"""Errores del vigilante.

`ProviderError` y sus subclases son *valores*, no solo excepciones: el motor las
recibe como resultado por símbolo y decide qué hacer sin que un fallo de un
proveedor tumbe la evaluación del resto.
"""

from __future__ import annotations


class VigilanteError(Exception):
    """Raíz de los errores propios."""


class ConfigError(VigilanteError):
    """Configuración inválida. Siempre es fatal: mejor fallar al arrancar."""


class StateError(VigilanteError):
    """El fichero de estado no se puede leer o escribir con seguridad."""


class NotifierError(VigilanteError):
    """No se pudo entregar la notificación."""


class ProviderError(VigilanteError):
    """Fallo al obtener un precio. Nunca corrompe el estado del activo."""

    def __init__(self, message: str, *, provider: str = "", symbol: str = "") -> None:
        super().__init__(message)
        self.provider = provider
        self.symbol = symbol

    def __str__(self) -> str:
        prefix = f"[{self.provider}:{self.symbol}] " if self.provider else ""
        return f"{prefix}{super().__str__()}"


class SymbolNotFound(ProviderError):
    """El proveedor no conoce el símbolo (o lo omitió de la respuesta)."""


class RateLimited(ProviderError):
    """El proveedor rechazó la petición por cuota."""

    def __init__(self, message: str, *, retry_after: int | None = None, **kw) -> None:
        super().__init__(message, **kw)
        self.retry_after = retry_after


class StaleData(ProviderError):
    """El precio llegó, pero es demasiado viejo para actuar sobre él."""
