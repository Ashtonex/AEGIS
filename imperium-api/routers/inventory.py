"""Inventory and materials control workflow APIs."""

from datetime import datetime
from decimal import Decimal
import json
from typing import Any, Literal, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.security import require_permission
from app.shared.sql import tenant_reference_sql

router = APIRouter()


class Payload(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class StockMovementPayload(Payload):
    item_id: UUID
    store_id: Optional[UUID] = None
    project_id: Optional[UUID] = None
    quantity: Decimal = Field(gt=0, max_digits=14, decimal_places=3)
    unit_cost: Decimal = Field(
        default=Decimal("0"), ge=0, max_digits=15, decimal_places=4
    )
    reference: Optional[str] = Field(default=None, max_length=160)
    work_package: Optional[str] = Field(default=None, max_length=160)
    notes: Optional[str] = None


def ok(data: Any, message: str, total: Optional[int] = None):
    return {
        "success": True,
        "data": data,
        "message": message,
        "meta": {} if total is None else {"total": total},
    }


async def emit_event(
    db: AsyncSession,
    *,
    user: dict,
    event_type: str,
    aggregate_type: str,
    aggregate_id: UUID,
    project_id: Optional[UUID],
    payload: dict[str, Any],
) -> None:
    await db.execute(
        text("""
        INSERT INTO core.domain_events (
            organization_id, event_type, schema_version, aggregate_type, aggregate_id,
            project_id, actor_id, idempotency_key, payload
        ) VALUES (
            :org_id, :event_type, 1, :aggregate_type, :aggregate_id,
            :project_id, :actor_id, :idempotency_key, CAST(:payload AS jsonb)
        ) ON CONFLICT (organization_id, idempotency_key) DO NOTHING
    """),
        {
            "org_id": user["org_id"],
            "event_type": event_type,
            "aggregate_type": aggregate_type,
            "aggregate_id": aggregate_id,
            "project_id": project_id,
            "actor_id": user["user_id"],
            "idempotency_key": f"{event_type}:{aggregate_type}:{aggregate_id}",
            "payload": json.dumps(payload, default=str),
        },
    )


async def require_ref(
    db: AsyncSession, table: str, record_id: Optional[UUID], org_id: str, label: str
) -> None:
    if record_id is None:
        return
    if table not in {
        "procurement.inventory_items",
        "procurement.stores",
        "projects.projects",
    }:
        raise HTTPException(status_code=500, detail="Unsupported reference validation")
    row = await db.execute(
        tenant_reference_sql(
            table,
            {
                "procurement.inventory_items",
                "procurement.stores",
                "projects.projects",
            },
        ),
        {"id": record_id, "org_id": org_id},
    )
    if not row.scalar():
        raise HTTPException(status_code=404, detail=f"{label} not found")


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


@router.get("/stock-levels")
async def stock_levels(
    store_id: Optional[UUID] = None,
    below_reorder: bool = False,
    user: dict = Depends(require_permission("inventory.item.read")),
    db: AsyncSession = Depends(get_db),
):
    rows = await db.execute(
        text("""
        WITH balances AS (
          SELECT item_id, store_id, SUM(quantity) AS available_qty,
                 SUM(COALESCE(total_cost, quantity * COALESCE(unit_cost, 0))) AS stock_value
          FROM procurement.stock_ledger
          WHERE organization_id=:org_id
            AND (CAST(:store_id AS uuid) IS NULL OR store_id=CAST(:store_id AS uuid))
          GROUP BY item_id, store_id
        )
        SELECT i.id, i.item_name, i.item_code, i.category, i.unit_of_measure,
               COALESCE(i.reorder_level, 0) AS reorder_level,
               COALESCE(i.standard_cost, 0) AS standard_cost,
               st.id AS store_id, st.name AS store_name, st.store_type,
               COALESCE(b.available_qty, 0) AS available_qty,
               COALESCE(b.stock_value, 0) AS stock_value,
               CASE WHEN COALESCE(b.available_qty, 0) <= COALESCE(i.reorder_level, 0) THEN true ELSE false END AS below_reorder
        FROM procurement.inventory_items i
        LEFT JOIN balances b ON b.item_id=i.id
        LEFT JOIN procurement.stores st ON st.id=b.store_id AND st.organization_id=:org_id
        WHERE i.organization_id=:org_id AND i.is_deleted=false
          AND (:below_reorder = false OR COALESCE(b.available_qty, 0) <= COALESCE(i.reorder_level, 0))
        ORDER BY i.item_name NULLS LAST, st.name NULLS LAST
        LIMIT 1000
    """),
        {
            "org_id": user["org_id"],
            "store_id": store_id,
            "below_reorder": below_reorder,
        },
    )
    data = [dict(r._mapping) for r in rows]
    return ok(data, "Stock levels listed.", len(data))


@router.get("/movements")
async def movements(
    store_id: Optional[UUID] = None,
    movement_type: Optional[str] = None,
    limit: int = Query(default=200, ge=1, le=1000),
    user: dict = Depends(require_permission("inventory.item.read")),
    db: AsyncSession = Depends(get_db),
):
    rows = await db.execute(
        text("""
        SELECT sl.*, i.item_name, i.item_code, st.name AS store_name, p.name AS project_name
        FROM procurement.stock_ledger sl
        JOIN procurement.inventory_items i ON i.id=sl.item_id AND i.organization_id=sl.organization_id
        LEFT JOIN procurement.stores st ON st.id=sl.store_id AND st.organization_id=sl.organization_id
        LEFT JOIN projects.projects p ON p.id=sl.project_id AND p.organization_id=sl.organization_id
        WHERE sl.organization_id=:org_id
          AND (CAST(:store_id AS uuid) IS NULL OR sl.store_id=CAST(:store_id AS uuid))
          AND (CAST(:movement_type AS varchar) IS NULL OR sl.movement_type=CAST(:movement_type AS varchar))
        ORDER BY sl.movement_at DESC, sl.created_at DESC
        LIMIT :limit
    """),
        {
            "org_id": user["org_id"],
            "store_id": store_id,
            "movement_type": movement_type,
            "limit": limit,
        },
    )
    data = [dict(r._mapping) for r in rows]
    return ok(data, "Stock movements listed.", len(data))


async def record_movement(
    db: AsyncSession,
    user: dict,
    payload: StockMovementPayload,
    movement_type: Literal["receipt", "issue"],
) -> UUID:
    await require_ref(
        db,
        "procurement.inventory_items",
        payload.item_id,
        user["org_id"],
        "Inventory item",
    )
    await require_ref(
        db, "procurement.stores", payload.store_id, user["org_id"], "Store"
    )
    await require_ref(
        db, "projects.projects", payload.project_id, user["org_id"], "Project"
    )
    if movement_type == "issue":
        available = await stock_balance(
            db,
            org_id=user["org_id"],
            item_id=payload.item_id,
            store_id=payload.store_id,
        )
        if available < payload.quantity:
            raise HTTPException(
                status_code=409,
                detail=f"Insufficient stock available for issue. Available quantity is {available}. Use a material request to procure the shortfall.",
            )
    signed_quantity = (
        payload.quantity if movement_type == "receipt" else -payload.quantity
    )
    row = await db.execute(
        text("""
        INSERT INTO procurement.stock_ledger (
            organization_id, item_id, store_id, project_id, movement_type, quantity,
            unit_cost, total_cost, source_type, source_id, reference, recorded_by
        ) VALUES (
            :org_id, :item_id, :store_id, :project_id, :movement_type, :quantity,
            :unit_cost, ROUND(ABS(CAST(:quantity AS numeric)) * CAST(:unit_cost AS numeric), 2), :source_type, gen_random_uuid(), :reference, :user_id
        ) RETURNING id
    """),
        {
            "org_id": user["org_id"],
            "item_id": payload.item_id,
            "store_id": payload.store_id,
            "project_id": payload.project_id,
            "movement_type": movement_type,
            "quantity": signed_quantity,
            "unit_cost": payload.unit_cost,
            "source_type": f"manual_{movement_type}",
            "reference": payload.reference
            or f"{movement_type.upper()}-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}",
            "user_id": user["user_id"],
        },
    )
    movement_id = row.scalar()
    event_type = (
        "inventory.receipt_recorded.v1"
        if movement_type == "receipt"
        else "inventory.issue_recorded.v1"
    )
    await emit_event(
        db,
        user=user,
        event_type=event_type,
        aggregate_type="stock_ledger",
        aggregate_id=movement_id,
        project_id=payload.project_id,
        payload=payload.model_dump(mode="json") | {"movement_type": movement_type},
    )
    if movement_type == "issue":
        remaining = await stock_balance(
            db,
            org_id=user["org_id"],
            item_id=payload.item_id,
            store_id=payload.store_id,
        )
        threshold = await reorder_level(
            db, org_id=user["org_id"], item_id=payload.item_id
        )
        if threshold > 0 and remaining <= threshold:
            await emit_event(
                db,
                user=user,
                event_type="inventory.below_reorder_level.v1",
                aggregate_type="inventory_item",
                aggregate_id=payload.item_id,
                project_id=payload.project_id,
                payload={
                    "store_id": str(payload.store_id) if payload.store_id else None,
                    "available_qty": str(remaining),
                    "reorder_level": str(threshold),
                    "source_movement_id": str(movement_id),
                },
            )
    return movement_id


@router.post("/receive", status_code=status.HTTP_201_CREATED)
async def receive_stock(
    payload: StockMovementPayload,
    user: dict = Depends(require_permission("inventory.receipt.create")),
    db: AsyncSession = Depends(get_db),
):
    movement_id = await record_movement(db, user, payload, "receipt")
    await db.commit()
    return ok({"id": str(movement_id)}, "Stock receipt recorded.")


@router.post("/issue", status_code=status.HTTP_201_CREATED)
async def issue_stock(
    payload: StockMovementPayload,
    user: dict = Depends(require_permission("inventory.issue.create")),
    db: AsyncSession = Depends(get_db),
):
    movement_id = await record_movement(db, user, payload, "issue")
    await db.commit()
    return ok({"id": str(movement_id)}, "Stock issue recorded.")
