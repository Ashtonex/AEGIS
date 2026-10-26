"""Verifies POST /procurement/goods-received on the configured database inside
a transaction that is always rolled back, with push/email stubbed.

    .venv/Scripts/python.exe scripts/verify_goods_receipt.py [PO number]

Uses an issued PO (default: the first issued PO with lines) and walks:
  1. partial receipt + a rejected quantity with reason
  2. rejected quantity without a reason        -> 422
  3. receiving more than is outstanding        -> 422
  4. the same delivery note again              -> 409
  5. the rest of the order (lines omitted)     -> PO received, stock = ordered
  6. any further receipt                       -> 409
checking PO line quantities, PO status and stock-ledger totals at each step.
"""

import asyncio
import sys
from datetime import date
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import text

from _rollback_harness import block_outbound, check, finish, rollback_session
from core.security import SUPERADMIN_ROLE
from routers.procurement import GoodsReceivedPayload, receive_goods


async def po_state(db, po_id):
    lines = (await db.execute(text("""
        SELECT id, quantity, quantity_received, item_id FROM procurement.purchase_order_lines
        WHERE po_id = :po AND NOT is_deleted ORDER BY created_at, id
    """), {"po": po_id})).all()
    status = (await db.execute(text("SELECT status FROM procurement.purchase_orders WHERE id = :po"), {"po": po_id})).scalar()
    stock = (await db.execute(text("""
        SELECT COALESCE(SUM(sl.quantity), 0) FROM procurement.stock_ledger sl
        JOIN procurement.grn_lines gl ON gl.id = sl.source_id
        JOIN procurement.goods_received_notes g ON g.id = gl.grn_id
        WHERE g.po_id = :po
    """), {"po": po_id})).scalar()
    return lines, status, Decimal(str(stock))


async def attempt(db, user, payload, expect_status=None):
    try:
        res = await receive_goods(GoodsReceivedPayload(**payload), user=user, db=db)
        return res, None
    except HTTPException as exc:
        return None, exc


async def run(po_number: str | None) -> None:
    with block_outbound():
        async with rollback_session() as db:
            po = (await db.execute(text("""
                SELECT po.id::text AS id, po.po_number, po.organization_id::text AS org_id FROM procurement.purchase_orders po
                WHERE po.status IN ('issued','partially_received') AND NOT po.is_deleted
                  AND (CAST(:n AS text) IS NULL OR po.po_number = :n)
                  AND EXISTS (SELECT 1 FROM procurement.purchase_order_lines l WHERE l.po_id = po.id AND NOT l.is_deleted)
                LIMIT 1
            """), {"n": po_number})).first()
            if not po:
                check(False, "an issued PO with lines exists")
                return finish()
            uid = (await db.execute(text("SELECT id::text FROM core.users WHERE organization_id = :o LIMIT 1"), {"o": po.org_id})).scalar()
            user = {"user_id": uid, "sub": uid, "org_id": po.org_id, "role": SUPERADMIN_ROLE}
            lines, status, stock0 = await po_state(db, po.id)
            print(f"\n== {po.po_number}: {len(lines)} lines, status {status}")
            l1, l2 = lines[0], lines[1] if len(lines) > 1 else lines[0]
            out1 = Decimal(str(l1.quantity)) - Decimal(str(l1.quantity_received or 0))
            part = (out1 / 2).quantize(Decimal("0.001"))
            base = {"po_id": po.id, "delivery_date": str(date.today())}

            res, err = await attempt(db, user, {**base, "delivery_note_ref": "VERIFY-DN-1", "lines": [
                {"po_line_id": str(l1.id), "quantity_received": str(part)},
                {"po_line_id": str(l2.id), "quantity_received": "0", "quantity_rejected": "1", "rejection_reason": "Damaged in transit"},
            ] if l2.id != l1.id else [{"po_line_id": str(l1.id), "quantity_received": str(part)}]})
            check(err is None, f"1. partial receipt accepted ({res and res['data']['grn_number']})")
            lines_a, status_a, stock_a = await po_state(db, po.id)
            got = {str(x.id): x for x in lines_a}
            check(Decimal(str(got[str(l1.id)].quantity_received)) == Decimal(str(l1.quantity_received or 0)) + part,
                  f"   line 1 received +{part}")
            if l2.id != l1.id:
                check(Decimal(str(got[str(l2.id)].quantity_received or 0)) == Decimal(str(l2.quantity_received or 0)),
                      "   rejected-only line stays outstanding")
                rej = (await db.execute(text("""
                    SELECT quantity_rejected, rejection_reason FROM procurement.grn_lines gl
                    JOIN procurement.goods_received_notes g ON g.id = gl.grn_id
                    WHERE g.po_id = :po AND gl.po_line_id = :l
                """), {"po": po.id, "l": str(l2.id)})).first()
                check(rej is not None and Decimal(str(rej.quantity_rejected)) == 1 and rej.rejection_reason == "Damaged in transit",
                      "   rejection recorded on the GRN line with its reason")
            check(status_a == "partially_received", f"   PO status {status_a}")
            check(stock_a - stock0 == part, f"   stock ledger +{stock_a - stock0} (expected +{part})")

            _, err = await attempt(db, user, {**base, "lines": [
                {"po_line_id": str(l1.id), "quantity_received": "0", "quantity_rejected": "1"}]})
            check(err is not None and err.status_code == 422, f"2. rejection without reason refused ({err and err.detail})")

            _, err = await attempt(db, user, {**base, "lines": [
                {"po_line_id": str(l1.id), "quantity_received": str(out1 + 1)}]})
            check(err is not None and err.status_code == 422, f"3. over-receipt refused ({err and err.detail})")

            _, err = await attempt(db, user, {**base, "delivery_note_ref": " verify-dn-1 "})
            check(err is not None and err.status_code == 409, f"4. duplicate delivery note refused ({err and err.detail})")

            lines_b, _, stock_b = await po_state(db, po.id)
            res, err = await attempt(db, user, {**base, "delivery_note_ref": "VERIFY-DN-2"})
            check(err is None, "5. remaining order received in full")
            lines_c, status_c, stock_c = await po_state(db, po.id)
            check(all(Decimal(str(x.quantity_received)) == Decimal(str(x.quantity)) for x in lines_c),
                  "   every PO line fully received")
            check(status_c == "received", f"   PO status {status_c}")
            outstanding_b = sum(Decimal(str(x.quantity)) - Decimal(str(x.quantity_received or 0)) for x in lines_b)
            check(stock_c - stock_b == outstanding_b, f"   stock ledger +{stock_c - stock_b} (expected +{outstanding_b})")
            check(all(x.item_id for x in lines_c), "   once-off items provisioned for lines without a catalogue item")

            _, err = await attempt(db, user, {**base, "delivery_note_ref": "VERIFY-DN-3"})
            check(err is not None and err.status_code == 409, f"6. receipt on a fully received PO refused ({err and err.detail})")

            await invoice_to_payment(db, user, po, res["data"]["id"] if res else None)
    finish()


