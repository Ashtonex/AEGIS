"""
CCB (Commercial Control Brain) automated monitoring checks.

Runs on a schedule (see app/workers/arq_worker.py) rather than only when a
human clicks a governance tool, and writes/updates rows in
finance.ccb_monitor_findings - an open/resolved-lifecycle feed, distinct
from the point-in-time audit tables the manual CCB tools write to.

Each check function is independently callable with an explicit org_id (for
manual testing / a single-org re-run) or with org_id=None to sweep every
organization in one batch query, matching the pattern already used by
app/workers/arq_worker.py's poll_ticket_sla_triggers_job.
"""

import json
from datetime import date, timedelta
from typing import Any, Dict, Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services import inventory_service
from app.services.finance.project_forecast import (
    compute_project_financials,
    derive_forecast_metrics,
)
from app.shared.events import emit_role_notification
from core.logging import logger
from core.security import SUPERADMIN_ROLE

# Deliberately a local, module-owned list rather than importing
# project_forecast.COMMERCIAL_ALERT_ROLES - each CCB-adjacent module keeps
# its own explicit alert-role list (see compliance_gap.py's ALERT_ROLES for
# the same convention) rather than sharing one constant across modules.
COMMERCIAL_ALERT_ROLES = ["Executive (Admin)", "Finance Manager", SUPERADMIN_ROLE]

_ACTIVE_PROJECT_STATUSES = ("active", "in progress", "ongoing", "live", "execution")


async def _find_budget_overrun_candidates(db: AsyncSession, org_id: Optional[str]):
    """Projects with an approved budget and at least one active BOQ line -
    the minimum real data needed for the overrun comparison to mean anything."""
    rows = (
        await db.execute(
            text("""
                SELECT DISTINCT p.id AS project_id, p.organization_id AS org_id
                FROM projects.projects p
                JOIN finance.project_budgets pb
                    ON pb.project_id = p.id AND pb.organization_id = p.organization_id
                   AND pb.status = 'approved' AND pb.is_deleted = false
                WHERE p.is_deleted = false
                  AND (CAST(:org_id AS uuid) IS NULL OR p.organization_id = CAST(:org_id AS uuid))
                  AND lower(COALESCE(p.status, '')) = ANY(:active_statuses)
                  AND EXISTS (
                      SELECT 1 FROM finance.boq_line_items b
                      WHERE b.project_id = p.id AND b.organization_id = p.organization_id
                        AND b.status = 'active' AND b.is_deleted = false
                  )
            """),
            {"org_id": org_id, "active_statuses": list(_ACTIVE_PROJECT_STATUSES)},
        )
    ).mappings().all()
    return rows


def _overrun_severity(unexplained_overrun_amount: float, justified_ceiling: float) -> str:
    if justified_ceiling <= 0:
        return "medium"
    ratio = unexplained_overrun_amount / justified_ceiling
    if ratio >= 0.20:
        return "critical"
    if ratio >= 0.10:
        return "high"
    return "medium"


async def _upsert_finding(
    db: AsyncSession,
    *,
    org_id: str,
    project_id: str,
    check_type: str,
    natural_key: str,
    severity: str,
    summary: str,
    evidence: Dict[str, Any],
) -> bool:
    """UPSERT on (organization_id, natural_key). Returns True if this finding
    is newly open (first-ever detection, or a resolved -> open transition) -
    the only two cases the caller should notify on, so a finding that stays
    open (or stays acknowledged) across repeated runs never re-notifies."""
    existing = (
        await db.execute(
            text("""
                SELECT status FROM finance.ccb_monitor_findings
                WHERE organization_id = :org_id AND natural_key = :natural_key
            """),
            {"org_id": org_id, "natural_key": natural_key},
        )
    ).first()

    newly_open = existing is None or existing.status == "resolved"

    await db.execute(
        text("""
            INSERT INTO finance.ccb_monitor_findings (
                organization_id, project_id, check_type, natural_key,
                severity, status, summary, evidence,
                first_detected_at, last_seen_at, last_notified_at
            ) VALUES (
                :org_id, :project_id, :check_type, :natural_key,
                :severity, 'open', :summary, CAST(:evidence AS jsonb),
                NOW(), NOW(), CASE WHEN :newly_open THEN NOW() ELSE NULL END
            )
            ON CONFLICT (organization_id, natural_key) DO UPDATE SET
                severity = EXCLUDED.severity,
                summary = EXCLUDED.summary,
                evidence = EXCLUDED.evidence,
                last_seen_at = NOW(),
                status = CASE WHEN :newly_open THEN 'open' ELSE finance.ccb_monitor_findings.status END,
                resolved_at = CASE WHEN :newly_open THEN NULL ELSE finance.ccb_monitor_findings.resolved_at END,
                resolved_by = CASE WHEN :newly_open THEN NULL ELSE finance.ccb_monitor_findings.resolved_by END,
                last_notified_at = CASE WHEN :newly_open THEN NOW() ELSE finance.ccb_monitor_findings.last_notified_at END
        """),
        {
            "org_id": org_id,
            "project_id": project_id,
            "check_type": check_type,
            "natural_key": natural_key,
            "severity": severity,
            "summary": summary,
            "evidence": json.dumps(evidence, default=str),
            "newly_open": newly_open,
        },
    )
    return newly_open


async def _resolve_finding(db: AsyncSession, *, org_id: str, natural_key: str) -> None:
    """Auto-clears a finding whose underlying condition is no longer true,
    rather than leaving a stale alert nobody will ever clear by hand. A
    no-op if no open/acknowledged finding exists for this key."""
    await db.execute(
        text("""
            UPDATE finance.ccb_monitor_findings
            SET status = 'resolved', resolved_at = NOW(), last_seen_at = NOW()
            WHERE organization_id = :org_id AND natural_key = :natural_key
              AND status IN ('open', 'acknowledged')
        """),
        {"org_id": org_id, "natural_key": natural_key},
    )


