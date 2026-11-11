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


# ---------------------------------------------------------------------------
# Office expense vouchers (entries with no project, migration 288)
# ---------------------------------------------------------------------------

def test_office_categories_land_on_head_office_expense_accounts():
    from app.services.finance.bank_books import money_out_account
    expected = {"rent": "6100", "utilities": "6200", "professional_fees": "6300", "insurance": "6400",
                "travel_accommodation": "6500", "office_admin": "6600", "consumables_supplies": "6600",
                "marketing": "6700", "bank_charges": "6800",
                "tax_statutory": "6900", "salaries_wages": "6000", "tithe_donation": "7800", "other": "7900"}
    assert set(project_entries.OFFICE_CATEGORIES) == set(expected)
    for category, code in expected.items():
        assert money_out_account(category, has_project=False) == code, category
    # never Suspense or a project-cost account
    assert all(money_out_account(c, has_project=False) not in (bank_books.SUSPENSE, bank_books.UNCLASSIFIED_PROJECT_COST)
               for c in project_entries.OFFICE_CATEGORIES)


def test_bank_line_settling_an_office_voucher_posts_bank_against_awaiting():
    line = _line("-120", entry_id=uuid4(), project_id=None, category="utilities")
    debit, credit = _line_journal(line, ACCOUNTS)[0]
    assert debit["account_id"] == ACCOUNTS[bank_books.AWAITING_BANK] and debit["debit_amount"] == Decimal("120")
    assert credit["account_id"] == ACCOUNTS[bank_books.BANK]


class _Result:
    def __init__(self, row):
        self._row = row

    def first(self):
        return self._row

    def mappings(self):
        return self

    def scalar(self):
        return self._row


class _Db:
    """Answers every existence check with a row."""
    async def execute(self, *_args, **_kwargs):
        return _Result((1,))


def _office(**overrides):
    values = {"project_id": None, "direction": "out", "paid_via": "cash", "entry_date": date(2026, 11, 3),
              "amount": 45, "category": "utilities", "pays_claim_id": None}
    return {**values, **overrides}


def test_office_voucher_must_be_money_out_with_a_category():
    import asyncio

    import pytest

    from app.services.finance.general_ledger import GeneralLedgerError

    asyncio.run(project_entries._validate(_Db(), "org", _office()))
    with pytest.raises(GeneralLedgerError):
        asyncio.run(project_entries._validate(_Db(), "org", _office(direction="in", category="refund")))
    with pytest.raises(GeneralLedgerError):
        asyncio.run(project_entries._validate(_Db(), "org", _office(category=None)))
    with pytest.raises(GeneralLedgerError):
        asyncio.run(project_entries._validate(_Db(), "org", _office(category="supplier_payment")))


def test_office_totals_are_not_limited_to_the_listed_rows():
    import inspect
    src = inspect.getsource(project_entries.office_summary)
    import re
    assert not re.search(r"\bLIMIT\b", src) and "count(*) AS count" in src
    assert "LIMIT {OFFICE_LIST_LIMIT}" in inspect.getsource(project_entries.list_office)


def test_approver_cannot_be_supplied_by_the_client():
    from pathlib import Path
    router = (Path(__file__).resolve().parents[1] / "routers" / "bank_transactions.py").read_text(encoding="utf-8")
    for model in ("class ProjectEntryFields", "class ProjectEntryUpdate", "class OfficeExpenseFields"):
        body = router.split(model)[1].split("\nclass ")[0]
        assert "approved_by" not in body, model
    assert "approved_by" not in project_entries.ENTRY_FIELDS



def test_consumables_and_supplies_is_a_project_cost_type():
    """Food, water, cleaning and petty-cash buys (migration 289): on a project they
    land on 5910 and count as site overhead; on an office voucher, office admin."""
    from app.services.finance.bank_books import cost_category, money_out_account
    from app.services.finance.bank_rules import KNOWN_CATEGORIES
    from app.services.microsoft.bank_workbook import EDITABLE_CATEGORIES
    assert money_out_account("consumables_supplies", has_project=True) == "5910"
    assert money_out_account("consumables_supplies", has_project=False) == "6600"
    assert cost_category("consumables_supplies") == "overhead"
    assert "consumables_supplies" in KNOWN_CATEGORIES and "consumables_supplies" in EDITABLE_CATEGORIES
    assert "consumables_supplies" not in project_entries.OUT_EXCLUDED


def test_every_project_cost_lands_on_a_direct_cost_account():
    """Migration 295: anything money out that counts as project cost books to a
    5xxx direct-cost account (from the cut-over), so the project cost report and
    the P&L agree. Office vouchers keep their 6xxx overheads; closed periods
    before the cut-over keep what was posted."""
    from app.services.finance.bank_books import (
        EXCLUDED_FROM_PROJECT_BOOKS, SITE_OVERHEADS_DIRECT_FROM, money_out_account,
    )
    on = SITE_OVERHEADS_DIRECT_FROM
    exceptions = {"bank_charges", "refund"}   # finance cost / refund keep their own accounts
    for category in project_entries.OFFICE_CATEGORIES + ("supplier_payment", "subcontractor", "equipment_hire",
                                                          "fuel_transport", "card_purchase"):
        if category in EXCLUDED_FROM_PROJECT_BOOKS or category in exceptions:
            continue
        assert money_out_account(category, has_project=True, on=on).startswith("5"), category
    assert money_out_account("rent", has_project=True, on=on) == "5510"
    assert money_out_account("other", has_project=True, on=on) == "5950"
    assert money_out_account("rent", has_project=False, on=on) == "6100"
    assert money_out_account("rent", has_project=True, on=date(2026, 8, 31)) == "6100"
    assert money_out_account("other", has_project=True, on=date(2026, 8, 31)) == "7900"


def test_drawings_loans_and_tithes_are_never_project_cost():
    from app.services.finance.bank_books import EXCLUDED_FROM_PROJECT_BOOKS, money_out_account
    assert {"owner_drawings", "loan_advance", "tithe_donation"} <= set(EXCLUDED_FROM_PROJECT_BOOKS)
    assert money_out_account("tithe_donation", has_project=True) == "7800"   # the ledger still records it
