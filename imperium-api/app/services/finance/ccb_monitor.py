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
                  AND (:org_id::uuid IS NULL OR p.organization_id = :org_id)
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
            # No unexplained overrun right now - if a finding was previously
            # open for this project, resolve it automatically rather than
            # leaving a stale alert nobody will ever clear by hand.
            await db.execute(
                text("""
                    UPDATE finance.ccb_monitor_findings
                    SET status = 'resolved', resolved_at = NOW(), last_seen_at = NOW()
                    WHERE organization_id = :org_id AND natural_key = :natural_key
                      AND status IN ('open', 'acknowledged')
                """),
                {"org_id": project_org_id, "natural_key": natural_key},
            )
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
