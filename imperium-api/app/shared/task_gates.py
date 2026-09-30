"""Two-way link between tasks and the project gates they satisfy.

A project can't activate until its pre-mobilisation checks
(projects.project_checks, check_type='pre_mobilisation') are complete with
evidence and its commercial readiness controls
(projects.project_profiles.commercial_readiness_pack) are ticked - see
routers/projects.py _ensure_project_can_activate. The project and
commercial_readiness task packs describe that same work, and each linked
task names its gate in contribution_target_* (migration 242):

    contribution_target_type  'project_check'        | 'commercial_readiness'
    contribution_target_id    the project id
    contribution_target_field the check_name         | the control key

Completing (verifying) a linked task ticks its gate with the task's proof as
the evidence; reopening it unticks. Ticking a gate on the project completes
its linked tasks with the gate's evidence; unticking reopens them. Every
function here writes without committing - callers own the transaction.
"""

from __future__ import annotations

import json
from typing import Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

PROJECT_CHECK = "project_check"
COMMERCIAL_READINESS = "commercial_readiness"
PRE_MOBILISATION = "pre_mobilisation"
_DONE_CHECK_STATUSES = ("complete", "complete_with_conditions", "not_applicable")


async def sync_gate_from_task(
    db: AsyncSession,
    *,
    org_id: str,
    task: dict,
    completed: bool,
    evidence_ref: Optional[str],
) -> Optional[str]:
    """task needs contribution_target_type/_id/_field. Returns a short
    description of the gate touched (for logs/UI), or None."""
    target_type = task.get("contribution_target_type")
    project_id = task.get("contribution_target_id")
    field = task.get("contribution_target_field")
    if not (target_type and project_id and field):
        return None

    if target_type == PROJECT_CHECK:
        updated = await db.execute(
            text("""
                UPDATE projects.project_checks
                SET status = :status,
                    evidence_reference = CASE WHEN CAST(:completed AS boolean) THEN COALESCE(NULLIF(:evidence, ''), evidence_reference)
                                              ELSE evidence_reference END,
                    completed_at = CASE WHEN CAST(:completed AS boolean) THEN COALESCE(completed_at, NOW()) ELSE NULL END
                WHERE project_id = CAST(:project_id AS uuid) AND organization_id = :org_id
                  AND check_type = :check_type AND check_name = :check_name
                  AND (CASE WHEN CAST(:completed AS boolean) THEN status NOT IN ('complete', 'complete_with_conditions', 'not_applicable')
                            ELSE status = 'complete' END)
                RETURNING id
            """),
            {
                "status": "complete" if completed else "incomplete",
                "completed": completed,
                "evidence": evidence_ref or "",
                "project_id": str(project_id),
                "org_id": org_id,
                "check_type": PRE_MOBILISATION,
                "check_name": field,
            },
        )
        if updated.first():
            return f"pre-mobilisation check '{field}'"
        if completed:
            # Checks are seeded lazily (on first view of the project's
            # readiness) - create it already complete if it isn't there yet.
            inserted = await db.execute(
                text("""
                    INSERT INTO projects.project_checks (
                        project_id, organization_id, check_name, check_type, status,
                        evidence_reference, completed_at
                    )
                    SELECT CAST(:project_id AS uuid), :org_id, :check_name, :check_type, 'complete',
                           NULLIF(:evidence, ''), NOW()
                    WHERE NOT EXISTS (
                        SELECT 1 FROM projects.project_checks
                        WHERE project_id = CAST(:project_id AS uuid) AND organization_id = :org_id
                          AND check_type = :check_type AND check_name = :check_name
                    )
                    RETURNING id
                """),
                {
                    "project_id": str(project_id),
                    "org_id": org_id,
                    "check_name": field,
                    "check_type": PRE_MOBILISATION,
                    "evidence": evidence_ref or "",
                },
            )
            if inserted.first():
                return f"pre-mobilisation check '{field}'"
        return None

    if target_type == COMMERCIAL_READINESS:
        # Imported here: routers.projects imports app.shared modules at load.
        from routers.projects import (
            COMMERCIAL_READINESS_CONTROLS,
            _commercial_readiness_blockers,
            _commercial_readiness_status,
            _normalize_commercial_readiness_pack,
        )

        if field not in COMMERCIAL_READINESS_CONTROLS:
            return None
        row = (
            await db.execute(
                text("""
                    SELECT commercial_readiness_pack, commercial_readiness_status
                    FROM projects.project_profiles
                    WHERE project_id = CAST(:project_id AS uuid) AND organization_id = :org_id
                    FOR UPDATE
                """),
                {"project_id": str(project_id), "org_id": org_id},
            )
        ).mappings().first()
        if not row:
            return None
        raw_pack = row["commercial_readiness_pack"]
        if isinstance(raw_pack, str):
            raw_pack = json.loads(raw_pack or "{}")
        pack = _normalize_commercial_readiness_pack(raw_pack)
        if bool(pack.get(field)) == completed:
            return None
        pack[field] = completed
        blockers = _commercial_readiness_blockers(pack)
        # Unticking a control un-clears a cleared project.
        current_status = row["commercial_readiness_status"] if completed else None
        status = _commercial_readiness_status(pack, blockers, current_status)
        await db.execute(
            text("""
                UPDATE projects.project_profiles
                SET commercial_readiness_pack = CAST(:pack AS jsonb),
                    commercial_readiness_blockers = CAST(:blockers AS jsonb),
                    commercial_readiness_status = :status,
                    updated_at = NOW()
                WHERE project_id = CAST(:project_id AS uuid) AND organization_id = :org_id
            """),
            {
                "pack": json.dumps(pack, default=str),
                "blockers": json.dumps(blockers, default=str),
                "status": status,
                "project_id": str(project_id),
                "org_id": org_id,
            },
        )
        return f"commercial readiness control '{field}'"
    return None


