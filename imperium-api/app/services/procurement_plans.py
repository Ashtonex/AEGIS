"""Procurement plans: what a job needs to buy, driven by its lifecycle.

One plan per opportunity, carried to the project when the deal is won.

    planning     BOQ uploaded on the opportunity -> plan pre-filled from the BOQ
    sourcing     deal won -> plan seeded as an active (draft) purchase request
    ordering     project pending deposit
    executing    deposit confirmed (pre-mobilisation)
    reconciling  project completed

sync_procurement_plan() is the single entry point: it finds or creates the
plan, moves it to the stage the record is actually at, and issues every
stage's task pack up to there through the existing task engine (packs are
de-duplicated, so syncing again never duplicates tasks). Like
generate_task_stack(), call it AFTER the caller's commit; it never raises.
"""

from __future__ import annotations

import json
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation
from typing import Any, Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from core.logging import logger

STAGES = ["planning", "sourcing", "ordering", "executing", "reconciling"]

# BOQ lines measured in these units are likely things to buy. Lump sums,
# items, weeks, trips and percentages are not.
MATERIAL_UNITS = {
    "kg", "t", "ton", "tonne", "tonnes", "m", "lm", "m2", "m²", "sqm", "m3", "m³", "cube", "cubes",
    "no", "no.", "nr", "nos", "each", "ea", "pcs", "pc", "bag", "bags", "sheet", "sheets", "length",
    "lengths", "roll", "rolls", "litre", "litres", "l", "box", "boxes", "set", "sets", "pair", "pairs",
}


def _decimal(value: Any) -> Decimal:
    try:
        return Decimal(str(value).replace(",", "").strip() or "0")
    except (InvalidOperation, ValueError):
        return Decimal("0")


def boq_material_lines(items: Any) -> list[dict[str, Any]]:
    """BOQ lines worth carrying into the plan as a starting point: a measured
    quantity in a material-type unit. Procurement turns these into the real
    materials list (the BOQ describes work, not purchases)."""
    if isinstance(items, str):
        try:
            items = json.loads(items)
        except json.JSONDecodeError:
            return []
    out: list[dict[str, Any]] = []
    for item in items or []:
        if not isinstance(item, dict) or item.get("item_type") == "note":
            continue
        description = str(item.get("description") or "").strip()
        unit = str(item.get("unit") or "").strip().lower()
        qty = _decimal(item.get("quantity", item.get("qty")))
        if not description or qty <= 0 or unit not in MATERIAL_UNITS:
            continue
        ref = " ".join(str(item.get(k) or "").strip() for k in ("section", "item_no")).strip()
        out.append({
            "description": description[:500],
            "quantity": qty,
            "unit_of_measure": (item.get("unit") or "each")[:40],
            "source_ref": ref[:120] or None,
        })
    return out


async def _stage_for(db: AsyncSession, org_id: str, plan: dict[str, Any]) -> str:
    if plan.get("project_id"):
        project = (
            await db.execute(
                text("""
                    SELECT status, deposit_confirmed_at
                    FROM projects.projects
                    WHERE id = :id AND organization_id = :org_id
                """),
                {"id": plan["project_id"], "org_id": org_id},
            )
        ).mappings().first()
        if project:
            status = (project["status"] or "").lower()
            if status == "completed":
                return "reconciling"
            if project["deposit_confirmed_at"] or status == "active":
                return "executing"
            if status == "pending_deposit":
                return "ordering"
        return "sourcing"
    if plan.get("opportunity_id"):
        won = (
            await db.execute(
                text("""
                    SELECT 1 FROM crm.opportunities
                    WHERE id = :id AND organization_id = :org_id
                      AND (lower(COALESCE(win_loss_status, '')) = 'won' OR lower(COALESCE(stage, '')) = 'won')
                """),
                {"id": plan["opportunity_id"], "org_id": org_id},
            )
        ).first()
        return "sourcing" if won else "planning"
    return "planning"


