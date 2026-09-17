"""Compliance foundation commands. Caller owns the tenant-fenced transaction."""

from datetime import date

from fastapi import HTTPException
from sqlalchemy import text

from app.services.workflow_service import WorkflowService
from app.shared.events import emit_event
from app.shared.workforce_transactions import audit_action, canonical_json

TABLES = {
    "domains",
    "authorities",
    "sources",
    "obligations",
    "obligation_versions",
    "applicability_assessments",
    "assignments",
    "scope_grants",
}
SUBJECTS = {
    "project": "projects.projects",
    "worker": "hr.employees",
    "supplier": "procurement.suppliers",
    "subcontractor": "crm.subcontractors",
    "asset": "fleet.fleet",
}
PREFIX = "compliance.foundation."


def permit(user, action):
    if PREFIX + action not in user.get("permissions", set()):
        raise HTTPException(403, f"Missing permission: {PREFIX}{action}")


def check_version(row, expected):
    if row["version"] != expected:
        raise HTTPException(409, "Record changed; reload before deciding")


async def row(db, user, table, record_id, *, lock=False):
    if table not in TABLES:
        raise HTTPException(404, "Compliance register not found")
    found = (
        (
            await db.execute(
                text(
                    f"SELECT * FROM compliance.{table} WHERE organization_id=:org AND id=:id AND is_deleted=false"
                    + (" FOR UPDATE" if lock else "")
                ),
                {"org": user["org_id"], "id": record_id},
            )
        )
        .mappings()
        .first()
    )
    if not found:
        raise HTTPException(404, "Compliance record not found")
    return dict(found)


async def insert(db, user, table, values):
    if table not in TABLES:
        raise ValueError("Unknown compliance table")
    values = {
        **values,
        "organization_id": user["org_id"],
        "created_by": user["user_id"],
    }
    # Keys are service-owned or come from strict Pydantic model fields, never arbitrary JSON.
    if any(not key.replace("_", "").isalnum() for key in values):
        raise ValueError("Invalid column")
    expressions = [
        f"CAST(:{key} AS jsonb)" if key == "rule" else f":{key}" for key in values
    ]
    if "rule" in values:
        values["rule"] = canonical_json(values["rule"])
    result = await db.execute(
        text(
            f"INSERT INTO compliance.{table} ({','.join(values)}) VALUES ({','.join(expressions)}) RETURNING *"
        ),
        values,
    )
    return dict(result.mappings().one())


async def record(db, user, table, result, action, reason=""):
    await audit_action(
        db,
        user,
        f"compliance.{table}",
        result["id"],
        action.upper(),
        {
            "version": result["version"],
            "reason": reason,
            "status": result.get("status"),
        },
    )
    event = {
        ("obligation_versions", "created"): "compliance.obligation_created.v1",
        ("obligation_versions", "active"): "compliance.obligation_activated.v1",
    }.get((table, action), f"compliance.foundation.{table}.{action}.v1")
    await emit_event(
        db,
        user=user,
        event_type=event,
        aggregate_type=table,
        aggregate_id=result["id"],
        project_id=result.get("project_id"),
        idempotency_suffix=str(result["version"]),
        event_data={"version": result["version"], "status": result.get("status")},
    )
    recipient = result.get("owner_id") or result.get("created_by")
    if recipient and str(recipient) != str(user["user_id"]):
        await db.execute(text("INSERT INTO core.notifications(organization_id,user_id,title,message) VALUES(:org,:recipient,:title,:message)"),
            {"org": user["org_id"], "recipient": recipient, "title": "Compliance record updated", "message": f"{table}: {action}. Record {result['id']} requires your attention."})
    return result


async def master(db, user, table, record_id):
    # Table identifiers are constant call-site values.
    if table not in {*SUBJECTS.values(), "core.users"}:
        raise ValueError("Unknown master")
    found = (
        await db.execute(
            text(
                f"SELECT id FROM {table} WHERE organization_id=:org AND id=:id AND is_deleted=false"
            ),
            {"org": user["org_id"], "id": record_id},
        )
    ).scalar()
    if not found:
        raise HTTPException(404, "Referenced subject or owner not found")