async def run_budget_overrun_check(db: AsyncSession, org_id: Optional[str] = None) -> Dict[str, int]:
    """Compares estimate-at-completion against approved budget + approved
    variations for every eligible project, reusing the exact math
    project_forecast.py already trusts for the quotation-win-time alert -
    the only change is running it on a schedule instead of once.

    Pass org_id to scope to a single organization (manual test / admin
    re-run); pass None to sweep every organization in one batch, matching
    the cron job's usage.
    """
    candidates = await _find_budget_overrun_candidates(db, org_id)
    checked = 0
    findings_open = 0
    notified = 0

    for row in candidates:
        checked += 1
        project_org_id = str(row["org_id"])
        project_id = str(row["project_id"])

        financials = await compute_project_financials(db, project_org_id, project_id)
        if financials is None:
            continue
        metrics = derive_forecast_metrics(financials)

        natural_key = f"{project_id}:budget_boq_overrun"

        if metrics.get("unexplained_overrun_amount", 0) <= 0:
            # No unexplained overrun right now - resolve any previously
            # open finding for this project.
            await _resolve_finding(db, org_id=project_org_id, natural_key=natural_key)
            continue

        findings_open += 1
        project_title = financials.get("project_title") or "Project"
        justified_ceiling = metrics["approved_budget"] + metrics["approved_variations"]
        summary = (
            f"Estimate at completion (${metrics['estimate_at_completion']:,.2f}) exceeds the approved "
            f"budget plus approved variations (${justified_ceiling:,.2f}) by "
            f"${metrics['unexplained_overrun_amount']:,.2f}, with no matching approved change order on file."
        )
        severity = _overrun_severity(metrics["unexplained_overrun_amount"], justified_ceiling)

        newly_open = await _upsert_finding(
            db,
            org_id=project_org_id,
            project_id=project_id,
            check_type="budget_boq_overrun",
            natural_key=natural_key,
            severity=severity,
            summary=summary,
            evidence={
                "estimate_at_completion": metrics["estimate_at_completion"],
                "approved_budget": metrics["approved_budget"],
                "approved_variations": metrics["approved_variations"],
                "unexplained_overrun_amount": metrics["unexplained_overrun_amount"],
            },
        )

        if newly_open:
            notified += 1
            await emit_role_notification(
                db,
                org_id=project_org_id,
                role_names=COMMERCIAL_ALERT_ROLES,
                title=f"CCB: budget overrun risk detected on {project_title}",
                message=summary + " Either raise a variation to formally document the scope/cost change, or investigate the overrun.",
                notification_type="ccb_budget_boq_overrun",
                priority="urgent" if severity == "critical" else "high",
                action_url="/dashboard/finance",
                metadata={"project_id": project_id, "check_type": "budget_boq_overrun"},
            )

    logger.info(
        f"CCB budget overrun check: {checked} project(s) evaluated, "
        f"{findings_open} with an open overrun, {notified} newly notified."
    )
    return {"checked": checked, "findings_open": findings_open, "notified": notified}


# ---------------------------------------------------------------------------
# Requisition budget-breach check (Phase 3) - primarily an event hook fired
# synchronously at submit/approve time (see record_requisition_budget_breach,
# called from routers/procurement.py) so a breach is findable immediately,
# not after waiting for the next daily sweep. The sweep below exists to
# catch requisitions that were within budget when actioned but whose
# project's budget position has since drifted (another requisition or cost
# transaction ate the remaining headroom), and to resolve findings whose
# requisition is no longer in an open state.
# ---------------------------------------------------------------------------

_OPEN_REQUISITION_STATUSES = ("submitted", "approved", "ordered")


def _requisition_natural_key(project_id: str, requisition_id: str) -> str:
    return f"{project_id}:requisition_budget_breach:{requisition_id}"


async def record_requisition_budget_breach(
    db: AsyncSession,
    *,
    org_id: str,
    project_id: str,
    requisition_id: str,
    requisition_number: str,
    total_estimated: float,
    budget_available: float,
) -> bool:
    """Call this right where a requisition is actually allowed to proceed
    over budget (submit or approve, after an authorized override) - it's the
    real-time counterpart to the daily sweep. No-ops (returns False) if the
    requisition isn't actually over budget. Returns True if this is a new or
    reopened finding (i.e. a notification was sent)."""
    breach_amount = float(total_estimated) - float(budget_available)
    if breach_amount <= 0:
        return False

    natural_key = _requisition_natural_key(project_id, requisition_id)
    severity = _overrun_severity(breach_amount, float(total_estimated))
    summary = (
        f"Requisition {requisition_number} (${float(total_estimated):,.2f}) was allowed to proceed "
        f"${breach_amount:,.2f} over the project's available approved budget "
        f"(${float(budget_available):,.2f} available) via an authorized override."
    )

    newly_open = await _upsert_finding(
        db,
        org_id=org_id,
        project_id=project_id,
        check_type="requisition_budget_breach",
        natural_key=natural_key,
        severity=severity,
        summary=summary,
        evidence={
            "requisition_id": requisition_id,
            "requisition_number": requisition_number,
            "total_estimated": float(total_estimated),
            "budget_available": float(budget_available),
            "breach_amount": breach_amount,
        },
    )

    if newly_open:
        await emit_role_notification(
            db,
            org_id=org_id,
            role_names=COMMERCIAL_ALERT_ROLES,
            title=f"CCB: requisition {requisition_number} approved over budget",
            message=summary,
            notification_type="ccb_requisition_budget_breach",
            priority="urgent" if severity == "critical" else "high",
            action_url="/dashboard/procurement?tab=requisitions",
            metadata={
                "project_id": project_id,
                "requisition_id": requisition_id,
                "check_type": "requisition_budget_breach",
            },
        )

    return newly_open


async def _resolve_stale_requisition_findings(db: AsyncSession, org_id: Optional[str]) -> None:
    """Findings whose requisition has since been rejected/cancelled won't be
    revisited by the sweep loop below (it only selects open-status
    requisitions), so clear them here based on the requisition_id recorded
    in evidence at creation time."""
    await db.execute(
        text("""
            UPDATE finance.ccb_monitor_findings f
            SET status = 'resolved', resolved_at = NOW(), last_seen_at = NOW()
            FROM procurement.purchase_requisitions r
            WHERE f.check_type = 'requisition_budget_breach'
              AND f.status IN ('open', 'acknowledged')
              AND f.organization_id = r.organization_id
              AND (f.evidence->>'requisition_id') = r.id::text
              AND (CAST(:org_id AS uuid) IS NULL OR f.organization_id = CAST(:org_id AS uuid))
              AND NOT (r.status = ANY(:open_statuses))
        """),
        {"org_id": org_id, "open_statuses": list(_OPEN_REQUISITION_STATUSES)},
    )


async def _find_open_requisitions(db: AsyncSession, org_id: Optional[str]):
    rows = (
        await db.execute(
            text("""
                SELECT id AS requisition_id, organization_id AS org_id, project_id,
                       requisition_number, total_estimated
                FROM procurement.purchase_requisitions
                WHERE is_deleted = false
                  AND status = ANY(:open_statuses)
                  AND project_id IS NOT NULL
                  AND (CAST(:org_id AS uuid) IS NULL OR organization_id = CAST(:org_id AS uuid))
            """),
            {"open_statuses": list(_OPEN_REQUISITION_STATUSES), "org_id": org_id},
        )
    ).mappings().all()
    return rows


