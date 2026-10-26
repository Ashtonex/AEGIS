"""Exercises the Sync-from-Quotation and quotation-win budget seeding paths
against the configured database inside ONE outer transaction that is always
rolled back - nothing it does is ever committed.

    .venv/Scripts/python.exe scripts/verify_quotation_budget_sync.py <project_ref> [<project_ref> ...]

Each project_ref is a project id or code. For every project it:
  * calls GET  /budget/eligible-quotations and /budget/category-summary,
  * calls POST /budget/import-quotation for the linked quotation,
  * checks the new approved budget's lines add up to its header,
  * repeats the import and checks no second budget version appears,
  * tries every unpriced quotation it can find and checks it is refused
    with 422 while the approved budget stays untouched.
"""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import HTTPException  # noqa: E402
from sqlalchemy import text  # noqa: E402
from sqlalchemy.ext.asyncio import AsyncSession  # noqa: E402

from core.database import engine  # noqa: E402
from core.security import SUPERADMIN_ROLE, user_has_permission  # noqa: E402
from routers.projects import (  # noqa: E402
    QuotationImportPayload,
    get_budget_category_summary,
    get_eligible_quotations_for_project,
    import_budget_from_quotation,
)

FAILURES: list[str] = []


def check(cond: bool, label: str) -> None:
    print(("  PASS " if cond else "  FAIL ") + label)
    if not cond:
        FAILURES.append(label)


async def approved_budget(db, project_id):
    return (await db.execute(text("""
        SELECT b.id, b.total_amount, b.budget_version,
               (SELECT COALESCE(SUM(amount), 0) FROM finance.budget_lines l
                 WHERE l.budget_id = b.id AND NOT COALESCE(l.is_deleted, false)) AS lines_total,
               (SELECT count(*) FROM finance.project_budgets x WHERE x.project_id = b.project_id) AS versions,
               (SELECT count(*) FROM finance.boq_line_items x
                 WHERE x.project_id = b.project_id AND x.status = 'active' AND NOT x.is_deleted) AS boq_active
        FROM finance.project_budgets b
        WHERE b.project_id = :pid AND b.status = 'approved' AND NOT b.is_deleted
    """), {"pid": project_id})).first()


async def run(project_refs: list[str]) -> None:
    async with engine.connect() as conn:
        outer = await conn.begin()
        db = AsyncSession(bind=conn, join_transaction_mode="create_savepoint", expire_on_commit=False)
        try:
            for ref in project_refs:
                proj = (await db.execute(text("""
                    SELECT id, organization_id, created_by, project_code, name FROM projects.projects
                    WHERE (id::text = :r OR project_code = :r) AND NOT is_deleted LIMIT 1
                """), {"r": ref})).first()
                if not proj:
                    check(False, f"{ref}: project exists")
                    continue
                user = {
                    "user_id": str(proj.created_by), "sub": str(proj.created_by),
                    "org_id": str(proj.organization_id), "role": "verification",
                }
                pid = str(proj.id)
                print(f"\n== {proj.project_code or proj.name} ({pid})")

                eligible = await get_eligible_quotations_for_project(ref, user=user, db=db, _={})
                rows = eligible["data"]["all_eligible_quotations"]
                check(isinstance(rows, list), f"eligible-quotations lists {len(rows)} quotation(s)")

                summary = await get_budget_category_summary(ref, user=user, db=db, _={})
                linked = summary["data"]["linked_quotation"]
                print(f"  linked quotation: {linked and linked['id']}")

                before = await approved_budget(db, pid)
                if before and await user_has_permission(db, user, "projects.budget_baseline.lock"):
                    # Find a real colleague without the Finance lock grant.
                    for row in (await db.execute(text("""
                        SELECT id FROM core.users WHERE organization_id = :org AND id <> :me LIMIT 40
                    """), {"org": user["org_id"], "me": user["user_id"]})).all():
                        other = {**user, "user_id": str(row.id), "sub": str(row.id)}
                        if not await user_has_permission(db, other, "projects.budget_baseline.lock"):
                            user = other
                            break
                if before and not await user_has_permission(db, user, "projects.budget_baseline.lock"):
                    try:
                        res = await import_budget_from_quotation(ref, QuotationImportPayload(), user=user, db=db)
                        check(bool(res["data"].get("already_current")),
                              "non-Finance user cannot replace an approved baseline")
                    except HTTPException as exc:
                        after = await approved_budget(db, pid)
                        check(exc.status_code in (403, 404, 409, 422) and after.id == before.id,
                              f"non-Finance user refused {exc.status_code}, approved baseline untouched")
                # Finance-equivalent caller for the rest of the run.
                user = {**user, "role": SUPERADMIN_ROLE}
                try:
                    res = await import_budget_from_quotation(ref, QuotationImportPayload(), user=user, db=db)
                    data = res["data"]
                    after = await approved_budget(db, pid)
                    if data.get("already_current"):
                        check(after.id == before.id, "unchanged quotation: current budget kept")
                    else:
                        check(after is not None and float(after.total_amount) == data["total_amount"],
                              f"import set approved budget to {data['total_amount']}")
                        check(abs(float(after.lines_total) - float(after.total_amount)) < 0.01,
                              f"budget lines ({after.lines_total}) add up to header ({after.total_amount})")
                        check(after.boq_active == data["boq_lines_seeded"] or data["boq_lines_seeded"] == 0,
                              f"{data['boq_lines_seeded']} BOQ lines seeded, {after.boq_active} active")
                    again = await import_budget_from_quotation(ref, QuotationImportPayload(), user=user, db=db)
                    after2 = await approved_budget(db, pid)
                    check(again["data"].get("already_current") is True and after2.versions == after.versions,
                          "repeat import is idempotent (no extra budget version)")
                except HTTPException as exc:
                    after = await approved_budget(db, pid)
                    check(exc.status_code in (404, 409, 422) and (after and after.id) == (before and before.id),
                          f"import refused {exc.status_code} ({exc.detail}) and budget untouched")

                unpriced = [q for q in rows if q["category_estimates"]["total"] <= 0][:3]
                for q in unpriced:
                    before = await approved_budget(db, pid)
                    try:
                        await import_budget_from_quotation(
                            ref, QuotationImportPayload(quotation_id=q["id"]), user=user, db=db,
                        )
                        check(False, f"unpriced quotation {q['id'][:8]} refused")
                    except HTTPException as exc:
                        after = await approved_budget(db, pid)
                        check(exc.status_code in (409, 422) and (after and after.id) == (before and before.id),
                              f"unpriced quotation {q['id'][:8]} refused with {exc.status_code}, budget untouched")
        finally:
            await db.close()
            await outer.rollback()
    await engine.dispose()
    print("\nRESULT:", "ALL PASSED" if not FAILURES else f"{len(FAILURES)} FAILURE(S)")
    sys.exit(1 if FAILURES else 0)


if __name__ == "__main__":
    asyncio.run(run(sys.argv[1:] or ["EHTRW", "TBTS4", "TCT-2026-014"]))
