"""Tenant-scoped fleet asset, dispatch, compliance and cost controls."""

from datetime import date, datetime
from decimal import Decimal
import json
from typing import Any, Literal, Mapping, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.compliance import validate_employee_deployment
from core.security import get_current_user, require_permission
from app.shared.sql import (
    safe_payload_columns,
    tenant_child_reference_sql,
    tenant_child_rows_sql,
    tenant_reference_sql,
    update_tenant_row_sql,
)

router = APIRouter()


class Payload(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class AssetPayload(Payload):
    vehicle_registration: str = Field(min_length=1, max_length=50)
    vehicle_type: Optional[str] = Field(default=None, max_length=100)
    asset_code: Optional[str] = Field(default=None, max_length=80)
    ownership_type: Literal["owned", "leased", "rented", "subcontracted"] = "owned"
    operational_status: Literal[
        "available", "assigned", "in_service", "out_of_service", "retired"
    ] = "available"
    make: Optional[str] = Field(default=None, max_length=100)
    model: Optional[str] = Field(default=None, max_length=100)
    model_year: Optional[int] = Field(default=None, ge=1900, le=2200)
    vin: Optional[str] = Field(default=None, max_length=80)
    odometer_km: Decimal = Field(
        default=Decimal("0"), ge=0, max_digits=14, decimal_places=2
    )
    engine_hours: Decimal = Field(
        default=Decimal("0"), ge=0, max_digits=14, decimal_places=2
    )
    capacity_description: Optional[str] = Field(default=None, max_length=160)
    home_location: Optional[str] = Field(default=None, max_length=255)
    acquired_on: Optional[date] = None
    retired_on: Optional[date] = None
    notes: Optional[str] = None

    @model_validator(mode="after")
    def valid_dates(self):
        if self.acquired_on and self.retired_on and self.retired_on < self.acquired_on:
            raise ValueError("retired_on cannot precede acquired_on")
        return self


class AssetUpdate(AssetPayload):
    vehicle_registration: Optional[str] = Field(
        default=None, min_length=1, max_length=50
    )


class AssignmentPayload(Payload):
    fleet_id: UUID
    project_id: Optional[UUID] = None
    assigned_to_user_id: Optional[UUID] = None
    operator_employee_id: Optional[UUID] = None
    dispatch_reference: Optional[str] = Field(default=None, max_length=100)
    starts_at: datetime
    ends_at: Optional[datetime] = None
    status: Literal["planned", "dispatched", "active", "completed", "cancelled"] = (
        "planned"
    )
    origin_location: Optional[str] = Field(default=None, max_length=255)
    destination_location: Optional[str] = Field(default=None, max_length=255)
    purpose: Optional[str] = None
    odometer_out: Optional[Decimal] = Field(
        default=None, ge=0, max_digits=14, decimal_places=2
    )
    odometer_in: Optional[Decimal] = Field(
        default=None, ge=0, max_digits=14, decimal_places=2
    )

    @model_validator(mode="after")
    def valid_range(self):
        if self.ends_at and self.ends_at < self.starts_at:
            raise ValueError("ends_at cannot precede starts_at")
        if (
            self.odometer_in is not None
            and self.odometer_out is not None
            and self.odometer_in < self.odometer_out
        ):
            raise ValueError("odometer_in cannot be below odometer_out")
        return self


class InspectionPayload(Payload):
    fleet_id: UUID
    inspection_type: Literal["pre_start", "post_trip", "scheduled", "compliance"]
    inspected_at: Optional[datetime] = None
    outcome: Literal["pass", "conditional", "fail"]
    odometer_km: Optional[Decimal] = Field(
        default=None, ge=0, max_digits=14, decimal_places=2
    )
    engine_hours: Optional[Decimal] = Field(
        default=None, ge=0, max_digits=14, decimal_places=2
    )
    checklist: dict = Field(default_factory=dict)
    notes: Optional[str] = None


class DefectPayload(Payload):
    fleet_id: UUID
    inspection_id: Optional[UUID] = None
    defect_reference: Optional[str] = Field(default=None, max_length=100)
    title: str = Field(min_length=1, max_length=255)
    severity: Literal["low", "medium", "high", "critical"]
    description: Optional[str] = None


class DefectDecision(Payload):
    status: Literal["triaged", "in_repair", "resolved", "deferred"]
    resolution_notes: Optional[str] = None


class WorkOrderPayload(Payload):
    fleet_id: UUID
    defect_id: Optional[UUID] = None
    work_order_number: str = Field(min_length=1, max_length=100)
    maintenance_type: Literal["preventive", "corrective", "inspection", "compliance"]
    priority: Literal["low", "medium", "high", "critical"] = "medium"
    vendor_name: Optional[str] = Field(default=None, max_length=255)
    scheduled_for: Optional[datetime] = None
    estimated_cost: Optional[Decimal] = Field(
        default=None, ge=0, max_digits=15, decimal_places=2
    )
    description: str = Field(min_length=1)


class WorkOrderDecision(Payload):
    status: Literal["scheduled", "in_progress", "completed", "cancelled"]
    actual_cost: Optional[Decimal] = Field(
        default=None, ge=0, max_digits=15, decimal_places=2
    )
    completion_notes: Optional[str] = None


class FuelPayload(Payload):
    fleet_id: UUID
    assignment_id: Optional[UUID] = None
    project_id: Optional[UUID] = None
    transaction_at: Optional[datetime] = None
    fuel_type: str = Field(min_length=1, max_length=32)
    quantity_litres: Decimal = Field(gt=0, max_digits=14, decimal_places=3)
    unit_cost: Optional[Decimal] = Field(
        default=None, ge=0, max_digits=15, decimal_places=4
    )
    total_cost: Optional[Decimal] = Field(
        default=None, ge=0, max_digits=15, decimal_places=2
    )
    odometer_km: Optional[Decimal] = Field(
        default=None, ge=0, max_digits=14, decimal_places=2
    )
    supplier_name: Optional[str] = Field(default=None, max_length=255)
    receipt_reference: Optional[str] = Field(default=None, max_length=120)


class UtilizationPayload(Payload):
    fleet_id: UUID
    assignment_id: Optional[UUID] = None
    project_id: Optional[UUID] = None
    occurred_on: date
    operating_hours: Decimal = Field(
        default=Decimal("0"), ge=0, le=24, max_digits=10, decimal_places=2
    )
    distance_km: Decimal = Field(
        default=Decimal("0"), ge=0, max_digits=14, decimal_places=2
    )
    idle_hours: Decimal = Field(
        default=Decimal("0"), ge=0, le=24, max_digits=10, decimal_places=2
    )
    odometer_km: Optional[Decimal] = Field(
        default=None, ge=0, max_digits=14, decimal_places=2
    )
    engine_hours: Optional[Decimal] = Field(
        default=None, ge=0, max_digits=14, decimal_places=2
    )
    notes: Optional[str] = None

    @model_validator(mode="after")
    def idle_not_more_than_operating(self):
        if self.idle_hours > self.operating_hours:
            raise ValueError("idle_hours cannot exceed operating_hours")
        return self


class MeterReadingPayload(Payload):
    occurred_on: date = Field(default_factory=date.today)
    assignment_id: Optional[UUID] = None
    project_id: Optional[UUID] = None
    operating_hours: Decimal = Field(
        default=Decimal("0"), ge=0, le=24, max_digits=10, decimal_places=2
    )
    distance_km: Decimal = Field(
        default=Decimal("0"), ge=0, max_digits=14, decimal_places=2
    )
    idle_hours: Decimal = Field(
        default=Decimal("0"), ge=0, le=24, max_digits=10, decimal_places=2
    )
    odometer_km: Optional[Decimal] = Field(
        default=None, ge=0, max_digits=14, decimal_places=2
    )
    engine_hours: Optional[Decimal] = Field(
        default=None, ge=0, max_digits=14, decimal_places=2
    )
    fuel_litres: Optional[Decimal] = Field(
        default=None, gt=0, max_digits=14, decimal_places=3
    )
    fuel_unit_cost: Optional[Decimal] = Field(
        default=None, ge=0, max_digits=15, decimal_places=4
    )
    notes: Optional[str] = None

    @model_validator(mode="after")
    def idle_not_more_than_operating(self):
        if self.idle_hours > self.operating_hours:
            raise ValueError("idle_hours cannot exceed operating_hours")
        return self


def result(data, message: str, total: Optional[int] = None):
    return {
        "success": True,
        "data": data,
        "message": message,
        "meta": {} if total is None else {"total": total},
    }


async def asset_or_404(db: AsyncSession, fleet_id: UUID, org_id: str) -> dict[str, Any]:
    row = await db.execute(
        text(
            "SELECT * FROM fleet.fleet WHERE id=:id AND organization_id=:org_id AND is_deleted=false"
        ),
        {"id": fleet_id, "org_id": org_id},
    )
    asset = row.mappings().first()
    if not asset:
        raise HTTPException(status_code=404, detail="Fleet asset not found")
    return dict(asset)


async def tenant_reference(
    db: AsyncSession, table: str, record_id: Optional[UUID], org_id: str, label: str
):
    if record_id is None:
        return
    allowed = {
        "projects.projects",
        "core.users",
        "fleet.fleet_inspections",
        "fleet.fleet_defects",
        "fleet.fleet_assignments",
    }
    if table not in allowed:
        raise HTTPException(status_code=500, detail="Unsupported reference validation")
    found = await db.execute(
        tenant_reference_sql(table, allowed),
        {"id": record_id, "org_id": org_id},
    )
    if not found.scalar():
        raise HTTPException(status_code=404, detail=f"{label} not found")


async def asset_reference(
    db: AsyncSession,
    table: str,
    record_id: Optional[UUID],
    fleet_id: UUID,
    org_id: str,
    label: str,
):
    if record_id is None:
        return
    found = await db.execute(
        tenant_child_reference_sql(
            table,
            "fleet_id",
            {"fleet.fleet_inspections", "fleet.fleet_defects"},
            {"fleet_id"},
        ),
        {"id": record_id, "parent_id": fleet_id, "org_id": org_id},
    )
    if not found.scalar():
        raise HTTPException(
            status_code=404, detail=f"{label} does not belong to the fleet asset"
        )


async def emit_event(
    db: AsyncSession,
    *,
    user: dict,
    event_type: str,
    aggregate_type: str,
    aggregate_id: UUID,
    project_id: Optional[UUID],
    event_payload: Mapping[str, Any],
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
            "payload": json.dumps(event_payload, default=str),
        },
    )


