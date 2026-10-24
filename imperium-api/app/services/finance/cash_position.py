"""
Cash Position Command Centre (Phase 6A).

A multi-horizon, two-tier forward cash projection built entirely from real,
already-existing columns - this phase ships with zero new schema. An audit
confirmed a defensible forward projection is only buildable from cash-on-
hand, statutory tax due dates, payroll payment dates, and supplier-invoice
due dates; client-receipt timing has no stored expected-date field at all,
so it is estimated from each client's measured collection delay on paid
claims (client_collection.py), falling back to a documented day-offset
constant when a client has too little history. Issued purchase orders not
yet invoiced are committed outflows dated at expected delivery plus payment
terms, net of any supplier invoice already counted below.

Two tiers only - Committed and Probable. A third "Optimistic" tier is
deliberately not shipped here: with today's data it would only be
"Probable plus zero" (nothing exists to defensibly add beyond it), and a
decorative third tier would misrepresent sophistication as truth. CRM
pipeline value is surfaced as a separate, undated, clearly-labeled summary
figure - it is never added into a dated horizon's cash number, honoring the
master spec's "0% by default unless scenario enabled" instruction: this
phase has no scenario engine, so pipeline stays visibly out of the total.

finance.commitments and finance.variations are deliberately not modeled as
timed cash items here, consistent with their treatment throughout this
initiative (Phase 2's GL bridge, Phase 5A's budgeting) - a commitment has
no timing at all, and a variation's cash impact only becomes real once it
is actually certified through a progress claim, which is already covered.

Nothing here writes to any table - this is a pure read-side projection.
"""

from datetime import date, timedelta
from typing import Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.finance.client_collection import (
    CLIENT_COLLECTION_DAYS_AFTER_CERTIFICATION,
    CLIENT_COLLECTION_DAYS_AFTER_SUBMISSION,
    CLIENT_KEY_SQL,
    MIN_PAID_CLAIMS,
    client_collection_profiles,
    default_collection_profile,
)

DEFAULT_SUPPLIER_PAYMENT_TERMS_DAYS = 30

# A supplier invoice that is already a cash event in this forecast (approved
# or matched, see the supplier-invoice queries below) or already paid. Only
# these are netted off a purchase order's open value - an unmatched or
# rejected invoice is not in the forecast, so its PO value stays committed.
_INVOICE_COUNTED_SQL = """
    si.is_deleted = false AND (
        si.status IN ('approved', 'paid')
        OR (si.match_status IN ('matched', 'partial_match') AND si.status NOT IN ('rejected', 'cancelled'))
    )
"""
OPEN_PO_STATUSES = ("issued", "partially_received", "received")

STANDARD_HORIZON_LABELS = ["yesterday", "today", "+7d", "+14d", "+30d", "+60d", "+90d", "+6mo", "+12mo"]


def standard_horizons(as_of: Optional[date] = None) -> list[date]:
    today = as_of or date.today()
    return [
        today - timedelta(days=1), today,
        today + timedelta(days=7), today + timedelta(days=14), today + timedelta(days=30),
        today + timedelta(days=60), today + timedelta(days=90),
        today + timedelta(days=182), today + timedelta(days=365),
    ]


async def get_cash_reserves(db: AsyncSession, org_id: str) -> float:
    row = await db.execute(
        text("SELECT COALESCE(SUM(current_balance), 0) AS total FROM finance.cash_accounts WHERE organization_id = :org_id AND is_active = true AND is_deleted = false"),
        {"org_id": org_id},
    )
    result = row.first()
    return float(result.total) if result else 0.0


async def get_trailing_cash_burn(db: AsyncSession, org_id: str) -> float:
    row = await db.execute(
        text("""
            SELECT COALESCE(SUM(amount), 0) AS total
            FROM finance.cashbook_transactions
            WHERE organization_id = :org_id AND direction = 'outflow' AND is_deleted = false
              AND transaction_date >= (CURRENT_DATE - INTERVAL '90 days')
        """),
        {"org_id": org_id},
    )
    result = row.first()
    return (float(result.total) / 3.0) if result else 0.0


async def compute_cash_runway(db: AsyncSession, org_id: str) -> dict:
    total_cash = await get_cash_reserves(db, org_id)
    monthly_burn = await get_trailing_cash_burn(db, org_id)
    runway_months = round(total_cash / monthly_burn, 1) if monthly_burn > 0 else None
    return {
        "total_cash": round(total_cash, 2),
        "trailing_monthly_burn": round(monthly_burn, 2),
        "runway_months": runway_months,
    }


