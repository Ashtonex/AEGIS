"""Alerts when a CRM lead is missing a government/regulatory compliance
document (ZBCA, CIFOZ, ZIMRA Tax Clearance, etc.) the organization doesn't
currently hold - and how much pipeline value is exposed because of it."""

from typing import Any, Dict, List, Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from core.email import send_email
from core.security import SUPERADMIN_ROLE
from app.shared.events import emit_role_notification

# SUPERADMIN alongside Executive (Admin) mirrors project_forecast.py's own
# COMMERCIAL_ALERT_ROLES for the identical reason: relying on "someone holds
# Executive (Admin)" alone is fragile - if nobody in the org currently does
# (a real, observed state in this system), emit_role_notification silently
# reaches zero people instead of erroring.
ALERT_ROLES = ["Executive (Admin)", SUPERADMIN_ROLE]

_MISSING_REQUIREMENTS_SQL = """
    SELECT t.id AS requirement_type_id, t.code, t.label
    FROM crm.lead_compliance_requirements lcr
    JOIN crm.compliance_requirement_types t ON t.id = lcr.requirement_type_id
    WHERE lcr.lead_id = :lead_id AND lcr.organization_id = :org_id
      AND NOT EXISTS (
          SELECT 1 FROM core.compliance_items ci
          WHERE ci.organization_id = :org_id AND ci.requirement_type_id = t.id
            AND ci.is_deleted = false
            AND (ci.expiry_date IS NULL OR ci.expiry_date >= CURRENT_DATE)
      )
"""


async def get_missing_lead_requirements(db: AsyncSession, org_id: str, lead_id: str) -> List[Dict[str, Any]]:
    rows = (
        await db.execute(text(_MISSING_REQUIREMENTS_SQL), {"lead_id": lead_id, "org_id": org_id})
    ).mappings().all()
    return [dict(r) for r in rows]


async def check_and_alert_lead_compliance_gap(
    db: AsyncSession,
    org_id: str,
    lead_id: str,
    company_name: str,
    estimated_budget: Optional[float],
) -> List[Dict[str, Any]]:
    """Returns the missing requirement types (each {requirement_type_id, code,
    label}). Empty list means nothing is missing - no alert fires."""
    missing = await get_missing_lead_requirements(db, org_id, lead_id)
    if not missing:
        return []

    # Aggregate: total estimated_budget across every open lead currently
    # missing each of these same requirement types, so the alert reflects
    # real pipeline exposure, not just this one lead's number.
    pipeline_at_risk = 0.0
    for item in missing:
        total = (
            await db.execute(
                text("""
                    SELECT COALESCE(SUM(l.estimated_budget), 0)
                    FROM crm.leads l
                    JOIN crm.lead_compliance_requirements lcr
                        ON lcr.lead_id = l.id AND lcr.organization_id = l.organization_id
                    WHERE l.organization_id = :org_id AND l.is_deleted = false
                      AND l.status NOT IN ('converted', 'disqualified')
                      AND lcr.requirement_type_id = :requirement_type_id
                      AND NOT EXISTS (
                          SELECT 1 FROM core.compliance_items ci
                          WHERE ci.organization_id = :org_id AND ci.requirement_type_id = :requirement_type_id
                            AND ci.is_deleted = false
                            AND (ci.expiry_date IS NULL OR ci.expiry_date >= CURRENT_DATE)
                      )
                """),
                {"org_id": org_id, "requirement_type_id": item["requirement_type_id"]},
            )
        ).scalar()
        pipeline_at_risk += float(total or 0)

    missing_labels = ", ".join(m["label"] for m in missing)
    this_lead_value = float(estimated_budget or 0)

    recipients = (
        await db.execute(
            text("""
                SELECT DISTINCT u.email
                FROM core.users u
                JOIN core.user_roles ur ON ur.user_id = u.id AND ur.organization_id = u.organization_id
                JOIN core.roles r ON r.id = ur.role_id AND r.organization_id = u.organization_id
                WHERE u.organization_id = :org_id AND u.is_active = true AND u.is_deleted = false
                  AND r.is_deleted = false AND upper(r.name) = ANY(:role_names) AND u.email IS NOT NULL
            """),
            {"org_id": org_id, "role_names": [r.upper() for r in ALERT_ROLES]},
        )
    ).scalars().all()

    subject = f"Compliance gap on {company_name}: ${this_lead_value:,.2f} at risk"
    html = f"""
    <div style="font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #1a1a1a;">
      <p style="font-size: 12px; letter-spacing: 2px; text-transform: uppercase; color: #b8860b; font-weight: 700; margin-bottom: 4px;">AEGIS</p>
      <h1 style="font-size: 20px; margin: 0 0 16px;">Missing compliance documentation</h1>
      <p style="font-size: 14px; line-height: 1.6;"><strong>{company_name}</strong> requires <strong>{missing_labels}</strong>, which the organization does not currently hold on file (or the record has expired).</p>
      <p style="font-size: 14px; line-height: 1.6;">
        Revenue at risk on this lead: <strong>${this_lead_value:,.2f}</strong><br>
        Total pipeline currently exposed to the same gap(s): <strong>${pipeline_at_risk:,.2f}</strong>
      </p>
      <p style="font-size: 12px; line-height: 1.6; color: #666; margin-top: 24px;">Resolve by adding the missing document(s) under Compliance, or edit this lead if the requirement doesn't actually apply.</p>
    </div>
    """
    for email in recipients:
        await send_email(email, subject, html)

    await emit_role_notification(
        db,
        org_id=org_id,
        role_names=ALERT_ROLES,
        title=f"Compliance gap on {company_name}",
        message=(
            f"Missing {missing_labels} - ${this_lead_value:,.2f} at risk on this lead, "
            f"${pipeline_at_risk:,.2f} across pipeline currently exposed to the same gap(s)."
        ),
        notification_type="lead_compliance_gap",
        priority="high",
        action_url="/dashboard/crm/leads",
        metadata={"lead_id": lead_id, "missing_codes": [m["code"] for m in missing]},
    )

    return missing
