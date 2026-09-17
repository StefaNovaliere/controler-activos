"""Salida por consola: dry-run y pruebas locales sin tocar Telegram."""

from __future__ import annotations

import re
import sys

_TAGS = re.compile(r"</?[bi]>")


class ConsoleNotifier:
    name = "console"

    def __init__(self, stream=None) -> None:
        self._stream = stream or sys.stdout

    def send(self, text: str) -> None:
        print(_TAGS.sub("", text), file=self._stream)
