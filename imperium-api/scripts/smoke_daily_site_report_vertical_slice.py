"""Disposable end-to-end smoke test for the first AEGIS vertical slice.

This script uses the live configured Supabase/Postgres database and the running
FastAPI service. It creates temporary identities and operational records, drives
the Daily Site Report workflow through the API, verifies downstream cost/stock
event effects, and then removes the temporary data.

Run from imperium-api:
    python scripts/smoke_daily_site_report_vertical_slice.py

Optional:
    AEGIS_API_BASE=http://imperium-api:8000 python scripts/smoke_daily_site_report_vertical_slice.py
"""

from __future__ import annotations

import asyncio
from datetime import date
import os
from pathlib import Path
import secrets
import string
import sys
from typing import Awaitable, Callable

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import asyncpg
import httpx

from core.config import settings
from core.database import supabase


ORG_ID = "00000000-0000-0000-0000-000000000001"
SUPERADMIN_ROLE_ID = "00000000-0000-0000-0000-000000000002"
API_BASE = os.environ.get("AEGIS_API_BASE", "http://imperium-api:8000")


created_auth_ids: list[str] = []
ids: dict[str, object] = {}


def _db_url() -> str:
    return settings.DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://", 1)


def _password() -> str:
    chars = string.ascii_letters + string.digits
    return "Smoke-" + "".join(secrets.choice(chars) for _ in range(20)) + "!1"


async def _conn_exec(fn: Callable[[asyncpg.Connection], Awaitable[object]]) -> object:
    conn = await asyncpg.connect(_db_url(), statement_cache_size=0)
    try:
        return await fn(conn)
    finally:
        await conn.close()


async def _create_core_user(user_id: str, email: str) -> None:
    async def run(conn: asyncpg.Connection) -> None:
        await conn.execute(
            """
            INSERT INTO core.users (id, organization_id, email, full_name, is_active, is_deleted)
            VALUES ($1::uuid, $2::uuid, $3, 'Codex Smoke User', true, false)
            ON CONFLICT (id) DO UPDATE
            SET organization_id=EXCLUDED.organization_id,
                email=EXCLUDED.email,
                is_active=true,
                is_deleted=false
            """,
            user_id,
            ORG_ID,
            email,
        )
        await conn.execute(
            """
            INSERT INTO core.user_roles (user_id, role_id, organization_id)
            VALUES ($1::uuid, $2::uuid, $3::uuid)
            ON CONFLICT DO NOTHING
            """,
            user_id,
            SUPERADMIN_ROLE_ID,
            ORG_ID,
        )

    await _conn_exec(run)


async def _create_api_user(label: str) -> dict[str, object]:
    email = f"codex.{label}.{secrets.token_hex(6)}@gmail.com"
    password = _password()
    created = supabase.auth.admin.create_user(
        {
            "email": email,
            "password": password,
            "email_confirm": True,
            "user_metadata": {"full_name": f"Codex {label}"},
            "app_metadata": {"org_id": ORG_ID, "role": "SUPERADMIN"},
        }
    )
    user_id = created.user.id
    created_auth_ids.append(user_id)
    await _create_core_user(user_id, email)
    signin = supabase.auth.sign_in_with_password({"email": email, "password": password})
    return {
        "id": user_id,
        "headers": {"Authorization": f"Bearer {signin.session.access_token}"},
    }


async def _setup_shared_records(created_by: str) -> str:
    suffix = secrets.token_hex(5).upper()

    async def run(conn: asyncpg.Connection) -> str:
        project_id = await conn.fetchval(
            """
            INSERT INTO projects.projects (
                organization_id, created_by, name, status, project_code,
                project_type, client_name, contract_value
            )
            VALUES ($1::uuid, $2::uuid, $3, 'active', $4, 'Smoke Test', 'Codex QA', 1000)
            RETURNING id::text
            """,
            ORG_ID,
            created_by,
            f"Codex Smoke Project {suffix}",
            f"SMOKE-{suffix}",
        )
        employee_id = await conn.fetchval(
            """
            INSERT INTO hr.employees (
                organization_id, created_by, employee_name, job_title,
                employee_number, employment_status
            )
            VALUES ($1::uuid, $2::uuid, $3, 'Operator', $4, 'active')
            RETURNING id::text
            """,
            ORG_ID,
            created_by,
            f"Smoke Operator {suffix}",
            f"EMP-{suffix}",
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
            created_by,
            f"SMK-{suffix}",
            f"PLANT-{suffix}",
        )
        item_id = await conn.fetchval(
            """
            INSERT INTO procurement.inventory_items (organization_id, created_by, item_name, stock_quantity)
            VALUES ($1::uuid, $2::uuid, $3, 100)
            RETURNING id::text
            """,
            ORG_ID,
            created_by,
            f"Smoke Cement {suffix}",
        )
        ids.update(
            {
                "project_id": project_id,
                "employee_id": employee_id,
                "fleet_id": fleet_id,
                "item_id": item_id,
            }
        )
        return suffix

    return str(await _conn_exec(run))


