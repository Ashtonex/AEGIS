"""Programme rollout: when a project mobilises, its schedule becomes its weeks.

Schedule activities that point at a BOQ line (project_milestones.boq_line_item_id)
carry the work the site must deliver. rollout_programme():

    1. re-baselines the programme to the mobilisation date (only while nothing
       has started), then recalculates the critical path
    2. spreads each linked activity's BOQ quantity evenly over the working days
       (Mon-Fri) between its early start and early finish
    3. writes one submitted weekly budget per week (generated_by_rollout) with a
       line per activity, and one daily target per activity per working day

A week the site already has a budget for is left alone, so running it again
only fills weeks that are still missing. Like sync_procurement_plan(), call it
AFTER the caller's commit; it never raises.
"""

from __future__ import annotations

import json
from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from core.logging import logger

WORKING_DAYS = {0, 1, 2, 3, 4}  # Mon-Fri
BUDGET_COLUMNS = {
    "labour": "labour_budget",
    "materials": "materials_budget",
    "equipment": "equipment_budget",
    "subcontract": "subcontract_budget",
}


def _as_date(value: Any) -> Optional[date]:
    if isinstance(value, date):
        return value
    if isinstance(value, str) and value:
        return date.fromisoformat(value[:10])
    return None


def activity_days(start: date, finish: date) -> list[date]:
    """Working days an activity occupies: early_start up to (not including)
    early_finish. An activity that sits wholly on a weekend keeps its days."""
    span = [start + timedelta(days=i) for i in range(max((finish - start).days, 1))]
    working = [d for d in span if d.weekday() in WORKING_DAYS]
    return working or span


def split_evenly(total: Decimal, parts: int, places: str) -> list[Decimal]:
    """Even split whose last part takes the rounding remainder, so the parts
    always add back to the total."""
    quantum = Decimal(places)
    each = (total / parts).quantize(quantum)
    return [each] * (parts - 1) + [total - each * (parts - 1)]


def plan_weeks(activities: list[dict[str, Any]]) -> dict[date, list[dict[str, Any]]]:
    """Week start (Monday) -> that week's activity lines, each with its daily
    quantities and amounts."""
    weeks: dict[date, dict[str, dict[str, Any]]] = defaultdict(dict)
    for act in activities:
        start, finish = _as_date(act["early_start"]), _as_date(act["early_finish"])
        qty = Decimal(str(act["contract_qty"] or 0))
        rate = Decimal(str(act["rate"] or 0))
        if not start or not finish or qty <= 0:
            continue
        days = activity_days(start, finish)
        day_qty = split_evenly(qty, len(days), "0.001")
        day_amount = split_evenly((qty * rate).quantize(Decimal("0.01")), len(days), "0.01")
        for d, q, a in zip(days, day_qty, day_amount):
            week = d - timedelta(days=d.weekday())
            line = weeks[week].setdefault(str(act["id"]), {**act, "days": []})
            line["days"].append({"date": d, "qty": q, "amount": a})
    return {week: list(lines.values()) for week, lines in sorted(weeks.items())}


async def _rebaseline(db: AsyncSession, *, org_id: str, project_id: str, mobilisation_date: date) -> int:
    """Shift the whole programme so it starts on the mobilisation date. Done
    only while no activity has started; returns the shift in days."""
    row = (
        await db.execute(
            text("""
                SELECT MIN(baseline_date) AS first_start,
                       COUNT(*) FILTER (WHERE status <> 'not_started' OR COALESCE(percent_complete, 0) > 0) AS started
                FROM projects.project_milestones
                WHERE organization_id = :org_id AND project_id = :project_id
                  AND is_deleted = false AND status <> 'cancelled'
            """),
            {"org_id": org_id, "project_id": project_id},
        )
    ).mappings().first()
    if not row or not row["first_start"] or row["started"]:
        return 0
    shift = (mobilisation_date - row["first_start"]).days
    if shift:
        await db.execute(
            text("""
                UPDATE projects.project_milestones
                SET baseline_date = baseline_date + CAST(:shift AS integer),
                    forecast_date = forecast_date + CAST(:shift AS integer),
                    updated_at = NOW()
                WHERE organization_id = :org_id AND project_id = :project_id
                  AND is_deleted = false AND baseline_date IS NOT NULL
            """),
            {"shift": shift, "org_id": org_id, "project_id": project_id},
        )
    return shift


