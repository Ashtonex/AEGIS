"""
Final-account / project close-out workflow.

Closes the QS gap where nothing formalised measuring final completed works,
negotiating a final account, releasing retention, or locking a budget-vs-
actual-vs-profit/loss report at project completion - previously there was
no schema, no endpoints, and no frontend for any of this. finance.
retention_ledger (migration 023) already anticipated it (its source_type
enum literally includes 'final_completion') but had no reader or writer
until this router's /close endpoint.

Reuses compute_project_financials/derive_forecast_metrics from project_
forecast.py as the same live source-of-truth query the Finance dashboard
and finance.project_forecasts snapshots already use, so a final account
is never a second, drifted set of numbers.
"""

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.finance.project_forecast import compute_project_financials, derive_forecast_metrics
from app.shared.pagination import ok
from core.database import get_db
from core.security import require_permission

router = APIRouter()


async def _open_blockers(db: AsyncSession, org_id: str, project_id: UUID) -> dict:
    """Live re-check of anything that must be resolved before a final account
    can be agreed - variations still awaiting a decision, and claims that
    haven't reached a terminal state."""
    variations_count = (
        await db.execute(
            text("""
                SELECT COUNT(*) FROM finance.variations
                WHERE project_id = :project_id AND organization_id = :org_id
                  AND status IN ('pending', 'submitted') AND is_deleted = false
            """),
            {"project_id": project_id, "org_id": org_id},
        )
    ).scalar()

    claims_amount = (
        await db.execute(
            text("""
                SELECT COALESCE(SUM(this_claim_amount), 0) FROM finance.progress_claims
                WHERE project_id = :project_id AND organization_id = :org_id
                  AND status IN ('draft', 'submitted', 'disputed') AND is_deleted = false
            """),
            {"project_id": project_id, "org_id": org_id},
        )
    ).scalar()

    retention_held = (
        await db.execute(
            text("""
                SELECT COALESCE(SUM(retention_amount), 0) FROM finance.progress_claims
                WHERE project_id = :project_id AND organization_id = :org_id
                  AND status IN ('certified', 'paid') AND is_deleted = false
            """),
            {"project_id": project_id, "org_id": org_id},
        )
    ).scalar()

    return {
        "outstanding_variations_count": int(variations_count or 0),
        "outstanding_claims_amount": round(float(claims_amount or 0), 2),
        "retention_held": round(float(retention_held or 0), 2),
    }


def _blocker_messages(figures: dict) -> list[str]:
    blockers = []
    if figures["outstanding_variations_count"] > 0:
        blockers.append(
            f"{figures['outstanding_variations_count']} variation(s) still pending/submitted - approve or reject before agreeing the final account."
        )
    if figures["outstanding_claims_amount"] > 0:
        blockers.append(
            f"${figures['outstanding_claims_amount']:,.2f} in progress claims are still draft/submitted/disputed - resolve before agreeing the final account."
        )
    return blockers


async def _refresh_final_account_lines(db: AsyncSession, org_id: str, final_account_id: UUID, project_id: UUID):
    await db.execute(
        text("DELETE FROM finance.final_account_lines WHERE final_account_id = :id AND organization_id = :org_id"),
        {"id": final_account_id, "org_id": org_id},
    )
    lines = await db.execute(
        text("""
            SELECT id, contract_qty, rate, contract_amount, qty_measured_to_date
            FROM finance.boq_line_items
            WHERE organization_id = :org_id AND project_id = :project_id
              AND is_deleted = false AND status != 'superseded'
        """),
        {"org_id": org_id, "project_id": project_id},
    )
    for row in lines:
        li = dict(row._mapping)
        contract_qty = float(li["contract_qty"])
        rate = float(li["rate"])
        qty_measured = float(li["qty_measured_to_date"])
        capped_qty = min(qty_measured, contract_qty) if contract_qty > 0 else 0.0
        final_amount = round(capped_qty * rate, 2)
        await db.execute(
            text("""
                INSERT INTO finance.final_account_lines (
                    organization_id, final_account_id, boq_line_item_id,
                    final_qty, final_amount, variance_qty, variance_amount
                ) VALUES (
                    :org_id, :final_account_id, :boq_line_item_id,
                    :final_qty, :final_amount, :variance_qty, :variance_amount
                )
            """),
            {
                "org_id": org_id,
                "final_account_id": final_account_id,
                "boq_line_item_id": li["id"],
                "final_qty": round(qty_measured, 3),
                "final_amount": final_amount,
                "variance_qty": round(qty_measured - contract_qty, 3),
                "variance_amount": round(final_amount - float(li["contract_amount"] or 0), 2),
            },
        )


