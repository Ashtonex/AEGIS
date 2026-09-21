"""
One-off backfill: recognises deposits that were confirmed via
POST /projects/{id}/confirm-deposit *before* that endpoint drove them
through the finance.progress_claims lifecycle. Those projects have
deposit_received_amount set on projects.projects but no matching
progress claim/cashbook receipt, so Finance's certified revenue and cash
collected figures never reflected them.

Uses app.services.finance.deposit_recognition.recognise_deposit_as_claimed_revenue
- the exact same code path the live endpoint now uses - so a backfilled
record is indistinguishable in shape from one created live, just backdated
to the project's real deposit_confirmed_at instead of "today".

Idempotent: a project already carrying a 'DEP-%' claim is skipped, so this
is safe to re-run.

Usage (from imperium-api):
    python scripts/backfill_deposit_revenue_recognition.py            # dry run, lists what would change
    python scripts/backfill_deposit_revenue_recognition.py --apply    # actually writes and commits
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from sqlalchemy import text

from core.database import AsyncSessionLocal
from core.logging import logger
from app.services.finance.deposit_recognition import NoCashAccountError, recognise_deposit_as_claimed_revenue


async def main(apply: bool) -> None:
    async with AsyncSessionLocal() as db:
        rows = (
            await db.execute(
                text("""
                    SELECT p.id, p.organization_id, p.name, p.contract_value, p.department_id,
                           p.deposit_received_amount, p.deposit_reference, p.deposit_confirmed_at,
                           p.deposit_confirmed_by
                    FROM projects.projects p
                    WHERE p.is_deleted = false
                      AND p.deposit_received_amount IS NOT NULL
                      AND p.deposit_confirmed_at IS NOT NULL
                      AND NOT EXISTS (
                          SELECT 1 FROM finance.progress_claims pc
                          WHERE pc.project_id = p.id AND pc.organization_id = p.organization_id
                            AND pc.claim_number LIKE 'DEP-%' AND pc.is_deleted = false
                      )
                    ORDER BY p.deposit_confirmed_at
                """)
            )
        ).mappings().all()

        if not rows:
            logger.info("backfill_deposit_revenue_recognition: nothing to backfill.")
            return

        logger.info(f"backfill_deposit_revenue_recognition: {len(rows)} project(s) missing finance recognition.")

        recognised, skipped = 0, 0
        for row in rows:
            project_id = str(row["id"])
            org_id = str(row["organization_id"])
            amount = float(row["deposit_received_amount"])
            as_at = row["deposit_confirmed_at"].date()
            label = f"{row['name']} ({project_id})"

            if not apply:
                print(f"[DRY RUN] would recognise ${amount:,.2f} deposit on {label} as at {as_at}")
                continue

            try:
                result = await recognise_deposit_as_claimed_revenue(
                    db,
                    org_id=org_id,
                    project_id=row["id"],
                    project_name=row["name"],
                    contract_value=float(row["contract_value"] or 0),
                    department_id=row["department_id"],
                    deposit_amount=amount,
                    deposit_reference=row["deposit_reference"],
                    notes="Backfilled retroactively - deposit predates finance recognition wiring.",
                    user_id=str(row["deposit_confirmed_by"]) if row["deposit_confirmed_by"] else None,
                    as_at=as_at,
                )
                await db.commit()
                recognised += 1
                warn = f" (GL warning: {result['gl_proposal_warning']})" if result["gl_proposal_warning"] else ""
                print(f"[OK] {label}: claim {result['claim_number']} for ${amount:,.2f}{warn}")
            except NoCashAccountError as exc:
                await db.rollback()
                skipped += 1
                print(f"[SKIP] {label}: {exc}")
            except Exception as exc:  # noqa: BLE001 - keep going through the rest of the batch
                await db.rollback()
                skipped += 1
                print(f"[ERROR] {label}: {exc!r}")

        if apply:
            logger.info(f"backfill_deposit_revenue_recognition: recognised {recognised}, skipped {skipped}.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="Actually write records (default is dry-run).")
    args = parser.parse_args()
    asyncio.run(main(args.apply))
