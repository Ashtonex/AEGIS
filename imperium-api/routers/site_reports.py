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
from app.services import inventory_service
from app.shared.events import emit_event, emit_notification, emit_role_notification
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
    labour_count_completed: bool = False
    toolbox_talk_completed: bool = False
    ppe_check_completed: bool = False
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
    labour_count_completed: Optional[bool] = None
    toolbox_talk_completed: Optional[bool] = None
    ppe_check_completed: Optional[bool] = None
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
    weekly_budget_item_id: Optional[UUID] = None
    variance_id: Optional[UUID] = None
    quantity: Decimal = Field(gt=0, max_digits=14, decimal_places=3)
    unit_cost: Decimal = Field(
        default=Decimal("0"), ge=0, max_digits=15, decimal_places=4
    )
    required_by_date: date
    priority: Literal["low", "normal", "urgent", "emergency"] = "normal"
    work_package: Optional[str] = Field(default=None, max_length=160)
    justification: Optional[str] = None
    auto_submit_requisition: bool = True


class WeeklyBudgetPayload(Payload):
    project_id: UUID
    site_id: Optional[UUID] = None
    week_start: date
    labour_budget: Decimal = Field(default=Decimal("0"), ge=0, max_digits=15, decimal_places=2)
    materials_budget: Decimal = Field(default=Decimal("0"), ge=0, max_digits=15, decimal_places=2)
    equipment_budget: Decimal = Field(default=Decimal("0"), ge=0, max_digits=15, decimal_places=2)
    subcontract_budget: Decimal = Field(default=Decimal("0"), ge=0, max_digits=15, decimal_places=2)
    work_plan: Optional[str] = None
    labour_plan: list[dict[str, Any]] = Field(default_factory=list)
    material_plan: list[dict[str, Any]] = Field(default_factory=list)
    plant_plan: list[dict[str, Any]] = Field(default_factory=list)
    risk_plan: list[dict[str, Any]] = Field(default_factory=list)
    notes: Optional[str] = None


class WeeklyBudgetLinePayload(Payload):
    boq_line_item_id: Optional[UUID] = None
    work_package: Optional[str] = Field(default=None, max_length=160)
    description: str = Field(min_length=1, max_length=500)
    unit: str = Field(default="item", max_length=20)
    planned_qty: Decimal = Field(default=Decimal("0"), ge=0, max_digits=14, decimal_places=3)
    planned_amount: Decimal = Field(default=Decimal("0"), ge=0, max_digits=15, decimal_places=2)
    cost_category: Optional[Literal["labour", "equipment", "materials", "subcontract", "overhead", "other"]] = None
    notes: Optional[str] = None
    variance_reason: Optional[str] = None
    variance_origin: Literal["client_initiated", "site_initiated", "designer_initiated", "statutory", "internal_loss"] = "site_initiated"
    variance_classification: Literal[
        "client_variation",
        "design_variation",
        "site_condition_variation",
        "quantity_variance",
        "internal_cost_variance",
        "emergency_variance",
    ] = "quantity_variance"
    approval_route: Literal["client", "internal", "client_and_internal"] = "internal"
    proceed_at_risk: bool = False
    proceed_instruction_given_by: Optional[str] = Field(default=None, max_length=255)
    proceed_instruction_at: Optional[str] = Field(default=None, max_length=80)
    proceed_evidence_note: Optional[str] = Field(default=None, max_length=2000)
    proceed_estimated_cost_exposure: Decimal = Field(default=Decimal("0"), ge=0, max_digits=15, decimal_places=2)
    proceed_estimated_time_exposure_days: int = Field(default=0, ge=0)
    proceed_management_authorizer: Optional[str] = Field(default=None, max_length=255)
    proceed_formal_approval_deadline: Optional[date] = None

    @model_validator(mode="after")
    def proceed_at_risk_requires_control_fields(self):
        if not self.proceed_at_risk:
            return self
        missing = []
        required_text = {
            "instruction giver": self.proceed_instruction_given_by,
            "instruction date/time": self.proceed_instruction_at,
            "evidence/witness": self.proceed_evidence_note,
            "management authoriser": self.proceed_management_authorizer,
        }
        for label, value in required_text.items():
            if not value or not str(value).strip():
                missing.append(label)
        if self.proceed_estimated_cost_exposure <= 0:
            missing.append("estimated cost exposure")
        if self.proceed_estimated_time_exposure_days <= 0:
            missing.append("estimated time exposure")
        if self.proceed_formal_approval_deadline is None:
            missing.append("formal approval deadline")
        if missing:
            raise ValueError(f"proceed-at-risk requires {', '.join(missing)}")
        return self


class WeeklyBudgetWithLinesPayload(WeeklyBudgetPayload):
    lines: list[WeeklyBudgetLinePayload] = Field(default_factory=list)


class VariationQsReviewPayload(Payload):
    decision: Literal["reviewed", "rejected"]
    cost_impact: Decimal = Field(default=Decimal("0"), max_digits=15, decimal_places=2)
    time_impact_days: int = 0
    notes: Optional[str] = Field(default=None, max_length=2000)


class VariationClientDecisionPayload(Payload):
    decision: Literal["approved", "rejected"]
    notes: Optional[str] = Field(default=None, max_length=2000)


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


