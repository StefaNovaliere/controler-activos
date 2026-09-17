"""Comprobación en vivo de un símbolo.

Convierte una cadena abstracta (`xauusd`, `bitcoin`, `AAPL`) en un número que
alguien no técnico puede juzgar. Un símbolo inventado se detecta en un segundo,
en vez de manifestarse media hora después como un aviso de fallo.

Como `validate.py`: sin importaciones hermanas ni del paquete en el nivel del
módulo, para que un fallo de carga se pueda contar en vez de convertirse en la
página de error genérica de Vercel.
"""

from __future__ import annotations

import hmac
import json
import os
import sys
import traceback
from http.server import BaseHTTPRequestHandler
from pathlib import Path

AQUI = Path(__file__).resolve().parent
CANDIDATOS = [AQUI / "_vendor", AQUI.parent.parent / "src"]

#: Qué variable de entorno lleva la clave de cada proveedor. Igual que en el YAML,
#: se referencian por nombre, nunca por valor.
CLAVES = {"coingecko": "COINGECKO_DEMO_KEY", "twelvedata": "TWELVEDATA_API_KEY", "stooq": None}


def cargar():
    for candidato in CANDIDATOS:
        if (candidato / "vigilante").is_dir() and str(candidato) not in sys.path:
            sys.path.insert(0, str(candidato))

    from vigilante.config import ProviderSettings
    from vigilante.errors import ProviderError, VigilanteError
    from vigilante.models import PriceRequest, Quote
    from vigilante.providers.registry import build_provider, known_providers

    return ProviderSettings, ProviderError, VigilanteError, PriceRequest, Quote, build_provider, known_providers


def sondear(proveedor: str, simbolo: str, divisa: str) -> dict:
    (ProviderSettings, ProviderError, VigilanteError,
     PriceRequest, Quote, build_provider, known_providers) = cargar()

    if proveedor not in known_providers():
        return {"ok": False, "error": f"proveedor desconocido: '{proveedor}'"}
    if not simbolo.strip():
        return {"ok": False, "error": "falta el símbolo"}

    ajustes = ProviderSettings(api_key_env=CLAVES.get(proveedor), timeout_seconds=10)
    try:
        instancia = build_provider(proveedor, ajustes, os.environ)
    except VigilanteError as exc:
        return {"ok": False, "error": str(exc)}

    peticion = PriceRequest(asset_id="probe", symbol=simbolo.strip(), currency=divisa.lower())
    try:
        resultado = instancia.fetch([peticion]).get("probe")
    except ProviderError as exc:
        return {"ok": False, "error": str(exc)}
    except Exception as exc:  # noqa: BLE001 — un proveedor roto no debe tumbar el panel
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}"}

    if isinstance(resultado, Quote):
        return {
            "ok": True,
            "price": format(resultado.price.normalize(), "f"),
            "currency": resultado.currency,
            "as_of": resultado.as_of.isoformat().replace("+00:00", "Z"),
            "provider": resultado.provider,
        }
    return {"ok": False, "error": str(resultado) if resultado else "sin respuesta del proveedor"}


def diagnostico(error: BaseException) -> dict:
    return {
        "ok": False,
        "error": f"{type(error).__name__}: {error}",
        "detalles": [
            f"Python {sys.version.split()[0]}",
            *[f"Buscado en {c}: {'existe' if (c / 'vigilante').is_dir() else 'NO existe'}" for c in CANDIDATOS],
        ],
        "traceback": traceback.format_exc(),
    }


class handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802
        try:
            _, _, _, _, _, _, known_providers = cargar()
        except BaseException as exc:  # noqa: BLE001
            return self._json(500, diagnostico(exc))
        self._json(200, {
            "ok": True,
            "mensaje": "La función de sondeo está viva. Usa POST para consultar un precio.",
            "proveedores": known_providers(),
            "python": sys.version.split()[0],
        })

    def do_POST(self) -> None:  # noqa: N802
        if not self._autorizado():
            return self._json(401, {"ok": False, "error": "no autorizado"})

        try:
            longitud = int(self.headers.get("content-length") or 0)
            peticion = json.loads(self.rfile.read(longitud)) if longitud else {}
            resultado = sondear(
                str(peticion.get("provider", "")),
                str(peticion.get("symbol", "")),
                str(peticion.get("currency", "usd")),
            )
        except BaseException as exc:  # noqa: BLE001
            return self._json(500, diagnostico(exc))

        self._json(200, resultado)

    def _autorizado(self) -> bool:
        esperado = os.environ.get("INTERNAL_API_TOKEN", "")
        recibido = self.headers.get("x-panel-token") or ""
        return bool(esperado) and hmac.compare_digest(recibido, esperado)

    def _json(self, codigo: int, payload: dict) -> None:
        cuerpo = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(codigo)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(cuerpo)))
        self.end_headers()
        self.wfile.write(cuerpo)

    def log_message(self, *_args) -> None:
        """Silencio: los logs por defecto imprimen la petición entera."""
