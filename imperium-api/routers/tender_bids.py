import json
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Dict, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from sqlalchemy.exc import DataError, IntegrityError

from core.database import get_db
from core.security import get_current_user, is_self_certification, require_permission, SUPERADMIN_ROLE
from app.services.finance.department_transfers import post_department_transfer
from app.services.finance.project_forecast import (
    check_and_alert_margin_threat,
    refresh_project_forecast,
    seed_boq_line_items_from_quotation,
    seed_project_budget_from_quotation,
)
from app.services.quotations.calculator import QuotationCalculator, build_calc_input_from_metadata
from app.shared.events import emit_event, emit_notification
from app.shared.task_stacks import generate_task_stack, cascade_delete_entity_tasks
from app.shared.pursuits import get_or_create_pursuit
from app.shared.sql import (
    insert_returning_id_sql,
    safe_payload_columns,
    tenant_reference_sql,
    update_returning_id_sql,
)

"""
Module: tender_bids
Description: Auto-generated CRUD endpoints for crm.tenders, plus the
tender-award project handoff (see award_tender below).
"""

router = APIRouter()


async def _single_row(db: AsyncSession, sql: str, params: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    row = (await db.execute(text(sql), params)).first()
    return dict(row._mapping) if row else None


# asyncpg binds parameters directly (no string-to-timestamptz coercion like
# psycopg does), so an ISO string from the frontend fails DataError against
# this table's one timestamptz column unless parsed here first.
_TIMESTAMPTZ_COLUMNS = {"submission_deadline"}


def _coerce_timestamptz_columns(params: dict) -> None:
    for column in _TIMESTAMPTZ_COLUMNS:
        value = params.get(column)
        if isinstance(value, str):
            params[column] = datetime.fromisoformat(value.replace("Z", "+00:00"))


@router.get("/")
async def list_items(
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("tender_bids.read")),
):
    # Fetch active records scoped to the user's organization
    query = text("""
        SELECT *
        FROM crm.tenders
        WHERE organization_id = :org_id AND is_deleted = false
        ORDER BY created_at DESC
        LIMIT 100
    """)
    result = await db.execute(query, {"org_id": user["org_id"]})
    items = [dict(row._mapping) for row in result]

    return {
        "success": True,
        "data": items,
        "message": "tender_bids listed.",
        "meta": {"total": len(items)},
    }


@router.post("/")
async def create_item(
    request: Request,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("tender_bids.create")),
):
    payload = await request.json()

    # Extract keys and values from JSON payload dynamically
    # Exclude reserved keys to prevent override
    safe_keys = safe_payload_columns(payload.keys())

    if not safe_keys:
        raise HTTPException(status_code=400, detail="Empty or invalid payload.")

    params = {k: payload[k] for k in safe_keys}
    params["org_id"] = user["org_id"]
    params["user_id"] = user["sub"]
    _coerce_timestamptz_columns(params)

    query = insert_returning_id_sql("crm.tenders", safe_keys, safe_keys)

    try:
        result = await db.execute(query, params)
        await db.commit()
        new_id = str(result.scalar())
        return {
            "success": True,
            "data": {"id": new_id},
            "message": "tender_bids created.",
            "meta": {},
        }
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


@router.get("/{item_id}")
async def get_item(
    item_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("tender_bids.read")),
):
    query = text("""
        SELECT *
        FROM crm.tenders
        WHERE id = :item_id AND organization_id = :org_id AND is_deleted = false
    """)
    result = await db.execute(query, {"item_id": item_id, "org_id": user["org_id"]})
    item = result.first()

    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    return {
        "success": True,
        "data": dict(item._mapping),
        "message": "tender_bids retrieved.",
        "meta": {},
    }


