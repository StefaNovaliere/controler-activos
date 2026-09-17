"""Orquestación: fallback, degradación y la garantía de no perder avisos."""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal

import pytest

from vigilante.config import load_config
from vigilante.errors import NotifierError, ProviderError
from vigilante.models import Quote, Zone
from vigilante.runner import run
from vigilante.state_store import load_state

from .conftest import T0

YAML = """
version: 1
defaults: {cooldown_minutes: 0, first_run_policy: summary}
providers:
  principal: {}
  suplente: {}
notifier: {}
assets:
  - {id: a, provider: principal, symbol: A, lower: 100, upper: 200, fallback: {provider: suplente, symbol: A2}}
  - {id: b, provider: principal, symbol: B, lower: 100, upper: 200}
"""


class FakeProvider:
    """Devuelve lo que se le diga, por símbolo."""

    def __init__(self, name, respuestas):
        self.name, self._respuestas, self.llamadas = name, respuestas, 0

    def fetch(self, requests):
        self.llamadas += 1
        return {
            r.asset_id: _quote(r, self._respuestas[r.symbol], self.name)
            if not isinstance(self._respuestas[r.symbol], Exception)
            else self._respuestas[r.symbol]
            for r in requests
        }


def _quote(request, price, provider):
    return Quote(request.asset_id, Decimal(price), request.currency, T0, provider)


class FakeNotifier:
    name = "fake"

    def __init__(self, falla=False):
        self.falla, self.enviados = falla, []

    def send(self, text):
        if self.falla:
            raise NotifierError("Telegram caído")
        self.enviados.append(text)


@pytest.fixture
def config(tmp_path):
    path = tmp_path / "assets.yml"
    path.write_text(YAML, encoding="utf-8")
    return load_config(path)


@pytest.fixture
def state_path(tmp_path):
    return tmp_path / "state.json"


def _run(config, state_path, respuestas, notifier, **kw):
    providers = {
        "principal": FakeProvider("principal", respuestas.get("principal", {})),
        "suplente": FakeProvider("suplente", respuestas.get("suplente", {})),
    }
    return run(config, state_path, now=kw.pop("now", T0), notifier=notifier, providers=providers, **kw), providers


def test_el_fallback_rescata_el_activo_que_lo_declara(config, state_path):
    respuestas = {
        "principal": {"A": ProviderError("429"), "B": "150"},
        "suplente": {"A2": "150"},
    }
    result, providers = _run(config, state_path, respuestas, FakeNotifier())

    assert isinstance(result.quotes["a"], Quote)
    assert result.quotes["a"].provider == "suplente"
    assert providers["suplente"].llamadas == 1, "solo se llama al suplente si hace falta"


def test_un_fallback_que_tambien_falla_conserva_el_error_original(config, state_path):
    respuestas = {
        "principal": {"A": ProviderError("cuota agotada"), "B": "150"},
        "suplente": {"A2": ProviderError("suplente roto")},
    }
    result, _ = _run(config, state_path, respuestas, FakeNotifier())
    assert "cuota agotada" in str(result.quotes["a"]), "el error del principal es más informativo"


def test_un_proveedor_caido_no_deja_sin_vigilar_al_resto(config, state_path):
    respuestas = {"principal": {"A": ProviderError("502"), "B": "250"}, "suplente": {"A2": ProviderError("502")}}
    result, _ = _run(config, state_path, respuestas, FakeNotifier())

    assert result.states["b"].zone is Zone.ABOVE, "b se evalúa aunque a haya fallado"
    assert any(e.asset_id == "b" for e in result.events)


def test_una_caida_general_produce_un_aviso_no_uno_por_activo(config, state_path):
    caido = ProviderError("timeout")
    respuestas = {"principal": {"A": caido, "B": caido}, "suplente": {"A2": caido}}
    previo = {
        "principal": {"A": caido, "B": caido},
        "suplente": {"A2": caido},
    }
    # Se acumulan fallos hasta cruzar el primer escalón de aviso de salud.
    result = None
    for i in range(6):
        result, _ = _run(config, state_path, previo, FakeNotifier(), now=T0 + timedelta(minutes=30 * i))

    assert result.degraded
    salud = [e for e in result.events if e.asset_id == "*"]
    assert len(salud) == 1 and "2 de 2" in (salud[0].detail or "")


def test_si_falla_la_entrega_el_cruce_se_vuelve_a_detectar(config, state_path):
    """Mejor un aviso duplicado que un aviso perdido."""
    respuestas = {"principal": {"A": "50", "B": "150"}, "suplente": {"A2": "50"}}

    roto = FakeNotifier(falla=True)
    result, _ = _run(config, state_path, respuestas, roto)
    assert result.delivery_error and result.exit_code == 1
    assert "a" not in load_state(state_path), "no se da por avisado lo que no salió"

    ok = FakeNotifier()
    result, _ = _run(config, state_path, respuestas, ok, now=T0 + timedelta(minutes=30))
    assert ok.enviados, "en la siguiente ejecución el cruce se vuelve a anunciar"
    assert load_state(state_path)["a"].zone is Zone.BELOW


def test_un_fallo_de_proveedor_no_pone_el_repositorio_en_rojo(config, state_path):
    caido = ProviderError("429")
    respuestas = {"principal": {"A": caido, "B": caido}, "suplente": {"A2": caido}}
    result, _ = _run(config, state_path, respuestas, FakeNotifier())
    assert result.exit_code == 0


def test_dry_run_no_envia_ni_persiste(config, state_path):
    respuestas = {"principal": {"A": "50", "B": "150"}, "suplente": {"A2": "50"}}
    notifier = FakeNotifier()
    result, _ = _run(config, state_path, respuestas, notifier, dry_run=True)

    assert result.message is not None, "sí calcula lo que habría enviado"
    assert notifier.enviados == []
    assert not state_path.exists()


def test_sin_eventos_no_se_envia_mensaje(config, state_path):
    respuestas = {"principal": {"A": "150", "B": "150"}, "suplente": {"A2": "150"}}
    notifier = FakeNotifier()
    result, _ = _run(config, state_path, respuestas, notifier)
    assert result.message is None and notifier.enviados == []
