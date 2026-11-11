"""Site Operations reconciliations and site-logged variations (migration 298).

Mounted at /api/v1/site-operations.

Day close.  A site day can't be closed until the day's material usage and
plant usage are recorded on its daily report ("nothing used" is an answer).
Usage drawn from a site store leaves the store's stock the moment it is
recorded; usage of material already issued to the project (the issue took it
out of the store) is recorded without moving stock again.

Saturday.  Every project that worked during the week (Sunday-Saturday)
confirms the week's material usage and counts its site stores. Material usage
comes first (usage that happened but never made a daily report is booked
then); the count follows, and any difference between the count and the books
is posted as a stock adjustment. Until last week's reconciliation is done no
new site day can be opened, and a Saturday can't be closed without it.

Variations.  Site staff log variations (site instructions, site conditions,
client changes) straight into finance.variations, the register Finance, the
project workspace, the client portal and final accounts all read.
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from typing import Any, Literal, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services import inventory_service
from app.shared.events import emit_event, emit_role_notification
from app.shared.variations import next_variation_number, normalise_initiated_by
from core.database import get_db
from core.project_scope import require_project_access
from core.security import require_any_permission
from routers.site_day import (
    SITE_DAY_READ,
    SITE_DAY_WRITE,
    _briefing,
    _project_name,
    ensure_daily_report_draft,
    harare_today,
)
from routers.site_reports import daily_report_lines, sync_material_line_stock

router = APIRouter()

# The Saturday reconciliation is enforced from the first Saturday after it
# shipped; earlier weeks are not chased.
WEEKLY_RECON_START = date(2026, 11, 14)
EDITABLE_REPORT = ("draft", "rejected")
QTY = Decimal("0.001")


def result(data: Any, message: str) -> dict[str, Any]:
    return {"success": True, "data": data, "message": message}


class Payload(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


def _d(value: Any) -> Decimal:
    return Decimal(str(value or 0))


# ============================================================================= week helpers
def week_ending_for(day: date) -> date:
    """The Saturday that closes the Sunday-Saturday week containing `day`."""
    return day + timedelta(days=(6 - day.isoweekday()) % 7)


def previous_week_ending(day: date) -> date:
    """The most recent Saturday strictly before `day`."""
    back = (day.isoweekday() - 6) % 7 or 7
    return day - timedelta(days=back)


async def weekly_recon_required(db: AsyncSession, org_id: str, project_id: UUID, week_ending: date) -> bool:
    if week_ending < WEEKLY_RECON_START:
        return False
    worked = (
        await db.execute(
            text("""
            SELECT 1 FROM projects.site_day_briefings
            WHERE organization_id = CAST(:org_id AS uuid) AND project_id = :project_id AND is_deleted = false
              AND status IN ('started', 'closed')
              AND briefing_date BETWEEN :week_start AND :week_ending
            LIMIT 1
        """),
            {"org_id": org_id, "project_id": project_id,
             "week_start": week_ending - timedelta(days=6), "week_ending": week_ending},
        )
    ).scalar()
    return bool(worked)


async def _recon_row(db: AsyncSession, org_id: str, project_id: UUID, week_ending: date) -> Optional[dict[str, Any]]:
    row = (
        await db.execute(
            text("""
            SELECT r.*, mu.full_name AS materials_completed_by_name, su.full_name AS stores_completed_by_name
            FROM projects.weekly_site_reconciliations r
            LEFT JOIN core.users mu ON mu.id = r.materials_completed_by
            LEFT JOIN core.users su ON su.id = r.stores_completed_by
            WHERE r.organization_id = CAST(:org_id AS uuid) AND r.project_id = :project_id AND r.week_ending = :we
        """),
            {"org_id": org_id, "project_id": project_id, "we": week_ending},
        )
    ).mappings().first()
    return dict(row) if row else None


async def outstanding_weekly_recon(db: AsyncSession, org_id: str, project_id: UUID, week_ending: date) -> bool:
    """True when that week needed a reconciliation and it isn't complete."""
    if not await weekly_recon_required(db, org_id, project_id, week_ending):
        return False
    row = await _recon_row(db, org_id, project_id, week_ending)
    return not (row and row["status"] == "completed")


async def guard_open_site_day(db: AsyncSession, org_id: str, project_id: UUID, on_date: date) -> None:
    """Called when a site day is opened: last week's reconciliation must be done."""
    week_ending = previous_week_ending(on_date)
    if await outstanding_weekly_recon(db, org_id, project_id, week_ending):
        raise HTTPException(
            status_code=409,
            detail=(
                f"The weekly stores and material usage reconciliation for the week ending {week_ending:%a %d %b %Y} "
                "has not been done. Complete it in Site Operations > Weekly Recon, then open today's site day."
            ),
        )


async def guard_close_site_day(db: AsyncSession, org_id: str, briefing: dict[str, Any], report_status: Optional[str]) -> None:
    """Called when a site day is closed: usage recorded, and on Saturday the week reconciled."""
    if report_status in EDITABLE_REPORT or report_status is None:
        missing = []
        if not briefing.get("materials_reconciled_at"):
            missing.append("material usage")
        if not briefing.get("plant_reconciled_at"):
            missing.append("plant usage")
        if missing:
            raise HTTPException(
                status_code=409,
                detail=f"Record today's {' and '.join(missing)} before closing the site day (say so if nothing was used).",
            )
    on_date = briefing["briefing_date"]
    if on_date.isoweekday() == 6 and await outstanding_weekly_recon(db, org_id, briefing["project_id"], on_date):
        raise HTTPException(
            status_code=409,
            detail="It's Saturday: complete the weekly stores count and material usage reconciliation (Weekly Recon tab) before closing the site day.",
        )


# ============================================================================= day close: usage
class UsageMaterial(Payload):
    item_id: UUID
    store_id: Optional[UUID] = None
    quantity_used: Decimal = Field(gt=0, max_digits=14, decimal_places=3)
    wastage_quantity: Decimal = Field(default=Decimal("0"), ge=0, max_digits=14, decimal_places=3)
    unit_cost: Optional[Decimal] = Field(default=None, ge=0, max_digits=15, decimal_places=4)
    consumes_stock: bool = True
    work_package: Optional[str] = Field(default=None, max_length=160)
    notes: Optional[str] = None


