"""
Measured-quantity progress tracking against the priced Bill of Quantities.

Closes the QS gap where "how much work has been completed" and "what can
be invoiced now" had no answer grounded in physically measured quantities -
finance.progress_claims.this_claim_amount was previously a manually typed
dollar figure with no BOQ line-item backing. finance.boq_line_items (seeded
from a won quotation, see app.services.finance.project_forecast.
seed_boq_line_items_from_quotation) gives each priced BOQ line a persistent
identity; finance.boq_measurement_entries is the submit->approve audit trail
that updates qty_measured_to_date, mirroring the lifecycle finance.variations
and finance.progress_claims already use rather than overwriting a quantity
silently in place.
"""

from datetime import date
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.shared.pagination import ok
from core.database import get_db
from core.security import require_permission

router = APIRouter()


def _pct_and_earned_value(contract_qty: float, rate: float, qty_measured_to_date: float) -> tuple[float, float]:
    """Caps measured quantity at contract quantity for earned-value purposes -
    over-measurement against the priced BOQ should surface as a variation,
    not silently inflate earned value beyond what was contracted."""
    capped_qty = min(qty_measured_to_date, contract_qty) if contract_qty > 0 else 0.0
    pct_complete = round(capped_qty / contract_qty * 100, 2) if contract_qty > 0 else 0.0
    earned_value = round(capped_qty * rate, 2)
    return pct_complete, earned_value


