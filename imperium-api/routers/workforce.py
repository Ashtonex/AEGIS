"""Tenant-scoped workforce operations: people, competency, allocation and time controls."""

from datetime import date, datetime
from decimal import Decimal
import json
from typing import Literal, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.compliance import validate_employee_deployment
from core.security import get_current_user, require_permission
from app.shared.sql import safe_payload_columns, update_tenant_row_sql

router = APIRouter()


class Payload(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class EmployeeCreate(Payload):
    employee_name: str = Field(min_length=1, max_length=255)
    job_title: Optional[str] = Field(default=None, max_length=100)
    employee_number: Optional[str] = Field(default=None, max_length=80)
    linked_user_id: Optional[UUID] = None
    employment_status: Literal["active", "on_leave", "suspended", "terminated"] = (
        "active"
    )
    employment_type: Optional[str] = Field(default=None, max_length=32)
    department: Optional[str] = Field(default=None, max_length=120)
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    work_location: Optional[str] = Field(default=None, max_length=255)
    emergency_contact: Optional[dict] = None

    @model_validator(mode="after")
    def valid_dates(self):
        if self.start_date and self.end_date and self.end_date < self.start_date:
            raise ValueError("end_date cannot precede start_date")
        return self


class EmployeeUpdate(Payload):
    employee_name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    job_title: Optional[str] = Field(default=None, max_length=100)
    employee_number: Optional[str] = Field(default=None, max_length=80)
    linked_user_id: Optional[UUID] = None
    employment_status: Optional[
        Literal["active", "on_leave", "suspended", "terminated"]
    ] = None
    employment_type: Optional[str] = Field(default=None, max_length=32)
    department: Optional[str] = Field(default=None, max_length=120)
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    work_location: Optional[str] = Field(default=None, max_length=255)
    emergency_contact: Optional[dict] = None


class SkillPayload(Payload):
    skill_name: str = Field(min_length=1, max_length=160)
    proficiency: Literal["basic", "working", "advanced", "expert"] = "working"
    notes: Optional[str] = None


class CertificationPayload(Payload):
    certification_name: str = Field(min_length=1, max_length=200)
    issuing_authority: Optional[str] = Field(default=None, max_length=200)
    certificate_number: Optional[str] = Field(default=None, max_length=160)
    issued_on: Optional[date] = None
    expires_on: Optional[date] = None
    evidence_path: Optional[str] = Field(default=None, max_length=2000)

    @model_validator(mode="after")
    def valid_dates(self):
        if self.issued_on and self.expires_on and self.expires_on < self.issued_on:
            raise ValueError("expires_on cannot precede issued_on")
        return self


class AvailabilityPayload(Payload):
    available_from: date
    available_to: date
    status: Literal["available", "leave", "unavailable", "training"]
    capacity_percent: Decimal = Field(default=Decimal("100"), ge=0, le=100)
    notes: Optional[str] = None

    @model_validator(mode="after")
    def valid_period(self):
        if self.available_to < self.available_from:
            raise ValueError("available_to cannot precede available_from")
        return self


class AllocationPayload(Payload):
    employee_id: UUID
    project_id: UUID
    role_on_project: Optional[str] = Field(default=None, max_length=120)
    allocation_percent: Decimal = Field(gt=0, le=100, max_digits=5, decimal_places=2)
    starts_on: date
    ends_on: date
    status: Literal["planned", "active", "completed", "cancelled"] = "planned"
    notes: Optional[str] = None

    @model_validator(mode="after")
    def valid_period(self):
        if self.ends_on < self.starts_on:
            raise ValueError("ends_on cannot precede starts_on")
        return self


class TimesheetPayload(Payload):
    employee_id: UUID
    project_id: Optional[UUID] = None
    work_date: date
    regular_hours: Decimal = Field(default=Decimal("0"), ge=0, le=24)
    overtime_hours: Decimal = Field(default=Decimal("0"), ge=0, le=24)
    description: Optional[str] = None

    @model_validator(mode="after")
    def has_hours(self):
        if self.regular_hours + self.overtime_hours <= 0:
            raise ValueError("at least one worked hour is required")
        return self


class TimesheetDecision(Payload):
    status: Literal["approved", "rejected"]


class UniversalAttendancePayload(Payload):
    employee_id: UUID
    # Event-based (old format)
    event_type: Optional[
        Literal["clock_in", "clock_out", "break_start", "break_end"]
    ] = None
    occurred_at: Optional[datetime] = None
    source: Optional[Literal["manual", "mobile", "biometric", "import"]] = "manual"
    location_label: Optional[str] = Field(default=None, max_length=255)
    latitude: Optional[Decimal] = Field(default=None, ge=-90, le=90)
    longitude: Optional[Decimal] = Field(default=None, ge=-180, le=180)
    # Record-based (new format)
    project_id: Optional[UUID] = None
    attendance_date: Optional[date] = None
    status: Optional[str] = "present"
    regular_hours: Optional[Decimal] = Decimal("8")
    overtime_hours: Optional[Decimal] = Decimal("0")
    notes: Optional[str] = None


def result(data, message: str, total: Optional[int] = None):
    return {
        "success": True,
        "data": data,
        "message": message,
        "meta": {} if total is None else {"total": total},
    }


async def employee_or_404(db: AsyncSession, employee_id: UUID, org_id: str) -> None:
    found = await db.execute(
        text("""SELECT 1 FROM hr.employees
        WHERE id = :employee_id AND organization_id = :org_id AND is_deleted = false"""),
        {"employee_id": employee_id, "org_id": org_id},
    )
    if not found.scalar():
        raise HTTPException(status_code=404, detail="Employee not found")


async def project_or_404(db: AsyncSession, project_id: UUID, org_id: str) -> None:
    found = await db.execute(
        text("""SELECT 1 FROM projects.projects
        WHERE id = :project_id AND organization_id = :org_id AND is_deleted = false"""),
        {"project_id": project_id, "org_id": org_id},
    )
    if not found.scalar():
        raise HTTPException(status_code=404, detail="Project not found")


@router.get("/")
async def list_employees(
    user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    rows = await db.execute(
        text("""
        SELECT e.*, COUNT(c.id) FILTER (WHERE c.expires_on < CURRENT_DATE AND c.is_deleted = false) AS expired_certifications
        FROM hr.employees e LEFT JOIN hr.employee_certifications c ON c.employee_id = e.id AND c.organization_id = e.organization_id
        WHERE e.organization_id = :org_id AND e.is_deleted = false
        GROUP BY e.id ORDER BY e.employee_name LIMIT 250
    """),
        {"org_id": user["org_id"]},
    )
    items = [dict(row._mapping) for row in rows]
    return result(items, "Workforce listed.", len(items))


@router.post("/", status_code=status.HTTP_201_CREATED)
async def create_employee(
    payload: EmployeeCreate,
    user: dict = Depends(require_permission("workforce.create")),
    db: AsyncSession = Depends(get_db),
):
    values = payload.model_dump()
    values["emergency_contact"] = (
        json.dumps(values["emergency_contact"])
        if values["emergency_contact"] is not None
        else None
    )
    query = text("""INSERT INTO hr.employees (organization_id, created_by, employee_name, job_title, employee_number, linked_user_id,
       employment_status, employment_type, department, start_date, end_date, work_location, emergency_contact)
       VALUES (:org_id, :user_id, :employee_name, :job_title, :employee_number, :linked_user_id, :employment_status,
       :employment_type, :department, :start_date, :end_date, :work_location, CAST(:emergency_contact AS jsonb)) RETURNING id""")
    try:
        new_id = (
            await db.execute(
                query, {**values, "org_id": user["org_id"], "user_id": user["sub"]}
            )
        ).scalar()
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=409, detail="Employee number or linked account already exists"
        ) from exc
    return result({"id": str(new_id)}, "Employee created.")


@router.put("/{employee_id}")
async def update_employee(
    employee_id: UUID,
    payload: EmployeeUpdate,
    user: dict = Depends(require_permission("workforce.update")),
    db: AsyncSession = Depends(get_db),
):
    await employee_or_404(db, employee_id, user["org_id"])
    values = payload.model_dump(exclude_unset=True)
    if not values:
        return result({"id": str(employee_id)}, "No fields to update.")
    if (
        values.get("start_date")
        and values.get("end_date")
        and values["end_date"] < values["start_date"]
    ):
        raise HTTPException(
            status_code=422, detail="end_date cannot precede start_date"
        )
    allowed = set(EmployeeUpdate.model_fields)
    safe_keys = safe_payload_columns(values.keys())
    try:
        await db.execute(
            update_tenant_row_sql(
                "hr.employees",
                safe_keys,
                allowed,
                id_param="employee_id",
                require_not_deleted=False,
            ),
            {
                **{key: values[key] for key in safe_keys},
                "employee_id": employee_id,
                "org_id": user["org_id"],
            },
        )
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=409, detail="Employee number or linked account already exists"
        ) from exc
    return result({"id": str(employee_id)}, "Employee updated.")


