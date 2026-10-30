"""End-to-end verification of live rate sources and build-up templates
(migration 280) through the real FastAPI app against an ISOLATED database.

Seeds tagged inventory / PO / rate-card / fleet / site-worker rows, exercises
GET /quotations/rate-sources, POST /quotations/rate-sources/resolve and the
/quotations/rate-templates endpoints, then deletes what it seeded.

Refuses to run unless DATABASE_URL points at localhost.

    set DATABASE_URL=postgresql://postgres@127.0.0.1:55432/aegis_test
    .venv/Scripts/python.exe scripts/verify_quotation_rate_sources.py
"""

import asyncio
import os
import secrets
import sys
import time
import uuid
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

if (urlsplit(os.environ.get("DATABASE_URL", "")).hostname or "") not in ("127.0.0.1", "localhost"):
    sys.exit("Refusing to run: DATABASE_URL must point at an isolated local database.")

JWT_SECRET = secrets.token_urlsafe(48)
JWT_ISSUER = "aegis-local-quotation-rate-sources-test"
os.environ["JWT_SECRET_KEY"] = JWT_SECRET
os.environ["JWT_ISSUER"] = JWT_ISSUER
os.environ.setdefault("ENVIRONMENT", "development")
os.environ.setdefault("BACKGROUND_JOBS_ENABLED", "false")
os.environ["RATE_LIMIT_ENABLED"] = "false"

import httpx  # noqa: E402
import jwt  # noqa: E402
from sqlalchemy import text  # noqa: E402

from _rollback_harness import FAILURES, block_outbound, check  # noqa: E402
from core.database import AsyncSessionLocal  # noqa: E402
from main import app  # noqa: E402

TAG = uuid.uuid4().hex[:6].upper()
Q = "/api/v1/quotations"


async def scalar(db, sql, **p):
    return (await db.execute(text(sql), p)).scalar()


async def make_user(db, org_id, name, role):
    uid = str(uuid.uuid4())
    email = f"{name.lower().replace(' ', '.')}.{TAG.lower()}@example.test"
    await db.execute(text("""INSERT INTO core.users (id, organization_id, email, full_name, is_active, is_deleted)
                             VALUES (:id, :org, :email, :name, true, false)"""),
                     {"id": uid, "org": org_id, "email": email, "name": name})
    await db.execute(text("INSERT INTO auth.users (id, email) VALUES (:id, :email) ON CONFLICT DO NOTHING"), {"id": uid, "email": email})
    role_id = await scalar(db, "SELECT id FROM core.roles WHERE organization_id = :org AND name = :name", org=org_id, name=role)
    assert role_id, f"role {role} missing in replica"
    await db.execute(text("INSERT INTO core.user_roles (user_id, role_id, organization_id) VALUES (:u, :r, :org)"),
                     {"u": uid, "r": role_id, "org": org_id})
    now = int(time.time())
    token = jwt.encode({
        "sub": uid, "aud": "authenticated", "iss": JWT_ISSUER, "iat": now, "exp": now + 3600, "role": "authenticated",
        "email": email, "app_metadata": {"org_id": org_id}, "user_metadata": {},
    }, JWT_SECRET, algorithm="HS256")
    return {"id": uid, "headers": {"Authorization": f"Bearer {token}"}}


