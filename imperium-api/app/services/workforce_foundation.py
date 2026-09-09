"""Workforce foundation: operational projections, authority and effective eligibility."""

from datetime import date

from fastapi import HTTPException
from sqlalchemy import text

from app.services.workflow_service import WorkflowService
from app.shared.events import emit_event
from app.shared.sql import insert_returning_id_sql, update_returning_id_sql
from app.shared.workforce_transactions import audit_action, canonical_json
import json

PERSON_FIELDS = "e.id,e.employee_number,e.employee_name,e.job_title,e.employment_status,e.work_location,e.category_id,e.position_id,e.department_id,e.version,e.created_at"
CATALOGUES = {"categories": "hr.worker_categories", "positions": "hr.positions"}


async def person(db, user, employee_id, *, lock=False):
    row = (
        (
            await db.execute(
                text(
                    f"SELECT {PERSON_FIELDS},e.linked_user_id FROM hr.employees e WHERE e.organization_id=:org AND e.id=:id AND e.is_deleted=false"
                    + (" FOR UPDATE" if lock else "")
                ),
                {"org": user["org_id"], "id": employee_id},
            )
        )
        .mappings()
        .first()
    )
    if not row:
        raise HTTPException(404, "Worker not found")
    return dict(row)


async def validate_refs(db, user, values):
    for field, table in {
        "category_id": "hr.worker_categories",
        "position_id": "hr.positions",
        "department_id": "finance.departments",
        "document_id": "core.documents",
    }.items():
        if values.get(field):
            found = (
                await db.execute(
                    text(
                        f"SELECT 1 FROM {table} WHERE organization_id=:org AND id=:id AND is_deleted=false"
                    ),
                    {"org": user["org_id"], "id": values[field]},
                )
            ).scalar()
            if not found:
                raise HTTPException(422, f"Invalid or inaccessible {field}")


async def list_people(db, user, query, status, after, limit):
    params = {
        "org": user["org_id"],
        "query": f"%{query}%",
        "status": status,
        "after": after,
        "limit": limit + 1,
    }
    rows = (
        (
            await db.execute(
                text(f"""
        SELECT {PERSON_FIELDS},c.name AS category_name,p.name AS position_name,d.name AS department_name
        FROM hr.employees e LEFT JOIN hr.worker_categories c ON c.id=e.category_id AND c.organization_id=e.organization_id
        LEFT JOIN hr.positions p ON p.id=e.position_id AND p.organization_id=e.organization_id
        LEFT JOIN finance.departments d ON d.id=e.department_id AND d.organization_id=e.organization_id
        WHERE e.organization_id=:org AND e.is_deleted=false
          AND (e.employee_name ILIKE :query OR e.employee_number ILIKE :query)
          AND (CAST(:status AS text) IS NULL OR e.employment_status=:status)
          AND (CAST(:after AS uuid) IS NULL OR e.id>CAST(:after AS uuid)) ORDER BY e.id LIMIT :limit
    """),
                params,
            )
        )
        .mappings()
        .all()
    )
    return [dict(r) for r in rows[:limit]], str(rows[limit - 1]["id"]) if len(
        rows
    ) > limit else None


async def create_person(db, user, payload):
    values = payload.model_dump()
    await validate_refs(db, user, values)
    row_id = (
        await db.execute(
            insert_returning_id_sql("hr.employees", values, values),
            {**values, "org_id": user["org_id"], "user_id": user["user_id"]},
        )
    ).scalar_one()
    await audit_action(
        db,
        user,
        "hr.employees",
        row_id,
        "CREATE",
        {"workforce_number": values["employee_number"], "version": 1},
    )
    await emit_event(
        db,
        user=user,
        event_type="worker.registered.v1",
        aggregate_type="worker",
        aggregate_id=row_id,
        event_data={"worker_id": str(row_id), "version": 1},
    )
    return {"id": str(row_id), "version": 1}


async def update_person(db, user, employee_id, payload):
    current = await person(db, user, employee_id, lock=True)
    if current["version"] != payload.expected_version:
        raise HTTPException(409, "Worker changed; reload before applying this revision")
    values = payload.model_dump(
        exclude_unset=True, exclude={"expected_version", "reason"}
    )
    if (
        not values
        or values.get("employee_name", "valid") is None
        or values.get("category_id", "valid") is None
    ):
        raise HTTPException(
            422, "Supply operational fields; name and category cannot be cleared"
        )
    await validate_refs(db, user, values)
    values["version"] = current["version"] + 1
    await db.execute(
        update_returning_id_sql("hr.employees", values, values),
        {**values, "item_id": employee_id, "org_id": user["org_id"]},
    )
    await audit_action(
        db,
        user,
        "hr.employees",
        employee_id,
        "UPDATE",
        {
            "reason": payload.reason,
            "fields": list(values),
            "from_version": current["version"],
            "version": values["version"],
        },
    )
    return {"id": str(employee_id), "version": values["version"]}


