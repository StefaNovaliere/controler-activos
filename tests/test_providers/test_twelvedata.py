from __future__ import annotations

from decimal import Decimal
from pathlib import Path

import pytest
import responses

from vigilante.config import ProviderSettings
from vigilante.errors import ConfigError, RateLimited, SymbolNotFound
from vigilante.models import PriceRequest
from vigilante.providers.twelvedata import BASE_URL, TwelveDataProvider

FIXTURES = Path(__file__).parent.parent / "fixtures"
ENV = {"TD_KEY": "clave-secreta"}


def _provider(**over) -> TwelveDataProvider:
    settings = ProviderSettings(api_key_env="TD_KEY", timeout_seconds=1, **over)
    provider = TwelveDataProvider(settings, ENV)
    provider._http.retries = 0
    return provider


def test_sin_clave_falla_al_arrancar_no_a_mitad_de_ejecucion():
    with pytest.raises(ConfigError, match="TD_KEY"):
        TwelveDataProvider(ProviderSettings(api_key_env="TD_KEY"), {})


@responses.activate
def test_lote_con_exito_y_simbolo_erroneo_mezclados():
    responses.add(
        responses.GET,
        BASE_URL,
        body=(FIXTURES / "twelvedata_quote_batch.json").read_text(),
        content_type="application/json",
    )
    out = _provider().fetch([PriceRequest("aapl", "AAPL", "usd"), PriceRequest("x", "NOPE", "usd")])

    assert out["aapl"].price == Decimal("241.84000")
    assert out["aapl"].currency == "usd"
    assert isinstance(out["x"], SymbolNotFound), "un error por símbolo no tumba el lote entero"


@responses.activate
def test_la_cuota_agotada_llega_con_http_200():
    """Si solo se mira el código HTTP, un 429 pasa por 'precio no disponible'."""
    responses.add(
        responses.GET,
        BASE_URL,
        status=200,
        body=(FIXTURES / "twelvedata_quota.json").read_text(),
        content_type="application/json",
    )
    out = _provider().fetch([PriceRequest("aapl", "AAPL", "usd")])
    assert isinstance(out["aapl"], RateLimited)


@responses.activate
def test_un_solo_simbolo_devuelve_el_objeto_plano():
    responses.add(
        responses.GET,
        BASE_URL,
        body='{"symbol":"AAPL","currency":"USD","timestamp":1789651800,"close":"241.84"}',
        content_type="application/json",
    )
    out = _provider().fetch([PriceRequest("aapl", "AAPL", "usd")])
    assert out["aapl"].price == Decimal("241.84")


@responses.activate
def test_el_lote_respeta_el_batch_size_para_no_reventar_la_cuota():
    responses.add(responses.GET, BASE_URL, body="{}", content_type="application/json")
    peticiones = [PriceRequest(f"a{i}", f"SYM{i}", "usd") for i in range(9)]
    _provider(batch_size=4).fetch(peticiones)
    assert len(responses.calls) == 3, "9 símbolos en lotes de 4"


@responses.activate
def test_la_clave_no_aparece_en_los_mensajes_de_error():
    responses.add(responses.GET, BASE_URL, status=403, body="forbidden")
    out = _provider().fetch([PriceRequest("aapl", "AAPL", "usd")])
    assert "clave-secreta" not in str(out["aapl"])
