"""Approved daily site report workflow for the first AEGIS operational slice."""

from datetime import date
from decimal import Decimal
import json
from typing import Any, Literal, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.security import get_current_user, require_permission
from app.shared.events import emit_notification
from app.shared.sequences import next_reference
from app.shared.sql import (
    safe_payload_columns,
    tenant_child_rows_by_parent_sql,
    tenant_reference_sql,
    update_tenant_row_sql,
)

router = APIRouter()


class Payload(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class SitePayload(Payload):
    project_id: UUID
    site_code: Optional[str] = Field(default=None, max_length=80)
    name: str = Field(min_length=1, max_length=255)
    location_label: Optional[str] = Field(default=None, max_length=255)
    status: Literal["planned", "active", "suspended", "closed"] = "active"


class DailyReportCreate(Payload):
    project_id: UUID
    site_id: Optional[UUID] = None
    report_date: date
    shift: Literal["day", "night", "double"] = "day"
    weather: dict[str, Any] = Field(default_factory=dict)
    planned_work: Optional[str] = None
    actual_work: Optional[str] = None
    delays: Optional[str] = None
    safety_notes: Optional[str] = None
    cost_exposure: Decimal = Field(
        default=Decimal("0"), ge=0, max_digits=15, decimal_places=2
    )


class DailyReportUpdate(Payload):
    site_id: Optional[UUID] = None
    weather: Optional[dict[str, Any]] = None
    planned_work: Optional[str] = None
    actual_work: Optional[str] = None
    delays: Optional[str] = None
    safety_notes: Optional[str] = None
    cost_exposure: Optional[Decimal] = Field(
        default=None, ge=0, max_digits=15, decimal_places=2
    )


class LabourLine(Payload):
    employee_id: UUID
    role_on_site: Optional[str] = Field(default=None, max_length=120)
    regular_hours: Decimal = Field(
        default=Decimal("0"), ge=0, le=24, max_digits=5, decimal_places=2
    )
    overtime_hours: Decimal = Field(
        default=Decimal("0"), ge=0, le=24, max_digits=5, decimal_places=2
    )
    cost_rate: Decimal = Field(
        default=Decimal("0"), ge=0, max_digits=15, decimal_places=2
    )
    notes: Optional[str] = None

    @model_validator(mode="after")
    def requires_hours(self):
        if self.regular_hours + self.overtime_hours <= 0:
            raise ValueError("labour line requires worked hours")
        return self


class EquipmentLine(Payload):
    fleet_id: UUID
    operator_employee_id: Optional[UUID] = None
    operating_hours: Decimal = Field(
        default=Decimal("0"), ge=0, le=24, max_digits=10, decimal_places=2
    )
    idle_hours: Decimal = Field(
        default=Decimal("0"), ge=0, le=24, max_digits=10, decimal_places=2
    )
    fuel_litres: Decimal = Field(
        default=Decimal("0"), ge=0, max_digits=14, decimal_places=3
    )
    cost_rate: Decimal = Field(
        default=Decimal("0"), ge=0, max_digits=15, decimal_places=2
    )
    notes: Optional[str] = None

    @model_validator(mode="after")
    def valid_usage(self):
        if self.idle_hours > self.operating_hours:
            raise ValueError("idle_hours cannot exceed operating_hours")
        if self.operating_hours <= 0 and self.fuel_litres <= 0:
            raise ValueError("equipment line requires operating hours or fuel")
        return self


class MaterialLine(Payload):
    item_id: UUID
    store_id: Optional[UUID] = None
    quantity_used: Decimal = Field(gt=0, max_digits=14, decimal_places=3)
    unit_cost: Decimal = Field(
        default=Decimal("0"), ge=0, max_digits=15, decimal_places=4
    )
    wastage_quantity: Decimal = Field(
        default=Decimal("0"), ge=0, max_digits=14, decimal_places=3
    )
    work_package: Optional[str] = Field(default=None, max_length=160)
    notes: Optional[str] = None


class SiteMaterialRequest(Payload):
    project_id: UUID
    site_id: Optional[UUID] = None
    store_id: Optional[UUID] = None
    item_id: UUID
    quantity: Decimal = Field(gt=0, max_digits=14, decimal_places=3)
    unit_cost: Decimal = Field(
        default=Decimal("0"), ge=0, max_digits=15, decimal_places=4
    )
    required_by_date: date
    priority: Literal["low", "normal", "urgent", "emergency"] = "normal"
    work_package: Optional[str] = Field(default=None, max_length=160)
    justification: Optional[str] = None
    auto_submit_requisition: bool = True


class DocumentLinkPayload(Payload):
    document_id: UUID
    link_role: str = Field(default="evidence", min_length=1, max_length=80)


class DecisionPayload(Payload):
    decision: Literal["approved", "rejected"]
    reason: Optional[str] = Field(default=None, max_length=2000)


def result(data, message: str, total: Optional[int] = None):
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
    event_data: dict[str, Any],
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
            "idempotency_key": f"{event_type}:{aggregate_id}",
            "payload": json.dumps(event_data, default=str),
        },
    )


async def project_or_404(db: AsyncSession, project_id: UUID, org_id: str) -> None:
    found = await db.execute(
        text("""
        SELECT 1 FROM projects.projects
        WHERE id=:project_id AND organization_id=:org_id AND is_deleted=false
    """),
        {"project_id": project_id, "org_id": org_id},
    )
    if not found.scalar():
        raise HTTPException(status_code=404, detail="Project not found")


async def site_or_404(
    db: AsyncSession, site_id: Optional[UUID], project_id: UUID, org_id: str
) -> None:
    if site_id is None:
        return
    found = await db.execute(
        text("""
        SELECT 1 FROM projects.sites
        WHERE id=:site_id AND project_id=:project_id AND organization_id=:org_id AND is_deleted=false
    """),
        {"site_id": site_id, "project_id": project_id, "org_id": org_id},
    )
    if not found.scalar():
        raise HTTPException(status_code=404, detail="Site not found")


