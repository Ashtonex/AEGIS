"""Person card: one record per person, shared by the HR and Workforce screens.

Mounted at /api/v1/hr/people. The Workforce foundation router stays the
authority for creating, renaming and archiving workers; this router owns the
sections the person card edits (employment, line manager, personal details,
pay, psychometrics) and leaving the organisation. Every section is
permission-gated on its own so a Workforce clerk can see where someone is
deployed without seeing their salary or ID number.
"""

from __future__ import annotations

import json
from datetime import date
from typing import Literal, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.shared.pagination import ok
from core.database import get_db
from core.security import get_current_user, require_permission, user_has_permission

router = APIRouter()

EMPLOYMENT_TYPES = ("permanent", "fixed_term", "casual", "intern", "consultant")
PERSONAL_FIELDS = (
    "national_id", "date_of_birth", "gender", "nationality", "marital_status",
    "personal_phone", "personal_email", "home_address", "highest_qualification",
    "professional_body", "professional_registration_number",
)


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class EmploymentUpdate(Input):
    employee_name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    job_title: Optional[str] = Field(default=None, max_length=100)
    category_id: Optional[UUID] = None
    position_id: Optional[UUID] = None
    department_id: Optional[UUID] = None
    employment_type: Optional[Literal["permanent", "fixed_term", "casual", "intern", "consultant"]] = None
    start_date: Optional[date] = None
    work_location: Optional[str] = Field(default=None, max_length=255)
    annual_leave_days: Optional[int] = Field(default=None, ge=0, le=60)
    employment_status: Optional[Literal["active", "on_leave", "suspended"]] = None
    # Sentinel: omit to leave unchanged, null to clear the line manager.
    line_manager_id: Optional[UUID] = None


class EmergencyContact(Input):
    name: Optional[str] = Field(default=None, max_length=160)
    relationship: Optional[str] = Field(default=None, max_length=80)
    phone: Optional[str] = Field(default=None, max_length=40)
    address: Optional[str] = Field(default=None, max_length=500)


class PersonalUpdate(Input):
    national_id: Optional[str] = Field(default=None, max_length=40)
    date_of_birth: Optional[date] = None
    gender: Optional[str] = Field(default=None, max_length=20)
    nationality: Optional[str] = Field(default=None, max_length=80)
    marital_status: Optional[str] = Field(default=None, max_length=20)
    personal_phone: Optional[str] = Field(default=None, max_length=40)
    personal_email: Optional[str] = Field(default=None, max_length=255)
    home_address: Optional[str] = Field(default=None, max_length=1000)
    highest_qualification: Optional[str] = Field(default=None, max_length=160)
    professional_body: Optional[str] = Field(default=None, max_length=160)
    professional_registration_number: Optional[str] = Field(default=None, max_length=80)
    emergency_contact: Optional[EmergencyContact] = None

    @model_validator(mode="after")
    def plausible_birth_date(self):
        if self.date_of_birth and not (date(1930, 1, 1) <= self.date_of_birth <= date.today()):
            raise ValueError("Date of birth is not plausible")
        return self


class PayUpdate(Input):
    pay_type: Literal["monthly_salary", "hourly", "daily"]
    base_rate: float = Field(ge=0)
    overtime_rate: float = Field(default=0.0, ge=0)
    currency: str = Field(default="USD", min_length=3, max_length=3)
    bank_name: Optional[str] = Field(default=None, max_length=160)
    bank_account_number: Optional[str] = Field(default=None, max_length=120)
    tax_number: Optional[str] = Field(default=None, max_length=80)
    nssa_number: Optional[str] = Field(default=None, max_length=80)


class PsychometricCreate(Input):
    test_name: str = Field(min_length=2, max_length=160)
    provider: Optional[str] = Field(default=None, max_length=160)
    assessed_on: Optional[date] = None
    overall_score: Optional[float] = Field(default=None, ge=0)
    max_score: Optional[float] = Field(default=None, gt=0)
    dimension_scores: dict[str, float] = Field(default_factory=dict)
    interpretation: Optional[str] = Field(default=None, max_length=4000)
    recruitment_assessment_id: Optional[UUID] = None

    @model_validator(mode="after")
    def score_within_max(self):
        if self.overall_score is not None and self.max_score is not None and self.overall_score > self.max_score:
            raise ValueError("Score cannot exceed the maximum")
        return self


class LeaveOrganisation(Input):
    left_on: date
    reason: str = Field(min_length=3, max_length=2000)
    disable_login: bool = True


class Reinstate(Input):
    reason: str = Field(min_length=3, max_length=2000)


class EndAllocation(Input):
    ends_on: date


