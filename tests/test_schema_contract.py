"""El corpus compartido, visto desde Python.

`schema/cases.json` lo consumen dos lados: este test contra `load_config()`, y el
panel web contra ajv más las reglas cruzadas. Mientras los dos coincidan en el
veredicto de cada caso, la validación del formulario y la del bot no han
divergido. El día que alguien añada una regla a pydantic sin añadir el caso, el
lado de TypeScript se queda corto y salta en su propio test.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from vigilante.config import load_config
from vigilante.errors import ConfigError
from vigilante.providers import unknown_providers

CASES = json.loads((Path(__file__).parent.parent / "schema" / "cases.json").read_text("utf-8"))["cases"]


def _verdict(yaml_text: str, tmp_path: Path) -> str | None:
    """None si es válido; si no, el texto del error."""
    path = tmp_path / "assets.yml"
    path.write_text(yaml_text, encoding="utf-8")
    try:
        config = load_config(path)
    except ConfigError as exc:
        return str(exc)
    if desconocidos := unknown_providers(config):
        return f"proveedor(es) desconocido(s): {', '.join(desconocidos)}"
    return None


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_el_corpus_coincide_con_pydantic(case, tmp_path):
    verdict = _verdict(case["yaml"], tmp_path)
    if case["valid"]:
        assert verdict is None, f"debía ser válido pero falló: {verdict}"
    else:
        assert verdict is not None, "debía ser rechazado y pasó"


def test_el_corpus_cubre_las_reglas_que_json_schema_no_expresa():
    """Estas son justo las que el panel tiene que duplicar a mano."""
    cubiertas = {c.get("expect") for c in CASES}
    assert {
        "lower_ge_upper",
        "sin_umbral",
        "id_duplicado",
        "provider_no_declarado",
        "provider_desconocido",
        "sin_activos",
    } <= cubiertas


def test_el_esquema_json_esta_al_dia():
    """Si falla: `python scripts/gen_schema.py`."""
    import subprocess
    import sys

    root = Path(__file__).parent.parent
    result = subprocess.run(
        [sys.executable, "scripts/gen_schema.py", "--check"], cwd=root, capture_output=True, text=True
    )
    assert result.returncode == 0, result.stdout + result.stderr
