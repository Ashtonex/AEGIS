"""Phase 2 endpoints, independently authorised and executed under tenant RLS."""

from datetime import date
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services import workforce_foundation as service
from app.shared.sql import insert_returning_id_sql
from app.shared.workforce_transactions import (
    workforce_db,
    begin_command,
    complete_command,
    audit_action,
)
from core.database import get_db
from core.security import get_current_user, get_user_permission_keys, require_permission
from schemas.workforce_foundation import (
    PersonCreate,
    PersonUpdate,
    CatalogueCreate,
    ReportingLine,
    EngagementCreate,
    EngagementDecision,
    VersionReason,
    AvailabilityCreate,
)

router = APIRouter()
DB = Annotated[AsyncSession, Depends(workforce_db, scope="function")]
CommandKey = Annotated[UUID, Header(alias="Idempotency-Key")]


def response(data, message="Workforce records loaded", **meta):
    return {"success": True, "data": data, "message": message, "meta": meta}


async def execute(db, user, key, action, payload, operation):
    receipt, replay = await begin_command(db, user, action, key, payload)
    if replay is not None:
        return replay
    result = response(await operation(), "Workforce command completed")
    return await complete_command(db, user, receipt, result)


@router.get("/people")
async def people(
    db: DB,
    user: dict = Depends(require_permission("workforce.people.read")),
    q: str = Query("", max_length=160),
    status: Literal["active", "on_leave", "suspended", "terminated"] | None = None,
    after: UUID | None = None,
    limit: int = Query(50, ge=1, le=200),
):
    rows, cursor = await service.list_people(db, user, q, status, after, limit)
    return response(rows, next_cursor=cursor)


@router.get("/people/{employee_id}")
async def person_detail(
    employee_id: UUID,
    db: DB,
    user: dict = Depends(require_permission("workforce.people.read")),
):
    worker = await service.person(db, user, employee_id)
    worker.pop("linked_user_id", None)
    return response(worker)


@router.get("/me")
async def own_person(db: DB, user: dict = Depends(get_current_user)):
    row_id = (
        await db.execute(
            text(
                "SELECT id FROM hr.employees WHERE organization_id=:org AND linked_user_id=:actor AND is_deleted=false"
            ),
            {"org": user["org_id"], "actor": user["user_id"]},
        )
    ).scalar()
    if not row_id:
        raise HTTPException(404, "No worker is linked to your identity")
    worker = await service.person(db, user, row_id)
    worker.pop("linked_user_id", None)
    return response(worker)


@router.post("/people", status_code=201)
async def create_person(
    payload: PersonCreate,
    db: DB,
    key: CommandKey,
    user: dict = Depends(require_permission("workforce.people.create")),
):
    return await execute(
        db,
        user,
        key,
        "people.create",
        payload.model_dump(),
        lambda: service.create_person(db, user, payload),
    )


@router.patch("/people/{employee_id}")
async def update_person(
    employee_id: UUID,
    payload: PersonUpdate,
    db: DB,
    key: CommandKey,
    user: dict = Depends(require_permission("workforce.people.update")),
):
    return await execute(
        db,
        user,
        key,
        "people.update",
        {"id": employee_id, **payload.model_dump(exclude_unset=True)},
        lambda: service.update_person(db, user, employee_id, payload),
    )


@router.post("/people/{employee_id}/archive")
async def archive_person(
    employee_id: UUID,
    payload: VersionReason,
    db: DB,
    key: CommandKey,
    user: dict = Depends(require_permission("workforce.people.archive")),
):
    async def operation():
        current = await service.person(db, user, employee_id, lock=True)
        if current["version"] != payload.expected_version:
            raise HTTPException(409, "Worker version changed")
        # Do not orphan active deployment or employment authority.
        active = (
            await db.execute(
                text(
                    "SELECT 1 FROM hr.worker_engagements WHERE organization_id=:org AND employee_id=:id AND is_deleted=false AND status='verified' AND (ends_on IS NULL OR ends_on>=CURRENT_DATE) UNION ALL SELECT 1 FROM hr.project_allocations WHERE organization_id=:org AND employee_id=:id AND is_deleted=false AND status IN ('planned','active') AND ends_on>=CURRENT_DATE LIMIT 1"
                ),
                {"org": user["org_id"], "id": employee_id},
            )
        ).scalar()
        if active:
            raise HTTPException(
                409, "An effective engagement or allocation prevents archival"
            )
        await db.execute(
            text(
                "UPDATE hr.employees SET is_deleted=true,archived_at=now(),archived_reason=:reason,version=version+1 WHERE organization_id=:org AND id=:id"
            ),
            {"org": user["org_id"], "id": employee_id, "reason": payload.reason},
        )
        await audit_action(
            db,
            user,
            "hr.employees",
            employee_id,
            "ARCHIVE",
            {"reason": payload.reason, "version": current["version"] + 1},
        )
        return {"id": str(employee_id), "version": current["version"] + 1}

    return await execute(
        db,
        user,
        key,
        "people.archive",
        {"id": employee_id, **payload.model_dump()},
        operation,
    )


