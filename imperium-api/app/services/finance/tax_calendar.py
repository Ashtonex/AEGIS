"""
Tax compliance calendar (Phase 8C).

finance.statutory_liabilities.due_date (migration 080) has existed since
before this whole GL initiative but nothing ever set it - statutory_accrual.py
now computes it on every accrual. This module is the read side (a live list
of upcoming deadlines) and the alerting side (staged notifications at
30/14/7/3/1 days out and overdue) built on top of that column.

Staged alerts are point-in-time notifications, not ccb_monitor_findings-style
ongoing conditions - a "30 days out" event happens once per liability and
never needs to be tracked/resolved the way a budget overrun does. This
function is deliberately Redis-free and stateless (safe to call repeatedly
in tests); the cron job wrapper in app/workers/arq_worker.py is what applies
the long-lived dedupe key so a stage only ever notifies once in production.
"""

from datetime import date
from typing import Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.shared.events import emit_role_notification

STAGES = (30, 14, 7, 3, 1)


async def get_upcoming_deadlines(db: AsyncSession, *, org_id: str) -> list[dict]:
    rows = await db.execute(
        text("""
            SELECT id, authority, liability_type, currency, period_start, period_end,
                   due_date, outstanding_amount, status,
                   (due_date - CURRENT_DATE) AS days_until_due
            FROM finance.statutory_liabilities
            WHERE organization_id = :org_id AND is_deleted = false
              AND status NOT IN ('paid', 'waived') AND due_date IS NOT NULL
            ORDER BY due_date
        """),
        {"org_id": org_id},
    )
    return [dict(r._mapping) for r in rows]


def _stage_for(days_until_due: int) -> Optional[str]:
    if days_until_due < 0:
        return "overdue"
    if days_until_due in STAGES:
        return str(days_until_due)
    return None


async def list_deadline_candidates(db: AsyncSession, *, org_id: Optional[str] = None) -> list[dict]:
    """Pure read, no notification side effects: every unpaid liability with
    a due_date that currently matches an alert stage (30/14/7/3/1 days out,
    or overdue). Sweeps one org (org_id given) or every org (org_id=None),
    matching ccb_monitor.py's run_budget_overrun_check scoping idiom. The
    cron job uses this to decide, per (liability_id, stage), whether its own
    Redis dedupe key has already fired before calling notify_deadline."""
    rows = await db.execute(
        text("""
            SELECT id, organization_id, authority, liability_type, currency, period_start, period_end,
                   due_date, outstanding_amount,
                   (due_date - CURRENT_DATE) AS days_until_due
            FROM finance.statutory_liabilities
            WHERE (CAST(:org_id AS uuid) IS NULL OR organization_id = :org_id)
              AND is_deleted = false AND status NOT IN ('paid', 'waived') AND due_date IS NOT NULL
        """),
        {"org_id": org_id},
    )
    candidates = []
    for row in rows.mappings():
        stage = _stage_for(int(row["days_until_due"]))
        if stage is not None:
            candidates.append({**dict(row), "stage": stage})
    return candidates


async def notify_deadline(db: AsyncSession, *, candidate: dict) -> None:
    """Actually emits the role notification for one candidate from
    list_deadline_candidates. Split out from the sweep so the cron job can
    dedupe per (liability_id, stage) before calling this - this function
    itself has no dedupe awareness, it always sends."""
    stage = candidate["stage"]
    org_id = str(candidate["organization_id"])
    period_label = candidate["period_start"].strftime("%b %Y")
    liability_label = f"{candidate['liability_type'].upper()} for {period_label}"

    if stage == "overdue":
        title = f"{liability_label} is overdue"
        message = f"{liability_label} was due on {candidate['due_date']} and is still outstanding (US${candidate['outstanding_amount']})."
        role_names = ["Finance Manager", "Managing Director", "Executive (Admin)"]
        priority = "high"
    else:
        title = f"{liability_label} due in {stage} day{'s' if stage != '1' else ''}"
        message = f"{liability_label} is due on {candidate['due_date']} (US${candidate['outstanding_amount']} outstanding)."
        role_names = ["Finance Manager"]
        priority = "normal"

    await emit_role_notification(
        db, org_id=org_id, role_names=role_names, title=title, message=message,
        notification_type="finance_statutory", priority=priority,
        metadata={"liability_id": str(candidate["id"]), "stage": stage},
    )


async def check_tax_deadline_alerts(db: AsyncSession, *, org_id: Optional[str] = None) -> dict:
    """Convenience sweep-and-notify-all, used for direct/manual invocation
    and tests - unconditionally notifies every current candidate with no
    dedupe. The production cron job does NOT call this; it calls
    list_deadline_candidates + notify_deadline itself so it can dedupe each
    (liability_id, stage) via Redis first, ensuring a stage only ever
    notifies once in production."""
    candidates = await list_deadline_candidates(db, org_id=org_id)
    for candidate in candidates:
        await notify_deadline(db, candidate=candidate)
    return {"checked": len(candidates), "notified": len(candidates), "stages": [
        {"liability_id": str(c["id"]), "org_id": str(c["organization_id"]), "stage": c["stage"]} for c in candidates
    ]}