class UsagePlant(Payload):
    fleet_id: UUID
    operator_employee_id: Optional[UUID] = None
    operating_hours: Decimal = Field(ge=0, le=24, max_digits=10, decimal_places=2)
    idle_hours: Decimal = Field(default=Decimal("0"), ge=0, le=24, max_digits=10, decimal_places=2)
    fuel_litres: Decimal = Field(default=Decimal("0"), ge=0, max_digits=14, decimal_places=3)
    notes: Optional[str] = None

    @model_validator(mode="after")
    def _sane(self):
        if self.operating_hours <= 0 and self.fuel_litres <= 0:
            raise ValueError("Give operating hours (or fuel) for each machine used, or leave it off the list.")
        if self.idle_hours > self.operating_hours:
            raise ValueError("Idle hours can't be more than operating hours.")
        return self


class UsageReconcile(Payload):
    materials: list[UsageMaterial] = Field(default_factory=list, max_length=200)
    no_materials_used: bool = False
    plant: list[UsagePlant] = Field(default_factory=list, max_length=100)
    no_plant_used: bool = False

    @model_validator(mode="after")
    def _answered(self):
        if not self.materials and not self.no_materials_used:
            raise ValueError("Record the materials used today, or confirm that none were used.")
        if self.materials and self.no_materials_used:
            raise ValueError("Materials are listed but 'no materials used' is ticked.")
        if not self.plant and not self.no_plant_used:
            raise ValueError("Record the plant and small machines used today, or confirm that none were used.")
        if self.plant and self.no_plant_used:
            raise ValueError("Plant is listed but 'no plant used' is ticked.")
        keys = [(m.item_id, m.store_id, m.consumes_stock) for m in self.materials]
        if len(keys) != len(set(keys)):
            raise ValueError("The same material from the same store is listed twice; combine the quantities.")
        fleet = [p.fleet_id for p in self.plant]
        if len(fleet) != len(set(fleet)):
            raise ValueError("A machine is listed twice; combine its hours.")
        return self


async def _project_store_ids(db: AsyncSession, org_id: str, project_id: UUID) -> list[str]:
    rows = await db.execute(
        text("""
        SELECT id FROM procurement.stores
        WHERE organization_id = CAST(:org_id AS uuid) AND project_id = :project_id AND is_deleted = false
    """),
        {"org_id": org_id, "project_id": project_id},
    )
    return [str(r[0]) for r in rows]


async def _site_stock(db: AsyncSession, org_id: str, store_ids: list[str]) -> list[dict[str, Any]]:
    """Current stock per (site store, item), with an average receipt cost."""
    if not store_ids:
        return []
    rows = await db.execute(
        text("""
        SELECT sl.store_id, st.name AS store_name, sl.item_id, i.item_name, i.item_code, i.unit_of_measure,
               SUM(sl.quantity) AS balance,
               COALESCE(
                   SUM(sl.total_cost) FILTER (WHERE sl.quantity > 0) / NULLIF(SUM(sl.quantity) FILTER (WHERE sl.quantity > 0), 0),
                   MAX(i.standard_cost), 0
               ) AS unit_cost
        FROM procurement.stock_ledger sl
        JOIN procurement.inventory_items i ON i.id = sl.item_id AND i.organization_id = sl.organization_id
        JOIN procurement.stores st ON st.id = sl.store_id
        WHERE sl.organization_id = CAST(:org_id AS uuid) AND sl.store_id = ANY(CAST(:stores AS uuid[]))
        GROUP BY sl.store_id, st.name, sl.item_id, i.item_name, i.item_code, i.unit_of_measure
        HAVING SUM(sl.quantity) <> 0
        ORDER BY st.name, i.item_name
    """),
        {"org_id": org_id, "stores": store_ids},
    )
    return [dict(r._mapping) for r in rows]


async def _report_for_day(db: AsyncSession, org_id: str, user: dict, briefing: dict[str, Any]) -> dict[str, Any]:
    report = await ensure_daily_report_draft(
        db, org_id=org_id, project_id=briefing["project_id"], site_id=briefing.get("site_id"),
        on_date=briefing["briefing_date"], shift=briefing["shift"], user_id=user["user_id"], briefing_id=briefing["id"],
    )
    if not report or not report.get("id"):
        raise HTTPException(status_code=500, detail="The day's daily report could not be prepared.")
    row = (
        await db.execute(
            text("SELECT id, status, report_date FROM projects.daily_site_reports WHERE id = :id"),
            {"id": report["id"]},
        )
    ).mappings().first()
    return dict(row)


