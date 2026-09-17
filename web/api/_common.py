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

# Dos rutas posibles: la copia commiteada en `_vendor/` —que es la que siempre
# está, porque el builder de Python de Vercel parte del checkout de git y no de
# la salida del build de Next— o el `src/` del repositorio si Vercel incluye
# ficheros de fuera del Root Directory.
BUSCADO = [_HERE / "_vendor", _HERE.parent.parent / "src"]
ENCONTRADO = None

for candidate in BUSCADO:
    if (candidate / "vigilante").is_dir():
        sys.path.insert(0, str(candidate))
        ENCONTRADO = candidate
        break


def diagnostico(error: BaseException) -> dict:
    """Qué contar cuando el paquete no se puede importar.

    Sin esto, un fallo de importación es un 500 de Vercel sin ninguna pista, y
    desde fuera no hay forma de distinguirlo de un error de red o de permisos.
    """
    return {
        "ok": False,
        "errors": [
            f"La función no pudo cargar el paquete del centinela: {type(error).__name__}: {error}",
            f"Buscado en: {', '.join(str(p) for p in BUSCADO)}",
            f"Encontrado en: {ENCONTRADO or 'ninguno'}",
            "Si dice 'ninguno', falta web/api/_vendor/vigilante en el repositorio: "
            "regenéralo con `node scripts/vendor.mjs` desde web/ y commitéalo.",
        ],
    }


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