async def _employee(db: AsyncSession, org_id, employee_id, *, include_left=True) -> dict:
    row = (
        await db.execute(
            text("""
            SELECT e.*, c.name AS category_name, c.code AS category_code,
                   p.name AS position_name, p.code AS position_code, p.grade AS position_grade,
                   d.name AS department_name,
                   u.email AS login_email, u.is_active AS login_active,
                   lb.full_name AS left_recorded_by_name
            FROM hr.employees e
            LEFT JOIN hr.worker_categories c ON c.id = e.category_id AND c.organization_id = e.organization_id
            LEFT JOIN hr.positions p ON p.id = e.position_id AND p.organization_id = e.organization_id
            LEFT JOIN finance.departments d ON d.id = e.department_id AND d.organization_id = e.organization_id
            LEFT JOIN core.users u ON u.id = e.linked_user_id
            LEFT JOIN core.users lb ON lb.id = e.left_recorded_by
            WHERE e.organization_id = :org AND e.id = :id AND e.is_deleted = false
            """),
            {"org": org_id, "id": employee_id},
        )
    ).mappings().first()
    if not row:
        raise HTTPException(404, "Person not found")
    if not include_left and row["employment_status"] == "terminated":
        raise HTTPException(409, "This person has left the organisation; reinstate them first")
    return dict(row)


async def _ref_exists(db, org_id, table: str, ref_id) -> bool:
    return bool(
        (
            await db.execute(
                text(f"SELECT 1 FROM {table} WHERE organization_id=:org AND id=:id AND is_deleted=false"),
                {"org": org_id, "id": ref_id},
            )
        ).scalar()
    )


async def _line_manager(db, org_id, employee_id) -> Optional[dict]:
    row = (
        await db.execute(
            text("""
            SELECT r.id, r.manager_employee_id, r.effective_from, m.employee_name AS manager_name,
                   m.job_title AS manager_job_title, m.employee_number AS manager_number
            FROM hr.reporting_lines r
            JOIN hr.employees m ON m.id = r.manager_employee_id AND m.organization_id = r.organization_id
            WHERE r.organization_id = :org AND r.employee_id = :id AND r.is_deleted = false
              AND r.relationship_type = 'line_manager'
              AND r.effective_from <= CURRENT_DATE AND (r.effective_to IS NULL OR r.effective_to >= CURRENT_DATE)
            ORDER BY r.effective_from DESC LIMIT 1
            """),
            {"org": org_id, "id": employee_id},
        )
    ).mappings().first()
    return dict(row) if row else None


async def _set_line_manager(db, user, employee_id, manager_id: Optional[UUID]) -> None:
    """One current line manager per person. Changing it closes the old link
    yesterday and opens a new one today, so history stays dated."""
    org_id = user["org_id"]
    await db.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:key,0))"),
        {"key": f"reporting:{org_id}"},
    )
    current = await _line_manager(db, org_id, employee_id)
    if current and manager_id and str(current["manager_employee_id"]) == str(manager_id):
        return
    if manager_id:
        if str(manager_id) == str(employee_id):
            raise HTTPException(422, "A person cannot be their own line manager")
        manager = await _employee(db, org_id, manager_id)
        if manager["employment_status"] == "terminated":
            raise HTTPException(422, "The chosen manager has left the organisation")
        # Refuse a loop: walk up from the proposed manager.
        loop = (
            await db.execute(
                text("""
                WITH RECURSIVE up(id, depth) AS (
                  SELECT CAST(:manager AS uuid), 0
                  UNION ALL
                  SELECT r.manager_employee_id, up.depth + 1 FROM hr.reporting_lines r JOIN up ON r.employee_id = up.id
                  WHERE r.organization_id = :org AND r.is_deleted = false AND r.relationship_type = 'line_manager'
                    AND r.effective_from <= CURRENT_DATE AND (r.effective_to IS NULL OR r.effective_to >= CURRENT_DATE)
                    AND up.depth < 50
                ) SELECT 1 FROM up WHERE id = CAST(:employee AS uuid) LIMIT 1
                """),
                {"org": org_id, "manager": manager_id, "employee": employee_id},
            )
        ).scalar()
        if loop:
            raise HTTPException(422, "That would make a reporting loop (this person already manages that manager)")
    # Close every open line-manager link: ones that started today are voided, older ones end yesterday.
    await db.execute(
        text("""
        UPDATE hr.reporting_lines
        SET is_deleted = (effective_from >= CURRENT_DATE),
            effective_to = CASE WHEN effective_from >= CURRENT_DATE THEN effective_to ELSE CURRENT_DATE - 1 END,
            updated_at = now()
        WHERE organization_id = :org AND employee_id = :id AND is_deleted = false
          AND relationship_type = 'line_manager' AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
        """),
        {"org": org_id, "id": employee_id},
    )
    if manager_id:
        await db.execute(
            text("""
            INSERT INTO hr.reporting_lines (organization_id, employee_id, manager_employee_id, relationship_type, effective_from, created_by)
            VALUES (:org, :id, :manager, 'line_manager', CURRENT_DATE, :actor)
            """),
            {"org": org_id, "id": employee_id, "manager": manager_id, "actor": user["user_id"]},
        )


def _mask(value: Optional[str]) -> Optional[str]:
    if not value:
        return value
    tail = value[-4:]
    return f"{'•' * max(0, min(len(value) - 4, 8))}{tail}"


async def _can_any(db, user, *keys: str) -> bool:
    for key in keys:
        if await user_has_permission(db, user, key):
            return True
    return False