@router.get("/catalogues")
async def catalogues(
    db: DB, user: dict = Depends(require_permission("workforce.organisation.read"))
):
    data = {}
    for name, table in {
        **service.CATALOGUES,
        "departments": "finance.departments",
    }.items():
        data[name] = [
            dict(r)
            for r in (
                await db.execute(
                    text(
                        f"SELECT id,code,name FROM {table} WHERE organization_id=:org AND is_deleted=false ORDER BY name"
                    ),
                    {"org": user["org_id"]},
                )
            ).mappings()
        ]
    return response(data)


@router.post("/catalogues/{kind}", status_code=201)
async def create_catalogue(
    kind: Literal["categories", "positions"],
    payload: CatalogueCreate,
    db: DB,
    key: CommandKey,
    user: dict = Depends(require_permission("workforce.organisation.manage")),
):
    return await execute(
        db,
        user,
        key,
        "catalogue.create",
        {"kind": kind, **payload.model_dump()},
        lambda: service.create_catalogue(db, user, kind, payload),
    )


@router.get("/reporting-lines")
async def reporting_lines(
    db: DB,
    user: dict = Depends(require_permission("workforce.organisation.read")),
    on: date = Query(default_factory=date.today),
    after: UUID | None = None,
    limit: int = Query(50, ge=1, le=200),
):
    rows = (
        (
            await db.execute(
                text("""
        SELECT r.id,r.employee_id,r.manager_employee_id,r.relationship_type,r.effective_from,r.effective_to,
          e.employee_name,m.employee_name AS manager_name FROM hr.reporting_lines r
        JOIN hr.employees e ON e.id=r.employee_id AND e.organization_id=r.organization_id
        JOIN hr.employees m ON m.id=r.manager_employee_id AND m.organization_id=r.organization_id
        WHERE r.organization_id=:org AND r.is_deleted=false AND r.effective_from<=:on
          AND (r.effective_to IS NULL OR r.effective_to>=:on)
          AND (CAST(:after AS uuid) IS NULL OR r.id>CAST(:after AS uuid)) ORDER BY r.id LIMIT :limit
    """),
                {"org": user["org_id"], "on": on, "after": after, "limit": limit + 1},
            )
        )
        .mappings()
        .all()
    )
    return response(
        [dict(r) for r in rows[:limit]],
        next_cursor=str(rows[limit - 1]["id"]) if len(rows) > limit else None,
    )


@router.post("/reporting-lines", status_code=201)
async def create_reporting_line(
    payload: ReportingLine,
    db: DB,
    key: CommandKey,
    user: dict = Depends(require_permission("workforce.organisation.manage")),
):
    return await execute(
        db,
        user,
        key,
        "reporting.create",
        payload.model_dump(),
        lambda: service.create_reporting_line(db, user, payload),
    )


@router.get("/people/{employee_id}/availability")
async def worker_availability(
    employee_id: UUID,
    starts_on: date,
    ends_on: date,
    db: DB,
    user: dict = Depends(require_permission("workforce.availability.read")),
):
    return response(
        await service.availability(db, user, employee_id, starts_on, ends_on)
    )


@router.post("/availability", status_code=201)
async def create_availability(
    payload: AvailabilityCreate,
    db: DB,
    key: CommandKey,
    user: dict = Depends(require_permission("workforce.availability.manage")),
):
    async def operation():
        await service.person(db, user, payload.employee_id, lock=True)
        values = payload.model_dump()
        row_id = (
            await db.execute(
                insert_returning_id_sql("hr.employee_availability", values, values),
                {**values, "org_id": user["org_id"], "user_id": user["user_id"]},
            )
        ).scalar_one()
        await audit_action(
            db,
            user,
            "hr.employee_availability",
            row_id,
            "CREATE",
            {"worker_id": str(payload.employee_id), "status": payload.status},
        )
        return {"id": str(row_id)}

    return await execute(
        db, user, key, "availability.create", payload.model_dump(), operation
    )


@router.get("/people/{employee_id}/evidence")
async def evidence(
    employee_id: UUID,
    db: DB,
    user: dict = Depends(require_permission("workforce.people.read")),
):
    await service.person(db, user, employee_id)
    data = {}
    projections = {
        "certifications": (
            "hr.employee_certifications",
            "id,certification_name,verification_status,issued_on,expires_on",
        ),
        "skills": ("hr.employee_skills", "id,skill_name,proficiency,verified_at"),
        "engagements": ("hr.worker_engagements", "id,starts_on,ends_on,status,version"),
        "documents": (
            "hr.employee_documents",
            "id,document_type,title,status,expires_on",
        ),
        "training": (
            "hr.training_records",
            "id,training_name,status,completed_on,expires_on",
        ),
    }
    for name, (table, fields) in projections.items():
        data[name] = [
            dict(r)
            for r in (
                await db.execute(
                    text(
                        f"SELECT {fields} FROM {table} WHERE organization_id=:org AND employee_id=:id AND is_deleted=false ORDER BY created_at DESC LIMIT 200"
                    ),
                    {"org": user["org_id"], "id": employee_id},
                )
            ).mappings()
        ]
    return response(data, limit_per_source=200)


