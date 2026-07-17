"""Disposable smoke test for Workforce -> Compliance deployment gating.

Uses the live configured database and FastAPI app. It does not create Supabase
Auth users; it validates through the existing ashton@admin.com core SUPERADMIN
by overriding only token verification.

Run from imperium-api:
    python scripts/smoke_workforce_compliance_gate.py
"""

from __future__ import annotations

import asyncio
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
import secrets
import sys
from typing import Awaitable, Callable

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import asyncpg
from fastapi.testclient import TestClient

from core.config import settings
from core import security
from main import app


ASHTON_EMAIL = "ashton@admin.com"
ORG_ID = "00000000-0000-0000-0000-000000000001"
ids: dict[str, str] = {}


def _db_url() -> str:
    return settings.DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://", 1)


async def _conn_exec(fn: Callable[[asyncpg.Connection], Awaitable[object]]) -> object:
    conn = await asyncpg.connect(_db_url(), statement_cache_size=0)
    try:
        return await fn(conn)
    finally:
        await conn.close()


async def _setup_records() -> str:
    suffix = secrets.token_hex(5).upper()

    async def run(conn: asyncpg.Connection) -> str:
        ashton = await conn.fetchrow(
            """
            SELECT u.id::text AS id, u.organization_id::text AS organization_id
            FROM core.users u
            JOIN core.user_roles ur ON ur.user_id = u.id AND ur.organization_id = u.organization_id
            JOIN core.roles r ON r.id = ur.role_id AND r.organization_id = u.organization_id
            WHERE lower(u.email) = $1
              AND u.is_active = true
              AND u.is_deleted = false
              AND r.name = 'SUPERADMIN'
              AND r.is_deleted = false
            """,
            ASHTON_EMAIL,
        )
        if not ashton:
            raise RuntimeError(f"{ASHTON_EMAIL} is not an active core SUPERADMIN")
        if ashton["organization_id"] != ORG_ID:
            raise RuntimeError(
                f"{ASHTON_EMAIL} organization mismatch: {ashton['organization_id']}"
            )

        project_id = await conn.fetchval(
            """
            INSERT INTO projects.projects (
                organization_id, created_by, name, status, project_code,
                project_type, client_name, contract_value
            )
            VALUES ($1::uuid, $2::uuid, $3, 'active', $4, 'Smoke Test', 'Codex QA', 5000)
            RETURNING id::text
            """,
            ORG_ID,
            ashton["id"],
            f"Codex Workforce Compliance Smoke {suffix}",
            f"WCGATE-{suffix}",
        )
        employee_id = await conn.fetchval(
            """
            INSERT INTO hr.employees (
                organization_id, created_by, employee_name, job_title,
                employee_number, employment_status
            )
            VALUES ($1::uuid, $2::uuid, $3, 'Equipment Operator', $4, 'active')
            RETURNING id::text
            """,
            ORG_ID,
            ashton["id"],
            f"Smoke Operator {suffix}",
            f"WCG-{suffix}",
        )
        fleet_id = await conn.fetchval(
            """
            INSERT INTO fleet.fleet (
                organization_id, created_by, vehicle_registration, vehicle_type,
                asset_code, ownership_type, operational_status
            )
            VALUES ($1::uuid, $2::uuid, $3, 'Loader', $4, 'owned', 'available')
            RETURNING id::text
            """,
            ORG_ID,
            ashton["id"],
            f"WCG-{suffix}",
            f"LOAD-WCG-{suffix}",
        )
        operator_req_id = await conn.fetchval(
            """
            INSERT INTO compliance.deployment_requirements (
                organization_id, requirement_scope, equipment_type,
                certification_name, required_verification_status, warning_days, created_by
            )
            VALUES ($1::uuid, 'equipment_assignment', 'Loader', 'Operator Certificate', 'verified', 30, $2::uuid)
            RETURNING id::text
            """,
            ORG_ID,
            ashton["id"],
        )
        induction_req_id = await conn.fetchval(
            """
            INSERT INTO compliance.deployment_requirements (
                organization_id, requirement_scope, target_role,
                certification_name, required_verification_status, warning_days, created_by
            )
            VALUES ($1::uuid, 'workforce_project_allocation', 'Site Agent', 'Site Induction', 'verified', 30, $2::uuid)
            RETURNING id::text
            """,
            ORG_ID,
            ashton["id"],
        )
        ids.update(
            {
                "user_id": ashton["id"],
                "project_id": project_id,
                "employee_id": employee_id,
                "fleet_id": fleet_id,
                "operator_req_id": operator_req_id,
                "induction_req_id": induction_req_id,
            }
        )
        return suffix

    return str(await _conn_exec(run))


