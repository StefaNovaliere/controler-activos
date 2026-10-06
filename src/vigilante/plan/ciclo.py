"""Un ciclo del plan: comandos → lecturas → bandas → calendario → historial → mensaje.

Lo que tiene red (Telegram, fuentes) entra por parámetro, así que el ciclo
entero se prueba sin red ni reloj.
"""

from __future__ import annotations

import csv
import html
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Protocol

from ..errors import ProviderError
from . import comandos as cmds
from .calendario import recordatorios
from .config import PlanSpec, PosicionSpec
from .estado import EstadoPlan
from .fuentes import Fuentes
from .motor import ICONOS, URGENTES, Aviso, Lectura, Tipo, dia_hora_txt, evaluar, fase, registrar_fallo

COLUMNAS = ("timestamp", "posicion", "fuente", "precio", "liquidez_usd", "volumen_h24", "fase", "direccion")


class LectorDeMensajes(Protocol):
    def leer_mensajes(self, offset: int | None) -> tuple[int | None, list[str]]: ...


@dataclass
class Salida:
    estado: EstadoPlan
    avisos: list[Aviso] = field(default_factory=list)
    filas: list[tuple[str, ...]] = field(default_factory=list)
    lecturas: dict[str, Lectura | str] = field(default_factory=dict)
    comandos: int = 0
    terminado: bool = False

    @property
    def hay_cambios(self) -> bool:
        """Algo que conviene persistir YA, sin esperar a la próxima ronda."""
        return bool(self.avisos or self.comandos)


def ejecutar(
    plan: PlanSpec,
    estado: EstadoPlan,
    ahora: datetime,
    fuentes: Fuentes,
    lector: LectorDeMensajes | None,
) -> Salida:
    if ahora >= plan.bucle.hasta:
        # Plan terminado: ni una consulta más. Sin esto, cada ejecución del
        # vigilante permanente seguiría pagando lecturas de un plan muerto.
        return Salida(estado, terminado=True)

    # 1 · Comandos. Se leen primero para consultar en la misma ronda las
    #     direcciones nuevas que traigan.
    textos: list[str] = []
    errores_lectura: list[Aviso] = []
    if lector is not None:
        try:
            offset, textos = lector.leer_mensajes(estado.telegram_offset)
            estado = estado.with_(telegram_offset=offset, avisado_comandos=False)
        except Exception as exc:  # noqa: BLE001 — sin comandos se sigue vigilando
            if not estado.avisado_comandos:
                estado = estado.with_(avisado_comandos=True)
                errores_lectura.append(
                    Aviso(
                        Tipo.SIN_DATOS,
                        "No puedo leer tus comandos de Telegram",
                        (str(exc)[:200], "Los avisos siguen llegando, pero /entrada no se registra hasta que se arregle."),
                    )
                )
    pedidos = [c for c in (cmds.parsear(t) for t in textos) if c is not None]

    # 2 · Lecturas: una consulta por fuente, no una por posición.
    direcciones = [estado.de(p.id).direccion for p in plan.posiciones if p.fuente == "dexscreener"]
    direcciones = [d for d in direcciones if d] + cmds.direcciones_en(pedidos)
    dex = fuentes.dexscreener("solana", direcciones) if direcciones else {}
    por_simbolo: dict[str, Lectura | str] = {}

    def consultar(spec: PosicionSpec, direccion: str | None) -> Lectura | str:
        if spec.fuente == "dexscreener":
            if not direccion:
                return "sin dirección registrada"
            r = dex.get(direccion)
            if r is None:  # dirección que no estaba en el lote (no debería pasar)
                r = fuentes.dexscreener(spec.cadena, [direccion]).get(direccion)
            return r if isinstance(r, Lectura) else str(r)
        if spec.id not in por_simbolo:
            por_simbolo[spec.id] = _con_respaldo(fuentes, spec)
        return por_simbolo[spec.id]

    # 3 · Aplicar los comandos, en orden.
    respuestas: list[Aviso] = []
    registradas: set[str] = set()
    for pedido in pedidos:
        estado, respuesta = cmds.aplicar(plan, estado, pedido, consultar, ahora)
        respuestas.append(respuesta)
        if pedido.nombre == "entrada" and pedido.args:
            registradas.add(pedido.args[0].lower())

    # 4 · Bandas.
    avisos: list[Aviso] = []
    lecturas: dict[str, Lectura | str] = {}
    filas: list[tuple[str, ...]] = []
    for spec in plan.posiciones:
        est = estado.de(spec.id)
        if spec.fuente == "dexscreener" and not est.direccion:
            continue
        lectura = consultar(spec, est.direccion)
        lecturas[spec.id] = lectura
        if isinstance(lectura, str):
            est, aviso = registrar_fallo(plan, spec, est, lectura)
            if aviso:
                avisos.append(aviso)
            estado = estado.con(spec.id, est)
            continue
        if spec.id in registradas:
            # Recién registrada en esta misma ronda: se evalúa en la próxima.
            # Si el precio tecleado tuviera una errata, evaluarla ya dispararía
            # un SL falso antes de que llegue la respuesta que lo advierte.
            filas.append(_fila(ahora, spec, est.with_(ultimo_precio=lectura.precio), lectura))
            continue
        resultado = evaluar(plan, spec, est, lectura, ahora)
        estado = estado.con(spec.id, resultado.estado)
        avisos.extend(resultado.avisos)
        if resultado.abre_pausa and plan.pausa_tras_stop_minutos:
            estado = estado.with_(
                pausa_hasta=ahora + timedelta(minutes=plan.pausa_tras_stop_minutos), pausa_avisada_fin=False
            )
        filas.append(_fila(ahora, spec, resultado.estado, lectura))

    # 5 · Calendario (después de leer: los recordatorios citan el precio de ahora).
    estado, del_calendario = recordatorios(plan, estado, ahora)

    urgentes = [a for a in avisos if a.tipo in URGENTES]
    resto = [a for a in avisos if a.tipo not in URGENTES]
    return Salida(
        estado=estado,
        avisos=urgentes + respuestas + resto + del_calendario + errores_lectura,
        filas=filas,
        lecturas=lecturas,
        comandos=len(pedidos),
    )