async def run_requisition_budget_breach_check(db: AsyncSession, org_id: Optional[str] = None) -> Dict[str, int]:
    """Daily sweep: re-evaluates every submitted/approved/ordered
    requisition's project budget headroom (the same figure
    inventory_service.budget_available already computes at submit/approve
    time) and upserts/resolves the requisition_budget_breach finding to
    match current reality.
    """
    await _resolve_stale_requisition_findings(db, org_id)

    requisitions = await _find_open_requisitions(db, org_id)
    checked = 0
    findings_open = 0
    notified = 0

    for row in requisitions:
        checked += 1
        req_org_id = str(row["org_id"])
        project_id = str(row["project_id"])
        requisition_id = str(row["requisition_id"])
        natural_key = _requisition_natural_key(project_id, requisition_id)

        available = await inventory_service.budget_available(
            db, org_id=req_org_id, project_id=row["project_id"]
        )
        total_estimated = float(row["total_estimated"] or 0)

        if available is None or total_estimated <= float(available):
            await _resolve_finding(db, org_id=req_org_id, natural_key=natural_key)
            continue

        findings_open += 1
        breach_amount = total_estimated - float(available)
        severity = _overrun_severity(breach_amount, total_estimated)
        summary = (
            f"Requisition {row['requisition_number']} (${total_estimated:,.2f}) now exceeds the "
            f"project's available approved budget (${float(available):,.2f} available) by "
            f"${breach_amount:,.2f} - the project's budget position has drifted since this "
            "requisition was submitted/approved."
        )

        newly_open = await _upsert_finding(
            db,
            org_id=req_org_id,
            project_id=project_id,
            check_type="requisition_budget_breach",
            natural_key=natural_key,
            severity=severity,
            summary=summary,
            evidence={
                "requisition_id": requisition_id,
                "requisition_number": row["requisition_number"],
                "total_estimated": total_estimated,
                "budget_available": float(available),
                "breach_amount": breach_amount,
            },
        )

        if newly_open:
            notified += 1
            await emit_role_notification(
                db,
                org_id=req_org_id,
                role_names=COMMERCIAL_ALERT_ROLES,
                title=f"CCB: requisition {row['requisition_number']} now over budget",
                message=summary,
                notification_type="ccb_requisition_budget_breach",
                priority="urgent" if severity == "critical" else "high",
                action_url="/dashboard/procurement?tab=requisitions",
                metadata={
                    "project_id": project_id,
                    "requisition_id": requisition_id,
                    "check_type": "requisition_budget_breach",
                },
            )

    logger.info(
        f"CCB requisition budget-breach sweep: {checked} requisition(s) evaluated, "
        f"{findings_open} over budget, {notified} newly notified."
    )
    return {"checked": checked, "findings_open": findings_open, "notified": notified}


# ---------------------------------------------------------------------------
# Client variance / document-change staleness check (Phase 4). Flags
# finance.document_change_logs rows that required MD approval and have gone
# 3+ days without it. Deliberately does NOT attempt to reconcile this table
# with finance.variations (the real, FK-backed change-order table the budget
# math trusts) - document_change_logs has no approval endpoint anywhere in
# the product (is_approved is never set by anything) and project_id is a
# bare VARCHAR, not an FK. Both are real, separate architecture gaps that
# deserve their own scoped review, not a silent fix bundled into a
# monitoring job - so every finding this check raises says so explicitly,
# otherwise the first MD who tries to act on it finds nothing to click and
# it reads as a bug in the monitor instead of the pre-existing gap it is.
# ---------------------------------------------------------------------------

_STALE_APPROVAL_DAYS = 3


def _document_change_natural_key(project_id: str, change_id: str) -> str:
    return f"{project_id}:variance_stale_approval:{change_id}"


def _staleness_severity(days_stale: int) -> str:
    if days_stale >= 14:
        return "critical"
    if days_stale >= 7:
        return "high"
    return "medium"


async def _resolve_settled_document_change_findings(db: AsyncSession, org_id: Optional[str]) -> None:
    """Clears a finding once its underlying change log row is approved or
    gone - covers both "someone eventually recorded approval some other
    way" and "the log row was deleted" without the sweep needing to revisit
    every historical change_id explicitly."""
    await db.execute(
        text("""
            UPDATE finance.ccb_monitor_findings f
            SET status = 'resolved', resolved_at = NOW(), last_seen_at = NOW()
            WHERE f.check_type = 'variance_stale_approval'
              AND f.status IN ('open', 'acknowledged')
              AND (CAST(:org_id AS uuid) IS NULL OR f.organization_id = CAST(:org_id AS uuid))
              AND NOT EXISTS (
                  SELECT 1 FROM finance.document_change_logs dcl
                  WHERE dcl.id::text = (f.evidence->>'change_id')
                    AND dcl.organization_id = f.organization_id
                    AND dcl.approval_level_required = 'MD_APPROVAL_REQUIRED'
                    AND dcl.is_approved = false
              )
        """),
        {"org_id": org_id},
    )


async def _find_stale_document_changes(db: AsyncSession, org_id: Optional[str]):
    rows = (
        await db.execute(
            text("""
                SELECT dcl.id AS change_id, dcl.organization_id AS org_id,
                       p.id AS project_id, p.name AS project_title,
                       dcl.document_name, dcl.revision, dcl.margin_impact_amount,
                       EXTRACT(DAY FROM NOW() - dcl.created_at)::int AS days_stale
                FROM finance.document_change_logs dcl
                JOIN projects.projects p
                    ON p.id::text = dcl.project_id AND p.organization_id = dcl.organization_id
                   AND p.is_deleted = false
                WHERE dcl.approval_level_required = 'MD_APPROVAL_REQUIRED'
                  AND dcl.is_approved = false
                  AND dcl.created_at < NOW() - make_interval(days => :threshold_days)
                  AND (CAST(:org_id AS uuid) IS NULL OR dcl.organization_id = CAST(:org_id AS uuid))
            """),
            {"org_id": org_id, "threshold_days": _STALE_APPROVAL_DAYS},
        )
    ).mappings().all()
    return rows


