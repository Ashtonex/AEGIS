"""Cron entrypoint for tender automation (run via system cron, not the arq
worker - see scripts/README-cron.md). Every 15 minutes is fine: each
organisation only runs when its own schedule (Tender automation settings:
interval, enabled) is due. Per due organisation it verifies the e-GP
connection, runs discovery, imports the matching notices (if auto-import
is on), collects their documents and schedule, and sends the new-tender
emails. Then it retries every due email delivery.

Usage: docker compose exec -T imperium-api python3 scripts/run_tender_automation.py
"""

import asyncio
import json
import os
import sys

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.services.tenders.pipeline import run_scheduled  # noqa: E402
from core.logging import logger  # noqa: E402


async def main() -> None:
    outcomes = await run_scheduled()
    logger.info("tender_automation.cron_finished", outcomes=outcomes)
    print(json.dumps(outcomes, default=str))


if __name__ == "__main__":
    asyncio.run(main())
