"""Auto-generates the standard task stack for a newly-created CRM record.

Called as a best-effort side effect right after a lead/opportunity/tender/
project is created - never allowed to fail the parent create, since a task
template not applying cleanly shouldn't block someone from logging a real
lead or tender.
"""

import json
from typing import Any, Optional
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from core.logging import logger

# Fixed entity_type -> department mapping for the Tasks page's department
# tabs. Deliberately code-level rather than a department_id column on every
# source table: leads/tenders have no department column at all today, and
# the columns that DO exist (crm.opportunities.originating_department_id,
# projects.projects.department_id) track deal-sourcing/delivery department,
# which can legitimately diverge from this fixed grouping - this map answers
# "which tab does this task type belong on", not "who owns this deal."
ENTITY_DEPARTMENT_CODE: dict[str, str] = {
    "lead": "commercial",
    "opportunity": "commercial",
    "tender": "commercial",
    "project": "construction",
    "fleet": "plant_equipment",
    "machinery": "plant_equipment",
    "plant_request": "plant_equipment",
    "plant_dispatch": "plant_equipment",
    "plant_breakdown": "plant_equipment",
    "plant_return": "plant_equipment",
    "plant_closure": "plant_equipment",
    # Pursuit-lifecycle packs (crm.pursuits.id as entity_id) - Award and
    # Handover / Loss Review / Clarification and Negotiation teams are all
    # chaired out of Commercial per the pursuit operating model, even though
    # individual tasks within an Award pack fan out to Construction/Plant.
    "award": "commercial",
    "loss": "commercial",
    "clarification": "commercial",
    "commercial_readiness": "commercial",
}


def _requirement_code(title: str, explicit: Optional[str] = None) -> str:
    if explicit:
        return explicit.strip().upper()
    return "".join(character if character.isalnum() else "_" for character in title.upper()).strip("_")


def _dedupe_key(
    *,
    entity_type: str,
    entity_id: UUID | str,
    requirement_code: str,
    scope: str = "MAIN",
    version: int = 1,
) -> str:
    return f"{entity_type.upper()}:{entity_id}|{requirement_code}|{scope.upper()}|V{version}"


def _json_value(value: Any, fallback: Any) -> Any:
    if value is None:
        return fallback
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return fallback
    return value


def _json_dumps(value: Any, fallback: Any) -> str:
    return json.dumps(_json_value(value, fallback))


def _normalize_stage(stage: Optional[str]) -> Optional[str]:
    if not stage:
        return None
    return " ".join(str(stage).strip().split())


async def _load_templates(db: AsyncSession, *, org_id: str, entity_type: str, stage: Optional[str]):
    base_sql = """
        SELECT id, title, description, template_key, template_version,
               requirement_code, task_type, outcome_key, stage,
               reuse_scope, responsible_role, reviewer_role,
               approver_role, criticality, weight, gate_effect,
               completion_criteria, required_evidence,
               contribution_target
        FROM crm.task_templates
        WHERE organization_id = :org_id AND entity_type = :entity_type
          AND is_active = true AND is_deleted = false
          AND {stage_filter}
        ORDER BY sort_order
    """
    params = {"org_id": org_id, "entity_type": entity_type, "stage": stage}
    stage_filter = "stage = :stage" if stage else "stage IS NULL"
    rows = (
        await db.execute(text(base_sql.format(stage_filter=stage_filter)), params)
    ).mappings().all()
    if rows or not stage:
        return rows

    return (
        await db.execute(
            text(base_sql.format(stage_filter="stage IS NULL")),
            {"org_id": org_id, "entity_type": entity_type, "stage": None},
        )
    ).mappings().all()