async def run_variance_staleness_check(db: AsyncSession, org_id: Optional[str] = None) -> Dict[str, int]:
    """Daily cron: flags document/drawing revisions that required MD
    approval and have sat unapproved for 3+ days. See module docstring
    above this section for why this is deliberately kept separate from
    finance.variations.
    """
    await _resolve_settled_document_change_findings(db, org_id)

    rows = await _find_stale_document_changes(db, org_id)
    checked = 0
    findings_open = 0
    notified = 0

    for row in rows:
        checked += 1
        change_org_id = str(row["org_id"])
        project_id = str(row["project_id"])
        project_title = row["project_title"] or "Project"
        change_id = str(row["change_id"])
        days_stale = int(row["days_stale"])
        margin_impact = float(row["margin_impact_amount"] or 0)

        natural_key = _document_change_natural_key(project_id, change_id)
        severity = _staleness_severity(days_stale)
        summary = (
            f"{row['document_name']} ({row['revision']}) on {project_title} has required MD approval for "
            f"{days_stale} day(s) with no approval recorded (margin impact ${margin_impact:,.2f}). "
            "Note: there is currently no approval action in the product for this workflow - this finding "
            "surfaces a known gap in the change-review process, not a bug in this monitor. Approval must "
            "be tracked and actioned manually until a real approval endpoint exists."
        )

        findings_open += 1
        newly_open = await _upsert_finding(
            db,
            org_id=change_org_id,
            project_id=project_id,
            check_type="variance_stale_approval",
            natural_key=natural_key,
            severity=severity,
            summary=summary,
            evidence={
                "change_id": change_id,
                "document_name": row["document_name"],
                "revision": row["revision"],
                "margin_impact_amount": margin_impact,
                "days_stale": days_stale,
            },
        )

        if newly_open:
            notified += 1
            await emit_role_notification(
                db,
                org_id=change_org_id,
                role_names=COMMERCIAL_ALERT_ROLES,
                title=f"CCB: MD approval overdue on {project_title}",
                message=summary,
                notification_type="ccb_variance_stale_approval",
                priority="urgent" if severity == "critical" else "high",
                action_url="/dashboard/quotations/ccb",
                metadata={
                    "project_id": project_id,
                    "change_id": change_id,
                    "check_type": "variance_stale_approval",
                },
            )

    logger.info(
        f"CCB variance staleness check: {checked} stale change(s) evaluated, "
        f"{findings_open} open, {notified} newly notified."
    )
    return {"checked": checked, "findings_open": findings_open, "notified": notified}


# ---------------------------------------------------------------------------
# Weekly BOQ pace-variance check (Phase 5). projects.weekly_budget_items
# already carries a planned_qty per BOQ line for a given week, and
# finance.boq_measurement_entries already carries dated, approved measured
# quantities against that same BOQ line - but nothing compared the two.
# This check closes that gap: for every approved weekly budget whose week
# has started, it sums approved measurements dated within that week against
# the line's planned quantity, and separately checks whether any daily site
# report exists for the project during that week as supporting evidence.
# Deliberately does not touch daily_site_reports' planned_work/actual_work
# text fields - those aren't linked to a BOQ line or cost code anywhere in
# the schema, so "evidence exists" here means "at least one report was filed
# that week," not "the report corroborates this specific quantity."
# ---------------------------------------------------------------------------

_PACE_LOOKBACK_DAYS = 60
_OVER_PACE_RATIO = 1.5
_UNDER_PACE_RATIO = 0.5


def _weekly_pace_natural_key(project_id: str, weekly_budget_item_id: str) -> str:
    return f"{project_id}:weekly_boq_pace_variance:{weekly_budget_item_id}"


async def _find_weekly_pace_candidates(db: AsyncSession, org_id: Optional[str]):
    rows = (
        await db.execute(
            text("""
                SELECT
                    wbi.id AS weekly_budget_item_id,
                    wbi.organization_id AS org_id,
                    wbi.project_id,
                    p.name AS project_title,
                    wb.week_start,
                    bli.description AS boq_description,
                    bli.unit,
                    wbi.planned_qty,
                    wbi.planned_amount,
                    COALESCE(m.actual_qty, 0) AS actual_qty,
                    COALESCE(dr.report_count, 0) AS daily_report_count
                FROM projects.weekly_budget_items wbi
                JOIN projects.weekly_budgets wb
                    ON wb.id = wbi.weekly_budget_id AND wb.organization_id = wbi.organization_id
                   AND wb.status = 'approved' AND wb.is_deleted = false
                JOIN projects.projects p
                    ON p.id = wbi.project_id AND p.organization_id = wbi.organization_id
                   AND p.is_deleted = false
                JOIN finance.boq_line_items bli
                    ON bli.id = wbi.boq_line_item_id AND bli.organization_id = wbi.organization_id
                LEFT JOIN LATERAL (
                    SELECT COALESCE(SUM(me.qty_this_period), 0) AS actual_qty
                    FROM finance.boq_measurement_entries me
                    WHERE me.boq_line_item_id = wbi.boq_line_item_id
                      AND me.organization_id = wbi.organization_id
                      AND me.status = 'approved'
                      AND me.measurement_date BETWEEN wb.week_start AND (wb.week_start + INTERVAL '6 days')
                ) m ON true
                LEFT JOIN LATERAL (
                    SELECT COUNT(*) AS report_count
                    FROM projects.daily_site_reports dsr
                    WHERE dsr.project_id = wbi.project_id
                      AND dsr.organization_id = wbi.organization_id
                      AND dsr.report_date BETWEEN wb.week_start AND (wb.week_start + INTERVAL '6 days')
                ) dr ON true
                WHERE wbi.is_deleted = false
                  AND wbi.boq_line_item_id IS NOT NULL
                  AND wbi.planned_qty > 0
                  AND wb.week_start BETWEEN CURRENT_DATE - make_interval(days => :lookback_days) AND CURRENT_DATE
                  AND (CAST(:org_id AS uuid) IS NULL OR wbi.organization_id = CAST(:org_id AS uuid))
            """),
            {"org_id": org_id, "lookback_days": _PACE_LOOKBACK_DAYS},
        )
    ).mappings().all()
    return rows


