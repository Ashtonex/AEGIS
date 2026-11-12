"""End-to-end check of the payment control gates (migration 299) against an
ISOLATED database:

* supplier payments: an invoice not approved for payment is held, needs a
  real reason, and only a different person can release it; holds can be
  cancelled; blocked suppliers, unconfirmed bank details, closed periods and
  future dates are refused; the old batch screen can't post a held payment.
* supplier records: a real bank-detail change (not a re-save) needs a second
  person to confirm it; a new supplier's bank details too; stamps can't be
  forged on create; lifting a block needs a director and a reason.
* payroll: the person who drafted a run, or who recently changed where an
  employee on it is paid, can't approve it.
* purchase orders: an amendment can't come from whoever raised the PO, needs
  the director sign-off unless an approved variation of the same project
  backs it.

Needs a local database with production's schema-only definitions (pg_dump
--schema-only of core, crm, finance, hr, procurement, projects ...) and
migration 299 applied. Refuses to run unless DATABASE_URL is local.

    set DATABASE_URL=postgresql://postgres@127.0.0.1:55441/controls_test
    python scripts/verify_payment_control_gates.py
"""

import asyncio
import os
import sys
import uuid
from datetime import date, timedelta
from decimal import Decimal as D
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

URL = os.environ.get("DATABASE_URL", "")
if (urlsplit(URL).hostname or "") not in ("127.0.0.1", "localhost"):
    sys.exit("Refusing to run: DATABASE_URL must point at an isolated local database.")

from fastapi import HTTPException  # noqa: E402
from sqlalchemy import text  # noqa: E402

from core.database import AsyncSessionLocal  # noqa: E402
from routers import finance_ops, payments, payroll_runs, procurement, supplier_records  # noqa: E402

FAILURES: list[str] = []
ORG = str(uuid.uuid4())
MAKER, CHECKER, DIRECTOR, PROC = (str(uuid.uuid4()) for _ in range(4))
PERMS = {
    MAKER: {"finance.supplier_payment.post", "finance.payroll.post", "finance.payroll.manage"},
    CHECKER: {"finance.supplier_payment.post", "finance.payroll.post", "procurement.po.approve"},
    DIRECTOR: {"finance.payroll.post", "procurement.po.director_signoff"},
    PROC: {"supplier_records.update", "procurement.po.create"},
}
CASH = str(uuid.uuid4())
PROJECT, OTHER_PROJECT = str(uuid.uuid4()), str(uuid.uuid4())
S_OK, S_BLOCKED = str(uuid.uuid4()), str(uuid.uuid4())
I_APPROVED, I_UNAPPROVED, I_SPARE, I_BLOCKED = (str(uuid.uuid4()) for _ in range(4))
EMP = str(uuid.uuid4())
RUN = str(uuid.uuid4())
PO = str(uuid.uuid4())
VAR_SAME, VAR_OTHER = str(uuid.uuid4()), str(uuid.uuid4())
TODAY = date.today()
GOOD_REASON = "Cement received on site 3 Nov, GRN pending; agreed by the MD"


def user(uid: str, role: str = "Finance Manager") -> dict:
    return {"user_id": uid, "sub": uid, "org_id": ORG, "role": role}


async def fake_user_has_permission(db, u, key):
    return key in PERMS.get(u["user_id"], set())


supplier_records.user_has_permission = fake_user_has_permission
procurement.user_has_permission = fake_user_has_permission


class FakeRequest:
    def __init__(self, body: dict):
        self._body = body

    async def json(self):
        return dict(self._body)


def check(label: str, condition: bool, detail: object = "") -> None:
    print(("PASS " if condition else "FAIL ") + label + (f"  [{detail}]" if not condition and detail != "" else ""))
    if not condition:
        FAILURES.append(label)


async def sql(query: str, **params):
    async with AsyncSessionLocal() as db:
        result = await db.execute(text(query), params)
        rows = result.mappings().all() if result.returns_rows else None
        await db.commit()
        return rows


async def one(query: str, **params):
    rows = await sql(query, **params)
    return rows[0] if rows else None