async def resolve_project_id(
    db: AsyncSession,
    *,
    org_id: str,
    fleet_id: UUID,
    assignment_id: Optional[UUID],
    explicit_project_id: Optional[UUID],
) -> Optional[UUID]:
    if assignment_id:
        assignment = (
            (
                await db.execute(
                    text("""
            SELECT project_id FROM fleet.fleet_assignments
            WHERE id=:assignment_id AND fleet_id=:fleet_id AND organization_id=:org_id AND is_deleted=false
        """),
                    {
                        "assignment_id": assignment_id,
                        "fleet_id": fleet_id,
                        "org_id": org_id,
                    },
                )
            )
            .mappings()
            .first()
        )
        if not assignment:
            raise HTTPException(
                status_code=404, detail="Assignment does not belong to the fleet asset"
            )
        assignment_project_id = assignment["project_id"]
        if (
            explicit_project_id
            and assignment_project_id
            and explicit_project_id != assignment_project_id
        ):
            raise HTTPException(
                status_code=409, detail="Project does not match the selected assignment"
            )
        return explicit_project_id or assignment_project_id
    await tenant_reference(
        db, "projects.projects", explicit_project_id, org_id, "Project"
    )
    return explicit_project_id


async def post_equipment_cost(
    db: AsyncSession,
    *,
    user: dict,
    project_id: Optional[UUID],
    source_type: str,
    source_id: UUID,
    description: str,
    quantity: Decimal,
    unit_cost: Decimal,
    amount: Decimal,
    transaction_date: date,
) -> Optional[UUID]:
    if project_id is None or amount <= 0:
        return None
    row = await db.execute(
        text("""
        INSERT INTO finance.cost_transactions (
            organization_id, project_id, source_type, source_id, cost_category,
            description, quantity, unit_cost, amount, transaction_date, posted_by
        ) VALUES (
            :org_id, :project_id, :source_type, :source_id, 'equipment',
            :description, :quantity, :unit_cost, :amount, :transaction_date, :user_id
        )
        ON CONFLICT (organization_id, source_type, source_id, cost_category) DO UPDATE
        SET description=EXCLUDED.description,
            quantity=EXCLUDED.quantity,
            unit_cost=EXCLUDED.unit_cost,
            amount=EXCLUDED.amount,
            transaction_date=EXCLUDED.transaction_date,
            posted_by=EXCLUDED.posted_by,
            posted_at=NOW()
        RETURNING id
    """),
        {
            "org_id": user["org_id"],
            "project_id": project_id,
            "source_type": source_type,
            "source_id": source_id,
            "description": description,
            "quantity": quantity,
            "unit_cost": unit_cost,
            "amount": amount,
            "transaction_date": transaction_date,
            "user_id": user["user_id"],
        },
    )
    return row.scalar()


