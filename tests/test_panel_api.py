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
    """Es lo que permite avisar de una reevaluación ANTES de guardar."""
    verdict = validate_yaml((ROOT / "config" / "assets.yml").read_text("utf-8"))

    assert verdict["ok"]
    btc = next(a for a in verdict["assets"] if a["id"] == "btc")
    assert btc["fingerprint"].startswith("sha256:")
    assert btc["lower"] == "55000"
    assert btc["label"] == "Bitcoin"


def test_un_yaml_vacio_no_revienta():
    assert validate_yaml("")["ok"] is False


def test_los_errores_llegan_como_lineas_legibles():
    errores = validate_yaml("version: 1\nproviders: {stooq: {}}\nassets: []\n")["errors"]
    assert errores and all(isinstance(line, str) for line in errores)
