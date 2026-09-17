"""Capability-based approvals over existing Core tables; caller owns the transaction."""

from uuid import UUID
from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from app.shared.events import emit_event
from app.shared.workforce_transactions import audit_action, canonical_json


class WorkflowService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def initiate_approval(
        self,
        *,
        user: dict,
        workflow_name: str,
        target_type: str,
        target_id: UUID,
        target_version: int,
        steps: list[str],
        subject_user_id: UUID | None = None,
        excluded_user_ids: list[UUID] | None = None,
    ) -> UUID:
        if not steps or len(steps) != len(set(steps)):
            raise ValueError("Approval requires distinct ordered capability steps")
        instance_id = (
            await self.db.execute(
                text("""
            INSERT INTO core.approval_instances(organization_id,workflow_key,target_type,target_id,
              target_version,submitted_by,metadata)
            VALUES(:org,:workflow,:type,:id,:version,:actor,CAST(:metadata AS jsonb)) RETURNING id
        """),
                {
                    "org": user["org_id"],
                    "workflow": workflow_name,
                    "type": target_type,
                    "id": target_id,
                    "version": target_version,
                    "actor": user["user_id"],
                    "metadata": canonical_json({"subject_user_id": subject_user_id, "excluded_user_ids": excluded_user_ids or []}),
                },
            )
        ).scalar_one()
        for number, capability in enumerate(steps, 1):
            await self.db.execute(
                text("""
                INSERT INTO core.approval_steps(organization_id,approval_instance_id,step_number,permission_key)
                VALUES(:org,:instance,:number,:permission)
            """),
                {
                    "org": user["org_id"],
                    "instance": instance_id,
                    "number": number,
                    "permission": capability,
                },
            )
        return instance_id

    async def decide(
        self,
        *,
        user: dict,
        permissions: set[str],
        instance_id: UUID,
        target_version: int,
        decision: str,
        reason: str,
    ) -> dict:
        if decision not in ("approved", "rejected") or not reason.strip():
            raise HTTPException(422, "A valid decision and reason are required")
        instance = (
            (
                await self.db.execute(
                    text("""
            SELECT * FROM core.approval_instances WHERE id=:id AND organization_id=:org
              AND is_deleted=false FOR UPDATE
        """),
                    {"id": instance_id, "org": user["org_id"]},
                )
            )
            .mappings()
            .first()
        )
        if not instance:
            raise HTTPException(404, "Approval not found")
        if (
            instance["status"] != "pending"
            or instance["target_version"] != target_version
        ):
            raise HTTPException(
                409, "Approval is closed or references a different target version"
            )
        actor = str(user["user_id"])
        if actor in (
            str(instance["submitted_by"]),
            str(instance["metadata"].get("subject_user_id")),
        ) or actor in {str(value) for value in instance["metadata"].get("excluded_user_ids", [])}:
            raise HTTPException(
                403, "The originator and subject cannot approve their own evidence"
            )
        previous = (
            await self.db.execute(
                text("""
            SELECT 1 FROM core.approval_decisions WHERE organization_id=:org
              AND approval_instance_id=:id AND actor_id=:actor
        """),
                {"org": user["org_id"], "id": instance_id, "actor": actor},
            )
        ).scalar()
        if previous:
            raise HTTPException(
                403, "A different reviewer must complete this approval stage"
            )
        step = (
            (
                await self.db.execute(
                    text("""
            SELECT * FROM core.approval_steps WHERE organization_id=:org
              AND approval_instance_id=:id AND status='pending' ORDER BY step_number LIMIT 1 FOR UPDATE
        """),
                    {"org": user["org_id"], "id": instance_id},
                )
            )
            .mappings()
            .first()
        )
        if not step or step["permission_key"] not in permissions:
            raise HTTPException(
                403, "The pending approval stage is not assigned to your capabilities"
            )
        params = {
            "org": user["org_id"],
            "id": instance_id,
            "actor": actor,
            "number": step["step_number"],
            "decision": decision,
            "reason": reason.strip(),
            "version": target_version,
        }
        await self.db.execute(
            text("""
            INSERT INTO core.approval_decisions(organization_id,approval_instance_id,step_number,
              actor_id,decision,reason,target_version) VALUES(:org,:id,:number,:actor,:decision,:reason,:version)
        """),
            params,
        )
        await self.db.execute(
            text("""
            UPDATE core.approval_steps SET status=:decision,decided_by=:actor,decided_at=now(),reason=:reason
            WHERE organization_id=:org AND approval_instance_id=:id AND step_number=:number
        """),
            params,
        )
        remaining = (
            await self.db.execute(
                text(
                    "SELECT count(*) FROM core.approval_steps WHERE organization_id=:org AND approval_instance_id=:id AND status='pending'"
                ),
                params,
            )
        ).scalar()
        state = (
            "rejected"
            if decision == "rejected"
            else ("pending" if remaining else "approved")
        )
        if state != "pending":
            await self.db.execute(
                text("""
                UPDATE core.approval_instances SET status=:state,decided_by=:actor,decided_at=now(),decision_reason=:reason
                WHERE id=:id AND organization_id=:org
            """),
                {**params, "state": state},
            )
        await audit_action(
            self.db,
            user,
            "core.approval_instances",
            instance_id,
            "APPROVAL_DECISION",
            {
                "step": step["step_number"],
                "decision": decision,
                "reason": reason,
                "target_version": target_version,
            },
        )
        await emit_event(
            self.db,
            user=user,
            event_type="approval.decision_recorded.v1",
            aggregate_type="approval_instance",
            aggregate_id=instance_id,
            idempotency_suffix=str(step["step_number"]),
            event_data={
                "decision": decision,
                "target_id": str(instance["target_id"]),
                "target_version": target_version,
            },
        )
        return {
            "id": str(instance_id),
            "status": state,
            "target_id": str(instance["target_id"]),
        }