async def _usage_payload(db: AsyncSession, org_id: str, briefing: dict[str, Any], report: Optional[dict[str, Any]]) -> dict[str, Any]:
    project_id = briefing["project_id"]
    store_ids = await _project_store_ids(db, org_id, project_id)
    issued_today = await db.execute(
        text("""
        SELECT sl.item_id, i.item_name, i.item_code, i.unit_of_measure, sl.store_id, st.name AS store_name,
               SUM(ABS(sl.quantity)) AS issued_qty,
               COALESCE(SUM(sl.total_cost) / NULLIF(SUM(ABS(sl.quantity)), 0), MAX(i.standard_cost), 0) AS unit_cost
        FROM procurement.stock_ledger sl
        JOIN procurement.inventory_items i ON i.id = sl.item_id AND i.organization_id = sl.organization_id
        LEFT JOIN procurement.stores st ON st.id = sl.store_id
        WHERE sl.organization_id = CAST(:org_id AS uuid) AND sl.project_id = :project_id
          AND sl.movement_type = 'issue'
          AND CAST(COALESCE(sl.movement_at, sl.created_at) AT TIME ZONE 'Africa/Harare' AS date) = :on_date
        GROUP BY sl.item_id, i.item_name, i.item_code, i.unit_of_measure, sl.store_id, st.name
        ORDER BY i.item_name
    """),
        {"org_id": org_id, "project_id": project_id, "on_date": briefing["briefing_date"]},
    )
    fleet = await db.execute(
        text("""
        SELECT f.id, f.asset_code, f.vehicle_registration, f.make, f.model, f.asset_type, f.asset_category,
               f.vehicle_type, f.operational_status,
               COALESCE(f.hourly_charge_rate, f.hourly_operating_cost, 0) AS cost_rate,
               (f.current_project_id = :project_id) AS on_this_project,
               (f.asset_category ILIKE 'small plant%') AS is_small_plant
        FROM fleet.fleet f
        WHERE f.organization_id = CAST(:org_id AS uuid) AND f.is_deleted = false
          AND COALESCE(f.disposal_status, '') NOT IN ('disposed', 'sold', 'written_off')
          AND f.retired_on IS NULL
        ORDER BY (f.current_project_id = :project_id) DESC NULLS LAST,
                 (f.asset_category ILIKE 'small plant%') DESC, f.asset_category, f.asset_type, f.asset_code
    """),
        {"org_id": org_id, "project_id": project_id},
    )
    lines = await daily_report_lines(db, report_id=report["id"], org_id=org_id) if report else {"materials": [], "equipment": []}
    return {
        "briefing_id": str(briefing["id"]),
        "date": briefing["briefing_date"].isoformat(),
        "report_id": str(report["id"]) if report else None,
        "report_status": report["status"] if report else None,
        "editable": bool(report and report["status"] in EDITABLE_REPORT),
        "materials_reconciled_at": briefing.get("materials_reconciled_at"),
        "materials_nil_usage": briefing.get("materials_nil_usage"),
        "plant_reconciled_at": briefing.get("plant_reconciled_at"),
        "plant_nil_usage": briefing.get("plant_nil_usage"),
        "site_stock": await _site_stock(db, org_id, store_ids),
        "issued_today": [dict(r._mapping) for r in issued_today],
        "fleet": [dict(r._mapping) for r in fleet],
        "recorded_materials": lines["materials"],
        "recorded_plant": lines["equipment"],
        "is_saturday": briefing["briefing_date"].isoweekday() == 6,
    }


@router.get("/day/{briefing_id}/usage-reconciliation")
async def get_usage_reconciliation(
    briefing_id: UUID,
    user: dict = Depends(require_any_permission(*SITE_DAY_READ)),
    db: AsyncSession = Depends(get_db),
):
    """What the close-day check needs: site store stock, today's issues, the
    plant list (this project's plant first, then small plant) and what the
    daily report already holds."""
    org_id = user["org_id"]
    briefing = await _briefing(db, org_id, briefing_id, user=user)
    report = (
        await db.execute(
            text("""
            SELECT id, status, report_date FROM projects.daily_site_reports
            WHERE organization_id = CAST(:org_id AS uuid) AND project_id = :project_id
              AND report_date = :on_date AND shift = :shift AND is_deleted = false
            LIMIT 1
        """),
            {"org_id": org_id, "project_id": briefing["project_id"], "on_date": briefing["briefing_date"], "shift": briefing["shift"]},
        )
    ).mappings().first()
    return result(await _usage_payload(db, org_id, briefing, dict(report) if report else None), "Usage reconciliation loaded.")


