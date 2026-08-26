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
from app.services.finance.department_transfers import post_department_transfer
from app.shared.task_stacks import generate_task_stack

router = APIRouter()


PLANT_READINESS_CONTROLS: dict[str, str] = {
    "technical_specification": "Plant Manager technical specification not approved",
    "source_decision": "Internal allocation, hire, purchase or subcontract source decision missing",
    "budget_approval": "Approved plant budget or cost plan missing",
    "asset_identified": "Asset number or external hire asset not identified",
    "availability_no_overlap": "Allocation conflict check not confirmed",
    "inspection_fit": "Pre-dispatch inspection has not declared the asset fit",
    "compliance_documents": "Insurance, licences, permits or certificates incomplete",
    "operator_verified": "Competent operator assignment not verified",
    "site_readiness": "Site access, unloading and working area readiness not confirmed",
    "transport_approved": "Transport method, route, permit or cost approval missing",
    "fuel_controls": "Fuel allocation and register controls missing",
    "maintenance_controls": "Maintenance, pre-start and breakdown controls missing",
    "plant_manager_declaration": "Plant Manager readiness declaration missing",
}


def normalize_plant_readiness_pack(raw: Mapping[str, Any] | None) -> dict[str, bool]:
    source = raw or {}
    return {key: bool(source.get(key)) for key in PLANT_READINESS_CONTROLS}


def merge_plant_readiness_pack(
    current: Mapping[str, Any] | None, update: Mapping[str, Any] | None = None
) -> dict[str, bool]:
    merged = normalize_plant_readiness_pack(current)
    if update:
        for key in PLANT_READINESS_CONTROLS:
            if key in update:
                merged[key] = bool(update[key])
    return merged


def plant_readiness_blockers(
    pack: Mapping[str, Any] | None, *, operator_required: bool = False, has_operator: bool = False
) -> list[str]:
    normalized = normalize_plant_readiness_pack(pack)
    blockers = [label for key, label in PLANT_READINESS_CONTROLS.items() if not normalized[key]]
    if operator_required and not has_operator and "Competent operator assignment not verified" not in blockers:
        blockers.append("Competent operator assignment not verified")
    return blockers


def plant_readiness_status(blockers: list[str], pack: Mapping[str, Any] | None) -> str:
    if not any(normalize_plant_readiness_pack(pack).values()):
        return "not_started"
    return "ready" if not blockers else "blocked"


