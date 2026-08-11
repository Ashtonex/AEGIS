"""Statutory (ZIMRA/NSSA) rate tables + liability ledger.

Rate tables are pure reference data (finance.tax_rate_tables/_bands,
migration 079) - editing them never touches a computation directly, only
what future computations resolve to. The liability ledger (migration 080)
is the actual "what do we owe right now" tracker, built from real source
records (progress claims, payroll items, supplier invoices) via the
recompute endpoint below and the real-time accrual calls already wired
into progress-claim certification and payroll posting.
"""

from datetime import date
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.security import require_permission
from app.shared.pagination import ok
from app.services.finance.statutory_accrual import accrue_liability_line

router = APIRouter()


# ---------------------------------------------------------------------------
# Rate tables
# ---------------------------------------------------------------------------

class RateBandInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    band_order: int
    lower_bound: float = 0
    upper_bound: Optional[float] = None
    rate_pct: float
    fixed_deduction: float = 0
    band_cap_amount: Optional[float] = None
    notes: Optional[str] = None


class RateTableCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    tax_type: str = Field(min_length=1, max_length=30)
    currency: str = Field(min_length=3, max_length=3)
    period_basis: str = Field(min_length=1, max_length=20)
    effective_from: date
    effective_to: Optional[date] = None
    name: Optional[str] = None
    source_reference: Optional[str] = None
    bands: list[RateBandInput] = Field(min_length=1)


@router.get("/rate-tables")
async def list_rate_tables(
    tax_type: Optional[str] = None,
    currency: Optional[str] = None,
    user: dict = Depends(require_permission("finance.tax_rate.read")),
    db: AsyncSession = Depends(get_db),
):
    query_str = "SELECT * FROM finance.tax_rate_tables WHERE organization_id = :org_id AND is_deleted = false"
    params: dict = {"org_id": user["org_id"]}
    if tax_type:
        query_str += " AND tax_type = :tax_type"
        params["tax_type"] = tax_type
    if currency:
        query_str += " AND currency = :currency"
        params["currency"] = currency
    query_str += " ORDER BY tax_type, currency, effective_from DESC"
    result = await db.execute(text(query_str), params)
    return ok([dict(r._mapping) for r in result], "Rate tables listed.")


@router.get("/rate-tables/active")
async def get_active_rate_table(
    tax_type: str,
    currency: str = "USD",
    as_at: Optional[date] = None,
    user: dict = Depends(require_permission("finance.tax_rate.read")),
    db: AsyncSession = Depends(get_db),
):
    as_at = as_at or date.today()
    header = await db.execute(
        text("""
            SELECT * FROM finance.tax_rate_tables
            WHERE organization_id = :org_id AND tax_type = :tax_type AND currency = :currency
              AND is_active = true AND is_deleted = false
              AND effective_from <= :as_at AND (effective_to IS NULL OR effective_to >= :as_at)
            ORDER BY effective_from DESC LIMIT 1
        """),
        {"org_id": user["org_id"], "tax_type": tax_type, "currency": currency, "as_at": as_at},
    )
    row = header.mappings().first()
    if not row:
        return ok(None, "No active rate table configured for this tax type/currency/date.")
    bands = await db.execute(
        text("SELECT * FROM finance.tax_rate_bands WHERE rate_table_id = :id ORDER BY band_order"),
        {"id": row["id"]},
    )
    return ok({**dict(row), "bands": [dict(b._mapping) for b in bands]}, "Active rate table retrieved.")


@router.get("/rate-tables/{table_id}")
async def get_rate_table(
    table_id: UUID,
    user: dict = Depends(require_permission("finance.tax_rate.read")),
    db: AsyncSession = Depends(get_db),
):
    header = await db.execute(
        text("SELECT * FROM finance.tax_rate_tables WHERE id = :id AND organization_id = :org_id AND is_deleted = false"),
        {"id": table_id, "org_id": user["org_id"]},
    )
    row = header.mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Rate table not found.")
    bands = await db.execute(
        text("SELECT * FROM finance.tax_rate_bands WHERE rate_table_id = :id ORDER BY band_order"),
        {"id": table_id},
    )
    return ok({**dict(row), "bands": [dict(b._mapping) for b in bands]}, "Rate table retrieved.")