@router.get("/projects/{project_id}/line-items")
async def list_boq_line_items(
    project_id: UUID,
    user: dict = Depends(require_permission("finance.boq_progress.read")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        text("""
            SELECT * FROM finance.boq_line_items
            WHERE organization_id = :org_id AND project_id = :project_id
              AND is_deleted = false AND status != 'superseded'
            ORDER BY sort_order, created_at
        """),
        {"org_id": user["org_id"], "project_id": project_id},
    )
    items = []
    for row in result:
        item = dict(row._mapping)
        pct_complete, earned_value = _pct_and_earned_value(
            float(item["contract_qty"]), float(item["rate"]), float(item["qty_measured_to_date"])
        )
        item["pct_complete"] = pct_complete
        item["earned_value_amount"] = earned_value
        items.append(item)
    return ok(items, "BOQ line items listed.")


class BoqMeasurementCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    measurement_date: date
    qty_this_period: float = Field(gt=0)
    notes: Optional[str] = None


@router.post("/line-items/{line_item_id}/measurements", status_code=status.HTTP_201_CREATED)
async def submit_boq_measurement(
    line_item_id: UUID,
    payload: BoqMeasurementCreate,
    user: dict = Depends(require_permission("finance.boq_progress.record")),
    db: AsyncSession = Depends(get_db),
):
    line = (
        await db.execute(
            text("""
                SELECT * FROM finance.boq_line_items
                WHERE id = :id AND organization_id = :org_id AND is_deleted = false
            """),
            {"id": line_item_id, "org_id": user["org_id"]},
        )
    ).first()
    if not line:
        raise HTTPException(status_code=404, detail="BOQ line item not found.")

    line = dict(line._mapping)
    projected_cumulative = float(line["qty_measured_to_date"]) + payload.qty_this_period

    entry_id = (
        await db.execute(
            text("""
                INSERT INTO finance.boq_measurement_entries (
                    organization_id, boq_line_item_id, measurement_date, qty_this_period,
                    cumulative_qty_after, measured_by, notes
                ) VALUES (
                    :org_id, :line_item_id, :measurement_date, :qty_this_period,
                    :cumulative_qty_after, :measured_by, :notes
                ) RETURNING id
            """),
            {
                "org_id": user["org_id"],
                "line_item_id": line_item_id,
                "measurement_date": payload.measurement_date,
                "qty_this_period": payload.qty_this_period,
                "cumulative_qty_after": round(projected_cumulative, 3),
                "measured_by": user["sub"],
                "notes": payload.notes,
            },
        )
    ).scalar()
    await db.commit()
    return ok({"id": str(entry_id)}, "Measurement submitted for approval.")


@router.post("/measurements/{entry_id}/approve")
async def approve_boq_measurement(
    entry_id: UUID,
    user: dict = Depends(require_permission("finance.boq_progress.approve")),
    db: AsyncSession = Depends(get_db),
):
    entry = (
        await db.execute(
            text("""
                SELECT * FROM finance.boq_measurement_entries
                WHERE id = :id AND organization_id = :org_id AND status = 'submitted'
            """),
            {"id": entry_id, "org_id": user["org_id"]},
        )
    ).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Submitted measurement entry not found.")
    entry = dict(entry._mapping)

    line = (
        await db.execute(
            text("""
                SELECT * FROM finance.boq_line_items
                WHERE id = :id AND organization_id = :org_id AND is_deleted = false
                FOR UPDATE
            """),
            {"id": entry["boq_line_item_id"], "org_id": user["org_id"]},
        )
    ).first()
    if not line:
        raise HTTPException(status_code=404, detail="BOQ line item not found.")
    line = dict(line._mapping)

    # Recompute against the line's CURRENT total at approval time rather than
    # trusting the projection made at submission time, so two measurements
    # submitted concurrently against the same line don't clobber each other.
    new_cumulative = round(float(line["qty_measured_to_date"]) + float(entry["qty_this_period"]), 3)
    new_status = "completed" if new_cumulative >= float(line["contract_qty"]) > 0 else line["status"]

    await db.execute(
        text("""
            UPDATE finance.boq_line_items
            SET qty_measured_to_date = :qty, status = :status, updated_at = NOW()
            WHERE id = :id AND organization_id = :org_id
        """),
        {"qty": new_cumulative, "status": new_status, "id": line["id"], "org_id": user["org_id"]},
    )
    await db.execute(
        text("""
            UPDATE finance.boq_measurement_entries
            SET status = 'approved', approved_by = :user_id, approved_at = NOW(), cumulative_qty_after = :qty
            WHERE id = :id AND organization_id = :org_id
        """),
        {"qty": new_cumulative, "user_id": user["user_id"], "id": entry_id, "org_id": user["org_id"]},
    )
    await db.commit()
    return ok({"qty_measured_to_date": new_cumulative}, "Measurement approved.")


class BoqMeasurementReject(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    rejection_reason: str = Field(min_length=1, max_length=500)


@router.post("/measurements/{entry_id}/reject")
async def reject_boq_measurement(
    entry_id: UUID,
    payload: BoqMeasurementReject,
    user: dict = Depends(require_permission("finance.boq_progress.approve")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        text("""
            UPDATE finance.boq_measurement_entries
            SET status = 'rejected', approved_by = :user_id, approved_at = NOW(), rejection_reason = :reason
            WHERE id = :id AND organization_id = :org_id AND status = 'submitted'
            RETURNING id
        """),
        {"user_id": user["user_id"], "reason": payload.rejection_reason, "id": entry_id, "org_id": user["org_id"]},
    )
    if not result.first():
        await db.rollback()
        raise HTTPException(status_code=404, detail="Submitted measurement entry not found.")
    await db.commit()
    return ok({"id": str(entry_id)}, "Measurement rejected.")


@router.get("/measurements")
async def list_boq_measurements(
    project_id: UUID,
    status_filter: Optional[str] = None,
    user: dict = Depends(require_permission("finance.boq_progress.read")),
    db: AsyncSession = Depends(get_db),
):
    query_str = """
        SELECT me.*, li.description AS line_description, li.unit AS line_unit
        FROM finance.boq_measurement_entries me
        JOIN finance.boq_line_items li ON li.id = me.boq_line_item_id
        WHERE me.organization_id = :org_id AND li.project_id = :project_id
    """
    params = {"org_id": user["org_id"], "project_id": project_id}
    if status_filter:
        query_str += " AND me.status = :status_filter"
        params["status_filter"] = status_filter
    query_str += " ORDER BY me.created_at DESC"

    result = await db.execute(text(query_str), params)
    items = [dict(row._mapping) for row in result]
    return ok(items, "BOQ measurement entries listed.")


async def _earned_value_and_certified(db: AsyncSession, org_id: str, project_id: UUID) -> dict:
    lines = await db.execute(
        text("""
            SELECT contract_qty, rate, qty_measured_to_date, contract_amount
            FROM finance.boq_line_items
            WHERE organization_id = :org_id AND project_id = :project_id
              AND is_deleted = false AND status != 'superseded'
        """),
        {"org_id": org_id, "project_id": project_id},
    )
    total_contract_value = 0.0
    total_earned_value = 0.0
    line_count = 0
    measured_count = 0
    for row in lines:
        r = dict(row._mapping)
        total_contract_value += float(r["contract_amount"] or 0)
        _, ev = _pct_and_earned_value(float(r["contract_qty"]), float(r["rate"]), float(r["qty_measured_to_date"]))
        total_earned_value += ev
        line_count += 1
        if float(r["qty_measured_to_date"]) > 0:
            measured_count += 1

    certified_to_date = (
        await db.execute(
            text("""
                SELECT COALESCE(SUM(certified_amount), 0) FROM finance.progress_claims
                WHERE project_id = :project_id AND organization_id = :org_id
                  AND status IN ('certified', 'paid') AND is_deleted = false
            """),
            {"org_id": org_id, "project_id": project_id},
        )
    ).scalar()

    return {
        "total_contract_value": round(total_contract_value, 2),
        "total_earned_value": round(total_earned_value, 2),
        "line_item_count": line_count,
        "measured_line_item_count": measured_count,
        "certified_to_date": round(float(certified_to_date or 0), 2),
    }


@router.get("/projects/{project_id}/summary")
async def get_boq_progress_summary(
    project_id: UUID,
    user: dict = Depends(require_permission("finance.boq_progress.read")),
    db: AsyncSession = Depends(get_db),
):
    figures = await _earned_value_and_certified(db, user["org_id"], project_id)
    pct_complete_value_weighted = (
        round(figures["total_earned_value"] / figures["total_contract_value"] * 100, 2)
        if figures["total_contract_value"] > 0 else 0.0
    )
    figures["pct_complete_value_weighted"] = pct_complete_value_weighted
    figures["claimable_amount"] = max(0.0, round(figures["total_earned_value"] - figures["certified_to_date"], 2))
    return ok(figures, "BOQ progress summary computed.")


@router.get("/projects/{project_id}/claimable-amount")
async def get_boq_claimable_amount(
    project_id: UUID,
    user: dict = Depends(require_permission("finance.boq_progress.read")),
    db: AsyncSession = Depends(get_db),
):
    figures = await _earned_value_and_certified(db, user["org_id"], project_id)
    claimable_amount = max(0.0, round(figures["total_earned_value"] - figures["certified_to_date"], 2))
    return ok(
        {
            "earned_value_to_date": figures["total_earned_value"],
            "previously_certified": figures["certified_to_date"],
            "claimable_amount": claimable_amount,
        },
        "Claimable amount computed from measured earned value.",
    )