async def _dossier(db: AsyncSession, user: dict, employee_id, *, is_self: bool = False) -> dict:
    org_id = user["org_id"]
    person = await _employee(db, org_id, employee_id)
    can_personal_hr = await _can_any(db, user, "hr.people.personal.read")
    can_personal = is_self or can_personal_hr
    can_pay_read = await _can_any(db, user, "hr.payroll.read", "hr.payroll.manage", "finance.payroll.manage")
    can_pay_manage = await _can_any(db, user, "hr.payroll.manage", "finance.payroll.manage")

    employment_keys = (
        "id", "employee_number", "employee_name", "job_title", "employment_status", "employment_type",
        "category_id", "category_name", "category_code", "position_id", "position_name", "position_code",
        "position_grade", "department_id", "department_name", "start_date", "end_date", "work_location",
        "annual_leave_days", "version", "login_email", "login_active", "left_reason", "left_recorded_at",
        "left_recorded_by_name", "created_at", "self_profile_updated_at",
    )
    data: dict = {"person": {k: person.get(k) for k in employment_keys}}
    data["line_manager"] = await _line_manager(db, org_id, employee_id)
    data["direct_reports"] = [
        dict(r)
        for r in (
            await db.execute(
                text("""
                SELECT e.id, e.employee_name, e.job_title, e.employee_number FROM hr.reporting_lines r
                JOIN hr.employees e ON e.id = r.employee_id AND e.organization_id = r.organization_id
                WHERE r.organization_id = :org AND r.manager_employee_id = :id AND r.is_deleted = false
                  AND r.relationship_type = 'line_manager' AND e.is_deleted = false AND e.employment_status <> 'terminated'
                  AND r.effective_from <= CURRENT_DATE AND (r.effective_to IS NULL OR r.effective_to >= CURRENT_DATE)
                ORDER BY e.employee_name
                """),
                {"org": org_id, "id": employee_id},
            )
        ).mappings()
    ]
    data["allocations"] = [
        dict(r)
        for r in (
            await db.execute(
                text("""
                SELECT a.id, a.project_id, p.name AS project_name, p.project_code, a.role_on_project,
                       a.allocation_percent, a.starts_on, a.ends_on, a.status, a.compliance_status
                FROM hr.project_allocations a
                JOIN projects.projects p ON p.id = a.project_id AND p.organization_id = a.organization_id
                WHERE a.organization_id = :org AND a.employee_id = :id AND a.is_deleted = false
                ORDER BY (a.status IN ('planned','active') AND a.ends_on >= CURRENT_DATE) DESC, a.starts_on DESC
                LIMIT 100
                """),
                {"org": org_id, "id": employee_id},
            )
        ).mappings()
    ]
    if can_personal:
        data["personal"] = {**{k: person.get(k) for k in PERSONAL_FIELDS}, "emergency_contact": _contact(person.get("emergency_contact"))}
    if can_personal_hr:
        # Assessor interpretations are HR-only, even on your own card.
        data["psychometrics"] = [
            dict(r)
            for r in (
                await db.execute(
                    text("""
                    SELECT id, test_name, provider, assessed_on, overall_score, max_score, dimension_scores,
                           interpretation, recruitment_assessment_id, created_at
                    FROM hr.employee_psychometrics
                    WHERE organization_id = :org AND employee_id = :id AND is_deleted = false
                    ORDER BY assessed_on DESC NULLS LAST, created_at DESC
                    """),
                    {"org": org_id, "id": employee_id},
                )
            ).mappings()
        ]
    if can_pay_read or is_self:
        pay = (
            await db.execute(
                text("""
                SELECT pay_type, base_rate, overtime_rate, currency, bank_name, bank_account_number,
                       tax_number, nssa_number, is_active, updated_at
                FROM finance.employee_pay_profiles
                WHERE organization_id = :org AND employee_id = :id AND is_deleted = false
                """),
                {"org": org_id, "id": employee_id},
            )
        ).mappings().first()
        pay = dict(pay) if pay else None
        if pay and not can_pay_manage:
            pay["bank_account_number"] = _mask(pay.get("bank_account_number"))
        data["pay"] = pay
    data["access"] = {
        "personal": can_personal,
        "personal_manage": is_self or await _can_any(db, user, "hr.people.personal.manage"),
        "pay": can_pay_read or is_self,
        "pay_manage": can_pay_manage,
        "employment_manage": await _can_any(db, user, "workforce.people.update"),
        "allocate": await _can_any(db, user, "workforce.create"),
        "offboard": await _can_any(db, user, "hr.people.offboard"),
        "files": await _can_any(db, user, "hr.operations.read"),
        "files_manage": await _can_any(db, user, "hr.operations.update"),
    }
    data["completeness"] = _completeness(person, data)
    return data


def _contact(value) -> dict:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError:
            return {}
    return value if isinstance(value, dict) else {}


