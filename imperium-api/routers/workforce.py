"""Tenant-scoped workforce operations: people, competency, allocation and time controls."""

from datetime import date, datetime
from decimal import Decimal
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
from app.shared.hr_self_service import resolve_own_employee_id

from schemas.workforce_foundation import (
    PersonCreate as EmployeeCreate,
    PersonUpdate as EmployeeUpdate,
)
from routers.workforce_foundation import (
    DB,
    CommandKey,
    create_person as register_worker,
    update_person as revise_worker,
)

router = APIRouter()


class Payload(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


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
        if self.regular_hours + self.overtime_hours > 24:
            raise ValueError("total worked hours cannot exceed 24")
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
    status: Literal[
        "present", "absent", "late", "half_day", "on_leave", "public_holiday"
    ] = "present"
    regular_hours: Decimal = Field(default=Decimal("8"), ge=0, le=24)
    overtime_hours: Decimal = Field(default=Decimal("0"), ge=0, le=24)
    notes: Optional[str] = None

    @model_validator(mode="after")
    def valid_record(self):
        if self.attendance_date is not None:
            if self.event_type is not None:
                raise ValueError("Send either an attendance record or a clock event")
            if self.regular_hours + self.overtime_hours > 24:
                raise ValueError("total worked hours cannot exceed 24")
            if (
                self.status in ("absent", "on_leave")
                and self.regular_hours + self.overtime_hours
            ):
                raise ValueError("Absent and on-leave records must have zero hours")
        return self


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
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("workforce.read")),
):
    rows = await db.execute(
        text("""
        SELECT e.id,e.employee_name,e.employee_number,e.job_title,e.employment_status,
               e.employment_type,e.department,e.start_date,e.end_date,e.work_location,
               COUNT(c.id) FILTER (WHERE c.expires_on < CURRENT_DATE AND c.is_deleted = false) AS expired_certifications
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
    db: DB,
    key: CommandKey,
    user: dict = Depends(require_permission("workforce.people.create")),
):
    """Compatibility route with the same receipts and guards as foundation (INSERT INTO hr.employees)."""
    return await register_worker(payload=payload, db=db, key=key, user=user)


@router.put("/{employee_id}")
async def update_employee(
    employee_id: UUID,
    payload: EmployeeUpdate,
    db: DB,
    key: CommandKey,
    user: dict = Depends(require_permission("workforce.people.update")),
):
    return await revise_worker(
        employee_id=employee_id, payload=payload, db=db, key=key, user=user
    )


@router.get("/{employee_id}/skills")
async def list_skills(
    employee_id: UUID,
    user: dict = Depends(require_permission("workforce.read")),
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
    _: dict = Depends(require_permission("workforce.read")),
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
    _: dict = Depends(require_permission("workforce.read")),
):
    rows = await db.execute(
        text("""SELECT a.*, e.employee_name, p.name AS project_name FROM hr.project_allocations a
        JOIN hr.employees e ON e.id=a.employee_id AND e.organization_id=a.organization_id
        JOIN projects.projects p ON p.id=a.project_id AND p.organization_id=a.organization_id
        WHERE a.organization_id=:org_id AND a.is_deleted=false AND (CAST(:project_id AS uuid) IS NULL OR a.project_id=CAST(:project_id AS uuid))
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


@router.get("/timesheets")
async def list_timesheets(
    date_from: date,
    date_to: date,
    project_id: Optional[UUID] = None,
    user: dict = Depends(require_permission("workforce.read")),
    db: AsyncSession = Depends(get_db),
):
    if date_to < date_from or (date_to - date_from).days > 31:
        raise HTTPException(
            status_code=422, detail="Choose a period of at most 32 days"
        )
    rows = await db.execute(
        text("""
        SELECT t.*, e.employee_name, p.name AS project_name
        FROM hr.timesheets t
        JOIN hr.employees e ON e.id=t.employee_id AND e.organization_id=t.organization_id
        LEFT JOIN projects.projects p ON p.id=t.project_id AND p.organization_id=t.organization_id
        WHERE t.organization_id=:org_id AND t.is_deleted=false
          AND t.work_date BETWEEN :date_from AND :date_to
          AND (CAST(:project_id AS uuid) IS NULL OR t.project_id=CAST(:project_id AS uuid))
        ORDER BY t.work_date DESC, e.employee_name
    """),
        {
            "org_id": user["org_id"],
            "date_from": date_from,
            "date_to": date_to,
            "project_id": project_id,
        },
    )
    items = [dict(row._mapping) for row in rows]
    return result(items, "Timesheets listed.", len(items))


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
    # Serialize decisions and require a reviewer independent of worker and author.
    existing = await db.execute(
        text("""
        SELECT t.*, e.linked_user_id FROM hr.timesheets t
        JOIN hr.employees e ON e.id=t.employee_id AND e.organization_id=t.organization_id
        WHERE t.id=:id AND t.organization_id=:org_id AND t.is_deleted=false
        FOR UPDATE OF t
    """),
        {"id": timesheet_id, "org_id": user["org_id"]},
    )
    sheet = existing.mappings().first()
    if not sheet or sheet["status"] != "submitted":
        raise HTTPException(
            status_code=409, detail="Only submitted timesheets can be decided"
        )
    if str(user["sub"]) in (str(sheet["created_by"]), str(sheet["linked_user_id"])):
        raise HTTPException(
            status_code=403, detail="A separate reviewer must decide this timesheet"
        )
    if payload.status == "approved":
        if not sheet["project_id"] or not (sheet["description"] or "").strip():
            raise HTTPException(
                status_code=409,
                detail="Project and activity evidence are required before approval",
            )
        evidence = await db.execute(
            text("""
            SELECT regular_hours, overtime_hours FROM hr.attendance_records
            WHERE organization_id=:org_id AND employee_id=:employee_id
              AND project_id=:project_id AND attendance_date=:work_date
              AND is_deleted=false AND status IN ('present', 'late', 'half_day', 'public_holiday')
            FOR SHARE
        """),
            {
                "org_id": user["org_id"],
                "employee_id": sheet["employee_id"],
                "project_id": sheet["project_id"],
                "work_date": sheet["work_date"],
            },
        )
        attendance = evidence.mappings().first()
        if not attendance or any(
            Decimal(sheet[key]) > Decimal(attendance[key])
            for key in ("regular_hours", "overtime_hours")
        ):
            raise HTTPException(
                status_code=409,
                detail="Recorded attendance must support both ordinary and overtime hours before approval",
            )
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
    _: dict = Depends(require_permission("workforce.read")),
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
        query_str += " AND ar.attendance_date = :date"
        params["date"] = date_filter
    if project_id:
        query_str += " AND ar.project_id = :project_id"
        params["project_id"] = project_id

    query_str += " ORDER BY ar.attendance_date DESC, e.employee_name"

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

    if payload.project_id:
        await project_or_404(db, payload.project_id, user["org_id"])

    # If attendance_date is provided, it's the new record-based format
    if payload.attendance_date is not None:
        work_date = payload.attendance_date
        # Manual registers do not provide clock evidence; leave timestamps unset.

        row = await db.execute(
            text("""
            INSERT INTO hr.attendance_records (
                organization_id, employee_id, project_id, attendance_date,
                status, regular_hours, overtime_hours, notes, recorded_by
            ) VALUES (
                :org_id, :employee_id, :project_id, :work_date,
                :status, :regular_hours, :overtime_hours, :notes, :user_id
            ) ON CONFLICT (organization_id, employee_id, attendance_date) DO NOTHING RETURNING id
        """),
            {
                "org_id": user["org_id"],
                "employee_id": payload.employee_id,
                "project_id": payload.project_id,
                "work_date": work_date,
                "status": payload.status,
                "regular_hours": payload.regular_hours,
                "overtime_hours": payload.overtime_hours,
                "notes": payload.notes,
                "user_id": user["sub"],
            },
        )
        attendance_id = row.scalar()
        if not attendance_id:
            raise HTTPException(
                status_code=409,
                detail="Attendance already exists for this worker and date; existing evidence was preserved",
            )
        await db.commit()
        return result(
            {"id": str(attendance_id)}, "HR Attendance record logged successfully."
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
            "user_id": user["sub"],
        },
    )
    await db.commit()
    return result({"id": str(row.scalar())}, "Attendance event recorded.")


@router.get("/me/attendance")
async def list_my_attendance(
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Self-service: the caller's own attendance history. No require_permission -
    scoped entirely by resolve_own_employee_id, never a client-supplied
    employee_id, so nobody can read anyone else's attendance through this."""
    employee_id = await resolve_own_employee_id(
        db, org_id=user["org_id"], user_id=user["user_id"]
    )
    if not employee_id:
        raise HTTPException(
            status_code=404, detail="Employee identity is not provisioned."
        )
    rows = await db.execute(
        text("""
            SELECT * FROM hr.attendance_records
            WHERE organization_id = :org_id AND employee_id = :employee_id AND is_deleted = false
            ORDER BY attendance_date DESC
        """),
        {"org_id": user["org_id"], "employee_id": employee_id},
    )
    data = [dict(row._mapping) for row in rows]
    return result(data, "Attendance records listed.", len(data))


@router.get("/{employee_id}")
async def get_employee(
    employee_id: UUID,
    user: dict = Depends(require_permission("workforce.read")),
    db: AsyncSession = Depends(get_db),
):
    row = await db.execute(
        text("""
            SELECT e.id,e.employee_name,e.employee_number,e.job_title,e.employment_status,
                   e.employment_type,e.department,e.start_date,e.end_date,e.work_location
            FROM hr.employees e
            WHERE e.id = :employee_id
              AND e.organization_id = :org_id
              AND e.is_deleted = false
        """),
        {"employee_id": employee_id, "org_id": user["org_id"]},
    )
    employee = row.first()
    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found")
    return result(dict(employee._mapping), "Employee retrieved.")
