"""El cliente HTTP compartido: reintentos que no empeoran el problema.

Un vigilante desatendido no puede tumbarse por un 502 pasajero, pero insistir
contra un límite de cuota es justo lo que lo agrava.
"""

from __future__ import annotations

import pytest
import requests

from vigilante.errors import ProviderError, RateLimited
from vigilante.providers.http import HttpClient


class RespuestaFalsa:
    def __init__(self, status: int, headers: dict[str, str] | None = None) -> None:
        self.status_code = status
        self.headers = headers or {}
        self.text = "cuerpo"

    @property
    def ok(self) -> bool:
        return 200 <= self.status_code < 300


@pytest.fixture
def cliente(monkeypatch):
    """Un cliente que no duerme de verdad: apunta cuánto le pidieron dormir."""
    esperas: list[float] = []
    monkeypatch.setattr("vigilante.providers.http.time.sleep", esperas.append)

    def construir(*respuestas: RespuestaFalsa) -> tuple[HttpClient, list, list[float]]:
        llamadas: list[str] = []
        c = HttpClient(retries=2)

        def falso_get(url, **kw):
            llamadas.append(url)
            return respuestas[min(len(llamadas) - 1, len(respuestas) - 1)]

        monkeypatch.setattr(c._session, "get", falso_get)
        return c, llamadas, esperas

    return construir


class TestCuotaAgotada:
    def test_hace_caso_al_tiempo_que_indica_el_servidor(self, cliente) -> None:
        # Antes se leía `Retry-After` solo para el mensaje de error y luego se
        # esperaba lo de siempre: ante un «vuelve en 5 s» reintentaba a 1 s y a
        # 2 s, gastando dos peticiones para fallar las dos veces.
        c, llamadas, esperas = cliente(RespuestaFalsa(429, {"Retry-After": "5"}))

        with pytest.raises(RateLimited):
            c.get("http://x", provider="p")

        assert len(llamadas) == 3
        assert all(5.0 <= e <= 5.5 for e in esperas), esperas

    def test_si_pide_esperar_demasiado_no_se_insiste(self, cliente) -> None:
        # El trabajo entero tiene diez minutos: dormir en un socket es la forma
        # de agotarlos sin haber consultado nada. La siguiente ejecución del
        # cron llega antes.
        c, llamadas, esperas = cliente(RespuestaFalsa(429, {"Retry-After": "600"}))

        with pytest.raises(RateLimited):
            c.get("http://x", provider="p")

        assert len(llamadas) == 1
        assert esperas == []

    def test_sin_cabecera_se_usa_la_espera_creciente(self, cliente) -> None:
        c, llamadas, esperas = cliente(RespuestaFalsa(429))

        with pytest.raises(RateLimited):
            c.get("http://x", provider="p")

        assert len(llamadas) == 3
        assert esperas[0] < esperas[1]

    def test_una_cabecera_ilegible_no_rompe_nada(self, cliente) -> None:
        c, llamadas, _ = cliente(RespuestaFalsa(429, {"Retry-After": "Wed, 21 Oct 2026 07:28:00 GMT"}))

        with pytest.raises(RateLimited):
            c.get("http://x", provider="p")

        assert len(llamadas) == 3  # trata la fecha como «no me dijeron nada»


class TestOtrosFallos:
    def test_un_502_se_reintenta_con_espera_creciente(self, cliente) -> None:
        c, llamadas, esperas = cliente(RespuestaFalsa(502))
        with pytest.raises(ProviderError):
            c.get("http://x", provider="p")
        assert len(llamadas) == 3
        assert esperas[0] < esperas[1]

    def test_un_404_no_se_reintenta_jamas(self, cliente) -> None:
        # Si el símbolo está mal escrito, insistir solo gasta cuota.
        c, llamadas, esperas = cliente(RespuestaFalsa(404))
        with pytest.raises(ProviderError):
            c.get("http://x", provider="p")
        assert len(llamadas) == 1
        assert esperas == []

    def test_a_la_segunda_va_la_vencida(self, cliente) -> None:
        c, llamadas, _ = cliente(RespuestaFalsa(503), RespuestaFalsa(200))
        assert c.get("http://x", provider="p").status_code == 200
        assert len(llamadas) == 2

    def test_un_fallo_de_red_tambien_se_reintenta(self, cliente, monkeypatch) -> None:
        c, llamadas, _ = cliente(RespuestaFalsa(200))

        def explota(url, **kw):
            llamadas.append(url)
            raise requests.ConnectionError("sin red")

        monkeypatch.setattr(c._session, "get", explota)
        with pytest.raises(ProviderError, match="fallo de red"):
            c.get("http://x", provider="p")
        assert len(llamadas) == 3
