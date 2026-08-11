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

from datetime import date
from typing import Any, Optional
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


def _period_for(as_at: date, period_type: str) -> tuple[date, date]:
    if period_type != "month":
        # quarter/year not needed yet for Phase 3's VAT/PAYE monthly flows -
        # month is the only period_type actually produced today.
        raise ValueError(f"Unsupported period_type for auto period calculation: {period_type}")
    from datetime import timedelta
    start = as_at.replace(day=1)
    next_month_first = date(start.year + (1 if start.month == 12 else 0), (start.month % 12) + 1, 1)
    end = next_month_first - timedelta(days=1)
    return start, end


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

    header = await db.execute(
        text("""
            INSERT INTO finance.statutory_liabilities (
                organization_id, authority, liability_type, currency, period_type, period_start, period_end
            ) VALUES (:org_id, :authority, :liability_type, :currency, :period_type, :period_start, :period_end)
            ON CONFLICT (organization_id, authority, liability_type, currency, period_start, period_end)
            DO UPDATE SET updated_at = NOW()
            RETURNING id
        """),
        {
            "org_id": org_id, "authority": authority, "liability_type": liability_type,
            "currency": currency, "period_type": period_type, "period_start": period_start, "period_end": period_end,
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
