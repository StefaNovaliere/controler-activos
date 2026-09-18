"""Carga y validación del YAML de configuración.

Todo error de configuración es fatal y se detecta al arrancar: es preferible que
`vigilante check` falle en un segundo a descubrir una errata cuando se pierde una
alerta. Las credenciales se referencian por *nombre de variable de entorno*,
nunca por valor, para que el YAML sea commiteable sin riesgo.
"""

from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

from .errors import ConfigError

FirstRunPolicy = Literal["none", "summary", "full"]


class ProviderSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    api_key_env: str | None = None
    batch_size: int = Field(default=8, ge=1, le=120)
    timeout_seconds: float = Field(default=15.0, gt=0)


class TelegramSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    token_env: str = "TELEGRAM_BOT_TOKEN"
    chat_id_env: str = "TELEGRAM_CHAT_ID"
    parse_mode: Literal["HTML"] = "HTML"


class NotifierSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    telegram: TelegramSettings | None = None


class Defaults(BaseModel):
    model_config = ConfigDict(extra="forbid")

    currency: str = "usd"
    cooldown_minutes: int = Field(default=180, ge=0)
    hysteresis_pct: Decimal = Field(default=Decimal("0.25"), ge=0, le=50)
    notify_on_return: bool = True
    renotify_while_outside: bool = False
    notify_transient: bool = False
    max_staleness_minutes: int = Field(default=240, ge=1)
    first_run_policy: FirstRunPolicy = "summary"


class ExitSpec(BaseModel):
    """Un tramo del plan de salida: a este precio, vendo esta parte.

    El bot no ejecuta nada —no toca tu dinero ni tiene por qué poder hacerlo—:
    avisa. Pero el aviso lleva la fracción escrita porque el valor del plan está
    en haberlo decidido antes, no en recordarlo en caliente.
    """

    model_config = ConfigDict(extra="forbid")

    price: Decimal = Field(gt=0)
    #: Qué parte de la posición vender aquí. Informativo, para el mensaje.
    sell_pct: Decimal | None = Field(default=None, gt=0, le=100)
    #: Una nota tuya: "recupero lo invertido", "esto ya es ganancia".
    note: str | None = Field(default=None, max_length=120)


class TrailingSpec(BaseModel):
    """Aviso relativo a un extremo, no a un precio fijo.

    Un umbral fijo contesta «¿llegó a este precio?». Esto contesta «¿se dio la
    vuelta?», que es otra pregunta y la que de verdad corresponde a vender alto
    y comprar barato: no hay que acertar el techo, solo decidir cuánto se está
    dispuesto a devolver desde él.

    Además no hay que reajustarlo: un porcentaje sobre el máximo vale igual a
    0,07 que a 7, mientras que un umbral fijo se queda obsoleto en cuanto el
    activo cambia de orden de magnitud.
    """

    model_config = ConfigDict(extra="forbid")

    #: Caída desde el máximo que dispara el aviso.
    drop_pct: Decimal | None = Field(default=None, gt=0, lt=100)
    #: Subida desde el mínimo que dispara el aviso.
    rise_pct: Decimal | None = Field(default=None, gt=0)

    @model_validator(mode="after")
    def _algo_que_vigilar(self) -> TrailingSpec:
        if self.drop_pct is None and self.rise_pct is None:
            raise ValueError("'trailing' no define ni 'drop_pct' ni 'rise_pct': no vigila nada")
        return self


class FallbackSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider: str
    symbol: str