async def generate_task_stack(
    db: AsyncSession,
    *,
    org_id: str,
    entity_type: str,
    entity_id: UUID | str,
    created_by: Optional[str] = None,
    source_event: str = "task_stack_generated",
    generation_reason: Optional[str] = None,
    stage: Optional[str] = None,
) -> int:
    """Bulk-inserts crm.tasks from the active crm.task_templates rows for
    this entity_type, linked back via entity_type/entity_id. No-ops if a
    template-sourced stack already exists for this exact record - that
    existence check is the duplicate guard (a stack is many rows, so this
    can't be a simple unique constraint). Returns the number of tasks
    created (0 if none, including the no-op case)."""
    try:
        normalized_stage = _normalize_stage(stage)
        templates = await _load_templates(db, org_id=org_id, entity_type=entity_type, stage=normalized_stage)
        if not templates:
            return 0

        created = 0
        pack_stage = normalized_stage or entity_type
        pack_key = f"{entity_type}.standard"
        pack = (
            await db.execute(
                text("""
                    INSERT INTO crm.task_pack_instances (
                        organization_id, entity_type, entity_id, stage,
                        template_key, template_version, generation_reason,
                        generated_by
                    ) VALUES (
                        :org_id, :entity_type, :entity_id, :stage,
                        :template_key, 1, :generation_reason, :created_by
                    )
                    ON CONFLICT (organization_id, entity_type, entity_id, stage, template_key, template_version)
                    DO UPDATE SET updated_at = NOW(),
                                  generation_reason = COALESCE(EXCLUDED.generation_reason, crm.task_pack_instances.generation_reason)
                    RETURNING id
                """),
                {
                    "org_id": org_id,
                    "entity_type": entity_type,
                    "entity_id": entity_id,
                    "stage": pack_stage,
                    "template_key": pack_key,
                    "generation_reason": generation_reason or source_event,
                    "created_by": created_by,
                },
            )
        ).scalar()
        for template in templates:
            requirement_code = _requirement_code(template["title"], template["requirement_code"])
            template_version = int(template["template_version"] or 1)
            dedupe_key = _dedupe_key(
                entity_type=entity_type,
                entity_id=entity_id,
                requirement_code=requirement_code,
                version=template_version,
            )
            existing = await db.execute(
                text("""
                    SELECT id FROM crm.tasks
                    WHERE organization_id = :org_id
                      AND deduplication_key = :deduplication_key
                      AND is_deleted = false
                      AND status NOT IN ('cancelled','superseded')
                    LIMIT 1
                """),
                {
                    "org_id": org_id,
                    "deduplication_key": dedupe_key,
                },
            )
            existing_task = existing.mappings().first()
            if existing_task:
                await db.execute(
                    text("""
                        UPDATE crm.tasks
                        SET template_id = :template_id,
                            template_version = :template_version,
                            parent_pack_id = COALESCE(parent_pack_id, :parent_pack_id),
                            source_history = source_history || jsonb_build_array(jsonb_build_object(
                                'event', :source_event,
                                'rule', :generation_rule,
                                'template_id', :template_id,
                                'generated_at', NOW()
                            )),
                            updated_at = NOW()
                        WHERE id = :task_id AND organization_id = :org_id
                    """),
                    {
                        "org_id": org_id,
                        "task_id": existing_task["id"],
                        "parent_pack_id": pack,
                        "source_event": source_event,
                        "generation_rule": template["template_key"] or requirement_code,
                        "template_id": template["id"],
                        "template_version": template_version,
                    },
                )
                continue
            await db.execute(
                text("""
                    INSERT INTO crm.tasks (
                        organization_id, title, description, entity_type, entity_id,
                        primary_entity_type, primary_entity_id, source, source_event,
                        source_history, template_id, template_version,
                        parent_pack_id, task_type, requirement_code,
                        expected_outcome, deduplication_key, applicability_result,
                        responsible_role, reviewer_role, approver_role,
                        criticality, weight, gate_effect, completion_criteria,
                        required_evidence, contribution_target_type,
                        contribution_target_id, contribution_target_field,
                        reuse_scope, generation_rule, priority, created_by
                    ) VALUES (
                        :org_id, :title, :description, :entity_type, :entity_id,
                        :entity_type, :entity_id, 'template', :source_event,
                        jsonb_build_array(jsonb_build_object(
                            'event', :source_event,
                            'rule', :generation_rule,
                            'template_id', :template_id,
                            'generated_at', NOW()
                        )),
                        :template_id, :template_version, :parent_pack_id,
                        :task_type, :requirement_code, :expected_outcome,
                        :deduplication_key, 'required', :responsible_role,
                        :reviewer_role, :approver_role, :criticality, :weight,
                        :gate_effect, CAST(:completion_criteria AS jsonb),
                        CAST(:required_evidence AS jsonb),
                        :contribution_target_type, :contribution_target_id,
                        :contribution_target_field, :reuse_scope,
                        :generation_rule, 'normal', :created_by
                    )
                """),
                {
                    "org_id": org_id,
                    "title": template["title"],
                    "description": template["description"],
                    "entity_type": entity_type,
                    "entity_id": entity_id,
                    "template_id": template["id"],
                    "template_version": template_version,
                    "parent_pack_id": pack,
                    "task_type": template["task_type"] or "control",
                    "requirement_code": requirement_code,
                    "expected_outcome": template["outcome_key"],
                    "deduplication_key": dedupe_key,
                    "source_event": source_event,
                    "responsible_role": template["responsible_role"],
                    "reviewer_role": template["reviewer_role"],
                    "approver_role": template["approver_role"],
                    "criticality": template["criticality"] or "medium",
                    "weight": template["weight"] or 5,
                    "gate_effect": template["gate_effect"] or "non_blocking",
                    "completion_criteria": _json_dumps(template["completion_criteria"], {}),
                    "required_evidence": _json_dumps(template["required_evidence"], []),
                    "contribution_target_type": _json_value(template["contribution_target"], {}).get("entity_type"),
                    "contribution_target_id": _json_value(template["contribution_target"], {}).get("entity_id"),
                    "contribution_target_field": _json_value(template["contribution_target"], {}).get("field"),
                    "reuse_scope": template["reuse_scope"] or "entity_specific",
                    "generation_rule": template["template_key"] or requirement_code,
                    "created_by": created_by,
                },
            )
            created += 1
        await db.commit()
        return created
    except Exception:
        logger.exception(
            "task_stack.generation_failed",
            org_id=org_id,
            entity_type=entity_type,
            entity_id=str(entity_id),
        )
        await db.rollback()
        return 0