async def create_catalogue(db, user, kind, payload):
    table = CATALOGUES.get(kind)
    if not table:
        raise HTTPException(404, "Catalogue not found")
    include = (
        {"code", "name", "payroll_eligible"}
        if kind == "categories"
        else {"code", "name", "department_id", "trade", "grade"}
    )
    values = payload.model_dump(include=include)
    await validate_refs(db, user, values)
    row_id = (
        await db.execute(
            insert_returning_id_sql(table, values, values),
            {**values, "org_id": user["org_id"], "user_id": user["user_id"]},
        )
    ).scalar_one()
    await audit_action(
        db, user, table, row_id, "CREATE", {"code": payload.code, "version": 1}
    )
    return {"id": str(row_id), "version": 1}


async def create_reporting_line(db, user, payload):
    # One transaction-level graph lock per org prevents concurrent A->B / B->A.
    await db.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:key,0))"),
        {"key": f"reporting:{user['org_id']}"},
    )
    await person(db, user, payload.employee_id)
    await person(db, user, payload.manager_employee_id)
    params = {**payload.model_dump(), "org": user["org_id"]}
    cycle = (
        await db.execute(
            text("""
      WITH RECURSIVE chain(employee_id,manager_employee_id,path,lo,hi) AS (
       SELECT employee_id,manager_employee_id,ARRAY[employee_id],
         GREATEST(effective_from,:effective_from),LEAST(COALESCE(effective_to,'infinity'::date),COALESCE(:effective_to,'infinity'::date))
       FROM hr.reporting_lines WHERE organization_id=:org AND is_deleted=false
         AND employee_id=:manager_employee_id AND relationship_type=:relationship_type
       UNION ALL
       SELECT r.employee_id,r.manager_employee_id,c.path||r.employee_id,
         GREATEST(c.lo,r.effective_from),LEAST(c.hi,COALESCE(r.effective_to,'infinity'::date))
       FROM hr.reporting_lines r JOIN chain c ON r.employee_id=c.manager_employee_id
       WHERE r.organization_id=:org AND r.is_deleted=false AND r.relationship_type=:relationship_type
         AND NOT r.employee_id=ANY(c.path) AND c.lo<=c.hi
      ) SELECT 1 FROM chain WHERE manager_employee_id=:employee_id AND lo<=hi LIMIT 1
    """),
            params,
        )
    ).scalar()
    if cycle:
        raise HTTPException(409, "Reporting assignment would create a cycle")
    overlap = (
        await db.execute(
            text("""
       SELECT 1 FROM hr.reporting_lines WHERE organization_id=:org AND employee_id=:employee_id
       AND relationship_type=:relationship_type AND is_deleted=false
       AND daterange(effective_from,effective_to,'[]') && daterange(:effective_from,:effective_to,'[]') LIMIT 1
    """),
            params,
        )
    ).scalar()
    if overlap:
        raise HTTPException(409, "An authority assignment already covers this period")
    values = payload.model_dump()
    row_id = (
        await db.execute(
            insert_returning_id_sql("hr.reporting_lines", values, values),
            {**values, "org_id": user["org_id"], "user_id": user["user_id"]},
        )
    ).scalar_one()
    await audit_action(
        db,
        user,
        "hr.reporting_lines",
        row_id,
        "CREATE",
        {
            "employee_id": str(payload.employee_id),
            "manager_id": str(payload.manager_employee_id),
        },
    )
    return {"id": str(row_id)}