async def call(fn, **kwargs):
    async with AsyncSessionLocal() as db:
        try:
            return 200, await fn(db=db, **kwargs)
        except HTTPException as exc:
            await db.rollback()
            return exc.status_code, exc.detail


async def seed() -> None:
    await sql("INSERT INTO core.organizations (id, name) VALUES (:id, 'Controls Test Org')", id=ORG)
    for uid, name in ((MAKER, "Fay Maker"), (CHECKER, "Cal Checker"), (DIRECTOR, "Dee Director"), (PROC, "Pat Procurement")):
        await sql("INSERT INTO core.users (id, email, full_name, organization_id) VALUES (:id, :e, :n, :org)",
                  id=uid, e=f"{uid[:8]}@example.test", n=name, org=ORG)
    await sql("""INSERT INTO finance.cash_accounts (id, organization_id, account_code, account_name, account_type, currency)
                 VALUES (:id, :org, 'BANK-USD', 'Bank USD', 'bank', 'USD')""", id=CASH, org=ORG)
    await sql("""INSERT INTO projects.projects (id, organization_id, name) VALUES (:a, :org, 'Main Project'), (:b, :org, 'Other Project')""",
              a=PROJECT, b=OTHER_PROJECT, org=ORG)
    await sql("""INSERT INTO procurement.suppliers (id, organization_id, supplier_name, status, bank_name, bank_account_number)
                 VALUES (:a, :org, 'Good Supplies', 'active', 'CBZ', '1111'), (:b, :org, 'Banned Ltd', 'blacklisted', NULL, NULL)""",
              a=S_OK, b=S_BLOCKED, org=ORG)
    for iid, sid, num, status, amount in (
        (I_APPROVED, S_OK, "INV-A", "approved", 100), (I_UNAPPROVED, S_OK, "INV-U", "received", 200),
        (I_SPARE, S_OK, "INV-S", "received", 50), (I_BLOCKED, S_BLOCKED, "INV-B", "approved", 70),
    ):
        await sql("""INSERT INTO procurement.supplier_invoices (id, organization_id, invoice_number, supplier_id, project_id,
                        invoice_date, subtotal, tax_amount, total_amount, status, currency)
                     VALUES (:id, :org, :num, :sid, :p, :d, :amt, 0, :amt, :st, 'USD')""",
                  id=iid, org=ORG, num=num, sid=sid, p=PROJECT, d=TODAY - timedelta(days=20), amt=amount, st=status)
    await sql("""INSERT INTO finance.accounting_periods (organization_id, period_code, fiscal_year, period_number, period_start, period_end, status)
                 VALUES (:org, '2026-08', 2026, 8, '2026-08-01', '2026-08-31', 'closed'),
                        (:org, :code, :y, :m, :s, :e, 'open')""",
              org=ORG, code=f"{TODAY:%Y-%m}", y=TODAY.year, m=TODAY.month, s=TODAY.replace(day=1),
              e=(TODAY.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1))
    # Payroll: a draft run Fay drafted; Cal set where the employee is paid 2 days ago.
    await sql("INSERT INTO hr.employees (id, organization_id, employee_name, employment_status) VALUES (:id, :org, 'Ed Employee', 'active')",
              id=EMP, org=ORG)
    await sql("""INSERT INTO finance.payroll_runs (id, organization_id, run_number, period_start, period_end, payment_date,
                    cash_account_id, status, net_pay, created_by)
                 VALUES (:id, :org, 'PAY-TEST-001', :ps, :pe, :pd, :cash, 'draft', 500, :maker)""",
              id=RUN, org=ORG, ps=TODAY.replace(day=1), pe=TODAY, pd=TODAY, cash=CASH, maker=MAKER)
    await sql("INSERT INTO finance.payroll_items (organization_id, payroll_run_id, employee_id) VALUES (:org, :run, :emp)",
              org=ORG, run=RUN, emp=EMP)
    await sql("""INSERT INTO finance.employee_payment_accounts (organization_id, employee_id, currency, method, bank_name,
                    account_number, created_by, created_at)
                 VALUES (:org, :emp, 'USD', 'bank', 'CBZ', '999', :checker, NOW() - interval '2 days')""",
              org=ORG, emp=EMP, checker=CHECKER)
    # An issued PO Pat raised, with its commitment, and two approved variations.
    await sql("""INSERT INTO procurement.purchase_orders (id, organization_id, po_number, supplier_id, project_id, status,
                    subtotal, tax_amount, total_amount, created_by, issued_at)
                 VALUES (:id, :org, 'PO-TEST-1', :s, :p, 'issued', 1000, 0, 1000, :proc, NOW())""",
              id=PO, org=ORG, s=S_OK, p=PROJECT, proc=PROC)
    await sql("""INSERT INTO finance.commitments (organization_id, project_id, cost_category, source_type, source_id,
                    description, committed_amount, commitment_date)
                 VALUES (:org, :p, 'materials', 'purchase_order', :po, 'PO-TEST-1', 1000, CURRENT_DATE)""",
              org=ORG, p=PROJECT, po=PO)
    await sql("""INSERT INTO finance.variations (id, organization_id, variation_number, project_id, title, status)
                 VALUES (:a, :org, 'VO-1', :p, 'Extra slab', 'approved'), (:b, :org, 'VO-2', :o, 'Other job', 'approved')""",
              a=VAR_SAME, b=VAR_OTHER, org=ORG, p=PROJECT, o=OTHER_PROJECT)


