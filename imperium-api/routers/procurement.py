"""Procurement control tower workflow APIs."""

from datetime import date, timedelta
from decimal import Decimal
import json
import logging
from typing import Any, Literal, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.security import require_permission
from core.project_scope import project_scope_sql, visible_project_ids
from core.truncation import capped
from app.services import inventory_service
from app.services.finance.ccb_monitor import record_requisition_budget_breach
from app.services.finance import procurement_verification, gl_bridge, vat_engine
from app.services.finance.general_ledger import GeneralLedgerError
from app.services.quotations.intelligence_engine import RateIntelligenceEngine, CommercialGuard
from app.shared.events import emit_notification, emit_role_notification
from app.shared.project_setup import ensure_project_operational_setup

logger = logging.getLogger(__name__)

router = APIRouter()

# Roles permitted to push a requisition/stock action through past a budget or
# stock-level cap, provided they supply a reason. SUPERADMIN could always do
# this silently before; this makes the bypass visible, role-scoped, and
# auditable instead of an undocumented backend-only escape hatch.
BUDGET_OVERRIDE_ROLES = {"SUPERADMIN", "Finance Manager", "Project Manager"}


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


class ReplenishmentDraftPayload(Payload):
    store_id: Optional[UUID] = None
    project_id: Optional[UUID] = None
    item_ids: Optional[list[UUID]] = None


class DecisionPayload(Payload):
    decision: Literal["approved", "rejected"]
    reason: Optional[str] = Field(default=None, max_length=2000)
    override_reason: Optional[str] = Field(default=None, max_length=2000)


class MaterialRequestPricePayload(Payload):
    unit_cost: Decimal = Field(gt=0, max_digits=15, decimal_places=4)


class SubmitRequisitionPayload(Payload):
    override_reason: Optional[str] = Field(default=None, max_length=2000)


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
    # Whether this invoice is a valid fiscal tax invoice from a VAT-registered
    # supplier and its VAT is genuinely reclaimable - not inferred from the
    # supplier's own is_vat_registered flag, since a specific invoice can
    # still lack a valid tax invoice even from a registered supplier. Drives
    # real-time input-VAT accrual (see vat_engine.py).
    input_vat_claimable: bool = False
    notes: Optional[str] = None


class PaymentDecisionPayload(Payload):
    decision: Literal["approved", "rejected"]
    reason: Optional[str] = Field(default=None, max_length=2000)
    approval_document_id: Optional[UUID] = None


class PurchaseOrderDecisionPayload(Payload):
    decision: Literal["approved", "rejected"]
    reason: Optional[str] = Field(default=None, max_length=2000)


class PurchaseOrderAmendmentPayload(Payload):
    additional_amount: Decimal = Field(gt=0, decimal_places=2, description="Additional authorized commitment amount")
    reason: str = Field(min_length=5, max_length=2000, description="Commercial justification or variation claim note")
    variation_id: Optional[UUID] = Field(default=None, description="Optional approved variation order ID")


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


def is_procurement_manager(user: dict) -> bool:
    return str(user.get("role") or "").strip().lower() == "procurement manager"


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


async def ensure_current_weekly_budget(
    db: AsyncSession,
    *,
    org_id: str,
    project_id: Optional[UUID],
    site_id: Optional[UUID] = None,
) -> Optional[UUID]:
    if project_id is None:
        return None
    row = await db.execute(
        text("""
        SELECT id
        FROM projects.weekly_budgets
        WHERE organization_id=:org_id
          AND project_id=:project_id
          AND (CAST(:site_id AS uuid) IS NULL OR site_id=CAST(:site_id AS uuid) OR site_id IS NULL)
          AND week_start <= CURRENT_DATE
          AND week_start + 6 >= CURRENT_DATE
          AND status IN ('submitted', 'approved')
          AND is_deleted=false
        LIMIT 1
    """),
        {"org_id": org_id, "project_id": project_id, "site_id": site_id},
    )
    budget_id = row.scalar()
    if not budget_id:
        raise HTTPException(
            status_code=409,
            detail="Submit this week's project/site budget before creating requisitions or RFQs.",
        )
    return budget_id


@router.get("/control-tower")
async def get_supply_control_tower_kpis(
    project_id: Optional[UUID] = None,
    store_id: Optional[UUID] = None,
    user: dict = Depends(require_permission("procurement.requisition.read")),
    db: AsyncSession = Depends(get_db),
):
    """
    Supply Control Tower unified KPI summary for Procurement and Inventory.
    Calculates operational health indicators server-side across inventory, requisitions,
    open deliveries, invoices, and budget commitment headroom.
    """
    org_id = user["org_id"]

    critical_low_stock = {
        "count": 0,
        "out_of_stock": 0,
        "store_id": str(store_id) if store_id else None,
    }
    expected_deliveries = {
        "count": 0,
        "overdue_count": 0,
        "value": 0.0,
        "currency": "USD",
    }
    pending_approvals = {
        "total": 0,
        "requisitions": 0,
        "orders": 0,
    }
    unmatched_invoices = {
        "count": 0,
        "disputed_count": 0,
        "value": 0.0,
        "currency": "USD",
    }
    financial_commitments = {
        "committed_amount": 0.0,
        "approved_budget": 0.0,
        "currency": "USD",
    }

    # 1. Critical Low Stock items (at or below reorder level in usable state)
    try:
        low_stock_row = (
            await db.execute(
                text("""
                WITH item_balances AS (
                    SELECT sl.item_id, COALESCE(SUM(sl.quantity), 0) AS total_qty
                    FROM procurement.stock_ledger sl
                    WHERE sl.organization_id = CAST(:org_id AS uuid)
                      AND (CAST(:store_id AS uuid) IS NULL OR sl.store_id = CAST(:store_id AS uuid))
                    GROUP BY sl.item_id
                )
                SELECT COUNT(i.id) AS low_stock_count,
                       COALESCE(SUM(CASE WHEN COALESCE(b.total_qty, 0) = 0 THEN 1 ELSE 0 END), 0) AS out_of_stock_count
                FROM procurement.inventory_items i
                LEFT JOIN item_balances b ON b.item_id = i.id
                WHERE i.organization_id = CAST(:org_id AS uuid)
                  AND i.is_deleted = false
                  AND COALESCE(i.reorder_level, 0) > 0
                  AND COALESCE(b.total_qty, 0) <= COALESCE(i.reorder_level, 0)
            """),
                {"org_id": org_id, "store_id": store_id},
            )
        ).mappings().first()
        if low_stock_row:
            critical_low_stock["count"] = int(low_stock_row["low_stock_count"] or 0)
            critical_low_stock["out_of_stock"] = int(low_stock_row["out_of_stock_count"] or 0)
    except Exception as exc:
        logger.warning("Failed to calculate low stock KPIs: %s", exc)

    # 2. Expected Deliveries & In-Transit (POs issued or partially received)
    try:
        deliveries_row = (
            await db.execute(
                text("""
                SELECT COUNT(po.id) AS pending_deliveries_count,
                       COALESCE(SUM(po.total_amount), 0) AS pending_deliveries_value,
                       COALESCE(SUM(CASE WHEN po.required_by_date IS NOT NULL AND po.required_by_date < CURRENT_DATE THEN 1 ELSE 0 END), 0) AS overdue_deliveries_count
                FROM procurement.purchase_orders po
                WHERE po.organization_id = CAST(:org_id AS uuid)
                  AND po.is_deleted = false
                  AND po.status IN ('issued', 'partially_received')
                  AND (CAST(:project_id AS uuid) IS NULL OR po.project_id = CAST(:project_id AS uuid))
            """),
                {"org_id": org_id, "project_id": project_id},
            )
        ).mappings().first()
        if deliveries_row:
            expected_deliveries["count"] = int(deliveries_row["pending_deliveries_count"] or 0)
            expected_deliveries["overdue_count"] = int(deliveries_row["overdue_deliveries_count"] or 0)
            expected_deliveries["value"] = float(deliveries_row["pending_deliveries_value"] or 0)
    except Exception as exc:
        logger.warning("Failed to calculate delivery KPIs: %s", exc)

    # 3. Decisions Awaiting Approval (Requisitions submitted + POs awaiting approval)
    try:
        approvals_row = (
            await db.execute(
                text("""
                SELECT
                    (SELECT COUNT(id) FROM procurement.purchase_requisitions
                     WHERE organization_id = CAST(:org_id AS uuid)
                       AND is_deleted = false
                       AND status = 'submitted'
                       AND (CAST(:project_id AS uuid) IS NULL OR project_id = CAST(:project_id AS uuid))) AS pending_requisitions,
                    (SELECT COUNT(id) FROM procurement.purchase_orders
                     WHERE organization_id = CAST(:org_id AS uuid)
                       AND is_deleted = false
                       AND status = 'draft'
                       AND (CAST(:project_id AS uuid) IS NULL OR project_id = CAST(:project_id AS uuid))) AS pending_orders
            """),
                {"org_id": org_id, "project_id": project_id},
            )
        ).mappings().first()
        if approvals_row:
            req_cnt = int(approvals_row["pending_requisitions"] or 0)
            ord_cnt = int(approvals_row["pending_orders"] or 0)
            pending_approvals["requisitions"] = req_cnt
            pending_approvals["orders"] = ord_cnt
            pending_approvals["total"] = req_cnt + ord_cnt
    except Exception as exc:
        logger.warning("Failed to calculate approval KPIs: %s", exc)

    # 4. Unmatched & Disputed Invoices
    try:
        invoices_row = (
            await db.execute(
                text("""
                SELECT COUNT(inv.id) AS unmatched_invoices_count,
                       COALESCE(SUM(inv.total_amount), 0) AS unmatched_invoices_value,
                       COALESCE(SUM(CASE WHEN inv.match_status IN ('over_invoice', 'disputed') THEN 1 ELSE 0 END), 0) AS disputed_invoices_count
                FROM procurement.supplier_invoices inv
                WHERE inv.organization_id = CAST(:org_id AS uuid)
                  AND inv.is_deleted = false
                  AND inv.match_status IN ('unmatched', 'partial_match', 'over_invoice', 'disputed')
                  AND (CAST(:project_id AS uuid) IS NULL OR inv.project_id = CAST(:project_id AS uuid))
            """),
                {"org_id": org_id, "project_id": project_id},
            )
        ).mappings().first()
        if invoices_row:
            unmatched_invoices["count"] = int(invoices_row["unmatched_invoices_count"] or 0)
            unmatched_invoices["disputed_count"] = int(invoices_row["disputed_invoices_count"] or 0)
            unmatched_invoices["value"] = float(invoices_row["unmatched_invoices_value"] or 0)
    except Exception as exc:
        logger.warning("Failed to calculate invoice KPIs: %s", exc)

    # 5. Financial Commitments vs Active Project Budgets
    try:
        financials_row = (
            await db.execute(
                text("""
                SELECT
                    COALESCE((
                        SELECT SUM(c.committed_amount)
                        FROM finance.commitments c
                        WHERE c.organization_id = CAST(:org_id AS uuid)
                          AND c.is_deleted = false
                          AND c.status <> 'cancelled'
                          AND (CAST(:project_id AS uuid) IS NULL OR c.project_id = CAST(:project_id AS uuid))
                    ), 0) AS total_committed,
                    COALESCE((
                        SELECT SUM(pb.total_amount)
                        FROM finance.project_budgets pb
                        WHERE pb.organization_id = CAST(:org_id AS uuid)
                          AND pb.is_deleted = false
                          AND pb.status = 'approved'
                          AND (CAST(:project_id AS uuid) IS NULL OR pb.project_id = CAST(:project_id AS uuid))
                    ), 0) AS total_approved_budget
            """),
                {"org_id": org_id, "project_id": project_id},
            )
        ).mappings().first()
        if financials_row:
            financial_commitments["committed_amount"] = float(financials_row["total_committed"] or 0)
            financial_commitments["approved_budget"] = float(financials_row["total_approved_budget"] or 0)
    except Exception as exc:
        logger.warning("Failed to calculate financial commitments KPIs: %s", exc)

    data = {
        "critical_low_stock": critical_low_stock,
        "expected_deliveries": expected_deliveries,
        "pending_approvals": pending_approvals,
        "unmatched_invoices": unmatched_invoices,
        "financial_commitments": financial_commitments,
    }

    return ok(data, "Supply control tower KPIs calculated.")