@router.get("/summary")
async def summary(
    user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    row = (
        (
            await db.execute(
                text("""SELECT COUNT(*) FILTER (WHERE operational_status='available') AS available,
        COUNT(*) FILTER (WHERE operational_status IN ('assigned','in_service')) AS deployed,
        COUNT(*) FILTER (WHERE operational_status='out_of_service') AS out_of_service,
        COUNT(*) AS total_assets,
        COUNT(d.id) FILTER (WHERE d.status IN ('open','triaged','in_repair') AND d.severity IN ('high','critical')) AS critical_defects,
        COUNT(w.id) FILTER (WHERE w.status IN ('open','scheduled','in_progress') AND w.priority IN ('high','critical')) AS priority_work_orders
        FROM fleet.fleet f LEFT JOIN fleet.fleet_defects d ON d.fleet_id=f.id AND d.organization_id=f.organization_id AND d.is_deleted=false
        LEFT JOIN fleet.maintenance_work_orders w ON w.fleet_id=f.id AND w.organization_id=f.organization_id AND w.is_deleted=false
        WHERE f.organization_id=:org_id AND f.is_deleted=false"""),
                {"org_id": user["org_id"]},
            )
        )
        .mappings()
        .one()
    )
    return result(dict(row), "Fleet operational summary.")


@router.get("/")
async def list_assets(user: dict = Depends(require_permission("fleet.read")), db: AsyncSession = Depends(get_db)):  # fmt: skip
    rows = await db.execute(
        text("""SELECT f.*,
        COALESCE(defects.active_defects_count, 0) AS unresolved_defects,
        COALESCE(defects.active_defects_count, 0) AS active_defects_count,
        COALESCE(util.operating_hours_month, 0) AS operating_hours_month,
        COALESCE(util.idle_hours_month, 0) AS idle_hours_month,
        ROUND(CASE WHEN COALESCE(util.operating_hours_month + util.idle_hours_month, 0) > 0
          THEN (util.operating_hours_month / NULLIF(util.operating_hours_month + util.idle_hours_month, 0)) * 100
          ELSE 0 END, 2) AS utilization_pct,
        COALESCE(util.monthly_revenue, 0) AS monthly_revenue,
        COALESCE(util.utilization_cost_month, 0)
          + COALESCE(fuel.fuel_cost_month, 0)
          + COALESCE(maint.maintenance_cost_month, 0)
          + COALESCE(f.monthly_ownership_cost, 0) AS monthly_operating_cost,
        COALESCE(fuel.fuel_cost_month, 0) AS fuel_cost_month,
        COALESCE(maint.maintenance_cost_month, 0) AS maintenance_cost_month
        FROM fleet.fleet f
        LEFT JOIN LATERAL (
          SELECT COUNT(*) AS active_defects_count
          FROM fleet.fleet_defects d
          WHERE d.fleet_id=f.id AND d.organization_id=f.organization_id AND d.is_deleted=false
            AND d.status IN ('open','triaged','in_repair')
        ) defects ON true
        LEFT JOIN LATERAL (
          SELECT COALESCE(SUM(operating_hours), 0) AS operating_hours_month,
                 COALESCE(SUM(idle_hours), 0) AS idle_hours_month,
                 COALESCE(SUM(revenue_amount), 0) AS monthly_revenue,
                 COALESCE(SUM(cost_amount), 0) AS utilization_cost_month
          FROM fleet.utilization_logs u
          WHERE u.fleet_id=f.id AND u.organization_id=f.organization_id AND u.is_deleted=false
            AND u.occurred_on >= date_trunc('month', CURRENT_DATE)::date
        ) util ON true
        LEFT JOIN LATERAL (
          SELECT COALESCE(SUM(total_cost), 0) AS fuel_cost_month
          FROM fleet.fuel_transactions ft
          WHERE ft.fleet_id=f.id AND ft.organization_id=f.organization_id AND ft.is_deleted=false
            AND ft.transaction_at >= date_trunc('month', CURRENT_DATE)
        ) fuel ON true
        LEFT JOIN LATERAL (
          SELECT COALESCE(SUM(actual_cost), 0) AS maintenance_cost_month
          FROM fleet.maintenance_work_orders wo
          WHERE wo.fleet_id=f.id AND wo.organization_id=f.organization_id AND wo.is_deleted=false
            AND wo.status='completed' AND wo.completed_at >= date_trunc('month', CURRENT_DATE)
        ) maint ON true
        WHERE f.organization_id=:org_id AND f.is_deleted=false ORDER BY f.asset_code NULLS LAST, f.vehicle_registration LIMIT 500"""),
        {"org_id": user["org_id"]},
    )
    data = [dict(r._mapping) for r in rows]
    return result(data, "Fleet assets listed.", len(data))


@router.post("/", status_code=status.HTTP_201_CREATED)
async def create_asset(
    payload: AssetPayload,
    user: dict = Depends(require_permission("fleet.create")),
    db: AsyncSession = Depends(get_db),
):
    try:
        new_id = (
            await db.execute(
                text("""INSERT INTO fleet.fleet (organization_id,created_by,vehicle_registration,vehicle_type,asset_code,ownership_type,operational_status,make,model,model_year,vin,odometer_km,engine_hours,capacity_description,home_location,acquired_on,retired_on,notes)
           VALUES (:org_id,:user_id,:vehicle_registration,:vehicle_type,:asset_code,:ownership_type,:operational_status,:make,:model,:model_year,:vin,:odometer_km,:engine_hours,:capacity_description,:home_location,:acquired_on,:retired_on,:notes) RETURNING id"""),
                {
                    **payload.model_dump(),
                    "org_id": user["org_id"],
                    "user_id": user["sub"],
                },
            )
        ).scalar()
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=409, detail="Asset code or registration already exists"
        ) from exc
    return result({"id": str(new_id)}, "Fleet asset created.")


