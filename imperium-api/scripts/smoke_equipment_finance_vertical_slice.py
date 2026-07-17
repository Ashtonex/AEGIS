"""Disposable smoke test for the AEGIS Equipment -> Finance vertical slice.

Uses the live configured Postgres database and the FastAPI app, but does not
create Supabase Auth users. The only SUPERADMIN is the existing
ashton@admin.com account; this smoke verifies that account through the app's
normal core role resolution by overriding only token verification.

Run from imperium-api:
    python scripts/smoke_equipment_finance_vertical_slice.py
"""

from __future__ import annotations

import asyncio
from datetime import date, datetime, timezone
from decimal import Decimal
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
            VALUES ($1::uuid, $2::uuid, $3, 'active', $4, 'Smoke Test', 'Codex QA', 10000)
            RETURNING id::text
            """,
            ORG_ID,
            ashton["id"],
            f"Codex Equipment Finance Smoke {suffix}",
            f"EQFIN-{suffix}",
        )
        fleet_id = await conn.fetchval(
            """
            INSERT INTO fleet.fleet (
                organization_id, created_by, vehicle_registration, vehicle_type,
                asset_code, ownership_type, operational_status,
                hourly_charge_rate, hourly_operating_cost, idle_hour_cost, monthly_ownership_cost
            )
            VALUES (
                $1::uuid, $2::uuid, $3, 'Loader', $4, 'owned', 'available',
                125.00, 60.00, 15.00, 1500.00
            )
            RETURNING id::text
            """,
            ORG_ID,
            ashton["id"],
            f"EQF-{suffix}",
            f"PLANT-EQF-{suffix}",
        )

        ids.update(
            {"user_id": ashton["id"], "project_id": project_id, "fleet_id": fleet_id}
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
    client: TestClient, path: str, payload: dict[str, object]
) -> dict[str, object]:
    response = client.post(path, json=payload)
    if response.status_code >= 400:
        raise RuntimeError(
            f"POST {path} failed {response.status_code}: {response.text}"
        )
    body = response.json()
    return body.get("data", body)


def _patch(
    client: TestClient, path: str, payload: dict[str, object]
) -> dict[str, object]:
    response = client.patch(path, json=payload)
    if response.status_code >= 400:
        raise RuntimeError(
            f"PATCH {path} failed {response.status_code}: {response.text}"
        )
    body = response.json()
    return body.get("data", body)


def _run_api_flow() -> None:
    with _client() as client:
        assignment = _post(
            client,
            "/api/v1/fleet/assignments",
            {
                "fleet_id": ids["fleet_id"],
                "project_id": ids["project_id"],
                "starts_at": datetime.now(timezone.utc).isoformat(),
                "status": "active",
                "dispatch_reference": "EQFIN-SMOKE",
                "purpose": "Equipment to finance smoke test",
            },
        )
        ids["assignment_id"] = assignment["id"]

        utilization = _post(
            client,
            "/api/v1/fleet/utilization",
            {
                "fleet_id": ids["fleet_id"],
                "assignment_id": ids["assignment_id"],
                "occurred_on": date.today().isoformat(),
                "operating_hours": "5.00",
                "idle_hours": "1.00",
                "distance_km": "42.00",
                "odometer_km": "42.00",
                "engine_hours": "5.00",
                "notes": "Smoke utilization",
            },
        )
        ids["utilization_id"] = utilization["id"]

        fuel = _post(
            client,
            "/api/v1/fleet/fuel",
            {
                "fleet_id": ids["fleet_id"],
                "assignment_id": ids["assignment_id"],
                "fuel_type": "diesel",
                "quantity_litres": "40.000",
                "unit_cost": "1.5000",
                "supplier_name": "Smoke Fuel Supplier",
                "receipt_reference": "EQFIN-FUEL-SMOKE",
            },
        )
        ids["fuel_id"] = fuel["id"]

        defect = _post(
            client,
            f"/api/v1/fleet/{ids['fleet_id']}/defects",
            {
                "fleet_id": ids["fleet_id"],
                "title": "Smoke hydraulic leak",
                "severity": "high",
                "description": "Smoke defect for maintenance costing",
                "defect_reference": "EQFIN-DEFECT-SMOKE",
            },
        )
        ids["defect_id"] = defect["id"]

        work_order = _post(
            client,
            "/api/v1/fleet/work-orders",
            {
                "fleet_id": ids["fleet_id"],
                "defect_id": ids["defect_id"],
                "work_order_number": f"WO-EQFIN-{secrets.token_hex(4).upper()}",
                "maintenance_type": "corrective",
                "priority": "high",
                "vendor_name": "Smoke Maintenance Vendor",
                "estimated_cost": "250.00",
                "description": "Smoke maintenance work order",
            },
        )
        ids["work_order_id"] = work_order["id"]

        _patch(
            client,
            f"/api/v1/fleet/work-orders/{ids['work_order_id']}/decision",
            {
                "status": "completed",
                "actual_cost": "250.00",
                "completion_notes": "Smoke work completed",
            },
        )


async def _verify() -> dict[str, object]:
    async def run(conn: asyncpg.Connection) -> dict[str, object]:
        row = await conn.fetchrow(
            """
            SELECT
              (SELECT current_project_id::text FROM fleet.fleet WHERE id=$1::uuid) AS current_project_id,
              (SELECT current_assignment_id::text FROM fleet.fleet WHERE id=$1::uuid) AS current_assignment_id,
              (SELECT operational_status FROM fleet.fleet WHERE id=$1::uuid) AS operational_status,
              (SELECT project_id::text FROM fleet.utilization_logs WHERE id=$2::uuid) AS utilization_project_id,
              (SELECT revenue_amount FROM fleet.utilization_logs WHERE id=$2::uuid) AS utilization_revenue,
              (SELECT cost_amount FROM fleet.utilization_logs WHERE id=$2::uuid) AS utilization_cost,
              (SELECT project_id::text FROM fleet.fuel_transactions WHERE id=$3::uuid) AS fuel_project_id,
              (SELECT total_cost FROM fleet.fuel_transactions WHERE id=$3::uuid) AS fuel_cost,
              (SELECT project_id::text FROM fleet.maintenance_work_orders WHERE id=$4::uuid) AS maintenance_project_id,
              (SELECT actual_cost FROM fleet.maintenance_work_orders WHERE id=$4::uuid) AS maintenance_cost,
              (SELECT COUNT(*) FROM finance.cost_transactions WHERE project_id=$5::uuid AND source_id IN ($2::uuid, $3::uuid, $4::uuid)) AS finance_cost_count,
              (SELECT COALESCE(SUM(amount), 0) FROM finance.cost_transactions WHERE project_id=$5::uuid AND source_id IN ($2::uuid, $3::uuid, $4::uuid)) AS finance_cost_total,
              (SELECT COUNT(*) FROM core.domain_events WHERE organization_id=$6::uuid AND aggregate_id IN ($1::uuid, $2::uuid, $3::uuid, $4::uuid)) AS event_count
            """,
            ids["fleet_id"],
            ids["utilization_id"],
            ids["fuel_id"],
            ids["work_order_id"],
            ids["project_id"],
            ORG_ID,
        )
        return dict(row)

    result = dict(await _conn_exec(run))
    expected = {
        "current_project_id": ids["project_id"],
        "current_assignment_id": ids["assignment_id"],
        "utilization_project_id": ids["project_id"],
        "fuel_project_id": ids["project_id"],
        "maintenance_project_id": ids["project_id"],
    }
    for key, value in expected.items():
        if result.get(key) != value:
            raise AssertionError(f"{key} expected {value}, got {result.get(key)}")
    if Decimal(str(result["utilization_revenue"])) != Decimal("625.00"):
        raise AssertionError(
            f"unexpected utilization revenue: {result['utilization_revenue']}"
        )
    if Decimal(str(result["utilization_cost"])) != Decimal("315.00"):
        raise AssertionError(
            f"unexpected utilization cost: {result['utilization_cost']}"
        )
    if Decimal(str(result["fuel_cost"])) != Decimal("60.00"):
        raise AssertionError(f"unexpected fuel cost: {result['fuel_cost']}")
    if Decimal(str(result["maintenance_cost"])) != Decimal("250.00"):
        raise AssertionError(
            f"unexpected maintenance cost: {result['maintenance_cost']}"
        )
    if int(result["finance_cost_count"]) != 3:
        raise AssertionError(
            f"expected 3 finance cost transactions, got {result['finance_cost_count']}"
        )
    if Decimal(str(result["finance_cost_total"])) != Decimal("625.00"):
        raise AssertionError(
            f"unexpected finance cost total: {result['finance_cost_total']}"
        )
    if int(result["event_count"]) < 5:
        raise AssertionError(
            f"expected at least 5 domain events, got {result['event_count']}"
        )
    return result


async def _cleanup() -> None:
    async def run(conn: asyncpg.Connection) -> None:
        if ids.get("fleet_id") and not ids.get("assignment_id"):
            assignment_id = await conn.fetchval(
                """
                SELECT id::text
                FROM fleet.fleet_assignments
                WHERE organization_id=$1::uuid
                  AND fleet_id=$2::uuid
                  AND dispatch_reference='EQFIN-SMOKE'
                ORDER BY created_at DESC
                LIMIT 1
                """,
                ORG_ID,
                ids["fleet_id"],
            )
            if assignment_id:
                ids["assignment_id"] = assignment_id

        await conn.execute(
            """
            DELETE FROM core.domain_events
            WHERE organization_id=$1::uuid
              AND (
                aggregate_id = ANY($2::uuid[])
                OR project_id = $3::uuid
              )
            """,
            ORG_ID,
            [
                ids.get("fleet_id"),
                ids.get("assignment_id"),
                ids.get("utilization_id"),
                ids.get("fuel_id"),
                ids.get("defect_id"),
                ids.get("work_order_id"),
            ],
            ids.get("project_id"),
        )
        if ids.get("fleet_id"):
            await conn.execute(
                "UPDATE fleet.utilization_logs SET cost_transaction_id=NULL WHERE fleet_id=$1::uuid",
                ids.get("fleet_id"),
            )
            await conn.execute(
                "UPDATE fleet.fuel_transactions SET cost_transaction_id=NULL WHERE fleet_id=$1::uuid",
                ids.get("fleet_id"),
            )
            await conn.execute(
                "UPDATE fleet.maintenance_work_orders SET cost_transaction_id=NULL WHERE fleet_id=$1::uuid",
                ids.get("fleet_id"),
            )
        await conn.execute(
            "DELETE FROM fleet.maintenance_work_orders WHERE id=$1::uuid",
            ids.get("work_order_id"),
        )
        await conn.execute(
            "DELETE FROM fleet.fleet_defects WHERE id=$1::uuid", ids.get("defect_id")
        )
        await conn.execute(
            "DELETE FROM fleet.fuel_transactions WHERE id=$1::uuid", ids.get("fuel_id")
        )
        await conn.execute(
            "DELETE FROM fleet.utilization_logs WHERE id=$1::uuid",
            ids.get("utilization_id"),
        )
        await conn.execute(
            "DELETE FROM finance.cost_transactions WHERE project_id=$1::uuid",
            ids.get("project_id"),
        )
        if ids.get("fleet_id"):
            await conn.execute(
                "UPDATE fleet.fleet SET current_assignment_id=NULL, current_project_id=NULL WHERE id=$1::uuid",
                ids.get("fleet_id"),
            )
        if ids.get("assignment_id"):
            await conn.execute(
                "DELETE FROM fleet.fleet_assignments WHERE id=$1::uuid",
                ids.get("assignment_id"),
            )
        if ids.get("fleet_id"):
            await conn.execute(
                "DELETE FROM fleet.fleet_assignments WHERE organization_id=$1::uuid AND fleet_id=$2::uuid AND dispatch_reference='EQFIN-SMOKE'",
                ORG_ID,
                ids.get("fleet_id"),
            )
        await conn.execute(
            "DELETE FROM fleet.fleet WHERE id=$1::uuid", ids.get("fleet_id")
        )
        await conn.execute(
            "DELETE FROM projects.projects WHERE id=$1::uuid", ids.get("project_id")
        )

    await _conn_exec(run)


async def main() -> None:
    try:
        await _setup_records()
        _run_api_flow()
        verification = await _verify()
        print("equipment_finance_smoke=passed")
        for key, value in verification.items():
            print(f"{key}={value}")
    finally:
        await _cleanup()
        app.dependency_overrides.clear()


if __name__ == "__main__":
    asyncio.run(main())