@router.post("/rate-tables", status_code=status.HTTP_201_CREATED)
async def create_rate_table(
    payload: RateTableCreate,
    user: dict = Depends(require_permission("finance.tax_rate.manage")),
    db: AsyncSession = Depends(get_db),
):
    """
    Bands are immutable once used by a real computation (a liability line
    referencing this table) - to correct a rate, create a new effective-
    dated table rather than editing an old one, so history never silently
    restates.
    """
    try:
        table_id = (
            await db.execute(
                text("""
                    INSERT INTO finance.tax_rate_tables (
                        organization_id, tax_type, currency, period_basis, effective_from,
                        effective_to, name, source_reference, created_by
                    ) VALUES (
                        :org_id, :tax_type, :currency, :period_basis, :effective_from,
                        :effective_to, :name, :source_reference, :user_id
                    ) RETURNING id
                """),
                {
                    "org_id": user["org_id"], "tax_type": payload.tax_type, "currency": payload.currency,
                    "period_basis": payload.period_basis, "effective_from": payload.effective_from,
                    "effective_to": payload.effective_to, "name": payload.name,
                    "source_reference": payload.source_reference, "user_id": user["sub"],
                },
            )
        ).scalar()

        for band in payload.bands:
            await db.execute(
                text("""
                    INSERT INTO finance.tax_rate_bands (
                        organization_id, rate_table_id, band_order, lower_bound, upper_bound,
                        rate_pct, fixed_deduction, band_cap_amount, notes
                    ) VALUES (
                        :org_id, :table_id, :band_order, :lower_bound, :upper_bound,
                        :rate_pct, :fixed_deduction, :band_cap_amount, :notes
                    )
                """),
                {
                    "org_id": user["org_id"], "table_id": table_id, "band_order": band.band_order,
                    "lower_bound": band.lower_bound, "upper_bound": band.upper_bound,
                    "rate_pct": band.rate_pct, "fixed_deduction": band.fixed_deduction,
                    "band_cap_amount": band.band_cap_amount, "notes": band.notes,
                },
            )
        await db.commit()
        return ok({"id": str(table_id)}, "Rate table created.")
    except Exception as exc:
        await db.rollback()
        raise HTTPException(status_code=409, detail=f"Could not create rate table: {exc}") from exc