@router.put("/{fleet_id}")
async def update_asset(
    fleet_id: UUID,
    payload: AssetUpdate,
    user: dict = Depends(require_permission("fleet.update")),
    db: AsyncSession = Depends(get_db),
):
    await asset_or_404(db, fleet_id, user["org_id"])
    values = payload.model_dump(exclude_unset=True)
    if not values:
        return result({"id": str(fleet_id)}, "No fields to update.")
    try:
        safe_keys = safe_payload_columns(values.keys())
        await db.execute(
            update_tenant_row_sql(
                "fleet.fleet",
                safe_keys,
                AssetUpdate.model_fields,
                id_param="fleet_id",
                require_not_deleted=False,
            ),
            {**values, "fleet_id": fleet_id, "org_id": user["org_id"]},
        )
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=409, detail="Asset code or registration already exists"
        ) from exc
    return result({"id": str(fleet_id)}, "Fleet asset updated.")


@router.get("/assignments")
async def list_assignments(user: dict = Depends(require_permission("fleet.read")), db: AsyncSession = Depends(get_db)):  # fmt: skip
    rows = await db.execute(
        text(
            "SELECT * FROM fleet.fleet_assignments WHERE organization_id=:org_id AND is_deleted=false ORDER BY starts_at DESC LIMIT 500"
        ),
        {"org_id": user["org_id"]},
    )
    return result([dict(r._mapping) for r in rows], "Assignments listed.")


@router.post("/assignments", status_code=status.HTTP_201_CREATED)
async def create_assignment(
    payload: AssignmentPayload,
    user: dict = Depends(require_permission("fleet.create")),
    db: AsyncSession = Depends(get_db),
):
    asset = await asset_or_404(db, payload.fleet_id, user["org_id"])
    await tenant_reference(
        db, "projects.projects", payload.project_id, user["org_id"], "Project"
    )
    await tenant_reference(
        db, "core.users", payload.assigned_to_user_id, user["org_id"], "Assignee"
    )
    operator_employee_id = payload.operator_employee_id
    if operator_employee_id is None and payload.assigned_to_user_id is not None:
        operator = (
            (
                await db.execute(
                    text("""
            SELECT id FROM hr.employees
            WHERE organization_id=:org_id
              AND linked_user_id=:assigned_to_user_id
              AND is_deleted=false
            LIMIT 1
        """),
                    {
                        "org_id": user["org_id"],
                        "assigned_to_user_id": payload.assigned_to_user_id,
                    },
                )
            )
            .mappings()
            .first()
        )
        operator_employee_id = operator["id"] if operator else None
    compliance_gate_check_id = None
    if payload.status in ("dispatched", "active") and operator_employee_id is not None:
        compliance_gate_check_id = await validate_employee_deployment(
            db,
            user=user,
            employee_id=operator_employee_id,
            gate_type="equipment_assignment",
            project_id=payload.project_id,
            effective_date=payload.starts_at.date(),
            role_on_project="Equipment Operator",
            fleet_id=payload.fleet_id,
            equipment_type=asset.get("vehicle_type"),
            source_type="fleet_assignment",
        )
    conflict = await db.execute(
        text("""SELECT 1 FROM fleet.fleet_assignments WHERE organization_id=:org_id AND fleet_id=:fleet_id AND is_deleted=false AND status IN ('planned','dispatched','active')
        AND tstzrange(starts_at, COALESCE(ends_at, 'infinity'::timestamptz), '[]')
            && tstzrange(CAST(:starts_at AS timestamptz), COALESCE(CAST(:ends_at AS timestamptz), 'infinity'::timestamptz), '[]')"""),
        {**payload.model_dump(), "org_id": user["org_id"]},
    )
    if conflict.scalar():
        raise HTTPException(
            status_code=409, detail="Asset has an overlapping active assignment"
        )
    row = await db.execute(
        text("""INSERT INTO fleet.fleet_assignments (organization_id,fleet_id,project_id,assigned_to_user_id,operator_employee_id,dispatch_reference,starts_at,ends_at,status,origin_location,destination_location,purpose,odometer_out,odometer_in,compliance_gate_check_id,created_by)
        VALUES (:org_id,:fleet_id,:project_id,:assigned_to_user_id,:operator_employee_id,:dispatch_reference,:starts_at,:ends_at,:status,:origin_location,:destination_location,:purpose,:odometer_out,:odometer_in,:compliance_gate_check_id,:user_id) RETURNING id"""),
        {
            **payload.model_dump(),
            "operator_employee_id": operator_employee_id,
            "compliance_gate_check_id": compliance_gate_check_id,
            "org_id": user["org_id"],
            "user_id": user["sub"],
        },
    )
    assignment_id = row.scalar()
    if compliance_gate_check_id:
        await db.execute(
            text("""
            UPDATE compliance.deployment_gate_checks
            SET source_id=:assignment_id
            WHERE id=:check_id AND organization_id=:org_id
        """),
            {
                "assignment_id": assignment_id,
                "check_id": compliance_gate_check_id,
                "org_id": user["org_id"],
            },
        )
    if payload.status in ("dispatched", "active"):
        await db.execute(
            text("""
            UPDATE fleet.fleet
            SET operational_status=CASE WHEN :status='active' THEN 'in_service' ELSE 'assigned' END,
                current_project_id=:project_id,
                current_assignment_id=:assignment_id,
                updated_at=NOW()
            WHERE id=:fleet_id AND organization_id=:org_id
        """),
            {
                **payload.model_dump(),
                "assignment_id": assignment_id,
                "org_id": user["org_id"],
            },
        )
    await emit_event(
        db,
        user=user,
        event_type="equipment.deployed.v1",
        aggregate_type="fleet_assignment",
        aggregate_id=assignment_id,
        project_id=payload.project_id,
        event_payload=payload.model_dump(mode="json"),
    )
    await db.commit()
    return result({"id": str(assignment_id)}, "Fleet assignment created.")


