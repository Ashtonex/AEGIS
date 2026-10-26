"""Verifies the site pay run on the configured database inside a transaction
that is always rolled back (push/email stubbed).

    .venv/Scripts/python.exe scripts/verify_site_pay_run.py

  1. draft a run for the project with the most unpaid site hours: every
     unpaid entry in the period is claimed once and priced at the worker's
     rates (overtime default 1.5x)
  2. drafting again for the same period -> 409 (no hours left to claim)
  3. paying before approval -> 409; approve; pay -> one cashbook outflow of
     the net and one labour cost of the gross, run 'paid'
  4. paying or cancelling a paid run -> 409
  5. a cancelled draft releases its hours for a new run
"""

import asyncio
from datetime import date
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import text

from _rollback_harness import block_outbound, check, finish, rollback_session
from core.security import SUPERADMIN_ROLE  # noqa: E402
from routers.finance_ops import SitePayRunCreate, SitePayRunDecision, create_site_pay_run, decide_site_pay_run  # noqa: E402


async def run() -> None:
    with block_outbound():
        async with rollback_session() as db:
            target = (await db.execute(text("""
                SELECT te.project_id, te.organization_id::text AS org_id, min(te.work_date) AS d0, max(te.work_date) AS d1,
                       count(*) AS n,
                       (SELECT sum(g) FROM (
                          SELECT round(sum(t.regular_hours) * w2.hourly_rate
                                       + sum(t.overtime_hours) * COALESCE(w2.overtime_rate, round(w2.hourly_rate * 1.5, 2)), 2) AS g
                          FROM finance.site_time_entries t JOIN finance.site_workers w2 ON w2.id = t.worker_id
                          WHERE t.pay_run_id IS NULL AND t.project_id = te.project_id
                          GROUP BY w2.id, w2.hourly_rate, w2.overtime_rate) per_worker) AS expected_gross
                FROM finance.site_time_entries te
                WHERE te.pay_run_id IS NULL GROUP BY 1, 2 ORDER BY count(*) DESC LIMIT 1
            """))).first()
            if not target:
                check(False, "unpaid site hours exist to test with")
                return finish()
            uid = (await db.execute(text("SELECT id::text FROM core.users WHERE organization_id = :o LIMIT 1"), {"o": target.org_id})).scalar()
            user = {"user_id": uid, "sub": uid, "org_id": target.org_id, "role": SUPERADMIN_ROLE}
            cash = (await db.execute(text("SELECT id FROM finance.cash_accounts WHERE organization_id = :o LIMIT 1"), {"o": target.org_id})).scalar()
            body = dict(project_id=target.project_id, period_start=target.d0, period_end=target.d1, payment_date=date.today())

            print(f"\n== 1. draft run: {target.n} unpaid entries {target.d0}..{target.d1}")
            res = await create_site_pay_run(SitePayRunCreate(**body), user=user, db=db)
            run_id = res["data"]["id"]
            run_row = (await db.execute(text("SELECT * FROM finance.site_pay_runs WHERE id = :id"), {"id": run_id})).mappings().first()
            claimed = (await db.execute(text("SELECT count(*) FROM finance.site_time_entries WHERE pay_run_id = :id"), {"id": run_id})).scalar()
            lines_gross = (await db.execute(text("SELECT sum(gross_pay) FROM finance.site_pay_run_lines WHERE pay_run_id = :id"), {"id": run_id})).scalar()
            check(claimed == target.n, f"all {target.n} entries claimed by the run ({claimed})")
            check(abs(Decimal(str(run_row["total_gross"])) - Decimal(str(target.expected_gross))) == 0,
                  f"gross {run_row['total_gross']} = hours x rates {round(target.expected_gross, 2)}")
            check(Decimal(str(lines_gross)) == Decimal(str(run_row["total_gross"])), "lines add up to the run total")

            try:
                await create_site_pay_run(SitePayRunCreate(**body), user=user, db=db)
                check(False, "2. second draft for the same period refused")
            except HTTPException as exc:
                check(exc.status_code == 409, f"2. second draft for the same period refused ({exc.detail})")

            try:
                await decide_site_pay_run(run_id, SitePayRunDecision(action="pay", cash_account_id=cash), user=user, db=db)
                check(False, "3. pay before approval refused")
            except HTTPException as exc:
                check(exc.status_code == 409, "3. pay before approval refused")
            await decide_site_pay_run(run_id, SitePayRunDecision(action="approve"), user=user, db=db)
            if cash:
                await decide_site_pay_run(run_id, SitePayRunDecision(action="pay", cash_account_id=cash), user=user, db=db)
                cb = (await db.execute(text("SELECT count(*), sum(amount) FROM finance.cashbook_transactions WHERE source_type = 'site_pay_run' AND source_id = :id"), {"id": run_id})).first()
                ct = (await db.execute(text("SELECT count(*), sum(amount) FROM finance.cost_transactions WHERE source_type = 'site_pay_run' AND source_id = :id"), {"id": run_id})).first()
                check(cb[0] == 1 and Decimal(str(cb[1])) == Decimal(str(run_row["total_net"])), f"   one cashbook outflow of the net ({cb[1]})")
                check(ct[0] == 1 and Decimal(str(ct[1])) == Decimal(str(run_row["total_gross"])), f"   one labour cost of the gross ({ct[1]})")
                for action in ("pay", "cancel"):
                    try:
                        await decide_site_pay_run(run_id, SitePayRunDecision(action=action, cash_account_id=cash), user=user, db=db)
                        check(False, f"4. {action} on a paid run refused")
                    except HTTPException as exc:
                        check(exc.status_code == 409, f"4. {action} on a paid run refused")
            else:
                check(False, "a cash account exists to pay from")

            print("\n== 5. cancelled draft releases its hours")
            await db.execute(text("UPDATE finance.site_time_entries SET pay_run_id = NULL WHERE pay_run_id = :id"), {"id": run_id})
            res2 = await create_site_pay_run(SitePayRunCreate(**body), user=user, db=db)
            await decide_site_pay_run(res2["data"]["id"], SitePayRunDecision(action="cancel"), user=user, db=db)
            free = (await db.execute(text("""
                SELECT count(*) FROM finance.site_time_entries WHERE project_id = :p AND pay_run_id IS NULL AND work_date BETWEEN :a AND :b
            """), {"p": target.project_id, "a": target.d0, "b": target.d1})).scalar()
            check(free == target.n, f"{free} entries unpaid again after cancel")
    finish()


if __name__ == "__main__":
    asyncio.run(run())