@router.post("/rate-tables/{table_id}/deactivate")
async def deactivate_rate_table(
    table_id: UUID,
    user: dict = Depends(require_permission("finance.tax_rate.manage")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        text("""
            UPDATE finance.tax_rate_tables SET is_active = false, updated_at = NOW()
            WHERE id = :id AND organization_id = :org_id AND is_deleted = false
            RETURNING id
        """),
        {"id": table_id, "org_id": user["org_id"]},
    )
    if not result.first():
        raise HTTPException(status_code=404, detail="Rate table not found.")
    await db.commit()
    return ok({"id": str(table_id)}, "Rate table deactivated.")


# ---------------------------------------------------------------------------
# Liability ledger
# ---------------------------------------------------------------------------

@router.get("/liabilities")
async def list_liabilities(
    authority: Optional[str] = None,
    liability_type: Optional[str] = None,
    status_filter: Optional[str] = Query(default=None, alias="status"),
    department_id: Optional[UUID] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    user: dict = Depends(require_permission("finance.statutory.read")),
    db: AsyncSession = Depends(get_db),
):
    filters = ["l.organization_id = :org_id", "l.is_deleted = false"]
    params: dict = {"org_id": user["org_id"]}
    if authority:
        filters.append("l.authority = :authority")
        params["authority"] = authority
    if liability_type:
        filters.append("l.liability_type = :liability_type")
        params["liability_type"] = liability_type
    if status_filter:
        filters.append("l.status = :status")
        params["status"] = status_filter
    if date_from:
        filters.append("l.period_start >= :date_from")
        params["date_from"] = date_from
    if date_to:
        filters.append("l.period_end <= :date_to")
        params["date_to"] = date_to
    if department_id:
        filters.append("""EXISTS (
            SELECT 1 FROM finance.statutory_liability_lines ln
            WHERE ln.liability_id = l.id AND ln.department_id = :department_id
        )""")
        params["department_id"] = department_id

    where = " AND ".join(filters)
    result = await db.execute(
        text(f"SELECT l.* FROM finance.statutory_liabilities l WHERE {where} ORDER BY l.period_start DESC, l.liability_type"),
        params,
    )
    return ok([dict(r._mapping) for r in result], "Statutory liabilities listed.")


@router.get("/liabilities/{liability_id}")
async def get_liability(
    liability_id: UUID,
    user: dict = Depends(require_permission("finance.statutory.read")),
    db: AsyncSession = Depends(get_db),
):
    header = await db.execute(
        text("SELECT * FROM finance.statutory_liabilities WHERE id = :id AND organization_id = :org_id AND is_deleted = false"),
        {"id": liability_id, "org_id": user["org_id"]},
    )
    row = header.mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Liability not found.")
    lines = await db.execute(
        text("""
            SELECT ln.*, d.name AS department_name
            FROM finance.statutory_liability_lines ln
            LEFT JOIN finance.departments d ON d.id = ln.department_id
            WHERE ln.liability_id = :id ORDER BY ln.created_at
        """),
        {"id": liability_id},
    )
    settlements = await db.execute(
        text("SELECT * FROM finance.statutory_settlements WHERE liability_id = :id ORDER BY payment_date DESC"),
        {"id": liability_id},
    )
    return ok(
        {"liability": dict(row), "lines": [dict(r._mapping) for r in lines], "settlements": [dict(r._mapping) for r in settlements]},
        "Liability retrieved.",
    )


@router.post("/liabilities/{liability_id}/file")
async def file_liability(
    liability_id: UUID,
    filing_reference: Optional[str] = None,
    user: dict = Depends(require_permission("finance.statutory.file")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        text("""
            UPDATE finance.statutory_liabilities
            SET status = 'filed', filed_by = :user_id, filed_at = NOW(), filing_reference = :ref, updated_at = NOW()
            WHERE id = :id AND organization_id = :org_id AND is_deleted = false
            RETURNING id
        """),
        {"id": liability_id, "org_id": user["org_id"], "user_id": user["sub"], "ref": filing_reference},
    )
    if not result.first():
        raise HTTPException(status_code=404, detail="Liability not found.")
    await db.commit()
    return ok({"id": str(liability_id)}, "Liability marked filed.")


class SettlementCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    payment_date: date
    amount: float = Field(gt=0)
    cash_account_id: Optional[UUID] = None
    reference: Optional[str] = None
    notes: Optional[str] = None


@router.post("/liabilities/{liability_id}/settle", status_code=status.HTTP_201_CREATED)
async def settle_liability(
    liability_id: UUID,
    payload: SettlementCreate,
    user: dict = Depends(require_permission("finance.statutory.settle")),
    db: AsyncSession = Depends(get_db),
):
    liability = await db.execute(
        text("SELECT * FROM finance.statutory_liabilities WHERE id = :id AND organization_id = :org_id AND is_deleted = false"),
        {"id": liability_id, "org_id": user["org_id"]},
    )
    liability_row = liability.mappings().first()
    if not liability_row:
        raise HTTPException(status_code=404, detail="Liability not found.")

    cashbook_tx_id = None
    if payload.cash_account_id:
        cashbook_tx_id = (
            await db.execute(
                text("""
                    INSERT INTO finance.cashbook_transactions (
                        organization_id, cash_account_id, transaction_number, transaction_date,
                        transaction_type, direction, amount, currency, description,
                        source_type, source_id, posted_by
                    ) VALUES (
                        :org_id, :cash_account_id, :tx_number, :payment_date,
                        'payment', 'outflow', :amount, :currency, :desc,
                        'statutory_settlement', :liability_id, :user_id
                    ) RETURNING id
                """),
                {
                    "org_id": user["org_id"], "cash_account_id": payload.cash_account_id,
                    "tx_number": f"STAT-{liability_row['liability_type'].upper()}-{liability_id}"[:40],
                    "payment_date": payload.payment_date, "amount": payload.amount,
                    "currency": liability_row["currency"],
                    "desc": f"{liability_row['authority'].upper()} {liability_row['liability_type']} settlement",
                    "liability_id": liability_id, "user_id": user["sub"],
                },
            )
        ).scalar()
        await db.execute(
            text("UPDATE finance.cash_accounts SET current_balance = current_balance - :amount WHERE id = :id"),
            {"amount": payload.amount, "id": payload.cash_account_id},
        )

    settlement_id = (
        await db.execute(
            text("""
                INSERT INTO finance.statutory_settlements (
                    organization_id, liability_id, cashbook_transaction_id, payment_date, amount, reference, notes, created_by
                ) VALUES (:org_id, :liability_id, :cashbook_tx_id, :payment_date, :amount, :reference, :notes, :user_id)
                RETURNING id
            """),
            {
                "org_id": user["org_id"], "liability_id": liability_id, "cashbook_tx_id": cashbook_tx_id,
                "payment_date": payload.payment_date, "amount": payload.amount,
                "reference": payload.reference, "notes": payload.notes, "user_id": user["sub"],
            },
        )
    ).scalar()

    await db.execute(
        text("""
            UPDATE finance.statutory_liabilities
            SET settled_amount = settled_amount + :amount, updated_at = NOW(),
                status = CASE
                    WHEN settled_amount + :amount >= (gross_accrued - offset_amount) THEN 'paid'
                    ELSE 'part_paid'
                END
            WHERE id = :id
        """),
        {"amount": payload.amount, "id": liability_id},
    )

    await db.commit()
    return ok({"id": str(settlement_id)}, "Settlement recorded.")


@router.get("/summary")
async def statutory_summary(
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    user: dict = Depends(require_permission("finance.statutory.read")),
    db: AsyncSession = Depends(get_db),
):
    """Org-wide VAT/PAYE/NSSA rollup - the "what do we owe right now"
    view that didn't exist anywhere before Phase 3."""
    filters = ["organization_id = :org_id", "is_deleted = false"]
    params: dict = {"org_id": user["org_id"]}
    if date_from:
        filters.append("period_start >= :date_from")
        params["date_from"] = date_from
    if date_to:
        filters.append("period_end <= :date_to")
        params["date_to"] = date_to
    where = " AND ".join(filters)
    result = await db.execute(
        text(f"""
            SELECT authority, liability_type, currency,
                   SUM(gross_accrued) AS gross_accrued, SUM(offset_amount) AS offset_amount,
                   SUM(settled_amount) AS settled_amount, SUM(outstanding_amount) AS outstanding_amount,
                   MIN(due_date) AS next_due_date
            FROM finance.statutory_liabilities
            WHERE {where}
            GROUP BY authority, liability_type, currency
            ORDER BY authority, liability_type
        """),
        params,
    )
    return ok([dict(r._mapping) for r in result], "Statutory summary retrieved.")


# ---------------------------------------------------------------------------
# Recompute - the idempotent reconciler
# ---------------------------------------------------------------------------

class RecomputePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    period_start: date
    period_end: date
    currency: str = "USD"


@router.post("/recompute")
async def recompute_statutory(
    payload: RecomputePayload,
    user: dict = Depends(require_permission("finance.statutory.manage")),
    db: AsyncSession = Depends(get_db),
):
    """
    Re-derives liability lines for a period from source records, regardless
    of whether they already accrued in real time - safe to re-run any
    number of times (idempotent upsert on each source record). This is the
    reconciler of record: real-time accrual on certify/post is a
    convenience layer, this is what makes a period's numbers trustworthy
    even for data that was hand-loaded or backfilled.
    """
    org_id = user["org_id"]
    accrued_count = 0

    # Output VAT: certified progress claims in the period.
    claims = await db.execute(
        text("""
            SELECT pc.id, pc.certified_amount, pc.vat_amount, pc.vat_rate_table_id, pc.certified_at,
                   pc.project_id, p.department_id
            FROM finance.progress_claims pc
            JOIN projects.projects p ON p.id = pc.project_id
            WHERE pc.organization_id = :org_id AND pc.is_deleted = false AND pc.status IN ('certified', 'invoiced', 'paid')
              AND pc.certified_at::date >= :period_start AND pc.certified_at::date <= :period_end
              AND pc.vat_amount > 0
        """),
        {"org_id": org_id, "period_start": payload.period_start, "period_end": payload.period_end},
    )
    for row in claims.mappings():
        await accrue_liability_line(
            db, org_id=org_id, authority="zimra", liability_type="vat", currency=payload.currency,
            as_at=row["certified_at"].date() if hasattr(row["certified_at"], "date") else row["certified_at"],
            direction="output", source_type="progress_claim", source_id=row["id"],
            project_id=row["project_id"], department_id=row["department_id"],
            taxable_base=float(row["certified_amount"]), rate_table_id=row["vat_rate_table_id"],
            computed_amount=float(row["vat_amount"]),
        )
        accrued_count += 1

    # Input VAT: claimable supplier invoices in the period.
    invoices = await db.execute(
        text("""
            SELECT id, tax_amount, subtotal, invoice_date, project_id
            FROM procurement.supplier_invoices
            WHERE organization_id = :org_id AND is_deleted = false AND input_vat_claimable = true
              AND tax_amount > 0 AND invoice_date >= :period_start AND invoice_date <= :period_end
        """),
        {"org_id": org_id, "period_start": payload.period_start, "period_end": payload.period_end},
    )
    for row in invoices.mappings():
        await accrue_liability_line(
            db, org_id=org_id, authority="zimra", liability_type="vat", currency=payload.currency,
            as_at=row["invoice_date"], direction="input", source_type="supplier_invoice", source_id=row["id"],
            project_id=row["project_id"], taxable_base=float(row["subtotal"] or 0),
            computed_amount=float(row["tax_amount"]),
        )
        accrued_count += 1

    # PAYE/NSSA: posted payroll items in the period.
    items = await db.execute(
        text("""
            SELECT pi.id, pi.employee_id, pi.department_id, pi.paye_amount, pi.nssa_employee_amount,
                   pi.nssa_employer_amount, pi.taxable_gross, pi.rate_table_id, pr.payment_date
            FROM finance.payroll_items pi
            JOIN finance.payroll_runs pr ON pr.id = pi.payroll_run_id
            WHERE pi.organization_id = :org_id AND pr.status = 'posted'
              AND pr.payment_date >= :period_start AND pr.payment_date <= :period_end
        """),
        {"org_id": org_id, "period_start": payload.period_start, "period_end": payload.period_end},
    )
    for row in items.mappings():
        common = {
            "db": db, "org_id": org_id, "currency": payload.currency, "as_at": row["payment_date"],
            "source_type": "payroll_item", "source_id": row["id"], "direction": "output",
            "department_id": row["department_id"], "employee_id": row["employee_id"],
            "taxable_base": float(row["taxable_gross"]) if row["taxable_gross"] is not None else None,
            "rate_table_id": row["rate_table_id"],
        }
        if row["paye_amount"] and float(row["paye_amount"]) > 0:
            await accrue_liability_line(authority="zimra", liability_type="paye", computed_amount=float(row["paye_amount"]), **common)
            accrued_count += 1
        if row["nssa_employee_amount"] and float(row["nssa_employee_amount"]) > 0:
            await accrue_liability_line(authority="nssa", liability_type="nssa_employee", computed_amount=float(row["nssa_employee_amount"]), **common)
            accrued_count += 1
        if row["nssa_employer_amount"] and float(row["nssa_employer_amount"]) > 0:
            await accrue_liability_line(authority="nssa", liability_type="nssa_employer", computed_amount=float(row["nssa_employer_amount"]), **common)
            accrued_count += 1

    await db.commit()
    return ok({"lines_accrued": accrued_count}, f"Recomputed {accrued_count} statutory lines for the period.")