@router.post("/inspections", status_code=status.HTTP_201_CREATED)
async def create_inspection(
    payload: InspectionPayload,
    user: dict = Depends(require_permission("fleet.create")),
    db: AsyncSession = Depends(get_db),
):
    await asset_or_404(db, payload.fleet_id, user["org_id"])
    row = await db.execute(
        text("""INSERT INTO fleet.fleet_inspections (organization_id,fleet_id,inspection_type,inspected_at,inspector_id,outcome,odometer_km,engine_hours,checklist,notes,created_by)
        VALUES (:org_id,:fleet_id,:inspection_type,COALESCE(:inspected_at,NOW()),:user_id,:outcome,:odometer_km,:engine_hours,CAST(:checklist AS jsonb),:notes,:user_id) RETURNING id"""),
        {
            **payload.model_dump(),
            "checklist": json.dumps(payload.checklist),
            "org_id": user["org_id"],
            "user_id": user["sub"],
        },
    )
    inspection_id = row.scalar()
    if payload.outcome == "fail":
        await db.execute(
            text(
                "UPDATE fleet.fleet SET operational_status='out_of_service', updated_at=NOW() WHERE id=:fleet_id AND organization_id=:org_id"
            ),
            {"fleet_id": payload.fleet_id, "org_id": user["org_id"]},
        )
    await emit_event(
        db,
        user=user,
        event_type="equipment.inspection_recorded.v1",
        aggregate_type="fleet_inspection",
        aggregate_id=inspection_id,
        project_id=None,
        event_payload=payload.model_dump(mode="json"),
    )
    await db.commit()
    return result({"id": str(inspection_id)}, "Inspection recorded.")


@router.post("/defects", status_code=status.HTTP_201_CREATED)
async def create_defect(
    payload: DefectPayload,
    user: dict = Depends(require_permission("fleet.create")),
    db: AsyncSession = Depends(get_db),
):
    await asset_or_404(db, payload.fleet_id, user["org_id"])
    await asset_reference(
        db,
        "fleet.fleet_inspections",
        payload.inspection_id,
        payload.fleet_id,
        user["org_id"],
        "Inspection",
    )
    row = await db.execute(
        text("""INSERT INTO fleet.fleet_defects (organization_id,fleet_id,inspection_id,defect_reference,title,severity,description,reported_by)
        VALUES (:org_id,:fleet_id,:inspection_id,:defect_reference,:title,:severity,:description,:user_id) RETURNING id"""),
        {**payload.model_dump(), "org_id": user["org_id"], "user_id": user["sub"]},
    )
    defect_id = row.scalar()
    if payload.severity in ("high", "critical"):
        await db.execute(
            text(
                "UPDATE fleet.fleet SET operational_status='out_of_service', updated_at=NOW() WHERE id=:fleet_id AND organization_id=:org_id"
            ),
            {"fleet_id": payload.fleet_id, "org_id": user["org_id"]},
        )
    await emit_event(
        db,
        user=user,
        event_type="equipment.breakdown_reported.v1",
        aggregate_type="fleet_defect",
        aggregate_id=defect_id,
        project_id=None,
        event_payload=payload.model_dump(mode="json"),
    )
    await db.commit()
    return result({"id": str(defect_id)}, "Defect recorded.")


@router.patch("/defects/{defect_id}/decision")
async def decide_defect(
    defect_id: UUID,
    payload: DefectDecision,
    user: dict = Depends(require_permission("fleet.update")),
    db: AsyncSession = Depends(get_db),
):
    row = await db.execute(
        text("""UPDATE fleet.fleet_defects SET status=:status,resolution_notes=:resolution_notes,
        resolved_at=CASE WHEN :status='resolved' THEN NOW() ELSE NULL END,resolved_by=CASE WHEN :status='resolved' THEN :user_id ELSE NULL END,updated_at=NOW()
        WHERE id=:id AND organization_id=:org_id AND is_deleted=false AND status <> 'resolved' RETURNING id"""),
        {
            **payload.model_dump(),
            "id": defect_id,
            "org_id": user["org_id"],
            "user_id": user["sub"],
        },
    )
    if not row.scalar():
        raise HTTPException(
            status_code=409, detail="Defect not found or already resolved"
        )
    await db.commit()
    return result({"id": str(defect_id)}, "Defect updated.")