async def invoice_to_payment(db, user, po, grn_id):
    """7-12: register -> duplicate -> match -> second invoice -> pay."""
    from routers.procurement import (
        PaymentDecisionPayload, SupplierInvoicePayload, create_invoice, link_procurement_document,
        match_invoice, payment_decision,
    )

    print("\n== invoice -> match -> payment")
    po_row = (await db.execute(text("SELECT subtotal, tax_amount, project_id FROM procurement.purchase_orders WHERE id = :p"), {"p": po.id})).first()
    inv_payload = {"po_id": po.id, "grn_id": grn_id, "supplier_invoice_ref": "VERIFY-INV-1",
                   "invoice_date": str(date.today()), "subtotal": str(po_row.subtotal), "tax_amount": str(po_row.tax_amount)}
    reg = await create_invoice(SupplierInvoicePayload(**inv_payload), user=user, db=db)
    inv_id = reg["data"]["id"]
    check(bool(inv_id), f"7. invoice registered ({reg['data']['invoice_number']})")

    try:
        await create_invoice(SupplierInvoicePayload(**{**inv_payload, "supplier_invoice_ref": "verify-inv-1"}), user=user, db=db)
        check(False, "8. duplicate supplier reference refused")
    except HTTPException as exc:
        check(exc.status_code == 409, f"8. duplicate supplier reference refused ({exc.detail})")

    m = await match_invoice(inv_id, user=user, db=db)
    check(m["data"]["match_status"] == "matched", f"9. fully received invoice matched ({m['data']['match_status']})")

    reg2 = await create_invoice(SupplierInvoicePayload(**{**inv_payload, "supplier_invoice_ref": "VERIFY-INV-2"}), user=user, db=db)
    m2 = await match_invoice(reg2["data"]["id"], user=user, db=db)
    check(m2["data"]["match_status"] == "over_invoice",
          f"10. second invoice for the same delivery not matched ({m2['data']['match_status']})")

    try:
        await payment_decision(inv_id, PaymentDecisionPayload(decision="approved"), user=user, db=db)
        check(False, "11a. approval without evidence refused")
    except HTTPException as exc:
        check(exc.status_code == 409, f"11a. approval without evidence refused ({exc.detail})")
    doc_id = (await db.execute(text(
        "SELECT id FROM core.documents WHERE organization_id = :o AND COALESCE(is_deleted, false) = false LIMIT 1"
    ), {"o": user["org_id"]})).scalar()
    if not doc_id:
        check(False, "a document exists to attach as evidence")
        return
    for entity_type, entity_id, role in (("purchase_order", po.id, "evidence"), ("goods_received_note", grn_id, "evidence"),
                                         ("supplier_invoice", inv_id, "evidence")):
        await link_procurement_document(db, user=user, entity_type=entity_type, entity_id=entity_id,
                                        document_id=doc_id, link_role=role, project_id=po_row.project_id)
    commit_before = (await db.execute(text(
        "SELECT invoiced_amount FROM finance.commitments WHERE source_type='purchase_order' AND source_id = :p"), {"p": po.id})).scalar()
    paid = await payment_decision(inv_id, PaymentDecisionPayload(decision="approved", approval_document_id=doc_id), user=user, db=db)
    check(paid["data"]["status"] == "approved", f"11b. payment approved with evidence (GL: {paid['data'].get('gl_proposal_warning') or 'journal proposed'})")
    commit_after = (await db.execute(text(
        "SELECT invoiced_amount FROM finance.commitments WHERE source_type='purchase_order' AND source_id = :p"), {"p": po.id})).scalar()
    if commit_before is not None:
        check(Decimal(str(commit_after)) - Decimal(str(commit_before)) == Decimal(str(po_row.subtotal)) + Decimal(str(po_row.tax_amount)),
              f"    commitment invoiced +{Decimal(str(commit_after)) - Decimal(str(commit_before))}")
    again = await payment_decision(inv_id, PaymentDecisionPayload(decision="approved", approval_document_id=doc_id), user=user, db=db)
    check(bool(again.get("already_approved") or (again.get("data") or {}).get("already_approved")),
          "12. repeat approval is a no-op")


if __name__ == "__main__":
    asyncio.run(run(sys.argv[1] if len(sys.argv) > 1 else None))