async def report_or_404(
    db: AsyncSession, report_id: UUID, org_id: str
) -> dict[str, Any]:
    row = (
        (
            await db.execute(
                text("""
        SELECT * FROM projects.daily_site_reports
        WHERE id=:report_id AND organization_id=:org_id AND is_deleted=false
    """),
                {"report_id": report_id, "org_id": org_id},
            )
        )
        .mappings()
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Daily site report not found")
    return dict(row)


def ensure_editable(report: dict[str, Any]) -> None:
    if report["status"] not in {"draft", "rejected"}:
        raise HTTPException(
            status_code=409, detail="Only draft or rejected reports can be edited."
        )


async def tenant_reference(
    db: AsyncSession, table: str, record_id: Optional[UUID], org_id: str, label: str
) -> None:
    if record_id is None:
        return
    allowed = {
        "hr.employees",
        "fleet.fleet",
        "procurement.inventory_items",
        "procurement.stores",
        "core.documents",
    }
    if table not in allowed:
        raise HTTPException(status_code=500, detail="Unsupported reference validation")
    found = await db.execute(
        tenant_reference_sql(table, allowed),
        {"id": record_id, "org_id": org_id},
    )
    if not found.scalar():
        raise HTTPException(status_code=404, detail=f"{label} not found")


async def inventory_item(
    db: AsyncSession, item_id: UUID, org_id: str
) -> dict[str, Any]:
    row = (
        (
            await db.execute(
                text("""
        SELECT id, item_name, item_code, unit_of_measure, standard_cost
        FROM procurement.inventory_items
        WHERE id=:item_id AND organization_id=:org_id AND is_deleted=false
    """),
                {"item_id": item_id, "org_id": org_id},
            )
        )
        .mappings()
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Inventory item not found")
    return dict(row)


async def store_or_404(
    db: AsyncSession, store_id: Optional[UUID], project_id: UUID, org_id: str
) -> None:
    if store_id is None:
        return
    row = await db.execute(
        text("""
        SELECT 1 FROM procurement.stores
        WHERE id=:store_id AND organization_id=:org_id AND is_deleted=false
          AND (project_id IS NULL OR project_id=:project_id)
    """),
        {"store_id": store_id, "project_id": project_id, "org_id": org_id},
    )
    if not row.scalar():
        raise HTTPException(status_code=404, detail="Store not found for this project")


async def available_stock(
    db: AsyncSession, *, org_id: str, item_id: UUID, store_id: Optional[UUID]
) -> Decimal:
    row = (
        (
            await db.execute(
                text("""
        SELECT COALESCE(SUM(quantity), 0) AS available_qty
        FROM procurement.stock_ledger
        WHERE organization_id=:org_id
          AND item_id=:item_id
          AND (CAST(:store_id AS uuid) IS NULL OR store_id=CAST(:store_id AS uuid))
    """),
                {"org_id": org_id, "item_id": item_id, "store_id": store_id},
            )
        )
        .mappings()
        .one()
    )
    return Decimal(str(row["available_qty"] or 0))


async def budget_available(db: AsyncSession, org_id: str, project_id: UUID) -> Decimal:
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


@router.get("/sites")
async def list_sites(
    project_id: Optional[UUID] = None,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rows = await db.execute(
        text("""
        SELECT s.*, p.name AS project_name
        FROM projects.sites s
        JOIN projects.projects p ON p.id=s.project_id AND p.organization_id=s.organization_id
        WHERE s.organization_id=:org_id AND s.is_deleted=false
          AND (CAST(:project_id AS uuid) IS NULL OR s.project_id=CAST(:project_id AS uuid))
        ORDER BY s.name
    """),
        {"org_id": user["org_id"], "project_id": project_id},
    )
    data = [dict(row._mapping) for row in rows]
    return result(data, "Sites listed.", len(data))


@router.post("/sites", status_code=status.HTTP_201_CREATED)
async def create_site(
    payload: SitePayload,
    user: dict = Depends(require_permission("site_operations.daily_report.create")),
    db: AsyncSession = Depends(get_db),
):
    await project_or_404(db, payload.project_id, user["org_id"])
    try:
        site_id = (
            await db.execute(
                text("""
            INSERT INTO projects.sites (organization_id, project_id, site_code, name, location_label, status, created_by)
            VALUES (:org_id, :project_id, :site_code, :name, :location_label, :status, :user_id)
            RETURNING id
        """),
                {
                    **payload.model_dump(),
                    "org_id": user["org_id"],
                    "user_id": user["user_id"],
                },
            )
        ).scalar()
        await emit_event(
            db,
            user=user,
            event_type="site.created.v1",
            aggregate_type="site",
            aggregate_id=site_id,
            project_id=payload.project_id,
            event_data=payload.model_dump(mode="json"),
        )
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=409, detail="Site code already exists for this project."
        ) from exc
    return result({"id": str(site_id)}, "Site created.")


@router.get("/inventory-items")
async def list_inventory_items(
    user: dict = Depends(require_permission("site_operations.material.record")),
    db: AsyncSession = Depends(get_db),
):
    rows = await db.execute(
        text("""
        SELECT i.id, i.item_name, i.stock_quantity, i.created_at, i.updated_at
        FROM procurement.inventory_items i
        WHERE i.organization_id=:org_id AND i.is_deleted=false
        ORDER BY i.item_name NULLS LAST, i.created_at DESC
        LIMIT 500
    """),
        {"org_id": user["org_id"]},
    )
    data = [dict(row._mapping) for row in rows]
    return result(data, "Inventory items listed.", len(data))


@router.get("/stores")
async def list_stores(
    project_id: Optional[UUID] = None,
    user: dict = Depends(require_permission("site_operations.material.record")),
    db: AsyncSession = Depends(get_db),
):
    rows = await db.execute(
        text("""
        SELECT st.*, p.name AS project_name, s.name AS site_name
        FROM procurement.stores st
        LEFT JOIN projects.projects p ON p.id=st.project_id AND p.organization_id=st.organization_id
        LEFT JOIN projects.sites s ON s.id=st.site_id AND s.organization_id=st.organization_id
        WHERE st.organization_id=:org_id AND st.is_deleted=false
          AND (CAST(:project_id AS uuid) IS NULL OR st.project_id=CAST(:project_id AS uuid))
        ORDER BY st.store_type, st.name
        LIMIT 500
    """),
        {"org_id": user["org_id"], "project_id": project_id},
    )
    data = [dict(row._mapping) for row in rows]
    return result(data, "Stores listed.", len(data))


@router.post("/material-requests", status_code=status.HTTP_201_CREATED)
async def request_site_material(
    payload: SiteMaterialRequest,
    user: dict = Depends(require_permission("site_operations.material.request")),
    db: AsyncSession = Depends(get_db),
):
    await project_or_404(db, payload.project_id, user["org_id"])
    await site_or_404(db, payload.site_id, payload.project_id, user["org_id"])
    await store_or_404(db, payload.store_id, payload.project_id, user["org_id"])
    item = await inventory_item(db, payload.item_id, user["org_id"])

    available = await available_stock(
        db, org_id=user["org_id"], item_id=payload.item_id, store_id=payload.store_id
    )
    issue_qty = min(payload.quantity, max(available, Decimal("0")))
    shortfall_qty = payload.quantity - issue_qty
    effective_unit_cost = payload.unit_cost or Decimal(
        str(item.get("standard_cost") or 0)
    )
    total_estimated = (payload.quantity * effective_unit_cost).quantize(Decimal("0.01"))
    status_value = (
        "fulfilled_from_stock"
        if shortfall_qty == 0
        else "partially_issued_requisitioned"
        if issue_qty > 0
        else "requisitioned"
    )
    request_number = await next_reference(db, user["org_id"], "material_request")
    material_request_id = (
        await db.execute(
            text("""
        INSERT INTO procurement.material_requests (
            organization_id, request_number, project_id, site_id, store_id, item_id,
            requested_by, requested_quantity, issued_quantity, shortfall_quantity,
            unit_cost, total_estimated, required_by_date, priority, status,
            work_package, justification, created_by
        ) VALUES (
            :org_id, :request_number, :project_id, :site_id, :store_id, :item_id,
            :user_id, :requested_quantity, :issued_quantity, :shortfall_quantity,
            :unit_cost, :total_estimated, :required_by_date, :priority, :status,
            :work_package, :justification, :user_id
        ) RETURNING id
    """),
            {
                "org_id": user["org_id"],
                "request_number": request_number,
                "project_id": payload.project_id,
                "site_id": payload.site_id,
                "store_id": payload.store_id,
                "item_id": payload.item_id,
                "user_id": user["user_id"],
                "requested_quantity": payload.quantity,
                "issued_quantity": issue_qty,
                "shortfall_quantity": shortfall_qty,
                "unit_cost": effective_unit_cost,
                "total_estimated": total_estimated,
                "required_by_date": payload.required_by_date,
                "priority": payload.priority,
                "status": status_value,
                "work_package": payload.work_package,
                "justification": payload.justification,
            },
        )
    ).scalar()

    stock_ledger_id: Optional[UUID] = None
    if issue_qty > 0:
        stock_ledger_id = (
            await db.execute(
                text("""
            INSERT INTO procurement.stock_ledger (
                organization_id, item_id, store_id, project_id, movement_type, quantity,
                unit_cost, total_cost, source_type, source_id, reference, recorded_by
            ) VALUES (
                :org_id, :item_id, :store_id, :project_id, 'issue', (:quantity * -1),
                :unit_cost, ROUND(CAST(:quantity AS numeric) * CAST(:unit_cost AS numeric), 2),
                'site_material_request', :request_id, :reference, :user_id
            ) ON CONFLICT (organization_id, source_type, source_id, item_id, movement_type) DO UPDATE
              SET quantity=EXCLUDED.quantity, unit_cost=EXCLUDED.unit_cost, total_cost=EXCLUDED.total_cost, recorded_by=EXCLUDED.recorded_by
            RETURNING id
        """),
                {
                    "org_id": user["org_id"],
                    "item_id": payload.item_id,
                    "store_id": payload.store_id,
                    "project_id": payload.project_id,
                    "quantity": issue_qty,
                    "unit_cost": effective_unit_cost,
                    "request_id": material_request_id,
                    "reference": request_number,
                    "user_id": user["user_id"],
                },
            )
        ).scalar()
        await db.execute(
            text("""
            INSERT INTO finance.cost_transactions (
                organization_id, project_id, source_type, source_id, cost_category,
                description, quantity, unit_cost, amount, transaction_date, posted_by
            ) VALUES (
                :org_id, :project_id, 'site_material_request', :request_id, 'materials',
                :description, :quantity, :unit_cost, ROUND(CAST(:quantity AS numeric) * CAST(:unit_cost AS numeric), 2),
                CURRENT_DATE, :user_id
            ) ON CONFLICT (organization_id, source_type, source_id, cost_category) DO NOTHING
        """),
            {
                "org_id": user["org_id"],
                "project_id": payload.project_id,
                "request_id": material_request_id,
                "description": f"Site material request {request_number} issued from stock",
                "quantity": issue_qty,
                "unit_cost": effective_unit_cost,
                "user_id": user["user_id"],
            },
        )
        await emit_event(
            db,
            user=user,
            event_type="inventory.material_issued.v1",
            aggregate_type="material_request",
            aggregate_id=material_request_id,
            project_id=payload.project_id,
            event_data={
                "item_id": str(payload.item_id),
                "quantity": str(issue_qty),
                "stock_ledger_id": str(stock_ledger_id),
            },
        )
        await emit_event(
            db,
            user=user,
            event_type="finance.actual_cost_created.v1",
            aggregate_type="material_request",
            aggregate_id=material_request_id,
            project_id=payload.project_id,
            event_data={
                "quantity": str(issue_qty),
                "unit_cost": str(effective_unit_cost),
            },
        )

    requisition_id: Optional[UUID] = None
    requisition_number: Optional[str] = None
    if shortfall_qty > 0:
        available_budget = await budget_available(
            db, user["org_id"], payload.project_id
        )
        requisition_total = (shortfall_qty * effective_unit_cost).quantize(
            Decimal("0.01")
        )
        should_submit = payload.auto_submit_requisition and (
            requisition_total <= available_budget or user.get("role") == "SUPERADMIN"
        )
        requisition_number = await next_reference(
            db, user["org_id"], "purchase_requisition"
        )
        requisition_id = (
            await db.execute(
                text("""
            INSERT INTO procurement.purchase_requisitions (
                organization_id, requisition_number, project_id, site_id,
                requested_by, required_by_date, priority, justification, total_estimated,
                status, submitted_at, submitted_by, budget_checked, budget_available, created_by
            ) VALUES (
                :org_id, :requisition_number, :project_id, :site_id,
                :user_id, :required_by_date, :priority, :justification, :total_estimated,
                CAST(:status AS varchar),
                CASE WHEN CAST(:status AS varchar)='submitted' THEN NOW() ELSE NULL END,
                CASE WHEN CAST(:status AS varchar)='submitted' THEN :user_id ELSE NULL END,
                true, :budget_available, :user_id
            ) RETURNING id
        """),
                {
                    "org_id": user["org_id"],
                    "requisition_number": requisition_number,
                    "project_id": payload.project_id,
                    "site_id": payload.site_id,
                    "user_id": user["user_id"],
                    "required_by_date": payload.required_by_date,
                    "priority": payload.priority,
                    "justification": payload.justification
                    or f"Shortfall from site material request {request_number}",
                    "total_estimated": requisition_total,
                    "status": "submitted" if should_submit else "draft",
                    "budget_available": available_budget,
                },
            )
        ).scalar()
        await db.execute(
            text("""
            INSERT INTO procurement.requisition_lines (
                organization_id, requisition_id, item_id, description, quantity,
                unit_of_measure, estimated_unit_cost, work_package, notes
            ) VALUES (
                :org_id, :requisition_id, :item_id, :description, :quantity,
                :uom, :unit_cost, :work_package, :notes
            )
        """),
            {
                "org_id": user["org_id"],
                "requisition_id": requisition_id,
                "item_id": payload.item_id,
                "description": item.get("item_name")
                or item.get("item_code")
                or "Site material shortfall",
                "quantity": shortfall_qty,
                "uom": item.get("unit_of_measure") or "each",
                "unit_cost": effective_unit_cost,
                "work_package": payload.work_package,
                "notes": f"Generated from material request {request_number}",
            },
        )
        await db.execute(
            text("""
            UPDATE procurement.material_requests
            SET purchase_requisition_id=:requisition_id, updated_at=NOW()
            WHERE id=:request_id AND organization_id=:org_id
        """),
            {
                "org_id": user["org_id"],
                "request_id": material_request_id,
                "requisition_id": requisition_id,
            },
        )
        await emit_event(
            db,
            user=user,
            event_type="material.requested.v1",
            aggregate_type="purchase_requisition",
            aggregate_id=requisition_id,
            project_id=payload.project_id,
            event_data={
                "material_request_id": str(material_request_id),
                "requisition_number": requisition_number,
                "shortfall_quantity": str(shortfall_qty),
                "budget_available": str(available_budget),
            },
        )
        if should_submit:
            await emit_event(
                db,
                user=user,
                event_type="procurement.requisition.submitted.v1",
                aggregate_type="purchase_requisition",
                aggregate_id=requisition_id,
                project_id=payload.project_id,
                event_data={
                    "material_request_id": str(material_request_id),
                    "status": "submitted",
                },
            )

    if stock_ledger_id:
        await db.execute(
            text("""
            UPDATE procurement.material_requests
            SET stock_ledger_id=:stock_ledger_id, updated_at=NOW()
            WHERE id=:request_id AND organization_id=:org_id
        """),
            {
                "org_id": user["org_id"],
                "request_id": material_request_id,
                "stock_ledger_id": stock_ledger_id,
            },
        )

    await emit_event(
        db,
        user=user,
        event_type="site.material.requested.v1",
        aggregate_type="material_request",
        aggregate_id=material_request_id,
        project_id=payload.project_id,
        event_data={
            "request_number": request_number,
            "requested_quantity": str(payload.quantity),
            "available_quantity": str(available),
            "issued_quantity": str(issue_qty),
            "shortfall_quantity": str(shortfall_qty),
            "purchase_requisition_id": str(requisition_id) if requisition_id else None,
        },
    )
    await db.commit()
    return result(
        {
            "id": str(material_request_id),
            "request_number": request_number,
            "status": status_value,
            "available_quantity": str(available),
            "issued_quantity": str(issue_qty),
            "shortfall_quantity": str(shortfall_qty),
            "stock_ledger_id": str(stock_ledger_id) if stock_ledger_id else None,
            "purchase_requisition_id": str(requisition_id) if requisition_id else None,
            "purchase_requisition_number": requisition_number,
        },
        "Site material request processed.",
    )


@router.get("/daily-reports")
async def list_daily_reports(
    project_id: Optional[UUID] = None,
    status_filter: Optional[str] = Query(default=None, alias="status"),
    user: dict = Depends(require_permission("site_operations.daily_report.read")),
    db: AsyncSession = Depends(get_db),
):
    rows = await db.execute(
        text("""
        SELECT r.*, p.name AS project_name, s.name AS site_name,
               COUNT(l.id) FILTER (WHERE l.is_deleted=false) AS labour_lines,
               COUNT(e.id) FILTER (WHERE e.is_deleted=false) AS equipment_lines,
               COUNT(m.id) FILTER (WHERE m.is_deleted=false) AS material_lines
        FROM projects.daily_site_reports r
        JOIN projects.projects p ON p.id=r.project_id AND p.organization_id=r.organization_id
        LEFT JOIN projects.sites s ON s.id=r.site_id AND s.organization_id=r.organization_id
        LEFT JOIN projects.daily_report_labour l ON l.report_id=r.id AND l.organization_id=r.organization_id
        LEFT JOIN projects.daily_report_equipment e ON e.report_id=r.id AND e.organization_id=r.organization_id
        LEFT JOIN projects.daily_report_materials m ON m.report_id=r.id AND m.organization_id=r.organization_id
        WHERE r.organization_id=:org_id AND r.is_deleted=false
          AND (CAST(:project_id AS uuid) IS NULL OR r.project_id=CAST(:project_id AS uuid))
          AND (CAST(:status_filter AS varchar) IS NULL OR r.status=CAST(:status_filter AS varchar))
        GROUP BY r.id, p.name, s.name
        ORDER BY r.report_date DESC, r.created_at DESC
        LIMIT 250
    """),
        {
            "org_id": user["org_id"],
            "project_id": project_id,
            "status_filter": status_filter,
        },
    )
    data = [dict(row._mapping) for row in rows]
    return result(data, "Daily site reports listed.", len(data))


@router.post("/daily-reports", status_code=status.HTTP_201_CREATED)
async def create_daily_report(
    payload: DailyReportCreate,
    user: dict = Depends(require_permission("site_operations.daily_report.create")),
    db: AsyncSession = Depends(get_db),
):
    await project_or_404(db, payload.project_id, user["org_id"])
    await site_or_404(db, payload.site_id, payload.project_id, user["org_id"])
    values = payload.model_dump(exclude={"weather"})
    try:
        report_id = (
            await db.execute(
                text("""
            INSERT INTO projects.daily_site_reports (
                organization_id, project_id, site_id, report_date, shift, weather, planned_work,
                actual_work, delays, safety_notes, cost_exposure, created_by
            ) VALUES (
                :org_id, :project_id, :site_id, :report_date, :shift, CAST(:weather AS jsonb),
                :planned_work, :actual_work, :delays, :safety_notes, :cost_exposure, :user_id
            ) RETURNING id
        """),
                {
                    **values,
                    "weather": json.dumps(payload.weather),
                    "org_id": user["org_id"],
                    "user_id": user["user_id"],
                },
            )
        ).scalar()
        await emit_event(
            db,
            user=user,
            event_type="site.daily_report.created.v1",
            aggregate_type="daily_site_report",
            aggregate_id=report_id,
            project_id=payload.project_id,
            event_data=payload.model_dump(mode="json"),
        )
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Daily report already exists for this project, date and shift.",
        ) from exc
    return result({"id": str(report_id)}, "Daily site report created.")


@router.get("/daily-reports/{report_id}")
async def get_daily_report(
    report_id: UUID,
    user: dict = Depends(require_permission("site_operations.daily_report.read")),
    db: AsyncSession = Depends(get_db),
):
    report = await report_or_404(db, report_id, user["org_id"])
    tables = {
        "labour": ("projects.daily_report_labour", "created_at"),
        "equipment": ("projects.daily_report_equipment", "created_at"),
        "materials": ("projects.daily_report_materials", "created_at"),
    }
    detail: dict[str, Any] = {"report": report}
    for key, (table, order_column) in tables.items():
        rows = await db.execute(
            tenant_child_rows_by_parent_sql(
                table,
                "report_id",
                order_column,
                {table for table, _ in tables.values()},
                {"report_id"},
                {order_column for _, order_column in tables.values()},
            ),
            {"parent_id": report_id, "org_id": user["org_id"]},
        )
        detail[key] = [dict(row._mapping) for row in rows]
    docs = await db.execute(
        text("""
        SELECT dl.*, d.title
        FROM core.document_links dl
        JOIN core.documents d ON d.id=dl.document_id AND d.organization_id=dl.organization_id
        WHERE dl.organization_id=:org_id AND dl.entity_type='daily_site_report'
          AND dl.entity_id=:report_id AND dl.is_deleted=false
        ORDER BY dl.linked_at DESC
    """),
        {"report_id": report_id, "org_id": user["org_id"]},
    )
    detail["documents"] = [dict(row._mapping) for row in docs]
    approvals = await db.execute(
        text("""
        SELECT * FROM core.approval_instances
        WHERE organization_id=:org_id AND target_type='daily_site_report' AND target_id=:report_id AND is_deleted=false
        ORDER BY created_at DESC
    """),
        {"report_id": report_id, "org_id": user["org_id"]},
    )
    detail["approvals"] = [dict(row._mapping) for row in approvals]
    return result(detail, "Daily site report retrieved.")


@router.patch("/daily-reports/{report_id}")
async def update_daily_report(
    report_id: UUID,
    payload: DailyReportUpdate,
    user: dict = Depends(require_permission("site_operations.daily_report.update")),
    db: AsyncSession = Depends(get_db),
):
    report = await report_or_404(db, report_id, user["org_id"])
    ensure_editable(report)
    values = payload.model_dump(exclude_unset=True)
    if payload.site_id is not None:
        await site_or_404(db, payload.site_id, report["project_id"], user["org_id"])
    if not values:
        return result({"id": str(report_id)}, "No fields to update.")
    if "weather" in values:
        values["weather"] = json.dumps(values["weather"])
    safe_keys = safe_payload_columns(values.keys())
    await db.execute(
        update_tenant_row_sql(
            "projects.daily_site_reports",
            safe_keys,
            DailyReportUpdate.model_fields,
            id_param="report_id",
            require_not_deleted=False,
            casts={"weather": "jsonb"},
        ),
        {
            **{key: values[key] for key in safe_keys},
            "report_id": report_id,
            "org_id": user["org_id"],
        },
    )
    await emit_event(
        db,
        user=user,
        event_type="site.daily_report.updated.v1",
        aggregate_type="daily_site_report",
        aggregate_id=report_id,
        project_id=report["project_id"],
        event_data={"fields": sorted(values)},
    )
    await db.commit()
    return result({"id": str(report_id)}, "Daily site report updated.")


@router.post("/daily-reports/{report_id}/labour", status_code=status.HTTP_201_CREATED)
async def add_labour(
    report_id: UUID,
    payload: LabourLine,
    user: dict = Depends(require_permission("site_operations.labour.record")),
    db: AsyncSession = Depends(get_db),
):
    report = await report_or_404(db, report_id, user["org_id"])
    ensure_editable(report)
    await tenant_reference(
        db, "hr.employees", payload.employee_id, user["org_id"], "Employee"
    )
    line_id = (
        await db.execute(
            text("""
        INSERT INTO projects.daily_report_labour (
            organization_id, report_id, employee_id, role_on_site, regular_hours,
            overtime_hours, cost_rate, notes, created_by
        ) VALUES (
            :org_id, :report_id, :employee_id, :role_on_site, :regular_hours,
            :overtime_hours, :cost_rate, :notes, :user_id
        ) RETURNING id
    """),
            {
                **payload.model_dump(),
                "org_id": user["org_id"],
                "report_id": report_id,
                "user_id": user["user_id"],
            },
        )
    ).scalar()
    await emit_event(
        db,
        user=user,
        event_type="site.labour_recorded.v1",
        aggregate_type="daily_site_report",
        aggregate_id=report_id,
        project_id=report["project_id"],
        event_data={"line_id": str(line_id)},
    )
    await db.commit()
    return result({"id": str(line_id)}, "Labour recorded.")


@router.post(
    "/daily-reports/{report_id}/equipment", status_code=status.HTTP_201_CREATED
)
async def add_equipment(
    report_id: UUID,
    payload: EquipmentLine,
    user: dict = Depends(require_permission("site_operations.equipment.record")),
    db: AsyncSession = Depends(get_db),
):
    report = await report_or_404(db, report_id, user["org_id"])
    ensure_editable(report)
    await tenant_reference(
        db, "fleet.fleet", payload.fleet_id, user["org_id"], "Fleet asset"
    )
    await tenant_reference(
        db, "hr.employees", payload.operator_employee_id, user["org_id"], "Operator"
    )
    line_id = (
        await db.execute(
            text("""
        INSERT INTO projects.daily_report_equipment (
            organization_id, report_id, fleet_id, operator_employee_id, operating_hours,
            idle_hours, fuel_litres, cost_rate, notes, created_by
        ) VALUES (
            :org_id, :report_id, :fleet_id, :operator_employee_id, :operating_hours,
            :idle_hours, :fuel_litres, :cost_rate, :notes, :user_id
        ) RETURNING id
    """),
            {
                **payload.model_dump(),
                "org_id": user["org_id"],
                "report_id": report_id,
                "user_id": user["user_id"],
            },
        )
    ).scalar()
    await emit_event(
        db,
        user=user,
        event_type="site.equipment_recorded.v1",
        aggregate_type="daily_site_report",
        aggregate_id=report_id,
        project_id=report["project_id"],
        event_data={"line_id": str(line_id)},
    )
    await db.commit()
    return result({"id": str(line_id)}, "Equipment usage recorded.")


@router.post(
    "/daily-reports/{report_id}/materials", status_code=status.HTTP_201_CREATED
)
async def add_material(
    report_id: UUID,
    payload: MaterialLine,
    user: dict = Depends(require_permission("site_operations.material.record")),
    db: AsyncSession = Depends(get_db),
):
    report = await report_or_404(db, report_id, user["org_id"])
    ensure_editable(report)
    await tenant_reference(
        db,
        "procurement.inventory_items",
        payload.item_id,
        user["org_id"],
        "Inventory item",
    )
    await tenant_reference(
        db, "procurement.stores", payload.store_id, user["org_id"], "Store"
    )
    line_id = (
        await db.execute(
            text("""
        INSERT INTO projects.daily_report_materials (
            organization_id, report_id, item_id, store_id, quantity_used, unit_cost,
            wastage_quantity, work_package, notes, created_by
        ) VALUES (
            :org_id, :report_id, :item_id, :store_id, :quantity_used, :unit_cost,
            :wastage_quantity, :work_package, :notes, :user_id
        ) RETURNING id
    """),
            {
                **payload.model_dump(),
                "org_id": user["org_id"],
                "report_id": report_id,
                "user_id": user["user_id"],
            },
        )
    ).scalar()
    await emit_event(
        db,
        user=user,
        event_type="site.material_consumed.v1",
        aggregate_type="daily_site_report",
        aggregate_id=report_id,
        project_id=report["project_id"],
        event_data={"line_id": str(line_id), "approval_pending": True},
    )
    await db.commit()
    return result({"id": str(line_id)}, "Material consumption staged.")


@router.post(
    "/daily-reports/{report_id}/documents", status_code=status.HTTP_201_CREATED
)
async def link_document(
    report_id: UUID,
    payload: DocumentLinkPayload,
    user: dict = Depends(require_permission("documents.link")),
    db: AsyncSession = Depends(get_db),
):
    report = await report_or_404(db, report_id, user["org_id"])
    await tenant_reference(
        db, "core.documents", payload.document_id, user["org_id"], "Document"
    )
    try:
        link_id = (
            await db.execute(
                text("""
            INSERT INTO core.document_links (
                organization_id, document_id, entity_type, entity_id, project_id, link_role, linked_by
            ) VALUES (
                :org_id, :document_id, 'daily_site_report', :report_id, :project_id, :link_role, :user_id
            ) ON CONFLICT (organization_id, document_id, entity_type, entity_id, link_role)
              DO UPDATE SET is_deleted=false, linked_at=NOW(), linked_by=:user_id
            RETURNING id
        """),
                {
                    **payload.model_dump(),
                    "org_id": user["org_id"],
                    "report_id": report_id,
                    "project_id": report["project_id"],
                    "user_id": user["user_id"],
                },
            )
        ).scalar()
        await emit_event(
            db,
            user=user,
            event_type="document.linked.v1",
            aggregate_type="daily_site_report",
            aggregate_id=report_id,
            project_id=report["project_id"],
            event_data={
                "document_id": str(payload.document_id),
                "link_role": payload.link_role,
            },
        )
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=409, detail="Document could not be linked to the daily report."
        ) from exc
    return result({"id": str(link_id)}, "Document linked.")


