"""Twelve Data: acciones y ETFs (plan gratuito).

Se usa `/quote` en vez de `/price` porque cuesta lo mismo (1 crédito por símbolo)
y además trae la marca de tiempo del dato, que es lo que permite distinguir "el
mercado está cerrado" de "el proveedor me está dando basura vieja".

Presupuesto: 800 créditos/día. Con el cron de 30 min (48 ejecuciones) caben unos
16 símbolos.
"""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from typing import Any, ClassVar, Mapping, Sequence

from ..config import ProviderSettings
from ..errors import ConfigError, ProviderError, RateLimited, SymbolNotFound
from ..models import PriceRequest, Quote
from .base import QuoteResult
from .http import HttpClient
from .registry import register

BASE_URL = "https://api.twelvedata.com/quote"


@register
class TwelveDataProvider:
    name: ClassVar[str] = "twelvedata"
    max_batch: ClassVar[int] = 8

    def __init__(self, settings: ProviderSettings, env: Mapping[str, str]) -> None:
        if not settings.api_key_env:
            raise ConfigError("el proveedor 'twelvedata' necesita 'api_key_env' en la configuración")
        self._api_key = env.get(settings.api_key_env)
        if not self._api_key:
            raise ConfigError(
                f"falta la variable de entorno {settings.api_key_env} (clave de Twelve Data)"
            )
        self.max_batch = settings.batch_size
        self._http = HttpClient(timeout=settings.timeout_seconds)

    def fetch(self, requests: Sequence[PriceRequest]) -> dict[str, QuoteResult]:
        if not requests:
            return {}
        results: dict[str, QuoteResult] = {}
        for chunk in _chunks(list(requests), self.max_batch):
            results.update(self._fetch_chunk(chunk))
        return results

    def _fetch_chunk(self, requests: list[PriceRequest]) -> dict[str, QuoteResult]:
        symbols = [r.symbol for r in requests]
        try:
            payload = self._http.get(
                BASE_URL,
                provider=self.name,
                params={"symbol": ",".join(symbols), "apikey": self._api_key},
            ).json()
        except ProviderError as exc:
            return {r.asset_id: exc for r in requests}
        except ValueError as exc:
            return {r.asset_id: ProviderError(f"respuesta ilegible: {exc}", provider=self.name) for r in requests}

        # Twelve Data señala el agotamiento de cuota con HTTP 200 y un cuerpo de
        # error: si no se mira el cuerpo, un 429 pasa por "precio no disponible".
        global_error = _as_error(payload, self.name, symbol=",".join(symbols))
        if global_error is not None:
            return {r.asset_id: global_error for r in requests}

        # Con un único símbolo la respuesta es el objeto plano, no un mapa por símbolo.
        if len(requests) == 1 and "symbol" in payload:
            payload = {requests[0].symbol: payload}

        return {r.asset_id: _extract(r, payload, self.name) for r in requests}


def _extract(request: PriceRequest, payload: dict, provider: str) -> QuoteResult:
    entry = payload.get(request.symbol) or payload.get(request.symbol.upper())
    if not isinstance(entry, dict):
        return SymbolNotFound("no está en la respuesta", provider=provider, symbol=request.symbol)

    error = _as_error(entry, provider, symbol=request.symbol)
    if error is not None:
        return error

    raw = entry.get("close") or entry.get("price")
    if raw in (None, ""):
        return SymbolNotFound("sin precio de cierre", provider=provider, symbol=request.symbol)
    try:
        price = Decimal(str(raw))
    except InvalidOperation:
        return ProviderError(f"precio ilegible: {raw!r}", provider=provider, symbol=request.symbol)

    timestamp = entry.get("timestamp")
    as_of = (
        datetime.fromtimestamp(int(timestamp), tz=UTC)
        if isinstance(timestamp, (int, float, str)) and str(timestamp).isdigit()
        else datetime.now(UTC)
    )
    return Quote(
        asset_id=request.asset_id,
        price=price,
        currency=(entry.get("currency") or request.currency).lower(),
        as_of=as_of,
        provider=provider,
    )


def _as_error(payload: Any, provider: str, *, symbol: str) -> ProviderError | None:
    if not isinstance(payload, dict) or payload.get("status") != "error":
        return None
    code = payload.get("code")
    message = str(payload.get("message", "error sin detalle"))
    if code == 429:
        return RateLimited(message, provider=provider, symbol=symbol)
    if code == 404:
        return SymbolNotFound(message, provider=provider, symbol=symbol)
    return ProviderError(f"{code}: {message}", provider=provider, symbol=symbol)


def _chunks(items: list, size: int):
    for i in range(0, len(items), size):
        yield items[i : i + size]
