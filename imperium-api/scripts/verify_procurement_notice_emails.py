"""End-to-end check of phase 3 of procurement notices (migration 284) against
an ISOLATED database: supplier emails (new notice / outcome, once only,
retried on failure), the public notice's requested items, RFQ codes on the
notice page, the signed RFQ PDF route, and the supplier portal's closing-date
rule and procurement@ email.

No email leaves the machine: the sender is a fake that records calls.
Needs a local database with the production definitions of core.organizations,
core.users, projects.projects, procurement.{rfqs, rfq_responses,
purchase_orders, purchase_order_lines, goods_received_notes, suppliers,
purchase_requisitions, requisition_lines} and core.document_{attestations,
signing_keys}, with migrations 283 and 284 NOT yet applied.

    set DATABASE_URL=postgresql://postgres@127.0.0.1:55433/notices_test
    set PSQL=<path to psql.exe>
    python scripts/verify_procurement_notice_emails.py
"""

import asyncio
import os
import subprocess
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

URL = os.environ.get("DATABASE_URL", "")
if (urlsplit(URL).hostname or "") not in ("127.0.0.1", "localhost"):
    sys.exit("Refusing to run: DATABASE_URL must point at an isolated local database.")

from sqlalchemy import text  # noqa: E402

from app.services import procurement_notice_emails as emails  # noqa: E402
from app.services import procurement_notices as pn  # noqa: E402
from core.database import AsyncSessionLocal  # noqa: E402

FAILURES: list[str] = []
NOW = datetime.now(timezone.utc)
ORG, USER, PROJECT = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
SUP_A, SUP_B, SUP_PENDING, SUP_NOMAIL = (uuid.uuid4() for _ in range(4))


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


class FakeSender:
    def __init__(self):
        self.calls: list[dict] = []
        self.fail_next = 0

    async def __call__(self, to, subject, html, text=None, reply_to=None):
        self.calls.append({"to": to, "subject": subject, "html": html, "text": text, "reply_to": reply_to})
        if self.fail_next:
            self.fail_next -= 1
            return SimpleNamespace(ok=False, error="Email service returned HTTP 503")
        return SimpleNamespace(ok=True, error=None)


async def run(db, sql: str, **params):
    return await db.execute(text(sql), params)


async def log_rows(db, notice_id):
    return (await run(db, "SELECT * FROM procurement.notice_email_log WHERE notice_id = :n ORDER BY recipient_email", n=notice_id)).mappings().all()


