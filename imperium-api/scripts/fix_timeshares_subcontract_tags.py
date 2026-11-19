"""One-off (2026-11-10): make the Troutbeck Timeshares payments show on their
projects as the right kind of cost, through the normal bank-books path
(tag -> split -> sync), so cost lines, claims and GL journals all follow.

Owner rulings:
- Blue Swallows = subcontractor (supply & install); "plumbing fittings" = materials.
- Aluminium windows & doors = subcontractor; Rinnai heaters = materials.
- Subcontractor payments from Sep 2026 belong to Units 9-12 as tagged; any other
  payment naming units is apportioned by the units it names.
- Closed months may be reopened with a reason, fixed, and closed again.

    python scripts/fix_timeshares_subcontract_tags.py            # dry run, rolled back
    python scripts/fix_timeshares_subcontract_tags.py --commit   # real
"""

import asyncio
import sys
from collections import defaultdict
from datetime import date
from decimal import Decimal as D
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from _rollback_harness import block_outbound, check, finish, rollback_session
from core.database import engine  # noqa: E402
from app.services.finance import bank_books, bank_reconciliation, general_ledger  # noqa: E402

ORG = "00000000-0000-0000-0000-000000000001"
ACTOR = "3e84ee75-dd68-4502-9dc2-c6016756d396"
U14 = UUID("ccefa92c-7062-46a4-8550-ba2a32ebb8fe")
U58 = UUID("0b3134d1-bc88-4e5a-b270-d5279718fd71")
U912 = UUID("6c74b142-1204-4d49-a95c-43d760f043bf")
PROJECTS = {U14: "Units 1-4", U58: "Units 5-8", U912: "Units 9-12"}
REASON = "Recategorise Troutbeck Timeshares bank payments (subcontract/materials/equipment) per owner, 2026-11-10"

SUB, MAT, EQUIP, TRANSPORT = "subcontractor", "supplier_payment", "equipment_hire", "fuel_transport"

# (project now, date, amount, description fragment, category)
RECATEGORISE = [
    (U14, "2025-10-17", "4512.77", "kitchen units", SUB),
    (U14, "2025-10-23", "800.00", "Blue swallows", SUB),
    (U14, "2025-10-24", "7221.00", "flooring", SUB),
    (U14, "2025-10-28", "2750.80", "Sliding doors", SUB),
    (U14, "2025-11-20", "1943.28", "flooring balance", SUB),
    (U14, "2025-11-26", "1700.00", "Electricals", SUB),
    (U14, "2025-12-10", "4920.00", "TB plumbing", SUB),
    (U14, "2025-12-17", "4920.00", "TB plumbing", SUB),
    (U58, "2025-10-17", "4756.37", "Plumbing equip", MAT),
    (U58, "2026-04-07", "4820.00", "Blue swallows plumbing", SUB),
    (U58, "2026-04-16", "234.00", "glazing", SUB),
    (U58, "2026-05-07", "1421.00", "floor grinding", SUB),
    (U58, "2026-05-12", "609.49", "floor grinding balance", SUB),
    (U58, "2026-05-20", "42.71", "Chryso", MAT),
    (U58, "2026-05-28", "25.00", "welding", SUB),
    (U58, "2026-07-18", "6243.64", "FLOORING FINAL", SUB),
    (U58, "2026-07-18", "1984.62", "kitchen units final", SUB),
    (U58, "2026-07-18", "2072.07", "Aluminum final", SUB),
    (U58, "2026-07-21", "2990.00", "electrical", SUB),
    (U58, "2026-08-17", "500.00", "Scaffold", EQUIP),     # two lines, same day and amount
    (U58, "2026-08-18", "1392.00", "Scaffolding", EQUIP),
    (U912, "2026-09-14", "15.00", "Transpor", TRANSPORT),
    (U912, "2026-10-01", "20.00", "geyser biker", TRANSPORT),
    (U912, "2026-10-08", "1640.00", "Tlb Hire", EQUIP),
    (U912, "2026-10-12", "450.00", "tipper", EQUIP),
    (U912, "2026-11-02", "12065.50", "aluminium", SUB),
    (U912, "2026-11-02", "13482.16", "aluminum", SUB),
]

# (project now, date, amount, fragment, category, [(project, amount, note)])
SIX = "of units 1-6"
SPLITS = [
    (U58, "2026-02-02", "3780.00", "1 TO 6 DEPOSIT", SUB, [(U14, "2520.00", f"4 {SIX}"), (U58, "1260.00", f"2 {SIX}")]),
    (U58, "2026-02-06", "3042.00", "Electricals unit 1 to 6", SUB, [(U14, "2028.00", f"4 {SIX}"), (U58, "1014.00", f"2 {SIX}")]),
    (U58, "2026-02-09", "1899.00", "Carpentry", SUB, [(U14, "1266.00", f"4 {SIX}"), (U58, "633.00", f"2 {SIX}")]),
    (U58, "2026-02-13", "16866.00", "Plumbing fittings units 1 to 8", MAT,
     [(U14, "8433.00", "4 of units 1-8"), (U58, "8433.00", "4 of units 1-8")]),
    (U58, "2026-03-13", "8288.28", "units 1 to 6", SUB, [(U14, "5525.52", f"4 {SIX}"), (U58, "2762.76", f"2 {SIX}")]),
    (U58, "2026-03-13", "24972.51", "units 1to6", SUB, [(U14, "16648.34", f"4 {SIX}"), (U58, "8324.17", f"2 {SIX}")]),
    (U58, "2026-03-13", "15938.00", "units 1 to 6", SUB, [(U14, "10625.33", f"4 {SIX}"), (U58, "5312.67", f"2 {SIX}")]),
    (U912, "2026-09-29", "5197.50", "Rinnai", MAT, [(U58, "2079.00", "2 of units 7-11"), (U912, "3118.50", "3 of units 7-11")]),
    (U912, "2026-10-09", "4480.00", "TB units 7 to 10 deposit", MAT, [(U58, "2240.00", "2 of units 7-10"), (U912, "2240.00", "2 of units 7-10")]),
    (U912, "2026-10-09", "2115.60", "TBz units 7 to 10", MAT, [(U58, "1057.80", "2 of units 7-10"), (U912, "1057.80", "2 of units 7-10")]),
]