class Payload(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class AssetPayload(Payload):
    vehicle_registration: str = Field(min_length=1, max_length=50)
    vehicle_type: Optional[str] = Field(default=None, max_length=100)
    asset_code: Optional[str] = Field(default=None, max_length=80)
    ownership_type: Literal["owned", "leased", "hired_in", "financed", "rented", "subcontracted"] = "owned"
    operational_status: Literal[
        "available",
        "reserved",
        "mobilisation_pending",
        "deployed",
        "operating",
        "idle_on_site",
        "under_inspection",
        "scheduled_maintenance",
        "breakdown",
        "under_repair",
        "awaiting_parts",
        "hired_out",
        "hired_in",
        "quarantined",
        "decommissioned",
        "disposed",
        "assigned",
        "in_service",
        "out_of_service",
        "retired",
    ] = "available"
    asset_category: Optional[str] = Field(default=None, max_length=80)
    asset_type: Optional[str] = Field(default=None, max_length=120)
    make: Optional[str] = Field(default=None, max_length=100)
    model: Optional[str] = Field(default=None, max_length=100)
    model_year: Optional[int] = Field(default=None, ge=1900, le=2200)
    vin: Optional[str] = Field(default=None, max_length=80)
    serial_number: Optional[str] = Field(default=None, max_length=120)
    chassis_number: Optional[str] = Field(default=None, max_length=120)
    supplier_id: Optional[UUID] = None
    supplier_name: Optional[str] = Field(default=None, max_length=255)
    purchase_date: Optional[date] = None
    acquisition_cost: Optional[Decimal] = Field(default=None, ge=0, max_digits=15, decimal_places=2)
    current_book_value: Optional[Decimal] = Field(default=None, ge=0, max_digits=15, decimal_places=2)
    useful_life_months: Optional[int] = Field(default=None, gt=0)
    odometer_km: Decimal = Field(
        default=Decimal("0"), ge=0, max_digits=14, decimal_places=2
    )
    engine_hours: Decimal = Field(
        default=Decimal("0"), ge=0, max_digits=14, decimal_places=2
    )
    capacity_description: Optional[str] = Field(default=None, max_length=160)
    home_location: Optional[str] = Field(default=None, max_length=255)
    current_location: Optional[str] = Field(default=None, max_length=255)
    responsible_custodian: Optional[str] = Field(default=None, max_length=255)
    meter_type: Literal["kilometres", "engine_hours", "cycles"] = "engine_hours"
    current_meter_reading: Decimal = Field(default=Decimal("0"), ge=0, max_digits=14, decimal_places=2)
    acquired_on: Optional[date] = None
    insurance_provider: Optional[str] = Field(default=None, max_length=160)
    insurance_policy_number: Optional[str] = Field(default=None, max_length=160)
    insurance_expiry_date: Optional[date] = None
    licence_number: Optional[str] = Field(default=None, max_length=160)
    licence_expiry_date: Optional[date] = None
    warranty_provider: Optional[str] = Field(default=None, max_length=160)
    warranty_expiry_date: Optional[date] = None
    photo_urls: list[str] = Field(default_factory=list)
    qr_code_value: Optional[str] = Field(default=None, max_length=255)
    barcode_value: Optional[str] = Field(default=None, max_length=255)
    disposal_status: Literal["in_service", "marked_for_disposal", "under_disposal", "disposed"] = "in_service"
    disposal_date: Optional[date] = None
    finance_provider: Optional[str] = Field(default=None, max_length=160)
    lease_contract_reference: Optional[str] = Field(default=None, max_length=160)
    expected_replacement_date: Optional[date] = None
    replacement_reason: Optional[str] = None
    retired_on: Optional[date] = None
    notes: Optional[str] = None
    owning_department_id: Optional[UUID] = None
    # Rate card - the columns exist on fleet.fleet (024_equipment_finance_integration.sql)
    # and record_utilization already reads them off the asset row, but until now
    # nothing exposed them for the caller to actually set.
    hourly_charge_rate: Decimal = Field(
        default=Decimal("0"), ge=0, max_digits=15, decimal_places=4
    )
    hourly_operating_cost: Decimal = Field(
        default=Decimal("0"), ge=0, max_digits=15, decimal_places=4
    )
    idle_hour_cost: Decimal = Field(
        default=Decimal("0"), ge=0, max_digits=15, decimal_places=4
    )
    monthly_ownership_cost: Decimal = Field(
        default=Decimal("0"), ge=0, max_digits=15, decimal_places=2
    )

    @model_validator(mode="after")
    def valid_dates(self):
        if self.acquired_on and self.retired_on and self.retired_on < self.acquired_on:
            raise ValueError("retired_on cannot precede acquired_on")
        if self.acquired_on and self.disposal_date and self.disposal_date < self.acquired_on:
            raise ValueError("disposal_date cannot precede acquired_on")
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
    inspection_type: Literal[
        "pre_start",
        "post_operation",
        "post_trip",
        "weekly",
        "mobilisation",
        "demobilisation",
        "maintenance",
        "accident",
        "hired_in",
        "statutory",
        "scheduled",
        "compliance",
    ]
    inspected_at: Optional[datetime] = None
    outcome: Literal["pass", "conditional", "fail"]
    severity: Optional[Literal["minor", "moderate", "critical", "catastrophic"]] = None
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
    severity: Literal["low", "medium", "high", "minor", "moderate", "critical", "catastrophic"]
    description: Optional[str] = None


class DefectDecision(Payload):
    status: Literal["triaged", "in_repair", "resolved", "deferred", "supervisor_approval", "asset_locked", "escalated"]
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
    status: Literal[
        "reported",
        "assessed",
        "awaiting_approval",
        "awaiting_parts",
        "scheduled",
        "in_progress",
        "testing",
        "completed",
        "returned_to_service",
        "closed",
        "cancelled",
    ]
    actual_cost: Optional[Decimal] = Field(
        default=None, ge=0, max_digits=15, decimal_places=2
    )
    completion_notes: Optional[str] = None


class FuelPayload(Payload):
    fleet_id: UUID
    assignment_id: Optional[UUID] = None
    project_id: Optional[UUID] = None
    plant_request_id: Optional[UUID] = None
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
    storage_tank: Optional[str] = Field(default=None, max_length=120)
    issued_to_operator_employee_id: Optional[UUID] = None
    cost_centre: Optional[str] = Field(default=None, max_length=120)
    receiver_signature: Optional[str] = None
    tank_balance_after: Optional[Decimal] = Field(default=None, ge=0, max_digits=14, decimal_places=3)
    actual_consumption_litres: Optional[Decimal] = Field(default=None, ge=0, max_digits=14, decimal_places=3)
    duplicate_slip_hash: Optional[str] = Field(default=None, max_length=160)
    expected_consumption_litres: Optional[Decimal] = Field(
        default=None, ge=0, max_digits=14, decimal_places=3
    )


class UtilizationPayload(Payload):
    fleet_id: UUID
    assignment_id: Optional[UUID] = None
    project_id: Optional[UUID] = None
    plant_request_id: Optional[UUID] = None
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
    productive_hours: Optional[Decimal] = Field(
        default=None, ge=0, le=24, max_digits=10, decimal_places=2
    )
    downtime_hours: Optional[Decimal] = Field(
        default=None, ge=0, le=24, max_digits=10, decimal_places=2
    )
    work_performed: Optional[str] = None
    supervisor_approval: Optional[str] = Field(default=None, max_length=255)
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
    plant_request_id: Optional[UUID] = None
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
    expected_consumption_litres: Optional[Decimal] = Field(
        default=None, ge=0, max_digits=14, decimal_places=3
    )
    actual_consumption_litres: Optional[Decimal] = Field(
        default=None, ge=0, max_digits=14, decimal_places=3
    )
    storage_tank: Optional[str] = Field(default=None, max_length=120)
    receipt_reference: Optional[str] = Field(default=None, max_length=120)
    cost_centre: Optional[str] = Field(default=None, max_length=120)
    receiver_signature: Optional[str] = None
    tank_balance_after: Optional[Decimal] = Field(
        default=None, ge=0, max_digits=14, decimal_places=3
    )
    productive_hours: Optional[Decimal] = Field(
        default=None, ge=0, le=24, max_digits=10, decimal_places=2
    )
    downtime_hours: Optional[Decimal] = Field(
        default=None, ge=0, le=24, max_digits=10, decimal_places=2
    )
    work_performed: Optional[str] = None
    supervisor_approval: Optional[str] = Field(default=None, max_length=255)
    notes: Optional[str] = None

    @model_validator(mode="after")
    def idle_not_more_than_operating(self):
        if self.idle_hours > self.operating_hours:
            raise ValueError("idle_hours cannot exceed operating_hours")
        if self.productive_hours is not None and self.productive_hours > self.operating_hours:
            raise ValueError("productive_hours cannot exceed operating_hours")
        return self


class PlantRequestPayload(Payload):
    request_type: Literal[
        "internal_project",
        "external_hire",
        "maintenance",
        "emergency",
        "mobilisation",
        "department_transfer",
        "tender_capacity",
    ]
    requesting_department_id: Optional[UUID] = None
    project_id: Optional[UUID] = None
    client_id: Optional[UUID] = None
    client_name: Optional[str] = Field(default=None, max_length=255)
    requested_by_user_id: Optional[UUID] = None
    approver_user_id: Optional[UUID] = None
    required_asset_type: str = Field(min_length=1, max_length=120)
    specification: Optional[str] = None
    attachments_required: Optional[str] = None
    quantity: int = Field(default=1, gt=0)
    work_location: str = Field(min_length=1, max_length=255)
    start_date: date
    end_date: Optional[date] = None
    operating_hours_mode: Literal["normal", "extended", "continuous"] = "normal"
    operator_required: bool = False
    fuel_responsibility: Literal["snc", "project", "client"] = "snc"
    transport_requirement: Literal[
        "low_bed", "tow", "drive", "collection", "none"
    ] = "drive"
    work_description: str = Field(min_length=1)
    cost_centre: Optional[str] = Field(default=None, max_length=120)
    priority: Literal["routine", "urgent", "emergency"] = "routine"
    commercial_terms: dict = Field(default_factory=dict)
    risk_assessment: dict = Field(default_factory=dict)
    readiness_pack: dict = Field(default_factory=dict)
    expected_revenue: Decimal = Field(
        default=Decimal("0"), ge=0, max_digits=15, decimal_places=2
    )
    estimated_cost: Decimal = Field(
        default=Decimal("0"), ge=0, max_digits=15, decimal_places=2
    )
    risk_level: Literal["low", "normal", "high", "critical"] = "normal"

    @model_validator(mode="after")
    def valid_request_dates(self):
        if self.end_date and self.end_date < self.start_date:
            raise ValueError("end_date cannot precede start_date")
        return self


class PlantRequestStatusPayload(Payload):
    status: Literal[
        "submitted",
        "under_validation",
        "returned_for_correction",
        "rejected",
        "availability_check",
        "awaiting_cost_review",
        "awaiting_risk_review",
        "awaiting_approval",
        "approved",
        "cancelled",
    ]
    notes: Optional[str] = None
    expected_revenue: Optional[Decimal] = Field(
        default=None, ge=0, max_digits=15, decimal_places=2
    )
    estimated_cost: Optional[Decimal] = Field(
        default=None, ge=0, max_digits=15, decimal_places=2
    )
    risk_level: Optional[Literal["low", "normal", "high", "critical"]] = None
    readiness_pack: Optional[dict] = None


class PlantReservationPayload(Payload):
    fleet_id: UUID
    reserved_from: datetime
    reserved_until: Optional[datetime] = None
    conditions: Optional[str] = None

    @model_validator(mode="after")
    def valid_reservation_range(self):
        if self.reserved_until and self.reserved_until < self.reserved_from:
            raise ValueError("reserved_until cannot precede reserved_from")
        return self


class PlantDispatchPayload(Payload):
    fleet_id: UUID
    reservation_id: Optional[UUID] = None
    project_id: Optional[UUID] = None
    assigned_to_user_id: Optional[UUID] = None
    operator_employee_id: Optional[UUID] = None
    dispatch_at: Optional[datetime] = None
    destination_location: str = Field(min_length=1, max_length=255)
    origin_location: Optional[str] = Field(default=None, max_length=255)
    transport_instructions: Optional[str] = None
    receiving_party: Optional[str] = Field(default=None, max_length=255)
    handover_signatures: dict = Field(default_factory=dict)
    dispatch_pack: dict = Field(default_factory=dict)
    odometer_out: Optional[Decimal] = Field(
        default=None, ge=0, max_digits=14, decimal_places=2
    )
    engine_hours: Optional[Decimal] = Field(
        default=None, ge=0, max_digits=14, decimal_places=2
    )
    fuel_level: Optional[str] = Field(default=None, max_length=80)
    notes: Optional[str] = None


class PlantIncidentPayload(Payload):
    fleet_id: UUID
    assignment_id: Optional[UUID] = None
    incident_type: Literal[
        "breakdown",
        "injury",
        "property_damage",
        "theft",
        "fire",
        "overturn",
        "environmental",
        "third_party_claim",
        "operator_misconduct",
        "fuel_variance",
        "parts_fraud",
        "downtime",
        "other",
    ]
    severity: Literal["low", "medium", "high", "critical"] = "medium"
    occurred_at: Optional[datetime] = None
    location: Optional[str] = Field(default=None, max_length=255)
    meter_reading: Optional[Decimal] = Field(
        default=None, ge=0, max_digits=14, decimal_places=2
    )
    description: str = Field(min_length=1)
    open_work_order: bool = False
    estimated_repair_cost: Optional[Decimal] = Field(
        default=None, ge=0, max_digits=15, decimal_places=2
    )


class PlantOffHirePayload(Payload):
    fleet_id: UUID
    assignment_id: Optional[UUID] = None
    final_working_at: datetime
    final_meter_reading: Optional[Decimal] = Field(
        default=None, ge=0, max_digits=14, decimal_places=2
    )
    final_fuel_level: Optional[str] = Field(default=None, max_length=80)
    release_reason: Literal[
        "work_completed",
        "hire_expired",
        "client_terminated",
        "project_released",
        "asset_recalled",
        "unsafe",
        "payment_breach",
        "contract_breach",
        "other",
    ]
    transport_required: bool = False
    confirmation_party: Optional[str] = Field(default=None, max_length=255)
    notes: Optional[str] = None


class PlantReturnInspectionPayload(Payload):
    fleet_id: UUID
    off_hire_id: Optional[UUID] = None
    outcome: Literal[
        "good_condition",
        "minor_maintenance",
        "major_repair",
        "client_damage",
        "missing_items",
        "service_due",
        "safety_block",
    ]
    final_meter_reading: Optional[Decimal] = Field(
        default=None, ge=0, max_digits=14, decimal_places=2
    )
    final_fuel_level: Optional[str] = Field(default=None, max_length=80)
    damage_notes: Optional[str] = None
    missing_items: Optional[str] = None
    cleaning_required: bool = False
    quarantine_required: bool = False
    claim_amount: Optional[Decimal] = Field(
        default=None, ge=0, max_digits=15, decimal_places=2
    )


class PlantFinancialClosurePayload(Payload):
    status: Literal["draft", "under_review", "posted", "disputed", "closed"] = "closed"
    internal_charge_amount: Decimal = Field(
        default=Decimal("0"), ge=0, max_digits=15, decimal_places=2
    )
    external_invoice_amount: Decimal = Field(
        default=Decimal("0"), ge=0, max_digits=15, decimal_places=2
    )
    operator_cost_amount: Decimal = Field(
        default=Decimal("0"), ge=0, max_digits=15, decimal_places=2
    )
    fuel_cost_amount: Decimal = Field(
        default=Decimal("0"), ge=0, max_digits=15, decimal_places=2
    )
    transport_cost_amount: Decimal = Field(
        default=Decimal("0"), ge=0, max_digits=15, decimal_places=2
    )
    maintenance_cost_amount: Decimal = Field(
        default=Decimal("0"), ge=0, max_digits=15, decimal_places=2
    )
    damage_charge_amount: Decimal = Field(
        default=Decimal("0"), ge=0, max_digits=15, decimal_places=2
    )
    discount_amount: Decimal = Field(
        default=Decimal("0"), ge=0, max_digits=15, decimal_places=2
    )
    tax_amount: Decimal = Field(
        default=Decimal("0"), ge=0, max_digits=15, decimal_places=2
    )
    outstanding_balance: Decimal = Field(
        default=Decimal("0"), ge=0, max_digits=15, decimal_places=2
    )
    invoice_reference: Optional[str] = Field(default=None, max_length=120)
    finance_notes: Optional[str] = None


class OperatorProfilePayload(Payload):
    employee_id: Optional[UUID] = None
    contractor_name: Optional[str] = Field(default=None, max_length=255)
    assigned_asset_types: list[str] = Field(default_factory=list)
    licence_classes: list[str] = Field(default_factory=list)
    operator_certificates: list[dict] = Field(default_factory=list)
    training_records: list[dict] = Field(default_factory=list)
    medical_clearance_expiry: Optional[date] = None
    competency_status: Literal["pending", "competent", "restricted", "expired", "suspended"] = "pending"
    current_assignment_id: Optional[UUID] = None
    incident_count: int = Field(default=0, ge=0)
    performance_score: Optional[Decimal] = Field(
        default=None, ge=0, le=100, max_digits=5, decimal_places=2
    )
    performance_history: list[dict] = Field(default_factory=list)
    incidents_and_violations: list[dict] = Field(default_factory=list)
    suspended: bool = False
    notes: Optional[str] = None

    @model_validator(mode="after")
    def has_identity(self):
        if not self.employee_id and not self.contractor_name:
            raise ValueError("employee_id or contractor_name is required")
        return self


class ExternalHireAgreementPayload(Payload):
    plant_request_id: Optional[UUID] = None
    customer_id: Optional[UUID] = None
    customer_name: Optional[str] = Field(default=None, max_length=255)
    hire_agreement_number: Optional[str] = Field(default=None, max_length=120)
    status: Literal[
        "enquiry",
        "quoted",
        "approved",
        "agreement_signed",
        "deposit_pending",
        "dispatched",
        "active",
        "off_hire_requested",
        "returned",
        "invoice_instruction",
        "debtor_follow_up",
        "closed",
        "cancelled",
    ] = "enquiry"
    hire_type: Literal["dry_hire", "wet_hire", "hourly", "daily", "weekly_monthly", "output_based"] = "wet_hire"
    rate_card: dict = Field(default_factory=dict)
    deposit_required: Decimal = Field(default=Decimal("0"), ge=0, max_digits=15, decimal_places=2)
    fuel_responsibility: Literal["snc", "project", "client"] = "client"
    mobilisation_charge: Decimal = Field(default=Decimal("0"), ge=0, max_digits=15, decimal_places=2)
    demobilisation_charge: Decimal = Field(default=Decimal("0"), ge=0, max_digits=15, decimal_places=2)
    standing_time_rate: Optional[Decimal] = Field(default=None, ge=0, max_digits=15, decimal_places=4)
    overtime_rate: Optional[Decimal] = Field(default=None, ge=0, max_digits=15, decimal_places=4)
    damage_recovery_amount: Decimal = Field(default=Decimal("0"), ge=0, max_digits=15, decimal_places=2)
    invoice_instruction: Optional[str] = None
    debtor_follow_up_status: Literal["not_started", "pending", "contacted", "disputed", "paid", "escalated", "closed"] = "not_started"
    debtor_follow_up_notes: Optional[str] = None


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
        "crm.contacts",
        "finance.departments",
        "hr.employees",
        "fleet.fleet_inspections",
        "fleet.fleet_defects",
        "fleet.fleet_assignments",
        "fleet.plant_requests",
        "fleet.plant_reservations",
        "fleet.off_hire_records",
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
            AND wo.status IN ('completed','returned_to_service','closed') AND wo.completed_at >= date_trunc('month', CURRENT_DATE)
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
        params = payload.model_dump()
        params["photo_urls"] = json.dumps(params.get("photo_urls") or [])
        new_id = (
            await db.execute(
                text("""INSERT INTO fleet.fleet (
                    organization_id,created_by,vehicle_registration,vehicle_type,asset_code,ownership_type,operational_status,
                    asset_category,asset_type,make,model,model_year,vin,serial_number,chassis_number,supplier_id,supplier_name,
                    purchase_date,acquisition_cost,current_book_value,useful_life_months,odometer_km,engine_hours,
                    capacity_description,home_location,current_location,responsible_custodian,meter_type,current_meter_reading,
                    acquired_on,insurance_provider,insurance_policy_number,insurance_expiry_date,licence_number,licence_expiry_date,
                    warranty_provider,warranty_expiry_date,photo_urls,qr_code_value,barcode_value,disposal_status,disposal_date,
                    finance_provider,lease_contract_reference,expected_replacement_date,replacement_reason,retired_on,notes,
                    owning_department_id,hourly_charge_rate,hourly_operating_cost,idle_hour_cost,monthly_ownership_cost
                )
                VALUES (
                    :org_id,:user_id,:vehicle_registration,:vehicle_type,:asset_code,:ownership_type,:operational_status,
                    :asset_category,:asset_type,:make,:model,:model_year,:vin,:serial_number,:chassis_number,:supplier_id,:supplier_name,
                    :purchase_date,:acquisition_cost,:current_book_value,:useful_life_months,:odometer_km,:engine_hours,
                    :capacity_description,:home_location,:current_location,:responsible_custodian,:meter_type,:current_meter_reading,
                    :acquired_on,:insurance_provider,:insurance_policy_number,:insurance_expiry_date,:licence_number,:licence_expiry_date,
                    :warranty_provider,:warranty_expiry_date,CAST(:photo_urls AS jsonb),:qr_code_value,:barcode_value,:disposal_status,:disposal_date,
                    :finance_provider,:lease_contract_reference,:expected_replacement_date,:replacement_reason,:retired_on,:notes,
                    :owning_department_id,:hourly_charge_rate,:hourly_operating_cost,:idle_hour_cost,:monthly_ownership_cost
                ) RETURNING id"""),
                {
                    **params,
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
    await generate_task_stack(
        db, org_id=user["org_id"], entity_type="fleet", entity_id=new_id, created_by=user["sub"],
    )
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
    if "photo_urls" in values:
        values["photo_urls"] = json.dumps(values["photo_urls"] or [])
    try:
        safe_keys = safe_payload_columns(values.keys())
        await db.execute(
            update_tenant_row_sql(
                "fleet.fleet",
                safe_keys,
                AssetUpdate.model_fields,
                id_param="fleet_id",
                require_not_deleted=False,
                casts={"photo_urls": "jsonb"},
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


@router.get("/operator-profiles")
async def list_operator_profiles(
    user: dict = Depends(require_permission("fleet.operator_profiles.read")),
    db: AsyncSession = Depends(get_db),
):
    rows = await db.execute(
        text("""
            SELECT op.*, e.employee_name, e.employee_number
            FROM fleet.operator_profiles op
            LEFT JOIN hr.employees e ON e.id=op.employee_id AND e.organization_id=op.organization_id
            WHERE op.organization_id=:org_id AND op.is_deleted=false
            ORDER BY op.suspended ASC, op.competency_status, COALESCE(e.employee_name, op.contractor_name)
            LIMIT 500
        """),
        {"org_id": user["org_id"]},
    )
    return result([dict(row._mapping) for row in rows], "Operator profiles listed.")


@router.post("/operator-profiles", status_code=status.HTTP_201_CREATED)
async def create_operator_profile(
    payload: OperatorProfilePayload,
    user: dict = Depends(require_permission("fleet.operator_profiles.create")),
    db: AsyncSession = Depends(get_db),
):
    await tenant_reference(db, "hr.employees", payload.employee_id, user["org_id"], "Employee")
    await tenant_reference(db, "fleet.fleet_assignments", payload.current_assignment_id, user["org_id"], "Assignment")
    row = await db.execute(
        text("""
            INSERT INTO fleet.operator_profiles (
                organization_id, employee_id, contractor_name, assigned_asset_types, licence_classes,
                operator_certificates, training_records, medical_clearance_expiry, competency_status,
                current_assignment_id, incident_count, performance_score, performance_history, incidents_and_violations, suspended, notes, created_by
            ) VALUES (
                :org_id, :employee_id, :contractor_name, :assigned_asset_types, :licence_classes,
                CAST(:operator_certificates AS jsonb), CAST(:training_records AS jsonb), :medical_clearance_expiry, :competency_status,
                :current_assignment_id, :incident_count, :performance_score, CAST(:performance_history AS jsonb), CAST(:incidents_and_violations AS jsonb), :suspended, :notes, :user_id
            )
            RETURNING id
        """),
        {
            **payload.model_dump(),
            "operator_certificates": json.dumps(payload.operator_certificates),
            "training_records": json.dumps(payload.training_records),
            "performance_history": json.dumps(payload.performance_history),
            "incidents_and_violations": json.dumps(payload.incidents_and_violations),
            "org_id": user["org_id"],
            "user_id": user["sub"],
        },
    )
    await db.commit()
    return result({"id": str(row.scalar())}, "Operator profile created.")


@router.patch("/operator-profiles/{profile_id}")
async def update_operator_profile(
    profile_id: UUID,
    payload: OperatorProfilePayload,
    user: dict = Depends(require_permission("fleet.operator_profiles.update")),
    db: AsyncSession = Depends(get_db),
):
    await tenant_reference(db, "hr.employees", payload.employee_id, user["org_id"], "Employee")
    await tenant_reference(db, "fleet.fleet_assignments", payload.current_assignment_id, user["org_id"], "Assignment")
    updated = await db.execute(
        text("""
            UPDATE fleet.operator_profiles
            SET employee_id=:employee_id,
                contractor_name=:contractor_name,
                assigned_asset_types=:assigned_asset_types,
                licence_classes=:licence_classes,
                operator_certificates=CAST(:operator_certificates AS jsonb),
                training_records=CAST(:training_records AS jsonb),
                medical_clearance_expiry=:medical_clearance_expiry,
                competency_status=:competency_status,
                current_assignment_id=:current_assignment_id,
                incident_count=:incident_count,
                performance_score=:performance_score,
                performance_history=CAST(:performance_history AS jsonb),
                incidents_and_violations=CAST(:incidents_and_violations AS jsonb),
                suspended=:suspended,
                notes=:notes,
                updated_at=NOW()
            WHERE id=:profile_id AND organization_id=:org_id AND is_deleted=false
            RETURNING id
        """),
        {
            **payload.model_dump(),
            "operator_certificates": json.dumps(payload.operator_certificates),
            "training_records": json.dumps(payload.training_records),
            "performance_history": json.dumps(payload.performance_history),
            "incidents_and_violations": json.dumps(payload.incidents_and_violations),
            "profile_id": profile_id,
            "org_id": user["org_id"],
        },
    )
    if not updated.scalar():
        raise HTTPException(status_code=404, detail="Operator profile not found")
    await db.commit()
    return result({"id": str(profile_id)}, "Operator profile updated.")


@router.get("/external-hire-agreements")
async def list_external_hire_agreements(
    user: dict = Depends(require_permission("fleet.external_hire.read")),
    db: AsyncSession = Depends(get_db),
):
    rows = await db.execute(
        text("""
            SELECT eha.*, pr.request_number, pr.required_asset_type, pr.work_location
            FROM fleet.external_hire_agreements eha
            LEFT JOIN fleet.plant_requests pr ON pr.id=eha.plant_request_id AND pr.organization_id=eha.organization_id
            WHERE eha.organization_id=:org_id AND eha.is_deleted=false
            ORDER BY eha.updated_at DESC
            LIMIT 500
        """),
        {"org_id": user["org_id"]},
    )
    return result([dict(row._mapping) for row in rows], "External hire agreements listed.")


@router.post("/external-hire-agreements", status_code=status.HTTP_201_CREATED)
async def create_external_hire_agreement(
    payload: ExternalHireAgreementPayload,
    user: dict = Depends(require_permission("fleet.external_hire.create")),
    db: AsyncSession = Depends(get_db),
):
    await tenant_reference(db, "fleet.plant_requests", payload.plant_request_id, user["org_id"], "Plant request")
    await tenant_reference(db, "crm.contacts", payload.customer_id, user["org_id"], "Customer")
    row = await db.execute(
        text("""
            INSERT INTO fleet.external_hire_agreements (
                organization_id, plant_request_id, customer_id, customer_name, hire_agreement_number, status, hire_type, rate_card,
                deposit_required, fuel_responsibility, mobilisation_charge, demobilisation_charge,
                standing_time_rate, overtime_rate, damage_recovery_amount, invoice_instruction,
                debtor_follow_up_status, debtor_follow_up_notes, created_by
            ) VALUES (
                :org_id, :plant_request_id, :customer_id, :customer_name, :hire_agreement_number, :status, :hire_type, CAST(:rate_card AS jsonb),
                :deposit_required, :fuel_responsibility, :mobilisation_charge, :demobilisation_charge,
                :standing_time_rate, :overtime_rate, :damage_recovery_amount, :invoice_instruction,
                :debtor_follow_up_status, :debtor_follow_up_notes, :user_id
            ) RETURNING id
        """),
        {
            **payload.model_dump(),
            "rate_card": json.dumps(payload.rate_card),
            "org_id": user["org_id"],
            "user_id": user["sub"],
        },
    )
    await db.commit()
    return result({"id": str(row.scalar())}, "External hire agreement created.")


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
            SET operational_status=CASE WHEN :status='active' THEN 'operating' ELSE 'deployed' END,
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
        text("""INSERT INTO fleet.fleet_inspections (organization_id,fleet_id,inspection_type,inspected_at,inspector_id,outcome,severity,odometer_km,engine_hours,checklist,notes,return_to_service_required,created_by)
        VALUES (:org_id,:fleet_id,:inspection_type,COALESCE(:inspected_at,NOW()),:user_id,:outcome,:severity,:odometer_km,:engine_hours,CAST(:checklist AS jsonb),:notes,:return_to_service_required,:user_id) RETURNING id"""),
        {
            **payload.model_dump(),
            "checklist": json.dumps(payload.checklist),
            "return_to_service_required": payload.outcome == "fail" or payload.severity in ("critical", "catastrophic"),
            "org_id": user["org_id"],
            "user_id": user["sub"],
        },
    )
    inspection_id = row.scalar()
    if payload.outcome == "fail" or payload.severity in ("critical", "catastrophic"):
        await db.execute(
            text(
                "UPDATE fleet.fleet SET operational_status=CASE WHEN :severity='catastrophic' THEN 'breakdown' ELSE 'quarantined' END, updated_at=NOW() WHERE id=:fleet_id AND organization_id=:org_id"
            ),
            {"fleet_id": payload.fleet_id, "severity": payload.severity, "org_id": user["org_id"]},
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
    system_action = {
        "minor": "corrective_task",
        "moderate": "supervisor_approval",
        "critical": "lock_asset",
        "catastrophic": "management_escalation",
    }.get(payload.severity)
    initial_status = {
        "moderate": "supervisor_approval",
        "critical": "asset_locked",
        "catastrophic": "escalated",
    }.get(payload.severity, "open")
    row = await db.execute(
        text("""INSERT INTO fleet.fleet_defects (organization_id,fleet_id,inspection_id,defect_reference,title,severity,status,description,system_action,supervisor_approval_required,locked_asset,reported_by)
        VALUES (:org_id,:fleet_id,:inspection_id,:defect_reference,:title,:severity,:status,:description,:system_action,:supervisor_approval_required,:locked_asset,:user_id) RETURNING id"""),
        {
            **payload.model_dump(),
            "status": initial_status,
            "system_action": system_action,
            "supervisor_approval_required": payload.severity == "moderate",
            "locked_asset": payload.severity in ("critical", "catastrophic"),
            "org_id": user["org_id"],
            "user_id": user["sub"],
        },
    )
    defect_id = row.scalar()
    if payload.severity in ("high", "critical", "catastrophic"):
        await db.execute(
            text(
                "UPDATE fleet.fleet SET operational_status=CASE WHEN :severity='catastrophic' THEN 'breakdown' ELSE 'quarantined' END, updated_at=NOW() WHERE id=:fleet_id AND organization_id=:org_id"
            ),
            {"fleet_id": payload.fleet_id, "severity": payload.severity, "org_id": user["org_id"]},
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
        resolved_at=CASE WHEN :status='resolved' THEN NOW() ELSE NULL END,resolved_by=CASE WHEN :status='resolved' THEN CAST(:user_id AS uuid) ELSE NULL END,updated_at=NOW()
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
        completed_by=CASE WHEN CAST(:status AS varchar)='completed' THEN CAST(:user_id AS uuid) ELSE completed_by END,updated_at=NOW()
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
    await tenant_reference(
        db,
        "fleet.plant_requests",
        payload.plant_request_id,
        user["org_id"],
        "Plant request",
    )
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
    variance_litres = (
        payload.quantity_litres - payload.expected_consumption_litres
        if payload.expected_consumption_litres is not None
        else None
    )
    litres_per_hour = None
    if payload.actual_consumption_litres is not None:
        hours_row = await db.execute(
            text("""
                SELECT operating_hours
                FROM fleet.utilization_logs
                WHERE organization_id=:org_id
                  AND fleet_id=:fleet_id
                  AND (CAST(:assignment_id AS uuid) IS NULL OR assignment_id=:assignment_id)
                  AND is_deleted=false
                ORDER BY occurred_on DESC, created_at DESC
                LIMIT 1
            """),
            {
                "org_id": user["org_id"],
                "fleet_id": payload.fleet_id,
                "assignment_id": payload.assignment_id,
            },
        )
        latest_hours = hours_row.scalar()
        if latest_hours and Decimal(str(latest_hours)) > Decimal("0"):
            litres_per_hour = (payload.actual_consumption_litres / Decimal(str(latest_hours))).quantize(Decimal("0.001"))
    row = await db.execute(
        text("""INSERT INTO fleet.fuel_transactions (
            organization_id,fleet_id,transaction_at,fuel_type,quantity_litres,unit_cost,total_cost,odometer_km,
            supplier_name,receipt_reference,plant_request_id,expected_consumption_litres,variance_litres,
            storage_tank,issued_to_operator_employee_id,cost_centre,issuer_user_id,receiver_signature,
            tank_balance_after,actual_consumption_litres,litres_per_hour,duplicate_slip_hash,recorded_by
        )
        VALUES (
            :org_id,:fleet_id,COALESCE(:transaction_at,NOW()),:fuel_type,:quantity_litres,:unit_cost,:total_cost,:odometer_km,
            :supplier_name,:receipt_reference,:plant_request_id,:expected_consumption_litres,:variance_litres,
            :storage_tank,:issued_to_operator_employee_id,:cost_centre,:user_id,:receiver_signature,
            :tank_balance_after,:actual_consumption_litres,:litres_per_hour,:duplicate_slip_hash,:user_id
        ) RETURNING id"""),
        {
            **payload.model_dump(),
            "unit_cost": unit_cost,
            "total_cost": total_cost,
            "variance_litres": variance_litres,
            "litres_per_hour": litres_per_hour,
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
    if variance_litres is not None and abs(variance_litres) > Decimal("0"):
        task = await db.execute(
            text("""
            INSERT INTO crm.tasks (
                organization_id, title, description, entity_type, entity_id,
                source, priority, created_by
            ) VALUES (
                :org_id, 'Investigate fuel variance',
                :description, 'plant_request', COALESCE(:plant_request_id, :fuel_id),
                'manual', 'high', :user_id
            ) RETURNING id
        """),
            {
                "org_id": user["org_id"],
                "description": f"Fuel variance of {variance_litres}L recorded against equipment fuel issue.",
                "plant_request_id": payload.plant_request_id,
                "fuel_id": fuel_id,
                "user_id": user["sub"],
            },
        )
        await db.execute(
            text(
                "UPDATE fleet.fuel_transactions SET variance_task_id=:task_id WHERE id=:id AND organization_id=:org_id"
            ),
            {"task_id": task.scalar(), "id": fuel_id, "org_id": user["org_id"]},
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
    await tenant_reference(
        db,
        "fleet.plant_requests",
        payload.plant_request_id,
        user["org_id"],
        "Plant request",
    )
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
        text("""INSERT INTO fleet.utilization_logs (organization_id,fleet_id,assignment_id,project_id,plant_request_id,occurred_on,operating_hours,distance_km,idle_hours,odometer_km,engine_hours,productive_hours,downtime_hours,work_performed,supervisor_approval,revenue_amount,cost_amount,notes,recorded_by)
        VALUES (:org_id,:fleet_id,:assignment_id,:project_id,:plant_request_id,:occurred_on,:operating_hours,:distance_km,:idle_hours,:odometer_km,:engine_hours,:productive_hours,:downtime_hours,:work_performed,:supervisor_approval,:revenue_amount,:cost_amount,:notes,:user_id) RETURNING id"""),
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
    # Internal plant-hire transfer: credit whichever department owns this
    # asset the hire revenue, charged against the hiring project's
    # delivering department. Never defaults to Plant & Equipment in code -
    # reads the asset's own owning_department_id, and no-ops (stays
    # unattributed) if that isn't set, or if the asset has no configured
    # hourly_charge_rate (revenue_amount == 0) - existing behaviour for
    # untagged/unrated equipment is unchanged.
    from_department_id = None
    if project_id is not None:
        proj_row = await db.execute(
            text("SELECT department_id FROM projects.projects WHERE id = :id AND organization_id = :org_id"),
            {"id": project_id, "org_id": user["org_id"]},
        )
        proj = proj_row.first()
        from_department_id = proj.department_id if proj else None
    to_department_id = asset.get("owning_department_id")

    transfer_id = await post_department_transfer(
        db,
        org_id=user["org_id"],
        user_id=user["sub"],
        transfer_type="internal_plant_hire",
        transfer_date=payload.occurred_on,
        from_department_id=from_department_id,
        to_department_id=to_department_id,
        amount=revenue_amount,
        description=f"Internal plant hire: {payload.operating_hours} operating hours",
        source_type="fleet_utilization_log",
        source_id=utilization_id,
        project_id=project_id,
        cost_category="equipment",
        basis={
            "operating_hours": str(payload.operating_hours),
            "hourly_charge_rate": str(hourly_rate),
            "cost_amount": str(cost_amount),
        },
    )

    await db.execute(
        text(
            "UPDATE fleet.utilization_logs SET cost_transaction_id=:cost_id, department_transfer_id=:transfer_id WHERE id=:id AND organization_id=:org_id"
        ),
        {"cost_id": cost_id, "transfer_id": transfer_id, "id": utilization_id, "org_id": user["org_id"]},
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
            "department_transfer_id": str(transfer_id) if transfer_id else None,
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
            "department_transfer_id": str(transfer_id) if transfer_id else None,
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
        plant_request_id=payload.plant_request_id,
        occurred_on=payload.occurred_on,
        operating_hours=payload.operating_hours,
        distance_km=payload.distance_km,
        idle_hours=payload.idle_hours,
        odometer_km=payload.odometer_km,
        engine_hours=payload.engine_hours,
        productive_hours=payload.productive_hours,
        downtime_hours=payload.downtime_hours,
        work_performed=payload.work_performed,
        supervisor_approval=payload.supervisor_approval,
        notes=payload.notes,
    )
    recorded = await record_utilization(utilization, user, db)
    if payload.fuel_litres:
        fuel = FuelPayload(
            fleet_id=fleet_id,
            assignment_id=payload.assignment_id,
            project_id=payload.project_id,
            plant_request_id=payload.plant_request_id,
            fuel_type="diesel",
            quantity_litres=payload.fuel_litres,
            unit_cost=payload.fuel_unit_cost or Decimal("0"),
            odometer_km=payload.odometer_km,
            receipt_reference=payload.receipt_reference or "meter-reading",
            storage_tank=payload.storage_tank,
            cost_centre=payload.cost_centre,
            receiver_signature=payload.receiver_signature,
            tank_balance_after=payload.tank_balance_after,
            expected_consumption_litres=payload.expected_consumption_litres,
            actual_consumption_litres=payload.actual_consumption_litres,
        )
        await record_fuel(fuel, user, db)
    return recorded


@router.get("/plant/summary")
async def plant_lifecycle_summary(
    user: dict = Depends(require_permission("fleet.plant_requests.read")),
    db: AsyncSession = Depends(get_db),
):
    row = (
        (
            await db.execute(
                text("""
        SELECT
          COUNT(*) FILTER (WHERE status NOT IN ('closed','cancelled','rejected')) AS open_requests,
          COUNT(*) FILTER (WHERE status IN ('submitted','under_validation','returned_for_correction')) AS validation_queue,
          COUNT(*) FILTER (WHERE status IN ('availability_check','awaiting_cost_review','awaiting_risk_review','awaiting_approval')) AS approval_queue,
          COUNT(*) FILTER (WHERE status IN ('approved','reserved','ready_for_dispatch')) AS dispatch_queue,
          COUNT(*) FILTER (WHERE status IN ('dispatched','active')) AS active_deployments,
          COUNT(*) FILTER (WHERE status IN ('off_hire_requested','returned','under_reconciliation')) AS return_or_closure_queue,
          COALESCE(SUM(expected_revenue), 0) AS expected_revenue,
          COALESCE(SUM(estimated_cost), 0) AS estimated_cost,
          COALESCE(SUM(contribution_margin), 0) AS contribution_margin
        FROM fleet.plant_requests
        WHERE organization_id=:org_id AND is_deleted=false
    """),
                {"org_id": user["org_id"]},
            )
        )
        .mappings()
        .one()
    )
    incidents = (
        (
            await db.execute(
                text("""
        SELECT
          COUNT(*) FILTER (WHERE status NOT IN ('closed','cancelled')) AS open_incidents,
          COUNT(*) FILTER (WHERE severity IN ('high','critical') AND status NOT IN ('closed','cancelled')) AS serious_incidents
        FROM fleet.plant_incidents
        WHERE organization_id=:org_id AND is_deleted=false
    """),
                {"org_id": user["org_id"]},
            )
        )
        .mappings()
        .one()
    )
    return result(
        {**dict(row), **dict(incidents)},
        "Plant lifecycle summary.",
    )


@router.get("/plant/requests")
async def list_plant_requests(
    status_filter: Optional[str] = None,
    user: dict = Depends(require_permission("fleet.plant_requests.read")),
    db: AsyncSession = Depends(get_db),
):
    rows = await db.execute(
        text("""
        SELECT pr.*,
          p.name AS project_name,
          COALESCE(c.contact_name, pr.client_name) AS client_display_name,
          COALESCE(res.reservations_count, 0) AS reservations_count,
          COALESCE(dispatch.dispatch_count, 0) AS dispatch_count,
          COALESCE(util.daily_logs_count, 0) AS daily_logs_count,
          COALESCE(fuel.fuel_transactions_count, 0) AS fuel_transactions_count,
          COALESCE(inc.open_incidents_count, 0) AS open_incidents_count,
          COALESCE(cl.status, 'not_started') AS closure_status
        FROM fleet.plant_requests pr
        LEFT JOIN projects.projects p ON p.id=pr.project_id AND p.organization_id=pr.organization_id
        LEFT JOIN crm.contacts c ON c.id=pr.client_id AND c.organization_id=pr.organization_id
        LEFT JOIN LATERAL (
          SELECT COUNT(*) AS reservations_count FROM fleet.plant_reservations r
          WHERE r.plant_request_id=pr.id AND r.organization_id=pr.organization_id AND r.is_deleted=false
        ) res ON true
        LEFT JOIN LATERAL (
          SELECT COUNT(*) AS dispatch_count FROM fleet.dispatch_notes d
          WHERE d.plant_request_id=pr.id AND d.organization_id=pr.organization_id AND d.is_deleted=false
        ) dispatch ON true
        LEFT JOIN LATERAL (
          SELECT COUNT(*) AS daily_logs_count FROM fleet.utilization_logs u
          WHERE u.plant_request_id=pr.id AND u.organization_id=pr.organization_id AND u.is_deleted=false
        ) util ON true
        LEFT JOIN LATERAL (
          SELECT COUNT(*) AS fuel_transactions_count FROM fleet.fuel_transactions ft
          WHERE ft.plant_request_id=pr.id AND ft.organization_id=pr.organization_id AND ft.is_deleted=false
        ) fuel ON true
        LEFT JOIN LATERAL (
          SELECT COUNT(*) AS open_incidents_count FROM fleet.plant_incidents i
          WHERE i.plant_request_id=pr.id AND i.organization_id=pr.organization_id AND i.is_deleted=false AND i.status NOT IN ('closed','cancelled')
        ) inc ON true
        LEFT JOIN fleet.plant_financial_closures cl ON cl.plant_request_id=pr.id AND cl.organization_id=pr.organization_id AND cl.is_deleted=false
        WHERE pr.organization_id=:org_id AND pr.is_deleted=false
          AND (:status_filter IS NULL OR pr.status=:status_filter)
        ORDER BY pr.created_at DESC
        LIMIT 500
    """),
        {"org_id": user["org_id"], "status_filter": status_filter},
    )
    return result([dict(r._mapping) for r in rows], "Plant requests listed.")


@router.post("/plant/requests", status_code=status.HTTP_201_CREATED)
async def create_plant_request(
    payload: PlantRequestPayload,
    user: dict = Depends(require_permission("fleet.plant_requests.create")),
    db: AsyncSession = Depends(get_db),
):
    await tenant_reference(
        db, "projects.projects", payload.project_id, user["org_id"], "Project"
    )
    await tenant_reference(
        db, "crm.contacts", payload.client_id, user["org_id"], "Client"
    )
    await tenant_reference(
        db,
        "finance.departments",
        payload.requesting_department_id,
        user["org_id"],
        "Requesting department",
    )
    await tenant_reference(
        db, "core.users", payload.approver_user_id, user["org_id"], "Approver"
    )
    contribution_margin = payload.expected_revenue - payload.estimated_cost
    readiness_pack = normalize_plant_readiness_pack(payload.readiness_pack)
    readiness_blockers = plant_readiness_blockers(
        readiness_pack,
        operator_required=payload.operator_required,
        has_operator=bool(readiness_pack.get("operator_verified")),
    )
    readiness_state = plant_readiness_status(readiness_blockers, readiness_pack)
    row = await db.execute(
        text("""
        INSERT INTO fleet.plant_requests (
            organization_id, request_number, request_type, status,
            requesting_department_id, project_id, client_id, client_name,
            requested_by_user_id, approver_user_id, required_asset_type,
            specification, attachments_required, quantity, work_location,
            start_date, end_date, operating_hours_mode, operator_required,
            fuel_responsibility, transport_requirement, work_description,
            cost_centre, priority, commercial_terms, risk_assessment,
            expected_revenue, estimated_cost, contribution_margin, risk_level,
            readiness_pack, readiness_blockers, readiness_status,
            plant_manager_ready_at, plant_manager_ready_by,
            created_by
        ) VALUES (
            :org_id,
            'PR-' || LPAD(nextval('fleet.plant_request_seq')::text, 6, '0'),
            :request_type, 'submitted',
            :requesting_department_id, :project_id, :client_id, :client_name,
            COALESCE(:requested_by_user_id, CAST(:user_id AS uuid)), :approver_user_id,
            :required_asset_type, :specification, :attachments_required,
            :quantity, :work_location, :start_date, :end_date,
            :operating_hours_mode, :operator_required, :fuel_responsibility,
            :transport_requirement, :work_description, :cost_centre,
            :priority, CAST(:commercial_terms AS jsonb), CAST(:risk_assessment AS jsonb),
            :expected_revenue, :estimated_cost, :contribution_margin, :risk_level,
            CAST(:readiness_pack AS jsonb), CAST(:readiness_blockers AS jsonb),
            :readiness_status,
            CASE WHEN :readiness_status='ready' THEN NOW() ELSE NULL END,
            CASE WHEN :readiness_status='ready' THEN CAST(:user_id AS uuid) ELSE NULL END,
            :user_id
        ) RETURNING id, request_number
    """),
        {
            **payload.model_dump(),
            "commercial_terms": json.dumps(payload.commercial_terms),
            "risk_assessment": json.dumps(payload.risk_assessment),
            "readiness_pack": json.dumps(readiness_pack),
            "readiness_blockers": json.dumps(readiness_blockers),
            "readiness_status": readiness_state,
            "contribution_margin": contribution_margin,
            "org_id": user["org_id"],
            "user_id": user["sub"],
        },
    )
    created = row.mappings().one()
    await emit_event(
        db,
        user=user,
        event_type="plant.request_submitted.v1",
        aggregate_type="plant_request",
        aggregate_id=created["id"],
        project_id=payload.project_id,
        event_payload=payload.model_dump(mode="json"),
    )
    await db.commit()
    await generate_task_stack(
        db,
        org_id=user["org_id"],
        entity_type="plant_request",
        entity_id=created["id"],
        created_by=user["sub"],
    )
    return result(
        {"id": str(created["id"]), "request_number": created["request_number"]},
        "Plant request created.",
    )


@router.get("/plant/requests/{plant_request_id}")
async def get_plant_request(
    plant_request_id: UUID,
    user: dict = Depends(require_permission("fleet.plant_requests.read")),
    db: AsyncSession = Depends(get_db),
):
    request = (
        (
            await db.execute(
                text("""
        SELECT pr.*, p.name AS project_name,
               COALESCE(c.contact_name, pr.client_name) AS client_display_name
        FROM fleet.plant_requests pr
        LEFT JOIN projects.projects p ON p.id=pr.project_id AND p.organization_id=pr.organization_id
        LEFT JOIN crm.contacts c ON c.id=pr.client_id AND c.organization_id=pr.organization_id
        WHERE pr.id=:id AND pr.organization_id=:org_id AND pr.is_deleted=false
    """),
                {"id": plant_request_id, "org_id": user["org_id"]},
            )
        )
        .mappings()
        .first()
    )
    if not request:
        raise HTTPException(status_code=404, detail="Plant request not found")
    child_tables = {
        "items": ("fleet.plant_request_items", "created_at"),
        "reservations": ("fleet.plant_reservations", "created_at"),
        "dispatch_notes": ("fleet.dispatch_notes", "created_at"),
        "incidents": ("fleet.plant_incidents", "occurred_at"),
        "off_hire_records": ("fleet.off_hire_records", "created_at"),
        "return_inspections": ("fleet.return_inspections", "inspected_at"),
        "damage_claims": ("fleet.damage_claims", "created_at"),
        "financial_closures": ("fleet.plant_financial_closures", "created_at"),
    }
    detail: dict[str, Any] = {"request": dict(request)}
    for key, (table, order_column) in child_tables.items():
        rows = await db.execute(
            text(f"""
            SELECT * FROM {table}
            WHERE plant_request_id=:id AND organization_id=:org_id AND is_deleted=false
            ORDER BY {order_column} DESC
            LIMIT 200
        """),
            {"id": plant_request_id, "org_id": user["org_id"]},
        )
        detail[key] = [dict(r._mapping) for r in rows]
    return result(detail, "Plant request detail.")


@router.patch("/plant/requests/{plant_request_id}/status")
async def update_plant_request_status(
    plant_request_id: UUID,
    payload: PlantRequestStatusPayload,
    user: dict = Depends(require_permission("fleet.plant_requests.update")),
    db: AsyncSession = Depends(get_db),
):
    if payload.status == "approved":
        await require_permission("fleet.plant_requests.approve")(user=user, db=db)
    current = (
        (
            await db.execute(
                text("""
        SELECT id, project_id, operator_required, readiness_pack
        FROM fleet.plant_requests
        WHERE id=:id AND organization_id=:org_id AND is_deleted=false
          AND status NOT IN ('closed','cancelled','rejected')
    """),
                {"id": plant_request_id, "org_id": user["org_id"]},
            )
        )
        .mappings()
        .first()
    )
    if not current:
        raise HTTPException(status_code=404, detail="Plant request not found or closed")
    readiness_pack = merge_plant_readiness_pack(
        current.get("readiness_pack"), payload.readiness_pack
    )
    readiness_blockers = plant_readiness_blockers(
        readiness_pack,
        operator_required=bool(current["operator_required"]),
        has_operator=bool(readiness_pack.get("operator_verified")),
    )
    readiness_state = plant_readiness_status(readiness_blockers, readiness_pack)
    update = await db.execute(
        text("""
        UPDATE fleet.plant_requests
        SET status=:status,
            validation_notes=CASE WHEN :status IN ('under_validation','availability_check','awaiting_cost_review','awaiting_risk_review','awaiting_approval') THEN COALESCE(:notes, validation_notes) ELSE validation_notes END,
            correction_notes=CASE WHEN :status='returned_for_correction' THEN :notes ELSE correction_notes END,
            rejection_reason=CASE WHEN :status='rejected' THEN :notes ELSE rejection_reason END,
            expected_revenue=COALESCE(:expected_revenue, expected_revenue),
            estimated_cost=COALESCE(:estimated_cost, estimated_cost),
            contribution_margin=COALESCE(:expected_revenue, expected_revenue) - COALESCE(:estimated_cost, estimated_cost),
            risk_level=COALESCE(:risk_level, risk_level),
            approved_at=CASE WHEN :status='approved' THEN NOW() ELSE approved_at END,
            approved_by=CASE WHEN :status='approved' THEN CAST(:user_id AS uuid) ELSE approved_by END,
            readiness_pack=CAST(:readiness_pack AS jsonb),
            readiness_blockers=CAST(:readiness_blockers AS jsonb),
            readiness_status=:readiness_status,
            plant_manager_ready_at=CASE WHEN :readiness_status='ready' THEN COALESCE(plant_manager_ready_at, NOW()) ELSE NULL END,
            plant_manager_ready_by=CASE WHEN :readiness_status='ready' THEN COALESCE(plant_manager_ready_by, CAST(:user_id AS uuid)) ELSE NULL END,
            updated_at=NOW()
        WHERE id=:id AND organization_id=:org_id AND is_deleted=false
          AND status NOT IN ('closed','cancelled','rejected')
        RETURNING id, project_id
    """),
        {
            **payload.model_dump(),
            "readiness_pack": json.dumps(readiness_pack),
            "readiness_blockers": json.dumps(readiness_blockers),
            "readiness_status": readiness_state,
            "id": plant_request_id,
            "org_id": user["org_id"],
            "user_id": user["sub"],
        },
    )
    updated = update.mappings().first()
    if not updated:
        raise HTTPException(status_code=404, detail="Plant request not found or closed")
    await emit_event(
        db,
        user=user,
        event_type=f"plant.request_{payload.status}.v1",
        aggregate_type="plant_request",
        aggregate_id=plant_request_id,
        project_id=updated["project_id"],
        event_payload=payload.model_dump(mode="json"),
    )
    await db.commit()
    return result({"id": str(plant_request_id)}, "Plant request status updated.")


@router.post("/plant/requests/{plant_request_id}/reserve", status_code=status.HTTP_201_CREATED)
async def reserve_plant_asset(
    plant_request_id: UUID,
    payload: PlantReservationPayload,
    user: dict = Depends(require_permission("fleet.plant_requests.update")),
    db: AsyncSession = Depends(get_db),
):
    await asset_or_404(db, payload.fleet_id, user["org_id"])
    plant_request = (
        (
            await db.execute(
                text("""
        SELECT id, status, project_id FROM fleet.plant_requests
        WHERE id=:id AND organization_id=:org_id AND is_deleted=false
    """),
                {"id": plant_request_id, "org_id": user["org_id"]},
            )
        )
        .mappings()
        .first()
    )
    if not plant_request:
        raise HTTPException(status_code=404, detail="Plant request not found")
    if plant_request["status"] not in (
        "availability_check",
        "awaiting_cost_review",
        "awaiting_risk_review",
        "awaiting_approval",
        "approved",
    ):
        raise HTTPException(status_code=409, detail="Plant request is not ready for reservation")
    conflict = await db.execute(
        text("""
        SELECT 1 FROM fleet.plant_reservations
        WHERE organization_id=:org_id AND fleet_id=:fleet_id AND is_deleted=false
          AND status IN ('provisional','confirmed')
          AND tstzrange(reserved_from, COALESCE(reserved_until, 'infinity'::timestamptz), '[]')
              && tstzrange(CAST(:reserved_from AS timestamptz), COALESCE(CAST(:reserved_until AS timestamptz), 'infinity'::timestamptz), '[]')
        LIMIT 1
    """),
        {**payload.model_dump(), "org_id": user["org_id"]},
    )
    if conflict.scalar():
        raise HTTPException(status_code=409, detail="Asset has an overlapping plant reservation")
    row = await db.execute(
        text("""
        INSERT INTO fleet.plant_reservations (
            organization_id, plant_request_id, fleet_id, reservation_number,
            status, reserved_from, reserved_until, conditions, created_by
        ) VALUES (
            :org_id, :plant_request_id, :fleet_id,
            'PA-' || LPAD(nextval('fleet.plant_allocation_seq')::text, 6, '0'),
            CASE WHEN :request_status='approved' THEN 'confirmed' ELSE 'provisional' END,
            :reserved_from, :reserved_until, :conditions, :user_id
        ) RETURNING id, reservation_number
    """),
        {
            **payload.model_dump(),
            "plant_request_id": plant_request_id,
            "request_status": plant_request["status"],
            "org_id": user["org_id"],
            "user_id": user["sub"],
        },
    )
    created = row.mappings().one()
    await db.execute(
        text("""
        UPDATE fleet.plant_requests
        SET status=CASE WHEN status='approved' THEN 'reserved' ELSE status END,
            updated_at=NOW()
        WHERE id=:id AND organization_id=:org_id
    """),
        {"id": plant_request_id, "org_id": user["org_id"]},
    )
    await db.execute(
        text("""
        UPDATE fleet.fleet
        SET operational_status=CASE WHEN operational_status='available' THEN 'assigned' ELSE operational_status END,
            updated_at=NOW()
        WHERE id=:fleet_id AND organization_id=:org_id
    """),
        {"fleet_id": payload.fleet_id, "org_id": user["org_id"]},
    )
    await emit_event(
        db,
        user=user,
        event_type="plant.asset_reserved.v1",
        aggregate_type="plant_reservation",
        aggregate_id=created["id"],
        project_id=plant_request["project_id"],
        event_payload=payload.model_dump(mode="json"),
    )
    await db.commit()
    return result(
        {"id": str(created["id"]), "reservation_number": created["reservation_number"]},
        "Plant asset reserved.",
    )


@router.post("/plant/requests/{plant_request_id}/dispatch", status_code=status.HTTP_201_CREATED)
async def dispatch_plant_asset(
    plant_request_id: UUID,
    payload: PlantDispatchPayload,
    user: dict = Depends(require_permission("fleet.plant_requests.update")),
    db: AsyncSession = Depends(get_db),
):
    asset = await asset_or_404(db, payload.fleet_id, user["org_id"])
    request = (
        (
            await db.execute(
                text("""
        SELECT * FROM fleet.plant_requests
        WHERE id=:id AND organization_id=:org_id AND is_deleted=false
    """),
                {"id": plant_request_id, "org_id": user["org_id"]},
            )
        )
        .mappings()
        .first()
    )
    if not request:
        raise HTTPException(status_code=404, detail="Plant request not found")
    if request["status"] not in ("approved", "reserved", "ready_for_dispatch"):
        raise HTTPException(status_code=409, detail="Plant request is not approved for dispatch")
    await tenant_reference(
        db, "projects.projects", payload.project_id or request["project_id"], user["org_id"], "Project"
    )
    await tenant_reference(
        db, "fleet.plant_reservations", payload.reservation_id, user["org_id"], "Reservation"
    )
    pack_update = {}
    if isinstance(payload.dispatch_pack, dict):
        for key in ("readiness_pack", "readiness"):
            nested = payload.dispatch_pack.get(key)
            if isinstance(nested, dict):
                pack_update.update(nested)
    readiness_pack = merge_plant_readiness_pack(request["readiness_pack"], pack_update)
    readiness_blockers = plant_readiness_blockers(
        readiness_pack,
        operator_required=bool(request["operator_required"]),
        has_operator=bool(payload.operator_employee_id) or bool(readiness_pack.get("operator_verified")),
    )
    critical_defects = await db.execute(
        text("""
        SELECT COUNT(*) FROM fleet.fleet_defects
        WHERE organization_id=:org_id AND fleet_id=:fleet_id AND is_deleted=false
          AND status IN ('open','triaged','in_repair')
          AND severity IN ('high','critical')
    """),
        {"org_id": user["org_id"], "fleet_id": payload.fleet_id},
    )
    if int(critical_defects.scalar() or 0) > 0:
        readiness_blockers.append("Critical defects remain open")
    if readiness_blockers:
        await db.execute(
            text("""
            UPDATE fleet.plant_requests
            SET readiness_pack=CAST(:readiness_pack AS jsonb),
                readiness_blockers=CAST(:readiness_blockers AS jsonb),
                readiness_status='blocked',
                plant_manager_ready_at=NULL,
                plant_manager_ready_by=NULL,
                updated_at=NOW()
            WHERE id=:id AND organization_id=:org_id
        """),
            {
                "id": plant_request_id,
                "org_id": user["org_id"],
                "readiness_pack": json.dumps(readiness_pack),
                "readiness_blockers": json.dumps(readiness_blockers),
            },
        )
        await db.commit()
        raise HTTPException(
            status_code=409,
            detail=f"Plant mobilisation blocked: {', '.join(readiness_blockers)}",
        )
    starts_at = payload.dispatch_at or datetime.utcnow()
    ends_at = datetime.combine(request["end_date"], datetime.min.time()) if request["end_date"] else None
    assignment = AssignmentPayload(
        fleet_id=payload.fleet_id,
        project_id=payload.project_id or request["project_id"],
        assigned_to_user_id=payload.assigned_to_user_id,
        operator_employee_id=payload.operator_employee_id,
        dispatch_reference=None,
        starts_at=starts_at,
        ends_at=ends_at,
        status="dispatched",
        origin_location=payload.origin_location,
        destination_location=payload.destination_location,
        purpose=request["work_description"],
        odometer_out=payload.odometer_out,
    )
    conflict = await db.execute(
        text("""SELECT 1 FROM fleet.fleet_assignments WHERE organization_id=:org_id AND fleet_id=:fleet_id AND is_deleted=false AND status IN ('planned','dispatched','active')
        AND tstzrange(starts_at, COALESCE(ends_at, 'infinity'::timestamptz), '[]')
            && tstzrange(CAST(:starts_at AS timestamptz), COALESCE(CAST(:ends_at AS timestamptz), 'infinity'::timestamptz), '[]')"""),
        {**assignment.model_dump(), "org_id": user["org_id"]},
    )
    if conflict.scalar():
        raise HTTPException(status_code=409, detail="Asset has an overlapping active assignment")
    inspection = await db.execute(
        text("""
        INSERT INTO fleet.fleet_inspections (
            organization_id, fleet_id, inspection_type, inspected_at, inspector_id,
            outcome, odometer_km, engine_hours, checklist, notes, plant_request_id, created_by
        ) VALUES (
            :org_id, :fleet_id, 'pre_start', NOW(), :user_id,
            'pass', :odometer_km, :engine_hours, CAST(:checklist AS jsonb),
            :notes, :plant_request_id, :user_id
        ) RETURNING id
    """),
        {
            "org_id": user["org_id"],
            "fleet_id": payload.fleet_id,
            "user_id": user["sub"],
            "odometer_km": payload.odometer_out,
            "engine_hours": payload.engine_hours,
            "checklist": json.dumps({"fuel_level": payload.fuel_level, "dispatch_pack": payload.dispatch_pack}),
            "notes": payload.notes,
            "plant_request_id": plant_request_id,
        },
    )
    inspection_id = inspection.scalar()
    assignment_row = await db.execute(
        text("""INSERT INTO fleet.fleet_assignments (organization_id,fleet_id,project_id,assigned_to_user_id,operator_employee_id,dispatch_reference,starts_at,ends_at,status,origin_location,destination_location,purpose,odometer_out,plant_request_id,reservation_id,created_by)
        VALUES (:org_id,:fleet_id,:project_id,:assigned_to_user_id,:operator_employee_id,:dispatch_reference,:starts_at,:ends_at,:status,:origin_location,:destination_location,:purpose,:odometer_out,:plant_request_id,:reservation_id,:user_id) RETURNING id"""),
        {
            **assignment.model_dump(),
            "dispatch_reference": None,
            "plant_request_id": plant_request_id,
            "reservation_id": payload.reservation_id,
            "org_id": user["org_id"],
            "user_id": user["sub"],
        },
    )
    assignment_id = assignment_row.scalar()
    dispatch = await db.execute(
        text("""
        INSERT INTO fleet.dispatch_notes (
            organization_id, dispatch_number, plant_request_id, reservation_id,
            assignment_id, fleet_id, pre_dispatch_inspection_id, status,
            dispatch_at, origin_location, destination_location,
            transport_instructions, operator_employee_id, issuing_officer_id,
            receiving_party, handover_signatures, dispatch_pack, notes, created_by
        ) VALUES (
            :org_id, 'DN-' || LPAD(nextval('fleet.dispatch_note_seq')::text, 6, '0'),
            :plant_request_id, :reservation_id, :assignment_id, :fleet_id,
            :inspection_id, 'dispatched', COALESCE(:dispatch_at, NOW()),
            :origin_location, :destination_location, :transport_instructions,
            :operator_employee_id, :user_id, :receiving_party,
            CAST(:handover_signatures AS jsonb), CAST(:dispatch_pack AS jsonb),
            :notes, :user_id
        ) RETURNING id, dispatch_number
    """),
        {
            **payload.model_dump(),
            "plant_request_id": plant_request_id,
            "assignment_id": assignment_id,
            "inspection_id": inspection_id,
            "handover_signatures": json.dumps(payload.handover_signatures),
            "dispatch_pack": json.dumps(payload.dispatch_pack),
            "org_id": user["org_id"],
            "user_id": user["sub"],
        },
    )
    dispatch_created = dispatch.mappings().one()
    await db.execute(
        text("""
        UPDATE fleet.fleet_assignments
        SET dispatch_note_id=:dispatch_note_id,
            dispatch_reference=:dispatch_number
        WHERE id=:assignment_id AND organization_id=:org_id
    """),
        {
            "dispatch_note_id": dispatch_created["id"],
            "dispatch_number": dispatch_created["dispatch_number"],
            "assignment_id": assignment_id,
            "org_id": user["org_id"],
        },
    )
    await db.execute(
        text("""
        UPDATE fleet.plant_requests
        SET status='dispatched',
            readiness_pack=CAST(:readiness_pack AS jsonb),
            readiness_blockers='[]'::jsonb,
            readiness_status='ready',
            plant_manager_ready_at=COALESCE(plant_manager_ready_at, NOW()),
            plant_manager_ready_by=COALESCE(plant_manager_ready_by, CAST(:user_id AS uuid)),
            updated_at=NOW()
        WHERE id=:id AND organization_id=:org_id
    """),
        {
            "id": plant_request_id,
            "org_id": user["org_id"],
            "user_id": user["sub"],
            "readiness_pack": json.dumps(readiness_pack),
        },
    )
    await db.execute(
        text("""
        UPDATE fleet.fleet
        SET operational_status='assigned',
            current_project_id=:project_id,
            current_assignment_id=:assignment_id,
            updated_at=NOW()
        WHERE id=:fleet_id AND organization_id=:org_id
    """),
        {
            "project_id": assignment.project_id,
            "assignment_id": assignment_id,
            "fleet_id": payload.fleet_id,
            "org_id": user["org_id"],
        },
    )
    await emit_event(
        db,
        user=user,
        event_type="plant.asset_dispatched.v1",
        aggregate_type="dispatch_note",
        aggregate_id=dispatch_created["id"],
        project_id=assignment.project_id,
        event_payload={**payload.model_dump(mode="json"), "asset": asset.get("asset_code")},
    )
    await db.commit()
    await generate_task_stack(
        db,
        org_id=user["org_id"],
        entity_type="plant_dispatch",
        entity_id=dispatch_created["id"],
        created_by=user["sub"],
    )
    return result(
        {
            "id": str(dispatch_created["id"]),
            "dispatch_number": dispatch_created["dispatch_number"],
            "assignment_id": str(assignment_id),
            "inspection_id": str(inspection_id),
        },
        "Plant dispatch created.",
    )


@router.post("/plant/requests/{plant_request_id}/incidents", status_code=status.HTTP_201_CREATED)
async def record_plant_incident(
    plant_request_id: UUID,
    payload: PlantIncidentPayload,
    user: dict = Depends(require_permission("fleet.plant_requests.update")),
    db: AsyncSession = Depends(get_db),
):
    await asset_or_404(db, payload.fleet_id, user["org_id"])
    await tenant_reference(
        db, "fleet.plant_requests", plant_request_id, user["org_id"], "Plant request"
    )
    if payload.assignment_id:
        await tenant_reference(
            db, "fleet.fleet_assignments", payload.assignment_id, user["org_id"], "Assignment"
        )
    escalation_required = payload.severity in ("high", "critical") or payload.incident_type in (
        "injury",
        "property_damage",
        "theft",
        "fire",
        "overturn",
        "environmental",
        "third_party_claim",
        "operator_misconduct",
        "fuel_variance",
        "parts_fraud",
        "downtime",
    )
    incident = await db.execute(
        text("""
        INSERT INTO fleet.plant_incidents (
            organization_id, plant_request_id, fleet_id, assignment_id,
            incident_type, severity, status, occurred_at, location,
            meter_reading, description, escalation_required, reported_by
        ) VALUES (
            :org_id, :plant_request_id, :fleet_id, :assignment_id,
            :incident_type, :severity, 'reported', COALESCE(:occurred_at, NOW()),
            :location, :meter_reading, :description, :escalation_required, :user_id
        ) RETURNING id
    """),
        {
            **payload.model_dump(),
            "plant_request_id": plant_request_id,
            "escalation_required": escalation_required,
            "org_id": user["org_id"],
            "user_id": user["sub"],
        },
    )
    incident_id = incident.scalar()
    work_order_id = None
    if payload.open_work_order or payload.incident_type == "breakdown":
        work_order_number = f"WO-PLANT-{str(incident_id)[:8].upper()}"
        wo = await db.execute(
            text("""INSERT INTO fleet.maintenance_work_orders (organization_id,fleet_id,plant_request_id,incident_id,work_order_number,maintenance_type,priority,estimated_cost,description,created_by)
            VALUES (:org_id,:fleet_id,:plant_request_id,:incident_id,:work_order_number,'corrective',:priority,:estimated_cost,:description,:user_id) RETURNING id"""),
            {
                "org_id": user["org_id"],
                "fleet_id": payload.fleet_id,
                "plant_request_id": plant_request_id,
                "incident_id": incident_id,
                "work_order_number": work_order_number,
                "priority": "critical" if payload.severity == "critical" else "high",
                "estimated_cost": payload.estimated_repair_cost,
                "description": payload.description,
                "user_id": user["sub"],
            },
        )
        work_order_id = wo.scalar()
        await db.execute(
            text("UPDATE fleet.plant_incidents SET status='work_order_opened', work_order_id=:work_order_id WHERE id=:id AND organization_id=:org_id"),
            {"work_order_id": work_order_id, "id": incident_id, "org_id": user["org_id"]},
        )
    if payload.severity in ("high", "critical"):
        await db.execute(
            text("UPDATE fleet.fleet SET operational_status='out_of_service', updated_at=NOW() WHERE id=:fleet_id AND organization_id=:org_id"),
            {"fleet_id": payload.fleet_id, "org_id": user["org_id"]},
        )
    await emit_event(
        db,
        user=user,
        event_type="plant.incident_reported.v1",
        aggregate_type="plant_incident",
        aggregate_id=incident_id,
        project_id=None,
        event_payload={**payload.model_dump(mode="json"), "work_order_id": str(work_order_id) if work_order_id else None},
    )
    await db.commit()
    await generate_task_stack(
        db,
        org_id=user["org_id"],
        entity_type="plant_breakdown",
        entity_id=incident_id,
        created_by=user["sub"],
    )
    return result(
        {"id": str(incident_id), "work_order_id": str(work_order_id) if work_order_id else None},
        "Plant incident recorded.",
    )


@router.post("/plant/requests/{plant_request_id}/off-hire", status_code=status.HTTP_201_CREATED)
async def create_off_hire(
    plant_request_id: UUID,
    payload: PlantOffHirePayload,
    user: dict = Depends(require_permission("fleet.plant_requests.update")),
    db: AsyncSession = Depends(get_db),
):
    await asset_or_404(db, payload.fleet_id, user["org_id"])
    await tenant_reference(
        db, "fleet.plant_requests", plant_request_id, user["org_id"], "Plant request"
    )
    off_hire = await db.execute(
        text("""
        INSERT INTO fleet.off_hire_records (
            organization_id, off_hire_number, plant_request_id, fleet_id,
            assignment_id, status, final_working_at, final_meter_reading,
            final_fuel_level, release_reason, transport_required,
            confirmation_party, notes, created_by
        ) VALUES (
            :org_id, 'OH-' || LPAD(nextval('fleet.off_hire_seq')::text, 6, '0'),
            :plant_request_id, :fleet_id, :assignment_id, 'requested',
            :final_working_at, :final_meter_reading, :final_fuel_level,
            :release_reason, :transport_required, :confirmation_party,
            :notes, :user_id
        ) RETURNING id, off_hire_number
    """),
        {
            **payload.model_dump(),
            "plant_request_id": plant_request_id,
            "org_id": user["org_id"],
            "user_id": user["sub"],
        },
    )
    created = off_hire.mappings().one()
    await db.execute(
        text("UPDATE fleet.plant_requests SET status='off_hire_requested', updated_at=NOW() WHERE id=:id AND organization_id=:org_id"),
        {"id": plant_request_id, "org_id": user["org_id"]},
    )
    if payload.assignment_id:
        await db.execute(
            text("UPDATE fleet.fleet_assignments SET status='completed', ends_at=COALESCE(ends_at, :final_working_at), odometer_in=COALESCE(odometer_in, :final_meter_reading), updated_at=NOW() WHERE id=:assignment_id AND organization_id=:org_id"),
            {
                "assignment_id": payload.assignment_id,
                "final_working_at": payload.final_working_at,
                "final_meter_reading": payload.final_meter_reading,
                "org_id": user["org_id"],
            },
        )
    await emit_event(
        db,
        user=user,
        event_type="plant.off_hire_requested.v1",
        aggregate_type="off_hire_record",
        aggregate_id=created["id"],
        project_id=None,
        event_payload=payload.model_dump(mode="json"),
    )
    await db.commit()
    await generate_task_stack(
        db,
        org_id=user["org_id"],
        entity_type="plant_return",
        entity_id=created["id"],
        created_by=user["sub"],
    )
    return result(
        {"id": str(created["id"]), "off_hire_number": created["off_hire_number"]},
        "Off-hire recorded.",
    )


@router.post("/plant/requests/{plant_request_id}/return-inspections", status_code=status.HTTP_201_CREATED)
async def create_return_inspection(
    plant_request_id: UUID,
    payload: PlantReturnInspectionPayload,
    user: dict = Depends(require_permission("fleet.plant_requests.update")),
    db: AsyncSession = Depends(get_db),
):
    await asset_or_404(db, payload.fleet_id, user["org_id"])
    await tenant_reference(
        db, "fleet.plant_requests", plant_request_id, user["org_id"], "Plant request"
    )
    inspection = await db.execute(
        text("""
        INSERT INTO fleet.fleet_inspections (
            organization_id, fleet_id, inspection_type, inspected_at, inspector_id,
            outcome, odometer_km, checklist, notes, plant_request_id, created_by
        ) VALUES (
            :org_id, :fleet_id, 'post_trip', NOW(), :user_id,
            CASE WHEN :outcome IN ('good_condition','minor_maintenance','service_due') THEN 'pass' ELSE 'fail' END,
            :final_meter_reading, CAST(:checklist AS jsonb), :notes,
            :plant_request_id, :user_id
        ) RETURNING id
    """),
        {
            "org_id": user["org_id"],
            "fleet_id": payload.fleet_id,
            "user_id": user["sub"],
            "outcome": payload.outcome,
            "final_meter_reading": payload.final_meter_reading,
            "checklist": json.dumps(
                {
                    "final_fuel_level": payload.final_fuel_level,
                    "missing_items": payload.missing_items,
                    "cleaning_required": payload.cleaning_required,
                }
            ),
            "notes": payload.damage_notes,
            "plant_request_id": plant_request_id,
        },
    )
    inspection_id = inspection.scalar()
    returned = await db.execute(
        text("""
        INSERT INTO fleet.return_inspections (
            organization_id, plant_request_id, off_hire_id, fleet_id,
            inspection_id, outcome, final_meter_reading, final_fuel_level,
            damage_notes, missing_items, cleaning_required, quarantine_required,
            inspected_by
        ) VALUES (
            :org_id, :plant_request_id, :off_hire_id, :fleet_id,
            :inspection_id, :outcome, :final_meter_reading, :final_fuel_level,
            :damage_notes, :missing_items, :cleaning_required, :quarantine_required,
            :user_id
        ) RETURNING id
    """),
        {
            **payload.model_dump(),
            "plant_request_id": plant_request_id,
            "inspection_id": inspection_id,
            "org_id": user["org_id"],
            "user_id": user["sub"],
        },
    )
    return_inspection_id = returned.scalar()
    if payload.claim_amount and payload.claim_amount > 0:
        await db.execute(
            text("""
            INSERT INTO fleet.damage_claims (
                organization_id, claim_number, plant_request_id,
                return_inspection_id, fleet_id, claim_type, liable_party,
                estimated_amount, description, created_by
            ) VALUES (
                :org_id, 'DC-' || LPAD(nextval('fleet.damage_claim_seq')::text, 6, '0'),
                :plant_request_id, :return_inspection_id, :fleet_id,
                CASE WHEN :outcome='missing_items' THEN 'missing_items' ELSE 'damage' END,
                'client/project', :claim_amount,
                COALESCE(:damage_notes, :missing_items, 'Return inspection claim'),
                :user_id
            )
        """),
            {
                **payload.model_dump(),
                "plant_request_id": plant_request_id,
                "return_inspection_id": return_inspection_id,
                "org_id": user["org_id"],
                "user_id": user["sub"],
            },
        )
    asset_status = "out_of_service" if payload.outcome in ("major_repair", "safety_block") or payload.quarantine_required else "available"
    await db.execute(
        text("""
        UPDATE fleet.fleet
        SET operational_status=:asset_status,
            current_project_id=NULL,
            current_assignment_id=NULL,
            updated_at=NOW()
        WHERE id=:fleet_id AND organization_id=:org_id
    """),
        {"asset_status": asset_status, "fleet_id": payload.fleet_id, "org_id": user["org_id"]},
    )
    await db.execute(
        text("UPDATE fleet.plant_requests SET status='returned', updated_at=NOW() WHERE id=:id AND organization_id=:org_id"),
        {"id": plant_request_id, "org_id": user["org_id"]},
    )
    await emit_event(
        db,
        user=user,
        event_type="plant.asset_returned.v1",
        aggregate_type="return_inspection",
        aggregate_id=return_inspection_id,
        project_id=None,
        event_payload=payload.model_dump(mode="json"),
    )
    await db.commit()
    return result(
        {"id": str(return_inspection_id), "inspection_id": str(inspection_id)},
        "Return inspection recorded.",
    )


@router.post("/plant/requests/{plant_request_id}/financial-close", status_code=status.HTTP_201_CREATED)
async def close_plant_financials(
    plant_request_id: UUID,
    payload: PlantFinancialClosurePayload,
    user: dict = Depends(require_permission("fleet.plant_requests.close")),
    db: AsyncSession = Depends(get_db),
):
    request = (
        (
            await db.execute(
                text("""
        SELECT id, project_id, request_type FROM fleet.plant_requests
        WHERE id=:id AND organization_id=:org_id AND is_deleted=false
    """),
                {"id": plant_request_id, "org_id": user["org_id"]},
            )
        )
        .mappings()
        .first()
    )
    if not request:
        raise HTTPException(status_code=404, detail="Plant request not found")
    contribution_margin = (
        payload.internal_charge_amount
        + payload.external_invoice_amount
        + payload.damage_charge_amount
        - payload.operator_cost_amount
        - payload.fuel_cost_amount
        - payload.transport_cost_amount
        - payload.maintenance_cost_amount
        - payload.discount_amount
        - payload.tax_amount
    )
    closure = await db.execute(
        text("""
        INSERT INTO fleet.plant_financial_closures (
            organization_id, plant_request_id, status, internal_charge_amount,
            external_invoice_amount, operator_cost_amount, fuel_cost_amount,
            transport_cost_amount, maintenance_cost_amount, damage_charge_amount,
            discount_amount, tax_amount, outstanding_balance, contribution_margin,
            invoice_reference, finance_notes, finance_confirmed_by, closed_at, created_by
        ) VALUES (
            :org_id, :plant_request_id, :status, :internal_charge_amount,
            :external_invoice_amount, :operator_cost_amount, :fuel_cost_amount,
            :transport_cost_amount, :maintenance_cost_amount, :damage_charge_amount,
            :discount_amount, :tax_amount, :outstanding_balance, :contribution_margin,
            :invoice_reference, :finance_notes, :user_id,
            CASE WHEN :status='closed' THEN NOW() ELSE NULL END, :user_id
        )
        ON CONFLICT (organization_id, plant_request_id) DO UPDATE
        SET status=EXCLUDED.status,
            internal_charge_amount=EXCLUDED.internal_charge_amount,
            external_invoice_amount=EXCLUDED.external_invoice_amount,
            operator_cost_amount=EXCLUDED.operator_cost_amount,
            fuel_cost_amount=EXCLUDED.fuel_cost_amount,
            transport_cost_amount=EXCLUDED.transport_cost_amount,
            maintenance_cost_amount=EXCLUDED.maintenance_cost_amount,
            damage_charge_amount=EXCLUDED.damage_charge_amount,
            discount_amount=EXCLUDED.discount_amount,
            tax_amount=EXCLUDED.tax_amount,
            outstanding_balance=EXCLUDED.outstanding_balance,
            contribution_margin=EXCLUDED.contribution_margin,
            invoice_reference=EXCLUDED.invoice_reference,
            finance_notes=EXCLUDED.finance_notes,
            finance_confirmed_by=EXCLUDED.finance_confirmed_by,
            closed_at=EXCLUDED.closed_at,
            updated_at=NOW()
        RETURNING id
    """),
        {
            **payload.model_dump(),
            "plant_request_id": plant_request_id,
            "contribution_margin": contribution_margin,
            "org_id": user["org_id"],
            "user_id": user["sub"],
        },
    )
    closure_id = closure.scalar()
    await db.execute(
        text("""
        UPDATE fleet.plant_requests
        SET status=CASE WHEN :status='closed' THEN 'closed' ELSE 'under_reconciliation' END,
            closed_at=CASE WHEN :status='closed' THEN NOW() ELSE closed_at END,
            expected_revenue=GREATEST(expected_revenue, :internal_charge_amount + :external_invoice_amount + :damage_charge_amount),
            estimated_cost=GREATEST(estimated_cost, :operator_cost_amount + :fuel_cost_amount + :transport_cost_amount + :maintenance_cost_amount),
            contribution_margin=:contribution_margin,
            updated_at=NOW()
        WHERE id=:id AND organization_id=:org_id
    """),
        {
            **payload.model_dump(),
            "id": plant_request_id,
            "contribution_margin": contribution_margin,
            "org_id": user["org_id"],
        },
    )
    await emit_event(
        db,
        user=user,
        event_type="plant.financial_closure_posted.v1",
        aggregate_type="plant_financial_closure",
        aggregate_id=closure_id,
        project_id=request["project_id"],
        event_payload={**payload.model_dump(mode="json"), "contribution_margin": str(contribution_margin)},
    )
    await db.commit()
    await generate_task_stack(
        db,
        org_id=user["org_id"],
        entity_type="plant_closure",
        entity_id=closure_id,
        created_by=user["sub"],
    )
    return result({"id": str(closure_id)}, "Plant financial closure recorded.")


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
