"""Verifies POST /quotations/{id}/decision against the configured database
inside a transaction that is always rolled back, with push/email stubbed.

    .venv/Scripts/python.exe scripts/verify_quotation_decision.py

Scenarios (fixtures are adjusted only inside the rolled-back transaction):
  A. repeating 'won' on a won quotation changes nothing (was: re-seeded budget)
  B. unpriced quotation won on a project -> budget untouched, reason returned
  C. priced quotation won on a project with an approved baseline:
     non-Finance caller -> baseline untouched; Finance caller -> new budget
     whose lines add up to its header, BOQ lines seeded
  D. client-name-only match never auto-links a project
"""

import asyncio

from fastapi import HTTPException
from sqlalchemy import text
from starlette.requests import Request

from _rollback_harness import block_outbound, check, finish, rollback_session
from core.security import SUPERADMIN_ROLE, user_has_permission
from routers.quotations import decide_quotation


def _request() -> Request:
    return Request({"type": "http", "method": "POST", "path": "/", "headers": []})


async def budget_state(db, project_id):
    row = (await db.execute(text("""
        SELECT (SELECT count(*) FROM finance.project_budgets WHERE project_id = :p) AS versions,
               b.id, b.total_amount,
               (SELECT COALESCE(SUM(amount), 0) FROM finance.budget_lines l WHERE l.budget_id = b.id) AS lines_total,
               (SELECT count(*) FROM finance.boq_line_items x
                 WHERE x.project_id = :p AND x.status = 'active' AND NOT x.is_deleted) AS boq_active
        FROM (SELECT 1) one
        LEFT JOIN finance.project_budgets b
          ON b.project_id = :p AND b.status = 'approved' AND NOT b.is_deleted
    """), {"p": project_id})).first()
    return row


async def quote(db, criteria: str):
    return (await db.execute(text(f"""
        SELECT q.id::text AS id, q.organization_id::text AS org_id
        FROM finance.quotations q WHERE NOT q.is_deleted AND {criteria}
        ORDER BY q.created_at DESC LIMIT 1
    """))).first()


async def project(db, criteria: str):
    return (await db.execute(text(f"""
        SELECT id::text AS id, organization_id::text AS org_id, client_name FROM projects.projects p
        WHERE NOT is_deleted AND {criteria} LIMIT 1
    """))).first()


async def other_user(db, org_id, *, lock: bool, exclude: str):
    for row in (await db.execute(text(
        "SELECT id::text AS id FROM core.users WHERE organization_id = :o AND id::text <> :x LIMIT 60"
    ), {"o": org_id, "x": exclude or ""})).all():
        u = {"user_id": row.id, "sub": row.id, "org_id": org_id, "role": "verification"}
        if await user_has_permission(db, u, "projects.budget_baseline.lock") == lock:
            return u
    return None


