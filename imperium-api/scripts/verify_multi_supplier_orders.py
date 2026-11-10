"""End-to-end check of ordering one requisition from several suppliers
(migration 292) against an ISOLATED local database.

Needs a local database holding the production schema (pg_dump --schema-only)
with migration 292 NOT yet applied. Refuses to run unless DATABASE_URL is local.

    set DATABASE_URL=postgresql+asyncpg://postgres@127.0.0.1:55434/msplit_test
    set PSQL=<path to psql.exe>
    python scripts/verify_multi_supplier_orders.py

  A. migration: a requisition ordered the old way (one PO, lines copied) gets
     its PO lines linked to the requisition lines; 'partially_ordered' allowed
  B. (rolled back) split ordering:
     1. cement 60 to supplier A + 40 to B, sand to A, rebar left for later
        -> 2 POs, lines linked, requisition partially_ordered
     2. refusals: over-ordering, same line+supplier twice, no reason, a quote
        from another supplier, a quote from another requisition
     3. the old one-supplier PO orders only the rebar that is left -> ordered;
        again -> refused; PO-from-quote on a partly ordered one -> refused
     4. amend: removing an ordered line or cutting below the ordered quantity
        -> refused; adding a line -> back to partially_ordered
     5. quote-priced split needs no reason, marks the quotes selected and, once
        fully ordered, closes the RFQ and rejects the unused quote
     6. a legacy requisition (unlinked PO line) keeps its status on amend
"""

import asyncio
import os
import subprocess
import sys
import uuid
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

URL = os.environ.get("DATABASE_URL", "")
if (urlsplit(URL).hostname or "") not in ("127.0.0.1", "localhost"):
    sys.exit("Refusing to run: DATABASE_URL must point at an isolated local database.")

from fastapi import HTTPException  # noqa: E402
from sqlalchemy import text  # noqa: E402

from _rollback_harness import FAILURES, block_outbound, check, rollback_session  # noqa: E402
from core.database import engine  # noqa: E402
from core.security import SUPERADMIN_ROLE  # noqa: E402
from routers.procurement import (  # noqa: E402
    PurchaseOrderFromRequisition, PurchaseOrderFromRfq, RequisitionAmendPayload, SupplierOrdersPayload,
    amend_requisition, create_purchase_order, create_purchase_order_from_rfq,
    create_supplier_purchase_orders,
)

MIGRATION = ROOT / "migrations" / "292_requisition_multi_supplier_orders.sql"
ORG, USER, PROJECT = (str(uuid.uuid4()) for _ in range(3))
SUP_A, SUP_B, SUP_C = (str(uuid.uuid4()) for _ in range(3))
LEGACY_REQ, LEGACY_PO = str(uuid.uuid4()), str(uuid.uuid4())
LEGACY_LINES = [str(uuid.uuid4()) for _ in range(3)]
USER_CTX = {"user_id": USER, "sub": USER, "org_id": ORG, "role": SUPERADMIN_ROLE, "email": "verify@example.test"}


def psql_file(path: Path) -> bool:
    u = urlsplit(URL)
    result = subprocess.run(
        [os.environ["PSQL"], "-h", u.hostname, "-p", str(u.port), "-U", u.username or "postgres",
         "-d", u.path.lstrip("/"), "-v", "ON_ERROR_STOP=1", "-q", "-f", str(path)],
        capture_output=True, text=True,
    )
    check(result.returncode == 0, f"migration applies cleanly {result.stderr.strip()[-300:]}")
    return result.returncode == 0


async def attempt(coro):
    try:
        return await coro, None
    except HTTPException as exc:
        return None, exc


async def q(db, sql: str, **params):
    return await db.execute(text(sql), params)