def _weekly_pace_finding(row) -> Optional[Dict[str, Any]]:
    """Returns None when nothing about this row is worth flagging (caller
    should resolve any existing finding), otherwise a dict of
    {severity, summary} describing the one most relevant condition. Never
    labels a condition as fraud - only as a pattern worth review, consistent
    with the rest of this module's findings."""
    planned = float(row["planned_qty"] or 0)
    actual = float(row["actual_qty"] or 0)
    reports = int(row["daily_report_count"] or 0)
    week_start = row["week_start"]
    week_end = week_start + timedelta(days=6)
    week_fully_elapsed = week_end < date.today()
    unit = row["unit"] or "unit(s)"
    desc = row["boq_description"] or "BOQ line"

    if actual > planned * _OVER_PACE_RATIO:
        ratio = actual / planned if planned else 0
        if reports == 0:
            severity = "critical" if ratio >= 2.5 else "high"
            summary = (
                f"{desc}: {actual:,.2f} {unit} measured and approved for the week of {week_start} "
                f"against a plan of {planned:,.2f} {unit} ({ratio:.1f}x plan), with no daily site "
                f"report on file for that week as supporting evidence. Unusual pattern - recommend "
                f"verifying the measurement before it is relied on for a progress claim."
            )
        else:
            severity = "medium"
            summary = (
                f"{desc}: {actual:,.2f} {unit} measured and approved for the week of {week_start} "
                f"against a plan of {planned:,.2f} {unit} ({ratio:.1f}x plan). {reports} daily site "
                f"report(s) exist for that week. Materially ahead of the weekly plan - worth a quick "
                f"review of the measurement and the plan."
            )
        return {"severity": severity, "summary": summary}

    if week_fully_elapsed and actual == 0:
        if reports == 0:
            severity = "high"
            summary = (
                f"{desc}: {planned:,.2f} {unit} was planned for the week of {week_start} but no "
                f"measurement was approved and no daily site report was filed for that week - both "
                f"the planned progress and its supporting evidence are missing."
            )
        else:
            severity = "medium"
            summary = (
                f"{desc}: {planned:,.2f} {unit} was planned for the week of {week_start} but no "
                f"measurement has been submitted/approved against this BOQ line yet, even though "
                f"{reports} daily site report(s) exist for that week - a measurement recording lag "
                f"worth following up."
            )
        return {"severity": severity, "summary": summary}

    if week_fully_elapsed and 0 < actual < planned * _UNDER_PACE_RATIO:
        pct = (actual / planned * 100) if planned else 0
        severity = "low"
        summary = (
            f"{desc}: only {actual:,.2f} of {planned:,.2f} {unit} planned for the week of "
            f"{week_start} was measured and approved ({pct:.0f}% of plan) - behind the weekly pace."
        )
        return {"severity": severity, "summary": summary}

    return None


async def run_weekly_boq_pace_variance_check(db: AsyncSession, org_id: Optional[str] = None) -> Dict[str, int]:
    """Daily cron (CCB automation Phase 5): cross-checks planned weekly BOQ
    quantities (projects.weekly_budget_items) against approved measured
    progress for the same week (finance.boq_measurement_entries) and against
    daily site report presence (projects.daily_site_reports), flagging
    material over-pace, under-pace and missing-evidence patterns.
    """
    candidates = await _find_weekly_pace_candidates(db, org_id)
    checked = 0
    findings_open = 0
    notified = 0

    for row in candidates:
        checked += 1
        project_org_id = str(row["org_id"])
        project_id = str(row["project_id"])
        item_id = str(row["weekly_budget_item_id"])
        natural_key = _weekly_pace_natural_key(project_id, item_id)

        finding = _weekly_pace_finding(row)
        if finding is None:
            await _resolve_finding(db, org_id=project_org_id, natural_key=natural_key)
            continue

        findings_open += 1
        project_title = row["project_title"] or "Project"

        newly_open = await _upsert_finding(
            db,
            org_id=project_org_id,
            project_id=project_id,
            check_type="weekly_boq_pace_variance",
            natural_key=natural_key,
            severity=finding["severity"],
            summary=finding["summary"],
            evidence={
                "weekly_budget_item_id": item_id,
                "week_start": str(row["week_start"]),
                "boq_description": row["boq_description"],
                "unit": row["unit"],
                "planned_qty": float(row["planned_qty"] or 0),
                "actual_qty": float(row["actual_qty"] or 0),
                "daily_report_count": int(row["daily_report_count"] or 0),
            },
        )

        if newly_open:
            notified += 1
            await emit_role_notification(
                db,
                org_id=project_org_id,
                role_names=COMMERCIAL_ALERT_ROLES,
                title=f"CCB: weekly BOQ pace variance on {project_title}",
                message=finding["summary"],
                notification_type="ccb_weekly_boq_pace_variance",
                priority="urgent" if finding["severity"] == "critical" else "high",
                action_url="/dashboard/finance",
                metadata={
                    "project_id": project_id,
                    "weekly_budget_item_id": item_id,
                    "check_type": "weekly_boq_pace_variance",
                },
            )

    logger.info(
        f"CCB weekly BOQ pace-variance check: {checked} weekly line(s) evaluated, "
        f"{findings_open} flagged, {notified} newly notified."
    )
    return {"checked": checked, "findings_open": findings_open, "notified": notified}


# ---------------------------------------------------------------------------
# Cross-module anomaly checks (Phase 10A). Each mirrors the exact
# candidate-finder -> per-row _upsert_finding/_resolve_finding ->
# emit_role_notification shape used by every check above. Every finding here
# still has a real, non-null project_id (the table's own constraint) - a
# company-wide event with no project association is simply out of scope for
# these checks rather than being force-fitted to one.
# ---------------------------------------------------------------------------

_GL_PROPOSAL_STALE_DAYS = 5
_LABOUR_HEADCOUNT_MISMATCH_THRESHOLD = 1
_FUEL_VARIANCE_RATIO = 0.15
_STOCK_CONSUMPTION_TOLERANCE_RATIO = 0.10


def _gl_proposal_natural_key(project_id: str, journal_id: str) -> str:
    return f"{project_id}:gl_proposal_stale_review:{journal_id}"


async def _find_stale_gl_proposals(db: AsyncSession, org_id: Optional[str]):
    """System-proposed journals still pending_review after 5+ days, scoped
    to journals with at least one project-tagged line - a company-wide
    proposal (e.g. a VAT settlement) has no project to attach the finding
    to and is deliberately excluded rather than assigned an arbitrary one."""
    rows = (
        await db.execute(
            text("""
                SELECT DISTINCT ON (je.id)
                    je.id AS journal_id,
                    je.organization_id AS org_id,
                    jl.project_id,
                    p.name AS project_title,
                    je.journal_number,
                    je.description,
                    je.source_type,
                    je.total_debit,
                    je.created_at,
                    EXTRACT(DAY FROM NOW() - je.created_at)::int AS days_pending
                FROM finance.journal_entries je
                JOIN finance.journal_lines jl
                    ON jl.journal_entry_id = je.id AND jl.organization_id = je.organization_id
                   AND jl.project_id IS NOT NULL
                JOIN projects.projects p
                    ON p.id = jl.project_id AND p.organization_id = je.organization_id
                   AND p.is_deleted = false
                WHERE je.origination = 'system_proposed'
                  AND je.proposal_status = 'pending_review'
                  AND je.created_at < NOW() - make_interval(days => :threshold_days)
                  AND (CAST(:org_id AS uuid) IS NULL OR je.organization_id = CAST(:org_id AS uuid))
                ORDER BY je.id, jl.line_number
            """),
            {"org_id": org_id, "threshold_days": _GL_PROPOSAL_STALE_DAYS},
        )
    ).mappings().all()
    return rows


