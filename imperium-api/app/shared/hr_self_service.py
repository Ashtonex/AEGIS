"""Shared helper for employee self-service endpoints.

Bridges a core.users login to its hr.employees workforce record via
linked_user_id (populated at invite time by routers/settings.py's
invite_user, and backfilled for pre-existing users by migration 140).
Used by both routers/hr_records.py and routers/workforce.py so the lookup
isn't duplicated in each.
"""

from __future__ import annotations

from typing import Optional
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def resolve_own_employee_id(
    db: AsyncSession, *, org_id: str, user_id: str
) -> Optional[UUID]:
    return (
        await db.execute(
            text("""
                SELECT id FROM hr.employees
                WHERE organization_id = :org_id AND linked_user_id = :user_id AND is_deleted = false
            """),
            {"org_id": org_id, "user_id": user_id},
        )
    ).scalar()
