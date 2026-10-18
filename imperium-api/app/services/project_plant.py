"""
Project Plant & Equipment Operations Service
Aggregates plant assignments, daily shift hours, utilization rate,
downtime breakdowns, fuel burn rate reconciliation against benchmark,
and output productivity metrics.
"""
from datetime import date, datetime, timezone
from typing import Optional, Dict, Any, List
from uuid import UUID
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import HTTPException


async def get_project_plant_analytics(
    db: AsyncSession,
    project_id: UUID,
    org_id: UUID,
) -> Dict[str, Any]:
    """
    Returns aggregated plant operations, allocations, utilization,
    fuel metrics, and shift history for a project.
    """
    # 1. Fetch all assigned plant/fleet for this project
    assigned_assets_raw = (
        await db.execute(
            text("""
                SELECT 
                    fa.id AS assignment_id,
                    fa.status AS assignment_status,
                    fa.starts_at,
                    fa.ends_at,
                    fa.dispatch_reference,
                    fa.purpose,
                    f.id AS fleet_id,
                    COALESCE(f.asset_code, f.vehicle_registration, 'PLANT-UNCODED') AS asset_code,
                    f.vehicle_registration,
                    f.make,
                    f.model,
                    COALESCE(f.ownership_type, 'owned') AS ownership_type,
                    COALESCE(f.asset_category, f.vehicle_type, 'heavy_plant') AS asset_category,
                    f.asset_type,
                    COALESCE(f.operational_status, 'operational') AS operational_status,
                    COALESCE(f.hourly_charge_rate, 0) AS hourly_charge_rate,
                    COALESCE(f.benchmark_litres_per_hour, 0) AS benchmark_litres_per_hour,
                    COALESCE(f.current_meter_reading, 0) AS current_meter_reading
                FROM fleet.fleet_assignments fa
                JOIN fleet.fleet f ON f.id = fa.fleet_id
                WHERE fa.project_id = CAST(:project_id AS uuid)
                  AND fa.organization_id = CAST(:org_id AS uuid)
                  AND fa.is_deleted = false
                  AND f.is_deleted = false
                ORDER BY fa.starts_at DESC
            """),
            {"project_id": str(project_id), "org_id": str(org_id)},
        )
    ).mappings().all()

    # 2. Fetch utilization sums from fleet.utilization_logs
    utilization_sums_raw = (
        await db.execute(
            text("""
                SELECT 
                    ul.fleet_id,
                    COALESCE(SUM(ul.operating_hours), 0) AS total_operating_hours,
                    COALESCE(SUM(ul.idle_hours), 0) AS total_idle_hours,
                    COALESCE(SUM(ul.breakdown_downtime_hours), 0) AS total_breakdown_hours,
                    COALESCE(SUM(ul.weather_downtime_hours), 0) AS total_weather_hours,
                    COALESCE(SUM(ul.standing_downtime_hours), 0) AS total_standing_hours,
                    COALESCE(SUM(ul.output_quantity), 0) AS total_output_quantity,
                    MAX(ul.output_unit) AS output_unit
                FROM fleet.utilization_logs ul
                WHERE (
                    ul.project_id = CAST(:project_id AS uuid)
                    OR ul.assignment_id IN (
                        SELECT id FROM fleet.fleet_assignments 
                        WHERE project_id = CAST(:project_id AS uuid)
                          AND organization_id = CAST(:org_id AS uuid)
                          AND is_deleted = false
                    )
                )
                  AND ul.organization_id = CAST(:org_id AS uuid)
                  AND ul.is_deleted = false
                GROUP BY ul.fleet_id
            """),
            {"project_id": str(project_id), "org_id": str(org_id)},
        )
    ).mappings().all()

    util_by_fleet = {str(r["fleet_id"]): dict(r) for r in utilization_sums_raw}

    # 3. Also check daily site report equipment for any field hours logged on site
    daily_report_eq_raw = (
        await db.execute(
            text("""
                SELECT 
                    dre.fleet_id,
                    COALESCE(SUM(dre.operating_hours), 0) AS op_hours,
                    COALESCE(SUM(dre.idle_hours), 0) AS idle_hours,
                    COALESCE(SUM(dre.fuel_litres), 0) AS fuel_litres
                FROM projects.daily_report_equipment dre
                JOIN projects.daily_site_reports dsr ON dsr.id = dre.report_id
                WHERE dsr.project_id = CAST(:project_id AS uuid)
                  AND dre.organization_id = CAST(:org_id AS uuid)
                  AND dre.is_deleted = false
                  AND dsr.is_deleted = false
                GROUP BY dre.fleet_id
            """),
            {"project_id": str(project_id), "org_id": str(org_id)},
        )
    ).mappings().all()

    daily_by_fleet = {str(r["fleet_id"]): dict(r) for r in daily_report_eq_raw}

    # 4. Fetch fuel transactions from fleet.fuel_transactions
    fuel_sums_raw = (
        await db.execute(
            text("""
                SELECT 
                    ft.fleet_id,
                    COALESCE(SUM(ft.quantity_litres), 0) AS total_litres,
                    COALESCE(SUM(ft.total_cost), 0) AS total_fuel_cost
                FROM fleet.fuel_transactions ft
                WHERE (
                    ft.project_id = CAST(:project_id AS uuid)
                    OR ft.assignment_id IN (
                        SELECT id FROM fleet.fleet_assignments 
                        WHERE project_id = CAST(:project_id AS uuid)
                          AND organization_id = CAST(:org_id AS uuid)
                          AND is_deleted = false
                    )
                )
                  AND ft.organization_id = CAST(:org_id AS uuid)
                  AND ft.is_deleted = false
                GROUP BY ft.fleet_id
            """),
            {"project_id": str(project_id), "org_id": str(org_id)},
        )
    ).mappings().all()

    fuel_by_fleet = {str(r["fleet_id"]): dict(r) for r in fuel_sums_raw}

    # 5. Fetch recent shift logs (last 30 logs)
    recent_logs_raw = (
        await db.execute(
            text("""
                SELECT 
                    ul.id,
                    ul.fleet_id,
                    ul.occurred_on,
                    ul.operating_hours,
                    ul.idle_hours,
                    ul.breakdown_downtime_hours,
                    ul.weather_downtime_hours,
                    ul.standing_downtime_hours,
                    ul.output_quantity,
                    ul.output_unit,
                    ul.work_performed,
                    ul.approval_status,
                    COALESCE(f.asset_code, f.vehicle_registration, 'PLANT') AS asset_code,
                    f.make,
                    f.model
                FROM fleet.utilization_logs ul
                JOIN fleet.fleet f ON f.id = ul.fleet_id
                WHERE (
                    ul.project_id = CAST(:project_id AS uuid)
                    OR ul.assignment_id IN (
                        SELECT id FROM fleet.fleet_assignments 
                        WHERE project_id = CAST(:project_id AS uuid)
                          AND organization_id = CAST(:org_id AS uuid)
                          AND is_deleted = false
                    )
                )
                  AND ul.organization_id = CAST(:org_id AS uuid)
                  AND ul.is_deleted = false
                ORDER BY ul.occurred_on DESC, ul.created_at DESC
                LIMIT 30
            """),
            {"project_id": str(project_id), "org_id": str(org_id)},
        )
    ).mappings().all()

    # Compile per-asset and overall metrics
    plant_inventory = []
    tot_operating = 0.0
    tot_idle = 0.0
    tot_breakdown = 0.0
    tot_weather = 0.0
    tot_fuel_litres = 0.0
    tot_fuel_cost = 0.0
    tot_operating_cost = 0.0
    owned_count = 0
    hired_count = 0

    for a in assigned_assets_raw:
        f_id = str(a["fleet_id"])
        u = util_by_fleet.get(f_id, {})
        d = daily_by_fleet.get(f_id, {})
        fu = fuel_by_fleet.get(f_id, {})

        # Merge utilization_logs and daily_report_equipment (taking max to avoid double-counting if logged in both)
        op_hours = max(float(u.get("total_operating_hours", 0)), float(d.get("op_hours", 0)))
        idle_hours = max(float(u.get("total_idle_hours", 0)), float(d.get("idle_hours", 0)))
        breakdown_hours = float(u.get("total_breakdown_hours", 0))
        weather_hours = float(u.get("total_weather_hours", 0))
        standing_hours = float(u.get("total_standing_hours", 0))
        output_qty = float(u.get("total_output_quantity", 0))
        output_unit = u.get("output_unit") or "units"

        fuel_litres = max(float(fu.get("total_litres", 0)), float(d.get("fuel_litres", 0)))
        fuel_cost = float(fu.get("total_fuel_cost", 0))

        # Utilization calculation: Op / (Op + Idle + Breakdown)
        work_denominator = op_hours + idle_hours + breakdown_hours
        utilization_rate = round((op_hours / work_denominator) * 100, 1) if work_denominator > 0 else 0.0

        # Burn rate
        burn_rate = round(fuel_litres / op_hours, 2) if op_hours > 0 else 0.0
        benchmark = float(a["benchmark_litres_per_hour"])
        burn_variance = round(burn_rate - benchmark, 2) if benchmark > 0 and op_hours > 0 else 0.0

        # Hourly cost
        hourly_rate = float(a["hourly_charge_rate"])
        asset_operating_cost = round(op_hours * hourly_rate, 2)

        # Output rate
        productivity = round(output_qty / op_hours, 2) if op_hours > 0 and output_qty > 0 else 0.0

        ownership = str(a["ownership_type"]).lower()
        if ownership in ("hired", "leased"):
            hired_count += 1
        else:
            owned_count += 1

        tot_operating += op_hours
        tot_idle += idle_hours
        tot_breakdown += breakdown_hours
        tot_weather += weather_hours
        tot_fuel_litres += fuel_litres
        tot_fuel_cost += fuel_cost
        tot_operating_cost += asset_operating_cost

        plant_inventory.append({
            "assignment_id": str(a["assignment_id"]),
            "assignment_status": a["assignment_status"],
            "starts_at": a["starts_at"].isoformat() if a["starts_at"] else None,
            "ends_at": a["ends_at"].isoformat() if a["ends_at"] else None,
            "fleet_id": f_id,
            "asset_code": a["asset_code"],
            "vehicle_registration": a["vehicle_registration"],
            "make": a["make"],
            "model": a["model"],
            "ownership_type": a["ownership_type"],
            "asset_category": a["asset_category"],
            "operational_status": a["operational_status"],
            "hourly_charge_rate": hourly_rate,
            "benchmark_litres_per_hour": benchmark,
            "current_meter_reading": float(a["current_meter_reading"]),
            "operating_hours": op_hours,
            "idle_hours": idle_hours,
            "breakdown_hours": breakdown_hours,
            "weather_hours": weather_hours,
            "standing_hours": standing_hours,
            "utilization_rate": utilization_rate,
            "fuel_litres": fuel_litres,
            "fuel_cost": fuel_cost,
            "burn_rate": burn_rate,
            "burn_variance": burn_variance,
            "output_quantity": output_qty,
            "output_unit": output_unit,
            "productivity": productivity,
            "operating_cost": asset_operating_cost,
        })

    # Overall project plant metrics
    overall_denom = tot_operating + tot_idle + tot_breakdown
    overall_utilization = round((tot_operating / overall_denom) * 100, 1) if overall_denom > 0 else 0.0
    overall_burn_rate = round(tot_fuel_litres / tot_operating, 2) if tot_operating > 0 else 0.0

    return {
        "kpis": {
            "total_assigned_assets": len(assigned_assets_raw),
            "owned_assets_count": owned_count,
            "hired_assets_count": hired_count,
            "total_operating_hours": round(tot_operating, 1),
            "total_idle_hours": round(tot_idle, 1),
            "total_breakdown_hours": round(tot_breakdown, 1),
            "total_weather_downtime_hours": round(tot_weather, 1),
            "overall_utilization_rate": overall_utilization,
            "total_fuel_consumed_litres": round(tot_fuel_litres, 1),
            "total_fuel_cost": round(tot_fuel_cost, 2),
            "average_burn_rate": overall_burn_rate,
            "total_plant_operating_cost": round(tot_operating_cost, 2),
        },
        "plant_inventory": plant_inventory,
        "recent_shift_logs": [
            {
                "id": str(log["id"]),
                "fleet_id": str(log["fleet_id"]),
                "occurred_on": log["occurred_on"].isoformat() if log["occurred_on"] else None,
                "asset_code": log["asset_code"],
                "make": log["make"],
                "model": log["model"],
                "operating_hours": float(log["operating_hours"] or 0),
                "idle_hours": float(log["idle_hours"] or 0),
                "breakdown_downtime_hours": float(log["breakdown_downtime_hours"] or 0),
                "output_quantity": float(log["output_quantity"] or 0),
                "output_unit": log["output_unit"],
                "work_performed": log["work_performed"],
                "approval_status": log["approval_status"],
            }
            for log in recent_logs_raw
        ],
    }


