"""Finance operations workbench - /api/v1/finance/ops.

What the reworked Finance screens need that the older per-table endpoints
don't give them:

* /dashboard              - the Finance & Cost Control overview (cash flow by
                            month, cost mix, payables ageing, budget and claim
                            pipelines) in one call.
* /payables...            - every unpaid supplier invoice with its age, and
                            the actions Finance takes on one: pay it (alone or
                            with others), reject it, or ask the supplier for a
                            proper invoice. Each action leaves a
                            finance.payable_events row.
* /cost-codes/by-project  - cost codes as each project actually uses them:
                            budgeted amount from the project's approved budget
                            and actual spend from posted cost transactions.
* /budgets/draft-reminders - who a draft budget's reminder goes to, and a
                            send-now for Finance (the weekday cron lives in
                            app/workers/arq_worker.draft_budget_reminder_job).
* /site-payroll...        - hourly site labour that isn't on AEGIS or HR:
                            workers logged against a project, their hours, and
                            per-project site pay runs (draft -> approved ->
                            paid). Paying a run writes a cashbook payment and
                            a labour cost against the project.
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal
from html import escape
from typing import List, Literal, Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.finance import draft_budget_reminders
from app.shared.pagination import ok
from core.database import get_db
from core.email import send_email
from core.security import require_permission

router = APIRouter()

OPEN_INVOICE_STATUSES = ("received", "matching", "matched", "approved", "disputed")
AGE_BUCKETS = ("current", "1_30", "31_60", "61_90", "90_plus")
DEFAULT_TERMS_DAYS = 30


def _uid(user: dict) -> Optional[str]:
    return user.get("user_id") or user.get("sub")


def _d(value) -> Decimal:
    return Decimal(str(value or 0)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _bucket(days_overdue: int) -> str:
    if days_overdue <= 0:
        return "current"
    if days_overdue <= 30:
        return "1_30"
    if days_overdue <= 60:
        return "31_60"
    if days_overdue <= 90:
        return "61_90"
    return "90_plus"


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------


@router.get("/dashboard")
async def finance_dashboard(
    department_id: Optional[UUID] = None,
    months: int = Query(default=12, ge=3, le=24),
    user: dict = Depends(require_permission("finance.cost.read")),
    db: AsyncSession = Depends(get_db),
):
    org_id = user["org_id"]
    params = {"org_id": org_id, "department_id": department_id, "months": months}

    monthly = await db.execute(
        text("""
            WITH m AS (
                SELECT generate_series(
                    date_trunc('month', CURRENT_DATE) - make_interval(months => CAST(:months AS int) - 1),
                    date_trunc('month', CURRENT_DATE), interval '1 month')::date AS month
            )
            SELECT to_char(m.month, 'YYYY-MM') AS month,
                   COALESCE(SUM(ct.amount) FILTER (WHERE ct.direction = 'inflow'), 0) AS inflow,
                   COALESCE(SUM(ct.amount) FILTER (WHERE ct.direction = 'outflow'), 0) AS outflow
            FROM m
            LEFT JOIN finance.cashbook_transactions ct
              ON date_trunc('month', ct.transaction_date) = m.month
             AND ct.organization_id = :org_id AND ct.is_deleted = false
             AND ct.transaction_type NOT IN ('transfer_in', 'transfer_out')
             AND (CAST(:department_id AS uuid) IS NULL OR ct.department_id = CAST(:department_id AS uuid))
            GROUP BY m.month ORDER BY m.month
        """),
        params,
    )
    monthly_cash = [
        {"month": r.month, "inflow": float(r.inflow), "outflow": float(r.outflow), "net": float(r.inflow - r.outflow)}
        for r in monthly
    ]

    cost_mix = await db.execute(
        text("""
            SELECT ct.cost_category AS category, SUM(ct.amount) AS amount
            FROM finance.cost_transactions ct
            LEFT JOIN projects.projects p ON p.id = ct.project_id
            WHERE ct.organization_id = :org_id AND ct.status = 'posted'
              AND (CAST(:department_id AS uuid) IS NULL OR p.department_id = CAST(:department_id AS uuid))
            GROUP BY ct.cost_category ORDER BY 2 DESC
        """),
        params,
    )
    cost_by_category = [{"category": r.category, "amount": float(r.amount or 0)} for r in cost_mix]

    monthly_cost = await db.execute(
        text("""
            SELECT to_char(date_trunc('month', ct.transaction_date), 'YYYY-MM') AS month, ct.cost_category AS category,
                   SUM(ct.amount) AS amount
            FROM finance.cost_transactions ct
            LEFT JOIN projects.projects p ON p.id = ct.project_id
            WHERE ct.organization_id = :org_id AND ct.status = 'posted'
              AND ct.transaction_date >= date_trunc('month', CURRENT_DATE) - make_interval(months => CAST(:months AS int) - 1)
              AND (CAST(:department_id AS uuid) IS NULL OR p.department_id = CAST(:department_id AS uuid))
            GROUP BY 1, 2 ORDER BY 1
        """),
        params,
    )
    cost_by_month: dict[str, dict] = {}
    for r in monthly_cost:
        cost_by_month.setdefault(r.month, {"month": r.month})[r.category] = float(r.amount or 0)

    accounts = await db.execute(
        text("""
            SELECT account_name, account_type, is_petty_cash, current_balance
            FROM finance.cash_accounts
            WHERE organization_id = :org_id AND is_deleted = false AND is_active = true
            ORDER BY current_balance DESC
        """),
        params,
    )
    cash_accounts = [
        {"account_name": r.account_name, "account_type": r.account_type, "is_petty_cash": r.is_petty_cash,
         "balance": float(r.current_balance or 0)}
        for r in accounts
    ]

    budgets = await db.execute(
        text("""
            SELECT pb.status, COUNT(*) AS n, COALESCE(SUM(pb.total_amount), 0) AS amount
            FROM finance.project_budgets pb
            JOIN projects.projects p ON p.id = pb.project_id
            WHERE pb.organization_id = :org_id AND pb.is_deleted = false
              AND (CAST(:department_id AS uuid) IS NULL OR p.department_id = CAST(:department_id AS uuid))
            GROUP BY pb.status
        """),
        params,
    )
    budget_pipeline = {r.status: {"count": r.n, "amount": float(r.amount)} for r in budgets}

    claims = await db.execute(
        text("""
            SELECT pc.status, COUNT(*) AS n, COALESCE(SUM(pc.net_claim_amount), 0) AS amount
            FROM finance.progress_claims pc
            JOIN projects.projects p ON p.id = pc.project_id
            WHERE pc.organization_id = :org_id AND COALESCE(pc.is_deleted, false) = false
              AND (CAST(:department_id AS uuid) IS NULL OR p.department_id = CAST(:department_id AS uuid))
            GROUP BY pc.status
        """),
        params,
    )
    claim_pipeline = {r.status: {"count": r.n, "amount": float(r.amount)} for r in claims}

    payables = await _open_payables(db, org_id)
    aging = {b: 0.0 for b in AGE_BUCKETS}
    for inv in payables:
        aging[inv["bucket"]] += inv["outstanding"]

    site = await db.execute(
        text("""
            SELECT COALESCE(SUM(total_net) FILTER (WHERE status = 'paid' AND paid_at >= date_trunc('month', NOW())), 0) AS paid_month,
                   COALESCE(SUM(total_net) FILTER (WHERE status IN ('draft', 'approved')), 0) AS open_runs
            FROM finance.site_pay_runs WHERE organization_id = :org_id AND is_deleted = false
        """),
        params,
    )
    site_row = site.first()

    return ok(
        {
            "monthly_cash": monthly_cash,
            "cost_by_category": cost_by_category,
            "cost_by_month": list(cost_by_month.values()),
            "cash_accounts": cash_accounts,
            "budget_pipeline": budget_pipeline,
            "claim_pipeline": claim_pipeline,
            "payables_aging": aging,
            "payables_total": round(sum(aging.values()), 2),
            "payables_count": len(payables),
            "site_payroll": {
                "paid_this_month": float(site_row.paid_month) if site_row else 0.0,
                "open_runs": float(site_row.open_runs) if site_row else 0.0,
            },
        },
        "Finance dashboard.",
    )


# ---------------------------------------------------------------------------
# Payables (supplier invoices Finance still owes)
# ---------------------------------------------------------------------------


async def _open_payables(db: AsyncSession, org_id: str, invoice_ids: Optional[list[str]] = None) -> list[dict]:
    rows = await db.execute(
        text("""
            SELECT inv.id, inv.invoice_number, inv.supplier_invoice_ref, inv.supplier_id, inv.project_id,
                   inv.po_id, inv.grn_id, inv.invoice_date, inv.due_date, inv.currency, inv.total_amount,
                   inv.status, inv.match_status, inv.notes,
                   s.supplier_name, s.primary_contact_email AS supplier_email,
                   p.name AS project_name, p.department_id,
                   COALESCE(paid.amount, 0) AS paid_to_date,
                   ev.last_action, ev.last_action_at, ev.invoice_requests
            FROM procurement.supplier_invoices inv
            JOIN procurement.suppliers s ON s.id = inv.supplier_id
            LEFT JOIN projects.projects p ON p.id = inv.project_id
            LEFT JOIN LATERAL (
                SELECT SUM(spi.amount) AS amount
                FROM finance.supplier_payment_items spi
                JOIN finance.supplier_payment_batches b ON b.id = spi.batch_id AND b.is_deleted = false
                WHERE spi.supplier_invoice_id = inv.id
            ) paid ON true
            LEFT JOIN LATERAL (
                SELECT (array_agg(pe.action ORDER BY pe.created_at DESC))[1] AS last_action,
                       MAX(pe.created_at) AS last_action_at,
                       COUNT(*) FILTER (WHERE pe.action = 'invoice_requested') AS invoice_requests
                FROM finance.payable_events pe WHERE pe.supplier_invoice_id = inv.id
            ) ev ON true
            WHERE inv.organization_id = :org_id AND inv.is_deleted = false
              AND inv.status = ANY(:statuses)
              AND (CAST(:ids AS uuid[]) IS NULL OR inv.id = ANY(CAST(:ids AS uuid[])))
            ORDER BY COALESCE(inv.due_date, inv.invoice_date + CAST(:terms AS int)) ASC, inv.invoice_date ASC
        """),
        {"org_id": org_id, "statuses": list(OPEN_INVOICE_STATUSES), "ids": invoice_ids, "terms": DEFAULT_TERMS_DAYS},
    )
    today = date.today()
    out = []
    for r in rows.mappings():
        item = dict(r)
        due = item["due_date"] or (item["invoice_date"] + timedelta(days=DEFAULT_TERMS_DAYS) if item["invoice_date"] else today)
        outstanding = _d(item["total_amount"]) - _d(item["paid_to_date"])
        if outstanding <= 0:
            continue
        overdue = (today - due).days
        item.update(
            effective_due_date=due,
            due_date_assumed=item["due_date"] is None,
            days_outstanding=(today - item["invoice_date"]).days if item["invoice_date"] else 0,
            days_overdue=max(overdue, 0),
            bucket=_bucket(overdue),
            outstanding=float(outstanding),
            total_amount=float(item["total_amount"] or 0),
            paid_to_date=float(item["paid_to_date"] or 0),
            three_way_matched=item["match_status"] == "matched" and bool(item["po_id"]) and bool(item["grn_id"]),
            payable_now=item["status"] == "approved",
        )
        out.append(item)
    return out


@router.get("/payables")
async def list_payables(
    user: dict = Depends(require_permission("finance.cash.read")),
    db: AsyncSession = Depends(get_db),
):
    org_id = user["org_id"]
    items = await _open_payables(db, org_id)
    aging = {b: {"amount": 0.0, "count": 0} for b in AGE_BUCKETS}
    by_supplier: dict[str, dict] = {}
    by_project: dict[str, dict] = {}
    for inv in items:
        aging[inv["bucket"]]["amount"] += inv["outstanding"]
        aging[inv["bucket"]]["count"] += 1
        s = by_supplier.setdefault(str(inv["supplier_id"]), {
            "supplier_id": str(inv["supplier_id"]), "supplier_name": inv["supplier_name"],
            "outstanding": 0.0, "overdue": 0.0, "count": 0, "oldest_days": 0,
        })
        s["outstanding"] += inv["outstanding"]
        s["count"] += 1
        s["oldest_days"] = max(s["oldest_days"], inv["days_outstanding"])
        if inv["days_overdue"] > 0:
            s["overdue"] += inv["outstanding"]
        pkey = str(inv["project_id"] or "")
        pj = by_project.setdefault(pkey, {"project_id": inv["project_id"], "project_name": inv["project_name"] or "No project", "outstanding": 0.0, "count": 0})
        pj["outstanding"] += inv["outstanding"]
        pj["count"] += 1

    recent = await db.execute(
        text("""
            SELECT pe.id, pe.action, pe.amount, pe.reason, pe.email_sent, pe.created_at,
                   inv.invoice_number, s.supplier_name, u.full_name AS actor
            FROM finance.payable_events pe
            JOIN procurement.supplier_invoices inv ON inv.id = pe.supplier_invoice_id
            JOIN procurement.suppliers s ON s.id = inv.supplier_id
            LEFT JOIN core.users u ON u.id = pe.created_by
            WHERE pe.organization_id = :org_id
            ORDER BY pe.created_at DESC LIMIT 40
        """),
        {"org_id": org_id},
    )
    total = sum(i["outstanding"] for i in items)
    overdue = sum(i["outstanding"] for i in items if i["days_overdue"] > 0)
    return ok(
        {
            "invoices": items,
            "summary": {
                "total_outstanding": round(total, 2),
                "overdue": round(overdue, 2),
                "count": len(items),
                "payable_now": round(sum(i["outstanding"] for i in items if i["payable_now"]), 2),
                "awaiting_approval": round(sum(i["outstanding"] for i in items if not i["payable_now"]), 2),
                "weighted_days_outstanding": round(
                    sum(i["outstanding"] * i["days_outstanding"] for i in items) / total, 1
                ) if total else 0,
                "assumed_terms_days": DEFAULT_TERMS_DAYS,
            },
            "aging": aging,
            "by_supplier": sorted(by_supplier.values(), key=lambda s: -s["outstanding"]),
            "by_project": sorted(by_project.values(), key=lambda p: -p["outstanding"]),
            "recent_actions": [dict(r._mapping) for r in recent],
        },
        "Open payables.",
    )


class PayableLine(BaseModel):
    model_config = ConfigDict(extra="forbid")
    invoice_id: UUID
    amount: Optional[float] = Field(default=None, gt=0)


class PayablesPay(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    cash_account_id: UUID
    payment_date: date = Field(default_factory=date.today)
    payment_method: Literal["bank_transfer", "cash", "mobile_money", "cheque"] = "bank_transfer"
    reference: Optional[str] = Field(default=None, max_length=160)
    override_reason: Optional[str] = Field(default=None, max_length=1000)
    items: List[PayableLine] = Field(min_length=1)


@router.post("/payables/pay", status_code=status.HTTP_201_CREATED)
async def pay_payables(
    payload: PayablesPay,
    user: dict = Depends(require_permission("finance.supplier_payment.post")),
    db: AsyncSession = Depends(get_db),
):
    """Pay one or more supplier invoices from a cash account in one batch.

    An invoice Finance has approved for payment pays straight away. One that
    isn't approved yet (no completed PO/GRN/invoice match) can still be paid,
    but only with a written override reason - kept on the invoice's event
    trail so the exception is visible later, not silent."""
    org_id = user["org_id"]
    user_id = _uid(user)
    ids = [str(i.invoice_id) for i in payload.items]
    if len(set(ids)) != len(ids):
        raise HTTPException(status_code=422, detail="An invoice appears twice in this payment.")
    open_by_id = {str(i["id"]): i for i in await _open_payables(db, org_id, ids)}
    missing = [i for i in ids if i not in open_by_id]
    if missing:
        raise HTTPException(status_code=409, detail="One or more invoices are already paid, rejected or not found. Refresh and try again.")
    unapproved = [open_by_id[i] for i in ids if not open_by_id[i]["payable_now"]]
    if unapproved and not payload.override_reason:
        names = ", ".join(i["invoice_number"] for i in unapproved[:5])
        raise HTTPException(
            status_code=409,
            detail=f"Not yet approved for payment: {names}. Give an override reason to pay without a completed PO/GRN/invoice match.",
        )
    account = (await db.execute(
        text("SELECT id, account_name FROM finance.cash_accounts WHERE id = :id AND organization_id = :org_id AND is_deleted = false"),
        {"id": payload.cash_account_id, "org_id": org_id},
    )).first()
    if not account:
        raise HTTPException(status_code=404, detail="Cash account not found.")

    lines = []
    for item in payload.items:
        inv = open_by_id[str(item.invoice_id)]
        amount = _d(item.amount) if item.amount is not None else _d(inv["outstanding"])
        if amount > _d(inv["outstanding"]):
            raise HTTPException(status_code=422, detail=f"{inv['invoice_number']}: payment exceeds the {inv['outstanding']:,.2f} outstanding.")
        lines.append((inv, amount))

    total = sum((a for _, a in lines), Decimal("0"))
    batch_number = f"SPB-{payload.payment_date:%Y%m%d}-{uuid4().hex[:6].upper()}"
    batch_id = (await db.execute(
        text("""
            INSERT INTO finance.supplier_payment_batches (
                organization_id, batch_number, cash_account_id, payment_date, status,
                total_amount, payment_method, reference, notes, created_by
            ) VALUES (:org_id, :batch_number, :cash_account_id, :payment_date, 'posted',
                      :total, :method, :reference, :notes, :user_id)
            RETURNING id
        """),
        {"org_id": org_id, "batch_number": batch_number, "cash_account_id": payload.cash_account_id,
         "payment_date": payload.payment_date, "total": total, "method": payload.payment_method,
         "reference": payload.reference, "notes": payload.override_reason, "user_id": user_id},
    )).scalar_one()

    fully_paid = 0
    for inv, amount in lines:
        tx_id = (await db.execute(
            text("""
                INSERT INTO finance.cashbook_transactions (
                    organization_id, cash_account_id, transaction_number, transaction_date,
                    transaction_type, direction, source_type, source_id, amount, currency, description,
                    project_id, department_id, counterparty_type, counterparty_name, payment_method,
                    reference, posted_by, is_posted, posted_at
                ) VALUES (
                    :org_id, :cash_account_id, :tx_number, :payment_date,
                    'payment', 'outflow', 'supplier_invoice', :invoice_id, :amount, :currency, :description,
                    :project_id, :department_id, 'supplier', :supplier_name, :method,
                    :reference, :user_id, true, NOW()
                ) RETURNING id
            """),
            {"org_id": org_id, "cash_account_id": payload.cash_account_id,
             "tx_number": f"PMT-{batch_number}-{str(inv['id'])[:8]}", "payment_date": payload.payment_date,
             "invoice_id": inv["id"], "amount": amount, "currency": inv["currency"] or "USD",
             "description": f"Payment of {inv['supplier_name']} invoice {inv['invoice_number']}",
             "project_id": inv["project_id"], "department_id": inv["department_id"],
             "supplier_name": inv["supplier_name"], "method": payload.payment_method,
             "reference": payload.reference or inv["supplier_invoice_ref"], "user_id": user_id},
        )).scalar_one()
        await db.execute(
            text("""
                INSERT INTO finance.supplier_payment_items (
                    organization_id, batch_id, supplier_invoice_id, supplier_id, project_id, department_id,
                    amount, payment_reference, cashbook_transaction_id
                ) VALUES (:org_id, :batch_id, :invoice_id, :supplier_id, :project_id, :department_id,
                          :amount, :reference, :tx_id)
            """),
            {"org_id": org_id, "batch_id": batch_id, "invoice_id": inv["id"], "supplier_id": inv["supplier_id"],
             "project_id": inv["project_id"], "department_id": inv["department_id"], "amount": amount,
             "reference": payload.reference, "tx_id": tx_id},
        )
        settled = amount >= _d(inv["outstanding"])
        if settled:
            fully_paid += 1
            await db.execute(
                text("""
                    UPDATE procurement.supplier_invoices
                    SET status = 'paid', paid_at = NOW(), payment_reference = COALESCE(:reference, :batch_number), updated_at = NOW()
                    WHERE id = :id
                """),
                {"id": inv["id"], "reference": payload.reference, "batch_number": batch_number},
            )
        if not inv["payable_now"]:
            await _event(db, org_id, inv["id"], "match_override", user_id, amount=amount, reason=payload.override_reason, batch_id=batch_id)
        await _event(db, org_id, inv["id"], "paid", user_id, amount=amount,
                     reason=None if settled else "Part payment", batch_id=batch_id)

    await db.commit()
    return ok(
        {"batch_id": str(batch_id), "batch_number": batch_number, "total": float(total),
         "invoices": len(lines), "fully_paid": fully_paid},
        f"Paid {len(lines)} invoice{'s' if len(lines) != 1 else ''} ({float(total):,.2f}) from {account.account_name}.",
    )


async def _event(db: AsyncSession, org_id: str, invoice_id, action: str, user_id, *, amount=None, reason=None, email_sent=None, batch_id=None):
    await db.execute(
        text("""
            INSERT INTO finance.payable_events (organization_id, supplier_invoice_id, action, amount, reason, email_sent, batch_id, created_by)
            VALUES (:org_id, :invoice_id, :action, :amount, :reason, :email_sent, :batch_id, :user_id)
        """),
        {"org_id": org_id, "invoice_id": invoice_id, "action": action, "amount": amount, "reason": reason,
         "email_sent": email_sent, "batch_id": batch_id, "user_id": user_id},
    )


class PayableReject(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    reason: str = Field(min_length=3, max_length=1000)


@router.post("/payables/{invoice_id}/reject")
async def reject_payable(
    invoice_id: UUID,
    payload: PayableReject,
    user: dict = Depends(require_permission("finance.supplier_payment.post")),
    db: AsyncSession = Depends(get_db),
):
    org_id = user["org_id"]
    open_items = await _open_payables(db, org_id, [str(invoice_id)])
    if not open_items:
        raise HTTPException(status_code=409, detail="Invoice is already paid, rejected or not found.")
    if open_items[0]["paid_to_date"] > 0:
        raise HTTPException(status_code=409, detail="This invoice has been part-paid; it can't be rejected outright.")
    await db.execute(
        text("""
            UPDATE procurement.supplier_invoices
            SET status = 'rejected', rejection_reason = :reason, updated_at = NOW()
            WHERE id = :id AND organization_id = :org_id
        """),
        {"id": invoice_id, "org_id": org_id, "reason": payload.reason},
    )
    await _event(db, org_id, invoice_id, "rejected", _uid(user), reason=payload.reason)
    await db.commit()
    return ok({"id": str(invoice_id), "status": "rejected"}, "Invoice rejected for payment.")


class InvoiceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    message: Optional[str] = Field(default=None, max_length=2000)
    send_email: bool = True


@router.post("/payables/{invoice_id}/request-invoice")
async def request_supplier_invoice(
    invoice_id: UUID,
    payload: InvoiceRequest,
    user: dict = Depends(require_permission("finance.supplier_payment.post")),
    db: AsyncSession = Depends(get_db),
):
    """Ask the supplier for a valid (fiscal) tax invoice before paying. Emails
    the supplier's primary contact when one is on file; the request is logged
    either way so the screen shows it's been chased."""
    org_id = user["org_id"]
    open_items = await _open_payables(db, org_id, [str(invoice_id)])
    if not open_items:
        raise HTTPException(status_code=409, detail="Invoice is already paid, rejected or not found.")
    inv = open_items[0]
    email_sent: Optional[bool] = None
    if payload.send_email and inv["supplier_email"]:
        body = escape(payload.message) if payload.message else (
            "Please send us a valid fiscal tax invoice for the supply below so that we can release payment."
        )
        html = (
            f"<p>Dear {escape(inv['supplier_name'])},</p><p>{body}</p>"
            f"<ul><li>Our reference: {escape(inv['invoice_number'])}</li>"
            + (f"<li>Your reference: {escape(inv['supplier_invoice_ref'])}</li>" if inv["supplier_invoice_ref"] else "")
            + f"<li>Amount: {escape(inv['currency'] or 'USD')} {inv['outstanding']:,.2f}</li>"
            + (f"<li>Project: {escape(inv['project_name'])}</li>" if inv["project_name"] else "")
            + "</ul><p>Regards,<br/>Six Nine Construction - Finance</p>"
        )
        email_sent = await send_email(inv["supplier_email"], f"Tax invoice required - {inv['invoice_number']}", html)
    await _event(db, org_id, invoice_id, "invoice_requested", _uid(user), reason=payload.message, email_sent=email_sent)
    await db.commit()
    if email_sent:
        message = f"Invoice requested from {inv['supplier_name']} ({inv['supplier_email']})."
    elif payload.send_email and not inv["supplier_email"]:
        message = f"Request logged. {inv['supplier_name']} has no contact email on file - follow up by phone."
    elif payload.send_email:
        message = "Request logged, but the email could not be sent."
    else:
        message = "Request logged."
    return ok({"id": str(invoice_id), "email_sent": email_sent, "supplier_email": inv["supplier_email"]}, message)