def pay(items, reason=None, payment_date=None):
    return finance_ops.PayablesPay(
        cash_account_id=CASH, payment_date=payment_date or TODAY, payment_method="bank_transfer",
        reference="POP-1", override_reason=reason, items=[finance_ops.PayableLine(invoice_id=i) for i in items],
    )


async def payables_for(uid: str) -> dict:
    _, res = await call(finance_ops.list_payables, user=user(uid))
    return res["data"]


async def test_supplier_payments() -> None:
    data = await payables_for(MAKER)
    by_id = {str(i["id"]): i for i in data["invoices"]}
    check("payables: blacklisted supplier flagged", by_id[I_BLOCKED]["supplier_blocked"] is True)
    check("payables: full amount available on an unpaid invoice", by_id[I_APPROVED]["available_to_pay"] == 100.0)

    code, res = await call(finance_ops.pay_payables, payload=pay([I_APPROVED]), user=user(MAKER))
    check("approved invoice pays straight away", code == 200 and res["data"]["held"] is False, res)
    inv = await one("SELECT status FROM procurement.supplier_invoices WHERE id = :id", id=I_APPROVED)
    check("approved invoice marked paid", inv["status"] == "paid")
    batch = await one("SELECT status, posted_by FROM finance.supplier_payment_batches WHERE id = :id", id=res["data"]["batch_id"])
    check("immediate batch is posted and names who posted it", batch["status"] == "posted" and str(batch["posted_by"]) == MAKER, batch)

    code, res = await call(finance_ops.pay_payables, payload=pay([I_UNAPPROVED], reason="Cleared"), user=user(MAKER))
    check("one-word override reason refused", code == 409 and "at least" in str(res), (code, res))

    before = (await one("SELECT count(*) AS n FROM finance.cashbook_transactions WHERE organization_id = :org", org=ORG))["n"]
    code, res = await call(finance_ops.pay_payables, payload=pay([I_UNAPPROVED], reason=GOOD_REASON), user=user(MAKER))
    check("unapproved invoice payment is held", code == 200 and res["data"]["held"] is True, (code, res))
    held_id = res["data"]["batch_id"] if code == 200 else None
    after = (await one("SELECT count(*) AS n FROM finance.cashbook_transactions WHERE organization_id = :org", org=ORG))["n"]
    check("held payment writes no cashbook entry", after == before, (before, after))
    inv = await one("SELECT status FROM procurement.supplier_invoices WHERE id = :id", id=I_UNAPPROVED)
    check("held invoice stays unpaid", inv["status"] == "received")
    ev = await one("SELECT action, reason FROM finance.payable_events WHERE supplier_invoice_id = :id ORDER BY created_at DESC LIMIT 1", id=I_UNAPPROVED)
    check("hold is logged with its reason", ev["action"] == "payment_held" and ev["reason"] == GOOD_REASON, ev)

    code, res = await call(finance_ops.pay_payables, payload=pay([I_UNAPPROVED], reason=GOOD_REASON), user=user(MAKER))
    check("an invoice already held can't be paid again", code == 409, (code, res))

    data = await payables_for(MAKER)
    held = [h for h in data["held_payments"] if str(h["id"]) == held_id]
    check("held payment listed with its invoices", len(held) == 1 and len(held[0]["items"]) == 1, data["held_payments"])
    check("holder can't release (UI flag)", held and held[0]["can_release"] is False)
    data_checker = await payables_for(CHECKER)
    check("another person can release (UI flag)", any(h["can_release"] for h in data_checker["held_payments"] if str(h["id"]) == held_id))
    inv_row = next(i for i in data["invoices"] if str(i["id"]) == I_UNAPPROVED)
    check("held amount shown, still owed", inv_row["held_amount"] == 200.0 and inv_row["outstanding"] == 200.0 and inv_row["available_to_pay"] == 0.0, inv_row)

    code, res = await call(payments.decide_payment_batch, batch_id=uuid.UUID(held_id),
                           payload=payments.PaymentBatchDecision(action="approve"), user=user(CHECKER), _={})
    check("old batch screen refuses a held payment", code == 409, (code, res))

    code, res = await call(finance_ops.release_held_payment, batch_id=uuid.UUID(held_id), user=user(MAKER))
    check("holder can't release their own held payment", code == 409, (code, res))
    code, res = await call(finance_ops.release_held_payment, batch_id=uuid.UUID(held_id), user=user(CHECKER))
    check("second person releases the held payment", code == 200, (code, res))
    batch = await one("SELECT status, approved_by, posted_by FROM finance.supplier_payment_batches WHERE id = :id", id=held_id)
    check("released batch posted, approver recorded", batch["status"] == "posted" and str(batch["approved_by"]) == CHECKER, batch)
    cb = await one("""SELECT count(*) AS n, sum(amount) AS amt FROM finance.cashbook_transactions
                      WHERE source_type = 'supplier_invoice' AND source_id = :id""", id=I_UNAPPROVED)
    check("release writes the cashbook payment", cb["n"] == 1 and D(str(cb["amt"])) == D("200"), cb)
    item = await one("SELECT cashbook_transaction_id FROM finance.supplier_payment_items WHERE batch_id = :id", id=held_id)
    check("held line linked to its cashbook payment", item["cashbook_transaction_id"] is not None)
    inv = await one("SELECT status FROM procurement.supplier_invoices WHERE id = :id", id=I_UNAPPROVED)
    check("released invoice marked paid", inv["status"] == "paid")
    evs = await sql("SELECT action, created_by FROM finance.payable_events WHERE supplier_invoice_id = :id ORDER BY created_at", id=I_UNAPPROVED)
    actions = {(e["action"], str(e["created_by"])) for e in evs}
    check("trail names who asked and who agreed", ("match_override", MAKER) in actions and ("paid", CHECKER) in actions, evs)
    code, res = await call(finance_ops.release_held_payment, batch_id=uuid.UUID(held_id), user=user(CHECKER))
    check("a released payment can't be released twice", code == 409, (code, res))

    code, res = await call(finance_ops.pay_payables, payload=pay([I_SPARE], reason=GOOD_REASON), user=user(MAKER))
    spare_batch = res["data"]["batch_id"]
    code, res = await call(finance_ops.cancel_held_payment, batch_id=uuid.UUID(spare_batch),
                           payload=finance_ops.HeldPaymentCancel(reason="Supplier will be paid by cheque later"), user=user(MAKER))
    check("held payment can be cancelled", code == 200, (code, res))
    data = await payables_for(MAKER)
    spare = next(i for i in data["invoices"] if str(i["id"]) == I_SPARE)
    check("cancelled hold frees the invoice again", spare["available_to_pay"] == 50.0 and spare["held_amount"] == 0.0, spare)

    code, res = await call(finance_ops.pay_payables, payload=pay([I_BLOCKED]), user=user(MAKER))
    check("blacklisted supplier can't be paid", code == 409 and "blocked" in str(res), (code, res))
    code, res = await call(finance_ops.pay_payables, payload=pay([I_SPARE], reason=GOOD_REASON, payment_date=date(2026, 8, 15)), user=user(MAKER))
    check("payment dated in a closed period refused", code == 409 and "2026-08" in str(res), (code, res))
    code, res = await call(finance_ops.pay_payables, payload=pay([I_SPARE], reason=GOOD_REASON, payment_date=TODAY + timedelta(days=2)), user=user(MAKER))
    check("future-dated payment refused", code == 422, (code, res))


