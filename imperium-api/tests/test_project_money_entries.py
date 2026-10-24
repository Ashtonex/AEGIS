from datetime import date
from decimal import Decimal
from uuid import uuid4

from app.services.finance import bank_books, project_entries
from app.services.finance.bank_books import Line, _claim_wanted, _line_journal


def _line(amount: str, entry_id=None, project_id=None, category=None):
    return Line({"id": uuid4(), "amount": Decimal(amount), "category": category, "project_id": project_id,
                 "description": "RTGS", "books_claim_id": None, "transaction_date": date(2026, 9, 10),
                 "reference": "FT123", "counterparty_name": None, "receipt_already_in_books": False,
                 "project_entry_id": entry_id})


ACCOUNTS = {code: uuid4() for code in (bank_books.BANK, bank_books.AWAITING_BANK, bank_books.REVENUE, "5000",
                                       bank_books.SUSPENSE)}


def test_receipt_settling_an_entry_posts_bank_against_awaiting_not_revenue():
    line = _line("5000", entry_id=uuid4(), project_id=uuid4(), category="client_receipt")
    debit, credit = _line_journal(line, ACCOUNTS)[0]
    assert debit["account_id"] == ACCOUNTS[bank_books.BANK] and debit["debit_amount"] == Decimal("5000")
    assert credit["account_id"] == ACCOUNTS[bank_books.AWAITING_BANK] and credit["credit_amount"] == Decimal("5000")


def test_payment_settling_an_entry_clears_awaiting_against_bank():
    line = _line("-1356.55", entry_id=uuid4(), project_id=uuid4(), category="supplier_payment")
    debit, credit = _line_journal(line, ACCOUNTS)[0]
    assert debit["account_id"] == ACCOUNTS[bank_books.AWAITING_BANK]
    assert credit["account_id"] == ACCOUNTS[bank_books.BANK] and credit["credit_amount"] == Decimal("1356.55")


def test_settling_line_creates_no_claim_of_its_own():
    line = _line("5000", entry_id=uuid4(), project_id=uuid4(), category="client_receipt")
    assert not any(_claim_wanted(line, part) for part in line.parts())
    unlinked = _line("5000", project_id=uuid4(), category="client_receipt")
    assert all(_claim_wanted(unlinked, part) for part in unlinked.parts())


def test_unlinked_project_receipt_still_credits_revenue():
    line = _line("5000", project_id=uuid4(), category="client_receipt")
    gl = _line_journal(line, ACCOUNTS)[0]
    assert gl[1]["account_id"] == ACCOUNTS[bank_books.REVENUE]


def test_reference_hit_outranks_a_closer_date():
    near = {"ref_hit": False, "same_project": True, "name_hit": False, "days_apart": 1}
    referenced = {"ref_hit": True, "same_project": False, "name_hit": False, "days_apart": 9}
    assert sorted([near, referenced], key=project_entries._score, reverse=True)[0] is referenced


def test_summary_counts_only_bank_entries_as_awaiting():
    entries = [
        {"direction": "in", "amount": Decimal("100"), "paid_via": "bank", "match_status": "awaiting", "suggestions": []},
        {"direction": "out", "amount": Decimal("40"), "paid_via": "cash", "match_status": "not_bank", "suggestions": []},
        {"direction": "out", "amount": Decimal("25"), "paid_via": "bank", "match_status": "suggested",
         "suggestions": [{"id": "x"}]},
        {"direction": "in", "amount": Decimal("10"), "paid_via": "bank", "match_status": "matched", "suggestions": []},
    ]
    s = project_entries.summary(entries)
    assert s["recorded_in"] == Decimal("110") and s["recorded_out"] == Decimal("65")
    assert s["awaiting_bank"] == 2 and s["awaiting_bank_amount"] == Decimal("125")
    assert s["needs_decision"] == 1
