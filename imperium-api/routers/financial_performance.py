from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from typing import Dict, Any

from core.database import get_db
from core.security import require_permission, get_current_user

router = APIRouter()

"""
Module: financial_performance
Description: Auto-generated CRUD endpoints for finance.financial_performance.
"""

@router.get("/")
async def list_items(
    user: dict = Depends(get_current_user), 
    db: AsyncSession = Depends(get_db)
):
    # Fetch active records scoped to the user's organization
    query = text("""
        SELECT *
        FROM finance.financial_performance
        WHERE organization_id = :org_id AND is_deleted = false
        ORDER BY created_at DESC
        LIMIT 100
    """)
    result = await db.execute(query, {"org_id": user["org_id"]})
    items = [dict(row._mapping) for row in result]
    
    return {"success": True, "data": items, "message": "financial_performance listed.", "meta": {"total": len(items)}}

@router.post("/")
async def create_item(
    request: Request,
    user: dict = Depends(get_current_user), 
    db: AsyncSession = Depends(get_db)
):
    payload = await request.json()
    
    # Extract keys and values from JSON payload dynamically
    # Exclude reserved keys to prevent override
    safe_keys = [k for k in payload.keys() if k not in ['id', 'created_at', 'updated_at', 'organization_id', 'created_by', 'is_deleted']]
    
    if not safe_keys:
        raise HTTPException(status_code=400, detail="Empty or invalid payload.")

    columns = ", ".join(safe_keys) + ", organization_id, created_by"
    binds = ", ".join([f":{k}" for k in safe_keys]) + ", :org_id, :user_id"
    
    params = {k: payload[k] for k in safe_keys}
    params["org_id"] = user["org_id"]
    params["user_id"] = user["sub"]

    query = text(f"""
        INSERT INTO finance.financial_performance ({columns})
        VALUES ({binds})
        RETURNING id
    """)
    
    try:
        result = await db.execute(query, params)
        await db.commit()
        new_id = str(result.scalar())
        return {"success": True, "data": {"id": new_id}, "message": "financial_performance created.", "meta": {}}
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

@router.get("/{item_id}")
async def get_item(
    item_id: str, 
    user: dict = Depends(get_current_user), 
    db: AsyncSession = Depends(get_db)
):
    query = text("""
        SELECT *
        FROM finance.financial_performance
        WHERE id = :item_id AND organization_id = :org_id AND is_deleted = false
    """)
    result = await db.execute(query, {"item_id": item_id, "org_id": user["org_id"]})
    item = result.first()
    
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
        
    return {"success": True, "data": dict(item._mapping), "message": "financial_performance retrieved.", "meta": {}}

@router.put("/{item_id}")
async def update_item(
    item_id: str, 
    request: Request,
    user: dict = Depends(get_current_user), 
    db: AsyncSession = Depends(get_db)
):
    payload = await request.json()
    safe_keys = [k for k in payload.keys() if k not in ['id', 'created_at', 'updated_at', 'organization_id', 'created_by', 'is_deleted']]
    
    if not safe_keys:
        return {"success": True, "data": {"id": item_id}, "message": "No fields to update."}

    set_clause = ", ".join([f"{k} = :{k}" for k in safe_keys])
    
    params = {k: payload[k] for k in safe_keys}
    params["item_id"] = item_id
    params["org_id"] = user["org_id"]

    query = text(f"""
        UPDATE finance.financial_performance
        SET {set_clause}, updated_at = NOW()
        WHERE id = :item_id AND organization_id = :org_id AND is_deleted = false
        RETURNING id
    """)
    
    try:
        result = await db.execute(query, params)
        if not result.first():
            raise HTTPException(status_code=404, detail="Item not found")
            
        await db.commit()
        return {"success": True, "data": {"id": item_id}, "message": "financial_performance updated.", "meta": {}}
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

@router.delete("/{item_id}")
async def delete_item(
    item_id: str, 
    user: dict = Depends(get_current_user), 
    db: AsyncSession = Depends(get_db)
):
    query = text("""
        UPDATE finance.financial_performance
        SET is_deleted = true, updated_at = NOW()
        WHERE id = :item_id AND organization_id = :org_id
        RETURNING id
    """)
    
    result = await db.execute(query, {"item_id": item_id, "org_id": user["org_id"]})
    if not result.first():
        raise HTTPException(status_code=404, detail="Item not found")
        
    await db.commit()
    return {"success": True, "data": None, "message": "financial_performance deleted (soft delete).", "meta": {}}
