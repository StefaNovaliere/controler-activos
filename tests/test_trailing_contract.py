"""El corpus de avisos de giro, visto desde el módulo de verdad.

Gemelo de `tests/test_engine_contract.py`. El panel dice «con este porcentaje te
habría avisado N veces» para ayudar a elegirlo, y ese número sale de una
simulación en TypeScript porque el bot no corre en el navegador. Aquí se
comprueba contra `vigilante.trailing`, que es el que manda.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path

import pytest

from vigilante.config import ResolvedAsset, TrailingSpec
from vigilante.models import AssetState, Quote
from vigilante.trailing import check

CASES = json.loads((Path(__file__).parent.parent / "schema" / "trailing_cases.json").read_text("utf-8"))["cases"]
INICIO = datetime(2026, 9, 10, tzinfo=UTC)


def _asset(caso: dict) -> ResolvedAsset:
    drop, rise = caso.get("drop_pct"), caso.get("rise_pct")
    return ResolvedAsset(
        id="caso",
        label="Caso",
        provider="coingecko",
        symbol="x",
        currency="usd",
        lower=None,
        upper=Decimal("1000000"),  # inofensivo: aquí no se evalúan zonas
        cooldown_minutes=caso.get("cooldown_minutes", 180),
        hysteresis_pct=Decimal("0.25"),
        notify_on_return=True,
        renotify_while_outside=False,
        notify_transient=False,
        max_staleness_minutes=10**6,
        first_run_policy="summary",
        fallback=None,
        trailing=None
        if drop is None and rise is None
        else TrailingSpec(
            drop_pct=None if drop is None else Decimal(drop),
            rise_pct=None if rise is None else Decimal(rise),
        ),
    )


def _contar(caso: dict) -> int:
    cfg = _asset(caso)
    estado = AssetState()
    avisos = 0
    for offset_ms, precio in caso["puntos"]:
        ahora = INICIO + timedelta(milliseconds=offset_ms)
        quote = Quote(
            asset_id=cfg.id, price=Decimal(precio), currency="usd", as_of=ahora, provider="coingecko"
        )
        estado, evento = check(cfg, estado, quote, ahora)
        if evento is not None:
            avisos += 1
    return avisos


@pytest.mark.parametrize("caso", CASES, ids=[c["nombre"] for c in CASES])
def test_corpus_de_giros(caso: dict) -> None:
    assert _contar(caso) == caso["avisos"]
