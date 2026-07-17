"""Procurement control tower workflow APIs."""

from datetime import date
from decimal import Decimal
import json
from typing import Any, Literal, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.security import require_permission

router = APIRouter()


class Payload(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class RequisitionLinePayload(Payload):
    item_id: Optional[UUID] = None
    description: str = Field(min_length=1)
    qty: Decimal = Field(gt=0, alias="qty", max_digits=14, decimal_places=3)
    uom: str = Field(default="each", max_length=40)
    unit_cost: Decimal = Field(
        default=Decimal("0"), ge=0, max_digits=15, decimal_places=4
    )
    work_package: Optional[str] = Field(default=None, max_length=160)
    notes: Optional[str] = None


class RequisitionCreate(Payload):
    project_id: Optional[UUID] = None
    site_id: Optional[UUID] = None
    cost_code_id: Optional[UUID] = None
    required_by_date: date
    priority: Literal["low", "normal", "urgent", "emergency"] = "normal"
    justification: Optional[str] = None
    line_items: list[RequisitionLinePayload] = Field(min_length=1)


class DecisionPayload(Payload):
    decision: Literal["approved", "rejected"]
    reason: Optional[str] = Field(default=None, max_length=2000)


class RfqCreatePayload(Payload):
    requisition_id: UUID
    title: Optional[str] = Field(default=None, max_length=255)
    description: Optional[str] = None
    closing_date: Optional[date] = None
    issue_now: bool = True


class RfqResponsePayload(Payload):
    supplier_id: UUID
    reference: Optional[str] = Field(default=None, max_length=160)
    total_amount: Decimal = Field(ge=0, max_digits=15, decimal_places=2)
    delivery_days: Optional[int] = Field(default=None, gt=0, le=3650)
    validity_days: int = Field(default=30, gt=0, le=3650)
    notes: Optional[str] = None
    line_items: list[dict[str, Any]] = Field(default_factory=list)


class RfqResponseDecisionPayload(Payload):
    decision: Literal["selected", "rejected", "evaluated"]
    evaluation_score: Optional[Decimal] = Field(
        default=None, ge=0, le=100, max_digits=5, decimal_places=2
    )
    notes: Optional[str] = None


class PurchaseOrderFromRfq(Payload):
    rfq_response_id: UUID
    title: Optional[str] = None
    delivery_address: Optional[str] = None
    required_by_date: Optional[date] = None
    tax_amount: Decimal = Field(
        default=Decimal("0"), ge=0, max_digits=15, decimal_places=2
    )
    notes: Optional[str] = None


class PurchaseOrderFromRequisition(Payload):
    requisition_id: UUID
    supplier_id: UUID
    title: Optional[str] = None
    delivery_address: Optional[str] = None
    required_by_date: Optional[date] = None
    tax_amount: Decimal = Field(
        default=Decimal("0"), ge=0, max_digits=15, decimal_places=2
    )
    notes: Optional[str] = None


class IssuePoPayload(Payload):
    notes: Optional[str] = None


class GoodsReceivedPayload(Payload):
    po_id: UUID
    store_id: Optional[UUID] = None
    delivery_date: date
    delivery_note_ref: Optional[str] = Field(default=None, max_length=160)
    condition_notes: Optional[str] = None


class SupplierInvoicePayload(Payload):
    po_id: UUID
    grn_id: Optional[UUID] = None
    supplier_invoice_ref: str = Field(min_length=1, max_length=160)
    invoice_date: date
    due_date: Optional[date] = None
    subtotal: Decimal = Field(ge=0, max_digits=15, decimal_places=2)
    tax_amount: Decimal = Field(
        default=Decimal("0"), ge=0, max_digits=15, decimal_places=2
    )
    notes: Optional[str] = None


class PaymentDecisionPayload(Payload):
    decision: Literal["approved", "rejected"]
    reason: Optional[str] = Field(default=None, max_length=2000)
    approval_document_id: Optional[UUID] = None


class ProcurementDocumentLinkPayload(Payload):
    entity_type: Literal["purchase_order", "goods_received_note", "supplier_invoice"]
    entity_id: UUID
    document_id: UUID
    link_role: Literal[
        "purchase_order",
        "goods_receipt",
        "supplier_invoice",
        "payment_approval",
        "evidence",
    ] = "evidence"


def ok(data: Any, message: str, total: Optional[int] = None):
    return {
        "success": True,
        "data": data,
        "message": message,
        "meta": {} if total is None else {"total": total},
    }


async def emit_event(
    db: AsyncSession,
    *,
    user: dict,
    event_type: str,
    aggregate_type: str,
    aggregate_id: UUID,
    project_id: Optional[UUID],
    payload: dict[str, Any],
) -> None:
    await db.execute(
        text("""
        INSERT INTO core.domain_events (
            organization_id, event_type, schema_version, aggregate_type, aggregate_id,
            project_id, actor_id, idempotency_key, payload
        ) VALUES (
            :org_id, :event_type, 1, :aggregate_type, :aggregate_id,
            :project_id, :actor_id, :idempotency_key, CAST(:payload AS jsonb)
        ) ON CONFLICT (organization_id, idempotency_key) DO NOTHING
    """),
        {
            "org_id": user["org_id"],
            "event_type": event_type,
            "aggregate_type": aggregate_type,
            "aggregate_id": aggregate_id,
            "project_id": project_id,
            "actor_id": user["user_id"],
            "idempotency_key": f"{event_type}:{aggregate_type}:{aggregate_id}",
            "payload": json.dumps(payload, default=str),
        },
    )


async def next_number(db: AsyncSession, org_id: str, name: str, prefix: str) -> str:
    row = await db.execute(
        text("""
        INSERT INTO core.sequences (organization_id, sequence_name, last_value)
        VALUES (:org_id, :name, 1)
        ON CONFLICT (organization_id, sequence_name)
        DO UPDATE SET last_value = core.sequences.last_value + 1, updated_at = NOW()
        RETURNING last_value
    """),
        {"org_id": org_id, "name": name},
    )
    return f"{prefix}-{int(row.scalar()):06d}"


async def project_exists(
    db: AsyncSession, project_id: Optional[UUID], org_id: str
) -> None:
    if project_id is None:
        return
    found = await db.execute(
        text(
            "SELECT 1 FROM projects.projects WHERE id=:id AND organization_id=:org_id AND is_deleted=false"
        ),
        {"id": project_id, "org_id": org_id},
    )
    if not found.scalar():
        raise HTTPException(status_code=404, detail="Project not found")


async def document_or_404(db: AsyncSession, document_id: UUID, org_id: str) -> None:
    found = await db.execute(
        text("""
        SELECT 1 FROM core.documents
        WHERE id=:document_id AND organization_id=:org_id AND is_deleted=false
    """),
        {"document_id": document_id, "org_id": org_id},
    )
    if not found.scalar():
        raise HTTPException(status_code=404, detail="Document not found")


async def procurement_entity_project(
    db: AsyncSession, *, org_id: str, entity_type: str, entity_id: UUID
) -> Optional[UUID]:
    query_map = {
        "purchase_order": text("""
            SELECT project_id FROM procurement.purchase_orders
            WHERE id=:entity_id AND organization_id=:org_id AND is_deleted=false
        """),
        "goods_received_note": text("""
            SELECT project_id FROM procurement.goods_received_notes
            WHERE id=:entity_id AND organization_id=:org_id AND is_deleted=false
        """),
        "supplier_invoice": text("""
            SELECT project_id FROM procurement.supplier_invoices
            WHERE id=:entity_id AND organization_id=:org_id AND is_deleted=false
        """),
    }
    query = query_map.get(entity_type)
    if query is None:
        raise HTTPException(
            status_code=400, detail="Unsupported procurement document entity type"
        )
    row = (
        (
            await db.execute(
                query,
                {"entity_id": entity_id, "org_id": org_id},
            )
        )
        .mappings()
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Procurement record not found")
    return row["project_id"]


async def link_procurement_document(
    db: AsyncSession,
    *,
    user: dict,
    entity_type: str,
    entity_id: UUID,
    document_id: UUID,
    link_role: str,
    project_id: Optional[UUID],
) -> None:
    await document_or_404(db, document_id, user["org_id"])
    await db.execute(
        text("""
        INSERT INTO core.document_links (
            organization_id, document_id, entity_type, entity_id, project_id, link_role, linked_by
        ) VALUES (
            :org_id, :document_id, :entity_type, :entity_id, :project_id, :link_role, :user_id
        ) ON CONFLICT (organization_id, document_id, entity_type, entity_id, link_role)
          DO UPDATE SET is_deleted=false, linked_by=EXCLUDED.linked_by, linked_at=NOW()
    """),
        {
            "org_id": user["org_id"],
            "document_id": document_id,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "project_id": project_id,
            "link_role": link_role,
            "user_id": user["user_id"],
        },
    )
    await emit_event(
        db,
        user=user,
        event_type="document.linked.v1",
        aggregate_type=entity_type,
        aggregate_id=entity_id,
        project_id=project_id,
        payload={"document_id": str(document_id), "link_role": link_role},
    )


async def has_document_link(
    db: AsyncSession,
    *,
    org_id: str,
    entity_type: str,
    entity_id: UUID,
    roles: tuple[str, ...],
) -> bool:
    row = await db.execute(
        text("""
        SELECT 1 FROM core.document_links
        WHERE organization_id=:org_id
          AND entity_type=:entity_type
          AND entity_id=:entity_id
          AND is_deleted=false
          AND link_role = ANY(CAST(:roles AS varchar[]))
        LIMIT 1
    """),
        {
            "org_id": org_id,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "roles": list(roles),
        },
    )
    return bool(row.scalar())


async def budget_available(
    db: AsyncSession, org_id: str, project_id: Optional[UUID]
) -> Decimal:
    if project_id is None:
        return Decimal("0")
    row = (
        await db.execute(
            text("""
        SELECT
          COALESCE((SELECT total_amount FROM finance.project_budgets WHERE organization_id=:org_id AND project_id=:project_id AND status='approved' AND is_deleted=false LIMIT 1), 0)
          - COALESCE((SELECT SUM(committed_amount) FROM finance.commitments WHERE organization_id=:org_id AND project_id=:project_id AND status <> 'cancelled' AND is_deleted=false), 0)
          - COALESCE((SELECT SUM(amount) FROM finance.cost_transactions WHERE organization_id=:org_id AND project_id=:project_id), 0)
          AS available
    """),
            {"org_id": org_id, "project_id": project_id},
        )
    ).first()
    return Decimal(str(row.available or 0))


@router.get("/requisitions")
async def list_requisitions(
    status_filter: Optional[str] = Query(default=None, alias="status"),
    project_id: Optional[UUID] = None,
    user: dict = Depends(require_permission("procurement.requisition.read")),
    db: AsyncSession = Depends(get_db),
):
    rows = await db.execute(
        text("""
        SELECT pr.*, p.name AS project_name,
               COALESCE(jsonb_agg(to_jsonb(rl) ORDER BY rl.created_at) FILTER (WHERE rl.id IS NOT NULL), '[]'::jsonb) AS lines
        FROM procurement.purchase_requisitions pr
        LEFT JOIN projects.projects p ON p.id=pr.project_id AND p.organization_id=pr.organization_id
        LEFT JOIN procurement.requisition_lines rl ON rl.requisition_id=pr.id AND rl.organization_id=pr.organization_id AND rl.is_deleted=false
        WHERE pr.organization_id=:org_id AND pr.is_deleted=false
          AND (CAST(:status AS varchar) IS NULL OR pr.status=CAST(:status AS varchar))
          AND (CAST(:project_id AS uuid) IS NULL OR pr.project_id=CAST(:project_id AS uuid))
        GROUP BY pr.id, p.name
        ORDER BY pr.created_at DESC
        LIMIT 500
    """),
        {"org_id": user["org_id"], "status": status_filter, "project_id": project_id},
    )
    data = [dict(r._mapping) for r in rows]
    return ok(data, "Purchase requisitions listed.", len(data))


@router.post("/requisitions", status_code=status.HTTP_201_CREATED)
async def create_requisition(
    payload: RequisitionCreate,
    user: dict = Depends(require_permission("procurement.requisition.create")),
    db: AsyncSession = Depends(get_db),
):
    await project_exists(db, payload.project_id, user["org_id"])
    total = sum(
        (line.qty * line.unit_cost for line in payload.line_items), Decimal("0")
    )
    available = await budget_available(db, user["org_id"], payload.project_id)
    req_no = await next_number(db, user["org_id"], "purchase_requisition", "PR")
    req_id = (
        await db.execute(
            text("""
        INSERT INTO procurement.purchase_requisitions (
            organization_id, requisition_number, project_id, site_id, cost_code_id,
            requested_by, required_by_date, priority, justification, total_estimated,
            budget_checked, budget_available, created_by
        ) VALUES (
            :org_id, :number, :project_id, :site_id, :cost_code_id,
            :user_id, :required_by_date, :priority, :justification, :total,
            true, :available, :user_id
        ) RETURNING id
    """),
            {
                "org_id": user["org_id"],
                "number": req_no,
                "project_id": payload.project_id,
                "site_id": payload.site_id,
                "cost_code_id": payload.cost_code_id,
                "user_id": user["user_id"],
                "required_by_date": payload.required_by_date,
                "priority": payload.priority,
                "justification": payload.justification,
                "total": total,
                "available": available,
            },
        )
    ).scalar()
    for line in payload.line_items:
        await db.execute(
            text("""
            INSERT INTO procurement.requisition_lines (
                organization_id, requisition_id, item_id, description, quantity,
                unit_of_measure, estimated_unit_cost, work_package, notes
            ) VALUES (
                :org_id, :req_id, :item_id, :description, :quantity,
                :uom, :unit_cost, :work_package, :notes
            )
        """),
            {
                "org_id": user["org_id"],
                "req_id": req_id,
                "item_id": line.item_id,
                "description": line.description,
                "quantity": line.qty,
                "uom": line.uom,
                "unit_cost": line.unit_cost,
                "work_package": line.work_package,
                "notes": line.notes,
            },
        )
    await emit_event(
        db,
        user=user,
        event_type="material.requested.v1",
        aggregate_type="purchase_requisition",
        aggregate_id=req_id,
        project_id=payload.project_id,
        payload={
            "requisition_number": req_no,
            "total_estimated": total,
            "budget_available": available,
        },
    )
    await db.commit()
    return ok(
        {"id": str(req_id), "requisition_number": req_no},
        "Purchase requisition created.",
    )


async def requisition_or_404(
    db: AsyncSession, req_id: UUID, org_id: str
) -> dict[str, Any]:
    row = (
        (
            await db.execute(
                text(
                    "SELECT * FROM procurement.purchase_requisitions WHERE id=:id AND organization_id=:org_id AND is_deleted=false"
                ),
                {"id": req_id, "org_id": org_id},
            )
        )
        .mappings()
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Purchase requisition not found")
    return dict(row)


@router.post("/requisitions/{req_id}/submit")
async def submit_requisition(
    req_id: UUID,
    user: dict = Depends(require_permission("procurement.requisition.submit")),
    db: AsyncSession = Depends(get_db),
):
    req = await requisition_or_404(db, req_id, user["org_id"])
    if req["status"] != "draft":
        raise HTTPException(
            status_code=409, detail="Only draft requisitions can be submitted."
        )
    if (
        Decimal(str(req["total_estimated"]))
        > Decimal(str(req["budget_available"] or 0))
        and user.get("role") != "SUPERADMIN"
    ):
        raise HTTPException(
            status_code=409, detail="Requisition exceeds available approved budget."
        )
    await db.execute(
        text(
            "UPDATE procurement.purchase_requisitions SET status='submitted', submitted_at=NOW(), submitted_by=:user_id, updated_at=NOW() WHERE id=:id"
        ),
        {"id": req_id, "user_id": user["user_id"]},
    )
    await emit_event(
        db,
        user=user,
        event_type="procurement.requisition.submitted.v1",
        aggregate_type="purchase_requisition",
        aggregate_id=req_id,
        project_id=req["project_id"],
        payload={"status": "submitted"},
    )
    await db.commit()
    return ok(
        {"id": str(req_id), "status": "submitted"}, "Purchase requisition submitted."
    )


@router.post("/requisitions/{req_id}/decision")
async def decide_requisition(
    req_id: UUID,
    payload: DecisionPayload,
    user: dict = Depends(require_permission("procurement.requisition.approve")),
    db: AsyncSession = Depends(get_db),
):
    req = await requisition_or_404(db, req_id, user["org_id"])
    if req["status"] != "submitted":
        raise HTTPException(
            status_code=409,
            detail="Only submitted requisitions can be approved or rejected.",
        )
    if str(req["requested_by"]) == user["user_id"]:
        raise HTTPException(status_code=409, detail="Self-approval is not permitted.")
    if (
        payload.decision == "approved"
        and Decimal(str(req["total_estimated"]))
        > Decimal(str(req["budget_available"] or 0))
        and user.get("role") != "SUPERADMIN"
    ):
        raise HTTPException(
            status_code=409,
            detail="Cannot approve requisition above available approved budget.",
        )
    await db.execute(
        text("""
        UPDATE procurement.purchase_requisitions
        SET status=CAST(:decision AS varchar),
            approved_at=CASE WHEN CAST(:decision AS varchar)='approved' THEN NOW() ELSE approved_at END,
            approved_by=CASE WHEN CAST(:decision AS varchar)='approved' THEN :user_id ELSE approved_by END,
            rejection_reason=CASE WHEN CAST(:decision AS varchar)='rejected' THEN :reason ELSE NULL END,
            updated_at=NOW()
        WHERE id=:id
    """),
        {
            "id": req_id,
            "decision": payload.decision,
            "reason": payload.reason,
            "user_id": user["user_id"],
        },
    )
    decision_event = (
        "procurement.requisition.approved.v1"
        if payload.decision == "approved"
        else "procurement.requisition.rejected.v1"
    )
    await emit_event(
        db,
        user=user,
        event_type=decision_event,
        aggregate_type="purchase_requisition",
        aggregate_id=req_id,
        project_id=req["project_id"],
        payload=payload.model_dump(mode="json"),
    )
    await db.commit()
    return ok(
        {"id": str(req_id), "status": payload.decision},
        f"Purchase requisition {payload.decision}.",
    )


@router.get("/rfqs")
async def list_rfqs(
    status_filter: Optional[str] = Query(default=None, alias="status"),
    project_id: Optional[UUID] = None,
    user: dict = Depends(require_permission("procurement.rfq.read")),
    db: AsyncSession = Depends(get_db),
):
    rows = await db.execute(
        text("""
        SELECT rfq.*, pr.requisition_number, p.name AS project_name,
               COALESCE((
                 SELECT jsonb_agg(
                   jsonb_build_object(
                     'id', rr.id,
                     'supplier_id', rr.supplier_id,
                     'supplier_name', s.supplier_name,
                     'reference', rr.reference,
                     'total_amount', rr.total_amount,
                     'delivery_days', rr.delivery_days,
                     'validity_days', rr.validity_days,
                     'evaluation_score', rr.evaluation_score,
                     'status', rr.status,
                     'notes', rr.notes,
                     'line_items', rr.line_items,
                     'received_at', rr.received_at
                   ) ORDER BY rr.total_amount ASC, rr.received_at ASC
                 )
                 FROM procurement.rfq_responses rr
                 JOIN procurement.suppliers s ON s.id=rr.supplier_id AND s.organization_id=rr.organization_id
                 WHERE rr.rfq_id=rfq.id AND rr.organization_id=rfq.organization_id AND rr.is_deleted=false
               ), '[]'::jsonb) AS responses
        FROM procurement.rfqs rfq
        LEFT JOIN procurement.purchase_requisitions pr ON pr.id=rfq.requisition_id AND pr.organization_id=rfq.organization_id
        LEFT JOIN projects.projects p ON p.id=rfq.project_id AND p.organization_id=rfq.organization_id
        WHERE rfq.organization_id=:org_id AND rfq.is_deleted=false
          AND (CAST(:status AS varchar) IS NULL OR rfq.status=CAST(:status AS varchar))
          AND (CAST(:project_id AS uuid) IS NULL OR rfq.project_id=CAST(:project_id AS uuid))
        ORDER BY rfq.created_at DESC
        LIMIT 500
    """),
        {"org_id": user["org_id"], "status": status_filter, "project_id": project_id},
    )
    data = [dict(r._mapping) for r in rows]
    return ok(data, "RFQs listed.", len(data))


async def rfq_or_404(db: AsyncSession, rfq_id: UUID, org_id: str) -> dict[str, Any]:
    row = (
        (
            await db.execute(
                text("""
        SELECT * FROM procurement.rfqs
        WHERE id=:id AND organization_id=:org_id AND is_deleted=false
    """),
                {"id": rfq_id, "org_id": org_id},
            )
        )
        .mappings()
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="RFQ not found")
    return dict(row)


async def rfq_response_or_404(
    db: AsyncSession, response_id: UUID, org_id: str
) -> dict[str, Any]:
    row = (
        (
            await db.execute(
                text("""
        SELECT rr.*, rfq.requisition_id, rfq.project_id, rfq.id AS rfq_id
        FROM procurement.rfq_responses rr
        JOIN procurement.rfqs rfq ON rfq.id=rr.rfq_id AND rfq.organization_id=rr.organization_id
        WHERE rr.id=:id AND rr.organization_id=:org_id AND rr.is_deleted=false AND rfq.is_deleted=false
    """),
                {"id": response_id, "org_id": org_id},
            )
        )
        .mappings()
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="RFQ response not found")
    return dict(row)


@router.post("/rfqs", status_code=status.HTTP_201_CREATED)
async def create_rfq(
    payload: RfqCreatePayload,
    user: dict = Depends(require_permission("procurement.rfq.create")),
    db: AsyncSession = Depends(get_db),
):
    req = await requisition_or_404(db, payload.requisition_id, user["org_id"])
    if req["status"] != "approved":
        raise HTTPException(
            status_code=409, detail="RFQ requires an approved requisition."
        )
    rfq_no = await next_number(db, user["org_id"], "rfq", "RFQ")
    status_value = "issued" if payload.issue_now else "draft"
    rfq_id = (
        await db.execute(
            text("""
        INSERT INTO procurement.rfqs (
            organization_id, rfq_number, requisition_id, project_id, title, description,
            closing_date, status, issued_by, issued_at, created_by
        ) VALUES (
            :org_id, :rfq_number, :requisition_id, :project_id, :title, :description,
            CAST(:closing_date AS timestamptz), CAST(:status AS varchar),
            CASE WHEN CAST(:status AS varchar)='issued' THEN :user_id ELSE NULL END,
            CASE WHEN CAST(:status AS varchar)='issued' THEN NOW() ELSE NULL END,
            :user_id
        ) RETURNING id
    """),
            {
                "org_id": user["org_id"],
                "rfq_number": rfq_no,
                "requisition_id": payload.requisition_id,
                "project_id": req["project_id"],
                "title": payload.title or req["requisition_number"],
                "description": payload.description or req["justification"],
                "closing_date": payload.closing_date,
                "status": status_value,
                "user_id": user["user_id"],
            },
        )
    ).scalar()
    await emit_event(
        db,
        user=user,
        event_type="procurement.rfq.issued.v1"
        if status_value == "issued"
        else "procurement.rfq.created.v1",
        aggregate_type="rfq",
        aggregate_id=rfq_id,
        project_id=req["project_id"],
        payload={
            "rfq_number": rfq_no,
            "requisition_id": str(payload.requisition_id),
            "status": status_value,
        },
    )
    await db.commit()
    return ok(
        {"id": str(rfq_id), "rfq_number": rfq_no, "status": status_value},
        "RFQ created.",
    )


@router.post("/rfqs/{rfq_id}/responses", status_code=status.HTTP_201_CREATED)
async def record_rfq_response(
    rfq_id: UUID,
    payload: RfqResponsePayload,
    user: dict = Depends(require_permission("procurement.rfq.manage")),
    db: AsyncSession = Depends(get_db),
):
    rfq = await rfq_or_404(db, rfq_id, user["org_id"])
    if rfq["status"] not in {"issued", "closed"}:
        raise HTTPException(
            status_code=409,
            detail="Supplier quotations can only be captured against issued or closed RFQs.",
        )
    supplier = (
        await db.execute(
            text(
                "SELECT 1 FROM procurement.suppliers WHERE id=:id AND organization_id=:org_id AND is_deleted=false"
            ),
            {"id": payload.supplier_id, "org_id": user["org_id"]},
        )
    ).scalar()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")
    response_id = (
        await db.execute(
            text("""
        INSERT INTO procurement.rfq_responses (
            organization_id, rfq_id, supplier_id, reference, total_amount,
            delivery_days, validity_days, notes, line_items, created_by
        ) VALUES (
            :org_id, :rfq_id, :supplier_id, :reference, :total_amount,
            :delivery_days, :validity_days, :notes, CAST(:line_items AS jsonb), :user_id
        ) ON CONFLICT (organization_id, rfq_id, supplier_id)
          DO UPDATE SET reference=EXCLUDED.reference, total_amount=EXCLUDED.total_amount,
              delivery_days=EXCLUDED.delivery_days, validity_days=EXCLUDED.validity_days,
              notes=EXCLUDED.notes, line_items=EXCLUDED.line_items, status='received', updated_at=NOW()
        RETURNING id
    """),
            {
                "org_id": user["org_id"],
                "rfq_id": rfq_id,
                "supplier_id": payload.supplier_id,
                "reference": payload.reference,
                "total_amount": payload.total_amount,
                "delivery_days": payload.delivery_days,
                "validity_days": payload.validity_days,
                "notes": payload.notes,
                "line_items": json.dumps(payload.line_items, default=str),
                "user_id": user["user_id"],
            },
        )
    ).scalar()
    await emit_event(
        db,
        user=user,
        event_type="procurement.quotation.received.v1",
        aggregate_type="rfq_response",
        aggregate_id=response_id,
        project_id=rfq["project_id"],
        payload={
            "rfq_id": str(rfq_id),
            "supplier_id": str(payload.supplier_id),
            "total_amount": str(payload.total_amount),
        },
    )
    await db.commit()
    return ok({"id": str(response_id)}, "Supplier quotation recorded.")


@router.post("/rfqs/{rfq_id}/responses/{response_id}/decision")
async def decide_rfq_response(
    rfq_id: UUID,
    response_id: UUID,
    payload: RfqResponseDecisionPayload,
    user: dict = Depends(require_permission("procurement.rfq.manage")),
    db: AsyncSession = Depends(get_db),
):
    rfq = await rfq_or_404(db, rfq_id, user["org_id"])
    response = await rfq_response_or_404(db, response_id, user["org_id"])
    if response["rfq_id"] != rfq_id:
        raise HTTPException(
            status_code=404, detail="RFQ response not found for this RFQ"
        )
    if payload.decision == "selected":
        await db.execute(
            text("""
            UPDATE procurement.rfq_responses
            SET status='rejected', updated_at=NOW()
            WHERE organization_id=:org_id AND rfq_id=:rfq_id AND id<>:response_id AND is_deleted=false
        """),
            {"org_id": user["org_id"], "rfq_id": rfq_id, "response_id": response_id},
        )
        await db.execute(
            text(
                "UPDATE procurement.rfqs SET status='closed', updated_at=NOW() WHERE id=:rfq_id"
            ),
            {"rfq_id": rfq_id},
        )
    await db.execute(
        text("""
        UPDATE procurement.rfq_responses
        SET status=CAST(:decision AS varchar),
            evaluation_score=COALESCE(:score, evaluation_score),
            notes=COALESCE(:notes, notes),
            updated_at=NOW()
        WHERE id=:response_id AND organization_id=:org_id
    """),
        {
            "org_id": user["org_id"],
            "response_id": response_id,
            "decision": payload.decision,
            "score": payload.evaluation_score,
            "notes": payload.notes,
        },
    )
    event_type = (
        "procurement.quotation.selected.v1"
        if payload.decision == "selected"
        else f"procurement.quotation.{payload.decision}.v1"
    )
    await emit_event(
        db,
        user=user,
        event_type=event_type,
        aggregate_type="rfq_response",
        aggregate_id=response_id,
        project_id=rfq["project_id"],
        payload=payload.model_dump(mode="json"),
    )
    await db.commit()
    return ok(
        {"id": str(response_id), "status": payload.decision},
        f"Supplier quotation {payload.decision}.",
    )


@router.get("/purchase-orders")
async def list_purchase_orders(
    status_filter: Optional[str] = Query(default=None, alias="status"),
    supplier_id: Optional[UUID] = None,
    user: dict = Depends(require_permission("procurement.po.read")),
    db: AsyncSession = Depends(get_db),
):
    rows = await db.execute(
        text("""
        SELECT po.*, s.supplier_name, p.name AS project_name,
               COALESCE((
                 SELECT jsonb_agg(to_jsonb(pol) ORDER BY pol.created_at)
                 FROM procurement.purchase_order_lines pol
                 WHERE pol.po_id=po.id AND pol.organization_id=po.organization_id AND pol.is_deleted=false
               ), '[]'::jsonb) AS lines,
               COALESCE((
                 SELECT ROUND((SUM(pol.quantity_received) / NULLIF(SUM(pol.quantity), 0)) * 100, 2)
                 FROM procurement.purchase_order_lines pol
                 WHERE pol.po_id=po.id AND pol.organization_id=po.organization_id AND pol.is_deleted=false
               ), 0) AS percent_received,
               COALESCE((
                 SELECT jsonb_agg(to_jsonb(grn) ORDER BY grn.created_at DESC)
                 FROM procurement.goods_received_notes grn
                 WHERE grn.po_id=po.id AND grn.organization_id=po.organization_id AND grn.is_deleted=false
               ), '[]'::jsonb) AS grns,
               COALESCE((
                 SELECT jsonb_agg(to_jsonb(inv) ORDER BY inv.created_at DESC)
                 FROM procurement.supplier_invoices inv
                 WHERE inv.po_id=po.id AND inv.organization_id=po.organization_id AND inv.is_deleted=false
               ), '[]'::jsonb) AS invoices
        FROM procurement.purchase_orders po
        JOIN procurement.suppliers s ON s.id=po.supplier_id AND s.organization_id=po.organization_id
        LEFT JOIN projects.projects p ON p.id=po.project_id AND p.organization_id=po.organization_id
        WHERE po.organization_id=:org_id AND po.is_deleted=false
          AND (CAST(:status AS varchar) IS NULL OR po.status=CAST(:status AS varchar))
          AND (CAST(:supplier_id AS uuid) IS NULL OR po.supplier_id=CAST(:supplier_id AS uuid))
        ORDER BY po.created_at DESC
        LIMIT 500
    """),
        {"org_id": user["org_id"], "status": status_filter, "supplier_id": supplier_id},
    )
    data = [dict(r._mapping) for r in rows]
    return ok(data, "Purchase orders listed.", len(data))


@router.post("/documents/link", status_code=status.HTTP_201_CREATED)
async def link_document(
    payload: ProcurementDocumentLinkPayload,
    user: dict = Depends(require_permission("documents.link")),
    db: AsyncSession = Depends(get_db),
):
    project_id = await procurement_entity_project(
        db,
        org_id=user["org_id"],
        entity_type=payload.entity_type,
        entity_id=payload.entity_id,
    )
    await link_procurement_document(
        db,
        user=user,
        entity_type=payload.entity_type,
        entity_id=payload.entity_id,
        document_id=payload.document_id,
        link_role=payload.link_role,
        project_id=project_id,
    )
    await db.commit()
    return ok(
        {
            "entity_type": payload.entity_type,
            "entity_id": str(payload.entity_id),
            "document_id": str(payload.document_id),
            "link_role": payload.link_role,
        },
        "Procurement document linked.",
    )


@router.post("/purchase-orders/from-rfq", status_code=status.HTTP_201_CREATED)
async def create_purchase_order_from_rfq(
    payload: PurchaseOrderFromRfq,
    user: dict = Depends(require_permission("procurement.po.create")),
    db: AsyncSession = Depends(get_db),
):
    response = await rfq_response_or_404(db, payload.rfq_response_id, user["org_id"])
    if response["status"] != "selected":
        raise HTTPException(
            status_code=409,
            detail="Purchase order requires a selected supplier quotation.",
        )
    req = await requisition_or_404(db, response["requisition_id"], user["org_id"])
    if req["status"] != "approved":
        raise HTTPException(
            status_code=409, detail="Purchase order requires an approved requisition."
        )
    rfq = await rfq_or_404(db, response["rfq_id"], user["org_id"])
    lines = (
        (
            await db.execute(
                text("""
        SELECT * FROM procurement.requisition_lines
        WHERE requisition_id=:id AND organization_id=:org_id AND is_deleted=false
    """),
                {"id": response["requisition_id"], "org_id": user["org_id"]},
            )
        )
        .mappings()
        .all()
    )
    subtotal = Decimal(str(response["total_amount"] or 0))
    po_no = await next_number(db, user["org_id"], "purchase_order", "PO")
    po_id = (
        await db.execute(
            text("""
        INSERT INTO procurement.purchase_orders (
            organization_id, po_number, requisition_id, rfq_id, rfq_response_id, supplier_id,
            project_id, site_id, cost_code_id, title, delivery_address, required_by_date,
            subtotal, tax_amount, total_amount, notes, created_by
        ) VALUES (
            :org_id, :number, :req_id, :rfq_id, :response_id, :supplier_id,
            :project_id, :site_id, :cost_code_id, :title, :delivery_address, :required_by_date,
            :subtotal, :tax, :total, :notes, :user_id
        ) RETURNING id
    """),
            {
                "org_id": user["org_id"],
                "number": po_no,
                "req_id": response["requisition_id"],
                "rfq_id": response["rfq_id"],
                "response_id": payload.rfq_response_id,
                "supplier_id": response["supplier_id"],
                "project_id": req["project_id"],
                "site_id": req["site_id"],
                "cost_code_id": req["cost_code_id"],
                "title": payload.title or rfq["title"] or req["requisition_number"],
                "delivery_address": payload.delivery_address,
                "required_by_date": payload.required_by_date or req["required_by_date"],
                "subtotal": subtotal,
                "tax": payload.tax_amount,
                "total": subtotal + payload.tax_amount,
                "notes": payload.notes
                or f"Created from selected quotation {response['reference'] or payload.rfq_response_id}",
                "user_id": user["user_id"],
            },
        )
    ).scalar()
    if lines:
        estimated_total = sum(
            (
                Decimal(str(line["quantity"]))
                * Decimal(str(line["estimated_unit_cost"] or 0))
                for line in lines
            ),
            Decimal("0"),
        )
        for line in lines:
            quantity = Decimal(str(line["quantity"]))
            estimated_line_total = quantity * Decimal(
                str(line["estimated_unit_cost"] or 0)
            )
            line_total = (
                (subtotal * (estimated_line_total / estimated_total)).quantize(
                    Decimal("0.01")
                )
                if estimated_total > 0
                else Decimal("0.00")
            )
            unit_price = (
                (line_total / quantity).quantize(Decimal("0.0001"))
                if quantity > 0
                else Decimal("0.0000")
            )
            await db.execute(
                text("""
                INSERT INTO procurement.purchase_order_lines (
                    organization_id, po_id, item_id, description, quantity,
                    unit_of_measure, unit_price, line_total, notes
                ) VALUES (
                    :org_id, :po_id, :item_id, :description, :quantity,
                    :uom, :unit_price, :line_total, :notes
                )
            """),
                {
                    "org_id": user["org_id"],
                    "po_id": po_id,
                    "item_id": line["item_id"],
                    "description": line["description"],
                    "quantity": line["quantity"],
                    "uom": line["unit_of_measure"],
                    "unit_price": unit_price,
                    "line_total": line_total,
                    "notes": line["notes"],
                },
            )
    else:
        await db.execute(
            text("""
            INSERT INTO procurement.purchase_order_lines (
                organization_id, po_id, description, quantity, unit_of_measure, unit_price, line_total, notes
            ) VALUES (
                :org_id, :po_id, :description, 1, 'lot', :unit_price, :line_total, :notes
            )
        """),
            {
                "org_id": user["org_id"],
                "po_id": po_id,
                "description": rfq["title"],
                "unit_price": subtotal,
                "line_total": subtotal,
                "notes": "Generated from RFQ response total.",
            },
        )
    await db.execute(
        text(
            "UPDATE procurement.purchase_requisitions SET status='ordered', updated_at=NOW() WHERE id=:id"
        ),
        {"id": response["requisition_id"]},
    )
    await emit_event(
        db,
        user=user,
        event_type="procurement.purchase_order.created.v1",
        aggregate_type="purchase_order",
        aggregate_id=po_id,
        project_id=req["project_id"],
        payload={
            "po_number": po_no,
            "requisition_id": str(response["requisition_id"]),
            "rfq_id": str(response["rfq_id"]),
            "rfq_response_id": str(payload.rfq_response_id),
        },
    )
    await db.commit()
    return ok(
        {"id": str(po_id), "po_number": po_no},
        "Purchase order created from selected quotation.",
    )


@router.post("/purchase-orders", status_code=status.HTTP_201_CREATED)
async def create_purchase_order(
    payload: PurchaseOrderFromRequisition,
    user: dict = Depends(require_permission("procurement.po.create")),
    db: AsyncSession = Depends(get_db),
):
    req = await requisition_or_404(db, payload.requisition_id, user["org_id"])
    if req["status"] != "approved":
        raise HTTPException(
            status_code=409, detail="Purchase order requires an approved requisition."
        )
    if not payload.notes or len(payload.notes.strip()) < 12:
        raise HTTPException(
            status_code=422,
            detail="Direct purchase order creation requires a supplier selection rationale.",
        )
    supplier = (
        await db.execute(
            text(
                "SELECT 1 FROM procurement.suppliers WHERE id=:id AND organization_id=:org_id AND is_deleted=false"
            ),
            {"id": payload.supplier_id, "org_id": user["org_id"]},
        )
    ).scalar()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")
    lines = (
        (
            await db.execute(
                text(
                    "SELECT * FROM procurement.requisition_lines WHERE requisition_id=:id AND organization_id=:org_id AND is_deleted=false"
                ),
                {"id": payload.requisition_id, "org_id": user["org_id"]},
            )
        )
        .mappings()
        .all()
    )
    subtotal = sum(
        (
            Decimal(str(line["quantity"])) * Decimal(str(line["estimated_unit_cost"] or 0))
            for line in lines
        ),
        Decimal("0"),
    )
    po_no = await next_number(db, user["org_id"], "purchase_order", "PO")
    po_id = (
        await db.execute(
            text("""
        INSERT INTO procurement.purchase_orders (
            organization_id, po_number, requisition_id, supplier_id, project_id, site_id, cost_code_id,
            title, delivery_address, required_by_date, subtotal, tax_amount, total_amount, notes, created_by
        ) VALUES (
            :org_id, :number, :req_id, :supplier_id, :project_id, :site_id, :cost_code_id,
            :title, :delivery_address, :required_by_date, :subtotal, :tax, :total, :notes, :user_id
        ) RETURNING id
    """),
            {
                "org_id": user["org_id"],
                "number": po_no,
                "req_id": payload.requisition_id,
                "supplier_id": payload.supplier_id,
                "project_id": req["project_id"],
                "site_id": req["site_id"],
                "cost_code_id": req["cost_code_id"],
                "title": payload.title or req["requisition_number"],
                "delivery_address": payload.delivery_address,
                "required_by_date": payload.required_by_date or req["required_by_date"],
                "subtotal": subtotal,
                "tax": payload.tax_amount,
                "total": subtotal + payload.tax_amount,
                "notes": payload.notes,
                "user_id": user["user_id"],
            },
        )
    ).scalar()
    for line in lines:
        line_total = Decimal(str(line["quantity"])) * Decimal(
            str(line["estimated_unit_cost"] or 0)
        )
        await db.execute(
            text("""
            INSERT INTO procurement.purchase_order_lines (organization_id, po_id, item_id, description, quantity, unit_of_measure, unit_price, line_total, notes)
            VALUES (:org_id, :po_id, :item_id, :description, :quantity, :uom, :unit_price, :line_total, :notes)
        """),
            {
                "org_id": user["org_id"],
                "po_id": po_id,
                "item_id": line["item_id"],
                "description": line["description"],
                "quantity": line["quantity"],
                "uom": line["unit_of_measure"],
                "unit_price": line["estimated_unit_cost"] or 0,
                "line_total": line_total,
                "notes": line["notes"],
            },
        )
    await db.execute(
        text(
            "UPDATE procurement.purchase_requisitions SET status='ordered', updated_at=NOW() WHERE id=:id"
        ),
        {"id": payload.requisition_id},
    )
    await emit_event(
        db,
        user=user,
        event_type="procurement.purchase_order.created.v1",
        aggregate_type="purchase_order",
        aggregate_id=po_id,
        project_id=req["project_id"],
        payload={"po_number": po_no, "requisition_id": str(payload.requisition_id)},
    )
    await db.commit()
    return ok({"id": str(po_id), "po_number": po_no}, "Purchase order created.")


@router.post("/purchase-orders/{po_id}/issue")
async def issue_purchase_order(
    po_id: UUID,
    payload: IssuePoPayload,
    user: dict = Depends(require_permission("procurement.po.issue")),
    db: AsyncSession = Depends(get_db),
):
    po = (
        (
            await db.execute(
                text(
                    "SELECT * FROM procurement.purchase_orders WHERE id=:id AND organization_id=:org_id AND is_deleted=false"
                ),
                {"id": po_id, "org_id": user["org_id"]},
            )
        )
        .mappings()
        .first()
    )
    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    if po["status"] not in {"draft", "approved"}:
        raise HTTPException(
            status_code=409,
            detail="Only draft or approved purchase orders can be issued.",
        )
    await db.execute(
        text(
            "UPDATE procurement.purchase_orders SET status='issued', issued_by=:user_id, issued_at=NOW(), updated_at=NOW() WHERE id=:id"
        ),
        {"id": po_id, "user_id": user["user_id"]},
    )
    await db.execute(
        text("""
        INSERT INTO finance.commitments (organization_id, project_id, cost_code_id, cost_category, source_type, source_id, description, committed_amount, commitment_date, created_by)
        VALUES (:org_id, :project_id, :cost_code_id, 'materials', 'purchase_order', :po_id, :description, :amount, CURRENT_DATE, :user_id)
        ON CONFLICT (organization_id, source_type, source_id) DO NOTHING
    """),
        {
            "org_id": user["org_id"],
            "project_id": po["project_id"],
            "cost_code_id": po["cost_code_id"],
            "po_id": po_id,
            "description": po["title"] or po["po_number"],
            "amount": po["total_amount"],
            "user_id": user["user_id"],
        },
    )
    await emit_event(
        db,
        user=user,
        event_type="procurement.purchase_order.issued.v1",
        aggregate_type="purchase_order",
        aggregate_id=po_id,
        project_id=po["project_id"],
        payload={"po_number": po["po_number"]},
    )
    await emit_event(
        db,
        user=user,
        event_type="finance.commitment_created.v1",
        aggregate_type="purchase_order",
        aggregate_id=po_id,
        project_id=po["project_id"],
        payload={"amount": po["total_amount"]},
    )
    await db.commit()
    return ok(
        {"id": str(po_id), "status": "issued"},
        "Purchase order issued and commitment created.",
    )


@router.get("/suppliers")
async def suppliers(
    user: dict = Depends(require_permission("procurement.supplier.read")),
    db: AsyncSession = Depends(get_db),
):
    rows = await db.execute(
        text(
            "SELECT * FROM procurement.suppliers WHERE organization_id=:org_id AND is_deleted=false ORDER BY supplier_name LIMIT 500"
        ),
        {"org_id": user["org_id"]},
    )
    data = [dict(r._mapping) for r in rows]
    return ok(data, "Suppliers listed.", len(data))


@router.get("/invoices")
async def invoices(
    match_status: Optional[str] = None,
    user: dict = Depends(require_permission("procurement.invoice.read")),
    db: AsyncSession = Depends(get_db),
):
    rows = await db.execute(
        text("""
        SELECT inv.*, s.supplier_name, po.po_number
        FROM procurement.supplier_invoices inv
        JOIN procurement.suppliers s ON s.id=inv.supplier_id AND s.organization_id=inv.organization_id
        LEFT JOIN procurement.purchase_orders po ON po.id=inv.po_id AND po.organization_id=inv.organization_id
        WHERE inv.organization_id=:org_id AND inv.is_deleted=false
          AND (CAST(:match_status AS varchar) IS NULL OR inv.match_status=CAST(:match_status AS varchar))
        ORDER BY inv.invoice_date DESC, inv.created_at DESC
        LIMIT 500
    """),
        {"org_id": user["org_id"], "match_status": match_status},
    )
    data = [dict(r._mapping) for r in rows]
    return ok(data, "Supplier invoices listed.", len(data))


@router.post("/goods-received", status_code=status.HTTP_201_CREATED)
async def receive_goods(
    payload: GoodsReceivedPayload,
    user: dict = Depends(require_permission("procurement.grn.create")),
    db: AsyncSession = Depends(get_db),
):
    po = (
        (
            await db.execute(
                text(
                    "SELECT * FROM procurement.purchase_orders WHERE id=:id AND organization_id=:org_id AND is_deleted=false"
                ),
                {"id": payload.po_id, "org_id": user["org_id"]},
            )
        )
        .mappings()
        .first()
    )
    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    if po["status"] not in {"issued", "partially_received"}:
        raise HTTPException(
            status_code=409,
            detail="Goods can only be received against an issued purchase order.",
        )
    if payload.store_id:
        store = (
            await db.execute(
                text(
                    "SELECT 1 FROM procurement.stores WHERE id=:id AND organization_id=:org_id AND is_deleted=false"
                ),
                {"id": payload.store_id, "org_id": user["org_id"]},
            )
        ).scalar()
        if not store:
            raise HTTPException(status_code=404, detail="Store not found")
    lines = (
        (
            await db.execute(
                text("""
        SELECT * FROM procurement.purchase_order_lines
        WHERE po_id=:po_id AND organization_id=:org_id AND is_deleted=false
          AND quantity_received < quantity
    """),
                {"po_id": payload.po_id, "org_id": user["org_id"]},
            )
        )
        .mappings()
        .all()
    )
    if not lines:
        raise HTTPException(
            status_code=409,
            detail="Purchase order has no outstanding receivable lines.",
        )
    grn_no = await next_number(db, user["org_id"], "goods_received_note", "GRN")
    grn_id = (
        await db.execute(
            text("""
        INSERT INTO procurement.goods_received_notes (
            organization_id, grn_number, po_id, supplier_id, store_id, project_id,
            delivery_date, delivery_note_ref, received_by, status, condition_notes,
            confirmed_at, confirmed_by, created_by
        ) VALUES (
            :org_id, :number, :po_id, :supplier_id, :store_id, :project_id,
            :delivery_date, :delivery_note_ref, :user_id, 'confirmed', :condition_notes,
            NOW(), :user_id, :user_id
        ) RETURNING id
    """),
            {
                "org_id": user["org_id"],
                "number": grn_no,
                "po_id": payload.po_id,
                "supplier_id": po["supplier_id"],
                "store_id": payload.store_id,
                "project_id": po["project_id"],
                "delivery_date": payload.delivery_date,
                "delivery_note_ref": payload.delivery_note_ref,
                "condition_notes": payload.condition_notes,
                "user_id": user["user_id"],
            },
        )
    ).scalar()
    for line in lines:
        remaining = Decimal(str(line["quantity"])) - Decimal(
            str(line["quantity_received"])
        )
        grn_line_id = (
            await db.execute(
                text("""
            INSERT INTO procurement.grn_lines (
                organization_id, grn_id, po_line_id, item_id, description,
                quantity_ordered, quantity_received, quantity_rejected, unit_price
            ) VALUES (
                :org_id, :grn_id, :po_line_id, :item_id, :description,
                :ordered, :received, 0, :unit_price
            ) RETURNING id
        """),
                {
                    "org_id": user["org_id"],
                    "grn_id": grn_id,
                    "po_line_id": line["id"],
                    "item_id": line["item_id"],
                    "description": line["description"],
                    "ordered": line["quantity"],
                    "received": remaining,
                    "unit_price": line["unit_price"],
                },
            )
        ).scalar()
        await db.execute(
            text(
                "UPDATE procurement.purchase_order_lines SET quantity_received = quantity_received + :received WHERE id=:id"
            ),
            {"received": remaining, "id": line["id"]},
        )
        if line["item_id"]:
            await db.execute(
                text("""
                INSERT INTO procurement.stock_ledger (
                    organization_id, item_id, store_id, project_id, movement_type, quantity,
                    unit_cost, total_cost, source_type, source_id, reference, recorded_by
                ) VALUES (
                    :org_id, :item_id, :store_id, :project_id, 'receipt', :quantity,
                    :unit_cost, ROUND(CAST(:quantity AS numeric) * CAST(:unit_cost AS numeric), 2), 'goods_received_note', :source_id, :reference, :user_id
                ) ON CONFLICT (organization_id, source_type, source_id, item_id, movement_type) DO NOTHING
            """),
                {
                    "org_id": user["org_id"],
                    "item_id": line["item_id"],
                    "store_id": payload.store_id,
                    "project_id": po["project_id"],
                    "quantity": remaining,
                    "unit_cost": line["unit_price"],
                    "source_id": grn_line_id,
                    "reference": grn_no,
                    "user_id": user["user_id"],
                },
            )
    await db.execute(
        text("""
        UPDATE procurement.purchase_orders po
        SET status = CASE
            WHEN NOT EXISTS (
              SELECT 1 FROM procurement.purchase_order_lines pol
              WHERE pol.po_id=po.id AND pol.organization_id=po.organization_id AND pol.is_deleted=false AND pol.quantity_received < pol.quantity
            ) THEN 'received' ELSE 'partially_received' END,
            updated_at=NOW()
        WHERE po.id=:po_id
    """),
        {"po_id": payload.po_id},
    )
    await emit_event(
        db,
        user=user,
        event_type="inventory.goods_received.v1",
        aggregate_type="goods_received_note",
        aggregate_id=grn_id,
        project_id=po["project_id"],
        payload={"grn_number": grn_no, "po_id": str(payload.po_id)},
    )
    await db.commit()
    return ok(
        {"id": str(grn_id), "grn_number": grn_no}, "Goods received and stock updated."
    )


@router.post("/invoices", status_code=status.HTTP_201_CREATED)
async def create_invoice(
    payload: SupplierInvoicePayload,
    user: dict = Depends(require_permission("procurement.invoice.create")),
    db: AsyncSession = Depends(get_db),
):
    po = (
        (
            await db.execute(
                text(
                    "SELECT * FROM procurement.purchase_orders WHERE id=:id AND organization_id=:org_id AND is_deleted=false"
                ),
                {"id": payload.po_id, "org_id": user["org_id"]},
            )
        )
        .mappings()
        .first()
    )
    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    if payload.grn_id:
        grn = (
            await db.execute(
                text(
                    "SELECT 1 FROM procurement.goods_received_notes WHERE id=:id AND po_id=:po_id AND organization_id=:org_id AND status='confirmed' AND is_deleted=false"
                ),
                {
                    "id": payload.grn_id,
                    "po_id": payload.po_id,
                    "org_id": user["org_id"],
                },
            )
        ).scalar()
        if not grn:
            raise HTTPException(
                status_code=404,
                detail="Confirmed GRN not found for this purchase order",
            )
    invoice_no = await next_number(db, user["org_id"], "supplier_invoice", "INV")
    total = payload.subtotal + payload.tax_amount
    try:
        invoice_id = (
            await db.execute(
                text("""
            INSERT INTO procurement.supplier_invoices (
                organization_id, invoice_number, supplier_invoice_ref, supplier_id, po_id, grn_id, project_id,
                invoice_date, due_date, subtotal, tax_amount, total_amount, notes, created_by
            ) VALUES (
                :org_id, :invoice_number, :supplier_invoice_ref, :supplier_id, :po_id, :grn_id, :project_id,
                :invoice_date, :due_date, :subtotal, :tax_amount, :total_amount, :notes, :user_id
            ) RETURNING id
        """),
                {
                    "org_id": user["org_id"],
                    "invoice_number": invoice_no,
                    "supplier_invoice_ref": payload.supplier_invoice_ref,
                    "supplier_id": po["supplier_id"],
                    "po_id": payload.po_id,
                    "grn_id": payload.grn_id,
                    "project_id": po["project_id"],
                    "invoice_date": payload.invoice_date,
                    "due_date": payload.due_date,
                    "subtotal": payload.subtotal,
                    "tax_amount": payload.tax_amount,
                    "total_amount": total,
                    "notes": payload.notes,
                    "user_id": user["user_id"],
                },
            )
        ).scalar()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=409, detail="Duplicate supplier invoice reference."
        ) from exc
    await emit_event(
        db,
        user=user,
        event_type="finance.invoice_registered.v1",
        aggregate_type="supplier_invoice",
        aggregate_id=invoice_id,
        project_id=po["project_id"],
        payload={"invoice_number": invoice_no, "total_amount": total},
    )
    await db.commit()
    return ok(
        {"id": str(invoice_id), "invoice_number": invoice_no},
        "Supplier invoice registered.",
    )


@router.post("/invoices/{invoice_id}/match")
async def match_invoice(
    invoice_id: UUID,
    user: dict = Depends(require_permission("procurement.invoice.match")),
    db: AsyncSession = Depends(get_db),
):
    inv = (
        (
            await db.execute(
                text("""
        SELECT inv.*, po.total_amount AS po_total,
               COALESCE((SELECT SUM(quantity_received * unit_price) FROM procurement.grn_lines gl JOIN procurement.goods_received_notes grn ON grn.id=gl.grn_id WHERE grn.po_id=inv.po_id AND grn.organization_id=inv.organization_id AND grn.status='confirmed' AND gl.is_deleted=false), 0) AS grn_total
        FROM procurement.supplier_invoices inv
        JOIN procurement.purchase_orders po ON po.id=inv.po_id AND po.organization_id=inv.organization_id
        WHERE inv.id=:id AND inv.organization_id=:org_id AND inv.is_deleted=false
    """),
                {"id": invoice_id, "org_id": user["org_id"]},
            )
        )
        .mappings()
        .first()
    )
    if not inv:
        raise HTTPException(status_code=404, detail="Supplier invoice not found")
    total = Decimal(str(inv["total_amount"]))
    matched_amount = min(
        total, Decimal(str(inv["po_total"] or 0)), Decimal(str(inv["grn_total"] or 0))
    )
    match_status = (
        "matched"
        if matched_amount == total
        else (
            "over_invoice"
            if total > Decimal(str(inv["po_total"] or 0))
            else "partial_match"
        )
    )
    status_value = "matched" if match_status == "matched" else "matching"
    await db.execute(
        text("""
        UPDATE procurement.supplier_invoices
        SET matched_amount=:matched_amount, match_status=:match_status, status=:status, is_duplicate_checked=true, updated_at=NOW()
        WHERE id=:id
    """),
        {
            "id": invoice_id,
            "matched_amount": matched_amount,
            "match_status": match_status,
            "status": status_value,
        },
    )
    await emit_event(
        db,
        user=user,
        event_type="procurement.invoice_matched.v1",
        aggregate_type="supplier_invoice",
        aggregate_id=invoice_id,
        project_id=inv["project_id"],
        payload={"match_status": match_status, "matched_amount": matched_amount},
    )
    await db.commit()
    return ok(
        {
            "id": str(invoice_id),
            "match_status": match_status,
            "matched_amount": str(matched_amount),
        },
        "Invoice matching completed.",
    )


@router.post("/invoices/{invoice_id}/payment-decision")
async def payment_decision(
    invoice_id: UUID,
    payload: PaymentDecisionPayload,
    user: dict = Depends(require_permission("procurement.invoice.approve_payment")),
    db: AsyncSession = Depends(get_db),
):
    inv = (
        (
            await db.execute(
                text(
                    "SELECT * FROM procurement.supplier_invoices WHERE id=:id AND organization_id=:org_id AND is_deleted=false"
                ),
                {"id": invoice_id, "org_id": user["org_id"]},
            )
        )
        .mappings()
        .first()
    )
    if not inv:
        raise HTTPException(status_code=404, detail="Supplier invoice not found")
    if payload.decision == "approved" and inv["match_status"] != "matched":
        raise HTTPException(
            status_code=409,
            detail="Payment approval requires a matched PO, GRN and invoice.",
        )
    if payload.decision == "approved":
        if not inv["po_id"] or not inv["grn_id"]:
            raise HTTPException(
                status_code=409,
                detail="Payment approval requires linked PO, GRN, invoice and approval evidence.",
            )
        if not payload.approval_document_id:
            raise HTTPException(
                status_code=409,
                detail="Payment approval requires approval evidence document.",
            )
        evidence_checks = [
            ("purchase_order", inv["po_id"], ("purchase_order", "evidence")),
            ("goods_received_note", inv["grn_id"], ("goods_receipt", "evidence")),
            ("supplier_invoice", invoice_id, ("supplier_invoice", "evidence")),
        ]
        missing_evidence: list[str] = []
        for entity_type, entity_id, roles in evidence_checks:
            if not await has_document_link(
                db,
                org_id=user["org_id"],
                entity_type=entity_type,
                entity_id=entity_id,
                roles=roles,
            ):
                missing_evidence.append(entity_type)
        if missing_evidence:
            raise HTTPException(
                status_code=409,
                detail=f"Payment approval requires document evidence for: {', '.join(missing_evidence)}.",
            )
        await link_procurement_document(
            db,
            user=user,
            entity_type="supplier_invoice",
            entity_id=invoice_id,
            document_id=payload.approval_document_id,
            link_role="payment_approval",
            project_id=inv["project_id"],
        )
    status_value = "approved" if payload.decision == "approved" else "rejected"
    await db.execute(
        text("""
        UPDATE procurement.supplier_invoices
        SET status=CAST(:status AS varchar),
            payment_approved_by=CASE WHEN CAST(:status AS varchar)='approved' THEN :user_id ELSE payment_approved_by END,
            payment_approved_at=CASE WHEN CAST(:status AS varchar)='approved' THEN NOW() ELSE payment_approved_at END,
            rejection_reason=CASE WHEN CAST(:status AS varchar)='rejected' THEN :reason ELSE rejection_reason END,
            updated_at=NOW()
        WHERE id=:id
    """),
        {
            "id": invoice_id,
            "status": status_value,
            "reason": payload.reason,
            "user_id": user["user_id"],
        },
    )
    if status_value == "approved":
        await db.execute(
            text("""
            UPDATE finance.commitments
            SET invoiced_amount = LEAST(committed_amount, invoiced_amount + :amount),
                status = CASE WHEN LEAST(committed_amount, invoiced_amount + :amount) >= committed_amount THEN 'fully_invoiced' ELSE 'partially_invoiced' END,
                updated_at=NOW()
            WHERE organization_id=:org_id AND source_type='purchase_order' AND source_id=:po_id
        """),
            {
                "org_id": user["org_id"],
                "po_id": inv["po_id"],
                "amount": inv["total_amount"],
            },
        )
    invoice_event = (
        "finance.invoice_approved.v1"
        if status_value == "approved"
        else "finance.invoice_rejected.v1"
    )
    await emit_event(
        db,
        user=user,
        event_type=invoice_event,
        aggregate_type="supplier_invoice",
        aggregate_id=invoice_id,
        project_id=inv["project_id"],
        payload=payload.model_dump(mode="json"),
    )
    await db.commit()
    return ok(
        {"id": str(invoice_id), "status": status_value},
        f"Invoice payment {status_value}.",
    )
