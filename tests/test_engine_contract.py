"""El corpus de alertas, visto desde el motor de verdad.

`schema/alert_cases.json` lo consumen dos lados: este test contra `evaluate()`, y
`web/test/mercado.contract.test.ts` contra la simulación del panel.

Importa porque el panel le dice al usuario «con estos umbrales te habría avisado
N veces» para ayudarle a elegirlos. Si esa cuenta se separa del motor, el panel
promete avisos que luego no llegan, y eso es peor que no decir nada: el usuario
elige el umbral confiando en un número inventado.

Este lado es el árbitro. Si los dos no coinciden, el que está mal es el panel.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, UTC
from decimal import Decimal
from pathlib import Path

import pytest

from vigilante.config import ResolvedAsset
from vigilante.engine import evaluate
from vigilante.models import Quote

CASES = json.loads((Path(__file__).parent.parent / "schema" / "alert_cases.json").read_text("utf-8"))["cases"]
INICIO = datetime(2026, 9, 10, tzinfo=UTC)


def _asset(caso: dict) -> ResolvedAsset:
    def dec(clave: str) -> Decimal | None:
        valor = caso.get(clave)
        return None if valor is None else Decimal(valor)

    return ResolvedAsset(
        id="caso",
        label="Caso",
        provider="coingecko",
        symbol="x",
        currency="usd",
        lower=dec("lower"),
        upper=dec("upper"),
        cooldown_minutes=caso.get("cooldown_minutes", 180),
        hysteresis_pct=Decimal(caso.get("hysteresis_pct", "0.25")),
        notify_on_return=caso.get("notify_on_return", True),
        renotify_while_outside=caso.get("renotify_while_outside", False),
        notify_transient=caso.get("notify_transient", False),
        # Alto a propósito: aquí se mide la lógica de zonas, no la de datos
        # rancios, y los puntos del corpus están separados horas.
        max_staleness_minutes=10**6,
        first_run_policy=caso.get("first_run_policy", "summary"),
        fallback=None,
    )


def _contar(caso: dict) -> int:
    cfg = _asset(caso)
    estado = None
    avisos = 0
    for offset_ms, precio in caso["puntos"]:
        ahora = INICIO + timedelta(milliseconds=offset_ms)
        quote = Quote(
            asset_id=cfg.id,
            price=Decimal(precio),
            currency=cfg.currency,
            as_of=ahora,
            provider=cfg.provider,
        )
        estado, evento = evaluate(cfg, estado, quote, ahora)
        if evento is not None:
            avisos += 1
    return avisos


@pytest.mark.parametrize("caso", CASES, ids=[c["nombre"] for c in CASES])
def test_corpus_de_alertas(caso: dict) -> None:
    assert _contar(caso) == caso["avisos"]
