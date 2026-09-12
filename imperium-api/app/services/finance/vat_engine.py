"""
VAT engine completion (Phase 8A).

Output VAT already accrues in real time today, via certify_progress_claim's
existing call into accrue_liability_line (authority='zimra',
liability_type='vat', direction='output'). This module adds the missing
symmetric half - real-time input VAT accrual plus a non-blocking compliance
check - and a read-only net-position view over data that's already correct.

Never recomputes what a supplier actually charged: tax_amount on a supplier
invoice is what's on the real invoice. The vat_input rate table is used only
as a reference to flag a suspicious mismatch, never to override the figure.
"""

from datetime import date, timedelta
from decimal import Decimal
from typing import Optional
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.finance import procurement_verification
from app.services.finance.statutory_accrual import accrue_liability_line
from app.services.finance.tax_rates import NoRateTableError, resolve_rate_table

INPUT_VAT_TOLERANCE_PCT = Decimal("0.01")
INPUT_VAT_TOLERANCE_ABS = Decimal("1.00")


def _current_period(vat_filing_frequency: Optional[str], today: date) -> tuple[date, date]:
    if vat_filing_frequency == "quarterly":
        quarter_start_month = ((today.month - 1) // 3) * 3 + 1
        start = today.replace(month=quarter_start_month, day=1)
        end_month = quarter_start_month + 2
        if end_month > 12:
            end = date(start.year + 1, end_month - 12, 1) - timedelta(days=1)
        else:
            next_month_first = date(start.year + (1 if end_month == 12 else 0), (end_month % 12) + 1, 1)
            end = next_month_first - timedelta(days=1)
        return start, end
    start = today.replace(day=1)
    next_month_first = date(start.year + (1 if start.month == 12 else 0), (start.month % 12) + 1, 1)
    end = next_month_first - timedelta(days=1)
    return start, end


async def get_vat_net_position(
    db: AsyncSession, *, org_id: str, period_start: Optional[date] = None, period_end: Optional[date] = None
) -> dict:
    period_not_specified = period_start is None or period_end is None
    filing_frequency = None
    is_fallback_period = False

    if period_not_specified:
        profile_row = await db.execute(
            text("SELECT vat_filing_frequency FROM finance.statutory_profile WHERE organization_id = :org_id"),
            {"org_id": org_id},
        )
        profile = profile_row.first()
        filing_frequency = profile.vat_filing_frequency if profile else None
        # "Fallback" specifically means no filing profile exists to derive a
        # real period from - a configured profile (even the default monthly
        # cadence) is not a fallback, it's the correct, honestly-sourced period.
        is_fallback_period = filing_frequency is None
        period_start, period_end = _current_period(filing_frequency, date.today())

    totals = await db.execute(
        text("""
            SELECT COALESCE(SUM(gross_accrued), 0) AS output_vat, COALESCE(SUM(offset_amount), 0) AS input_vat
            FROM finance.statutory_liabilities
            WHERE organization_id = :org_id AND liability_type = 'vat'
              AND period_start >= :period_start AND period_end <= :period_end
        """),
        {"org_id": org_id, "period_start": period_start, "period_end": period_end},
    )
    row = totals.mappings().first() or {"output_vat": 0, "input_vat": 0}
    output_vat = float(row["output_vat"] or 0)
    input_vat = float(row["input_vat"] or 0)

    return {
        "period_start": period_start,
        "period_end": period_end,
        "output_vat": output_vat,
        "input_vat": input_vat,
        "net_vat_payable": round(output_vat - input_vat, 2),
        "filing_frequency": filing_frequency,
        "is_fallback_period": is_fallback_period,
    }


async def accrue_input_vat(db: AsyncSession, *, org_id: str, invoice_id: UUID) -> None:
    """Additive, non-blocking - called alongside Phase 3A's verification
    hooks at the end of create_invoice. A failure here must never block
    invoice registration; the periodic /recompute reconciler is the safety
    net if this silently no-ops."""
    try:
        row = await db.execute(
            text("""
                SELECT id, invoice_date, subtotal, tax_amount, input_vat_claimable, project_id
                FROM procurement.supplier_invoices
                WHERE id = :id AND organization_id = :org_id
            """),
            {"id": invoice_id, "org_id": org_id},
        )
        inv = row.mappings().first()
        if not inv or not inv["input_vat_claimable"] or float(inv["tax_amount"] or 0) <= 0:
            return

        await accrue_liability_line(
            db, org_id=org_id, authority="zimra", liability_type="vat", currency="USD",
            as_at=inv["invoice_date"], direction="input",
            source_type="supplier_invoice", source_id=inv["id"],
            project_id=inv["project_id"], taxable_base=float(inv["subtotal"] or 0),
            computed_amount=float(inv["tax_amount"]),
        )
    except Exception:
        return


async def check_input_vat_rate_mismatch(db: AsyncSession, *, org_id: str, invoice_id: UUID) -> None:
    """Non-blocking advisory check, same shape as procurement_verification.py's
    checks - flags a suspicious deviation from the resolved vat_input rate,
    never overrides or blocks on it."""
    try:
        row = await db.execute(
            text("""
                SELECT id, project_id, invoice_date, subtotal, tax_amount, input_vat_claimable, supplier_invoice_ref
                FROM procurement.supplier_invoices
                WHERE id = :id AND organization_id = :org_id
            """),
            {"id": invoice_id, "org_id": org_id},
        )
        inv = row.mappings().first()
        if not inv or not inv["input_vat_claimable"]:
            return

        try:
            rate_table = await resolve_rate_table(db, org_id=org_id, tax_type="vat_input", currency="USD", as_at=inv["invoice_date"])
        except NoRateTableError:
            return

        subtotal = Decimal(str(inv["subtotal"] or 0))
        tax_amount = Decimal(str(inv["tax_amount"] or 0))
        expected_vat = (subtotal * rate_table.bands[0].rate_pct / Decimal("100")).quantize(Decimal("0.01"))
        tolerance = max(expected_vat * INPUT_VAT_TOLERANCE_PCT, INPUT_VAT_TOLERANCE_ABS)

        if abs(tax_amount - expected_vat) > tolerance:
            await procurement_verification.record_finding(
                db, org_id=org_id, project_id=str(inv["project_id"]),
                check_type="input_vat_rate_mismatch",
                natural_key=f"supplier_invoice:{invoice_id}:input_vat_mismatch",
                severity="medium",
                summary=f"Invoice {inv['supplier_invoice_ref']}'s VAT amount ({tax_amount}) differs from the expected {rate_table.bands[0].rate_pct}% rate applied to its subtotal ({expected_vat}).",
                evidence={"invoice_id": str(invoice_id), "tax_amount": str(tax_amount), "expected_vat": str(expected_vat), "rate_pct": str(rate_table.bands[0].rate_pct)},
            )
    except Exception:
        return
