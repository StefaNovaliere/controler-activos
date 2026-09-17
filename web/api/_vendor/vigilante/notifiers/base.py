"""Contrato de las salidas de notificación."""

from __future__ import annotations

from typing import Protocol


class Notifier(Protocol):
    name: str

    def send(self, text: str) -> None:
        """Entrega un mensaje ya redactado. Lanza `NotifierError` si no puede."""
        ...
