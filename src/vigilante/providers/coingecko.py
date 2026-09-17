"""CoinGecko: criptomonedas.

Funciona sin clave (modo *keyless*), pero el límite es por IP y dinámico — y los
runners de GitHub comparten IP con medio mundo, así que ahí conviene la Demo key
gratuita. Una sola petición cubre todos los activos de cripto de la ejecución.
"""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from typing import ClassVar, Mapping, Sequence

from ..config import ProviderSettings
from ..errors import ProviderError, SymbolNotFound
from ..models import PriceRequest, Quote
from .base import QuoteResult
from .http import HttpClient
from .registry import register

BASE_URL = "https://api.coingecko.com/api/v3/simple/price"


@register
class CoinGeckoProvider:
    name: ClassVar[str] = "coingecko"
    max_batch: ClassVar[int] = 100

    def __init__(self, settings: ProviderSettings, env: Mapping[str, str]) -> None:
        self._api_key = env.get(settings.api_key_env) if settings.api_key_env else None
        self._http = HttpClient(timeout=settings.timeout_seconds)

    def fetch(self, requests: Sequence[PriceRequest]) -> dict[str, QuoteResult]:
        if not requests:
            return {}
        results: dict[str, QuoteResult] = {}
        for chunk in _chunks(list(requests), self.max_batch):
            results.update(self._fetch_chunk(chunk))
        return results

    def _fetch_chunk(self, requests: list[PriceRequest]) -> dict[str, QuoteResult]:
        ids = sorted({r.symbol.lower() for r in requests})
        currencies = sorted({r.currency.lower() for r in requests})
        headers = {"x-cg-demo-api-key": self._api_key} if self._api_key else {}

        try:
            payload = self._http.get(
                BASE_URL,
                provider=self.name,
                params={
                    "ids": ",".join(ids),
                    "vs_currencies": ",".join(currencies),
                    "include_last_updated_at": "true",
                },
                headers=headers,
            ).json()
        except ProviderError as exc:
            return {r.asset_id: exc for r in requests}
        except ValueError as exc:
            return {r.asset_id: ProviderError(f"respuesta ilegible: {exc}", provider=self.name) for r in requests}

        return {r.asset_id: _extract(r, payload, self.name) for r in requests}


def _extract(request: PriceRequest, payload: dict, provider: str) -> QuoteResult:
    # Un id desconocido no da 404: CoinGecko simplemente lo omite. Tratarlo como
    # "sin dato" en vez de como error dejaría el activo sin vigilar en silencio.
    entry = payload.get(request.symbol.lower())
    if not isinstance(entry, dict):
        return SymbolNotFound(
            "no está en la respuesta (¿es el id de CoinGecko y no el ticker?)",
            provider=provider,
            symbol=request.symbol,
        )

    raw = entry.get(request.currency.lower())
    if raw is None:
        return SymbolNotFound(
            f"sin precio en '{request.currency}'", provider=provider, symbol=request.symbol
        )

    try:
        price = Decimal(str(raw))
    except InvalidOperation:
        return ProviderError(f"precio ilegible: {raw!r}", provider=provider, symbol=request.symbol)

    updated = entry.get("last_updated_at")
    as_of = (
        datetime.fromtimestamp(int(updated), tz=UTC)
        if isinstance(updated, (int, float))
        else datetime.now(UTC)
    )
    return Quote(
        asset_id=request.asset_id,
        price=price,
        currency=request.currency,
        as_of=as_of,
        provider=provider,
    )


def _chunks(items: list, size: int):
    for i in range(0, len(items), size):
        yield items[i : i + size]
