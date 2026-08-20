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
