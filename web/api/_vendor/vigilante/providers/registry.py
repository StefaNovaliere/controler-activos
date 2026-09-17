"""Registro de proveedores.

Solo se instancian los proveedores realmente referenciados por algún activo
habilitado: así no hace falta una clave de Twelve Data para vigilar solo criptos.
"""

from __future__ import annotations

import os
from typing import Mapping

from ..config import Config, ProviderSettings
from ..errors import ConfigError
from .base import PriceProvider

_REGISTRY: dict[str, type] = {}


def register(cls: type) -> type:
    """Decorador de clase: `@register` sobre un proveedor lo hace usable en el YAML."""
    _REGISTRY[cls.name] = cls
    return cls


def known_providers() -> list[str]:
    return sorted(_REGISTRY)


def unknown_providers(config: Config) -> list[str]:
    """Proveedores que el YAML declara pero el registro no conoce.

    `ConfigSpec` solo comprueba que el proveedor de un activo esté declarado en
    `providers:`, no que exista de verdad. Sin esta comprobación, un
    `provider: kraken` pasa la validación y el gate de CI, y revienta media hora
    después en producción.
    """
    return sorted(config.active_providers() - set(_REGISTRY))


def build_provider(
    name: str, settings: ProviderSettings, env: Mapping[str, str] | None = None
) -> PriceProvider:
    try:
        cls = _REGISTRY[name]
    except KeyError:
        raise ConfigError(
            f"proveedor desconocido: '{name}'. Disponibles: {', '.join(known_providers())}"
        ) from None
    return cls(settings, env if env is not None else os.environ)


def build_providers(config: Config, env: Mapping[str, str] | None = None) -> dict[str, PriceProvider]:
    return {
        name: build_provider(name, config.providers[name], env)
        for name in sorted(config.active_providers())
    }
