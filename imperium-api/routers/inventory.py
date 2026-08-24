"""Inventory and materials control workflow APIs."""

from datetime import date, datetime
from decimal import Decimal
from typing import Any, Literal, Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.security import require_permission
from app.services import inventory_service
from app.shared.events import emit_event
from app.shared.sql import tenant_reference_sql

router = APIRouter()


class Payload(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class StockMovementPayload(Payload):
    item_id: UUID
    store_id: Optional[UUID] = None
    project_id: Optional[UUID] = None
    supplier_id: Optional[UUID] = None
    quantity: Decimal = Field(gt=0, max_digits=14, decimal_places=3)
    unit_cost: Decimal = Field(
        default=Decimal("0"), ge=0, max_digits=15, decimal_places=4
    )
    reference: Optional[str] = Field(default=None, max_length=160)
    work_package: Optional[str] = Field(default=None, max_length=160)
    notes: Optional[str] = None
    override_reason: Optional[str] = Field(default=None, max_length=2000)


class TransferStockPayload(Payload):
    item_id: UUID
    from_store_id: UUID
    to_store_id: UUID
    quantity: Decimal = Field(gt=0, max_digits=14, decimal_places=3)
    unit_cost: Decimal = Field(
        default=Decimal("0"), ge=0, max_digits=15, decimal_places=4
    )
    reference: Optional[str] = Field(default=None, max_length=160)
    notes: Optional[str] = None
    override_reason: Optional[str] = Field(default=None, max_length=2000)


class AdjustStockPayload(Payload):
    item_id: UUID
    store_id: UUID
    quantity_delta: Decimal = Field(max_digits=14, decimal_places=3)
    unit_cost: Decimal = Field(
        default=Decimal("0"), ge=0, max_digits=15, decimal_places=4
    )
    reason: str = Field(min_length=3, max_length=500)
    reference: Optional[str] = Field(default=None, max_length=160)


class StorePayload(Payload):
    name: str = Field(min_length=1, max_length=255)
    store_code: str = Field(min_length=1, max_length=80)
    store_type: Literal["warehouse", "site", "yard", "vehicle"] = "warehouse"
    project_id: Optional[UUID] = None
    site_id: Optional[UUID] = None
    location_label: Optional[str] = Field(default=None, max_length=255)
    status: Literal["active", "inactive", "closed"] = "active"


class InventoryInvoiceLinePayload(Payload):
    item_id: UUID
    store_id: Optional[UUID] = None
    project_id: Optional[UUID] = None
    quantity: Decimal = Field(gt=0, max_digits=14, decimal_places=3)
    unit_cost: Decimal = Field(ge=0, max_digits=15, decimal_places=4)
    vat_rate: Decimal = Field(default=Decimal("15.5"), ge=0, le=100, max_digits=6, decimal_places=3)
    vat_inclusive: bool = False
    description: Optional[str] = Field(default=None, max_length=2000)


class InventoryInvoiceReceiptPayload(Payload):
    supplier_id: UUID
    store_id: UUID
    project_id: Optional[UUID] = None
    invoice_number: str = Field(min_length=1, max_length=40)
    supplier_invoice_ref: Optional[str] = Field(default=None, max_length=160)
    invoice_date: date
    due_date: Optional[date] = None
    currency: str = Field(default="USD", min_length=3, max_length=3)
    notes: Optional[str] = None
    lines: list[InventoryInvoiceLinePayload] = Field(min_length=1, max_length=200)


def ok(data: Any, message: str, total: Optional[int] = None):
    return {
        "success": True,
        "data": data,
        "message": message,
        "meta": {} if total is None else {"total": total},
    }


def _round_money(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"))


def _round_unit(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.0001"))


def invoice_line_amounts(line: InventoryInvoiceLinePayload) -> dict[str, Decimal]:
    multiplier = Decimal("1") + (line.vat_rate / Decimal("100"))
    if line.vat_inclusive and line.vat_rate > 0:
        unit_inc = line.unit_cost
        unit_ex = line.unit_cost / multiplier
    else:
        unit_ex = line.unit_cost
        unit_inc = line.unit_cost * multiplier
    line_subtotal = _round_money(line.quantity * unit_ex)
    line_total = _round_money(line.quantity * unit_inc)
    return {
        "unit_ex": _round_unit(unit_ex),
        "unit_inc": _round_unit(unit_inc),
        "subtotal": line_subtotal,
        "vat_amount": _round_money(line_total - line_subtotal),
        "total": line_total,
    }


async def require_ref(
    db: AsyncSession, table: str, record_id: Optional[UUID], org_id: str, label: str
) -> None:
    if record_id is None:
        return
    allowed = {
        "procurement.inventory_items",
        "procurement.stores",
        "projects.projects",
        "procurement.suppliers",
    }
    if table not in allowed:
        raise HTTPException(status_code=500, detail="Unsupported reference validation")
    row = await db.execute(
        tenant_reference_sql(table, allowed),
        {"id": record_id, "org_id": org_id},
    )
    if not row.scalar():
        raise HTTPException(status_code=404, detail=f"{label} not found")


async def require_site_for_project(
    db: AsyncSession,
    *,
    site_id: Optional[UUID],
    project_id: Optional[UUID],
    org_id: str,
) -> None:
    if site_id is None:
        return
    row = await db.execute(
        text("""
        SELECT 1 FROM projects.sites
        WHERE id=:site_id AND organization_id=:org_id AND is_deleted=false
          AND (CAST(:project_id AS uuid) IS NULL OR project_id=CAST(:project_id AS uuid))
    """),
        {"site_id": site_id, "org_id": org_id, "project_id": project_id},
    )
    if not row.scalar():
        raise HTTPException(status_code=404, detail="Site not found for this project")


@router.get("/stock-levels")
async def stock_levels(
    store_id: Optional[UUID] = None,
    below_reorder: bool = False,
    user: dict = Depends(require_permission("inventory_items.read")),
    db: AsyncSession = Depends(get_db),
):
    rows = await db.execute(
        text("""
        WITH balances AS (
          SELECT item_id, store_id, SUM(quantity) AS available_qty,
                 SUM(quantity * COALESCE(unit_cost, 0)) AS stock_value
          FROM procurement.stock_ledger
          WHERE organization_id=:org_id
            AND (CAST(:store_id AS uuid) IS NULL OR store_id=CAST(:store_id AS uuid))
          GROUP BY item_id, store_id
        )
        SELECT i.id, i.item_name, i.item_code, i.category, i.item_type, i.unit_of_measure,
               COALESCE(i.reorder_level, 0) AS reorder_level,
               COALESCE(i.standard_cost, 0) AS standard_cost,
               COALESCE(i.vat_rate, 0) AS vat_rate,
               COALESCE(i.vat_inclusive, false) AS vat_inclusive,
               COALESCE(i.unit_price_ex_vat, i.standard_cost, 0) AS unit_price_ex_vat,
               COALESCE(i.unit_price_inc_vat, i.standard_cost, 0) AS unit_price_inc_vat,
               st.id AS store_id, st.name AS store_name, st.store_type,
               st.project_id, p.name AS project_name, p.client_name,
               COALESCE(b.available_qty, 0) AS available_qty,
               COALESCE(b.stock_value, 0) AS stock_value,
               CASE WHEN COALESCE(b.available_qty, 0) <= COALESCE(i.reorder_level, 0) THEN true ELSE false END AS below_reorder
        FROM procurement.inventory_items i
        LEFT JOIN balances b ON b.item_id=i.id
        LEFT JOIN procurement.stores st ON st.id=b.store_id AND st.organization_id=:org_id
        LEFT JOIN projects.projects p ON p.id=st.project_id AND p.organization_id=:org_id
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
    user: dict = Depends(require_permission("inventory_items.read")),
    db: AsyncSession = Depends(get_db),
):
    rows = await db.execute(
        text("""
        SELECT sl.*, i.item_name, i.item_code, st.name AS store_name, p.name AS project_name, p.client_name
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


@router.get("/stores")
async def list_stores(
    project_id: Optional[UUID] = None,
    user: dict = Depends(require_permission("inventory_items.read")),
    db: AsyncSession = Depends(get_db),
):
    rows = await db.execute(
        text("""
        SELECT st.*, p.name AS project_name, p.client_name, s.name AS site_name
        FROM procurement.stores st
        LEFT JOIN projects.projects p ON p.id=st.project_id AND p.organization_id=st.organization_id
        LEFT JOIN projects.sites s ON s.id=st.site_id AND s.organization_id=st.organization_id
        WHERE st.organization_id=:org_id AND st.is_deleted=false
          AND (CAST(:project_id AS uuid) IS NULL OR st.project_id=CAST(:project_id AS uuid))
        ORDER BY st.store_type, st.name
        LIMIT 500
    """),
        {"org_id": user["org_id"], "project_id": project_id},
    )
    data = [dict(r._mapping) for r in rows]
    return ok(data, "Stores listed.", len(data))


@router.post("/stores", status_code=status.HTTP_201_CREATED)
async def create_store(
    payload: StorePayload,
    user: dict = Depends(require_permission("inventory.store.manage")),
    db: AsyncSession = Depends(get_db),
):
    await require_ref(
        db, "projects.projects", payload.project_id, user["org_id"], "Project"
    )
    await require_site_for_project(
        db, site_id=payload.site_id, project_id=payload.project_id, org_id=user["org_id"]
    )
    try:
        store_id = (
            await db.execute(
                text("""
            INSERT INTO procurement.stores (
                organization_id, project_id, site_id, store_code, name, store_type,
                location_label, status, created_by
            ) VALUES (
                :org_id, :project_id, :site_id, :store_code, :name, :store_type,
                :location_label, :status, :user_id
            ) RETURNING id
        """),
                {
                    **payload.model_dump(),
                    "org_id": user["org_id"],
                    "user_id": user["user_id"],
                },
            )
        ).scalar()
        await emit_event(
            db,
            user=user,
            event_type="inventory.store.created.v1",
            aggregate_type="store",
            aggregate_id=store_id,
            project_id=payload.project_id,
            event_data=payload.model_dump(mode="json"),
        )
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=409, detail="Store code already exists."
        ) from exc
    return ok({"id": str(store_id)}, "Store registered.")


@router.post("/receive", status_code=status.HTTP_201_CREATED)
async def receive_stock(
    payload: StockMovementPayload,
    user: dict = Depends(require_permission("inventory.receipt.create")),
    db: AsyncSession = Depends(get_db),
):
    await require_ref(
        db, "procurement.inventory_items", payload.item_id, user["org_id"], "Inventory item"
    )
    await require_ref(
        db, "procurement.stores", payload.store_id, user["org_id"], "Store"
    )
    await require_ref(
        db, "projects.projects", payload.project_id, user["org_id"], "Project"
    )
    await require_ref(
        db, "procurement.suppliers", payload.supplier_id, user["org_id"], "Supplier"
    )
    movement_id = await inventory_service.receive_stock(
        db,
        user,
        item_id=payload.item_id,
        store_id=payload.store_id,
        project_id=payload.project_id,
        quantity=payload.quantity,
        unit_cost=payload.unit_cost,
        source_type="manual_receipt",
        source_id=uuid4(),
        reference=payload.reference
        or f"RECEIPT-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}",
        notes=payload.notes,
        supplier_id=payload.supplier_id,
    )
    await db.commit()
    return ok({"id": str(movement_id)}, "Stock receipt recorded.")


@router.post("/receive-invoice", status_code=status.HTTP_201_CREATED)
async def receive_inventory_invoice(
    payload: InventoryInvoiceReceiptPayload,
    user: dict = Depends(require_permission("procurement.invoice.create")),
    db: AsyncSession = Depends(get_db),
):
    await require_ref(
        db, "procurement.suppliers", payload.supplier_id, user["org_id"], "Supplier"
    )
    await require_ref(db, "procurement.stores", payload.store_id, user["org_id"], "Store")
    await require_ref(db, "projects.projects", payload.project_id, user["org_id"], "Project")

    subtotal = Decimal("0")
    tax_amount = Decimal("0")
    total_amount = Decimal("0")
    prepared_lines: list[dict[str, Any]] = []
    for line in payload.lines:
        line_store_id = line.store_id or payload.store_id
        line_project_id = line.project_id or payload.project_id
        await require_ref(
            db, "procurement.inventory_items", line.item_id, user["org_id"], "Inventory item"
        )
        await require_ref(db, "procurement.stores", line_store_id, user["org_id"], "Store")
        await require_ref(db, "projects.projects", line_project_id, user["org_id"], "Project")
        amounts = invoice_line_amounts(line)
        subtotal += amounts["subtotal"]
        tax_amount += amounts["vat_amount"]
        total_amount += amounts["total"]
        prepared_lines.append(
            {
                "line": line,
                "store_id": line_store_id,
                "project_id": line_project_id,
                **amounts,
            }
        )

    try:
        invoice_id = (
            await db.execute(
                text("""
            INSERT INTO procurement.supplier_invoices (
                organization_id, invoice_number, supplier_invoice_ref, supplier_id, project_id,
                invoice_date, due_date, currency, subtotal, tax_amount, total_amount, notes, created_by
            ) VALUES (
                :org_id, :invoice_number, :supplier_invoice_ref, :supplier_id, :project_id,
                :invoice_date, :due_date, :currency, :subtotal, :tax_amount, :total_amount, :notes, :user_id
            ) RETURNING id
        """),
                {
                    "org_id": user["org_id"],
                    "invoice_number": payload.invoice_number,
                    "supplier_invoice_ref": payload.supplier_invoice_ref,
                    "supplier_id": payload.supplier_id,
                    "project_id": payload.project_id,
                    "invoice_date": payload.invoice_date,
                    "due_date": payload.due_date,
                    "currency": payload.currency.upper(),
                    "subtotal": _round_money(subtotal),
                    "tax_amount": _round_money(tax_amount),
                    "total_amount": _round_money(total_amount),
                    "notes": payload.notes,
                    "user_id": user["user_id"],
                },
            )
        ).scalar()

        movement_totals: dict[tuple[UUID, UUID, Optional[UUID]], dict[str, Decimal]] = {}
        for prepared in prepared_lines:
            line = prepared["line"]
            item_row = (
                await db.execute(
                    text("""
                    SELECT unit_of_measure FROM procurement.inventory_items
                    WHERE id=:item_id AND organization_id=:org_id AND is_deleted=false
                """),
                    {"item_id": line.item_id, "org_id": user["org_id"]},
                )
            ).mappings().first()
            await db.execute(
                text("""
                INSERT INTO procurement.supplier_invoice_lines (
                    organization_id, supplier_invoice_id, item_id, store_id, project_id,
                    description, quantity, unit_of_measure, unit_cost_ex_vat, vat_rate,
                    vat_amount, unit_cost_inc_vat, line_subtotal, line_total, created_by
                ) VALUES (
                    :org_id, :invoice_id, :item_id, :store_id, :project_id,
                    :description, :quantity, :unit_of_measure, :unit_ex, :vat_rate,
                    :vat_amount, :unit_inc, :subtotal, :total, :user_id
                )
            """),
                {
                    "org_id": user["org_id"],
                    "invoice_id": invoice_id,
                    "item_id": line.item_id,
                    "store_id": prepared["store_id"],
                    "project_id": prepared["project_id"],
                    "description": line.description,
                    "quantity": line.quantity,
                    "unit_of_measure": item_row["unit_of_measure"] if item_row else None,
                    "unit_ex": prepared["unit_ex"],
                    "vat_rate": line.vat_rate,
                    "vat_amount": prepared["vat_amount"],
                    "unit_inc": prepared["unit_inc"],
                    "subtotal": prepared["subtotal"],
                    "total": prepared["total"],
                    "user_id": user["user_id"],
                },
            )
            key = (line.item_id, prepared["store_id"], prepared["project_id"])
            movement = movement_totals.setdefault(
                key, {"quantity": Decimal("0"), "total": Decimal("0")}
            )
            movement["quantity"] += line.quantity
            movement["total"] += prepared["total"]

        movement_ids: list[str] = []
        for (item_id, store_id, project_id), movement in movement_totals.items():
            unit_inc = _round_unit(movement["total"] / movement["quantity"])
            movement_id = await inventory_service.receive_stock(
                db,
                user,
                item_id=item_id,
                store_id=store_id,
                project_id=project_id,
                quantity=movement["quantity"],
                unit_cost=unit_inc,
                source_type="supplier_invoice",
                source_id=invoice_id,
                reference=payload.invoice_number,
                notes=payload.notes,
                supplier_id=payload.supplier_id,
            )
            movement_ids.append(str(movement_id))

        await emit_event(
            db,
            user=user,
            event_type="inventory.invoice_received.v1",
            aggregate_type="supplier_invoice",
            aggregate_id=invoice_id,
            project_id=payload.project_id,
            event_data={
                "invoice_number": payload.invoice_number,
                "supplier_id": str(payload.supplier_id),
                "line_count": len(payload.lines),
                "subtotal": str(_round_money(subtotal)),
                "tax_amount": str(_round_money(tax_amount)),
                "total_amount": str(_round_money(total_amount)),
                "movement_ids": movement_ids,
            },
        )
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Duplicate supplier invoice.") from exc

    return ok(
        {
            "id": str(invoice_id),
            "invoice_number": payload.invoice_number,
            "subtotal": str(_round_money(subtotal)),
            "tax_amount": str(_round_money(tax_amount)),
            "total_amount": str(_round_money(total_amount)),
            "movement_ids": movement_ids,
        },
        "Supplier invoice and stock receipts captured.",
    )


@router.post("/issue", status_code=status.HTTP_201_CREATED)
async def issue_stock(
    payload: StockMovementPayload,
    user: dict = Depends(require_permission("inventory.issue.create")),
    db: AsyncSession = Depends(get_db),
):
    await require_ref(
        db, "procurement.inventory_items", payload.item_id, user["org_id"], "Inventory item"
    )
    await require_ref(
        db, "procurement.stores", payload.store_id, user["org_id"], "Store"
    )
    await require_ref(
        db, "projects.projects", payload.project_id, user["org_id"], "Project"
    )
    outcome = await inventory_service.issue_stock(
        db,
        user,
        item_id=payload.item_id,
        store_id=payload.store_id,
        project_id=payload.project_id,
        quantity=payload.quantity,
        unit_cost=payload.unit_cost,
        source_type="manual_issue",
        source_id=uuid4(),
        reference=payload.reference
        or f"ISSUE-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}",
        notes=payload.notes,
        cost_description=payload.reference or "Manual stock issue",
        override_reason=payload.override_reason,
    )
    await db.commit()
    return ok({"id": str(outcome["movement_id"])}, "Stock issue recorded.")


@router.post("/transfer", status_code=status.HTTP_201_CREATED)
async def transfer_stock(
    payload: TransferStockPayload,
    user: dict = Depends(require_permission("inventory.transfer.create")),
    db: AsyncSession = Depends(get_db),
):
    await require_ref(
        db, "procurement.inventory_items", payload.item_id, user["org_id"], "Inventory item"
    )
    await require_ref(
        db, "procurement.stores", payload.from_store_id, user["org_id"], "Source store"
    )
    await require_ref(
        db, "procurement.stores", payload.to_store_id, user["org_id"], "Destination store"
    )
    outcome = await inventory_service.transfer_stock(
        db,
        user,
        item_id=payload.item_id,
        from_store_id=payload.from_store_id,
        to_store_id=payload.to_store_id,
        quantity=payload.quantity,
        unit_cost=payload.unit_cost,
        reference=payload.reference
        or f"TRANSFER-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}",
        notes=payload.notes,
        override_reason=payload.override_reason,
    )
    await db.commit()
    return ok(
        {
            "transfer_id": str(outcome["transfer_id"]),
            "out_movement_id": str(outcome["out_movement_id"]),
            "in_movement_id": str(outcome["in_movement_id"]),
        },
        "Stock transfer completed.",
    )


@router.post("/adjustment", status_code=status.HTTP_201_CREATED)
async def record_adjustment(
    payload: AdjustStockPayload,
    user: dict = Depends(require_permission("inventory.count.create")),
    db: AsyncSession = Depends(get_db),
):
    await require_ref(
        db, "procurement.inventory_items", payload.item_id, user["org_id"], "Inventory item"
    )
    await require_ref(
        db, "procurement.stores", payload.store_id, user["org_id"], "Store"
    )
    outcome = await inventory_service.adjust_stock(
        db,
        user,
        item_id=payload.item_id,
        store_id=payload.store_id,
        quantity_delta=payload.quantity_delta,
        unit_cost=payload.unit_cost,
        reason=payload.reason,
        reference=payload.reference
        or f"ADJUST-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}",
    )
    await db.commit()
    return ok({"id": str(outcome["movement_id"])}, "Stock adjustment recorded.")