def _con_respaldo(fuentes: Fuentes, spec: PosicionSpec) -> Lectura | str:
    try:
        return fuentes.por_fuente(spec.fuente, spec.simbolo or "")
    except (ProviderError, ValueError) as primero:
        if spec.respaldo is None:
            return str(primero)
        try:
            return fuentes.por_fuente(spec.respaldo.fuente, spec.respaldo.simbolo)
        except (ProviderError, ValueError) as segundo:
            return f"{primero} · respaldo: {segundo}"


def _fila(ahora: datetime, spec: PosicionSpec, est, lectura: Lectura) -> tuple[str, ...]:
    def d(v: Decimal | None) -> str:
        return "" if v is None else format(v.normalize(), "f")

    return (
        ahora.replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        spec.id,
        lectura.fuente,
        d(lectura.precio),
        d(lectura.liquidez),
        d(lectura.volumen),
        fase(spec, est),
        est.direccion or "",
    )


def guardar_historial(directorio: str | Path, filas: list[tuple[str, ...]], ahora: datetime) -> Path | None:
    """`history/plan-AAAA.csv`, en modo añadir, como el historial de precios."""
    if not filas:
        return None
    path = Path(directorio) / f"plan-{ahora.year}.csv"
    path.parent.mkdir(parents=True, exist_ok=True)
    nuevo = not path.exists() or path.stat().st_size == 0
    with path.open("a", encoding="utf-8", newline="") as fh:
        escritor = csv.writer(fh)
        if nuevo:
            escritor.writerow(COLUMNAS)
        escritor.writerows(filas)
    return path


def redactar(plan: PlanSpec, avisos: list[Aviso], ahora: datetime) -> str | None:
    """Un solo mensaje por ciclo, con lo urgente arriba."""
    if not avisos:
        return None
    bloques = [f"<b>{html.escape(plan.nombre)}</b> · {dia_hora_txt(ahora)} (hora ARG)"]
    for a in avisos:
        lineas = [f"{ICONOS[a.tipo]} <b>{html.escape(a.titulo)}</b>"]
        lineas += [f"    {html.escape(l)}" for l in a.lineas]
        bloques.append("\n".join(lineas))
    return "\n\n".join(bloques)


def informe(plan: PlanSpec, salida: Salida, ahora: datetime) -> str:
    """Tabla para la consola y el resumen del workflow."""
    lineas = [f"### {plan.nombre} · {dia_hora_txt(ahora)} (ARG)", ""]
    if salida.terminado:
        return "\n".join(lineas + ["Plan terminado: no se consulta nada."])
    lineas += ["| Posición | Fase | Fuente | Precio | Liquidez | Volumen 24 h |", "|---|---|---|---|---|---|"]
    for spec in plan.posiciones:
        est = salida.estado.de(spec.id)
        lectura = salida.lecturas.get(spec.id)
        if isinstance(lectura, Lectura):
            lineas.append(
                f"| {spec.id} | {fase(spec, est)} | {lectura.fuente} | {lectura.precio} | "
                f"{lectura.liquidez if lectura.liquidez is not None else '—'} | "
                f"{lectura.volumen if lectura.volumen is not None else '—'} |"
            )
        elif isinstance(lectura, str):
            lineas.append(f"| {spec.id} | {fase(spec, est)} | ✗ | {lectura[:120]} | | |")
        else:
            lineas.append(f"| {spec.id} | {fase(spec, est)} | — | sin consultar | | |")
    lineas += ["", f"Comandos: {salida.comandos} · avisos: {len(salida.avisos)}"]
    return "\n".join(lineas)