async def seed(db, org_id):
    ids = {}
    ids["supplier"] = await scalar(db, "INSERT INTO procurement.suppliers (organization_id, supplier_name) VALUES (:org, :n) RETURNING id",
                                   org=org_id, n=f"Supplier {TAG}")
    ids["sub"] = await scalar(db, "INSERT INTO crm.subcontractors (organization_id, name) VALUES (:org, :n) RETURNING id",
                              org=org_id, n=f"Haulier {TAG}")
    ids["cement"] = await scalar(db, """INSERT INTO procurement.inventory_items (organization_id, item_name, item_code, unit_of_measure, standard_cost, unit_price_ex_vat)
                                       VALUES (:org, :n, :c, 'bag', 11.00, 11.80) RETURNING id""", org=org_id, n=f"Cement 42.5N {TAG}", c=f"CEM-{TAG}")
    ids["sand"] = await scalar(db, """INSERT INTO procurement.inventory_items (organization_id, item_name, unit_of_measure, standard_cost)
                                     VALUES (:org, :n, 'm3', 24.00) RETURNING id""", org=org_id, n=f"River sand {TAG}")

    async def po(status, when, price, item=None, desc=None):
        po_id = await scalar(db, """INSERT INTO procurement.purchase_orders (organization_id, po_number, supplier_id, status, currency, subtotal, tax_amount, total_amount, issued_at)
                                   VALUES (:org, :n, :s, :st, 'USD', 0, 0, 0, NOW() - make_interval(days => CAST(:d AS integer))) RETURNING id""",
                             org=org_id, n=f"PO-{TAG}-{uuid.uuid4().hex[:4]}", s=ids["supplier"], st=status, d=when)
        await db.execute(text("""INSERT INTO procurement.purchase_order_lines (organization_id, po_id, item_id, description, quantity, unit_of_measure, unit_price, line_total)
                                 VALUES (:org, :po, :item, :desc, 10, 'bag', :p, :lt)"""),
                         {"org": org_id, "po": po_id, "item": item, "desc": desc or f"Cement 42.5N {TAG}", "p": price, "lt": round(price * 10, 2)})
        return po_id

    ids["po_old"] = await po("issued", 40, 12.10, ids["cement"])
    ids["po_new"] = await po("received", 5, 12.60, ids["cement"])
    ids["po_draft"] = await po("draft", 1, 99.00, ids["cement"])
    ids["po_cancel"] = await po("cancelled", 2, 88.00, ids["cement"])
    ids["po_free"] = await po("issued", 3, 7.25, None, f"Binding wire {TAG}")
    ids["rate_mat"] = await scalar(db, """INSERT INTO procurement.vendor_rate_items (organization_id, subcontractor_id, rate_type, description, unit_of_measure, unit_price, currency, is_active, effective_from)
                                         VALUES (:org, :s, 'material', :d, 'm3', 31.00, 'USD', true, CURRENT_DATE - 10) RETURNING id""",
                                   org=org_id, s=ids["sub"], d=f"Aggregate 19mm {TAG}")
    ids["rate_haul"] = await scalar(db, """INSERT INTO procurement.vendor_rate_items (organization_id, subcontractor_id, rate_type, description, unit_of_measure, unit_price, currency, is_active, effective_from, route_from, route_to)
                                          VALUES (:org, :s, 'transport', :d, 'trip', 140.00, 'USD', true, CURRENT_DATE - 10, 'Quarry', 'Site') RETURNING id""",
                                    org=org_id, s=ids["sub"], d=f"Tipper load {TAG}")
    ids["rate_expired"] = await scalar(db, """INSERT INTO procurement.vendor_rate_items (organization_id, subcontractor_id, rate_type, description, unit_of_measure, unit_price, currency, is_active, effective_from, effective_to)
                                             VALUES (:org, :s, 'material', :d, 'm3', 5.00, 'USD', true, CURRENT_DATE - 100, CURRENT_DATE - 50) RETURNING id""",
                                       org=org_id, s=ids["sub"], d=f"Expired stone {TAG}")
    ids["exc"] = await scalar(db, """INSERT INTO fleet.fleet (organization_id, vehicle_registration, asset_code, make, model, vehicle_type, hourly_operating_cost, hourly_charge_rate)
                                    VALUES (:org, :r, :c, 'CAT', '320', 'Excavator', 38.50, 55.00) RETURNING id""", org=org_id, r=f"EXC-{TAG}", c=f"PL-{TAG}")
    ids["retired"] = await scalar(db, """INSERT INTO fleet.fleet (organization_id, vehicle_registration, asset_code, make, model, vehicle_type, hourly_operating_cost, retired_on)
                                        VALUES (:org, :r, :c, 'CAT', '320', 'Excavator', 20, CURRENT_DATE) RETURNING id""", org=org_id, r=f"OLD-{TAG}", c=f"PL-OLD-{TAG}")
    ids["workers"] = []
    for name, trade, rate in ((f"Worker A {TAG}", f"Bricklayer {TAG}", 5.0), (f"Worker B {TAG}", f"Bricklayer {TAG}", 6.0),
                              (f"Worker C {TAG}", f"bricklayer {TAG} ", 7.5), (f"Worker D {TAG}", f"Welder {TAG}", 9.0),
                              (f"Worker E {TAG}", f"Welder {TAG}", 10.0)):
        ids["workers"].append(await scalar(db, """INSERT INTO finance.site_workers (organization_id, full_name, trade, hourly_rate, currency, status)
                                                  VALUES (:org, :n, :t, :r, 'USD', 'active') RETURNING id""", org=org_id, n=name, t=trade, r=rate))
    return ids