async def test_supplier_records() -> None:
    code, res = await call(supplier_records.update_item, item_id=S_OK, request=FakeRequest({"bank_account_number": "2222"}),
                           user=user(PROC, "Stores and Procurement Manager"), _={})
    check("procurement changes supplier bank details", code == 200, (code, res))
    row = await one("SELECT bank_updated_at, bank_updated_by, bank_confirmed_at FROM procurement.suppliers WHERE id = :id", id=S_OK)
    check("bank change stamped", row["bank_updated_at"] is not None and str(row["bank_updated_by"]) == PROC, row)
    stamp = row["bank_updated_at"]

    code, res = await call(supplier_records.update_item, item_id=S_OK,
                           request=FakeRequest({"bank_account_number": "2222", "bank_name": "CBZ", "address": "1 Main Rd"}),
                           user=user(PROC, "Stores and Procurement Manager"), _={})
    row = await one("SELECT bank_updated_at, address FROM procurement.suppliers WHERE id = :id", id=S_OK)
    check("re-saving the same bank details doesn't count as a change", code == 200 and row["bank_updated_at"] == stamp and row["address"] == "1 Main Rd", (code, row))

    data = await payables_for(MAKER)
    spare = next(i for i in data["invoices"] if str(i["id"]) == I_SPARE)
    check("payables flag unconfirmed bank details", spare["supplier_bank_unconfirmed"] is True, spare)
    code, res = await call(finance_ops.pay_payables, payload=pay([I_SPARE], reason=GOOD_REASON), user=user(MAKER))
    check("supplier with unconfirmed bank details can't be paid", code == 409 and "not yet confirmed" in str(res), (code, res))

    code, res = await call(supplier_records.confirm_supplier_bank_details, item_id=uuid.UUID(S_OK), user=user(PROC))
    check("whoever changed bank details can't confirm them", code == 409, (code, res))
    code, res = await call(supplier_records.confirm_supplier_bank_details, item_id=uuid.UUID(S_OK), user=user(MAKER))
    check("another person confirms bank details", code == 200, (code, res))
    code, res = await call(supplier_records.confirm_supplier_bank_details, item_id=uuid.UUID(S_OK), user=user(CHECKER))
    check("nothing left to confirm afterwards", code == 409, (code, res))
    code, res = await call(finance_ops.pay_payables, payload=pay([I_SPARE], reason=GOOD_REASON), user=user(MAKER))
    check("supplier payable again once confirmed", code == 200 and res["data"]["held"] is True, (code, res))

    forged = (TODAY + timedelta(days=365)).isoformat()
    code, res = await call(supplier_records.create_item, request=FakeRequest({
        "supplier_name": "Fresh Vendor", "bank_name": "FBC", "bank_account_number": "3333",
        "bank_confirmed_at": forged, "bank_confirmed_by": PROC,
    }), user=user(PROC, "Stores and Procurement Manager"), _={})
    new_id = (res.get("data") or {}).get("id") if isinstance(res, dict) else None
    row = await one("SELECT bank_updated_at, bank_updated_by, bank_confirmed_at FROM procurement.suppliers WHERE id = :id", id=new_id) if new_id else None
    check("new supplier's bank details need confirming; stamps can't be forged",
          row is not None and row["bank_updated_at"] is not None and row["bank_confirmed_at"] is None and str(row["bank_updated_by"]) == PROC,
          (code, res, row))

    code, res = await call(supplier_records.update_item, item_id=S_BLOCKED, request=FakeRequest({"status": "active"}),
                           user=user(PROC, "Stores and Procurement Manager"), _={})
    check("non-director can't lift a blacklisting", code == 403, (code, res))
    code, res = await call(supplier_records.update_item, item_id=S_BLOCKED, request=FakeRequest({"status": "active"}),
                           user=user(DIRECTOR, "Executive (Admin)"), _={})
    check("lifting a blacklisting needs a reason", code == 422, (code, res))
    code, res = await call(supplier_records.update_item, item_id=S_BLOCKED,
                           request=FakeRequest({"status": "active", "status_change_reason": "Dispute settled, board minute 14/26"}),
                           user=user(DIRECTOR, "Executive (Admin)"), _={})
    row = await one("SELECT status FROM procurement.suppliers WHERE id = :id", id=S_BLOCKED)
    ev = await one("""SELECT payload FROM core.domain_events WHERE organization_id = :org
                      AND event_type = 'procurement.supplier.block_lifted.v1'""", org=ORG)
    check("director lifts the blacklisting with a reason, logged", code == 200 and row["status"] == "active" and ev is not None, (code, res, ev))
    code, res = await call(supplier_records.update_item, item_id=S_OK, request=FakeRequest({"status": "suspended"}),
                           user=user(PROC, "Stores and Procurement Manager"), _={})
    check("anyone with edit rights can still suspend", code == 200, (code, res))


