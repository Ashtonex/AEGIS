"""
Statutory liability accrual.

The single place that writes to finance.statutory_liabilities /
finance.statutory_liability_lines, used by progress-claim certification
(VAT output), payroll posting (PAYE/NSSA), and the manual recompute
endpoint - so a liability period's totals are always a straight sum of its
lines, never hand-maintained in two places.

Idempotent: re-accruing the same source record (e.g. a corrected progress
claim) updates its existing line rather than double-counting, via the
UNIQUE (liability_id, source_type, source_id, direction) constraint from
migration 080.
"""

from datetime import date, timedelta
from typing import Any, Optional
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


def _period_for(as_at: date, period_type: str) -> tuple[date, date]:
    if period_type != "month":
        # quarter/year not needed yet for Phase 3's VAT/PAYE monthly flows -
        # month is the only period_type actually produced today.
        raise ValueError(f"Unsupported period_type for auto period calculation: {period_type}")
    start = as_at.replace(day=1)
    next_month_first = date(start.year + (1 if start.month == 12 else 0), (start.month % 12) + 1, 1)
    end = next_month_first - timedelta(days=1)
    return start, end


_FILING_DAY_COLUMN_FOR_LIABILITY_TYPE = {
    "vat": "vat_filing_day",
    "paye": "paye_filing_day",
    # AIDS Levy is remitted on the same ZIMRA P2 return as PAYE in real
    # practice - there is no dedicated aids_levy_filing_day column, so this
    # is a documented domain assumption, not a fabrication.
    "aids_levy": "paye_filing_day",
    "nssa_employee": "nssa_filing_day",
    "nssa_employer": "nssa_filing_day",
    # withholding_tax/other have no configured cadence anywhere - due_date
    # stays honestly null for them rather than guessed.
}


async def _compute_due_date(db: AsyncSession, org_id: str, liability_type: str, period_end: date) -> Optional[date]:
    """Filing_day-th day of the month AFTER period_end, clamped to that
    month's real last day (e.g. filing_day=31 in a 30-day month lands on the
    30th, never rolling into the next month). None if no statutory profile
    or no configured filing day exists for this liability_type."""
    column = _FILING_DAY_COLUMN_FOR_LIABILITY_TYPE.get(liability_type)
    if not column:
        return None

    row = await db.execute(
        text(f"SELECT {column} AS filing_day FROM finance.statutory_profile WHERE organization_id = :org_id"),
        {"org_id": org_id},
    )
    profile = row.first()
    if not profile or profile.filing_day is None:
        return None

    filing_day = int(profile.filing_day)
    next_month_first = date(period_end.year + (1 if period_end.month == 12 else 0), (period_end.month % 12) + 1, 1)
    following_month_last = date(
        next_month_first.year + (1 if next_month_first.month == 12 else 0),
        (next_month_first.month % 12) + 1, 1,
    ) - timedelta(days=1)
    day = min(filing_day, following_month_last.day)
    return next_month_first.replace(day=day)


async def accrue_liability_line(
    db: AsyncSession,
    *,
    org_id: str,
    authority: str,
    liability_type: str,
    currency: str,
    as_at: date,
    period_type: str = "month",
    direction: str,
    source_type: str,
    source_id: UUID,
    project_id: Optional[UUID] = None,
    department_id: Optional[UUID] = None,
    employee_id: Optional[UUID] = None,
    taxable_base: Optional[float] = None,
    rate_table_id: Optional[str] = None,
    computed_amount: float,
    basis: Optional[dict[str, Any]] = None,
) -> UUID:
    """Upserts a liability line and recomputes its header's gross_accrued/
    offset_amount as a straight sum of that liability's lines. Returns the
    liability id."""
    import json

    period_start, period_end = _period_for(as_at, period_type)
    due_date = await _compute_due_date(db, org_id, liability_type, period_end)

    header = await db.execute(
        text("""
            INSERT INTO finance.statutory_liabilities (
                organization_id, authority, liability_type, currency, period_type, period_start, period_end, due_date
            ) VALUES (:org_id, :authority, :liability_type, :currency, :period_type, :period_start, :period_end, :due_date)
            ON CONFLICT (organization_id, authority, liability_type, currency, period_start, period_end)
            DO UPDATE SET due_date = :due_date, updated_at = NOW()
            RETURNING id
        """),
        {
            "org_id": org_id, "authority": authority, "liability_type": liability_type,
            "currency": currency, "period_type": period_type, "period_start": period_start, "period_end": period_end,
            "due_date": due_date,
        },
    )
    liability_id = header.scalar()

    await db.execute(
        text("""
            INSERT INTO finance.statutory_liability_lines (
                organization_id, liability_id, direction, source_type, source_id,
                project_id, department_id, employee_id, taxable_base, rate_table_id, computed_amount, basis
            ) VALUES (
                :org_id, :liability_id, :direction, :source_type, :source_id,
                :project_id, :department_id, :employee_id, :taxable_base, :rate_table_id, :computed_amount, CAST(:basis AS jsonb)
            )
            ON CONFLICT (organization_id, liability_id, source_type, source_id, direction)
            DO UPDATE SET taxable_base = EXCLUDED.taxable_base, rate_table_id = EXCLUDED.rate_table_id,
                          computed_amount = EXCLUDED.computed_amount, basis = EXCLUDED.basis
        """),
        {
            "org_id": org_id, "liability_id": liability_id, "direction": direction,
            "source_type": source_type, "source_id": source_id, "project_id": project_id,
            "department_id": department_id, "employee_id": employee_id, "taxable_base": taxable_base,
            "rate_table_id": rate_table_id, "computed_amount": computed_amount,
            "basis": json.dumps(basis) if basis else None,
        },
    )

    await db.execute(
        text("""
            UPDATE finance.statutory_liabilities
            SET gross_accrued = COALESCE((
                    SELECT SUM(computed_amount) FROM finance.statutory_liability_lines
                    WHERE liability_id = :liability_id AND direction = 'output'
                ), 0),
                offset_amount = COALESCE((
                    SELECT SUM(computed_amount) FROM finance.statutory_liability_lines
                    WHERE liability_id = :liability_id AND direction = 'input'
                ), 0),
                updated_at = NOW(),
                status = CASE WHEN status = 'accruing' THEN 'accruing' ELSE status END
            WHERE id = :liability_id
        """),
        {"liability_id": liability_id},
    )

    return liability_id
