"""Verifies plant request readiness, cross-hire swap, hire dates and hours on
the configured database inside a transaction that is always rolled back,
with push/email stubbed. Applies migration 293 inside the same transaction.

    .venv/Scripts/python.exe scripts/verify_plant_readiness_hours.py

  1. migration 293 applies (twice) and the request list returns hours and
     the current machine
  2. readiness can be ticked and planned hours saved on a RESERVED request
  3. hire dates before dispatch move the reservation, and are refused when
     the machine is booked elsewhere in them
  4. swapping: to a cross-hired machine registers a hired_in asset; the same
     machine, a machine booked elsewhere and a broken-down machine are refused
  5. hours cannot be logged before dispatch
  6. dispatching without naming a machine uses the reserved one
  7. hours after dispatch: counted, costed to the request's project, refused
     for a future day or a day before dispatch
  8. dates on hire: start locked, end moves the live assignment
  9. swapping on hire moves only this request's assignment, returns a
     cross-hired machine to its supplier and leaves a busy machine busy
 10. the list shows the machine on site even without a reservation
 11. once returned, dates and swaps are refused
 12. a decided variance cannot be QS-reviewed back to 'submitted'
"""

import asyncio
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path

from fastapi import HTTPException
from sqlalchemy import text

from _rollback_harness import block_outbound, check, finish, rollback_session
from core.security import SUPERADMIN_ROLE
from routers.fleet import (
    FLEET_JOB_STATUSES,
    FLEET_UNUSABLE_STATUSES,
    PLANT_READINESS_CONTROLS,
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
)
from routers.site_reports import VariationQsReviewPayload, review_site_variance_qs

MIGRATION = (Path(__file__).resolve().parents[1] / "migrations" / "293_plant_request_planned_hours.sql").read_text(encoding="utf-8")
TODAY = date.today()


def statements(sql: str) -> list[str]:
    lines = [ln for ln in sql.splitlines() if not ln.strip().startswith("--")]
    return [s.strip() for s in "\n".join(lines).split(";") if s.strip()]


async def row_for(db, user, request_id):
    listed = await list_plant_requests(status_filter=None, user=user, db=db)
    return next(r for r in listed["data"] if str(r["id"]) == str(request_id))


async def refused(coro, code: int, label: str) -> None:
    try:
        await coro
        check(False, f"{label} (was allowed)")
    except HTTPException as exc:
        check(exc.status_code == code, f"{label} -> {exc.status_code}: {str(exc.detail)[:90]}")


async def free_internal_machine(db, org_id, exclude: list) -> str | None:
    """An owned machine that is usable and booked nowhere."""
    return (await db.execute(text("""
        SELECT f.id FROM fleet.fleet f
        WHERE f.organization_id = :o AND f.is_deleted = false
          AND f.ownership_type <> 'hired_in'
          AND f.operational_status <> ALL(CAST(:bad AS text[]))
          AND f.id <> ALL(CAST(:exclude AS uuid[]))
          AND NOT EXISTS (SELECT 1 FROM fleet.fleet_assignments a WHERE a.fleet_id = f.id
                          AND a.is_deleted = false AND a.status IN ('planned','dispatched','active'))
          AND NOT EXISTS (SELECT 1 FROM fleet.plant_reservations r WHERE r.fleet_id = f.id
                          AND r.is_deleted = false AND r.status IN ('provisional','confirmed'))
          AND NOT EXISTS (SELECT 1 FROM fleet.fleet_defects d WHERE d.fleet_id = f.id AND d.is_deleted = false
                          AND d.status IN ('open','triaged','in_repair') AND d.severity IN ('high','critical'))
        ORDER BY f.asset_code LIMIT 1
    """), {"o": org_id, "bad": list(FLEET_UNUSABLE_STATUSES), "exclude": [str(e) for e in exclude]})).scalar()


async def planned_booking(db, org_id, fleet_id, uid, start_days: int, end_days: int):
    return (await db.execute(text("""
        INSERT INTO fleet.fleet_assignments (organization_id, fleet_id, starts_at, ends_at, status, purpose, created_by)
        VALUES (:o, :f, now() + make_interval(days => :s), now() + make_interval(days => :e), 'planned', 'verify other job', :u)
        RETURNING id
    """), {"o": org_id, "f": fleet_id, "u": uid, "s": start_days, "e": end_days})).scalar()