async def test_payroll() -> None:
    decision = payroll_runs.PayrollRunDecision(action="approve")
    code, res = await call(payroll_runs.decide_payroll_run, run_id=uuid.UUID(RUN), payload=decision, user=user(MAKER), _={})
    check("payroll drafter can't approve the run", code == 409 and "drafted" in str(res), (code, res))
    code, res = await call(payroll_runs.decide_payroll_run, run_id=uuid.UUID(RUN), payload=decision, user=user(CHECKER), _={})
    check("whoever changed an employee's pay-into account can't approve", code == 409 and "Ed Employee" in str(res), (code, res))
    code, res = await call(payroll_runs.decide_payroll_run, run_id=uuid.UUID(RUN), payload=decision, user=user(DIRECTOR), _={})
    run = await one("SELECT status, approved_by FROM finance.payroll_runs WHERE id = :id", id=RUN)
    check("independent approver approves the run", code == 200 and run["status"] == "approved" and str(run["approved_by"]) == DIRECTOR, (code, res, run))


async def test_po_amendments() -> None:
    async def amend(uid, role, amount, variation=None):
        payload = procurement.PurchaseOrderAmendmentPayload(additional_amount=D(amount), reason="Extra cement for the slab", variation_id=variation)
        return await call(procurement.amend_purchase_order, po_id=uuid.UUID(PO), payload=payload, user=user(uid, role))

    code, res = await amend(PROC, "Authorising Officer", "500", VAR_SAME)
    check("whoever raised the PO can't amend it", code == 409, (code, res))
    code, res = await amend(CHECKER, "Authorising Officer", "500")
    check("amendment without a variation needs the director", code == 403, (code, res))
    code, res = await amend(DIRECTOR, "Executive (Admin)", "250", VAR_OTHER)
    check("variation from another project refused", code == 409 and "different project" in str(res), (code, res))
    code, res = await amend(CHECKER, "Authorising Officer", "150", VAR_SAME)
    check("approver amends with an approved variation of the same project", code == 200, (code, res))
    code, res = await amend(DIRECTOR, "Executive (Admin)", "100")
    po = await one("SELECT total_amount FROM procurement.purchase_orders WHERE id = :id", id=PO)
    com = await one("SELECT committed_amount FROM finance.commitments WHERE source_id = :id", id=PO)
    check("director amends without a variation; PO and commitment rise together",
          code == 200 and D(str(po["total_amount"])) == D("1250") and D(str(com["committed_amount"])) == D("1250"), (code, res, po, com))


async def main() -> None:
    await seed()
    await test_supplier_payments()
    await test_supplier_records()
    await test_payroll()
    await test_po_amendments()
    print()
    print(f"{len(FAILURES)} failure(s)" if FAILURES else "ALL CHECKS PASSED")
    sys.exit(1 if FAILURES else 0)


if __name__ == "__main__":
    asyncio.run(main())
