"""Conservative LIVE check of the PRAZ e-GP connector against the real portal,
writing only to an ISOLATED local database (refuses anything else).

Reads at most --pages Bulletin Board pages and --details notice pages, at
the connector's normal pacing (3 s between requests). Optionally imports the
best-scoring staged notice into the isolated database to prove the live
data flows through import. Nothing is sent to the portal except GETs of its
public pages.

    set DATABASE_URL=postgresql://postgres@127.0.0.1:55432/aegis_test
    .venv/Scripts/python.exe scripts/live_check_egp_portal.py --pages 2 --details 4 --import-best
"""

import argparse
import asyncio
import os
import sys
from pathlib import Path
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
if (urlsplit(os.environ.get("DATABASE_URL", "")).hostname or "") not in ("127.0.0.1", "localhost"):
    sys.exit("Refusing to run: DATABASE_URL must point at an isolated local database.")

from sqlalchemy import text  # noqa: E402

from _rollback_harness import block_outbound  # noqa: E402
from app.services.tenders.egp import discovery as disc  # noqa: E402
from core.database import AsyncSessionLocal  # noqa: E402
from routers import tender_discovery as td  # noqa: E402


async def main(pages: int, details: int, import_best: bool) -> None:
    with block_outbound():
        async with AsyncSessionLocal() as db:
            org_id = str((await db.execute(text("SELECT id FROM core.organizations LIMIT 1"))).scalar())
            user_row = (await db.execute(text("""
                SELECT u.id::text FROM core.users u JOIN core.user_roles ur ON ur.user_id = u.id
                JOIN core.roles r ON r.id = ur.role_id WHERE r.name = 'Tender / Bid Manager' LIMIT 1"""))).scalar()
            user = {"user_id": user_row, "sub": user_row, "org_id": org_id, "role": "Tender / Bid Manager"}
            source = await disc.ensure_source(db, org_id)
            await db.execute(text("UPDATE crm.tender_sources SET max_details_per_run = :d WHERE id = :id"), {"d": details, "id": source["id"]})
            await db.commit()

            probe = await disc.probe_connection(db, org_id=org_id, user_id=user_row)
            await db.commit()
            print("PROBE:", probe["connection_state"], "-", probe["state_reason"])
            print("      ", {k: probe["probe"].get(k) for k in ("http_status", "records_total", "pages_total", "clock_offset_minutes", "timezone_consistent")})
            if probe["connection_state"] != "connected_verified":
                return

            await db.execute(text("UPDATE crm.tender_discovery_runs SET status = 'cancelled' WHERE status IN ('queued','running')"))
            await db.commit()
            profile = await disc.ensure_default_profile(db, org_id, user_row)
            run = await disc.create_run(db, org_id=org_id, user_id=user_row, profile=profile, filters={}, page_limit=pages)
            await db.commit()
            run = await disc.execute_run(db, str(run["id"]))
            print("RUN:", run["status"], run["outcome"], "|", run["summary"])
            print("     failures:", run["failures"][:3])
            staged = (await db.execute(text("""
                SELECT id, source_notice_id, relevance_band, relevance_score, readiness, detail_status, title, procuring_entity,
                       closing_at, location_text, jsonb_array_length(conflicts) AS conflicts
                FROM crm.tender_candidates WHERE last_run_id = :r ORDER BY relevance_score DESC NULLS LAST LIMIT 10
            """), {"r": run["id"]})).mappings().all()
            for c in staged:
                print(f"  {c['relevance_band']:8} {c['relevance_score']:>4} {c['detail_status']:11} {c['readiness']:22} "
                      f"{c['source_notice_id']} {str(c['title'])[:60]} | {c['procuring_entity']} | closes {c['closing_at']}")
            best = next((c for c in staged if c["detail_status"] == "fetched"), None)
            if import_best and best:
                res = await td.import_selected(td.ImportRequest(items=[td.ImportItem(candidate_id=best["id"], create_new=True)]), user=user, db=db)
                item = res["data"][0]
                print("IMPORT (isolated DB):", item["status"], item.get("tender_url"), item["message"])
                if item.get("tender_id"):
                    reqs = (await db.execute(text("SELECT source, label FROM crm.tender_requirements WHERE tender_id = :t ORDER BY sort_order"),
                                             {"t": item["tender_id"]})).all()
                    for source, label in reqs:
                        print(f"   [{source}] {label[:110]}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--pages", type=int, default=2)
    parser.add_argument("--details", type=int, default=4)
    parser.add_argument("--import-best", action="store_true")
    args = parser.parse_args()
    asyncio.run(main(min(args.pages, 5), min(args.details, 10), args.import_best))