async def _create_store(created_by: str, suffix: str) -> None:
    async def run(conn: asyncpg.Connection) -> None:
        store_id = await conn.fetchval(
            """
            INSERT INTO procurement.stores (
                organization_id, project_id, site_id, store_code, name, store_type, created_by
            )
            VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, 'site', $6::uuid)
            RETURNING id::text
            """,
            ORG_ID,
            ids["project_id"],
            ids["site_id"],
            f"STORE-{suffix}",
            f"Smoke Site Store {suffix}",
            created_by,
        )
        ids["store_id"] = store_id

    await _conn_exec(run)


async def _verify() -> dict[str, object]:
    async def run(conn: asyncpg.Connection) -> dict[str, object]:
        row = await conn.fetchrow(
            """
            SELECT
              (SELECT status FROM projects.daily_site_reports WHERE id=$1::uuid)::text AS report_status,
              (SELECT COUNT(*) FROM finance.cost_transactions WHERE source_type='daily_site_report' AND source_id=$1::uuid) AS cost_count,
              (SELECT COALESCE(SUM(amount), 0) FROM finance.cost_transactions WHERE source_type='daily_site_report' AND source_id=$1::uuid) AS cost_total,
              (SELECT COUNT(*) FROM procurement.stock_ledger WHERE source_type='daily_report_material' AND source_id=$2::uuid AND movement_type='consumption') AS stock_count,
              (SELECT COUNT(*) FROM core.domain_events WHERE project_id=$3::uuid) AS event_count
            """,
            ids["report_id"],
            ids["material_line_id"],
            ids["project_id"],
        )
        return dict(row)

    return dict(await _conn_exec(run))


async def _cleanup() -> None:
    async def run(conn: asyncpg.Connection) -> None:
        report_id = ids.get("report_id")
        project_id = ids.get("project_id")
        material_line_id = ids.get("material_line_id")

        if report_id:
            if material_line_id:
                await conn.execute(
                    "DELETE FROM procurement.stock_ledger WHERE source_id=$1::uuid",
                    material_line_id,
                )
            await conn.execute(
                "DELETE FROM finance.cost_transactions WHERE source_id=$1::uuid",
                report_id,
            )
            await conn.execute(
                "DELETE FROM core.approval_steps WHERE approval_instance_id IN (SELECT id FROM core.approval_instances WHERE target_id=$1::uuid)",
                report_id,
            )
            await conn.execute(
                "DELETE FROM core.approval_instances WHERE target_id=$1::uuid",
                report_id,
            )
            if project_id:
                await conn.execute(
                    "DELETE FROM core.domain_events WHERE project_id=$1::uuid",
                    project_id,
                )
            await conn.execute(
                "DELETE FROM projects.daily_report_labour WHERE report_id=$1::uuid",
                report_id,
            )
            await conn.execute(
                "DELETE FROM projects.daily_report_equipment WHERE report_id=$1::uuid",
                report_id,
            )
            await conn.execute(
                "DELETE FROM projects.daily_report_materials WHERE report_id=$1::uuid",
                report_id,
            )
            await conn.execute(
                "DELETE FROM projects.daily_site_reports WHERE id=$1::uuid", report_id
            )

        for key, table in [
            ("store_id", "procurement.stores"),
            ("site_id", "projects.sites"),
            ("item_id", "procurement.inventory_items"),
            ("fleet_id", "fleet.fleet"),
            ("employee_id", "hr.employees"),
            ("project_id", "projects.projects"),
        ]:
            if ids.get(key):
                await conn.execute(f"DELETE FROM {table} WHERE id=$1::uuid", ids[key])

        for user_id in ids.get("user_ids", []):
            await conn.execute(
                "DELETE FROM core.user_roles WHERE user_id=$1::uuid", user_id
            )
            await conn.execute("DELETE FROM core.users WHERE id=$1::uuid", user_id)

    await _conn_exec(run)


def _raise_for_status(label: str, response: httpx.Response) -> None:
    print(f"{label}={response.status_code}")
    if response.status_code >= 400:
        print(response.text[:500])
    response.raise_for_status()


