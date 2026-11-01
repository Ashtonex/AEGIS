"""Verifies pre-mobilisation procurement and the programme rollout on the
configured database inside a transaction that is always rolled back
(push/email stubbed). Uses the Willowton project (pre-mobilisation, BOQ-linked
programme, no weekly budgets yet).

    .venv/Scripts/python.exe scripts/verify_programme_rollout_and_procurement.py

  1. requisition on a pre-mobilisation project needs no weekly budget and
     notifies the procurement team; submit works
  2. RFQ on a submitted requisition; quotation captured with its file
  3. amend: draft edits freely; once submitted a reason is required; every
     amendment is counted and kept in the event trail
  4. rollout on mobilisation: re-baselined, weekly budgets + Mon-Fri daily
     targets add back to the linked BOQ value; a re-run creates nothing new
"""

import asyncio
from datetime import date, timedelta
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import text

from _rollback_harness import block_outbound, check, finish, rollback_session
from core.security import SUPERADMIN_ROLE  # noqa: E402
from app.services.programme_rollout import rollout_programme  # noqa: E402
from routers.procurement import (  # noqa: E402
    RequisitionAmendPayload, RequisitionCreate, RfqCreatePayload, RfqResponsePayload, SubmitRequisitionPayload,
    amend_requisition, create_requisition, create_rfq, list_rfqs, record_rfq_response, submit_requisition,
)

ORG = "00000000-0000-0000-0000-000000000001"
PROJECT = "dacf0363-d2db-4467-922b-bbac12a3e705"


async def attempt(coro):
    try:
        return await coro, None
    except HTTPException as exc:
        return None, exc