@router.post("/day/{briefing_id}/usage-reconciliation")
async def reconcile_day_usage(
    briefing_id: UUID,
    payload: UsageReconcile,
    user: dict = Depends(require_any_permission(*SITE_DAY_WRITE)),
    db: AsyncSession = Depends(get_db),
):
    """Records the day's material and plant usage on the daily report. The
    lists are the day's full answer: lines not on them are removed. Material
    from a site store leaves that store's stock now."""
    org_id = user["org_id"]
    briefing = await _briefing(db, org_id, briefing_id, user=user)
    if briefing["status"] not in ("started", "closed"):
        raise HTTPException(status_code=409, detail="Start the site day before recording its usage.")
    report = await _report_for_day(db, org_id, user, briefing)
    if report["status"] not in EDITABLE_REPORT:
        raise HTTPException(
            status_code=409,
            detail=f"The daily report is already {report['status']}; its material and plant usage stand as submitted.",
        )
    report_id = report["id"]
    project_id = briefing["project_id"]
    project_stores = set(await _project_store_ids(db, org_id, project_id))
    reference = f"DSR-{briefing['briefing_date']}"

    # --- materials: the submitted list replaces the report's material lines
    existing = (
        await db.execute(
            text("""
            SELECT id, item_id, store_id, consumes_stock FROM projects.daily_report_materials
            WHERE report_id = :report_id AND organization_id = CAST(:org_id AS uuid) AND is_deleted = false
        """),
            {"report_id": report_id, "org_id": org_id},
        )
    ).mappings().all()
    by_key = {(str(r["item_id"]), str(r["store_id"]) if r["store_id"] else None, bool(r["consumes_stock"])): r["id"] for r in existing}
    kept: set[str] = set()
    touched: list[UUID] = []
    warnings: list[str] = []
    for m in payload.materials:
        item = (
            await db.execute(
                text("""
                SELECT item_name, standard_cost FROM procurement.inventory_items
                WHERE id = :id AND organization_id = CAST(:org_id AS uuid) AND is_deleted = false
            """),
                {"id": m.item_id, "org_id": org_id},
            )
        ).mappings().first()
        if not item:
            raise HTTPException(status_code=404, detail="A material on the list is not in the inventory catalogue.")
        consumes = m.consumes_stock and m.store_id is not None
        if m.store_id is not None:
            store_ok = (
                await db.execute(
                    text("""
                    SELECT 1 FROM procurement.stores WHERE id = :id AND organization_id = CAST(:org_id AS uuid)
                      AND is_deleted = false AND (project_id IS NULL OR project_id = :project_id)
                """),
                    {"id": m.store_id, "org_id": org_id, "project_id": project_id},
                )
            ).scalar()
            if not store_ok:
                raise HTTPException(status_code=404, detail=f"The store for {item['item_name']} is not one of this project's stores.")
            if consumes and str(m.store_id) not in project_stores:
                # Material sitting in a central store reaches site through an issue, not a usage line.
                consumes = False
        unit_cost = m.unit_cost if m.unit_cost is not None else _d(item["standard_cost"])
        if consumes:
            available = await inventory_service.stock_balance(db, org_id=org_id, item_id=m.item_id, store_id=m.store_id)
            already = _d((
                await db.execute(
                    text("""
                    SELECT -quantity FROM procurement.stock_ledger
                    WHERE organization_id = CAST(:org_id AS uuid) AND source_type = 'daily_report_material'
                      AND movement_type = 'consumption' AND source_id = :line_id
                """),
                    {"org_id": org_id, "line_id": by_key.get((str(m.item_id), str(m.store_id), True))},
                )
            ).scalar())
            if m.quantity_used > available + already:
                warnings.append(
                    f"{item['item_name']}: {m.quantity_used} used but the books show {available + already} in store. "
                    "The weekly count will settle the difference."
                )
        key = (str(m.item_id), str(m.store_id) if m.store_id else None, consumes)
        values = {
            "qty": m.quantity_used, "wastage": m.wastage_quantity, "cost": unit_cost, "wp": m.work_package,
            "notes": m.notes or "Recorded at day close", "org_id": org_id, "report_id": report_id,
            "item_id": m.item_id, "store_id": m.store_id, "consumes": consumes, "user_id": user["user_id"],
        }
        if key in by_key:
            line_id = by_key[key]
            await db.execute(
                text("""
                UPDATE projects.daily_report_materials
                SET quantity_used = :qty, wastage_quantity = :wastage, unit_cost = :cost,
                    work_package = COALESCE(:wp, work_package), notes = :notes
                WHERE id = :line_id
            """),
                {**values, "line_id": line_id},
            )
        else:
            line_id = (
                await db.execute(
                    text("""
                    INSERT INTO projects.daily_report_materials (
                        organization_id, report_id, item_id, store_id, quantity_used, unit_cost,
                        wastage_quantity, work_package, notes, created_by, consumes_stock
                    ) VALUES (
                        CAST(:org_id AS uuid), :report_id, :item_id, :store_id, :qty, :cost,
                        :wastage, :wp, :notes, CAST(:user_id AS uuid), :consumes
                    ) RETURNING id
                """),
                    values,
                )
            ).scalar()
        kept.add(str(line_id))
        touched.append(line_id)
    for row in existing:
        if str(row["id"]) not in kept:
            await db.execute(
                text("UPDATE projects.daily_report_materials SET is_deleted = true WHERE id = :id"),
                {"id": row["id"]},
            )
            touched.append(row["id"])
    for line_id in touched:
        await sync_material_line_stock(db, user, line_id=line_id, project_id=project_id, reference=reference)

    # --- plant: the submitted list replaces the report's plant lines
    existing_plant = (
        await db.execute(
            text("""
            SELECT id, fleet_id FROM projects.daily_report_equipment
            WHERE report_id = :report_id AND organization_id = CAST(:org_id AS uuid) AND is_deleted = false
        """),
            {"report_id": report_id, "org_id": org_id},
        )
    ).mappings().all()
    plant_by_fleet = {str(r["fleet_id"]): r["id"] for r in existing_plant}
    kept_plant: set[str] = set()
    for p in payload.plant:
        asset = (
            await db.execute(
                text("""
                SELECT COALESCE(hourly_charge_rate, hourly_operating_cost, 0) AS rate
                FROM fleet.fleet WHERE id = :id AND organization_id = CAST(:org_id AS uuid) AND is_deleted = false
            """),
                {"id": p.fleet_id, "org_id": org_id},
            )
        ).mappings().first()
        if not asset:
            raise HTTPException(status_code=404, detail="A machine on the list is not in the fleet register.")
        values = {
            "op": p.operating_hours, "idle": p.idle_hours, "fuel": p.fuel_litres, "operator": p.operator_employee_id,
            "notes": p.notes or "Recorded at day close", "org_id": org_id, "report_id": report_id,
            "fleet_id": p.fleet_id, "rate": _d(asset["rate"]), "user_id": user["user_id"],
        }
        if str(p.fleet_id) in plant_by_fleet:
            line_id = plant_by_fleet[str(p.fleet_id)]
            await db.execute(
                text("""
                UPDATE projects.daily_report_equipment
                SET operating_hours = :op, idle_hours = :idle, fuel_litres = :fuel,
                    operator_employee_id = COALESCE(:operator, operator_employee_id), notes = :notes
                WHERE id = :line_id
            """),
                {**values, "line_id": line_id},
            )
        else:
            line_id = (
                await db.execute(
                    text("""
                    INSERT INTO projects.daily_report_equipment (
                        organization_id, report_id, fleet_id, operator_employee_id, operating_hours,
                        idle_hours, fuel_litres, cost_rate, notes, created_by
                    ) VALUES (
                        CAST(:org_id AS uuid), :report_id, :fleet_id, :operator, :op,
                        :idle, :fuel, :rate, :notes, CAST(:user_id AS uuid)
                    ) RETURNING id
                """),
                    values,
                )
            ).scalar()
        kept_plant.add(str(line_id))
    for row in existing_plant:
        if str(row["id"]) not in kept_plant:
            await db.execute(text("UPDATE projects.daily_report_equipment SET is_deleted = true WHERE id = :id"), {"id": row["id"]})

    await db.execute(
        text("""
        UPDATE projects.site_day_briefings
        SET materials_reconciled_at = NOW(), materials_reconciled_by = CAST(:user_id AS uuid),
            materials_nil_usage = :no_materials,
            plant_reconciled_at = NOW(), plant_reconciled_by = CAST(:user_id AS uuid),
            plant_nil_usage = :no_plant, updated_at = NOW()
        WHERE id = :id AND organization_id = CAST(:org_id AS uuid)
    """),
        {"user_id": user["user_id"], "no_materials": payload.no_materials_used, "no_plant": payload.no_plant_used,
         "id": briefing_id, "org_id": org_id},
    )
    await emit_event(
        db, user=user, event_type="site.day.usage_reconciled.v1", aggregate_type="site_day_briefing",
        aggregate_id=briefing_id, project_id=project_id,
        event_data={"materials": len(payload.materials), "plant": len(payload.plant),
                    "no_materials_used": payload.no_materials_used, "no_plant_used": payload.no_plant_used},
    )
    await db.commit()
    data = await _usage_payload(db, org_id, await _briefing(db, org_id, briefing_id), report)
    data["warnings"] = warnings
    return result(data, "Today's material and plant usage recorded. Site stock updated.")


