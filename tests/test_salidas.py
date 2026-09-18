"""El plan de salida por tramos.

Lo que convierte «vender alto» en una decisión tomada en frío en vez de una
improvisación en el momento de máxima euforia, que es exactamente cuando peor
se decide.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest

from vigilante.config import ExitSpec, ResolvedAsset
from vigilante.models import AssetState, EventKind, Quote
from vigilante.salidas import check

AHORA = datetime(2026, 9, 18, tzinfo=UTC)


def asset(tramos: list[tuple[str, str | None]], entrada: str | None = "1") -> ResolvedAsset:
    exits = tuple(
        sorted(
            (ExitSpec(price=Decimal(p), sell_pct=None if s is None else Decimal(s)) for p, s in tramos),
            key=lambda e: e.price,
        )
    )
    return ResolvedAsset(
        id="doge", label="Dogecoin", provider="coingecko", symbol="dogecoin", currency="usd",
        lower=None, upper=None, cooldown_minutes=180, hysteresis_pct=Decimal("0.25"),
        notify_on_return=True, renotify_while_outside=False, notify_transient=False,
        max_staleness_minutes=240, first_run_policy="summary", fallback=None, trailing=None,
        exits=exits, entry_price=None if entrada is None else Decimal(entrada),
    )


def quote(precio: str) -> Quote:
    return Quote(asset_id="doge", price=Decimal(precio), currency="usd", as_of=AHORA, provider="coingecko")


def recorrer(cfg: ResolvedAsset, precios: list[str], estado: AssetState | None = None):
    """Devuelve (estado final, lista de eventos)."""
    estado = estado or AssetState()
    eventos = []
    for i, precio in enumerate(precios):
        cuando = AHORA + timedelta(minutes=15 * i)
        estado, evento = check(cfg, estado, quote(precio), cuando)
        if evento is not None:
            eventos.append(evento)
    return estado, eventos


class TestAlcanzarTramos:
    def test_avisa_al_llegar_al_primer_objetivo(self) -> None:
        _, eventos = recorrer(asset([("2", "25"), ("3", "25")]), ["1", "1.5", "2.1"])
        assert [e.kind for e in eventos] == [EventKind.EXIT_TARGET]
        assert eventos[0].threshold == Decimal("2")

    def test_un_tramo_ya_alcanzado_NO_vuelve_a_avisar(self) -> None:
        # Es la razón de existir de este módulo: ese tramo ya lo vendiste, el
        # aviso no puede volver a sonar porque ya no tienes esa parte.
        _, eventos = recorrer(asset([("2", "50")]), ["1", "2.1", "1.5", "2.2", "1.8", "2.5"])
        assert len(eventos) == 1

    def test_un_salto_grande_junta_los_tramos_en_un_aviso(self) -> None:
        # Entre dos consultas el precio puede saltarse varios objetivos. Son la
        # misma noticia, no tres mensajes.
        _, eventos = recorrer(asset([("2", "25"), ("3", "25"), ("4", "25")]), ["1", "4.5"])
        assert len(eventos) == 1
        assert eventos[0].threshold == Decimal("4")
        assert "75 %" in eventos[0].detail

    def test_despues_del_salto_sigue_avisando_de_los_de_arriba(self) -> None:
        _, eventos = recorrer(asset([("2", "25"), ("3", "25"), ("10", "50")]), ["1", "4.5", "11"])
        assert len(eventos) == 2
        assert eventos[1].threshold == Decimal("10")

    def test_no_avisa_mientras_no_llega(self) -> None:
        _, eventos = recorrer(asset([("2", "50")]), ["1", "1.5", "1.99"])
        assert eventos == []


class TestSinCooldown:
    def test_dos_objetivos_seguidos_avisan_aunque_sea_al_minuto(self) -> None:
        # A diferencia del trailing, esto NO lleva silencio: alcanzar un objetivo
        # de venta es un suceso único y accionable. Callarlo tres horas puede
        # costar exactamente el tramo que habías planeado vender.
        cfg = asset([("2", "25"), ("3", "25")])
        estado, primeros = recorrer(cfg, ["1", "2.1"])
        _, segundos = recorrer(cfg, ["3.1"], estado)
        assert len(primeros) == 1 and len(segundos) == 1


class TestEditarElPlan:
    def test_cambiar_el_plan_no_dispara_los_tramos_ya_superados(self) -> None:
        # Reorganizar el plan con el precio arriba no puede soltar de golpe
        # todos los avisos de los tramos por debajo.
        estado, _ = recorrer(asset([("2", "50")]), ["1", "2.5"])
        _, eventos = recorrer(asset([("1.5", "25"), ("2", "25")]), ["2.5"], estado)
        assert eventos == []

    def test_pero_un_objetivo_nuevo_por_encima_sigue_avisando(self) -> None:
        estado, _ = recorrer(asset([("2", "50")]), ["1", "2.5"])
        _, eventos = recorrer(asset([("2", "25"), ("5", "25")]), ["2.5", "5.5"], estado)
        assert len(eventos) == 1
        assert eventos[0].threshold == Decimal("5")

    def test_sin_plan_configurado_no_se_guarda_nada(self) -> None:
        cfg = asset([])
        estado, evento = check(cfg, AssetState(highest_exit=Decimal("9")), quote("5"), AHORA)
        assert evento is None
        assert estado.highest_exit is None


class TestMensaje:
    def test_dice_qué_parte_tocaba_vender(self) -> None:
        _, eventos = recorrer(asset([("2", "25")]), ["1", "2.1"])
        assert "25 %" in eventos[0].detail

    def test_dice_el_múltiplo_sobre_la_entrada(self) -> None:
        # «2x sobre tu entrada» se entiende sin hacer cuentas; «0,16 USD» no.
        _, eventos = recorrer(asset([("2", "25")], entrada="1"), ["1", "2.1"])
        assert "2x sobre tu entrada" in eventos[0].detail

    def test_sin_entrada_registrada_no_inventa_el_múltiplo(self) -> None:
        _, eventos = recorrer(asset([("2", "25")], entrada=None), ["1", "2.1"])
        assert "x sobre tu entrada" not in eventos[0].detail

    def test_los_porcentajes_redondos_no_salen_en_notacion_cientifica(self) -> None:
        # `Decimal("50").normalize()` es `5E+1`, y el mensaje decía «tu plan
        # vende 5E+1 % aquí». Un aviso cuyo trabajo es que decidas rápido no
        # puede estar escrito así.
        _, eventos = recorrer(asset([("2", "25"), ("3", "25")]), ["1", "3.5"])
        assert "50 %" in eventos[0].detail
        assert "E+" not in eventos[0].detail

    def test_los_multiplos_redondos_tampoco(self) -> None:
        _, eventos = recorrer(asset([("10", "50")], entrada="1"), ["1", "11"])
        assert "10x sobre tu entrada" in eventos[0].detail

    def test_la_nota_del_usuario_viaja_al_aviso(self) -> None:
        cfg = asset([])
        object.__setattr__(
            cfg, "exits", (ExitSpec(price=Decimal("2"), sell_pct=Decimal("50"), note="recupero lo invertido"),)
        )
        _, eventos = recorrer(cfg, ["1", "2.1"])
        assert "recupero lo invertido" in eventos[0].detail


class TestConfiguracion:
    def test_no_se_puede_vender_mas_del_100_por_ciento(self) -> None:
        from vigilante.config import AssetSpec

        with pytest.raises(ValueError, match="100 %"):
            AssetSpec(
                id="x", provider="coingecko", symbol="y",
                exits=[{"price": "2", "sell_pct": "60"}, {"price": "3", "sell_pct": "60"}],
            )

    def test_no_se_puede_repetir_un_precio(self) -> None:
        from vigilante.config import AssetSpec

        with pytest.raises(ValueError, match="repite un precio"):
            AssetSpec(
                id="x", provider="coingecko", symbol="y",
                exits=[{"price": "2", "sell_pct": "25"}, {"price": "2", "sell_pct": "25"}],
            )

    def test_un_plan_de_salida_ya_es_algo_que_vigilar(self) -> None:
        from vigilante.config import AssetSpec

        spec = AssetSpec(id="x", provider="coingecko", symbol="y", exits=[{"price": "2"}])
        assert spec.lower is None and spec.upper is None