async def run() -> None:
    with block_outbound():
        async with rollback_session() as db:
            uid = (await db.execute(text("SELECT id::text FROM core.users WHERE organization_id=:o AND is_active LIMIT 1"), {"o": ORG})).scalar()
            su = {"user_id": uid, "sub": uid, "org_id": ORG, "role": SUPERADMIN_ROLE}
            status = (await db.execute(text("SELECT status FROM projects.projects WHERE id=:p"), {"p": PROJECT})).scalar()
            check(status == "pre_mobilisation", f"Willowton is in pre-mobilisation ({status})")

            print("\n== 1. pre-mobilisation requisition")
            before = (await db.execute(text("SELECT count(*) FROM core.notifications WHERE title='Open procurement pending mobilisation'"))).scalar()
            res, err = await attempt(create_requisition(RequisitionCreate(
                project_id=PROJECT, required_by_date=date.today() + timedelta(days=10), justification="verification run",
                line_items=[{"description": "Cement 50kg (verification)", "qty": "10", "uom": "bag", "unit_cost": "0"}],
            ), user=su, db=db))
            check(err is None, f"raised without a weekly budget{'' if err is None else f' ({err.detail})'}")
            if err:
                return finish()
            req_id = res["data"]["id"]
            after = (await db.execute(text("SELECT count(*) FROM core.notifications WHERE title='Open procurement pending mobilisation'"))).scalar()
            check(after > before, f"procurement team notified ({after - before} notification(s))")

            print("\n== 3a. amend a draft")
            _, err = await attempt(amend_requisition(req_id, RequisitionAmendPayload(
                lines=[{"description": "Cement 50kg (verification)", "qty": "12", "uom": "bag", "unit_cost": "11.50"},
                       {"description": "River sand (verification)", "qty": "2", "uom": "m3", "unit_cost": "25"}],
            ), user=su, db=db))
            row = (await db.execute(text("SELECT total_estimated, amendment_count FROM procurement.purchase_requisitions WHERE id=:i"), {"i": req_id})).first()
            lines = (await db.execute(text("SELECT count(*) FROM procurement.requisition_lines WHERE requisition_id=:i AND NOT is_deleted"), {"i": req_id})).scalar()
            check(err is None and row.total_estimated == Decimal("188") and lines == 2,
                  f"draft amended: total {row.total_estimated} (12x11.50 + 2x25 = 188), {lines} lines, count {row.amendment_count}")

            _, err = await attempt(submit_requisition(req_id, SubmitRequisitionPayload(), user=su, db=db))
            check(err is None, f"submitted without a weekly budget{'' if err is None else f' ({err.detail})'}")

            print("\n== 3b. amend once submitted")
            _, err = await attempt(amend_requisition(req_id, RequisitionAmendPayload(priority="urgent"), user=su, db=db))
            check(err is not None and err.status_code == 422, f"no reason -> refused ({err and err.status_code})")
            for n in (1, 2):
                _, err = await attempt(amend_requisition(req_id, RequisitionAmendPayload(
                    priority="urgent", reason=f"Re-measured at setting out (verification {n})"), user=su, db=db))
                check(err is None, f"amendment {n} with reason accepted{'' if err is None else f' ({err.detail})'}")
            row = (await db.execute(text("SELECT status, priority, amendment_count FROM procurement.purchase_requisitions WHERE id=:i"), {"i": req_id})).first()
            events = (await db.execute(text("""
                SELECT count(*) FROM core.domain_events WHERE aggregate_id=:i AND event_type='procurement.requisition.amended.v1'
            """), {"i": req_id})).scalar()
            check(row.status == "submitted" and row.priority == "urgent", f"status kept ({row.status}), priority {row.priority}")
            check(row.amendment_count == 3 and events == 3, f"3 amendments counted ({row.amendment_count}) and all in the event trail ({events})")

            print("\n== 2. quotes on the submitted request")
            rfq, err = await attempt(create_rfq(RfqCreatePayload(requisition_id=req_id, title="verification RFQ"), user=su, db=db))
            check(err is None, f"RFQ on a submitted requisition{'' if err is None else f' ({err.detail})'}")
            if err:
                return finish()
            rfq_id = rfq["data"]["id"]
            supplier = (await db.execute(text("SELECT id FROM procurement.suppliers WHERE organization_id=:o AND NOT is_deleted LIMIT 1"), {"o": ORG})).scalar()
            doc_id = (await db.execute(text("""
                INSERT INTO core.documents (organization_id, title, category, file_name, created_by)
                VALUES (:o, 'Quotation (verification)', 'procurement_quotation', 'quote.pdf', :u) RETURNING id
            """), {"o": ORG, "u": uid})).scalar()
            _, err = await attempt(record_rfq_response(rfq_id, RfqResponsePayload(
                supplier_id=supplier, reference="Q-VERIFY", total_amount=Decimal("180.00"), document_id=doc_id), user=su, db=db))
            check(err is None, f"quotation captured with its file{'' if err is None else f' ({err.detail})'}")
            listed = await list_rfqs(status_filter=None, project_id=PROJECT, user=su, db=db)
            mine = next((r for r in listed["data"] if str(r["id"]) == str(rfq_id)), None)
            response = (mine or {}).get("responses", [{}])[0]
            check(str(response.get("document_id")) == str(doc_id) and response.get("document_name") == "quote.pdf",
                  f"RFQ list returns the quote file ({response.get('document_name')})")

            print("\n== 4. rollout on mobilisation")
            await db.execute(text("UPDATE projects.projects SET status='active', start_date=:d WHERE id=:p"), {"p": PROJECT, "d": date(2026, 11, 16)})
            first = (await db.execute(text("SELECT min(baseline_date) FROM projects.project_milestones WHERE project_id=:p AND NOT is_deleted"), {"p": PROJECT})).scalar()
            summary = await rollout_programme(db, org_id=ORG, project_id=PROJECT, user_id=uid, mobilisation_date=date(2026, 11, 16))
            print("   ", summary)
            check("error" not in summary, f"rollout ran ({summary.get('error', 'ok')})")
            check(summary.get("rebaselined_days") == (date(2026, 11, 16) - first).days, f"re-baselined by {summary.get('rebaselined_days')} days")
            totals = (await db.execute(text("""
                SELECT
                  (SELECT count(*) FROM projects.weekly_budgets WHERE project_id=:p AND generated_by_rollout AND NOT is_deleted) AS weeks,
                  (SELECT min(week_start) FROM projects.weekly_budgets WHERE project_id=:p AND generated_by_rollout) AS first_week,
                  (SELECT sum(total_planned_amount) FROM projects.weekly_budgets WHERE project_id=:p AND generated_by_rollout) AS week_total,
                  (SELECT sum(planned_amount) FROM projects.weekly_budget_items WHERE project_id=:p AND NOT is_deleted) AS item_total,
                  (SELECT sum(planned_amount) FROM projects.site_daily_targets WHERE project_id=:p AND NOT is_deleted) AS target_total,
                  (SELECT count(*) FROM projects.site_daily_targets WHERE project_id=:p AND extract(isodow FROM target_date) > 5) AS weekend,
                  (SELECT sum(b.contract_amount) FROM finance.boq_line_items b
                    WHERE b.project_id=:p AND NOT b.is_deleted AND b.id IN (SELECT boq_line_item_id FROM projects.project_milestones WHERE project_id=:p AND NOT is_deleted)) AS boq_linked
            """), {"p": PROJECT})).first()
            print("   ", dict(totals._mapping))
            check(totals.weeks == summary.get("weeks_created") and totals.weeks >= 5, f"{totals.weeks} weekly budgets")
            check(totals.first_week == date(2026, 11, 16), f"first week starts on mobilisation Monday ({totals.first_week})")
            check(totals.week_total == totals.item_total == totals.target_total == totals.boq_linked,
                  f"weeks = lines = daily targets = linked BOQ ({totals.week_total} / {totals.item_total} / {totals.target_total} / {totals.boq_linked})")
            check(totals.weekend == 0, "no daily targets on weekends")
            qty_ok = (await db.execute(text("""
                SELECT bool_and(t.q = b.contract_qty) FROM (
                    SELECT boq_line_item_id, sum(planned_qty) q FROM projects.weekly_budget_items
                    WHERE project_id=:p AND NOT is_deleted GROUP BY boq_line_item_id) t
                JOIN finance.boq_line_items b ON b.id=t.boq_line_item_id
            """), {"p": PROJECT})).scalar()
            check(bool(qty_ok), "each BOQ line's quantity is planned exactly once across the weeks")
            again = await rollout_programme(db, org_id=ORG, project_id=PROJECT, user_id=uid)
            check(again.get("weeks_created") == 0 and again.get("weeks_skipped") == totals.weeks, f"re-run creates nothing new ({again})")
    finish()


asyncio.run(run())