async def cleanup(db, ids):
    await db.execute(text("DELETE FROM finance.site_workers WHERE id = ANY(CAST(:ids AS uuid[]))"), {"ids": [str(i) for i in ids["workers"]]})
    await db.execute(text("DELETE FROM fleet.fleet WHERE id IN (:a, :b)"), {"a": ids["exc"], "b": ids["retired"]})
    await db.execute(text("DELETE FROM procurement.vendor_rate_items WHERE subcontractor_id = :s"), {"s": ids["sub"]})
    await db.execute(text("DELETE FROM procurement.purchase_order_lines WHERE po_id IN (SELECT id FROM procurement.purchase_orders WHERE supplier_id = :s)"), {"s": ids["supplier"]})
    await db.execute(text("DELETE FROM procurement.purchase_orders WHERE supplier_id = :s"), {"s": ids["supplier"]})
    await db.execute(text("DELETE FROM procurement.inventory_items WHERE id IN (:a, :b)"), {"a": ids["cement"], "b": ids["sand"]})
    await db.execute(text("DELETE FROM crm.subcontractors WHERE id = :s"), {"s": ids["sub"]})
    await db.execute(text("DELETE FROM procurement.suppliers WHERE id = :s"), {"s": ids["supplier"]})
    await db.execute(text("UPDATE finance.construction_assemblies SET superseded_by = NULL WHERE assembly_code LIKE :c"), {"c": f"%{TAG}%"})
    await db.execute(text("DELETE FROM finance.construction_assemblies WHERE assembly_code LIKE :c"), {"c": f"%{TAG}%"})


def by(items, **kw):
    return [c for c in items if all(c.get(k) == v for k, v in kw.items())]