@router.post("/daily-reports/{report_id}/submit")
async def submit_daily_report(
    report_id: UUID,
    user: dict = Depends(require_permission("site_operations.daily_report.submit")),
    db: AsyncSession = Depends(get_db),
):
    report = await report_or_404(db, report_id, user["org_id"])
    ensure_editable(report)
    counts = (
        (
            await db.execute(
                text("""
        SELECT
          (SELECT COUNT(*) FROM projects.daily_report_labour WHERE organization_id=:org_id AND report_id=:report_id AND is_deleted=false) AS labour_count,
          (SELECT COUNT(*) FROM projects.daily_report_equipment WHERE organization_id=:org_id AND report_id=:report_id AND is_deleted=false) AS equipment_count,
          (SELECT COUNT(*) FROM projects.daily_report_materials WHERE organization_id=:org_id AND report_id=:report_id AND is_deleted=false) AS material_count,
          (SELECT COUNT(*) FROM core.document_links WHERE organization_id=:org_id AND entity_type='daily_site_report' AND entity_id=:report_id AND is_deleted=false) AS document_count
    """),
                {"org_id": user["org_id"], "report_id": report_id},
            )
        )
        .mappings()
        .one()
    )
    if not (
        report.get("actual_work")
        or counts["labour_count"]
        or counts["equipment_count"]
        or counts["material_count"]
    ):
        raise HTTPException(
            status_code=422, detail="Cannot submit an empty daily report."
        )
    await db.execute(
        text("""
        UPDATE projects.daily_site_reports
        SET status='submitted', submitted_at=NOW(), submitted_by=:user_id, updated_at=NOW()
        WHERE id=:report_id AND organization_id=:org_id
    """),
        {"report_id": report_id, "org_id": user["org_id"], "user_id": user["user_id"]},
    )
    approval_id = (
        await db.execute(
            text("""
        INSERT INTO core.approval_instances (
            organization_id, workflow_key, target_type, target_id, project_id, submitted_by, metadata
        ) VALUES (
            :org_id, 'daily_site_report_approval', 'daily_site_report', :report_id, :project_id,
            :user_id, CAST(:metadata AS jsonb)
        ) ON CONFLICT (organization_id, workflow_key, target_type, target_id)
          WHERE is_deleted=false AND status='pending'
          DO UPDATE SET updated_at=NOW()
        RETURNING id
    """),
            {
                "org_id": user["org_id"],
                "report_id": report_id,
                "project_id": report["project_id"],
                "user_id": user["user_id"],
                "metadata": json.dumps(dict(counts)),
            },
        )
    ).scalar()
    await db.execute(
        text("""
        INSERT INTO core.approval_steps (organization_id, approval_instance_id, step_number, role_name)
        VALUES (:org_id, :approval_id, 1, 'Project Manager')
        ON CONFLICT (organization_id, approval_instance_id, step_number) DO NOTHING
    """),
        {"org_id": user["org_id"], "approval_id": approval_id},
    )
    await emit_event(
        db,
        user=user,
        event_type="site.daily_report.submitted.v1",
        aggregate_type="daily_site_report",
        aggregate_id=report_id,
        project_id=report["project_id"],
        event_data={"approval_id": str(approval_id), **dict(counts)},
    )
    await db.commit()
    return result(
        {"id": str(report_id), "approval_id": str(approval_id)},
        "Daily site report submitted for approval.",
    )


