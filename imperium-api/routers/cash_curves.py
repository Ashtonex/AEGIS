"""Tender / project cash curves - see app/services/finance/project_cash_curve.py.

Computing a curve never writes anything, so it is gated by the *read*
permission of the thing it is computed for (quotations.read for a bid,
projects.read plus project scoping for a live job) even though it is a POST
(the scenario overrides travel in the body). Saving a named scenario against a
quotation is a change to that quotation's record and needs quotations.update.
"""

import json
import logging
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import ProgrammingError
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.finance import project_cash_curve as cc
from app.shared.pagination import ok
from core.database import get_db
from core.project_scope import require_project_access
from core.security import require_permission

router = APIRouter()
logger = logging.getLogger(__name__)


class ScenarioIn(BaseModel):
    name: Optional[str] = Field(default=None, max_length=80)
    assumptions: dict[str, Any] = Field(default_factory=dict)


class ComputeRequest(BaseModel):
    scenarios: list[ScenarioIn] = Field(default_factory=list, max_length=4)


class SaveScenarioRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    assumptions: dict[str, Any] = Field(default_factory=dict)


def _compute(loaded: tuple, body: ComputeRequest) -> dict:
    defaults, sources, context = loaded
    try:
        results = cc.compute_scenarios(defaults, [s.model_dump() for s in body.scenarios])
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=f"Invalid assumption: {exc}") from exc
    return {
        "context": context,
        "defaults": defaults.to_dict(),
        "default_sources": sources,
        "scenarios": results,
    }


@router.post("/quotations/{quotation_id}")
async def compute_quotation_cash_curve(
    quotation_id: str,
    body: ComputeRequest,
    user: dict = Depends(require_permission("quotations.read")),
    db: AsyncSession = Depends(get_db),
):
    loaded = await cc.load_quotation_defaults(db, user["org_id"], quotation_id)
    if not loaded:
        raise HTTPException(status_code=404, detail="Quotation not found.")
    return ok(_compute(loaded, body), "Cash curve computed.")


@router.post("/projects/{project_id}")
async def compute_project_cash_curve(
    project_id: str,
    body: ComputeRequest,
    user: dict = Depends(require_permission("projects.read")),
    db: AsyncSession = Depends(get_db),
):
    await require_project_access(db, user, project_id)
    loaded = await cc.load_project_defaults(db, user["org_id"], project_id)
    if not loaded:
        raise HTTPException(status_code=404, detail="Project not found.")
    return ok(_compute(loaded, body), "Cash curve computed.")


def _scenarios_table_missing(exc: ProgrammingError) -> bool:
    return "cash_curve_scenarios" in str(exc) and "does not exist" in str(exc)


@router.get("/quotations/{quotation_id}/scenarios")
async def list_saved_scenarios(
    quotation_id: str,
    user: dict = Depends(require_permission("quotations.read")),
    db: AsyncSession = Depends(get_db),
):
    try:
        rows = (await db.execute(
            text("""
                SELECT s.id, s.name, s.assumptions, s.summary, s.created_at,
                       COALESCE(u.full_name, u.email) AS created_by_name
                FROM finance.cash_curve_scenarios s
                LEFT JOIN core.users u ON u.id = s.created_by
                WHERE s.organization_id = :org_id AND s.quotation_id = CAST(:qid AS uuid) AND s.is_deleted = false
                ORDER BY s.created_at DESC
            """),
            {"org_id": user["org_id"], "qid": quotation_id},
        )).mappings().all()
    except ProgrammingError as exc:
        if not _scenarios_table_missing(exc):
            raise
        # Migration 256 not applied yet - computing still works, saving doesn't.
        await db.rollback()
        return {"success": True, "data": [], "message": "Saved scenarios unavailable.", "meta": {"scenarios_available": False}}
    data = [{**dict(r), "id": str(r["id"])} for r in rows]
    return {"success": True, "data": data, "message": "Saved scenarios listed.", "meta": {"scenarios_available": True}}


@router.post("/quotations/{quotation_id}/scenarios", status_code=201)
async def save_scenario(
    quotation_id: str,
    body: SaveScenarioRequest,
    user: dict = Depends(require_permission("quotations.update")),
    db: AsyncSession = Depends(get_db),
):
    loaded = await cc.load_quotation_defaults(db, user["org_id"], quotation_id)
    if not loaded:
        raise HTTPException(status_code=404, detail="Quotation not found.")
    result = _compute(loaded, ComputeRequest(scenarios=[ScenarioIn(name=body.name, assumptions=body.assumptions)]))
    scenario = result["scenarios"][0]
    try:
        new_id = (await db.execute(
            text("""
                INSERT INTO finance.cash_curve_scenarios
                    (organization_id, quotation_id, name, assumptions, summary, created_by)
                VALUES (:org_id, CAST(:qid AS uuid), :name, CAST(:assumptions AS jsonb), CAST(:summary AS jsonb), :user_id)
                RETURNING id
            """),
            {
                "org_id": user["org_id"],
                "qid": quotation_id,
                "name": body.name.strip(),
                # Only the user's overrides are stored, so a saved scenario
                # keeps following the quotation's latest figures for anything
                # it didn't pin.
                "assumptions": json.dumps(body.assumptions, default=str),
                "summary": json.dumps(scenario["summary"], default=str),
                "user_id": user.get("user_id") or user.get("sub"),
            },
        )).scalar()
        await db.commit()
    except ProgrammingError as exc:
        await db.rollback()
        if _scenarios_table_missing(exc):
            raise HTTPException(status_code=503, detail="Saving scenarios needs database migration 256.") from exc
        raise
    return ok({"id": str(new_id), "name": body.name.strip(), "assumptions": body.assumptions, "summary": scenario["summary"]}, "Scenario saved.")


@router.delete("/scenarios/{scenario_id}")
async def delete_scenario(
    scenario_id: str,
    user: dict = Depends(require_permission("quotations.update")),
    db: AsyncSession = Depends(get_db),
):
    deleted = (await db.execute(
        text("""
            UPDATE finance.cash_curve_scenarios SET is_deleted = true, updated_at = NOW()
            WHERE id = CAST(:sid AS uuid) AND organization_id = :org_id AND is_deleted = false
            RETURNING id
        """),
        {"sid": scenario_id, "org_id": user["org_id"]},
    )).scalar()
    if not deleted:
        raise HTTPException(status_code=404, detail="Scenario not found.")
    await db.commit()
    return ok({"id": str(deleted)}, "Scenario deleted.")
