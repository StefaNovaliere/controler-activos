"""El plan de salida: «vendo un cuarto a 2x, otro cuarto a 3x».

Módulo PURO, como `engine.py` y `trailing.py`: sin red, sin reloj, sin disco.

Es la tercera pregunta distinta sobre el mismo precio, y la más útil de las tres
para no regalar una subida:

    engine.py   →  ¿llegó a este precio?        (un nivel que decidiste)
    trailing.py →  ¿se dio la vuelta?           (relativo a su extremo)
    salidas.py  →  ¿toca vender un tramo?       (un plan hecho en frío)

Por qué existe aparte de `upper`: un umbral fijo es un nivel y un plan son
varios, cada uno de un solo uso. Cuando vendes el tramo de 2x, ese aviso no debe
volver a sonar aunque el precio baje y vuelva a subir — ya no tienes esa parte.
`upper` no sabe expresar eso, y meterlo dentro habría complicado una máquina de
estados que lleva 211 tests en verde.

El bot NO ejecuta nada: no toca tu dinero ni tiene por qué poder hacerlo. Avisa.
El valor del plan está en haberlo decidido cuando estabas tranquilo; el aviso
solo te devuelve esa decisión en el momento en el que peor decides.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from .config import ExitSpec, ResolvedAsset
from .models import AssetState, Event, EventKind, Quote


def check(
    cfg: ResolvedAsset,
    state: AssetState,
    quote: Quote,
    now: datetime,
) -> tuple[AssetState, Event | None]:
    """Decide si el precio ha alcanzado tramos nuevos del plan.

    Sin cooldown a propósito, y es la diferencia importante con los otros dos
    mecanismos: alcanzar un objetivo de venta es un suceso único y accionable,
    no una condición que se repite. Silenciarlo tres horas puede costarte
    exactamente el tramo que habías planificado vender.
    """
    if not cfg.exits:
        return _limpiar(state), None

    huella = cfg.exits_fingerprint()
    precio = quote.price

    # Plan nuevo o cambiado: se siembra con lo que YA está alcanzado, sin avisar.
    # Si no, editar el plan dispararía de golpe todos los tramos por debajo del
    # precio actual, que es justo lo que no quieres al reorganizarlo.
    if state.exits_fingerprint != huella:
        alcanzados = [e.price for e in cfg.exits if e.price <= precio]
        return (
            state.with_(
                highest_exit=max(alcanzados) if alcanzados else None,
                exits_fingerprint=huella,
            ),
            None,
        )

    techo = state.highest_exit
    nuevos = [e for e in cfg.exits if e.price <= precio and (techo is None or e.price > techo)]
    if not nuevos:
        return state.with_(exits_fingerprint=huella), None

    # Entre dos consultas el precio puede saltarse varios tramos. Salen todos en
    # un aviso, no uno por tramo: son la misma noticia.
    base = state.with_(highest_exit=max(e.price for e in nuevos), exits_fingerprint=huella)
    return base, _evento(cfg, nuevos, precio)


def _evento(cfg: ResolvedAsset, alcanzados: list[ExitSpec], precio: Decimal) -> Event:
    objetivo = max(alcanzados, key=lambda e: e.price)
    return Event(
        asset_id=cfg.id,
        label=cfg.label,
        kind=EventKind.EXIT_TARGET,
        price=precio,
        currency=cfg.currency,
        threshold=objetivo.price,
        detail=_detalle(alcanzados, cfg.entry_price),
    )


def _detalle(alcanzados: list[ExitSpec], entrada: Decimal | None) -> str:
    """Qué dice el aviso además del precio: qué parte tocaba vender y por qué."""
    partes: list[str] = []

    vendible = sum((e.sell_pct or Decimal(0)) for e in alcanzados)
    if vendible > 0:
        plural = "los tramos" if len(alcanzados) > 1 else "el tramo"
        partes.append(f"tu plan vende {_pct(vendible)} % aquí ({plural})")

    notas = [e.note for e in alcanzados if e.note]
    partes.extend(notas)

    if entrada is not None and entrada > 0:
        objetivo = max(e.price for e in alcanzados)
        partes.append(f"{_pct(objetivo / entrada)}x sobre tu entrada")

    return " · ".join(partes)


def _pct(valor: Decimal) -> str:
    """Sin decimales cuando son redondos: «2x», no «2.00x».

    Con `format(..., "f")` y no con `str()`: `Decimal("50").normalize()` es
    `5E+1`, y `str()` lo propagaba tal cual al mensaje de Telegram — «tu plan
    vende 5E+1 % aquí». Un mensaje cuyo trabajo es que decidas rápido no puede
    estar escrito en notación científica.
    """
    normalizado = valor.normalize()
    entero = normalizado.to_integral_value()
    if normalizado == entero:
        return format(entero, "f")
    return f"{normalizado:.2f}".rstrip("0").rstrip(".")


def _limpiar(state: AssetState) -> AssetState:
    """Sin plan configurado, lo guardado sobra."""
    if state.highest_exit is None and state.exits_fingerprint is None:
        return state
    return state.with_(highest_exit=None, exits_fingerprint=None)
