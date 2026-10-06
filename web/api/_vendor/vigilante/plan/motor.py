"""Bandas relativas a la entrada. Módulo PURO: sin red, sin reloj, sin disco.

Una posición pasa por estas fases, y la fase decide qué niveles valen:

    sin entrada ──/entrada──▶ abierta ──TP parcial──▶ moonbag (SL en break-even)
                                 │  └──alerta con sl_pasa_a──▶ SL en break-even
                                 └──TP total / SL──▶ cerrada

El monitor NO ejecuta: la OCO de Binance y Photon lo hacen. Pero el plan dice
qué hicieron (vender el 50 % al +100 %), así que el monitor asume que pasó y
mueve sus bandas igual que se movieron las órdenes reales. Si no pasó —la orden
no se llenó, Photon falló—, el aviso lo dice y se corrige por Telegram.

Cada nivel suena una vez por posición. Con lecturas cada dos minutos, un nivel
que sonara cada vez que el precio lo roza serían treinta mensajes en una hora
lateral, y el que importa quedaría enterrado entre ellos.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal
from enum import StrEnum

from .config import ART, Bandas, PlanSpec, PosicionSpec
from .estado import EstadoPlan, EstadoPosicion


class Tipo(StrEnum):
    ALERTA_SUPERIOR = "alerta_superior"
    TP = "tp"
    ALERTA_INFERIOR = "alerta_inferior"
    SL = "sl"
    SL_SIN_LLENAR = "sl_sin_llenar"
    LIQUIDEZ = "liquidez"
    SIN_DATOS = "sin_datos"
    DATOS_OK = "datos_ok"
    RECORDATORIO = "recordatorio"
    PAUSA_FIN = "pausa_fin"
    RESPUESTA = "respuesta"


#: Los que interrumpen: van primero en el mensaje.
URGENTES = frozenset({Tipo.SL, Tipo.SL_SIN_LLENAR, Tipo.LIQUIDEZ, Tipo.TP})

ICONOS = {
    Tipo.ALERTA_SUPERIOR: "📈",
    Tipo.TP: "🎯",
    Tipo.ALERTA_INFERIOR: "⚠️",
    Tipo.SL: "🛑",
    Tipo.SL_SIN_LLENAR: "🚨",
    Tipo.LIQUIDEZ: "🚨",
    Tipo.SIN_DATOS: "📡",
    Tipo.DATOS_OK: "📡",
    Tipo.RECORDATORIO: "⏰",
    Tipo.PAUSA_FIN: "⏰",
    Tipo.RESPUESTA: "💬",
}


@dataclass(frozen=True)
class Lectura:
    """Una consulta de precio para una posición."""

    precio: Decimal
    fuente: str
    liquidez: Decimal | None = None
    volumen: Decimal | None = None
    simbolo_token: str | None = None


@dataclass(frozen=True)
class Aviso:
    tipo: Tipo
    titulo: str
    lineas: tuple[str, ...] = ()
    posicion: str | None = None


# --------------------------------------------------------------------------- #
# Formato compartido
# --------------------------------------------------------------------------- #


def precio_txt(valor: Decimal | None) -> str:
    """Cinco cifras significativas, sin notación científica.

    Lo justo para copiar el nivel a la OCO (SUI se negocia a 0,0001) sin
    arrastrar los doce decimales de multiplicar por 1,09, y lo mismo vale para
    una meme a 0,00001234.
    """
    if valor is None:
        return "—"
    if valor == 0:
        return "0"
    paso = Decimal(1).scaleb(valor.adjusted() - 4)
    return format(valor.quantize(paso).normalize(), "f")


def pct_txt(ratio: Decimal) -> str:
    """El múltiplo como porcentaje con signo: 1,09 → «+9 %»."""
    pct = (ratio - 1) * 100
    texto = f"{pct:+.1f}".replace(".0", "") if pct == pct.to_integral_value() else f"{pct:+.1f}"
    return texto.replace("-", "−") + " %"


def hora_txt(cuando: datetime) -> str:
    return cuando.astimezone(ART).strftime("%H:%M")


def dia_hora_txt(cuando: datetime) -> str:
    return cuando.astimezone(ART).strftime("%d/%m %H:%M")


def nombre(spec: PosicionSpec, est: EstadoPosicion) -> str:
    return f"{spec.etiqueta} ({est.simbolo_token})" if est.simbolo_token else spec.etiqueta


def fase(spec: PosicionSpec, est: EstadoPosicion) -> str:
    if est.entrada is None:
        return "sin entrada"
    if est.cerrada:
        return f"cerrada ({est.cierre_motivo})"
    if 0 < est.vendido_pct < 100:
        return "moonbag"
    if est.sl_factor is not None:
        return "SL en break-even" if est.sl_factor == 1 else f"SL en {pct_txt(est.sl_factor)}"
    return "abierta"


def niveles(plan: PlanSpec, spec: PosicionSpec, est: EstadoPosicion) -> list[str]:
    """Los niveles vigentes en precio absoluto: lo que hay que cargar en la OCO."""
    if est.entrada is None:
        return []
    b = plan.bandas_de(spec)
    e = est.entrada
    lineas: list[str] = []

    def pone(etiqueta: str, factor: Decimal, extra: str = "") -> None:
        lineas.append(f"{etiqueta} ({pct_txt(factor)}): {precio_txt(e * factor)}{extra}")

    if b.tp and "tp" not in est.disparados:
        pone("TP", b.tp.factor)
    if b.alerta_superior and "alerta_superior" not in est.disparados:
        pone("Alerta ↑", b.alerta_superior.factor)
    if b.alerta_inferior and "alerta_inferior" not in est.disparados and est.sl_factor is None:
        pone("Alerta ↓", b.alerta_inferior.factor)
    if est.sl_factor is not None:
        pone("SL", est.sl_factor, " · break-even" if est.sl_factor == 1 else "")
    elif b.sl:
        limite = f" · límite {precio_txt(e * b.sl.limite)}" if b.sl.limite else ""
        pone("SL", b.sl.factor, limite)
    return lineas


# --------------------------------------------------------------------------- #
# Evaluación de una lectura
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class Resultado:
    estado: EstadoPosicion
    avisos: tuple[Aviso, ...] = ()
    #: Hubo un stop en una posición que abre la pausa de reentrada.
    abre_pausa: bool = False


def evaluar(plan: PlanSpec, spec: PosicionSpec, est: EstadoPosicion, lectura: Lectura, ahora: datetime) -> Resultado:
    avisos: list[Aviso] = []
    liquidez_previa = est.ultima_liquidez

    if est.avisado_fallo:
        avisos.append(Aviso(Tipo.DATOS_OK, f"{nombre(spec, est)}: vuelven a llegar precios", posicion=spec.id))
    est = est.with_(
        ultimo_precio=lectura.precio,
        ultima_lectura_at=ahora,
        ultima_fuente=lectura.fuente,
        ultima_liquidez=lectura.liquidez if lectura.liquidez is not None else est.ultima_liquidez,
        ultimo_volumen=lectura.volumen if lectura.volumen is not None else est.ultimo_volumen,
        simbolo_token=lectura.simbolo_token or est.simbolo_token,
        fallos=0,
        ultimo_error=None,
        avisado_fallo=False,
    )

    if est.entrada is None:
        return Resultado(est, tuple(avisos))

    bandas = plan.bandas_de(spec)
    ratio = lectura.precio / est.entrada

    if est.cerrada:
        return _tras_el_cierre(spec, bandas, est, ratio, lectura, avisos)

    est = est.with_(
        maximo=lectura.precio if est.maximo is None else max(est.maximo, lectura.precio),
        minimo=lectura.precio if est.minimo is None else min(est.minimo, lectura.precio),
    )

    aviso_liquidez = _liquidez(plan, spec, est, liquidez_previa, lectura.liquidez)
    if aviso_liquidez:
        avisos.append(aviso_liquidez)

    # Hacia arriba, en orden: entre dos lecturas el precio puede saltarse la
    # alerta y caer directo en el TP. Salen los dos, en el orden en que pasaron.
    for clave in ("alerta_superior", "tp"):
        nivel = getattr(bandas, clave)
        if nivel is None or clave in est.disparados or ratio < nivel.factor:
            continue
        est = est.with_(disparados=est.disparados + (clave,))
        if nivel.sl_pasa_a is not None:
            est = est.with_(sl_factor=nivel.sl_pasa_a)
        if nivel.vende_pct is not None:
            est = est.with_(vendido_pct=min(Decimal(100), est.vendido_pct + nivel.vende_pct))

        titulo = (
            f"{nombre(spec, est)} tocó el TP ({pct_txt(nivel.factor)})"
            if clave == "tp"
            else f"{nombre(spec, est)} {pct_txt(nivel.factor)} sobre tu entrada"
        )
        lineas = [_ahora(lectura.precio, est.entrada)]
        if nivel.accion:
            lineas.append(nivel.accion)
        if est.vendido_pct >= 100:
            est = est.with_(cerrada_at=ahora, cierre_motivo=clave, precio_cierre=lectura.precio)
        elif nivel.sl_pasa_a is not None:
            lineas.append(f"El monitor ahora vigila el SL en {precio_txt(est.entrada * nivel.sl_pasa_a)}.")
        avisos.append(Aviso(Tipo.TP if clave == "tp" else Tipo.ALERTA_SUPERIOR, titulo, tuple(lineas), spec.id))
        if est.cerrada:
            return Resultado(est, tuple(avisos))

    # Hacia abajo: el SL vigente (quizá movido a break-even) manda sobre la alerta.
    sl_factor = est.sl_factor if est.sl_factor is not None else (bandas.sl.factor if bandas.sl else None)
    if sl_factor is not None and ratio <= sl_factor:
        movido = est.sl_factor is not None
        motivo = "sl_break_even" if movido and sl_factor == 1 else "sl"
        est = est.with_(
            cerrada_at=ahora, cierre_motivo=motivo, precio_cierre=lectura.precio,
            disparados=est.disparados + ("sl",),
        )
        titulo = (
            f"{nombre(spec, est)} volvió a la entrada: SL en break-even"
            if motivo == "sl_break_even"
            else f"{nombre(spec, est)} tocó el SL ({pct_txt(sl_factor)})"
        )
        lineas = [_ahora(lectura.precio, est.entrada)]
        if bandas.sl and bandas.sl.accion:
            lineas.append(bandas.sl.accion)
        if not movido and bandas.sl and bandas.sl.limite and ratio <= bandas.sl.limite:
            est = est.with_(disparados=est.disparados + ("sl_sin_llenar",))
            lineas.append(_sin_llenar(est.entrada, bandas.sl.limite))
        if spec.pausa_tras_stop and plan.pausa_tras_stop_minutos:
            fin = ahora + timedelta(minutes=plan.pausa_tras_stop_minutos)
            lineas.append(f"Pausa: no abras otra meme hasta las {hora_txt(fin)}.")
        avisos.append(Aviso(Tipo.SL, titulo, tuple(lineas), spec.id))
        return Resultado(est, tuple(avisos), abre_pausa=spec.pausa_tras_stop)

    ai = bandas.alerta_inferior
    if ai and "alerta_inferior" not in est.disparados and ratio <= ai.factor:
        est = est.with_(disparados=est.disparados + ("alerta_inferior",))
        lineas = [_ahora(lectura.precio, est.entrada)]
        if ai.accion:
            lineas.append(ai.accion)
        if sl_factor is not None:
            lineas.append(f"El SL está en {precio_txt(est.entrada * sl_factor)}.")
        avisos.append(
            Aviso(Tipo.ALERTA_INFERIOR, f"{nombre(spec, est)} {pct_txt(ai.factor)} bajo tu entrada", tuple(lineas), spec.id)
        )

    return Resultado(est, tuple(avisos))


def _tras_el_cierre(spec, bandas: Bandas, est, ratio, lectura, avisos) -> Resultado:
    """Cerrada por SL, el precio sigue importando una vez más.

    Un stop-limit con el límite en 0,925 no vende si el precio pasa de largo por
    debajo: la orden queda colgada y la posición sigue abierta sin protección.
    Es el fallo más caro de una OCO y el más fácil de no ver.
    """
    if (
        est.cierre_motivo == "sl"
        and bandas.sl
        and bandas.sl.limite
        and "sl_sin_llenar" not in est.disparados
        and ratio <= bandas.sl.limite
    ):
        est = est.with_(disparados=est.disparados + ("sl_sin_llenar",))
        avisos.append(
            Aviso(
                Tipo.SL_SIN_LLENAR,
                f"{nombre(spec, est)} está por debajo del límite de tu stop",
                (_ahora(lectura.precio, est.entrada), _sin_llenar(est.entrada, bandas.sl.limite)),
                spec.id,
            )
        )
    return Resultado(est, tuple(avisos))


def _sin_llenar(entrada: Decimal, limite: Decimal) -> str:
    return (
        f"El límite era {precio_txt(entrada * limite)}: si la orden no se llenó, la posición "
        "sigue abierta y SIN stop. Revisá Binance ya."
    )


def _liquidez(plan: PlanSpec, spec: PosicionSpec, est: EstadoPosicion, antes, ahora_liq) -> Aviso | None:
    if not spec.vigilar_liquidez or antes is None or ahora_liq is None or antes <= 0:
        return None
    caida = (antes - ahora_liq) / antes * 100
    if caida <= plan.liquidez_caida_pct:
        return None
    return Aviso(
        Tipo.LIQUIDEZ,
        f"{nombre(spec, est)}: la liquidez cayó {caida:.0f} % entre dos lecturas",
        (
            f"De {_usd(antes)} a {_usd(ahora_liq)}. Posible rug pull: revisá el par ya.",
            "Si se confirma, vendé con Photon sin esperar al SL: sin liquidez el SL no tiene contra quién vender.",
        ),
        spec.id,
    )


def registrar_fallo(plan: PlanSpec, spec: PosicionSpec, est: EstadoPosicion, error: str) -> tuple[EstadoPosicion, Aviso | None]:
    """Una lectura fallida. Se avisa una vez, y solo si hay algo abierto que vigilar."""
    est = est.with_(fallos=est.fallos + 1, ultimo_error=error[:300])
    if est.abierta and not est.avisado_fallo and est.fallos >= plan.fallos_para_avisar:
        est = est.with_(avisado_fallo=True)
        return est, Aviso(
            Tipo.SIN_DATOS,
            f"{nombre(spec, est)}: {est.fallos} lecturas seguidas sin precio",
            (f"Último error: {est.ultimo_error}", "Tus órdenes siguen activas, pero el monitor está ciego: miralo a mano."),
            spec.id,
        )
    return est, None


def pausa_vigente(estado: EstadoPlan, ahora: datetime) -> bool:
    return estado.pausa_hasta is not None and ahora < estado.pausa_hasta


def _ahora(precio: Decimal, entrada: Decimal) -> str:
    return f"Ahora {precio_txt(precio)} ({pct_txt(precio / entrada)}) · entrada {precio_txt(entrada)}"


def _usd(valor: Decimal) -> str:
    if valor >= 1_000_000:
        return f"${valor / 1_000_000:.2f} M"
    if valor >= 1_000:
        return f"${valor / 1_000:.1f} k"
    return f"${valor:.0f}"