def _completeness(person: dict, data: dict) -> dict:
    """What is still missing from this person's card, for nudges and the HR dashboard."""
    checks = {
        "Role": bool(person.get("position_id")),
        "Department": bool(person.get("department_id")),
        "Start date": bool(person.get("start_date")),
        "Employment type": bool(person.get("employment_type")),
        "Line manager": bool(data.get("line_manager")) or person.get("position_code") == "MD",
        "National ID": bool(person.get("national_id")),
        "Date of birth": bool(person.get("date_of_birth")),
        "Phone": bool(person.get("personal_phone")),
        "Next of kin": bool(_contact(person.get("emergency_contact")).get("name")),
        "Pay profile": data.get("pay") is not None if "pay" in data else True,
    }
    missing = [k for k, ok_ in checks.items() if not ok_]
    return {"percent": round(100 * (len(checks) - len(missing)) / len(checks)), "missing": missing}


async def _bump(db, org_id, employee_id) -> None:
    await db.execute(
        text("UPDATE hr.employees SET version = version + 1, updated_at = now() WHERE organization_id=:org AND id=:id"),
        {"org": org_id, "id": employee_id},
    )


# --------------------------------------------------------------------------- reads

@router.get("/summary")
async def people_summary(
    user: dict = Depends(require_permission("workforce.people.read")),
    db: AsyncSession = Depends(get_db),
):
    """Headline numbers for the HR dashboard."""
    org = user["org_id"]
    row = (
        await db.execute(
            text("""
            WITH staff AS (
              SELECT e.*, u.is_active AS login_active FROM hr.employees e
              LEFT JOIN core.users u ON u.id = e.linked_user_id
              WHERE e.organization_id = :org AND e.is_deleted = false
            )
            SELECT
              COUNT(*) FILTER (WHERE employment_status <> 'terminated') AS headcount,
              COUNT(*) FILTER (WHERE employment_status = 'active') AS active,
              COUNT(*) FILTER (WHERE employment_status = 'on_leave') AS on_leave_status,
              COUNT(*) FILTER (WHERE employment_status = 'suspended') AS suspended,
              COUNT(*) FILTER (WHERE employment_status = 'terminated') AS former,
              COUNT(*) FILTER (WHERE employment_status <> 'terminated' AND login_active = false) AS login_disabled_but_active,
              COUNT(*) FILTER (WHERE employment_status <> 'terminated' AND position_id IS NULL) AS missing_role,
              COUNT(*) FILTER (WHERE employment_status <> 'terminated' AND start_date IS NULL) AS missing_start_date,
              COUNT(*) FILTER (WHERE employment_status <> 'terminated' AND (national_id IS NULL OR date_of_birth IS NULL OR personal_phone IS NULL)) AS missing_personal,
              COUNT(*) FILTER (WHERE employment_status <> 'terminated' AND NOT EXISTS (
                  SELECT 1 FROM finance.employee_pay_profiles pp WHERE pp.organization_id = staff.organization_id
                  AND pp.employee_id = staff.id AND pp.is_deleted = false)) AS missing_pay_profile,
              COUNT(*) FILTER (WHERE employment_status <> 'terminated' AND NOT EXISTS (
                  SELECT 1 FROM hr.project_allocations a WHERE a.organization_id = staff.organization_id AND a.employee_id = staff.id
                  AND a.is_deleted = false AND a.status IN ('planned','active') AND a.ends_on >= CURRENT_DATE)) AS unallocated
            FROM staff
            """),
            {"org": org},
        )
    ).mappings().first()
    on_leave_today = (
        await db.execute(
            text("""SELECT COUNT(DISTINCT employee_id) FROM hr.leave_requests WHERE organization_id=:org AND is_deleted=false
            AND status='approved' AND CURRENT_DATE BETWEEN start_date AND end_date"""),
            {"org": org},
        )
    ).scalar() or 0
    by_category = [
        dict(r)
        for r in (
            await db.execute(
                text("""
                SELECT COALESCE(c.name, 'No discipline') AS name, COUNT(*) AS people
                FROM hr.employees e LEFT JOIN hr.worker_categories c ON c.id = e.category_id AND c.organization_id = e.organization_id
                WHERE e.organization_id = :org AND e.is_deleted = false AND e.employment_status <> 'terminated'
                GROUP BY 1 ORDER BY 2 DESC, 1
                """),
                {"org": org},
            )
        ).mappings()
    ]
    by_department = [
        dict(r)
        for r in (
            await db.execute(
                text("""
                SELECT COALESCE(d.name, 'No department') AS name, COUNT(*) AS people
                FROM hr.employees e LEFT JOIN finance.departments d ON d.id = e.department_id AND d.organization_id = e.organization_id
                WHERE e.organization_id = :org AND e.is_deleted = false AND e.employment_status <> 'terminated'
                GROUP BY 1 ORDER BY 2 DESC, 1
                """),
                {"org": org},
            )
        ).mappings()
    ]
    recent_leavers = [
        dict(r)
        for r in (
            await db.execute(
                text("""SELECT id, employee_name, employee_number, end_date, left_reason FROM hr.employees
                WHERE organization_id=:org AND is_deleted=false AND employment_status='terminated'
                ORDER BY COALESCE(end_date, left_recorded_at::date) DESC NULLS LAST LIMIT 10"""),
                {"org": org},
            )
        ).mappings()
    ]
    return ok({**dict(row), "on_leave_today": on_leave_today, "by_category": by_category,
               "by_department": by_department, "recent_leavers": recent_leavers}, "People summary.")


