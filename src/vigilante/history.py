"""Historial de precios.

Cada ejecución añade una fila por precio obtenido. No es memoria de trabajo del
vigilante — el estado vive en `state/state.json` — sino la materia prima del
análisis posterior: sin historial, un motor de volatilidad no tiene nada que
medir, y el historial solo se consigue dejándolo correr.

Se escribe **en modo añadir**, nunca reescribiendo: un fichero de ~5 MB al año no
se puede regenerar en cada cron, y un append es la operación que mejor sobrevive
a que el proceso muera a medias.
"""

from __future__ import annotations

import csv
from datetime import datetime
from pathlib import Path
from typing import Iterable

from .models import Quote

COLUMNS = ("timestamp", "asset_id", "provider", "price", "currency")


def history_path(directory: str | Path, now: datetime) -> Path:
    """Un fichero por año: acota el tamaño sin necesitar rotación manual."""
    return Path(directory) / f"prices-{now.year}.csv"


def append_quotes(directory: str | Path, quotes: Iterable[Quote], now: datetime) -> int:
    """Añade las cotizaciones válidas. Devuelve cuántas filas se escribieron."""
    rows = [
        (
            _iso(quote.as_of),
            quote.asset_id,
            quote.provider,
            format(quote.price.normalize(), "f"),
            quote.currency,
        )
        for quote in quotes
    ]
    if not rows:
        return 0

    path = history_path(directory, now)
    path.parent.mkdir(parents=True, exist_ok=True)
    nuevo = not path.exists() or path.stat().st_size == 0

    with path.open("a", encoding="utf-8", newline="") as fh:
        writer = csv.writer(fh)
        if nuevo:
            writer.writerow(COLUMNS)
        writer.writerows(rows)
    return len(rows)


def _iso(value: datetime) -> str:
    return value.replace(microsecond=0).isoformat().replace("+00:00", "Z")