# ============================================================================= Saturday reconciliation
class ReconMaterialLine(Payload):
    item_id: UUID
    store_id: UUID
    unrecorded_usage_qty: Decimal = Field(default=Decimal("0"), ge=0, max_digits=14, decimal_places=3)
    notes: Optional[str] = Field(default=None, max_length=500)


class ReconMaterials(Payload):
    project_id: UUID
    week_ending: date
    lines: list[ReconMaterialLine] = Field(default_factory=list, max_length=500)
    notes: Optional[str] = None


class ReconCountLine(Payload):
    item_id: UUID
    store_id: UUID
    counted_qty: Decimal = Field(ge=0, max_digits=14, decimal_places=3)
    notes: Optional[str] = Field(default=None, max_length=500)


class ReconStores(Payload):
    project_id: UUID
    week_ending: date
    lines: list[ReconCountLine] = Field(default_factory=list, max_length=500)
    notes: Optional[str] = None


def _check_week(week_ending: date) -> None:
    if week_ending.isoweekday() != 6:
        raise HTTPException(status_code=422, detail="A weekly reconciliation is for a week ending on a Saturday.")
    if week_ending > harare_today():
        raise HTTPException(status_code=422, detail="This week's reconciliation opens on Saturday.")


async def _week_snapshot(db: AsyncSession, org_id: str, project_id: UUID, week_ending: date) -> list[dict[str, Any]]:
    """Per site store and item: this week's receipts, issues out and recorded
    usage, and the stock the books hold now."""
    store_ids = await _project_store_ids(db, org_id, project_id)
    if not store_ids:
        return []
    rows = await db.execute(
        text("""
        WITH mv AS (
            SELECT sl.*, CAST(COALESCE(sl.movement_at, sl.created_at) AT TIME ZONE 'Africa/Harare' AS date) AS on_day
            FROM procurement.stock_ledger sl
            WHERE sl.organization_id = CAST(:org_id AS uuid) AND sl.store_id = ANY(CAST(:stores AS uuid[]))
        )
        SELECT mv.store_id, st.name AS store_name, mv.item_id, i.item_name, i.item_code, i.unit_of_measure,
               COALESCE(SUM(mv.quantity) FILTER (WHERE mv.movement_type IN ('receipt', 'transfer_in', 'return')
                                                  AND mv.on_day BETWEEN :ws AND :we), 0) AS received_qty,
               COALESCE(-SUM(mv.quantity) FILTER (WHERE mv.movement_type IN ('issue', 'transfer_out')
                                                   AND mv.on_day BETWEEN :ws AND :we), 0) AS issued_qty,
               COALESCE(-SUM(mv.quantity) FILTER (WHERE mv.movement_type = 'consumption'
                                                   AND mv.source_type = 'daily_report_material'
                                                   AND mv.on_day BETWEEN :ws AND :we), 0) AS recorded_usage_qty,
               COALESCE(SUM(mv.quantity), 0) AS system_qty,
               COALESCE(
                   SUM(mv.total_cost) FILTER (WHERE mv.quantity > 0) / NULLIF(SUM(mv.quantity) FILTER (WHERE mv.quantity > 0), 0),
                   MAX(i.standard_cost), 0
               ) AS unit_cost
        FROM mv
        JOIN procurement.inventory_items i ON i.id = mv.item_id AND i.organization_id = mv.organization_id
        JOIN procurement.stores st ON st.id = mv.store_id
        GROUP BY mv.store_id, st.name, mv.item_id, i.item_name, i.item_code, i.unit_of_measure
        HAVING COALESCE(SUM(mv.quantity), 0) <> 0
            OR COUNT(*) FILTER (WHERE mv.on_day BETWEEN :ws AND :we) > 0
        ORDER BY st.name, i.item_name
    """),
        {"org_id": org_id, "stores": store_ids, "ws": week_ending - timedelta(days=6), "we": week_ending},
    )
    return [dict(r._mapping) for r in rows]


async def _ensure_recon(db: AsyncSession, user: dict, project_id: UUID, week_ending: date) -> dict[str, Any]:
    await db.execute(
        text("""
        INSERT INTO projects.weekly_site_reconciliations (organization_id, project_id, week_ending, created_by)
        VALUES (CAST(:org_id AS uuid), :project_id, :we, CAST(:user_id AS uuid))
        ON CONFLICT (organization_id, project_id, week_ending) DO NOTHING
    """),
        {"org_id": user["org_id"], "project_id": project_id, "we": week_ending, "user_id": user["user_id"]},
    )
    row = (
        await db.execute(
            text("""
            SELECT * FROM projects.weekly_site_reconciliations
            WHERE organization_id = CAST(:org_id AS uuid) AND project_id = :project_id AND week_ending = :we
            FOR UPDATE
        """),
            {"org_id": user["org_id"], "project_id": project_id, "we": week_ending},
        )
    ).mappings().one()
    return dict(row)


async def _saved_lines(db: AsyncSession, org_id: str, recon_id: Any) -> list[dict[str, Any]]:
    rows = await db.execute(
        text("""
        SELECT l.*, i.item_name, i.item_code, i.unit_of_measure, st.name AS store_name
        FROM projects.weekly_site_reconciliation_lines l
        LEFT JOIN procurement.inventory_items i ON i.id = l.item_id
        LEFT JOIN procurement.stores st ON st.id = l.store_id
        WHERE l.reconciliation_id = :id AND l.organization_id = CAST(:org_id AS uuid)
        ORDER BY l.kind, st.name, i.item_name
    """),
        {"id": recon_id, "org_id": org_id},
    )
    return [dict(r._mapping) for r in rows]


