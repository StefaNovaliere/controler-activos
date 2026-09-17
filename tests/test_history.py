"""Historial de precios: la materia prima del análisis posterior."""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal

from vigilante.history import append_quotes, history_path
from vigilante.models import Quote

from .conftest import T0


def _quote(asset_id="btc", price="61234.5", at=T0, provider="coingecko", currency="usd"):
    return Quote(asset_id, Decimal(price), currency, at, provider)


def test_escribe_cabecera_solo_la_primera_vez(tmp_path):
    assert append_quotes(tmp_path, [_quote()], T0) == 1
    assert append_quotes(tmp_path, [_quote(price="60000")], T0) == 1

    lineas = history_path(tmp_path, T0).read_text().strip().splitlines()
    assert lineas[0] == "timestamp,asset_id,provider,price,currency"
    assert len(lineas) == 3, "cabecera + dos filas"


def test_anade_sin_reescribir(tmp_path):
    """Un fichero de ~5 MB no se puede regenerar en cada ejecución del cron."""
    append_quotes(tmp_path, [_quote(price="1")], T0)
    antes = history_path(tmp_path, T0).read_text()
    append_quotes(tmp_path, [_quote(price="2")], T0)
    assert history_path(tmp_path, T0).read_text().startswith(antes)


def test_un_fichero_por_ano(tmp_path):
    append_quotes(tmp_path, [_quote()], T0)
    siguiente = T0.replace(year=T0.year + 1)
    append_quotes(tmp_path, [_quote(at=siguiente)], siguiente)

    assert history_path(tmp_path, T0).name == "prices-2026.csv"
    assert history_path(tmp_path, siguiente).name == "prices-2027.csv"
    assert sorted(p.name for p in tmp_path.iterdir()) == ["prices-2026.csv", "prices-2027.csv"]


def test_sin_cotizaciones_no_crea_el_fichero(tmp_path):
    assert append_quotes(tmp_path, [], T0) == 0
    assert not list(tmp_path.iterdir())


def test_el_precio_conserva_su_precision(tmp_path):
    append_quotes(tmp_path, [_quote(price="0.00001234")], T0)
    assert "0.00001234" in history_path(tmp_path, T0).read_text()


def test_guarda_la_hora_del_dato_no_la_de_la_ejecucion(tmp_path):
    """El cierre del viernes debe quedar fechado el viernes, no el domingo."""
    dato = T0 - timedelta(days=2)
    append_quotes(tmp_path, [_quote(at=dato)], T0)
    assert dato.strftime("%Y-%m-%dT%H:%M:%S") in history_path(tmp_path, T0).read_text()