@router.post("/projects/{project_id}/prepare", status_code=status.HTTP_201_CREATED)
async def prepare_final_account(
    project_id: UUID,
    user: dict = Depends(require_permission("finance.final_account.prepare")),
    db: AsyncSession = Depends(get_db),
):
    financials = await compute_project_financials(db, user["org_id"], str(project_id))
    if financials is None:
        raise HTTPException(status_code=404, detail="Project not found.")
    metrics = derive_forecast_metrics(financials)
    blockers_figures = await _open_blockers(db, user["org_id"], project_id)

    existing = (
        await db.execute(
            text("""
                SELECT * FROM finance.final_accounts
                WHERE organization_id = :org_id AND project_id = :project_id
                  AND status IN ('draft', 'under_negotiation') AND is_deleted = false
                ORDER BY account_version DESC LIMIT 1
            """),
            {"org_id": user["org_id"], "project_id": project_id},
        )
    ).first()

    already_agreed = (
        await db.execute(
            text("""
                SELECT 1 FROM finance.final_accounts
                WHERE organization_id = :org_id AND project_id = :project_id
                  AND status = 'agreed' AND is_deleted = false
            """),
            {"org_id": user["org_id"], "project_id": project_id},
        )
    ).first()
    if already_agreed and not existing:
        raise HTTPException(
            status_code=409,
            detail="This project's final account is already agreed - negotiate via PUT or proceed to /close.",
        )

    params = {
        "org_id": user["org_id"],
        "final_contract_value": metrics["revised_contract_value"],
        "total_approved_variations": metrics["approved_variations"],
        "total_certified_claims": metrics["certified_to_date"],
        "total_actual_cost": metrics["actual_cost_to_date"],
        "total_committed_outstanding": metrics["committed_cost"],
        "retention_held": blockers_figures["retention_held"],
        "final_margin_pct": metrics["forecast_margin_pct"],
        "outstanding_variations_count": blockers_figures["outstanding_variations_count"],
        "outstanding_claims_amount": blockers_figures["outstanding_claims_amount"],
        "prepared_by": user["sub"],
    }

    if existing:
        existing = dict(existing._mapping)
        params["id"] = existing["id"]
        await db.execute(
            text("""
                UPDATE finance.final_accounts SET
                    final_contract_value = :final_contract_value,
                    total_approved_variations = :total_approved_variations,
                    total_certified_claims = :total_certified_claims,
                    total_actual_cost = :total_actual_cost,
                    total_committed_outstanding = :total_committed_outstanding,
                    retention_held = :retention_held,
                    final_margin_pct = :final_margin_pct,
                    outstanding_variations_count = :outstanding_variations_count,
                    outstanding_claims_amount = :outstanding_claims_amount,
                    prepared_by = :prepared_by, prepared_at = NOW(), updated_at = NOW()
                WHERE id = :id AND organization_id = :org_id
            """),
            params,
        )
        final_account_id = existing["id"]
    else:
        next_version = (
            await db.execute(
                text("""
                    SELECT COALESCE(MAX(account_version), 0) + 1
                    FROM finance.final_accounts WHERE project_id = :project_id AND organization_id = :org_id
                """),
                {"project_id": project_id, "org_id": user["org_id"]},
            )
        ).scalar()
        params["project_id"] = project_id
        params["version"] = next_version
        final_account_id = (
            await db.execute(
                text("""
                    INSERT INTO finance.final_accounts (
                        organization_id, project_id, account_version, status,
                        final_contract_value, total_approved_variations, total_certified_claims,
                        total_actual_cost, total_committed_outstanding, retention_held,
                        final_margin_pct, outstanding_variations_count, outstanding_claims_amount,
                        prepared_by, prepared_at
                    ) VALUES (
                        :org_id, :project_id, :version, 'draft',
                        :final_contract_value, :total_approved_variations, :total_certified_claims,
                        :total_actual_cost, :total_committed_outstanding, :retention_held,
                        :final_margin_pct, :outstanding_variations_count, :outstanding_claims_amount,
                        :prepared_by, NOW()
                    ) RETURNING id
                """),
                params,
            )
        ).scalar()

    await _refresh_final_account_lines(db, user["org_id"], final_account_id, project_id)
    await db.commit()

    return ok(
        {"id": str(final_account_id), "blockers": _blocker_messages(blockers_figures)},
        "Final account prepared from live project financials.",
    )