async def _find_plan(db: AsyncSession, org_id: str, opportunity_id: Optional[str], project_id: Optional[str]) -> Optional[dict]:
    row = (
        await db.execute(
            text("""
                SELECT * FROM procurement.procurement_plans
                WHERE organization_id = :org_id AND is_deleted = false
                  AND ((CAST(:project_id AS uuid) IS NOT NULL AND project_id = CAST(:project_id AS uuid))
                    OR (CAST(:opportunity_id AS uuid) IS NOT NULL AND opportunity_id = CAST(:opportunity_id AS uuid)))
                ORDER BY (project_id IS NOT NULL) DESC
                LIMIT 1
            """),
            {"org_id": org_id, "project_id": project_id, "opportunity_id": opportunity_id},
        )
    ).mappings().first()
    return dict(row) if row else None


async def _latest_boq_quotation(db: AsyncSession, org_id: str, opportunity_id: Optional[str], project_id: Optional[str]) -> Optional[dict]:
    row = (
        await db.execute(
            text("""
                SELECT id, metadata FROM finance.quotations
                WHERE organization_id = :org_id AND is_deleted = false
                  AND ((CAST(:opportunity_id AS uuid) IS NOT NULL AND opportunity_id = CAST(:opportunity_id AS uuid))
                    OR (CAST(:project_id AS uuid) IS NOT NULL AND project_id = CAST(:project_id AS uuid)))
                  AND jsonb_typeof(metadata->'items') = 'array'
                ORDER BY (status = 'won') DESC, updated_at DESC
                LIMIT 1
            """),
            {"org_id": org_id, "opportunity_id": opportunity_id, "project_id": project_id},
        )
    ).mappings().first()
    return dict(row) if row else None


async def _create_plan(db: AsyncSession, *, org_id: str, user_id: Optional[str], opportunity_id: Optional[str], project_id: Optional[str]) -> dict:
    title_row = (
        await db.execute(
            text("""
                SELECT COALESCE(
                    (SELECT name FROM projects.projects WHERE id = CAST(:project_id AS uuid)),
                    (SELECT name FROM crm.opportunities WHERE id = CAST(:opportunity_id AS uuid)),
                    'Procurement plan'
                )
            """),
            {"project_id": project_id, "opportunity_id": opportunity_id},
        )
    ).scalar()
    quotation = await _latest_boq_quotation(db, org_id, opportunity_id, project_id)
    plan = (
        await db.execute(
            text("""
                INSERT INTO procurement.procurement_plans (
                    organization_id, opportunity_id, project_id, quotation_id, title, created_by
                ) VALUES (:org_id, :opportunity_id, :project_id, :quotation_id, :title, :user_id)
                RETURNING *
            """),
            {
                "org_id": org_id, "opportunity_id": opportunity_id, "project_id": project_id,
                "quotation_id": quotation["id"] if quotation else None,
                "title": str(title_row)[:255], "user_id": user_id,
            },
        )
    ).mappings().one()
    if quotation:
        for index, line in enumerate(boq_material_lines(quotation["metadata"].get("items") if isinstance(quotation["metadata"], dict) else None)):
            await db.execute(
                text("""
                    INSERT INTO procurement.procurement_plan_items (
                        organization_id, plan_id, description, quantity, unit_of_measure,
                        source, source_ref, sort_order, created_by
                    ) VALUES (:org_id, :plan_id, :description, :quantity, :uom, 'boq', :source_ref, :sort_order, :user_id)
                """),
                {
                    "org_id": org_id, "plan_id": plan["id"], "description": line["description"],
                    "quantity": line["quantity"], "uom": line["unit_of_measure"], "source_ref": line["source_ref"],
                    "sort_order": (index + 1) * 10, "user_id": user_id,
                },
            )
    return dict(plan)


