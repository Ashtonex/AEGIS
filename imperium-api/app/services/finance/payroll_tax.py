"""
Payroll statutory tax computation.

Replaces the flat-rate placeholder in routers/payroll_runs.py::_compute_pay
(25% cliff above $500, 3%-capped-at-$5.40 NSSA - explicitly marked in that
code as "to be replaced with proper tax tables") with real lookups against
finance.tax_rate_tables (app/services/finance/tax_rates.py).

PAYE and employee NSSA are computed independently from gross - never as a
split of one combined "deductions" figure, which is how the old code
produced its arbitrary 90/10 tax_deduction/statutory_deduction split.
Employer NSSA and the AIDS levy are treated as best-effort (default to 0
if no rate table is configured) since neither reduces the employee's net
pay - only PAYE and employee NSSA hard-block a payroll run when missing,
because a silently-wrong deduction from someone's pay is the actual
compliance risk.
"""

from dataclasses import dataclass
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy.ext.asyncio import AsyncSession

from app.services.finance.tax_rates import (
    NoRateTableError,
    apply_bracket_table,
    apply_flat_with_cap,
    resolve_rate_table,
)

_CENTS = Decimal("0.01")


def _round(value: Decimal) -> Decimal:
    return value.quantize(_CENTS, rounding=ROUND_HALF_UP)


@dataclass
class StatutoryResult:
    paye: Decimal
    nssa_employee: Decimal
    nssa_employer: Decimal
    aids_levy: Decimal
    net_pay: Decimal
    paye_rate_table_id: str
    nssa_employee_rate_table_id: str


async def compute_statutory(
    db: AsyncSession, *, org_id: str, currency: str, as_at: date, gross_pay: Decimal
) -> StatutoryResult:
    """Computes PAYE, employee NSSA, employer NSSA and AIDS levy from real
    rate tables. Raises NoRateTableError (uncaught) if no PAYE or employee
    NSSA table is configured - the caller must not swallow this into a
    zero deduction; it should surface as a 422 telling the user which
    rate table to configure."""
    paye_table = await resolve_rate_table(db, org_id=org_id, tax_type="paye", currency=currency, as_at=as_at)
    nssa_ee_table = await resolve_rate_table(db, org_id=org_id, tax_type="nssa_employee", currency=currency, as_at=as_at)

    paye = _round(apply_bracket_table(paye_table, gross_pay))
    nssa_employee = _round(apply_flat_with_cap(nssa_ee_table, gross_pay))

    try:
        nssa_er_table = await resolve_rate_table(db, org_id=org_id, tax_type="nssa_employer", currency=currency, as_at=as_at)
        nssa_employer = _round(apply_flat_with_cap(nssa_er_table, gross_pay))
    except NoRateTableError:
        nssa_employer = Decimal("0")

    try:
        aids_table = await resolve_rate_table(db, org_id=org_id, tax_type="aids_levy", currency=currency, as_at=as_at)
        # AIDS levy is conventionally a percentage of the PAYE payable, not
        # of gross - expressed as a flat-with-cap lookup against the PAYE
        # amount so the exact rate stays data-driven.
        aids_levy = _round(apply_flat_with_cap(aids_table, paye))
    except NoRateTableError:
        aids_levy = Decimal("0")

    net_pay = max(Decimal("0"), gross_pay - paye - nssa_employee - aids_levy)

    return StatutoryResult(
        paye=paye,
        nssa_employee=nssa_employee,
        nssa_employer=nssa_employer,
        aids_levy=aids_levy,
        net_pay=_round(net_pay),
        paye_rate_table_id=paye_table.id,
        nssa_employee_rate_table_id=nssa_ee_table.id,
    )
