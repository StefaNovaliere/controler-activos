"""Invariante central ante fallos del proveedor.

Un proveedor caído no puede traducirse en alertas fantasma al volver el servicio.
La garantía es fuerte y merece su propio fichero: pase lo que pase, un error
**no** toca `zone`, `pending` ni los relojes de notificación.
"""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal

import pytest

from vigilante.engine import HEALTH_FAILURE_STEPS, evaluate
from vigilante.errors import ProviderError, RateLimited
from vigilante.models import EventKind, PendingEvent, Zone

from .conftest import T0, make_asset, make_quote, make_state

CAMPOS_INTOCABLES = ("zone", "pending", "last_breach_notified_at", "last_recovery_notified_at")


@pytest.fixture
def estado_rico(cfg):
    return make_state(
        cfg,
        Zone.BELOW,
        last_price=Decimal("54000"),
        last_breach_notified_at=T0 - timedelta(hours=2),
        last_recovery_notified_at=T0 - timedelta(hours=9),
        pending=PendingEvent(EventKind.BREACH_LOWER, T0 - timedelta(hours=1), Decimal("54100")),
    )


def test_un_fallo_no_toca_nada_salvo_el_contador(cfg, estado_rico):
    nuevo, event = evaluate(cfg, estado_rico, ProviderError("502 Bad Gateway"), T0)

    for campo in CAMPOS_INTOCABLES:
        assert getattr(nuevo, campo) == getattr(estado_rico, campo)
    assert nuevo.consecutive_failures == 1
    assert nuevo.last_error_at == T0
    assert event is None


def test_fallos_repetidos_conservan_el_estado(cfg, estado_rico):
    estado, now = estado_rico, T0
    for _ in range(50):
        now += timedelta(minutes=30)
        estado, _ = evaluate(cfg, estado, RateLimited("429", retry_after=60), now)

    for campo in CAMPOS_INTOCABLES:
        assert getattr(estado, campo) == getattr(estado_rico, campo)
    assert estado.consecutive_failures == 50


def test_avisa_al_llevar_demasiado_tiempo_a_ciegas(cfg, estado_rico):
    """Un proveedor mudo es una alerta que no va a llegar: hay que enterarse."""
    estado = estado_rico.with_(consecutive_failures=HEALTH_FAILURE_STEPS[0] - 1)
    _, event = evaluate(cfg, estado, ProviderError("timeout"), T0)

    assert event is not None and event.kind is EventKind.HEALTH
    assert event.price is None


def test_el_aviso_de_salud_no_se_repite_en_cada_escalon(cfg, estado_rico):
    estado = estado_rico.with_(
        consecutive_failures=HEALTH_FAILURE_STEPS[1] - 1,
        last_health_notified_at=T0 - timedelta(minutes=30),
    )
    _, event = evaluate(cfg, estado, ProviderError("timeout"), T0)
    assert event is None


def test_un_precio_rancio_es_un_fallo_no_un_precio(cfg, estado_rico):
    """El cierre del viernes no puede disparar una "recuperación" el domingo."""
    viejo = T0 - timedelta(minutes=cfg.max_staleness_minutes + 1)
    nuevo, event = evaluate(cfg, estado_rico, make_quote(cfg, "60000", at=viejo), T0)

    assert nuevo.zone is Zone.BELOW, "no se reclasifica con un dato caducado"
    assert nuevo.consecutive_failures == 1
    assert "máximo" in (nuevo.last_error or ""), "el error dice por qué se descartó"
    assert event is None


def test_un_mercado_cerrado_no_cuenta_como_rancio():
    """Con 4 días de tolerancia, un viernes por la tarde sigue siendo válido el domingo."""
    cfg = make_asset(id="aapl", lower=Decimal("180"), upper=Decimal("260"), max_staleness_minutes=5760)
    viernes = T0 - timedelta(days=2)
    nuevo, _ = evaluate(cfg, make_state(cfg, Zone.INSIDE), make_quote(cfg, "200", at=viernes), T0)
    assert nuevo.consecutive_failures == 0
    assert nuevo.last_price == Decimal("200")


def test_el_contador_se_reinicia_al_recuperar_el_proveedor(cfg, estado_rico):
    roto = estado_rico.with_(consecutive_failures=17, last_error="timeout")
    nuevo, _ = evaluate(cfg, roto, make_quote(cfg, "54000"), T0)
    assert nuevo.consecutive_failures == 0
    assert nuevo.last_error is None
