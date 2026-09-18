"""Orquestación de una ejecución completa.

Pega las piezas y, sobre todo, decide el orden en que ocurren las cosas:
consultar → evaluar → **notificar** → persistir. Ese orden es deliberado: si la
notificación falla, el estado de los activos afectados no se guarda, de modo que
en la siguiente ejecución el cruce se vuelve a detectar. Se prefiere un aviso
duplicado (molesto) a un aviso perdido (que invalida el producto).
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from typing import Mapping, Sequence

from .config import Config, ResolvedAsset
from .engine import QuoteResult, evaluate
from .trailing import check as check_trailing
from .errors import NotifierError, ProviderError
from .history import append_quotes
from .models import AssetState, Event, EventKind, PriceRequest, Quote
from .notifiers.base import Notifier
from .notifiers.format import money, render
from .providers.base import PriceProvider
from .state_store import load_state, save_state

#: Si falla más de esta fracción de activos, el problema casi siempre es la red
#: del runner: se avisa una vez, no una vez por activo.
DEGRADED_FRACTION = 0.5


@dataclass
class RunResult:
    now: datetime
    events: list[Event] = field(default_factory=list)
    states: dict[str, AssetState] = field(default_factory=dict)
    quotes: dict[str, QuoteResult] = field(default_factory=dict)
    state_written: bool = False
    history_rows: int = 0
    message: str | None = None
    delivered: bool = False
    delivery_error: str | None = None

    @property
    def failures(self) -> dict[str, ProviderError]:
        return {k: v for k, v in self.quotes.items() if isinstance(v, ProviderError)}

    @property
    def degraded(self) -> bool:
        return bool(self.quotes) and len(self.failures) / len(self.quotes) > DEGRADED_FRACTION

    @property
    def exit_code(self) -> int:
        """Un 429 de un proveedor NO pone el repositorio en rojo.

        Si lo hiciera, el repo viviría en rojo y acabarías ignorando los avisos de
        GitHub justo cuando uno de verdad importe. Solo falla si no se pudo
        entregar la notificación (ahí sí se pierde la razón de ser del vigilante).
        """
        return 1 if self.delivery_error else 0


def run(
    config: Config,
    state_path: str | Path,
    *,
    now: datetime,
    notifier: Notifier | None,
    providers: Mapping[str, PriceProvider] | None = None,
    dry_run: bool = False,
    force_notify: bool = False,
    price_overrides: Mapping[str, Decimal] | None = None,
    history_dir: str | Path | None = None,
) -> RunResult:
    """Ejecuta un ciclo. `price_overrides` permite simular sin tocar la red."""
    previous = load_state(state_path)
    result = RunResult(now=now)

    result.quotes = (
        _simulated_quotes(config.assets, price_overrides, now)
        if price_overrides is not None
        else _collect_quotes(config.assets, providers or {})
    )

    states: dict[str, AssetState] = dict(previous)
    events: list[Event] = []
    for asset in config.assets:
        quote = result.quotes.get(asset.id)
        if quote is None:
            continue
        state, event = evaluate(asset, previous.get(asset.id), quote, now, force_notify=force_notify)
        if event is not None:
            events.append(event)

        # El trailing se evalúa DESPUÉS y sobre el estado ya avanzado, no en vez
        # de. Son dos preguntas distintas sobre el mismo precio —«¿llegó a este
        # nivel?» y «¿se dio la vuelta?»— y un activo puede querer las dos. Cada
        # una lleva su propio reloj, así que ninguna silencia a la otra.
        if isinstance(quote, Quote):
            state, trail = check_trailing(asset, state, quote, now, force_notify=force_notify)
            if trail is not None:
                events.append(trail)

        states[asset.id] = state

    events = _collapse_health(events, result, config.assets)
    result.states, result.events = states, events

    if events:
        summary_init = any(a.first_run_policy == "summary" for a in config.assets)
        result.message = render(events, now, summary_init=summary_init)

    if result.message and notifier is not None and not dry_run:
        try:
            notifier.send(result.message)
            result.delivered = True
        except NotifierError as exc:
            result.delivery_error = str(exc)
            # Se revierte solo lo que se había dado por avisado: el cruce se
            # volverá a detectar en la siguiente ejecución.
            for event in events:
                if event.asset_id in previous:
                    states[event.asset_id] = previous[event.asset_id]
                else:
                    states.pop(event.asset_id, None)

    if not dry_run:
        result.state_written = save_state(state_path, states, now)
        if history_dir is not None:
            quotes = [q for q in result.quotes.values() if isinstance(q, Quote)]
            result.history_rows = append_quotes(history_dir, quotes, now)

    return result


# --------------------------------------------------------------------------- #
# Obtención de precios
# --------------------------------------------------------------------------- #


def _collect_quotes(
    assets: Sequence[ResolvedAsset], providers: Mapping[str, PriceProvider]
) -> dict[str, QuoteResult]:
    """Una llamada por proveedor, y un reintento contra el fallback de cada activo."""
    requests: dict[str, list[PriceRequest]] = defaultdict(list)
    for asset in assets:
        requests[asset.provider].append(PriceRequest(asset.id, asset.symbol, asset.currency))

    results = _fetch_all(requests, providers)

    retries: dict[str, list[PriceRequest]] = defaultdict(list)
    for asset in assets:
        if asset.fallback and isinstance(results.get(asset.id), ProviderError):
            retries[asset.fallback.provider].append(
                PriceRequest(asset.id, asset.fallback.symbol, asset.currency)
            )
    # El fallback solo pisa el resultado si de verdad trajo un precio: un error del
    # suplente no debe sustituir al error original, que suele ser más informativo.
    for asset_id, value in _fetch_all(retries, providers).items():
        if isinstance(value, Quote):
            results[asset_id] = value

    return results


def _fetch_all(
    requests: Mapping[str, list[PriceRequest]], providers: Mapping[str, PriceProvider]
) -> dict[str, QuoteResult]:
    results: dict[str, QuoteResult] = {}
    for name, batch in requests.items():
        provider = providers.get(name)
        if provider is None:
            error = ProviderError("proveedor no disponible en esta ejecución", provider=name)
            results.update({r.asset_id: error for r in batch})
            continue
        try:
            results.update(provider.fetch(batch))
        except ProviderError as exc:
            results.update({r.asset_id: exc for r in batch})
        except Exception as exc:  # un proveedor roto no puede tumbar el resto
            error = ProviderError(f"error inesperado: {type(exc).__name__}: {exc}", provider=name)
            results.update({r.asset_id: error for r in batch})
    return results


def _simulated_quotes(
    assets: Sequence[ResolvedAsset], prices: Mapping[str, Decimal], now: datetime
) -> dict[str, QuoteResult]:
    return {
        asset.id: Quote(
            asset_id=asset.id,
            price=prices[asset.id],
            currency=asset.currency,
            as_of=now,
            provider="simulado",
        )
        for asset in assets
        if asset.id in prices
    }


def _collapse_health(
    events: list[Event], result: RunResult, assets: Sequence[ResolvedAsset]
) -> list[Event]:
    """Una caída general produce un aviso, no uno por activo."""
    if not result.degraded:
        return events
    kept = [e for e in events if e.kind is not EventKind.HEALTH]
    kept.append(
        Event(
            asset_id="*",
            label="Centinela",
            kind=EventKind.HEALTH,
            price=None,
            currency="",
            detail=(
                f"{len(result.failures)} de {len(result.quotes)} activos sin datos en esta "
                f"ejecución (probable corte de red o cuota agotada)"
            ),
        )
    )
    return kept


# --------------------------------------------------------------------------- #
# Informe
# --------------------------------------------------------------------------- #


def summarize(result: RunResult, config: Config) -> str:
    """Tabla en Markdown para `$GITHUB_STEP_SUMMARY` y para la salida local."""
    lines = [
        f"## Centinela de precios — {result.now:%Y-%m-%d %H:%M} UTC",
        "",
        "| Activo | Proveedor | Precio | Zona | Estado |",
        "| --- | --- | ---: | --- | --- |",
    ]
    for asset in config.assets:
        quote = result.quotes.get(asset.id)
        state = result.states.get(asset.id)
        if isinstance(quote, ProviderError):
            price, note = "—", f"⚠️ {quote}"
        elif quote is None:
            price, note = "—", "sin consultar"
        else:
            price = f"{money(quote.price)} {asset.currency.upper()}"
            note = "pendiente de avisar" if state and state.pending else "ok"
        zone = state.zone.value if state and state.zone else "—"
        lines.append(f"| {asset.label} | {asset.provider} | {price} | {zone} | {note} |")

    lines += ["", f"**Eventos:** {len(result.events)} · **Fallos:** {len(result.failures)}"]
    if result.delivery_error:
        lines.append(f"**Entrega fallida:** {result.delivery_error}")
    elif result.events:
        lines.append("**Entrega:** " + ("enviada" if result.delivered else "no enviada (dry-run)"))
    if result.state_written:
        lines.append("**Estado:** actualizado")
    if result.history_rows:
        lines.append(f"**Historial:** +{result.history_rows} fila(s)")
    return "\n".join(lines)
