"""End-to-end check of AEGIS registered stationery (migration 290) against an
ISOLATED database, through the real HTTP routes: generate books (serial
blocks never overlap), list/get, the print PDF, issue / lose / cancel rules,
voiding a leaf, staff lookup and the public scan (and that a scan of a token
AEGIS never printed is refused).

Needs a local database holding the production definitions of core.users,
core.roles, core.permissions and core.role_permissions (pg_dump --schema-only
-t ...) with migration 290 applied, plus one row in core.users with id USER
below. Refuses to run unless DATABASE_URL is local.

    set DATABASE_URL=postgresql://postgres@127.0.0.1:55437/postgres
    python scripts/verify_stationery_books.py
"""

import asyncio
import io
import os
import sys
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

URL = os.environ.get("DATABASE_URL", "")
if (urlsplit(URL).hostname or "") not in ("127.0.0.1", "localhost"):
    sys.exit("Refusing to run: DATABASE_URL must point at an isolated local database.")

os.environ.setdefault("RATE_LIMIT_ENABLED", "false")

import httpx  # noqa: E402
from pypdf import PdfReader  # noqa: E402
from sqlalchemy import text  # noqa: E402

from core.database import AsyncSessionLocal  # noqa: E402
from core.security import SUPERADMIN_ROLE, get_current_user  # noqa: E402

ORG = os.environ.get("STATIONERY_TEST_ORG", "00000000-0000-0000-0000-0000000000aa")
USER = os.environ.get("STATIONERY_TEST_USER", "11111111-1111-1111-1111-111111111111")
FAILURES: list[str] = []


def check(label: str, condition: bool, detail: object = "") -> None:
    print(("PASS " if condition else "FAIL ") + label + (f"  [{detail}]" if not condition and detail != "" else ""))
    if not condition:
        FAILURES.append(label)


