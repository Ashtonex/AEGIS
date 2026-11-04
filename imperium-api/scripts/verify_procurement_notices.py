"""End-to-end check of public procurement notices (migration 283) against an
ISOLATED database: backfill, the RFQ / PO / goods-received triggers, the
derived public status, the public payload (no amounts or suppliers), the PO
code check and the staff visibility endpoint.

Needs a local database holding the production definitions of core.organizations,
core.users, projects.projects, procurement.{rfqs, rfq_responses, purchase_orders,
purchase_order_lines, goods_received_notes, suppliers} and
core.document_{attestations, signing_keys} (pg_dump --schema-only -t ...), with
migration 283 NOT yet applied. Refuses to run unless DATABASE_URL is local.

    set DATABASE_URL=postgresql://postgres@127.0.0.1:55433/notices_test
    set PSQL=<path to psql.exe>
    python scripts/verify_procurement_notices.py
"""

import asyncio
import os
import subprocess
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

URL = os.environ.get("DATABASE_URL", "")
if (urlsplit(URL).hostname or "") not in ("127.0.0.1", "localhost"):
    sys.exit("Refusing to run: DATABASE_URL must point at an isolated local database.")

from sqlalchemy import text  # noqa: E402

from app.services import procurement_notices as pn  # noqa: E402
from core.database import AsyncSessionLocal  # noqa: E402

FAILURES: list[str] = []
MIGRATION = ROOT / "migrations" / "283_procurement_public_notices.sql"
NOW = datetime.now(timezone.utc)
ORG = uuid.uuid4()
USER = uuid.uuid4()
PROJECT = uuid.uuid4()
SUPPLIER = uuid.uuid4()


def check(label: str, condition: bool, detail: object = "") -> None:
    print(("PASS " if condition else "FAIL ") + label + (f"  [{detail}]" if not condition and detail != "" else ""))
    if not condition:
        FAILURES.append(label)


def psql_file(path: Path) -> None:
    u = urlsplit(URL)
    result = subprocess.run(
        [os.environ["PSQL"], "-h", u.hostname, "-p", str(u.port), "-U", u.username or "postgres",
         "-d", u.path.lstrip("/"), "-v", "ON_ERROR_STOP=1", "-q", "-f", str(path)],
        capture_output=True, text=True,
    )
    check(f"migration applies cleanly ({path.name})", result.returncode == 0, result.stderr.strip()[-400:])


async def run(db, sql: str, **params):
    return await db.execute(text(sql), params)


async def notice_for(db, *, rfq=None, po=None):
    col, value = ("rfq_id", rfq) if rfq else ("purchase_order_id", po)
    return (await run(db, f"SELECT * FROM procurement.public_notices WHERE {col} = :v", v=value)).mappings().first()


async def status_of(db, reference: str) -> str:
    row = (await run(db, pn.NOTICE_SQL + " AND n.reference = :r", org_id=str(ORG), r=reference)).mappings().first()
    return pn.serialize(dict(row))["status"]