@router.post("/work-orders", status_code=status.HTTP_201_CREATED)
async def create_work_order(
    payload: WorkOrderPayload,
    user: dict = Depends(require_permission("fleet.create")),
    db: AsyncSession = Depends(get_db),
):
    await asset_or_404(db, payload.fleet_id, user["org_id"])
    await asset_reference(
        db,
        "fleet.fleet_defects",
        payload.defect_id,
        payload.fleet_id,
        user["org_id"],
        "Defect",
    )
    try:
        row = await db.execute(
            text("""INSERT INTO fleet.maintenance_work_orders (organization_id,fleet_id,defect_id,work_order_number,maintenance_type,priority,vendor_name,scheduled_for,estimated_cost,description,created_by)
            VALUES (:org_id,:fleet_id,:defect_id,:work_order_number,:maintenance_type,:priority,:vendor_name,:scheduled_for,:estimated_cost,:description,:user_id) RETURNING id"""),
            {**payload.model_dump(), "org_id": user["org_id"], "user_id": user["sub"]},
        )
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=409, detail="Work order number already exists"
        ) from exc
    return result({"id": str(row.scalar())}, "Maintenance work order created.")


@router.patch("/work-orders/{work_order_id}/decision")
async def decide_work_order(
    work_order_id: UUID,
    payload: WorkOrderDecision,
    user: dict = Depends(require_permission("fleet.update")),
    db: AsyncSession = Depends(get_db),
):
    work_order = (
        (
            await db.execute(
                text("""
        SELECT wo.*, fa.project_id AS assignment_project_id
        FROM fleet.maintenance_work_orders wo
        LEFT JOIN fleet.fleet f ON f.id=wo.fleet_id AND f.organization_id=wo.organization_id
        LEFT JOIN fleet.fleet_assignments fa ON fa.id=f.current_assignment_id AND fa.organization_id=wo.organization_id
        WHERE wo.id=:id AND wo.organization_id=:org_id AND wo.is_deleted=false
    """),
                {"id": work_order_id, "org_id": user["org_id"]},
            )
        )
        .mappings()
        .first()
    )
    if not work_order:
        raise HTTPException(status_code=404, detail="Work order not found")
    project_id = work_order["project_id"] or work_order["assignment_project_id"]
    row = await db.execute(
        text("""UPDATE fleet.maintenance_work_orders SET status=CAST(:status AS varchar),actual_cost=COALESCE(:actual_cost,actual_cost),completion_notes=COALESCE(:completion_notes,completion_notes),
        project_id=COALESCE(project_id, :project_id),
        started_at=CASE WHEN CAST(:status AS varchar)='in_progress' THEN COALESCE(started_at,NOW()) ELSE started_at END,
        completed_at=CASE WHEN CAST(:status AS varchar)='completed' THEN NOW() ELSE completed_at END,
        completed_by=CASE WHEN CAST(:status AS varchar)='completed' THEN :user_id ELSE completed_by END,updated_at=NOW()
        WHERE id=:id AND organization_id=:org_id AND is_deleted=false AND status NOT IN ('completed','cancelled') RETURNING id"""),
        {
            **payload.model_dump(),
            "id": work_order_id,
            "org_id": user["org_id"],
            "user_id": user["sub"],
            "project_id": project_id,
        },
    )
    if not row.scalar():
        raise HTTPException(status_code=409, detail="Work order not found or closed")
    if (
        payload.status == "completed"
        and payload.actual_cost
        and payload.actual_cost > 0
    ):
        cost_id = await post_equipment_cost(
            db,
            user=user,
            project_id=project_id,
            source_type="fleet_maintenance_work_order",
            source_id=work_order_id,
            description=f"Equipment maintenance: {work_order['work_order_number']}",
            quantity=Decimal("1"),
            unit_cost=payload.actual_cost,
            amount=payload.actual_cost,
            transaction_date=date.today(),
        )
        await db.execute(
            text(
                "UPDATE fleet.maintenance_work_orders SET cost_transaction_id=:cost_id WHERE id=:id AND organization_id=:org_id"
            ),
            {"cost_id": cost_id, "id": work_order_id, "org_id": user["org_id"]},
        )
        await emit_event(
            db,
            user=user,
            event_type="finance.actual_cost_created.v1",
            aggregate_type="maintenance_work_order",
            aggregate_id=work_order_id,
            project_id=project_id,
            event_payload={
                "amount": str(payload.actual_cost),
                "cost_transaction_id": str(cost_id) if cost_id else None,
            },
        )
    await emit_event(
        db,
        user=user,
        event_type="equipment.service_completed.v1"
        if payload.status == "completed"
        else "equipment.service_status_updated.v1",
        aggregate_type="maintenance_work_order",
        aggregate_id=work_order_id,
        project_id=project_id,
        event_payload=payload.model_dump(mode="json"),
    )
    await db.commit()
    return result({"id": str(work_order_id)}, "Work order updated.")


