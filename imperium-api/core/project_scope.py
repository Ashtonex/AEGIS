"""Project-level visibility: who may see which projects.

A user whose roles hold ``projects.read_all`` (office roles: executives,
project/finance/commercial managers, auditors...) sees every project, as
before. Everyone else - site agents, engineers, foremen, clerks, site
managers, storekeepers and any new custom role by default - sees ONLY the
projects they are assigned to, plus everything hanging off those projects
(site days, daily reports, weekly budgets, material requests, GRNs,
variances, requisitions).

A user is assigned to a project when ANY of these holds:
  * they are on the project team (hr.project_allocations, via the employee
    record linked to their login) and the allocation is planned/active;
  * they hold an active site role assignment (projects.site_role_assignments);
  * they are the project's assigned owner (projects.assigned_to_user_id).

So adding a site agent to a project's team is what gives them that project -
nothing else does.
"""

from __future__ import annotations

from typing import Any, Optional

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.security import SUPERADMIN_ROLE, get_current_user, user_has_permission

PROJECTS_READ_ALL = "projects.read_all"
_CACHE_KEY = "aegis_visible_project_ids"


async def visible_project_ids(db: AsyncSession, user: dict) -> Optional[list[str]]:
    """None means unrestricted (every project in the org). Otherwise the ids
    of the projects this user is assigned to. Cached for the request."""
    info = getattr(db, "info", None)
    cache_key = (str(user.get("user_id")), str(user.get("org_id")))
    if info is not None and info.get(_CACHE_KEY, (None,))[0] == cache_key:
        return info[_CACHE_KEY][1]

    if user.get("role") == SUPERADMIN_ROLE or await user_has_permission(db, user, PROJECTS_READ_ALL):
        ids: Optional[list[str]] = None
    else:
        rows = await db.execute(
            text("""
            SELECT CAST(p.id AS text) AS id
            FROM projects.projects p
            WHERE p.organization_id = :org_id
              AND p.is_deleted = false
              AND (
                p.assigned_to_user_id = :user_id
                OR EXISTS (
                  SELECT 1 FROM projects.site_role_assignments sra
                  WHERE sra.project_id = p.id
                    AND sra.organization_id = p.organization_id
                    AND sra.user_id = :user_id
                    AND sra.is_active = true AND sra.is_deleted = false
                    AND (sra.starts_on IS NULL OR sra.starts_on <= CURRENT_DATE)
                    AND (sra.ends_on IS NULL OR sra.ends_on >= CURRENT_DATE)
                )
                OR EXISTS (
                  SELECT 1 FROM hr.project_allocations a
                  JOIN hr.employees e ON e.id = a.employee_id
                   AND e.organization_id = a.organization_id
                   AND e.is_deleted = false
                  WHERE a.project_id = p.id
                    AND a.organization_id = p.organization_id
                    AND e.linked_user_id = :user_id
                    AND a.is_deleted = false
                    AND a.status IN ('planned', 'active')
                    AND (a.ends_on IS NULL OR a.ends_on >= CURRENT_DATE)
                )
              )
        """),
            {"org_id": user.get("org_id"), "user_id": user.get("user_id")},
        )
        ids = [row.id for row in rows]

    if info is not None:
        info[_CACHE_KEY] = (cache_key, ids)
    return ids


def project_scope_sql(column: str, ids: Optional[list[str]]) -> tuple[str, dict[str, Any]]:
    """A WHERE fragment restricting ``column`` (a project_id column) to the
    visible ids. Unrestricted users get ``TRUE`` and no extra params."""
    if ids is None:
        return "TRUE", {}
    return (
        f"CAST({column} AS text) = ANY(CAST(:scope_project_ids AS text[]))",
        {"scope_project_ids": ids},
    )


async def require_project_access(db: AsyncSession, user: dict, project_id: Any) -> None:
    """404 (not 403, so existence isn't leaked) when the project isn't one
    this user may see."""
    if project_id is None:
        return
    ids = await visible_project_ids(db, user)
    if ids is not None and str(project_id) not in ids:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found.")


async def enforce_project_path_scope(
    request: Request,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Router-level dependency: any route with a ``{project_id}`` path
    parameter is checked against the caller's visible projects."""
    await require_project_access(db, user, request.path_params.get("project_id"))