class AssetSpec(BaseModel):
    """Un activo tal y como lo escribe el usuario: los overrides son opcionales."""

    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, pattern=r"^[a-zA-Z0-9_.-]+$")
    provider: str
    symbol: str
    label: str | None = None
    currency: str | None = None
    lower: Decimal | None = None
    upper: Decimal | None = None
    enabled: bool = True
    fallback: FallbackSpec | None = None
    trailing: TrailingSpec | None = None
    #: Plan de salida por tramos. Lo que convierte "vender alto" en una decisión
    #: tomada en frío en vez de una improvisación en el momento de euforia.
    exits: list[ExitSpec] = Field(default_factory=list, max_length=8)
    #: A cuánto compraste. Sirve para que el panel hable en múltiplos ("2x") en
    #: vez de en precios sueltos. Opcional: sin esto todo sigue funcionando.
    entry_price: Decimal | None = Field(default=None, gt=0)

    cooldown_minutes: int | None = Field(default=None, ge=0)
    hysteresis_pct: Decimal | None = Field(default=None, ge=0, le=50)
    notify_on_return: bool | None = None
    renotify_while_outside: bool | None = None
    notify_transient: bool | None = None
    max_staleness_minutes: int | None = Field(default=None, ge=1)
    first_run_policy: FirstRunPolicy | None = None

    @model_validator(mode="after")
    def _check_thresholds(self) -> AssetSpec:
        if self.lower is None and self.upper is None and self.trailing is None and not self.exits:
            raise ValueError(
                f"el activo '{self.id}' no define ni 'lower' ni 'upper' ni 'trailing' ni "
                "'exits': no hay nada que vigilar"
            )
        vendido = sum((e.sell_pct or Decimal(0)) for e in self.exits)
        if vendido > 100:
            raise ValueError(
                f"el activo '{self.id}' reparte {vendido} % entre sus objetivos de salida: "
                "no se puede vender más del 100 % de una posición"
            )
        precios = [e.price for e in self.exits]
        if len(precios) != len(set(precios)):
            raise ValueError(f"el activo '{self.id}' repite un precio en su plan de salida")
        if self.lower is not None and self.upper is not None and self.lower >= self.upper:
            raise ValueError(f"el activo '{self.id}' tiene lower ({self.lower}) >= upper ({self.upper})")
        return self


class ConfigSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: Literal[1] = 1
    defaults: Defaults = Field(default_factory=Defaults)
    providers: dict[str, ProviderSettings] = Field(default_factory=dict)
    notifier: NotifierSettings = Field(default_factory=NotifierSettings)
    assets: list[AssetSpec]

    @field_validator("assets")
    @classmethod
    def _unique_ids(cls, assets: list[AssetSpec]) -> list[AssetSpec]:
        seen: set[str] = set()
        for a in assets:
            if a.id in seen:
                raise ValueError(f"id de activo duplicado: '{a.id}'")
            seen.add(a.id)
        return assets

    @model_validator(mode="after")
    def _providers_declared(self) -> ConfigSpec:
        for a in self.assets:
            for name in filter(None, (a.provider, a.fallback.provider if a.fallback else None)):
                if name not in self.providers:
                    raise ValueError(
                        f"el activo '{a.id}' usa el proveedor '{name}', que no está declarado en 'providers'"
                    )
        return self


@dataclass(frozen=True)
class ResolvedAsset:
    """Un activo con los defaults ya aplicados. Es lo que ve el motor.

    Al no tener campos opcionales de configuración, el motor nunca necesita
    consultar los defaults ni conocer la forma del YAML.
    """

    id: str
    label: str
    provider: str
    symbol: str
    currency: str
    lower: Decimal | None
    upper: Decimal | None
    cooldown_minutes: int
    hysteresis_pct: Decimal
    notify_on_return: bool
    renotify_while_outside: bool
    notify_transient: bool
    max_staleness_minutes: int
    first_run_policy: FirstRunPolicy
    fallback: FallbackSpec | None
    trailing: TrailingSpec | None = None
    exits: tuple[ExitSpec, ...] = ()
    entry_price: Decimal | None = None

    def fingerprint(self) -> str:
        """Huella de lo que afecta a la clasificación en zonas.

        Si cambia, el estado previo deja de ser comparable y el activo se
        reevalúa como si fuese la primera vez. Sin esto, subir un umbral y que el
        bot siga callado porque "ya estaba en BELOW" sería un bug silencioso.
        """
        material = "|".join(
            str(x)
            for x in (
                self.provider,
                self.symbol,
                self.currency,
                _norm(self.lower),
                _norm(self.upper),
                _norm(self.hysteresis_pct),
            )
        )
        return "sha256:" + hashlib.sha256(material.encode()).hexdigest()[:16]

    def exits_fingerprint(self) -> str | None:
        """Huella del plan de salida, separada de las otras dos.

        Cambiar un objetivo tiene que poder reactivar el aviso de ese tramo sin
        arrastrar consigo la reevaluación de las zonas ni el rastro del trailing.
        """
        if not self.exits:
            return None
        material = "|".join(f"{_norm(e.price)}:{_norm(e.sell_pct)}" for e in self.exits)
        return "sha256:" + hashlib.sha256(material.encode()).hexdigest()[:16]

    def trailing_fingerprint(self) -> str | None:
        """Huella SOLO de la configuración de trailing.

        Separada de `fingerprint()` a propósito: cambiar el porcentaje de caída
        no tiene por qué reevaluar las zonas desde cero, ni al revés. Cada
        mecanismo se reinicia cuando cambia lo suyo.
        """
        if self.trailing is None:
            return None
        material = f"{_norm(self.trailing.drop_pct)}|{_norm(self.trailing.rise_pct)}"
        return "sha256:" + hashlib.sha256(material.encode()).hexdigest()[:16]


