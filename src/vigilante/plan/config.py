"""Configuración de un plan de trading con fecha de caducidad.

Es otra cosa que `config/assets.yml`, y por eso vive en otro fichero:

    assets.yml  →  umbrales FIJOS sobre activos que se vigilan indefinidamente.
    plan.yml    →  bandas RELATIVAS a un precio de entrada que todavía no existe
                   cuando se escribe el plan, con reglas de calendario y un final.

Meterlo en `assets.yml` habría obligado a cambiar el editor del panel y el
contrato de esquema que comparten Python y TypeScript, para algo que dura una
semana. Aquí se reutiliza lo que sirve (Telegram, el cliente HTTP, el historial,
el workflow) sin tocar el motor de alertas, que lleva cientos de tests en verde.

Todas las horas se escriben en hora de Argentina (UTC−3, sin horario de verano
desde 2009): es la hora en la que se escribió el plan y en la que se lee el aviso.
Un desfase de tres horas en "no operar de 14:30 a 15:30" es exactamente el tipo
de error propio que el plan existe para eliminar.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

from ..errors import ConfigError

#: Argentina no tiene horario de verano: un desfase fijo es más seguro que
#: depender de que el runner tenga la base de datos de zonas horarias al día.
ART = timezone(timedelta(hours=-3), "ART")

Fuente = Literal["binance", "dexscreener", "coingecko"]
Extra = Literal["ventana_entrada", "cierre_ventana", "abiertas", "memes_abiertas", "balance"]


def _a_art(valor: datetime) -> datetime:
    """Una hora sin zona se interpreta en Argentina; con zona, se respeta."""
    return valor.replace(tzinfo=ART) if valor.tzinfo is None else valor


class _Base(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Nivel(_Base):
    """Un nivel de la banda, como múltiplo del precio de entrada.

    `factor: 1.15` es entrada × 1,15. Relativo a propósito: el plan se escribe
    antes de comprar, y el precio de entrada solo se sabe en el momento.
    """

    factor: Decimal = Field(gt=0)
    #: Solo para el SL de una orden stop-limit: dónde está el límite. Si el
    #: precio salta por debajo del límite, la orden puede quedar sin llenarse.
    limite: Decimal | None = Field(default=None, gt=0)
    #: Qué parte vende el ejecutor (la OCO, Photon) al tocar este nivel.
    vende_pct: Decimal | None = Field(default=None, gt=0, le=100)
    #: Tras tocar este nivel, el SL pasa a este factor (1 = break-even).
    sl_pasa_a: Decimal | None = Field(default=None, gt=0)
    #: Qué hay que hacer a mano. Va tal cual en el aviso.
    accion: str | None = Field(default=None, max_length=240)


class Bandas(_Base):
    alerta_superior: Nivel | None = None
    tp: Nivel | None = None
    alerta_inferior: Nivel | None = None
    sl: Nivel | None = None

    @model_validator(mode="after")
    def _orden(self) -> Bandas:
        arriba = [n.factor for n in (self.alerta_superior, self.tp) if n]
        abajo = [n.factor for n in (self.alerta_inferior, self.sl) if n]
        if any(f <= 1 for f in arriba):
            raise ValueError("los niveles superiores tienen que estar por encima de la entrada (factor > 1)")
        if any(f >= 1 for f in abajo):
            raise ValueError("los niveles inferiores tienen que estar por debajo de la entrada (factor < 1)")
        if self.alerta_superior and self.tp and self.alerta_superior.factor >= self.tp.factor:
            raise ValueError("la alerta superior tiene que estar por debajo del TP")
        if self.alerta_inferior and self.sl and self.alerta_inferior.factor <= self.sl.factor:
            raise ValueError("la alerta inferior tiene que estar por encima del SL")
        if self.sl and self.sl.limite is not None and self.sl.limite > self.sl.factor:
            raise ValueError("el límite del SL no puede estar por encima del gatillo")
        return self


class Respaldo(_Base):
    fuente: Fuente
    simbolo: str


class ReglaEntrada(_Base):
    """Cuándo y a qué precio el plan permite abrir esta posición."""

    desde: datetime | None = None
    hasta: datetime | None = None
    precio_min: Decimal | None = Field(default=None, gt=0)
    precio_max: Decimal | None = Field(default=None, gt=0)

    @field_validator("desde", "hasta")
    @classmethod
    def en_argentina(cls, v):
        return v and _a_art(v)


class PosicionSpec(_Base):
    id: str = Field(pattern=r"^[a-z0-9_-]+$")
    etiqueta: str
    fuente: Fuente
    #: Para Binance, el par (SUIUSDT). Para DexScreener se deja vacío: la
    #: dirección del contrato se registra por Telegram al comprar.
    simbolo: str | None = None
    cadena: str = "solana"
    respaldo: Respaldo | None = None
    #: Nombre de un juego de bandas de `bandas:`.
    bandas: str
    entrada: ReglaEntrada | None = None
    #: Si un stop en esta posición abre la pausa de reentrada.
    pausa_tras_stop: bool = False
    #: Avisar si la liquidez cae de golpe (memes).
    vigilar_liquidez: bool = False
    #: Cuánto puede alejarse el precio registrado del de mercado antes de
    #: preguntar si fue un error de tipeo. Las memes se mueven más.
    tolerancia_tipeo_pct: Decimal = Field(default=Decimal("5"), gt=0)


class Recordatorio(_Base):
    id: str = Field(pattern=r"^[a-z0-9_-]+$")
    cuando: datetime
    #: Pasado esto ya no sirve: un "no operes de 14:30 a 15:30" que llega a las
    #: 16:00 confunde más de lo que ayuda. Por defecto, una hora.
    hasta: datetime | None = None
    texto: str = Field(max_length=600)
    extra: Extra | None = None
    posicion: str | None = None

    @field_validator("cuando", "hasta")
    @classmethod
    def en_argentina(cls, v):
        return v and _a_art(v)

    @property
    def caduca(self) -> datetime:
        return self.hasta or self.cuando + timedelta(hours=1)


class Franja(_Base):
    desde: datetime
    hasta: datetime
    motivo: str = Field(max_length=200)
    #: Vacío = vale para todas las posiciones.
    posiciones: list[str] = Field(default_factory=list)

    @field_validator("desde", "hasta")
    @classmethod
    def en_argentina(cls, v):
        return _a_art(v)

    def aplica(self, posicion: str, cuando: datetime) -> bool:
        return (not self.posiciones or posicion in self.posiciones) and self.desde <= cuando < self.hasta


class Bucle(_Base):
    """Cuándo el workflow se queda despierto consultando cada `cada_segundos`."""

    desde: datetime
    hasta: datetime
    cada_segundos: int = Field(default=120, ge=60)

    @field_validator("desde", "hasta")
    @classmethod
    def en_argentina(cls, v):
        return _a_art(v)


class PlanSpec(_Base):
    version: Literal[1] = 1
    nombre: str
    fin: datetime
    bucle: Bucle
    liquidez_caida_pct: Decimal = Field(default=Decimal("30"), gt=0, lt=100)
    pausa_tras_stop_minutos: int = Field(default=120, ge=0)
    #: Tras cuántas lecturas fallidas seguidas se avisa de que faltan datos.
    fallos_para_avisar: int = Field(default=3, ge=1)
    bandas: dict[str, Bandas]
    posiciones: list[PosicionSpec]
    no_abrir: list[Franja] = Field(default_factory=list)
    recordatorios: list[Recordatorio] = Field(default_factory=list)

    @field_validator("fin")
    @classmethod
    def en_argentina(cls, v):
        return _a_art(v)

    @model_validator(mode="after")
    def _coherente(self) -> PlanSpec:
        ids = [p.id for p in self.posiciones]
        if len(ids) != len(set(ids)):
            raise ValueError("hay ids de posición repetidos")
        for p in self.posiciones:
            if p.bandas not in self.bandas:
                raise ValueError(f"la posición '{p.id}' usa las bandas '{p.bandas}', que no existen")
            if p.fuente == "binance" and not p.simbolo:
                raise ValueError(f"la posición '{p.id}' es de Binance y no tiene 'simbolo' (p. ej. SUIUSDT)")
        rec = [r.id for r in self.recordatorios]
        if len(rec) != len(set(rec)):
            raise ValueError("hay ids de recordatorio repetidos")
        for r in self.recordatorios:
            if r.posicion and r.posicion not in ids:
                raise ValueError(f"el recordatorio '{r.id}' nombra la posición '{r.posicion}', que no existe")
            if r.extra in ("ventana_entrada", "cierre_ventana") and not r.posicion:
                raise ValueError(f"el recordatorio '{r.id}' necesita 'posicion' para '{r.extra}'")
        for f in self.no_abrir:
            if f.desde >= f.hasta:
                raise ValueError(f"la franja «{f.motivo}» termina antes de empezar")
        if self.bucle.desde >= self.bucle.hasta:
            raise ValueError("el bucle termina antes de empezar")
        return self

    def posicion(self, id_: str) -> PosicionSpec | None:
        return next((p for p in self.posiciones if p.id == id_), None)

    def bandas_de(self, p: PosicionSpec) -> Bandas:
        return self.bandas[p.bandas]


def load_plan(path: str | Path) -> PlanSpec:
    path = Path(path)
    try:
        raw: Any = yaml.safe_load(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ConfigError(f"no existe el plan: {path}") from exc
    except yaml.YAMLError as exc:
        raise ConfigError(f"YAML inválido en {path}: {exc}") from exc
    if not isinstance(raw, dict):
        raise ConfigError(f"{path} debe contener un mapa en la raíz")
    try:
        return PlanSpec.model_validate(raw)
    except ValidationError as exc:
        lineas = [f"  - {'.'.join(str(p) for p in e['loc']) or '(raíz)'}: {e['msg']}" for e in exc.errors()]
        raise ConfigError(f"plan inválido en {path}:\n" + "\n".join(lineas)) from exc


def segundos_de_bucle(plan: PlanSpec, ahora: datetime, maximo: int) -> int:
    """Cuánto debe quedarse despierto el workflow. 0 = una sola pasada."""
    if not (plan.bucle.desde <= ahora < plan.bucle.hasta):
        return 0
    return max(0, min(int((plan.bucle.hasta - ahora).total_seconds()), maximo))