async def _site_for(db: AsyncSession, *, org_id: str, project_id: str, user_id: Optional[str]) -> str:
    site_id = (
        await db.execute(
            text("""
                SELECT id FROM projects.sites
                WHERE organization_id = :org_id AND project_id = :project_id AND is_deleted = false
                ORDER BY (status = 'active') DESC, created_at
                LIMIT 1
            """),
            {"org_id": org_id, "project_id": project_id},
        )
    ).scalar()
    if site_id:
        return str(site_id)
    return str(
        (
            await db.execute(
                text("""
                    INSERT INTO projects.sites (organization_id, project_id, site_code, name, status, created_by)
                    VALUES (:org_id, :project_id, 'MAIN', 'Main site', 'active', :user_id)
                    RETURNING id
                """),
                {"org_id": org_id, "project_id": project_id, "user_id": user_id},
            )
        ).scalar()
    )


async def rollout_programme(
    db: AsyncSession,
    *,
    org_id: str,
    project_id: str,
    user_id: Optional[str],
    mobilisation_date: Optional[date] = None,
) -> dict[str, Any]:
    """Re-baseline the programme and generate its weekly budgets and daily
    targets. Returns a summary; never raises."""
    from app.services.project_cpm import recalculate_and_persist_project_cpm

    org_id, project_id = str(org_id), str(project_id)
    try:
        shift = 0
        if mobilisation_date:
            shift = await _rebaseline(db, org_id=org_id, project_id=project_id, mobilisation_date=mobilisation_date)
        await recalculate_and_persist_project_cpm(db, org_id, project_id)  # commits

        activities = (
            await db.execute(
                text("""
                    SELECT m.id, m.name, m.early_start, m.early_finish,
                           b.id AS boq_line_item_id, b.item_no, b.description AS boq_description,
                           b.unit, b.contract_qty, b.rate, b.cost_category,
                           GREATEST(b.contract_qty - b.qty_measured_to_date, 0) AS available_qty
                    FROM projects.project_milestones m
                    JOIN finance.boq_line_items b
                      ON b.id = m.boq_line_item_id AND b.organization_id = m.organization_id
                     AND b.is_deleted = false AND b.status = 'active'
                    WHERE m.organization_id = :org_id AND m.project_id = :project_id
                      AND m.is_deleted = false AND m.status <> 'cancelled'
                    ORDER BY m.early_start, b.sort_order
                """),
                {"org_id": org_id, "project_id": project_id},
            )
        ).mappings().all()
        weeks = plan_weeks([dict(a) for a in activities])
        if not weeks:
            return {"rebaselined_days": shift, "weeks_created": 0, "weeks_skipped": 0, "daily_targets": 0,
                    "message": "No schedule activities are linked to BOQ lines yet."}

        site_id = await _site_for(db, org_id=org_id, project_id=project_id, user_id=user_id)
        source_budget_id = (
            await db.execute(
                text("""
                    SELECT id FROM finance.project_budgets
                    WHERE organization_id = :org_id AND project_id = :project_id
                      AND status = 'approved' AND is_deleted = false
                    ORDER BY effective_date DESC, budget_version DESC
                    LIMIT 1
                """),
                {"org_id": org_id, "project_id": project_id},
            )
        ).scalar()

        created = skipped = targets = 0
        for week_start, lines in weeks.items():
            by_column: dict[str, Decimal] = defaultdict(Decimal)
            total = Decimal("0")
            for line in lines:
                amount = sum((d["amount"] for d in line["days"]), Decimal("0"))
                total += amount
                column = BUDGET_COLUMNS.get(line["cost_category"] or "")
                if column:
                    by_column[column] += amount
            work_plan = "\n".join(
                f"{line['item_no'] or ''} {line['name']} "
                f"({line['days'][0]['date']:%a %d %b} - {line['days'][-1]['date']:%a %d %b})".strip()
                for line in lines
            )
            budget_id = (
                await db.execute(
                    text("""
                        INSERT INTO projects.weekly_budgets (
                            organization_id, project_id, site_id, week_start, status,
                            labour_budget, materials_budget, equipment_budget, subcontract_budget,
                            work_plan, notes, source_budget_id, total_planned_amount,
                            generated_by_rollout, submitted_at, submitted_by, created_by
                        ) VALUES (
                            :org_id, :project_id, :site_id, :week_start, 'submitted',
                            :labour_budget, :materials_budget, :equipment_budget, :subcontract_budget,
                            :work_plan, :notes, CAST(:source_budget_id AS uuid), :total,
                            true, NOW(), :user_id, :user_id
                        )
                        ON CONFLICT (organization_id, project_id, site_id, week_start) DO NOTHING
                        RETURNING id
                    """),
                    {
                        "org_id": org_id, "project_id": project_id, "site_id": site_id, "week_start": week_start,
                        "labour_budget": by_column["labour_budget"], "materials_budget": by_column["materials_budget"],
                        "equipment_budget": by_column["equipment_budget"],
                        "subcontract_budget": by_column["subcontract_budget"],
                        "work_plan": work_plan,
                        "notes": "Generated from the programme on mobilisation. Site agent reviews and approves.",
                        "source_budget_id": str(source_budget_id) if source_budget_id else None,
                        "total": total, "user_id": user_id,
                    },
                )
            ).scalar()
            if not budget_id:
                skipped += 1
                continue
            created += 1
            for line in lines:
                week_qty = sum((d["qty"] for d in line["days"]), Decimal("0"))
                week_amount = sum((d["amount"] for d in line["days"]), Decimal("0"))
                item_id = (
                    await db.execute(
                        text("""
                            INSERT INTO projects.weekly_budget_items (
                                organization_id, weekly_budget_id, project_id, boq_line_item_id, work_package,
                                description, unit, planned_qty, available_qty, planned_amount, cost_category,
                                variance_required, status, notes, created_by
                            ) VALUES (
                                :org_id, :budget_id, :project_id, :boq_line_item_id, :work_package,
                                :description, :unit, :planned_qty, :available_qty, :planned_amount, :cost_category,
                                false, 'planned', :notes, :user_id
                            ) RETURNING id
                        """),
                        {
                            "org_id": org_id, "budget_id": budget_id, "project_id": project_id,
                            "boq_line_item_id": line["boq_line_item_id"], "work_package": line["item_no"],
                            "description": line["name"], "unit": line["unit"], "planned_qty": week_qty,
                            "available_qty": line["available_qty"], "planned_amount": week_amount,
                            "cost_category": line["cost_category"],
                            "notes": f"Programme activity, {len(line['days'])} working day(s) this week",
                            "user_id": user_id,
                        },
                    )
                ).scalar()
                for day in line["days"]:
                    await db.execute(
                        text("""
                            INSERT INTO projects.site_daily_targets (
                                organization_id, project_id, weekly_budget_id, weekly_budget_item_id, target_date,
                                work_package, description, unit, target_qty, planned_amount, created_by
                            ) VALUES (:org_id, :project_id, :budget_id, :item_id, :d, :wp, :descr, :unit, :qty, :amount, :user_id)
                        """),
                        {
                            "org_id": org_id, "project_id": project_id, "budget_id": budget_id, "item_id": item_id,
                            "d": day["date"], "wp": line["item_no"], "descr": line["name"], "unit": line["unit"],
                            "qty": day["qty"], "amount": day["amount"], "user_id": user_id,
                        },
                    )
                    targets += 1

        summary = {
            "rebaselined_days": shift, "site_id": site_id, "weeks_created": created,
            "weeks_skipped": skipped, "daily_targets": targets,
        }
        await db.execute(
            text("""
                INSERT INTO core.domain_events (
                    organization_id, event_type, schema_version, aggregate_type, aggregate_id,
                    project_id, actor_id, idempotency_key, payload
                ) VALUES (
                    :org_id, 'project.programme_rolled_out.v1', 1, 'project', :project_id,
                    :project_id, :user_id, :key, CAST(:payload AS jsonb)
                ) ON CONFLICT (organization_id, idempotency_key) DO NOTHING
            """),
            {
                "org_id": org_id, "project_id": project_id, "user_id": user_id,
                "key": f"project.programme_rolled_out.v1:{project_id}:{date.today().isoformat()}:{created}",
                "payload": json.dumps(summary, default=str),
            },
        )
        await db.commit()
        return summary
    except Exception as exc:  # noqa: BLE001 - rollout must never undo an authorised mobilisation
        await db.rollback()
        logger.warning("programme_rollout.failed", org_id=org_id, project_id=project_id, error=str(exc))
        return {"error": str(exc)}
