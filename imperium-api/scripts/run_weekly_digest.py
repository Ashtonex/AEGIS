"""Weekly cron entrypoint (run via system cron, not the arq worker - see
scripts/README-cron.md): aggregates the past 7 days of CRM/quotation
activity per organization and fires the 'weekly_digest' automation trigger
so a matching automation rule can email it to Executive/Admin.

Usage: docker compose exec -T imperium-api python3 scripts/run_weekly_digest.py
"""

import asyncio
import os
import sys
from datetime import datetime, timezone

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from sqlalchemy import bindparam, text

from core.database import AsyncSessionLocal
from core.logging import logger
from app.services.crm.automation_engine import evaluate_and_run_automations

# Stages that still represent open, uncommitted pipeline - matches the
# opportunity lifecycle used elsewhere (Contract = won, Lost = lost).
CLOSED_STAGES = ("Contract", "Lost")


async def main() -> None:
    async with AsyncSessionLocal() as db:
        org_ids = (
            await db.execute(text("SELECT id FROM core.organizations WHERE is_deleted = false"))
        ).scalars().all()

        for org_id in org_ids:
            org_id = str(org_id)

            new_leads = (
                await db.execute(
                    text("""
                        SELECT COUNT(*) FROM crm.leads
                        WHERE organization_id = :org_id AND is_deleted = false
                          AND created_at >= NOW() - INTERVAL '7 days'
                    """),
                    {"org_id": org_id},
                )
            ).scalar() or 0

            pipeline_rows = (
                await db.execute(
                    text("""
                        SELECT stage, COUNT(*) AS count, COALESCE(SUM(budget), 0) AS value
                        FROM crm.opportunities
                        WHERE organization_id = :org_id AND is_deleted = false
                          AND stage NOT IN :closed_stages
                        GROUP BY stage
                        ORDER BY value DESC
                    """).bindparams(bindparam("closed_stages", expanding=True)),
                    {"org_id": org_id, "closed_stages": list(CLOSED_STAGES)},
                )
            ).mappings().all()
            pipeline_total = sum(float(r["value"]) for r in pipeline_rows)
            pipeline_summary = (
                "; ".join(f"{r['stage']}: {r['count']} (${float(r['value']):,.0f})" for r in pipeline_rows)
                or "No open pipeline"
            )

            quotes_row = (
                await db.execute(
                    text("""
                        SELECT
                            COUNT(*) FILTER (WHERE status = 'sent' AND created_at >= NOW() - INTERVAL '7 days') AS sent,
                            COUNT(*) FILTER (WHERE status = 'won' AND updated_at >= NOW() - INTERVAL '7 days') AS won,
                            COUNT(*) FILTER (WHERE status = 'lost' AND updated_at >= NOW() - INTERVAL '7 days') AS lost
                        FROM finance.quotations
                        WHERE organization_id = :org_id AND is_deleted = false
                    """),
                    {"org_id": org_id},
                )
            ).mappings().first()
            won = quotes_row["won"] or 0
            lost = quotes_row["lost"] or 0
            decided = won + lost
            win_rate = f"{(won / decided * 100):.0f}%" if decided else "N/A"

            await evaluate_and_run_automations(
                db,
                org_id,
                None,
                "weekly_digest",
                {
                    "id": org_id,
                    "new_leads": str(new_leads),
                    "pipeline_summary": pipeline_summary,
                    "pipeline_total": f"${pipeline_total:,.0f}",
                    "quotes_sent": str(quotes_row["sent"] or 0),
                    "quotes_won": str(won),
                    "quotes_lost": str(lost),
                    "win_rate": win_rate,
                },
            )

        logger.info(f"Weekly digest fired for {len(org_ids)} organization(s) at {datetime.now(timezone.utc).isoformat()}.")


if __name__ == "__main__":
    asyncio.run(main())