async def main() -> None:
    try:
        submitter = await _create_api_user("submitter")
        approver = await _create_api_user("approver")
        ids["user_ids"] = [submitter["id"], approver["id"]]
        suffix = await _setup_shared_records(str(submitter["id"]))

        with httpx.Client(timeout=30) as client:
            site = client.post(
                f"{API_BASE}/api/v1/site-operations/sites",
                headers=submitter["headers"],
                json={
                    "project_id": ids["project_id"],
                    "site_code": f"SITE-{suffix}",
                    "name": f"Smoke Site {suffix}",
                    "location_label": "Codex Yard",
                },
            )
            _raise_for_status("create_site", site)
            ids["site_id"] = site.json()["data"]["id"]
            await _create_store(str(submitter["id"]), suffix)

            report = client.post(
                f"{API_BASE}/api/v1/site-operations/daily-reports",
                headers=submitter["headers"],
                json={
                    "project_id": ids["project_id"],
                    "site_id": ids["site_id"],
                    "report_date": date.today().isoformat(),
                    "shift": "day",
                    "planned_work": "Smoke planned work",
                    "actual_work": "Smoke report: labour, plant and cement consumed.",
                    "cost_exposure": 0,
                    "weather": {},
                },
            )
            _raise_for_status("create_report", report)
            ids["report_id"] = report.json()["data"]["id"]

            labour = client.post(
                f"{API_BASE}/api/v1/site-operations/daily-reports/{ids['report_id']}/labour",
                headers=submitter["headers"],
                json={
                    "employee_id": ids["employee_id"],
                    "role_on_site": "Operator",
                    "regular_hours": 8,
                    "overtime_hours": 1,
                    "cost_rate": 10,
                },
            )
            _raise_for_status("add_labour", labour)
            ids["labour_line_id"] = labour.json()["data"]["id"]

            equipment = client.post(
                f"{API_BASE}/api/v1/site-operations/daily-reports/{ids['report_id']}/equipment",
                headers=submitter["headers"],
                json={
                    "fleet_id": ids["fleet_id"],
                    "operator_employee_id": ids["employee_id"],
                    "operating_hours": 3,
                    "idle_hours": 0.5,
                    "fuel_litres": 15,
                    "cost_rate": 25,
                },
            )
            _raise_for_status("add_equipment", equipment)
            ids["equipment_line_id"] = equipment.json()["data"]["id"]

            material = client.post(
                f"{API_BASE}/api/v1/site-operations/daily-reports/{ids['report_id']}/materials",
                headers=submitter["headers"],
                json={
                    "item_id": ids["item_id"],
                    "store_id": ids["store_id"],
                    "quantity_used": 2,
                    "unit_cost": 12.5,
                    "wastage_quantity": 0,
                    "work_package": "Smoke WP",
                },
            )
            _raise_for_status("add_material", material)
            ids["material_line_id"] = material.json()["data"]["id"]

            submit = client.post(
                f"{API_BASE}/api/v1/site-operations/daily-reports/{ids['report_id']}/submit",
                headers=submitter["headers"],
            )
            _raise_for_status("submit_report", submit)

            approve = client.post(
                f"{API_BASE}/api/v1/site-operations/daily-reports/{ids['report_id']}/decision",
                headers=approver["headers"],
                json={"decision": "approved", "reason": "Codex smoke approval"},
            )
            _raise_for_status("approve_report", approve)

        result = await _verify()
        print("verified=" + ",".join(f"{key}:{value}" for key, value in result.items()))
        if result["report_status"] != "approved":
            raise RuntimeError("Daily report was not approved.")
        if int(result["cost_count"]) != 3:
            raise RuntimeError(
                "Expected three cost transactions: labour, equipment, materials."
            )
        if float(result["cost_total"]) != 190.0:
            raise RuntimeError("Expected total cost of 190.0.")
        if int(result["stock_count"]) != 1:
            raise RuntimeError("Expected one stock ledger consumption movement.")
        if int(result["event_count"]) < 8:
            raise RuntimeError(
                "Expected at least eight domain events for the vertical slice."
            )
    finally:
        try:
            await _cleanup()
            print("cleanup=data_deleted")
        finally:
            for user_id in created_auth_ids:
                try:
                    supabase.auth.admin.delete_user(user_id)
                except Exception:
                    pass
            if created_auth_ids:
                print("cleanup=auth_users_deleted")


if __name__ == "__main__":
    asyncio.run(main())
