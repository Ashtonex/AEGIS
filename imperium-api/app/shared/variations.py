"""Variation numbering and normalisation shared by every place that records a
variation (Finance, the project workspace and Site Operations), so they all
land in finance.variations the same way and show up everywhere that reads it
(project financials, cost to complete, client portal, final accounts)."""

from __future__ import annotations

import re
from typing import Any, Optional
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

INITIATED_BY = {"client", "contractor", "designer", "statutory"}
_INITIATED_ALIASES = {
    "site": "contractor",
    "site_team": "contractor",
    "internal": "contractor",
    "snc": "contractor",
    "consultant": "designer",
    "architect": "designer",
    "engineer": "designer",
    "council": "statutory",
    "authority": "statutory",
}


def normalise_initiated_by(value: Optional[str]) -> str:
    """finance.variations only accepts client/contractor/designer/statutory;
    forms have sent 'site', which the check constraint rejected."""
    key = (value or "contractor").strip().lower()
    return key if key in INITIATED_BY else _INITIATED_ALIASES.get(key, "contractor")


async def next_variation_number(db: AsyncSession, org_id: str, project_id: UUID) -> str:
    """VAR-<first 8 of project id>-NNN, one series per project (the format
    weekly-budget variances already use). Takes the highest existing suffix,
    deleted rows included, because the number is unique per organisation."""
    prefix = f"VAR-{str(project_id)[:8].upper()}-"
    rows = await db.execute(
        text("""
        SELECT variation_number FROM finance.variations
        WHERE organization_id = :org_id AND variation_number LIKE :pattern
    """),
        {"org_id": org_id, "pattern": f"{prefix}%"},
    )
    highest = 0
    for (number,) in rows:
        match = re.search(r"-(\d+)$", number or "")
        if match:
            highest = max(highest, int(match.group(1)))
    return f"{prefix}{highest + 1:03d}"


def signed_cost(cost_impact: Any, variation_type: Optional[str]) -> float:
    """An omission reduces the contract sum; record it as a negative impact."""
    amount = float(cost_impact or 0)
    if (variation_type or "").lower() == "omission":
        return -abs(amount)
    return amount