@router.put("/{item_id}")
async def update_item(
    item_id: str,
    request: Request,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("tender_bids.update")),
):
    payload = await request.json()
    safe_keys = safe_payload_columns(payload.keys())

    if not safe_keys:
        return {
            "success": True,
            "data": {"id": item_id},
            "message": "No fields to update.",
        }

    params = {k: payload[k] for k in safe_keys}
    params["item_id"] = item_id
    params["org_id"] = user["org_id"]
    _coerce_timestamptz_columns(params)

    query = update_returning_id_sql("crm.tenders", safe_keys, safe_keys)

    try:
        result = await db.execute(query, params)
        if not result.first():
            raise HTTPException(status_code=404, detail="Item not found")

        await db.commit()
        return {
            "success": True,
            "data": {"id": item_id},
            "message": "tender_bids updated.",
            "meta": {},
        }
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


@router.delete("/{item_id}")
async def delete_item(
    item_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("tender_bids.delete")),
):
    query = text("""
        UPDATE crm.tenders
        SET is_deleted = true, updated_at = NOW()
        WHERE id = :item_id AND organization_id = :org_id
        RETURNING id
    """)

    result = await db.execute(query, {"item_id": item_id, "org_id": user["org_id"]})
    if not result.first():
        raise HTTPException(status_code=404, detail="Item not found")

    await db.commit()
    await cascade_delete_entity_tasks(db, org_id=user["org_id"], entity_type="tender", entity_id=item_id)
    return {
        "success": True,
        "data": None,
        "message": "tender_bids deleted (soft delete).",
        "meta": {},
    }


# ----------------------------------------------------------------------------
# Award: the tender-side counterpart to crm.py's mark_opportunity_won. Turns
# a won tender into a real projects.projects row and, when a quotation is
# linked, seeds its execution budget/BOQ/forecast the same way - these were
# two disconnected systems before this (crm.tenders.project_id has existed
# since migration 005 but nothing ever wrote to it).
# ----------------------------------------------------------------------------

class TenderAwardPayload(BaseModel):
    project_id: Optional[UUID] = None
    create_project: bool = True
    project_code: Optional[str] = Field(default=None, max_length=80)
    project_type: Optional[str] = Field(default=None, max_length=100)
    client_name: Optional[str] = Field(default=None, max_length=255)
    start_date: Optional[date] = None
    planned_completion_date: Optional[date] = None
    department_id: Optional[UUID] = None
    originating_department_id: Optional[UUID] = None