async def _committed_events(db: AsyncSession, org_id: str, profiles: dict[str, dict]) -> list[dict]:
    events: list[dict] = []

    # Certified/invoiced claims still owed by the client. Paid claims are
    # already in cash_accounts and must not be counted again; receipts
    # allocated to a part-paid claim reduce what is still to come.
    rows = await db.execute(
        text(f"""
            SELECT pc.id, pc.certified_at::date AS base_date, {CLIENT_KEY_SQL} AS client_key,
                   pc.certified_amount - COALESCE(alloc.received, 0) AS amount
            FROM finance.progress_claims pc
            JOIN projects.projects p ON p.id = pc.project_id
            LEFT JOIN (
                SELECT progress_claim_id, SUM(allocated_amount) AS received
                FROM finance.receipt_allocations WHERE organization_id = :org_id GROUP BY progress_claim_id
            ) alloc ON alloc.progress_claim_id = pc.id
            WHERE pc.organization_id = :org_id AND pc.is_deleted = false AND pc.status IN ('certified', 'invoiced')
              AND pc.certified_at IS NOT NULL AND pc.certified_amount IS NOT NULL
        """),
        {"org_id": org_id},
    )
    for r in rows.mappings().all():
        if float(r["amount"]) <= 0:
            continue
        lag = profiles.get(r["client_key"], default_collection_profile())["days_after_certification"]
        events.append({"date": r["base_date"] + timedelta(days=lag), "amount": float(r["amount"]), "direction": "inflow", "source_type": "progress_claim", "source_id": str(r["id"]), "client_key": r["client_key"], "description": "Certified progress claim - expected collection"})

    rows = await db.execute(
        text("""
            SELECT id, due_date, outstanding_amount
            FROM finance.statutory_liabilities
            WHERE organization_id = :org_id AND is_deleted = false AND status IN ('due', 'part_paid')
              AND due_date IS NOT NULL AND outstanding_amount > 0
        """),
        {"org_id": org_id},
    )
    for r in rows.mappings().all():
        events.append({"date": r["due_date"], "amount": float(r["outstanding_amount"]), "direction": "outflow", "source_type": "statutory_liability", "source_id": str(r["id"]), "description": "Statutory liability due"})

    rows = await db.execute(
        text("""
            SELECT id, payment_date, net_pay
            FROM finance.payroll_runs
            WHERE organization_id = :org_id AND is_deleted = false AND status IN ('approved', 'posted')
              AND payment_date IS NOT NULL
        """),
        {"org_id": org_id},
    )
    for r in rows.mappings().all():
        events.append({"date": r["payment_date"], "amount": float(r["net_pay"]), "direction": "outflow", "source_type": "payroll_run", "source_id": str(r["id"]), "description": "Approved payroll run"})

    rows = await db.execute(
        text("""
            SELECT si.id, si.total_amount,
                   COALESCE(si.due_date, (si.invoice_date + (COALESCE(s.payment_terms_days, 30) || ' days')::interval)::date) AS expected_date
            FROM procurement.supplier_invoices si
            JOIN procurement.suppliers s ON s.id = si.supplier_id AND s.organization_id = si.organization_id
            WHERE si.organization_id = :org_id AND si.is_deleted = false AND si.status = 'approved'
        """),
        {"org_id": org_id},
    )
    for r in rows.mappings().all():
        events.append({"date": r["expected_date"], "amount": float(r["total_amount"]), "direction": "outflow", "source_type": "supplier_invoice", "source_id": str(r["id"]), "description": "Approved supplier invoice - due for payment"})

    return events