# ---------------------------------------------------------------------------
# Cost codes grouped by project
# ---------------------------------------------------------------------------


@router.get("/cost-codes/by-project")
async def cost_codes_by_project(
    department_id: Optional[UUID] = None,
    user: dict = Depends(require_permission("finance.budget.read")),
    db: AsyncSession = Depends(get_db),
):
    rows = await db.execute(
        text("""
            WITH budgeted AS (
                SELECT pb.project_id, bl.cost_code_id, SUM(bl.amount) AS budget_amount
                FROM finance.project_budgets pb
                JOIN finance.budget_lines bl ON bl.budget_id = pb.id
                WHERE pb.organization_id = :org_id AND pb.status = 'approved' AND pb.is_deleted = false
                  AND bl.cost_code_id IS NOT NULL
                GROUP BY 1, 2
            ), drafted AS (
                SELECT pb.project_id, bl.cost_code_id, SUM(bl.amount) AS draft_amount
                FROM finance.project_budgets pb
                JOIN finance.budget_lines bl ON bl.budget_id = pb.id
                WHERE pb.organization_id = :org_id AND pb.status = 'draft' AND pb.is_deleted = false
                  AND bl.cost_code_id IS NOT NULL
                GROUP BY 1, 2
            ), actual AS (
                SELECT project_id, cost_code_id, SUM(amount) AS actual_amount, COUNT(*) AS tx_count
                FROM finance.cost_transactions
                WHERE organization_id = :org_id AND status = 'posted' AND cost_code_id IS NOT NULL AND project_id IS NOT NULL
                GROUP BY 1, 2
            ), pairs AS (
                SELECT project_id, cost_code_id FROM budgeted
                UNION SELECT project_id, cost_code_id FROM drafted
                UNION SELECT project_id, cost_code_id FROM actual
            )
            SELECT pairs.project_id, p.name AS project_name, p.project_code, p.status AS project_status,
                   cc.id AS cost_code_id, cc.code, cc.name, cc.category,
                   COALESCE(b.budget_amount, 0) AS budget_amount,
                   COALESCE(d.draft_amount, 0) AS draft_amount,
                   COALESCE(a.actual_amount, 0) AS actual_amount,
                   COALESCE(a.tx_count, 0) AS tx_count
            FROM pairs
            JOIN projects.projects p ON p.id = pairs.project_id AND p.is_deleted = false
            JOIN finance.cost_codes cc ON cc.id = pairs.cost_code_id AND cc.is_deleted = false
            LEFT JOIN budgeted b ON b.project_id = pairs.project_id AND b.cost_code_id = pairs.cost_code_id
            LEFT JOIN drafted d ON d.project_id = pairs.project_id AND d.cost_code_id = pairs.cost_code_id
            LEFT JOIN actual a ON a.project_id = pairs.project_id AND a.cost_code_id = pairs.cost_code_id
            WHERE (CAST(:department_id AS uuid) IS NULL OR p.department_id = CAST(:department_id AS uuid) OR p.department_id IS NULL)
            ORDER BY p.name, cc.code
        """),
        {"org_id": user["org_id"], "department_id": department_id},
    )
    projects: dict[str, dict] = {}
    used_codes: set[str] = set()
    for r in rows.mappings():
        pid = str(r["project_id"])
        used_codes.add(str(r["cost_code_id"]))
        proj = projects.setdefault(pid, {
            "project_id": pid, "project_name": r["project_name"], "project_code": r["project_code"],
            "project_status": r["project_status"], "budget_amount": 0.0, "draft_amount": 0.0,
            "actual_amount": 0.0, "codes": [],
        })
        code = {
            "cost_code_id": str(r["cost_code_id"]), "code": r["code"], "name": r["name"], "category": r["category"],
            "budget_amount": float(r["budget_amount"]), "draft_amount": float(r["draft_amount"]),
            "actual_amount": float(r["actual_amount"]), "tx_count": r["tx_count"],
        }
        proj["codes"].append(code)
        proj["budget_amount"] += code["budget_amount"]
        proj["draft_amount"] += code["draft_amount"]
        proj["actual_amount"] += code["actual_amount"]

    unassigned = await db.execute(
        text("""
            SELECT id, code, name, category FROM finance.cost_codes
            WHERE organization_id = :org_id AND is_deleted = false
              AND NOT (id = ANY(CAST(:used AS uuid[])))
              AND (CAST(:department_id AS uuid) IS NULL OR department_id = CAST(:department_id AS uuid) OR department_id IS NULL)
            ORDER BY code
        """),
        {"org_id": user["org_id"], "used": list(used_codes), "department_id": department_id},
    )
    return ok(
        {
            "projects": list(projects.values()),
            "unassigned": [dict(r._mapping) for r in unassigned],
        },
        "Cost codes grouped by project.",
    )


