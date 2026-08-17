from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from core.database import get_db
from core.security import get_current_user, require_permission
from app.shared.sql import (
    insert_returning_id_sql,
    safe_payload_columns,
    tenant_child_rows_by_parent_sql,
    tenant_reference_sql,
    update_returning_id_sql,
)

router = APIRouter()

"""
Module: tender_bids
Description: Auto-generated CRUD endpoints for crm.tenders.
"""

# asyncpg binds parameters directly (no string-to-timestamptz coercion like
# psycopg does), so an ISO string from the frontend fails DataError against
# this table's one timestamptz column unless parsed here first.
_TIMESTAMPTZ_COLUMNS = {"submission_deadline"}


def _coerce_timestamptz_columns(params: dict) -> None:
    for column in _TIMESTAMPTZ_COLUMNS:
        value = params.get(column)
        if isinstance(value, str):
            params[column] = datetime.fromisoformat(value.replace("Z", "+00:00"))


@router.get("/")
async def list_items(
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("tender_bids.read")),
):
    # Fetch active records scoped to the user's organization
    query = text("""
        SELECT *
        FROM crm.tenders
        WHERE organization_id = :org_id AND is_deleted = false
        ORDER BY created_at DESC
        LIMIT 100
    """)
    result = await db.execute(query, {"org_id": user["org_id"]})
    items = [dict(row._mapping) for row in result]

    return {
        "success": True,
        "data": items,
        "message": "tender_bids listed.",
        "meta": {"total": len(items)},
    }


@router.post("/")
async def create_item(
    request: Request,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("tender_bids.create")),
):
    payload = await request.json()

    # Extract keys and values from JSON payload dynamically
    # Exclude reserved keys to prevent override
    safe_keys = safe_payload_columns(payload.keys())

    if not safe_keys:
        raise HTTPException(status_code=400, detail="Empty or invalid payload.")

    params = {k: payload[k] for k in safe_keys}
    params["org_id"] = user["org_id"]
    params["user_id"] = user["sub"]
    _coerce_timestamptz_columns(params)

    query = insert_returning_id_sql("crm.tenders", safe_keys, safe_keys)

    try:
        result = await db.execute(query, params)
        await db.commit()
        new_id = str(result.scalar())
        return {
            "success": True,
            "data": {"id": new_id},
            "message": "tender_bids created.",
            "meta": {},
        }
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


@router.get("/{item_id}")
async def get_item(
    item_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("tender_bids.read")),
):
    query = text("""
        SELECT *
        FROM crm.tenders
        WHERE id = :item_id AND organization_id = :org_id AND is_deleted = false
    """)
    result = await db.execute(query, {"item_id": item_id, "org_id": user["org_id"]})
    item = result.first()

    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    return {
        "success": True,
        "data": dict(item._mapping),
        "message": "tender_bids retrieved.",
        "meta": {},
    }


@router.put("/{item_id}")
async def update_item(
    item_id: str,
    request: Request,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("tender_bids.update")),
):
    payload = await request.json()
    safe_keys = safe_payload_columns(payload.keys())

    if not safe_keys:
        return {
            "success": True,
            "data": {"id": item_id},
            "message": "No fields to update.",
        }

    params = {k: payload[k] for k in safe_keys}
    params["item_id"] = item_id
    params["org_id"] = user["org_id"]
    _coerce_timestamptz_columns(params)

    query = update_returning_id_sql("crm.tenders", safe_keys, safe_keys)

    try:
        result = await db.execute(query, params)
        if not result.first():
            raise HTTPException(status_code=404, detail="Item not found")

        await db.commit()
        return {
            "success": True,
            "data": {"id": item_id},
            "message": "tender_bids updated.",
            "meta": {},
        }
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


@router.delete("/{item_id}")
async def delete_item(
    item_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("tender_bids.delete")),
):
    query = text("""
        UPDATE crm.tenders
        SET is_deleted = true, updated_at = NOW()
        WHERE id = :item_id AND organization_id = :org_id
        RETURNING id
    """)

    result = await db.execute(query, {"item_id": item_id, "org_id": user["org_id"]})
    if not result.first():
        raise HTTPException(status_code=404, detail="Item not found")

    await db.commit()
    return {
        "success": True,
        "data": None,
        "message": "tender_bids deleted (soft delete).",
        "meta": {},
    }