async def _probable_events(db: AsyncSession, org_id: str, profiles: dict[str, dict]) -> list[dict]:
    events: list[dict] = []

    rows = await db.execute(
        text(f"""
            SELECT pc.id, pc.this_claim_amount, pc.submitted_at::date AS base_date, {CLIENT_KEY_SQL} AS client_key
            FROM finance.progress_claims pc
            JOIN projects.projects p ON p.id = pc.project_id
            WHERE pc.organization_id = :org_id AND pc.is_deleted = false AND pc.status = 'submitted'
              AND pc.submitted_at IS NOT NULL
        """),
        {"org_id": org_id},
    )
    for r in rows.mappings().all():
        lag = profiles.get(r["client_key"], default_collection_profile())["days_after_submission"]
        events.append({"date": r["base_date"] + timedelta(days=lag), "amount": float(r["this_claim_amount"]), "direction": "inflow", "source_type": "progress_claim", "source_id": str(r["id"]), "client_key": r["client_key"], "description": "Submitted progress claim - awaiting certification"})

    rows = await db.execute(
        text("""
            SELECT id, due_date, outstanding_amount
            FROM finance.statutory_liabilities
            WHERE organization_id = :org_id AND is_deleted = false AND status = 'accruing'
              AND due_date IS NOT NULL AND outstanding_amount > 0
        """),
        {"org_id": org_id},
    )
    for r in rows.mappings().all():
        events.append({"date": r["due_date"], "amount": float(r["outstanding_amount"]), "direction": "outflow", "source_type": "statutory_liability", "source_id": str(r["id"]), "description": "Accruing statutory liability - estimated due date"})

    rows = await db.execute(
        text("""
            SELECT id, payment_date, net_pay
            FROM finance.payroll_runs
            WHERE organization_id = :org_id AND is_deleted = false AND status = 'draft'
              AND payment_date IS NOT NULL
        """),
        {"org_id": org_id},
    )
    for r in rows.mappings().all():
        events.append({"date": r["payment_date"], "amount": float(r["net_pay"]), "direction": "outflow", "source_type": "payroll_run", "source_id": str(r["id"]), "description": "Draft payroll run - not yet approved"})

    rows = await db.execute(
        text("""
            SELECT si.id, si.total_amount,
                   COALESCE(si.due_date, (si.invoice_date + (COALESCE(s.payment_terms_days, 30) || ' days')::interval)::date) AS expected_date
            FROM procurement.supplier_invoices si
            JOIN procurement.suppliers s ON s.id = si.supplier_id AND s.organization_id = si.organization_id
            WHERE si.organization_id = :org_id AND si.is_deleted = false AND si.match_status IN ('matched', 'partial_match')
              AND si.status NOT IN ('approved', 'paid', 'rejected', 'cancelled')
        """),
        {"org_id": org_id},
    )
    for r in rows.mappings().all():
        events.append({"date": r["expected_date"], "amount": float(r["total_amount"]), "direction": "outflow", "source_type": "supplier_invoice", "source_id": str(r["id"]), "description": "Matched supplier invoice - not yet approved for payment"})

    return events


def open_po_events(purchase_orders: list[dict], counted_invoice_totals: dict[str, float]) -> list[dict]:
    """Committed outflows for purchase-order value not yet invoiced.

    counted_invoice_totals maps po_id -> value of that PO's supplier invoices
    already in the forecast (or paid); only the remainder is added, so an
    invoiced PO is never counted twice. Each PO falls due on its expected
    delivery date plus payment terms (PO terms, else supplier terms, else 30).
    """
    events = []
    for po in purchase_orders:
        open_value = round(float(po["total_amount"] or 0) - float(counted_invoice_totals.get(str(po["id"]), 0)), 2)
        if open_value <= 0:
            continue
        terms = po.get("payment_terms_days")
        if terms is None:
            terms = DEFAULT_SUPPLIER_PAYMENT_TERMS_DAYS
        events.append({
            "date": po["expected_delivery_date"] + timedelta(days=int(terms)),
            "amount": open_value,
            "direction": "outflow",
            "source_type": "purchase_order",
            "source_id": str(po["id"]),
            "description": f"Open purchase order {po.get('po_number') or ''} - not yet invoiced",
        })
    return events


async def _purchase_order_events(db: AsyncSession, org_id: str, statuses: tuple[str, ...]) -> list[dict]:
    # Expected delivery: last confirmed GRN, else the PO's required-by date,
    # else the date it was issued/approved.
    rows = await db.execute(
        text("""
            SELECT po.id, po.po_number, po.total_amount,
                   COALESCE(grn.last_delivery, po.required_by_date, po.issued_at::date, po.approved_at::date, CURRENT_DATE) AS expected_delivery_date,
                   COALESCE(po.payment_terms_days, s.payment_terms_days) AS payment_terms_days
            FROM procurement.purchase_orders po
            LEFT JOIN procurement.suppliers s ON s.id = po.supplier_id AND s.organization_id = po.organization_id
            LEFT JOIN (
                SELECT po_id, MAX(delivery_date) AS last_delivery
                FROM procurement.goods_received_notes
                WHERE organization_id = :org_id AND is_deleted = false AND status = 'confirmed'
                GROUP BY po_id
            ) grn ON grn.po_id = po.id
            WHERE po.organization_id = :org_id AND po.is_deleted = false AND po.status = ANY(:statuses)
        """),
        {"org_id": org_id, "statuses": list(statuses)},
    )
    purchase_orders = [dict(r) for r in rows.mappings().all()]
    if not purchase_orders:
        return []
    rows = await db.execute(
        text(f"""
            SELECT si.po_id, SUM(si.total_amount) AS invoiced
            FROM procurement.supplier_invoices si
            WHERE si.organization_id = :org_id AND si.po_id IS NOT NULL AND {_INVOICE_COUNTED_SQL}
            GROUP BY si.po_id
        """),
        {"org_id": org_id},
    )
    counted = {str(r["po_id"]): float(r["invoiced"] or 0) for r in rows.mappings().all()}
    return open_po_events(purchase_orders, counted)