async def cascade_delete_entity_tasks(
    db: AsyncSession,
    *,
    org_id: str,
    entity_type: str,
    entity_id: UUID | str,
) -> int:
    """Soft-deletes any crm.tasks stack linked to this record. Call as a
    best-effort side effect right after the parent record itself is
    soft-deleted (mirrors generate_task_stack's on-create side effect) -
    without this, a deleted lead/opportunity/tender/project leaves its task
    stack behind pointing at a now-nonexistent record, which is exactly the
    orphaned-reference case the Tasks page group headers can't resolve a
    name for. Never allowed to fail the parent delete. Returns the number of
    tasks soft-deleted."""
    try:
        result = await db.execute(
            text("""
                UPDATE crm.tasks SET is_deleted = true, updated_at = NOW()
                WHERE organization_id = :org_id AND entity_type = :entity_type AND entity_id = :entity_id
                  AND is_deleted = false
                RETURNING id
            """),
            {"org_id": org_id, "entity_type": entity_type, "entity_id": entity_id},
        )
        deleted = result.fetchall()
        await db.commit()
        return len(deleted)
    except Exception:
        logger.exception(
            "task_stack.cascade_delete_failed",
            org_id=org_id,
            entity_type=entity_type,
            entity_id=str(entity_id),
        )
        await db.rollback()
        return 0


async def supersede_entity_tasks(
    db: AsyncSession,
    *,
    org_id: str,
    entity_type: str,
    entity_id: UUID | str,
    authorized_by: Optional[str] = None,
    reason: str = "Superseded by lifecycle transition",
) -> int:
    """Scratches off still-open tasks for an entity when its CRM lifecycle
    moves to a new stage. Completed work remains audit-visible."""
    result = await db.execute(
        text("""
            UPDATE crm.tasks
            SET status = 'superseded',
                cancellation_reason = COALESCE(cancellation_reason, :reason),
                cancellation_authorized_by = COALESCE(cancellation_authorized_by, CAST(:authorized_by AS uuid)),
                updated_at = NOW()
            WHERE organization_id = :org_id
              AND entity_type = :entity_type
              AND entity_id = :entity_id
              AND is_deleted = false
              AND status NOT IN ('completed', 'cancelled', 'superseded', 'not_applicable')
            RETURNING id
        """),
        {
            "org_id": org_id,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "authorized_by": authorized_by,
            "reason": reason,
        },
    )
    return len(result.fetchall())