async def main() -> None:
    client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app, raise_app_exceptions=False), base_url="http://127.0.0.1:8000")
    async with AsyncSessionLocal() as db:
        org_id = str(await scalar(db, "SELECT id FROM core.organizations ORDER BY created_at LIMIT 1"))
        estimator = await make_user(db, org_id, f"Estimator {TAG}", "Estimations & Quotations Associate")
        qs = await make_user(db, org_id, f"QS {TAG}", "Quantity Surveyor")
        ids = await seed(db, org_id)
        await db.commit()

    try:
        print("\nA. Material sources: inventory, latest priced PO, active rate card")
        r = await client.get(f"{Q}/rate-sources", params={"q": TAG, "resource_type": "material"}, headers=estimator["headers"])
        check(r.status_code == 200, f"rate-sources is routed (not captured by /{{item_id}}): {r.status_code}")
        data = r.json().get("data", [])
        inv = by(data, source_type="inventory", source_ref=str(ids["cement"]))
        check(len(inv) == 1 and inv[0]["rate"] == 11.8 and inv[0]["currency"] is None and inv[0]["date"],
              "inventory: unit price ex VAT used, currency left unset (not guessed), dated")
        sand = by(data, source_type="inventory", source_ref=str(ids["sand"]))
        check(len(sand) == 1 and sand[0]["rate"] == 24.0 and "standard cost" in sand[0]["detail"], "inventory without a price falls back to standard cost and says so")
        pos = by(data, source_type="purchase_order", source_ref=f"item:{ids['cement']}")
        check(len(pos) == 1 and pos[0]["rate"] == 12.6 and pos[0]["currency"] == "USD",
              "PO: newest priced PO line for the item (12.60), draft 99 and cancelled 88 ignored")
        check(len(by(data, source_type="purchase_order", rate=7.25)) == 1, "PO line without a stock item is offered on its own")
        mats = by(data, source_type="vendor_rate", resource_type="material")
        check(len(mats) == 1 and mats[0]["rate"] == 31.0, "rate card: active material line only (expired line excluded)")
        check(not by(data, source_type="vendor_rate", resource_type="transport"), "transport card not offered for a material resource")

        print("\nB. Transport, plant and labour")
        r = await client.get(f"{Q}/rate-sources", params={"q": TAG, "resource_type": "transport"}, headers=estimator["headers"])
        haul = r.json()["data"]
        check(len(haul) == 1 and haul[0]["rate"] == 140.0 and "Quarry" in haul[0]["name"], "transport rate card with its route")
        r = await client.get(f"{Q}/rate-sources", params={"q": TAG, "resource_type": "equipment"}, headers=estimator["headers"])
        plant = r.json()["data"]
        check(by(plant, source_type="fleet_operating", source_ref=str(ids["exc"]), rate=38.5) and by(plant, source_type="fleet_charge", source_ref=str(ids["exc"]), rate=55.0),
              "own fleet: operating cost and internal charge rate offered separately")
        check(not [c for c in plant if c["source_ref"] == str(ids["retired"])], "retired plant excluded")
        r = await client.get(f"{Q}/rate-sources", params={"q": TAG, "resource_type": "labour"}, headers=estimator["headers"])
        labour = r.json()["data"]
        brick = [c for c in labour if c["name"].lower().startswith("bricklayer")]
        check(len(brick) == 1 and brick[0]["rate"] == 6.0 and "3 active" in brick[0]["detail"],
              "labour: median of 3 bricklayers (5, 6, 7.5 -> 6.00), trade case/space normalised")
        check(not [c for c in labour if c["name"].lower().startswith("welder")], "trade with only 2 workers hidden (individual pay not exposed)")
        check(TAG not in str([c["name"] for c in labour]).replace(f"Bricklayer {TAG}", "").replace(f"bricklayer {TAG}", ""),
              "no worker names in labour candidates")
        r = await client.get(f"{Q}/rate-sources", params={"resource_type": "bogus"}, headers=estimator["headers"])
        check(r.status_code == 400, "unknown resource type rejected")

        print("\nC. Resolve (refresh) follows the source to today's value")
        refs = [
            {"source_type": "inventory", "source_ref": str(ids["cement"])},
            {"source_type": "purchase_order", "source_ref": f"item:{ids['cement']}"},
            {"source_type": "fleet_charge", "source_ref": str(ids["exc"])},
            {"source_type": "site_labour", "source_ref": brick[0]["source_ref"]},
            {"source_type": "inventory", "source_ref": "not-a-uuid"},
            {"source_type": "made_up", "source_ref": "x"},
        ]
        async with AsyncSessionLocal() as db:
            await db.execute(text("UPDATE procurement.inventory_items SET unit_price_ex_vat = 12.25 WHERE id = :id"), {"id": ids["cement"]})
            await db.execute(text("UPDATE fleet.fleet SET hourly_charge_rate = 60 WHERE id = :id"), {"id": ids["exc"]})
            await db.commit()
        r = await client.post(f"{Q}/rate-sources/resolve", json={"refs": refs}, headers=estimator["headers"])
        res = r.json().get("data", {})
        check(r.status_code == 200 and res.get(f"inventory:{ids['cement']}", {}).get("rate") == 12.25, "inventory price change visible")
        check(res.get(f"purchase_order:item:{ids['cement']}", {}).get("rate") == 12.6, "PO ref resolves to the newest priced PO")
        check(res.get(f"fleet_charge:{ids['exc']}", {}).get("rate") == 60.0 and f"fleet_operating:{ids['exc']}" not in res,
              "fleet ref returns only the requested rate kind")
        check(res.get(f"site_labour:{brick[0]['source_ref']}", {}).get("rate") == 6.0, "labour ref resolves")
        check(len(res) == 4, f"invalid / unknown refs ignored, not errors ({len(res)} resolved)")
        async with AsyncSessionLocal() as db:
            await db.execute(text("UPDATE procurement.inventory_items SET is_deleted = true WHERE id = :id"), {"id": ids["cement"]})
            await db.commit()
        r = await client.post(f"{Q}/rate-sources/resolve", json={"refs": refs[:1]}, headers=estimator["headers"])
        check(r.json()["data"] == {}, "deleted stock item is reported as gone (absent), not priced")
        r = await client.post(f"{Q}/rate-sources/resolve", json={"refs": "nope"}, headers=estimator["headers"])
        check(r.status_code == 400, "malformed resolve payload rejected")

        print("\nD. Build-up templates")
        buildup = [
            {"type": "material", "name": "Cement", "qty": 7, "unit": "bag", "rate": 12.6, "source_type": "purchase_order", "source_ref": f"item:{ids['cement']}", "source_date": "2026-10-25"},
            {"type": "labour", "name": "Concrete gang", "qty": 3, "unit": "hr", "rate": 4.04},
            {"type": "equipment", "name": "Mixer", "qty": 0.5, "unit": "hr", "rate": 15},
            {"type": "transport", "name": "Tipper load", "qty": 0.1, "unit": "trip", "rate": 140},
            {"type": "material", "name": "", "qty": 1, "unit": "x", "rate": 1},
            {"type": "invented", "name": "Bad", "qty": 1, "unit": "x", "rate": 1},
        ]
        code = f"WS-CONC-{TAG}"
        body = {"code": code, "name": "Concrete 25MPa (workspace)", "unit": "m3", "currency": "USD", "buildup": buildup}
        r = await client.post(f"{Q}/rate-templates", json=body, headers=estimator["headers"])
        check(r.status_code == 403, f"estimator without quotations.manage_assemblies cannot change the library ({r.status_code})")
        r = await client.post(f"{Q}/rate-templates", json=body, headers=qs["headers"])
        check(r.status_code == 200 and r.json()["data"]["version"] == 1, f"QS saves template v1 ({r.status_code})")
        v1 = r.json()["data"]["id"]
        r = await client.post(f"{Q}/rate-templates", json={**body, "buildup": buildup[:2]}, headers=qs["headers"])
        check(r.status_code == 200 and r.json()["data"]["version"] == 2 and r.json()["data"]["superseded"] == [v1], "re-save creates v2 and retires v1")
        async with AsyncSessionLocal() as db:
            row = (await db.execute(text("SELECT is_deleted, superseded_by, resources, material_recipe, labour_gang, plant_needs, wastage_tolerance_pct FROM finance.construction_assemblies WHERE id = :id"), {"id": v1})).first()
        check(row.is_deleted and str(row.superseded_by) == r.json()["data"]["id"], "v1 kept as history, pointing at v2")
        check(len(row.resources) == 4 and len(row.material_recipe) == 1 and len(row.labour_gang) == 1 and len(row.plant_needs) == 1 and float(row.wastage_tolerance_pct) == 0,
              "v1: invalid resources dropped; legacy recipe filled for material/labour/plant; wastage 0 (already in quantities)")
        check(row.resources[0].get("source_ref") == f"item:{ids['cement']}", "resource source kept on the template")
        r = await client.get(f"{Q}/rate-templates", headers=estimator["headers"])
        tpls = r.json()["data"]
        mine = [t for t in tpls if t["code"] == code]
        check(len(mine) == 1 and mine[0]["version"] == 2 and len(mine[0]["buildup"]) == 2 and mine[0]["origin"] == "workspace", "list shows only the current version")
        defaults = [t for t in tpls if t["origin"] == "default"]
        conc = [t for t in defaults if t["code"] == "CONC-25MPA"]
        check(conc and conc[0]["buildup"][0]["qty"] == round(6.5 * 1.05, 6) and "wastage" in conc[0]["buildup"][0].get("conversion_note", "")
              and "illustrative" in (conc[0]["notes"] or ""),
              "built-in recipe converted (5% wastage folded into qty and noted) and labelled as unsourced")
        r = await client.post(f"{Q}/rate-templates", json={**body, "code": "bad code!"}, headers=qs["headers"])
        check(r.status_code == 400, "invalid template code rejected")
        r = await client.post(f"{Q}/rate-templates", json={**body, "buildup": buildup[4:]}, headers=qs["headers"])
        check(r.status_code == 400, "template with no valid resources rejected")
        r = await client.post(f"{Q}/rate-templates", json={**body, "quotation_id": str(uuid.uuid4())}, headers=qs["headers"])
        check(r.status_code == 404, "source quotation must belong to the org")

        print("\nE. Concurrent saves of one code serialise")
        code2 = f"WS-RACE-{TAG}"
        rs = await asyncio.gather(*[client.post(f"{Q}/rate-templates", json={**body, "code": code2}, headers=qs["headers"]) for _ in range(5)])
        versions = sorted(x.json()["data"]["version"] for x in rs if x.status_code == 200)
        check(versions == [1, 2, 3, 4, 5], f"5 concurrent saves -> versions 1..5 ({versions})")
        async with AsyncSessionLocal() as db:
            live = await scalar(db, "SELECT count(*) FROM finance.construction_assemblies WHERE assembly_code = :c AND is_deleted = false", c=code2)
        check(live == 1, "exactly one current row for the code")
    finally:
        async with AsyncSessionLocal() as db:
            await cleanup(db, ids)
            await db.commit()
        await client.aclose()

    print(f"\n{'ALL PASS' if not FAILURES else f'{len(FAILURES)} FAILURE(S)'}")
    sys.exit(1 if FAILURES else 0)


if __name__ == "__main__":
    with block_outbound():
        asyncio.run(main())
