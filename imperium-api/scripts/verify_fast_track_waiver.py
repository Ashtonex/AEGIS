"""Verifies the executive waiver on commercial clearance (Fast-Track
Mobilisation) against the configured database inside a transaction that is
always rolled back (push/email stubbed). Willowton is put back into
pre-mobilisation with an empty commercial pack inside the transaction.

    .venv/Scripts/python.exe scripts/verify_fast_track_waiver.py

  1. clearing with open items and no exceptions is refused (409)
  2. naming only some open items is refused (409)
  3. naming all of them without mobilisation authority is refused (403)
  4. an executive naming all of them clears; controls stay unticked and the
     summary reports them as waived, not as blockers
  5. mobilisation approval then moves the project to active
"""

import asyncio
import json
from datetime import date
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import text

from _rollback_harness import block_outbound, check, finish, rollback_session
import routers.projects as projects_router  # noqa: E402
from core.security import SUPERADMIN_ROLE  # noqa: E402
from routers.projects import (  # noqa: E402
    CommercialClearancePayload,
    PreMobilisationApproval,
    _commercial_readiness_summary,
    approve_pre_mobilisation,
    clear_commercial_readiness,
)

ORG = "00000000-0000-0000-0000-000000000001"
PROJECT = UUID("dacf0363-d2db-4467-922b-bbac12a3e705")
ACTOR = "3e84ee75-dd68-4502-9dc2-c6016756d396"
# A blocker recorded by hand: not derivable from the control pack, so the
# waived list must come from what was accepted at clearance.
MANUAL_BLOCKERS = ["Client performance bond not yet lodged"]


async def attempt(coro):
    try:
        return await coro, None
    except HTTPException as exc:
        return None, exc


async def run() -> None:
    with block_outbound():
        async with rollback_session() as db:
            su = {"user_id": ACTOR, "sub": ACTOR, "org_id": ORG, "role": SUPERADMIN_ROLE}
            await db.execute(text("UPDATE projects.projects SET status='pre_mobilisation', start_date=NULL WHERE id=:p"), {"p": PROJECT})
            await db.execute(text("""
                UPDATE projects.project_profiles
                SET commercial_readiness_status='in_progress', commercial_readiness_pack='{}'::jsonb,
                    commercial_readiness_blockers=CAST(:manual AS jsonb), commercial_clearance_statement='{}'::jsonb,
                    commercial_cleared_at=NULL, commercial_cleared_by=NULL, mobilisation_approved_at=NULL
                WHERE project_id=:p
            """), {"p": PROJECT, "manual": json.dumps(MANUAL_BLOCKERS)})
            summary = await _commercial_readiness_summary(db, org_id=ORG, project_id=PROJECT)
            controls_open = [c["label"] for c in summary["controls"] if not c["complete"]]
            open_items = list(dict.fromkeys(summary["blockers"] + controls_open))
            check(len(open_items) == 15, f"14 open controls + 1 manual blocker ({len(open_items)})")

            print("\n== 1. no exceptions")
            _, err = await attempt(clear_commercial_readiness(PROJECT, CommercialClearancePayload(
                authority_relied_upon="verification"), user=su, db=db))
            check(err is not None and err.status_code == 409, f"refused ({err and err.status_code})")

            print("\n== 2. only some exceptions")
            _, err = await attempt(clear_commercial_readiness(PROJECT, CommercialClearancePayload(
                authority_relied_upon="verification", executive_exceptions_accepted=open_items[:-1]), user=su, db=db))
            check(err is not None and err.status_code == 409, f"refused ({err and err.status_code})")

            print("\n== 3. all exceptions, no mobilisation authority")
            real = projects_router.user_has_permission

            async def deny(db_, user_, key):
                return False if key == "projects.registration.approve" else await real(db_, user_, key)

            projects_router.user_has_permission = deny
            try:
                _, err = await attempt(clear_commercial_readiness(PROJECT, CommercialClearancePayload(
                    authority_relied_upon="verification", executive_exceptions_accepted=open_items),
                    user={**su, "role": "Commercial Manager"}, db=db))
            finally:
                projects_router.user_has_permission = real
            check(err is not None and err.status_code == 403, f"refused ({err and err.status_code})")

            print("\n== 4. executive waiver")
            res, err = await attempt(clear_commercial_readiness(PROJECT, CommercialClearancePayload(
                authority_relied_upon="Executive fast-track authorization: verification",
                executive_exceptions_accepted=open_items, outstanding_conditions=open_items), user=su, db=db))
            check(err is None, f"cleared{'' if err is None else f' ({err.detail})'}")
            if err:
                return finish()
            data = res["data"]
            check(data["status"] == "cleared" and data["ready"], "status cleared and ready")
            check(data["blockers"] == [], "no live blockers on the cleared pack")
            check(sorted(data["waived"]) == sorted(open_items), f"all {len(open_items)} items reported as waived")
            check(MANUAL_BLOCKERS[0] in data["waived"], "the waived manual blocker stays in the waived list")
            check(data["ready_count"] == 0, "controls stay unticked (not claimed as done)")
            check(data["clearance_statement"].get("executive_waiver") is True, "statement records the waiver")

            print("\n== 5. mobilisation")
            res, err = await attempt(approve_pre_mobilisation(PROJECT, PreMobilisationApproval(
                mobilisation_date=date(2026, 11, 9)), user=su, db=db))
            check(err is None and res["data"]["status"] == "active", f"project active{'' if err is None else f' ({err.detail})'}")
    finish()


if __name__ == "__main__":
    asyncio.run(run())
