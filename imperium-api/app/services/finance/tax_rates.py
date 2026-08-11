"""
Statutory tax rate resolution.

Rates/brackets live as data (finance.tax_rate_tables + finance.tax_rate_bands,
migration 079), not code constants, so a rate change never needs a deploy.
This module is the only place that reads them for a computation - payroll
tax (app/services/finance/payroll_tax.py) and VAT accrual both go through
here so there is exactly one source of truth for "what rate applies right
now."

No fallback to a hardcoded rate on a missing table, ever: a silently wrong
tax figure is a compliance failure, not a degraded feature. Callers must
handle NoRateTableError explicitly (the payroll/VAT flows turn it into a
clear 422 telling the user which rate table to configure).
"""

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


class NoRateTableError(Exception):
    """Raised when no active rate table covers the requested tax_type/
    currency/date. Never silently substituted with a zero or legacy rate."""

    def __init__(self, tax_type: str, currency: str, as_at: date):
        self.tax_type = tax_type
        self.currency = currency
        self.as_at = as_at
        super().__init__(
            f"No active {tax_type} rate table effective {as_at.isoformat()} for {currency} - "
            f"configure one under Finance -> Statutory -> Rate Tables."
        )


@dataclass
class RateBand:
    band_order: int
    lower_bound: Decimal
    upper_bound: Optional[Decimal]
    rate_pct: Decimal
    fixed_deduction: Decimal
    band_cap_amount: Optional[Decimal]


@dataclass
class RateTable:
    id: str
    tax_type: str
    currency: str
    period_basis: str
    bands: list[RateBand]


async def resolve_rate_table(
    db: AsyncSession, *, org_id: str, tax_type: str, currency: str, as_at: date
) -> RateTable:
    """The active rate table (with its bands, ordered) for this tax type/
    currency as of a given date. Raises NoRateTableError if none exists -
    callers must not catch this and fall back to a guessed rate."""
    header = await db.execute(
        text("""
            SELECT id, tax_type, currency, period_basis
            FROM finance.tax_rate_tables
            WHERE organization_id = :org_id AND tax_type = :tax_type AND currency = :currency
              AND is_active = true AND is_deleted = false
              AND effective_from <= :as_at
              AND (effective_to IS NULL OR effective_to >= :as_at)
            ORDER BY effective_from DESC
            LIMIT 1
        """),
        {"org_id": org_id, "tax_type": tax_type, "currency": currency, "as_at": as_at},
    )
    row = header.mappings().first()
    if not row:
        raise NoRateTableError(tax_type, currency, as_at)

    bands_result = await db.execute(
        text("""
            SELECT band_order, lower_bound, upper_bound, rate_pct, fixed_deduction, band_cap_amount
            FROM finance.tax_rate_bands
            WHERE organization_id = :org_id AND rate_table_id = :table_id
            ORDER BY band_order ASC
        """),
        {"org_id": org_id, "table_id": row["id"]},
    )
    bands = [
        RateBand(
            band_order=b["band_order"],
            lower_bound=Decimal(str(b["lower_bound"])),
            upper_bound=Decimal(str(b["upper_bound"])) if b["upper_bound"] is not None else None,
            rate_pct=Decimal(str(b["rate_pct"])),
            fixed_deduction=Decimal(str(b["fixed_deduction"])),
            band_cap_amount=Decimal(str(b["band_cap_amount"])) if b["band_cap_amount"] is not None else None,
        )
        for b in bands_result.mappings()
    ]
    if not bands:
        raise NoRateTableError(tax_type, currency, as_at)

    return RateTable(id=str(row["id"]), tax_type=row["tax_type"], currency=row["currency"], period_basis=row["period_basis"], bands=bands)


def apply_bracket_table(table: RateTable, taxable: Decimal) -> Decimal:
    """PAYE-style bracket lookup: finds the single band the taxable amount
    falls into and applies that band's rate with its published "deduct $X"
    offset (result = taxable * rate% - fixed_deduction). This is how real
    ZIMRA PAYE tables are published - the fixed_deduction already accounts
    for the lower brackets, so a single lookup is mathematically equivalent
    to (and simpler than) re-summing every band from zero. Bands must be
    ordered by band_order with ascending, non-overlapping ranges."""
    if taxable <= 0:
        return Decimal("0")
    for band in table.bands:
        if taxable >= band.lower_bound and (band.upper_bound is None or taxable < band.upper_bound):
            amount = (taxable * band.rate_pct / Decimal("100")) - band.fixed_deduction
            return max(Decimal("0"), amount)
    # Taxable amount falls below the lowest band's lower_bound (e.g. a
    # tax-free threshold with no explicit zero-rate band) - no tax due.
    return Decimal("0")


def apply_flat_with_cap(table: RateTable, base: Decimal) -> Decimal:
    """NSSA-style flat rate: caps the BASE at the band's upper_bound
    (insurable earnings ceiling) if set, applies the rate, then caps the
    resulting CONTRIBUTION at band_cap_amount if set. Capping the base and
    capping the contribution are different things and NSSA-style schemes
    can use either or both, so this expresses both explicitly rather than
    picking one."""
    if base <= 0 or not table.bands:
        return Decimal("0")
    band = table.bands[0]
    capped_base = min(base, band.upper_bound) if band.upper_bound is not None else base
    contribution = capped_base * band.rate_pct / Decimal("100")
    if band.band_cap_amount is not None:
        contribution = min(contribution, band.band_cap_amount)
    return max(Decimal("0"), contribution)