@router.post("/{tender_id}/award")
async def award_tender(
    tender_id: UUID,
    payload: TenderAwardPayload,
    # Deliberately a stricter permission than tender_bids.update: this path
    # can create a real projects.projects row with a real contract value -
    # see crm.opportunities.close_won, which this mirrors.
    user: dict = Depends(require_permission("tender_bids.award")),
    db: AsyncSession = Depends(get_db),
):
    org_id = user["org_id"]
    user_id = user["sub"]

    tender = await _single_row(
        db,
        """
        SELECT t.*, q.id AS latest_quote_id, q.quote_amount, q.metadata AS latest_quote_metadata,
               q.created_by AS latest_quote_created_by
        FROM crm.tenders t
        LEFT JOIN LATERAL (
            SELECT id, quote_amount, metadata, created_by
            FROM finance.quotations
            WHERE organization_id = t.organization_id AND tender_id = t.id AND is_deleted = false
            ORDER BY created_at DESC
            LIMIT 1
        ) q ON true
        WHERE t.id = :tender_id AND t.organization_id = :org_id AND t.is_deleted = false
        """,
        {"tender_id": tender_id, "org_id": org_id},
    )
    if not tender:
        raise HTTPException(status_code=404, detail="Tender not found.")
    if tender.get("project_id"):
        raise HTTPException(status_code=400, detail="Tender has already been awarded to a project.")

    project_id = payload.project_id
    budget_id = None
    forecast_metrics = None
    margin_alert_raised = False
    budget_pending_reason = None
    contract_value = tender.get("quote_amount") or tender.get("bid_amount")

    try:
        if not project_id and payload.create_project:
            project_row = await db.execute(
                text("""
                    INSERT INTO projects.projects (
                        organization_id, created_by, name, status, project_code, project_type,
                        client_name, contract_value, start_date, planned_completion_date,
                        tender_id, department_id, originating_department_id, contract_signed_at, contract_signed_by
                    )
                    VALUES (
                        :org_id, :user_id, :name, 'pending_deposit', :project_code, :project_type,
                        :client_name, :contract_value, :start_date, :planned_completion_date,
                        :tender_id, :department_id, :originating_department_id, NOW(), :user_id
                    )
                    RETURNING id
                """),
                {
                    "org_id": org_id,
                    "user_id": user_id,
                    "name": tender.get("tender_name"),
                    "project_code": payload.project_code,
                    "project_type": payload.project_type,
                    "client_name": payload.client_name,
                    "contract_value": contract_value,
                    "start_date": payload.start_date,
                    "planned_completion_date": payload.planned_completion_date,
                    "tender_id": tender_id,
                    "department_id": payload.department_id,
                    "originating_department_id": payload.originating_department_id,
                },
            )
            project_id = project_row.scalar()

        await db.execute(
            text("""
                UPDATE crm.tenders
                SET stage = 'Awarded', project_id = :project_id, updated_at = NOW()
                WHERE id = :tender_id AND organization_id = :org_id AND is_deleted = false
            """),
            {"project_id": project_id, "tender_id": tender_id, "org_id": org_id},
        )

        if tender.get("latest_quote_id"):
            await db.execute(
                text("""
                    UPDATE finance.quotations
                    SET status = 'accepted', project_id = COALESCE(project_id, :project_id), updated_at = NOW()
                    WHERE id = :quote_id AND organization_id = :org_id
                """),
                {"quote_id": tender.get("latest_quote_id"), "project_id": project_id, "org_id": org_id},
            )

            # Same segregation-of-duties guard as mark_opportunity_won: whoever
            # authored the quotation cannot also be the one whose award
            # confirmation commits its budget.
            if project_id:
                if user.get("role") != SUPERADMIN_ROLE and is_self_certification(
                    user_id, tender.get("latest_quote_created_by")
                ):
                    budget_pending_reason = (
                        "You authored this quotation and cannot also be the one whose "
                        "award confirmation commits its budget - get an independent "
                        "commercial sign-off via Quotations > Decision."
                    )
                else:
                    try:
                        async with db.begin_nested():
                            metadata = tender.get("latest_quote_metadata") or {}
                            if isinstance(metadata, str):
                                metadata = json.loads(metadata)
                            calc_input = build_calc_input_from_metadata(
                                str(tender.get("latest_quote_id")), metadata
                            )
                            calculation = QuotationCalculator.calculate(calc_input)
                            direct_costs_total = sum(
                                float(v or 0)
                                for v in (calculation.breakdown_log.get("direct_costs_breakdown") or {}).values()
                            )
                            execution_total = (
                                direct_costs_total
                                + float(calculation.preliminaries or 0)
                                + float(calculation.overhead_amount or 0)
                                + float(calculation.contingency_amount or 0)
                            )
                            if not metadata.get("items") or execution_total <= 0:
                                budget_pending_reason = (
                                    "Quotation has no priced line items - price the BOQ, "
                                    "then confirm via Quotations > Decision."
                                )
                            else:
                                budget_id = await seed_project_budget_from_quotation(
                                    db, org_id, str(project_id), str(tender.get("latest_quote_id")),
                                    calculation, created_by=user_id,
                                )
                                await seed_boq_line_items_from_quotation(
                                    db, org_id, str(project_id), str(tender.get("latest_quote_id")),
                                    metadata, created_by=user_id,
                                )
                                forecast_metrics = await refresh_project_forecast(
                                    db, org_id, str(project_id), computed_by=user_id,
                                )
                                if forecast_metrics:
                                    margin_alert_raised = await check_and_alert_margin_threat(
                                        db, org_id, str(project_id), forecast_metrics,
                                    )
                    except Exception:
                        budget_id = None
                        forecast_metrics = None
                        budget_pending_reason = (
                            "Budget could not be seeded automatically - confirm via "
                            "Quotations > Decision instead."
                        )

        # Commercial-sourced referral credit, mirroring crm.py's opportunity_won
        # block: fires only if a matching finance.department_transfer_rules row
        # exists for trigger_event='tender_won' - no rule means no-op.
        if project_id and payload.originating_department_id:
            try:
                async with db.begin_nested():
                    delivering_row = await db.execute(
                        text("SELECT department_id FROM projects.projects WHERE id = :id AND organization_id = :org_id"),
                        {"id": project_id, "org_id": org_id},
                    )
                    delivering_row = delivering_row.first()
                    delivering_department_id = delivering_row.department_id if delivering_row else None

                    if delivering_department_id and delivering_department_id != payload.originating_department_id:
                        rule_row = await db.execute(
                            text("""
                                SELECT * FROM finance.department_transfer_rules
                                WHERE organization_id = :org_id AND transfer_type = 'internal_referral'
                                  AND trigger_event = 'tender_won' AND is_active = true AND is_deleted = false
                                  AND (from_department_id = :delivering OR from_department_id IS NULL)
                                  AND (to_department_id = :originating OR to_department_id IS NULL)
                                  AND effective_from <= CURRENT_DATE
                                  AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
                                ORDER BY (from_department_id IS NOT NULL) DESC, (to_department_id IS NOT NULL) DESC
                                LIMIT 1
                            """),
                            {
                                "org_id": org_id,
                                "delivering": delivering_department_id,
                                "originating": payload.originating_department_id,
                            },
                        )
                        rule = rule_row.mappings().first()
                        if rule:
                            cv = Decimal(str(contract_value or 0))
                            if rule["basis"] == "fixed_amount" and rule["fixed_amount"]:
                                referral_amount = Decimal(str(rule["fixed_amount"]))
                            elif rule["basis"] == "percent_of_contract_value" and rule["rate"]:
                                referral_amount = cv * Decimal(str(rule["rate"])) / Decimal("100")
                            else:
                                referral_amount = Decimal("0")
                            if referral_amount > 0:
                                await post_department_transfer(
                                    db,
                                    org_id=org_id,
                                    user_id=user_id,
                                    transfer_type="internal_referral",
                                    transfer_date=date.today(),
                                    from_department_id=delivering_department_id,
                                    to_department_id=payload.originating_department_id,
                                    amount=referral_amount,
                                    description=f"Referral credit for tender: {tender.get('tender_name')}",
                                    source_type="crm_tender",
                                    source_id=tender_id,
                                    project_id=project_id,
                                    cost_category="overhead",
                                    basis={
                                        "rule_code": rule["rule_code"],
                                        "basis": rule["basis"],
                                        "rate": str(rule["rate"]) if rule["rate"] else None,
                                        "contract_value": str(cv),
                                    },
                                )
            except Exception:
                pass

        # Award Task Pack: resolve (or create, if this Tender never went
        # through Lead qualification) the pursuit spine row and mark it won,
        # in the same transaction as everything else above.
        pursuit_id = await get_or_create_pursuit(
            db,
            org_id=org_id,
            lead_id=str(tender.get("lead_id")) if tender.get("lead_id") else None,
            opportunity_id=str(tender.get("opportunity_id")) if tender.get("opportunity_id") else None,
            tender_id=str(tender_id),
            status="won",
            created_by=user_id,
        )

        await db.commit()
    except (DataError, IntegrityError) as exc:
        await db.rollback()
        raise HTTPException(status_code=400, detail="Award handoff payload violates CRM constraints.") from exc

    await emit_event(
        db,
        user=user,
        event_type="project.created_from_tender_award.v1",
        aggregate_type="project",
        aggregate_id=project_id,
        project_id=project_id,
        event_data={"tender_id": str(tender_id)},
    )
    await db.commit()

    await generate_task_stack(db, org_id=org_id, entity_type="award", entity_id=pursuit_id, created_by=user_id)

    return {
        "success": True,
        "data": {
            "id": str(tender_id),
            "project_id": str(project_id) if project_id else None,
            "budget_id": budget_id,
            "budget_seeded": budget_id is not None,
            "budget_pending_reason": budget_pending_reason,
            "forecast": forecast_metrics,
            "margin_alert_raised": margin_alert_raised,
        },
        "message": "Tender awarded and project handoff completed." + (
            " Project execution budget seeded from this quotation." if budget_id else ""
        ),
        "meta": {},
    }