def _client() -> TestClient:
    def fake_verify_token() -> dict[str, object]:
        return {
            "sub": ids["user_id"],
            "email": ASHTON_EMAIL,
            "app_metadata": {"org_id": ORG_ID, "role": "SUPERADMIN"},
            "user_metadata": {},
            "role": "authenticated",
        }

    app.dependency_overrides[security.verify_token] = fake_verify_token
    return TestClient(app)


def _post(
    client: TestClient, path: str, payload: dict[str, object], expected: int = 201
) -> dict[str, object]:
    response = client.post(path, json=payload)
    if response.status_code != expected:
        raise RuntimeError(
            f"POST {path} expected {expected}, got {response.status_code}: {response.text}"
        )
    body = response.json()
    return body.get("data", body)


async def _add_certification(name: str, expires_on: date) -> str:
    async def run(conn: asyncpg.Connection) -> str:
        return await conn.fetchval(
            """
            INSERT INTO hr.employee_certifications (
                organization_id, employee_id, certification_name, issuing_authority,
                certificate_number, issued_on, expires_on, verification_status, created_by
            )
            VALUES ($1::uuid, $2::uuid, $3, 'Codex QA', $4, $5::date, $6::date, 'verified', $7::uuid)
            RETURNING id::text
            """,
            ORG_ID,
            ids["employee_id"],
            name,
            f"{name.upper().replace(' ', '-')}-{secrets.token_hex(3).upper()}",
            date.today() - timedelta(days=10),
            expires_on,
            ids["user_id"],
        )

    return str(await _conn_exec(run))


def _run_api_flow() -> None:
    with _client() as client:
        blocked_assignment = _post(
            client,
            "/api/v1/fleet/assignments",
            {
                "fleet_id": ids["fleet_id"],
                "project_id": ids["project_id"],
                "operator_employee_id": ids["employee_id"],
                "starts_at": datetime.now(timezone.utc).isoformat(),
                "status": "active",
                "dispatch_reference": "WCGATE-BLOCKED",
                "purpose": "Blocked smoke assignment",
            },
            expected=409,
        )
        if "missing_requirements" not in str(blocked_assignment):
            raise AssertionError(
                f"blocked assignment did not include missing requirements: {blocked_assignment}"
            )


async def _run_pass_flows() -> None:
    await _add_certification("Operator Certificate", date.today() + timedelta(days=365))
    with _client() as client:
        assignment = _post(
            client,
            "/api/v1/fleet/assignments",
            {
                "fleet_id": ids["fleet_id"],
                "project_id": ids["project_id"],
                "operator_employee_id": ids["employee_id"],
                "starts_at": datetime.now(timezone.utc).isoformat(),
                "status": "active",
                "dispatch_reference": "WCGATE-PASS",
                "purpose": "Passed smoke assignment",
            },
        )
        ids["assignment_id"] = assignment["id"]
        ids["assignment_gate_id"] = assignment.get("compliance_gate_check_id") or ""

        _post(
            client,
            "/api/v1/workforce/allocations",
            {
                "employee_id": ids["employee_id"],
                "project_id": ids["project_id"],
                "role_on_project": "Site Agent",
                "allocation_percent": "25.00",
                "starts_on": date.today().isoformat(),
                "ends_on": (date.today() + timedelta(days=30)).isoformat(),
                "status": "active",
                "notes": "Blocked allocation smoke",
            },
            expected=409,
        )

    await _add_certification("Site Induction", date.today() + timedelta(days=180))
    with _client() as client:
        allocation = _post(
            client,
            "/api/v1/workforce/allocations",
            {
                "employee_id": ids["employee_id"],
                "project_id": ids["project_id"],
                "role_on_project": "Site Agent",
                "allocation_percent": "25.00",
                "starts_on": date.today().isoformat(),
                "ends_on": (date.today() + timedelta(days=30)).isoformat(),
                "status": "active",
                "notes": "Passed allocation smoke",
            },
        )
        ids["allocation_id"] = allocation["id"]
        ids["allocation_gate_id"] = allocation.get("compliance_gate_check_id") or ""


