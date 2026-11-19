"""One-off: activate the Willowton Group Civil works project through the
normal gate endpoints (commercial pack -> commercial clearance -> mobilisation
approval), so events, task sync and the programme rollout all run as they
would from the UI.

Owner rulings (2026-11-10): authority = fully executed contract; the 14
commercial controls were completed offline and are recorded as complete;
works started on site 2026-11-09.

    .venv/Scripts/python.exe scripts/activate_willowton.py            # dry run, rolled back
    .venv/Scripts/python.exe scripts/activate_willowton.py --commit   # real
"""

import asyncio
import sys
from datetime import date
from decimal import Decimal
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from _rollback_harness import block_outbound, check, finish, rollback_session
from core.database import engine
from core.security import SUPERADMIN_ROLE
from routers.projects import (
    COMMERCIAL_READINESS_CONTROLS,
    CommercialClearancePayload,
    CommercialReadinessUpdate,
    PreMobilisationApproval,
    approve_pre_mobilisation,
    clear_commercial_readiness,
    update_commercial_readiness,
)

ORG = "00000000-0000-0000-0000-000000000001"
PROJECT = UUID("dacf0363-d2db-4467-922b-bbac12a3e705")
ACTOR = "3e84ee75-dd68-4502-9dc2-c6016756d396"  # Aegis Administrare
MOBILISED_ON = date(2026, 11, 9)


async def steps(db: AsyncSession) -> None:
    user = {"user_id": ACTOR, "sub": ACTOR, "org_id": ORG, "role": SUPERADMIN_ROLE}
    row = (await db.execute(text("SELECT status, contract_value FROM projects.projects WHERE id=:p"), {"p": PROJECT})).first()
    check(row.status == "pre_mobilisation", f"starts in pre_mobilisation ({row.status})")

    try:
        res = await update_commercial_readiness(PROJECT, CommercialReadinessUpdate(
            readiness_pack={key: True for key in COMMERCIAL_READINESS_CONTROLS},
            authority_status="fully_executed",
        ), user=user, db=db)
        check(not res["data"]["blockers"], f"commercial pack saved, blockers={res['data']['blockers']}")

        res = await clear_commercial_readiness(PROJECT, CommercialClearancePayload(
            authority_relied_upon="Fully executed contract with Willowton Group Zimbabwe",
            approved_contract_value=Decimal(str(row.contract_value)),
        ), user=user, db=db)
        check(res["data"]["status"] == "cleared", f"commercial readiness {res['data']['status']}")

        res = await approve_pre_mobilisation(PROJECT, PreMobilisationApproval(
            mobilisation_date=MOBILISED_ON,
            conditions="Works started on site 2026-11-09; mobilisation recorded in AEGIS on 2026-11-10.",
        ), user=user, db=db)
        check(res["data"]["status"] == "active", f"project {res['data']['status']}, auth {res['data']['mobilisation_authorisation_number']}")
        print("  programme rollout:", res["data"].get("programme_rollout"))
    except HTTPException as exc:
        check(False, f"HTTP {exc.status_code}: {exc.detail}")
        return

    after = (await db.execute(text("""
        SELECT p.status, p.start_date, pp.mobilisation_approved_at IS NOT NULL AS approved, pp.commercial_readiness_status
        FROM projects.projects p JOIN projects.project_profiles pp ON pp.project_id = p.id WHERE p.id=:p
    """), {"p": PROJECT})).first()
    print("  after:", dict(after._mapping))


async def run(commit: bool) -> None:
    if commit:
        async with AsyncSession(engine, expire_on_commit=False) as db:
            await steps(db)
        await engine.dispose()
    else:
        with block_outbound():
            async with rollback_session() as db:
                await steps(db)
    print("\nMODE:", "COMMITTED" if commit else "DRY RUN (rolled back)")
    finish()


if __name__ == "__main__":
    asyncio.run(run("--commit" in sys.argv))