async def main() -> None:
    async with AsyncSessionLocal() as db:
        await run(db, "INSERT INTO core.organizations (id, name) VALUES (:id, 'SNC test')", id=ORG)
        await run(db, "INSERT INTO core.users (id, email, full_name, organization_id) VALUES (:id, 'qa@example.test', 'QA Buyer', :org)", id=USER, org=ORG)
        await run(db, "INSERT INTO projects.projects (id, name, organization_id) VALUES (:id, 'Willowton Civil', :org)", id=PROJECT, org=ORG)
        for sid, name, status, email in [
            (SUP_A, "Alpha Hardware", "active", "Sales@Alpha.example"),
            (SUP_B, "Beta Cement", "active", "quotes@beta.example"),
            (SUP_PENDING, "Pending Pipes", "pending_approval", "info@pending.example"),
            (SUP_NOMAIL, "No Mail Steel", "active", None),
        ]:
            await run(db, """INSERT INTO procurement.suppliers (id, organization_id, supplier_name, status, primary_contact_email)
                             VALUES (:id, :org, :n, :s, :e)""", id=sid, org=ORG, n=name, s=status, e=email)

        async def requisition(number):
            rid = uuid.uuid4()
            await run(db, """INSERT INTO procurement.purchase_requisitions (id, organization_id, requisition_number, project_id, requested_by, status)
                             VALUES (:id, :org, :n, :p, :u, 'approved')""", id=rid, org=ORG, n=number, p=PROJECT, u=USER)
            await run(db, """INSERT INTO procurement.requisition_lines (organization_id, requisition_id, description, quantity, unit_of_measure, estimated_unit_cost, work_package)
                             VALUES (:org, :r, '600mm culvert pipe', 12, 'length', 987.65, 'Drainage'),
                                    (:org, :r, 'Cement 42.5N', 80, 'bag', 11.11, NULL)""", org=ORG, r=rid)
            return rid

        async def rfq(number, status, closing_days, requisition_id=None):
            rid = uuid.uuid4()
            await run(db, """INSERT INTO procurement.rfqs (id, organization_id, rfq_number, requisition_id, project_id, title, description,
                                 closing_date, status, issued_at, issued_by)
                             VALUES (:id, :org, :n, :req, :p, :t, 'Drainage materials.', :c, CAST(:s AS varchar),
                                     CASE WHEN CAST(:s AS varchar) <> 'draft' THEN now() END, :u)""",
                      id=rid, org=ORG, n=number, req=requisition_id, p=PROJECT, t=f"Willowton {number}",
                      c=NOW + timedelta(days=closing_days), s=status, u=USER)
            return rid

        old_rfq = await rfq("RFQ-OLD", "issued", 5)
        await db.commit()

    # Migration 283 then 284: notices that exist before 284 are not announced.
    psql_file(ROOT / "migrations" / "283_procurement_public_notices.sql")
    psql_file(ROOT / "migrations" / "284_procurement_notice_emails.sql")
    sender = FakeSender()

    async with AsyncSessionLocal() as db:
        old = (await run(db, "SELECT * FROM procurement.public_notices WHERE rfq_id = :id", id=old_rfq)).mappings().first()
        check("existing notice is not announced retroactively", old["announce"] is False)

        req_id = await requisition("PR-1")
        new_rfq = await rfq("RFQ-NEW", "issued", 7, req_id)
        await db.commit()
        new = (await run(db, "SELECT * FROM procurement.public_notices WHERE rfq_id = :id", id=new_rfq)).mappings().first()
        check("a notice created after migration 284 is announced", new["announce"] is True)

        # ── New-notice invitations ─────────────────────────────────────────
        sender.fail_next = 1
        counts = await emails.run(db, sender=sender)
        invited = sorted(c["to"] for c in sender.calls)
        check("invitations go to active suppliers with an email only",
              invited == ["quotes@beta.example", "sales@alpha.example"], invited)
        check("no invitation for the pre-existing notice", not await log_rows(db, old["id"]))
        check("one failed send is recorded for retry", counts == {"sent": 1, "failed": 1}, counts)
        check("invitations reply to procurement@", all(c["reply_to"] == "procurement@sixnineconstruction.com" for c in sender.calls))
        first = sender.calls[0]
        check("invitation names the notice, closing date and portal link",
              new["reference"] in first["subject"] and "portal/supplier?notice=" + new["reference"] in first["text"]
              and "Quotations close" in first["text"])
        check("invitation carries no prices", "987" not in first["html"] and "11.11" not in first["html"])

        sender.calls.clear()
        counts = await emails.run(db, sender=sender)
        check("the failed invitation is retried and nothing else re-sent", counts == {"sent": 1, "failed": 0} and len(sender.calls) == 1, counts)
        counts = await emails.run(db, sender=sender)
        check("a further run sends nothing", counts == {"sent": 0, "failed": 0}, counts)
        rows = await log_rows(db, new["id"])
        check("every invitation logged as sent once", [r["status"] for r in rows] == ["sent", "sent"]
              and sorted(r["attempts"] for r in rows) == [1, 2], [(r["status"], r["attempts"]) for r in rows])

        # ── Public detail: requested items, no costs ───────────────────────
        detail = await pn.get_public(db, str(ORG), new["reference"])
        check("public notice lists the requested items",
              [i["description"] for i in detail["items"]] == ["600mm culvert pipe", "Cement 42.5N"], detail["items"])
        check("public notice items carry no estimated cost", "987" not in repr(detail) and "11.11" not in repr(detail))
        check("public notice gives the portal link", detail["portal_path"] == f"/portal/supplier?notice={new['reference']}")

        # ── Signed RFQ PDF route ───────────────────────────────────────────
        import io

        import pypdf

        from routers.procurement import download_rfq_pdf

        user = {"org_id": str(ORG), "user_id": str(USER)}
        response = await download_rfq_pdf(new_rfq, user=user, db=db)
        pdf_text = " ".join("".join(p.extract_text() for p in pypdf.PdfReader(io.BytesIO(response.body)).pages).split())
        code = response.headers["x-aegis-verification-code"]
        check("RFQ PDF is signed and lists the items", code in pdf_text and "600mm culvert pipe" in pdf_text and "REQUEST FOR QUOTATION" in pdf_text)
        check("RFQ PDF never prints estimated costs", "987" not in pdf_text and "11.11" not in pdf_text)
        check("RFQ PDF points at its notice", new["reference"] in pdf_text and "procurement@sixnineconstruction.com" in pdf_text)
        att = (await run(db, "SELECT * FROM core.document_attestations WHERE verification_code = :c", c=code)).mappings().first()
        check("RFQ PDF is attested against the RFQ", att and att["document_type"] == "request_for_quotation" and att["entity_id"] == new_rfq)
        check("the RFQ's own code is accepted on its notice page", await pn.code_belongs_to_notice(db, str(ORG), new["reference"], code))
        check("the RFQ's code is refused on another notice", not await pn.code_belongs_to_notice(db, str(ORG), old["reference"], code))

        # ── Supplier portal: closing date and procurement@ email ───────────
        from routers import portals

        emailed = []

        async def fake_context(_user, _db):
            return {"linked_supplier_id": str(SUP_B), "name": "Beta Cement"}

        async def fake_role_notification(*args, **kwargs):
            return None

        async def fake_email(**kwargs):
            emailed.append(kwargs)
            return True

        portals._get_supplier_portal_context = fake_context
        portals.emit_role_notification = fake_role_notification
        import app.services.procurement_notice_emails as emails_module

        emails_module.email_procurement_on_quote = fake_email
        payload = portals.SupplierRfqResponseCreate.model_validate({
            "reference": "BC-77", "total_amount": 1500, "notes": "Ex works",
            "line_items": [{"description": "Cement 42.5N", "qty": 80, "unit_price": 12.5}],
        })
        result = await portals.submit_supplier_rfq_response(new_rfq, payload, user=user, db=db)
        check("portal accepts a quote before the closing date", result["success"])
        check("portal quote emails procurement@ with the notice reference",
              emailed and emailed[0]["notice_reference"] == new["reference"] and emailed[0]["supplier_name"] == "Beta Cement", emailed)
        await run(db, "UPDATE procurement.rfqs SET closing_date = now() - interval '1 minute' WHERE id = :id", id=new_rfq)
        await db.commit()
        try:
            await portals.submit_supplier_rfq_response(new_rfq, payload, user=user, db=db)
            check("portal refuses a quote after the closing date", False)
        except Exception as exc:
            check("portal refuses a quote after the closing date", getattr(exc, "status_code", None) == 409, exc)
        await db.rollback()

        # ── Outcome emails ─────────────────────────────────────────────────
        await run(db, """INSERT INTO procurement.rfq_responses (organization_id, rfq_id, supplier_id, total_amount)
                         VALUES (:org, :rfq, :s, 1400)""", org=ORG, rfq=new_rfq, s=SUP_A)
        await run(db, """INSERT INTO procurement.purchase_orders (organization_id, po_number, rfq_id, supplier_id, project_id,
                             subtotal, tax_amount, total_amount, status, issued_at)
                         VALUES (:org, 'PO-9', :rfq, :s, :p, 1400, 0, 1400, 'issued', now())""",
                  org=ORG, rfq=new_rfq, s=SUP_A, p=PROJECT)
        await db.commit()
        sender.calls.clear()
        await emails.run(db, sender=sender)
        outcome = {c["to"]: c for c in sender.calls}
        check("awarded: winner told selected, other quoter told not selected",
              set(outcome) == {"sales@alpha.example", "quotes@beta.example"}
              and "selected" in outcome["sales@alpha.example"]["text"]
              and "not selected" in outcome["quotes@beta.example"]["text"], list(outcome))
        check("outcome emails never name the winner or an amount",
              "Alpha" not in outcome["quotes@beta.example"]["text"] and "1400" not in outcome["quotes@beta.example"]["text"]
              and "1,400" not in outcome["quotes@beta.example"]["text"])
        sender.calls.clear()
        await run(db, "UPDATE procurement.purchase_orders SET status = 'received' WHERE po_number = 'PO-9'")
        await db.commit()
        await emails.run(db, sender=sender)
        check("delivery does not send a second outcome", sender.calls == [], [c["to"] for c in sender.calls])

        cancelled = await rfq("RFQ-CXL", "issued", 3)
        await run(db, """INSERT INTO procurement.rfq_responses (organization_id, rfq_id, supplier_id, total_amount)
                         VALUES (:org, :rfq, :s, 900)""", org=ORG, rfq=cancelled, s=SUP_A)
        await run(db, "UPDATE procurement.rfqs SET status = 'cancelled' WHERE id = :id", id=cancelled)
        closed = await rfq("RFQ-CLS", "issued", 3)
        await run(db, """INSERT INTO procurement.rfq_responses (organization_id, rfq_id, supplier_id, total_amount)
                         VALUES (:org, :rfq, :s, 800)""", org=ORG, rfq=closed, s=SUP_B)
        await run(db, "UPDATE procurement.rfqs SET status = 'closed' WHERE id = :id", id=closed)
        await db.commit()
        sender.calls.clear()
        await emails.run(db, sender=sender)
        texts = {c["to"]: c["text"] for c in sender.calls}
        check("cancelled RFQ: quoter told it was cancelled", "cancelled" in texts.get("sales@alpha.example", ""), texts)
        check("RFQ closed without award: quoter told", "closed without an award" in texts.get("quotes@beta.example", ""), texts)
        check("cancelled / closed RFQs were never announced after closing",
              all("invites your quotation" not in t for t in texts.values()))

    print(f"\n{len(FAILURES)} failure(s)")
    sys.exit(1 if FAILURES else 0)


if __name__ == "__main__":
    asyncio.run(main())
