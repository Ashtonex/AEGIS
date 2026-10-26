"""Verifies manual stock movements on the configured database inside a
transaction that is always rolled back (push/email stubbed).

    .venv/Scripts/python.exe scripts/verify_stock_movements.py

  1. receipt / issue / transfer / adjustment repeated with the same
     request_id -> recorded once, the repeat says "already recorded"
  2. two separate issues of one item to the same work order (or vehicle)
     -> two ledger rows and two cost rows (the second used to be dropped)
  3. issuing more than is in the store (non-override role) -> 409
"""

import asyncio
from decimal import Decimal
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import text

from _rollback_harness import block_outbound, check, finish, rollback_session
from routers.inventory import (  # noqa: E402
    AdjustStockPayload, StockMovementPayload, TransferStockPayload,
    issue_stock, receive_stock, record_adjustment, transfer_stock,
)


async def ledger_count(db, source_id):
    return (await db.execute(text("SELECT count(*) FROM procurement.stock_ledger WHERE source_id = :s"), {"s": source_id})).scalar()


async def run() -> None:
    with block_outbound():
        async with rollback_session() as db:
            stock = (await db.execute(text("""
                SELECT sl.item_id, sl.store_id, sl.organization_id::text AS org_id, sum(sl.quantity) AS qty
                FROM procurement.stock_ledger sl WHERE sl.store_id IS NOT NULL
                GROUP BY 1, 2, 3 HAVING sum(sl.quantity) >= 5 ORDER BY sum(sl.quantity) DESC LIMIT 1
            """))).first()
            other_store = (await db.execute(text("""
                SELECT id FROM procurement.stores WHERE organization_id = :o AND id <> :s AND NOT is_deleted LIMIT 1
            """), {"o": stock.org_id, "s": stock.store_id})).scalar()
            uid = (await db.execute(text("SELECT id::text FROM core.users WHERE organization_id = :o LIMIT 1"), {"o": stock.org_id})).scalar()
            user = {"user_id": uid, "sub": uid, "org_id": stock.org_id, "role": "Storekeeper"}

            print("\n== 1. repeated submissions")
            rid = uuid4()
            body = dict(item_id=stock.item_id, store_id=stock.store_id, quantity=Decimal("2"), unit_cost=Decimal("3.50"), request_id=rid)
            await receive_stock(StockMovementPayload(**body), user=user, db=db)
            again = await receive_stock(StockMovementPayload(**body), user=user, db=db)
            check(await ledger_count(db, rid) == 1 and again["data"].get("already_recorded"), "receipt recorded once")

            rid = uuid4()
            body = dict(item_id=stock.item_id, store_id=stock.store_id, quantity=Decimal("1"), unit_cost=Decimal("3.50"), request_id=rid)
            await issue_stock(StockMovementPayload(**body), user=user, db=db)
            again = await issue_stock(StockMovementPayload(**body), user=user, db=db)
            check(await ledger_count(db, rid) == 1 and again["data"].get("already_recorded"), "issue recorded once")

            if other_store:
                rid = uuid4()
                body = dict(item_id=stock.item_id, from_store_id=stock.store_id, to_store_id=other_store, quantity=Decimal("1"), request_id=rid)
                await transfer_stock(TransferStockPayload(**body), user=user, db=db)
                again = await transfer_stock(TransferStockPayload(**body), user=user, db=db)
                check(await ledger_count(db, rid) == 2 and again["data"].get("already_recorded"), "transfer recorded once (one out + one in)")

            rid = uuid4()
            body = dict(item_id=stock.item_id, store_id=stock.store_id, quantity_delta=Decimal("-1"), reason="verification count", request_id=rid)
            await record_adjustment(AdjustStockPayload(**body), user=user, db=db)
            again = await record_adjustment(AdjustStockPayload(**body), user=user, db=db)
            check(await ledger_count(db, rid) == 1 and again["data"].get("already_recorded"), "adjustment recorded once")

            print("\n== 2. two issues of one item to the same work order / vehicle")
            wo = (await db.execute(text("SELECT id FROM fleet.maintenance_work_orders WHERE organization_id = :o AND NOT is_deleted LIMIT 1"), {"o": stock.org_id})).scalar()
            fleet = (await db.execute(text("SELECT id FROM fleet.fleet WHERE organization_id = :o AND NOT is_deleted LIMIT 1"), {"o": stock.org_id})).scalar()
            target = {"work_order_id": wo} if wo else ({"fleet_id": fleet} if fleet else None)
            if target:
                ids = [uuid4(), uuid4()]
                for r in ids:
                    await issue_stock(StockMovementPayload(item_id=stock.item_id, store_id=stock.store_id, quantity=Decimal("1"),
                                                           unit_cost=Decimal("2"), request_id=r, **target), user=user, db=db)
                rows = sum([await ledger_count(db, r) for r in ids])
                costs = (await db.execute(text("SELECT count(*) FROM finance.cost_transactions WHERE source_id = ANY(:ids)"), {"ids": ids})).scalar()
                check(rows == 2, f"both issues in the ledger ({rows}) via {list(target)[0]}")
                project_linked = (await db.execute(text("SELECT count(*) FROM procurement.stock_ledger WHERE source_id = ANY(:ids) AND project_id IS NOT NULL"), {"ids": ids})).scalar()
                check(costs == project_linked, f"one cost per project-linked issue ({costs})")
            else:
                print("  (no work order or fleet asset to test with)")

            print("\n== 3. shortage")
            try:
                await issue_stock(StockMovementPayload(item_id=stock.item_id, store_id=stock.store_id, quantity=Decimal("999999"),
                                                       request_id=uuid4()), user=user, db=db)
                check(False, "issue beyond available stock refused")
            except HTTPException as exc:
                check(exc.status_code == 409, f"issue beyond available stock refused ({exc.detail[:60]}...)")
    finish()


if __name__ == "__main__":
    asyncio.run(run())
