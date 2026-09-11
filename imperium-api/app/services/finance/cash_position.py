"""
Cash Position Command Centre (Phase 6A).

A multi-horizon, two-tier forward cash projection built entirely from real,
already-existing columns - this phase ships with zero new schema. An audit
confirmed a defensible forward projection is only buildable from cash-on-
hand, statutory tax due dates, payroll payment dates, and supplier-invoice
due dates; client-receipt timing has no stored expected-date field at all,
so it is estimated via a documented day-offset constant rather than read
from data, and is clearly distinguishable from the real-dated sources below.

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

CLIENT_COLLECTION_DAYS_AFTER_CERTIFICATION = 30
CLIENT_COLLECTION_DAYS_AFTER_SUBMISSION = 45

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


async def _committed_events(db: AsyncSession, org_id: str) -> list[dict]:
    events: list[dict] = []

    rows = await db.execute(
        text("""
            SELECT id, project_id, certified_amount,
                   (certified_at::date + CAST(:lag AS interval))::date AS expected_date
            FROM finance.progress_claims
            WHERE organization_id = :org_id AND is_deleted = false AND status IN ('certified', 'paid')
              AND certified_at IS NOT NULL AND certified_amount IS NOT NULL
        """),
        {"org_id": org_id, "lag": timedelta(days=CLIENT_COLLECTION_DAYS_AFTER_CERTIFICATION)},
    )
    for r in rows.mappings().all():
        events.append({"date": r["expected_date"], "amount": float(r["certified_amount"]), "direction": "inflow", "source_type": "progress_claim", "source_id": str(r["id"]), "description": "Certified progress claim - expected collection"})

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


async def _probable_events(db: AsyncSession, org_id: str) -> list[dict]:
    events: list[dict] = []

    rows = await db.execute(
        text("""
            SELECT id, this_claim_amount, (submitted_at::date + CAST(:lag AS interval))::date AS expected_date
            FROM finance.progress_claims
            WHERE organization_id = :org_id AND is_deleted = false AND status = 'submitted'
              AND submitted_at IS NOT NULL
        """),
        {"org_id": org_id, "lag": timedelta(days=CLIENT_COLLECTION_DAYS_AFTER_SUBMISSION)},
    )
    for r in rows.mappings().all():
        events.append({"date": r["expected_date"], "amount": float(r["this_claim_amount"]), "direction": "inflow", "source_type": "progress_claim", "source_id": str(r["id"]), "description": "Submitted progress claim - awaiting certification"})

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
              AND si.status != 'approved'
        """),
        {"org_id": org_id},
    )
    for r in rows.mappings().all():
        events.append({"date": r["expected_date"], "amount": float(r["total_amount"]), "direction": "outflow", "source_type": "supplier_invoice", "source_id": str(r["id"]), "description": "Matched supplier invoice - not yet approved for payment"})

    return events


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


async def compute_cash_forecast(db: AsyncSession, org_id: str, horizons: Optional[list[date]] = None) -> dict:
    horizons = horizons or standard_horizons()
    opening_cash = await get_cash_reserves(db, org_id)

    committed = await _committed_events(db, org_id)
    probable_only = await _probable_events(db, org_id)

    committed_series = _bucket_events(opening_cash, committed, horizons)
    probable_series = _bucket_events(opening_cash, committed + probable_only, horizons)

    pipeline = await get_pipeline_summary(db, org_id)

    return {
        "opening_cash": round(opening_cash, 2),
        "horizon_labels": STANDARD_HORIZON_LABELS if horizons == standard_horizons() else [str(h) for h in horizons],
        "committed": committed_series,
        "probable": probable_series,
        "pipeline": pipeline,
        "assumptions": {
            "client_collection_days_after_certification": CLIENT_COLLECTION_DAYS_AFTER_CERTIFICATION,
            "client_collection_days_after_submission": CLIENT_COLLECTION_DAYS_AFTER_SUBMISSION,
            "note": "Client receipt dates are estimated (no expected-collection-date field exists on progress_claims) - all other dates are read directly from real due_date/payment_date columns.",
        },
    }
