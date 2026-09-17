"""Tests de la máquina de estados.

El motor es puro, así que aquí se recorre el ciclo de vida completo de una alerta
sin red, sin disco y sin esperar al cron: basta con inyectar precios e instantes.
"""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal

import pytest

from vigilante.engine import classify, evaluate
from vigilante.models import AssetState, EventKind, PendingEvent, Zone

from .conftest import T0, make_asset, make_quote, make_state


# --------------------------------------------------------------------------- #
# Tabla de transiciones
# --------------------------------------------------------------------------- #

@pytest.mark.parametrize(
    "prev_zone,price,expect_zone,expect_kind",
    [
        # Arranque en frío
        (None, "60000", Zone.INSIDE, None),
        (None, "50000", Zone.BELOW, EventKind.INIT_OUTSIDE),
        (None, "99000", Zone.ABOVE, EventKind.INIT_OUTSIDE),
        # Rupturas
        (Zone.INSIDE, "54999", Zone.BELOW, EventKind.BREACH_LOWER),
        (Zone.INSIDE, "95001", Zone.ABOVE, EventKind.BREACH_UPPER),
        # Permanencia: no se repite el aviso
        (Zone.BELOW, "40000", Zone.BELOW, None),
        (Zone.ABOVE, "99000", Zone.ABOVE, None),
        (Zone.INSIDE, "60000", Zone.INSIDE, None),
        # Histéresis: rozar el umbral no cuenta como vuelta al rango
        (Zone.BELOW, "55050", Zone.BELOW, None),
        (Zone.BELOW, "55200", Zone.INSIDE, EventKind.RECOVER_FROM_BELOW),
        (Zone.ABOVE, "94950", Zone.ABOVE, None),
        (Zone.ABOVE, "94700", Zone.INSIDE, EventKind.RECOVER_FROM_ABOVE),
        # Cruce completo de un extremo al otro entre dos consultas
        (Zone.BELOW, "99000", Zone.ABOVE, EventKind.BREACH_UPPER),
        (Zone.ABOVE, "40000", Zone.BELOW, EventKind.BREACH_LOWER),
    ],
)
def test_transiciones(cfg, prev_zone, price, expect_zone, expect_kind):
    prev = make_state(cfg, prev_zone)
    state, event = evaluate(cfg, prev, make_quote(cfg, price), T0)

    assert state.zone is expect_zone
    assert (event.kind if event else None) == expect_kind


def test_precio_igual_al_umbral_esta_dentro(cfg):
    """La comparación es estricta: `price == lower` NO es una ruptura."""
    state, event = evaluate(cfg, make_state(cfg, Zone.INSIDE), make_quote(cfg, "55000"), T0)
    assert state.zone is Zone.INSIDE
    assert event is None


def test_umbral_superior_nulo_nunca_dispara_por_arriba():
    cfg = make_asset(upper=None)
    state, event = evaluate(cfg, make_state(cfg, Zone.INSIDE), make_quote(cfg, "999999"), T0)
    assert state.zone is Zone.INSIDE
    assert event is None


def test_classify_sin_zona_previa_ignora_histeresis(cfg):
    """Sin estado previo no hay de qué salir: la histéresis no aplica."""
    assert classify(Decimal("55050"), cfg, None) is Zone.INSIDE
    assert classify(Decimal("55050"), cfg, Zone.BELOW) is Zone.BELOW


# --------------------------------------------------------------------------- #
# Cooldown y pendientes
# --------------------------------------------------------------------------- #

def test_cooldown_retiene_el_evento_como_pendiente(cfg):
    prev = make_state(cfg, Zone.INSIDE, last_breach_notified_at=T0 - timedelta(minutes=10))
    state, event = evaluate(cfg, prev, make_quote(cfg, "54000"), T0)

    assert event is None, "el cooldown silencia el envío"
    assert state.zone is Zone.BELOW, "pero NUNCA congela la zona"
    assert state.pending == PendingEvent(EventKind.BREACH_LOWER, T0, Decimal("54000"))


def test_pendiente_sale_coalescido_al_vencer_el_cooldown(cfg):
    prev = make_state(
        cfg,
        Zone.BELOW,
        last_breach_notified_at=T0 - timedelta(minutes=180),
        pending=PendingEvent(EventKind.BREACH_LOWER, T0 - timedelta(minutes=42), Decimal("54980")),
    )
    later = T0 + timedelta(minutes=1)
    state, event = evaluate(cfg, prev, make_quote(cfg, "53210", at=later), later)

    assert event is not None and event.kind is EventKind.BREACH_LOWER
    assert event.is_coalesced
    assert event.since == T0 - timedelta(minutes=42)
    assert event.first_price == Decimal("54980"), "conserva el precio del cruce original"
    assert event.price == Decimal("53210"), "y añade el precio actual"
    assert state.pending is None


def test_cooldown_justo_en_el_limite_si_envia(cfg):
    prev = make_state(cfg, Zone.INSIDE, last_breach_notified_at=T0 - timedelta(minutes=180))
    _, event = evaluate(cfg, prev, make_quote(cfg, "54000"), T0)
    assert event is not None, "now - last == cooldown cuenta como vencido"