@router.get("/requisitions")
async def list_requisitions(
    status_filter: Optional[str] = Query(default=None, alias="status"),
    project_id: Optional[UUID] = None,
    user: dict = Depends(require_permission("procurement.requisition.read")),
    db: AsyncSession = Depends(get_db),
):
    # Site roles see requisitions for their assigned projects (and their own).
    scope_sql, scope_params = project_scope_sql("pr.project_id", await visible_project_ids(db, user))
    rows = await db.execute(
        text(f"""
        SELECT pr.*, p.name AS project_name,
               COALESCE(jsonb_agg(to_jsonb(rl) ORDER BY rl.created_at) FILTER (WHERE rl.id IS NOT NULL), '[]'::jsonb) AS lines
        FROM procurement.purchase_requisitions pr
        LEFT JOIN projects.projects p ON p.id=pr.project_id AND p.organization_id=pr.organization_id
        LEFT JOIN procurement.requisition_lines rl ON rl.requisition_id=pr.id AND rl.organization_id=pr.organization_id AND rl.is_deleted=false
        WHERE pr.organization_id=:org_id AND pr.is_deleted=false
          AND ({scope_sql} OR pr.requested_by=CAST(:scope_user_id AS uuid))
          AND (CAST(:status AS varchar) IS NULL OR pr.status=CAST(:status AS varchar))
          AND (CAST(:project_id AS uuid) IS NULL OR pr.project_id=CAST(:project_id AS uuid))
        GROUP BY pr.id, p.name
        ORDER BY pr.created_at DESC
        LIMIT 501
    """),
        {"org_id": user["org_id"], "status": status_filter, "project_id": project_id,
         "scope_user_id": user["user_id"], **scope_params},
    )
    data = [dict(r._mapping) for r in capped(rows, 500)]
    return ok(data, "Purchase requisitions listed.", len(data))


@router.get("/material-requests")
async def list_material_requests(
    is_price_confirmed: Optional[bool] = Query(default=None),
    project_id: Optional[UUID] = None,
    user: dict = Depends(require_permission("procurement.requisition.read")),
    db: AsyncSession = Depends(get_db),
):
    scope_sql, scope_params = project_scope_sql("mr.project_id", await visible_project_ids(db, user))
    rows = await db.execute(
        text(f"""
        SELECT mr.*, i.item_name, i.item_code, i.unit_of_measure, p.name AS project_name
        FROM procurement.material_requests mr
        JOIN procurement.inventory_items i ON i.id=mr.item_id
        LEFT JOIN projects.projects p ON p.id=mr.project_id AND p.organization_id=mr.organization_id
        WHERE mr.organization_id=:org_id AND mr.is_deleted=false
          AND ({scope_sql} OR mr.requested_by=CAST(:scope_user_id AS uuid))
          AND (CAST(:is_price_confirmed AS boolean) IS NULL OR mr.is_price_confirmed=CAST(:is_price_confirmed AS boolean))
          AND (CAST(:project_id AS uuid) IS NULL OR mr.project_id=CAST(:project_id AS uuid))
        ORDER BY mr.created_at DESC
        LIMIT 501
    """),
        {
            "org_id": user["org_id"],
            "is_price_confirmed": is_price_confirmed,
            "project_id": project_id,
            "scope_user_id": user["user_id"],
            **scope_params,
        },
    )
    data = [dict(r._mapping) for r in capped(rows, 500)]
    return ok(data, "Material requests listed.", len(data))


