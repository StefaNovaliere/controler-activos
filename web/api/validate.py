"""La puerta autoritativa: si pydantic no lo acepta, no se commitea.

No hay dos validadores. `load_config` es literalmente la misma función que
ejecuta el cron cada media hora, así que el panel no puede guardar nada que el
bot no sepa leer.

De regalo devuelve el `fingerprint()` ya resuelto de cada activo. Eso permite
avisar ANTES de guardar de que un cambio va a hacer que el bot reevalúe el activo
desde cero y probablemente mande un aviso — la sorpresa más desagradable del
sistema, y algo que solo el código real sabe calcular.
"""

from __future__ import annotations

import os
import tempfile
from http.server import BaseHTTPRequestHandler

from _common import authorized, diagnostico, read_json, write_json  # noqa: E402

CARGA_FALLIDA = None
try:
    from vigilante.config import load_config  # noqa: E402
    from vigilante.errors import ConfigError  # noqa: E402
    from vigilante.providers import known_providers, unknown_providers  # noqa: E402
except Exception as _exc:  # noqa: BLE001 — cualquier fallo aquí debe poder contarse
    CARGA_FALLIDA = _exc


def validate_yaml(yaml_text: str) -> dict:
    """El veredicto, sin HTTP de por medio para poder probarlo."""
    if not isinstance(yaml_text, str) or not yaml_text.strip():
        return {"ok": False, "errors": ["falta el YAML"]}

    descriptor, path = tempfile.mkstemp(suffix=".yml")
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(yaml_text)
        config = load_config(path)
    except ConfigError as exc:
        return {"ok": False, "errors": str(exc).splitlines()}
    finally:
        os.unlink(path)

    # Lo único que `load_config` no mira y `run` sí: que el proveedor exista.
    if desconocidos := unknown_providers(config):
        return {"ok": False, "errors": [
            f"proveedor desconocido: '{name}'. Disponibles: {', '.join(known_providers())}"
            for name in desconocidos
        ]}

    return {
        "ok": True,
        "assets": [
            {
                "id": asset.id,
                "label": asset.label,
                "provider": asset.provider,
                "symbol": asset.symbol,
                "currency": asset.currency,
                "lower": None if asset.lower is None else str(asset.lower),
                "upper": None if asset.upper is None else str(asset.upper),
                "cooldown_minutes": asset.cooldown_minutes,
                "fingerprint": asset.fingerprint(),
            }
            for asset in config.assets
        ],
    }


class handler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:  # noqa: N802  (lo exige BaseHTTPRequestHandler)
        if CARGA_FALLIDA is not None:
            return write_json(self, 500, diagnostico(CARGA_FALLIDA))
        if not authorized(self.headers.get("x-panel-token")):
            return write_json(self, 401, {"ok": False, "errors": ["no autorizado"]})
        return write_json(self, 200, validate_yaml(read_json(self).get("yaml", "")))

    def log_message(self, *_args) -> None:
        """Silencio: los logs por defecto imprimen la petición entera."""
