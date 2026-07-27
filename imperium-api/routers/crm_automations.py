from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
import json
from typing import Any, Dict, Optional
from pydantic import BaseModel, ConfigDict, Field

from core.database import get_db
from core.security import get_current_user, require_permission
from app.shared.sql import insert_returning_id_sql, update_returning_id_sql
from app.services.crm.automation_engine import evaluate_and_run_automations

router = APIRouter()

AUTOMATION_COLUMNS = (
    "name",
    "trigger_type",
    "trigger_conditions",
    "action_type",
    "action_config",
    "is_active",
)


class AutomationPayload(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    trigger_type: Optional[str] = Field(default=None, min_length=1, max_length=100)
    trigger_conditions: Optional[Dict[str, Any]] = None
    action_type: Optional[str] = Field(default=None, min_length=1, max_length=100)
    action_config: Optional[Dict[str, Any]] = None
    is_active: Optional[bool] = None


def _payload_values(payload: AutomationPayload) -> dict:
    return payload.model_dump(exclude_unset=True, exclude_none=False)


"""
Module: crm_automations
Description: CRUD endpoints for crm.automation_rules.
"""


@router.get("/")
async def list_items(
    user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    query = text("""
        SELECT *
        FROM crm.automation_rules
        WHERE organization_id = :org_id AND is_deleted = false
        ORDER BY created_at DESC
        LIMIT 100
    """)
    result = await db.execute(query, {"org_id": user["org_id"]})
    items = [dict(row._mapping) for row in result]

    return {
        "success": True,
        "data": items,
        "message": "crm_automations listed.",
        "meta": {"total": len(items)},
    }


@router.post("/")
async def create_item(
    payload: AutomationPayload,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    values = _payload_values(payload)
    safe_keys = [column for column in AUTOMATION_COLUMNS if column in values]

    if not safe_keys:
        raise HTTPException(status_code=400, detail="Empty or invalid payload.")
    if (
        not values.get("name")
        or not values.get("trigger_type")
        or not values.get("action_type")
    ):
        raise HTTPException(
            status_code=422, detail="name, trigger_type, and action_type are required."
        )

    params = {}
    for k in safe_keys:
        val = values[k]
        # If it's a dict or list (like trigger_conditions or action_config), serialize to JSON string to ensure DB compatibility
        if isinstance(val, (dict, list)):
            params[k] = json.dumps(val)
        else:
            params[k] = val

    params["org_id"] = user["org_id"]
    params["user_id"] = user["sub"]

    query = insert_returning_id_sql("crm.automation_rules", safe_keys, AUTOMATION_COLUMNS)

    try:
        result = await db.execute(query, params)
        await db.commit()
        new_id = str(result.scalar())
        return {
            "success": True,
            "data": {"id": new_id},
            "message": "crm_automations created.",
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
):
    query = text("""
        SELECT *
        FROM crm.automation_rules
        WHERE id = :item_id AND organization_id = :org_id AND is_deleted = false
    """)
    result = await db.execute(query, {"item_id": item_id, "org_id": user["org_id"]})
    item = result.first()

    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    return {
        "success": True,
        "data": dict(item._mapping),
        "message": "crm_automations retrieved.",
        "meta": {},
    }


@router.put("/{item_id}")
async def update_item(
    item_id: str,
    payload: AutomationPayload,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    values = _payload_values(payload)
    safe_keys = [column for column in AUTOMATION_COLUMNS if column in values]

    if not safe_keys:
        return {
            "success": True,
            "data": {"id": item_id},
            "message": "No fields to update.",
        }

    params = {}
    for k in safe_keys:
        val = values[k]
        if isinstance(val, (dict, list)):
            params[k] = json.dumps(val)
        else:
            params[k] = val

    params["item_id"] = item_id
    params["org_id"] = user["org_id"]

    query = update_returning_id_sql("crm.automation_rules", safe_keys, AUTOMATION_COLUMNS)

    try:
        result = await db.execute(query, params)
        if not result.first():
            raise HTTPException(status_code=404, detail="Item not found")

        await db.commit()
        return {
            "success": True,
            "data": {"id": item_id},
            "message": "crm_automations updated.",
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
):
    query = text("""
        UPDATE crm.automation_rules
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
        "message": "crm_automations deleted (soft delete).",
        "meta": {},
    }


class ExecutePayload(BaseModel):
    trigger_type: str = Field(..., min_length=1, max_length=100)
    trigger_payload: Dict[str, Any] = Field(default_factory=dict)


@router.post("/execute")
async def execute_automations(
    payload: ExecutePayload,
    user: dict = Depends(require_permission("crm.automations.execute")),
    db: AsyncSession = Depends(get_db),
):
    runs = await evaluate_and_run_automations(
        db, user["org_id"], user["sub"], payload.trigger_type, payload.trigger_payload
    )
    return {"success": True, "data": runs, "message": "CRM automations executed.", "meta": {"total": len(runs)}}


@router.get("/runs")
async def list_automation_runs(
    rule_id: Optional[str] = None,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    params: Dict[str, Any] = {"org_id": user["org_id"]}
    filter_sql = ""
    if rule_id:
        filter_sql = "AND rule_id = :rule_id"
        params["rule_id"] = rule_id

    query = text(f"""
        SELECT *
        FROM crm.automation_runs
        WHERE organization_id = :org_id {filter_sql}
        ORDER BY created_at DESC
        LIMIT 100
    """)
    result = await db.execute(query, params)
    runs = [dict(row._mapping) for row in result]

    return {
        "success": True,
        "data": runs,
        "message": "crm_automation_runs listed.",
        "meta": {"total": len(runs)},
    }

