#!/usr/bin/env python3
"""Genera `schema/config.schema.json` desde los modelos de pydantic.

El esquema NO es la validación autoritativa — hay siete reglas que JSON Schema no
sabe expresar (ver `schema/cases.json`). Sirve para que el panel web marque
errores mientras se escribe, sin ida y vuelta al servidor.

`sort_keys=True` es deliberado: el orden de claves de pydantic no es estable
entre versiones, y sin ordenar el paso anti-deriva de CI daría diffs falsos que
enseñan a ignorar el rojo.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

from vigilante.config import ConfigSpec  # noqa: E402

DEST = ROOT / "schema" / "config.schema.json"


def render() -> str:
    schema = ConfigSpec.model_json_schema()
    schema["$schema"] = "https://json-schema.org/draft/2020-12/schema"
    return json.dumps(schema, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


if __name__ == "__main__":
    text = render()
    if "--check" in sys.argv:
        actual = DEST.read_text(encoding="utf-8") if DEST.exists() else ""
        if actual != text:
            print(f"{DEST} está desactualizado. Regenéralo con: python scripts/gen_schema.py")
            sys.exit(1)
        print(f"{DEST}: al día")
    else:
        DEST.parent.mkdir(parents=True, exist_ok=True)
        DEST.write_text(text, encoding="utf-8")
        print(f"escrito {DEST}")