async def seed_base() -> None:
    """Committed seed (local DB only): org, user, project, suppliers and a
    requisition ordered the old way, before the migration exists."""
    async with engine.begin() as conn:
        await conn.execute(text("INSERT INTO core.organizations (id, name) VALUES (:o, 'Verify Org')"), {"o": ORG})
        await conn.execute(text("INSERT INTO auth.users (id, email) VALUES (:u, 'verify@example.test')"), {"u": USER})
        await conn.execute(text("INSERT INTO core.users (id, organization_id, full_name, email) VALUES (:u, :o, 'Verify Buyer', 'verify@example.test')"), {"u": USER, "o": ORG})
        await conn.execute(text("INSERT INTO projects.projects (id, organization_id, name) VALUES (:p, :o, 'Verify House')"), {"p": PROJECT, "o": ORG})
        for sid, name in ((SUP_A, "Bhola Hardware"), (SUP_B, "Halsteds"), (SUP_C, "Electrosales")):
            await conn.execute(text("INSERT INTO procurement.suppliers (id, organization_id, supplier_name) VALUES (:s, :o, :n)"), {"s": sid, "o": ORG, "n": name})
        await conn.execute(text("""
            INSERT INTO procurement.purchase_requisitions (id, organization_id, requisition_number, project_id, requested_by, status, total_estimated)
            VALUES (:r, :o, 'REQ-LEGACY', :p, :u, 'ordered', 0)"""), {"r": LEGACY_REQ, "o": ORG, "p": PROJECT, "u": USER})
        for lid, desc in zip(LEGACY_LINES, ("Bricks", "Bricks", "Timber")):
            await conn.execute(text("""
                INSERT INTO procurement.requisition_lines (id, organization_id, requisition_id, description, quantity, estimated_unit_cost)
                VALUES (:l, :o, :r, :d, 10, 1)"""), {"l": lid, "o": ORG, "r": LEGACY_REQ, "d": desc})
        await conn.execute(text("""
            INSERT INTO procurement.purchase_orders (id, organization_id, po_number, requisition_id, supplier_id, project_id, subtotal, total_amount, status)
            VALUES (:po, :o, 'PO-LEGACY', :r, :s, :p, 30, 30, 'issued')"""), {"po": LEGACY_PO, "o": ORG, "r": LEGACY_REQ, "s": SUP_A, "p": PROJECT})
        # Copies of the three lines: 'Bricks' twice is ambiguous, ' timber ' matches by case/space.
        for desc in ("Bricks", "Bricks", " timber "):
            await conn.execute(text("""
                INSERT INTO procurement.purchase_order_lines (organization_id, po_id, description, quantity, unit_price, line_total)
                VALUES (:o, :po, :d, 10, 1, 10)"""), {"o": ORG, "po": LEGACY_PO, "d": desc})


async def make_requisition(db, number: str, lines: list[tuple[str, str, str, str]], status: str = "approved") -> tuple[str, dict[str, str]]:
    req_id = str(uuid.uuid4())
    await q(db, """
        INSERT INTO procurement.purchase_requisitions (id, organization_id, requisition_number, project_id, requested_by, status, required_by_date, total_estimated)
        VALUES (:r, :o, :n, :p, :u, :s, :d, 0)""", r=req_id, o=ORG, n=number, p=PROJECT, u=USER, s=status, d=date.today() + timedelta(days=10))
    ids = {}
    for desc, qty, uom, cost in lines:
        ids[desc] = str((await q(db, """
            INSERT INTO procurement.requisition_lines (organization_id, requisition_id, description, quantity, unit_of_measure, estimated_unit_cost)
            VALUES (:o, :r, :d, :q, :u, :c) RETURNING id""", o=ORG, r=req_id, d=desc, q=Decimal(qty), u=uom, c=Decimal(cost))).scalar())
    return req_id, ids


async def req_status(db, req_id: str) -> str:
    return (await q(db, "SELECT status FROM procurement.purchase_requisitions WHERE id = :r", r=req_id)).scalar()


