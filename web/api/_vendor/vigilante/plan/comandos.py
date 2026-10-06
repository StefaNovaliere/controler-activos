"""Comandos por Telegram: registrar la entrada en el momento de comprar.

    /entrada sui 1.2345              SUI comprado a 1,2345
    /entrada meme1 <dirección> 0.00012   meme comprada a ese precio
    /entrada meme1 <dirección>       sin precio: se toma el de mercado
    /tp meme1                        Photon vendió el 50 % (si el monitor no lo vio)
    /stop meme1 [precio]             se cerró por stop (abre la pausa de 2 h)
    /cerrar sui [precio]             cerrada a mano
    /borrar meme1                    deshacer un registro equivocado
    /estado                          niveles vigentes de todo
    /ayuda

Por qué Telegram y no el panel: el momento de registrar es el de comprar, con
el teléfono en la mano y Photon abierto. Y el panel hoy no está desplegado.

El registro NUNCA se rechaza por romper una regla del plan: si compraste,
compraste, y el monitor tiene que vigilar esa posición igual. Lo que hace es
decirlo en la respuesta, con la regla que se rompió. Lo que sí se rechaza es lo
que no se puede vigilar (una dirección que no existe, un precio ilegible).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation
from typing import Callable

from .config import PlanSpec, PosicionSpec
from .estado import EstadoPlan, EstadoPosicion
from .motor import Aviso, Lectura, Tipo, dia_hora_txt, fase, hora_txt, niveles, nombre, pausa_vigente, pct_txt, precio_txt

#: Base58 de Solana: sin 0, O, I ni l. Entre 32 y 44 caracteres.
DIRECCION = re.compile(r"^[1-9A-HJ-NP-Za-km-z]{32,44}$")

AYUDA = (
    "/entrada sui 1.2345 — registra la compra de SUI",
    "/entrada meme1 <dirección> 0.00012 — registra una meme (sin precio, toma el de mercado)",
    "/tp meme1 — Photon vendió el 50 % (si el monitor no lo vio)",
    "/stop meme1 [precio] — se cerró por stop",
    "/cerrar sui [precio] — cerrada a mano",
    "/borrar meme1 — deshace un registro equivocado",
    "/estado — niveles vigentes",
)

Consulta = Callable[[PosicionSpec, str | None], "Lectura | str"]


@dataclass(frozen=True)
class Comando:
    nombre: str
    args: tuple[str, ...]


def parsear(texto: str) -> Comando | None:
    partes = texto.strip().split()
    if not partes or not partes[0].startswith("/"):
        return None
    # En grupos Telegram añade el nombre del bot: /entrada@CentinelaBot
    nombre_cmd = partes[0][1:].split("@", 1)[0].lower()
    return Comando(nombre_cmd, tuple(partes[1:])) if nombre_cmd else None


def numero(texto: str) -> Decimal | None:
    """Acepta «1.2345», «1,2345» y «$1.23». Un precio con miles no tiene sentido aquí."""
    t = texto.strip().lstrip("$").replace("_", "")
    if "," in t and "." not in t:
        t = t.replace(",", ".")
    try:
        valor = Decimal(t)
    except InvalidOperation:
        return None
    return valor if valor.is_finite() and valor > 0 else None


def direcciones_en(comandos: list[Comando]) -> list[str]:
    """Las direcciones que hay que consultar antes de aplicar los comandos."""
    return [a for c in comandos if c.nombre == "entrada" for a in c.args[1:] if DIRECCION.match(a)]


def aplicar(
    plan: PlanSpec, estado: EstadoPlan, cmd: Comando, consultar: Consulta, ahora: datetime
) -> tuple[EstadoPlan, Aviso]:
    if cmd.nombre in ("ayuda", "help", "start"):
        return estado, _respuesta("Comandos del plan", AYUDA)
    if cmd.nombre == "estado":
        return estado, _estado(plan, estado, ahora)

    acciones = {"entrada": _entrada, "tp": _tp, "stop": _cerrar, "cerrar": _cerrar, "borrar": _borrar}
    if cmd.nombre not in acciones:
        return estado, _respuesta(f"No conozco /{cmd.nombre}", AYUDA)
    if not cmd.args:
        return estado, _respuesta(f"/{cmd.nombre} necesita la posición", (_posiciones(plan),))
    spec = plan.posicion(cmd.args[0].lower())
    if spec is None:
        return estado, _respuesta(f"No conozco la posición «{cmd.args[0]}»", (_posiciones(plan),))
    return acciones[cmd.nombre](plan, estado, spec, cmd, consultar, ahora)


# --------------------------------------------------------------------------- #


def _entrada(plan, estado: EstadoPlan, spec: PosicionSpec, cmd, consultar, ahora):
    previo = estado.de(spec.id)
    direccion: str | None = None
    precio: Decimal | None = None
    for arg in cmd.args[1:]:
        if spec.fuente == "dexscreener" and DIRECCION.match(arg):
            direccion = arg
            continue
        valor = numero(arg)
        if valor is None:
            return estado, _respuesta(f"No entiendo «{arg}»", ("Formato: " + AYUDA[0 if spec.fuente != "dexscreener" else 1],))
        precio = valor

    if spec.fuente == "dexscreener":
        direccion = direccion or previo.direccion
        if not direccion:
            return estado, _respuesta(
                f"Falta la dirección del contrato de {spec.etiqueta}",
                (f"/entrada {spec.id} <dirección> [precio]",),
            )

    lectura = consultar(spec, direccion)
    if isinstance(lectura, str):
        if spec.fuente == "dexscreener":
            # Una dirección que DexScreener no conoce no se puede vigilar: mejor
            # rechazarla ahora que descubrirlo cuando la meme ya cayó un 30 %.
            return estado, _respuesta(
                f"No encuentro {spec.etiqueta} en DexScreener",
                (lectura, "Revisá que la dirección esté bien copiada y mandala de nuevo."),
            )
        if precio is None:
            return estado, _respuesta(
                f"No pude leer el precio de {spec.etiqueta} y no me diste uno",
                (lectura, f"Mandá /entrada {spec.id} <precio>."),
            )

    origen = "telegram" if precio is not None else "mercado"
    if precio is None:
        precio = lectura.precio  # type: ignore[union-attr]

    nuevo = EstadoPosicion(
        direccion=direccion,
        simbolo_token=None if isinstance(lectura, str) else lectura.simbolo_token,
        entrada=precio,
        entrada_at=ahora,
        entrada_origen=origen,
        maximo=precio,
        minimo=precio,
        ultimo_precio=None if isinstance(lectura, str) else lectura.precio,
        ultima_lectura_at=None if isinstance(lectura, str) else ahora,
        ultima_fuente=None if isinstance(lectura, str) else lectura.fuente,
        # La liquidez de ahora es la base contra la que se mide la caída.
        ultima_liquidez=None if isinstance(lectura, str) else lectura.liquidez,
        ultimo_volumen=None if isinstance(lectura, str) else lectura.volumen,
    )

    lineas = [f"Entrada {precio_txt(precio)}" + (" (precio de mercado: si en Photon fue otro, mandalo)" if origen == "mercado" else "")]
    if direccion:
        lineas.append(f"Contrato {direccion}")
    lineas += niveles(plan, spec, nuevo)
    lineas += _reglas_rotas(plan, estado, spec, precio, ahora)
    if origen == "telegram" and not isinstance(lectura, str):
        desvio = abs(precio / lectura.precio - 1) * 100
        if desvio > spec.tolerancia_tipeo_pct:
            lineas.append(
                f"❓ El mercado está en {precio_txt(lectura.precio)}: tu precio se aleja {desvio:.0f} %. "
                f"¿Error de tipeo? Si es así, mandá /entrada {spec.id} de nuevo."
            )
    if previo.abierta:
        lineas.append(f"Reemplaza la entrada anterior ({precio_txt(previo.entrada)}).")

    return estado.con(spec.id, nuevo), _respuesta(f"✅ {nombre(spec, nuevo)} registrada", lineas)


def _reglas_rotas(plan: PlanSpec, estado: EstadoPlan, spec: PosicionSpec, precio: Decimal, ahora: datetime) -> list[str]:
    """Qué regla del plan rompe esta entrada. Avisar, no impedir."""
    rotas: list[str] = []
    if ahora >= plan.fin:
        rotas.append("⛔ El plan ya terminó: todo tenía que estar en USDT.")
    for franja in plan.no_abrir:
        if franja.aplica(spec.id, ahora):
            rotas.append(f"⛔ {franja.motivo}")
    regla = spec.entrada
    if regla:
        if (regla.desde and ahora < regla.desde) or (regla.hasta and ahora > regla.hasta):
            rotas.append(
                f"⛔ Fuera de la ventana de entrada ({dia_hora_txt(regla.desde) if regla.desde else '…'}"
                f" – {dia_hora_txt(regla.hasta) if regla.hasta else '…'})."
            )
        if (regla.precio_min and precio < regla.precio_min) or (regla.precio_max and precio > regla.precio_max):
            rotas.append(
                f"⛔ {precio_txt(precio)} está fuera de la regla de entrada "
                f"({precio_txt(regla.precio_min)} – {precio_txt(regla.precio_max)}): según el plan no se entraba."
            )
    if spec.pausa_tras_stop and pausa_vigente(estado, ahora):
        rotas.append(f"⛔ Estás en la pausa tras un stop hasta las {hora_txt(estado.pausa_hasta)}.")
    if rotas:
        rotas.append("Queda registrada igual y la vigilo. Anotá por qué la abriste.")
    return rotas


def _tp(plan, estado: EstadoPlan, spec, cmd, consultar, ahora):
    est = estado.de(spec.id)
    if not est.abierta:
        return estado, _respuesta(f"{spec.etiqueta} no tiene una posición abierta", ())
    tp = plan.bandas_de(spec).tp
    if tp is None or "tp" in est.disparados:
        return estado, _respuesta(f"{spec.etiqueta} ya pasó por el TP", niveles(plan, spec, est))
    est = est.with_(disparados=est.disparados + tuple(k for k in ("alerta_superior", "tp") if k not in est.disparados))
    if tp.sl_pasa_a is not None:
        est = est.with_(sl_factor=tp.sl_pasa_a)
    est = est.with_(vendido_pct=min(Decimal(100), est.vendido_pct + (tp.vende_pct or Decimal(100))))
    if est.vendido_pct >= 100:
        est = est.with_(cerrada_at=ahora, cierre_motivo="tp", precio_cierre=est.ultimo_precio)
    return estado.con(spec.id, est), _respuesta(f"{nombre(spec, est)}: TP anotado · {fase(spec, est)}", niveles(plan, spec, est))


def _cerrar(plan, estado: EstadoPlan, spec, cmd, consultar, ahora):
    est = estado.de(spec.id)
    if not est.abierta:
        return estado, _respuesta(f"{spec.etiqueta} no tiene una posición abierta", ())
    precio = numero(cmd.args[1]) if len(cmd.args) > 1 else est.ultimo_precio
    if len(cmd.args) > 1 and precio is None:
        return estado, _respuesta(f"No entiendo «{cmd.args[1]}»", ())
    motivo = "sl" if cmd.nombre == "stop" else "manual"
    est = est.with_(cerrada_at=ahora, cierre_motivo=motivo, precio_cierre=precio)
    lineas = []
    if precio is not None and est.entrada:
        lineas.append(f"Cierre {precio_txt(precio)} ({pct_txt(precio / est.entrada)}) · entrada {precio_txt(est.entrada)}")
    if motivo == "sl" and spec.pausa_tras_stop and plan.pausa_tras_stop_minutos:
        fin = ahora + timedelta(minutes=plan.pausa_tras_stop_minutos)
        estado = estado.with_(pausa_hasta=fin, pausa_avisada_fin=False)
        lineas.append(f"Pausa: no abras otra meme hasta las {hora_txt(fin)}.")
    return estado.con(spec.id, est), _respuesta(f"{nombre(spec, est)} cerrada ({motivo})", lineas)


def _borrar(plan, estado: EstadoPlan, spec, cmd, consultar, ahora):
    previo = estado.de(spec.id)
    lineas = (f"Tenía entrada {precio_txt(previo.entrada)}.",) if previo.entrada else ()
    return estado.con(spec.id, EstadoPosicion()), _respuesta(f"{spec.etiqueta}: registro borrado", lineas)


def _estado(plan: PlanSpec, estado: EstadoPlan, ahora: datetime) -> Aviso:
    lineas: list[str] = []
    for spec in plan.posiciones:
        est = estado.de(spec.id)
        cabecera = f"• {nombre(spec, est)} · {fase(spec, est)}"
        if est.ultimo_precio is not None:
            cabecera += f" · ahora {precio_txt(est.ultimo_precio)}"
            if est.entrada:
                cabecera += f" ({pct_txt(est.ultimo_precio / est.entrada)})"
        lineas.append(cabecera)
        if est.abierta:
            lineas += [f"   {n}" for n in niveles(plan, spec, est)]
    if pausa_vigente(estado, ahora):
        lineas.append(f"Pausa de memes hasta las {hora_txt(estado.pausa_hasta)}.")
    for franja in plan.no_abrir:
        if franja.desde <= ahora < franja.hasta:
            lineas.append(f"Ahora: {franja.motivo}")
    proximo = next(
        (r for r in sorted(plan.recordatorios, key=lambda r: r.cuando) if r.cuando > ahora), None
    )
    if proximo:
        lineas.append(f"Próximo recordatorio: {dia_hora_txt(proximo.cuando)} — {proximo.texto}")
    return _respuesta(plan.nombre, lineas)


def _posiciones(plan: PlanSpec) -> str:
    return "Posiciones: " + ", ".join(p.id for p in plan.posiciones)


def _respuesta(titulo: str, lineas) -> Aviso:
    return Aviso(Tipo.RESPUESTA, titulo, tuple(lineas))