async def main() -> None:
    ids = {k: uuid.uuid4() for k in (
        "rfq_open", "rfq_stale", "rfq_draft", "rfq_cancel_draft", "rfq_closed",
        "po_direct", "po_test", "po_draft", "po_received",
    )}
    async with AsyncSessionLocal() as db:
        await run(db, "INSERT INTO core.organizations (id, name) VALUES (:id, 'SNC test')", id=ORG)
        await run(db, "INSERT INTO core.users (id, email, full_name, organization_id) VALUES (:id, 'qa@example.test', 'QA User', :org)", id=USER, org=ORG)
        await run(db, "INSERT INTO projects.projects (id, name, organization_id) VALUES (:id, 'Willowton Civil', :org)", id=PROJECT, org=ORG)
        await run(db, "INSERT INTO procurement.suppliers (id, supplier_name, organization_id) VALUES (:id, 'Halsteds Secret Supplier', :org)", id=SUPPLIER, org=ORG)

        async def rfq(key, number, status, closing, issued, updated):
            await run(db, """
                INSERT INTO procurement.rfqs (id, organization_id, rfq_number, project_id, title, description, closing_date,
                                              status, issued_at, created_at, updated_at)
                VALUES (:id, :org, :n, :p, :t, 'Supply of culverts and catch pits.', :c, :s, :i, :i0, :u)
            """, id=ids[key], org=ORG, n=number, p=PROJECT, t=f"Willowton {number}", c=closing, s=status,
                i=issued, i0=issued or NOW - timedelta(days=90), u=updated)

        await rfq("rfq_open", "RFQ-1", "issued", NOW + timedelta(days=5), NOW - timedelta(days=6), NOW - timedelta(days=6))
        await rfq("rfq_stale", "RFQ-2", "issued", NOW - timedelta(days=50), NOW - timedelta(days=70), NOW - timedelta(days=70))
        await rfq("rfq_draft", "RFQ-3", "draft", None, None, NOW)
        await rfq("rfq_cancel_draft", "RFQ-4", "cancelled", None, None, NOW)
        await rfq("rfq_closed", "RFQ-5", "closed", NOW - timedelta(days=3), NOW - timedelta(days=20), NOW - timedelta(days=2))

        async def po(key, number, status, issued, updated, rfq_id=None, total=1250):
            await run(db, """
                INSERT INTO procurement.purchase_orders (id, organization_id, po_number, rfq_id, supplier_id, project_id, title,
                    subtotal, tax_amount, total_amount, status, issued_at, notes, created_at, updated_at)
                VALUES (:id, :org, :n, :rfq, :sup, :p, :t, :tot, 0, :tot, :s, :i, 'internal note - do not publish', :c, :u)
            """, id=ids.get(key, key), org=ORG, n=number, rfq=rfq_id, sup=SUPPLIER, p=PROJECT, t=f"Order {number}",
                tot=total, s=status, i=issued, c=issued or NOW, u=updated)

        await po("po_direct", "PO-1", "issued", NOW - timedelta(days=10), NOW - timedelta(days=10))
        await po("po_test", "PO-P8A-TEST-01", "issued", NOW - timedelta(days=40), NOW - timedelta(days=40))
        await po("po_draft", "PO-3", "draft", None, NOW)
        await po("po_received", "PO-4", "received", NOW - timedelta(days=100), NOW - timedelta(days=95))
        await db.commit()

    # ── Backfill ────────────────────────────────────────────────────────────
    psql_file(MIGRATION)
    async with AsyncSessionLocal() as db:
        rows = (await run(db, "SELECT * FROM procurement.public_notices WHERE organization_id = :o ORDER BY published_at", o=ORG)).mappings().all()
        check("backfill: one notice per issued RFQ and direct PO (6)", len(rows) == 6, len(rows))
        check("backfill: references follow issue order",
              [r["reference"] for r in rows] == sorted(r["reference"] for r in rows), [r["reference"] for r in rows])
        check("backfill: draft RFQ / never-issued cancelled RFQ / draft PO get no notice",
              not any(r["rfq_id"] in (ids["rfq_draft"], ids["rfq_cancel_draft"]) or r["purchase_order_id"] == ids["po_draft"] for r in rows))
        test_notice = await notice_for(db, po=ids["po_test"])
        check("backfill: test PO notice is hidden with a reason", test_notice and not test_notice["is_published"] and test_notice["hidden_reason"])

        ref = {k: (await notice_for(db, rfq=ids[k]) if k.startswith("rfq") else await notice_for(db, po=ids[k]))["reference"]
               for k in ("rfq_open", "rfq_stale", "rfq_closed", "po_direct", "po_received")}
        check("status: RFQ before closing date is Active", await status_of(db, ref["rfq_open"]) == "open")
        check("status: RFQ past closing with no movement for 30+ days is Dormant", await status_of(db, ref["rfq_stale"]) == "dormant")
        check("status: RFQ closed without an award is Dormant", await status_of(db, ref["rfq_closed"]) == "dormant")
        check("status: issued direct PO is Awarded", await status_of(db, ref["po_direct"]) == "awarded")
        check("status: fully received PO is Fulfilled", await status_of(db, ref["po_received"]) == "fulfilled")

        # ── Triggers ────────────────────────────────────────────────────────
        await run(db, "UPDATE procurement.rfqs SET status = 'issued', issued_at = now(), closing_date = now() + interval '7 days' WHERE id = :id", id=ids["rfq_draft"])
        new_rfq = await notice_for(db, rfq=ids["rfq_draft"])
        check("trigger: issuing a draft RFQ creates its notice", new_rfq is not None and new_rfq["is_published"])

        before = (await notice_for(db, rfq=ids["rfq_open"]))["last_activity_at"]
        award = uuid.uuid4()
        await po(award, "PO-5", "draft", None, NOW, rfq_id=ids["rfq_open"])
        await run(db, "UPDATE procurement.purchase_orders SET status = 'approved' WHERE id = :id", id=award)
        check("trigger: draft / approved PO from an RFQ adds no notice",
              (await run(db, "SELECT count(*) FROM procurement.public_notices WHERE organization_id = :o", o=ORG)).scalar() == 7)
        await run(db, "UPDATE procurement.purchase_orders SET status = 'issued', issued_at = now() WHERE id = :id", id=award)
        after = await notice_for(db, rfq=ids["rfq_open"])
        check("trigger: issuing a PO from an RFQ reuses the RFQ's notice",
              (await run(db, "SELECT count(*) FROM procurement.public_notices WHERE organization_id = :o", o=ORG)).scalar() == 7)
        check("trigger: issuing the PO bumps the notice's last activity", after["last_activity_at"] > before)
        check("status: RFQ with an issued PO is Awarded", await status_of(db, ref["rfq_open"]) == "awarded")

        await run(db, "UPDATE procurement.public_notices SET last_activity_at = now() - interval '45 days' WHERE rfq_id = :id", id=ids["rfq_open"])
        check("status: awarded with no movement for 30+ days is Dormant", await status_of(db, ref["rfq_open"]) == "dormant")
        await run(db, """
            INSERT INTO procurement.goods_received_notes (organization_id, grn_number, po_id, supplier_id, delivery_date, received_by)
            VALUES (:o, 'GRN-1', :po, :s, CURRENT_DATE, :u)
        """, o=ORG, po=award, s=SUPPLIER, u=USER)
        check("trigger: goods received brings a dormant notice back", await status_of(db, ref["rfq_open"]) == "awarded")
        await run(db, "UPDATE procurement.purchase_orders SET status = 'partially_received' WHERE id = :id", id=award)
        check("status: part-delivered order is In delivery", await status_of(db, ref["rfq_open"]) == "in_delivery")
        await run(db, "UPDATE procurement.purchase_orders SET status = 'received' WHERE id = :id", id=award)
        check("status: delivered order is Fulfilled", await status_of(db, ref["rfq_open"]) == "fulfilled")

        direct = uuid.uuid4()
        await po(direct, "PO-6", "issued", NOW, NOW)
        check("trigger: a PO inserted already issued gets its own notice", await notice_for(db, po=direct) is not None)
        await run(db, "UPDATE procurement.purchase_orders SET status = 'cancelled' WHERE id = :id", id=direct)
        check("status: cancelled direct PO is Cancelled",
              await status_of(db, (await notice_for(db, po=direct))["reference"]) == "cancelled")
        await db.commit()

        # ── Public payload ──────────────────────────────────────────────────
        public = await pn.list_public(db, str(ORG))
        refs = {n["reference"] for n in public}
        check("public list hides the hidden test notice", test_notice["reference"] not in refs)
        blob = repr(public)
        check("public payload carries no amounts, supplier or PO notes",
              "1250" not in blob and "Halsteds" not in blob and "internal note" not in blob, blob[:300])
        one = await pn.get_public(db, str(ORG), ref["po_direct"].lower())
        check("public detail found by reference (case-insensitive)", one and one["status_label"] == "Awarded")
        check("public detail gives the procurement email", one and one["contact_email"] == "procurement@sixnineconstruction.com")
        check("hidden notice has no public detail", await pn.get_public(db, str(ORG), test_notice["reference"]) is None)

        # ── PO code check ───────────────────────────────────────────────────
        await run(db, """
            INSERT INTO core.document_signing_keys (key_id, algorithm, public_key) VALUES ('k1', 'ed25519', 'x')
            ON CONFLICT DO NOTHING
        """)
        await run(db, """
            INSERT INTO core.document_attestations (organization_id, verification_code, document_type, document_number,
                entity_type, entity_id, file_sha256, file_size, payload, signature, key_id)
            VALUES (:o, 'SNC-AAAA-BBBB-CCCC', 'purchase_order', 'PO-5', 'procurement.purchase_order', :po,
                    repeat('a', 64), 1, '{}', 's', 'k1')
        """, o=ORG, po=award)
        await db.commit()
        check("code check: the PO's own code matches its notice",
              await pn.code_belongs_to_notice(db, str(ORG), ref["rfq_open"], "snc aaaa bbbb cccc"))
        check("code check: the same code does not vouch for another notice",
              not await pn.code_belongs_to_notice(db, str(ORG), ref["po_direct"], "SNC-AAAA-BBBB-CCCC"))
        info = await pn.reference_for_po(db, str(ORG), award)
        check("reference_for_po finds an RFQ-awarded PO's notice", info and info["reference"] == ref["rfq_open"])

        # ── Staff visibility endpoint ───────────────────────────────────────
        from fastapi import HTTPException

        from routers.procurement import NoticeVisibilityPayload, set_notice_visibility

        user = {"org_id": str(ORG), "user_id": str(USER)}
        try:
            await set_notice_visibility(ref["po_direct"], NoticeVisibilityPayload(published=False), user=user, db=db)
            check("visibility: hiding without a reason is refused", False)
        except HTTPException as exc:
            check("visibility: hiding without a reason is refused", exc.status_code == 422)
        await set_notice_visibility(ref["po_direct"], NoticeVisibilityPayload(published=False, reason="Duplicate"), user=user, db=db)
        hidden = await notice_for(db, po=ids["po_direct"])
        check("visibility: hide records reason and who", not hidden["is_published"] and hidden["hidden_reason"] == "Duplicate" and hidden["hidden_by"] == USER)
        await set_notice_visibility(ref["po_direct"].lower(), NoticeVisibilityPayload(published=True), user=user, db=db)
        shown = await notice_for(db, po=ids["po_direct"])
        check("visibility: showing again clears the reason", shown["is_published"] and shown["hidden_reason"] is None)

    # ── Idempotency ─────────────────────────────────────────────────────────
    psql_file(MIGRATION)
    async with AsyncSessionLocal() as db:
        count = (await run(db, "SELECT count(*) FROM procurement.public_notices WHERE organization_id = :o", o=ORG)).scalar()
        check("re-running the migration adds no notices", count == 8, count)

    print(f"\n{len(FAILURES)} failure(s)")
    sys.exit(1 if FAILURES else 0)


if __name__ == "__main__":
    asyncio.run(main())
