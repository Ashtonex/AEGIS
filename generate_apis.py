import os

ROUTERS_DIR = r'g:\work\ATMCAPPROJECTS\Mudekwa\AEGIS\imperium-api\routers'

MAPPING = {
    'projects.py': 'projects.projects',
    'site_operations.py': 'projects.site_operations',
    'hse_incidents.py': 'projects.hse_incidents',
    'workforce.py': 'hr.employees',
    'hr_records.py': 'hr.records',
    'fleet.py': 'fleet.fleet',
    'equipment_assets.py': 'fleet.equipment_assets',
    'maintenance_schedules.py': 'fleet.maintenance_schedules',
    'procurement_orders.py': 'procurement.procurement_orders',
    'inventory_items.py': 'procurement.inventory_items',
    'supplier_records.py': 'procurement.suppliers',
    'budgets.py': 'finance.budgets',
    'financial_performance.py': 'finance.financial_performance',
    'quotations.py': 'finance.quotations',
    'kpi_metrics.py': 'executive.kpi_metrics',
    'bi_reports.py': 'executive.bi_reports',
    'risk_register.py': 'executive.risk_register',
    'automated_reports.py': 'executive.automated_reports',
    'client_portal_tickets.py': 'crm.tickets',
    'tender_bids.py': 'crm.tenders',
    'website_enquiries.py': 'crm.website_enquiries',
    'internal_messages.py': 'core.internal_messages',
    'compliance_items.py': 'core.compliance_items',
    'documents.py': 'core.documents',
    'crm_contacts.py': 'crm.contacts',
    'crm_leads.py': 'crm.leads',
}

SKIP = ['auth.py', 'users.py', 'crm.py', 'executive.py']

TEMPLATE = """from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from typing import Dict, Any

from core.database import get_db
from core.security import require_permission, get_current_user

router = APIRouter()

\"\"\"
Module: {module_name}
Description: Auto-generated CRUD endpoints for {table_name}.
\"\"\"

@router.get("/")
async def list_items(
    user: dict = Depends(get_current_user), 
    db: AsyncSession = Depends(get_db)
):
    # Fetch active records scoped to the user's organization
    query = text(\"\"\"
        SELECT *
        FROM {table_name}
        WHERE organization_id = :org_id AND is_deleted = false
        ORDER BY created_at DESC
        LIMIT 100
    \"\"\")
    result = await db.execute(query, {{"org_id": user["org_id"]}})
    items = [dict(row._mapping) for row in result]
    
    return {{"success": True, "data": items, "message": "{module_name} listed.", "meta": {{"total": len(items)}}}}

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
    binds = ", ".join([f":{{k}}" for k in safe_keys]) + ", :org_id, :user_id"
    
    params = {{k: payload[k] for k in safe_keys}}
    params["org_id"] = user["org_id"]
    params["user_id"] = user["sub"]

    query = text(f\"\"\"
        INSERT INTO {table_name} ({{columns}})
        VALUES ({{binds}})
        RETURNING id
    \"\"\")
    
    try:
        result = await db.execute(query, params)
        await db.commit()
        new_id = str(result.scalar())
        return {{"success": True, "data": {{"id": new_id}}, "message": "{module_name} created.", "meta": {{}}}}
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Database error: {{str(e)}}")

@router.get("/{{item_id}}")
async def get_item(
    item_id: str, 
    user: dict = Depends(get_current_user), 
    db: AsyncSession = Depends(get_db)
):
    query = text(\"\"\"
        SELECT *
        FROM {table_name}
        WHERE id = :item_id AND organization_id = :org_id AND is_deleted = false
    \"\"\")
    result = await db.execute(query, {{"item_id": item_id, "org_id": user["org_id"]}})
    item = result.first()
    
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
        
    return {{"success": True, "data": dict(item._mapping), "message": "{module_name} retrieved.", "meta": {{}}}}

@router.put("/{{item_id}}")
async def update_item(
    item_id: str, 
    request: Request,
    user: dict = Depends(get_current_user), 
    db: AsyncSession = Depends(get_db)
):
    payload = await request.json()
    safe_keys = [k for k in payload.keys() if k not in ['id', 'created_at', 'updated_at', 'organization_id', 'created_by', 'is_deleted']]
    
    if not safe_keys:
        return {{"success": True, "data": {{"id": item_id}}, "message": "No fields to update."}}

    set_clause = ", ".join([f"{{k}} = :{{k}}" for k in safe_keys])
    
    params = {{k: payload[k] for k in safe_keys}}
    params["item_id"] = item_id
    params["org_id"] = user["org_id"]

    query = text(f\"\"\"
        UPDATE {table_name}
        SET {{set_clause}}, updated_at = NOW()
        WHERE id = :item_id AND organization_id = :org_id AND is_deleted = false
        RETURNING id
    \"\"\")
    
    try:
        result = await db.execute(query, params)
        if not result.first():
            raise HTTPException(status_code=404, detail="Item not found")
            
        await db.commit()
        return {{"success": True, "data": {{"id": item_id}}, "message": "{module_name} updated.", "meta": {{}}}}
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Database error: {{str(e)}}")

@router.delete("/{{item_id}}")
async def delete_item(
    item_id: str, 
    user: dict = Depends(get_current_user), 
    db: AsyncSession = Depends(get_db)
):
    query = text(\"\"\"
        UPDATE {table_name}
        SET is_deleted = true, updated_at = NOW()
        WHERE id = :item_id AND organization_id = :org_id
        RETURNING id
    \"\"\")
    
    result = await db.execute(query, {{"item_id": item_id, "org_id": user["org_id"]}})
    if not result.first():
        raise HTTPException(status_code=404, detail="Item not found")
        
    await db.commit()
    return {{"success": True, "data": None, "message": "{module_name} deleted (soft delete).", "meta": {{}}}}
"""

success_count = 0
for filename in os.listdir(ROUTERS_DIR):
    if filename.endswith('.py') and filename not in SKIP:
        table_name = MAPPING.get(filename)
        if table_name:
            module_name = filename.replace('.py', '')
            content = TEMPLATE.format(module_name=module_name, table_name=table_name)
            
            filepath = os.path.join(ROUTERS_DIR, filename)
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(content)
            success_count += 1
            print(f"Generated {filename} mapped to {table_name}")
        else:
            print(f"WARNING: No mapping found for {filename}")

print(f"Generation complete. Updated {success_count} modules.")
