from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from typing import Optional
from uuid import UUID

from core.database import get_db
from core.security import require_permission
from app.shared.pagination import ok

router = APIRouter()


@router.get("/")
async def list_budgets(
    project_id: Optional[UUID] = None,
    user: dict = Depends(require_permission("finance.budget.read")),
    db: AsyncSession = Depends(get_db),
):
    """
    List approved and active budgets for projects, optionally filtered by project.
    """
    query_str = """
        SELECT pb.*, p.name AS project_name
        FROM finance.project_budgets pb
        JOIN projects.projects p ON p.id = pb.project_id AND p.organization_id = pb.organization_id
        WHERE pb.organization_id = :org_id AND pb.is_deleted = false
    """
    params = {"org_id": user["org_id"]}
    if project_id:
        query_str += " AND pb.project_id = :project_id"
        params["project_id"] = project_id

    query_str += " ORDER BY pb.effective_date DESC"

    result = await db.execute(text(query_str), params)
    items = [dict(row._mapping) for row in result]
    return ok(items, "Project budgets listed.")
