from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from core.cache import set_reference_data_cache_headers
from core.database import get_db
from core.security import require_permission
from app.shared.pagination import ok

router = APIRouter()


@router.get("/")
async def list_departments(
    response: Response,
    user: dict = Depends(require_permission("finance.department.read")),
    db: AsyncSession = Depends(get_db),
):
    """
    List the organization's finance departments (Construction, Plant &
    Equipment, Commercial) used to tag projects and department-scoped
    ledger entries.
    """
    result = await db.execute(
        text("""
            SELECT id, code, name, is_active
            FROM finance.departments
            WHERE organization_id = :org_id AND is_deleted = false AND is_active = true
            ORDER BY name
        """),
        {"org_id": user["org_id"]},
    )
    items = [dict(row._mapping) for row in result]
    set_reference_data_cache_headers(response)
    return ok(items, "Departments listed.")