@router.get("/weekly-reconciliation")
async def get_weekly_reconciliation(
    project_id: UUID,
    week_ending: Optional[date] = Query(default=None),
    user: dict = Depends(require_any_permission(*SITE_DAY_READ)),
    db: AsyncSession = Depends(get_db),
):
    """The reconciliation due now (this Saturday's once it is Saturday, else
    last Saturday's), or the week asked for."""
    org_id = user["org_id"]
    await _project_name(db, org_id, project_id, user=user)
    today = harare_today()
    due = today if today.isoweekday() == 6 else previous_week_ending(today)
    week = week_ending or due
    if week.isoweekday() != 6:
        raise HTTPException(status_code=422, detail="Pick a Saturday.")
    recon = await _recon_row(db, org_id, project_id, week)
    required = await weekly_recon_required(db, org_id, project_id, week)
    completed = bool(recon and recon["status"] == "completed")
    history = await db.execute(
        text("""
        SELECT week_ending, status, completed_at FROM projects.weekly_site_reconciliations
        WHERE organization_id = CAST(:org_id AS uuid) AND project_id = :project_id
        ORDER BY week_ending DESC LIMIT 12
    """),
        {"org_id": org_id, "project_id": project_id},
    )
    data = {
        "project_id": str(project_id),
        "week_ending": week.isoformat(),
        "week_start": (week - timedelta(days=6)).isoformat(),
        "due_week_ending": due.isoformat(),
        "enforced_from": WEEKLY_RECON_START.isoformat(),
        "required": required,
        "open": week <= today,
        "completed": completed,
        # Opening a site day is blocked while last week's is outstanding.
        "blocking": required and not completed and week == previous_week_ending(today),
        "reconciliation": recon,
        "store_ids": await _project_store_ids(db, org_id, project_id),
        "snapshot": [] if completed else await _week_snapshot(db, org_id, project_id, week),
        "lines": await _saved_lines(db, org_id, recon["id"]) if recon else [],
        "history": [dict(r._mapping) for r in history],
    }
    return result(data, "Weekly reconciliation loaded.")


@router.post("/weekly-reconciliation/materials")
async def confirm_weekly_material_usage(
    payload: ReconMaterials,
    user: dict = Depends(require_any_permission(*SITE_DAY_WRITE)),
    db: AsyncSession = Depends(get_db),
):
    """Step 1: confirm the week's material usage. Usage that happened but
    never reached a daily report is booked out of the store now."""
    org_id = user["org_id"]
    await _project_name(db, org_id, payload.project_id, user=user)
    _check_week(payload.week_ending)
    recon = await _ensure_recon(db, user, payload.project_id, payload.week_ending)
    if recon["materials_completed_at"]:
        raise HTTPException(status_code=409, detail="This week's material usage is already confirmed.")
    snapshot = {(str(r["store_id"]), str(r["item_id"])): r for r in await _week_snapshot(db, org_id, payload.project_id, payload.week_ending)}
    given = {(str(line.store_id), str(line.item_id)): line for line in payload.lines}
    unknown = [k for k in given if k not in snapshot]
    if unknown:
        raise HTTPException(status_code=422, detail="Only items held in this project's site stores can be reconciled here.")
    booked = 0
    for key, snap in snapshot.items():
        line = given.get(key)
        unrecorded = line.unrecorded_usage_qty if line else Decimal("0")
        line_id = (
            await db.execute(
                text("""
                INSERT INTO projects.weekly_site_reconciliation_lines (
                    organization_id, reconciliation_id, kind, item_id, store_id, received_qty, issued_qty,
                    recorded_usage_qty, unrecorded_usage_qty, system_qty, unit_cost, notes, created_by
                ) VALUES (
                    CAST(:org_id AS uuid), :recon_id, 'material_usage', :item_id, :store_id, :received, :issued,
                    :recorded, :unrecorded, :system, :cost, :notes, CAST(:user_id AS uuid)
                ) RETURNING id
            """),
                {"org_id": org_id, "recon_id": recon["id"], "item_id": snap["item_id"], "store_id": snap["store_id"],
                 "received": snap["received_qty"], "issued": snap["issued_qty"], "recorded": snap["recorded_usage_qty"],
                 "unrecorded": unrecorded, "system": snap["system_qty"], "cost": snap["unit_cost"],
                 "notes": line.notes if line else None, "user_id": user["user_id"]},
            )
        ).scalar()
        if unrecorded > 0:
            movement_id = await inventory_service.record_stock_movement(
                db, user, item_id=snap["item_id"], store_id=snap["store_id"], project_id=payload.project_id,
                movement_type="consumption", quantity=-unrecorded, unit_cost=_d(snap["unit_cost"]),
                source_type="weekly_site_recon", source_id=line_id,
                reference=f"WSR-{payload.week_ending}", notes="Usage not recorded on a daily report, found at the weekly reconciliation",
            )
            await db.execute(
                text("UPDATE projects.weekly_site_reconciliation_lines SET stock_movement_id = :m WHERE id = :id"),
                {"m": movement_id, "id": line_id},
            )
            booked += 1
    await db.execute(
        text("""
        UPDATE projects.weekly_site_reconciliations
        SET materials_completed_at = NOW(), materials_completed_by = CAST(:user_id AS uuid),
            notes = COALESCE(:notes, notes), updated_at = NOW()
        WHERE id = :id
    """),
        {"user_id": user["user_id"], "notes": payload.notes, "id": recon["id"]},
    )
    await emit_event(
        db, user=user, event_type="site.weekly_recon.materials_confirmed.v1", aggregate_type="weekly_site_reconciliation",
        aggregate_id=recon["id"], project_id=payload.project_id,
        event_data={"week_ending": payload.week_ending.isoformat(), "items": len(snapshot), "unrecorded_lines": booked},
    )
    await db.commit()
    message = "Material usage confirmed. Now count the site stores."
    if booked:
        message = f"Material usage confirmed; {booked} item(s) of unrecorded usage booked out of stock. Now count the site stores."
    return result({"reconciliation_id": str(recon["id"]), "unrecorded_lines": booked}, message)


