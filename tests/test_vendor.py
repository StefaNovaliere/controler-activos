"""La copia que despliega Vercel no puede desviarse del paquete real.

`web/api/_vendor/vigilante` es una copia commiteada de `src/vigilante`. Existe
porque el builder de Python de Vercel parte del checkout de git y no ve lo que
genera el build de Next, así que un directorio generado durante el build
simplemente no existe para las funciones.

El precio de esa copia es que puede quedarse atrás. Este test es lo que impide
que el panel valide con una versión vieja de las reglas mientras el bot usa otra.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

import pytest

RAIZ = Path(__file__).parent.parent
FUENTE = RAIZ / "src" / "vigilante"
COPIA = RAIZ / "web" / "api" / "_vendor" / "vigilante"


def _huellas(base: Path) -> dict[str, str]:
    return {
        str(f.relative_to(base)): hashlib.sha256(f.read_bytes()).hexdigest()
        for f in sorted(base.rglob("*.py"))
        if "__pycache__" not in f.parts
    }


def test_la_copia_existe():
    """Si falta, las funciones de Vercel dan un 500 al arrancar."""
    assert COPIA.is_dir(), "falta web/api/_vendor/vigilante: `node scripts/vendor.mjs` desde web/"


def test_la_copia_es_identica_al_paquete():
    fuente, copia = _huellas(FUENTE), _huellas(COPIA)

    faltan = sorted(set(fuente) - set(copia))
    sobran = sorted(set(copia) - set(fuente))
    distintos = sorted(f for f in set(fuente) & set(copia) if fuente[f] != copia[f])

    assert not faltan, f"faltan en la copia: {faltan}. Regenera con `node scripts/vendor.mjs`"
    assert not sobran, f"sobran en la copia: {sobran}. Regenera con `node scripts/vendor.mjs`"
    assert not distintos, f"han cambiado: {distintos}. Regenera con `node scripts/vendor.mjs`"


def test_la_copia_no_arrastra_bytecode():
    assert not list(COPIA.rglob("*.pyc"))
    assert not [d for d in COPIA.rglob("__pycache__")]


@pytest.mark.parametrize("modulo", ["config", "errors", "providers/registry"])
def test_los_modulos_que_usan_las_funciones_estan(modulo):
    assert (COPIA / f"{modulo}.py").exists()
