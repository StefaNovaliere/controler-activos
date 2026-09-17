"""La puerta autoritativa: si pydantic no lo acepta, no se commitea.

No hay dos validadores. `load_config` es literalmente la misma función que
ejecuta el cron cada media hora, así que el panel no puede guardar nada que el
bot no sepa leer.

**Este fichero no importa NADA fuera de la biblioteca estándar en el nivel del
módulo, y no tiene importaciones hermanas.** Si el módulo falla al cargar, Vercel
devuelve su página de error genérica y cualquier diagnóstico que hubiéramos
escrito se pierde: el mensaje que explica el fallo no puede depender de que el
fichero cargue bien. Todo lo demás se importa dentro del handler, donde una
excepción sí se puede contar.
"""

from __future__ import annotations

import hmac
import json
import os
import sys
import tempfile
import traceback
from http.server import BaseHTTPRequestHandler
from pathlib import Path

AQUI = Path(__file__).resolve().parent

#: `_vendor` es la copia commiteada, la que siempre está: el builder de Python de
#: Vercel parte del checkout de git. `../../src` solo existe si el proyecto
#: incluye ficheros de fuera del Root Directory.
CANDIDATOS = [AQUI / "_vendor", AQUI.parent.parent / "src"]


def cargar():
    """Deja el paquete importable y devuelve lo que hace falta."""
    for candidato in CANDIDATOS:
        if (candidato / "vigilante").is_dir() and str(candidato) not in sys.path:
            sys.path.insert(0, str(candidato))

    from vigilante.config import load_config
    from vigilante.errors import ConfigError
    from vigilante.providers import known_providers, unknown_providers

    return load_config, ConfigError, known_providers, unknown_providers


def diagnostico(error: BaseException) -> dict:
    """Todo lo que hace falta para saber por qué no arrancó, sin secretos."""
    return {
        "ok": False,
        "errors": [
            f"La función no pudo cargar el paquete del centinela: {type(error).__name__}: {error}",
            f"Python {sys.version.split()[0]}",
            *[f"Buscado en {c}: {'existe' if (c / 'vigilante').is_dir() else 'NO existe'}" for c in CANDIDATOS],
            "Si ninguno existe, falta web/api/_vendor/vigilante en el repositorio.",
        ],
        "traceback": traceback.format_exc(),
    }


def salud() -> dict:
    """Respuesta de GET: sirve para comprobar el despliegue desde el navegador."""
    try:
        cargar()
    except BaseException as exc:  # noqa: BLE001 — cualquier fallo debe poder contarse
        return diagnostico(exc)
    return {
        "ok": True,
        "mensaje": "La función de validación está viva. Usa POST para validar.",
        "python": sys.version.split()[0],
    }


def validar(yaml_text: str) -> dict:
    """El veredicto, sin HTTP de por medio para poder probarlo."""
    if not isinstance(yaml_text, str) or not yaml_text.strip():
        return {"ok": False, "errors": ["falta el YAML"]}

    load_config, ConfigError, known_providers, unknown_providers = cargar()

    descriptor, ruta = tempfile.mkstemp(suffix=".yml")
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as fichero:
            fichero.write(yaml_text)
        config = load_config(ruta)
    except ConfigError as exc:
        return {"ok": False, "errors": str(exc).splitlines()}
    finally:
        os.unlink(ruta)

    # Lo único que `load_config` no mira y `run` sí: que el proveedor exista.
    if desconocidos := unknown_providers(config):
        return {"ok": False, "errors": [
            f"proveedor desconocido: '{nombre}'. Disponibles: {', '.join(known_providers())}"
            for nombre in desconocidos
        ]}

    return {
        "ok": True,
        "assets": [
            {
                "id": a.id,
                "label": a.label,
                "provider": a.provider,
                "symbol": a.symbol,
                "currency": a.currency,
                "lower": None if a.lower is None else str(a.lower),
                "upper": None if a.upper is None else str(a.upper),
                "cooldown_minutes": a.cooldown_minutes,
                "fingerprint": a.fingerprint(),
            }
            for a in config.assets
        ],
    }


# Nombre histórico, usado por los tests.
validate_yaml = validar


class handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802
        """Abierto a propósito: no toca configuración ni revela secretos, y es lo
        que permite comprobar un despliegue pegando la URL en el navegador."""
        cuerpo = salud()
        self._json(200 if cuerpo.get("ok") else 500, cuerpo)

    def do_POST(self) -> None:  # noqa: N802
        if not self._autorizado():
            return self._json(401, {"ok": False, "errors": ["no autorizado"]})

        try:
            longitud = int(self.headers.get("content-length") or 0)
            peticion = json.loads(self.rfile.read(longitud)) if longitud else {}
            resultado = validar(peticion.get("yaml", ""))
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
