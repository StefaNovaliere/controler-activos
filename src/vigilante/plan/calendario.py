"""Recordatorios con fecha y el balance final. Módulo PURO.

Un recordatorio suena una vez, en la primera lectura a partir de su hora, y
solo hasta que caduca: «no operes de 14:30 a 15:30» llegando a las 16:00, porque
el workflow se retrasó, confunde más de lo que ayuda. Si caducó, se marca como
enviado sin mandarlo.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from decimal import Decimal

from .config import PlanSpec, Recordatorio
from .estado import EstadoPlan, EstadoPosicion
from .motor import Aviso, Tipo, dia_hora_txt, fase, nombre, pct_txt, precio_txt

#: Un precio más viejo que esto no se ofrece como "el de ahora".
FRESCURA = timedelta(minutes=15)


def recordatorios(plan: PlanSpec, estado: EstadoPlan, ahora: datetime) -> tuple[EstadoPlan, list[Aviso]]:
    avisos: list[Aviso] = []
    enviados = list(estado.recordatorios_enviados)
    for r in sorted(plan.recordatorios, key=lambda r: r.cuando):
        if r.id in enviados or ahora < r.cuando:
            continue
        enviados.append(r.id)
        if ahora > r.caduca:
            continue
        avisos.append(Aviso(Tipo.RECORDATORIO, r.texto, tuple(_extra(plan, estado, r, ahora))))
    estado = estado.with_(recordatorios_enviados=tuple(enviados))

    if estado.pausa_hasta and not estado.pausa_avisada_fin and ahora >= estado.pausa_hasta:
        estado = estado.with_(pausa_avisada_fin=True)
        lineas = ["Si el plan lo permite (el fin de semana no se abren posiciones), podés volver a entrar."]
        avisos.append(Aviso(Tipo.PAUSA_FIN, "Terminó la pausa tras el stop", tuple(lineas)))
    return estado, avisos


def _extra(plan: PlanSpec, estado: EstadoPlan, r: Recordatorio, ahora: datetime) -> list[str]:
    if r.extra == "ventana_entrada":
        return _ventana(plan, estado, r.posicion, ahora)
    if r.extra == "cierre_ventana":
        spec = plan.posicion(r.posicion)
        est = estado.de(r.posicion)
        if est.entrada is None:
            return [f"No hay entrada de {spec.etiqueta} registrada: según el plan, esos USDT pasan a las memes."]
        return [f"{spec.etiqueta} registrada a {precio_txt(est.entrada)}."]
    if r.extra == "abiertas":
        return _abiertas(plan, estado, solo_memes=False)
    if r.extra == "memes_abiertas":
        return _abiertas(plan, estado, solo_memes=True)
    if r.extra == "balance":
        return balance(plan, estado)
    return []


def _ventana(plan: PlanSpec, estado: EstadoPlan, posicion: str, ahora: datetime) -> list[str]:
    spec = plan.posicion(posicion)
    est = estado.de(posicion)
    regla = spec.entrada
    if est.ultimo_precio is None or est.ultima_lectura_at is None or ahora - est.ultima_lectura_at > FRESCURA:
        return [f"No tengo un precio reciente de {spec.etiqueta}: miralo en Binance antes de entrar."]
    p = est.ultimo_precio
    linea = f"{spec.etiqueta} ahora: {precio_txt(p)}"
    if regla is None or (regla.precio_min is None and regla.precio_max is None):
        return [linea]
    rango = f"{precio_txt(regla.precio_min)} – {precio_txt(regla.precio_max)}"
    dentro = (regla.precio_min is None or p >= regla.precio_min) and (regla.precio_max is None or p <= regla.precio_max)
    if dentro:
        return [linea, f"✅ Dentro de la regla ({rango}): se puede entrar."]
    return [linea, f"⛔ Fuera de la regla ({rango}): no se entra. Esos USDT pasan a las memes."]


def _abiertas(plan: PlanSpec, estado: EstadoPlan, *, solo_memes: bool) -> list[str]:
    lineas = []
    for spec in plan.posiciones:
        if solo_memes and spec.fuente != "dexscreener":
            continue
        est = estado.de(spec.id)
        if not est.abierta:
            continue
        lineas.append(f"• {nombre(spec, est)} · {fase(spec, est)}{_rendimiento(est)}")
    return lineas or ["No hay posiciones abiertas registradas."]


def _rendimiento(est: EstadoPosicion) -> str:
    if est.entrada is None or est.ultimo_precio is None:
        return ""
    return f" · ahora {precio_txt(est.ultimo_precio)} ({pct_txt(est.ultimo_precio / est.entrada)})"


def balance(plan: PlanSpec, estado: EstadoPlan) -> list[str]:
    """Por posición, en porcentaje. Sin montos: se multiplican aparte.

    Junto al resultado van el máximo y el mínimo desde la entrada: «cerró en
    −7 % después de haber estado en +12 %» dice algo del plan de salida que el
    −7 % solo no dice.
    """
    lineas: list[str] = []
    for spec in plan.posiciones:
        est = estado.de(spec.id)
        if est.entrada is None:
            lineas.append(f"• {spec.etiqueta}: sin entrada")
            continue
        final = est.precio_cierre if est.cerrada and est.precio_cierre is not None else est.ultimo_precio
        partes = [f"• {nombre(spec, est)} · {fase(spec, est)}", f"entrada {precio_txt(est.entrada)}"]
        if final is not None:
            etiqueta = "cierre" if est.cerrada else "ahora"
            partes.append(f"{etiqueta} {precio_txt(final)} ({pct_txt(final / est.entrada)})")
        if est.maximo is not None and est.minimo is not None:
            partes.append(f"máx {pct_txt(est.maximo / est.entrada)} · mín {pct_txt(est.minimo / est.entrada)}")
        combinado = resultado_pct(est, plan.bandas_de(spec).tp.factor if plan.bandas_de(spec).tp else None)
        if est.vendido_pct and 0 < est.vendido_pct < 100 and combinado is not None:
            partes.append(
                f"total ≈ {pct_txt(1 + combinado / 100)} (el {est.vendido_pct.normalize():f} % vendido en el TP)"
            )
        if est.entrada_at:
            partes.append(f"desde {dia_hora_txt(est.entrada_at)}")
        lineas.append(" · ".join(partes))
    return lineas


def resultado_pct(est: EstadoPosicion, tp_factor: Decimal | None = None) -> Decimal | None:
    """Resultado de la posición entera, contando la parte vendida en el TP.

    Una meme que vendió el 50 % al +100 % y cerró el resto en break-even dio
    +50 %, no 0 %. Supone que el TP se llenó a su precio, que es lo que hace
    Photon salvo deslizamiento.
    """
    final = est.precio_cierre if est.cerrada and est.precio_cierre is not None else est.ultimo_precio
    if est.entrada is None or final is None:
        return None
    resto = final / est.entrada
    vendido = est.vendido_pct / 100 if tp_factor is not None and est.vendido_pct < 100 else Decimal(0)
    return (vendido * tp_factor + (1 - vendido) * resto - 1) * 100 if vendido else (resto - 1) * 100