@router.get("/{employee_id}/skills")
async def list_skills(
    employee_id: UUID,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await employee_or_404(db, employee_id, user["org_id"])
    rows = await db.execute(
        text(
            "SELECT * FROM hr.employee_skills WHERE organization_id=:org_id AND employee_id=:employee_id AND is_deleted=false ORDER BY skill_name"
        ),
        {"org_id": user["org_id"], "employee_id": employee_id},
    )
    return result([dict(row._mapping) for row in rows], "Skills listed.")


@router.post("/{employee_id}/skills", status_code=status.HTTP_201_CREATED)
async def add_skill(
    employee_id: UUID,
    payload: SkillPayload,
    user: dict = Depends(require_permission("workforce.create")),
    db: AsyncSession = Depends(get_db),
):
    await employee_or_404(db, employee_id, user["org_id"])
    try:
        row = await db.execute(
            text("""INSERT INTO hr.employee_skills (organization_id, employee_id, skill_name, proficiency, notes, created_by)
            VALUES (:org_id,:employee_id,:skill_name,:proficiency,:notes,:user_id) RETURNING id"""),
            {
                **payload.model_dump(),
                "org_id": user["org_id"],
                "employee_id": employee_id,
                "user_id": user["sub"],
            },
        )
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=409, detail="Skill already recorded for employee"
        ) from exc
    return result({"id": str(row.scalar())}, "Skill added.")