@router.get("/register")
async def people_register(
    user: dict = Depends(require_permission("workforce.people.read")),
    db: AsyncSession = Depends(get_db),
    q: str = Query("", max_length=160),
    status: Literal["current", "active", "on_leave", "suspended", "terminated", "all"] = "current",
    category_id: Optional[UUID] = None,
    department_id: Optional[UUID] = None,
):
    """The full register for the HR and Workforce tables. 'current' = everyone who has not left."""
    rows = (
        await db.execute(
            text("""
            SELECT e.id, e.employee_number, e.employee_name, e.job_title, e.employment_status, e.employment_type,
                   e.start_date, e.end_date, e.work_location, e.version,
                   c.id AS category_id, c.name AS category_name, p.name AS position_name, d.name AS department_name,
                   u.email AS login_email, u.is_active AS login_active,
                   m.employee_name AS line_manager_name, m.id AS line_manager_id,
                   (SELECT COUNT(*) FROM hr.project_allocations a WHERE a.organization_id = e.organization_id AND a.employee_id = e.id
                      AND a.is_deleted = false AND a.status IN ('planned','active') AND a.ends_on >= CURRENT_DATE) AS live_allocations,
                   EXISTS (SELECT 1 FROM finance.employee_pay_profiles pp WHERE pp.organization_id = e.organization_id
                      AND pp.employee_id = e.id AND pp.is_deleted = false) AS has_pay_profile,
                   (e.national_id IS NOT NULL AND e.date_of_birth IS NOT NULL AND e.personal_phone IS NOT NULL) AS personal_complete
            FROM hr.employees e
            LEFT JOIN hr.worker_categories c ON c.id = e.category_id AND c.organization_id = e.organization_id
            LEFT JOIN hr.positions p ON p.id = e.position_id AND p.organization_id = e.organization_id
            LEFT JOIN finance.departments d ON d.id = e.department_id AND d.organization_id = e.organization_id
            LEFT JOIN core.users u ON u.id = e.linked_user_id
            LEFT JOIN LATERAL (
                SELECT mm.id, mm.employee_name FROM hr.reporting_lines r JOIN hr.employees mm ON mm.id = r.manager_employee_id
                WHERE r.organization_id = e.organization_id AND r.employee_id = e.id AND r.is_deleted = false
                  AND r.relationship_type = 'line_manager' AND r.effective_from <= CURRENT_DATE
                  AND (r.effective_to IS NULL OR r.effective_to >= CURRENT_DATE)
                ORDER BY r.effective_from DESC LIMIT 1
            ) m ON true
            WHERE e.organization_id = :org AND e.is_deleted = false
              AND (e.employee_name ILIKE :q OR COALESCE(e.employee_number,'') ILIKE :q OR COALESCE(e.job_title,'') ILIKE :q
                   OR COALESCE(p.name,'') ILIKE :q)
              AND (CAST(:status AS text) = 'all'
                   OR (CAST(:status AS text) = 'current' AND e.employment_status <> 'terminated')
                   OR e.employment_status = CAST(:status AS text))
              AND (CAST(:category AS uuid) IS NULL OR e.category_id = CAST(:category AS uuid))
              AND (CAST(:department AS uuid) IS NULL OR e.department_id = CAST(:department AS uuid))
            ORDER BY e.employment_status = 'terminated', e.employee_number NULLS LAST, e.employee_name
            LIMIT 500
            """),
            {"org": user["org_id"], "q": f"%{q}%", "status": status, "category": category_id, "department": department_id},
        )
    ).mappings()
    return ok([dict(r) for r in rows], "People register.")


@router.get("/catalogue")
async def people_catalogue(
    user: dict = Depends(require_permission("workforce.people.read")),
    db: AsyncSession = Depends(get_db),
):
    """Disciplines with their roles, departments and possible line managers for the card's pickers."""
    org = user["org_id"]
    categories = [dict(r) for r in (await db.execute(text("""
        SELECT id, code, name, description, payroll_eligible, sort_order FROM hr.worker_categories
        WHERE organization_id=:org AND is_deleted=false ORDER BY sort_order, name"""), {"org": org})).mappings()]
    positions = [dict(r) for r in (await db.execute(text("""
        SELECT p.id, p.code, p.name, p.category_id, p.department_id, p.grade, p.sort_order,
               (SELECT COUNT(*) FROM hr.employees e WHERE e.organization_id=p.organization_id AND e.position_id=p.id
                  AND e.is_deleted=false AND e.employment_status<>'terminated') AS people
        FROM hr.positions p WHERE p.organization_id=:org AND p.is_deleted=false ORDER BY p.sort_order, p.name"""), {"org": org})).mappings()]
    departments = [dict(r) for r in (await db.execute(text("""
        SELECT id, code, name FROM finance.departments WHERE organization_id=:org AND is_deleted=false ORDER BY name"""), {"org": org})).mappings()]
    managers = [dict(r) for r in (await db.execute(text("""
        SELECT id, employee_name, job_title, employee_number FROM hr.employees
        WHERE organization_id=:org AND is_deleted=false AND employment_status<>'terminated' ORDER BY employee_name"""), {"org": org})).mappings()]
    projects = [dict(r) for r in (await db.execute(text("""
        SELECT id, name, project_code, status FROM projects.projects
        WHERE organization_id=:org AND is_deleted=false AND COALESCE(is_historical,false)=false
          AND COALESCE(status,'') NOT IN ('completed','cancelled','closed')
        ORDER BY name"""), {"org": org})).mappings()]
    return ok({"categories": categories, "positions": positions, "departments": departments,
               "managers": managers, "projects": projects}, "People catalogue.")