async def process_verified_material_request(
    db: AsyncSession,
    *,
    request_id: UUID,
    request_row: dict[str, Any],
    user: dict,
) -> dict[str, Any]:
    gate_status = await enforce_material_execution_release(db, request_row=request_row, user=user)
    if request_row.get("purchase_requisition_id") or request_row.get("stock_ledger_id"):
        return {
            "request_number": request_row["request_number"],
            "status": request_row["status"],
            "issued_quantity": str(request_row.get("issued_quantity") or 0),
            "shortfall_quantity": str(request_row.get("shortfall_quantity") or 0),
            "purchase_requisition_id": str(request_row["purchase_requisition_id"]) if request_row.get("purchase_requisition_id") else None,
        }

    item = await inventory_item(db, request_row["item_id"], user["org_id"])
    available_stock = await inventory_service.stock_balance(
        db,
        org_id=user["org_id"],
        item_id=request_row["item_id"],
        store_id=request_row.get("store_id"),
    )
    requested_quantity = Decimal(str(request_row["requested_quantity"]))
    unit_cost = Decimal(str(request_row.get("unit_cost") or 0))
    issue_qty = min(requested_quantity, max(available_stock, Decimal("0")))
    shortfall_qty = requested_quantity - issue_qty
    status_value = (
        "fulfilled_from_stock"
        if shortfall_qty == 0
        else "partially_issued_requisitioned"
        if issue_qty > 0
        else "requisitioned"
    )
    stock_ledger_id: Optional[UUID] = None
    if issue_qty > 0:
        issue_outcome = await inventory_service.issue_stock(
            db,
            user,
            item_id=request_row["item_id"],
            store_id=request_row.get("store_id"),
            project_id=request_row["project_id"],
            quantity=issue_qty,
            unit_cost=unit_cost,
            source_type="site_material_request",
            source_id=request_id,
            reference=request_row["request_number"],
            cost_category="materials",
            cost_description=f"Site material request {request_row['request_number']} issued from stock",
        )
        stock_ledger_id = issue_outcome["movement_id"]
        await emit_event(
            db,
            user=user,
            event_type="inventory.material_issued.v1",
            aggregate_type="material_request",
            aggregate_id=request_id,
            project_id=request_row["project_id"],
            event_data={"item_id": str(request_row["item_id"]), "quantity": str(issue_qty), "stock_ledger_id": str(stock_ledger_id)},
        )

    requisition_id: Optional[UUID] = None
    requisition_number: Optional[str] = None
    if shortfall_qty > 0:
        available_budget = await inventory_service.budget_available(
            db, org_id=user["org_id"], project_id=request_row["project_id"]
        )
        requisition_total = (shortfall_qty * unit_cost).quantize(Decimal("0.01"))
        should_submit = (
            available_budget is None
            or requisition_total <= available_budget
            or user.get("role") == "SUPERADMIN"
        )
        requisition_number = await next_reference(db, user["org_id"], "purchase_requisition")
        requisition_id = (
            await db.execute(
                text("""
            INSERT INTO procurement.purchase_requisitions (
                organization_id, requisition_number, project_id, site_id,
                requested_by, required_by_date, priority, justification, total_estimated,
                status, submitted_at, submitted_by, budget_checked, budget_available, weekly_budget_id, created_by
            ) VALUES (
                :org_id, :requisition_number, :project_id, :site_id,
                :requested_by, :required_by_date, :priority, :justification, :total_estimated,
                CAST(:status AS varchar),
                CASE WHEN CAST(:status AS varchar)='submitted' THEN NOW() ELSE NULL END,
                CASE WHEN CAST(:status AS varchar)='submitted' THEN CAST(:user_id AS uuid) ELSE NULL END,
                :budget_checked, :budget_available, :weekly_budget_id, :user_id
            ) RETURNING id
        """),
                {
                    "org_id": user["org_id"],
                    "requisition_number": requisition_number,
                    "project_id": request_row["project_id"],
                    "site_id": request_row.get("site_id"),
                    "requested_by": request_row["requested_by"],
                    "required_by_date": request_row.get("required_by_date"),
                    "priority": request_row["priority"],
                    "justification": request_row.get("justification") or f"Shortfall from site material request {request_row['request_number']}",
                    "total_estimated": requisition_total,
                    "status": "submitted" if should_submit else "draft",
                    "budget_checked": available_budget is not None,
                    "budget_available": available_budget,
                    "weekly_budget_id": request_row.get("weekly_budget_id"),
                    "user_id": user["user_id"],
                },
            )
        ).scalar()
        await db.execute(
            text("""
            INSERT INTO procurement.requisition_lines (
                organization_id, requisition_id, item_id, description, quantity,
                unit_of_measure, estimated_unit_cost, work_package, notes, is_price_confirmed
            ) VALUES (
                :org_id, :requisition_id, :item_id, :description, :quantity,
                :uom, :unit_cost, :work_package, :notes, :is_price_confirmed
            )
        """),
            {
                "org_id": user["org_id"],
                "requisition_id": requisition_id,
                "item_id": request_row["item_id"],
                "description": item.get("item_name") or item.get("item_code") or "Site material shortfall",
                "quantity": shortfall_qty,
                "uom": item.get("unit_of_measure") or "each",
                "unit_cost": unit_cost,
                "work_package": request_row.get("work_package"),
                "notes": f"Generated from engineer-verified material request {request_row['request_number']}",
                "is_price_confirmed": unit_cost > 0,
            },
        )
        await emit_event(
            db,
            user=user,
            event_type="material.requested.v1",
            aggregate_type="purchase_requisition",
            aggregate_id=requisition_id,
            project_id=request_row["project_id"],
            event_data={
                "material_request_id": str(request_id),
                "requisition_number": requisition_number,
                "shortfall_quantity": str(shortfall_qty),
                "budget_available": str(available_budget),
                "engineer_review_status": "verified",
            },
        )
        if should_submit:
            await emit_event(
                db,
                user=user,
                event_type="procurement.requisition.submitted.v1",
                aggregate_type="purchase_requisition",
                aggregate_id=requisition_id,
                project_id=request_row["project_id"],
                event_data={
                    "material_request_id": str(request_id),
                    "status": "submitted",
                    "engineer_review_status": "verified",
                },
            )
            await emit_role_notification(
                db,
                org_id=user["org_id"],
                role_names=["Procurement Manager"],
                title="Engineer-verified requisition awaiting approval",
                message=f"Requisition {requisition_number} from {request_row['request_number']} is ready for procurement approval.",
                action_url="/dashboard/procurement?tab=requisitions",
            )

    await db.execute(
        text("""
        UPDATE procurement.material_requests
        SET issued_quantity=:issued_quantity,
            shortfall_quantity=:shortfall_quantity,
            status=:status,
            execution_gate_status=:execution_gate_status,
            stock_ledger_id=CAST(:stock_ledger_id AS uuid),
            purchase_requisition_id=CAST(:requisition_id AS uuid),
            updated_at=NOW()
        WHERE id=:request_id AND organization_id=:org_id
    """),
        {
            "org_id": user["org_id"],
            "request_id": request_id,
            "issued_quantity": issue_qty,
            "shortfall_quantity": shortfall_qty,
            "status": status_value,
            "execution_gate_status": gate_status,
            "stock_ledger_id": str(stock_ledger_id) if stock_ledger_id else None,
            "requisition_id": str(requisition_id) if requisition_id else None,
        },
    )
    return {
        "request_number": request_row["request_number"],
        "status": status_value,
        "available_quantity": str(available_stock),
        "issued_quantity": str(issue_qty),
        "shortfall_quantity": str(shortfall_qty),
        "stock_ledger_id": str(stock_ledger_id) if stock_ledger_id else None,
        "purchase_requisition_id": str(requisition_id) if requisition_id else None,
        "purchase_requisition_number": requisition_number,
    }


async def enforce_material_execution_release(
    db: AsyncSession,
    *,
    request_row: dict[str, Any],
    user: dict,
) -> str:
    weekly_budget_item_id = request_row.get("weekly_budget_item_id")
    if not weekly_budget_item_id:
        await db.execute(
            text("""
            UPDATE procurement.material_requests
            SET execution_gate_status='blocked', updated_at=NOW()
            WHERE id=:request_id AND organization_id=:org_id
        """),
            {"request_id": request_row["id"], "org_id": user["org_id"]},
        )
        raise HTTPException(
            status_code=409,
            detail="Link the material request to a weekly budget execution line before stock issue or procurement forwarding.",
        )
    row = (
        (
            await db.execute(
                text("""
        SELECT wbi.id, wbi.status, wbi.variance_required, wbi.planned_qty, wbi.available_qty,
               wbi.variance_id, v.status AS variation_status, v.qs_review_status,
               v.client_approval_required, v.client_approval_status, v.proceed_at_risk,
               v.execution_blocked, v.proceed_management_authorized_at
        FROM projects.weekly_budget_items wbi
        LEFT JOIN finance.variations v ON v.id=wbi.variance_id AND v.organization_id=wbi.organization_id
        WHERE wbi.id=:weekly_budget_item_id AND wbi.organization_id=:org_id AND wbi.is_deleted=false
    """),
                {"weekly_budget_item_id": weekly_budget_item_id, "org_id": user["org_id"]},
            )
        )
        .mappings()
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Linked weekly budget execution line was not found.")
    data = dict(row)
    if not data.get("variance_required"):
        return "released"
    approved_variance = (
        data.get("variation_status") == "approved"
        and data.get("qs_review_status") == "reviewed"
        and (
            not data.get("client_approval_required")
            or data.get("client_approval_status") == "approved"
        )
        and not data.get("execution_blocked")
    )
    proceed_override = (
        data.get("proceed_at_risk")
        and data.get("proceed_management_authorized_at")
        and not data.get("execution_blocked")
    )
    if not approved_variance and not proceed_override:
        await db.execute(
            text("""
            UPDATE procurement.material_requests
            SET execution_gate_status='blocked', updated_at=NOW()
            WHERE id=:request_id AND organization_id=:org_id
        """),
            {"request_id": request_row["id"], "org_id": user["org_id"]},
        )
        raise HTTPException(
            status_code=409,
            detail="This material request exceeds the released allowance. Approve the linked variance or complete the proceed-at-risk override before stock issue or procurement forwarding.",
        )
    return "proceed_at_risk" if proceed_override else "released"


async def ensure_current_weekly_budget(
    db: AsyncSession,
    *,
    org_id: str,
    project_id: UUID,
    site_id: Optional[UUID] = None,
) -> UUID:
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
            detail="Submit this week's site budget before requesting materials.",
        )
    return budget_id


