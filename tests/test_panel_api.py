"""La puerta autoritativa del panel, probada con el mismo corpus que el bot.

Que estos casos den el mismo veredicto aquí, en `test_schema_contract.py` y en
`web/test/contract.test.ts` es lo que garantiza que el formulario no pueda
guardar algo que el bot no sepa leer.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT / "web" / "api"))

from validate import validate_yaml  # noqa: E402

CASES = json.loads((ROOT / "schema" / "cases.json").read_text("utf-8"))["cases"]


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_el_veredicto_coincide_con_el_corpus(case):
    verdict = validate_yaml(case["yaml"])
    assert verdict["ok"] is case["valid"], verdict.get("errors")


def test_devuelve_la_huella_resuelta():
    """Es lo que permite avisar de una reevaluación ANTES de guardar.

    Contra un YAML fijo, no contra `config/assets.yml`: ese lo edita el usuario
    desde el panel y un test atado a sus activos rompería CI al usar el producto.
    """
    verdict = validate_yaml(
        "version: 1\n"
        "providers: {coingecko: {}}\n"
        "assets:\n"
        "  - {id: btc, label: Bitcoin, provider: coingecko, symbol: bitcoin, lower: 55000, upper: 95000}\n"
    )

    assert verdict["ok"]
    btc = next(a for a in verdict["assets"] if a["id"] == "btc")
    assert btc["fingerprint"].startswith("sha256:")
    assert btc["lower"] == "55000"
    assert btc["label"] == "Bitcoin"


def test_la_configuracion_real_pasa_la_puerta():
    """Lo que de verdad importa del fichero del usuario: que el bot lo acepte."""
    assert validate_yaml((ROOT / "config" / "assets.yml").read_text("utf-8"))["ok"]


def test_un_yaml_vacio_no_revienta():
    assert validate_yaml("")["ok"] is False


def test_los_errores_llegan_como_lineas_legibles():
    errores = validate_yaml("version: 1\nproviders: {stooq: {}}\nassets: []\n")["errors"]
    assert errores and all(isinstance(line, str) for line in errores)