@router.get("/people/{employee_id}/history")
async def history(
    employee_id: UUID,
    db: DB,
    user: dict = Depends(require_permission("workforce.audit.read")),
    after: UUID | None = None,
    limit: int = Query(50, ge=1, le=200),
):
    # Includes archived workers; check tenant directly instead of the active-only lookup.
    found = (
        await db.execute(
            text("SELECT 1 FROM hr.employees WHERE organization_id=:org AND id=:id"),
            {"org": user["org_id"], "id": employee_id},
        )
    ).scalar()
    if not found:
        raise HTTPException(404, "Worker not found")
    rows = (
        (
            await db.execute(
                text("""
        SELECT id,action,created_by,created_at,new_data->>'reason' AS reason,new_data->>'version' AS version
        FROM core.audit_log WHERE organization_id=:org AND table_name='hr.employees' AND record_id=:id
          AND (CAST(:after AS uuid) IS NULL OR id>CAST(:after AS uuid)) ORDER BY id LIMIT :limit
    """),
                {
                    "org": user["org_id"],
                    "id": employee_id,
                    "after": after,
                    "limit": limit + 1,
                },
            )
        )
        .mappings()
        .all()
    )
    return response(
        [dict(r) for r in rows[:limit]],
        next_cursor=str(rows[limit - 1]["id"]) if len(rows) > limit else None,
    )


@router.get("/engagements")
async def engagements(
    employee_id: UUID,
    db: DB,
    user: dict = Depends(require_permission("hr.engagement.read")),
    after: UUID | None = None,
    limit: int = Query(50, ge=1, le=200),
):
    await service.person(db, user, employee_id)
    rows = (
        (
            await db.execute(
                text("""SELECT id,employee_id,category_id,document_id,starts_on,ends_on,
        normal_minutes,jurisdiction,employer_name,status,version,created_by,verified_by,verified_at,decision_reason
        FROM hr.worker_engagements WHERE organization_id=:org AND employee_id=:employee AND is_deleted=false
          AND (CAST(:after AS uuid) IS NULL OR id>CAST(:after AS uuid)) ORDER BY id LIMIT :limit"""),
                {
                    "org": user["org_id"],
                    "employee": employee_id,
                    "after": after,
                    "limit": limit + 1,
                },
            )
        )
        .mappings()
        .all()
    )
    return response(
        [dict(row) for row in rows[:limit]],
        next_cursor=str(rows[limit - 1]["id"]) if len(rows) > limit else None,
    )


@router.get("/engagement-documents")
async def engagement_documents(
    db: DB,
    user: dict = Depends(require_permission("documents.read")),
    q: str = Query("", max_length=160),
):
    rows = (
        (
            await db.execute(
                text("""SELECT d.id,d.title FROM core.documents d
        JOIN core.file_attachments f ON f.id=d.file_attachment_id AND f.organization_id=d.organization_id
        WHERE d.organization_id=:org AND d.is_deleted=false AND f.is_deleted=false AND d.title ILIKE :q
        ORDER BY d.title,d.id LIMIT 30"""),
                {"org": user["org_id"], "q": f"%{q}%"},
            )
        )
        .mappings()
        .all()
    )
    return response([dict(row) for row in rows])


@router.post("/engagements", status_code=201)
async def create_engagement(
    payload: EngagementCreate,
    db: DB,
    key: CommandKey,
    user: dict = Depends(require_permission("hr.engagement.manage")),
):
    return await execute(
        db,
        user,
        key,
        "engagement.create",
        payload.model_dump(),
        lambda: service.create_engagement(db, user, payload),
    )


@router.post("/engagements/{engagement_id}/submit")
async def submit_engagement(
    engagement_id: UUID,
    payload: VersionReason,
    db: DB,
    key: CommandKey,
    user: dict = Depends(require_permission("hr.engagement.manage")),
):
    return await execute(
        db,
        user,
        key,
        "engagement.submit",
        {"id": engagement_id, **payload.model_dump()},
        lambda: service.engagement_command(db, user, engagement_id, payload),
    )


@router.post("/engagements/{engagement_id}/decision")
async def decide_engagement(
    engagement_id: UUID,
    payload: EngagementDecision,
    db: DB,
    key: CommandKey,
    user: dict = Depends(require_permission("hr.engagement.verify")),
    auth_db: AsyncSession = Depends(get_db),
):
    permissions = await get_user_permission_keys(auth_db, user)
    return await execute(
        db,
        user,
        key,
        "engagement.decision",
        {"id": engagement_id, **payload.model_dump()},
        lambda: service.engagement_command(
            db, user, engagement_id, payload, permissions
        ),
    )