def _norm(value: Decimal | None) -> str:
    """Normaliza para que 55000 y 55000.00 produzcan la misma huella."""
    if value is None:
        return "-"
    return format(value.normalize(), "f")


@dataclass(frozen=True)
class Config:
    spec: ConfigSpec
    assets: tuple[ResolvedAsset, ...]
    path: Path

    @property
    def providers(self) -> dict[str, ProviderSettings]:
        return self.spec.providers

    @property
    def notifier(self) -> NotifierSettings:
        return self.spec.notifier

    def active_providers(self) -> set[str]:
        """Solo los proveedores realmente referenciados por activos habilitados."""
        names: set[str] = set()
        for a in self.assets:
            names.add(a.provider)
            if a.fallback:
                names.add(a.fallback.provider)
        return names

    def missing_env(self) -> list[str]:
        """Variables de entorno declaradas en el YAML pero ausentes del entorno."""
        missing: list[str] = []
        for name in sorted(self.active_providers()):
            settings = self.providers[name]
            if settings.api_key_env and not os.environ.get(settings.api_key_env):
                missing.append(settings.api_key_env)
        tg = self.notifier.telegram
        if tg:
            missing += [v for v in (tg.token_env, tg.chat_id_env) if not os.environ.get(v)]
        return missing


def _resolve(spec: AssetSpec, d: Defaults) -> ResolvedAsset:
    pick = lambda override, fallback: fallback if override is None else override  # noqa: E731
    return ResolvedAsset(
        id=spec.id,
        label=spec.label or spec.id.upper(),
        provider=spec.provider,
        symbol=spec.symbol,
        currency=(spec.currency or d.currency).lower(),
        lower=spec.lower,
        upper=spec.upper,
        cooldown_minutes=pick(spec.cooldown_minutes, d.cooldown_minutes),
        hysteresis_pct=pick(spec.hysteresis_pct, d.hysteresis_pct),
        notify_on_return=pick(spec.notify_on_return, d.notify_on_return),
        renotify_while_outside=pick(spec.renotify_while_outside, d.renotify_while_outside),
        notify_transient=pick(spec.notify_transient, d.notify_transient),
        max_staleness_minutes=pick(spec.max_staleness_minutes, d.max_staleness_minutes),
        first_run_policy=pick(spec.first_run_policy, d.first_run_policy),
        fallback=spec.fallback,
        trailing=spec.trailing,
        # Ordenados por precio: el plan se recorre de abajo arriba y el estado
        # guarda solo el más alto alcanzado. Si llegaran desordenados, un tramo
        # bajo añadido después de alcanzar uno alto no volvería a avisar, que es
        # lo correcto pero solo si el orden es el del precio y no el de tecleo.
        exits=tuple(sorted(spec.exits, key=lambda e: e.price)),
        entry_price=spec.entry_price,
    )


def load_config(path: str | Path) -> Config:
    """Lee, valida y resuelve el YAML. Lanza `ConfigError` con un mensaje legible."""
    path = Path(path)
    try:
        raw: Any = yaml.safe_load(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ConfigError(f"no existe el fichero de configuración: {path}") from exc
    except yaml.YAMLError as exc:
        raise ConfigError(f"YAML inválido en {path}: {exc}") from exc

    if not isinstance(raw, dict):
        raise ConfigError(f"{path} debe contener un mapa en la raíz")

    try:
        spec = ConfigSpec.model_validate(raw)
    except ValidationError as exc:
        raise ConfigError(f"configuración inválida en {path}:\n{_format_errors(exc)}") from exc

    assets = tuple(_resolve(a, spec.defaults) for a in spec.assets if a.enabled)
    if not assets:
        raise ConfigError(f"{path} no tiene ningún activo habilitado")
    return Config(spec=spec, assets=assets, path=path)


def _format_errors(exc: ValidationError) -> str:
    lines = []
    for err in exc.errors():
        loc = ".".join(str(p) for p in err["loc"]) or "(raíz)"
        lines.append(f"  - {loc}: {err['msg']}")
    return "\n".join(lines)