async def project_scope(db, user, project_id):
    if project_id:
        await master(db, user, "projects.projects", project_id)
        if PREFIX + "scope.all" not in user["permissions"]:
            grant = (
                await db.execute(
                    text(
                        "SELECT 1 FROM compliance.scope_grants WHERE organization_id=:org AND user_id=:actor AND project_id=:project"
                    ),
                    {
                        "org": user["org_id"],
                        "actor": user["user_id"],
                        "project": project_id,
                    },
                )
            ).scalar()
            if not grant:
                raise HTTPException(403, "Project is outside your compliance scope")


async def create_catalogue(db, user, table, payload):
    permit(user, "manage")
    if table not in {"domains", "authorities"}:
        raise HTTPException(404, "Catalogue not found")
    return await record(
        db, user, table, await insert(db, user, table, payload.model_dump()), "created"
    )


async def create_source(db, user, payload):
    permit(user, "manage")
    await row(db, user, "authorities", payload.authority_id)
    return await record(
        db,
        user,
        "sources",
        await insert(db, user, "sources", payload.model_dump()),
        "created",
    )


async def verify_source(db, user, source_id, payload):
    permit(user, "approve")
    current = await row(db, user, "sources", source_id, lock=True)
    check_version(current, payload.expected_version)
    if current["created_by"] == user["user_id"] or str(current["created_by"]) == str(
        user["user_id"]
    ):
        raise HTTPException(403, "Source author cannot verify their own source")
    if current["status"] != "draft" or current["review_on"] < date.today():
        raise HTTPException(409, "Source is closed or review is overdue")
    result = (
        (
            await db.execute(
                text("""UPDATE compliance.sources SET status='verified',verified_by=:actor,
        verified_at=now(),verification_reason=:reason,version=version+1 WHERE id=:id AND organization_id=:org RETURNING *"""),
                {
                    "actor": user["user_id"],
                    "reason": payload.reason,
                    "id": source_id,
                    "org": user["org_id"],
                },
            )
        )
        .mappings()
        .one()
    )
    return await record(db, user, "sources", dict(result), "verified", payload.reason)


async def create_obligation(db, user, payload, predecessor_id=None):
    permit(user, "manage")
    await row(db, user, "domains", payload.domain_id)
    source = await row(db, user, "sources", payload.source_id)
    await master(db, user, "core.users", payload.owner_id)
    if source["status"] != "verified" or source["review_on"] < date.today():
        raise HTTPException(409, "A current independently verified source is required")
    if payload.rule.jurisdiction != source["jurisdiction"]:
        raise HTTPException(422, "Rule jurisdiction must match the verified source")
    revision = 1
    if predecessor_id:
        previous = await row(db, user, "obligation_versions", predecessor_id, lock=True)
        check_version(previous, payload.expected_version)
        root = await row(db, user, "obligations", previous["obligation_id"], lock=True)
        if root["code"] != payload.code or root["domain_id"] != payload.domain_id:
            raise HTTPException(422, "Revision must retain obligation code and domain")
        newest = (
            await db.execute(
                text(
                    "SELECT max(revision) FROM compliance.obligation_versions WHERE organization_id=:org AND obligation_id=:id"
                ),
                {"org": user["org_id"], "id": root["id"]},
            )
        ).scalar()
        if newest != previous["revision"] or previous["status"] in (
            "draft",
            "under_review",
        ):
            raise HTTPException(409, "Revise the latest completed review version")
        revision = newest + 1
    else:
        root = await insert(
            db,
            user,
            "obligations",
            {"code": payload.code, "domain_id": payload.domain_id},
        )
    values = payload.model_dump(
        exclude={"code", "domain_id", "expected_version", "reason"}
    )
    values.update(
        obligation_id=root["id"],
        revision=revision,
        predecessor_id=predecessor_id,
        change_reason=getattr(payload, "reason", "Initial registration"),
    )
    return await record(
        db,
        user,
        "obligation_versions",
        await insert(db, user, "obligation_versions", values),
        "created",
        values["change_reason"],
    )


