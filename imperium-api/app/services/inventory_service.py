"""Shared inventory/stock-ledger operations.

Used by routers/inventory.py, routers/site_reports.py, and
routers/procurement.py so stock-balance lookups, budget checks, and
movement/cost-posting logic aren't duplicated across those three files.

The one behavior this unifies deliberately: issue_stock() posts a
finance.cost_transactions row whenever a project_id is supplied, so any
stock issued to a project - whether through the manual inventory issue
endpoint, a site material request, or (in future) any other issue path -
recognises an actual cost the same way. receive_stock() and
transfer_stock() never post a cost: receiving is an asset arriving, and a
transfer only moves stock between locations, neither is a project expense.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any, Literal, Optional
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.shared.events import emit_event

MovementType = Literal[
    "receipt", "issue", "return", "transfer_in", "transfer_out", "adjustment", "consumption"
]

# Mirrors routers/procurement.py's BUDGET_OVERRIDE_ROLES - kept as a separate
# constant rather than a shared import to avoid a circular import (procurement.py
# already imports this module). Roles permitted to push stock issue/transfer/
# adjustment past a hard availability check, provided they supply a reason.
BUDGET_OVERRIDE_ROLES = {"SUPERADMIN", "Finance Manager", "Project Manager"}


async def stock_balance(
    db: AsyncSession, *, org_id: str, item_id: UUID, store_id: Optional[UUID]
) -> Decimal:
    row = (
        (
            await db.execute(
                text("""
        SELECT COALESCE(SUM(quantity), 0) AS available_qty
        FROM procurement.stock_ledger
        WHERE organization_id=:org_id
          AND item_id=:item_id
          AND (CAST(:store_id AS uuid) IS NULL OR store_id=CAST(:store_id AS uuid))
    """),
                {"org_id": org_id, "item_id": item_id, "store_id": store_id},
            )
        )
        .mappings()
        .one()
    )
    return Decimal(str(row["available_qty"] or 0))


async def reorder_level(db: AsyncSession, *, org_id: str, item_id: UUID) -> Decimal:
    row = (
        (
            await db.execute(
                text("""
        SELECT COALESCE(reorder_level, 0) AS reorder_level
        FROM procurement.inventory_items
        WHERE organization_id=:org_id AND id=:item_id AND is_deleted=false
    """),
                {"org_id": org_id, "item_id": item_id},
            )
        )
        .mappings()
        .first()
    )
    return Decimal(str(row["reorder_level"] or 0)) if row else Decimal("0")


async def budget_available(
    db: AsyncSession, *, org_id: str, project_id: Optional[UUID]
) -> Optional[Decimal]:
    """Single source of truth for project budget headroom - replaces the
    byte-identical budget_available() previously duplicated in
    procurement.py and site_reports.py.

    Returns None (not Decimal("0")) when the project has no approved
    finance.project_budgets row yet - e.g. a Field Intake project that
    hasn't been through Finance sign-off. Callers must treat None as "no
    ceiling configured, don't block" rather than "$0 available, block
    everything" - the two used to be indistinguishable, which made any
    non-zero requisition against an un-budgeted project unsubmittable.
    """
    if project_id is None:
        return Decimal("0")
    row = (
        await db.execute(
            text("""
        SELECT
          (SELECT total_amount FROM finance.project_budgets WHERE organization_id=:org_id AND project_id=:project_id AND status='approved' AND is_deleted=false LIMIT 1) AS budget,
          COALESCE((SELECT SUM(committed_amount) FROM finance.commitments WHERE organization_id=:org_id AND project_id=:project_id AND status <> 'cancelled' AND is_deleted=false), 0) AS committed,
          COALESCE((SELECT SUM(amount) FROM finance.cost_transactions WHERE organization_id=:org_id AND project_id=:project_id), 0) AS spent
    """),
            {"org_id": org_id, "project_id": project_id},
        )
    ).first()
    if row.budget is None:
        return None
    return Decimal(str(row.budget)) - Decimal(str(row.committed or 0)) - Decimal(str(row.spent or 0))


async def post_cost_transaction(
    db: AsyncSession,
    *,
    org_id: str,
    project_id: UUID,
    source_type: str,
    source_id: UUID,
    cost_category: str,
    description: str,
    quantity: Decimal,
    unit_cost: Decimal,
    amount: Decimal,
    posted_by: str,
) -> Optional[UUID]:
    row = await db.execute(
        text("""
        INSERT INTO finance.cost_transactions (
            organization_id, project_id, source_type, source_id, cost_category,
            description, quantity, unit_cost, amount, transaction_date, posted_by
        ) VALUES (
            :org_id, :project_id, :source_type, :source_id, :cost_category,
            :description, :quantity, :unit_cost, :amount, CURRENT_DATE, :posted_by
        ) ON CONFLICT (organization_id, source_type, source_id, cost_category) DO NOTHING
        RETURNING id
    """),
        {
            "org_id": org_id,
            "project_id": project_id,
            "source_type": source_type,
            "source_id": source_id,
            "cost_category": cost_category,
            "description": description,
            "quantity": quantity,
            "unit_cost": unit_cost,
            "amount": amount,
            "posted_by": posted_by,
        },
    )
    return row.scalar()


async def record_stock_movement(
    db: AsyncSession,
    user: dict,
    *,
    item_id: UUID,
    store_id: Optional[UUID],
    project_id: Optional[UUID],
    movement_type: MovementType,
    quantity: Decimal,
    unit_cost: Decimal = Decimal("0"),
    source_type: str,
    source_id: UUID,
    reference: Optional[str] = None,
    notes: Optional[str] = None,
    supplier_id: Optional[UUID] = None,
) -> UUID:
    """Lowest-level primitive: one signed insert into procurement.stock_ledger,
    idempotent on (organization_id, source_type, source_id, item_id, movement_type).
    Returns the ledger row id - the newly-inserted one, or the pre-existing one
    if this exact movement was already recorded."""
    row = await db.execute(
        text("""
        INSERT INTO procurement.stock_ledger (
            organization_id, item_id, store_id, project_id, movement_type, quantity,
            unit_cost, total_cost, source_type, source_id, reference, notes, recorded_by,
            supplier_id
        ) VALUES (
            :org_id, :item_id, :store_id, :project_id, :movement_type, :quantity,
            :unit_cost, ROUND(ABS(CAST(:quantity AS numeric)) * CAST(:unit_cost AS numeric), 2),
            :source_type, :source_id, :reference, :notes, :user_id,
            :supplier_id
        ) ON CONFLICT (organization_id, source_type, source_id, item_id, movement_type) DO NOTHING
        RETURNING id
    """),
        {
            "org_id": user["org_id"],
            "item_id": item_id,
            "store_id": store_id,
            "project_id": project_id,
            "movement_type": movement_type,
            "quantity": quantity,
            "unit_cost": unit_cost,
            "source_type": source_type,
            "source_id": source_id,
            "reference": reference,
            "notes": notes,
            "user_id": user["user_id"],
            "supplier_id": supplier_id,
        },
    )
    movement_id = row.scalar()
    if movement_id is not None:
        return movement_id
    existing = await db.execute(
        text("""
        SELECT id FROM procurement.stock_ledger
        WHERE organization_id=:org_id AND source_type=:source_type AND source_id=:source_id
          AND item_id=:item_id AND movement_type=:movement_type
    """),
        {
            "org_id": user["org_id"],
            "source_type": source_type,
            "source_id": source_id,
            "item_id": item_id,
            "movement_type": movement_type,
        },
    )
    return existing.scalar()


async def _below_reorder_check(
    db: AsyncSession,
    user: dict,
    *,
    item_id: UUID,
    store_id: Optional[UUID],
    project_id: Optional[UUID],
    movement_id: UUID,
) -> None:
    remaining = await stock_balance(
        db, org_id=user["org_id"], item_id=item_id, store_id=store_id
    )
    threshold = await reorder_level(db, org_id=user["org_id"], item_id=item_id)
    if threshold > 0 and remaining <= threshold:
        await emit_event(
            db,
            user=user,
            event_type="inventory.below_reorder_level.v1",
            aggregate_type="inventory_item",
            aggregate_id=item_id,
            project_id=project_id,
            event_data={
                "store_id": str(store_id) if store_id else None,
                "available_qty": str(remaining),
                "reorder_level": str(threshold),
                "source_movement_id": str(movement_id),
            },
        )


async def receive_stock(
    db: AsyncSession,
    user: dict,
    *,
    item_id: UUID,
    store_id: Optional[UUID],
    project_id: Optional[UUID],
    quantity: Decimal,
    unit_cost: Decimal,
    source_type: str,
    source_id: UUID,
    reference: Optional[str] = None,
    notes: Optional[str] = None,
    supplier_id: Optional[UUID] = None,
) -> UUID:
    """Stock arriving into a store. Asset only - never posts a Finance cost."""
    movement_id = await record_stock_movement(
        db,
        user,
        item_id=item_id,
        store_id=store_id,
        project_id=project_id,
        movement_type="receipt",
        quantity=abs(quantity),
        unit_cost=unit_cost,
        source_type=source_type,
        source_id=source_id,
        reference=reference,
        notes=notes,
        supplier_id=supplier_id,
    )
    await emit_event(
        db,
        user=user,
        event_type="inventory.receipt_recorded.v1",
        aggregate_type="stock_ledger",
        aggregate_id=movement_id,
        project_id=project_id,
        event_data={
            "item_id": str(item_id),
            "store_id": str(store_id) if store_id else None,
            "quantity": str(quantity),
            "unit_cost": str(unit_cost),
        },
    )
    return movement_id


async def issue_stock(
    db: AsyncSession,
    user: dict,
    *,
    item_id: UUID,
    store_id: Optional[UUID],
    project_id: Optional[UUID],
    quantity: Decimal,
    unit_cost: Decimal,
    source_type: str,
    source_id: UUID,
    reference: Optional[str] = None,
    notes: Optional[str] = None,
    cost_category: str = "materials",
    cost_description: Optional[str] = None,
    override_reason: Optional[str] = None,
) -> dict[str, Any]:
    """Stock leaving a store. If project_id is supplied, also posts an actual
    cost to finance.cost_transactions - this is what makes materials issued
    via a formal PO/GRN show up as real project spend the same way materials
    issued via a Site Operations material request already do."""
    available = await stock_balance(
        db, org_id=user["org_id"], item_id=item_id, store_id=store_id
    )
    is_override = False
    if available < quantity:
        if user.get("role") not in BUDGET_OVERRIDE_ROLES:
            raise HTTPException(
                status_code=409,
                detail=f"Insufficient stock available for issue. Available quantity is {available}. Use a material request to procure the shortfall.",
            )
        if not override_reason:
            raise HTTPException(
                status_code=409,
                detail=f"Insufficient stock available for issue. Available quantity is {available}. Provide an override reason to issue anyway.",
            )
        is_override = True
    movement_id = await record_stock_movement(
        db,
        user,
        item_id=item_id,
        store_id=store_id,
        project_id=project_id,
        movement_type="issue",
        quantity=-abs(quantity),
        unit_cost=unit_cost,
        source_type=source_type,
        source_id=source_id,
        reference=reference,
        notes=notes,
    )
    await emit_event(
        db,
        user=user,
        event_type="inventory.issue_recorded.v1",
        aggregate_type="stock_ledger",
        aggregate_id=movement_id,
        project_id=project_id,
        event_data={
            "item_id": str(item_id),
            "store_id": str(store_id) if store_id else None,
            "quantity": str(quantity),
            "unit_cost": str(unit_cost),
        },
    )
    if is_override:
        await emit_event(
            db,
            user=user,
            event_type="inventory.issue_overridden.v1",
            aggregate_type="stock_ledger",
            aggregate_id=movement_id,
            project_id=project_id,
            event_data={
                "item_id": str(item_id),
                "store_id": str(store_id) if store_id else None,
                "quantity_requested": str(quantity),
                "quantity_available": str(available),
                "override_reason": override_reason,
                "overridden_by_role": user.get("role"),
            },
        )
    await _below_reorder_check(
        db,
        user,
        item_id=item_id,
        store_id=store_id,
        project_id=project_id,
        movement_id=movement_id,
    )

    cost_transaction_id: Optional[UUID] = None
    if project_id is not None:
        amount = (quantity * unit_cost).quantize(Decimal("0.01"))
        cost_transaction_id = await post_cost_transaction(
            db,
            org_id=user["org_id"],
            project_id=project_id,
            source_type=source_type,
            source_id=source_id,
            cost_category=cost_category,
            description=cost_description or f"Stock issue ({source_type})",
            quantity=quantity,
            unit_cost=unit_cost,
            amount=amount,
            posted_by=user["user_id"],
        )
        if cost_transaction_id is not None:
            await emit_event(
                db,
                user=user,
                event_type="finance.actual_cost_created.v1",
                aggregate_type="cost_transaction",
                aggregate_id=cost_transaction_id,
                project_id=project_id,
                event_data={
                    "source_type": source_type,
                    "source_id": str(source_id),
                    "cost_category": cost_category,
                    "quantity": str(quantity),
                    "unit_cost": str(unit_cost),
                    "amount": str(amount),
                },
            )

    return {"movement_id": movement_id, "cost_transaction_id": cost_transaction_id}


async def transfer_stock(
    db: AsyncSession,
    user: dict,
    *,
    item_id: UUID,
    from_store_id: UUID,
    to_store_id: UUID,
    quantity: Decimal,
    unit_cost: Decimal = Decimal("0"),
    reference: Optional[str] = None,
    notes: Optional[str] = None,
    transfer_id: Optional[UUID] = None,
    override_reason: Optional[str] = None,
) -> dict[str, Any]:
    """Moves stock from one store to another. Never posts a Finance cost -
    the stock hasn't left the organisation, it's just moved location."""
    if from_store_id == to_store_id:
        raise HTTPException(
            status_code=422, detail="Source and destination store must differ."
        )
    available = await stock_balance(
        db, org_id=user["org_id"], item_id=item_id, store_id=from_store_id
    )
    is_override = False
    if available < quantity:
        if user.get("role") not in BUDGET_OVERRIDE_ROLES:
            raise HTTPException(
                status_code=409,
                detail=f"Insufficient stock available to transfer. Available quantity at source store is {available}.",
            )
        if not override_reason:
            raise HTTPException(
                status_code=409,
                detail=f"Insufficient stock available to transfer. Available quantity at source store is {available}. Provide an override reason to transfer anyway.",
            )
        is_override = True
    transfer_group_id = transfer_id or uuid4()

    out_movement_id = await record_stock_movement(
        db,
        user,
        item_id=item_id,
        store_id=from_store_id,
        project_id=None,
        movement_type="transfer_out",
        quantity=-abs(quantity),
        unit_cost=unit_cost,
        source_type="inventory_transfer",
        source_id=transfer_group_id,
        reference=reference,
        notes=notes,
    )
    in_movement_id = await record_stock_movement(
        db,
        user,
        item_id=item_id,
        store_id=to_store_id,
        project_id=None,
        movement_type="transfer_in",
        quantity=abs(quantity),
        unit_cost=unit_cost,
        source_type="inventory_transfer",
        source_id=transfer_group_id,
        reference=reference,
        notes=notes,
    )
    await emit_event(
        db,
        user=user,
        event_type="inventory.transfer.completed.v1",
        aggregate_type="stock_ledger",
        aggregate_id=transfer_group_id,
        project_id=None,
        event_data={
            "item_id": str(item_id),
            "from_store_id": str(from_store_id),
            "to_store_id": str(to_store_id),
            "quantity": str(quantity),
            "unit_cost": str(unit_cost),
        },
    )
    if is_override:
        await emit_event(
            db,
            user=user,
            event_type="inventory.transfer_overridden.v1",
            aggregate_type="stock_ledger",
            aggregate_id=transfer_group_id,
            project_id=None,
            event_data={
                "item_id": str(item_id),
                "from_store_id": str(from_store_id),
                "quantity_requested": str(quantity),
                "quantity_available": str(available),
                "override_reason": override_reason,
                "overridden_by_role": user.get("role"),
            },
        )
    return {
        "transfer_id": transfer_group_id,
        "out_movement_id": out_movement_id,
        "in_movement_id": in_movement_id,
    }


async def adjust_stock(
    db: AsyncSession,
    user: dict,
    *,
    item_id: UUID,
    store_id: UUID,
    quantity_delta: Decimal,
    unit_cost: Decimal = Decimal("0"),
    reason: str,
    reference: Optional[str] = None,
    adjustment_id: Optional[UUID] = None,
) -> dict[str, Any]:
    """Records a stock count correction (positive = found more, negative =
    damage/loss/shrinkage). Never posts a Finance cost - a count correction
    is an asset revaluation, not a project expense, and a store-level stock
    count has no project_id to post one against."""
    if quantity_delta == 0:
        raise HTTPException(
            status_code=422, detail="Adjustment quantity cannot be zero."
        )
    is_override = False
    if quantity_delta < 0:
        available = await stock_balance(
            db, org_id=user["org_id"], item_id=item_id, store_id=store_id
        )
        if available + quantity_delta < 0:
            if user.get("role") not in BUDGET_OVERRIDE_ROLES:
                raise HTTPException(
                    status_code=409,
                    detail=f"Adjustment would drive stock negative. Available quantity is {available}.",
                )
            # The mandatory `reason` param already doubles as the override
            # justification here, unlike issue/transfer which have no
            # required reason field for the non-override path.
            is_override = True
    movement_id = await record_stock_movement(
        db,
        user,
        item_id=item_id,
        store_id=store_id,
        project_id=None,
        movement_type="adjustment",
        quantity=quantity_delta,
        unit_cost=unit_cost,
        source_type="inventory_adjustment",
        source_id=adjustment_id or uuid4(),
        reference=reference,
        notes=reason,
    )
    await emit_event(
        db,
        user=user,
        event_type="inventory.adjustment.recorded.v1",
        aggregate_type="stock_ledger",
        aggregate_id=movement_id,
        project_id=None,
        event_data={
            "item_id": str(item_id),
            "store_id": str(store_id),
            "quantity_delta": str(quantity_delta),
            "reason": reason,
        },
    )
    if is_override:
        await emit_event(
            db,
            user=user,
            event_type="inventory.adjustment_overridden.v1",
            aggregate_type="stock_ledger",
            aggregate_id=movement_id,
            project_id=None,
            event_data={
                "item_id": str(item_id),
                "store_id": str(store_id),
                "quantity_delta": str(quantity_delta),
                "override_reason": reason,
                "overridden_by_role": user.get("role"),
            },
        )
    return {"movement_id": movement_id}