async def get_pipeline_summary(db: AsyncSession, org_id: str) -> dict:
    row = await db.execute(
        text("""
            SELECT COUNT(*) AS opportunity_count,
                   COALESCE(SUM(budget), 0) AS total_budget,
                   COALESCE(SUM(budget * probability / 100.0), 0) AS weighted_value
            FROM crm.opportunities
            WHERE organization_id = :org_id AND is_deleted = false AND stage NOT IN ('Contract')
        """),
        {"org_id": org_id},
    )
    result = row.mappings().first() or {"opportunity_count": 0, "total_budget": 0, "weighted_value": 0}
    return {
        "opportunity_count": result["opportunity_count"],
        "total_pipeline_value": float(result["total_budget"]),
        "weighted_pipeline_value": round(float(result["weighted_value"]), 2),
        "note": "Not included in any cash forecast tier below - shown for visibility only.",
    }


def _bucket_events(opening_cash: float, events: list[dict], horizons: list[date]) -> list[dict]:
    sorted_events = sorted(events, key=lambda e: e["date"])
    results = []
    event_idx = 0
    running_cash = opening_cash
    for horizon in horizons:
        while event_idx < len(sorted_events) and sorted_events[event_idx]["date"] <= horizon:
            event = sorted_events[event_idx]
            running_cash += event["amount"] if event["direction"] == "inflow" else -event["amount"]
            event_idx += 1
        results.append({"horizon": str(horizon), "projected_cash": round(running_cash, 2)})
    return results


def _cumulative(events: list[dict], horizon: date) -> float:
    return round(sum(e["amount"] for e in events if e["date"] <= horizon), 2)


async def _client_names(db: AsyncSession, org_id: str, keys: set[str]) -> dict[str, str]:
    if not keys:
        return {}
    rows = await db.execute(
        text(f"""
            SELECT DISTINCT ON (client_key) client_key, client_name FROM (
                SELECT {CLIENT_KEY_SQL} AS client_key, p.client_name
                FROM projects.projects p WHERE p.organization_id = :org_id
            ) k WHERE client_key = ANY(:keys)
        """),
        {"org_id": org_id, "keys": list(keys)},
    )
    return {r["client_key"]: r["client_name"] for r in rows.mappings().all()}


async def compute_cash_forecast(db: AsyncSession, org_id: str, horizons: Optional[list[date]] = None) -> dict:
    horizons = horizons or standard_horizons()
    opening_cash = await get_cash_reserves(db, org_id)
    profiles = await client_collection_profiles(db, org_id)

    committed = await _committed_events(db, org_id, profiles)
    committed_po = await _purchase_order_events(db, org_id, OPEN_PO_STATUSES)
    committed += committed_po
    probable_only = await _probable_events(db, org_id, profiles)
    probable_only += await _purchase_order_events(db, org_id, ("approved",))

    committed_series = _bucket_events(opening_cash, committed, horizons)
    probable_series = _bucket_events(opening_cash, committed + probable_only, horizons)

    pipeline = await get_pipeline_summary(db, org_id)

    # Collection delay used for every client in this forecast, plus any
    # client whose delay is measured.
    forecast_clients = {e["client_key"] for e in committed + probable_only if e.get("client_key")}
    names = await _client_names(db, org_id, forecast_clients - set(profiles))
    client_collection = sorted(
        (profiles.get(key) or {**default_collection_profile(), "client_key": key, "client_name": names.get(key)}
         for key in forecast_clients | set(profiles)),
        key=lambda c: (c["source"] != "measured", (c["client_name"] or "").lower()),
    )
    for c in client_collection:
        c["in_forecast"] = c["client_key"] in forecast_clients

    return {
        "opening_cash": round(opening_cash, 2),
        "horizon_labels": STANDARD_HORIZON_LABELS if horizons == standard_horizons() else [str(h) for h in horizons],
        "committed": committed_series,
        "probable": probable_series,
        "committed_purchase_orders": {
            "count": len(committed_po),
            "open_value": round(sum(e["amount"] for e in committed_po), 2),
            "by_horizon": [{"horizon": str(h), "cumulative_outflow": _cumulative(committed_po, h)} for h in horizons],
        },
        "pipeline": pipeline,
        "assumptions": {
            "client_collection_days_after_certification": CLIENT_COLLECTION_DAYS_AFTER_CERTIFICATION,
            "client_collection_days_after_submission": CLIENT_COLLECTION_DAYS_AFTER_SUBMISSION,
            "min_paid_claims_for_measured_delay": MIN_PAID_CLAIMS,
            "client_collection": client_collection,
            "default_supplier_payment_terms_days": DEFAULT_SUPPLIER_PAYMENT_TERMS_DAYS,
            "note": "Client receipts are dated by each client's measured median delay (paid claims and their allocated receipts); clients with too little history use the default days. Open purchase orders are dated at expected delivery plus payment terms, net of supplier invoices already in the forecast. All other dates are read directly from real due_date/payment_date columns.",
        },
    }