async def run() -> None:
    with block_outbound():
        async with rollback_session() as db:
            print("\n== 1. migration 293")
            for _ in range(2):
                for stmt in statements(MIGRATION):
                    await db.execute(text(stmt))
            check(True, "migration applied twice")

            req = (await db.execute(text("""
                SELECT id, organization_id::text AS org_id, project_id, status FROM fleet.plant_requests
                WHERE status = 'reserved' AND is_deleted = false ORDER BY updated_at DESC LIMIT 1
            """))).first()
            if not req:
                check(False, "a reserved plant request exists to test with")
                return finish()
            org = req.org_id
            uid = (await db.execute(text("SELECT id::text FROM core.users WHERE organization_id = :o LIMIT 1"), {"o": org})).scalar()
            user = {"user_id": uid, "sub": uid, "org_id": org, "role": SUPERADMIN_ROLE, "is_superadmin": True, "email": "verify@local"}
            before = await row_for(db, user, req.id)
            check("hours_worked" in before and "current_fleet_id" in before, f"list returns hours_worked={before['hours_worked']} current machine={before['current_asset_code']}")
            reserved_machine = before["current_fleet_id"]
            reserved_status = (await db.execute(text("SELECT operational_status FROM fleet.fleet WHERE id = :i"), {"i": reserved_machine})).scalar()

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

            print("\n== 3. hire dates before dispatch")
            await refused(
                update_plant_request_readiness(req.id, PlantReadinessUpdatePayload(end_date=TODAY.replace(year=TODAY.year - 1)), user=user, db=db),
                422, "end date before start refused",
            )
            # Pin the start so the test does not depend on the request's own dates.
            await update_plant_request_readiness(
                req.id, PlantReadinessUpdatePayload(start_date=TODAY, end_date=TODAY + timedelta(days=30)), user=user, db=db,
            )
            r_until = (await db.execute(text("""
                SELECT reserved_from::date AS f, reserved_until::date AS u FROM fleet.plant_reservations
                WHERE plant_request_id = :r AND status IN ('provisional','confirmed') AND is_deleted = false
                ORDER BY created_at DESC LIMIT 1
            """), {"r": req.id})).first()
            check(r_until.f == TODAY and r_until.u == TODAY + timedelta(days=30), f"reservation follows the hire dates ({r_until.f} - {r_until.u})")
            other_job = await planned_booking(db, org, reserved_machine, uid, 35, 40)
            await refused(
                update_plant_request_readiness(req.id, PlantReadinessUpdatePayload(end_date=TODAY + timedelta(days=60)), user=user, db=db),
                409, "extending into another booking of the reserved machine refused",
            )
            await db.execute(text("UPDATE fleet.fleet_assignments SET is_deleted = true WHERE id = :i"), {"i": other_job})

            print("\n== 4. swap rules")
            await refused(
                switch_plant_machine(req.id, SwitchPlantMachinePayload(new_fleet_id=reserved_machine, reason="verify"), user=user, db=db),
                409, "swap to the machine already on the request refused",
            )
            busy = await free_internal_machine(db, org, [reserved_machine])
            if busy:
                booking = await planned_booking(db, org, busy, uid, 5, 10)
                await refused(
                    switch_plant_machine(req.id, SwitchPlantMachinePayload(new_fleet_id=busy, reason="verify"), user=user, db=db),
                    409, "swap to a machine booked for another job in the period refused",
                )
                await db.execute(text("UPDATE fleet.fleet_assignments SET is_deleted = true WHERE id = :i"), {"i": booking})
                prior = (await db.execute(text("SELECT operational_status FROM fleet.fleet WHERE id = :i"), {"i": busy})).scalar()
                await db.execute(text("UPDATE fleet.fleet SET operational_status = 'breakdown' WHERE id = :i"), {"i": busy})
                await refused(
                    switch_plant_machine(req.id, SwitchPlantMachinePayload(new_fleet_id=busy, reason="verify"), user=user, db=db),
                    409, "swap to a broken-down machine refused",
                )
                await db.execute(text("UPDATE fleet.fleet SET operational_status = :s WHERE id = :i"), {"i": busy, "s": prior})
            else:
                check(False, "a free internal machine exists to test swap clashes with")
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
            check(asset.ownership_type == "hired_in" and asset.supplier_name == "Verify Hire Co", "cross-hire registers a hired_in asset with the supplier")
            check(asset.hourly_operating_cost == Decimal("45") and asset.current_meter_reading == Decimal("1200"), "hourly hire rate and meter carried over")
            after = await row_for(db, user, req.id)
            check(str(after["current_fleet_id"]) == str(new_id) and after["current_asset_ownership"] == "hired_in", "request now shows the cross-hired machine")
            old_status = (await db.execute(text("SELECT operational_status FROM fleet.fleet WHERE id = :i"), {"i": reserved_machine})).scalar()
            if reserved_status in FLEET_JOB_STATUSES:
                check(old_status in ("available", "assigned"), f"the replaced machine is released ({old_status})")
            else:
                check(old_status == reserved_status, f"a {reserved_status} machine keeps that status when swapped off ({old_status})")
            try:
                SwitchPlantMachinePayload()
                check(False, "swap with no machine refused")
            except Exception:
                check(True, "swap with no machine refused")

            print("\n== 5. hours before dispatch")
            await refused(
                record_utilization(UtilizationPayload(fleet_id=new_id, plant_request_id=req.id, occurred_on=TODAY, operating_hours=Decimal("8")), user=user, db=db),
                409, "hours on a request not yet dispatched refused",
            )

            print("\n== 6. dispatch without naming a machine")
            await db.execute(text("UPDATE fleet.fleet SET operational_status = 'breakdown' WHERE id = :i"), {"i": new_id})
            await refused(
                dispatch_plant_asset(req.id, PlantDispatchPayload(destination_location="Verify site"), user=user, db=db),
                409, "dispatch of a broken-down machine refused",
            )
            await db.execute(text("UPDATE fleet.fleet SET operational_status = 'assigned' WHERE id = :i"), {"i": new_id})
            out = await dispatch_plant_asset(req.id, PlantDispatchPayload(destination_location="Verify site"), user=user, db=db)
            note = (await db.execute(text("SELECT fleet_id FROM fleet.dispatch_notes WHERE plant_request_id = :r ORDER BY created_at DESC LIMIT 1"), {"r": req.id})).scalar()
            check(str(note) == str(new_id), f"dispatch note {out['data'].get('dispatch_number', '')} uses the reserved machine")
            assignment_id = out["data"]["assignment_id"]

            print("\n== 7. hours after dispatch")
            log = await record_utilization(
                UtilizationPayload(fleet_id=new_id, plant_request_id=req.id, occurred_on=TODAY, operating_hours=Decimal("8"), idle_hours=Decimal("1"), engine_hours=Decimal("1208")),
                user=user, db=db,
            )
            after = await row_for(db, user, req.id)
            worked = Decimal(str(after["hours_worked"])) - Decimal(str(before["hours_worked"]))
            check(worked == Decimal("8"), f"hours worked rose by 8 (now {after['hours_worked']} of {after['planned_hours']})")
            logged = (await db.execute(text("SELECT project_id, cost_amount FROM fleet.utilization_logs WHERE id = :i"), {"i": log["data"]["id"]})).first()
            check(str(logged.project_id) == str(req.project_id), "hours costed to the request's project")
            check(logged.cost_amount == Decimal("360.00"), f"cost = 8 h x 45 hire rate ({logged.cost_amount})")
            logs = await list_utilization_logs(fleet_id=None, project_id=None, plant_request_id=req.id, date_from=None, date_to=None, approval_status=None, limit=50, user=user, db=db)
            check(len(logs["data"]) >= 1 and all(str(l["plant_request_id"]) == str(req.id) for l in logs["data"]), "hour log filters by plant request")
            await refused(
                record_utilization(UtilizationPayload(fleet_id=new_id, plant_request_id=req.id, occurred_on=TODAY + timedelta(days=3), operating_hours=Decimal("8")), user=user, db=db),
                422, "hours for a future day refused",
            )
            await refused(
                record_utilization(UtilizationPayload(fleet_id=new_id, plant_request_id=req.id, occurred_on=TODAY - timedelta(days=2), operating_hours=Decimal("8")), user=user, db=db),
                422, "hours before the dispatch date refused",
            )

            print("\n== 8. dates on hire")
            await refused(
                update_plant_request_readiness(req.id, PlantReadinessUpdatePayload(start_date=TODAY + timedelta(days=1)), user=user, db=db),
                409, "start date change on hire refused",
            )
            new_end = TODAY + timedelta(days=45)
            await update_plant_request_readiness(req.id, PlantReadinessUpdatePayload(end_date=new_end), user=user, db=db)
            ends = (await db.execute(text("SELECT ends_at::date FROM fleet.fleet_assignments WHERE id = :i"), {"i": assignment_id})).scalar()
            check(ends == new_end, f"live assignment end moved with the hire end ({ends})")
            clash_job = await planned_booking(db, org, new_id, uid, 50, 55)
            await refused(
                update_plant_request_readiness(req.id, PlantReadinessUpdatePayload(end_date=TODAY + timedelta(days=70)), user=user, db=db),
                409, "extending on hire into another booking refused",
            )
            await db.execute(text("UPDATE fleet.fleet_assignments SET is_deleted = true WHERE id = :i"), {"i": clash_job})

            print("\n== 9. swap on hire")
            other = await planned_booking(db, org, new_id, uid, 400, 410)
            internal = await free_internal_machine(db, org, [new_id, reserved_machine])
            await switch_plant_machine(req.id, SwitchPlantMachinePayload(new_fleet_id=internal, reason="verify"), user=user, db=db)
            mine = (await db.execute(text("SELECT fleet_id FROM fleet.fleet_assignments WHERE id = :i"), {"i": assignment_id})).scalar()
            theirs = (await db.execute(text("SELECT fleet_id FROM fleet.fleet_assignments WHERE id = :i"), {"i": other})).scalar()
            check(str(mine) == str(internal), "this request's assignment moved to the replacement")
            check(str(theirs) == str(new_id), "the old machine's other booking stayed on it")
            xh = (await db.execute(text("SELECT operational_status, current_assignment_id FROM fleet.fleet WHERE id = :i"), {"i": new_id})).first()
            check(xh.operational_status == "hired_in" and xh.current_assignment_id is None, f"cross-hired machine goes back to its supplier ({xh.operational_status})")
            nw = (await db.execute(text("SELECT operational_status, current_assignment_id FROM fleet.fleet WHERE id = :i"), {"i": internal})).first()
            check(nw.operational_status == "deployed" and str(nw.current_assignment_id) == str(assignment_id), "replacement is deployed on this assignment")
            # A machine busy on another live job stays busy when swapped off this one.
            elsewhere = (await db.execute(text("""
                INSERT INTO fleet.fleet_assignments (organization_id, fleet_id, starts_at, ends_at, status, purpose, created_by)
                VALUES (:o, :f, now() + interval '500 days', now() + interval '510 days', 'dispatched', 'verify live job', :u) RETURNING id
            """), {"o": org, "f": internal, "u": uid})).scalar()
            third = await free_internal_machine(db, org, [new_id, reserved_machine, internal])
            if third:
                await switch_plant_machine(req.id, SwitchPlantMachinePayload(new_fleet_id=third, reason="verify"), user=user, db=db)
                st = (await db.execute(text("SELECT operational_status FROM fleet.fleet WHERE id = :i"), {"i": internal})).scalar()
                check(st == "deployed", f"machine still on another live job is not marked available ({st})")
            else:
                check(False, "a third free machine exists to test release")
            await db.execute(text("UPDATE fleet.fleet_assignments SET is_deleted = true WHERE id = :i"), {"i": elsewhere})

            print("\n== 10. list shows the machine on site")
            await db.execute(text("UPDATE fleet.plant_reservations SET is_deleted = true WHERE plant_request_id = :r"), {"r": req.id})
            after = await row_for(db, user, req.id)
            on_site = (await db.execute(text("SELECT fleet_id FROM fleet.fleet_assignments WHERE id = :i"), {"i": assignment_id})).scalar()
            check(str(after["current_fleet_id"]) == str(on_site) and str(after["current_assignment_id"]) == str(assignment_id), "machine on site shown without a reservation")

            print("\n== 11. after return")
            await db.execute(text("UPDATE fleet.plant_requests SET status = 'returned' WHERE id = :i"), {"i": req.id})
            await refused(
                update_plant_request_readiness(req.id, PlantReadinessUpdatePayload(end_date=TODAY + timedelta(days=90)), user=user, db=db),
                409, "date change after return refused",
            )
            await refused(
                switch_plant_machine(req.id, SwitchPlantMachinePayload(new_fleet_id=internal, reason="verify"), user=user, db=db),
                409, "swap after return refused",
            )
            await record_utilization(
                UtilizationPayload(fleet_id=on_site, plant_request_id=req.id, occurred_on=TODAY, operating_hours=Decimal("2")),
                user=user, db=db,
            )
            check(True, "late hours for the hire can still be logged after return")

            print("\n== 12. variation QS review guard")
            decided = (await db.execute(text("""
                SELECT id, status FROM finance.variations
                WHERE organization_id = :o AND is_deleted = false AND source_type = 'weekly_budget_item'
                  AND status NOT IN ('pending','submitted') LIMIT 1
            """), {"o": org})).first()
            if decided:
                await refused(
                    review_site_variance_qs(decided.id, VariationQsReviewPayload(decision="reviewed"), user=user, db=db),
                    409, f"QS review of a {decided.status} variance refused",
                )
            else:
                print("  SKIP no decided site variance to test with")
    finish()


if __name__ == "__main__":
    asyncio.run(run())