def test_pendiente_que_se_resuelve_solo_se_descarta_en_silencio(cfg):
    """Si el usuario nunca supo del cruce, anunciarle la vuelta solo confunde."""
    prev = make_state(
        cfg,
        Zone.BELOW,
        last_breach_notified_at=T0,
        pending=PendingEvent(EventKind.BREACH_LOWER, T0, Decimal("54900")),
    )
    state, event = evaluate(cfg, prev, make_quote(cfg, "56000"), T0 + timedelta(minutes=5))

    assert event is None
    assert state.zone is Zone.INSIDE
    assert state.pending is None


def test_notify_transient_sí_anuncia_el_cruce_breve():
    cfg = make_asset(notify_transient=True)
    prev = make_state(
        cfg,
        Zone.BELOW,
        last_breach_notified_at=T0,
        pending=PendingEvent(EventKind.BREACH_LOWER, T0, Decimal("54900")),
    )
    _, event = evaluate(cfg, prev, make_quote(cfg, "56000"), T0 + timedelta(minutes=5))

    assert event is not None and event.kind is EventKind.RECOVER_FROM_BELOW
    assert event.first_price == Decimal("54900")


def test_recuperacion_no_la_bloquea_el_cooldown_de_la_ruptura(cfg):
    """Son señales distintas: la vuelta al rango es la otra mitad del aviso."""
    prev = make_state(cfg, Zone.BELOW, last_breach_notified_at=T0 - timedelta(minutes=1))
    _, event = evaluate(cfg, prev, make_quote(cfg, "56000"), T0)
    assert event is not None and event.kind is EventKind.RECOVER_FROM_BELOW


def test_recuperacion_respeta_su_propio_cooldown(cfg):
    prev = make_state(cfg, Zone.BELOW, last_recovery_notified_at=T0 - timedelta(minutes=10))
    state, event = evaluate(cfg, prev, make_quote(cfg, "56000"), T0)
    assert event is None
    assert state.pending is not None and state.pending.kind is EventKind.RECOVER_FROM_BELOW


def test_cruce_completo_ignora_el_cooldown(cfg):
    prev = make_state(cfg, Zone.BELOW, last_breach_notified_at=T0 - timedelta(minutes=1))
    _, event = evaluate(cfg, prev, make_quote(cfg, "99000"), T0)
    assert event is not None and event.kind is EventKind.BREACH_UPPER


def test_force_notify_salta_el_cooldown(cfg):
    prev = make_state(cfg, Zone.INSIDE, last_breach_notified_at=T0 - timedelta(minutes=1))
    _, event = evaluate(cfg, prev, make_quote(cfg, "54000"), T0, force_notify=True)
    assert event is not None and event.kind is EventKind.BREACH_LOWER


def test_notify_on_return_false_silencia_la_vuelta():
    cfg = make_asset(notify_on_return=False)
    state, event = evaluate(cfg, make_state(cfg, Zone.BELOW), make_quote(cfg, "60000"), T0)
    assert event is None
    assert state.zone is Zone.INSIDE, "la zona se actualiza igualmente"


def test_renotify_while_outside_recuerda_al_vencer_el_cooldown():
    cfg = make_asset(renotify_while_outside=True)
    prev = make_state(cfg, Zone.BELOW, last_breach_notified_at=T0 - timedelta(minutes=180))
    _, event = evaluate(cfg, prev, make_quote(cfg, "50000"), T0)
    assert event is not None and event.detail == "sigue fuera de rango"


# --------------------------------------------------------------------------- #
# Arranque en frío y cambios de configuración
# --------------------------------------------------------------------------- #

@pytest.mark.parametrize(
    "policy,espera_evento",
    [("none", False), ("summary", True), ("full", True)],
)
def test_first_run_policy(policy, espera_evento):
    cfg = make_asset(first_run_policy=policy)
    state, event = evaluate(cfg, None, make_quote(cfg, "50000"), T0)
    assert (event is not None) is espera_evento
    assert state.zone is Zone.BELOW, "la zona se persiste aunque no se avise"


def test_cambiar_un_umbral_reevalua_como_arranque_en_frio():
    """Sin esto, subir el umbral y que el bot siga callado sería un bug silencioso."""
    viejo = make_asset(lower=Decimal("40000"))
    prev = make_state(viejo, Zone.INSIDE, last_breach_notified_at=T0)

    nuevo = make_asset(lower=Decimal("55000"))
    state, event = evaluate(nuevo, prev, make_quote(nuevo, "50000"), T0)

    assert state.zone is Zone.BELOW
    assert event is not None and event.kind is EventKind.INIT_OUTSIDE
    assert state.config_fingerprint == nuevo.fingerprint()


def test_cambio_de_configuracion_descarta_el_pendiente_obsoleto():
    viejo = make_asset(lower=Decimal("40000"))
    prev = make_state(
        viejo,
        Zone.BELOW,
        pending=PendingEvent(EventKind.BREACH_LOWER, T0, Decimal("39000")),
    )
    nuevo = make_asset(lower=Decimal("55000"))
    state, _ = evaluate(nuevo, prev, make_quote(nuevo, "60000"), T0)
    assert state.pending is None


def test_estado_vacio_equivale_a_arranque_en_frio(cfg):
    state, _ = evaluate(cfg, AssetState(), make_quote(cfg, "60000"), T0)
    assert state.zone is Zone.INSIDE
    assert state.config_fingerprint == cfg.fingerprint()
