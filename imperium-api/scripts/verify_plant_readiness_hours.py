"""Verifies plant request readiness, cross-hire swap and hours on the
configured database inside a transaction that is always rolled back, with
push/email stubbed. Applies migration 293 inside the same transaction.

    .venv/Scripts/python.exe scripts/verify_plant_readiness_hours.py

  1. migration 293 applies (twice) and the request list returns hours and
     the current machine
  2. readiness can be ticked and planned hours saved on a RESERVED request
     (the status endpoint refuses that state)
  3. swapping to a cross-hired machine registers a hired_in asset and moves
     the reservation to it
  4. logging hours against the request shows hours worked / left
  5. dispatching without naming a machine uses the reserved one
"""

import asyncio
from decimal import Decimal
from pathlib import Path

from fastapi import HTTPException
from sqlalchemy import text

from _rollback_harness import block_outbound, check, finish, rollback_session
from core.security import SUPERADMIN_ROLE
from routers.fleet import (
    PlantDispatchPayload,
    PlantReadinessUpdatePayload,
    SwitchPlantMachinePayload,
    UtilizationPayload,
    dispatch_plant_asset,
    list_plant_requests,
    list_utilization_logs,
    record_utilization,
    switch_plant_machine,
    update_plant_request_readiness,
    PLANT_READINESS_CONTROLS,
)

MIGRATION = (Path(__file__).resolve().parents[1] / "migrations" / "293_plant_request_planned_hours.sql").read_text(encoding="utf-8")


def statements(sql: str) -> list[str]:
    lines = [ln for ln in sql.splitlines() if not ln.strip().startswith("--")]
    return [s.strip() for s in "\n".join(lines).split(";") if s.strip()]


async def row_for(db, user, request_id):
    listed = await list_plant_requests(status_filter=None, user=user, db=db)
    return next(r for r in listed["data"] if str(r["id"]) == str(request_id))