async def _verify() -> dict[str, object]:
    async def run(conn: asyncpg.Connection) -> dict[str, object]:
        row = await conn.fetchrow(
            """
            SELECT
              (SELECT COUNT(*) FROM compliance.deployment_gate_checks WHERE organization_id=$1::uuid AND project_id=$2::uuid AND status='blocked') AS blocked_checks,
              (SELECT COUNT(*) FROM compliance.deployment_gate_checks WHERE organization_id=$1::uuid AND project_id=$2::uuid AND status='passed') AS passed_checks,
              (SELECT compliance_gate_check_id::text FROM fleet.fleet_assignments WHERE id=$3::uuid) AS assignment_gate_id,
              (SELECT operator_employee_id::text FROM fleet.fleet_assignments WHERE id=$3::uuid) AS operator_employee_id,
              (SELECT compliance_status FROM hr.project_allocations WHERE id=$4::uuid) AS allocation_compliance_status,
              (SELECT compliance_gate_check_id::text FROM hr.project_allocations WHERE id=$4::uuid) AS allocation_gate_id,
              (SELECT COUNT(*) FROM core.domain_events WHERE organization_id=$1::uuid AND project_id=$2::uuid AND event_type LIKE 'compliance.deployment_%') AS compliance_event_count
            """,
            ORG_ID,
            ids["project_id"],
            ids["assignment_id"],
            ids["allocation_id"],
        )
        return dict(row)

    result = dict(await _conn_exec(run))
    if int(result["blocked_checks"]) < 2:
        raise AssertionError(
            f"expected at least 2 blocked checks, got {result['blocked_checks']}"
        )
    if int(result["passed_checks"]) < 2:
        raise AssertionError(
            f"expected at least 2 passed checks, got {result['passed_checks']}"
        )
    if result["operator_employee_id"] != ids["employee_id"]:
        raise AssertionError("assignment operator was not linked")
    if result["allocation_compliance_status"] != "passed":
        raise AssertionError(
            f"allocation compliance status was {result['allocation_compliance_status']}"
        )
    if int(result["compliance_event_count"]) < 4:
        raise AssertionError(
            f"expected compliance events, got {result['compliance_event_count']}"
        )
    return result


async def _cleanup() -> None:
    async def run(conn: asyncpg.Connection) -> None:
        pids = [ids.get("project_id")] if ids.get("project_id") else []
        fids = [ids.get("fleet_id")] if ids.get("fleet_id") else []
        eids = [ids.get("employee_id")] if ids.get("employee_id") else []
        if fids:
            await conn.execute(
                "UPDATE fleet.fleet SET current_assignment_id=NULL, current_project_id=NULL WHERE id = ANY($1::uuid[])",
                fids,
            )
        if ids.get("assignment_id"):
            await conn.execute(
                "DELETE FROM fleet.fleet_assignments WHERE id=$1::uuid",
                ids["assignment_id"],
            )
        if ids.get("allocation_id"):
            await conn.execute(
                "DELETE FROM hr.project_allocations WHERE id=$1::uuid",
                ids["allocation_id"],
            )
        await conn.execute(
            "DELETE FROM fleet.fleet_assignments WHERE fleet_id = ANY($1::uuid[]) AND dispatch_reference LIKE 'WCGATE-%'",
            fids,
        )
        await conn.execute(
            "DELETE FROM hr.project_allocations WHERE employee_id = ANY($1::uuid[]) AND notes LIKE '%allocation smoke%'",
            eids,
        )
        await conn.execute(
            "DELETE FROM core.domain_events WHERE project_id = ANY($1::uuid[]) OR aggregate_id IN (SELECT id FROM compliance.deployment_gate_checks WHERE project_id = ANY($1::uuid[]))",
            pids,
        )
        await conn.execute(
            "DELETE FROM compliance.deployment_gate_checks WHERE project_id = ANY($1::uuid[])",
            pids,
        )
        await conn.execute(
            "DELETE FROM compliance.deployment_requirements WHERE id IN ($1::uuid, $2::uuid)",
            ids.get("operator_req_id"),
            ids.get("induction_req_id"),
        )
        await conn.execute(
            "DELETE FROM hr.employee_certifications WHERE employee_id = ANY($1::uuid[])",
            eids,
        )
        await conn.execute("DELETE FROM fleet.fleet WHERE id = ANY($1::uuid[])", fids)
        await conn.execute("DELETE FROM hr.employees WHERE id = ANY($1::uuid[])", eids)
        await conn.execute(
            "DELETE FROM projects.projects WHERE id = ANY($1::uuid[])", pids
        )

    await _conn_exec(run)


async def main() -> None:
    try:
        await _setup_records()
        _run_api_flow()
        await _run_pass_flows()
        verification = await _verify()
        print("workforce_compliance_gate_smoke=passed")
        for key, value in verification.items():
            print(f"{key}={value}")
    finally:
        await _cleanup()
        app.dependency_overrides.clear()


if __name__ == "__main__":
    asyncio.run(main())