@router.get("/{employee_id}/certifications")
async def list_certifications(
    employee_id: UUID,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await employee_or_404(db, employee_id, user["org_id"])
    rows = await db.execute(
        text("""SELECT *, CASE WHEN expires_on < CURRENT_DATE THEN true ELSE false END AS is_expired
        FROM hr.employee_certifications WHERE organization_id=:org_id AND employee_id=:employee_id AND is_deleted=false ORDER BY expires_on NULLS LAST"""),
        {"org_id": user["org_id"], "employee_id": employee_id},
    )
    return result([dict(row._mapping) for row in rows], "Certifications listed.")


@router.post("/{employee_id}/certifications", status_code=status.HTTP_201_CREATED)
async def add_certification(
    employee_id: UUID,
    payload: CertificationPayload,
    user: dict = Depends(require_permission("workforce.create")),
    db: AsyncSession = Depends(get_db),
):
    await employee_or_404(db, employee_id, user["org_id"])
    values = payload.model_dump()
    try:
        row = await db.execute(
            text("""INSERT INTO hr.employee_certifications (organization_id, employee_id, certification_name, issuing_authority,
            certificate_number, issued_on, expires_on, evidence_path, created_by) VALUES (:org_id,:employee_id,:certification_name,:issuing_authority,
            :certificate_number,:issued_on,:expires_on,:evidence_path,:user_id) RETURNING id"""),
            {
                **values,
                "org_id": user["org_id"],
                "employee_id": employee_id,
                "user_id": user["sub"],
            },
        )
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=409, detail="Certification already recorded for employee"
        ) from exc
    return result({"id": str(row.scalar())}, "Certification added.")


@router.post("/{employee_id}/availability", status_code=status.HTTP_201_CREATED)
async def set_availability(
    employee_id: UUID,
    payload: AvailabilityPayload,
    user: dict = Depends(require_permission("workforce.create")),
    db: AsyncSession = Depends(get_db),
):
    await employee_or_404(db, employee_id, user["org_id"])
    row = await db.execute(
        text("""INSERT INTO hr.employee_availability (organization_id, employee_id, available_from, available_to, status, capacity_percent, notes, created_by)
        VALUES (:org_id,:employee_id,:available_from,:available_to,:status,:capacity_percent,:notes,:user_id) RETURNING id"""),
        {
            **payload.model_dump(),
            "org_id": user["org_id"],
            "employee_id": employee_id,
            "user_id": user["sub"],
        },
    )
    await db.commit()
    return result({"id": str(row.scalar())}, "Availability recorded.")