async def post_costs_and_stock(
    db: AsyncSession, report: dict[str, Any], user: dict
) -> dict[str, str]:
    params = {
        "org_id": user["org_id"],
        "report_id": report["id"],
        "project_id": report["project_id"],
        "user_id": user["user_id"],
        "report_date": report["report_date"],
    }
    aggregates = (
        (
            await db.execute(
                text("""
        SELECT
          COALESCE((SELECT SUM((regular_hours + overtime_hours) * cost_rate) FROM projects.daily_report_labour WHERE organization_id=:org_id AND report_id=:report_id AND is_deleted=false), 0) AS labour_cost,
          COALESCE((SELECT SUM(operating_hours * cost_rate) FROM projects.daily_report_equipment WHERE organization_id=:org_id AND report_id=:report_id AND is_deleted=false), 0) AS equipment_cost,
          COALESCE((SELECT SUM(quantity_used * unit_cost) FROM projects.daily_report_materials WHERE organization_id=:org_id AND report_id=:report_id AND is_deleted=false), 0) AS material_cost
    """),
                params,
            )
        )
        .mappings()
        .one()
    )
    posted: dict[str, str] = {}
    for category, amount in {
        "labour": aggregates["labour_cost"],
        "equipment": aggregates["equipment_cost"],
        "materials": aggregates["material_cost"],
    }.items():
        if Decimal(str(amount or 0)) <= 0:
            continue
        row = await db.execute(
            text("""
            INSERT INTO finance.cost_transactions (
                organization_id, project_id, source_type, source_id, cost_category,
                description, quantity, unit_cost, amount, transaction_date, posted_by
            ) VALUES (
                :org_id, :project_id, 'daily_site_report', :report_id, :category,
                :description, 1, :amount, :amount, :report_date, :user_id
            ) ON CONFLICT (organization_id, source_type, source_id, cost_category) DO NOTHING
            RETURNING id
        """),
            {
                **params,
                "category": category,
                "amount": amount,
                "description": f"Approved daily site report {category} cost",
            },
        )
        cost_id = row.scalar()
        if cost_id:
            posted[category] = str(cost_id)
    material_rows = await db.execute(
        text("""
        SELECT id, item_id, store_id, quantity_used, unit_cost, ROUND(quantity_used * unit_cost, 2) AS total_cost
        FROM projects.daily_report_materials
        WHERE organization_id=:org_id AND report_id=:report_id AND is_deleted=false
    """),
        params,
    )
    for line in material_rows.mappings():
        await db.execute(
            text("""
            INSERT INTO procurement.stock_ledger (
                organization_id, item_id, store_id, project_id, movement_type, quantity,
                unit_cost, total_cost, source_type, source_id, reference, recorded_by
            ) VALUES (
                :org_id, :item_id, :store_id, :project_id, 'consumption', (:quantity_used * -1),
                :unit_cost, :total_cost, 'daily_report_material', :line_id, :reference, :user_id
            ) ON CONFLICT (organization_id, source_type, source_id, item_id, movement_type) DO NOTHING
        """),
            {
                **params,
                **dict(line),
                "line_id": line["id"],
                "reference": f"DSR-{report['id']}",
            },
        )
    return posted