# ----------------------------------------------------------------------------
# Freeform per-tender requirements checklist (crm.tender_requirements)
# ----------------------------------------------------------------------------

async def _require_tender(db: AsyncSession, tender_id: str, org_id: str) -> None:
    result = await db.execute(
        tenant_reference_sql("crm.tenders", {"crm.tenders"}),
        {"id": tender_id, "org_id": org_id},
    )
    if not result.first():
        raise HTTPException(status_code=404, detail="Tender not found")


@router.get("/{tender_id}/requirements")
async def list_requirements(
    tender_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("tender_bids.read")),
):
    await _require_tender(db, tender_id, user["org_id"])

    # Left-joined onto crm.tasks so a converted requirement (see
    # convert_requirement_to_task below) carries its task's live
    # assignee/status/due_date straight through to the checklist panel,
    # without the frontend needing a second round-trip to the Tasks API.
    query = text("""
        SELECT r.*, t.assigned_to_user_id AS task_assigned_to_user_id,
               u.full_name AS task_assigned_to_name, t.status AS task_status,
               t.due_date AS task_due_date
        FROM crm.tender_requirements r
        LEFT JOIN crm.tasks t ON t.id = r.linked_task_id
        LEFT JOIN core.users u ON u.id = t.assigned_to_user_id
        WHERE r.tender_id = :parent_id AND r.organization_id = :org_id AND r.is_deleted = false
        ORDER BY r.sort_order
    """)
    result = await db.execute(query, {"parent_id": tender_id, "org_id": user["org_id"]})
    items = [dict(row._mapping) for row in result]

    return {
        "success": True,
        "data": items,
        "message": "Tender requirements listed.",
        "meta": {"total": len(items)},
    }