@router.get("/allocations")
async def list_allocations(
    project_id: Optional[UUID] = None,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rows = await db.execute(
        text("""SELECT a.*, e.employee_name, p.name AS project_name FROM hr.project_allocations a
        JOIN hr.employees e ON e.id=a.employee_id AND e.organization_id=a.organization_id
        JOIN projects.projects p ON p.id=a.project_id AND p.organization_id=a.organization_id
        WHERE a.organization_id=:org_id AND a.is_deleted=false AND (:project_id IS NULL OR a.project_id=:project_id)
        ORDER BY a.starts_on DESC LIMIT 500"""),
        {"org_id": user["org_id"], "project_id": project_id},
    )
    return result([dict(row._mapping) for row in rows], "Allocations listed.")


@router.post("/allocations", status_code=status.HTTP_201_CREATED)
async def create_allocation(
    payload: AllocationPayload,
    user: dict = Depends(require_permission("workforce.create")),
    db: AsyncSession = Depends(get_db),
):
    await employee_or_404(db, payload.employee_id, user["org_id"])
    await project_or_404(db, payload.project_id, user["org_id"])
    compliance_gate_check_id = None
    if payload.status in ("planned", "active"):
        compliance_gate_check_id = await validate_employee_deployment(
            db,
            user=user,
            employee_id=payload.employee_id,
            gate_type="workforce_project_allocation",
            project_id=payload.project_id,
            effective_date=payload.starts_on,
            role_on_project=payload.role_on_project,
            source_type="project_allocation",
        )
    allocated = await db.execute(
        text("""SELECT COALESCE(SUM(allocation_percent), 0) FROM hr.project_allocations
        WHERE organization_id=:org_id AND employee_id=:employee_id AND is_deleted=false AND status IN ('planned','active')
          AND daterange(starts_on, ends_on, '[]') && daterange(:starts_on, :ends_on, '[]')"""),
        {**payload.model_dump(), "org_id": user["org_id"]},
    )
    if Decimal(allocated.scalar() or 0) + payload.allocation_percent > 100:
        raise HTTPException(
            status_code=409,
            detail="Allocation exceeds the employee's 100% capacity for the selected period",
        )
    row = await db.execute(
        text("""INSERT INTO hr.project_allocations (organization_id,employee_id,project_id,role_on_project,allocation_percent,starts_on,ends_on,status,notes,compliance_gate_check_id,compliance_status,created_by)
        VALUES (:org_id,:employee_id,:project_id,:role_on_project,:allocation_percent,:starts_on,:ends_on,:status,:notes,:compliance_gate_check_id,:compliance_status,:user_id) RETURNING id"""),
        {
            **payload.model_dump(),
            "compliance_gate_check_id": compliance_gate_check_id,
            "compliance_status": "passed" if compliance_gate_check_id else "pending",
            "org_id": user["org_id"],
            "user_id": user["sub"],
        },
    )
    allocation_id = row.scalar()
    if compliance_gate_check_id:
        await db.execute(
            text("""
            UPDATE compliance.deployment_gate_checks
            SET source_id=:allocation_id
            WHERE id=:check_id AND organization_id=:org_id
        """),
            {
                "allocation_id": allocation_id,
                "check_id": compliance_gate_check_id,
                "org_id": user["org_id"],
            },
        )
    await db.commit()
    return result(
        {
            "id": str(allocation_id),
            "compliance_gate_check_id": str(compliance_gate_check_id)
            if compliance_gate_check_id
            else None,
        },
        "Allocation created.",
    )


@router.post("/timesheets", status_code=status.HTTP_201_CREATED)
async def create_timesheet(
    payload: TimesheetPayload,
    user: dict = Depends(require_permission("workforce.create")),
    db: AsyncSession = Depends(get_db),
):
    await employee_or_404(db, payload.employee_id, user["org_id"])
    if payload.project_id:
        await project_or_404(db, payload.project_id, user["org_id"])
    try:
        row = await db.execute(
            text("""INSERT INTO hr.timesheets (organization_id,employee_id,project_id,work_date,regular_hours,overtime_hours,description,created_by)
            VALUES (:org_id,:employee_id,:project_id,:work_date,:regular_hours,:overtime_hours,:description,:user_id) RETURNING id"""),
            {**payload.model_dump(), "org_id": user["org_id"], "user_id": user["sub"]},
        )
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=409,
            detail="A timesheet already exists for this employee, project and date",
        ) from exc
    return result({"id": str(row.scalar())}, "Timesheet created.")


@router.post("/timesheets/{timesheet_id}/submit")
async def submit_timesheet(
    timesheet_id: UUID,
    user: dict = Depends(require_permission("workforce.update")),
    db: AsyncSession = Depends(get_db),
):
    row = await db.execute(
        text("""UPDATE hr.timesheets SET status='submitted', submitted_at=NOW(), updated_at=NOW()
        WHERE id=:id AND organization_id=:org_id AND is_deleted=false AND status='draft' RETURNING id"""),
        {"id": timesheet_id, "org_id": user["org_id"]},
    )
    if not row.scalar():
        raise HTTPException(
            status_code=409, detail="Only draft timesheets can be submitted"
        )
    await db.commit()
    return result({"id": str(timesheet_id)}, "Timesheet submitted.")