async def main() -> None:
    from main import app

    app.dependency_overrides[get_current_user] = lambda: {"user_id": USER, "sub": USER, "org_id": ORG, "role": SUPERADMIN_ROLE}
    base = "/api/v1/finance/stationery"
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://localhost", timeout=120) as c:
        r = await c.get(f"{base}/types")
        types = r.json()["data"]
        check("8 book types listed", r.status_code == 200 and len(types) == 8, r.text[:200])

        r = await c.get(f"{base}/types/payment_voucher/specimen")
        check("specimen PDF renders", r.status_code == 200 and r.content[:4] == b"%PDF", r.status_code)
        r = await c.get(f"{base}/types/payment_voucher/specimen", params={"page_size": "A5"})
        check("payment voucher refused on A5", r.status_code == 400, r.status_code)

        r = await c.post(f"{base}/books", json={"book_type": "petty_cash_voucher", "count": 2, "leaves_per_book": 10})
        batch1 = r.json().get("data", {})
        check("generate 2 PCV books", r.status_code == 200 and len(batch1.get("books", [])) == 2, r.text[:300])
        r = await c.post(f"{base}/books", json={"book_type": "petty_cash_voucher", "count": 1, "leaves_per_book": 10, "copies": 3})
        batch2 = r.json().get("data", {})
        labels = [b["first_label"] + ".." + b["last_label"] for b in batch1["books"] + batch2["books"]]
        check(
            "serial blocks are consecutive and never overlap",
            labels == ["PCV-000001..PCV-000010", "PCV-000011..PCV-000020", "PCV-000021..PCV-000030"],
            labels,
        )
        check(
            "book numbers continue across batches",
            [b["book_label"] for b in batch1["books"] + batch2["books"]] == ["PCV Book 0001", "PCV Book 0002", "PCV Book 0003"],
        )
        r = await c.post(f"{base}/books", json={"book_type": "nope", "count": 1})
        check("unknown book type refused", r.status_code == 400, r.status_code)
        r = await c.post(f"{base}/books", json={"book_type": "payment_voucher", "count": 1, "page_size": "A5"})
        check("A5 payment voucher book refused", r.status_code == 400, r.status_code)
        r = await c.post(f"{base}/books", json={"book_type": "payment_voucher", "count": 1, "leaves_per_book": 10})
        pv = r.json()["data"]["books"][0]
        check("PV serials start at 1 for their own type", pv["first_label"] == "PV-000001", pv)

        book_id = batch1["books"][0]["id"]
        r = await c.get(f"{base}/books")
        books = r.json()["data"]
        check("register lists 4 books", len(books) == 4, len(books))
        r = await c.get(f"{base}/books", params={"limit": 3})
        page1 = r.json()
        r = await c.get(f"{base}/books", params={"limit": 3, "offset": 3})
        page2 = r.json()
        check(
            "register pages: 3 + 1 rows, total 4 on both",
            len(page1["data"]) == 3 and len(page2["data"]) == 1 and page1["meta"].get("total") == 4 and page2["meta"].get("total") == 4,
            (len(page1["data"]), len(page2["data"]), page1["meta"], page2["meta"]),
        )
        r = await c.get(f"{base}/books", params={"limit": 3, "offset": 10})
        check("page past the end: empty, total still 4", r.json()["data"] == [] and r.json()["meta"].get("total") == 4, r.json()["meta"])
        b = next(x for x in books if x["id"] == book_id)
        check("leaf counts: 10 blank", b["leaves_blank"] == 10 and b["status"] == "generated", b)

        r = await c.get(f"{base}/books/{book_id}")
        leaves = r.json()["data"]["leaves"]
        check("book has 10 leaves in order", [lf["leaf_index"] for lf in leaves] == list(range(1, 11)))

        r = await c.get(f"{base}/books/{book_id}/pdf")
        reader = PdfReader(io.BytesIO(r.content))
        check("print PDF: cover + 10 leaves x 2 copies", r.status_code == 200 and len(reader.pages) == 21, len(reader.pages))
        page1 = reader.pages[1].extract_text()
        check("leaf 1 carries its serial and scan link", "PCV-000001" in page1 and "/q/" in page1, page1[-300:])
        token = page1.split("/q/")[1].split()[0].strip()[:10]
        r = await c.get(f"{base}/books/{book_id}/pdf", params={"cover": "false"})
        check("PDF without cover has 20 pages", len(PdfReader(io.BytesIO(r.content)).pages) == 20)

        # Public scan before the book is issued
        r = await c.get(f"/api/v1/public/stationery/{token}")
        pub = r.json().get("data", {})
        check("public scan: genuine but not issued", r.status_code == 200 and pub.get("result") == "not_issued", r.text[:300])
        check("public scan hides the holder's name", "issued_to_name" not in pub and "organization_id" not in pub, list(pub))
        r = await c.get(f"/api/v1/public/stationery/{token.lower()[:5]}-{token.lower()[5:]}")
        check("public scan accepts a typed, lower-case token", r.json().get("data", {}).get("serial_label") == "PCV-000001")
        r = await c.get("/api/v1/public/stationery/ZZZZZZZZZZ")
        check("token AEGIS never printed -> 404", r.status_code == 404, r.status_code)
        r = await c.get("/api/v1/public/stationery/specimen")
        check("specimen token -> specimen", r.json().get("data", {}).get("result") == "specimen")

        # Lifecycle
        r = await c.post(f"{base}/books/{book_id}/status", json={"action": "completed"})
        check("generated book cannot be completed", r.status_code == 400, r.status_code)
        r = await c.post(f"{base}/books/{book_id}/status", json={"action": "printed"})
        check("mark printed", r.status_code == 200 and r.json()["data"]["status"] == "printed", r.text[:200])
        r = await c.post(f"{base}/books/{book_id}/status", json={"action": "issue"})
        check("issue without a holder refused", r.status_code == 400, r.status_code)
        r = await c.post(
            f"{base}/books/{book_id}/status",
            json={"action": "issue", "issued_to_user_id": "22222222-2222-2222-2222-222222222222", "issued_department": "Front Desk"},
        )
        data = r.json().get("data", {})
        check("issue to a user fills their name", r.status_code == 200 and data.get("issued_to_name") == "Test Front Desk", r.text[:300])

        r = await c.get(f"/api/v1/public/stationery/{token}")
        pub = r.json()["data"]
        check("public scan after issue: unrecorded", pub["result"] == "unrecorded" and pub["issued_department"] == "Front Desk", pub)
        check("scans are counted (3 of this token so far)", pub["scan_count"] == 3, pub["scan_count"])

        leaf2 = leaves[1]["id"]
        r = await c.post(f"{base}/leaves/{leaf2}/void", json={"reason": "Spoilt while writing", "spoiled": True})
        check("void a leaf", r.status_code == 200 and r.json()["data"]["status"] == "spoiled", r.text[:200])
        r = await c.post(f"{base}/leaves/{leaf2}/void", json={"reason": "again"})
        check("cannot void twice", r.status_code == 400, r.status_code)

        r = await c.get(f"{base}/lookup", params={"q": "pcv-000002"})
        check("lookup by serial", r.status_code == 200 and r.json()["data"]["status"] == "spoiled", r.text[:200])
        r = await c.get(f"{base}/lookup", params={"q": f"https://sixnineconstruction.com/q/{token}"})
        check("lookup by scan link", r.status_code == 200 and r.json()["data"]["serial_label"] == "PCV-000001", r.text[:200])

        r = await c.post(f"{base}/books/{book_id}/status", json={"action": "cancelled", "reason": "x"})
        check("issued book cannot be cancelled", r.status_code == 400, r.status_code)
        r = await c.post(f"{base}/books/{book_id}/status", json={"action": "lost"})
        check("lost needs a reason", r.status_code == 400, r.status_code)
        r = await c.post(f"{base}/books/{book_id}/status", json={"action": "lost", "reason": "Stolen from reception"})
        check("report book lost", r.status_code == 200 and r.json()["data"]["status"] == "lost", r.text[:200])
        r = await c.get(f"/api/v1/public/stationery/{token}")
        check("public scan of a lost book: blocked", r.json()["data"]["result"] == "lost")

        spare = batch2["books"][0]["id"]
        r = await c.post(f"{base}/books/{spare}/status", json={"action": "cancelled", "reason": "Misprint"})
        check("unissued book can be cancelled", r.status_code == 200 and r.json()["data"]["status"] == "cancelled", r.text[:200])

    async with AsyncSessionLocal() as db:
        counter = (
            await db.execute(text("SELECT last_serial, last_book_number FROM core.stationery_counters WHERE book_type = 'petty_cash_voucher'"))
        ).one()
        check("counter matches what was issued", tuple(counter) == (30, 3), tuple(counter))
        dupes = (await db.execute(text("SELECT count(*) - count(DISTINCT token) FROM core.stationery_leaves"))).scalar()
        check("all tokens unique", dupes == 0, dupes)

    print()
    print("ALL PASSED" if not FAILURES else f"{len(FAILURES)} FAILED: {FAILURES}")
    sys.exit(1 if FAILURES else 0)


if __name__ == "__main__":
    asyncio.run(main())