async def run() -> None:
    with block_outbound():
        async with rollback_session() as db:
            print("\n== 1. migration 293")
            for _ in range(2):
                for stmt in statements(MIGRATION):
                    await db.execute(text(stmt))
            check(True, "migration applied twice")

            req = (await db.execute(text("""
                SELECT id, organization_id::text AS org_id, status FROM fleet.plant_requests
                WHERE status = 'reserved' AND is_deleted = false ORDER BY updated_at DESC LIMIT 1
            """))).first()
            if not req:
                check(False, "a reserved plant request exists to test with")
                return finish()
            uid = (await db.execute(text("SELECT id::text FROM core.users WHERE organization_id = :o LIMIT 1"), {"o": req.org_id})).scalar()
            user = {"user_id": uid, "sub": uid, "org_id": req.org_id, "role": SUPERADMIN_ROLE, "is_superadmin": True, "email": "verify@local"}
            before = await row_for(db, user, req.id)
            check("hours_worked" in before and "current_fleet_id" in before, f"list returns hours_worked={before['hours_worked']} current machine={before['current_asset_code']}")

            print("\n== 2. readiness on a reserved request")
            res = await update_plant_request_readiness(
                req.id, PlantReadinessUpdatePayload(readiness_pack={k: True for k in PLANT_READINESS_CONTROLS}, planned_hours=Decimal("100")),
                user=user, db=db,
            )
            check(res["data"]["readiness_status"] == "ready" and not res["data"]["readiness_blockers"], "all ticked -> ready, no blockers")
            after = await row_for(db, user, req.id)
            check(Decimal(str(after["planned_hours"])) == Decimal("100"), "planned hours saved = 100")
            res = await update_plant_request_readiness(req.id, PlantReadinessUpdatePayload(readiness_pack={"fuel_controls": False}), user=user, db=db)
            check(res["data"]["readiness_blockers"] == ["Fuel allocation and register controls missing"], "unticking one item blocks on just that item")
            after = await row_for(db, user, req.id)
            check(Decimal(str(after["planned_hours"])) == Decimal("100"), "planned hours kept when not sent")
            await update_plant_request_readiness(req.id, PlantReadinessUpdatePayload(readiness_pack={"fuel_controls": True}), user=user, db=db)

            print("\n== 3. swap to a cross-hired machine")
            swap = await switch_plant_machine(
                req.id,
                SwitchPlantMachinePayload(cross_hire={
                    "supplier_name": "Verify Hire Co", "registration_or_serial": "VERIFY-XH-1",
                    "asset_type": "Excavator 30T", "make_model": "CAT 330", "hire_rate": "45", "hire_rate_unit": "hourly",
                    "meter_reading": "1200",
                }, reason="No internal machine available - cross-hired"),
                user=user, db=db,
            )
            new_id = swap["data"]["new_fleet_id"]
            asset = (await db.execute(text("SELECT ownership_type, supplier_name, hourly_operating_cost, current_meter_reading FROM fleet.fleet WHERE id = :i"), {"i": new_id})).first()
            check(asset.ownership_type == "hired_in" and asset.supplier_name == "Verify Hire Co", "hired_in asset registered with supplier")
            check(asset.hourly_operating_cost == Decimal("45") and asset.current_meter_reading == Decimal("1200"), "hourly hire rate and meter carried over")
            after = await row_for(db, user, req.id)
            check(str(after["current_fleet_id"]) == str(new_id) and after["current_asset_ownership"] == "hired_in", "request now shows the cross-hired machine")
            try:
                SwitchPlantMachinePayload()
                check(False, "swap with no machine refused")
            except Exception:
                check(True, "swap with no machine refused")

            print("\n== 4. log hours")
            from datetime import date
            await record_utilization(
                UtilizationPayload(fleet_id=new_id, plant_request_id=req.id, occurred_on=date.today(), operating_hours=Decimal("8"), idle_hours=Decimal("1"), engine_hours=Decimal("1208")),
                user=user, db=db,
            )
            after = await row_for(db, user, req.id)
            worked = Decimal(str(after["hours_worked"])) - Decimal(str(before["hours_worked"]))
            check(worked == Decimal("8"), f"hours worked rose by 8 (now {after['hours_worked']} of {after['planned_hours']})")
            logs = await list_utilization_logs(fleet_id=None, project_id=None, plant_request_id=req.id, date_from=None, date_to=None, approval_status=None, limit=50, user=user, db=db)
            check(len(logs["data"]) >= 1 and all(str(l["plant_request_id"]) == str(req.id) for l in logs["data"]), "hour log filters by plant request")

            print("\n== 5. dispatch without naming a machine")
            req_end = (await db.execute(text("SELECT end_date FROM fleet.plant_requests WHERE id = :i"), {"i": req.id})).scalar()
            if req_end and req_end < date.today():
                try:
                    await dispatch_plant_asset(req.id, PlantDispatchPayload(destination_location="Verify site"), user=user, db=db)
                    check(False, "dispatch after the hire end date refused")
                except HTTPException as exc:
                    check(exc.status_code == 409, f"dispatch after the hire end date refused ({exc.detail[:60]}...)")
            try:
                await update_plant_request_readiness(req.id, PlantReadinessUpdatePayload(end_date=date.today().replace(day=1).replace(year=date.today().year - 1)), user=user, db=db)
                check(False, "end date before start refused")
            except HTTPException as exc:
                check(exc.status_code == 422, "end date before start refused")
            from datetime import timedelta
            await update_plant_request_readiness(req.id, PlantReadinessUpdatePayload(end_date=date.today() + timedelta(days=30)), user=user, db=db)
            after = await row_for(db, user, req.id)
            check(str(after["end_date"]) == str(date.today() + timedelta(days=30)) and Decimal(str(after["planned_hours"])) == Decimal("100"), "hire end date extended, plan kept")
            try:
                out = await dispatch_plant_asset(req.id, PlantDispatchPayload(destination_location="Verify site"), user=user, db=db)
                note = (await db.execute(text("SELECT fleet_id FROM fleet.dispatch_notes WHERE plant_request_id = :r ORDER BY created_at DESC LIMIT 1"), {"r": req.id})).scalar()
                check(str(note) == str(new_id), f"dispatch note {out['data'].get('dispatch_number', '')} uses the reserved machine")
            except HTTPException as exc:
                check(False, f"dispatch succeeded ({exc.status_code}: {exc.detail})")
    finish()


if __name__ == "__main__":
    asyncio.run(run())