async def sync_tasks_from_gate(
    db: AsyncSession,
    *,
    org_id: str,
    project_id: str,
    target_type: str,
    field: str,
    done: bool,
    evidence_ref: Optional[str],
    user_id: Optional[str],
) -> int:
    """Gate ticked/unticked on the project -> complete/reopen its linked
    tasks. Returns how many tasks changed."""
    if done:
        result = await db.execute(
            text("""
                UPDATE crm.tasks
                SET status = 'completed',
                    completed_at = NOW(),
                    evidence_ref = COALESCE(NULLIF(:evidence, ''), evidence_ref, 'Project gate ticked'),
                    evidence_status = 'accepted',
                    review_status = 'accepted',
                    verified_by_user_id = CAST(:user_id AS uuid),
                    verified_at = NOW(),
                    contribution_percent = weight,
                    outcome = COALESCE(outcome, 'Completed via the project gate'),
                    updated_at = NOW()
                WHERE organization_id = :org_id
                  AND contribution_target_id = CAST(:project_id AS uuid)
                  AND contribution_target_type = :target_type
                  AND contribution_target_field = :field
                  AND is_deleted = false
                  AND status NOT IN ('completed', 'cancelled', 'superseded', 'not_applicable')
                RETURNING id
            """),
            {
                "evidence": evidence_ref or "",
                "user_id": user_id,
                "org_id": org_id,
                "project_id": str(project_id),
                "target_type": target_type,
                "field": field,
            },
        )
    else:
        result = await db.execute(
            text("""
                UPDATE crm.tasks
                SET status = 'not_started',
                    completed_at = NULL,
                    verified_by_user_id = NULL,
                    verified_at = NULL,
                    evidence_status = CASE WHEN evidence_required THEN 'not_submitted' ELSE 'not_required' END,
                    review_status = CASE WHEN approver_user_id IS NOT NULL THEN 'not_submitted' ELSE 'not_required' END,
                    contribution_percent = 0,
                    updated_at = NOW()
                WHERE organization_id = :org_id
                  AND contribution_target_id = CAST(:project_id AS uuid)
                  AND contribution_target_type = :target_type
                  AND contribution_target_field = :field
                  AND is_deleted = false
                  AND status = 'completed'
                RETURNING id
            """),
            {
                "org_id": org_id,
                "project_id": str(project_id),
                "target_type": target_type,
                "field": field,
            },
        )
    return len(result.fetchall())


async def complete_stage_pack(
    db: AsyncSession,
    *,
    org_id: str,
    entity_type: str,
    entity_id: str,
    stage: str,
    evidence_ref: str,
    user_id: Optional[str],
) -> int:
    """Completes a stage pack's open tasks when the event they were driving
    toward has happened (e.g. deposit confirmed -> the deposit pack)."""
    result = await db.execute(
        text("""
            UPDATE crm.tasks t
            SET status = 'completed',
                completed_at = NOW(),
                evidence_ref = COALESCE(t.evidence_ref, :evidence),
                evidence_status = 'accepted',
                review_status = 'accepted',
                verified_by_user_id = CAST(:user_id AS uuid),
                verified_at = NOW(),
                contribution_percent = t.weight,
                updated_at = NOW()
            FROM crm.task_pack_instances p
            WHERE p.id = t.parent_pack_id
              AND lower(p.stage) = lower(:stage)
              AND t.organization_id = :org_id
              AND t.entity_type = :entity_type
              AND t.entity_id = CAST(:entity_id AS uuid)
              AND t.is_deleted = false
              AND t.status NOT IN ('completed', 'cancelled', 'superseded', 'not_applicable')
            RETURNING t.id
        """),
        {
            "evidence": evidence_ref,
            "user_id": user_id,
            "stage": stage,
            "org_id": org_id,
            "entity_type": entity_type,
            "entity_id": str(entity_id),
        },
    )
    return len(result.fetchall())