async def transition(db, user, record_id, action, payload):
    permit(user, "manage")
    current = await row(db, user, "obligation_versions", record_id)
    await row(db, user, "obligations", current["obligation_id"], lock=True)
    current = await row(db, user, "obligation_versions", record_id, lock=True)
    check_version(current, payload.expected_version)
    allowed = {
        "submit": {"draft"},
        "activate": {"applicable"},
        "archive": {"applicable", "active"},
    }
    if current["status"] not in allowed.get(action, set()):
        raise HTTPException(409, "Invalid obligation transition")
    target = {"submit": "under_review", "activate": "active", "archive": "archived"}[
        action
    ]
    approval_id = current["approval_id"]
    source = await row(db, user, "sources", current["source_id"])
    if action != "archive" and (
        source["status"] != "verified"
        or source["review_on"] < date.today()
        or current["review_on"] < date.today()
    ):
        raise HTTPException(409, "Source or rule requires review")
    if action == "submit":
        steps = [PREFIX + "approve"]
        if current["rule"]["requires_legal_review"]:
            steps.insert(0, PREFIX + "legal_review")
        approval_id = await WorkflowService(db).initiate_approval(
            user=user,
            workflow_name="compliance.obligation",
            target_type="compliance.obligation_versions",
            target_id=record_id,
            target_version=current["version"] + 1,
            steps=steps,
            subject_user_id=current["owner_id"],
            excluded_user_ids=[current["created_by"]],
        )
    if action == "activate":
        if current["effective_from"] > date.today() or (
            current["effective_to"] and current["effective_to"] <= date.today()
        ):
            raise HTTPException(409, "Rule is not effective today")
        # Serialize sibling activations and retain superseded historical content.
        siblings = (
            (
                await db.execute(
                    text(
                        "SELECT * FROM compliance.obligation_versions WHERE organization_id=:org AND obligation_id=:root AND status='active' FOR UPDATE"
                    ),
                    {"org": user["org_id"], "root": current["obligation_id"]},
                )
            )
            .mappings()
            .all()
        )
        for sibling in siblings:
            if sibling["revision"] >= current["revision"]:
                raise HTTPException(409, "A newer version is already active")
            updated = (
                (
                    await db.execute(
                        text(
                            "UPDATE compliance.obligation_versions SET status='superseded',version=version+1 WHERE organization_id=:org AND id=:id RETURNING *"
                        ),
                        {"org": user["org_id"], "id": sibling["id"]},
                    )
                )
                .mappings()
                .one()
            )
            await record(
                db,
                user,
                "obligation_versions",
                dict(updated),
                "superseded",
                payload.reason,
            )
    result = (
        (
            await db.execute(
                text(
                    "UPDATE compliance.obligation_versions SET status=:status,approval_id=:approval,version=version+1 WHERE organization_id=:org AND id=:id RETURNING *"
                ),
                {
                    "status": target,
                    "approval": approval_id,
                    "org": user["org_id"],
                    "id": record_id,
                },
            )
        )
        .mappings()
        .one()
    )
    return await record(
        db, user, "obligation_versions", dict(result), target, payload.reason
    )


async def assess(db, user, payload):
    permit(user, "manage")
    obligation = await row(
        db, user, "obligation_versions", payload.obligation_version_id
    )
    if (
        obligation["status"] != "active"
        or obligation["review_on"] < date.today()
        or (obligation["effective_to"] and obligation["effective_to"] <= date.today())
    ):
        raise HTTPException(409, "Assessment requires a current active obligation")
    if payload.subject_kind not in obligation["rule"]["subject_kinds"]:
        raise HTTPException(422, "Subject kind is outside this rule's scope")
    if payload.review_on < date.today():
        raise HTTPException(422, "Assessment review date cannot be in the past")
    if payload.subject_kind == "organisation":
        if str(payload.subject_id) != str(user["org_id"]):
            raise HTTPException(404, "Organisation not found")
    else:
        await master(db, user, SUBJECTS[payload.subject_kind], payload.subject_id)
    await project_scope(db, user, payload.project_id)
    result = await insert(db, user, "applicability_assessments", payload.model_dump())
    steps = [PREFIX + "approve"]
    if (
        obligation["rule"]["requires_legal_review"]
        or payload.outcome == "not_applicable"
    ):
        steps.insert(0, PREFIX + "legal_review")
    approval = await WorkflowService(db).initiate_approval(
        user=user,
        workflow_name="compliance.applicability",
        target_type="compliance.applicability_assessments",
        target_id=result["id"],
        target_version=1,
        steps=steps,
    )
    await db.execute(
        text(
            "UPDATE compliance.applicability_assessments SET approval_id=:approval WHERE organization_id=:org AND id=:id"
        ),
        {"approval": approval, "org": user["org_id"], "id": result["id"]},
    )
    result["approval_id"] = approval
    return await record(
        db, user, "applicability_assessments", result, "submitted", payload.reason
    )