@router.patch("/material-requests/{request_id}/price")
async def confirm_material_request_price(
    request_id: UUID,
    payload: MaterialRequestPricePayload,
    user: dict = Depends(require_permission("procurement.requisition.approve")),
    db: AsyncSession = Depends(get_db),
):
    """Procurement or inventory confirms the real unit cost for a material
    request a site submitted with no known price (a supplier quotation now
    exists). This is a correction, not a silent overwrite: the finance cost
    transaction and stock ledger unit cost already posted at issue time are
    updated to match, using the same DO UPDATE upsert pattern fleet.py uses
    for its own cost corrections, so the audit trail (posted_at, priced_by/
    priced_at) shows the price changed rather than losing the original post."""
    request_row = (
        (
            await db.execute(
                text("""
        SELECT * FROM procurement.material_requests
        WHERE id=:id AND organization_id=:org_id AND is_deleted=false
    """),
                {"id": request_id, "org_id": user["org_id"]},
            )
        )
        .mappings()
        .first()
    )
    if not request_row:
        raise HTTPException(status_code=404, detail="Material request not found.")

    total_estimated = (
        request_row["requested_quantity"] * payload.unit_cost
    ).quantize(Decimal("0.01"))
    await db.execute(
        text("""
        UPDATE procurement.material_requests
        SET unit_cost=:unit_cost, total_estimated=:total_estimated,
            is_price_confirmed=true, priced_by=:user_id, priced_at=NOW(), updated_at=NOW()
        WHERE id=:id AND organization_id=:org_id
    """),
        {
            "unit_cost": payload.unit_cost,
            "total_estimated": total_estimated,
            "user_id": user["user_id"],
            "id": request_id,
            "org_id": user["org_id"],
        },
    )

    if request_row["stock_ledger_id"]:
        await db.execute(
            text("""
            UPDATE procurement.stock_ledger
            SET unit_cost=:unit_cost, total_cost=ROUND(ABS(quantity) * CAST(:unit_cost AS numeric), 2)
            WHERE id=:stock_ledger_id AND organization_id=:org_id
        """),
            {
                "unit_cost": payload.unit_cost,
                "stock_ledger_id": request_row["stock_ledger_id"],
                "org_id": user["org_id"],
            },
        )
        issued_amount = (
            request_row["issued_quantity"] * payload.unit_cost
        ).quantize(Decimal("0.01"))
        await db.execute(
            text("""
            INSERT INTO finance.cost_transactions (
                organization_id, project_id, source_type, source_id, cost_category,
                description, quantity, unit_cost, amount, transaction_date, posted_by
            ) VALUES (
                :org_id, :project_id, 'site_material_request', :source_id, 'materials',
                :description, :quantity, :unit_cost, :amount, CURRENT_DATE, :user_id
            )
            ON CONFLICT (organization_id, source_type, source_id, cost_category) DO UPDATE
            SET unit_cost=EXCLUDED.unit_cost, amount=EXCLUDED.amount,
                description=EXCLUDED.description, posted_at=NOW()
        """),
            {
                "org_id": user["org_id"],
                "project_id": request_row["project_id"],
                "source_id": request_id,
                "description": f"Site material request {request_row['request_number']} - price confirmed",
                "quantity": request_row["issued_quantity"],
                "unit_cost": payload.unit_cost,
                "amount": issued_amount,
                "user_id": user["user_id"],
            },
        )

    if request_row["purchase_requisition_id"]:
        await db.execute(
            text("""
            UPDATE procurement.requisition_lines
            SET estimated_unit_cost=:unit_cost, is_price_confirmed=true
            WHERE requisition_id=:requisition_id AND item_id=:item_id AND organization_id=:org_id
        """),
            {
                "unit_cost": payload.unit_cost,
                "requisition_id": request_row["purchase_requisition_id"],
                "item_id": request_row["item_id"],
                "org_id": user["org_id"],
            },
        )
        await db.execute(
            text("""
            UPDATE procurement.purchase_requisitions pr
            SET total_estimated = (
                SELECT COALESCE(SUM(quantity * estimated_unit_cost), 0)
                FROM procurement.requisition_lines rl
                WHERE rl.requisition_id=pr.id AND rl.organization_id=pr.organization_id AND rl.is_deleted=false
            ), updated_at=NOW()
            WHERE pr.id=:requisition_id AND pr.organization_id=:org_id
        """),
            {
                "requisition_id": request_row["purchase_requisition_id"],
                "org_id": user["org_id"],
            },
        )

    await db.commit()
    return ok(
        {"id": str(request_id), "unit_cost": str(payload.unit_cost)},
        "Material request price confirmed.",
    )