async def availability(db, user, employee_id, starts_on: date, ends_on: date):
    if ends_on < starts_on or (ends_on - starts_on).days > 366:
        raise HTTPException(422, "Choose a valid period up to 367 days")
    worker = await person(db, user, employee_id)
    params = {
        "org": user["org_id"],
        "id": employee_id,
        "start": starts_on,
        "end": ends_on,
    }
    restrictions = []
    if worker["employment_status"] != "active":
        restrictions.append(
            {"source": "employment", "reason": worker["employment_status"]}
        )
    engagement = (
        await db.execute(
            text(
                """SELECT id FROM hr.worker_engagements WHERE organization_id=:org AND employee_id=:id AND status='verified' AND is_deleted=false AND starts_on<=:start AND (ends_on IS NULL OR ends_on>=:end)"""
            ),
            params,
        )
    ).scalar()
    if not engagement:
        restrictions.append(
            {
                "source": "engagement",
                "reason": "No verified engagement covers the requested period",
            }
        )
    for table, start, end, condition, source in [
        (
            "hr.leave_requests",
            "start_date",
            "end_date",
            "status='approved'",
            "hr_leave",
        ),
        (
            "hr.employee_availability",
            "available_from",
            "available_to",
            "(status<>'available' OR capacity_percent<100)",
            "availability",
        ),
    ]:
        rows = (
            (
                await db.execute(
                    text(
                        f"SELECT id,status,{start} AS starts_on,{end} AS ends_on FROM {table} WHERE organization_id=:org AND employee_id=:id AND is_deleted=false AND {condition} AND {start}<=:end AND {end}>=:start"
                    ),
                    params,
                )
            )
            .mappings()
            .all()
        )
        restrictions.extend({"source": source, **dict(r)} for r in rows)
    medical = (
        (
            await db.execute(
                text(
                    """WITH latest AS (
                        SELECT DISTINCT ON (check_type) id,status,expires_on
                        FROM hr.employee_medicals
                        WHERE organization_id=:org AND employee_id=:id AND is_deleted=false
                          AND (completed_on IS NULL OR completed_on<=:start)
                        ORDER BY check_type,completed_on DESC NULLS LAST,created_at DESC,id DESC
                    ), within_period AS (
                        SELECT id,status,expires_on FROM hr.employee_medicals
                        WHERE organization_id=:org AND employee_id=:id AND is_deleted=false
                          AND completed_on>:start AND completed_on<=:end
                    ) SELECT id FROM (SELECT * FROM latest UNION ALL SELECT * FROM within_period) checks
                      WHERE status IN ('failed','expired','due')
                        OR (status<>'waived' AND expires_on IS NOT NULL AND expires_on<:end)"""
                ),
                params,
            )
        )
        .mappings()
        .all()
    )
    if medical:
        # Operational consumers see readiness only, never the clinical result.
        restrictions.append(
            {
                "source": "hse_readiness",
                "reason": "HSE clearance requires review for this period",
            }
        )
    allocations = (
        (
            await db.execute(
                text(
                    "SELECT id,starts_on,ends_on,allocation_percent FROM hr.project_allocations WHERE organization_id=:org AND employee_id=:id AND is_deleted=false AND status IN ('planned','active') AND starts_on<=:end AND ends_on>=:start"
                ),
                params,
            )
        )
        .mappings()
        .all()
    )
    return {
        "employee_id": str(employee_id),
        "from": str(starts_on),
        "to": str(ends_on),
        "available": not restrictions,
        "restrictions": restrictions,
        "existing_allocations": [dict(row) for row in allocations],
        "unallocated": not allocations,
        "qualification_match": "Not evaluated; deployment checks remain required",
    }


async def engagement_document_snapshot(db, user, document_id):
    await db.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:key,2))"),
        {"key": f"evidence:{user['org_id']}:{document_id}"},
    )
    record = (
        (
            await db.execute(
                text("""SELECT d.id,d.title,d.updated_at,d.file_attachment_id,
        f.storage_path,f.file_name,f.size_bytes,f.mime_type
        FROM core.documents d JOIN core.file_attachments f ON f.id=d.file_attachment_id AND f.organization_id=d.organization_id
        WHERE d.organization_id=:org AND d.id=:id AND d.is_deleted=false AND f.is_deleted=false"""),
                {"org": user["org_id"], "id": document_id},
            )
        )
        .mappings()
        .first()
    )
    if not record:
        raise HTTPException(
            422, "An accessible document with an uploaded evidence file is required"
        )
    storage_revision = (
        await db.execute(
            text("SELECT core.workforce_document_object(:path)"),
            {"path": record["storage_path"]},
        )
    ).scalar()
    if storage_revision is None:
        raise HTTPException(
            422, "Contract file ownership could not be verified for this organisation"
        )
    # Capture the source revision, not only a mutable document identifier. The
    # stored reference can be compared before review and subsequent retrieval.
    return json.loads(
        canonical_json({**dict(record), "storage_revision": storage_revision})
    )