async def run_gl_proposal_stale_review_check(db: AsyncSession, org_id: Optional[str] = None) -> Dict[str, int]:
    """Daily cron (CCB automation Phase 10A): flags system-proposed GL
    journals (Phase 2+'s gl_bridge.py) that have sat in pending_review for
    5+ days without a human approving or rejecting them - a growing backlog
    here means the books are drifting out of date, not that fraud is
    occurring.
    """
    still_pending = await _find_stale_gl_proposals(db, org_id)
    still_pending_keys = {
        _gl_proposal_natural_key(str(row["project_id"]), str(row["journal_id"])) for row in still_pending
    }

    # Resolve any previously-open finding whose journal is no longer stale
    # (approved/rejected, or the journal-line project changed) by comparing
    # against every currently-open finding of this check_type.
    open_findings = (
        await db.execute(
            text("""
                SELECT organization_id AS org_id, natural_key
                FROM finance.ccb_monitor_findings
                WHERE check_type = 'gl_proposal_stale_review'
                  AND status IN ('open', 'acknowledged')
                  AND (CAST(:org_id AS uuid) IS NULL OR organization_id = CAST(:org_id AS uuid))
            """),
            {"org_id": org_id},
        )
    ).mappings().all()
    for finding in open_findings:
        if finding["natural_key"] not in still_pending_keys:
            await _resolve_finding(db, org_id=str(finding["org_id"]), natural_key=finding["natural_key"])

    checked = 0
    findings_open = 0
    notified = 0

    for row in still_pending:
        checked += 1
        proposal_org_id = str(row["org_id"])
        project_id = str(row["project_id"])
        journal_id = str(row["journal_id"])
        project_title = row["project_title"] or "Project"
        days_pending = int(row["days_pending"])
        natural_key = _gl_proposal_natural_key(project_id, journal_id)
        severity = "critical" if days_pending >= 14 else ("high" if days_pending >= 10 else "medium")
        summary = (
            f"GL journal {row['journal_number']} on {project_title} ({row['source_type'] or 'manual'}, "
            f"${float(row['total_debit'] or 0):,.2f}) has been pending review for {days_pending} day(s) - "
            "worth reviewing so the ledger reflects the current position."
        )

        findings_open += 1
        newly_open = await _upsert_finding(
            db,
            org_id=proposal_org_id,
            project_id=project_id,
            check_type="gl_proposal_stale_review",
            natural_key=natural_key,
            severity=severity,
            summary=summary,
            evidence={
                "journal_id": journal_id,
                "journal_number": row["journal_number"],
                "source_type": row["source_type"],
                "total_debit": float(row["total_debit"] or 0),
                "days_pending": days_pending,
            },
        )

        if newly_open:
            notified += 1
            await emit_role_notification(
                db,
                org_id=proposal_org_id,
                role_names=COMMERCIAL_ALERT_ROLES,
                title=f"CCB: GL proposal overdue for review on {project_title}",
                message=summary,
                notification_type="ccb_gl_proposal_stale_review",
                priority="urgent" if severity == "critical" else "high",
                action_url="/dashboard/finance",
                metadata={
                    "project_id": project_id,
                    "journal_id": journal_id,
                    "check_type": "gl_proposal_stale_review",
                },
            )

    logger.info(
        f"CCB GL proposal staleness check: {checked} pending proposal(s) evaluated, "
        f"{findings_open} flagged, {notified} newly notified."
    )
    return {"checked": checked, "findings_open": findings_open, "notified": notified}


def _labour_headcount_natural_key(project_id: str, payroll_run_id: str) -> str:
    return f"{project_id}:labour_headcount_mismatch:{payroll_run_id}"


async def _find_labour_headcount_candidates(db: AsyncSession, org_id: Optional[str]):
    """Per posted payroll run, per project it touches (via the item's own
    project_id or an explicit allocation split), compares paid headcount
    against approved-timesheet headcount for the same project/period.
    hr.timesheets is used (not attendance_records/attendance_events)
    because it is the only one of the three attendance shapes with a real
    approval workflow - see Phase 7A's audit."""
    rows = (
        await db.execute(
            text("""
                WITH item_projects AS (
                    SELECT DISTINCT
                        pr.id AS payroll_run_id,
                        pr.organization_id AS org_id,
                        pr.period_start,
                        pr.period_end,
                        COALESCE(pia.project_id, pi.project_id) AS project_id,
                        pi.employee_id
                    FROM finance.payroll_runs pr
                    JOIN finance.payroll_items pi
                        ON pi.payroll_run_id = pr.id AND pi.organization_id = pr.organization_id
                    LEFT JOIN finance.payroll_item_allocations pia
                        ON pia.payroll_item_id = pi.id AND pia.organization_id = pr.organization_id
                    WHERE pr.status = 'posted'
                      AND COALESCE(pia.project_id, pi.project_id) IS NOT NULL
                      AND (CAST(:org_id AS uuid) IS NULL OR pr.organization_id = CAST(:org_id AS uuid))
                )
                SELECT
                    ip.payroll_run_id,
                    ip.org_id,
                    ip.project_id,
                    p.name AS project_title,
                    ip.period_start,
                    ip.period_end,
                    COUNT(DISTINCT ip.employee_id) AS paid_headcount,
                    COUNT(DISTINCT ts.employee_id) AS timesheet_headcount
                FROM item_projects ip
                JOIN projects.projects p
                    ON p.id = ip.project_id AND p.organization_id = ip.org_id AND p.is_deleted = false
                LEFT JOIN hr.timesheets ts
                    ON ts.project_id = ip.project_id AND ts.organization_id = ip.org_id
                   AND ts.status = 'approved'
                   AND ts.work_date BETWEEN ip.period_start AND ip.period_end
                GROUP BY ip.payroll_run_id, ip.org_id, ip.project_id, p.name, ip.period_start, ip.period_end
            """),
            {"org_id": org_id},
        )
    ).mappings().all()
    return rows