async def _seed_requisition(db: AsyncSession, *, org_id: str, user_id: Optional[str], plan: dict) -> Optional[str]:
    """The won deal's plan becomes active procurement: a draft purchase
    request with the plan's items, created through the normal requisition
    path (numbering, weekly budget, budget check, event)."""
    if plan.get("requisition_id") or not plan.get("project_id"):
        return None
    items = (
        await db.execute(
            text("""
                SELECT description, quantity, unit_of_measure, budget_unit_cost
                FROM procurement.procurement_plan_items
                WHERE plan_id = :plan_id AND organization_id = :org_id AND is_deleted = false AND quantity > 0
                ORDER BY sort_order, created_at
            """),
            {"plan_id": plan["id"], "org_id": org_id},
        )
    ).mappings().all()
    if not items:
        return None
    from routers.procurement import RequisitionLinePayload, insert_requisition

    start = (
        await db.execute(text("SELECT start_date FROM projects.projects WHERE id = :id"), {"id": plan["project_id"]})
    ).scalar()
    needed_by = start if isinstance(start, date) and start > date.today() else date.today() + timedelta(days=14)
    lines = [
        RequisitionLinePayload.model_construct(
            item_id=None, description=row["description"], qty=Decimal(str(row["quantity"])),
            uom=row["unit_of_measure"] or "each", unit_cost=Decimal(str(row["budget_unit_cost"] or 0)),
            work_package=None, notes="From the procurement plan",
        )
        for row in items
    ]
    actor = {"org_id": org_id, "user_id": user_id, "sub": user_id}
    req_id, _ = await insert_requisition(
        db, user=actor, project_id=plan["project_id"], site_id=None, cost_code_id=None,
        required_by_date=needed_by, priority="normal",
        justification=f"Procurement plan: {plan['title']}", line_items=lines,
    )
    await db.execute(
        text("UPDATE procurement.procurement_plans SET requisition_id = :req_id, updated_at = NOW() WHERE id = :id"),
        {"req_id": req_id, "id": plan["id"]},
    )
    return str(req_id)


async def sync_procurement_plan(
    db: AsyncSession,
    *,
    org_id: str,
    user_id: Optional[str],
    opportunity_id: Optional[str] = None,
    project_id: Optional[str] = None,
    create: bool = True,
) -> Optional[str]:
    """Bring a job's procurement plan and its task packs up to date. Returns
    the plan id (None if there is no plan and create=False). Never raises."""
    from app.shared.task_stacks import generate_task_stack

    try:
        opportunity_id = str(opportunity_id) if opportunity_id else None
        project_id = str(project_id) if project_id else None
        if project_id and not opportunity_id:
            opportunity_id = (
                await db.execute(
                    text("SELECT CAST(opportunity_id AS text) FROM projects.projects WHERE id = :id AND organization_id = :org_id"),
                    {"id": project_id, "org_id": org_id},
                )
            ).scalar()
        plan = await _find_plan(db, org_id, opportunity_id, project_id)
        if not plan:
            if not create:
                return None
            plan = await _create_plan(db, org_id=org_id, user_id=user_id, opportunity_id=opportunity_id, project_id=project_id)
        elif project_id and not plan.get("project_id"):
            # Deal won: the opportunity's plan now belongs to the project too.
            await db.execute(
                text("UPDATE procurement.procurement_plans SET project_id = :project_id, updated_at = NOW() WHERE id = :id"),
                {"project_id": project_id, "id": plan["id"]},
            )
            plan["project_id"] = project_id

        target = await _stage_for(db, org_id, plan)
        current = plan.get("stage") or "planning"
        if current in STAGES and STAGES.index(target) > STAGES.index(current):
            await db.execute(
                text("UPDATE procurement.procurement_plans SET stage = :stage, updated_at = NOW() WHERE id = :id"),
                {"stage": target, "id": plan["id"]},
            )
            current = target
        if STAGES.index(current) >= STAGES.index("sourcing"):
            await _seed_requisition(db, org_id=org_id, user_id=user_id, plan=plan)
        await db.commit()

        reached = STAGES[: STAGES.index(current) + 1] if current in STAGES else STAGES
        for stage in reached:
            await generate_task_stack(
                db, org_id=org_id, entity_type="procurement_plan", entity_id=plan["id"],
                created_by=user_id, stage=stage,
                source_event="procurement_plan_stage", generation_reason=f"procurement plan reached {stage}",
            )
        return str(plan["id"])
    except Exception as exc:  # noqa: BLE001 - a plan must never block the lifecycle action that triggered it
        await db.rollback()
        logger.warning("procurement_plan.sync_failed", org_id=org_id, project_id=project_id, opportunity_id=opportunity_id, error=str(exc))
        return None
