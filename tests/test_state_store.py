"""Tests del almacén de estado."""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal

import pytest

from vigilante.errors import StateError
from vigilante.models import AssetState, EventKind, PendingEvent, Zone
from vigilante.state_store import SCHEMA_VERSION, load_state, save_state

from .conftest import T0


@pytest.fixture
def estados():
    return {
        "btc": AssetState(
            zone=Zone.BELOW,
            last_price=Decimal("53210.55"),
            last_ok_at=T0,
            last_breach_notified_at=T0,
            last_notified_event=EventKind.BREACH_LOWER,
            pending=PendingEvent(EventKind.BREACH_LOWER, T0, Decimal("54980")),
            config_fingerprint="sha256:abc123",
        ),
        "oro": AssetState(zone=Zone.INSIDE, last_price=Decimal("3721.88"), consecutive_failures=3),
    }


def test_ida_y_vuelta(tmp_path, estados):
    path = tmp_path / "state.json"
    assert save_state(path, estados, T0) is True
    assert load_state(path) == estados


def test_fichero_ausente_es_arranque_en_frio(tmp_path):
    assert load_state(tmp_path / "no-existe.json") == {}


def test_guardar_lo_mismo_no_reescribe(tmp_path, estados):
    """Si no, el cron generaría un commit cada media hora sin que pase nada."""
    path = tmp_path / "state.json"
    save_state(path, estados, T0)
    antes = path.read_bytes()

    assert save_state(path, estados, T0 + timedelta(hours=5)) is False
    assert path.read_bytes() == antes


def test_un_cambio_real_si_reescribe(tmp_path, estados):
    path = tmp_path / "state.json"
    save_state(path, estados, T0)
    estados["oro"] = estados["oro"].with_(zone=Zone.ABOVE)
    assert save_state(path, estados, T0) is True
    assert load_state(path)["oro"].zone is Zone.ABOVE


def test_serializacion_determinista(tmp_path, estados):
    a, b = tmp_path / "a.json", tmp_path / "b.json"
    save_state(a, estados, T0)
    save_state(b, dict(reversed(list(estados.items()))), T0)
    assert a.read_bytes() == b.read_bytes()


def test_schema_desconocido_aborta_sin_tocar_el_fichero(tmp_path):
    path = tmp_path / "state.json"
    contenido = f'{{"schema": {SCHEMA_VERSION + 99}, "assets": {{}}}}'
    path.write_text(contenido)

    with pytest.raises(StateError, match="schema"):
        load_state(path)
    assert path.read_text() == contenido


def test_json_corrupto_aborta_sin_tocar_el_fichero(tmp_path):
    path = tmp_path / "state.json"
    path.write_text("{esto no es json")

    with pytest.raises(StateError, match="corrupto"):
        load_state(path)
    assert path.read_text() == "{esto no es json"


def test_los_precios_no_pasan_por_float(tmp_path):
    """0.1 + 0.2 no puede convertirse en 0.30000000000000004 al ir a disco."""
    path = tmp_path / "state.json"
    preciso = Decimal("0.1") + Decimal("0.2")
    save_state(path, {"x": AssetState(zone=Zone.INSIDE, last_price=preciso)}, T0)

    assert '"0.3"' in path.read_text()
    assert load_state(path)["x"].last_price == Decimal("0.3")


def test_escritura_atomica_conserva_el_original_si_falla(tmp_path, estados, monkeypatch):
    path = tmp_path / "state.json"
    save_state(path, estados, T0)
    original = path.read_bytes()

    monkeypatch.setattr("vigilante.state_store.os.replace", _boom)
    with pytest.raises(OSError):
        save_state(path, {"btc": AssetState(zone=Zone.ABOVE)}, T0)

    assert path.read_bytes() == original
    assert not list(tmp_path.glob(".state.json.*")), "no deja temporales huérfanos"


def _boom(*_args, **_kw):
    raise OSError("disco lleno")