@router.get("/me")
async def my_card(user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    employee_id = (
        await db.execute(
            text("SELECT id FROM hr.employees WHERE organization_id=:org AND linked_user_id=:uid AND is_deleted=false"),
            {"org": user["org_id"], "uid": user["user_id"]},
        )
    ).scalar()
    if not employee_id:
        raise HTTPException(404, "Your login is not linked to a person record yet. Ask HR to link it.")
    return ok(await _dossier(db, user, employee_id, is_self=True), "Your profile.")


@router.get("/{employee_id}")
async def person_card(
    employee_id: UUID,
    user: dict = Depends(require_permission("workforce.people.read")),
    db: AsyncSession = Depends(get_db),
):
    return ok(await _dossier(db, user, employee_id), "Person card.")


# --------------------------------------------------------------------------- writes

async def _save_personal(db, org_id, employee_id, payload: PersonalUpdate) -> list[str]:
    values = payload.model_dump(exclude_unset=True)
    if not values:
        raise HTTPException(422, "Nothing to save")
    params: dict = {"org": org_id, "id": employee_id}
    sets = []
    for key, value in values.items():
        if key == "emergency_contact":
            sets.append("emergency_contact = CAST(:emergency_contact AS jsonb)")
            params["emergency_contact"] = json.dumps(value or {})
        else:
            sets.append(f"{key} = :{key}")
            params[key] = value if value != "" else None
    await db.execute(
        text(f"UPDATE hr.employees SET {', '.join(sets)}, version = version + 1, updated_at = now() WHERE organization_id=:org AND id=:id"),
        params,
    )
    return list(values)


@router.patch("/me/personal")
async def update_my_personal(
    payload: PersonalUpdate,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    employee_id = (
        await db.execute(
            text("SELECT id FROM hr.employees WHERE organization_id=:org AND linked_user_id=:uid AND is_deleted=false"),
            {"org": user["org_id"], "uid": user["user_id"]},
        )
    ).scalar()
    if not employee_id:
        raise HTTPException(404, "Your login is not linked to a person record yet. Ask HR to link it.")
    await _save_personal(db, user["org_id"], employee_id, payload)
    await db.execute(
        text("UPDATE hr.employees SET self_profile_updated_at = now() WHERE organization_id=:org AND id=:id"),
        {"org": user["org_id"], "id": employee_id},
    )
    await db.commit()
    return ok(await _dossier(db, user, employee_id, is_self=True), "Your details were saved.")


@router.patch("/{employee_id}/employment")
async def update_employment(
    employee_id: UUID,
    payload: EmploymentUpdate,
    user: dict = Depends(require_permission("workforce.people.update")),
    db: AsyncSession = Depends(get_db),
):
    org = user["org_id"]
    await _employee(db, org, employee_id, include_left=False)
    values = payload.model_dump(exclude_unset=True)
    manager_given = "line_manager_id" in values
    manager_id = values.pop("line_manager_id", None)
    for field, table in (("category_id", "hr.worker_categories"), ("position_id", "hr.positions"), ("department_id", "finance.departments")):
        if values.get(field) and not await _ref_exists(db, org, table, values[field]):
            raise HTTPException(422, f"Unknown {field.replace('_id', '')}")
    if values.get("position_id"):
        role = (await db.execute(text("SELECT name, category_id, department_id FROM hr.positions WHERE id=:id"),
                                 {"id": values["position_id"]})).mappings().first()
        values.setdefault("category_id", role["category_id"])
        if not values.get("department_id"):
            values["department_id"] = role["department_id"]
        if not values.get("job_title"):
            values["job_title"] = role["name"]
    if values.get("employee_name") is None:
        values.pop("employee_name", None)
    if values:
        sets = ", ".join(f"{k} = :{k}" for k in values)
        await db.execute(
            text(f"UPDATE hr.employees SET {sets}, version = version + 1, updated_at = now() WHERE organization_id=:org AND id=:id"),
            {**values, "org": org, "id": employee_id},
        )
    if manager_given:
        await _set_line_manager(db, user, employee_id, manager_id)
        if not values:
            await _bump(db, org, employee_id)
    await db.commit()
    return ok(await _dossier(db, user, employee_id), "Employment details saved.")


@router.patch("/{employee_id}/personal")
async def update_personal(
    employee_id: UUID,
    payload: PersonalUpdate,
    user: dict = Depends(require_permission("hr.people.personal.manage")),
    db: AsyncSession = Depends(get_db),
):
    await _employee(db, user["org_id"], employee_id)
    await _save_personal(db, user["org_id"], employee_id, payload)
    await db.commit()
    return ok(await _dossier(db, user, employee_id), "Personal details saved.")


@router.put("/{employee_id}/pay")
async def update_pay(
    employee_id: UUID,
    payload: PayUpdate,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not await _can_any(db, user, "hr.payroll.manage", "finance.payroll.manage"):
        raise HTTPException(403, "Missing required permission: hr.payroll.manage")
    org = user["org_id"]
    await _employee(db, org, employee_id, include_left=False)
    values = payload.model_dump()
    values["currency"] = values["currency"].upper()
    await db.execute(
        text("""
        INSERT INTO finance.employee_pay_profiles
          (organization_id, employee_id, pay_type, base_rate, overtime_rate, currency, bank_name,
           bank_account_number, tax_number, nssa_number, is_active, created_by)
        VALUES (:org, :id, :pay_type, :base_rate, :overtime_rate, :currency, :bank_name,
           :bank_account_number, :tax_number, :nssa_number, true, :actor)
        ON CONFLICT (organization_id, employee_id) DO UPDATE SET
          pay_type = EXCLUDED.pay_type, base_rate = EXCLUDED.base_rate, overtime_rate = EXCLUDED.overtime_rate,
          currency = EXCLUDED.currency, bank_name = EXCLUDED.bank_name,
          bank_account_number = EXCLUDED.bank_account_number, tax_number = EXCLUDED.tax_number,
          nssa_number = EXCLUDED.nssa_number, is_active = true, is_deleted = false, updated_at = now()
        """),
        {**values, "org": org, "id": employee_id, "actor": user["user_id"]},
    )
    await _bump(db, org, employee_id)
    await db.commit()
    return ok(await _dossier(db, user, employee_id), "Pay details saved.")


@router.post("/{employee_id}/psychometrics", status_code=201)
async def add_psychometric(
    employee_id: UUID,
    payload: PsychometricCreate,
    user: dict = Depends(require_permission("hr.people.personal.manage")),
    db: AsyncSession = Depends(get_db),
):
    org = user["org_id"]
    await _employee(db, org, employee_id)
    values = payload.model_dump()
    if values["recruitment_assessment_id"] and not await _ref_exists(db, org, "hr.recruitment_assessments", values["recruitment_assessment_id"]):
        raise HTTPException(422, "Unknown recruitment assessment")
    values["dimension_scores"] = json.dumps(values["dimension_scores"])
    await db.execute(
        text("""
        INSERT INTO hr.employee_psychometrics (organization_id, employee_id, test_name, provider, assessed_on, overall_score,
          max_score, dimension_scores, interpretation, recruitment_assessment_id, created_by)
        VALUES (:org, :id, :test_name, :provider, :assessed_on, :overall_score, :max_score,
          CAST(:dimension_scores AS jsonb), :interpretation, :recruitment_assessment_id, :actor)
        """),
        {**values, "org": org, "id": employee_id, "actor": user["user_id"]},
    )
    await db.commit()
    return ok(await _dossier(db, user, employee_id), "Assessment result recorded.")


@router.delete("/{employee_id}/psychometrics/{result_id}")
async def remove_psychometric(
    employee_id: UUID,
    result_id: UUID,
    user: dict = Depends(require_permission("hr.people.personal.manage")),
    db: AsyncSession = Depends(get_db),
):
    done = await db.execute(
        text("""UPDATE hr.employee_psychometrics SET is_deleted = true, updated_at = now()
        WHERE organization_id=:org AND employee_id=:emp AND id=:id AND is_deleted=false"""),
        {"org": user["org_id"], "emp": employee_id, "id": result_id},
    )
    if not done.rowcount:
        raise HTTPException(404, "Result not found")
    await db.commit()
    return ok(await _dossier(db, user, employee_id), "Assessment result removed.")


@router.post("/{employee_id}/allocations/{allocation_id}/end")
async def end_allocation(
    employee_id: UUID,
    allocation_id: UUID,
    payload: EndAllocation,
    user: dict = Depends(require_permission("workforce.update")),
    db: AsyncSession = Depends(get_db),
):
    row = (
        await db.execute(
            text("""SELECT starts_on FROM hr.project_allocations WHERE organization_id=:org AND employee_id=:emp
            AND id=:id AND is_deleted=false AND status IN ('planned','active')"""),
            {"org": user["org_id"], "emp": employee_id, "id": allocation_id},
        )
    ).first()
    if not row:
        raise HTTPException(404, "No live allocation found")
    if payload.ends_on < row.starts_on:
        await db.execute(
            text("UPDATE hr.project_allocations SET status='cancelled', updated_at=now() WHERE id=:id"),
            {"id": allocation_id},
        )
    else:
        await db.execute(
            text("""UPDATE hr.project_allocations SET ends_on=:ends_on,
            status = CASE WHEN :ends_on < CURRENT_DATE THEN 'completed' ELSE status END, updated_at=now() WHERE id=:id"""),
            {"id": allocation_id, "ends_on": payload.ends_on},
        )
    await db.commit()
    return ok(await _dossier(db, user, employee_id), "Allocation ended.")


@router.post("/{employee_id}/leave-organisation")
async def leave_organisation(
    employee_id: UUID,
    payload: LeaveOrganisation,
    user: dict = Depends(require_permission("hr.people.offboard")),
    db: AsyncSession = Depends(get_db),
):
    """Someone has left SNC. They drop off every active list, keep their history
    and worker number, live allocations end on the leaving date, they stop
    managing anyone, and (by default) their login is disabled."""
    org = user["org_id"]
    person = await _employee(db, org, employee_id, include_left=False)
    if person.get("linked_user_id") and str(person["linked_user_id"]) == str(user["user_id"]):
        raise HTTPException(400, "You cannot record yourself as having left")
    await db.execute(
        text("""UPDATE hr.employees SET employment_status='terminated', end_date=:left_on, left_reason=:reason,
        left_recorded_at=now(), left_recorded_by=:actor, version=version+1, updated_at=now()
        WHERE organization_id=:org AND id=:id"""),
        {"org": org, "id": employee_id, "left_on": payload.left_on, "reason": payload.reason, "actor": user["user_id"]},
    )
    await db.execute(
        text("""UPDATE hr.project_allocations
        SET status = CASE WHEN starts_on > :left_on THEN 'cancelled' ELSE 'completed' END,
            ends_on = CASE WHEN starts_on > :left_on THEN ends_on ELSE LEAST(ends_on, :left_on) END, updated_at = now()
        WHERE organization_id=:org AND employee_id=:id AND is_deleted=false AND status IN ('planned','active')"""),
        {"org": org, "id": employee_id, "left_on": payload.left_on},
    )
    # They no longer report to anyone, and nobody reports to them.
    await db.execute(
        text("""UPDATE hr.reporting_lines
        SET effective_to = GREATEST(effective_from, LEAST(COALESCE(effective_to, :left_on), :left_on)), updated_at = now()
        WHERE organization_id=:org AND is_deleted=false AND (employee_id=:id OR manager_employee_id=:id)
          AND (effective_to IS NULL OR effective_to > :left_on)"""),
        {"org": org, "id": employee_id, "left_on": payload.left_on},
    )
    login_disabled = False
    if payload.disable_login and person.get("linked_user_id"):
        is_superadmin = (
            await db.execute(
                text("""SELECT EXISTS (SELECT 1 FROM core.user_roles ur JOIN core.roles r ON r.id = ur.role_id
                WHERE ur.user_id = :uid AND r.name = 'SUPERADMIN')"""),
                {"uid": person["linked_user_id"]},
            )
        ).scalar()
        if not is_superadmin:
            await db.execute(
                text("UPDATE core.users SET is_active=false, updated_at=now() WHERE id=:uid AND organization_id=:org"),
                {"uid": person["linked_user_id"], "org": org},
            )
            login_disabled = True
    await db.execute(
        text("""INSERT INTO core.audit_log (organization_id, created_by, action, table_name, record_id, new_data)
        VALUES (:org, :actor, 'PERSON_LEFT', 'hr.employees', :id, CAST(:details AS jsonb))"""),
        {"org": org, "actor": user["user_id"], "id": employee_id,
         "details": json.dumps({"left_on": payload.left_on.isoformat(), "reason": payload.reason, "login_disabled": login_disabled})},
    )
    await db.commit()
    data = await _dossier(db, user, employee_id)
    return ok({**data, "login_disabled": login_disabled},
              "Recorded as left" + (" and login disabled." if login_disabled else "."))


@router.post("/{employee_id}/reinstate")
async def reinstate(
    employee_id: UUID,
    payload: Reinstate,
    user: dict = Depends(require_permission("hr.people.offboard")),
    db: AsyncSession = Depends(get_db),
):
    """Undo a leaving record (rehire or a mistake). The login is NOT re-enabled
    here; that stays an explicit Settings → Users decision."""
    org = user["org_id"]
    person = await _employee(db, org, employee_id)
    if person["employment_status"] != "terminated":
        raise HTTPException(409, "This person has not left")
    number = person["employee_number"] or (
        await db.execute(text("SELECT hr.next_worker_number(CAST(:org AS uuid))"), {"org": org})
    ).scalar_one()
    await db.execute(
        text("""UPDATE hr.employees SET employment_status='active', end_date=NULL, left_reason=NULL,
        left_recorded_at=NULL, left_recorded_by=NULL, employee_number=:number, version=version+1, updated_at=now()
        WHERE organization_id=:org AND id=:id"""),
        {"org": org, "id": employee_id, "number": number},
    )
    await db.execute(
        text("""INSERT INTO core.audit_log (organization_id, created_by, action, table_name, record_id, new_data)
        VALUES (:org, :actor, 'PERSON_REINSTATED', 'hr.employees', :id, CAST(:details AS jsonb))"""),
        {"org": org, "actor": user["user_id"], "id": employee_id, "details": json.dumps({"reason": payload.reason})},
    )
    await db.commit()
    return ok(await _dossier(db, user, employee_id), "Reinstated.")