async def create_engagement(db, user, payload):
    await person(db, user, payload.employee_id, lock=True)
    values = payload.model_dump()
    await validate_refs(db, user, values)
    snapshot = await engagement_document_snapshot(db, user, payload.document_id)
    values["document_snapshot"] = canonical_json(snapshot)
    row_id = (
        await db.execute(
            insert_returning_id_sql(
                "hr.worker_engagements",
                values,
                values,
                json_columns={"document_snapshot"},
            ),
            {**values, "org_id": user["org_id"], "user_id": user["user_id"]},
        )
    ).scalar_one()
    await audit_action(
        db,
        user,
        "hr.worker_engagements",
        row_id,
        "CREATE",
        {"worker_id": str(payload.employee_id), "version": 1},
    )
    return {"id": str(row_id), "version": 1}


async def engagement_command(db, user, engagement_id, payload, permissions=None):
    record = (
        (
            await db.execute(
                text(
                    "SELECT * FROM hr.worker_engagements WHERE id=:id AND organization_id=:org AND is_deleted=false FOR UPDATE"
                ),
                {"id": engagement_id, "org": user["org_id"]},
            )
        )
        .mappings()
        .first()
    )
    if not record:
        raise HTTPException(404, "Engagement not found")
    if record["version"] != payload.expected_version:
        raise HTTPException(409, "Engagement version changed")
    worker = await person(db, user, record["employee_id"], lock=True)
    if permissions is None or payload.decision == "approved":
        snapshot = await engagement_document_snapshot(db, user, record["document_id"])
        if snapshot != record["document_snapshot"]:
            raise HTTPException(
                409, "Contract evidence changed; prepare a new engagement revision"
            )
    flow = WorkflowService(db)
    if permissions is None:
        if record["status"] != "draft":
            raise HTTPException(409, "Only draft engagements can be submitted")
        if str(record["created_by"]) != str(user["user_id"]):
            raise HTTPException(403, "Only the engagement author may submit this draft")
        version = record["version"] + 1
        instance = await flow.initiate_approval(
            user=user,
            workflow_name="hr.engagement.verify",
            target_type="worker_engagement",
            target_id=engagement_id,
            target_version=version,
            steps=["hr.engagement.verify"],
            subject_user_id=worker["linked_user_id"],
        )
        state = "submitted"
    else:
        if record["status"] != "submitted":
            raise HTTPException(409, "Only submitted engagements can be decided")
        instance = (
            await db.execute(
                text(
                    "SELECT id FROM core.approval_instances WHERE organization_id=:org AND target_id=:id AND workflow_key='hr.engagement.verify' AND status='pending'"
                ),
                {"org": user["org_id"], "id": engagement_id},
            )
        ).scalar_one()
        if payload.decision == "approved":
            await validate_refs(db, user, dict(record))
            overlap = (
                await db.execute(
                    text(
                        """SELECT 1 FROM hr.worker_engagements WHERE organization_id=:org AND employee_id=:worker AND status='verified' AND is_deleted=false AND daterange(starts_on,ends_on,'[]') && daterange(:start,:end,'[]') LIMIT 1"""
                    ),
                    {
                        "org": user["org_id"],
                        "worker": record["employee_id"],
                        "start": record["starts_on"],
                        "end": record["ends_on"],
                    },
                )
            ).scalar()
            if overlap:
                raise HTTPException(
                    409, "A verified engagement already covers this period"
                )
        await flow.decide(
            user=user,
            permissions=permissions,
            instance_id=instance,
            target_version=record["version"],
            decision=payload.decision,
            reason=payload.reason,
        )
        state = "verified" if payload.decision == "approved" else "rejected"
        version = record["version"] + 1
    await db.execute(
        text(
            """UPDATE hr.worker_engagements SET status=CAST(:state AS varchar),version=:version,decision_reason=:reason,updated_at=now(),verified_by=CASE WHEN CAST(:state AS varchar)='verified' THEN CAST(:actor AS uuid) ELSE NULL END,verified_at=CASE WHEN CAST(:state AS varchar)='verified' THEN now() ELSE NULL END WHERE id=:id AND organization_id=:org"""
        ),
        {
            "state": state,
            "version": version,
            "reason": payload.reason,
            "actor": user["user_id"],
            "id": engagement_id,
            "org": user["org_id"],
        },
    )
    await audit_action(
        db,
        user,
        "hr.worker_engagements",
        engagement_id,
        "STATE_CHANGE",
        {"status": state, "version": version, "reason": payload.reason},
    )
    await emit_event(
        db,
        user=user,
        event_type=f"hr.engagement_{state}.v1",
        aggregate_type="worker_engagement",
        aggregate_id=engagement_id,
        idempotency_suffix=str(version),
        event_data={
            "worker_id": str(record["employee_id"]),
            "version": version,
            "status": state,
        },
    )
    return {
        "id": str(engagement_id),
        "status": state,
        "version": version,
        "approval_id": str(instance),
    }