@router.post("/fuel", status_code=status.HTTP_201_CREATED)
async def record_fuel(
    payload: FuelPayload,
    user: dict = Depends(require_permission("fleet.create")),
    db: AsyncSession = Depends(get_db),
):
    await asset_or_404(db, payload.fleet_id, user["org_id"])
    project_id = await resolve_project_id(
        db,
        org_id=user["org_id"],
        fleet_id=payload.fleet_id,
        assignment_id=payload.assignment_id,
        explicit_project_id=payload.project_id,
    )
    unit_cost = payload.unit_cost or Decimal("0")
    total_cost = (
        payload.total_cost
        if payload.total_cost is not None
        else (payload.quantity_litres * unit_cost).quantize(Decimal("0.01"))
    )
    row = await db.execute(
        text("""INSERT INTO fleet.fuel_transactions (organization_id,fleet_id,transaction_at,fuel_type,quantity_litres,unit_cost,total_cost,odometer_km,supplier_name,receipt_reference,recorded_by)
        VALUES (:org_id,:fleet_id,COALESCE(:transaction_at,NOW()),:fuel_type,:quantity_litres,:unit_cost,:total_cost,:odometer_km,:supplier_name,:receipt_reference,:user_id) RETURNING id"""),
        {
            **payload.model_dump(),
            "unit_cost": unit_cost,
            "total_cost": total_cost,
            "org_id": user["org_id"],
            "user_id": user["sub"],
        },
    )
    fuel_id = row.scalar()
    await db.execute(
        text("""
        UPDATE fleet.fuel_transactions
        SET assignment_id=:assignment_id, project_id=:project_id
        WHERE id=:id AND organization_id=:org_id
    """),
        {
            "assignment_id": payload.assignment_id,
            "project_id": project_id,
            "id": fuel_id,
            "org_id": user["org_id"],
        },
    )
    cost_id = await post_equipment_cost(
        db,
        user=user,
        project_id=project_id,
        source_type="fleet_fuel_transaction",
        source_id=fuel_id,
        description=f"Equipment fuel: {payload.quantity_litres}L {payload.fuel_type}",
        quantity=payload.quantity_litres,
        unit_cost=unit_cost,
        amount=total_cost,
        transaction_date=(
            payload.transaction_at.date() if payload.transaction_at else date.today()
        ),
    )
    await db.execute(
        text(
            "UPDATE fleet.fuel_transactions SET cost_transaction_id=:cost_id WHERE id=:id AND organization_id=:org_id"
        ),
        {"cost_id": cost_id, "id": fuel_id, "org_id": user["org_id"]},
    )
    await emit_event(
        db,
        user=user,
        event_type="equipment.fuel_recorded.v1",
        aggregate_type="fuel_transaction",
        aggregate_id=fuel_id,
        project_id=project_id,
        event_payload={
            **payload.model_dump(mode="json"),
            "total_cost": str(total_cost),
            "cost_transaction_id": str(cost_id) if cost_id else None,
        },
    )
    if cost_id:
        await emit_event(
            db,
            user=user,
            event_type="finance.actual_cost_created.v1",
            aggregate_type="fuel_transaction",
            aggregate_id=fuel_id,
            project_id=project_id,
            event_payload={
                "amount": str(total_cost),
                "cost_transaction_id": str(cost_id),
            },
        )
    await db.commit()
    return result(
        {"id": str(fuel_id), "cost_transaction_id": str(cost_id) if cost_id else None},
        "Fuel transaction recorded.",
    )


@router.post("/utilization", status_code=status.HTTP_201_CREATED)
async def record_utilization(
    payload: UtilizationPayload,
    user: dict = Depends(require_permission("fleet.create")),
    db: AsyncSession = Depends(get_db),
):
    asset = await asset_or_404(db, payload.fleet_id, user["org_id"])
    project_id = await resolve_project_id(
        db,
        org_id=user["org_id"],
        fleet_id=payload.fleet_id,
        assignment_id=payload.assignment_id,
        explicit_project_id=payload.project_id,
    )
    hourly_cost = asset.get("hourly_operating_cost") or Decimal("0")
    idle_cost = asset.get("idle_hour_cost") or Decimal("0")
    hourly_rate = asset.get("hourly_charge_rate") or Decimal("0")
    cost_amount = (
        (payload.operating_hours * hourly_cost) + (payload.idle_hours * idle_cost)
    ).quantize(Decimal("0.01"))
    revenue_amount = (payload.operating_hours * hourly_rate).quantize(Decimal("0.01"))
    row = await db.execute(
        text("""INSERT INTO fleet.utilization_logs (organization_id,fleet_id,assignment_id,project_id,occurred_on,operating_hours,distance_km,idle_hours,odometer_km,engine_hours,revenue_amount,cost_amount,notes,recorded_by)
        VALUES (:org_id,:fleet_id,:assignment_id,:project_id,:occurred_on,:operating_hours,:distance_km,:idle_hours,:odometer_km,:engine_hours,:revenue_amount,:cost_amount,:notes,:user_id) RETURNING id"""),
        {
            **payload.model_dump(),
            "project_id": project_id,
            "revenue_amount": revenue_amount,
            "cost_amount": cost_amount,
            "org_id": user["org_id"],
            "user_id": user["sub"],
        },
    )
    utilization_id = row.scalar()
    if payload.odometer_km is not None or payload.engine_hours is not None:
        await db.execute(
            text("""
            UPDATE fleet.fleet
            SET odometer_km=GREATEST(odometer_km, COALESCE(:odometer_km, odometer_km)),
                engine_hours=GREATEST(engine_hours, COALESCE(:engine_hours, engine_hours)),
                updated_at=NOW()
            WHERE id=:fleet_id AND organization_id=:org_id
        """),
            {
                "odometer_km": payload.odometer_km,
                "engine_hours": payload.engine_hours,
                "fleet_id": payload.fleet_id,
                "org_id": user["org_id"],
            },
        )
    cost_id = await post_equipment_cost(
        db,
        user=user,
        project_id=project_id,
        source_type="fleet_utilization_log",
        source_id=utilization_id,
        description=f"Equipment utilization: {payload.operating_hours} operating hours",
        quantity=payload.operating_hours,
        unit_cost=hourly_cost,
        amount=cost_amount,
        transaction_date=payload.occurred_on,
    )
    await db.execute(
        text(
            "UPDATE fleet.utilization_logs SET cost_transaction_id=:cost_id WHERE id=:id AND organization_id=:org_id"
        ),
        {"cost_id": cost_id, "id": utilization_id, "org_id": user["org_id"]},
    )
    await emit_event(
        db,
        user=user,
        event_type="equipment.utilization_recorded.v1",
        aggregate_type="fleet_utilization_log",
        aggregate_id=utilization_id,
        project_id=project_id,
        event_payload={
            **payload.model_dump(mode="json"),
            "cost_amount": str(cost_amount),
            "revenue_amount": str(revenue_amount),
            "cost_transaction_id": str(cost_id) if cost_id else None,
        },
    )
    if cost_id:
        await emit_event(
            db,
            user=user,
            event_type="finance.actual_cost_created.v1",
            aggregate_type="fleet_utilization_log",
            aggregate_id=utilization_id,
            project_id=project_id,
            event_payload={
                "amount": str(cost_amount),
                "cost_transaction_id": str(cost_id),
            },
        )
    await db.commit()
    return result(
        {
            "id": str(utilization_id),
            "cost_transaction_id": str(cost_id) if cost_id else None,
        },
        "Utilization recorded.",
    )


