"""Contrato que cumple toda fuente de precios."""

from __future__ import annotations

from typing import ClassVar, Mapping, Protocol, Sequence, runtime_checkable

from ..config import ProviderSettings
from ..errors import ProviderError
from ..models import PriceRequest, Quote

QuoteResult = Quote | ProviderError


@runtime_checkable
class PriceProvider(Protocol):
    """Devuelve un resultado **por símbolo**, no un resultado global.

    Que el fallo se aísle por símbolo es lo que permite que un 429 en las
    acciones no deje sin vigilar el oro y las criptos.
    """

    name: ClassVar[str]
    max_batch: ClassVar[int]

    def __init__(self, settings: ProviderSettings, env: Mapping[str, str]) -> None: ...

    def fetch(self, requests: Sequence[PriceRequest]) -> dict[str, QuoteResult]: ...
