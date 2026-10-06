"""Memoria del plan entre ejecuciones: `state/plan.json`.

Separado de `state/state.json` porque son dos cosas con vidas distintas: aquel
es la memoria del vigilante permanente, este muere el día que termina el plan.
Mezclarlos habría puesto en riesgo el estado que sí importa dentro de un mes.

Lo que se guarda son HECHOS de la operación (a cuánto se entró, qué niveles ya
avisaron, cuándo se cerró), nunca montos: el repositorio es público.
"""

from __future__ import annotations

import json
import os
import tempfile
from dataclasses import asdict, dataclass, field, fields, replace
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

from ..errors import StateError

SCHEMA = 1


@dataclass(frozen=True)
class EstadoPosicion:
    #: Dirección del contrato (memes). Se registra al comprar.
    direccion: str | None = None
    #: Símbolo del token según DexScreener, para que el aviso diga "BONK".
    simbolo_token: str | None = None
    entrada: Decimal | None = None
    entrada_at: datetime | None = None
    #: "telegram" si el usuario dio el precio; "mercado" si se tomó el actual.
    entrada_origen: str | None = None
    #: Niveles que ya avisaron. Cada uno suena UNA vez: un aviso que se repite
    #: cada dos minutos enseña a no leerlo.
    disparados: tuple[str, ...] = ()
    #: SL vigente si se movió (1 = break-even). None = el de la banda.
    sl_factor: Decimal | None = None
    vendido_pct: Decimal = Decimal(0)
    cerrada_at: datetime | None = None
    cierre_motivo: str | None = None
    precio_cierre: Decimal | None = None

    ultimo_precio: Decimal | None = None
    ultima_lectura_at: datetime | None = None
    ultima_fuente: str | None = None
    ultima_liquidez: Decimal | None = None
    ultimo_volumen: Decimal | None = None
    #: Extremos desde la entrada, para el balance: cuánto llegó a dar y cuánto
    #: llegó a quitar, que dice más que el resultado final.
    maximo: Decimal | None = None
    minimo: Decimal | None = None

    fallos: int = 0
    ultimo_error: str | None = None
    avisado_fallo: bool = False

    @property
    def abierta(self) -> bool:
        return self.entrada is not None and self.cerrada_at is None

    @property
    def cerrada(self) -> bool:
        return self.cerrada_at is not None

    def with_(self, **kw: Any) -> EstadoPosicion:
        return replace(self, **kw)


@dataclass(frozen=True)
class EstadoPlan:
    posiciones: dict[str, EstadoPosicion] = field(default_factory=dict)
    #: Último `update_id` de Telegram ya procesado + 1.
    telegram_offset: int | None = None
    recordatorios_enviados: tuple[str, ...] = ()
    #: Tras un stop en una meme, no se vuelve a entrar hasta esta hora.
    pausa_hasta: datetime | None = None
    pausa_avisada_fin: bool = True
    #: Ya se avisó de que no se pueden leer los comandos: una vez por episodio,
    #: no cada dos minutos.
    avisado_comandos: bool = False

    def de(self, id_: str) -> EstadoPosicion:
        return self.posiciones.get(id_, EstadoPosicion())

    def con(self, id_: str, estado: EstadoPosicion) -> EstadoPlan:
        return replace(self, posiciones={**self.posiciones, id_: estado})

    def with_(self, **kw: Any) -> EstadoPlan:
        return replace(self, **kw)


# --------------------------------------------------------------------------- #
# Disco
# --------------------------------------------------------------------------- #

_DECIMALES = {"entrada", "sl_factor", "vendido_pct", "precio_cierre", "ultimo_precio",
              "ultima_liquidez", "ultimo_volumen", "maximo", "minimo"}
_FECHAS = {"entrada_at", "cerrada_at", "ultima_lectura_at"}


def _codificar(e: EstadoPosicion) -> dict[str, Any]:
    salida: dict[str, Any] = {}
    for k, v in asdict(e).items():
        if v is None or v == () or (k == "fallos" and v == 0) or (k == "avisado_fallo" and not v):
            continue
        if isinstance(v, Decimal):
            salida[k] = format(v.normalize(), "f")
        elif isinstance(v, datetime):
            salida[k] = _iso(v)
        elif isinstance(v, tuple):
            salida[k] = list(v)
        else:
            salida[k] = v
    return salida


def _decodificar(raw: dict[str, Any]) -> EstadoPosicion:
    conocidos = {f.name for f in fields(EstadoPosicion)}
    kw: dict[str, Any] = {}
    for k, v in raw.items():
        if k not in conocidos or v is None:
            continue
        if k in _DECIMALES:
            kw[k] = Decimal(str(v))
        elif k in _FECHAS:
            kw[k] = datetime.fromisoformat(v.replace("Z", "+00:00"))
        elif k == "disparados":
            kw[k] = tuple(v)
        else:
            kw[k] = v
    return EstadoPosicion(**kw)


def cargar(path: str | Path) -> EstadoPlan:
    path = Path(path)
    if not path.exists():
        return EstadoPlan()
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        # No se arranca de cero en silencio: perderíamos los precios de entrada
        # y el bot se callaría justo cuando hay posiciones abiertas.
        raise StateError(f"no se puede leer {path}: {exc}") from exc
    pausa = raw.get("pausa_hasta")
    return EstadoPlan(
        posiciones={k: _decodificar(v) for k, v in (raw.get("posiciones") or {}).items()},
        telegram_offset=raw.get("telegram_offset"),
        recordatorios_enviados=tuple(raw.get("recordatorios_enviados") or ()),
        pausa_hasta=datetime.fromisoformat(pausa.replace("Z", "+00:00")) if pausa else None,
        pausa_avisada_fin=bool(raw.get("pausa_avisada_fin", True)),
        avisado_comandos=bool(raw.get("avisado_comandos", False)),
    )


def guardar(path: str | Path, estado: EstadoPlan, ahora: datetime) -> None:
    path = Path(path)
    documento = {
        "schema": SCHEMA,
        "updated_at": _iso(ahora),
        "telegram_offset": estado.telegram_offset,
        "recordatorios_enviados": list(estado.recordatorios_enviados),
        "pausa_hasta": _iso(estado.pausa_hasta) if estado.pausa_hasta else None,
        "pausa_avisada_fin": estado.pausa_avisada_fin,
        "avisado_comandos": estado.avisado_comandos,
        "posiciones": {k: _codificar(v) for k, v in sorted(estado.posiciones.items())},
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    texto = json.dumps(documento, indent=2, sort_keys=True, ensure_ascii=False) + "\n"
    # Escritura atómica: un proceso muerto a medias no deja un JSON truncado
    # que al día siguiente impida arrancar con posiciones abiertas.
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".plan-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(texto)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def _iso(valor: datetime) -> str:
    return valor.replace(microsecond=0).isoformat().replace("+00:00", "Z")