@router.post("/requisitions", status_code=status.HTTP_201_CREATED)
async def create_requisition(
    payload: RequisitionCreate,
    user: dict = Depends(require_permission("procurement.requisition.create")),
    db: AsyncSession = Depends(get_db),
):
    await project_exists(db, payload.project_id, user["org_id"])
    weekly_budget_id = await ensure_current_weekly_budget(
        db, org_id=user["org_id"], project_id=payload.project_id, site_id=payload.site_id
    )
    total = sum(
        (line.qty * line.unit_cost for line in payload.line_items), Decimal("0")
    )
    available = await inventory_service.budget_available(
        db, org_id=user["org_id"], project_id=payload.project_id
    )
    req_no = await next_number(db, user["org_id"], "purchase_requisition", "PR")
    req_id = (
        await db.execute(
            text("""
        INSERT INTO procurement.purchase_requisitions (
            organization_id, requisition_number, project_id, site_id, cost_code_id,
            requested_by, required_by_date, priority, justification, total_estimated,
            budget_checked, budget_available, weekly_budget_id, created_by
        ) VALUES (
            :org_id, :number, :project_id, :site_id, :cost_code_id,
            :user_id, :required_by_date, :priority, :justification, :total,
            :budget_checked, :available, :weekly_budget_id, :user_id
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
                "budget_checked": available is not None,
                "available": available,
                "weekly_budget_id": weekly_budget_id,
            },
        )
    ).scalar()
    if payload.line_items:
        values_sql = []
        line_params: dict[str, Any] = {"org_id": user["org_id"], "req_id": req_id}
        for idx, line in enumerate(payload.line_items):
            values_sql.append(
                f"(:org_id, :req_id, :item_id_{idx}, :description_{idx}, :quantity_{idx}, "
                f":uom_{idx}, :unit_cost_{idx}, :work_package_{idx}, :notes_{idx})"
            )
            line_params[f"item_id_{idx}"] = line.item_id
            line_params[f"description_{idx}"] = line.description
            line_params[f"quantity_{idx}"] = line.qty
            line_params[f"uom_{idx}"] = line.uom
            line_params[f"unit_cost_{idx}"] = line.unit_cost
            line_params[f"work_package_{idx}"] = line.work_package
            line_params[f"notes_{idx}"] = line.notes
        await db.execute(
            text(f"""
            INSERT INTO procurement.requisition_lines (
                organization_id, requisition_id, item_id, description, quantity,
                unit_of_measure, estimated_unit_cost, work_package, notes
            ) VALUES {", ".join(values_sql)}
        """),  # nosec B608 - values_sql holds only positional bind-parameter placeholders, never user input
            line_params,
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


@router.post("/replenish/generate-drafts")
async def generate_replenishment_drafts(
    payload: ReplenishmentDraftPayload = ReplenishmentDraftPayload(),
    user: dict = Depends(require_permission("procurement.requisition.create")),
    db: AsyncSession = Depends(get_db),
):
    target_project_id = payload.project_id
    target_site_id = None
    store_name = None

    if payload.store_id:
        store_res = await db.execute(
            text("""
            SELECT name, project_id, site_id
            FROM procurement.stores
            WHERE id=:store_id AND organization_id=:org_id AND is_deleted=false
            """),
            {"store_id": payload.store_id, "org_id": user["org_id"]},
        )
        store_row = store_res.mappings().first()
        if store_row:
            store_name = store_row["name"]
            if not target_project_id and store_row["project_id"]:
                target_project_id = store_row["project_id"]
                target_site_id = store_row["site_id"]

    if target_project_id:
        await project_exists(db, target_project_id, user["org_id"])

    weekly_budget_id = None
    if target_project_id:
        try:
            weekly_budget_id = await ensure_current_weekly_budget(
                db, org_id=user["org_id"], project_id=target_project_id, site_id=target_site_id
            )
        except HTTPException:
            weekly_budget_id = None

    items_query = text("""
        WITH balances AS (
            SELECT item_id, COALESCE(SUM(quantity), 0) AS available_qty
            FROM procurement.stock_ledger
            WHERE organization_id = :org_id
              AND (CAST(:store_id AS uuid) IS NULL OR store_id = CAST(:store_id AS uuid))
            GROUP BY item_id
        )
        SELECT i.id, i.item_name, i.item_code, i.unit_of_measure,
               COALESCE(i.reorder_level, 0) AS reorder_level,
               COALESCE(i.reorder_quantity, 0) AS reorder_quantity,
               COALESCE(i.standard_cost, i.unit_price_ex_vat, 0) AS unit_cost,
               COALESCE(b.available_qty, 0) AS available_qty
        FROM procurement.inventory_items i
        LEFT JOIN balances b ON b.item_id = i.id
        WHERE i.organization_id = :org_id
          AND i.is_deleted = false
          AND COALESCE(i.reorder_level, 0) > 0
          AND COALESCE(b.available_qty, 0) <= COALESCE(i.reorder_level, 0)
        ORDER BY (COALESCE(b.available_qty, 0) - COALESCE(i.reorder_level, 0)) ASC, i.item_name ASC
        LIMIT 100
    """)
    res = await db.execute(
        items_query,
        {"org_id": user["org_id"], "store_id": payload.store_id},
    )
    items = [dict(r) for r in res.mappings().all()]

    if payload.item_ids:
        target_ids = {str(uid) for uid in payload.item_ids}
        items = [i for i in items if str(i["id"]) in target_ids]

    if not items:
        return ok(None, "No items are currently below reorder thresholds.")

    req_no = await next_number(db, user["org_id"], "purchase_requisition", "PR")
    req_date = date.today() + timedelta(days=7)
    is_urgent = any(item["available_qty"] <= 0 for item in items)
    priority = "urgent" if is_urgent else "normal"
    justification = f"Automated stock replenishment for {store_name or 'Stores'}: {len(items)} SKU(s) below safety reorder threshold."

    computed_lines = []
    total = Decimal("0")
    for item in items:
        reorder_qty = Decimal(str(item["reorder_quantity"])) if item["reorder_quantity"] else Decimal("0")
        reorder_level = Decimal(str(item["reorder_level"]))
        avail_qty = Decimal(str(item["available_qty"]))
        qty = reorder_qty if reorder_qty > Decimal("0") else max(reorder_level - avail_qty, Decimal("1"))
        unit_cost = Decimal(str(item["unit_cost"] or "0"))
        if unit_cost <= Decimal("0"):
            unit_cost = Decimal("1.00")
        line_total = (qty * unit_cost).quantize(Decimal("0.01"))
        total += line_total
        computed_lines.append({
            "item_id": item["id"],
            "description": item["item_name"],
            "qty": qty,
            "uom": item["unit_of_measure"] or "each",
            "unit_cost": unit_cost,
            "work_package": "Stock Replenishment",
            "notes": f"On-hand: {avail_qty}, Safety point: {reorder_level}",
        })

    available = await inventory_service.budget_available(
        db, org_id=user["org_id"], project_id=target_project_id
    ) if target_project_id else None

    req_id = (
        await db.execute(
            text("""
            INSERT INTO procurement.purchase_requisitions (
                organization_id, requisition_number, project_id, site_id,
                requested_by, required_by_date, priority, justification, total_estimated,
                budget_checked, budget_available, weekly_budget_id, created_by
            ) VALUES (
                :org_id, :number, :project_id, :site_id,
                :user_id, :required_by_date, :priority, :justification, :total,
                :budget_checked, :available, :weekly_budget_id, :user_id
            ) RETURNING id
        """),
            {
                "org_id": user["org_id"],
                "number": req_no,
                "project_id": target_project_id,
                "site_id": target_site_id,
                "user_id": user["user_id"],
                "required_by_date": req_date,
                "priority": priority,
                "justification": justification,
                "total": total,
                "budget_checked": available is not None,
                "available": available,
                "weekly_budget_id": weekly_budget_id,
            },
        )
    ).scalar()

    values_sql = []
    line_params: dict[str, Any] = {"org_id": user["org_id"], "req_id": req_id}
    for idx, line in enumerate(computed_lines):
        values_sql.append(
            f"(:org_id, :req_id, :item_id_{idx}, :description_{idx}, :quantity_{idx}, "
            f":uom_{idx}, :unit_cost_{idx}, :work_package_{idx}, :notes_{idx})"
        )
        line_params[f"item_id_{idx}"] = line["item_id"]
        line_params[f"description_{idx}"] = line["description"]
        line_params[f"quantity_{idx}"] = line["qty"]
        line_params[f"uom_{idx}"] = line["uom"]
        line_params[f"unit_cost_{idx}"] = line["unit_cost"]
        line_params[f"work_package_{idx}"] = line["work_package"]
        line_params[f"notes_{idx}"] = line["notes"]

    await db.execute(
        text(f"""
        INSERT INTO procurement.requisition_lines (
            organization_id, requisition_id, item_id, description, quantity,
            unit_of_measure, estimated_unit_cost, work_package, notes
        ) VALUES {", ".join(values_sql)}
        """),
        line_params,
    )

    await emit_event(
        db,
        user=user,
        event_type="material.requested.v1",
        aggregate_type="purchase_requisition",
        aggregate_id=req_id,
        project_id=target_project_id,
        payload={
            "requisition_number": req_no,
            "total_estimated": float(total),
            "budget_available": float(available) if available is not None else None,
            "source": "reorder_replenishment_automation",
        },
    )
    await db.commit()

    return ok(
        {
            "id": str(req_id),
            "requisition_number": req_no,
            "items_count": len(computed_lines),
            "total_estimated": float(total),
        },
        f"Draft requisition {req_no} created with {len(computed_lines)} replenishment items.",
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
    payload: SubmitRequisitionPayload = SubmitRequisitionPayload(),
    user: dict = Depends(require_permission("procurement.requisition.submit")),
    db: AsyncSession = Depends(get_db),
):
    req = await requisition_or_404(db, req_id, user["org_id"])
    await ensure_current_weekly_budget(
        db, org_id=user["org_id"], project_id=req["project_id"], site_id=req.get("site_id")
    )
    if req["status"] != "draft":
        raise HTTPException(
            status_code=409, detail="Only draft requisitions can be submitted."
        )
    over_budget = (
        req["budget_checked"]
        and Decimal(str(req["total_estimated"]))
        > Decimal(str(req["budget_available"] or 0))
    )
    if over_budget:
        if user.get("role") not in BUDGET_OVERRIDE_ROLES:
            raise HTTPException(
                status_code=409, detail="Requisition exceeds available approved budget."
            )
        if not payload.override_reason:
            raise HTTPException(
                status_code=409,
                detail="Requisition exceeds available approved budget. Provide an override reason to submit anyway.",
            )
        await emit_event(
            db,
            user=user,
            event_type="procurement.requisition.budget_overridden.v1",
            aggregate_type="purchase_requisition",
            aggregate_id=req_id,
            project_id=req["project_id"],
            payload={
                "stage": "submit",
                "override_reason": payload.override_reason,
                "overridden_by_role": user.get("role"),
                "total_estimated": str(req["total_estimated"]),
                "budget_available": str(req["budget_available"] or 0),
            },
        )
        await record_requisition_budget_breach(
            db,
            org_id=user["org_id"],
            project_id=str(req["project_id"]),
            requisition_id=str(req_id),
            requisition_number=req["requisition_number"],
            total_estimated=req["total_estimated"],
            budget_available=req["budget_available"] or 0,
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
    await emit_role_notification(
        db,
        org_id=user["org_id"],
        role_names=["Procurement Manager"],
        title="New requisition awaiting approval",
        message=f"Requisition {req['requisition_number']} has been submitted for approval.",
        action_url="/dashboard/procurement?tab=requisitions",
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
    if payload.decision == "approved" and is_procurement_manager(user):
        raise HTTPException(
            status_code=403,
            detail="Procurement Manager can review or reject incomplete requisitions, but independent approval is required before Procurement acts.",
        )
    over_budget = (
        payload.decision == "approved"
        and req["budget_checked"]
        and Decimal(str(req["total_estimated"]))
        > Decimal(str(req["budget_available"] or 0))
    )
    if over_budget:
        if user.get("role") not in BUDGET_OVERRIDE_ROLES:
            raise HTTPException(
                status_code=409,
                detail="Cannot approve requisition above available approved budget.",
            )
        if not payload.override_reason:
            raise HTTPException(
                status_code=409,
                detail="Requisition exceeds available approved budget. Provide an override reason to approve anyway.",
            )
        await emit_event(
            db,
            user=user,
            event_type="procurement.requisition.budget_overridden.v1",
            aggregate_type="purchase_requisition",
            aggregate_id=req_id,
            project_id=req["project_id"],
            payload={
                "stage": "approve",
                "override_reason": payload.override_reason,
                "overridden_by_role": user.get("role"),
                "total_estimated": str(req["total_estimated"]),
                "budget_available": str(req["budget_available"] or 0),
            },
        )
        await record_requisition_budget_breach(
            db,
            org_id=user["org_id"],
            project_id=str(req["project_id"]),
            requisition_id=str(req_id),
            requisition_number=req["requisition_number"],
            total_estimated=req["total_estimated"],
            budget_available=req["budget_available"] or 0,
        )
    await db.execute(
        text("""
        UPDATE procurement.purchase_requisitions
        SET status=CAST(:decision AS varchar),
            approved_at=CASE WHEN CAST(:decision AS varchar)='approved' THEN NOW() ELSE approved_at END,
            approved_by=CASE WHEN CAST(:decision AS varchar)='approved' THEN CAST(:user_id AS uuid) ELSE approved_by END,
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
    await emit_notification(
        db,
        org_id=user["org_id"],
        user_id=str(req["requested_by"]),
        title=f"Requisition {payload.decision}",
        message=(
            f"Your requisition {req['requisition_number']} has been approved."
            if payload.decision == "approved"
            else f"Your requisition {req['requisition_number']} has been rejected. Reason: {payload.reason or 'Not specified'}."
        ),
        action_url="/dashboard/procurement?tab=requisitions",
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
        LIMIT 501
    """),
        {"org_id": user["org_id"], "status": status_filter, "project_id": project_id},
    )
    data = [dict(r._mapping) for r in capped(rows, 500)]
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
    weekly_budget_id = await ensure_current_weekly_budget(
        db, org_id=user["org_id"], project_id=req["project_id"], site_id=req.get("site_id")
    )
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
            organization_id, rfq_number, requisition_id, project_id, weekly_budget_id, title, description,
            closing_date, status, issued_by, issued_at, created_by
        ) VALUES (
            :org_id, :rfq_number, :requisition_id, :project_id, :weekly_budget_id, :title, :description,
            CAST(:closing_date AS timestamptz), CAST(:status AS varchar),
            CASE WHEN CAST(:status AS varchar)='issued' THEN CAST(:user_id AS uuid) ELSE NULL END,
            CASE WHEN CAST(:status AS varchar)='issued' THEN NOW() ELSE NULL END,
            :user_id
        ) RETURNING id
    """),
            {
                "org_id": user["org_id"],
                "rfq_number": rfq_no,
                "requisition_id": payload.requisition_id,
                "project_id": req["project_id"],
                "weekly_budget_id": weekly_budget_id,
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
        LIMIT 501
    """),
        {"org_id": user["org_id"], "status": status_filter, "supplier_id": supplier_id},
    )
    data = [dict(r._mapping) for r in capped(rows, 500)]
    return ok(data, "Purchase orders listed.", len(data))


@router.get("/purchase-orders/{po_id}/pdf")
async def download_purchase_order_pdf(
    po_id: UUID,
    user: dict = Depends(require_permission("procurement.po.read")),
    db: AsyncSession = Depends(get_db),
):
    """Six Nine branded purchase order PDF (logo, watermark; unissued POs are stamped)."""
    row = (
        await db.execute(
            text("""
            SELECT po.*, p.name AS project_name, pr.requisition_number,
                   to_jsonb(s) - 'bank_account_number' - 'bank_branch_code' AS supplier,
                   creator.full_name AS created_by_name,
                   approver.full_name AS approved_by_name,
                   issuer.full_name AS issued_by_name,
                   COALESCE((
                     SELECT jsonb_agg(to_jsonb(pol) ORDER BY pol.created_at)
                     FROM procurement.purchase_order_lines pol
                     WHERE pol.po_id=po.id AND pol.organization_id=po.organization_id AND pol.is_deleted=false
                   ), '[]'::jsonb) AS lines
            FROM procurement.purchase_orders po
            JOIN procurement.suppliers s ON s.id=po.supplier_id AND s.organization_id=po.organization_id
            LEFT JOIN projects.projects p ON p.id=po.project_id AND p.organization_id=po.organization_id
            LEFT JOIN procurement.purchase_requisitions pr ON pr.id=po.requisition_id AND pr.organization_id=po.organization_id
            LEFT JOIN core.users creator ON creator.id=po.created_by
            LEFT JOIN core.users approver ON approver.id=po.approved_by
            LEFT JOIN core.users issuer ON issuer.id=po.issued_by
            WHERE po.id=:po_id AND po.organization_id=:org_id AND po.is_deleted=false
        """),
            {"po_id": po_id, "org_id": user["org_id"]},
        )
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Purchase order not found.")

    from fastapi.concurrency import run_in_threadpool
    from fastapi.responses import Response
    from app.services.documents.po_renderer import render_purchase_order_pdf

    pdf = await run_in_threadpool(render_purchase_order_pdf, dict(row))
    filename = "".join(c for c in str(row["po_number"] or "purchase-order") if c.isalnum() or c in "-_") or "purchase-order"
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="SNC_Purchase_Order_{filename}.pdf"'},
    )


MATERIALS_LIST_MAX_BYTES = 5 * 1024 * 1024


@router.post("/materials-list/extract-text")
async def extract_materials_list_text(
    file: UploadFile = File(...),
    user: dict = Depends(require_permission("procurement.requisition.create")),
):
    """Text of an uploaded materials list (PDF, TXT or CSV) for the browser to parse.

    Nothing is stored: the user reviews the parsed lines before a purchase
    request is created through the normal requisition endpoint.
    """
    content = await file.read(MATERIALS_LIST_MAX_BYTES + 1)
    if len(content) > MATERIALS_LIST_MAX_BYTES:
        raise HTTPException(status_code=413, detail="The list is larger than 5 MB.")
    name = (file.filename or "").lower()
    if content[:5] == b"%PDF-" or name.endswith(".pdf"):
        import io

        from pypdf import PdfReader
        from pypdf.errors import PdfReadError

        try:
            reader = PdfReader(io.BytesIO(content))
            pages = []
            for page in reader.pages[:20]:
                # Layout mode keeps one line per list row; the default mode can
                # run a whole list together on one line.
                try:
                    pages.append(page.extract_text(extraction_mode="layout") or "")
                except Exception:  # noqa: BLE001 - fall back to plain extraction for odd PDFs
                    pages.append(page.extract_text() or "")
            text_out = "\n".join(pages)
        except (PdfReadError, ValueError) as exc:
            raise HTTPException(status_code=422, detail=f"Could not read that PDF: {exc}") from exc
        if not text_out.strip():
            raise HTTPException(status_code=422, detail="That PDF has no text layer (it may be a scan). Paste the list instead.")
    elif name.endswith((".txt", ".csv")) or not name:
        text_out = content.decode("utf-8", errors="replace")
    else:
        raise HTTPException(status_code=415, detail="Upload a PDF, TXT or CSV file, or paste the list.")
    return ok({"text": text_out, "filename": file.filename}, "Materials list text extracted.")


@router.get("/projects/{project_id}/materials")
async def project_materials_status(
    project_id: UUID,
    user: dict = Depends(require_permission("procurement.requisition.read")),
    db: AsyncSession = Depends(get_db),
):
    """Per material on a project: requested vs ordered vs delivered.

    Request lines and PO lines are matched on their description, normalised
    (lower case, punctuation and spacing ignored) - the same key the web app
    uses - so a PO raised from a request lines up with it.
    """
    await project_exists(db, project_id, user["org_id"])
    rows = await db.execute(
        text("""
        WITH requested AS (
            SELECT trim(regexp_replace(lower(rl.description), '[^a-z0-9]+', ' ', 'g')) AS item_key,
                   max(rl.description) AS description, max(rl.unit_of_measure) AS uom,
                   sum(rl.quantity) AS requested_qty,
                   array_agg(DISTINCT pr.requisition_number) AS requests
            FROM procurement.requisition_lines rl
            JOIN procurement.purchase_requisitions pr ON pr.id = rl.requisition_id AND pr.organization_id = rl.organization_id
            WHERE pr.organization_id = :org_id AND pr.project_id = :project_id
              AND pr.is_deleted = false AND rl.is_deleted = false
              AND pr.status NOT IN ('rejected', 'cancelled')
            GROUP BY 1
        ), ordered AS (
            SELECT trim(regexp_replace(lower(pol.description), '[^a-z0-9]+', ' ', 'g')) AS item_key,
                   max(pol.description) AS description, max(pol.unit_of_measure) AS uom,
                   sum(pol.quantity) AS ordered_qty, sum(pol.quantity_received) AS received_qty,
                   array_agg(DISTINCT po.po_number) AS orders
            FROM procurement.purchase_order_lines pol
            JOIN procurement.purchase_orders po ON po.id = pol.po_id AND po.organization_id = pol.organization_id
            WHERE po.organization_id = :org_id AND po.project_id = :project_id
              AND po.is_deleted = false AND pol.is_deleted = false AND po.status <> 'cancelled'
            GROUP BY 1
        )
        SELECT COALESCE(r.description, o.description) AS description,
               COALESCE(r.uom, o.uom) AS uom,
               COALESCE(r.requested_qty, 0) AS requested_qty,
               COALESCE(o.ordered_qty, 0) AS ordered_qty,
               COALESCE(o.received_qty, 0) AS received_qty,
               COALESCE(r.requests, ARRAY[]::varchar[]) AS requests,
               COALESCE(o.orders, ARRAY[]::varchar[]) AS orders
        FROM requested r
        FULL OUTER JOIN ordered o ON o.item_key = r.item_key
        ORDER BY 1
        LIMIT 1001
    """),
        {"org_id": user["org_id"], "project_id": project_id},
    )
    data = []
    for row in capped(rows, 1000):
        item = dict(row._mapping)
        requested, ordered, received = (Decimal(str(item[k] or 0)) for k in ("requested_qty", "ordered_qty", "received_qty"))
        item["to_order_qty"] = max(requested - ordered, Decimal("0"))
        item["to_deliver_qty"] = max(ordered - received, Decimal("0"))
        data.append(item)
    return ok(data, "Project materials status.", len(data))


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
    await emit_notification(
        db,
        org_id=user["org_id"],
        user_id=str(req["requested_by"]),
        title="Requisition converted to purchase order",
        message=f"Your requisition {req['requisition_number']} is now purchase order {po_no}.",
        action_url="/dashboard/procurement?tab=orders",
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
    await emit_notification(
        db,
        org_id=user["org_id"],
        user_id=str(req["requested_by"]),
        title="Requisition converted to purchase order",
        message=f"Your requisition {req['requisition_number']} is now purchase order {po_no}.",
        action_url="/dashboard/procurement?tab=orders",
    )

    # CCB Rate Interception & Commercial Audit Check
    ccb_outliers = []
    for line in lines:
        desc = str(line.get("description") or "Item")
        unit_price = float(line.get("estimated_unit_cost") or 0)
        eval_res = RateIntelligenceEngine.evaluate_rate(desc, unit_price)
        if eval_res.get("is_outlier"):
            ccb_outliers.append(eval_res.get("recommendation"))

    if ccb_outliers:
        try:
            await db.execute(
                text(
                    """
                    INSERT INTO finance.commercial_guard_audits (
                        organization_id, project_id, requester_id, requester_name, document_type,
                        item_description, input_amount, status, anomaly_reason, evidence_pack
                    ) VALUES (
                        :org_id, :project_id, :requester_id, :requester_name, 'PURCHASE_ORDER',
                        :item, 0, 'FLAGGED', :reason, :evidence
                    )
                    """
                ),
                {
                    "org_id": user["org_id"],
                    "project_id": str(req["project_id"]) if req.get("project_id") else None,
                    "requester_id": user["user_id"],
                    "requester_name": user.get("email", "Buyer"),
                    "item": f"PO {po_no} Rate Outlier",
                    "reason": " | ".join(ccb_outliers),
                    "evidence": json.dumps({"po_id": str(po_id), "outliers": ccb_outliers}),
                },
            )
        except Exception:
            pass

    await db.commit()
    return ok(
        {
            "id": str(po_id),
            "po_number": po_no,
            "ccb_audit": {
                "flagged": len(ccb_outliers) > 0,
                "outliers_count": len(ccb_outliers),
                "warnings": ccb_outliers,
            },
        },
        "Purchase order created." if not ccb_outliers else "Purchase order created with CCB rate outlier warnings.",
    )


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
    if is_procurement_manager(user):
        if po["status"] != "approved":
            raise HTTPException(
                status_code=409,
                detail="Procurement Manager can prepare purchase orders, but independent approval is required before issue.",
            )
        if po["approved_by"] and str(po["approved_by"]) == user["user_id"]:
            raise HTTPException(
                status_code=409,
                detail="Self-approved purchase orders cannot be issued.",
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


@router.post("/purchase-orders/{po_id}/decision")
async def decide_purchase_order(
    po_id: UUID,
    payload: PurchaseOrderDecisionPayload,
    user: dict = Depends(require_permission("procurement.po.approve")),
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
    if po["status"] != "draft":
        raise HTTPException(
            status_code=409,
            detail="Only draft purchase orders can be approved or rejected.",
        )
    if str(po["created_by"]) == user["user_id"]:
        raise HTTPException(status_code=409, detail="Self-approval is not permitted.")
    if payload.decision == "approved" and is_procurement_manager(user):
        raise HTTPException(
            status_code=403,
            detail="Procurement Manager can prepare purchase orders, but approval must be independent.",
        )

    await db.execute(
        text("""
        UPDATE procurement.purchase_orders
        SET status=CAST(:status_value AS varchar),
            approved_by=CASE WHEN CAST(:status_value AS varchar)='approved' THEN CAST(:user_id AS uuid) ELSE approved_by END,
            approved_at=CASE WHEN CAST(:status_value AS varchar)='approved' THEN NOW() ELSE approved_at END,
            notes=CASE
              WHEN CAST(:status_value AS varchar)='rejected' AND :reason IS NOT NULL
              THEN CONCAT(COALESCE(notes, ''), CASE WHEN notes IS NULL OR notes='' THEN '' ELSE E'\n' END, 'Rejection reason: ', :reason)
              ELSE notes
            END,
            updated_at=NOW()
        WHERE id=:id AND organization_id=:org_id
    """),
        {
            "id": po_id,
            "org_id": user["org_id"],
            "status_value": payload.decision,
            "reason": payload.reason,
            "user_id": user["user_id"],
        },
    )
    await emit_event(
        db,
        user=user,
        event_type=(
            "procurement.purchase_order.approved.v1"
            if payload.decision == "approved"
            else "procurement.purchase_order.rejected.v1"
        ),
        aggregate_type="purchase_order",
        aggregate_id=po_id,
        project_id=po["project_id"],
        payload=payload.model_dump(mode="json"),
    )
    await db.commit()
    return ok(
        {"id": str(po_id), "status": payload.decision},
        f"Purchase order {payload.decision}.",
    )


@router.post("/purchase-orders/{po_id}/amend")
async def amend_purchase_order(
    po_id: UUID,
    payload: PurchaseOrderAmendmentPayload,
    user: dict = Depends(require_permission("procurement.po.approve")),
    db: AsyncSession = Depends(get_db),
):
    """
    Authorize a commercial amendment to an issued Purchase Order.
    Increases both the Purchase Order total and the corresponding Finance
    Commitment, reopening exposure to permit valid variation/over-invoice approvals.
    """
    po = (
        (
            await db.execute(
                text(
                    "SELECT * FROM procurement.purchase_orders WHERE id=:id AND organization_id=:org_id AND is_deleted=false FOR UPDATE"
                ),
                {"id": po_id, "org_id": user["org_id"]},
            )
        )
        .mappings()
        .first()
    )
    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    if po["status"] not in {"issued", "partially_received", "received", "invoiced"}:
        raise HTTPException(
            status_code=409,
            detail=f"Only active purchase orders can be amended (current status: '{po['status']}').",
        )
    if is_procurement_manager(user):
        raise HTTPException(
            status_code=403,
            detail="Procurement Manager cannot self-authorize commercial PO amendments; independent approval required.",
        )

    # If linked variation supplied, ensure it exists and is approved
    if payload.variation_id:
        var = (
            await db.execute(
                text(
                    "SELECT * FROM finance.variations WHERE id=:id AND organization_id=:org_id AND is_deleted=false"
                ),
                {"id": payload.variation_id, "org_id": user["org_id"]},
            )
        ).mappings().first()
        if not var:
            raise HTTPException(status_code=404, detail="Linked variation order not found.")
        if var["status"] != "approved":
            raise HTTPException(
                status_code=409,
                detail=f"Linked variation must be approved before amending purchase order (current status: '{var['status']}').",
            )

    # Lock and update finance.commitments
    comm_res = await db.execute(
        text("""
            SELECT id, committed_amount, invoiced_amount,
                   (committed_amount - invoiced_amount) AS open_amount, status
            FROM finance.commitments
            WHERE organization_id=:org_id AND source_type='purchase_order' AND source_id=:po_id
            FOR UPDATE
        """),
        {"org_id": user["org_id"], "po_id": po_id},
    )
    comm = comm_res.mappings().first()
    if not comm:
        raise HTTPException(status_code=404, detail="Purchase order commitment not found in finance.")

    add_amt = Decimal(str(payload.additional_amount))
    cur_committed = Decimal(str(comm["committed_amount"] or 0))
    new_committed = cur_committed + add_amt
    cur_invoiced = Decimal(str(comm["invoiced_amount"] or 0))
    new_open = new_committed - cur_invoiced
    new_status = "fully_invoiced" if cur_invoiced >= new_committed else "partially_invoiced" if cur_invoiced > 0 else "active"

    # Update PO total
    await db.execute(
        text("""
            UPDATE procurement.purchase_orders
            SET total_amount = total_amount + :add_amt,
                subtotal = subtotal + :add_amt,
                notes = CONCAT(COALESCE(notes, ''), CASE WHEN notes IS NULL OR notes='' THEN '' ELSE E'\n' END, 'Commercial Amendment (+', CAST(:add_amt AS varchar), '): ', CAST(:reason AS text)),
                updated_at = NOW()
            WHERE id = :id AND organization_id = :org_id
        """),
        {
            "id": po_id,
            "org_id": user["org_id"],
            "add_amt": add_amt,
            "reason": payload.reason,
        },
    )

    # Update commitment
    await db.execute(
        text("""
            UPDATE finance.commitments
            SET committed_amount = :new_committed,
                status = CAST(:new_status AS varchar),
                updated_at = NOW()
            WHERE id = CAST(:comm_id AS uuid)
        """),
        {
            "comm_id": str(comm["id"]),
            "new_committed": new_committed,
            "new_status": new_status,
        },
    )

    await emit_event(
        db,
        user=user,
        event_type="procurement.purchase_order.amended.v1",
        aggregate_type="purchase_order",
        aggregate_id=po_id,
        project_id=po["project_id"],
        payload={
            "po_number": po["po_number"],
            "additional_amount": str(add_amt),
            "new_committed_amount": str(new_committed),
            "variation_id": str(payload.variation_id) if payload.variation_id else None,
            "reason": payload.reason,
        },
    )
    await db.commit()

    return ok(
        {
            "id": str(po_id),
            "po_number": po["po_number"],
            "previous_committed_amount": float(cur_committed),
            "additional_amount": float(add_amt),
            "new_committed_amount": float(new_committed),
            "invoiced_amount": float(cur_invoiced),
            "new_open_amount": float(new_open),
            "status": new_status,
        },
        f"Purchase order amended successfully with ${add_amt:,.2f} additional commitment.",
    )


@router.get("/suppliers")
async def suppliers(
    user: dict = Depends(require_permission("procurement.supplier.read")),
    db: AsyncSession = Depends(get_db),
):
    rows = await db.execute(
        text(
            "SELECT * FROM procurement.suppliers WHERE organization_id=:org_id AND is_deleted=false ORDER BY supplier_name LIMIT 501"
        ),
        {"org_id": user["org_id"]},
    )
    data = [dict(r._mapping) for r in capped(rows, 500)]
    return ok(data, "Suppliers listed.", len(data))


@router.get("/suppliers/{supplier_id}/catalogue")
async def supplier_catalogue(
    supplier_id: UUID,
    user: dict = Depends(require_permission("procurement.supplier.read")),
    db: AsyncSession = Depends(get_db),
):
    """A supplier's product catalog, derived live from every receipt ever
    tagged with them - no separate catalogue table to keep in sync. Covers
    both the quick manual Receive Stock action and formal PO/GRN receiving,
    since both paths write into procurement.stock_ledger with supplier_id
    set (see inventory_service.receive_stock)."""
    supplier = (
        await db.execute(
            text(
                "SELECT 1 FROM procurement.suppliers WHERE id=:id AND organization_id=:org_id AND is_deleted=false"
            ),
            {"id": supplier_id, "org_id": user["org_id"]},
        )
    ).scalar()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")

    rows = await db.execute(
        text("""
        SELECT i.id AS item_id, i.item_code, i.item_name, i.category, i.unit_of_measure,
               COUNT(*) AS receipt_count,
               SUM(sl.quantity) AS total_quantity_received,
               MAX(sl.movement_at) AS last_received_at,
               (ARRAY_AGG(sl.unit_cost ORDER BY sl.movement_at DESC))[1] AS last_unit_cost
        FROM procurement.stock_ledger sl
        JOIN procurement.inventory_items i ON i.id = sl.item_id AND i.organization_id = sl.organization_id
        WHERE sl.organization_id = :org_id
          AND sl.supplier_id = :supplier_id
          AND sl.movement_type = 'receipt'
        GROUP BY i.id, i.item_code, i.item_name, i.category, i.unit_of_measure
        ORDER BY MAX(sl.movement_at) DESC
    """),
        {"org_id": user["org_id"], "supplier_id": supplier_id},
    )
    data = [dict(r._mapping) for r in rows]
    return ok(data, "Supplier catalogue listed.", len(data))


@router.get("/invoices")
async def invoices(
    match_status: Optional[str] = None,
    user: dict = Depends(require_permission("procurement.invoice.read")),
    db: AsyncSession = Depends(get_db),
):
    rows = await db.execute(
        text("""
        SELECT inv.*, s.supplier_name, po.po_number, po.total_amount AS po_total_amount,
               grn.grn_number, grn.status AS grn_status,
               COALESCE((
                   SELECT SUM(gl.quantity_received * gl.unit_price)
                   FROM procurement.grn_lines gl
                   JOIN procurement.goods_received_notes g ON g.id = gl.grn_id
                   WHERE g.po_id = inv.po_id AND g.organization_id = inv.organization_id AND g.status = 'confirmed' AND gl.is_deleted = false
               ), 0) AS grn_total_amount,
               (inv.total_amount - COALESCE(inv.matched_amount, 0)) AS current_variance
        FROM procurement.supplier_invoices inv
        JOIN procurement.suppliers s ON s.id=inv.supplier_id AND s.organization_id=inv.organization_id
        LEFT JOIN procurement.purchase_orders po ON po.id=inv.po_id AND po.organization_id=inv.organization_id
        LEFT JOIN procurement.goods_received_notes grn ON grn.id=inv.grn_id AND grn.organization_id=inv.organization_id
        WHERE inv.organization_id=:org_id AND inv.is_deleted=false
          AND (CAST(:match_status AS varchar) IS NULL OR inv.match_status=CAST(:match_status AS varchar))
        ORDER BY inv.invoice_date DESC, inv.created_at DESC
        LIMIT 501
    """),
        {"org_id": user["org_id"], "match_status": match_status},
    )
    data = [dict(r._mapping) for r in capped(rows, 500)]
    return ok(data, "Supplier invoices listed.", len(data))


@router.get("/invoices/{invoice_id}/match-inspection")
async def get_invoice_match_inspection(
    invoice_id: UUID,
    user: dict = Depends(require_permission("procurement.invoice.read")),
    db: AsyncSession = Depends(get_db),
):
    """
    Detailed Three-Way Match Inspector Matrix.
    Reconciles PO lines, GRN received/rejected quantities, and invoice lines with variance tolerances.
    """
    inv = (
        await db.execute(
            text("""
            SELECT inv.*, s.supplier_name, s.tax_number, po.po_number, po.total_amount AS po_total,
                   grn.grn_number, grn.status AS grn_status, grn.delivery_note_ref
            FROM procurement.supplier_invoices inv
            JOIN procurement.suppliers s ON s.id = inv.supplier_id AND s.organization_id = inv.organization_id
            LEFT JOIN procurement.purchase_orders po ON po.id = inv.po_id AND po.organization_id = inv.organization_id
            LEFT JOIN procurement.goods_received_notes grn ON grn.id = inv.grn_id AND grn.organization_id = inv.organization_id
            WHERE inv.id = CAST(:id AS uuid) AND inv.organization_id = CAST(:org_id AS uuid) AND inv.is_deleted = false
        """),
            {"id": invoice_id, "org_id": user["org_id"]},
        )
    ).mappings().first()

    if not inv:
        raise HTTPException(status_code=404, detail="Supplier invoice not found")

    po_lines = []
    if inv["po_id"]:
        po_rows = await db.execute(
            text("""
            SELECT pol.id, pol.description, pol.quantity AS po_qty, pol.unit_price AS po_unit_price,
                   pol.line_total AS po_line_total, pol.quantity_received AS po_qty_received, pol.unit_of_measure AS uom
            FROM procurement.purchase_order_lines pol
            WHERE pol.po_id = CAST(:po_id AS uuid) AND pol.organization_id = CAST(:org_id AS uuid) AND pol.is_deleted = false
            ORDER BY pol.created_at ASC
        """),
            {"po_id": inv["po_id"], "org_id": user["org_id"]},
        )
        po_lines = [dict(r._mapping) for r in po_rows]

    grn_lines = []
    if inv["po_id"]:
        grn_rows = await db.execute(
            text("""
            SELECT gl.id, gl.po_line_id, gl.description, gl.quantity_ordered, gl.quantity_received,
                   gl.quantity_rejected, gl.unit_price AS grn_unit_price, gl.rejection_reason,
                   grn.grn_number, grn.created_at AS received_at
            FROM procurement.grn_lines gl
            JOIN procurement.goods_received_notes grn ON grn.id = gl.grn_id
            WHERE grn.po_id = CAST(:po_id AS uuid) AND grn.organization_id = CAST(:org_id AS uuid)
              AND grn.status = 'confirmed' AND gl.is_deleted = false
            ORDER BY grn.created_at ASC
        """),
            {"po_id": inv["po_id"], "org_id": user["org_id"]},
        )
        grn_lines = [dict(r._mapping) for r in grn_rows]

    inv_lines = []
    inv_line_rows = await db.execute(
        text("""
        SELECT sil.id, sil.description, sil.quantity AS inv_qty, sil.unit_cost_ex_vat AS inv_unit_cost,
               sil.line_total AS inv_line_total, sil.vat_rate, sil.vat_amount
        FROM procurement.supplier_invoice_lines sil
        WHERE sil.supplier_invoice_id = CAST(:id AS uuid) AND sil.organization_id = CAST(:org_id AS uuid) AND sil.is_deleted = false
        ORDER BY sil.created_at ASC
    """),
        {"id": invoice_id, "org_id": user["org_id"]},
    )
    inv_lines = [dict(r._mapping) for r in inv_line_rows]

    po_total = Decimal(str(inv["po_total"] or 0))
    inv_total = Decimal(str(inv["total_amount"] or 0))
    matched_amount = Decimal(str(inv["matched_amount"] or 0))
    variance_amount = inv_total - matched_amount

    # Tolerance rule: 0% quantity tolerance, 1% currency rounding tolerance (max $5.00)
    is_within_tolerance = abs(variance_amount) <= Decimal("5.00") and (
        po_total == 0 or (abs(variance_amount) / po_total) <= Decimal("0.01")
    )

    reconciliation = {
        "invoice": dict(inv),
        "po_lines": po_lines,
        "grn_lines": grn_lines,
        "invoice_lines": inv_lines,
        "summary": {
            "po_total": float(po_total),
            "invoice_total": float(inv_total),
            "matched_amount": float(matched_amount),
            "variance_amount": float(variance_amount),
            "is_within_tolerance": bool(is_within_tolerance),
            "tolerance_note": "Within 1% / $5 max variance" if is_within_tolerance else "Exceeds variance tolerance",
            "match_status": inv["match_status"],
            "can_approve_payment": inv["match_status"] == "matched" or (is_within_tolerance and inv["status"] != "disputed"),
        },
    }

    return ok(reconciliation, "Three-way match inspection details retrieved.")


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
    receipt_store_id = payload.store_id
    if receipt_store_id is None and po["project_id"]:
        setup = await ensure_project_operational_setup(
            db, org_id=user["org_id"], project_id=po["project_id"], created_by=user["user_id"]
        )
        receipt_store_id = setup.get("store_id")
    if receipt_store_id:
        store = (
            await db.execute(
                text(
                    """
                    SELECT 1 FROM procurement.stores
                    WHERE id=:id AND organization_id=:org_id AND is_deleted=false
                      AND (CAST(:project_id AS uuid) IS NULL OR project_id=CAST(:project_id AS uuid) OR project_id IS NULL)
                    """
                ),
                {"id": receipt_store_id, "org_id": user["org_id"], "project_id": po["project_id"]},
            )
        ).scalar()
        if not store:
            raise HTTPException(status_code=404, detail="Store not found")
    if receipt_store_id is None:
        raise HTTPException(
            status_code=422,
            detail="Select a store for this goods receipt, or link the purchase order to a project so AEGIS can use the project store.",
        )
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
                "store_id": receipt_store_id,
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
        effective_item_id = line["item_id"]
        if not effective_item_id:
            # Auto-provision a once-off inventory item for this project so the
            # material arrives in the site store and stock ledger without being dropped.
            item_code = f"ONCE-{str(line['id'])[:8].upper()}"
            effective_item_id = (
                await db.execute(
                    text("""
                    INSERT INTO procurement.inventory_items (
                        organization_id, item_code, item_name, description, category,
                        unit_of_measure, standard_cost, item_type, is_once_off_purchase,
                        repurchase_policy, created_by
                    ) VALUES (
                        :org_id, :code, :name, :description, 'Direct Project Material',
                        COALESCE(:uom, 'each'), :cost, 'material', true, 'once_off', :user_id
                    ) ON CONFLICT (organization_id, item_code) WHERE item_code IS NOT NULL AND is_deleted = false DO UPDATE
                    SET updated_at = NOW()
                    RETURNING id
                    """),
                    {
                        "org_id": user["org_id"],
                        "code": item_code,
                        "name": (line["description"] or "Direct Project Item")[:250],
                        "description": line["description"],
                        "uom": line.get("unit_of_measure") or "each",
                        "cost": line["unit_price"],
                        "user_id": user["user_id"],
                    },
                )
            ).scalar()
            await db.execute(
                text("UPDATE procurement.purchase_order_lines SET item_id=:item_id WHERE id=:id"),
                {"item_id": effective_item_id, "id": line["id"]},
            )
            await db.execute(
                text("UPDATE procurement.grn_lines SET item_id=:item_id WHERE id=:id"),
                {"item_id": effective_item_id, "id": grn_line_id},
            )

        if effective_item_id:
            # Goods received into stock is an asset arriving in the store, linked to project
            await inventory_service.receive_stock(
                db,
                user,
                item_id=effective_item_id,
                store_id=receipt_store_id,
                project_id=po["project_id"],
                quantity=remaining,
                unit_cost=line["unit_price"],
                source_type="goods_received_note",
                source_id=grn_line_id,
                reference=grn_no,
                supplier_id=po["supplier_id"],
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
                invoice_date, due_date, subtotal, tax_amount, total_amount, input_vat_claimable, notes, created_by
            ) VALUES (
                :org_id, :invoice_number, :supplier_invoice_ref, :supplier_id, :po_id, :grn_id, :project_id,
                :invoice_date, :due_date, :subtotal, :tax_amount, :total_amount, :input_vat_claimable, :notes, :user_id
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
                    "input_vat_claimable": payload.input_vat_claimable,
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
    # Phase 3A procurement verification: advisory anomaly flags only - never
    # blocks invoice registration itself. See procurement_verification.py.
    await procurement_verification.check_invoice_at_creation(db, org_id=user["org_id"], invoice_id=invoice_id)
    await procurement_verification.check_line_level_match(db, org_id=user["org_id"], invoice_id=invoice_id)
    # Phase 8A VAT engine: real-time input VAT accrual + a non-blocking
    # compliance flag, same advisory/never-blocking shape as the checks
    # above. See vat_engine.py.
    await vat_engine.accrue_input_vat(db, org_id=user["org_id"], invoice_id=invoice_id)
    await vat_engine.check_input_vat_rate_mismatch(db, org_id=user["org_id"], invoice_id=invoice_id)
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
                    "SELECT * FROM procurement.supplier_invoices WHERE id=:id AND organization_id=:org_id AND is_deleted=false FOR UPDATE"
                ),
                {"id": invoice_id, "org_id": user["org_id"]},
            )
        )
        .mappings()
        .first()
    )
    if not inv:
        raise HTTPException(status_code=404, detail="Supplier invoice not found")
    if inv["status"] == "approved":
        if payload.decision == "approved":
            return {"id": str(invoice_id), "status": "approved", "already_approved": True}
        raise HTTPException(
            status_code=409,
            detail="Cannot alter payment decision on an already approved supplier invoice.",
        )
    if payload.decision == "approved" and is_procurement_manager(user):
        raise HTTPException(
            status_code=403,
            detail="Finance controls supplier payment approval; Procurement Manager cannot release payments.",
        )
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
            payment_approved_by=CASE WHEN CAST(:status AS varchar)='approved' THEN CAST(:user_id AS uuid) ELSE payment_approved_by END,
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
        # Concurrency & Over-Invoice Protection: Fetch & lock commitment
        comm_res = await db.execute(
            text("""
                SELECT id, committed_amount, invoiced_amount,
                       (committed_amount - invoiced_amount) AS open_amount, status
                FROM finance.commitments
                WHERE organization_id=:org_id AND source_type='purchase_order' AND source_id=:po_id
                FOR UPDATE
            """),
            {"org_id": user["org_id"], "po_id": inv["po_id"]},
        )
        comm = comm_res.mappings().first()
        if comm:
            open_amount = Decimal(str(comm["open_amount"] or 0))
            inv_total = Decimal(str(inv["total_amount"] or 0))
            if inv_total > open_amount:
                raise HTTPException(
                    status_code=409,
                    detail=(
                        f"Invoice total (${inv_total:,.2f}) exceeds remaining purchase order commitment "
                        f"(${open_amount:,.2f}). An approved variation order or purchase order amendment "
                        "is required to authorize excess expenditure."
                    ),
                )
            await db.execute(
                text("""
                UPDATE finance.commitments
                SET invoiced_amount = invoiced_amount + :amount,
                    status = CASE
                        WHEN (invoiced_amount + :amount) >= committed_amount THEN 'fully_invoiced'
                        ELSE 'partially_invoiced'
                    END,
                    updated_at=NOW()
                WHERE id = CAST(:comm_id AS uuid)
            """),
                {
                    "comm_id": str(comm["id"]),
                    "amount": inv_total,
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
    gl_proposal_warning = None
    if status_value == "approved":
        # Phase 3A: advisory bank-change/supplier-status flag, then the GL
        # bridge proposal (Debit Accrued Project Costs / Credit Accounts
        # Payable). Neither ever blocks the payment decision itself.
        await procurement_verification.check_supplier_bank_changed(db, org_id=user["org_id"], invoice_id=invoice_id)
        try:
            await gl_bridge.propose_journal_for_supplier_invoice_approval(db, org_id=user["org_id"], user_id=user["user_id"], invoice_id=invoice_id)
        except GeneralLedgerError as exc:
            gl_proposal_warning = str(exc)
    await db.commit()
    response = {"id": str(invoice_id), "status": status_value}
    if gl_proposal_warning:
        response["gl_proposal_warning"] = gl_proposal_warning
    return ok(
        response,
        f"Invoice payment {status_value}.",
    )