# ----------------------------------------------------------------------------
# Freeform per-tender requirements checklist (crm.tender_requirements)
# ----------------------------------------------------------------------------

async def _require_tender(db: AsyncSession, tender_id: str, org_id: str) -> None:
    result = await db.execute(
        tenant_reference_sql("crm.tenders", {"crm.tenders"}),
        {"id": tender_id, "org_id": org_id},
    )
    if not result.first():
        raise HTTPException(status_code=404, detail="Tender not found")


@router.get("/{tender_id}/requirements")
async def list_requirements(
    tender_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("tender_bids.read")),
):
    await _require_tender(db, tender_id, user["org_id"])

    query = tenant_child_rows_by_parent_sql(
        "crm.tender_requirements",
        "tender_id",
        "sort_order",
        allowed_tables={"crm.tender_requirements"},
        allowed_parent_columns={"tender_id"},
        allowed_order_columns={"sort_order"},
    )
    result = await db.execute(query, {"parent_id": tender_id, "org_id": user["org_id"]})
    items = [dict(row._mapping) for row in result]

    return {
        "success": True,
        "data": items,
        "message": "Tender requirements listed.",
        "meta": {"total": len(items)},
    }


@router.post("/{tender_id}/requirements")
async def create_requirement(
    tender_id: str,
    request: Request,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("tender_bids.update")),
):
    payload = await request.json()
    label = str(payload.get("label", "")).strip()
    if not label:
        raise HTTPException(status_code=400, detail="Requirement label is required.")

    await _require_tender(db, tender_id, user["org_id"])

    query = insert_returning_id_sql(
        "crm.tender_requirements",
        ["tender_id", "label"],
        ["tender_id", "label"],
    )
    result = await db.execute(
        query,
        {"tender_id": tender_id, "label": label, "org_id": user["org_id"], "user_id": user["sub"]},
    )
    await db.commit()

    return {
        "success": True,
        "data": {"id": str(result.scalar())},
        "message": "Requirement added.",
        "meta": {},
    }


@router.patch("/{tender_id}/requirements/{requirement_id}")
async def update_requirement(
    tender_id: str,
    requirement_id: str,
    request: Request,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("tender_bids.update")),
):
    payload = await request.json()
    if "is_satisfied" not in payload:
        raise HTTPException(status_code=400, detail="is_satisfied is required.")

    query = text("""
        UPDATE crm.tender_requirements
        SET is_satisfied = :is_satisfied, updated_at = NOW()
        WHERE id = :requirement_id AND tender_id = :tender_id
          AND organization_id = :org_id AND is_deleted = false
        RETURNING id
    """)
    result = await db.execute(
        query,
        {
            "is_satisfied": bool(payload["is_satisfied"]),
            "requirement_id": requirement_id,
            "tender_id": tender_id,
            "org_id": user["org_id"],
        },
    )
    if not result.first():
        raise HTTPException(status_code=404, detail="Requirement not found")

    await db.commit()
    return {
        "success": True,
        "data": {"id": requirement_id},
        "message": "Requirement updated.",
        "meta": {},
    }


@router.delete("/{tender_id}/requirements/{requirement_id}")
async def delete_requirement(
    tender_id: str,
    requirement_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("tender_bids.update")),
):
    query = text("""
        UPDATE crm.tender_requirements
        SET is_deleted = true, updated_at = NOW()
        WHERE id = :requirement_id AND tender_id = :tender_id AND organization_id = :org_id
        RETURNING id
    """)
    result = await db.execute(
        query,
        {"requirement_id": requirement_id, "tender_id": tender_id, "org_id": user["org_id"]},
    )
    if not result.first():
        raise HTTPException(status_code=404, detail="Requirement not found")

    await db.commit()
    return {
        "success": True,
        "data": None,
        "message": "Requirement deleted.",
        "meta": {},
    }
