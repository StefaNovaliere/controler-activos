"""Stooq: forex, materias primas, índices y acciones, sin clave.

Es la única fuente gratuita y sin registro que cubre a la vez oro (`xauusd`),
petróleo (`cl.f`, `cb.f`), divisas (`eurusd`) y acciones (`aapl.us`) con un solo
parser. Sirve además de red de seguridad cuando un proveedor con clave agota su
cuota.

Devuelve CSV, no JSON, y marca los valores ausentes como `N/D`: convertir eso a
número daría una excepción, y tratarlo como 0 dispararía una alerta falsa.
"""

from __future__ import annotations

import csv
import io
import re
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from typing import ClassVar, Mapping, Sequence

from ..config import ProviderSettings
from ..errors import ProviderError, SymbolNotFound
from ..models import PriceRequest, Quote
from .base import QuoteResult
from .http import HttpClient
from .registry import register

BASE_URL = "https://stooq.com/q/l/"
_MISSING = {"N/D", "N/A", "", "-"}

#: Los pares llevan la divisa dentro del nombre: `xauusd` cotiza en dólares,
#: `etheur` en euros. Stooq no la declara en el CSV, así que el símbolo es la
#: única pista. Solo se interpreta como par si el sufijo es una divisa conocida:
#: si no, `nosuch` pasaría por un par cotizado en "UCH".
_QUOTE_CURRENCIES = frozenset(
    {"usd", "eur", "gbp", "jpy", "chf", "aud", "cad", "nzd", "pln", "sek", "nok", "czk", "huf"}
)
_PAIR = re.compile(r"^[a-z]{3}([a-z]{3})$")


@register
class StooqProvider:
    name: ClassVar[str] = "stooq"
    max_batch: ClassVar[int] = 20

    def __init__(self, settings: ProviderSettings, env: Mapping[str, str]) -> None:
        self.max_batch = min(settings.batch_size, 20) if settings.batch_size else 20
        self._http = HttpClient(timeout=settings.timeout_seconds)

    def fetch(self, requests: Sequence[PriceRequest]) -> dict[str, QuoteResult]:
        if not requests:
            return {}
        results: dict[str, QuoteResult] = {}
        for chunk in _chunks(list(requests), self.max_batch):
            results.update(self._fetch_chunk(chunk))
        return results

    def _fetch_chunk(self, requests: list[PriceRequest]) -> dict[str, QuoteResult]:
        symbols = [r.symbol.lower() for r in requests]
        try:
            body = self._http.get(
                BASE_URL,
                provider=self.name,
                params={"s": ",".join(symbols), "f": "sd2t2ohlcv", "h": "", "e": "csv"},
            ).text
        except ProviderError as exc:
            return {r.asset_id: exc for r in requests}

        try:
            rows = _parse_csv(body)
        except ValueError as exc:
            return {r.asset_id: ProviderError(str(exc), provider=self.name) for r in requests}

        return {r.asset_id: _extract(r, rows, self.name) for r in requests}


def _parse_csv(body: str) -> dict[str, dict[str, str]]:
    reader = csv.DictReader(io.StringIO(body.strip()))
    if not reader.fieldnames or "Symbol" not in reader.fieldnames:
        raise ValueError(f"CSV inesperado: {body[:120]!r}")
    return {(row.get("Symbol") or "").strip().upper(): row for row in reader}


def _extract(request: PriceRequest, rows: dict[str, dict[str, str]], provider: str) -> QuoteResult:
    # Etiquetar un precio con una divisa que no es la suya produce alertas falsas
    # silenciosas: un ETH en dólares comparado con umbrales en euros se desvía un
    # ~7 %. Mejor un error visible que un número creíble y equivocado.
    if (quoted := _quote_currency(request.symbol)) and quoted != request.currency.lower():
        return ProviderError(
            f"'{request.symbol}' cotiza en {quoted.upper()}, pero el activo está "
            f"configurado en {request.currency.upper()}",
            provider=provider,
            symbol=request.symbol,
        )

    row = rows.get(request.symbol.upper())
    if row is None:
        return SymbolNotFound("no está en el CSV", provider=provider, symbol=request.symbol)

    raw = (row.get("Close") or "").strip()
    if raw.upper() in _MISSING:
        return SymbolNotFound(
            f"sin cotización (Stooq devolvió '{raw or 'vacío'}')",
            provider=provider,
            symbol=request.symbol,
        )
    try:
        price = Decimal(raw)
    except InvalidOperation:
        return ProviderError(f"precio ilegible: {raw!r}", provider=provider, symbol=request.symbol)

    return Quote(
        asset_id=request.asset_id,
        price=price,
        currency=request.currency,
        as_of=_parse_stamp(row),
        provider=provider,
    )


def _quote_currency(symbol: str) -> str | None:
    """La divisa de cotización según el nombre del par, o None si no es un par."""
    match = _PAIR.match(symbol.lower())
    if match and (suffix := match.group(1)) in _QUOTE_CURRENCIES:
        return suffix
    return None


def _parse_stamp(row: dict[str, str]) -> datetime:
    """La hora de Stooq es la de su servidor: vale para detectar datos rancios,
    no para lógica fina. Si falta, se asume que el dato es de ahora."""
    date, time = (row.get("Date") or "").strip(), (row.get("Time") or "").strip()
    if date.upper() in _MISSING:
        return datetime.now(UTC)
    try:
        stamp = datetime.strptime(f"{date} {time or '00:00:00'}", "%Y-%m-%d %H:%M:%S")
    except ValueError:
        return datetime.now(UTC)
    return stamp.replace(tzinfo=UTC)


def _chunks(items: list, size: int):
    for i in range(0, len(items), size):
        yield items[i : i + size]