@router.post("/daily-reports/{report_id}/decision")
async def decide_daily_report(
    report_id: UUID,
    payload: DecisionPayload,
    user: dict = Depends(require_permission("site_operations.daily_report.approve")),
    db: AsyncSession = Depends(get_db),
):
    report = await report_or_404(db, report_id, user["org_id"])
    if report["status"] != "submitted":
        raise HTTPException(
            status_code=409,
            detail="Only submitted daily reports can receive an approval decision.",
        )
    if str(report.get("submitted_by")) == str(user["user_id"]):
        raise HTTPException(
            status_code=403,
            detail="Self-approval is not permitted for daily site reports.",
        )
    approval = (
        (
            await db.execute(
                text("""
        SELECT id FROM core.approval_instances
        WHERE organization_id=:org_id AND workflow_key='daily_site_report_approval'
          AND target_type='daily_site_report' AND target_id=:report_id
          AND status='pending' AND is_deleted=false
        ORDER BY created_at DESC LIMIT 1
    """),
                {"org_id": user["org_id"], "report_id": report_id},
            )
        )
        .mappings()
        .first()
    )
    if not approval:
        raise HTTPException(
            status_code=409, detail="No pending approval exists for this daily report."
        )
    if payload.decision == "rejected":
        await db.execute(
            text("""
            UPDATE projects.daily_site_reports
            SET status='rejected', rejection_reason=:reason, updated_at=NOW()
            WHERE id=:report_id AND organization_id=:org_id
        """),
            {
                "report_id": report_id,
                "org_id": user["org_id"],
                "reason": payload.reason,
            },
        )
        event_type = "site.daily_report.rejected.v1"
        await emit_notification(
            db,
            org_id=user["org_id"],
            user_id=str(report["submitted_by"]),
            title="Daily Site Report Rejected",
            message=f"Your daily site report for {report['report_date']} has been rejected. Reason: {payload.reason}",
        )
    else:
        posted = await post_costs_and_stock(db, report, user)
        await db.execute(
            text("""
            UPDATE projects.daily_site_reports
            SET status='approved', approved_at=NOW(), approved_by=:user_id, updated_at=NOW()
            WHERE id=:report_id AND organization_id=:org_id
        """),
            {
                "report_id": report_id,
                "org_id": user["org_id"],
                "user_id": user["user_id"],
            },
        )
        await emit_event(
            db,
            user=user,
            event_type="finance.actual_cost_created.v1",
            aggregate_type="daily_site_report",
            aggregate_id=report_id,
            project_id=report["project_id"],
            event_data={"cost_transactions": posted},
        )
        await emit_event(
            db,
            user=user,
            event_type="project.progress_updated.v1",
            aggregate_type="daily_site_report",
            aggregate_id=report_id,
            project_id=report["project_id"],
            event_data={"source": "daily_site_report"},
        )
        event_type = "site.daily_report.approved.v1"
        await emit_notification(
            db,
            org_id=user["org_id"],
            user_id=str(report["submitted_by"]),
            title="Daily Site Report Approved",
            message=f"Your daily site report for {report['report_date']} has been approved.",
        )
    await db.execute(
        text("""
        UPDATE core.approval_instances
        SET status=:decision, decided_by=:user_id, decided_at=NOW(), decision_reason=:reason, updated_at=NOW()
        WHERE id=:approval_id AND organization_id=:org_id
    """),
        {
            "approval_id": approval["id"],
            "org_id": user["org_id"],
            "decision": payload.decision,
            "user_id": user["user_id"],
            "reason": payload.reason,
        },
    )
    await db.execute(
        text("""
        UPDATE core.approval_steps
        SET status=:decision, decided_by=:user_id, decided_at=NOW(), reason=:reason, updated_at=NOW()
        WHERE approval_instance_id=:approval_id AND organization_id=:org_id AND step_number=1
    """),
        {
            "approval_id": approval["id"],
            "org_id": user["org_id"],
            "decision": payload.decision,
            "user_id": user["user_id"],
            "reason": payload.reason,
        },
    )
    await emit_event(
        db,
        user=user,
        event_type=event_type,
        aggregate_type="daily_site_report",
        aggregate_id=report_id,
        project_id=report["project_id"],
        event_data={"approval_id": str(approval["id"]), "reason": payload.reason},
    )
    await db.commit()
    return result(
        {"id": str(report_id), "decision": payload.decision},
        f"Daily site report {payload.decision}.",
    )