async def decide(db, user, table, record_id, payload):
    if table not in {"obligation_versions", "applicability_assessments"}:
        raise HTTPException(404, "Review not found")
    current = await row(db, user, table, record_id, lock=True)
    check_version(current, payload.expected_version)
    if current["status"] != "under_review":
        raise HTTPException(409, "Record is not under review")
    await project_scope(db, user, current.get("project_id"))
    if table == "applicability_assessments":
        obligation = await row(
            db, user, "obligation_versions", current["obligation_version_id"]
        )
        if obligation["status"] != "active" or current["review_on"] < date.today():
            raise HTTPException(409, "Assessment authority is no longer current")
    authority_version = current if table == "obligation_versions" else obligation
    source = await row(db, user, "sources", authority_version["source_id"])
    if source["status"] != "verified" or source["review_on"] < date.today() or authority_version["review_on"] < date.today() or (authority_version["effective_to"] and authority_version["effective_to"] <= date.today()):
        raise HTTPException(409, "Approval basis expired; revise and resubmit")
    decision = await WorkflowService(db).decide(
        user=user,
        permissions=user["permissions"],
        instance_id=current["approval_id"],
        target_version=current["version"],
        decision=payload.decision,
        reason=payload.reason,
    )
    if decision["status"] == "pending":
        return current
    target = (
        "rejected"
        if decision["status"] == "rejected"
        else ("applicable" if table == "obligation_versions" else "approved")
    )
    result = (
        (
            await db.execute(
                text(
                    f"UPDATE compliance.{table} SET status=:status,version=version+1 WHERE organization_id=:org AND id=:id RETURNING *"
                ),
                {"status": target, "org": user["org_id"], "id": record_id},
            )
        )
        .mappings()
        .one()
    )
    return await record(db, user, table, dict(result), target, payload.reason)


async def assign(db, user, payload):
    permit(user, "assign")
    assessment = await row(
        db, user, "applicability_assessments", payload.assessment_id, lock=True
    )
    if (
        assessment["status"] != "approved"
        or assessment["outcome"] != "applicable"
        or assessment["review_on"] < date.today()
    ):
        raise HTTPException(409, "Assignment requires current approved applicability")
    obligation = await row(
        db, user, "obligation_versions", assessment["obligation_version_id"]
    )
    if obligation["status"] != "active":
        raise HTTPException(409, "Obligation is no longer active")
    await master(db, user, "core.users", payload.owner_id)
    await project_scope(db, user, assessment["project_id"])
    result = await insert(
        db,
        user,
        "assignments",
        {**payload.model_dump(), "project_id": assessment["project_id"]},
    )
    return await record(db, user, "assignments", result, "created", payload.reason)


async def reassign(db, user, record_id, payload):
    permit(user, "assign")
    current = await row(db, user, "assignments", record_id, lock=True)
    check_version(current, payload.expected_version)
    await project_scope(db, user, current["project_id"])
    await master(db, user, "core.users", payload.owner_id)
    if str(current["owner_id"]) == str(payload.owner_id):
        raise HTTPException(422, "Choose a different accountable owner")
    result = (await db.execute(text("UPDATE compliance.assignments SET owner_id=:owner,reason=:reason,version=version+1 WHERE organization_id=:org AND id=:id RETURNING *"),
        {"owner": payload.owner_id, "reason": payload.reason, "org": user["org_id"], "id": record_id})).mappings().one()
    await audit_action(db, user, "compliance.assignments", record_id, "OWNER_CHANGED", {
        "previous_owner_id": str(current["owner_id"]), "owner_id": str(payload.owner_id),
        "reason": payload.reason, "version": result["version"]})
    return await record(db, user, "assignments", dict(result), "reassigned", payload.reason)
