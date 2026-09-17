"""Reloj inyectable.

El motor recibe `now` como parámetro, así que los tests no necesitan parchear
nada: basta con pasar otro instante.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Protocol


class Clock(Protocol):
    def now(self) -> datetime: ...


class SystemClock:
    """Reloj real. Siempre UTC y tz-aware."""

    def now(self) -> datetime:
        return datetime.now(UTC).replace(microsecond=0)


class FrozenClock:
    """Reloj de test: parado, avanzable a mano."""

    def __init__(self, start: datetime) -> None:
        self._now = _as_utc(start)

    def now(self) -> datetime:
        return self._now

    def advance(self, **kw) -> datetime:
        self._now += timedelta(**kw)
        return self._now


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)
