"""Auto-generates the standard task stack for a newly-created CRM record.

Called as a best-effort side effect right after a lead/opportunity/tender/
project is created - never allowed to fail the parent create, since a task
template not applying cleanly shouldn't block someone from logging a real
lead or tender.
"""

from typing import Optional
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from core.logging import logger


async def generate_task_stack(
    db: AsyncSession,
    *,
    org_id: str,
    entity_type: str,
    entity_id: UUID | str,
    created_by: Optional[str] = None,
) -> int:
    """Bulk-inserts crm.tasks from the active crm.task_templates rows for
    this entity_type, linked back via entity_type/entity_id. No-ops if a
    template-sourced stack already exists for this exact record - that
    existence check is the duplicate guard (a stack is many rows, so this
    can't be a simple unique constraint). Returns the number of tasks
    created (0 if none, including the no-op case)."""
    try:
        existing = await db.execute(
            text("""
                SELECT 1 FROM crm.tasks
                WHERE organization_id = :org_id AND entity_type = :entity_type AND entity_id = :entity_id
                  AND source = 'template' AND is_deleted = false
                LIMIT 1
            """),
            {"org_id": org_id, "entity_type": entity_type, "entity_id": entity_id},
        )
        if existing.first():
            return 0

        templates = (
            await db.execute(
                text("""
                    SELECT id, title, description FROM crm.task_templates
                    WHERE organization_id = :org_id AND entity_type = :entity_type
                      AND is_active = true AND is_deleted = false
                    ORDER BY sort_order
                """),
                {"org_id": org_id, "entity_type": entity_type},
            )
        ).mappings().all()
        if not templates:
            return 0

        for template in templates:
            await db.execute(
                text("""
                    INSERT INTO crm.tasks (
                        organization_id, title, description, entity_type, entity_id,
                        source, template_id, priority, created_by
                    ) VALUES (
                        :org_id, :title, :description, :entity_type, :entity_id,
                        'template', :template_id, 'normal', :created_by
                    )
                """),
                {
                    "org_id": org_id,
                    "title": template["title"],
                    "description": template["description"],
                    "entity_type": entity_type,
                    "entity_id": entity_id,
                    "template_id": template["id"],
                    "created_by": created_by,
                },
            )
        await db.commit()
        return len(templates)
    except Exception:
        logger.exception(
            "task_stack.generation_failed",
            org_id=org_id,
            entity_type=entity_type,
            entity_id=str(entity_id),
        )
        await db.rollback()
        return 0