async def run() -> None:
    with block_outbound():
        async with rollback_session() as db:
            # A. repeat decision
            won = await quote(db, "q.status = 'won' AND q.project_id IS NOT NULL")
            pid = (await db.execute(text("SELECT project_id::text FROM finance.quotations WHERE id = :i"), {"i": won.id})).scalar()
            before = await budget_state(db, pid)
            su = {"user_id": None, "sub": None, "org_id": won.org_id, "role": SUPERADMIN_ROLE}
            su["user_id"] = su["sub"] = (await db.execute(text(
                "SELECT id::text FROM core.users WHERE organization_id = :o LIMIT 1"), {"o": won.org_id})).scalar()
            print(f"\n== A. repeat 'won' on {won.id[:8]}")
            res = await decide_quotation(won.id, {"status": "won"}, _request(), user=su, db=db)
            after = await budget_state(db, pid)
            check(res["data"].get("already_decided") is True, "repeat decision reported as already decided")
            check(after.versions == before.versions and after.id == before.id, "no budget re-seeded")

            # B. unpriced quotation won on a project with no budget
            unpriced = await quote(db, "q.status NOT IN ('won','lost') AND jsonb_array_length(COALESCE(q.metadata->'items','[]'::jsonb)) = 0")
            target = await project(db, "NOT EXISTS (SELECT 1 FROM finance.project_budgets b WHERE b.project_id = p.id)")
            print(f"\n== B. unpriced {unpriced.id[:8]} won on project {target.id[:8]}")
            await db.execute(text("UPDATE finance.quotations SET project_id = CAST(:p AS uuid) WHERE id = CAST(:q AS uuid)"),
                             {"p": target.id, "q": unpriced.id})
            before = await budget_state(db, target.id)
            res = await decide_quotation(unpriced.id, {"status": "won"}, _request(), user=su, db=db)
            after = await budget_state(db, target.id)
            check(res["data"]["budget_id"] is None and bool(res["data"]["budget_pending_reason"]),
                  f"no budget written, reason: {res['data']['budget_pending_reason']}")
            check(after.versions == before.versions == 0, "project still has no budget (no approved $0 budget)")

            # C. priced quotation won on a project that already has an approved baseline
            priced = await quote(db, "q.status NOT IN ('won','lost') AND q.project_id IS NULL AND jsonb_array_length(COALESCE(q.metadata->'items','[]'::jsonb)) BETWEEN 1 AND 40")
            based = await project(db, "EXISTS (SELECT 1 FROM finance.project_budgets b WHERE b.project_id = p.id AND b.status = 'approved' AND b.total_amount > 0)")
            print(f"\n== C. priced {priced.id[:8]} won on project {based.id[:8]} with approved baseline")
            await db.execute(text("UPDATE finance.quotations SET project_id = CAST(:p AS uuid) WHERE id = CAST(:q AS uuid)"),
                             {"p": based.id, "q": priced.id})
            author = (await db.execute(text("SELECT created_by::text FROM finance.quotations WHERE id = CAST(:q AS uuid)"), {"q": priced.id})).scalar()
            plain = await other_user(db, priced.org_id, lock=False, exclude=author)
            before = await budget_state(db, based.id)
            if plain:
                try:
                    res = await decide_quotation(priced.id, {"status": "won"}, _request(), user=plain, db=db)
                    after = await budget_state(db, based.id)
                    check(after.id == before.id and res["data"]["budget_id"] is None,
                          f"non-Finance win leaves baseline untouched: {res['data']['budget_pending_reason']}")
                    # put it back to undecided for the Finance run
                    await db.execute(text("UPDATE finance.quotations SET status = 'draft' WHERE id = CAST(:q AS uuid)"), {"q": priced.id})
                except HTTPException as exc:
                    after = await budget_state(db, based.id)
                    check(exc.status_code in (403, 409) and after.id == before.id,
                          f"non-Finance win refused by an existing gate ({exc.status_code}: {exc.detail}); baseline untouched")
            # The endpoint's rollback on refusal also undoes fixture changes.
            await db.execute(text("UPDATE finance.quotations SET project_id = CAST(:p AS uuid), status = 'draft' WHERE id = CAST(:q AS uuid)"),
                             {"p": based.id, "q": priced.id})
            res = await decide_quotation(priced.id, {"status": "won"}, _request(), user=su, db=db)
            after = await budget_state(db, based.id)
            check(res["data"]["budget_id"] is not None and after.id != before.id,
                  f"Finance win seeds a new approved budget ({res['message']})")
            check(abs(float(after.lines_total) - float(after.total_amount)) < 0.01,
                  f"lines ({after.lines_total}) add up to header ({after.total_amount})")
            check(after.boq_active > 0, f"{after.boq_active} BOQ lines active")

            # D. client-name-only match must not auto-link
            loose = await quote(db, "q.status NOT IN ('won','lost') AND q.project_id IS NULL")
            named = await project(db, "client_name IS NOT NULL AND opportunity_id IS NULL AND tender_id IS NULL")
            print(f"\n== D. {loose.id[:8]} shares only a client name with project {named.id[:8]}")
            await db.execute(text("""
                UPDATE finance.quotations SET client_name = :n, client_org_id = NULL, opportunity_id = NULL, tender_id = NULL
                WHERE id = CAST(:q AS uuid)
            """), {"n": named.client_name, "q": loose.id})
            res = await decide_quotation(loose.id, {"status": "won"}, _request(), user=su, db=db)
            check(res["data"]["project_linked"] is False, "won quotation not auto-linked by client name")
    finish()


if __name__ == "__main__":
    asyncio.run(run())
