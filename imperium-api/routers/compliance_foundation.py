"""Authenticated, tenant-fenced Compliance foundation API."""

from typing import Annotated, Literal
from uuid import UUID
from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.services import compliance_foundation as service
from app.shared.workforce_transactions import (
    bind_workforce_context,
    begin_command,
    complete_command,
)
from core.database import AsyncSessionLocal, get_db
from core.security import get_current_user, get_user_permission_keys
from schemas.compliance import (
    CatalogueCreate,
    SourceCreate,
    ObligationCreate,
    RevisionCreate,
    VersionReason,
    AssessmentCreate,
    AssignmentCreate,
    AssignmentRevision,
    Decision,
    Payload,
)

router = APIRouter()


async def context(
    user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    permissions = await get_user_permission_keys(db, user)
    if service.PREFIX + "read" not in permissions:
        raise HTTPException(403, "Compliance foundation access is not granted")
    return {**user, "permissions": permissions}


async def database(user: dict = Depends(context)):
    async with AsyncSessionLocal() as db:
        try:
            async with db.begin():
                await bind_workforce_context(db, user)
                await db.execute(
                    text("SELECT set_config('app.compliance_all',:all_scope,true)"),
                    {
                        "all_scope": str(
                            service.PREFIX + "scope.all" in user["permissions"]
                        ).lower()
                    },
                )
                yield db
        except IntegrityError as exc:
            raise HTTPException(
                409, "Compliance change conflicts with retained records or valid scope"
            ) from exc


DB = Annotated[AsyncSession, Depends(database, scope="function")]
User = Annotated[dict, Depends(context)]
Key = Annotated[UUID, Header(alias="Idempotency-Key")]


def response(data, **meta):
    return {
        "success": True,
        "data": data,
        "message": "Compliance foundation",
        "meta": meta,
    }


async def execute(db, user, key, action, payload, operation):
    receipt, replay = await begin_command(
        db, user, "compliance." + action, key, payload
    )
    if replay is not None:
        return replay
    return await complete_command(db, user, receipt, response(await operation()))


@router.get("/context")
async def capabilities(user: User):
    permissions = user["permissions"]
    conflicts = []
    if (
        service.PREFIX + "manage" in permissions
        and service.PREFIX + "approve" in permissions
    ):
        conflicts.append(
            "Author and approver permissions overlap. You cannot approve your own records."
        )
    if (
        service.PREFIX + "legal_review" in permissions
        and service.PREFIX + "approve" in permissions
    ):
        conflicts.append(
            "Legal and final approval must be performed by different people."
        )
    return response(
        {
            "organization_id": str(user["org_id"]),
            "user_id": str(user["user_id"]),
            "permissions": sorted(
                p for p in permissions if p.startswith(service.PREFIX)
            ),
            "conflicts": conflicts,
        }
    )


@router.get("/lookups/{kind}")
async def lookups(
    kind: Literal["users", "project", "worker", "supplier", "subcontractor", "asset"],
    db: DB,
    user: User,
    q: str = Query("", max_length=160),
):
    table = "core.users" if kind == "users" else service.SUBJECTS[kind]
    # Read only identities here; the owning module supplies richer detail under its own permissions.
    rows = (
        (
            await db.execute(
                text(
                    f"SELECT id, COALESCE(to_jsonb(t)->>'full_name',to_jsonb(t)->>'name',to_jsonb(t)->>'employee_name',to_jsonb(t)->>'supplier_name',to_jsonb(t)->>'asset_code',CAST(id AS text)) AS name FROM {table} t WHERE organization_id=:org AND is_deleted=false AND (CAST(id AS text) ILIKE :q OR COALESCE(to_jsonb(t)->>'full_name',to_jsonb(t)->>'name',to_jsonb(t)->>'employee_name',to_jsonb(t)->>'supplier_name',to_jsonb(t)->>'asset_code','') ILIKE :q) ORDER BY id LIMIT 100"
                ),
                {"org": user["org_id"], "q": f"%{q}%"},
            )
        )
        .mappings()
        .all()
    )
    return response([dict(r) for r in rows])


@router.get("/{resource}")
async def listing(
    resource: str,
    db: DB,
    user: User,
    q: str = Query("", max_length=160),
    status: str | None = Query(None, max_length=40),
    after: UUID | None = None,
    limit: int = Query(50, ge=1, le=200),
):
    table = resource.replace("-", "_")
    if table not in service.TABLES:
        raise HTTPException(404, "Register not found")
    if table == "scope_grants":
        service.permit(user, "scope.manage")
    rows = (
        (
            await db.execute(
                text(f"""SELECT * FROM compliance.{table} t WHERE organization_id=:org AND is_deleted=false
        AND (CAST(:after AS uuid) IS NULL OR id>CAST(:after AS uuid))
        AND (CAST(:status AS text) IS NULL OR to_jsonb(t)->>'status'=:status)
        AND (COALESCE(to_jsonb(t)->>'title',to_jsonb(t)->>'name',to_jsonb(t)->>'code',CAST(id AS text)) ILIKE :q)
        ORDER BY id LIMIT :limit"""),
                {
                    "org": user["org_id"],
                    "after": after,
                    "status": status,
                    "q": f"%{q}%",
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


@router.get("/{resource}/{record_id}/history")
async def history(resource: str, record_id: UUID, db: DB, user: User):
    service.permit(user, "audit.read")
    table = resource.replace("-", "_")
    if table == "scope_grants":
        service.permit(user, "scope.manage")
    current = await service.row(db, user, table, record_id)
    rows = (
        (
            await db.execute(
                text("""SELECT id,action,new_data,created_at,created_by FROM core.audit_log
        WHERE organization_id=:org AND ((table_name=:table AND record_id=:id) OR (table_name='core.approval_instances' AND record_id=CAST(:approval AS uuid))) ORDER BY created_at,id"""),
                {
                    "org": user["org_id"],
                    "table": "compliance." + table,
                    "id": record_id,
                    "approval": current.get("approval_id"),
                },
            )
        )
        .mappings()
        .all()
    )
    return response([dict(r) for r in rows])


@router.get("/exports/{resource}")
async def export_register(
    resource: str,
    db: DB,
    user: User,
    q: str = Query("", max_length=160),
    status: str | None = Query(None, max_length=40),
):
    service.permit(user, "export")
    table = resource.replace("-", "_")
    if table not in service.TABLES or table == "scope_grants":
        raise HTTPException(403, "This register is not exportable")
    records = (
        (
            await db.execute(
                text(
                    f"SELECT * FROM compliance.{table} t WHERE organization_id=:org AND is_deleted=false AND (CAST(:status AS text) IS NULL OR to_jsonb(t)->>'status'=:status) AND COALESCE(to_jsonb(t)->>'title',to_jsonb(t)->>'name',to_jsonb(t)->>'code',CAST(id AS text)) ILIKE :q ORDER BY id LIMIT 5001"
                ),
                {"org": user["org_id"], "q": f"%{q}%", "status": status},
            )
        )
        .mappings()
        .all()
    )
    if len(records) > 5000:
        raise HTTPException(422, "Narrow the filter to at most 5000 records")
    return response([dict(r) for r in records])


@router.get("/{resource}/{record_id}")
async def detail(resource: str, record_id: UUID, db: DB, user: User):
    table = resource.replace("-", "_")
    if table == "scope_grants":
        service.permit(user, "scope.manage")
    current = await service.row(db, user, table, record_id)
    if current.get("approval_id"):
        stages = (await db.execute(text("SELECT step_number,permission_key,status,decided_by,decided_at,reason FROM core.approval_steps WHERE organization_id=:org AND approval_instance_id=:id ORDER BY step_number"), {"org": user["org_id"], "id": current["approval_id"]})).mappings().all()
        current["approval_stages"] = [dict(stage) for stage in stages]
    return response(current)


@router.post("/catalogues/{kind}", status_code=201)
async def catalogue(
    kind: Literal["domains", "authorities"],
    payload: CatalogueCreate,
    db: DB,
    user: User,
    key: Key,
):
    return await execute(
        db,
        user,
        key,
        kind + ".create",
        payload.model_dump(),
        lambda: service.create_catalogue(db, user, kind, payload),
    )


@router.post("/sources", status_code=201)
async def source(payload: SourceCreate, db: DB, user: User, key: Key):
    return await execute(
        db,
        user,
        key,
        "sources.create",
        payload.model_dump(),
        lambda: service.create_source(db, user, payload),
    )


@router.post("/sources/{record_id}/verify")
async def verify(record_id: UUID, payload: VersionReason, db: DB, user: User, key: Key):
    return await execute(
        db,
        user,
        key,
        "sources.verify",
        {"id": record_id, **payload.model_dump()},
        lambda: service.verify_source(db, user, record_id, payload),
    )


@router.post("/obligations", status_code=201)
async def obligation(payload: ObligationCreate, db: DB, user: User, key: Key):
    return await execute(
        db,
        user,
        key,
        "obligations.create",
        payload.model_dump(),
        lambda: service.create_obligation(db, user, payload),
    )


@router.post("/obligation-versions/{record_id}/revise", status_code=201)
async def revise(
    record_id: UUID, payload: RevisionCreate, db: DB, user: User, key: Key
):
    return await execute(
        db,
        user,
        key,
        "obligations.revise",
        {"id": record_id, **payload.model_dump()},
        lambda: service.create_obligation(db, user, payload, record_id),
    )


@router.post("/obligation-versions/{record_id}/{action}")
async def transition(
    record_id: UUID,
    action: Literal["submit", "activate", "archive"],
    payload: VersionReason,
    db: DB,
    user: User,
    key: Key,
):
    return await execute(
        db,
        user,
        key,
        "obligations." + action,
        {"id": record_id, **payload.model_dump()},
        lambda: service.transition(db, user, record_id, action, payload),
    )


@router.post("/assessments", status_code=201)
async def assess(payload: AssessmentCreate, db: DB, user: User, key: Key):
    return await execute(
        db,
        user,
        key,
        "assessments.create",
        payload.model_dump(),
        lambda: service.assess(db, user, payload),
    )


@router.post("/decisions/{resource}/{record_id}")
async def decide(
    resource: Literal["obligation-versions", "applicability-assessments"],
    record_id: UUID,
    payload: Decision,
    db: DB,
    user: User,
    key: Key,
):
    return await execute(
        db,
        user,
        key,
        "decisions." + resource,
        {"id": record_id, **payload.model_dump()},
        lambda: service.decide(
            db, user, resource.replace("-", "_"), record_id, payload
        ),
    )


@router.post("/assignments", status_code=201)
async def assign(payload: AssignmentCreate, db: DB, user: User, key: Key):
    return await execute(
        db,
        user,
        key,
        "assignments.create",
        payload.model_dump(),
        lambda: service.assign(db, user, payload),
    )


class ScopeGrant(Payload):
    user_id: UUID
    project_id: UUID


@router.post("/assignments/{record_id}/reassign")
async def reassign(record_id: UUID, payload: AssignmentRevision, db: DB, user: User, key: Key):
    return await execute(db, user, key, "assignments.reassign", {"id": record_id, **payload.model_dump()},
                         lambda: service.reassign(db, user, record_id, payload))


@router.post("/scope-grants", status_code=201)
async def scope_grant(payload: ScopeGrant, db: DB, user: User, key: Key):
    service.permit(user, "scope.manage")

    async def operation():
        await service.master(db, user, "core.users", payload.user_id)
        await service.master(db, user, "projects.projects", payload.project_id)
        return await service.record(
            db,
            user,
            "scope_grants",
            await service.insert(db, user, "scope_grants", payload.model_dump()),
            "created",
        )

    return await execute(db, user, key, "scope.grant", payload.model_dump(), operation)
