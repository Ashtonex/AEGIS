import json
from decimal import Decimal
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.security import require_permission
from app.services.crm.automation_engine import fire_trigger

router = APIRouter()


class LifecyclePayload(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class TicketPayload(LifecyclePayload):
    subject: str = Field(..., min_length=1, max_length=255)
    issue_description: Optional[str] = None
    status: str = Field(default="new", max_length=50)
    priority: str = Field(default="normal", max_length=50)
    category: Optional[str] = Field(default=None, max_length=100)
    client_id: Optional[str] = None
    contact_id: Optional[str] = None
    organization_account_id: Optional[str] = None
    opportunity_id: Optional[str] = None
    project_id: Optional[str] = None
    assigned_to: Optional[str] = None


class TicketUpdatePayload(LifecyclePayload):
    subject: Optional[str] = Field(default=None, min_length=1, max_length=255)
    issue_description: Optional[str] = None
    status: Optional[str] = Field(default=None, max_length=50)
    priority: Optional[str] = Field(default=None, max_length=50)
    category: Optional[str] = Field(default=None, max_length=100)
    assigned_to: Optional[str] = None
    first_responded_at: Optional[str] = None
    resolved_at: Optional[str] = None
    closed_at: Optional[str] = None
    satisfaction_score: Optional[Decimal] = Field(default=None, ge=0, le=5, max_digits=5, decimal_places=2)
    satisfaction_comment: Optional[str] = None


class TicketCommentPayload(LifecyclePayload):
    body: str = Field(..., min_length=1)
    visibility: str = Field(default="internal", pattern="^(internal|client)$")


def _org_id(user: dict) -> str:
    org_id = user.get("org_id")
    if not org_id:
        raise HTTPException(status_code=403, detail="CRM lifecycle requires an organization context.")
    return str(org_id)


def _user_id(user: dict) -> str:
    return str(user.get("sub") or user.get("user_id"))


def _json(value: Any) -> str:
    return json.dumps(value if value is not None else {})


def _row_dict(row: Any) -> Optional[Dict[str, Any]]:
    return dict(row._mapping) if row else None


async def _rows(db: AsyncSession, sql: str, params: Dict[str, Any]) -> List[Dict[str, Any]]:
    result = await db.execute(text(sql), params)
    return [dict(row._mapping) for row in result]


async def _require_tenant_record(
    db: AsyncSession,
    table: str,
    item_id: Optional[str],
    org_id: str,
    label: str,
) -> None:
    if not item_id:
        return
    allowed = {
        "crm.organizations",
        "crm.contacts",
        "crm.leads",
        "crm.opportunities",
        "crm.support_tickets",
        "projects.projects",
    }
    if table not in allowed:
        raise HTTPException(status_code=500, detail="Unsafe lifecycle reference check.")
    result = await db.execute(
        text(f"SELECT 1 FROM {table} WHERE id = :id AND organization_id = :org_id AND COALESCE(is_deleted, false) = false"),
        {"id": item_id, "org_id": org_id},
    )
    if not result.scalar():
        raise HTTPException(status_code=404, detail=f"{label} not found in this organization.")


@router.get("/support/tickets")
async def list_support_tickets(
    status_filter: Optional[str] = Query(default=None, alias="status"),
    user: dict = Depends(require_permission("crm.support.read")),
    db: AsyncSession = Depends(get_db),
):
    rows = await _rows(
        db,
        """
        SELECT t.*, c.contact_name, c.email, co.name AS company_name, p.name AS project_name
        FROM crm.support_tickets t
        LEFT JOIN crm.contacts c ON c.id = t.contact_id AND c.organization_id = t.organization_id
        LEFT JOIN crm.organizations co ON co.id = COALESCE(t.organization_account_id, c.client_org_id) AND co.organization_id = t.organization_id
        LEFT JOIN projects.projects p ON p.id = t.project_id AND p.organization_id = t.organization_id
        WHERE t.organization_id = :org_id
          AND t.is_deleted = false
          AND (:status_filter IS NULL OR t.status = :status_filter)
        ORDER BY
          CASE t.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,
          t.created_at DESC
        LIMIT 200
        """,
        {"org_id": _org_id(user), "status_filter": status_filter},
    )
    return {"success": True, "data": rows, "message": "CRM support tickets listed.", "meta": {"total": len(rows)}}


DEFAULT_SLA_HOURS = {
    "urgent": (4, 12),
    "high": (12, 24),
    "low": (48, 120),
    "normal": (24, 72),
}


async def _sla_hours_for(db: AsyncSession, org_id: str, priority: str) -> tuple[int, int]:
    """Org-configurable SLA hours (crm.sla_policies, set via crm.admin.configure),
    falling back to sensible built-in defaults when no policy is configured."""
    row = await _rows(
        db,
        "SELECT response_hours, resolution_hours FROM crm.sla_policies WHERE organization_id=:org_id AND priority=:priority AND is_deleted=false",
        {"org_id": org_id, "priority": priority},
    )
    if row:
        return row[0]["response_hours"], row[0]["resolution_hours"]
    return DEFAULT_SLA_HOURS.get(priority, DEFAULT_SLA_HOURS["normal"])


@router.post("/support/tickets", status_code=status.HTTP_201_CREATED)
async def create_support_ticket(
    payload: TicketPayload,
    user: dict = Depends(require_permission("crm.support.create")),
    db: AsyncSession = Depends(get_db),
):
    org_id = _org_id(user)
    await _require_tenant_record(db, "crm.contacts", payload.contact_id or payload.client_id, org_id, "Contact")
    await _require_tenant_record(db, "crm.organizations", payload.organization_account_id, org_id, "Customer organization")
    await _require_tenant_record(db, "crm.opportunities", payload.opportunity_id, org_id, "Opportunity")
    await _require_tenant_record(db, "projects.projects", payload.project_id, org_id, "Project")

    response_hours, resolution_hours = await _sla_hours_for(db, org_id, payload.priority)

    result = await db.execute(
        text("""
            INSERT INTO crm.support_tickets (
              organization_id, created_by, ticket_number, subject, description,
              status, priority, category, contact_id, client_org_id, organization_account_id,
              opportunity_id, project_id, assigned_to, first_response_due_at, resolution_due_at
            )
            VALUES (
              :org_id, :user_id,
              'TCK-' || to_char(NOW(), 'YYYYMMDD') || '-' || upper(substr(gen_random_uuid()::text, 1, 6)),
              :subject, :issue_description, :status, :priority, :category,
              COALESCE(:contact_id, :client_id), :organization_account_id, :organization_account_id, :opportunity_id,
              :project_id, :assigned_to,
              NOW() + (:response_hours || ' hours')::interval, NOW() + (:resolution_hours || ' hours')::interval
            )
            RETURNING id
        """),
        {
            "org_id": org_id, "user_id": _user_id(user), **payload.model_dump(),
            "response_hours": response_hours, "resolution_hours": resolution_hours,
        },
    )
    ticket_id = str(result.scalar())
    await db.execute(
        text("""
            INSERT INTO crm.ticket_sla_events (organization_id, ticket_id, event_type, details, created_by)
            VALUES (:org_id, :ticket_id, 'ticket_created', CAST(:details AS jsonb), :user_id)
        """),
        {
            "org_id": org_id, "ticket_id": ticket_id,
            "details": _json({"priority": payload.priority, "response_hours": response_hours, "resolution_hours": resolution_hours}),
            "user_id": _user_id(user),
        },
    )
    await db.commit()
    await fire_trigger(db, org_id, _user_id(user), "ticket_created", {**payload.model_dump(), "id": ticket_id, "ticket_id": ticket_id})
    return {"success": True, "data": {"id": ticket_id}, "message": "CRM support ticket created.", "meta": {}}


@router.get("/support/sla-policies")
async def list_sla_policies(
    user: dict = Depends(require_permission("crm.support.read")),
    db: AsyncSession = Depends(get_db),
):
    org_id = _org_id(user)
    rows = await _rows(
        db,
        "SELECT * FROM crm.sla_policies WHERE organization_id=:org_id AND is_deleted=false ORDER BY priority",
        {"org_id": org_id},
    )
    return {"success": True, "data": rows, "message": "SLA policies fetched.", "meta": {"total": len(rows)}}


class SlaPolicyPayload(LifecyclePayload):
    priority: str = Field(..., min_length=1, max_length=30)
    response_hours: int = Field(..., gt=0)
    resolution_hours: int = Field(..., gt=0)


@router.put("/support/sla-policies", status_code=status.HTTP_201_CREATED)
async def upsert_sla_policy(
    payload: SlaPolicyPayload,
    user: dict = Depends(require_permission("crm.admin.configure")),
    db: AsyncSession = Depends(get_db),
):
    org_id = _org_id(user)
    user_id = _user_id(user)
    row = await db.execute(
        text("""
            INSERT INTO crm.sla_policies (organization_id, created_by, priority, response_hours, resolution_hours)
            VALUES (:org_id, :user_id, :priority, :response_hours, :resolution_hours)
            ON CONFLICT (organization_id, priority) DO UPDATE SET
                response_hours = EXCLUDED.response_hours,
                resolution_hours = EXCLUDED.resolution_hours,
                updated_at = NOW()
            RETURNING id
        """),
        {
            "org_id": org_id, "user_id": user_id, "priority": payload.priority,
            "response_hours": payload.response_hours, "resolution_hours": payload.resolution_hours,
        },
    )
    await db.commit()
    return {"success": True, "data": {"id": str(row.scalar())}, "message": "SLA policy saved.", "meta": {}}


CLOSED_STATUSES = {"resolved", "closed"}


@router.patch("/support/tickets/{ticket_id}")
async def update_support_ticket(
    ticket_id: str,
    payload: TicketUpdatePayload,
    user: dict = Depends(require_permission("crm.support.update")),
    db: AsyncSession = Depends(get_db),
):
    org_id = _org_id(user)
    values = payload.model_dump(exclude_unset=True)
    if "issue_description" in values:
        values["description"] = values.pop("issue_description")
    allowed = {
        "subject", "description", "status", "priority", "category", "assigned_to",
        "first_responded_at", "resolved_at", "closed_at", "satisfaction_score", "satisfaction_comment",
    }
    fields = [field for field in allowed if field in values]
    if not fields:
        return {"success": True, "data": {"id": ticket_id}, "message": "No ticket fields changed.", "meta": {}}

    reopening = False
    if "status" in values:
        current = await _rows(
            db,
            "SELECT status FROM crm.support_tickets WHERE id = :ticket_id AND organization_id = :org_id AND is_deleted = false",
            {"ticket_id": ticket_id, "org_id": org_id},
        )
        if not current:
            raise HTTPException(status_code=404, detail="Support ticket not found.")
        previous_status = str(current[0].get("status") or "").lower()
        reopening = previous_status in CLOSED_STATUSES and values["status"].lower() not in CLOSED_STATUSES

    set_sql = ", ".join(f"{field} = :{field}" for field in fields)
    if reopening:
        set_sql += ", reopen_count = reopen_count + 1"
    result = await db.execute(
        text(f"""
            UPDATE crm.support_tickets
            SET {set_sql}, updated_at = NOW()
            WHERE id = :ticket_id AND organization_id = :org_id AND is_deleted = false
            RETURNING id
        """),
        {"ticket_id": ticket_id, "org_id": org_id, **values},
    )
    if not result.scalar():
        raise HTTPException(status_code=404, detail="Support ticket not found.")
    if "status" in values:
        await db.execute(
            text("""
                INSERT INTO crm.ticket_sla_events (organization_id, ticket_id, event_type, details, created_by)
                VALUES (:org_id, :ticket_id, 'status_changed', CAST(:details AS jsonb), :user_id)
            """),
            {
                "org_id": org_id,
                "ticket_id": ticket_id,
                "details": _json({"status": values["status"], "reopened": reopening}),
                "user_id": _user_id(user),
            },
        )
    await db.commit()
    return {"success": True, "data": {"id": ticket_id}, "message": "CRM support ticket updated.", "meta": {}}


class TicketEscalatePayload(LifecyclePayload):
    escalated_to: str
    reason: str = Field(..., min_length=1)


@router.post("/support/tickets/{ticket_id}/escalate", status_code=status.HTTP_201_CREATED)
async def escalate_support_ticket(
    ticket_id: str,
    payload: TicketEscalatePayload,
    user: dict = Depends(require_permission("crm.support.update")),
    db: AsyncSession = Depends(get_db),
):
    org_id = _org_id(user)
    await _require_tenant_record(db, "crm.support_tickets", ticket_id, org_id, "Support ticket")
    result = await db.execute(
        text("""
            UPDATE crm.support_tickets
            SET escalated_at = NOW(), escalated_to = :escalated_to, escalation_reason = :reason,
                assigned_to = :escalated_to, updated_at = NOW()
            WHERE id = :ticket_id AND organization_id = :org_id AND is_deleted = false
            RETURNING id
        """),
        {"ticket_id": ticket_id, "org_id": org_id, "escalated_to": payload.escalated_to, "reason": payload.reason},
    )
    if not result.scalar():
        raise HTTPException(status_code=404, detail="Support ticket not found.")
    await db.execute(
        text("""
            INSERT INTO crm.ticket_sla_events (organization_id, ticket_id, event_type, details, created_by)
            VALUES (:org_id, :ticket_id, 'escalated', CAST(:details AS jsonb), :user_id)
        """),
        {
            "org_id": org_id,
            "ticket_id": ticket_id,
            "details": _json({"escalated_to": payload.escalated_to, "reason": payload.reason}),
            "user_id": _user_id(user),
        },
    )
    await db.commit()
    return {"success": True, "data": {"id": ticket_id}, "message": "Support ticket escalated.", "meta": {}}


@router.get("/support/tickets/{ticket_id}/escalations")
async def list_ticket_escalations(
    ticket_id: str,
    user: dict = Depends(require_permission("crm.support.read")),
    db: AsyncSession = Depends(get_db),
):
    org_id = _org_id(user)
    await _require_tenant_record(db, "crm.support_tickets", ticket_id, org_id, "Support ticket")
    rows = await _rows(
        db,
        """
        SELECT *
        FROM crm.ticket_sla_events
        WHERE organization_id = :org_id AND ticket_id = :ticket_id AND event_type = 'escalated'
        ORDER BY created_at DESC
        """,
        {"org_id": org_id, "ticket_id": ticket_id},
    )
    return {"success": True, "data": rows, "message": "Ticket escalation history listed.", "meta": {"total": len(rows)}}


class TicketAttachmentPayload(LifecyclePayload):
    document_id: str
    link_role: str = Field(default="attachment", max_length=80)


@router.post("/support/tickets/{ticket_id}/attachments", status_code=status.HTTP_201_CREATED)
async def attach_ticket_document(
    ticket_id: str,
    payload: TicketAttachmentPayload,
    user: dict = Depends(require_permission("crm.support.update")),
    db: AsyncSession = Depends(get_db),
):
    org_id = _org_id(user)
    await _require_tenant_record(db, "crm.support_tickets", ticket_id, org_id, "Support ticket")
    document = await _rows(
        db,
        "SELECT id FROM core.documents WHERE id = :document_id AND organization_id = :org_id AND is_deleted = false",
        {"document_id": payload.document_id, "org_id": org_id},
    )
    if not document:
        raise HTTPException(status_code=404, detail="Document not found in this organization.")
    result = await db.execute(
        text("""
            INSERT INTO core.document_links (organization_id, document_id, entity_type, entity_id, link_role, linked_by)
            VALUES (:org_id, :document_id, 'support_ticket', :ticket_id, :link_role, :user_id)
            RETURNING id
        """),
        {
            "org_id": org_id,
            "document_id": payload.document_id,
            "ticket_id": ticket_id,
            "link_role": payload.link_role,
            "user_id": _user_id(user),
        },
    )
    await db.commit()
    return {"success": True, "data": {"id": str(result.scalar())}, "message": "Document attached to ticket.", "meta": {}}


@router.get("/support/tickets/{ticket_id}/attachments")
async def list_ticket_attachments(
    ticket_id: str,
    user: dict = Depends(require_permission("crm.support.read")),
    db: AsyncSession = Depends(get_db),
):
    org_id = _org_id(user)
    await _require_tenant_record(db, "crm.support_tickets", ticket_id, org_id, "Support ticket")
    rows = await _rows(
        db,
        """
        SELECT d.id, d.title, d.file_name, d.file_size_bytes, d.category, dl.link_role, dl.linked_at
        FROM core.document_links dl
        JOIN core.documents d ON d.id = dl.document_id AND d.organization_id = dl.organization_id
        WHERE dl.organization_id = :org_id AND dl.entity_type = 'support_ticket' AND dl.entity_id = :ticket_id
          AND dl.is_deleted = false AND d.is_deleted = false
        ORDER BY dl.linked_at DESC
        """,
        {"org_id": org_id, "ticket_id": ticket_id},
    )
    return {"success": True, "data": rows, "message": "Ticket attachments listed.", "meta": {"total": len(rows)}}


@router.get("/support/dashboard")
async def support_dashboard(
    user: dict = Depends(require_permission("crm.reports.read")),
    db: AsyncSession = Depends(get_db),
):
    org_id = _org_id(user)
    summary = (await db.execute(
        text("""
            SELECT
                COUNT(*) FILTER (WHERE status NOT IN ('resolved', 'closed')) AS open_tickets,
                COUNT(*) FILTER (WHERE status NOT IN ('resolved', 'closed') AND resolution_due_at IS NOT NULL AND resolution_due_at < NOW()) AS overdue_tickets,
                COUNT(*) FILTER (WHERE first_response_due_at IS NOT NULL) AS tickets_with_response_sla,
                COUNT(*) FILTER (WHERE first_response_due_at IS NOT NULL AND first_responded_at IS NOT NULL AND first_responded_at <= first_response_due_at) AS response_sla_met,
                COUNT(*) FILTER (WHERE resolution_due_at IS NOT NULL) AS tickets_with_resolution_sla,
                COUNT(*) FILTER (WHERE resolution_due_at IS NOT NULL AND resolved_at IS NOT NULL AND resolved_at <= resolution_due_at) AS resolution_sla_met,
                COUNT(*) FILTER (WHERE reopen_count > 0) AS reopened_tickets,
                COALESCE(AVG(EXTRACT(EPOCH FROM (first_responded_at - created_at)) / 3600.0) FILTER (WHERE first_responded_at IS NOT NULL), 0) AS avg_first_response_hours,
                COALESCE(AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 3600.0) FILTER (WHERE resolved_at IS NOT NULL), 0) AS avg_resolution_hours,
                COALESCE(AVG(satisfaction_score), 0) AS avg_satisfaction
            FROM crm.support_tickets
            WHERE organization_id = :org_id AND is_deleted = false
        """),
        {"org_id": org_id},
    )).mappings().first()
    by_category = await _rows(
        db,
        """
        SELECT COALESCE(category, 'uncategorized') AS category, COUNT(*) AS ticket_count
        FROM crm.support_tickets
        WHERE organization_id = :org_id AND is_deleted = false
        GROUP BY COALESCE(category, 'uncategorized')
        ORDER BY ticket_count DESC
        """,
        {"org_id": org_id},
    )
    by_client = await _rows(
        db,
        """
        SELECT co.name AS client_name, COUNT(*) AS ticket_count
        FROM crm.support_tickets t
        LEFT JOIN crm.organizations co ON co.id = t.organization_account_id AND co.organization_id = t.organization_id
        WHERE t.organization_id = :org_id AND t.is_deleted = false
        GROUP BY co.name
        ORDER BY ticket_count DESC
        LIMIT 20
        """,
        {"org_id": org_id},
    )
    by_project = await _rows(
        db,
        """
        SELECT p.name AS project_name, COUNT(*) AS ticket_count
        FROM crm.support_tickets t
        LEFT JOIN projects.projects p ON p.id = t.project_id AND p.organization_id = t.organization_id
        WHERE t.organization_id = :org_id AND t.is_deleted = false AND t.project_id IS NOT NULL
        GROUP BY p.name
        ORDER BY ticket_count DESC
        LIMIT 20
        """,
        {"org_id": org_id},
    )
    summary_dict = dict(summary) if summary else {}
    response_total = summary_dict.get("tickets_with_response_sla") or 0
    resolution_total = summary_dict.get("tickets_with_resolution_sla") or 0
    summary_dict["response_sla_compliance_pct"] = (
        round(100.0 * summary_dict.get("response_sla_met", 0) / response_total, 1) if response_total else None
    )
    summary_dict["resolution_sla_compliance_pct"] = (
        round(100.0 * summary_dict.get("resolution_sla_met", 0) / resolution_total, 1) if resolution_total else None
    )
    return {
        "success": True,
        "data": {
            "summary": summary_dict,
            "tickets_by_category": by_category,
            "tickets_by_client": by_client,
            "tickets_by_project": by_project,
        },
        "message": "Support dashboard fetched.",
        "meta": {},
    }


@router.post("/support/tickets/{ticket_id}/comments", status_code=status.HTTP_201_CREATED)
async def create_ticket_comment(
    ticket_id: str,
    payload: TicketCommentPayload,
    user: dict = Depends(require_permission("crm.support.create")),
    db: AsyncSession = Depends(get_db),
):
    org_id = _org_id(user)
    await _require_tenant_record(db, "crm.support_tickets", ticket_id, org_id, "Support ticket")
    result = await db.execute(
        text("""
            INSERT INTO crm.ticket_comments (organization_id, ticket_id, created_by, body, visibility)
            VALUES (:org_id, :ticket_id, :user_id, :body, :visibility)
            RETURNING id
        """),
        {"org_id": org_id, "ticket_id": ticket_id, "user_id": _user_id(user), **payload.model_dump()},
    )
    await db.commit()
    return {"success": True, "data": {"id": str(result.scalar())}, "message": "CRM ticket comment created.", "meta": {}}


@router.get("/support/tickets/{ticket_id}/comments")
async def list_ticket_comments(
    ticket_id: str,
    user: dict = Depends(require_permission("crm.support.read")),
    db: AsyncSession = Depends(get_db),
):
    org_id = _org_id(user)
    await _require_tenant_record(db, "crm.support_tickets", ticket_id, org_id, "Support ticket")
    rows = await _rows(
        db,
        """
        SELECT *
        FROM crm.ticket_comments
        WHERE organization_id = :org_id AND ticket_id = :ticket_id AND is_deleted = false
        ORDER BY created_at ASC
        """,
        {"org_id": org_id, "ticket_id": ticket_id},
    )
    return {"success": True, "data": rows, "message": "CRM ticket comments listed.", "meta": {"total": len(rows)}}
