"""Avisos relativos a un extremo: «cayó un X % desde su máximo».

Este módulo es PURO, igual que `engine.py`: no hace red, no lee el reloj y no
toca el disco.

Va aparte del motor de zonas a propósito, y no es una separación cosmética: son
dos preguntas distintas sobre el mismo precio.

    engine.py   →  ¿llegó a este precio?      (nivel absoluto, decidido por ti)
    trailing.py →  ¿se dio la vuelta?         (movimiento relativo a su extremo)

Un umbral fijo sirve cuando tienes una opinión de precio («si XRP llega a 2,
vendo»). No sirve para vender alto en algo que no sabes hasta dónde va a subir:
ahí no quieres elegir el techo, quieres que te avisen cuando se haya dado la
vuelta. Y como es un porcentaje sobre el propio máximo, no hay que reajustarlo
cuando el activo cambia de orden de magnitud, que es justo lo que hace una
memecoin en una semana.

Los dos mecanismos conviven en el mismo activo y no se estorban: cada uno lleva
su propio reloj de silencio y su propia huella de configuración.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from decimal import Decimal

from .config import ResolvedAsset
from .models import AssetState, Event, EventKind, Quote

CIEN = Decimal(100)


def check(
    cfg: ResolvedAsset,
    state: AssetState,
    quote: Quote,
    now: datetime,
    *,
    force_notify: bool = False,
) -> tuple[AssetState, Event | None]:
    """Avanza el rastro de máximo y mínimo, y decide si toca avisar.

    Recibe el estado que ya ha actualizado el motor de zonas y devuelve el mismo
    estado con el rastro al día. Si el activo no tiene trailing configurado, no
    toca nada: ni siquiera guarda extremos, para que el estado no engorde con
    datos que nadie va a leer.
    """
    if cfg.trailing is None:
        return _limpiar(state), None

    huella = cfg.trailing_fingerprint()
    precio = quote.price

    # Arranque en frío: nunca visto, o el usuario cambió los porcentajes y los
    # extremos guardados ya no corresponden a lo que pidió. Se siembra con el
    # precio de ahora y no se avisa: no hay historia con la que comparar, y un
    # aviso en la primera consulta sería inventado.
    if state.peak is None or state.trough is None or state.trailing_fingerprint != huella:
        return state.with_(peak=precio, trough=precio, trailing_fingerprint=huella), None

    peak = max(state.peak, precio)
    trough = min(state.trough, precio)
    base = state.with_(peak=peak, trough=trough, trailing_fingerprint=huella)

    disparo = _disparo(cfg, peak, trough, precio)
    if disparo is None:
        return base, None

    kind, extremo = disparo

    # El silencio retiene, pero NO se reinician los extremos: a diferencia de un
    # cruce de zona, que es un instante y hay que recordar, esta condición sigue
    # siendo cierta en la consulta siguiente y se volverá a detectar sola. Por
    # eso aquí no hace falta un evento pendiente.
    if not force_notify and not _silencio_vencido(state.last_trailing_notified_at, cfg.cooldown_minutes, now):
        return base, None

    evento = Event(
        asset_id=cfg.id,
        label=cfg.label,
        kind=kind,
        price=precio,
        currency=cfg.currency,
        # El extremo viaja como `threshold`: con él y el precio, el notificador
        # calcula el porcentaje. Formatear no es trabajo de un módulo puro, y
        # además así el número que se lee no puede desviarse del que se comparó.
        threshold=extremo,
    )

    # Tras avisar, el rastro se reinicia en el precio de ahora. Sin esto el aviso
    # se repetiría en cada consulta mientras siguiera cayendo; con esto, una
    # caída en cascada avisa por tramos, que es lo que sirve.
    return (
        base.with_(peak=precio, trough=precio, last_trailing_notified_at=now),
        evento,
    )


def _disparo(
    cfg: ResolvedAsset, peak: Decimal, trough: Decimal, precio: Decimal
) -> tuple[EventKind, Decimal] | None:
    """Qué aviso corresponde, si corresponde alguno.

    La caída se mira primero. Que las dos condiciones sean ciertas a la vez solo
    puede pasar con porcentajes muy pequeños sobre un precio que oscila, y en ese
    caso avisar de la caída es lo prudente.
    """
    t = cfg.trailing
    assert t is not None  # lo garantiza el llamador

    if t.drop_pct is not None and peak > 0:
        caida = (peak - precio) / peak * CIEN
        if caida >= t.drop_pct:
            return EventKind.TRAILING_DROP, peak

    if t.rise_pct is not None and trough > 0:
        subida = (precio - trough) / trough * CIEN
        if subida >= t.rise_pct:
            return EventKind.TRAILING_RISE, trough

    return None


def _silencio_vencido(last: datetime | None, minutes: int, now: datetime) -> bool:
    if last is None:
        return True
    return (now - last) >= timedelta(minutes=minutes)


def _limpiar(state: AssetState) -> AssetState:
    """Sin trailing configurado, el rastro guardado sobra."""
    if state.peak is None and state.trough is None and state.trailing_fingerprint is None:
        return state
    return state.with_(peak=None, trough=None, trailing_fingerprint=None)