# ---------------------------------------------------------------------------
# Draft budget reminders
# ---------------------------------------------------------------------------


@router.get("/budgets/draft-reminders")
async def draft_reminder_preview(
    user: dict = Depends(require_permission("finance.budget.read")),
    db: AsyncSession = Depends(get_db),
):
    drafts = await draft_budget_reminders.list_draft_budgets(db, user["org_id"])
    role_cache: dict = {}
    out = []
    for d in drafts:
        out.append({
            "budget_id": str(d["id"]),
            "project_id": str(d["project_id"]),
            "project_name": d["project_name"],
            "recipients": await draft_budget_reminders.recipients_for_draft(db, d, role_cache=role_cache),
        })
    return ok(out, "Draft budget reminder recipients.")


class DraftReminderSend(BaseModel):
    model_config = ConfigDict(extra="forbid")
    budget_id: Optional[UUID] = None


@router.post("/budgets/draft-reminders/send")
async def send_draft_reminders(
    payload: DraftReminderSend,
    user: dict = Depends(require_permission("finance.budget.remind")),
    db: AsyncSession = Depends(get_db),
):
    result = await draft_budget_reminders.send_reminders(
        db, user["org_id"], str(payload.budget_id) if payload.budget_id else None
    )
    if not result["sent"] and not result["failed"]:
        return ok(result, "No draft budgets to remind anyone about.")
    msg = f"Reminder sent to {len(result['sent'])} people."
    if result["failed"]:
        msg += f" Not delivered to: {', '.join(result['failed'])}."
    return ok(result, msg)


