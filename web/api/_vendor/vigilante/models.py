"""Modelos de dominio.

Los precios son `Decimal` en todo el recorrido: comparar un umbral con un float
es la forma más fácil de que una alerta salte (o no salte) por un ULP.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime
from decimal import Decimal
from enum import StrEnum


class Zone(StrEnum):
    """Dónde está el precio respecto al rango vigilado."""

    BELOW = "below"
    INSIDE = "inside"
    ABOVE = "above"


class EventKind(StrEnum):
    INIT_OUTSIDE = "INIT_OUTSIDE"
    BREACH_LOWER = "BREACH_LOWER"
    BREACH_UPPER = "BREACH_UPPER"
    RECOVER_FROM_BELOW = "RECOVER_FROM_BELOW"
    RECOVER_FROM_ABOVE = "RECOVER_FROM_ABOVE"
    HEALTH = "HEALTH"
    #: Cayó lo suficiente desde su máximo. El aviso de "se dio vuelta".
    TRAILING_DROP = "TRAILING_DROP"
    #: Rebotó lo suficiente desde su mínimo.
    TRAILING_RISE = "TRAILING_RISE"


BREACH_KINDS = frozenset({EventKind.BREACH_LOWER, EventKind.BREACH_UPPER})
RECOVER_KINDS = frozenset({EventKind.RECOVER_FROM_BELOW, EventKind.RECOVER_FROM_ABOVE})
TRAILING_KINDS = frozenset({EventKind.TRAILING_DROP, EventKind.TRAILING_RISE})


@dataclass(frozen=True)
class PriceRequest:
    """Lo que el runner le pide a un proveedor."""

    asset_id: str
    symbol: str
    currency: str


@dataclass(frozen=True)
class Quote:
    """Un precio obtenido con éxito."""

    asset_id: str
    price: Decimal
    currency: str
    as_of: datetime
    provider: str


@dataclass(frozen=True)
class PendingEvent:
    """Evento notificable retenido por el cooldown, a la espera de poder salir."""

    kind: EventKind
    first_seen_at: datetime
    first_price: Decimal


@dataclass(frozen=True)
class AssetState:
    """Memoria persistente de un activo entre ejecuciones.

    `zone is None` significa arranque en frío: nunca se ha evaluado este activo
    (o su configuración cambió y hay que reclasificarlo desde cero).
    """

    zone: Zone | None = None
    last_price: Decimal | None = None
    last_ok_at: datetime | None = None
    last_breach_notified_at: datetime | None = None
    last_recovery_notified_at: datetime | None = None
    last_notified_event: EventKind | None = None
    pending: PendingEvent | None = None
    consecutive_failures: int = 0
    last_error: str | None = None
    last_error_at: datetime | None = None
    last_health_notified_at: datetime | None = None
    config_fingerprint: str | None = None

    #: Máximo y mínimo vistos desde que se sigue el rastro. Son la memoria del
    #: aviso de tipo trailing: sin ellos "cayó un 20 % desde su máximo" no se
    #: puede contestar, porque el máximo no está en el precio de ahora.
    peak: Decimal | None = None
    trough: Decimal | None = None
    last_trailing_notified_at: datetime | None = None
    #: Huella de la configuración de trailing. Si cambia, los extremos guardados
    #: ya no corresponden a lo que el usuario pidió y hay que reiniciarlos.
    trailing_fingerprint: str | None = None

    @property
    def last_notified_at(self) -> datetime | None:
        """El más reciente de los dos relojes de notificación."""
        stamps = [s for s in (self.last_breach_notified_at, self.last_recovery_notified_at) if s]
        return max(stamps) if stamps else None

    def with_(self, **kw) -> AssetState:
        return replace(self, **kw)


@dataclass(frozen=True)
class Event:
    """Algo que merece un mensaje. Lo produce el motor; lo redacta el notificador."""

    asset_id: str
    label: str
    kind: EventKind
    price: Decimal | None
    currency: str
    threshold: Decimal | None = None
    since: datetime | None = None
    first_price: Decimal | None = None
    detail: str | None = None

    @property
    def is_coalesced(self) -> bool:
        """True si el evento estuvo retenido por el cooldown antes de salir."""
        return self.since is not None