@router.get("/{fleet_id}/inspections")
async def list_asset_inspections(fleet_id: UUID, user: dict = Depends(require_permission("fleet.read")), db: AsyncSession = Depends(get_db)):  # fmt: skip
    await asset_or_404(db, fleet_id, user["org_id"])
    rows = await db.execute(
        text("""
        SELECT * FROM fleet.fleet_inspections
        WHERE fleet_id=:fleet_id AND organization_id=:org_id AND is_deleted=false
        ORDER BY inspected_at DESC LIMIT 100
    """),
        {"fleet_id": fleet_id, "org_id": user["org_id"]},
    )
    return result([dict(row._mapping) for row in rows], "Fleet inspections listed.")


@router.post("/{fleet_id}/inspections", status_code=status.HTTP_201_CREATED)
async def create_asset_inspection(
    fleet_id: UUID,
    payload: InspectionPayload,
    user: dict = Depends(require_permission("fleet.create")),
    db: AsyncSession = Depends(get_db),
):
    if payload.fleet_id != fleet_id:
        raise HTTPException(
            status_code=409, detail="Path asset does not match inspection payload"
        )
    return await create_inspection(payload, user, db)


@router.post("/{fleet_id}/defects", status_code=status.HTTP_201_CREATED)
async def create_asset_defect(
    fleet_id: UUID,
    payload: DefectPayload,
    user: dict = Depends(require_permission("fleet.create")),
    db: AsyncSession = Depends(get_db),
):
    if payload.fleet_id != fleet_id:
        raise HTTPException(
            status_code=409, detail="Path asset does not match defect payload"
        )
    return await create_defect(payload, user, db)


@router.post("/{fleet_id}/meter-readings", status_code=status.HTTP_201_CREATED)
async def record_meter_reading(
    fleet_id: UUID,
    payload: MeterReadingPayload,
    user: dict = Depends(require_permission("fleet.create")),
    db: AsyncSession = Depends(get_db),
):
    utilization = UtilizationPayload(
        fleet_id=fleet_id,
        assignment_id=payload.assignment_id,
        project_id=payload.project_id,
        occurred_on=payload.occurred_on,
        operating_hours=payload.operating_hours,
        distance_km=payload.distance_km,
        idle_hours=payload.idle_hours,
        odometer_km=payload.odometer_km,
        engine_hours=payload.engine_hours,
        notes=payload.notes,
    )
    recorded = await record_utilization(utilization, user, db)
    if payload.fuel_litres:
        fuel = FuelPayload(
            fleet_id=fleet_id,
            assignment_id=payload.assignment_id,
            project_id=payload.project_id,
            fuel_type="diesel",
            quantity_litres=payload.fuel_litres,
            unit_cost=payload.fuel_unit_cost or Decimal("0"),
            odometer_km=payload.odometer_km,
            receipt_reference="meter-reading",
        )
        await record_fuel(fuel, user, db)
    return recorded


@router.get("/{fleet_id}")
async def get_asset(fleet_id: UUID, user: dict = Depends(require_permission("fleet.read")), db: AsyncSession = Depends(get_db)):  # fmt: skip
    """Return one asset with its recent, tenant-scoped operational history."""
    asset = (
        (
            await db.execute(
                text(
                    "SELECT * FROM fleet.fleet WHERE id=:id AND organization_id=:org_id AND is_deleted=false"
                ),
                {"id": fleet_id, "org_id": user["org_id"]},
            )
        )
        .mappings()
        .first()
    )
    if not asset:
        raise HTTPException(status_code=404, detail="Fleet asset not found")
    tables = {
        "assignments": ("fleet.fleet_assignments", "starts_at"),
        "inspections": ("fleet.fleet_inspections", "inspected_at"),
        "defects": ("fleet.fleet_defects", "reported_at"),
        "work_orders": ("fleet.maintenance_work_orders", "created_at"),
        "fuel_transactions": ("fleet.fuel_transactions", "transaction_at"),
        "utilization": ("fleet.utilization_logs", "occurred_on"),
    }
    detail = {"asset": dict(asset)}
    for key, (table, order_column) in tables.items():
        rows = await db.execute(
            tenant_child_rows_sql(
                table,
                order_column,
                {table for table, _ in tables.values()},
                {order_column for _, order_column in tables.values()},
            ),
            {"fleet_id": fleet_id, "org_id": user["org_id"]},
        )
        detail[key] = [dict(row._mapping) for row in rows]
    return result(detail, "Fleet asset operational detail.")


@router.delete("/{fleet_id}")
async def retire_asset(
    fleet_id: UUID,
    user: dict = Depends(require_permission("fleet.delete")),
    db: AsyncSession = Depends(get_db),
):
    row = await db.execute(
        text(
            "UPDATE fleet.fleet SET is_deleted=true,operational_status='retired',retired_on=COALESCE(retired_on,CURRENT_DATE),updated_at=NOW() WHERE id=:id AND organization_id=:org_id AND is_deleted=false RETURNING id"
        ),
        {"id": fleet_id, "org_id": user["org_id"]},
    )
    if not row.scalar():
        raise HTTPException(status_code=404, detail="Fleet asset not found")
    await db.commit()
    return result(None, "Fleet asset retired.")
