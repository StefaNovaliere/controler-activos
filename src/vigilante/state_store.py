"""Lectura y escritura del `state.json`.

El estado es la memoria del vigilante entre ejecuciones: sin él no se puede
distinguir "acaba de cruzar" de "lleva tres días fuera de rango". Como en GitHub
Actions el runner es efímero, este fichero se commitea al repositorio, así que
importan tres cosas:

* **Escritura atómica**: un fichero a medio escribir es un estado perdido.
* **Serialización determinista**: si el mismo estado produjese bytes distintos,
  el workflow commitearía en cada ejecución aunque no hubiera pasado nada.
* **Versionado estricto**: ante un `schema` desconocido se aborta sin
  sobrescribir, en vez de migrar a ciegas.
"""

from __future__ import annotations

import json
import os
import tempfile
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

from .errors import StateError
from .models import AssetState, EventKind, PendingEvent, Zone

SCHEMA_VERSION = 1

_TIMESTAMPS = (
    "last_ok_at",
    "last_breach_notified_at",
    "last_recovery_notified_at",
    "last_error_at",
    "last_health_notified_at",
    "last_trailing_notified_at",
)


def load_state(path: str | Path) -> dict[str, AssetState]:
    """Carga el estado. Un fichero ausente es un arranque en frío legítimo."""
    path = Path(path)
    if not path.exists():
        return {}

    text = path.read_text(encoding="utf-8").strip()
    if not text:
        return {}

    try:
        raw = json.loads(text)
    except json.JSONDecodeError as exc:
        raise StateError(
            f"{path} está corrupto ({exc}). No se sobrescribe: revísalo o bórralo a mano "
            f"(borrarlo implica re-avisar de los activos que ya estén fuera de rango)."
        ) from exc

    if not isinstance(raw, dict):
        raise StateError(f"{path} debe contener un objeto JSON en la raíz")

    schema = raw.get("schema")
    if schema != SCHEMA_VERSION:
        raise StateError(
            f"{path} usa schema {schema!r}, pero esta versión entiende {SCHEMA_VERSION}. "
            f"Se aborta sin tocar el fichero."
        )

    assets = raw.get("assets") or {}
    if not isinstance(assets, dict):
        raise StateError(f"{path}: 'assets' debe ser un objeto")

    try:
        return {asset_id: _decode(payload) for asset_id, payload in assets.items()}
    except (ValueError, TypeError, KeyError, InvalidOperation) as exc:
        raise StateError(f"{path}: estado ilegible para algún activo ({exc})") from exc


def save_state(path: str | Path, states: dict[str, AssetState], now: datetime) -> bool:
    """Persiste el estado. Devuelve True solo si el contenido cambió realmente.

    Si nada cambió no se toca el fichero: así el workflow no genera un commit por
    cada ejecución del cron.
    """
    path = Path(path)
    assets = {asset_id: _encode(state) for asset_id, state in sorted(states.items())}

    previous = _read_assets_blob(path)
    if previous == assets:
        return False

    document = {
        "schema": SCHEMA_VERSION,
        "updated_at": _iso(now),
        "assets": assets,
    }
    _write_atomic(path, json.dumps(document, indent=2, sort_keys=True, ensure_ascii=False) + "\n")
    return True


# --------------------------------------------------------------------------- #
# Internos
# --------------------------------------------------------------------------- #


def _read_assets_blob(path: Path) -> dict[str, Any] | None:
    """El bloque 'assets' ya escrito, o None si no se puede comparar."""
    if not path.exists():
        return None
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None
    return raw.get("assets") if isinstance(raw, dict) else None


def _write_atomic(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    # El temporal va en el mismo directorio para que `os.replace` sea atómico
    # (un rename entre sistemas de ficheros distintos no lo es).
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(text)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def _encode(state: AssetState) -> dict[str, Any]:
    out: dict[str, Any] = {
        "zone": state.zone.value if state.zone else None,
        "consecutive_failures": state.consecutive_failures,
    }
    if state.last_price is not None:
        out["last_price"] = _num(state.last_price)
    for field in _TIMESTAMPS:
        value = getattr(state, field)
        if value is not None:
            out[field] = _iso(value)
    if state.last_notified_event is not None:
        out["last_notified_event"] = state.last_notified_event.value
    if state.pending is not None:
        out["pending"] = {
            "kind": state.pending.kind.value,
            "first_seen_at": _iso(state.pending.first_seen_at),
            "first_price": _num(state.pending.first_price),
        }
    if state.last_error is not None:
        out["last_error"] = state.last_error
    if state.config_fingerprint is not None:
        out["config_fingerprint"] = state.config_fingerprint
    # El rastro del trailing. Sin persistirlo, cada ejecución arrancaría en frío
    # sembrando el máximo en el precio de ahora, y "cayó un 20 % desde su
    # máximo" no podría ser cierto jamás: el aviso no saltaría nunca y nada
    # parecería roto.
    if state.peak is not None:
        out["peak"] = _num(state.peak)
    if state.trough is not None:
        out["trough"] = _num(state.trough)
    if state.trailing_fingerprint is not None:
        out["trailing_fingerprint"] = state.trailing_fingerprint
    # Qué tramo del plan de salida ya sonó. Sin esto, un objetivo ya alcanzado
    # volvería a avisar en cada ejecución: el mismo fallo que el rastro del
    # trailing, que también se escapó de los tests unitarios.
    if state.highest_exit is not None:
        out["highest_exit"] = _num(state.highest_exit)
    if state.exits_fingerprint is not None:
        out["exits_fingerprint"] = state.exits_fingerprint
    return out


def _decode(payload: dict[str, Any]) -> AssetState:
    zone = payload.get("zone")
    pending = payload.get("pending")
    return AssetState(
        zone=Zone(zone) if zone else None,
        last_price=_dec(payload.get("last_price")),
        last_notified_event=(
            EventKind(payload["last_notified_event"]) if payload.get("last_notified_event") else None
        ),
        pending=(
            PendingEvent(
                kind=EventKind(pending["kind"]),
                first_seen_at=_parse(pending["first_seen_at"]),
                first_price=_dec(pending["first_price"]),
            )
            if pending
            else None
        ),
        consecutive_failures=int(payload.get("consecutive_failures", 0)),
        last_error=payload.get("last_error"),
        config_fingerprint=payload.get("config_fingerprint"),
        peak=_dec(payload.get("peak")),
        trough=_dec(payload.get("trough")),
        trailing_fingerprint=payload.get("trailing_fingerprint"),
        highest_exit=_dec(payload.get("highest_exit")),
        exits_fingerprint=payload.get("exits_fingerprint"),
        **{field: _parse(payload.get(field)) for field in _TIMESTAMPS},
    )


def _num(value: Decimal) -> str:
    """Los precios se guardan como cadena: un float en JSON pierde precisión."""
    return format(value.normalize(), "f")


def _dec(value: Any) -> Decimal | None:
    return None if value is None else Decimal(str(value))


def _iso(value: datetime) -> str:
    return value.astimezone(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _parse(value: Any) -> datetime | None:
    if value is None:
        return None
    parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)
