from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path

import responses

from vigilante.config import ProviderSettings
from vigilante.errors import ProviderError, SymbolNotFound
from vigilante.models import PriceRequest
from vigilante.providers.stooq import BASE_URL, StooqProvider

CSV = (Path(__file__).parent.parent / "fixtures" / "stooq_quotes.csv").read_text()

REQUESTS = [
    PriceRequest("oro", "xauusd", "usd"),
    PriceRequest("brent", "cb.f", "usd"),
    PriceRequest("basura", "nosuch", "usd"),
    PriceRequest("ausente", "noestaenelcsv", "usd"),
]


def _provider() -> StooqProvider:
    provider = StooqProvider(ProviderSettings(timeout_seconds=1), {})
    provider._http.retries = 0
    return provider


@responses.activate
def test_parsea_csv_multisimbolo():
    responses.add(responses.GET, BASE_URL, body=CSV, content_type="text/csv")
    out = _provider().fetch(REQUESTS)

    assert out["oro"].price == Decimal("3721.88")
    assert out["oro"].as_of == datetime(2026, 9, 17, 15, 42, 10, tzinfo=UTC)
    assert out["brent"].price == Decimal("71.55")
    assert len(responses.calls) == 1, "un solo CSV para todos los símbolos"


@responses.activate
def test_nd_es_falta_de_dato_no_un_precio_de_cero():
    """Convertir 'N/D' en 0 dispararía una alerta de caída catastrófica falsa."""
    responses.add(responses.GET, BASE_URL, body=CSV, content_type="text/csv")
    out = _provider().fetch(REQUESTS)
    assert isinstance(out["basura"], SymbolNotFound)
    assert isinstance(out["ausente"], SymbolNotFound)


@responses.activate
def test_csv_inesperado_no_revienta_el_parser():
    responses.add(responses.GET, BASE_URL, body="<html>rate limited</html>", content_type="text/html")
    out = _provider().fetch(REQUESTS)
    assert all(isinstance(v, ProviderError) for v in out.values())


@responses.activate
def test_fallo_de_red_se_reparte_por_simbolo():
    responses.add(responses.GET, BASE_URL, status=503)
    out = _provider().fetch(REQUESTS)
    assert set(out) == {r.asset_id for r in REQUESTS}
    assert all(isinstance(v, ProviderError) for v in out.values())


@responses.activate
def test_un_par_en_otra_divisa_es_error_no_un_precio_mal_etiquetado():
    """`ethusd` comparado con umbrales en euros se desvía ~7 %: alertas falsas."""
    responses.add(responses.GET, BASE_URL, body=CSV, content_type="text/csv")
    out = _provider().fetch([PriceRequest("eth", "ethusd", "eur")])

    assert isinstance(out["eth"], ProviderError)
    assert "cotiza en USD" in str(out["eth"])


@responses.activate
def test_un_par_en_la_divisa_correcta_pasa():
    responses.add(responses.GET, BASE_URL, body=CSV, content_type="text/csv")
    out = _provider().fetch([PriceRequest("oro", "xauusd", "usd")])
    assert out["oro"].price == Decimal("3721.88")


@responses.activate
def test_los_simbolos_que_no_son_pares_no_se_tocan():
    """`cb.f` o `aapl.us` no llevan divisa en el nombre: no hay nada que comprobar."""
    responses.add(responses.GET, BASE_URL, body=CSV, content_type="text/csv")
    out = _provider().fetch([PriceRequest("brent", "cb.f", "eur")])
    assert out["brent"].price == Decimal("71.55")
