"""Comprobación en vivo de un símbolo.

Es lo que convierte una cadena abstracta (`xauusd`, `bitcoin`, `AAPL`) en un
número que alguien no técnico puede juzgar: «Oro = 3 412,50 USD, dato de hace
2 min ✓». Un símbolo inventado se detecta en un segundo, en vez de manifestarse
media hora después como un aviso de fallo que nadie entiende.

Reutiliza los proveedores del bot, así que comprueba exactamente lo mismo que
hará el cron. Cada sondeo a Twelve Data cuesta 1 crédito de los 800 diarios: el
panel solo lo llama al pulsar el botón, nunca al teclear.
"""

from __future__ import annotations

import os
from http.server import BaseHTTPRequestHandler

from _common import authorized, diagnostico, read_json, write_json  # noqa: E402

CARGA_FALLIDA = None
try:
    from vigilante.config import ProviderSettings  # noqa: E402
    from vigilante.errors import ProviderError, VigilanteError  # noqa: E402
    from vigilante.models import PriceRequest, Quote  # noqa: E402
    from vigilante.providers.registry import build_provider, known_providers  # noqa: E402
except Exception as _exc:  # noqa: BLE001 — cualquier fallo aquí debe poder contarse
    CARGA_FALLIDA = _exc

#: Qué variable de entorno lleva la clave de cada proveedor. Igual que en el YAML,
#: se referencian por nombre, nunca por valor.
API_KEY_ENV = {
    "coingecko": "COINGECKO_DEMO_KEY",
    "twelvedata": "TWELVEDATA_API_KEY",
    "stooq": None,
}


def probe(provider_name: str, symbol: str, currency: str) -> dict:
    if provider_name not in known_providers():
        return {"ok": False, "error": f"proveedor desconocido: '{provider_name}'"}
    if not symbol.strip():
        return {"ok": False, "error": "falta el símbolo"}

    settings = ProviderSettings(api_key_env=API_KEY_ENV.get(provider_name), timeout_seconds=10)
    try:
        provider = build_provider(provider_name, settings, os.environ)
    except VigilanteError as exc:
        return {"ok": False, "error": str(exc)}

    request = PriceRequest(asset_id="probe", symbol=symbol.strip(), currency=currency.lower())
    try:
        result = provider.fetch([request]).get("probe")
    except ProviderError as exc:
        return {"ok": False, "error": str(exc)}
    except Exception as exc:  # una excepción no prevista no debe tumbar el panel
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}"}

    if isinstance(result, Quote):
        return {
            "ok": True,
            "price": format(result.price.normalize(), "f"),
            "currency": result.currency,
            "as_of": result.as_of.isoformat().replace("+00:00", "Z"),
            "provider": result.provider,
        }
    return {"ok": False, "error": str(result) if result else "sin respuesta del proveedor"}


class handler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:  # noqa: N802
        if CARGA_FALLIDA is not None:
            return write_json(self, 500, diagnostico(CARGA_FALLIDA))
        if not authorized(self.headers.get("x-panel-token")):
            return write_json(self, 401, {"ok": False, "error": "no autorizado"})

        payload = read_json(self)
        return write_json(self, 200, probe(
            str(payload.get("provider", "")),
            str(payload.get("symbol", "")),
            str(payload.get("currency", "usd")),
        ))

    def log_message(self, *_args) -> None:
        """Silencio: los logs por defecto imprimen la petición entera."""
