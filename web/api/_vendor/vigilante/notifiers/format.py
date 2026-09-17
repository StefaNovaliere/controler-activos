"""Redacción de los mensajes.

Se envía **un solo mensaje por ejecución** con todos los eventos: en una caída de
mercado, ocho mensajes seguidos son ruido, uno con ocho líneas es información.
"""

from __future__ import annotations

import html
from datetime import datetime, timedelta
from decimal import Decimal

from ..models import Event, EventKind

_ICONS = {
    EventKind.BREACH_LOWER: "🔻",
    EventKind.BREACH_UPPER: "🔺",
    EventKind.RECOVER_FROM_BELOW: "✅",
    EventKind.RECOVER_FROM_ABOVE: "✅",
    EventKind.INIT_OUTSIDE: "•",
    EventKind.HEALTH: "⚠️",
}

#: El umbral va dentro de la frase: pegarlo al final produce titulares como
#: "ha vuelto al rango 55 000 USD", que no dicen de qué lado se volvió.
_HEADLINES = {
    EventKind.BREACH_LOWER: "ha cruzado por DEBAJO de {umbral}",
    EventKind.BREACH_UPPER: "ha cruzado por ENCIMA de {umbral}",
    EventKind.RECOVER_FROM_BELOW: "ha vuelto al rango (por encima de {umbral})",
    EventKind.RECOVER_FROM_ABOVE: "ha vuelto al rango (por debajo de {umbral})",
}


def render(events: list[Event], now: datetime, *, summary_init: bool = True) -> str:
    """Compone el mensaje completo de una ejecución."""
    init = [e for e in events if e.kind is EventKind.INIT_OUTSIDE]
    health = [e for e in events if e.kind is EventKind.HEALTH]
    alerts = [e for e in events if e.kind not in (EventKind.INIT_OUTSIDE, EventKind.HEALTH)]

    blocks: list[str] = [f"<b>Centinela de precios</b> · {now:%d/%m/%Y %H:%M} UTC"]

    if alerts:
        blocks.append("\n".join(_render_alert(e, now) for e in alerts))
    if init:
        blocks.append(
            _render_init_summary(init, now)
            if summary_init
            else "\n".join(_render_alert(e, now) for e in init)
        )
    if health:
        blocks.append("\n".join(_render_health(e) for e in health))

    return "\n\n".join(blocks)


def _render_alert(event: Event, now: datetime) -> str:
    icon = _ICONS[event.kind]
    label = html.escape(event.label)
    currency = event.currency.upper()

    if event.kind is EventKind.INIT_OUTSIDE:
        side = "por debajo de" if event.threshold is not None and _below(event) else "por encima de"
        return f"{icon} <b>{label}</b>: {money(event.price)} {currency} ({side} {money(event.threshold)})"

    umbral = f"{money(event.threshold)} {currency}" if event.threshold is not None else "su umbral"
    headline = _HEADLINES[event.kind].format(umbral=umbral)
    lines = [f"{icon} <b>{label}</b> {headline}"]

    detail = f"    Ahora: <b>{money(event.price)} {currency}</b>"
    if event.is_coalesced and event.first_price is not None:
        detail += f" · cruzó hace {_ago(event.since, now)} a {money(event.first_price)}"
    if event.detail:
        detail += f" · {html.escape(event.detail)}"
    lines.append(detail)
    return "\n".join(lines)


def _render_init_summary(events: list[Event], now: datetime) -> str:
    """Arranque en frío: un bloque, no un mensaje por activo."""
    head = f"<i>Centinela iniciado. {len(events)} activo(s) ya fuera de rango:</i>"
    return "\n".join([head, *(_render_alert(e, now) for e in events)])


def _render_health(event: Event) -> str:
    return f"{_ICONS[event.kind]} <b>{html.escape(event.label)}</b>: {html.escape(event.detail or '')}"


def _below(event: Event) -> bool:
    return event.price is not None and event.threshold is not None and event.price < event.threshold


def money(value: Decimal | None) -> str:
    """Miles separados por espacio: no se confunde con el separador decimal."""
    if value is None:
        return "—"
    normalized = value.normalize()
    if abs(normalized) >= 1000:
        return f"{normalized:,.2f}".replace(",", " ")
    # Por debajo de 1000 se respeta la precisión original: redondear EUR/USD a dos
    # decimales borraría justo el dígito en el que se mueve el par.
    return format(normalized, "f")


def _ago(since: datetime | None, now: datetime) -> str:
    if since is None:
        return "un rato"
    return _humanize(now - since)


def _humanize(delta: timedelta) -> str:
    minutes = max(int(delta.total_seconds() // 60), 0)
    if minutes < 60:
        return f"{minutes} min"
    hours, minutes = divmod(minutes, 60)
    if hours < 24:
        return f"{hours} h {minutes:02d} min"
    return f"{hours // 24} d {hours % 24} h"
