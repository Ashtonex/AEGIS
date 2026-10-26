"""Verifies requisition -> approval -> PO -> sign-offs -> issue on the
configured database inside a transaction that is always rolled back
(push/email stubbed).

    .venv/Scripts/python.exe scripts/verify_requisition_to_po.py

  1. create + submit + approve a requisition on a project with a budget
  2. PO from the approved requisition; a second PO from it -> refused
  3. issuing before sign-off -> 409; director sign-off before Finance
     (non-superadmin) -> refused; Finance then director -> ready to issue
  4. issue -> status issued, one commitment of the PO total; issuing
     again -> refused, no second commitment
"""

import asyncio
from datetime import date, timedelta
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import text

from _rollback_harness import block_outbound, check, finish, rollback_session
from core.security import SUPERADMIN_ROLE  # noqa: E402
from routers.procurement import (  # noqa: E402
    DecisionPayload, IssuePoPayload, PurchaseOrderFromRequisition, PurchaseOrderSignoffPayload,
    RequisitionCreate, SubmitRequisitionPayload, create_purchase_order, create_requisition,
    decide_requisition, issue_purchase_order, signoff_purchase_order, submit_requisition,
)


async def attempt(coro):
    try:
        return await coro, None
    except HTTPException as exc:
        return None, exc


async def run() -> None:
    with block_outbound():
        async with rollback_session() as db:
            proj = (await db.execute(text("""
                SELECT p.id, p.organization_id::text AS org_id FROM projects.projects p
                JOIN finance.project_budgets b ON b.project_id = p.id AND b.status = 'approved' AND b.total_amount > 10000
                WHERE NOT p.is_deleted LIMIT 1
            """))).first()
            supplier = (await db.execute(text("SELECT id FROM procurement.suppliers WHERE organization_id = :o AND NOT is_deleted LIMIT 1"), {"o": proj.org_id})).scalar()
            uid = (await db.execute(text("SELECT id::text FROM core.users WHERE organization_id = :o LIMIT 1"), {"o": proj.org_id})).scalar()
            su = {"user_id": uid, "sub": uid, "org_id": proj.org_id, "role": SUPERADMIN_ROLE}
            uid2 = (await db.execute(text("SELECT id::text FROM core.users WHERE organization_id = :o AND id::text <> :u LIMIT 1"), {"o": proj.org_id, "u": uid})).scalar()
            approver = {"user_id": uid2, "sub": uid2, "org_id": proj.org_id, "role": SUPERADMIN_ROLE}

            print("\n== 1. requisition")
            req = await create_requisition(RequisitionCreate(
                project_id=proj.id, required_by_date=date.today() + timedelta(days=7), justification="verification run",
                line_items=[{"description": "Cement 50kg (verification)", "qty": "10", "uom": "bag", "unit_cost": "12.50"}],
            ), user=su, db=db)
            req_id = req["data"]["id"]
            _, err = await attempt(submit_requisition(req_id, SubmitRequisitionPayload(override_reason="verification"), user=su, db=db))
            check(err is None, f"submitted{'' if err is None else f' ({err.detail})'}")
            _, err = await attempt(decide_requisition(req_id, DecisionPayload(decision="approved", override_reason="verification"), user=su, db=db))
            check(err is not None and "Self-approval" in str(err.detail), "requester cannot approve their own requisition")
            _, err = await attempt(decide_requisition(req_id, DecisionPayload(decision="approved", override_reason="verification"), user=approver, db=db))
            status = (await db.execute(text("SELECT status FROM procurement.purchase_requisitions WHERE id = :i"), {"i": req_id})).scalar()
            check(status == "approved", f"approved (status {status}{'' if err is None else f'; {err.detail}'})")

            print("\n== 2. purchase order")
            po, err = await attempt(create_purchase_order(PurchaseOrderFromRequisition(requisition_id=req_id, supplier_id=supplier, notes="Verification: sole approved supplier for this item"), user=su, db=db))
            check(err is None, f"PO created{'' if err is None else f' ({err.detail})'}")
            if err:
                return finish()
            po_id = po["data"]["id"]
            _, err = await attempt(create_purchase_order(PurchaseOrderFromRequisition(requisition_id=req_id, supplier_id=supplier, notes="Verification: sole approved supplier for this item"), user=su, db=db))
            count = (await db.execute(text("SELECT count(*) FROM procurement.purchase_orders WHERE requisition_id = :i AND NOT is_deleted"), {"i": req_id})).scalar()
            check(count == 1, f"a second PO from the same requisition refused ({err.status_code if err else 'not refused'}: {err.detail if err else ''}; {count} PO)")

            print("\n== 3. sign-offs")
            plain = {**su, "role": "Finance Manager"}
            _, err = await attempt(issue_purchase_order(po_id, IssuePoPayload(), user=plain, db=db))
            check(err is not None and err.status_code in (403, 409), f"issue before sign-off refused ({err and err.detail[:70]})")
            _, err = await attempt(signoff_purchase_order(po_id, PurchaseOrderSignoffPayload(stage="director"), user=plain, db=db))
            check(err is not None, f"director sign-off out of order refused ({err and err.detail[:70]})")
            for stage in ("finance", "director"):
                _, err = await attempt(signoff_purchase_order(po_id, PurchaseOrderSignoffPayload(stage=stage), user=su, db=db))
                check(err is None, f"{stage} sign-off given{'' if err is None else f' ({err.detail})'}")

            print("\n== 4. issue")
            _, err = await attempt(issue_purchase_order(po_id, IssuePoPayload(), user=su, db=db))
            row = (await db.execute(text("SELECT status, total_amount FROM procurement.purchase_orders WHERE id = :i"), {"i": po_id})).first()
            commits = (await db.execute(text("SELECT count(*), sum(committed_amount) FROM finance.commitments WHERE source_type = 'purchase_order' AND source_id = :i"), {"i": po_id})).first()
            check(err is None and row.status == "issued", f"issued ({row.status}{'' if err is None else f'; {err.detail}'})")
            check(commits[0] == 1 and Decimal(str(commits[1])) == Decimal(str(row.total_amount)), f"one commitment of {row.total_amount} ({commits[1]})")
            _, err = await attempt(issue_purchase_order(po_id, IssuePoPayload(), user=su, db=db))
            commits2 = (await db.execute(text("SELECT count(*) FROM finance.commitments WHERE source_type = 'purchase_order' AND source_id = :i"), {"i": po_id})).scalar()
            check(err is not None and commits2 == 1, f"re-issue refused, still one commitment ({err and err.detail[:60]})")
    finish()


if __name__ == "__main__":
    asyncio.run(run())