@router.get("/projects/{project_id}")
async def get_project_final_account(
    project_id: UUID,
    user: dict = Depends(require_permission("finance.final_account.read")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        text("""
            SELECT fa.*, p.name AS project_name
            FROM finance.final_accounts fa
            JOIN projects.projects p ON p.id = fa.project_id AND p.organization_id = fa.organization_id
            WHERE fa.organization_id = :org_id AND fa.project_id = :project_id AND fa.is_deleted = false
            ORDER BY fa.account_version DESC
        """),
        {"org_id": user["org_id"], "project_id": project_id},
    )
    versions = [dict(row._mapping) for row in result]
    if not versions:
        return ok({"current": None, "versions": []}, "No final account prepared for this project yet.")
    return ok({"current": versions[0], "versions": versions}, "Final account retrieved.")


class FinalAccountUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    notes: Optional[str] = None
    retention_released: Optional[float] = Field(default=None, ge=0)
    status: Optional[str] = Field(default=None, pattern=r"^(draft|under_negotiation)$")


@router.put("/{final_account_id}")
async def update_final_account(
    final_account_id: UUID,
    payload: FinalAccountUpdate,
    user: dict = Depends(require_permission("finance.final_account.prepare")),
    db: AsyncSession = Depends(get_db),
):
    existing = (
        await db.execute(
            text("""
                SELECT * FROM finance.final_accounts
                WHERE id = :id AND organization_id = :org_id AND is_deleted = false
            """),
            {"id": final_account_id, "org_id": user["org_id"]},
        )
    ).first()
    if not existing:
        raise HTTPException(status_code=404, detail="Final account not found.")
    existing = dict(existing._mapping)
    if existing["status"] not in ("draft", "under_negotiation"):
        raise HTTPException(status_code=409, detail=f"Cannot edit a final account with status '{existing['status']}'.")

    if payload.retention_released is not None and payload.retention_released > float(existing["retention_held"]):
        raise HTTPException(status_code=422, detail="retention_released cannot exceed retention_held.")

    await db.execute(
        text("""
            UPDATE finance.final_accounts SET
                notes = COALESCE(:notes, notes),
                retention_released = COALESCE(:retention_released, retention_released),
                status = COALESCE(:status, status),
                updated_at = NOW()
            WHERE id = :id AND organization_id = :org_id
        """),
        {
            "notes": payload.notes,
            "retention_released": payload.retention_released,
            "status": payload.status,
            "id": final_account_id,
            "org_id": user["org_id"],
        },
    )
    await db.commit()
    return ok({"id": str(final_account_id)}, "Final account updated.")


@router.post("/{final_account_id}/agree")
async def agree_final_account(
    final_account_id: UUID,
    user: dict = Depends(require_permission("finance.final_account.agree")),
    db: AsyncSession = Depends(get_db),
):
    existing = (
        await db.execute(
            text("""
                SELECT * FROM finance.final_accounts
                WHERE id = :id AND organization_id = :org_id AND is_deleted = false
            """),
            {"id": final_account_id, "org_id": user["org_id"]},
        )
    ).first()
    if not existing:
        raise HTTPException(status_code=404, detail="Final account not found.")
    existing = dict(existing._mapping)
    if existing["status"] not in ("draft", "under_negotiation"):
        raise HTTPException(status_code=409, detail=f"Cannot agree a final account with status '{existing['status']}'.")

    figures = await _open_blockers(db, user["org_id"], existing["project_id"])
    blockers = _blocker_messages(figures)
    if blockers:
        raise HTTPException(status_code=409, detail="Unresolved items block agreement: " + " ".join(blockers))

    await db.execute(
        text("""
            UPDATE finance.final_accounts
            SET status = 'agreed', agreed_by = :user_id, agreed_at = NOW(), updated_at = NOW()
            WHERE id = :id AND organization_id = :org_id
        """),
        {"user_id": user["user_id"], "id": final_account_id, "org_id": user["org_id"]},
    )
    await db.commit()
    return ok({"id": str(final_account_id)}, "Final account marked as client-agreed.")


@router.post("/{final_account_id}/close")
async def close_final_account(
    final_account_id: UUID,
    user: dict = Depends(require_permission("finance.final_account.close")),
    db: AsyncSession = Depends(get_db),
):
    existing = (
        await db.execute(
            text("""
                SELECT * FROM finance.final_accounts
                WHERE id = :id AND organization_id = :org_id AND is_deleted = false
            """),
            {"id": final_account_id, "org_id": user["org_id"]},
        )
    ).first()
    if not existing:
        raise HTTPException(status_code=404, detail="Final account not found.")
    existing = dict(existing._mapping)
    if existing["status"] != "agreed":
        raise HTTPException(status_code=409, detail="Only an agreed final account can be closed.")

    # A retention_released not already adjusted via PUT (i.e. still its
    # default 0) means a full release of whatever's held - a partial
    # holdback (e.g. pending defects rectification) must be set explicitly
    # via PUT before closing.
    release_amount = (
        float(existing["retention_released"]) if float(existing["retention_released"]) > 0
        else float(existing["retention_held"])
    )

    await db.execute(
        text("""
            UPDATE finance.final_accounts
            SET status = 'closed', closed_by = :user_id, closed_at = NOW(),
                retention_released = :release_amount, updated_at = NOW()
            WHERE id = :id AND organization_id = :org_id
        """),
        {"user_id": user["user_id"], "release_amount": release_amount, "id": final_account_id, "org_id": user["org_id"]},
    )

    if release_amount > 0:
        await db.execute(
            text("""
                INSERT INTO finance.retention_ledger (
                    organization_id, project_id, source_type, source_id,
                    movement_type, amount, movement_date, notes, recorded_by
                ) VALUES (
                    :org_id, :project_id, 'final_completion', :final_account_id,
                    'released', :amount, CURRENT_DATE, 'Retention released on final account close-out.', :user_id
                )
            """),
            {
                "org_id": user["org_id"],
                "project_id": existing["project_id"],
                "final_account_id": final_account_id,
                "amount": release_amount,
                "user_id": user["user_id"],
            },
        )

    await db.execute(
        text("""
            UPDATE projects.projects
            SET final_account_closed_at = NOW(), final_account_closed_by = :user_id,
                status = 'completed', updated_at = NOW()
            WHERE id = :project_id AND organization_id = :org_id
        """),
        {"user_id": user["user_id"], "project_id": existing["project_id"], "org_id": user["org_id"]},
    )

    await db.commit()
    return ok({"id": str(final_account_id), "retention_released": release_amount}, "Final account closed and retention released.")


@router.get("/{final_account_id}/report")
async def get_final_account_report(
    final_account_id: UUID,
    user: dict = Depends(require_permission("finance.final_account.read")),
    db: AsyncSession = Depends(get_db),
):
    account = (
        await db.execute(
            text("""
                SELECT fa.*, p.name AS project_name, p.contract_value AS original_contract_value
                FROM finance.final_accounts fa
                JOIN projects.projects p ON p.id = fa.project_id AND p.organization_id = fa.organization_id
                WHERE fa.id = :id AND fa.organization_id = :org_id AND fa.is_deleted = false
            """),
            {"id": final_account_id, "org_id": user["org_id"]},
        )
    ).first()
    if not account:
        raise HTTPException(status_code=404, detail="Final account not found.")
    account = dict(account._mapping)

    lines = await db.execute(
        text("""
            SELECT fal.*, li.description, li.unit, li.contract_qty, li.rate
            FROM finance.final_account_lines fal
            JOIN finance.boq_line_items li ON li.id = fal.boq_line_item_id
            WHERE fal.final_account_id = :id AND fal.organization_id = :org_id
            ORDER BY li.sort_order
        """),
        {"id": final_account_id, "org_id": user["org_id"]},
    )
    account["lines"] = [dict(row._mapping) for row in lines]
    return ok(account, "Final cost report retrieved.")
