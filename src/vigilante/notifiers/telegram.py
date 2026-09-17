"""Bot de Telegram.

Dos cuidados que no son opcionales:

* El token va en la **ruta** de la URL, así que la URL completa no se registra
  nunca en un log ni en un mensaje de error.
* Telegram corta los mensajes a 4096 caracteres: se trocean por líneas antes de
  enviar, no se truncan (truncar perdería justo la última alerta del lote).
"""

from __future__ import annotations

import time

import requests

from ..errors import NotifierError

API_BASE = "https://api.telegram.org"
MAX_CHARS = 4096
MAX_RETRIES = 2


class TelegramNotifier:
    name = "telegram"

    def __init__(self, token: str, chat_id: str, *, parse_mode: str = "HTML", timeout: float = 15.0) -> None:
        if not token or not chat_id:
            raise NotifierError("faltan el token o el chat_id de Telegram")
        self._token = token
        self._chat_id = chat_id
        self._parse_mode = parse_mode
        self._timeout = timeout
        self._session = requests.Session()

    def send(self, text: str) -> None:
        for chunk in split_message(text):
            self._send_chunk(chunk)

    def _send_chunk(self, text: str) -> None:
        url = f"{API_BASE}/bot{self._token}/sendMessage"
        payload = {
            "chat_id": self._chat_id,
            "text": text,
            "parse_mode": self._parse_mode,
            "disable_web_page_preview": True,
        }

        for attempt in range(MAX_RETRIES + 1):
            try:
                response = self._session.post(url, json=payload, timeout=self._timeout)
            except requests.RequestException as exc:
                # `exc` puede arrastrar la URL, y la URL lleva el token.
                raise NotifierError(f"no se pudo contactar con Telegram: {type(exc).__name__}") from None

            if response.ok:
                return

            if response.status_code == 429 and attempt < MAX_RETRIES:
                time.sleep(min(_retry_after(response), 30))
                continue

            raise NotifierError(f"Telegram respondió {response.status_code}: {_safe_body(response)}")

    def close(self) -> None:
        self._session.close()


def split_message(text: str, limit: int = MAX_CHARS) -> list[str]:
    """Trocea por líneas, sin partir una alerta por la mitad si se puede evitar."""
    if len(text) <= limit:
        return [text]

    chunks: list[str] = []
    current = ""
    for line in text.split("\n"):
        candidate = f"{current}\n{line}" if current else line
        if len(candidate) <= limit:
            current = candidate
            continue
        if current:
            chunks.append(current)
        # Una sola línea más larga que el límite: aquí sí hay que cortar en seco.
        while len(line) > limit:
            chunks.append(line[:limit])
            line = line[limit:]
        current = line
    if current:
        chunks.append(current)
    return chunks


def _retry_after(response: requests.Response) -> float:
    try:
        return float(response.json()["parameters"]["retry_after"])
    except (ValueError, KeyError, TypeError):
        return 3.0


def _safe_body(response: requests.Response) -> str:
    try:
        payload = response.json()
        return str(payload.get("description", ""))[:200]
    except ValueError:
        return response.text[:200]
