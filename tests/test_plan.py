"""El plan de 7 días: bandas relativas, comandos, calendario, fuentes y ciclo."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path

import pytest
import responses

from vigilante.errors import ConfigError, ProviderError
from vigilante.notifiers.telegram import TelegramNotifier
from vigilante.plan import ciclo, comandos
from vigilante.plan.calendario import balance, recordatorios, resultado_pct
from vigilante.plan.config import ART, PlanSpec, load_plan, segundos_de_bucle
from vigilante.plan.estado import EstadoPlan, EstadoPosicion, cargar, guardar
from vigilante.plan.fuentes import DEXSCREENER_LEGACY, DEXSCREENER_V1, Fuentes, agregar
from vigilante.plan.motor import Lectura, Tipo, evaluar, niveles, pct_txt, precio_txt

RAIZ = Path(__file__).resolve().parents[1]
PLAN = load_plan(RAIZ / "config" / "plan.yml")
SUI = PLAN.posicion("sui")
MEME = PLAN.posicion("meme1")
DIR = "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr"  # forma de dirección Solana válida
DIR2 = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"


def art(texto: str) -> datetime:
    return datetime.fromisoformat(texto).replace(tzinfo=ART).astimezone(UTC)


MIERCOLES_1600 = art("2026-10-07T16:00")
SIN_RECORDATORIOS = EstadoPlan(recordatorios_enviados=tuple(r.id for r in PLAN.recordatorios))


def lectura(precio: str, liquidez: str | None = None, fuente: str = "binance") -> Lectura:
    return Lectura(precio=Decimal(precio), fuente=fuente, liquidez=None if liquidez is None else Decimal(liquidez))


def abierta(entrada: str, **kw) -> EstadoPosicion:
    return EstadoPosicion(entrada=Decimal(entrada), entrada_at=MIERCOLES_1600, **kw)


def recorrer(spec, est, precios, liquidez=None):
    avisos = []
    pausa = False
    for i, p in enumerate(precios):
        r = evaluar(PLAN, spec, est, lectura(p, liquidez[i] if liquidez else None), MIERCOLES_1600 + timedelta(minutes=2 * i))
        est = r.estado
        avisos += list(r.avisos)
        pausa = pausa or r.abre_pausa
    return est, avisos, pausa


# --------------------------------------------------------------------------- #
# Configuración
# --------------------------------------------------------------------------- #


class TestConfig:
    def test_el_plan_real_carga_y_las_horas_son_de_argentina(self):
        assert PLAN.fin == datetime(2026, 10, 13, 23, 0, tzinfo=UTC)  # 20:00 ARG
        assert SUI.entrada.desde == art("2026-10-07T15:30")

    def test_una_banda_al_reves_no_arranca(self, tmp_path):
        texto = (RAIZ / "config" / "plan.yml").read_text(encoding="utf-8").replace("factor: 0.70", "factor: 1.70")
        (tmp_path / "p.yml").write_text(texto, encoding="utf-8")
        with pytest.raises(ConfigError, match="por debajo de la entrada"):
            load_plan(tmp_path / "p.yml")

    def test_el_bucle_solo_dentro_de_su_ventana(self):
        assert segundos_de_bucle(PLAN, art("2026-10-06T12:00"), 19800) == 0
        assert segundos_de_bucle(PLAN, MIERCOLES_1600, 19800) == 19800
        assert segundos_de_bucle(PLAN, art("2026-10-14T09:59"), 19800) == 60
        assert segundos_de_bucle(PLAN, art("2026-10-14T10:00"), 19800) == 0


# --------------------------------------------------------------------------- #
# Motor
# --------------------------------------------------------------------------- #


class TestSui:
    def test_los_niveles_en_precio_son_los_que_van_a_la_oco(self):
        assert niveles(PLAN, SUI, abierta("1.2")) == [
            "TP (+15 %): 1.38",
            "Alerta ↑ (+9 %): 1.308",
            "Alerta ↓ (−5 %): 1.14",
            "SL (−7 %): 1.116 · límite 1.11",
        ]

    def test_la_alerta_superior_mueve_el_sl_a_break_even(self):
        est, avisos, _ = recorrer(SUI, abierta("1.2"), ["1.25", "1.31"])
        assert [a.tipo for a in avisos] == [Tipo.ALERTA_SUPERIOR]
        assert "rearmala" in " ".join(avisos[0].lineas)
        assert est.sl_factor == 1 and not est.cerrada

    def test_tras_la_alerta_volver_a_la_entrada_cierra_en_break_even(self):
        est, avisos, _ = recorrer(SUI, abierta("1.2"), ["1.31", "1.25", "1.199"])
        assert [a.tipo for a in avisos] == [Tipo.ALERTA_SUPERIOR, Tipo.SL]
        assert est.cierre_motivo == "sl_break_even"

    def test_un_salto_directo_al_tp_avisa_las_dos_cosas_y_cierra(self):
        est, avisos, _ = recorrer(SUI, abierta("1.2"), ["1.40"])
        assert [a.tipo for a in avisos] == [Tipo.ALERTA_SUPERIOR, Tipo.TP]
        assert est.cierre_motivo == "tp" and est.vendido_pct == 100

    def test_cada_nivel_suena_una_sola_vez(self):
        _, avisos, _ = recorrer(SUI, abierta("1.2"), ["1.13", "1.15", "1.13", "1.14"])
        assert [a.tipo for a in avisos] == [Tipo.ALERTA_INFERIOR]

    def test_sl_con_el_precio_bajo_el_limite_avisa_que_puede_no_haberse_llenado(self):
        est, avisos, _ = recorrer(SUI, abierta("1.2"), ["1.10"])
        assert [a.tipo for a in avisos] == [Tipo.SL]
        assert "SIN stop" in " ".join(avisos[0].lineas)
        assert "sl_sin_llenar" in est.disparados

    def test_si_cae_bajo_el_limite_despues_del_sl_lo_avisa_una_vez(self):
        est, avisos, _ = recorrer(SUI, abierta("1.2"), ["1.115", "1.10", "1.09"])
        assert [a.tipo for a in avisos] == [Tipo.SL, Tipo.SL_SIN_LLENAR]

    def test_un_stop_de_sui_no_abre_la_pausa_de_memes(self):
        _, _, pausa = recorrer(SUI, abierta("1.2"), ["1.0"])
        assert pausa is False

    def test_sin_entrada_solo_guarda_la_lectura(self):
        est, avisos, _ = recorrer(SUI, EstadoPosicion(), ["1.5", "0.5"])
        assert avisos == [] and est.ultimo_precio == Decimal("0.5")


class TestMeme:
    def test_el_tp_parcial_pasa_a_moonbag_con_sl_en_break_even(self):
        est, avisos, _ = recorrer(MEME, abierta("0.0001"), ["0.00017", "0.00021"])
        assert [a.tipo for a in avisos] == [Tipo.ALERTA_SUPERIOR, Tipo.TP]
        assert est.vendido_pct == 50 and est.sl_factor == 1 and not est.cerrada
        assert niveles(PLAN, MEME, est) == ["SL (+0 %): 0.0001 · break-even"]

    def test_en_moonbag_volver_a_la_entrada_cierra_y_abre_la_pausa(self):
        est, avisos, pausa = recorrer(MEME, abierta("0.0001"), ["0.00021", "0.00015", "0.0000999"])
        assert avisos[-1].tipo is Tipo.SL and est.cierre_motivo == "sl_break_even"
        assert pausa is True
        assert "Pausa" in " ".join(avisos[-1].lineas)

    def test_el_resultado_cuenta_la_mitad_vendida_en_el_tp(self):
        est, _, _ = recorrer(MEME, abierta("0.0001"), ["0.00021", "0.0001"])
        # 50 % a +100 % y 50 % en break-even: +50 % en total.
        assert resultado_pct(est, Decimal("2")) == Decimal("50")

    def test_sl_del_30_cierra_y_abre_la_pausa(self):
        est, avisos, pausa = recorrer(MEME, abierta("1"), ["0.84", "0.69"])
        assert [a.tipo for a in avisos] == [Tipo.ALERTA_INFERIOR, Tipo.SL]
        assert pausa and est.cierre_motivo == "sl"

    def test_liquidez_que_cae_mas_del_30_entre_dos_lecturas(self):
        _, avisos, _ = recorrer(MEME, abierta("1"), ["1", "1", "1"], liquidez=["100000", "80000", "50000"])
        assert [a.tipo for a in avisos] == [Tipo.LIQUIDEZ]
        assert "38 %" in avisos[0].titulo

    def test_sin_dato_de_liquidez_no_se_inventa_una_caida(self):
        _, avisos, _ = recorrer(MEME, abierta("1"), ["1", "1"], liquidez=["100000", None])
        assert avisos == []


class TestFormato:
    @pytest.mark.parametrize(
        ("valor", "texto"),
        [("1.345605", "1.3456"), ("0.000019744", "0.000019744"), ("85477.3", "85477"), ("1.3", "1.3"), ("2", "2")],
    )
    def test_cinco_cifras_sin_notacion_cientifica(self, valor, texto):
        assert precio_txt(Decimal(valor)) == texto

    def test_porcentajes(self):
        assert pct_txt(Decimal("1.09")) == "+9 %"
        assert pct_txt(Decimal("0.925")) == "−7.5 %"


# --------------------------------------------------------------------------- #
# Comandos
# --------------------------------------------------------------------------- #


def consulta_fija(**precios):
    def consultar(spec, direccion):
        valor = precios.get(spec.id)
        if valor is None:
            return "DexScreener no devuelve pares para esta dirección"
        return Lectura(precio=Decimal(valor), fuente="test", liquidez=Decimal("50000"), simbolo_token="BONK")

    return consultar


def correr(texto, estado=None, ahora=MIERCOLES_1600, **precios):
    cmd = comandos.parsear(texto)
    return comandos.aplicar(PLAN, estado or EstadoPlan(), cmd, consulta_fija(**precios), ahora)


class TestComandos:
    def test_parsea_el_sufijo_del_bot_y_la_coma_decimal(self):
        assert comandos.parsear("/entrada@CentinelaBot sui 1,2345") == comandos.Comando("entrada", ("sui", "1,2345"))
        assert comandos.numero("1,2345") == Decimal("1.2345")
        assert comandos.numero("$0.0001") == Decimal("0.0001")
        assert comandos.parsear("hola") is None

    def test_registrar_sui_devuelve_los_niveles_para_la_oco(self):
        estado, r = correr("/entrada sui 1.2", sui="1.2")
        assert estado.de("sui").entrada == Decimal("1.2")
        assert "SL (−7 %): 1.116 · límite 1.11" in r.lineas
        assert not any("⛔" in l for l in r.lineas)

    def test_fuera_de_la_regla_de_precio_lo_registra_pero_lo_dice(self):
        estado, r = correr("/entrada sui 1.35", sui="1.35")
        assert estado.de("sui").entrada == Decimal("1.35")
        assert any("fuera de la regla de entrada" in l for l in r.lineas)

    def test_fuera_de_la_ventana_lo_dice(self):
        _, r = correr("/entrada sui 1.2", ahora=art("2026-10-07T22:10"), sui="1.2")
        assert any("Fuera de la ventana" in l for l in r.lineas)

    def test_durante_las_minutas_de_la_fed_lo_dice(self):
        _, r = correr("/entrada sui 1.2", ahora=art("2026-10-07T14:45"), sui="1.2")
        assert any("minutas de la Fed" in l for l in r.lineas)

    def test_un_precio_lejos_del_mercado_pregunta_si_es_un_tipeo(self):
        _, r = correr("/entrada sui 12.1", sui="1.21")
        assert any("¿Error de tipeo?" in l for l in r.lineas)

    def test_una_meme_sin_direccion_no_se_registra(self):
        estado, r = correr("/entrada meme1 0.0001")
        assert estado.de("meme1").entrada is None and "dirección" in r.titulo

    def test_una_direccion_que_dexscreener_no_conoce_se_rechaza(self):
        estado, r = correr(f"/entrada meme1 {DIR}")
        assert estado.de("meme1").entrada is None and "No encuentro" in r.titulo

    def test_meme_sin_precio_toma_el_de_mercado(self):
        estado, r = correr(f"/entrada meme1 {DIR}", ahora=art("2026-10-07T18:00"), meme1="0.00042")
        est = estado.de("meme1")
        assert est.entrada == Decimal("0.00042") and est.entrada_origen == "mercado"
        assert est.direccion == DIR and est.ultima_liquidez == Decimal("50000")
        assert "BONK" in r.titulo

    def test_el_fin_de_semana_avisa_que_no_se_abren_posiciones(self):
        _, r = correr(f"/entrada meme1 {DIR} 0.0001", ahora=art("2026-10-10T12:00"), meme1="0.0001")
        assert any("Fin de semana" in l for l in r.lineas)

    def test_stop_de_una_meme_abre_la_pausa_y_la_siguiente_entrada_lo_recuerda(self):
        estado = EstadoPlan().con("meme1", abierta("0.0001", direccion=DIR, ultimo_precio=Decimal("0.00007")))
        estado, r = correr("/stop meme1", estado, ahora=art("2026-10-07T18:00"))
        assert estado.de("meme1").cierre_motivo == "sl"
        assert estado.pausa_hasta == art("2026-10-07T20:00")
        _, r = correr(f"/entrada meme2 {DIR2} 0.5", estado, ahora=art("2026-10-07T19:00"), meme2="0.5")
        assert any("pausa" in l for l in r.lineas)

    def test_tp_a_mano_si_el_monitor_no_lo_vio(self):
        estado = EstadoPlan().con("meme1", abierta("0.0001", direccion=DIR))
        estado, _ = correr("/tp meme1", estado)
        assert estado.de("meme1").vendido_pct == 50 and estado.de("meme1").sl_factor == 1

    def test_estado_y_ayuda(self):
        estado = EstadoPlan().con("sui", abierta("1.2", ultimo_precio=Decimal("1.25")))
        _, r = correr("/estado", estado)
        assert any("SUI · abierta · ahora 1.25 (+4.2 %)" in l for l in r.lineas)
        _, r = correr("/nada")
        assert "No conozco" in r.titulo


# --------------------------------------------------------------------------- #
# Calendario
# --------------------------------------------------------------------------- #


class TestCalendario:
    def test_suena_una_vez_y_con_el_precio_de_ahora(self):
        est = EstadoPlan().con("sui", EstadoPosicion(ultimo_precio=Decimal("1.25"), ultima_lectura_at=art("2026-10-07T15:30")))
        est, avisos = recordatorios(PLAN, est, art("2026-10-07T15:31"))
        textos = [a.titulo for a in avisos]
        assert "Abre la ventana de entrada de SUI (hasta las 21:30)." in textos
        ventana = next(a for a in avisos if "ventana de entrada" in a.titulo)
        assert any("✅ Dentro de la regla" in l for l in ventana.lineas)
        _, otra = recordatorios(PLAN, est, art("2026-10-07T15:33"))
        assert otra == []

    def test_fuera_de_la_regla_dice_que_no_se_entra(self):
        est = EstadoPlan().con("sui", EstadoPosicion(ultimo_precio=Decimal("1.40"), ultima_lectura_at=art("2026-10-07T15:30")))
        _, avisos = recordatorios(PLAN, est, art("2026-10-07T15:31"))
        ventana = next(a for a in avisos if "ventana de entrada" in a.titulo)
        assert any("no se entra" in l for l in ventana.lineas)

    def test_un_recordatorio_caducado_no_se_manda(self):
        est, avisos = recordatorios(PLAN, EstadoPlan(), art("2026-10-07T16:00"))
        assert "fed" in est.recordatorios_enviados
        assert not any("minutas" in a.titulo for a in avisos)

    def test_al_cerrar_la_ventana_sin_sui_dice_que_los_usdt_van_a_memes(self):
        est = EstadoPlan(recordatorios_enviados=("fed", "sui-abre", "memes-abre"))
        _, avisos = recordatorios(PLAN, est, art("2026-10-07T21:31"))
        assert any("pasan a las memes" in l for a in avisos for l in a.lineas)

    def test_la_salida_total_trae_el_balance(self):
        est = EstadoPlan(recordatorios_enviados=tuple(r.id for r in PLAN.recordatorios if r.id != "salida"))
        est = est.con("sui", abierta("1.2", ultimo_precio=Decimal("1.26"), maximo=Decimal("1.3"), minimo=Decimal("1.15")))
        _, avisos = recordatorios(PLAN, est, art("2026-10-13T20:01"))
        lineas = " ".join(avisos[0].lineas)
        assert "entrada 1.2" in lineas and "(+5 %)" in lineas and "Meme 1: sin entrada" in lineas

    def test_avisa_cuando_termina_la_pausa(self):
        est = EstadoPlan(pausa_hasta=art("2026-10-07T20:00"), pausa_avisada_fin=False, recordatorios_enviados=tuple(r.id for r in PLAN.recordatorios))
        est, avisos = recordatorios(PLAN, est, art("2026-10-07T20:01"))
        assert [a.tipo for a in avisos] == [Tipo.PAUSA_FIN] and est.pausa_avisada_fin


# --------------------------------------------------------------------------- #
# Fuentes
# --------------------------------------------------------------------------- #


def par(direccion, precio, liquidez, volumen="1000", simbolo="BONK", cadena="solana"):
    return {
        "chainId": cadena,
        "pairAddress": "PAR" + precio,
        "baseToken": {"address": direccion, "symbol": simbolo},
        "priceUsd": precio,
        "liquidity": {"usd": liquidez},
        "volume": {"h24": volumen},
    }


class TestFuentes:
    def test_dexscreener_precio_del_par_mas_liquido_y_liquidez_sumada(self):
        pares = [par(DIR, "0.0002", 1000), par(DIR, "0.0001", 90000), par(DIR2, "5", 1)]
        l = agregar(DIR, "solana", pares)
        assert l.precio == Decimal("0.0001") and l.liquidez == Decimal("91000") and l.volumen == Decimal("2000")

    def test_dexscreener_ignora_otras_cadenas(self):
        assert isinstance(agregar(DIR, "solana", [par(DIR, "1", 5, cadena="base")]), ProviderError)

    @responses.activate
    def test_dexscreener_v1_vacio_prueba_el_endpoint_historico(self):
        responses.get(DEXSCREENER_V1.format(cadena="solana", direcciones=DIR), json=[])
        responses.get(DEXSCREENER_LEGACY.format(direcciones=DIR), json={"pairs": [par(DIR, "0.5", 100)]})
        r = Fuentes({}).dexscreener("solana", [DIR])
        assert r[DIR].precio == Decimal("0.5")

    @responses.activate
    def test_binance_bloqueado_cae_al_respaldo_con_precision_completa(self):
        responses.get("https://data-api.binance.vision/api/v3/ticker/price", status=451, body="restricted")
        responses.get(
            "https://api.coingecko.com/api/v3/simple/price",
            json={"sui": {"usd": 1.234567}},
            match=[responses.matchers.query_param_matcher(
                {"ids": "sui", "vs_currencies": "usd", "precision": "full"}
            )],
        )
        l = ciclo._con_respaldo(Fuentes({}), SUI)
        assert l.precio == Decimal("1.234567") and l.fuente == "coingecko"

    @responses.activate
    def test_binance_directo(self):
        responses.get("https://data-api.binance.vision/api/v3/ticker/price", json={"symbol": "SUIUSDT", "price": "1.21340000"})
        assert ciclo._con_respaldo(Fuentes({}), SUI).precio == Decimal("1.2134")


# --------------------------------------------------------------------------- #
# Telegram y ciclo
# --------------------------------------------------------------------------- #


class TestTelegram:
    @responses.activate
    def test_solo_acepta_comandos_del_chat_configurado(self):
        responses.get(
            "https://api.telegram.org/botTOKEN/getUpdates",
            json={"ok": True, "result": [
                {"update_id": 10, "message": {"chat": {"id": 123}, "text": "/estado"}},
                {"update_id": 11, "message": {"chat": {"id": 999}, "text": "/entrada sui 0.01"}},
            ]},
        )
        offset, textos = TelegramNotifier("TOKEN", "123").leer_mensajes(None)
        assert offset == 12 and textos == ["/estado"]


class LectorFalso:
    def __init__(self, *textos):
        self.textos = list(textos)

    def leer_mensajes(self, offset):
        textos, self.textos = self.textos, []
        return (offset or 0) + len(textos), textos


class FuentesFalsas:
    def __init__(self, sui="1.2", memes=None):
        self.sui = sui
        self.memes = memes or {}
        self.consultas = 0

    def por_fuente(self, fuente, simbolo):
        self.consultas += 1
        return Lectura(precio=Decimal(self.sui), fuente=fuente)

    def dexscreener(self, cadena, direcciones):
        return {
            d: Lectura(precio=Decimal(self.memes[d]), fuente="dexscreener", liquidez=Decimal("1000"))
            if d in self.memes
            else ProviderError("sin pares")
            for d in direcciones
        }


class TestCiclo:
    """Con los recordatorios ya enviados, para mirar solo lo que se prueba."""
    def test_registrar_y_que_la_ronda_siguiente_vigile(self):
        fuentes = FuentesFalsas(sui="1.2")
        s = ciclo.ejecutar(PLAN, SIN_RECORDATORIOS, MIERCOLES_1600, fuentes, LectorFalso("/entrada sui 1.2"))
        assert s.estado.de("sui").entrada == Decimal("1.2") and s.comandos == 1
        assert [a.tipo for a in s.avisos] == [Tipo.RESPUESTA]

        fuentes.sui = "1.31"
        s = ciclo.ejecutar(PLAN, s.estado, MIERCOLES_1600 + timedelta(minutes=2), fuentes, LectorFalso())
        assert [a.tipo for a in s.avisos] == [Tipo.ALERTA_SUPERIOR]
        assert s.filas[0][1:4] == ("sui", "binance", "1.31")

    def test_una_errata_al_registrar_no_dispara_un_sl_en_la_misma_ronda(self):
        s = ciclo.ejecutar(PLAN, SIN_RECORDATORIOS, MIERCOLES_1600, FuentesFalsas(sui="1.2"), LectorFalso("/entrada sui 12"))
        assert [a.tipo for a in s.avisos] == [Tipo.RESPUESTA] and not s.estado.de("sui").cerrada

    def test_lo_urgente_va_primero(self):
        estado = SIN_RECORDATORIOS.con("meme1", abierta("1", direccion=DIR, ultima_liquidez=Decimal("1000")))
        fuentes = FuentesFalsas(memes={DIR: "0.5"})
        s = ciclo.ejecutar(PLAN, estado, MIERCOLES_1600, fuentes, LectorFalso("/estado"))
        assert [a.tipo for a in s.avisos][:2] == [Tipo.SL, Tipo.RESPUESTA]

    def test_tres_lecturas_fallidas_de_una_posicion_abierta_avisan_una_vez(self):
        estado = SIN_RECORDATORIOS.con("meme1", abierta("1", direccion=DIR))
        tipos = []
        for i in range(5):
            s = ciclo.ejecutar(PLAN, estado, MIERCOLES_1600 + timedelta(minutes=2 * i), FuentesFalsas(), None)
            estado = s.estado
            tipos += [a.tipo for a in s.avisos]
        assert tipos == [Tipo.SIN_DATOS]

    def test_si_no_se_pueden_leer_los_comandos_avisa_una_vez_por_episodio(self):
        class Roto:
            def leer_mensajes(self, offset):
                raise RuntimeError("getUpdates respondió 409")

        estado, tipos = SIN_RECORDATORIOS, []
        for lector in (Roto(), Roto(), LectorFalso(), Roto()):
            s = ciclo.ejecutar(PLAN, estado, MIERCOLES_1600, FuentesFalsas(), lector)
            estado = s.estado
            tipos.append([a.tipo for a in s.avisos])
        assert tipos == [[Tipo.SIN_DATOS], [], [], [Tipo.SIN_DATOS]]

    def test_con_el_plan_terminado_no_consulta_nada(self):
        fuentes = FuentesFalsas()
        s = ciclo.ejecutar(PLAN, SIN_RECORDATORIOS, art("2026-10-14T10:00"), fuentes, LectorFalso("/estado"))
        assert s.terminado and fuentes.consultas == 0

    def test_el_mensaje_escapa_lo_que_viene_de_fuera(self):
        texto = ciclo.redactar(PLAN, [comandos._respuesta("<b>x</b>", ("a & b",))], MIERCOLES_1600)
        assert "&lt;b&gt;x&lt;/b&gt;" in texto and "a &amp; b" in texto

    def test_historial_en_modo_anadir(self, tmp_path):
        s = ciclo.ejecutar(PLAN, SIN_RECORDATORIOS, MIERCOLES_1600, FuentesFalsas(), None)
        ciclo.guardar_historial(tmp_path, s.filas, MIERCOLES_1600)
        ciclo.guardar_historial(tmp_path, s.filas, MIERCOLES_1600)
        lineas = (tmp_path / "plan-2026.csv").read_text().splitlines()
        assert lineas[0].startswith("timestamp,posicion") and len(lineas) == 3


class TestEstado:
    def test_ida_y_vuelta(self, tmp_path):
        estado = EstadoPlan(telegram_offset=7, recordatorios_enviados=("fed",), pausa_hasta=MIERCOLES_1600)
        estado = estado.con("meme1", abierta("0.0001", direccion=DIR, disparados=("tp",), sl_factor=Decimal(1), vendido_pct=Decimal(50)))
        guardar(tmp_path / "plan.json", estado, MIERCOLES_1600)
        assert cargar(tmp_path / "plan.json") == estado

    def test_el_balance_sin_entradas_no_falla(self):
        assert balance(PLAN, EstadoPlan())[0] == "• SUI: sin entrada"