async def run_labour_headcount_mismatch_check(db: AsyncSession, org_id: Optional[str] = None) -> Dict[str, int]:
    """Daily cron (CCB automation Phase 10A): compares posted-payroll
    headcount against approved-timesheet headcount per project/period.
    Deliberately soft/advisory - HQ staff, casual labour, and legitimately
    un-timesheeted work are all real reasons this can differ without
    anything being wrong, so only a >1-employee gap is flagged, and always
    framed as worth reviewing rather than an accusation.
    """
    candidates = await _find_labour_headcount_candidates(db, org_id)
    checked = 0
    findings_open = 0
    notified = 0

    for row in candidates:
        checked += 1
        run_org_id = str(row["org_id"])
        project_id = str(row["project_id"])
        payroll_run_id = str(row["payroll_run_id"])
        natural_key = _labour_headcount_natural_key(project_id, payroll_run_id)
        paid = int(row["paid_headcount"] or 0)
        timesheeted = int(row["timesheet_headcount"] or 0)
        gap = abs(paid - timesheeted)

        if gap <= _LABOUR_HEADCOUNT_MISMATCH_THRESHOLD:
            await _resolve_finding(db, org_id=run_org_id, natural_key=natural_key)
            continue

        findings_open += 1
        project_title = row["project_title"] or "Project"
        severity = "high" if gap >= 5 else "medium"
        summary = (
            f"{project_title}: {paid} employee(s) paid for the period {row['period_start']} to "
            f"{row['period_end']} but only {timesheeted} have an approved timesheet on this project "
            f"for that period ({gap} difference). Worth a quick review - may be HQ/overhead staff or "
            "un-timesheeted work, not necessarily an error."
        )

        newly_open = await _upsert_finding(
            db,
            org_id=run_org_id,
            project_id=project_id,
            check_type="labour_headcount_mismatch",
            natural_key=natural_key,
            severity=severity,
            summary=summary,
            evidence={
                "payroll_run_id": payroll_run_id,
                "period_start": str(row["period_start"]),
                "period_end": str(row["period_end"]),
                "paid_headcount": paid,
                "timesheet_headcount": timesheeted,
            },
        )

        if newly_open:
            notified += 1
            await emit_role_notification(
                db,
                org_id=run_org_id,
                role_names=COMMERCIAL_ALERT_ROLES,
                title=f"CCB: labour headcount mismatch on {project_title}",
                message=summary,
                notification_type="ccb_labour_headcount_mismatch",
                priority="high" if severity == "high" else "normal",
                action_url="/dashboard/finance",
                metadata={
                    "project_id": project_id,
                    "payroll_run_id": payroll_run_id,
                    "check_type": "labour_headcount_mismatch",
                },
            )

    logger.info(
        f"CCB labour headcount mismatch check: {checked} project-period(s) evaluated, "
        f"{findings_open} flagged, {notified} newly notified."
    )
    return {"checked": checked, "findings_open": findings_open, "notified": notified}


def _fuel_hours_natural_key(project_id: str, fuel_transaction_id: str) -> str:
    return f"{project_id}:fuel_hours_variance:{fuel_transaction_id}"


async def _find_fuel_variance_candidates(db: AsyncSession, org_id: Optional[str]):
    """Sweeps fleet.fuel_transactions rows that already carry a computed
    expected_consumption_litres/variance_litres (set at record-fuel time,
    see routers/fleet.py) - this check reuses those figures, it does not
    recompute them."""
    rows = (
        await db.execute(
            text("""
                SELECT
                    ft.id AS fuel_transaction_id,
                    ft.organization_id AS org_id,
                    ft.project_id,
                    p.name AS project_title,
                    ft.transaction_at,
                    ft.quantity_litres,
                    ft.expected_consumption_litres,
                    ft.variance_litres,
                    COALESCE(f.asset_code, f.vehicle_registration, 'Vehicle/plant') AS fleet_name
                FROM fleet.fuel_transactions ft
                JOIN projects.projects p
                    ON p.id = ft.project_id AND p.organization_id = ft.organization_id
                   AND p.is_deleted = false
                LEFT JOIN fleet.fleet f
                    ON f.id = ft.fleet_id AND f.organization_id = ft.organization_id
                WHERE ft.is_deleted = false
                  AND ft.project_id IS NOT NULL
                  AND ft.expected_consumption_litres IS NOT NULL
                  AND ft.expected_consumption_litres > 0
                  AND ft.variance_litres IS NOT NULL
                  AND ABS(ft.variance_litres) > (ft.expected_consumption_litres * :variance_ratio)
                  AND ft.transaction_at > NOW() - INTERVAL '60 days'
                  AND (CAST(:org_id AS uuid) IS NULL OR ft.organization_id = CAST(:org_id AS uuid))
            """),
            {"org_id": org_id, "variance_ratio": _FUEL_VARIANCE_RATIO},
        )
    ).mappings().all()
    return rows


async def run_fuel_hours_variance_check(db: AsyncSession, org_id: Optional[str] = None) -> Dict[str, int]:
    """Daily cron (CCB automation Phase 10A): flags fuel transactions whose
    already-computed variance against expected consumption exceeds 15% -
    one finding per transaction (a point-in-time event, matching Phase 3A's
    per-invoice finding shape), not an aggregated rollup.
    """
    candidates = await _find_fuel_variance_candidates(db, org_id)
    checked = 0
    findings_open = 0
    notified = 0

    for row in candidates:
        checked += 1
        txn_org_id = str(row["org_id"])
        project_id = str(row["project_id"])
        txn_id = str(row["fuel_transaction_id"])
        natural_key = _fuel_hours_natural_key(project_id, txn_id)
        expected = float(row["expected_consumption_litres"] or 0)
        variance = float(row["variance_litres"] or 0)
        ratio = (variance / expected) if expected else 0
        project_title = row["project_title"] or "Project"
        fleet_name = row["fleet_name"] or "Vehicle/plant"
        direction = "over" if variance > 0 else "under"
        severity = "high" if abs(ratio) >= 0.30 else "medium"
        summary = (
            f"{fleet_name} on {project_title}: {float(row['quantity_litres']):,.1f}L recorded on "
            f"{row['transaction_at']} against an expected {expected:,.1f}L ({direction}-consumption by "
            f"{abs(ratio) * 100:.0f}%) - worth reviewing against usage records."
        )

        findings_open += 1
        newly_open = await _upsert_finding(
            db,
            org_id=txn_org_id,
            project_id=project_id,
            check_type="fuel_hours_variance",
            natural_key=natural_key,
            severity=severity,
            summary=summary,
            evidence={
                "fuel_transaction_id": txn_id,
                "quantity_litres": float(row["quantity_litres"] or 0),
                "expected_consumption_litres": expected,
                "variance_litres": variance,
                "variance_ratio": ratio,
            },
        )

        if newly_open:
            notified += 1
            await emit_role_notification(
                db,
                org_id=txn_org_id,
                role_names=COMMERCIAL_ALERT_ROLES,
                title=f"CCB: fuel variance on {project_title}",
                message=summary,
                notification_type="ccb_fuel_hours_variance",
                priority="high" if severity == "high" else "normal",
                action_url="/dashboard/finance",
                metadata={
                    "project_id": project_id,
                    "fuel_transaction_id": txn_id,
                    "check_type": "fuel_hours_variance",
                },
            )

    logger.info(
        f"CCB fuel-vs-hours variance check: {checked} transaction(s) evaluated, "
        f"{findings_open} flagged, {notified} newly notified."
    )
    return {"checked": checked, "findings_open": findings_open, "notified": notified}


