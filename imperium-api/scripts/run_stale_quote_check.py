"""Daily cron entrypoint (run via system cron, not the arq worker - see
scripts/README-cron.md): finds quotations sitting in 'sent' status with no
decision for 3+ days and fires the 'quotation_stale' automation trigger so a
matching automation rule can email the quote's owner to follow up.

Usage: docker compose exec -T imperium-api python3 scripts/run_stale_quote_check.py
"""

import asyncio
import os
import sys
from datetime import datetime, timezone

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from sqlalchemy import text

from core.database import AsyncSessionLocal
from core.logging import logger
from app.services.crm.automation_engine import evaluate_and_run_automations

STALE_AFTER_DAYS = 3


async def main() -> None:
    async with AsyncSessionLocal() as db:
        rows = (
            await db.execute(
                text("""
                    SELECT q.id, q.organization_id, q.client_name, q.quote_amount,
                           q.created_by, u.email AS rep_email
                    FROM finance.quotations q
                    LEFT JOIN core.users u ON u.id = q.created_by
                    WHERE q.is_deleted = false
                      AND q.status = 'sent'
                      AND q.updated_at < NOW() - make_interval(days => :days)
                    LIMIT 500
                """),
                {"days": STALE_AFTER_DAYS},
            )
        ).mappings().all()

        fired = 0
        for row in rows:
            quotation_id = str(row["id"])
            org_id = str(row["organization_id"])
            await evaluate_and_run_automations(
                db,
                org_id,
                str(row["created_by"]) if row["created_by"] else None,
                "quotation_stale",
                {
                    "id": quotation_id,
                    "quotation_id": quotation_id,
                    "client_name": row["client_name"] or "",
                    "quote_amount": str(row["quote_amount"]) if row["quote_amount"] is not None else "",
                    "rep_email": row["rep_email"] or "",
                },
            )
            fired += 1

        logger.info(f"Stale quote check fired {fired} trigger(s) at {datetime.now(timezone.utc).isoformat()}.")


if __name__ == "__main__":
    asyncio.run(main())