async def record_project_plant_shift_log(
    db: AsyncSession,
    project_id: UUID,
    org_id: UUID,
    user_id: UUID,
    payload: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Records a plant shift log (operating, idle, breakdown hours, output quantity, fuel)
    under fleet.utilization_logs and fleet.fuel_transactions.
    """
    fleet_id = payload.get("fleet_id")
    if not fleet_id:
        raise HTTPException(status_code=400, detail="fleet_id is required.")

    occurred_on = payload.get("occurred_on") or date.today()
    if isinstance(occurred_on, str):
        occurred_on = date.fromisoformat(occurred_on)

    operating_hours = max(0.0, float(payload.get("operating_hours", 0)))
    idle_hours = max(0.0, float(payload.get("idle_hours", 0)))
    breakdown_hours = max(0.0, float(payload.get("breakdown_downtime_hours", 0)))
    weather_hours = max(0.0, float(payload.get("weather_downtime_hours", 0)))
    output_quantity = float(payload["output_quantity"]) if payload.get("output_quantity") is not None else None
    output_unit = payload.get("output_unit")
    work_performed = payload.get("work_performed")
    fuel_litres = max(0.0, float(payload.get("fuel_litres", 0)))

    # Find active assignment for this plant and project if exists
    assignment_row = (
        await db.execute(
            text("""
                SELECT id FROM fleet.fleet_assignments
                WHERE project_id = CAST(:project_id AS uuid)
                  AND fleet_id = CAST(:fleet_id AS uuid)
                  AND organization_id = CAST(:org_id AS uuid)
                  AND is_deleted = false
                ORDER BY starts_at DESC
                LIMIT 1
            """),
            {"project_id": str(project_id), "fleet_id": str(fleet_id), "org_id": str(org_id)},
        )
    ).first()
    assignment_id = str(assignment_row[0]) if assignment_row else None

    # Insert utilization log
    util_row = (
        await db.execute(
            text("""
                INSERT INTO fleet.utilization_logs (
                    organization_id,
                    fleet_id,
                    project_id,
                    assignment_id,
                    occurred_on,
                    operating_hours,
                    idle_hours,
                    breakdown_downtime_hours,
                    weather_downtime_hours,
                    output_quantity,
                    output_unit,
                    work_performed,
                    approval_status,
                    recorded_by
                ) VALUES (
                    CAST(:org_id AS uuid),
                    CAST(:fleet_id AS uuid),
                    CAST(:project_id AS uuid),
                    CAST(:assignment_id AS uuid),
                    :occurred_on,
                    :operating_hours,
                    :idle_hours,
                    :breakdown_hours,
                    :weather_hours,
                    :output_quantity,
                    :output_unit,
                    :work_performed,
                    'approved',
                    CAST(:user_id AS uuid)
                )
                RETURNING id
            """),
            {
                "org_id": str(org_id),
                "fleet_id": str(fleet_id),
                "project_id": str(project_id),
                "assignment_id": assignment_id,
                "occurred_on": occurred_on,
                "operating_hours": operating_hours,
                "idle_hours": idle_hours,
                "breakdown_hours": breakdown_hours,
                "weather_hours": weather_hours,
                "output_quantity": output_quantity,
                "output_unit": output_unit,
                "work_performed": work_performed,
                "user_id": str(user_id),
            },
        )
    ).first()

    fuel_id = None
    if fuel_litres > 0:
        fuel_row = (
            await db.execute(
                text("""
                    INSERT INTO fleet.fuel_transactions (
                        organization_id,
                        fleet_id,
                        project_id,
                        assignment_id,
                        fuel_type,
                        quantity_litres,
                        recorded_by
                    ) VALUES (
                        CAST(:org_id AS uuid),
                        CAST(:fleet_id AS uuid),
                        CAST(:project_id AS uuid),
                        CAST(:assignment_id AS uuid),
                        'Diesel 50ppm',
                        :quantity_litres,
                        CAST(:user_id AS uuid)
                    )
                    RETURNING id
                """),
                {
                    "org_id": str(org_id),
                    "fleet_id": str(fleet_id),
                    "project_id": str(project_id),
                    "assignment_id": assignment_id,
                    "quantity_litres": fuel_litres,
                    "user_id": str(user_id),
                },
            )
        )
        fuel_id = str(fuel_row.first()[0])

    await db.commit()

    return {
        "utilization_id": str(util_row[0]),
        "fuel_transaction_id": fuel_id,
        "message": "Plant shift log and fuel recorded successfully.",
    }