def _stock_consumption_natural_key(project_id: str, item_id: str, week_start: str) -> str:
    return f"{project_id}:stock_consumption_variance:{item_id}:{week_start}"


async def _find_stock_consumption_candidates(db: AsyncSession, org_id: Optional[str]):
    """Per project/item/week, compares stock issued (procurement.stock_ledger,
    movement_type='issue') against material usage reported on site
    (projects.daily_report_materials, joined via daily_site_reports for
    project_id/report_date)."""
    rows = (
        await db.execute(
            text("""
                WITH issued AS (
                    SELECT
                        sl.organization_id AS org_id,
                        sl.project_id,
                        sl.item_id,
                        date_trunc('week', sl.movement_at)::date AS week_start,
                        SUM(sl.quantity) AS issued_qty
                    FROM procurement.stock_ledger sl
                    WHERE sl.movement_type = 'issue'
                      AND sl.project_id IS NOT NULL
                      AND sl.movement_at > NOW() - INTERVAL '60 days'
                      AND (CAST(:org_id AS uuid) IS NULL OR sl.organization_id = CAST(:org_id AS uuid))
                    GROUP BY sl.organization_id, sl.project_id, sl.item_id, date_trunc('week', sl.movement_at)
                ),
                used AS (
                    SELECT
                        dsr.organization_id AS org_id,
                        dsr.project_id,
                        drm.item_id,
                        date_trunc('week', dsr.report_date)::date AS week_start,
                        SUM(drm.quantity_used + drm.wastage_quantity) AS used_qty
                    FROM projects.daily_report_materials drm
                    JOIN projects.daily_site_reports dsr
                        ON dsr.id = drm.report_id AND dsr.organization_id = drm.organization_id
                    WHERE dsr.report_date > CURRENT_DATE - INTERVAL '60 days'
                      AND (CAST(:org_id AS uuid) IS NULL OR dsr.organization_id = CAST(:org_id AS uuid))
                    GROUP BY dsr.organization_id, dsr.project_id, drm.item_id, date_trunc('week', dsr.report_date)
                )
                SELECT
                    COALESCE(i.org_id, u.org_id) AS org_id,
                    COALESCE(i.project_id, u.project_id) AS project_id,
                    COALESCE(i.item_id, u.item_id) AS item_id,
                    COALESCE(i.week_start, u.week_start) AS week_start,
                    COALESCE(i.issued_qty, 0) AS issued_qty,
                    COALESCE(u.used_qty, 0) AS used_qty,
                    p.name AS project_title,
                    ii.item_name AS item_name,
                    ii.unit_of_measure AS item_unit
                FROM issued i
                FULL OUTER JOIN used u
                    ON u.org_id = i.org_id AND u.project_id = i.project_id
                   AND u.item_id = i.item_id AND u.week_start = i.week_start
                JOIN projects.projects p
                    ON p.id = COALESCE(i.project_id, u.project_id)
                   AND p.organization_id = COALESCE(i.org_id, u.org_id) AND p.is_deleted = false
                JOIN procurement.inventory_items ii
                    ON ii.id = COALESCE(i.item_id, u.item_id)
                   AND ii.organization_id = COALESCE(i.org_id, u.org_id)
            """),
            {"org_id": org_id},
        )
    ).mappings().all()
    return rows


async def run_stock_consumption_variance_check(db: AsyncSession, org_id: Optional[str] = None) -> Dict[str, int]:
    """Weekly-cadence cron (CCB automation Phase 10A): compares stock
    issued to a project against reported material usage+wastage for the
    same project/item/week, flagging a real gap in either direction -
    issued exceeding used+wastage by more than 10% (the direction most
    worth reviewing for waste or misallocation) or used+wastage exceeding
    issued (a likely data-entry/tracking gap) - both phrased as worth
    reviewing, not as an accusation.
    """
    candidates = await _find_stock_consumption_candidates(db, org_id)
    checked = 0
    findings_open = 0
    notified = 0

    for row in candidates:
        checked += 1
        issued = float(row["issued_qty"] or 0)
        used = float(row["used_qty"] or 0)
        row_org_id = str(row["org_id"])
        project_id = str(row["project_id"])
        item_id = str(row["item_id"])
        week_start = str(row["week_start"])
        natural_key = _stock_consumption_natural_key(project_id, item_id, week_start)

        if issued <= 0 and used <= 0:
            await _resolve_finding(db, org_id=row_org_id, natural_key=natural_key)
            continue

        tolerance = max(issued, used) * _STOCK_CONSUMPTION_TOLERANCE_RATIO
        gap = issued - used

        if abs(gap) <= tolerance:
            await _resolve_finding(db, org_id=row_org_id, natural_key=natural_key)
            continue

        project_title = row["project_title"] or "Project"
        item_name = row["item_name"] or "Material"
        unit = row["item_unit"] or "unit(s)"
        ratio = (abs(gap) / issued) if issued else 1.0
        severity = "high" if ratio >= 0.30 else "medium"

        if gap > 0:
            summary = (
                f"{item_name} on {project_title}: {issued:,.2f} {unit} issued for the week of "
                f"{week_start} but only {used:,.2f} {unit} of usage/wastage was reported - a gap of "
                f"{gap:,.2f} {unit} worth reviewing."
            )
        else:
            summary = (
                f"{item_name} on {project_title}: {used:,.2f} {unit} of usage/wastage reported for the "
                f"week of {week_start} against only {issued:,.2f} {unit} issued - likely a stock-issue "
                "recording gap worth following up."
            )

        findings_open += 1
        newly_open = await _upsert_finding(
            db,
            org_id=row_org_id,
            project_id=project_id,
            check_type="stock_consumption_variance",
            natural_key=natural_key,
            severity=severity,
            summary=summary,
            evidence={
                "item_id": item_id,
                "week_start": week_start,
                "issued_qty": issued,
                "used_qty": used,
                "gap": gap,
            },
        )

        if newly_open:
            notified += 1
            await emit_role_notification(
                db,
                org_id=row_org_id,
                role_names=COMMERCIAL_ALERT_ROLES,
                title=f"CCB: stock consumption variance on {project_title}",
                message=summary,
                notification_type="ccb_stock_consumption_variance",
                priority="high" if severity == "high" else "normal",
                action_url="/dashboard/finance",
                metadata={
                    "project_id": project_id,
                    "item_id": item_id,
                    "week_start": week_start,
                    "check_type": "stock_consumption_variance",
                },
            )

    logger.info(
        f"CCB stock-vs-consumption variance check: {checked} project-item-week(s) evaluated, "
        f"{findings_open} flagged, {notified} newly notified."
    )
    return {"checked": checked, "findings_open": findings_open, "notified": notified}