@router.post("/{tender_id}/requirements")
async def create_requirement(
    tender_id: str,
    request: Request,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("tender_bids.update")),
):
    payload = await request.json()
    label = str(payload.get("label", "")).strip()
    if not label:
        raise HTTPException(status_code=400, detail="Requirement label is required.")

    await _require_tender(db, tender_id, user["org_id"])

    query = insert_returning_id_sql(
        "crm.tender_requirements",
        ["tender_id", "label"],
        ["tender_id", "label"],
    )
    result = await db.execute(
        query,
        {"tender_id": tender_id, "label": label, "org_id": user["org_id"], "user_id": user["sub"]},
    )
    await db.commit()

    return {
        "success": True,
        "data": {"id": str(result.scalar())},
        "message": "Requirement added.",
        "meta": {},
    }


@router.post("/{tender_id}/requirements/{requirement_id}/convert-to-task")
async def convert_requirement_to_task(
    tender_id: str,
    requirement_id: str,
    request: Request,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("tender_bids.update")),
):
    """Turns one checklist line into a real, assignable crm.tasks row (see
    migration 137) so it gets an owner, a due date, and shows up grouped
    under this tender on the Tasks page - deliberately a manual, per-item
    action rather than automatic, since not every requirement needs a person
    chasing it (some are satisfied by a document upload alone)."""
    payload = await request.json()
    org_id = user["org_id"]

    requirement = await _single_row(
        db,
        """
        SELECT id, label, linked_task_id FROM crm.tender_requirements
        WHERE id = :id AND tender_id = :tender_id AND organization_id = :org_id AND is_deleted = false
        """,
        {"id": requirement_id, "tender_id": tender_id, "org_id": org_id},
    )
    if not requirement:
        raise HTTPException(status_code=404, detail="Requirement not found")
    if requirement["linked_task_id"]:
        raise HTTPException(status_code=409, detail="This requirement already has a task.")

    assigned_to_user_id = payload.get("assigned_to_user_id") or None
    due_date = payload.get("due_date") or None
    priority = str(payload.get("priority") or "normal")
    if priority not in ("low", "normal", "high", "urgent"):
        raise HTTPException(status_code=400, detail="Invalid priority.")

    if assigned_to_user_id:
        assignee_check = await db.execute(
            text("SELECT 1 FROM core.users WHERE id = :id AND organization_id = :org_id AND is_deleted = false"),
            {"id": assigned_to_user_id, "org_id": org_id},
        )
        if not assignee_check.first():
            raise HTTPException(status_code=404, detail="Assignee not found.")

    task_id = (
        await db.execute(
            text("""
                INSERT INTO crm.tasks (
                    organization_id, title, entity_type, entity_id,
                    assigned_to_user_id, due_date, priority, created_by
                ) VALUES (
                    :org_id, :title, 'tender', :entity_id,
                    :assigned_to_user_id, :due_date, :priority, :user_id
                ) RETURNING id
            """),
            {
                "org_id": org_id,
                "title": requirement["label"],
                "entity_id": tender_id,
                "assigned_to_user_id": assigned_to_user_id,
                "due_date": due_date,
                "priority": priority,
                "user_id": user["sub"],
            },
        )
    ).scalar()

    await db.execute(
        text("UPDATE crm.tender_requirements SET linked_task_id = :task_id, updated_at = NOW() WHERE id = :id"),
        {"task_id": task_id, "id": requirement_id},
    )

    if assigned_to_user_id and str(assigned_to_user_id) != user["sub"]:
        await emit_notification(
            db,
            org_id=org_id,
            user_id=str(assigned_to_user_id),
            title="New task assigned to you",
            message=f'"{requirement["label"]}" was assigned to you.',
            notification_type="task",
            action_url="/dashboard/crm/tasks",
        )

    await db.commit()
    return {
        "success": True,
        "data": {"task_id": str(task_id)},
        "message": "Requirement converted to a task.",
        "meta": {},
    }