@router.post("/weekly-reconciliation/stores")
async def complete_weekly_stores_count(
    payload: ReconStores,
    user: dict = Depends(require_any_permission(*SITE_DAY_WRITE)),
    db: AsyncSession = Depends(get_db),
):
    """Step 2: the physical count. Every item the books hold in a site store
    must be counted; differences are posted as stock adjustments."""
    org_id = user["org_id"]
    project_name = await _project_name(db, org_id, payload.project_id, user=user)
    _check_week(payload.week_ending)
    recon = await _ensure_recon(db, user, payload.project_id, payload.week_ending)
    if not recon["materials_completed_at"]:
        raise HTTPException(status_code=409, detail="Confirm the week's material usage first.")
    if recon["stores_completed_at"]:
        raise HTTPException(status_code=409, detail="This week's stores count is already done.")
    store_ids = set(await _project_store_ids(db, org_id, payload.project_id))
    snapshot = {(str(r["store_id"]), str(r["item_id"])): r for r in await _week_snapshot(db, org_id, payload.project_id, payload.week_ending)}
    given = {(str(line.store_id), str(line.item_id)): line for line in payload.lines}
    if len(given) != len(payload.lines):
        raise HTTPException(status_code=422, detail="An item is counted twice in the same store.")
    missing = [snap["item_name"] for key, snap in snapshot.items() if key not in given and _d(snap["system_qty"]) != 0]
    if missing:
        raise HTTPException(
            status_code=422,
            detail=f"Count every item in the site stores. Not counted: {', '.join(missing[:8])}{'…' if len(missing) > 8 else ''}.",
        )
    if any(store not in store_ids for store, _ in given):
        raise HTTPException(status_code=422, detail="Only this project's site stores are counted here.")
    differences = 0
    value = Decimal("0")
    reason = f"Weekly stores count, week ending {payload.week_ending}"
    for key, line in given.items():
        snap = snapshot.get(key)
        system = await inventory_service.stock_balance(db, org_id=org_id, item_id=line.item_id, store_id=line.store_id)
        unit_cost = _d(snap["unit_cost"]) if snap else _d((
            await db.execute(
                text("SELECT standard_cost FROM procurement.inventory_items WHERE id = :id AND organization_id = CAST(:org_id AS uuid)"),
                {"id": line.item_id, "org_id": org_id},
            )
        ).scalar())
        variance = (line.counted_qty - system).quantize(QTY)
        line_id = (
            await db.execute(
                text("""
                INSERT INTO projects.weekly_site_reconciliation_lines (
                    organization_id, reconciliation_id, kind, item_id, store_id, system_qty, counted_qty,
                    variance_qty, unit_cost, notes, created_by
                ) VALUES (
                    CAST(:org_id AS uuid), :recon_id, 'store_count', :item_id, :store_id, :system, :counted,
                    :variance, :cost, :notes, CAST(:user_id AS uuid)
                ) RETURNING id
            """),
                {"org_id": org_id, "recon_id": recon["id"], "item_id": line.item_id, "store_id": line.store_id,
                 "system": system, "counted": line.counted_qty, "variance": variance, "cost": unit_cost,
                 "notes": line.notes, "user_id": user["user_id"]},
            )
        ).scalar()
        if variance != 0:
            outcome = await inventory_service.adjust_stock(
                db, user,
                item_id=line.item_id, store_id=line.store_id, quantity_delta=variance, unit_cost=unit_cost,
                reason=line.notes or reason, reference=f"WSR-{payload.week_ending}", adjustment_id=line_id,
            )
            await db.execute(
                text("UPDATE projects.weekly_site_reconciliation_lines SET stock_movement_id = :m WHERE id = :id"),
                {"m": outcome["movement_id"], "id": line_id},
            )
            differences += 1
            value += variance * unit_cost
    await db.execute(
        text("""
        UPDATE projects.weekly_site_reconciliations
        SET stores_completed_at = NOW(), stores_completed_by = CAST(:user_id AS uuid),
            status = 'completed', completed_at = NOW(), notes = COALESCE(:notes, notes), updated_at = NOW()
        WHERE id = :id
    """),
        {"user_id": user["user_id"], "notes": payload.notes, "id": recon["id"]},
    )
    await emit_event(
        db, user=user, event_type="site.weekly_recon.completed.v1", aggregate_type="weekly_site_reconciliation",
        aggregate_id=recon["id"], project_id=payload.project_id,
        event_data={"week_ending": payload.week_ending.isoformat(), "counted": len(given), "differences": differences,
                    "difference_value": str(value.quantize(Decimal("0.01")))},
    )
    if differences:
        await emit_role_notification(
            db, org_id=org_id, role_names=["Project Manager", "Storekeeper", "Inventory Controller"],
            title=f"Weekly stores count: {differences} difference(s) on {project_name}",
            message=f"Week ending {payload.week_ending}: {differences} item(s) differed from the books "
                    f"(net value {value.quantize(Decimal('0.01'))}). Adjustments posted.",
            action_url=f"/dashboard/site-operations?tab=recon&projectId={payload.project_id}",
        )
    await db.commit()
    return result(
        {"reconciliation_id": str(recon["id"]), "differences": differences, "difference_value": str(value.quantize(Decimal("0.01")))},
        "Weekly reconciliation complete." + (f" {differences} stock difference(s) adjusted." if differences else " Stores agree with the books."),
    )


# ============================================================================= site variations
VARIANCE_ORIGINS = ("client_initiated", "site_initiated", "designer_initiated", "statutory", "internal_loss")
CLASSIFICATIONS = (
    "client_variation", "design_variation", "site_condition_variation",
    "quantity_variance", "internal_cost_variance", "emergency_variance",
)


