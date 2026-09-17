"""Fuentes de precios.

Añadir una fuente nueva es escribir un fichero aquí y una línea en el YAML: el
motor de alertas no se entera.
"""

from . import coingecko, stooq, twelvedata  # noqa: F401  (registran al importarse)
from .base import PriceProvider
from .registry import build_providers, known_providers, unknown_providers

__all__ = ["PriceProvider", "build_providers", "known_providers", "unknown_providers"]
