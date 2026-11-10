from datetime import date
from decimal import Decimal
from uuid import uuid4

from app.services.finance import bank_books
from app.services.finance.bank_books import HISTORICAL_CASH_USE, Line, Part, _use_journal, money_out_account


def test_historical_cash_use_maps_to_its_own_account():
    assert money_out_account(HISTORICAL_CASH_USE, has_project=False) == "5960"
    assert money_out_account(HISTORICAL_CASH_USE, has_project=True) == "5960"


def test_historical_cash_use_clears_hq_petty_cash_not_suspense():
    accounts = {code: uuid4() for code in (bank_books.HQ_PETTY, bank_books.SUSPENSE, "5960")}
    line = Line({"id": uuid4(), "amount": Decimal("-10000"), "category": bank_books.CASH_WITHDRAWAL,
                 "project_id": None, "description": "Cash Withdrawal", "books_claim_id": None,
                 "transaction_date": date(2026, 3, 13)})
    use = Part("a", uuid4(), None, HISTORICAL_CASH_USE, Decimal("10000"), "Salaries, subcontractors and other")

    debit, credit = _use_journal(line, use, accounts)

    assert debit["account_id"] == accounts["5960"] and debit["debit_amount"] == Decimal("10000")
    assert credit["account_id"] == accounts[bank_books.HQ_PETTY] and credit["credit_amount"] == Decimal("10000")


def test_overhead_categories_map_to_their_own_expense_accounts():
    assert money_out_account("professional_fees", has_project=False) == "6300"
    assert money_out_account("travel_accommodation", has_project=False) == "6500"
    assert money_out_account("office_admin", has_project=False) == "6600"
    assert money_out_account("marketing", has_project=False) == "6700"


def test_loans_lent_out_and_repaid_stay_on_the_balance_sheet():
    from app.services.finance.bank_books import money_in_account
    assert money_out_account("loan_advance", has_project=False) == "1500"
    assert money_in_account("loan_advance", has_project=False) == "1500"


def test_receipt_already_entered_as_a_hand_claim_creates_no_second_claim():
    from app.services.finance.bank_books import _claim_wanted
    row = {"id": uuid4(), "amount": Decimal("102344.55"), "category": "client_receipt", "project_id": uuid4(),
           "description": "RTGS Receipts AFRICAN SUN", "books_claim_id": None, "project_entry_id": None,
           "receipt_already_in_books": False, "claim_entered_by_hand": True}
    line = Line(row)
    assert _claim_wanted(line, line.parts()[0]) is False
    row["claim_entered_by_hand"] = False
    assert _claim_wanted(line, line.parts()[0]) is True


def test_rent_utilities_insurance_have_their_own_accounts():
    assert money_out_account("rent", has_project=False) == "6100"
    assert money_out_account("utilities", has_project=False) == "6200"
    assert money_out_account("insurance", has_project=False) == "6400"