async def find(db, project, on, amount, fragment) -> list[UUID]:
    rows = (await db.execute(text("""
        SELECT id FROM finance.bank_statement_lines
        WHERE organization_id = :org AND project_id = :p AND transaction_date = :d AND amount = -CAST(:a AS numeric)
          AND description ILIKE :f
    """), {"org": ORG, "p": project, "d": date.fromisoformat(on), "a": amount, "f": f"%{fragment}%"})).scalars().all()
    return list(rows)


async def costs(db) -> dict:
    out = defaultdict(D)
    for r in await db.execute(text("""
        SELECT project_id, cost_category, sum(amount) amt FROM finance.cost_transactions
        WHERE organization_id = :org AND project_id = ANY(:ids) GROUP BY 1, 2
    """), {"org": ORG, "ids": list(PROJECTS)}):
        out[(PROJECTS[r.project_id], r.cost_category)] = D(str(r.amt))
    return out


async def steps(db: AsyncSession) -> None:
    before = await costs(db)

    # 1. locate every line (fail before touching anything if one is missing)
    recat: dict[str, list[UUID]] = defaultdict(list)
    for project, on, amount, frag, cat in RECATEGORISE:
        ids = await find(db, project, on, amount, frag)
        expected = 2 if (on, amount) == ("2026-08-17", "500.00") else 1
        check(len(ids) == expected, f"{on} {amount} {frag!r}: {len(ids)} line(s)")
        recat[cat] += ids
    split_ids = []
    for project, on, amount, frag, cat, parts in SPLITS:
        ids = await find(db, project, on, amount, frag)
        check(len(ids) == 1, f"{on} {amount} {frag!r}: {len(ids)} line(s) to split")
        check(sum(D(a) for _, a, _ in parts) == D(amount), f"  split adds back to {amount}")
        split_ids.append(ids[0] if ids else None)
    if any(i is None for i in split_ids) or not all(recat.values()):
        return

    # 2. reopen the closed months these lines fall in
    all_ids = [i for ids in recat.values() for i in ids] + split_ids
    periods = (await db.execute(text("""
        SELECT DISTINCT ap.id, ap.period_start, ap.status FROM finance.accounting_periods ap
        JOIN finance.bank_statement_lines l ON l.transaction_date BETWEEN ap.period_start AND ap.period_end
        WHERE ap.organization_id = :org AND l.id = ANY(:ids) AND ap.status NOT IN ('open', 'soft_closed')
        ORDER BY ap.period_start
    """), {"org": ORG, "ids": all_ids})).all()
    print(f"  reopening {len(periods)} closed month(s):", ", ".join(str(p.period_start)[:7] for p in periods))
    for p in periods:
        await general_ledger.reopen_period(db, org_id=ORG, user_id=ACTOR, period_id=p.id, reason=REASON)

    # 3. categories, then splits (each split syncs its own line)
    for cat, ids in recat.items():
        await bank_reconciliation.tag_lines(db, org_id=ORG, user_id=ACTOR, updates={"category": cat}, line_ids=ids)
    counts = await bank_books.sync(db, org_id=ORG, user_id=ACTOR, line_ids=[i for ids in recat.values() for i in ids])
    print("  recategorised:", counts)
    for line_id, (_, _, amount, frag, cat, parts) in zip(split_ids, SPLITS):
        await bank_reconciliation.tag_lines(db, org_id=ORG, user_id=ACTOR, updates={"category": cat}, line_ids=[line_id])
        await bank_books.replace_allocations(db, org_id=ORG, user_id=ACTOR, line_id=line_id, allocations=[
            {"project_id": p, "category": cat, "amount": D(a), "description": f"{PROJECTS[p]} share ({note})"}
            for p, a, note in parts
        ])
    print(f"  split {len(split_ids)} line(s) across projects")

    # 4. close the months again
    for p in periods:
        await general_ledger.close_period(db, org_id=ORG, user_id=ACTOR, period_id=p.id)
    still_open = (await db.execute(text("SELECT count(*) FROM finance.accounting_periods WHERE id = ANY(:ids) AND status <> 'closed'"),
                                   {"ids": [p.id for p in periods]})).scalar()
    check(still_open == 0, "every reopened month is closed again")

    after = await costs(db)
    print("\n  project cost by type        before        after")
    for key in sorted(set(before) | set(after)):
        print(f"  {key[0]:<11} {key[1]:<12} {before.get(key, D(0)):>12,.2f} {after.get(key, D(0)):>12,.2f}")
    total_before, total_after = sum(before.values()), sum(after.values())
    check(total_before == total_after, f"total cost across the three projects unchanged ({total_before:,.2f})")

    audit = await bank_books.audit(db, org_id=ORG)
    failing = [c for c in audit.get("checks", []) if not c.get("ok", c.get("passed", True))]
    check(not failing, f"bank books audit passes{'' if not failing else f': {failing}'}")


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
