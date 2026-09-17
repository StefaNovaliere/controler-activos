from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path

import pytest
import responses

from vigilante.config import ProviderSettings
from vigilante.errors import ProviderError, RateLimited, SymbolNotFound
from vigilante.models import PriceRequest, Quote
from vigilante.providers.coingecko import BASE_URL, CoinGeckoProvider

FIXTURE = Path(__file__).parent.parent / "fixtures" / "coingecko_simple_price.json"

REQUESTS = [
    PriceRequest("btc", "bitcoin", "usd"),
    PriceRequest("eth", "ethereum", "eur"),
    PriceRequest("falso", "no-such-coin", "usd"),
]


def _provider(key_env: str | None = None, env: dict | None = None) -> CoinGeckoProvider:
    settings = ProviderSettings(api_key_env=key_env, timeout_seconds=1)
    provider = CoinGeckoProvider(settings, env or {})
    provider._http.retries = 0
    return provider


@responses.activate
def test_parseo_feliz_y_simbolo_ausente():
    responses.add(responses.GET, BASE_URL, body=FIXTURE.read_text(), content_type="application/json")
    out = _provider().fetch(REQUESTS)

    assert out["btc"] == Quote(
        asset_id="btc",
        price=Decimal("61234.5"),
        currency="usd",
        as_of=datetime(2026, 9, 17, 13, 30, tzinfo=UTC),
        provider="coingecko",
    )
    # CoinGecko omite los ids que no conoce en vez de dar 404: tratarlo como
    # "sin dato" dejaría el activo sin vigilar en silencio.
    assert isinstance(out["falso"], SymbolNotFound)
    # ethereum existe pero no trae precio en euros
    assert isinstance(out["eth"], SymbolNotFound)


@responses.activate
def test_una_sola_peticion_para_todas_las_criptos():
    responses.add(responses.GET, BASE_URL, body=FIXTURE.read_text(), content_type="application/json")
    _provider().fetch(REQUESTS)
    assert len(responses.calls) == 1


@responses.activate
def test_la_demo_key_viaja_en_la_cabecera():
    responses.add(responses.GET, BASE_URL, body="{}", content_type="application/json")
    _provider("CG_KEY", {"CG_KEY": "CG-secreta"}).fetch(REQUESTS[:1])
    assert responses.calls[0].request.headers["x-cg-demo-api-key"] == "CG-secreta"


@responses.activate
def test_sin_key_no_se_manda_cabecera():
    responses.add(responses.GET, BASE_URL, body="{}", content_type="application/json")
    _provider().fetch(REQUESTS[:1])
    assert "x-cg-demo-api-key" not in responses.calls[0].request.headers


@responses.activate
def test_cuota_agotada_afecta_a_todos_los_simbolos_del_lote():
    responses.add(responses.GET, BASE_URL, status=429)
    out = _provider().fetch(REQUESTS)
    assert all(isinstance(v, RateLimited) for v in out.values())


@responses.activate
def test_respuesta_no_json_es_un_error_no_una_excepcion():
    responses.add(responses.GET, BASE_URL, body="<html>502</html>", content_type="text/html")
    out = _provider().fetch(REQUESTS)
    assert all(isinstance(v, ProviderError) for v in out.values())


@responses.activate
def test_los_precios_no_pasan_por_float():
    responses.add(
        responses.GET,
        BASE_URL,
        body='{"bitcoin": {"usd": 0.1, "last_updated_at": 1789651800}}',
        content_type="application/json",
    )
    out = _provider().fetch([PriceRequest("btc", "bitcoin", "usd")])
    assert out["btc"].price == Decimal("0.1")
    assert isinstance(out["btc"].price, Decimal)
