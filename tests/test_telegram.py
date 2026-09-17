"""Redacción y entrega del mensaje."""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal

import pytest
import requests
import responses

from vigilante.errors import NotifierError
from vigilante.models import Event, EventKind
from vigilante.notifiers.format import money, render
from vigilante.notifiers.telegram import TelegramNotifier, split_message

from .conftest import T0

URL = "https://api.telegram.org/botTOKEN/sendMessage"


def _event(**over) -> Event:
    base = dict(
        asset_id="btc",
        label="Bitcoin",
        kind=EventKind.BREACH_LOWER,
        price=Decimal("53210"),
        currency="usd",
        threshold=Decimal("55000"),
    )
    base.update(over)
    return Event(**base)


# --------------------------------------------------------------------------- #
# Redacción
# --------------------------------------------------------------------------- #

def test_un_solo_mensaje_agrupa_todos_los_eventos():
    """En una caída de mercado, ocho mensajes son ruido; uno con ocho líneas, información."""
    eventos = [_event(asset_id=f"a{i}", label=f"Activo {i}") for i in range(8)]
    texto = render(eventos, T0)
    assert texto.count("ha cruzado por DEBAJO") == 8
    assert len(split_message(texto)) == 1


def test_se_escapa_el_html_del_nombre():
    """Un activo llamado `S&P 500 <ETF>` no puede romper el mensaje entero."""
    texto = render([_event(label="S&P 500 <ETF>")], T0)
    assert "S&amp;P 500 &lt;ETF&gt;" in texto
    assert "<ETF>" not in texto


def test_el_evento_coalescido_cuenta_desde_cuando():
    evento = _event(since=T0 - timedelta(minutes=42), first_price=Decimal("54980"))
    texto = render([evento], T0)
    assert "cruzó hace 42 min a 54 980.00" in texto


def test_el_arranque_en_frio_va_en_un_bloque_resumen():
    eventos = [
        _event(kind=EventKind.INIT_OUTSIDE, price=Decimal("53210")),
        _event(asset_id="oro", label="Oro", kind=EventKind.INIT_OUTSIDE,
               price=Decimal("4500"), threshold=Decimal("4200")),
    ]
    texto = render(eventos, T0, summary_init=True)
    assert "Vigilante iniciado. 2 activo(s) ya fuera de rango" in texto


def test_la_recuperacion_dice_de_que_lado_se_volvio():
    texto = render([_event(kind=EventKind.RECOVER_FROM_BELOW, price=Decimal("56000"))], T0)
    assert "ha vuelto al rango (por encima de 55 000.00 USD)" in texto


@pytest.mark.parametrize(
    "valor,esperado",
    [("53210.5", "53 210.50"), ("241.84", "241.84"), ("1.0450", "1.045"), ("0.00001234", "0.00001234")],
)
def test_formato_de_importes(valor, esperado):
    assert money(Decimal(valor)) == esperado


# --------------------------------------------------------------------------- #
# Troceado
# --------------------------------------------------------------------------- #

def test_se_trocea_por_lineas_sin_truncar():
    texto = "\n".join(f"linea {i} " + "x" * 80 for i in range(200))
    trozos = split_message(texto)

    assert len(trozos) > 1
    assert all(len(t) <= 4096 for t in trozos)
    assert "\n".join(trozos) == texto, "no se pierde ni una alerta por el camino"


def test_una_linea_gigante_se_corta_en_seco():
    trozos = split_message("y" * 10000)
    assert len(trozos) == 3 and "".join(trozos) == "y" * 10000


# --------------------------------------------------------------------------- #
# Entrega
# --------------------------------------------------------------------------- #

@responses.activate
def test_envio_correcto():
    responses.add(responses.POST, URL, json={"ok": True})
    TelegramNotifier("TOKEN", "123").send("hola")
    assert responses.calls[0].request.url == URL


@responses.activate
def test_reintenta_respetando_retry_after(monkeypatch):
    monkeypatch.setattr("vigilante.notifiers.telegram.time.sleep", lambda _s: None)
    responses.add(responses.POST, URL, status=429, json={"parameters": {"retry_after": 1}})
    responses.add(responses.POST, URL, json={"ok": True})

    TelegramNotifier("TOKEN", "123").send("hola")
    assert len(responses.calls) == 2


@responses.activate
def test_un_error_de_telegram_es_NotifierError():
    responses.add(responses.POST, URL, status=400, json={"description": "chat not found"})
    with pytest.raises(NotifierError, match="chat not found"):
        TelegramNotifier("TOKEN", "123").send("hola")


@responses.activate
def test_el_token_nunca_aparece_en_el_error():
    """El token va en la ruta de la URL: un error que la incluya lo filtra al log."""
    responses.add(
        responses.POST,
        URL,
        body=requests.ConnectionError("fallo con https://api.telegram.org/botTOKEN/x"),
    )
    with pytest.raises(NotifierError) as exc:
        TelegramNotifier("TOKEN", "123").send("hola")
    assert "TOKEN" not in str(exc.value)


def test_sin_credenciales_no_se_construye():
    with pytest.raises(NotifierError):
        TelegramNotifier("", "123")
