from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from decimal import Decimal, ROUND_HALF_UP

from core.database import get_db
from core.security import get_current_user, require_permission
from app.shared.sql import (
    insert_returning_id_sql,
    safe_payload_columns,
    update_returning_id_sql,
)

router = APIRouter()

"""
Module: inventory_items
Description: Auto-generated CRUD endpoints for procurement.inventory_items.
"""


ITEM_RETURNING_COLUMNS = """
    id, organization_id, created_by, created_at, updated_at, is_deleted,
    item_name, stock_quantity, item_code, description, category,
    unit_of_measure, reorder_level, reorder_quantity, standard_cost,
    is_hazardous, item_type, vat_rate, vat_inclusive, unit_price_ex_vat,
    unit_price_inc_vat, is_once_off_purchase, repurchase_policy, procurement_notes
"""


def _decimal(value, default: str = "0") -> Decimal:
    if value in (None, ""):
        return Decimal(default)
    return Decimal(str(value))


def _money4(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)


def normalize_item_payload(payload: dict) -> dict:
    normalized = dict(payload)
    if "uom" in normalized:
        if "unit_of_measure" not in normalized:
            normalized["unit_of_measure"] = normalized["uom"]
        normalized.pop("uom", None)
    if "apply_zimra_vat" in normalized:
        if normalized.pop("apply_zimra_vat") and not normalized.get("vat_rate"):
            normalized["vat_rate"] = Decimal("15.5")
    if "item_type" in normalized and normalized["item_type"] not in {
        "material",
        "supply",
        "tool",
    }:
        raise HTTPException(status_code=422, detail="Invalid inventory item type.")
    if "repurchase_policy" in normalized and normalized["repurchase_policy"] not in {
        "reorder",
        "once_off",
        "do_not_reorder",
    }:
        raise HTTPException(status_code=422, detail="Invalid repurchase policy.")
    if normalized.get("is_once_off_purchase") and not normalized.get("repurchase_policy"):
        normalized["repurchase_policy"] = "once_off"

    vat_rate = _decimal(normalized.get("vat_rate"))
    vat_inclusive = bool(normalized.get("vat_inclusive"))
    entered_cost = _decimal(normalized.get("standard_cost"))
    if entered_cost > 0:
        multiplier = Decimal("1") + (vat_rate / Decimal("100"))
        if vat_rate > 0 and not vat_inclusive:
            unit_ex = entered_cost
            unit_inc = entered_cost * multiplier
        elif vat_rate > 0 and vat_inclusive:
            unit_inc = entered_cost
            unit_ex = entered_cost / multiplier
        else:
            unit_ex = entered_cost
            unit_inc = entered_cost
        normalized["unit_price_ex_vat"] = _money4(unit_ex)
        normalized["unit_price_inc_vat"] = _money4(unit_inc)
        normalized["standard_cost"] = _money4(unit_inc)
        normalized["vat_rate"] = _money4(vat_rate)
    return normalized


@router.get("/")
async def list_items(
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("inventory_items.read")),
):
    # Fetch active records scoped to the user's organization
    query = text("""
        SELECT *
        FROM procurement.inventory_items
        WHERE organization_id = :org_id AND is_deleted = false
        ORDER BY item_name NULLS LAST, created_at DESC
        LIMIT 500
    """)
    result = await db.execute(query, {"org_id": user["org_id"]})
    items = [dict(row._mapping) for row in result]

    return {
        "success": True,
        "data": items,
        "message": "inventory_items listed.",
        "meta": {"total": len(items)},
    }


@router.post("/")
async def create_item(
    request: Request,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("inventory_items.create")),
):
    payload = normalize_item_payload(await request.json())

    # Extract keys and values from JSON payload dynamically
    # Exclude reserved keys to prevent override
    safe_keys = safe_payload_columns(payload.keys())

    if not safe_keys:
        raise HTTPException(status_code=400, detail="Empty or invalid payload.")

    params = {k: payload[k] for k in safe_keys}
    params["org_id"] = user["org_id"]
    params["user_id"] = user["sub"]

    query = insert_returning_id_sql("procurement.inventory_items", safe_keys, safe_keys)

    try:
        result = await db.execute(query, params)
        item_id = result.scalar()
        item_row = await db.execute(
            text(f"""
                SELECT {ITEM_RETURNING_COLUMNS}
                FROM procurement.inventory_items
                WHERE id = :item_id AND organization_id = :org_id AND is_deleted = false
            """),
            {"item_id": item_id, "org_id": user["org_id"]},
        )
        await db.commit()
        return {
            "success": True,
            "data": dict(item_row.mappings().one()),
            "message": "inventory_items created.",
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
    _: dict = Depends(require_permission("inventory_items.read")),
):
    query = text("""
        SELECT *
        FROM procurement.inventory_items
        WHERE id = :item_id AND organization_id = :org_id AND is_deleted = false
    """)
    result = await db.execute(query, {"item_id": item_id, "org_id": user["org_id"]})
    item = result.first()

    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    return {
        "success": True,
        "data": dict(item._mapping),
        "message": "inventory_items retrieved.",
        "meta": {},
    }


@router.put("/{item_id}")
async def update_item(
    item_id: str,
    request: Request,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("inventory_items.update")),
):
    payload = normalize_item_payload(await request.json())
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

    query = update_returning_id_sql("procurement.inventory_items", safe_keys, safe_keys)

    try:
        result = await db.execute(query, params)
        if not result.first():
            raise HTTPException(status_code=404, detail="Item not found")

        await db.commit()
        return {
            "success": True,
            "data": {"id": item_id},
            "message": "inventory_items updated.",
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
    _: dict = Depends(require_permission("inventory_items.delete")),
):
    query = text("""
        UPDATE procurement.inventory_items
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
        "message": "inventory_items deleted (soft delete).",
        "meta": {},
    }
