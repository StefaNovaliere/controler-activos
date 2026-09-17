"""Interfaz de línea de comandos.

    vigilante check          valida la configuración sin tocar la red
    vigilante run            el ciclo normal (el que ejecuta el cron)
    vigilante simulate       inyecta precios y reloj: recorre el ciclo sin esperar
    vigilante test-telegram  comprueba token y chat_id de una vez
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path

from . import __version__
from .clock import SystemClock
from .config import Config, load_config
from .errors import VigilanteError
from .notifiers.base import Notifier
from .notifiers.console import ConsoleNotifier
from .notifiers.telegram import TelegramNotifier
from .providers import build_providers, known_providers, unknown_providers
from .runner import run as run_cycle
from .runner import summarize

DEFAULT_CONFIG = "config/assets.yml"
DEFAULT_STATE = "state/state.json"
DEFAULT_HISTORY = "history"


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    try:
        return args.handler(args)
    except VigilanteError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        return 130


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="vigilante", description=__doc__)
    parser.add_argument("--version", action="version", version=f"vigilante {__version__}")
    subparsers = parser.add_subparsers(dest="command", required=True)

    def common(sub: argparse.ArgumentParser) -> argparse.ArgumentParser:
        sub.add_argument("--config", default=DEFAULT_CONFIG, help=f"por defecto: {DEFAULT_CONFIG}")
        return sub

    check = common(subparsers.add_parser("check", help="valida la configuración"))
    check.set_defaults(handler=cmd_check)

    run = common(subparsers.add_parser("run", help="consulta precios y notifica los cruces"))
    run.add_argument("--state", default=DEFAULT_STATE)
    run.add_argument("--dry-run", action="store_true", help="no envía ni persiste")
    run.add_argument("--force-notify", action="store_true", help="ignora el cooldown")
    run.add_argument("--console", action="store_true", help="imprime en vez de usar Telegram")
    run.add_argument("--history", default=DEFAULT_HISTORY, help="directorio del historial de precios")
    run.add_argument("--no-history", action="store_true", help="no registrar los precios")
    run.add_argument("--summary", help="fichero donde escribir el informe (p. ej. $GITHUB_STEP_SUMMARY)")
    run.set_defaults(handler=cmd_run)

    sim = common(subparsers.add_parser("simulate", help="inyecta precios: ni red ni espera"))
    sim.add_argument("--state", default=DEFAULT_STATE)
    sim.add_argument("--prices", required=True, help='p. ej. "btc=50000,oro=4500"')
    sim.add_argument("--now", help="instante ISO-8601 UTC, p. ej. 2026-09-17T10:00:00Z")
    sim.add_argument("--force-notify", action="store_true")
    sim.add_argument("--telegram", action="store_true", help="enviar de verdad (por defecto: consola)")
    sim.set_defaults(handler=cmd_simulate)

    telegram = common(subparsers.add_parser("test-telegram", help="envía un mensaje de prueba"))
    telegram.set_defaults(handler=cmd_test_telegram)

    return parser


# --------------------------------------------------------------------------- #
# Comandos
# --------------------------------------------------------------------------- #


def cmd_check(args: argparse.Namespace) -> int:
    config = load_config(args.config)
    print(f"✓ {args.config}: {len(config.assets)} activo(s) habilitado(s)")
    for asset in config.assets:
        rango = f"{asset.lower if asset.lower is not None else '—'} … {asset.upper if asset.upper is not None else '—'}"
        print(
            f"  {asset.id:10} {asset.provider:11} {asset.symbol:10} "
            f"{asset.currency.upper()}  [{rango}]  cooldown={asset.cooldown_minutes}m"
        )

    # `ConfigSpec` solo mira que el proveedor esté declarado en `providers:`, no
    # que exista. Sin esto, una errata como `provider: coingeko` pasaría el gate
    # de CI y fallaría en producción, media hora más tarde.
    if desconocidos := unknown_providers(config):
        print(
            f"\n✗ proveedor(es) desconocido(s): {', '.join(desconocidos)}. "
            f"Disponibles: {', '.join(known_providers())}",
            file=sys.stderr,
        )
        return 1

    missing = config.missing_env()
    if missing:
        print("\n⚠ variables de entorno sin definir: " + ", ".join(missing), file=sys.stderr)
        print("  (`check` no falla por esto, pero `run` sí lo hará)", file=sys.stderr)
    return 0


def cmd_run(args: argparse.Namespace) -> int:
    config = load_config(args.config)
    notifier = ConsoleNotifier() if args.console else _build_notifier(config)
    providers = build_providers(config)

    result = run_cycle(
        config,
        args.state,
        now=SystemClock().now(),
        notifier=notifier,
        providers=providers,
        dry_run=args.dry_run,
        force_notify=args.force_notify,
        history_dir=None if args.no_history else args.history,
    )

    report = summarize(result, config)
    print(report)
    if args.summary:
        Path(args.summary).write_text(report + "\n", encoding="utf-8")
    if result.delivery_error:
        print(f"error: no se pudo entregar la notificación: {result.delivery_error}", file=sys.stderr)
    return result.exit_code


def cmd_simulate(args: argparse.Namespace) -> int:
    config = load_config(args.config)
    prices = _parse_prices(args.prices, config)
    now = _parse_now(args.now)
    notifier: Notifier = _build_notifier(config) if args.telegram else ConsoleNotifier()

    result = run_cycle(
        config,
        args.state,
        now=now,
        notifier=notifier,
        price_overrides=prices,
        force_notify=args.force_notify,
    )
    print(summarize(result, config))
    if not result.events:
        print("\n(sin eventos: ningún activo cruzó un umbral en este paso)")
    return result.exit_code


def cmd_test_telegram(args: argparse.Namespace) -> int:
    config = load_config(args.config)
    notifier = _build_notifier(config)
    notifier.send(
        "<b>Centinela de precios</b>\nPrueba de conexión correcta ✅\n"
        f"<i>{len(config.assets)} activo(s) configurado(s).</i>"
    )
    print("✓ mensaje enviado: míralo en Telegram")
    return 0


# --------------------------------------------------------------------------- #
# Utilidades
# --------------------------------------------------------------------------- #


def _build_notifier(config: Config) -> Notifier:
    telegram = config.notifier.telegram
    if telegram is None:
        return ConsoleNotifier()
    token = os.environ.get(telegram.token_env, "")
    chat_id = os.environ.get(telegram.chat_id_env, "")
    if not token or not chat_id:
        missing = [v for v in (telegram.token_env, telegram.chat_id_env) if not os.environ.get(v)]
        raise VigilanteError(
            "faltan variables de entorno para Telegram: "
            + ", ".join(missing)
            + " (usa --console para probar sin enviar)"
        )
    return TelegramNotifier(token, chat_id, parse_mode=telegram.parse_mode)


def _parse_prices(raw: str, config: Config) -> dict[str, Decimal]:
    known = {a.id for a in config.assets}
    prices: dict[str, Decimal] = {}
    for item in raw.split(","):
        item = item.strip()
        if not item:
            continue
        asset_id, _, value = item.partition("=")
        asset_id = asset_id.strip()
        if not value:
            raise VigilanteError(f"precio mal formado: '{item}' (se espera id=precio)")
        if asset_id not in known:
            raise VigilanteError(f"activo desconocido: '{asset_id}'. Conocidos: {', '.join(sorted(known))}")
        try:
            prices[asset_id] = Decimal(value.strip())
        except InvalidOperation:
            raise VigilanteError(f"precio no numérico: '{value}'") from None
    if not prices:
        raise VigilanteError("--prices no contiene ningún precio")
    return prices


def _parse_now(raw: str | None) -> datetime:
    if not raw:
        return SystemClock().now()
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        raise VigilanteError(f"--now no es ISO-8601: '{raw}'") from None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


if __name__ == "__main__":
    sys.exit(main())
