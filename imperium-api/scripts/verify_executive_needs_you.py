"""Verify the executive "Needs you" list end to end against the configured
(production) database, inside one rolled-back transaction.

Creates migration 306's table inside the transaction (when it is not live
yet), reads the list, then assigns, snoozes, dismisses and reopens items.
Nothing is kept: the outer transaction is always rolled back and push/email
delivery is stubbed.

    .venv/Scripts/python.exe scripts/verify_executive_needs_you.py
"""

import asyncio
import sys
from datetime import timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from fastapi import HTTPException  # noqa: E402
from sqlalchemy import text  # noqa: E402

from _rollback_harness import block_outbound, check, finish, rollback_session  # noqa: E402

import routers.executive as executive  # noqa: E402
from app.services import executive_sites as sites  # noqa: E402

ORG = "00000000-0000-0000-0000-000000000001"
MIGRATION = Path(__file__).resolve().parents[1] / "migrations" / "306_executive_action_states.sql"


async def _sequential(db, *reads):
    # Borrowed connections would not see the in-transaction table.
    return [await read(db) for read in reads]


async def main() -> None:
    executive.gather_reads = _sequential
    with block_outbound() as outbound:
        async with rollback_session() as db:
            exists = (await db.execute(text("SELECT to_regclass('core.executive_action_states')"))).scalar()
            if not exists:
                conn = await db.connection()
                raw = await conn.get_raw_connection()
                await raw.driver_connection.execute(MIGRATION.read_text(encoding="utf-8"))
            actor = (await db.execute(text(
                "SELECT id FROM core.users WHERE organization_id=:org AND is_active AND NOT is_deleted "
                "ORDER BY created_at LIMIT 1"), {"org": ORG})).scalar()
            user = {"org_id": ORG, "user_id": str(actor)}
            before_notifications = (await db.execute(text("SELECT count(*) FROM core.notifications"))).scalar()

            res = await executive.get_executive_needs_you(user=user, db=db)
            data = res["data"]
            items = data["items"]
            print(f"  {len(items)} items, summary {data['summary']}, {len(data['assignees'])} assignees")
            for item in items:
                owner = (item["suggested_owner"] or {}).get("name")
                print(f"   [{item['severity']:8}] {item['kind']:9} {item['title'][:90]}  owner={owner}")
            check(not res["meta"]["source_errors"], "no source errors")
            check(all(item["key"] for item in items), "every item has a key")
            check(len({item["key"] for item in items}) == len(items), "keys are unique")
            severities = [executive.needs_you_service.SEVERITY_ORDER[item["severity"]] for item in items]
            check(severities == sorted(severities), "worst first")

            site_item = next((item for item in items if item["kind"] == "site"), None)
            exception_item = next((item for item in items if item["kind"] == "exception"), None)
            other = next(row for row in data["assignees"] if row["user_id"] != str(actor))

            if site_item:
                res = await executive.act_on_executive_needs_you(
                    {"item_key": site_item["key"], "action": "assign", "assignee_user_id": other["user_id"],
                     "note": "verification"}, user=user, db=db)
                after = executive.needs_you_service.find_item(res["data"]["items"], site_item["key"])
                check(after["state"]["assigned_to"]["user_id"] == other["user_id"], "assign sticks")
                notifications = (await db.execute(text("SELECT count(*) FROM core.notifications"))).scalar()
                check(notifications == before_notifications + 1, "assignee gets one notification")

                res = await executive.act_on_executive_needs_you(
                    {"item_key": site_item["key"], "action": "snooze"}, user=user, db=db)
                after = executive.needs_you_service.find_item(res["data"]["items"], site_item["key"])
                check(after["hidden"] and after["state"]["status"] == "snoozed", "snooze hides the site")
                check(after["state"]["assigned_to"] is not None, "snooze keeps the assignee")
                check(res["data"]["summary"]["snoozed"] >= 1, "summary counts snoozed")

                # A new flag on the site brings it back.
                await db.execute(text(
                    "UPDATE core.executive_action_states SET signature = signature[2:] "
                    "WHERE organization_id=:org AND item_key=:key"), {"org": ORG, "key": site_item["key"]})
                res = await executive.get_executive_needs_you(user=user, db=db)
                after = executive.needs_you_service.find_item(res["data"]["items"], site_item["key"])
                check(not after["hidden"] and after["state"]["returned"], "new problem un-snoozes")

                try:
                    await executive.act_on_executive_needs_you(
                        {"item_key": site_item["key"], "action": "snooze",
                         "until": (sites.site_today() + timedelta(days=200)).isoformat()}, user=user, db=db)
                    check(False, "snooze beyond 90 days is refused")
                except HTTPException as exc:
                    check(exc.status_code == 400, "snooze beyond 90 days is refused")

            if exception_item:
                try:
                    await executive.act_on_executive_needs_you(
                        {"item_key": exception_item["key"], "action": "dismiss"}, user=user, db=db)
                    check(False, "dismiss without a reason is refused")
                except HTTPException as exc:
                    check(exc.status_code == 400, "dismiss without a reason is refused")
                res = await executive.act_on_executive_needs_you(
                    {"item_key": exception_item["key"], "action": "dismiss", "note": "old, already handled"},
                    user=user, db=db)
                after = executive.needs_you_service.find_item(res["data"]["items"], exception_item["key"])
                check(after["hidden"] and after["state"]["status"] == "dismissed", "dismiss hides the exception")
                res = await executive.act_on_executive_needs_you(
                    {"item_key": exception_item["key"], "action": "reopen"}, user=user, db=db)
                after = executive.needs_you_service.find_item(res["data"]["items"], exception_item["key"])
                check(not after["hidden"] and after["state"]["status"] == "open", "reopen shows it again")

            try:
                await executive.act_on_executive_needs_you(
                    {"item_key": "site:00000000-0000-0000-0000-00000000dead", "action": "snooze"}, user=user, db=db)
                check(False, "unknown item is a 404")
            except HTTPException as exc:
                check(exc.status_code == 404, "unknown item is a 404")
    print(f"  outbound intercepted: {len(outbound)}")
    finish()


if __name__ == "__main__":
    asyncio.run(main())
