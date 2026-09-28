"""The payment batch decision endpoint may only write statuses the table allows.

034 created finance.supplier_payment_batches.status with
CHECK (status IN ('draft', 'posted', 'cancelled')) while
POST /payments/{id}/decision moved draft -> 'approved' -> 'posted', so
approving failed in Postgres and nothing could ever be posted (238 fixes it).
Once posting was reachable, its cashbook insert named a column the table
doesn't have and skipped two required ones, and it set a supplier invoice
match_status that isn't allowed - so posting is checked against the
migrations too.
"""

import asyncio
import re
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

import routers.payments as payments

MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations"
CREATOR = str(uuid4())
APPROVER = str(uuid4())


def allowed_batch_statuses() -> set[str]:
    """Statuses allowed by the newest migration statement that sets the CHECK."""
    latest = None
    for path in sorted(MIGRATIONS.glob("[0-9][0-9][0-9]_*.sql")):
        for statement in path.read_text(encoding="utf-8").split(";"):
            if "finance.supplier_payment_batches" not in statement:
                continue
            match = re.search(r"CHECK\s*\(\s*status\s+IN\s*\(([^)]*)\)", statement, re.I)
            if match:
                latest = match.group(1)
    assert latest, "no status CHECK found for finance.supplier_payment_batches"
    return set(re.findall(r"'([a-z_]+)'", latest))


def cashbook_columns() -> tuple[set[str], set[str]]:
    """(every column, required columns with no default) of finance.cashbook_transactions."""
    create = (MIGRATIONS / "034_finance_treasury_payroll.sql").read_text(encoding="utf-8")
    body = create.split("CREATE TABLE IF NOT EXISTS finance.cashbook_transactions (")[1].split("\n);")[0]
    columns, required = set(), set()
    for line in body.splitlines():
        match = re.match(r"\s+([a-z_]+)\s+[A-Z]", line)
        if not match:
            continue
        columns.add(match.group(1))
        if "NOT NULL" in line and "DEFAULT" not in line and "PRIMARY KEY" not in line:
            required.add(match.group(1))
    for path in sorted(MIGRATIONS.glob("[0-9][0-9][0-9]_*.sql")):
        for statement in path.read_text(encoding="utf-8").split(";"):
            if re.search(r"ALTER TABLE (IF EXISTS )?finance\.cashbook_transactions\b", statement):
                columns.update(re.findall(r"ADD COLUMN (?:IF NOT EXISTS )?([a-z_]+)", statement))
    return columns, required


class FakeSession:
    def __init__(self, status: str):
        self.batch = SimpleNamespace(
            id=uuid4(), batch_number="SPB-00007", status=status, cash_account_id=uuid4(),
            payment_date=None, payment_method="bank_transfer", reference=None, created_by=CREATOR,
        )
        self.item_total = 1250.0
        self.cashbook_txn_id = uuid4()
        self.statements: list[dict] = []
        self.updates: list[dict] = []
        self.committed = False

    async def execute(self, statement, params=None):
        sql = str(statement)
        self.statements.append({"sql": sql, **(params or {})})
        if sql.lstrip().startswith("SELECT id, batch_number, status"):
            return SimpleNamespace(first=lambda: self.batch)
        if "SUM(amount)" in sql:
            return SimpleNamespace(scalar=lambda: self.item_total)
        if "INSERT INTO finance.cashbook_transactions" in sql:
            return SimpleNamespace(scalar=lambda: self.cashbook_txn_id)
        if "UPDATE finance.supplier_payment_batches" in sql:
            self.updates.append({"sql": sql, **params})
            return SimpleNamespace()
        if "UPDATE finance.supplier_payment_items" in sql or "UPDATE procurement.supplier_invoices" in sql:
            return SimpleNamespace()
        raise AssertionError(f"unexpected query: {sql[:80]}")

    def statement(self, fragment: str) -> dict:
        [match] = [s for s in self.statements if fragment in s["sql"]]
        return match

    async def commit(self):
        self.committed = True

    async def rollback(self):
        pass


def decide(db: FakeSession, action: str, user_id: str = APPROVER):
    return asyncio.run(
        payments.decide_payment_batch(
            batch_id=db.batch.id,
            payload=payments.PaymentBatchDecision(action=action),
            user={"org_id": str(uuid4()), "sub": user_id},
            db=db,
            _={},
        )
    )


def test_approve_writes_an_allowed_status_and_records_the_approver():
    db = FakeSession("draft")
    decide(db, "approve")

    assert db.committed
    [update] = db.updates
    assert update["status"] == "approved"
    assert update["status"] in allowed_batch_statuses()
    assert update["approved_by"] == APPROVER
    assert "approved_at = NOW()" in update["sql"]


def test_every_decision_target_status_is_allowed_by_the_table():
    # draft -> approved -> posted, and cancelled, must all be writable.
    assert {"draft", "approved", "posted", "cancelled"} <= allowed_batch_statuses()


def test_post_requires_an_approved_batch():
    with pytest.raises(HTTPException) as exc:
        decide(FakeSession("draft"), "post")
    assert exc.value.status_code == 409


def test_creator_cannot_approve_their_own_batch():
    db = FakeSession("draft")
    with pytest.raises(HTTPException) as exc:
        decide(db, "approve", user_id=CREATOR)
    assert exc.value.status_code == 409
    assert db.updates == []


@pytest.fixture
def no_gl_proposal(monkeypatch):
    proposals = []

    async def propose(db, **kwargs):
        proposals.append(kwargs)

    monkeypatch.setattr(payments.gl_bridge, "propose_journal_for_supplier_payment", propose)
    return proposals


def test_post_writes_a_valid_cashbook_outflow_and_marks_invoices_paid(no_gl_proposal):
    db = FakeSession("approved")
    result = decide(db, "post")

    assert db.committed
    assert result["data"]["status"] == "posted"

    insert = db.statement("INSERT INTO finance.cashbook_transactions")
    inserted = re.search(r"cashbook_transactions \(([^)]*)\)", insert["sql"]).group(1)
    inserted = {c.strip() for c in inserted.split(",")}
    columns, required = cashbook_columns()
    assert inserted <= columns, f"not in the table: {inserted - columns}"
    assert required <= inserted, f"required but not set: {required - inserted}"
    assert "'outflow'" in insert["sql"]
    assert insert["transaction_number"] == "PMT-SPB-00007"
    assert insert["amount"] == 1250.0

    link = db.statement("UPDATE finance.supplier_payment_items")
    assert link["txn_id"] == str(db.cashbook_txn_id)

    invoices = db.statement("UPDATE procurement.supplier_invoices")
    assert "SET status = 'paid'" in invoices["sql"]
    assert "match_status" not in invoices["sql"]

    [update] = db.updates
    assert update["status"] == "posted" and update["status"] in allowed_batch_statuses()
    assert update["total_amount"] == 1250.0
    assert update["posted_by"] == APPROVER
    assert len(no_gl_proposal) == 1


def test_post_refuses_a_batch_with_nothing_to_pay(no_gl_proposal):
    db = FakeSession("approved")
    db.item_total = 0
    with pytest.raises(HTTPException) as exc:
        decide(db, "post")
    assert exc.value.status_code == 422
    assert not any("INSERT" in s["sql"] for s in db.statements)