@router.patch("/{tender_id}/requirements/{requirement_id}")
async def update_requirement(
    tender_id: str,
    requirement_id: str,
    request: Request,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("tender_bids.update")),
):
    payload = await request.json()
    if "is_satisfied" not in payload:
        raise HTTPException(status_code=400, detail="is_satisfied is required.")

    query = text("""
        UPDATE crm.tender_requirements
        SET is_satisfied = :is_satisfied, updated_at = NOW()
        WHERE id = :requirement_id AND tender_id = :tender_id
          AND organization_id = :org_id AND is_deleted = false
        RETURNING id
    """)
    result = await db.execute(
        query,
        {
            "is_satisfied": bool(payload["is_satisfied"]),
            "requirement_id": requirement_id,
            "tender_id": tender_id,
            "org_id": user["org_id"],
        },
    )
    if not result.first():
        raise HTTPException(status_code=404, detail="Requirement not found")

    await db.commit()
    return {
        "success": True,
        "data": {"id": requirement_id},
        "message": "Requirement updated.",
        "meta": {},
    }


@router.delete("/{tender_id}/requirements/{requirement_id}")
async def delete_requirement(
    tender_id: str,
    requirement_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("tender_bids.update")),
):
    query = text("""
        UPDATE crm.tender_requirements
        SET is_deleted = true, updated_at = NOW()
        WHERE id = :requirement_id AND tender_id = :tender_id AND organization_id = :org_id
        RETURNING id
    """)
    result = await db.execute(
        query,
        {"requirement_id": requirement_id, "tender_id": tender_id, "org_id": user["org_id"]},
    )
    if not result.first():
        raise HTTPException(status_code=404, detail="Requirement not found")

    await db.commit()
    return {
        "success": True,
        "data": None,
        "message": "Requirement deleted.",
        "meta": {},
    }
