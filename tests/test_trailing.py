"""El aviso que contesta «¿se dio la vuelta?».

Un umbral fijo sirve cuando tienes una opinión de precio. No sirve para vender
alto en algo que no sabes hasta dónde va a subir: ahí no quieres elegir el
techo, quieres enterarte cuando se haya dado la vuelta.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest

from vigilante.config import FallbackSpec, ResolvedAsset, TrailingSpec
from vigilante.models import AssetState, EventKind, Quote
from vigilante.trailing import check

AHORA = datetime(2026, 9, 18, tzinfo=UTC)


def asset(drop: str | None = "20", rise: str | None = None, cooldown: int = 180) -> ResolvedAsset:
    return ResolvedAsset(
        id="doge",
        label="Dogecoin",
        provider="coingecko",
        symbol="dogecoin",
        currency="usd",
        lower=None,
        upper=None,
        cooldown_minutes=cooldown,
        hysteresis_pct=Decimal("0.25"),
        notify_on_return=True,
        renotify_while_outside=False,
        notify_transient=False,
        max_staleness_minutes=240,
        first_run_policy="summary",
        fallback=None,
        trailing=TrailingSpec(
            drop_pct=None if drop is None else Decimal(drop),
            rise_pct=None if rise is None else Decimal(rise),
        ),
    )


def quote(precio: str, cuando: datetime = AHORA) -> Quote:
    return Quote(asset_id="doge", price=Decimal(precio), currency="usd", as_of=cuando, provider="coingecko")


def recorrer(cfg: ResolvedAsset, precios: list[str], paso_min: int = 30) -> list[EventKind]:
    """Pasa una serie de precios y devuelve los avisos que habrían salido."""
    estado = AssetState()
    avisos: list[EventKind] = []
    for i, precio in enumerate(precios):
        cuando = AHORA + timedelta(minutes=i * paso_min)
        estado, evento = check(cfg, estado, quote(precio, cuando), cuando)
        if evento is not None:
            avisos.append(evento.kind)
    return avisos


class TestRastro:
    def test_la_primera_consulta_siembra_pero_no_avisa(self) -> None:
        # No hay historia con la que comparar: un aviso aquí sería inventado.
        estado, evento = check(asset(), AssetState(), quote("1"), AHORA)
        assert evento is None
        assert estado.peak == Decimal("1")
        assert estado.trough == Decimal("1")

    def test_el_maximo_sube_pero_no_baja(self) -> None:
        cfg = asset()
        estado = AssetState()
        for precio in ("1", "2", "1.9"):
            estado, _ = check(cfg, estado, quote(precio), AHORA)
        assert estado.peak == Decimal("2")
        assert estado.trough == Decimal("1")

    def test_sin_trailing_configurado_no_se_guarda_rastro(self) -> None:
        # Que el estado no engorde con datos que nadie va a leer.
        cfg = asset()
        object.__setattr__(cfg, "trailing", None)
        estado, evento = check(cfg, AssetState(peak=Decimal("9"), trough=Decimal("1")), quote("5"), AHORA)
        assert evento is None
        assert estado.peak is None and estado.trough is None


class TestCaida:
    def test_avisa_al_caer_lo_pactado_desde_el_maximo(self) -> None:
        # Sube a 2 y cae a 1,6: un 20 % desde el máximo.
        assert recorrer(asset(drop="20"), ["1", "2", "1.6"]) == [EventKind.TRAILING_DROP]

    def test_no_avisa_mientras_sube(self) -> None:
        # Es la diferencia con un umbral fijo: la moneda puede hacer 20x sin que
        # esto diga nada, porque no se ha dado la vuelta.
        assert recorrer(asset(drop="20"), ["1", "2", "5", "10", "20"]) == []

    def test_una_caida_pequena_no_dispara(self) -> None:
        assert recorrer(asset(drop="20"), ["1", "2", "1.85"]) == []

    def test_es_relativo_al_maximo_nuevo_no_al_precio_inicial(self) -> None:
        # Sube a 10 y cae a 8: un 20 % desde 10, aunque siga muy por encima
        # del precio de partida. Un umbral fijo no puede expresar esto.
        assert recorrer(asset(drop="20"), ["1", "10", "8"]) == [EventKind.TRAILING_DROP]

    def test_una_cascada_avisa_por_tramos(self) -> None:
        # Tras avisar, el rastro se reinicia. Sin eso el aviso se repetiría en
        # cada consulta mientras siguiera cayendo; con eso, avisa por tramos.
        avisos = recorrer(asset(drop="20", cooldown=0), ["10", "8", "6.4", "5.1"])
        assert avisos == [EventKind.TRAILING_DROP] * 3


class TestRebote:
    def test_avisa_al_rebotar_desde_el_minimo(self) -> None:
        assert recorrer(asset(drop=None, rise="30"), ["10", "5", "6.5"]) == [EventKind.TRAILING_RISE]

    def test_no_avisa_mientras_cae(self) -> None:
        assert recorrer(asset(drop=None, rise="30"), ["10", "5", "2", "1"]) == []

    def test_caida_y_despues_rebote_dan_dos_avisos(self) -> None:
        # El ciclo entero que interesa: se dio la vuelta, y luego tocó fondo.
        avisos = recorrer(asset(drop="20", rise="30", cooldown=0), ["10", "8", "4", "5.2"])
        assert EventKind.TRAILING_DROP in avisos
        assert EventKind.TRAILING_RISE in avisos


class TestSilencio:
    def test_el_silencio_retiene_el_aviso(self) -> None:
        assert recorrer(asset(drop="20", cooldown=180), ["10", "8", "6.4"], paso_min=30) == [
            EventKind.TRAILING_DROP
        ]

    def test_pero_la_condicion_no_se_pierde_y_sale_al_vencer(self) -> None:
        # A diferencia de un cruce de zona, que es un instante, esta condición
        # sigue siendo cierta: se vuelve a detectar sola sin necesitar un
        # evento pendiente guardado.
        avisos = recorrer(asset(drop="20", cooldown=180), ["10", "8", "6.4", "6.4"], paso_min=200)
        assert avisos == [EventKind.TRAILING_DROP, EventKind.TRAILING_DROP]

    def test_retenido_no_reinicia_el_rastro(self) -> None:
        cfg = asset(drop="20", cooldown=180)
        estado = AssetState()
        estado, _ = check(cfg, estado, quote("10"), AHORA)
        estado, _ = check(cfg, estado, quote("8"), AHORA + timedelta(minutes=30))
        antes = estado.peak
        estado, evento = check(cfg, estado, quote("7.9"), AHORA + timedelta(minutes=60))
        assert evento is None
        assert estado.peak == antes  # el máximo sigue siendo 10, no 7,9


class TestConfiguracion:
    def test_cambiar_el_porcentaje_reinicia_el_rastro(self) -> None:
        # Los extremos guardados corresponden a lo que el usuario pidió antes.
        # Si cambia lo que pide, compararse con ellos daría un aviso ajeno.
        estado = AssetState()
        cfg20 = asset(drop="20")
        for precio in ("10", "9"):
            estado, _ = check(cfg20, estado, quote(precio), AHORA)

        estado, evento = check(asset(drop="50"), estado, quote("9"), AHORA)
        assert evento is None
        assert estado.peak == Decimal("9")  # sembrado de nuevo, ya no 10

    def test_no_se_puede_configurar_un_trailing_vacio(self) -> None:
        with pytest.raises(ValueError, match="no vigila nada"):
            TrailingSpec()

    def test_una_caida_del_100_por_ciento_no_tiene_sentido(self) -> None:
        # El precio tendría que llegar a cero exacto.
        with pytest.raises(ValueError):
            TrailingSpec(drop_pct=Decimal("100"))
