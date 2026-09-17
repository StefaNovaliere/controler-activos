"""Utilidades compartidas por las funciones Python del panel.

Estas funciones existen por una razón concreta: que la validación del formulario
y la del bot sean **la misma**. En vez de reimplementar las reglas en TypeScript
y rezar para que no se separen, aquí se importa `vigilante.config` de verdad.
"""

from __future__ import annotations

import hmac
import json
import os
import pathlib
import sys

_HERE = pathlib.Path(__file__).resolve().parent

# Dos rutas posibles: la copia que hace `scripts/vendor-python.mjs` durante el
# build, o el `src/` del repositorio si Vercel incluye ficheros de fuera del Root
# Directory. Se prueba la copia primero porque es la que siempre está.
for candidate in (_HERE / "_vendor", _HERE.parent.parent / "src"):
    if (candidate / "vigilante").is_dir():
        sys.path.insert(0, str(candidate))
        break


def authorized(token: str | None) -> bool:
    """Las funciones solo las llama el propio servidor, nunca el navegador."""
    expected = os.environ.get("INTERNAL_API_TOKEN", "")
    return bool(expected) and bool(token) and hmac.compare_digest(token, expected)


def write_json(handler, code: int, payload: dict) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(code)
    handler.send_header("content-type", "application/json; charset=utf-8")
    handler.send_header("content-length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def read_json(handler) -> dict:
    length = int(handler.headers.get("content-length") or 0)
    if not length:
        return {}
    try:
        return json.loads(handler.rfile.read(length))
    except (ValueError, TypeError):
        return {}