@router.post("/timesheets/{timesheet_id}/decision")
async def decide_timesheet(
    timesheet_id: UUID,
    payload: TimesheetDecision,
    user: dict = Depends(require_permission("workforce.update")),
    db: AsyncSession = Depends(get_db),
):
    row = await db.execute(
        text("""UPDATE hr.timesheets SET status=:status, approved_at=NOW(), approved_by=:user_id, updated_at=NOW()
        WHERE id=:id AND organization_id=:org_id AND is_deleted=false AND status='submitted' RETURNING id"""),
        {
            "id": timesheet_id,
            "status": payload.status,
            "user_id": user["sub"],
            "org_id": user["org_id"],
        },
    )
    if not row.scalar():
        raise HTTPException(
            status_code=409, detail="Only submitted timesheets can be decided"
        )
    await db.commit()
    return result({"id": str(timesheet_id)}, f"Timesheet {payload.status}.")


@router.get("/attendance")
async def list_attendance(
    date_filter: Optional[date] = Query(default=None, alias="date"),
    project_id: Optional[UUID] = None,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    List attendance records under organization scope.
    """
    query_str = """
        SELECT ar.*, e.employee_name
        FROM hr.attendance_records ar
        JOIN hr.employees e ON e.id = ar.employee_id AND e.organization_id = ar.organization_id
        WHERE ar.organization_id = :org_id AND ar.is_deleted = false
    """
    params = {"org_id": user["org_id"]}
    if date_filter:
        query_str += " AND ar.work_date = :date"
        params["date"] = date_filter
    if project_id:
        query_str += " AND ar.project_id = :project_id"
        params["project_id"] = project_id

    query_str += " ORDER BY ar.work_date DESC, e.employee_name"

    rows = await db.execute(text(query_str), params)
    data = [dict(row._mapping) for row in rows]
    return result(data, "Attendance records listed.", len(data))


@router.post("/attendance", status_code=status.HTTP_201_CREATED)
async def record_attendance(
    payload: UniversalAttendancePayload,
    user: dict = Depends(require_permission("workforce.create")),
    db: AsyncSession = Depends(get_db),
):
    await employee_or_404(db, payload.employee_id, user["org_id"])

    # If attendance_date is provided, it's the new record-based format
    if payload.attendance_date is not None:
        work_date = payload.attendance_date
        check_in = datetime.combine(work_date, datetime.min.time())  # start of day
        check_out = datetime.combine(
            work_date, datetime.max.time()
        )  # end of day if present

        row = await db.execute(
            text("""
            INSERT INTO hr.attendance_records (
                organization_id, employee_id, project_id, work_date, check_in, check_out,
                status, regular_hours, overtime_hours, notes, created_by
            ) VALUES (
                :org_id, :employee_id, :project_id, :work_date, :check_in, :check_out,
                :status, :regular_hours, :overtime_hours, :notes, :user_id
            ) RETURNING id
        """),
            {
                "org_id": user["org_id"],
                "employee_id": payload.employee_id,
                "project_id": payload.project_id,
                "work_date": work_date,
                "check_in": check_in,
                "check_out": check_out,
                "status": payload.status,
                "regular_hours": payload.regular_hours,
                "overtime_hours": payload.overtime_hours,
                "notes": payload.notes,
                "user_id": user["user_id"],
            },
        )
        await db.commit()
        return result(
            {"id": str(row.scalar())}, "HR Attendance record logged successfully."
        )

    # Otherwise, it's the event-based coordinate clock in/out format
    event_type = payload.event_type or "clock_in"
    row = await db.execute(
        text("""
        INSERT INTO hr.attendance_events (
            organization_id, employee_id, event_type, occurred_at, source,
            location_label, latitude, longitude, recorded_by
        ) VALUES (
            :org_id, :employee_id, :event_type, COALESCE(:occurred_at, NOW()), :source,
            :location_label, :latitude, :longitude, :user_id
        ) RETURNING id
    """),
        {
            "org_id": user["org_id"],
            "employee_id": payload.employee_id,
            "event_type": event_type,
            "occurred_at": payload.occurred_at,
            "source": payload.source,
            "location_label": payload.location_label,
            "latitude": payload.latitude,
            "longitude": payload.longitude,
            "user_id": user["user_id"],
        },
    )
    await db.commit()
    return result({"id": str(row.scalar())}, "Attendance event recorded.")
