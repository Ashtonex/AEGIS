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
