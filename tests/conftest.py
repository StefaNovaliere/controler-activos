"""Fábricas compartidas por los tests."""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal

import pytest

from vigilante.config import ResolvedAsset
from vigilante.models import AssetState, Quote, Zone

T0 = datetime(2026, 9, 17, 10, 0, 0, tzinfo=UTC)


def make_asset(**over) -> ResolvedAsset:
    base = dict(
        id="btc",
        label="Bitcoin",
        provider="coingecko",
        symbol="bitcoin",
        currency="usd",
        lower=Decimal("55000"),
        upper=Decimal("95000"),
        cooldown_minutes=180,
        hysteresis_pct=Decimal("0.25"),
        notify_on_return=True,
        renotify_while_outside=False,
        notify_transient=False,
        max_staleness_minutes=240,
        first_run_policy="summary",
        fallback=None,
    )
    base.update(over)
    return ResolvedAsset(**base)


def make_state(cfg: ResolvedAsset, zone: Zone | None, **over) -> AssetState:
    """Estado previo coherente con `cfg` (huella incluida, si no sería frío)."""
    return AssetState(
        zone=zone,
        config_fingerprint=cfg.fingerprint() if zone is not None else None,
        **over,
    )


def make_quote(cfg: ResolvedAsset, price: str, at: datetime = T0) -> Quote:
    return Quote(
        asset_id=cfg.id,
        price=Decimal(price),
        currency=cfg.currency,
        as_of=at,
        provider=cfg.provider,
    )


@pytest.fixture
def cfg() -> ResolvedAsset:
    return make_asset()
