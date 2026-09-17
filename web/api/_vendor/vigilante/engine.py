"""Máquina de estados de las alertas.

Este módulo es PURO: no importa nada de `providers/` ni de `notifiers/`, no hace
red, no lee el reloj y no toca el disco. Recibe la configuración de un activo, su
estado anterior, el resultado de la consulta y el instante actual, y devuelve el
estado nuevo junto con el evento a notificar (si lo hay).

Esa pureza es deliberada: es lo que permite recorrer en un test todo el ciclo de
vida de una alerta (cruce → cooldown → pendiente → coalescido → recuperación) sin
esperar al cron ni tocar la red.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from decimal import Decimal

from .config import ResolvedAsset
from .errors import ProviderError, StaleData
from .models import (
    BREACH_KINDS,
    RECOVER_KINDS,
    AssetState,
    Event,
    EventKind,
    PendingEvent,
    Quote,
    Zone,
)

QuoteResult = Quote | ProviderError

#: Tras cuántos fallos seguidos avisar de que un activo lleva a ciegas.
#: Con el cron de 30 min son ~3 h, ~12 h y ~48 h.
HEALTH_FAILURE_STEPS = (6, 24, 96)
HEALTH_COOLDOWN_MINUTES = 720

_TRANSITIONS: dict[tuple[Zone, Zone], EventKind] = {
    (Zone.INSIDE, Zone.BELOW): EventKind.BREACH_LOWER,
    (Zone.INSIDE, Zone.ABOVE): EventKind.BREACH_UPPER,
    (Zone.BELOW, Zone.ABOVE): EventKind.BREACH_UPPER,
    (Zone.ABOVE, Zone.BELOW): EventKind.BREACH_LOWER,
    (Zone.BELOW, Zone.INSIDE): EventKind.RECOVER_FROM_BELOW,
    (Zone.ABOVE, Zone.INSIDE): EventKind.RECOVER_FROM_ABOVE,
}


def classify(price: Decimal, cfg: ResolvedAsset, prev: Zone | None) -> Zone:
    """Sitúa un precio en su zona.

    La comparación con el umbral es estricta: un precio exactamente igual a
    `lower` está DENTRO del rango, no por debajo.

    La histéresis solo se aplica al RE-ENTRAR: para volver a `INSIDE` desde
    `BELOW` no basta con rozar el umbral, hay que recuperar el margen. Así un
    precio oscilando sobre la frontera no genera una ráfaga de cruces.
    """
    h = cfg.hysteresis_pct / Decimal(100)
    if cfg.lower is not None and price < cfg.lower:
        return Zone.BELOW
    if cfg.upper is not None and price > cfg.upper:
        return Zone.ABOVE
    if prev is Zone.BELOW and cfg.lower is not None and price < cfg.lower * (1 + h):
        return Zone.BELOW
    if prev is Zone.ABOVE and cfg.upper is not None and price > cfg.upper * (1 - h):
        return Zone.ABOVE
    return Zone.INSIDE


def evaluate(
    cfg: ResolvedAsset,
    prev: AssetState | None,
    result: QuoteResult,
    now: datetime,
    *,
    force_notify: bool = False,
) -> tuple[AssetState, Event | None]:
    """Avanza un activo un paso. Única puerta de entrada al motor."""
    state = prev or AssetState()

    if isinstance(result, Quote) and _is_stale(result, cfg, now):
        age = now - result.as_of
        result = StaleData(
            f"precio de hace {_humanize(age)} (máximo {cfg.max_staleness_minutes} min)",
            provider=result.provider,
            symbol=cfg.symbol,
        )

    if isinstance(result, ProviderError):
        return _on_failure(cfg, state, result, now)
    return _on_quote(cfg, state, result, now, force_notify)


# --------------------------------------------------------------------------- #
# Fallo del proveedor
# --------------------------------------------------------------------------- #


def _on_failure(
    cfg: ResolvedAsset, state: AssetState, err: ProviderError, now: datetime
) -> tuple[AssetState, Event | None]:
    """Un fallo NUNCA toca `zone`, `pending` ni los relojes de notificación.

    Si lo hiciera, una caída del proveedor se traduciría en alertas fantasma al
    volver el servicio: el activo parecería haber "cruzado" cuando en realidad
    solo dejamos de mirarlo un rato.
    """
    nxt = state.with_(
        consecutive_failures=state.consecutive_failures + 1,
        last_error=str(err),
        last_error_at=now,
    )
    if nxt.consecutive_failures in HEALTH_FAILURE_STEPS and _cooldown_ok(
        state.last_health_notified_at, HEALTH_COOLDOWN_MINUTES, now
    ):
        event = Event(
            asset_id=cfg.id,
            label=cfg.label,
            kind=EventKind.HEALTH,
            price=None,
            currency=cfg.currency,
            detail=f"{nxt.consecutive_failures} consultas seguidas fallidas: {err}",
        )
        return nxt.with_(last_health_notified_at=now), event
    return nxt, None


# --------------------------------------------------------------------------- #
# Precio válido
# --------------------------------------------------------------------------- #


def _on_quote(
    cfg: ResolvedAsset, state: AssetState, quote: Quote, now: datetime, force_notify: bool
) -> tuple[AssetState, Event | None]:
    fingerprint = cfg.fingerprint()
    # Arranque en frío: nunca visto, o su configuración cambió y el estado
    # anterior ya no es comparable con el nuevo rango.
    cold = state.zone is None or state.config_fingerprint != fingerprint
    prev_zone = None if cold else state.zone

    zone = classify(quote.price, cfg, prev_zone)
    base = state.with_(
        zone=zone,
        last_price=quote.price,
        last_ok_at=now,
        consecutive_failures=0,
        last_error=None,
        last_error_at=None,
        config_fingerprint=fingerprint,
    )

    if cold:
        return _on_cold_start(cfg, base.with_(pending=None), zone, now)
    if zone == prev_zone:
        return _on_steady(cfg, base, zone, now, force_notify)
    return _on_transition(cfg, base, prev_zone, zone, now, force_notify)


def _on_cold_start(
    cfg: ResolvedAsset, base: AssetState, zone: Zone, now: datetime
) -> tuple[AssetState, Event | None]:
    if zone is Zone.INSIDE or cfg.first_run_policy == "none":
        return base, None
    event = Event(
        asset_id=cfg.id,
        label=cfg.label,
        kind=EventKind.INIT_OUTSIDE,
        price=base.last_price,
        currency=cfg.currency,
        threshold=_threshold_for(cfg, zone),
    )
    return _mark_notified(base, EventKind.INIT_OUTSIDE, now), event


def _on_steady(
    cfg: ResolvedAsset, base: AssetState, zone: Zone, now: datetime, force_notify: bool
) -> tuple[AssetState, Event | None]:
    """Misma zona que antes: solo puede salir un pendiente o un recordatorio."""
    pending = base.pending
    if pending is not None:
        if force_notify or _cooldown_ok(_stamp_for(base, pending.kind), cfg.cooldown_minutes, now):
            event = Event(
                asset_id=cfg.id,
                label=cfg.label,
                kind=pending.kind,
                price=base.last_price,
                currency=cfg.currency,
                threshold=_threshold_for(cfg, zone) or _threshold_for_kind(cfg, pending.kind),
                since=pending.first_seen_at,
                first_price=pending.first_price,
            )
            return _mark_notified(base.with_(pending=None), pending.kind, now), event
        return base, None

    if cfg.renotify_while_outside and zone is not Zone.INSIDE:
        kind = EventKind.BREACH_LOWER if zone is Zone.BELOW else EventKind.BREACH_UPPER
        if force_notify or _cooldown_ok(_stamp_for(base, kind), cfg.cooldown_minutes, now):
            event = Event(
                asset_id=cfg.id,
                label=cfg.label,
                kind=kind,
                price=base.last_price,
                currency=cfg.currency,
                threshold=_threshold_for(cfg, zone),
                detail="sigue fuera de rango",
            )
            return _mark_notified(base, kind, now), event
    return base, None


def _on_transition(
    cfg: ResolvedAsset,
    base: AssetState,
    prev_zone: Zone,
    zone: Zone,
    now: datetime,
    force_notify: bool,
) -> tuple[AssetState, Event | None]:
    kind = _TRANSITIONS[(prev_zone, zone)]
    pending = base.pending

    # Vuelta al rango con un cruce que nunca llegó a anunciarse: el usuario no se
    # enteró de la ruptura, así que anunciarle la "recuperación" solo confunde.
    if zone is Zone.INSIDE and pending is not None and pending.kind in BREACH_KINDS:
        if not cfg.notify_transient:
            return base.with_(pending=None), None
        event = Event(
            asset_id=cfg.id,
            label=cfg.label,
            kind=kind,
            price=base.last_price,
            currency=cfg.currency,
            threshold=_threshold_for_kind(cfg, pending.kind),
            since=pending.first_seen_at,
            first_price=pending.first_price,
            detail="cruce breve, ya de vuelta en el rango",
        )
        return _mark_notified(base.with_(pending=None), kind, now), event

    if zone is Zone.INSIDE and not cfg.notify_on_return:
        return base.with_(pending=None), None

    # Un cruce completo (de un extremo al otro entre dos consultas) es demasiado
    # informativo como para que un cooldown lo silencie.
    full_cross = prev_zone is not Zone.INSIDE and zone is not Zone.INSIDE
    if full_cross or force_notify or _cooldown_ok(_stamp_for(base, kind), cfg.cooldown_minutes, now):
        event = Event(
            asset_id=cfg.id,
            label=cfg.label,
            kind=kind,
            price=base.last_price,
            currency=cfg.currency,
            threshold=_threshold_for_kind(cfg, kind),
        )
        return _mark_notified(base.with_(pending=None), kind, now), event

    # Retenido por el cooldown: se guarda, no se descarta. Saldrá coalescido.
    return base.with_(pending=PendingEvent(kind=kind, first_seen_at=now, first_price=base.last_price)), None


# --------------------------------------------------------------------------- #
# Utilidades
# --------------------------------------------------------------------------- #


def _is_stale(quote: Quote, cfg: ResolvedAsset, now: datetime) -> bool:
    return (now - quote.as_of) > timedelta(minutes=cfg.max_staleness_minutes)


def _cooldown_ok(last: datetime | None, minutes: int, now: datetime) -> bool:
    """El cooldown vencido incluye el instante exacto del límite."""
    if last is None:
        return True
    return (now - last) >= timedelta(minutes=minutes)


def _stamp_for(state: AssetState, kind: EventKind) -> datetime | None:
    """Las recuperaciones llevan su propio reloj.

    Así el cooldown de una ruptura no puede tragarse el aviso de que el precio ha
    vuelto al rango, que es justo la otra mitad de la señal de compra/venta.
    """
    if kind in RECOVER_KINDS:
        return state.last_recovery_notified_at
    return state.last_breach_notified_at


def _mark_notified(state: AssetState, kind: EventKind, now: datetime) -> AssetState:
    if kind in RECOVER_KINDS:
        return state.with_(last_recovery_notified_at=now, last_notified_event=kind)
    return state.with_(last_breach_notified_at=now, last_notified_event=kind)


def _threshold_for(cfg: ResolvedAsset, zone: Zone) -> Decimal | None:
    if zone is Zone.BELOW:
        return cfg.lower
    if zone is Zone.ABOVE:
        return cfg.upper
    return None


def _threshold_for_kind(cfg: ResolvedAsset, kind: EventKind) -> Decimal | None:
    if kind in (EventKind.BREACH_LOWER, EventKind.RECOVER_FROM_BELOW):
        return cfg.lower
    if kind in (EventKind.BREACH_UPPER, EventKind.RECOVER_FROM_ABOVE):
        return cfg.upper
    return None


def _humanize(delta: timedelta) -> str:
    minutes = int(delta.total_seconds() // 60)
    if minutes < 60:
        return f"{minutes} min"
    hours, minutes = divmod(minutes, 60)
    if hours < 24:
        return f"{hours} h {minutes:02d} min"
    days, hours = divmod(hours, 24)
    return f"{days} d {hours} h"
