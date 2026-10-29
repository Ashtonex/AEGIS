"""Verifies, on the configured database inside a transaction that is always
rolled back:

  1. a cashbook posting with another of our accounts as counterparty moves
     both balances (bank -> cash: bank down, cash up), with a mirror leg
  2. counterparty = the same account -> 400
  3. new cash accounts get generated codes (CASH-04 after CASH/CASH-02/CASH-03)
  4. close_day books the standard hours for an on-time sign-in and the actual
     hours for one 30+ minutes late, per office/site pattern

    ../venv/Scripts/python.exe scripts/verify_cashbook_transfer_and_hours.py
"""

import asyncio
from datetime import date, datetime

from fastapi import HTTPException
from sqlalchemy import text

from _rollback_harness import block_outbound, check, finish, rollback_session
from app.services.hr import time_tracking as tt
from core.security import SUPERADMIN_ROLE
from routers.financial_performance import (
    CashAccountCreate,
    CashbookTransactionCreate,
    create_cash_account,
    post_cashbook_transaction,
)

ORG = "00000000-0000-0000-0000-000000000001"
BANK, CASH = "479e90a2-0031-496c-840a-5b354f276c44", "e2effb9d-845a-47ab-9a9d-ba86e63d9d63"


async def balance(db, account_id):
    return float((await db.execute(text("SELECT current_balance FROM finance.cash_accounts WHERE id = :id"), {"id": account_id})).scalar())


async def run() -> None:
    with block_outbound():
        async with rollback_session() as db:
            uid = (await db.execute(text("SELECT id::text FROM core.users WHERE organization_id = :o AND is_deleted = false LIMIT 1"), {"o": ORG})).scalar()
            user = {"user_id": uid, "sub": uid, "org_id": ORG, "role": SUPERADMIN_ROLE}

            print("1. bank -> cash transfer")
            bank0, cash0 = await balance(db, BANK), await balance(db, CASH)
            res = await post_cashbook_transaction(CashbookTransactionCreate(
                cash_account_id=BANK, transaction_type="payment", amount=250, description="Cash withdrawal (verification)",
                counterparty_cash_account_id=CASH, counterparty_name="ignored"), user=user, db=db)
            data = res["data"] if isinstance(res, dict) else res.data
            bank1, cash1 = await balance(db, BANK), await balance(db, CASH)
            check(round(bank0 - bank1, 2) == 250, f"BANKABC down 250 ({bank0} -> {bank1})")
            check(round(cash1 - cash0, 2) == 250, f"Cash up 250 ({cash0} -> {cash1})")
            legs = (await db.execute(text("""
                SELECT cash_account_id::text a, transaction_type t, direction d, counterparty_name n FROM finance.cashbook_transactions
                WHERE id IN (:a, :b)
            """), {"a": data["id"], "b": data["mirror_id"]})).mappings().all()
            by_acc = {r["a"]: r for r in legs}
            check(by_acc[BANK]["t"] == "transfer_out" and by_acc[BANK]["n"] == "Cash", "bank leg is transfer_out to Cash")
            check(by_acc[CASH]["t"] == "transfer_in" and by_acc[CASH]["n"] == "BANKABC", "cash leg is transfer_in from BANKABC")

            print("2. same account on both sides")
            try:
                await post_cashbook_transaction(CashbookTransactionCreate(
                    cash_account_id=BANK, transaction_type="payment", amount=1, description="x",
                    counterparty_cash_account_id=BANK), user=user, db=db)
                check(False, "rejected")
            except HTTPException as exc:
                check(exc.status_code == 400, f"rejected with {exc.status_code}")

            print("3. generated account codes")
            await create_cash_account(CashAccountCreate(account_name="Verification till", account_type="cash"), user=user, db=db)
            await create_cash_account(CashAccountCreate(account_name="Verification bank", account_type="bank", account_code="IGNORED"), user=user, db=db)
            codes = dict((await db.execute(text("""
                SELECT account_name, account_code FROM finance.cash_accounts WHERE organization_id = :o AND account_name LIKE 'Verification %'
            """), {"o": ORG})).all())
            check(codes.get("Verification till") == "CASH-04", f"cash -> {codes.get('Verification till')}")
            check(codes.get("Verification bank") == "BANK-01", f"bank -> {codes.get('Verification bank')}")

            print("4. close_day hours")
            day = date(2026, 10, 29)  # Thursday
            people = (await db.execute(text("""
                SELECT id, work_pattern FROM hr.employees WHERE organization_id = :o AND is_deleted = false
                  AND employment_status <> 'terminated' AND work_pattern = :p LIMIT 1
            """), {"o": ORG, "p": "site"})).first(), (await db.execute(text("""
                SELECT id, work_pattern FROM hr.employees WHERE organization_id = :o AND is_deleted = false
                  AND employment_status <> 'terminated' AND work_pattern = :p LIMIT 1
            """), {"o": ORG, "p": "office"})).first()
            await db.execute(text("""
                DELETE FROM hr.attendance_records WHERE organization_id = :o AND attendance_date = :d AND employee_id IN (:a, :b)
            """), {"o": ORG, "d": day, "a": people[0].id, "b": people[1].id})
            for (emp, _), check_in in zip(people, (datetime(2026, 10, 29, 8, 10, tzinfo=tt.HARARE), datetime(2026, 10, 29, 9, 0, tzinfo=tt.HARARE))):
                await db.execute(text("""
                    INSERT INTO hr.attendance_records (organization_id, employee_id, attendance_date, check_in, status, regular_hours, overtime_hours, source, recorded_by)
                    VALUES (:o, :e, :d, :ci, 'present', 0, 0, 'aegis_login', :u)
                """), {"o": ORG, "e": emp, "d": day, "ci": check_in, "u": uid})
            await tt.close_day(db, day, ORG)
            got = dict((await db.execute(text("""
                SELECT employee_id, regular_hours FROM hr.attendance_records WHERE organization_id = :o AND attendance_date = :d AND employee_id IN (:a, :b)
            """), {"o": ORG, "d": day, "a": people[0].id, "b": people[1].id})).all())
            check(float(got[people[0].id]) == 9.0, f"site, in 08:10 -> {got[people[0].id]} h (standard 9)")
            check(float(got[people[1].id]) == 7.5, f"office, in 09:00 (late) -> {got[people[1].id]} h (09:00-16:30)")
    finish()


if __name__ == "__main__":
    asyncio.run(run())
