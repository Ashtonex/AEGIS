"""Shared compliance gate checks for employee and equipment deployment."""

from __future__ import annotations

from datetime import date
import json
from typing import Any, Optional
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def emit_domain_event(
    db: AsyncSession,
    *,
    user: dict[str, Any],
    event_type: str,
    aggregate_type: str,
    aggregate_id: UUID,
    project_id: Optional[UUID],
    payload_json: str,
) -> None:
    await db.execute(
        text(
            """
            INSERT INTO core.domain_events (
                organization_id, event_type, schema_version, aggregate_type, aggregate_id,
                project_id, actor_id, idempotency_key, payload
            ) VALUES (
                :org_id, :event_type, 1, :aggregate_type, :aggregate_id,
                :project_id, :actor_id, :idempotency_key, CAST(:payload AS jsonb)
            ) ON CONFLICT (organization_id, idempotency_key) DO NOTHING
            """
        ),
        {
            "org_id": user["org_id"],
            "event_type": event_type,
            "aggregate_type": aggregate_type,
            "aggregate_id": aggregate_id,
            "project_id": project_id,
            "actor_id": user["user_id"],
            "idempotency_key": f"{event_type}:{aggregate_type}:{aggregate_id}",
            "payload": payload_json,
        },
    )


async def validate_employee_deployment(
    db: AsyncSession,
    *,
    user: dict[str, Any],
    employee_id: UUID,
    gate_type: str,
    project_id: Optional[UUID],
    effective_date: date,
    role_on_project: Optional[str] = None,
    fleet_id: Optional[UUID] = None,
    equipment_type: Optional[str] = None,
    source_type: str,
    source_id: Optional[UUID] = None,
) -> UUID:
    """Validate employment status and required verified certifications.

    A blocked check is persisted before raising HTTP 409 so compliance failures
    remain auditable.
    """

    employee = (
        (
            await db.execute(
                text(
                    """
                SELECT id, employee_name, employment_status
                FROM hr.employees
                WHERE id=:employee_id
                  AND organization_id=:org_id
                  AND is_deleted=false
                """
                ),
                {"employee_id": employee_id, "org_id": user["org_id"]},
            )
        )
        .mappings()
        .first()
    )
    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found")

    missing: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []
    if employee["employment_status"] != "active":
        missing.append(
            {
                "requirement": "active_employment",
                "reason": f"Employee status is {employee['employment_status']}",
            }
        )

    requirements = (
        (
            await db.execute(
                text(
                    """
                SELECT id, certification_name, requirement_scope, target_role,
                       equipment_type, warning_days, required_verification_status
                FROM compliance.deployment_requirements
                WHERE organization_id=:org_id
                  AND is_active=true
                  AND requirement_scope IN (:gate_type, 'all_deployments')
                  AND (project_id IS NULL OR project_id=:project_id)
                  AND (target_role IS NULL OR lower(target_role)=lower(COALESCE(:role_on_project, target_role)))
                  AND (equipment_type IS NULL OR lower(equipment_type)=lower(COALESCE(:equipment_type, equipment_type)))
                ORDER BY certification_name
                """
                ),
                {
                    "org_id": user["org_id"],
                    "gate_type": gate_type,
                    "project_id": project_id,
                    "role_on_project": role_on_project,
                    "equipment_type": equipment_type,
                },
            )
        )
        .mappings()
        .all()
    )

    for requirement in requirements:
        cert = (
            (
                await db.execute(
                    text(
                        """
                    SELECT id, certification_name, verification_status, expires_on
                    FROM hr.employee_certifications
                    WHERE organization_id=:org_id
                      AND employee_id=:employee_id
                      AND is_deleted=false
                      AND lower(certification_name)=lower(:certification_name)
                    ORDER BY expires_on DESC NULLS FIRST, created_at DESC
                    LIMIT 1
                    """
                    ),
                    {
                        "org_id": user["org_id"],
                        "employee_id": employee_id,
                        "certification_name": requirement["certification_name"],
                    },
                )
            )
            .mappings()
            .first()
        )
        if not cert:
            missing.append(
                {
                    "requirement_id": str(requirement["id"]),
                    "certification_name": requirement["certification_name"],
                    "reason": "missing",
                }
            )
            continue
        if cert["verification_status"] != requirement["required_verification_status"]:
            missing.append(
                {
                    "requirement_id": str(requirement["id"]),
                    "certification_name": requirement["certification_name"],
                    "reason": f"verification_status:{cert['verification_status']}",
                }
            )
            continue
        if cert["expires_on"] is not None and cert["expires_on"] < effective_date:
            missing.append(
                {
                    "requirement_id": str(requirement["id"]),
                    "certification_name": requirement["certification_name"],
                    "reason": f"expired:{cert['expires_on']}",
                }
            )
            continue
        if cert["expires_on"] is not None:
            days_to_expiry = (cert["expires_on"] - effective_date).days
            if days_to_expiry <= int(requirement["warning_days"] or 0):
                warnings.append(
                    {
                        "requirement_id": str(requirement["id"]),
                        "certification_name": requirement["certification_name"],
                        "expires_on": str(cert["expires_on"]),
                        "days_to_expiry": days_to_expiry,
                    }
                )

    status = "blocked" if missing else "passed"
    check = await db.execute(
        text(
            """
            INSERT INTO compliance.deployment_gate_checks (
                organization_id, gate_type, subject_employee_id, fleet_id, project_id,
                source_type, source_id, status, missing_requirements, warnings,
                checked_by
            ) VALUES (
                :org_id, :gate_type, :employee_id, :fleet_id, :project_id,
                :source_type, :source_id, :status, CAST(:missing AS jsonb),
                CAST(:warnings AS jsonb), :user_id
            )
            RETURNING id
            """
        ),
        {
            "org_id": user["org_id"],
            "gate_type": gate_type,
            "employee_id": employee_id,
            "fleet_id": fleet_id,
            "project_id": project_id,
            "source_type": source_type,
            "source_id": source_id,
            "status": status,
            "missing": json.dumps(missing),
            "warnings": json.dumps(warnings),
            "user_id": user["user_id"],
        },
    )
    check_id = check.scalar()

    await emit_domain_event(
        db,
        user=user,
        event_type="compliance.deployment_blocked.v1"
        if missing
        else "compliance.deployment_cleared.v1",
        aggregate_type="deployment_gate_check",
        aggregate_id=check_id,
        project_id=project_id,
        payload_json=json.dumps(
            {
                "gate_type": gate_type,
                "employee_id": str(employee_id),
                "fleet_id": str(fleet_id) if fleet_id else None,
                "project_id": str(project_id) if project_id else None,
                "source_type": source_type,
                "source_id": str(source_id) if source_id else None,
                "status": status,
                "missing_requirements": missing,
                "warnings": warnings,
            }
        ),
    )

    if missing:
        await db.commit()
        raise HTTPException(
            status_code=409,
            detail={
                "message": "Compliance gate blocked deployment.",
                "gate_check_id": str(check_id),
                "missing_requirements": missing,
                "warnings": warnings,
            },
        )
    return check_id