async def execution_allowance_for_line(
    db: AsyncSession,
    *,
    org_id: str,
    line_item_id: Optional[UUID],
) -> Optional[dict[str, Any]]:
    if line_item_id is None:
        return None
    row = (
        (
            await db.execute(
                text("""
        SELECT id, project_id, item_no, description, unit, contract_qty, rate,
               qty_measured_to_date, contract_amount, cost_category,
               GREATEST(contract_qty - qty_measured_to_date, 0) AS available_qty
        FROM finance.boq_line_items
        WHERE id=:line_item_id AND organization_id=:org_id AND is_deleted=false AND status != 'superseded'
    """),
                {"line_item_id": line_item_id, "org_id": org_id},
            )
        )
        .mappings()
        .first()
    )
    return dict(row) if row else None


async def create_site_variation_from_weekly_line(
    db: AsyncSession,
    *,
    user: dict,
    project_id: UUID,
    weekly_budget_id: UUID,
    weekly_budget_item_id: UUID,
    line: WeeklyBudgetLinePayload,
    allowance: Optional[dict[str, Any]],
    estimated_excess_amount: Decimal,
) -> UUID:
    sequence = await db.execute(
        text("""
        SELECT COUNT(*) + 1
        FROM finance.variations
        WHERE organization_id=:org_id AND project_id=:project_id
    """),
        {"org_id": user["org_id"], "project_id": project_id},
    )
    variation_number = f"VAR-{str(project_id)[:8].upper()}-{int(sequence.scalar() or 1):03d}"
    client_required = line.approval_route in {"client", "client_and_internal"} or line.variance_origin == "client_initiated"
    variation_id = (
        await db.execute(
            text("""
        INSERT INTO finance.variations (
            organization_id, variation_number, project_id, title, description, initiated_by,
            scope_impact, cost_impact, time_impact_days, status, submitted_by, submitted_at,
            created_by, source_type, source_id, boq_line_item_id, weekly_budget_id,
            weekly_budget_item_id, variance_origin, variance_classification, approval_route, client_approval_required,
            client_approval_status, qs_review_status, proceed_at_risk, execution_blocked,
            proceed_instruction_given_by, proceed_instruction_at, proceed_evidence_note,
            proceed_estimated_cost_exposure, proceed_estimated_time_exposure_days,
            proceed_management_authorizer, proceed_management_authorized_at,
            formal_approval_deadline, notes
        ) VALUES (
            :org_id, :variation_number, :project_id, :title, :description, :initiated_by,
            :scope_impact, :cost_impact, 0, 'submitted', :user_id, NOW(),
            :user_id, 'weekly_budget_item', :weekly_budget_item_id, CAST(:boq_line_item_id AS uuid), :weekly_budget_id,
            :weekly_budget_item_id, :variance_origin, :variance_classification, :approval_route, :client_required,
            :client_approval_status, 'pending', :proceed_at_risk, :execution_blocked,
            :proceed_instruction_given_by, :proceed_instruction_at, :proceed_evidence_note,
            :proceed_estimated_cost_exposure, :proceed_estimated_time_exposure_days,
            :proceed_management_authorizer, CASE WHEN :proceed_at_risk THEN NOW() ELSE NULL END,
            CAST(:formal_approval_deadline AS date), :notes
        ) RETURNING id
    """),
            {
                "org_id": user["org_id"],
                "variation_number": variation_number,
                "project_id": project_id,
                "title": f"Weekly budget variance - {line.description[:180]}",
                "description": line.variance_reason or "Weekly execution budget exceeds available QS baseline allowance.",
                "initiated_by": "client" if line.variance_origin == "client_initiated" else "contractor",
                "scope_impact": f"Planned qty {line.planned_qty} {line.unit}; available baseline qty {allowance.get('available_qty') if allowance else 'not linked'}",
                "cost_impact": estimated_excess_amount,
                "user_id": user["user_id"],
                "weekly_budget_id": weekly_budget_id,
                "weekly_budget_item_id": weekly_budget_item_id,
                "boq_line_item_id": str(line.boq_line_item_id) if line.boq_line_item_id else None,
                "variance_origin": line.variance_origin,
                "variance_classification": line.variance_classification,
                "approval_route": line.approval_route,
                "client_required": client_required,
                "client_approval_status": "pending" if client_required else "not_required",
                "proceed_at_risk": line.proceed_at_risk,
                "execution_blocked": False if line.proceed_at_risk else True,
                "proceed_instruction_given_by": line.proceed_instruction_given_by,
                "proceed_instruction_at": line.proceed_instruction_at,
                "proceed_evidence_note": line.proceed_evidence_note,
                "proceed_estimated_cost_exposure": line.proceed_estimated_cost_exposure,
                "proceed_estimated_time_exposure_days": line.proceed_estimated_time_exposure_days,
                "proceed_management_authorizer": line.proceed_management_authorizer,
                "formal_approval_deadline": line.proceed_formal_approval_deadline,
                "notes": line.notes,
            },
        )
    ).scalar()
    return variation_id


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
        SELECT i.id, i.item_name, COALESCE(bal.available_qty, 0) AS stock_quantity,
               i.created_at, i.updated_at
        FROM procurement.inventory_items i
        LEFT JOIN (
            SELECT item_id, SUM(quantity) AS available_qty
            FROM procurement.stock_ledger
            WHERE organization_id=:org_id
            GROUP BY item_id
        ) bal ON bal.item_id = i.id
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
    weekly_budget_id = await ensure_current_weekly_budget(
        db, org_id=user["org_id"], project_id=payload.project_id, site_id=payload.site_id
    )
    await inventory_item(db, payload.item_id, user["org_id"])
    linked_weekly_item: Optional[dict[str, Any]] = None
    if payload.weekly_budget_item_id:
        linked = (
            (
                await db.execute(
                    text("""
        SELECT id, boq_line_item_id, variance_id
        FROM projects.weekly_budget_items
        WHERE id=:weekly_budget_item_id AND organization_id=:org_id
          AND weekly_budget_id=:weekly_budget_id AND project_id=:project_id
          AND is_deleted=false
    """),
                    {
                        "weekly_budget_item_id": payload.weekly_budget_item_id,
                        "weekly_budget_id": weekly_budget_id,
                        "project_id": payload.project_id,
                        "org_id": user["org_id"],
                    },
                )
            )
            .mappings()
            .first()
        )
        if not linked:
            raise HTTPException(status_code=422, detail="Material request must link to a current weekly budget execution line for this project.")
        linked_weekly_item = dict(linked)
        if payload.variance_id and str(payload.variance_id) != str(linked.get("variance_id")):
            raise HTTPException(status_code=422, detail="Linked variance does not match the weekly budget execution line.")
    total_estimated = (payload.quantity * payload.unit_cost).quantize(Decimal("0.01"))
    request_number = await next_reference(db, user["org_id"], "material_request")
    material_request_id = (
        await db.execute(
            text("""
        INSERT INTO procurement.material_requests (
            organization_id, request_number, project_id, site_id, store_id, item_id,
            requested_by, requested_quantity, issued_quantity, shortfall_quantity,
            unit_cost, total_estimated, required_by_date, priority, status,
            work_package, justification, created_by, is_price_confirmed, weekly_budget_id,
            weekly_budget_item_id, boq_line_item_id, variance_id, engineer_review_status
        ) VALUES (
            :org_id, :request_number, :project_id, :site_id, :store_id, :item_id,
            :user_id, :requested_quantity, :issued_quantity, :shortfall_quantity,
            :unit_cost, :total_estimated, :required_by_date, :priority, :status,
            :work_package, :justification, :user_id, :is_price_confirmed, :weekly_budget_id,
            CAST(:weekly_budget_item_id AS uuid), CAST(:boq_line_item_id AS uuid), CAST(:variance_id AS uuid), 'pending'
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
                "issued_quantity": Decimal("0"),
                "shortfall_quantity": payload.quantity,
                "unit_cost": payload.unit_cost,
                "total_estimated": total_estimated,
                "required_by_date": payload.required_by_date,
                "priority": payload.priority,
                "status": "requisitioned",
                "work_package": payload.work_package,
                "justification": payload.justification,
                "is_price_confirmed": payload.unit_cost > 0,
                "weekly_budget_id": weekly_budget_id,
                "weekly_budget_item_id": str(payload.weekly_budget_item_id) if payload.weekly_budget_item_id else None,
                "boq_line_item_id": str(linked_weekly_item.get("boq_line_item_id")) if linked_weekly_item and linked_weekly_item.get("boq_line_item_id") else None,
                "variance_id": str(payload.variance_id or (linked_weekly_item or {}).get("variance_id")) if (payload.variance_id or (linked_weekly_item or {}).get("variance_id")) else None,
            },
        )
    ).scalar()

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
            "engineer_review_status": "pending",
        },
    )
    await emit_role_notification(
        db,
        org_id=user["org_id"],
        role_names=["Site Engineer"],
        title="Material request awaiting technical sign-off",
        message=f"Site material request {request_number} needs engineer verification before stock issue or procurement forwarding.",
        action_url="/portal/site-engineer",
    )
    await db.commit()
    return result(
        {
            "id": str(material_request_id),
            "request_number": request_number,
            "status": "awaiting_engineer_review",
            "engineer_review_status": "pending",
        },
        "Site material request recorded for Site Engineer sign-off.",
    )


@router.get("/material-requests")
async def list_site_material_requests(
    project_id: Optional[UUID] = None,
    engineer_status: Optional[str] = Query(default=None),
    user: dict = Depends(require_permission("site_operations.engineer_portal.read")),
    db: AsyncSession = Depends(get_db),
):
    filters = ["mr.organization_id=:org_id", "mr.is_deleted=false"]
    params: dict[str, Any] = {"org_id": user["org_id"], "project_id": project_id, "engineer_status": engineer_status}
    if project_id:
        filters.append("mr.project_id=:project_id")
    if engineer_status and engineer_status != "all":
        filters.append("mr.engineer_review_status=:engineer_status")
    rows = await db.execute(
        text(f"""
        SELECT mr.*, p.name AS project_name, s.name AS site_name, i.item_name, i.item_code,
               requester.full_name AS requested_by_name
        FROM procurement.material_requests mr
        JOIN projects.projects p ON p.id=mr.project_id AND p.organization_id=mr.organization_id
        LEFT JOIN projects.sites s ON s.id=mr.site_id AND s.organization_id=mr.organization_id
        LEFT JOIN procurement.inventory_items i ON i.id=mr.item_id AND i.organization_id=mr.organization_id
        LEFT JOIN core.users requester ON requester.id=mr.requested_by AND requester.organization_id=mr.organization_id
        WHERE {' AND '.join(filters)}
        ORDER BY mr.created_at DESC
        LIMIT 200
    """),
        params,
    )
    data = [dict(row._mapping) for row in rows]
    return result(data, "Site material requests listed.", len(data))


@router.post("/material-requests/{request_id}/engineer-decision")
async def decide_site_material_request_engineer(
    request_id: UUID,
    payload: DecisionPayload,
    user: dict = Depends(require_permission("site_operations.engineer_verify")),
    db: AsyncSession = Depends(get_db),
):
    request_row = (
        (
            await db.execute(
                text("""
        SELECT * FROM procurement.material_requests
        WHERE id=:request_id AND organization_id=:org_id AND is_deleted=false
    """),
                {"request_id": request_id, "org_id": user["org_id"]},
            )
        )
        .mappings()
        .first()
    )
    if not request_row:
        raise HTTPException(status_code=404, detail="Material request not found")
    request_data = dict(request_row)
    if request_data.get("engineer_review_status") != "pending":
        raise HTTPException(status_code=409, detail="Material request has already received engineer review.")
    if str(request_data.get("requested_by")) == str(user["user_id"]):
        raise HTTPException(status_code=403, detail="Self-verification is not permitted for material requests.")

    if payload.decision == "rejected":
        await db.execute(
            text("""
            UPDATE procurement.material_requests
            SET engineer_review_status='rejected',
                engineer_reviewed_by=:user_id,
                engineer_reviewed_at=NOW(),
                engineer_review_reason=:reason,
                status='cancelled',
                updated_at=NOW()
            WHERE id=:request_id AND organization_id=:org_id
        """),
            {"request_id": request_id, "org_id": user["org_id"], "user_id": user["user_id"], "reason": payload.reason},
        )
        processed = {"id": str(request_id), "engineer_review_status": "rejected"}
        event_type = "site.material_request.engineer_rejected.v1"
    else:
        await db.execute(
            text("""
            UPDATE procurement.material_requests
            SET engineer_review_status='verified',
                engineer_reviewed_by=:user_id,
                engineer_reviewed_at=NOW(),
                engineer_review_reason=:reason,
                updated_at=NOW()
            WHERE id=:request_id AND organization_id=:org_id
        """),
            {"request_id": request_id, "org_id": user["org_id"], "user_id": user["user_id"], "reason": payload.reason},
        )
        processed = await process_verified_material_request(
            db, request_id=request_id, request_row=request_data, user=user
        )
        event_type = "site.material_request.engineer_verified.v1"

    await emit_event(
        db,
        user=user,
        event_type=event_type,
        aggregate_type="material_request",
        aggregate_id=request_id,
        project_id=request_data["project_id"],
        event_data={"reason": payload.reason, **processed},
    )
    await db.commit()
    return result(processed, f"Material request {payload.decision} by Site Engineer.")


@router.get("/weekly-budgets")
async def list_weekly_budgets(
    project_id: Optional[UUID] = None,
    status_filter: Optional[str] = Query(default=None, alias="status"),
    user: dict = Depends(require_permission("projects.weekly_budget.read")),
    db: AsyncSession = Depends(get_db),
):
    filters = ["wb.organization_id=:org_id", "wb.is_deleted=false"]
    params: dict[str, Any] = {"org_id": user["org_id"], "project_id": project_id, "status": status_filter}
    if project_id:
        filters.append("wb.project_id=:project_id")
    if status_filter and status_filter != "all":
        filters.append("wb.status=:status")
    rows = await db.execute(
        text(f"""
        SELECT wb.*, p.name AS project_name, s.name AS site_name,
               submitter.full_name AS submitted_by_name, approver.full_name AS approved_by_name
        FROM projects.weekly_budgets wb
        JOIN projects.projects p ON p.id=wb.project_id AND p.organization_id=wb.organization_id
        LEFT JOIN projects.sites s ON s.id=wb.site_id AND s.organization_id=wb.organization_id
        LEFT JOIN core.users submitter ON submitter.id=wb.submitted_by AND submitter.organization_id=wb.organization_id
        LEFT JOIN core.users approver ON approver.id=wb.approved_by AND approver.organization_id=wb.organization_id
        WHERE {' AND '.join(filters)}
        ORDER BY wb.week_start DESC, wb.created_at DESC
        LIMIT 200
    """),
        params,
    )
    data = [dict(row._mapping) for row in rows]
    return result(data, "Weekly site budgets listed.", len(data))


@router.get("/projects/{project_id}/execution-budget")
async def get_execution_budget(
    project_id: UUID,
    user: dict = Depends(require_permission("projects.execution_budget.read")),
    db: AsyncSession = Depends(get_db),
):
    await project_or_404(db, project_id, user["org_id"])
    budget = (
        (
            await db.execute(
                text("""
        SELECT id, label, effective_date, total_amount
        FROM finance.project_budgets
        WHERE organization_id=:org_id AND project_id=:project_id
          AND status='approved' AND is_deleted=false
        ORDER BY effective_date DESC, budget_version DESC
        LIMIT 1
    """),
                {"org_id": user["org_id"], "project_id": project_id},
            )
        )
        .mappings()
        .first()
    )
    rows = await db.execute(
        text("""
        SELECT li.id, li.item_no, li.description, li.unit, li.contract_qty,
               li.qty_measured_to_date,
               GREATEST(li.contract_qty - li.qty_measured_to_date, 0) AS available_qty,
               li.cost_category, li.status, li.sort_order,
               ROUND(GREATEST(li.contract_qty - li.qty_measured_to_date, 0) * li.rate, 2) AS remaining_execution_amount
        FROM finance.boq_line_items li
        WHERE li.organization_id=:org_id AND li.project_id=:project_id
          AND li.is_deleted=false AND li.status != 'superseded'
        ORDER BY li.sort_order, li.created_at
    """),
        {"org_id": user["org_id"], "project_id": project_id},
    )
    data = [dict(row._mapping) for row in rows]
    return result(
        {"budget": dict(budget) if budget else None, "line_items": data},
        "Execution budget allowances loaded.",
        len(data),
    )


@router.post("/weekly-budgets", status_code=status.HTTP_201_CREATED)
async def create_weekly_budget(
    payload: WeeklyBudgetWithLinesPayload,
    user: dict = Depends(require_permission("projects.weekly_budget.submit")),
    db: AsyncSession = Depends(get_db),
):
    await project_or_404(db, payload.project_id, user["org_id"])
    await site_or_404(db, payload.site_id, payload.project_id, user["org_id"])
    source_budget_id = (
        await db.execute(
            text("""
            SELECT id FROM finance.project_budgets
            WHERE organization_id=:org_id AND project_id=:project_id
              AND status='approved' AND is_deleted=false
            ORDER BY effective_date DESC, budget_version DESC
            LIMIT 1
        """),
            {"org_id": user["org_id"], "project_id": payload.project_id},
        )
    ).scalar()
    budget_id = (
        await db.execute(
            text("""
        INSERT INTO projects.weekly_budgets (
            organization_id, project_id, site_id, week_start, labour_budget, materials_budget,
            equipment_budget, subcontract_budget, work_plan, labour_plan, material_plan,
            plant_plan, risk_plan, notes, source_budget_id, submitted_at, submitted_by, created_by, status
        ) VALUES (
            :org_id, :project_id, :site_id, :week_start, :labour_budget, :materials_budget,
            :equipment_budget, :subcontract_budget, :work_plan, CAST(:labour_plan AS jsonb),
            CAST(:material_plan AS jsonb), CAST(:plant_plan AS jsonb), CAST(:risk_plan AS jsonb),
            :notes, CAST(:source_budget_id AS uuid), NOW(), :user_id, :user_id, 'submitted'
        )
        ON CONFLICT (organization_id, project_id, site_id, week_start)
        DO UPDATE SET
            labour_budget=EXCLUDED.labour_budget,
            materials_budget=EXCLUDED.materials_budget,
            equipment_budget=EXCLUDED.equipment_budget,
            subcontract_budget=EXCLUDED.subcontract_budget,
            work_plan=EXCLUDED.work_plan,
            labour_plan=EXCLUDED.labour_plan,
            material_plan=EXCLUDED.material_plan,
            plant_plan=EXCLUDED.plant_plan,
            risk_plan=EXCLUDED.risk_plan,
            notes=EXCLUDED.notes,
            source_budget_id=EXCLUDED.source_budget_id,
            status='submitted',
            submitted_at=NOW(),
            submitted_by=:user_id,
            updated_at=NOW()
        RETURNING id
    """),
            {
                **payload.model_dump(exclude={"labour_plan", "material_plan", "plant_plan", "risk_plan", "lines"}),
                "org_id": user["org_id"],
                "user_id": user["user_id"],
                "source_budget_id": str(source_budget_id) if source_budget_id else None,
                "labour_plan": json.dumps(payload.labour_plan),
                "material_plan": json.dumps(payload.material_plan),
                "plant_plan": json.dumps(payload.plant_plan),
                "risk_plan": json.dumps(payload.risk_plan),
            },
        )
    ).scalar()
    await db.execute(
        text("""
        UPDATE projects.weekly_budget_items
        SET is_deleted=true, updated_at=NOW()
        WHERE organization_id=:org_id AND weekly_budget_id=:budget_id AND is_deleted=false
    """),
        {"org_id": user["org_id"], "budget_id": budget_id},
    )
    total_planned = Decimal("0")
    variance_count = 0
    for line in payload.lines:
        allowance = await execution_allowance_for_line(
            db, org_id=user["org_id"], line_item_id=line.boq_line_item_id
        )
        if line.boq_line_item_id and (not allowance or str(allowance["project_id"]) != str(payload.project_id)):
            raise HTTPException(status_code=422, detail="Weekly budget line references a BOQ line outside this project.")
        available_qty = Decimal(str(allowance["available_qty"])) if allowance else Decimal("0")
        unit_rate = Decimal(str(allowance["rate"])) if allowance else Decimal("0")
        planned_amount = line.planned_amount or (line.planned_qty * unit_rate).quantize(Decimal("0.01"))
        total_planned += Decimal(str(planned_amount))
        variance_required = allowance is None or line.planned_qty > available_qty or line.approval_route in {"client", "client_and_internal"}
        item_id = (
            await db.execute(
                text("""
            INSERT INTO projects.weekly_budget_items (
                organization_id, weekly_budget_id, project_id, boq_line_item_id, work_package,
                description, unit, planned_qty, available_qty, planned_amount, cost_category,
                variance_required, proceed_at_risk, status, notes, created_by
            ) VALUES (
                :org_id, :weekly_budget_id, :project_id, CAST(:boq_line_item_id AS uuid), :work_package,
                :description, :unit, :planned_qty, :available_qty, :planned_amount, :cost_category,
                :variance_required, :proceed_at_risk, :status, :notes, :user_id
            ) RETURNING id
        """),
                {
                    "org_id": user["org_id"],
                    "weekly_budget_id": budget_id,
                    "project_id": payload.project_id,
                    "boq_line_item_id": str(line.boq_line_item_id) if line.boq_line_item_id else None,
                    "work_package": line.work_package,
                    "description": line.description,
                    "unit": line.unit,
                    "planned_qty": line.planned_qty,
                    "available_qty": available_qty,
                    "planned_amount": planned_amount,
                    "cost_category": line.cost_category or (allowance.get("cost_category") if allowance else None),
                    "variance_required": variance_required,
                    "proceed_at_risk": line.proceed_at_risk,
                    "status": "variance_pending" if variance_required else "planned",
                    "notes": line.notes,
                    "user_id": user["user_id"],
                },
            )
        ).scalar()
        if variance_required:
            variance_count += 1
            excess_qty = max(Decimal(str(line.planned_qty)) - available_qty, Decimal("0"))
            excess_amount = (excess_qty * unit_rate).quantize(Decimal("0.01")) if unit_rate > 0 else Decimal(str(planned_amount))
            variation_id = await create_site_variation_from_weekly_line(
                db,
                user=user,
                project_id=payload.project_id,
                weekly_budget_id=budget_id,
                weekly_budget_item_id=item_id,
                line=line,
                allowance=allowance,
                estimated_excess_amount=excess_amount,
            )
            await db.execute(
                text("""
                UPDATE projects.weekly_budget_items
                SET variance_id=:variation_id, updated_at=NOW()
                WHERE id=:item_id AND organization_id=:org_id
            """),
                {"variation_id": variation_id, "item_id": item_id, "org_id": user["org_id"]},
            )
    await db.execute(
        text("""
        UPDATE projects.weekly_budgets
        SET total_planned_amount=:total_planned, variance_count=:variance_count, updated_at=NOW()
        WHERE id=:budget_id AND organization_id=:org_id
    """),
        {"total_planned": total_planned, "variance_count": variance_count, "budget_id": budget_id, "org_id": user["org_id"]},
    )
    if variance_count:
        await emit_role_notification(
            db,
            org_id=user["org_id"],
            role_names=["Quantity Surveyor", "Commercial Manager"],
            title="Weekly budget created variance items",
            message=f"{variance_count} weekly budget line(s) need QS/client/internal variance review before normal execution.",
            action_url="/dashboard/finance/variations",
        )
    await emit_role_notification(
        db,
        org_id=user["org_id"],
        role_names=["Site Agent", "Project Manager"],
        title="Weekly site budget submitted",
        message="A Site Engineer submitted a weekly site budget for review.",
        action_url="/portal/site-engineer",
    )
    await db.commit()
    return result({"id": str(budget_id), "status": "submitted", "variance_count": variance_count}, "Weekly site budget submitted.")


@router.post("/weekly-budgets/{budget_id}/decision")
async def decide_weekly_budget(
    budget_id: UUID,
    payload: DecisionPayload,
    user: dict = Depends(require_permission("projects.weekly_budget.approve")),
    db: AsyncSession = Depends(get_db),
):
    new_status = "approved" if payload.decision == "approved" else "rejected"
    row = await db.execute(
        text("""
        UPDATE projects.weekly_budgets
        SET status=:status,
            approved_at=CASE WHEN :status='approved' THEN NOW() ELSE approved_at END,
            approved_by=CASE WHEN :status='approved' THEN CAST(:user_id AS uuid) ELSE approved_by END,
            site_agent_notes=:reason,
            updated_at=NOW()
        WHERE id=:budget_id AND organization_id=:org_id AND is_deleted=false
        RETURNING id, project_id
    """),
        {"budget_id": budget_id, "org_id": user["org_id"], "user_id": user["user_id"], "status": new_status, "reason": payload.reason},
    )
    budget = row.mappings().first()
    if not budget:
        raise HTTPException(status_code=404, detail="Weekly site budget not found.")
    await emit_event(
        db,
        user=user,
        event_type=f"site.weekly_budget.{new_status}.v1",
        aggregate_type="weekly_budget",
        aggregate_id=budget_id,
        project_id=budget["project_id"],
        event_data={"reason": payload.reason},
    )
    await db.commit()
    return result({"id": str(budget_id), "status": new_status}, f"Weekly site budget {new_status}.")


@router.get("/weekly-budgets/{budget_id}/items")
async def list_weekly_budget_items(
    budget_id: UUID,
    user: dict = Depends(require_permission("projects.weekly_budget.read")),
    db: AsyncSession = Depends(get_db),
):
    rows = await db.execute(
        text("""
        SELECT wbi.*, v.variation_number, v.status AS variation_status,
               v.qs_review_status, v.client_approval_status, v.execution_blocked
        FROM projects.weekly_budget_items wbi
        LEFT JOIN finance.variations v ON v.id=wbi.variance_id AND v.organization_id=wbi.organization_id
        WHERE wbi.organization_id=:org_id AND wbi.weekly_budget_id=:budget_id AND wbi.is_deleted=false
        ORDER BY wbi.created_at
    """),
        {"org_id": user["org_id"], "budget_id": budget_id},
    )
    data = [dict(row._mapping) for row in rows]
    return result(data, "Weekly budget items listed.", len(data))


@router.get("/variances")
async def list_site_variances(
    project_id: Optional[UUID] = None,
    status_filter: Optional[str] = Query(default=None, alias="status"),
    user: dict = Depends(require_permission("finance.variation.read")),
    db: AsyncSession = Depends(get_db),
):
    filters = ["v.organization_id=:org_id", "v.is_deleted=false", "v.source_type='weekly_budget_item'"]
    params: dict[str, Any] = {"org_id": user["org_id"], "project_id": project_id, "status": status_filter}
    if project_id:
        filters.append("v.project_id=:project_id")
    if status_filter and status_filter != "all":
        filters.append("v.status=:status")
    rows = await db.execute(
        text(f"""
        SELECT v.*, p.name AS project_name, li.description AS boq_description,
               wbi.description AS weekly_budget_description, wbi.planned_qty, wbi.available_qty
        FROM finance.variations v
        JOIN projects.projects p ON p.id=v.project_id AND p.organization_id=v.organization_id
        LEFT JOIN finance.boq_line_items li ON li.id=v.boq_line_item_id AND li.organization_id=v.organization_id
        LEFT JOIN projects.weekly_budget_items wbi ON wbi.id=v.weekly_budget_item_id AND wbi.organization_id=v.organization_id
        WHERE {' AND '.join(filters)}
        ORDER BY v.created_at DESC
        LIMIT 200
    """),
        params,
    )
    data = [dict(row._mapping) for row in rows]
    return result(data, "Site-originated variances listed.", len(data))


@router.post("/variances/{variation_id}/qs-review")
async def review_site_variance_qs(
    variation_id: UUID,
    payload: VariationQsReviewPayload,
    user: dict = Depends(require_permission("finance.variation.qs_review")),
    db: AsyncSession = Depends(get_db),
):
    row = (
        (
            await db.execute(
                text("""
        SELECT * FROM finance.variations
        WHERE id=:variation_id AND organization_id=:org_id AND is_deleted=false
    """),
                {"variation_id": variation_id, "org_id": user["org_id"]},
            )
        )
        .mappings()
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Variance not found.")
    status_value = "submitted" if payload.decision == "reviewed" else "rejected"
    await db.execute(
        text("""
        UPDATE finance.variations
        SET qs_review_status=:qs_status,
            qs_reviewed_by=:user_id,
            qs_reviewed_at=NOW(),
            cost_impact=:cost_impact,
            time_impact_days=:time_impact_days,
            notes=COALESCE(:notes, notes),
            status=:status,
            execution_blocked=CASE
                WHEN :qs_status='rejected' THEN true
                WHEN client_approval_required AND client_approval_status != 'approved' THEN true
                ELSE false
            END,
            updated_at=NOW()
        WHERE id=:variation_id AND organization_id=:org_id
    """),
        {
            "variation_id": variation_id,
            "org_id": user["org_id"],
            "user_id": user["user_id"],
            "qs_status": payload.decision,
            "cost_impact": payload.cost_impact,
            "time_impact_days": payload.time_impact_days,
            "notes": payload.notes,
            "status": status_value,
        },
    )
    await db.execute(
        text("""
        UPDATE projects.weekly_budget_items
        SET status=CASE WHEN :qs_status='rejected' THEN 'rejected' ELSE status END,
            updated_at=NOW()
        WHERE variance_id=:variation_id AND organization_id=:org_id
    """),
        {"variation_id": variation_id, "org_id": user["org_id"], "qs_status": payload.decision},
    )
    await db.commit()
    return result({"id": str(variation_id), "qs_review_status": payload.decision}, "Variance QS review saved.")


@router.post("/variances/{variation_id}/client-decision")
async def decide_site_variance_client(
    variation_id: UUID,
    payload: VariationClientDecisionPayload,
    user: dict = Depends(require_permission("finance.variation.client_approval")),
    db: AsyncSession = Depends(get_db),
):
    row = (
        (
            await db.execute(
                text("""
        SELECT * FROM finance.variations
        WHERE id=:variation_id AND organization_id=:org_id AND is_deleted=false
    """),
                {"variation_id": variation_id, "org_id": user["org_id"]},
            )
        )
        .mappings()
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Variance not found.")
    if not row["client_approval_required"]:
        raise HTTPException(status_code=409, detail="Client approval is not required for this variance.")
    status_value = "submitted" if payload.decision == "approved" else "rejected"
    await db.execute(
        text("""
        UPDATE finance.variations
        SET client_approval_status=:decision,
            client_approved_by=CASE WHEN :decision='approved' THEN CAST(:user_id AS uuid) ELSE client_approved_by END,
            client_approved_at=CASE WHEN :decision='approved' THEN NOW() ELSE client_approved_at END,
            rejection_reason=CASE WHEN :decision='rejected' THEN :notes ELSE rejection_reason END,
            notes=COALESCE(:notes, notes),
            status=:status,
            execution_blocked=CASE
                WHEN :decision='rejected' THEN true
                WHEN qs_review_status != 'reviewed' THEN true
                ELSE false
            END,
            updated_at=NOW()
        WHERE id=:variation_id AND organization_id=:org_id
    """),
        {"variation_id": variation_id, "org_id": user["org_id"], "decision": payload.decision, "user_id": user["user_id"], "notes": payload.notes, "status": status_value},
    )
    await db.execute(
        text("""
        UPDATE projects.weekly_budget_items
        SET status=CASE WHEN :decision='rejected' THEN 'rejected' ELSE status END,
            updated_at=NOW()
        WHERE variance_id=:variation_id AND organization_id=:org_id
    """),
        {"variation_id": variation_id, "org_id": user["org_id"], "decision": payload.decision},
    )
    await db.commit()
    return result({"id": str(variation_id), "client_approval_status": payload.decision}, "Variance client decision saved.")


@router.get("/grns")
async def list_site_grns(
    project_id: Optional[UUID] = None,
    engineer_status: Optional[str] = Query(default=None),
    user: dict = Depends(require_permission("procurement.grn.read")),
    db: AsyncSession = Depends(get_db),
):
    filters = ["g.organization_id=:org_id", "g.is_deleted=false"]
    params: dict[str, Any] = {"org_id": user["org_id"], "project_id": project_id, "engineer_status": engineer_status}
    if project_id:
        filters.append("g.project_id=:project_id")
    if engineer_status and engineer_status != "all":
        filters.append("g.engineer_review_status=:engineer_status")
    rows = await db.execute(
        text(f"""
        SELECT g.*, p.name AS project_name, s.name AS supplier_name, st.name AS store_name,
               receiver.full_name AS received_by_name
        FROM procurement.goods_received_notes g
        LEFT JOIN projects.projects p ON p.id=g.project_id AND p.organization_id=g.organization_id
        LEFT JOIN procurement.suppliers s ON s.id=g.supplier_id AND s.organization_id=g.organization_id
        LEFT JOIN procurement.stores st ON st.id=g.store_id AND st.organization_id=g.organization_id
        LEFT JOIN core.users receiver ON receiver.id=g.received_by AND receiver.organization_id=g.organization_id
        WHERE {' AND '.join(filters)}
        ORDER BY g.created_at DESC
        LIMIT 200
    """),
        params,
    )
    data = [dict(row._mapping) for row in rows]
    return result(data, "Site GRNs listed.", len(data))


@router.get("/engineer/workspace")
async def get_site_engineer_workspace(
    user: dict = Depends(require_permission("site_operations.engineer_portal.read")),
    db: AsyncSession = Depends(get_db),
):
    assigned_result = await db.execute(
        text("""
        SELECT DISTINCT p.id, p.name, p.project_code, p.status, sra.site_id, s.name AS site_name
        FROM projects.site_role_assignments sra
        JOIN projects.projects p ON p.id=sra.project_id AND p.organization_id=sra.organization_id AND p.is_deleted=false
        LEFT JOIN projects.sites s ON s.id=sra.site_id AND s.organization_id=sra.organization_id AND s.is_deleted=false
        WHERE sra.organization_id=:org_id
          AND sra.user_id=:user_id
          AND sra.is_active=true
          AND sra.is_deleted=false
          AND UPPER(sra.role_name) IN ('SITE ENGINEER', 'ENGINEER', 'SITE AGENT')
          AND (sra.starts_on IS NULL OR sra.starts_on <= CURRENT_DATE)
          AND (sra.ends_on IS NULL OR sra.ends_on >= CURRENT_DATE)
        ORDER BY p.name
    """),
        {"org_id": user["org_id"], "user_id": user["user_id"]},
    )
    assigned = [dict(row._mapping) for row in assigned_result]
    if not assigned:
        fallback_result = await db.execute(
            text("""
            SELECT id, name, project_code, status, NULL::uuid AS site_id, NULL::text AS site_name
            FROM projects.projects
            WHERE organization_id=:org_id AND is_deleted=false
            ORDER BY name
            LIMIT 100
        """),
            {"org_id": user["org_id"]},
        )
        assigned = [dict(row._mapping) for row in fallback_result]
    return result({"projects": assigned}, "Site Engineer workspace loaded.")


@router.post("/grns/{grn_id}/engineer-decision")
async def decide_grn_engineer(
    grn_id: UUID,
    payload: DecisionPayload,
    user: dict = Depends(require_permission("site_operations.engineer_verify")),
    db: AsyncSession = Depends(get_db),
):
    grn = (
        (
            await db.execute(
                text("""
        SELECT * FROM procurement.goods_received_notes
        WHERE id=:grn_id AND organization_id=:org_id AND is_deleted=false
    """),
                {"grn_id": grn_id, "org_id": user["org_id"]},
            )
        )
        .mappings()
        .first()
    )
    if not grn:
        raise HTTPException(status_code=404, detail="GRN not found.")
    if str(grn["received_by"]) == str(user["user_id"]):
        raise HTTPException(status_code=403, detail="Self-verification is not permitted for GRNs.")
    review_status = "verified" if payload.decision == "approved" else "rejected"
    await db.execute(
        text("""
        UPDATE procurement.goods_received_notes
        SET engineer_review_status=:review_status,
            engineer_reviewed_by=:user_id,
            engineer_reviewed_at=NOW(),
            engineer_review_reason=:reason,
            updated_at=NOW()
        WHERE id=:grn_id AND organization_id=:org_id
    """),
        {"grn_id": grn_id, "org_id": user["org_id"], "user_id": user["user_id"], "review_status": review_status, "reason": payload.reason},
    )
    await emit_event(
        db,
        user=user,
        event_type=f"site.grn.engineer_{review_status}.v1",
        aggregate_type="goods_received_note",
        aggregate_id=grn_id,
        project_id=grn["project_id"],
        event_data={"reason": payload.reason},
    )
    await db.commit()
    return result({"id": str(grn_id), "engineer_review_status": review_status}, f"GRN {review_status} by Site Engineer.")


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
    if not (
        payload.labour_count_completed
        and payload.toolbox_talk_completed
        and payload.ppe_check_completed
    ):
        raise HTTPException(
            status_code=409,
            detail="Labour count, toolbox talk and PPE check must be ticked before the site day can start.",
        )
    values = payload.model_dump(exclude={"weather"})
    try:
        report_id = (
            await db.execute(
                text("""
            INSERT INTO projects.daily_site_reports (
                organization_id, project_id, site_id, report_date, shift, weather, planned_work,
                actual_work, delays, safety_notes, labour_count_completed,
                toolbox_talk_completed, ppe_check_completed, cost_exposure, created_by
            ) VALUES (
                :org_id, :project_id, :site_id, :report_date, :shift, CAST(:weather AS jsonb),
                :planned_work, :actual_work, :delays, :safety_notes, :labour_count_completed,
                :toolbox_talk_completed, :ppe_check_completed, :cost_exposure, :user_id
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
        await emit_role_notification(
            db,
            org_id=user["org_id"],
            role_names=["Site Engineer"],
            title="Toolbox and start-of-day checks captured",
            message=f"Daily report for {payload.report_date} has labour count, toolbox talk and PPE checks ready for technical sign-off.",
            action_url="/portal/site-engineer",
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
        VALUES (:org_id, :approval_id, 1, 'Site Engineer')
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
    await emit_role_notification(
        db,
        org_id=user["org_id"],
        role_names=["Site Engineer"],
        title="Daily report awaiting technical verification",
        message=f"Daily site report for {report['report_date']} needs engineer sign-off.",
        action_url="/portal/site-engineer",
    )
    await db.commit()
    return result(
        {"id": str(report_id), "approval_id": str(approval_id)},
        "Daily site report submitted for approval.",
    )


@router.post("/daily-reports/{report_id}/engineer-decision")
async def engineer_decide_daily_report(
    report_id: UUID,
    payload: DecisionPayload,
    user: dict = Depends(require_permission("site_operations.engineer_verify")),
    db: AsyncSession = Depends(get_db),
):
    report = await report_or_404(db, report_id, user["org_id"])
    if report["status"] != "submitted":
        raise HTTPException(status_code=409, detail="Only submitted daily reports can receive engineer verification.")
    if str(report.get("submitted_by")) == str(user["user_id"]):
        raise HTTPException(status_code=403, detail="Self-verification is not permitted for daily site reports.")
    review_status = "verified" if payload.decision == "approved" else "rejected"
    report_status = "submitted" if payload.decision == "approved" else "rejected"
    await db.execute(
        text("""
        UPDATE projects.daily_site_reports
        SET engineer_review_status=:review_status,
            engineer_reviewed_by=:user_id,
            engineer_reviewed_at=NOW(),
            engineer_review_reason=:reason,
            status=:report_status,
            rejection_reason=CASE WHEN :report_status='rejected' THEN :reason ELSE rejection_reason END,
            updated_at=NOW()
        WHERE id=:report_id AND organization_id=:org_id
    """),
        {
            "report_id": report_id,
            "org_id": user["org_id"],
            "user_id": user["user_id"],
            "reason": payload.reason,
            "review_status": review_status,
            "report_status": report_status,
        },
    )
    await db.execute(
        text("""
        UPDATE core.approval_steps s
        SET status=:decision, decided_by=:user_id, decided_at=NOW(), reason=:reason, updated_at=NOW()
        FROM core.approval_instances ai
        WHERE s.approval_instance_id=ai.id
          AND s.organization_id=:org_id
          AND ai.organization_id=:org_id
          AND ai.workflow_key='daily_site_report_approval'
          AND ai.target_type='daily_site_report'
          AND ai.target_id=:report_id
          AND s.step_number=1
          AND ai.status='pending'
    """),
        {"report_id": report_id, "org_id": user["org_id"], "user_id": user["user_id"], "decision": payload.decision, "reason": payload.reason},
    )
    if payload.decision == "approved":
        approval_id = (
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
        ).scalar()
        if approval_id:
            await db.execute(
                text("""
                INSERT INTO core.approval_steps (organization_id, approval_instance_id, step_number, role_name)
                VALUES (:org_id, :approval_id, 2, 'Site Agent')
                ON CONFLICT (organization_id, approval_instance_id, step_number) DO NOTHING
            """),
                {"org_id": user["org_id"], "approval_id": approval_id},
            )
        await emit_role_notification(
            db,
            org_id=user["org_id"],
            role_names=["Site Agent"],
            title="Daily report ready for Site Agent authorisation",
            message=f"Daily site report for {report['report_date']} has engineer sign-off.",
            action_url="/portal/foreman",
        )
    else:
        await emit_notification(
            db,
            org_id=user["org_id"],
            user_id=str(report["submitted_by"]),
            title="Daily report rejected by Site Engineer",
            message=payload.reason or "Technical verification rejected the daily report.",
        )
    await emit_event(
        db,
        user=user,
        event_type=f"site.daily_report.engineer_{review_status}.v1",
        aggregate_type="daily_site_report",
        aggregate_id=report_id,
        project_id=report["project_id"],
        event_data={"reason": payload.reason},
    )
    await db.commit()
    return result({"id": str(report_id), "engineer_review_status": review_status}, f"Daily report {review_status} by Site Engineer.")


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
        # Note: the daily report's aggregate 'materials' cost_transactions row
        # above already recognises this line's cost - only the stock_ledger
        # consumption movement is recorded here (via record_stock_movement,
        # not issue_stock) to avoid posting the same cost twice.
        await inventory_service.record_stock_movement(
            db,
            user,
            item_id=line["item_id"],
            store_id=line["store_id"],
            project_id=report["project_id"],
            movement_type="consumption",
            quantity=-Decimal(str(line["quantity_used"])),
            unit_cost=Decimal(str(line["unit_cost"] or 0)),
            source_type="daily_report_material",
            source_id=line["id"],
            reference=f"DSR-{report['id']}",
        )
    return posted


@router.post("/daily-reports/{report_id}/decision")
async def decide_daily_report(
    report_id: UUID,
    payload: DecisionPayload,
    user: dict = Depends(require_permission("site_operations.site_agent_authorize")),
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
    if payload.decision == "approved" and report.get("engineer_review_status") != "verified":
        raise HTTPException(
            status_code=409,
            detail="Site Engineer verification is required before Site Agent approval.",
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
            SET status='approved',
                approved_at=NOW(),
                approved_by=:user_id,
                site_agent_approved_at=NOW(),
                site_agent_approved_by=:user_id,
                updated_at=NOW()
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
        WHERE approval_instance_id=:approval_id AND organization_id=:org_id AND step_number=2
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
