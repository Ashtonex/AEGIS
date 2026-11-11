"""One-off (2026-11-11, migration 295): repost project money already in the
books from 1 Sep 2026 that the new rules send to a direct-cost account
(rent, utilities, insurance, fees, travel, site admin, levies and "other"
charged to a project). Closed months are left exactly as posted.

Goes through the normal paths - bank_books.sync for statement lines and cash
uses, project_entries.update (rebuild) for money recorded on a project - so
each old journal is reversed and a new one posted. Project cost totals do not
change; only the ledger account does.

Needs migrations 294 and 295 applied first.

    python scripts/repost_project_site_overheads.py            # dry run, rolled back
    python scripts/repost_project_site_overheads.py --commit   # real
    (--org <uuid> --actor <uuid> to run against another organisation)
"""

import asyncio
import sys
from collections import defaultdict
from decimal import Decimal as D

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from _rollback_harness import block_outbound, check, finish, rollback_session
from core.database import engine  # noqa: E402
from app.services.finance import bank_books, project_entries  # noqa: E402


def _arg(name: str, default: str) -> str:
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


ORG = _arg("--org", "00000000-0000-0000-0000-000000000001")
ACTOR = _arg("--actor", "3e84ee75-dd68-4502-9dc2-c6016756d396")
CATEGORIES = list(bank_books._PROJECT_MONEY_OUT_ACCOUNTS)
FROM = bank_books.SITE_OVERHEADS_DIRECT_FROM


async def ledger(db) -> dict:
    out = defaultdict(D)
    for r in await db.execute(text("""
        SELECT a.account_code, sum(jl.debit_amount - jl.credit_amount) AS bal
        FROM finance.journal_lines jl
        JOIN finance.journal_entries je ON je.id = jl.journal_entry_id AND je.status = 'posted'
        JOIN finance.chart_of_accounts a ON a.id = jl.account_id
        WHERE je.organization_id = :org AND je.entry_date >= :from
          AND (a.account_code LIKE '5%' OR a.account_code LIKE '6%' OR a.account_code LIKE '7%')
        GROUP BY 1
    """), {"org": ORG, "from": FROM}):
        out[r.account_code] = D(str(r.bal))
    return out


async def project_cost(db) -> D:
    return D(str((await db.execute(text(
        "SELECT COALESCE(sum(amount), 0) FROM finance.cost_transactions WHERE organization_id = :org AND project_id IS NOT NULL"),
        {"org": ORG})).scalar()))


async def steps(db: AsyncSession) -> None:
    missing = (await db.execute(text("""
        SELECT v.code FROM (VALUES ('5510'),('5520'),('5530'),('5540'),('5550'),('5560'),('5570')) v(code)
        WHERE NOT EXISTS (SELECT 1 FROM finance.chart_of_accounts a
                          WHERE a.organization_id = :org AND a.account_code = v.code AND NOT a.is_deleted)
    """), {"org": ORG})).scalars().all()
    check(not missing, f"migration 295 accounts present{'' if not missing else f' (missing {missing})'}")
    if missing:
        return

    line_ids = list((await db.execute(text("""
        SELECT DISTINCT l.id FROM finance.bank_statement_lines l
        LEFT JOIN finance.bank_line_allocations a ON a.line_id = l.id
        WHERE l.organization_id = :org AND l.amount < 0
          AND ((l.project_id IS NOT NULL AND l.category = ANY(:cats) AND l.transaction_date >= :from)
               OR (a.project_id IS NOT NULL AND a.category = ANY(:cats)
                   AND COALESCE(a.allocation_date, l.transaction_date) >= :from))
    """), {"org": ORG, "cats": CATEGORIES, "from": FROM})).scalars().all())
    entry_ids = list((await db.execute(text("""
        SELECT id FROM finance.project_money_entries
        WHERE organization_id = :org AND NOT is_void AND project_id IS NOT NULL AND direction = 'out'
          AND category = ANY(:cats) AND entry_date >= :from
    """), {"org": ORG, "cats": CATEGORIES, "from": FROM})).scalars().all())
    print(f"  {len(line_ids)} statement line(s) and {len(entry_ids)} recorded entr(ies) dated from {FROM}")

    before, cost_before = await ledger(db), await project_cost(db)
    failing_before = {c["check"] for c in (await bank_books.audit(db, org_id=ORG))["checks"] if not c["ok"]}
    counts = await bank_books.sync(db, org_id=ORG, user_id=ACTOR, line_ids=line_ids) if line_ids else {}
    print("  bank books:", {k: v for k, v in counts.items() if v})
    for entry_id in entry_ids:
        await project_entries.update(db, org_id=ORG, user_id=ACTOR, entry_id=entry_id, changes={})
    after, cost_after = await ledger(db), await project_cost(db)

    print("\n  account        before        after      change")
    for code in sorted(set(before) | set(after)):
        if before.get(code, D(0)) != after.get(code, D(0)):
            print(f"  {code:<8} {before.get(code, D(0)):>12,.2f} {after.get(code, D(0)):>12,.2f} {after.get(code, D(0)) - before.get(code, D(0)):>11,.2f}")
    check(sum(before.values()) == sum(after.values()), "total expense in the open months unchanged (only the account moves)")
    check(cost_before == cost_after, f"project cost totals unchanged ({cost_after:,.2f})")
    moved_to_overheads = sum(after.get(c, D(0)) - before.get(c, D(0)) for c in ("6100", "6200", "6300", "6400", "6500", "6600", "6700", "6900", "7900"))
    check(moved_to_overheads <= 0, "nothing new lands on head-office overheads or other expense")

    audit = await bank_books.audit(db, org_id=ORG)
    newly = [c for c in audit["checks"] if not c["ok"] and c["check"] not in failing_before]
    if failing_before:
        print(f"  (already failing before the repost, untouched: {sorted(failing_before)})")
    check(not newly, f"no bank books audit check newly fails{'' if not newly else f': {newly}'}")


async def run(commit: bool) -> None:
    if commit:
        async with AsyncSession(engine, expire_on_commit=False) as db:
            await steps(db)
            from _rollback_harness import FAILURES
            if FAILURES:
                await db.rollback()
                print("\nFAILURES - rolled back, nothing saved")
            else:
                await db.commit()
        await engine.dispose()
    else:
        with block_outbound():
            async with rollback_session() as db:
                await steps(db)
    print("\nMODE:", "COMMIT" if commit else "DRY RUN (rolled back)")
    finish()


if __name__ == "__main__":
    asyncio.run(run("--commit" in sys.argv))