class DraftBudgetDecision(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    action: Literal["approve", "cancel"]
    reason: Optional[str] = Field(default=None, max_length=1000)


@router.post("/budgets/{budget_id}/decision")
async def decide_draft_budget(
    budget_id: UUID,
    payload: DraftBudgetDecision,
    user: dict = Depends(require_permission("projects.budget_baseline.lock")),
    db: AsyncSession = Depends(get_db),
):
    """Approve a draft budget (it becomes the project's working budget and the
    previous approved version moves to superseded) or cancel it. Either way
    it stops appearing in the weekday draft reminders. Same Finance
    permission that guards changing a protected baseline."""
    org_id = user["org_id"]
    draft = (await db.execute(
        text("""
            SELECT id, project_id, budget_version, notes FROM finance.project_budgets
            WHERE id = :id AND organization_id = :org_id AND is_deleted = false
            FOR UPDATE
        """),
        {"id": budget_id, "org_id": org_id},
    )).mappings().first()
    if not draft:
        raise HTTPException(status_code=404, detail="Budget not found.")
    current = (await db.execute(
        text("SELECT status FROM finance.project_budgets WHERE id = :id"), {"id": budget_id}
    )).scalar()
    if current != "draft":
        raise HTTPException(status_code=409, detail=f"Only a draft budget can be decided; this one is {current}.")
    note = payload.reason
    if payload.action == "cancel":
        if not note:
            raise HTTPException(status_code=422, detail="Give a reason for cancelling the draft.")
        await db.execute(
            text("""
                UPDATE finance.project_budgets
                SET status = 'cancelled', notes = CONCAT_WS(E'
', notes, :note), updated_at = NOW()
                WHERE id = :id
            """),
            {"id": budget_id, "note": f"Cancelled: {note}"},
        )
        message = "Draft budget cancelled."
    else:
        await db.execute(
            text("""
                UPDATE finance.project_budgets SET status = 'superseded', updated_at = NOW()
                WHERE project_id = :project_id AND organization_id = :org_id AND status = 'approved' AND is_deleted = false
            """),
            {"project_id": draft["project_id"], "org_id": org_id},
        )
        await db.execute(
            text("""
                UPDATE finance.project_budgets
                SET status = 'approved', approved_by = :user_id, approved_at = NOW(),
                    effective_date = CURRENT_DATE,
                    notes = CASE WHEN CAST(:note AS text) IS NULL THEN notes ELSE CONCAT_WS(E'
', notes, CAST(:note AS text)) END,
                    updated_at = NOW()
                WHERE id = :id
            """),
            {"id": budget_id, "user_id": _uid(user), "note": f"Approved: {note}" if note else None},
        )
        message = f"Budget v{draft['budget_version']} approved; it is now the project's working budget."
    await db.commit()
    return ok({"id": str(budget_id), "status": "cancelled" if payload.action == "cancel" else "approved"}, message)


# ---------------------------------------------------------------------------
# Site payroll - hourly project labour not registered on AEGIS
# ---------------------------------------------------------------------------


class SiteWorkerIn(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    project_id: Optional[UUID] = None
    full_name: str = Field(min_length=2, max_length=160)
    national_id: Optional[str] = Field(default=None, max_length=40)
    phone: Optional[str] = Field(default=None, max_length=40)
    trade: Optional[str] = Field(default=None, max_length=80)
    hourly_rate: float = Field(ge=0)
    overtime_rate: Optional[float] = Field(default=None, ge=0)
    currency: Literal["USD", "ZWG"] = "USD"
    payment_method: Literal["cash", "mobile_money", "bank_transfer"] = "cash"
    payment_details: Optional[str] = Field(default=None, max_length=160)
    status: Literal["active", "inactive"] = "active"
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    notes: Optional[str] = Field(default=None, max_length=1000)


WORKER_FIELDS = tuple(SiteWorkerIn.model_fields.keys())


@router.get("/site-payroll/workers")
async def list_site_workers(
    project_id: Optional[UUID] = None,
    include_inactive: bool = False,
    user: dict = Depends(require_permission("finance.payroll.read")),
    db: AsyncSession = Depends(get_db),
):
    rows = await db.execute(
        text("""
            SELECT w.*, p.name AS project_name,
                   COALESCE(t.unpaid_regular, 0) AS unpaid_regular_hours,
                   COALESCE(t.unpaid_overtime, 0) AS unpaid_overtime_hours,
                   t.last_worked
            FROM finance.site_workers w
            LEFT JOIN projects.projects p ON p.id = w.project_id
            LEFT JOIN LATERAL (
                SELECT SUM(te.regular_hours) FILTER (WHERE te.pay_run_id IS NULL) AS unpaid_regular,
                       SUM(te.overtime_hours) FILTER (WHERE te.pay_run_id IS NULL) AS unpaid_overtime,
                       MAX(te.work_date) AS last_worked
                FROM finance.site_time_entries te WHERE te.worker_id = w.id
            ) t ON true
            WHERE w.organization_id = :org_id AND w.is_deleted = false
              AND (CAST(:project_id AS uuid) IS NULL OR w.project_id = CAST(:project_id AS uuid))
              AND (CAST(:include_inactive AS boolean) OR w.status = 'active')
            ORDER BY p.name NULLS LAST, w.full_name
        """),
        {"org_id": user["org_id"], "project_id": project_id, "include_inactive": include_inactive},
    )
    return ok([dict(r._mapping) for r in rows], "Site workers.")


@router.post("/site-payroll/workers", status_code=status.HTTP_201_CREATED)
async def create_site_worker(
    payload: SiteWorkerIn,
    user: dict = Depends(require_permission("finance.site_payroll.manage")),
    db: AsyncSession = Depends(get_db),
):
    values = payload.model_dump()
    cols = ", ".join(WORKER_FIELDS)
    binds = ", ".join(f":{f}" for f in WORKER_FIELDS)
    new_id = (await db.execute(
        text(f"INSERT INTO finance.site_workers (organization_id, created_by, {cols}) VALUES (:org_id, :user_id, {binds}) RETURNING id"),
        {"org_id": user["org_id"], "user_id": _uid(user), **values},
    )).scalar_one()
    await db.commit()
    return ok({"id": str(new_id)}, f"{payload.full_name} added to site payroll.")


@router.put("/site-payroll/workers/{worker_id}")
async def update_site_worker(
    worker_id: UUID,
    payload: SiteWorkerIn,
    user: dict = Depends(require_permission("finance.site_payroll.manage")),
    db: AsyncSession = Depends(get_db),
):
    sets = ", ".join(f"{f} = :{f}" for f in WORKER_FIELDS)
    res = await db.execute(
        text(f"UPDATE finance.site_workers SET {sets}, updated_at = NOW() WHERE id = :id AND organization_id = :org_id AND is_deleted = false"),
        {"id": worker_id, "org_id": user["org_id"], **payload.model_dump()},
    )
    if res.rowcount == 0:
        raise HTTPException(status_code=404, detail="Site worker not found.")
    await db.commit()
    return ok({"id": str(worker_id)}, "Site worker updated.")


@router.get("/site-payroll/time-entries")
async def list_time_entries(
    project_id: UUID,
    date_from: date,
    date_to: date,
    user: dict = Depends(require_permission("finance.payroll.read")),
    db: AsyncSession = Depends(get_db),
):
    rows = await db.execute(
        text("""
            SELECT te.id, te.worker_id, te.project_id, te.work_date, te.regular_hours, te.overtime_hours,
                   te.notes, te.pay_run_id, r.status AS pay_run_status, r.run_number
            FROM finance.site_time_entries te
            LEFT JOIN finance.site_pay_runs r ON r.id = te.pay_run_id
            WHERE te.organization_id = :org_id AND te.project_id = :project_id
              AND te.work_date BETWEEN :date_from AND :date_to
            ORDER BY te.work_date
        """),
        {"org_id": user["org_id"], "project_id": project_id, "date_from": date_from, "date_to": date_to},
    )
    return ok([dict(r._mapping) for r in rows], "Site time entries.")


class TimeEntryIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    worker_id: UUID
    work_date: date
    regular_hours: float = Field(ge=0, le=24)
    overtime_hours: float = Field(default=0, ge=0, le=24)
    notes: Optional[str] = Field(default=None, max_length=500)


class TimeEntriesSave(BaseModel):
    model_config = ConfigDict(extra="forbid")
    project_id: UUID
    entries: List[TimeEntryIn] = Field(min_length=1, max_length=2000)


@router.put("/site-payroll/time-entries")
async def save_time_entries(
    payload: TimeEntriesSave,
    user: dict = Depends(require_permission("finance.site_payroll.manage")),
    db: AsyncSession = Depends(get_db),
):
    """Upsert a timesheet grid. A zero-hour cell deletes that day's entry.
    Days already on a pay run (any status but cancelled) are locked."""
    org_id = user["org_id"]
    worker_ids = list({str(e.worker_id) for e in payload.entries})
    known = {str(r.id) for r in await db.execute(
        text("SELECT id FROM finance.site_workers WHERE organization_id = :org_id AND id = ANY(CAST(:ids AS uuid[])) AND is_deleted = false"),
        {"org_id": org_id, "ids": worker_ids},
    )}
    if len(known) != len(worker_ids):
        raise HTTPException(status_code=404, detail="One or more site workers were not found.")
    saved = removed = locked = 0
    for e in payload.entries:
        existing = (await db.execute(
            text("""
                SELECT te.id, te.pay_run_id FROM finance.site_time_entries te
                WHERE te.worker_id = :worker_id AND te.project_id = :project_id AND te.work_date = :work_date
            """),
            {"worker_id": e.worker_id, "project_id": payload.project_id, "work_date": e.work_date},
        )).first()
        if existing and existing.pay_run_id:
            locked += 1
            continue
        if e.regular_hours == 0 and e.overtime_hours == 0:
            if existing:
                await db.execute(text("DELETE FROM finance.site_time_entries WHERE id = :id"), {"id": existing.id})
                removed += 1
            continue
        await db.execute(
            text("""
                INSERT INTO finance.site_time_entries (
                    organization_id, worker_id, project_id, work_date, regular_hours, overtime_hours, notes, created_by
                ) VALUES (:org_id, :worker_id, :project_id, :work_date, :regular, :overtime, :notes, :user_id)
                ON CONFLICT (worker_id, project_id, work_date) DO UPDATE SET
                    regular_hours = EXCLUDED.regular_hours, overtime_hours = EXCLUDED.overtime_hours,
                    notes = EXCLUDED.notes, updated_at = NOW()
            """),
            {"org_id": org_id, "worker_id": e.worker_id, "project_id": payload.project_id, "work_date": e.work_date,
             "regular": e.regular_hours, "overtime": e.overtime_hours, "notes": e.notes, "user_id": _uid(user)},
        )
        saved += 1
    await db.commit()
    msg = f"Saved {saved} day{'s' if saved != 1 else ''}"
    if removed:
        msg += f", cleared {removed}"
    if locked:
        msg += f"; {locked} already on a pay run and left unchanged"
    return ok({"saved": saved, "removed": removed, "locked": locked}, msg + ".")


@router.get("/site-payroll/runs")
async def list_site_pay_runs(
    project_id: Optional[UUID] = None,
    user: dict = Depends(require_permission("finance.payroll.read")),
    db: AsyncSession = Depends(get_db),
):
    rows = await db.execute(
        text("""
            SELECT r.*, p.name AS project_name, a.account_name
            FROM finance.site_pay_runs r
            JOIN projects.projects p ON p.id = r.project_id
            LEFT JOIN finance.cash_accounts a ON a.id = r.cash_account_id
            WHERE r.organization_id = :org_id AND r.is_deleted = false
              AND (CAST(:project_id AS uuid) IS NULL OR r.project_id = CAST(:project_id AS uuid))
            ORDER BY r.period_end DESC, r.created_at DESC
            LIMIT 200
        """),
        {"org_id": user["org_id"], "project_id": project_id},
    )
    return ok([dict(r._mapping) for r in rows], "Site pay runs.")


@router.get("/site-payroll/runs/{run_id}")
async def get_site_pay_run(
    run_id: UUID,
    user: dict = Depends(require_permission("finance.payroll.read")),
    db: AsyncSession = Depends(get_db),
):
    run = (await db.execute(
        text("""
            SELECT r.*, p.name AS project_name, a.account_name
            FROM finance.site_pay_runs r JOIN projects.projects p ON p.id = r.project_id
            LEFT JOIN finance.cash_accounts a ON a.id = r.cash_account_id
            WHERE r.id = :id AND r.organization_id = :org_id AND r.is_deleted = false
        """),
        {"id": run_id, "org_id": user["org_id"]},
    )).mappings().first()
    if not run:
        raise HTTPException(status_code=404, detail="Site pay run not found.")
    lines = await db.execute(
        text("""
            SELECT l.*, w.full_name, w.trade, w.payment_method, w.payment_details, w.national_id
            FROM finance.site_pay_run_lines l JOIN finance.site_workers w ON w.id = l.worker_id
            WHERE l.pay_run_id = :id ORDER BY w.full_name
        """),
        {"id": run_id},
    )
    return ok({**dict(run), "lines": [dict(r._mapping) for r in lines]}, "Site pay run.")


class SiteDeduction(BaseModel):
    model_config = ConfigDict(extra="forbid")
    worker_id: UUID
    amount: float = Field(ge=0)
    note: Optional[str] = Field(default=None, max_length=200)


class SitePayRunCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    project_id: UUID
    period_start: date
    period_end: date
    payment_date: date
    cash_account_id: Optional[UUID] = None
    deductions: List[SiteDeduction] = Field(default_factory=list)
    notes: Optional[str] = Field(default=None, max_length=1000)

    @model_validator(mode="after")
    def _dates(self):
        if self.period_end < self.period_start:
            raise ValueError("period_end must be on or after period_start.")
        return self


@router.post("/site-payroll/runs", status_code=status.HTTP_201_CREATED)
async def create_site_pay_run(
    payload: SitePayRunCreate,
    user: dict = Depends(require_permission("finance.site_payroll.manage")),
    db: AsyncSession = Depends(get_db),
):
    """Gather every unpaid hour logged on the project in the period into one
    draft run, pricing each worker at their current rate."""
    org_id = user["org_id"]
    rows = await db.execute(
        text("""
            SELECT w.id AS worker_id, w.full_name, w.hourly_rate, w.overtime_rate,
                   SUM(te.regular_hours) AS regular_hours, SUM(te.overtime_hours) AS overtime_hours,
                   array_agg(te.id) AS entry_ids
            FROM finance.site_time_entries te
            JOIN finance.site_workers w ON w.id = te.worker_id
            WHERE te.organization_id = :org_id AND te.project_id = :project_id
              AND te.work_date BETWEEN :start AND :end AND te.pay_run_id IS NULL
            GROUP BY w.id, w.full_name, w.hourly_rate, w.overtime_rate
            ORDER BY w.full_name
        """),
        {"org_id": org_id, "project_id": payload.project_id, "start": payload.period_start, "end": payload.period_end},
    )
    workers = [dict(r._mapping) for r in rows]
    if not workers:
        raise HTTPException(status_code=409, detail="No unpaid site hours logged on this project in that period.")
    deductions = {str(d.worker_id): d for d in payload.deductions}

    lines = []
    for w in workers:
        rate = _d(w["hourly_rate"])
        ot_rate = _d(w["overtime_rate"]) if w["overtime_rate"] is not None else (rate * Decimal("1.5")).quantize(Decimal("0.01"))
        gross = (_d(w["regular_hours"]) * rate + _d(w["overtime_hours"]) * ot_rate).quantize(Decimal("0.01"))
        ded = deductions.get(str(w["worker_id"]))
        ded_amount = _d(ded.amount) if ded else Decimal("0")
        if ded_amount > gross:
            raise HTTPException(status_code=422, detail=f"{w['full_name']}: deductions exceed gross pay ({gross}).")
        lines.append({**w, "rate": rate, "ot_rate": ot_rate, "gross": gross, "ded": ded_amount,
                      "ded_note": ded.note if ded else None, "net": gross - ded_amount})

    project = (await db.execute(
        text("SELECT project_code FROM projects.projects WHERE id = :id AND organization_id = :org_id"),
        {"id": payload.project_id, "org_id": org_id},
    )).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found.")
    run_number = f"SITE-{(project.project_code or 'PRJ')[:12]}-{payload.period_end:%Y%m%d}-{uuid4().hex[:4].upper()}"
    totals = {
        "gross": sum((l["gross"] for l in lines), Decimal("0")),
        "ded": sum((l["ded"] for l in lines), Decimal("0")),
        "hours": sum((_d(l["regular_hours"]) + _d(l["overtime_hours"]) for l in lines), Decimal("0")),
    }
    run_id = (await db.execute(
        text("""
            INSERT INTO finance.site_pay_runs (
                organization_id, run_number, project_id, period_start, period_end, payment_date, cash_account_id,
                status, worker_count, total_hours, total_gross, total_deductions, total_net, notes, created_by
            ) VALUES (:org_id, :run_number, :project_id, :start, :end, :payment_date, :cash_account_id,
                      'draft', :workers, :hours, :gross, :ded, :net, :notes, :user_id)
            RETURNING id
        """),
        {"org_id": org_id, "run_number": run_number, "project_id": payload.project_id, "start": payload.period_start,
         "end": payload.period_end, "payment_date": payload.payment_date, "cash_account_id": payload.cash_account_id,
         "workers": len(lines), "hours": totals["hours"], "gross": totals["gross"], "ded": totals["ded"],
         "net": totals["gross"] - totals["ded"], "notes": payload.notes, "user_id": _uid(user)},
    )).scalar_one()
    for l in lines:
        await db.execute(
            text("""
                INSERT INTO finance.site_pay_run_lines (
                    organization_id, pay_run_id, worker_id, regular_hours, overtime_hours, hourly_rate, overtime_rate,
                    gross_pay, deductions, net_pay, deduction_note
                ) VALUES (:org_id, :run_id, :worker_id, :regular, :overtime, :rate, :ot_rate, :gross, :ded, :net, :ded_note)
            """),
            {"org_id": org_id, "run_id": run_id, "worker_id": l["worker_id"], "regular": l["regular_hours"],
             "overtime": l["overtime_hours"], "rate": l["rate"], "ot_rate": l["ot_rate"], "gross": l["gross"],
             "ded": l["ded"], "net": l["net"], "ded_note": l["ded_note"]},
        )
        await db.execute(
            text("UPDATE finance.site_time_entries SET pay_run_id = :run_id, updated_at = NOW() WHERE id = ANY(CAST(:ids AS uuid[]))"),
            {"run_id": run_id, "ids": [str(i) for i in l["entry_ids"]]},
        )
    await db.commit()
    return ok({"id": str(run_id), "run_number": run_number, "total_net": float(totals["gross"] - totals["ded"])},
              f"Site pay run {run_number} drafted for {len(lines)} worker{'s' if len(lines) != 1 else ''}.")


class SitePayRunDecision(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    action: Literal["approve", "pay", "cancel"]
    cash_account_id: Optional[UUID] = None
    payment_method: Literal["cash", "mobile_money", "bank_transfer"] = "cash"
    reference: Optional[str] = Field(default=None, max_length=160)


@router.post("/site-payroll/runs/{run_id}/decision")
async def decide_site_pay_run(
    run_id: UUID,
    payload: SitePayRunDecision,
    user: dict = Depends(require_permission("finance.payroll.post")),
    db: AsyncSession = Depends(get_db),
):
    org_id = user["org_id"]
    user_id = _uid(user)
    run = (await db.execute(
        text("""
            SELECT r.*, p.name AS project_name, p.department_id
            FROM finance.site_pay_runs r JOIN projects.projects p ON p.id = r.project_id
            WHERE r.id = :id AND r.organization_id = :org_id AND r.is_deleted = false
            FOR UPDATE OF r
        """),
        {"id": run_id, "org_id": org_id},
    )).mappings().first()
    if not run:
        raise HTTPException(status_code=404, detail="Site pay run not found.")
    current = run["status"]
    if current in ("paid", "cancelled"):
        raise HTTPException(status_code=409, detail=f"This run is already {current}.")

    if payload.action == "approve":
        if current != "draft":
            raise HTTPException(status_code=409, detail="Only a draft run can be approved.")
        await db.execute(
            text("UPDATE finance.site_pay_runs SET status = 'approved', approved_by = :u, approved_at = NOW(), updated_at = NOW() WHERE id = :id"),
            {"id": run_id, "u": user_id},
        )
        message = f"{run['run_number']} approved."
    elif payload.action == "cancel":
        await db.execute(text("UPDATE finance.site_time_entries SET pay_run_id = NULL, updated_at = NOW() WHERE pay_run_id = :id"), {"id": run_id})
        await db.execute(text("UPDATE finance.site_pay_runs SET status = 'cancelled', updated_at = NOW() WHERE id = :id"), {"id": run_id})
        message = f"{run['run_number']} cancelled; its hours are unpaid again and can go on a new run."
    else:
        if current != "approved":
            raise HTTPException(status_code=409, detail="Approve the run before paying it.")
        cash_account_id = payload.cash_account_id or run["cash_account_id"]
        if not cash_account_id:
            raise HTTPException(status_code=422, detail="Choose the cash account the site wages are paid from.")
        net = _d(run["total_net"])
        gross = _d(run["total_gross"])
        tx_id = None
        if net > 0:
            tx_id = (await db.execute(
                text("""
                    INSERT INTO finance.cashbook_transactions (
                        organization_id, cash_account_id, transaction_number, transaction_date, transaction_type,
                        direction, source_type, source_id, amount, currency, description, project_id, department_id,
                        counterparty_type, counterparty_name, payment_method, reference, posted_by, is_posted, posted_at
                    ) VALUES (
                        :org_id, :cash_account_id, :tx_number, :payment_date, 'payment',
                        'outflow', 'site_pay_run', :run_id, :amount, 'USD', :description, :project_id, :department_id,
                        'employee', 'Site payroll', :method, :reference, :user_id, true, NOW()
                    ) RETURNING id
                """),
                {"org_id": org_id, "cash_account_id": cash_account_id, "tx_number": f"SPR-{run['run_number']}",
                 "payment_date": run["payment_date"], "run_id": run_id, "amount": net,
                 "description": f"Site wages {run['run_number']} - {run['project_name']} ({run['worker_count']} workers, {run['period_start']} to {run['period_end']})",
                 "project_id": run["project_id"], "department_id": run["department_id"],
                 "method": payload.payment_method, "reference": payload.reference, "user_id": user_id},
            )).scalar_one()
        if gross > 0:
            # Labour cost is the gross wage: deductions (advances recovered,
            # damages) reduce what is paid out, not what the work cost.
            await db.execute(
                text("""
                    INSERT INTO finance.cost_transactions (
                        organization_id, project_id, source_type, source_id, cost_category, description,
                        quantity, unit_cost, amount, transaction_date, status, posted_by, posted_at, evidence_quality
                    ) VALUES (:org_id, :project_id, 'site_pay_run', :run_id, 'labour', :description,
                              :hours, :unit_cost, :amount, :on, 'posted', :user_id, NOW(), 'B')
                """),
                {"org_id": org_id, "project_id": run["project_id"], "run_id": run_id,
                 "description": f"Site labour {run['run_number']} ({run['worker_count']} workers)",
                 "hours": _d(run["total_hours"]),
                 "unit_cost": (gross / _d(run["total_hours"])).quantize(Decimal("0.01")) if _d(run["total_hours"]) > 0 else gross,
                 "amount": gross, "on": run["payment_date"], "user_id": user_id},
            )
        await db.execute(
            text("""
                UPDATE finance.site_pay_runs
                SET status = 'paid', paid_by = :u, paid_at = NOW(), cash_account_id = :cash_account_id,
                    cashbook_transaction_id = :tx_id, updated_at = NOW()
                WHERE id = :id
            """),
            {"id": run_id, "u": user_id, "cash_account_id": cash_account_id, "tx_id": tx_id},
        )
        message = f"{run['run_number']} paid: {float(net):,.2f} out of cash, {float(gross):,.2f} labour cost on {run['project_name']}."
    await db.commit()
    return ok({"id": str(run_id)}, message)


@router.get("/site-payroll/summary")
async def site_payroll_summary(
    user: dict = Depends(require_permission("finance.payroll.read")),
    db: AsyncSession = Depends(get_db),
):
    rows = await db.execute(
        text("""
            SELECT p.id AS project_id, p.name AS project_name,
                   (SELECT COUNT(*) FROM finance.site_workers w WHERE w.project_id = p.id AND w.status = 'active' AND NOT w.is_deleted) AS active_workers,
                   COALESCE((SELECT SUM(te.regular_hours + te.overtime_hours) FROM finance.site_time_entries te
                             WHERE te.project_id = p.id AND te.organization_id = :org_id
                               AND te.work_date >= date_trunc('month', CURRENT_DATE)), 0) AS hours_this_month,
                   COALESCE((SELECT SUM(te.regular_hours * w.hourly_rate
                                        + te.overtime_hours * COALESCE(w.overtime_rate, w.hourly_rate * 1.5))
                             FROM finance.site_time_entries te JOIN finance.site_workers w ON w.id = te.worker_id
                             WHERE te.project_id = p.id AND te.organization_id = :org_id AND te.pay_run_id IS NULL), 0) AS unrun_value,
                   COALESCE((SELECT SUM(r.total_net) FROM finance.site_pay_runs r
                             WHERE r.project_id = p.id AND r.status IN ('draft', 'approved') AND NOT r.is_deleted), 0) AS open_runs,
                   COALESCE((SELECT SUM(r.total_net) FROM finance.site_pay_runs r
                             WHERE r.project_id = p.id AND r.status = 'paid' AND NOT r.is_deleted), 0) AS paid_to_date
            FROM projects.projects p
            WHERE p.organization_id = :org_id AND p.is_deleted = false
              AND (EXISTS (SELECT 1 FROM finance.site_workers w WHERE w.project_id = p.id AND NOT w.is_deleted)
                   OR EXISTS (SELECT 1 FROM finance.site_time_entries te WHERE te.project_id = p.id))
            ORDER BY p.name
        """),
        {"org_id": user["org_id"]},
    )
    return ok([dict(r._mapping) for r in rows], "Site payroll by project.")