async def run() -> None:
    print("\n== A. migration")
    async with engine.connect() as conn:
        has_column = (await conn.execute(text(
            "SELECT 1 FROM information_schema.columns WHERE table_schema='procurement' AND table_name='purchase_order_lines' AND column_name='requisition_line_id'"
        ))).scalar()
    if has_column:
        sys.exit("Migration 292 is already applied here; reload the schema-only replica first.")
    await seed_base()
    if not psql_file(MIGRATION):
        return
    async with engine.connect() as conn:
        links = (await conn.execute(text("""
            SELECT lower(btrim(pol.description)) AS d, pol.requisition_line_id::text AS l
            FROM procurement.purchase_order_lines pol WHERE pol.po_id = :po ORDER BY 1, 2"""), {"po": LEGACY_PO})).all()
    linked = {(d, link) for d, link in links if link}
    check(linked == {("timber", LEGACY_LINES[2])}, f"backfill links only the unambiguous line (timber) {linked}")
    check(sum(1 for _, link in links if link is None) == 2, "the two ambiguous 'Bricks' lines stay unlinked")

    with block_outbound():
        async with rollback_session() as db:
            print("\n== B1. split one requisition across suppliers")
            req_id, line = await make_requisition(db, "REQ-SPLIT", [
                ("Cement 50kg", "100", "bag", "12.50"), ("River sand", "6", "m3", "30"), ("Y12 rebar", "40", "length", "9"),
            ])
            reason = "Bhola cheapest on cement but short of stock"
            res, err = await attempt(create_supplier_purchase_orders(req_id, SupplierOrdersPayload(
                lines=[
                    {"requisition_line_id": line["Cement 50kg"], "supplier_id": SUP_A, "quantity": "60", "unit_price": "10.50"},
                    {"requisition_line_id": line["Cement 50kg"], "supplier_id": SUP_B, "quantity": "40", "unit_price": "11"},
                    {"requisition_line_id": line["River sand"], "supplier_id": SUP_A, "quantity": "6", "unit_price": "28"},
                ],
                suppliers=[{"supplier_id": SUP_B, "tax_amount": "15.50"}],
                selection_reason=reason,
            ), user=USER_CTX, db=db))
            check(err is None, f"split accepted {err.detail if err else ''}")
            if err:
                return
            data = res["data"]
            check(len(data["purchase_orders"]) == 2, f"two POs, one per supplier ({len(data['purchase_orders'])})")
            check(data["requisition_status"] == "partially_ordered", f"requisition partially_ordered ({data['requisition_status']})")
            pos = {r.supplier_id: r for r in (await q(db, """
                SELECT po.supplier_id::text AS supplier_id, po.id, po.subtotal, po.tax_amount, po.total_amount, po.status, po.notes,
                       count(pol.id) AS n, count(pol.requisition_line_id) AS linked, sum(pol.line_total) AS lines_total
                FROM procurement.purchase_orders po JOIN procurement.purchase_order_lines pol ON pol.po_id = po.id
                WHERE po.requisition_id = :r GROUP BY po.id""", r=req_id)).all()}
            a, b = pos.get(SUP_A), pos.get(SUP_B)
            check(a is not None and a.n == 2 and a.linked == 2 and a.subtotal == Decimal("798.00"), f"supplier A: cement 60 + sand 6 = 798.00 ({a and a.subtotal})")
            check(b is not None and b.n == 1 and b.subtotal == Decimal("440.00") and b.tax_amount == Decimal("15.50") and b.total_amount == Decimal("455.50"),
                  f"supplier B: cement 40 = 440.00 + tax 15.50 ({b and b.total_amount})")
            check(all(p.status == "draft" and p.lines_total == p.subtotal and p.notes == reason for p in pos.values()), "both draft, line totals = subtotal, reason on the PO")
            events = (await q(db, "SELECT count(*) FROM core.domain_events WHERE event_type = 'procurement.purchase_order.created.v1' AND aggregate_id = ANY(CAST(:ids AS uuid[]))",
                              ids=[str(p.id) for p in pos.values()])).scalar()
            check(events == 2, f"one created event per PO ({events})")

            print("\n== B2. refusals")
            cases = [
                ("over-ordering the rebar", [{"requisition_line_id": line["Y12 rebar"], "supplier_id": SUP_C, "quantity": "41", "unit_price": "9"}], reason, 409),
                ("cement is fully on order", [{"requisition_line_id": line["Cement 50kg"], "supplier_id": SUP_C, "quantity": "1", "unit_price": "9"}], reason, 409),
                ("same line and supplier twice", [
                    {"requisition_line_id": line["Y12 rebar"], "supplier_id": SUP_C, "quantity": "10", "unit_price": "9"},
                    {"requisition_line_id": line["Y12 rebar"], "supplier_id": SUP_C, "quantity": "10", "unit_price": "9"}], reason, 422),
                ("no reason without quotes", [{"requisition_line_id": line["Y12 rebar"], "supplier_id": SUP_C, "quantity": "10", "unit_price": "9"}], "", 422),
                ("a line from another requisition", [{"requisition_line_id": LEGACY_LINES[0], "supplier_id": SUP_C, "quantity": "1", "unit_price": "9"}], reason, 422),
            ]
            for label, lines, why, code in cases:
                _, err = await attempt(create_supplier_purchase_orders(req_id, SupplierOrdersPayload(lines=lines, selection_reason=why or None), user=USER_CTX, db=db))
                check(err is not None and err.status_code == code, f"{label} -> {code} ({err and err.status_code}: {err and err.detail})")
            count = (await q(db, "SELECT count(*) FROM procurement.purchase_orders WHERE requisition_id = :r", r=req_id)).scalar()
            check(count == 2, f"no PO from any refused call ({count})")

            print("\n== B3. old single-supplier PO orders only what is left")
            res, err = await attempt(create_purchase_order(PurchaseOrderFromRequisition(requisition_id=req_id, supplier_id=SUP_C, notes="Only rebar stockist with stock"), user=USER_CTX, db=db))
            check(err is None, f"direct PO for the rest {err.detail if err else ''}")
            rest = (await q(db, "SELECT count(*) AS n, sum(quantity) AS qty, bool_and(requisition_line_id = :l) AS linked FROM procurement.purchase_order_lines pol JOIN procurement.purchase_orders po ON po.id = pol.po_id WHERE po.supplier_id = :s AND po.requisition_id = :r",
                        s=SUP_C, r=req_id, l=line["Y12 rebar"])).first()
            check(rest.n == 1 and rest.qty == Decimal("40") and rest.linked, f"it holds only the 40 rebar, linked ({rest.n} lines, {rest.qty})")
            check(await req_status(db, req_id) == "ordered", f"requisition now ordered ({await req_status(db, req_id)})")
            _, err = await attempt(create_purchase_order(PurchaseOrderFromRequisition(requisition_id=req_id, supplier_id=SUP_C, notes="Only rebar stockist with stock"), user=USER_CTX, db=db))
            check(err is not None and err.status_code == 409, f"a further PO refused ({err and err.detail})")

            print("\n== B4. amendments respect what is on order")
            current = {r.description: r for r in (await q(db, "SELECT id, description, quantity, unit_of_measure, estimated_unit_cost FROM procurement.requisition_lines WHERE requisition_id = :r AND NOT is_deleted", r=req_id)).all()}

            def amend_line(desc: str, qty: str):
                r = current[desc]
                return {"id": r.id, "description": r.description, "qty": qty, "uom": r.unit_of_measure, "unit_cost": r.estimated_unit_cost}

            _, err = await attempt(amend_requisition(req_id, RequisitionAmendPayload(
                lines=[amend_line("Cement 50kg", "100"), amend_line("River sand", "6")], reason="drop the rebar"), user=USER_CTX, db=db))
            check(err is not None and err.status_code == 409 and "Y12 rebar" in err.detail, f"removing an ordered line refused ({err and err.detail})")
            _, err = await attempt(amend_requisition(req_id, RequisitionAmendPayload(
                lines=[amend_line("Cement 50kg", "90"), amend_line("River sand", "6"), amend_line("Y12 rebar", "40")], reason="less cement"), user=USER_CTX, db=db))
            check(err is not None and err.status_code == 409, f"cutting cement below the 100 ordered refused ({err and err.detail})")
            res, err = await attempt(amend_requisition(req_id, RequisitionAmendPayload(
                lines=[amend_line("Cement 50kg", "120"), amend_line("River sand", "6"), amend_line("Y12 rebar", "40"),
                       {"description": "Binding wire", "qty": "5", "uom": "roll", "unit_cost": "4"}], reason="site needs more"), user=USER_CTX, db=db))
            check(err is None and res["data"]["status"] == "partially_ordered" and await req_status(db, req_id) == "partially_ordered",
                  f"more cement + a new line -> partially_ordered ({err.detail if err else res['data']['status']})")

            print("\n== B5. quote-priced split")
            req2, line2 = await make_requisition(db, "REQ-QUOTED", [("Roof sheets", "50", "sheet", "15"), ("Ridge caps", "10", "each", "8")])
            rfq_id = str((await q(db, "INSERT INTO procurement.rfqs (organization_id, rfq_number, requisition_id, project_id, title, status) VALUES (:o, 'RFQ-V', :r, :p, 'Roofing', 'issued') RETURNING id", o=ORG, r=req2, p=PROJECT)).scalar())
            quote = {}
            for sid in (SUP_A, SUP_B, SUP_C):
                quote[sid] = str((await q(db, "INSERT INTO procurement.rfq_responses (organization_id, rfq_id, supplier_id, total_amount) VALUES (:o, :q, :s, 100) RETURNING id", o=ORG, q=rfq_id, s=sid)).scalar())
            _, err = await attempt(create_supplier_purchase_orders(req2, SupplierOrdersPayload(lines=[
                {"requisition_line_id": line2["Roof sheets"], "supplier_id": SUP_A, "quantity": "50", "unit_price": "14", "rfq_response_id": quote[SUP_B]}]), user=USER_CTX, db=db))
            check(err is not None and err.status_code == 422, f"another supplier's quote refused ({err and err.detail})")
            other_rfq = str((await q(db, "INSERT INTO procurement.rfqs (organization_id, rfq_number, requisition_id, title, status) VALUES (:o, 'RFQ-O', :r, 'Other', 'issued') RETURNING id", o=ORG, r=req_id)).scalar())
            foreign = str((await q(db, "INSERT INTO procurement.rfq_responses (organization_id, rfq_id, supplier_id, total_amount) VALUES (:o, :q, :s, 1) RETURNING id", o=ORG, q=other_rfq, s=SUP_A)).scalar())
            _, err = await attempt(create_supplier_purchase_orders(req2, SupplierOrdersPayload(lines=[
                {"requisition_line_id": line2["Roof sheets"], "supplier_id": SUP_A, "quantity": "50", "unit_price": "14", "rfq_response_id": foreign}]), user=USER_CTX, db=db))
            check(err is not None and err.status_code == 422, f"a quote from another requisition refused ({err and err.detail})")
            res, err = await attempt(create_supplier_purchase_orders(req2, SupplierOrdersPayload(lines=[
                {"requisition_line_id": line2["Roof sheets"], "supplier_id": SUP_A, "quantity": "50", "unit_price": "14", "rfq_response_id": quote[SUP_A]},
                {"requisition_line_id": line2["Ridge caps"], "supplier_id": SUP_B, "quantity": "10", "unit_price": "7.5", "rfq_response_id": quote[SUP_B]},
            ]), user=USER_CTX, db=db))
            check(err is None and res["data"]["requisition_status"] == "ordered", f"quote-priced split, no reason needed -> ordered ({err.detail if err else res['data']['requisition_status']})")
            states = dict((await q(db, "SELECT supplier_id::text, status FROM procurement.rfq_responses WHERE rfq_id = :q", q=rfq_id)).all())
            check(states == {SUP_A: "selected", SUP_B: "selected", SUP_C: "rejected"}, f"both used quotes selected, the unused one rejected {states}")
            rfq_state = (await q(db, "SELECT status FROM procurement.rfqs WHERE id = :q", q=rfq_id)).scalar()
            check(rfq_state == "closed", f"RFQ closed ({rfq_state})")
            tied = (await q(db, "SELECT count(*) FROM procurement.purchase_orders WHERE requisition_id = :r AND rfq_response_id IS NOT NULL AND rfq_id = :q", r=req2, q=rfq_id)).scalar()
            check(tied == 2, f"each PO tied to the quote it came from ({tied})")

            print("\n== B6. PO from a whole quote on a partly ordered requisition")
            req3, line3 = await make_requisition(db, "REQ-PART", [("Paint", "20", "litre", "6"), ("Brushes", "5", "each", "2")])
            rfq3 = str((await q(db, "INSERT INTO procurement.rfqs (organization_id, rfq_number, requisition_id, title, status) VALUES (:o, 'RFQ-P', :r, 'Paint', 'closed') RETURNING id", o=ORG, r=req3)).scalar())
            sel = str((await q(db, "INSERT INTO procurement.rfq_responses (organization_id, rfq_id, supplier_id, total_amount, status) VALUES (:o, :q, :s, 130, 'selected') RETURNING id", o=ORG, q=rfq3, s=SUP_B)).scalar())
            await attempt(create_supplier_purchase_orders(req3, SupplierOrdersPayload(lines=[
                {"requisition_line_id": line3["Paint"], "supplier_id": SUP_A, "quantity": "20", "unit_price": "6"}], selection_reason=reason), user=USER_CTX, db=db))
            _, err = await attempt(create_purchase_order_from_rfq(PurchaseOrderFromRfq(rfq_response_id=sel), user=USER_CTX, db=db))
            check(err is not None and err.status_code == 409 and "line by line" in err.detail, f"refused with a pointer to line ordering ({err and err.detail})")

            print("\n== B7. legacy requisition keeps its status")
            current = (await q(db, "SELECT id, description, quantity, unit_of_measure, estimated_unit_cost FROM procurement.requisition_lines WHERE requisition_id = :r AND NOT is_deleted ORDER BY description", r=LEGACY_REQ)).all()
            res, err = await attempt(amend_requisition(LEGACY_REQ, RequisitionAmendPayload(
                lines=[{"id": r.id, "description": r.description, "qty": "12", "uom": r.unit_of_measure, "unit_cost": r.estimated_unit_cost} for r in current],
                reason="legacy amend"), user=USER_CTX, db=db))
            check(err is None and await req_status(db, LEGACY_REQ) == "ordered", f"stays ordered ({err.detail if err else await req_status(db, LEGACY_REQ)})")

    print(f"\n{'ALL PASSED' if not FAILURES else f'{len(FAILURES)} FAILED'}")
    if FAILURES:
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(run())