class SiteVariationCreate(Payload):
    project_id: UUID
    title: str = Field(min_length=3, max_length=255)
    description: Optional[str] = Field(default=None, max_length=4000)
    variance_origin: Literal["client_initiated", "site_initiated", "designer_initiated", "statutory", "internal_loss"] = "site_initiated"
    variance_classification: Literal[
        "client_variation", "design_variation", "site_condition_variation",
        "quantity_variance", "internal_cost_variance", "emergency_variance",
    ] = "site_condition_variation"
    initiated_by: Optional[str] = Field(default=None, max_length=40)
    change_type: Literal["addition", "omission", "substitution"] = "addition"
    cost_impact: Decimal = Field(default=Decimal("0"), ge=0, max_digits=15, decimal_places=2)
    time_impact_days: int = Field(default=0, ge=0, le=3650)
    approval_route: Literal["client", "internal", "client_and_internal"] = "client_and_internal"
    instruction_given_by: Optional[str] = Field(default=None, max_length=160)
    instruction_reference: Optional[str] = Field(default=None, max_length=160)
    location: Optional[str] = Field(default=None, max_length=255)
    notes: Optional[str] = Field(default=None, max_length=4000)


@router.get("/variations")
async def list_site_variations(
    project_id: UUID,
    user: dict = Depends(require_any_permission("finance.variation.read", *SITE_DAY_READ)),
    db: AsyncSession = Depends(get_db),
):
    """Every variation on the project, whoever logged it."""
    await require_project_access(db, user, project_id)
    rows = await db.execute(
        text("""
        SELECT v.id, v.variation_number, v.title, v.description, v.status, v.cost_impact, v.time_impact_days,
               v.initiated_by, v.scope_impact, v.source_type, v.variance_origin, v.variance_classification,
               v.approval_route, v.client_approval_required, v.client_approval_status, v.qs_review_status,
               v.rejection_reason, v.notes, v.created_at, v.submitted_at, v.approved_at,
               cu.full_name AS logged_by_name
        FROM finance.variations v
        LEFT JOIN core.users cu ON cu.id = COALESCE(v.submitted_by, v.created_by)
        WHERE v.organization_id = CAST(:org_id AS uuid) AND v.project_id = :project_id AND v.is_deleted = false
        ORDER BY v.created_at DESC
        LIMIT 300
    """),
        {"org_id": user["org_id"], "project_id": project_id},
    )
    data = [dict(r._mapping) for r in rows]
    totals = {
        "count": len(data),
        "approved_value": float(sum(float(v["cost_impact"] or 0) for v in data if v["status"] == "approved")),
        "pending_value": float(sum(float(v["cost_impact"] or 0) for v in data if v["status"] in ("pending", "submitted"))),
        "approved_days": sum(int(v["time_impact_days"] or 0) for v in data if v["status"] == "approved"),
    }
    return {"success": True, "data": data, "totals": totals, "message": "Project variations listed."}


@router.post("/variations", status_code=status.HTTP_201_CREATED)
async def log_site_variation(
    payload: SiteVariationCreate,
    user: dict = Depends(require_any_permission(
        "finance.variation.create", "site_operations.daily_report.create", "site_operations.labour_register.manage",
    )),
    db: AsyncSession = Depends(get_db),
):
    """A variation logged from site goes into the project's variation register
    (finance.variations) as submitted, for QS review and approval."""
    org_id = user["org_id"]
    project_name = await _project_name(db, org_id, payload.project_id, user=user)
    number = await next_variation_number(db, org_id, payload.project_id)
    client_required = payload.approval_route in ("client", "client_and_internal")
    cost = -payload.cost_impact if payload.change_type == "omission" else payload.cost_impact
    initiated = payload.initiated_by or {
        "client_initiated": "client", "designer_initiated": "designer", "statutory": "statutory",
    }.get(payload.variance_origin, "contractor")
    scope = " · ".join(x for x in (
        payload.change_type.capitalize(),
        f"Location: {payload.location}" if payload.location else None,
        f"Instruction by {payload.instruction_given_by}" if payload.instruction_given_by else None,
        f"Ref {payload.instruction_reference}" if payload.instruction_reference else None,
    ) if x)
    variation_id = (
        await db.execute(
            text("""
            INSERT INTO finance.variations (
                organization_id, variation_number, project_id, title, description, initiated_by, scope_impact,
                cost_impact, time_impact_days, status, submitted_by, submitted_at, created_by, source_type,
                variance_origin, variance_classification, approval_route, client_approval_required,
                client_approval_status, qs_review_status, proceed_instruction_given_by, notes
            ) VALUES (
                CAST(:org_id AS uuid), :number, :project_id, :title, :description, :initiated_by, :scope,
                :cost, :days, 'submitted', CAST(:user_id AS uuid), NOW(), CAST(:user_id AS uuid), 'site_operations',
                :origin, :classification, :route, :client_required,
                :client_status, 'pending', :given_by, :notes
            ) RETURNING id
        """),
            {
                "org_id": org_id, "number": number, "project_id": payload.project_id, "title": payload.title,
                "description": payload.description, "initiated_by": normalise_initiated_by(initiated), "scope": scope or None,
                "cost": cost, "days": payload.time_impact_days, "user_id": user["user_id"],
                "origin": payload.variance_origin, "classification": payload.variance_classification,
                "route": payload.approval_route, "client_required": client_required,
                "client_status": "pending" if client_required else "not_required",
                "given_by": payload.instruction_given_by, "notes": payload.notes,
            },
        )
    ).scalar()
    await emit_event(
        db, user=user, event_type="finance.variation.logged_from_site.v1", aggregate_type="variation",
        aggregate_id=variation_id, project_id=payload.project_id,
        event_data={"variation_number": number, "cost_impact": str(cost), "time_impact_days": payload.time_impact_days},
    )
    await emit_role_notification(
        db, org_id=org_id, role_names=["Quantity Surveyor", "Project Manager", "Commercial Manager"],
        title=f"Variation {number} logged on site",
        message=f"{project_name}: {payload.title} ({payload.change_type}, {cost:,.2f}, {payload.time_impact_days} day(s)). Review and price it.",
        action_url=f"/dashboard/projects/{payload.project_id}/financials",
    )
    await db.commit()
    return result({"id": str(variation_id), "variation_number": number}, f"Variation {number} logged and sent for review.")
