"""
AEGIS LIVING ASSURANCE LOOP — CYCLE 3 TEST EXECUTION SUITE
Independent Evidence, Edge Cases, Concurrency, and Release-Gate Review

Tests:
- Work Package A: Subcontract Valuation, Concurrency, and Retention Edge Cases (CYC3-CERT-001 to 005)
- Work Package B: Live Commitment Consumption, Evidence Gating, and Over-Invoice Handling (CYC3-COM-001 to 006)
- Work Package C: Complete Multi-Tenant & Role Isolation Route Matrix (CYC3-ISOL-001 to 002)
- Work Package D: Truthful Project Health Governance & Threshold Transparency (CYC3-HLTH-001 to 002)
- Work Package E: Scoped Teardown & Foreign-Key Integrity Verification (CYC3-CLN-001)
"""

import asyncio
from datetime import date, timedelta
from decimal import Decimal
import time
from typing import Dict, Any, List, Optional
from uuid import uuid4

import httpx
import jwt
from sqlalchemy import text
from core.database import AsyncSessionLocal
from core.config import settings
from core.cache import cache_set_json_sync

BASE_URL = "http://127.0.0.1:8000"
TEST_PREFIX = "AEGIS_QA_ECOSYSTEM_CYCLE3_"


class TestResult:
    def __init__(self, test_id: str, package: str, description: str, priority: str = "P0"):
        self.test_id = test_id
        self.package = package
        self.description = description
        self.priority = priority
        self.status = "NOT_RUN"
        self.latency_ms = 0.0
        self.actual_result = ""
        self.metrics = {}


class Cycle3AssuranceRunner:
    def __init__(self):
        self.results: List[TestResult] = []
        self.user_a_token: Optional[str] = None
        self.user_a_id: Optional[str] = None
        self.org_a_id: Optional[str] = None

        self.tenant_b_org_id: Optional[str] = None
        self.tenant_b_user_id: str = str(uuid4())
        self.tenant_b_role_id: str = str(uuid4())
        self.tenant_b_email: Optional[str] = None
        self.user_b_token: Optional[str] = None

        # Test fixtures
        self.project_a_id: Optional[str] = None
        self.site_a_id: Optional[str] = None
        self.subcontractor_id: Optional[str] = None
        self.package_a_id: Optional[str] = None
        self.cert1_id: Optional[str] = None
        self.cert2_id: Optional[str] = None

        self.supplier_id: Optional[str] = None
        self.po_id: Optional[str] = None
        self.grn_id: Optional[str] = None
        self.doc_id: Optional[str] = None
        self.inv1_id: Optional[str] = None
        self.inv2_id: Optional[str] = None
        self.inv3_id: Optional[str] = None

    def add(self, test_id: str, package: str, desc: str, priority: str = "P0") -> TestResult:
        res = TestResult(test_id, package, desc, priority)
        self.results.append(res)
        return res

    async def purge_project(self, db, p_id: str):
        """Purge project and all foreign-key dependent rows in exact dependency order."""
        await db.execute(text("DELETE FROM core.domain_events WHERE project_id=CAST(:p_id AS uuid)"), {"p_id": p_id})
        await db.execute(text("DELETE FROM core.approval_instances WHERE project_id=CAST(:p_id AS uuid)"), {"p_id": p_id})
        await db.execute(text("DELETE FROM core.document_links WHERE project_id=CAST(:p_id AS uuid)"), {"p_id": p_id})
        await db.execute(text("DELETE FROM core.sharepoint_folder_map WHERE project_id=CAST(:p_id AS uuid)"), {"p_id": p_id})
        await db.execute(text("DELETE FROM finance.cost_transactions WHERE project_id=CAST(:p_id AS uuid)"), {"p_id": p_id})
        await db.execute(text("DELETE FROM finance.journal_lines WHERE project_id=CAST(:p_id AS uuid)"), {"p_id": p_id})
        await db.execute(text("DELETE FROM finance.vendor_payment_requests WHERE project_id=CAST(:p_id AS uuid)"), {"p_id": p_id})
        await db.execute(text("DELETE FROM finance.client_payment_requests WHERE project_id=CAST(:p_id AS uuid)"), {"p_id": p_id})
        await db.execute(text("DELETE FROM finance.retention_ledger WHERE project_id=CAST(:p_id AS uuid)"), {"p_id": p_id})
        await db.execute(text("DELETE FROM finance.commitments WHERE project_id=CAST(:p_id AS uuid)"), {"p_id": p_id})
        await db.execute(text("DELETE FROM finance.progress_claims WHERE project_id=CAST(:p_id AS uuid)"), {"p_id": p_id})
        await db.execute(text("DELETE FROM finance.variations WHERE project_id=CAST(:p_id AS uuid)"), {"p_id": p_id})
        await db.execute(text("DELETE FROM finance.project_budgets WHERE project_id=CAST(:p_id AS uuid)"), {"p_id": p_id})
        await db.execute(text("DELETE FROM procurement.supplier_invoice_lines WHERE project_id=CAST(:p_id AS uuid)"), {"p_id": p_id})
        await db.execute(text("DELETE FROM procurement.supplier_invoices WHERE project_id=CAST(:p_id AS uuid)"), {"p_id": p_id})
        await db.execute(text("DELETE FROM procurement.goods_received_notes WHERE project_id=CAST(:p_id AS uuid)"), {"p_id": p_id})
        await db.execute(text("DELETE FROM procurement.purchase_orders WHERE project_id=CAST(:p_id AS uuid)"), {"p_id": p_id})
        await db.execute(text("DELETE FROM procurement.purchase_requisitions WHERE project_id=CAST(:p_id AS uuid)"), {"p_id": p_id})
        await db.execute(text("DELETE FROM procurement.material_requests WHERE project_id=CAST(:p_id AS uuid)"), {"p_id": p_id})
        await db.execute(text("DELETE FROM procurement.stock_ledger WHERE project_id=CAST(:p_id AS uuid)"), {"p_id": p_id})
        await db.execute(text("DELETE FROM procurement.stores WHERE project_id=CAST(:p_id AS uuid)"), {"p_id": p_id})
        await db.execute(text("DELETE FROM projects.daily_site_reports WHERE project_id=CAST(:p_id AS uuid)"), {"p_id": p_id})
        await db.execute(text("DELETE FROM projects.subcontractor_certificates WHERE project_id=CAST(:p_id AS uuid)"), {"p_id": p_id})
        await db.execute(text("DELETE FROM projects.subcontract_packages WHERE project_id=CAST(:p_id AS uuid)"), {"p_id": p_id})
        await db.execute(text("DELETE FROM projects.sites WHERE project_id=CAST(:p_id AS uuid)"), {"p_id": p_id})
        await db.execute(text("DELETE FROM projects.project_profiles WHERE project_id=CAST(:p_id AS uuid)"), {"p_id": p_id})
        await db.execute(text("DELETE FROM projects.projects WHERE id=CAST(:p_id AS uuid)"), {"p_id": p_id})

    async def setup_tenants_and_auth(self):
        print("[SETUP] Authenticating Primary Admin User (Tenant A)...")
        async with httpx.AsyncClient(timeout=30.0) as auth_client:
            auth_resp = await auth_client.post(
                f"{settings.SUPABASE_URL}/auth/v1/token?grant_type=password",
                headers={"apikey": settings.SUPABASE_ANON_KEY, "Content-Type": "application/json"},
                json={"email": "ashton@admin.com", "password": "ashytana"},
            )
            if auth_resp.status_code != 200:
                raise RuntimeError(f"Tenant A Auth failed: HTTP {auth_resp.status_code}")
            auth_data = auth_resp.json()
            self.user_a_token = auth_data["access_token"]
            self.user_a_id = auth_data["user"]["id"]

        async with AsyncSessionLocal() as db:
            row = (await db.execute(text("SELECT organization_id FROM core.users WHERE id = :u_id"), {"u_id": self.user_a_id})).fetchone()
            self.org_a_id = str(row[0]) if row else "00000000-0000-0000-0000-000000000001"

            print(f"[SETUP] Tenant A: Org {self.org_a_id}, User {self.user_a_id}")
            print(f"[SETUP] Purging any lingering synthetic records with prefix '{TEST_PREFIX}'...")

            stale_projs = (await db.execute(
                text("SELECT id FROM projects.projects WHERE name LIKE :pfx OR project_code LIKE 'C3-%'"),
                {"pfx": f"{TEST_PREFIX}%"}
            )).scalars().all()
            for p_id in stale_projs:
                await self.purge_project(db, p_id)

            await db.execute(text("DELETE FROM procurement.suppliers WHERE supplier_name LIKE :pfx"), {"pfx": f"{TEST_PREFIX}%"})
            await db.execute(text("DELETE FROM core.documents WHERE title LIKE :pfx"), {"pfx": f"{TEST_PREFIX}%"})
            await db.execute(text("DELETE FROM core.file_attachments WHERE file_name LIKE :pfx"), {"pfx": f"{TEST_PREFIX}%"})
            await db.commit()

            print(f"[SETUP] Provisioning Isolated Synthetic Tenant B...")

            row_org = (await db.execute(text("SELECT id FROM core.organizations WHERE name = :name"), {"name": f"{TEST_PREFIX}Tenant_B"})).fetchone()
            if row_org:
                self.tenant_b_org_id = str(row_org[0])
                await db.execute(text("UPDATE core.organizations SET is_deleted = false WHERE id = CAST(:id AS uuid)"), {"id": self.tenant_b_org_id})
            else:
                self.tenant_b_org_id = str(uuid4())
                await db.execute(
                    text("""
                    INSERT INTO core.organizations (id, name, is_deleted, created_at, updated_at)
                    VALUES (CAST(:id AS uuid), :name, false, NOW(), NOW())
                    ON CONFLICT (id) DO UPDATE SET is_deleted = false
                    """),
                    {"id": self.tenant_b_org_id, "name": f"{TEST_PREFIX}Tenant_B"},
                )

            await db.execute(text("DELETE FROM core.user_roles WHERE organization_id = CAST(:oid AS uuid)"), {"oid": self.tenant_b_org_id})
            await db.execute(text("DELETE FROM core.roles WHERE organization_id = CAST(:oid AS uuid)"), {"oid": self.tenant_b_org_id})
            await db.execute(text("DELETE FROM core.users WHERE organization_id = CAST(:oid AS uuid)"), {"oid": self.tenant_b_org_id})

            self.tenant_b_email = f"cycle3_tenant_b_{uuid4().hex[:8]}@assurance.aegis"

            await db.execute(
                text("""
                INSERT INTO core.users (id, organization_id, email, full_name, is_active, is_deleted, created_at, updated_at)
                VALUES (CAST(:id AS uuid), CAST(:org_id AS uuid), :email, :name, true, false, NOW(), NOW())
                ON CONFLICT (id) DO NOTHING
                """),
                {
                    "id": self.tenant_b_user_id,
                    "org_id": self.tenant_b_org_id,
                    "email": self.tenant_b_email,
                    "name": "Cycle3 Tenant B Auditor",
                },
            )

            await db.execute(
                text("""
                INSERT INTO core.roles (id, organization_id, name, description, is_deleted, created_at, updated_at)
                VALUES (CAST(:id AS uuid), CAST(:org_id AS uuid), 'SUPERADMIN', 'Tenant B Superadmin', false, NOW(), NOW())
                ON CONFLICT (id) DO NOTHING
                """),
                {"id": self.tenant_b_role_id, "org_id": self.tenant_b_org_id},
            )

            await db.execute(
                text("""
                INSERT INTO core.user_roles (organization_id, user_id, role_id)
                VALUES (CAST(:org_id AS uuid), CAST(:u_id AS uuid), CAST(:r_id AS uuid))
                ON CONFLICT DO NOTHING
                """),
                {
                    "org_id": self.tenant_b_org_id,
                    "u_id": self.tenant_b_user_id,
                    "r_id": self.tenant_b_role_id,
                },
            )

            sub_res = await db.execute(text("SELECT id FROM crm.subcontractors WHERE is_deleted=false LIMIT 1"))
            self.subcontractor_id = str(sub_res.scalar() or "79b10a7a-b717-4d19-b741-664dfe123aba")

            await db.commit()

        payload_b = {
            "sub": self.tenant_b_user_id,
            "email": self.tenant_b_email,
            "app_metadata": {"org_id": self.tenant_b_org_id, "role": "SUPERADMIN"},
            "user_metadata": {"full_name": "Cycle3 Tenant B Auditor"},
            "role": "authenticated",
            "exp": time.time() + 3600,
        }
        self.user_b_token = jwt.encode(payload_b, "cycle3_tenant_b_secret_key_32bytes_long_secret!!", algorithm="HS256")
        import hashlib
        key = hashlib.sha256(self.user_b_token.encode("utf-8")).hexdigest()
        cache_set_json_sync(
            f"auth:token:{key}",
            {
                "id": self.tenant_b_user_id,
                "email": self.tenant_b_email,
                "app_metadata": {"org_id": self.tenant_b_org_id},
                "user_metadata": {"full_name": "Cycle3 Tenant B Auditor"},
            },
            3600,
        )
        print(f"[SETUP] Tenant B token cached in Redis (User: {self.tenant_b_user_id})")

    async def run(self):
        await self.setup_tenants_and_auth()

        async with httpx.AsyncClient(
            base_url=BASE_URL,
            headers={"Authorization": f"Bearer {self.user_a_token}", "Content-Type": "application/json"},
            timeout=45.0,
        ) as client_a, httpx.AsyncClient(
            base_url=BASE_URL,
            headers={"Authorization": f"Bearer {self.user_b_token}", "Content-Type": "application/json"},
            timeout=45.0,
        ) as client_b:

            def _extract_id(resp: httpx.Response) -> Optional[str]:
                try:
                    b = resp.json()
                    if isinstance(b, dict):
                        if "data" in b and isinstance(b["data"], dict) and "id" in b["data"]:
                            return str(b["data"]["id"])
                        if "id" in b:
                            return str(b["id"])
                except Exception:
                    pass
                return None

            suffix = int(time.time()) % 100000

            # Create Baseline Project A
            proj_resp = await client_a.post(
                "/api/v1/projects/",
                json={
                    "name": f"{TEST_PREFIX}Project_{suffix}",
                    "project_code": f"C3-{suffix}",
                    "project_type": "commercial_building",
                    "status": "in progress",
                    "contract_value": 750000.00,
                    "target_margin_pct": 20.0,
                    "start_date": (date.today() - timedelta(days=30)).isoformat(),
                    "planned_completion_date": (date.today() + timedelta(days=150)).isoformat(),
                },
            )
            if proj_resp.status_code != 201:
                raise RuntimeError(f"Project creation failed: HTTP {proj_resp.status_code}: {proj_resp.text}")
            self.project_a_id = _extract_id(proj_resp)

            site_resp = await client_a.post(
                "/api/v1/site-operations/sites",
                json={
                    "project_id": self.project_a_id,
                    "name": f"{TEST_PREFIX}Main_Site_{suffix}",
                    "location_label": "Highlands Corporate Park, Harare",
                    "status": "active",
                },
            )
            if site_resp.status_code == 201:
                self.site_a_id = _extract_id(site_resp)

            # ==================================================================
            # WORK PACKAGE A: CERTIFICATE ACCOUNTING, CONCURRENCY & EDGE CASES
            # ==================================================================

            # --- Test CYC3-CERT-001: Subcontract Package & Certificate 1 Post to Finance ---
            t_cert1 = self.add("CYC3-CERT-001", "Package A (Certificates)", "Post Subcontract Certificate 1: Gross Incurred Cost ($40k) & Retention Held ($4k)", "P0")
            t0 = time.time()
            pkg_resp = await client_a.post(
                f"/api/v1/projects/{self.project_a_id}/subcontracts",
                json={
                    "package_number": f"PKG-C3-{suffix}",
                    "title": f"{TEST_PREFIX}Electrical_Infrastructure",
                    "trade": "Electrical",
                    "subcontractor_id": self.subcontractor_id,
                    "award_value": 300000.00,
                    "retention_percentage": 10.0,
                    "retention_cap": 30000.00,
                    "start_date": date.today().isoformat(),
                    "scope_description": "Medium voltage cabling, transformers, and distribution boards",
                },
            )
            self.package_a_id = _extract_id(pkg_resp)
            if pkg_resp.status_code == 201 and self.package_a_id:
                cert1_resp = await client_a.post(
                    f"/api/v1/projects/{self.project_a_id}/subcontracts/{self.package_a_id}/certificates",
                    json={
                        "certificate_number": f"IPC-C3-001-{suffix}",
                        "valuation_date": date.today().isoformat(),
                        "period_start": (date.today() - timedelta(days=30)).isoformat(),
                        "period_end": date.today().isoformat(),
                        "claimed_amount": 40000.00,
                        "certified_gross_amount": 40000.00,
                        "notes": "First valuation of conduits, cable trays, and main feed",
                    },
                )
                self.cert1_id = _extract_id(cert1_resp)
                if cert1_resp.status_code == 201 and self.cert1_id:
                    post1_resp = await client_a.post(
                        f"/api/v1/projects/{self.project_a_id}/subcontracts/{self.package_a_id}/certificates/{self.cert1_id}/post-to-finance"
                    )
                    t_cert1.latency_ms = round((time.time() - t0) * 1000, 1)

                    if post1_resp.status_code == 200:
                        async with AsyncSessionLocal() as db:
                            cost_row = (await db.execute(
                                text("SELECT amount, cost_category FROM finance.cost_transactions WHERE source_id=CAST(:cid AS uuid) AND source_type='subcontractor_certificate'"),
                                {"cid": self.cert1_id},
                            )).fetchone()
                            ret_row = (await db.execute(
                                text("SELECT amount, movement_type FROM finance.retention_ledger WHERE source_id=CAST(:cid AS uuid)"),
                                {"cid": self.cert1_id},
                            )).fetchone()

                        cost_amt = float(cost_row[0]) if cost_row else None
                        ret_amt = float(ret_row[0]) if ret_row else None
                        t_cert1.metrics = {"cost_transaction_amount": cost_amt, "retention_ledger_amount": ret_amt}

                        if cost_amt == 40000.00 and ret_amt == 4000.00:
                            t_cert1.status = "PASSED"
                            t_cert1.actual_result = f"Gross liability recognized: ${cost_amt:,.2f}; Retention held: ${ret_amt:,.2f} (Accounting Truthful)"
                        else:
                            t_cert1.status = "FAILED"
                            t_cert1.actual_result = f"Accounting discrepancy: Cost=${cost_amt} (exp 40000.0), Ret=${ret_amt} (exp 4000.0)"
                    else:
                        t_cert1.status = "FAILED"
                        t_cert1.actual_result = f"Post to finance failed: HTTP {post1_resp.status_code}: {post1_resp.text}"
                else:
                    t_cert1.status = "FAILED"
                    t_cert1.actual_result = f"Certificate 1 creation failed: HTTP {cert1_resp.status_code}: {cert1_resp.text}"
            else:
                t_cert1.status = "FAILED"
                t_cert1.actual_result = f"Subcontract creation failed: HTTP {pkg_resp.status_code}: {pkg_resp.text}"

            # --- Test CYC3-CERT-002: Concurrent Retries Race Condition Guard (5 parallel posts) ---
            t_conc = self.add("CYC3-CERT-002", "Package A (Certificates)", "Concurrent Retries Guard: 5 parallel posts return HTTP 200 and create exactly 1 ledger row", "P0")
            t0 = time.time()

            async def _post_call():
                return await client_a.post(
                    f"/api/v1/projects/{self.project_a_id}/subcontracts/{self.package_a_id}/certificates/{self.cert1_id}/post-to-finance"
                )

            concurrent_responses = await asyncio.gather(*[_post_call() for _ in range(5)])
            t_conc.latency_ms = round((time.time() - t0) * 1000, 1)

            status_codes = [r.status_code for r in concurrent_responses]
            already_posted_flags = [r.json().get("data", {}).get("already_posted") for r in concurrent_responses if r.status_code == 200]

            async with AsyncSessionLocal() as db:
                count_tx = (await db.execute(
                    text("SELECT COUNT(*) FROM finance.cost_transactions WHERE source_id=CAST(:cid AS uuid)"),
                    {"cid": self.cert1_id},
                )).scalar()
                count_ret = (await db.execute(
                    text("SELECT COUNT(*) FROM finance.retention_ledger WHERE source_id=CAST(:cid AS uuid)"),
                    {"cid": self.cert1_id},
                )).scalar()

            t_conc.metrics = {
                "status_codes": status_codes,
                "already_posted_flags": already_posted_flags,
                "cost_rows": count_tx,
                "retention_rows": count_ret,
            }

            if all(sc == 200 for sc in status_codes) and count_tx == 1 and count_ret == 1:
                t_conc.status = "PASSED"
                t_conc.actual_result = f"Concurrency serialized cleanly: 5/5 HTTP 200, cost_rows={count_tx}, retention_rows={count_ret}"
            else:
                t_conc.status = "FAILED"
                t_conc.actual_result = f"Concurrency failure: codes={status_codes}, cost_rows={count_tx}, retention_rows={count_ret}"

            # --- Test CYC3-CERT-003: Identical Serial Retry ---
            t_ser = self.add("CYC3-CERT-003", "Package A (Certificates)", "Identical Serial Retry: Returns already_posted=True with zero ledger mutation", "P0")
            t0 = time.time()
            ser_resp = await client_a.post(
                f"/api/v1/projects/{self.project_a_id}/subcontracts/{self.package_a_id}/certificates/{self.cert1_id}/post-to-finance"
            )
            t_ser.latency_ms = round((time.time() - t0) * 1000, 1)
            if ser_resp.status_code == 200 and ser_resp.json().get("data", {}).get("already_posted") is True:
                t_ser.status = "PASSED"
                t_ser.actual_result = "Idempotency guaranteed: already_posted=True on serial retry."
            else:
                t_ser.status = "FAILED"
                t_ser.actual_result = f"Serial retry unexpected result: HTTP {ser_resp.status_code}: {ser_resp.text}"

            # --- Test CYC3-CERT-004: Second Cumulative Certificate ($70k cumulative gross) ---
            t_cert2 = self.add("CYC3-CERT-004", "Package A (Certificates)", "Post Certificate 2 ($70k Cumulative): Incremental Gross ($30k) & Cumulative Retention ($7k)", "P0")
            t0 = time.time()
            cert2_resp = await client_a.post(
                f"/api/v1/projects/{self.project_a_id}/subcontracts/{self.package_a_id}/certificates",
                json={
                    "certificate_number": f"IPC-C3-002-{suffix}",
                    "valuation_date": date.today().isoformat(),
                    "period_start": (date.today() - timedelta(days=15)).isoformat(),
                    "period_end": date.today().isoformat(),
                    "claimed_amount": 70000.00,
                    "certified_gross_amount": 70000.00,
                    "notes": "Second valuation for transformers and sub-distribution",
                },
            )
            self.cert2_id = _extract_id(cert2_resp)
            if cert2_resp.status_code == 201 and self.cert2_id:
                post2_resp = await client_a.post(
                    f"/api/v1/projects/{self.project_a_id}/subcontracts/{self.package_a_id}/certificates/{self.cert2_id}/post-to-finance"
                )
                t_cert2.latency_ms = round((time.time() - t0) * 1000, 1)

                if post2_resp.status_code == 200:
                    async with AsyncSessionLocal() as db:
                        cost2_row = (await db.execute(
                            text("SELECT amount FROM finance.cost_transactions WHERE source_id=CAST(:cid AS uuid) AND source_type='subcontractor_certificate'"),
                            {"cid": self.cert2_id},
                        )).fetchone()
                        total_costs = (await db.execute(
                            text("SELECT SUM(amount) FROM finance.cost_transactions WHERE project_id=CAST(:pid AS uuid) AND source_type='subcontractor_certificate'"),
                            {"pid": self.project_a_id},
                        )).scalar()
                        total_retention = (await db.execute(
                            text("SELECT SUM(amount) FROM finance.retention_ledger WHERE project_id=CAST(:pid AS uuid)"),
                            {"pid": self.project_a_id},
                        )).scalar()

                    c2_amt = float(cost2_row[0]) if cost2_row else None
                    tot_c = float(total_costs or 0)
                    tot_r = float(total_retention or 0)

                    t_cert2.metrics = {
                        "incremental_cost_amount": c2_amt,
                        "total_subcontract_cost": tot_c,
                        "total_retention_held": tot_r,
                    }

                    if c2_amt == 30000.00 and tot_c == 70000.00 and tot_r == 7000.00:
                        t_cert2.status = "PASSED"
                        t_cert2.actual_result = f"Incremental Gross: ${c2_amt:,.2f}; Cumulative Package Cost: ${tot_c:,.2f}; Cumulative Retention: ${tot_r:,.2f}"
                    else:
                        t_cert2.status = "FAILED"
                        t_cert2.actual_result = f"Valuation discrepancy: IncCost=${c2_amt} (exp 30k), TotCost=${tot_c} (exp 70k), TotRet=${tot_r} (exp 7k)"
                else:
                    t_cert2.status = "FAILED"
                    t_cert2.actual_result = f"Post 2 failed: HTTP {post2_resp.status_code}: {post2_resp.text}"
            else:
                t_cert2.status = "FAILED"
                t_cert2.actual_result = f"Certificate 2 creation failed: HTTP {cert2_resp.status_code}: {cert2_resp.text}"

            # --- Test CYC3-CERT-005: Cross-Tenant Certificate Post Rejection ---
            t_cross_cert = self.add("CYC3-CERT-005", "Package A (Certificates)", "Cross-Tenant Certificate Post: Tenant B attempting post on Tenant A certificate returns HTTP 404", "P0")
            t0 = time.time()
            cross_resp = await client_b.post(
                f"/api/v1/projects/{self.project_a_id}/subcontracts/{self.package_a_id}/certificates/{self.cert2_id}/post-to-finance"
            )
            t_cross_cert.latency_ms = round((time.time() - t0) * 1000, 1)
            t_cross_cert.metrics = {"status_code": cross_resp.status_code}
            if cross_resp.status_code == 404:
                t_cross_cert.status = "PASSED"
                t_cross_cert.actual_result = "HTTP 404 Not Found: Tenant B cannot post Tenant A certificate to finance."
            else:
                t_cross_cert.status = "FAILED"
                t_cross_cert.actual_result = f"Cross-tenant leak: HTTP {cross_resp.status_code} (expected 404)"

            # ==================================================================
            # WORK PACKAGE B: COMMITMENT & INVOICE LIFECYCLE EDGE CASES
            # ==================================================================

            # --- Test CYC3-COM-001: Issue Purchase Order ($120k) ---
            t_com1 = self.add("CYC3-COM-001", "Package B (Commitments)", "Issue PO ($120k): Creates finance.commitments with $120k committed and $120k outstanding", "P0")
            t0 = time.time()

            async with AsyncSessionLocal() as db:
                sup_row = (await db.execute(
                    text("""
                    INSERT INTO procurement.suppliers (
                        organization_id, supplier_name, tax_number, status, payment_terms_days, is_deleted, created_at, updated_at
                    ) VALUES (
                        CAST(:org_id AS uuid), :name, 'TAX-CYC3-999', 'active', 30, false, NOW(), NOW()
                    ) RETURNING id
                    """),
                    {"org_id": self.org_a_id, "name": f"{TEST_PREFIX}HVAC_Equipment_Supplier"},
                )).first()
                self.supplier_id = str(sup_row.id)

                po_row = (await db.execute(
                    text("""
                    INSERT INTO procurement.purchase_orders (
                        organization_id, po_number, project_id, supplier_id, subtotal, tax_amount, total_amount, status,
                        currency, payment_terms_days, is_deleted, created_by, created_at, updated_at
                    ) VALUES (
                        CAST(:org_id AS uuid), :po_num, CAST(:proj_id AS uuid), CAST(:sup_id AS uuid),
                        120000.00, 0.00, 120000.00, 'approved', 'USD', 30, false, CAST(:user_id AS uuid), NOW(), NOW()
                    ) RETURNING id
                    """),
                    {
                        "org_id": self.org_a_id,
                        "po_num": f"PO-C3-{suffix}",
                        "proj_id": self.project_a_id,
                        "sup_id": self.supplier_id,
                        "user_id": self.user_a_id,
                    },
                )).first()
                self.po_id = str(po_row.id)

                grn_row = (await db.execute(
                    text("""
                    INSERT INTO procurement.goods_received_notes (
                        organization_id, grn_number, po_id, project_id, supplier_id, delivery_date,
                        status, received_by, is_deleted, created_by, created_at, updated_at
                    ) VALUES (
                        CAST(:org_id AS uuid), :grn_num, CAST(:po_id AS uuid), CAST(:proj_id AS uuid), CAST(:sup_id AS uuid),
                        CURRENT_DATE, 'confirmed', CAST(:user_id AS uuid), false, CAST(:user_id AS uuid), NOW(), NOW()
                    ) RETURNING id
                    """),
                    {
                        "org_id": self.org_a_id,
                        "grn_num": f"GRN-C3-{suffix}",
                        "po_id": self.po_id,
                        "proj_id": self.project_a_id,
                        "sup_id": self.supplier_id,
                        "user_id": self.user_a_id,
                    },
                )).first()
                self.grn_id = str(grn_row.id)

                att_row = (await db.execute(
                    text("""
                    INSERT INTO core.file_attachments (
                        organization_id, uploaded_by, file_name, storage_path, mime_type, size_bytes
                    ) VALUES (
                        CAST(:org_id AS uuid), CAST(:user_id AS uuid), :fname, '/storage/cycle3_evidence.pdf', 'application/pdf', 10240
                    ) RETURNING id
                    """),
                    {
                        "org_id": self.org_a_id,
                        "user_id": self.user_a_id,
                        "fname": f"{TEST_PREFIX}evidence.pdf",
                    },
                )).first()
                self.att_id = str(att_row.id)

                doc_row = (await db.execute(
                    text("""
                    INSERT INTO core.documents (
                        organization_id, created_by, title, file_attachment_id, category, file_size_bytes, file_name,
                        is_deleted, created_at, updated_at
                    ) VALUES (
                        CAST(:org_id AS uuid), CAST(:user_id AS uuid), :title, CAST(:att_id AS uuid), 'evidence', 10240, :fname,
                        false, NOW(), NOW()
                    ) RETURNING id
                    """),
                    {
                        "org_id": self.org_a_id,
                        "user_id": self.user_a_id,
                        "title": f"{TEST_PREFIX}Evidence_Doc",
                        "att_id": self.att_id,
                        "fname": f"{TEST_PREFIX}evidence.pdf",
                    },
                )).first()
                self.doc_id = str(doc_row.id)
                await db.commit()

            po_issue_resp = await client_a.post(f"/api/v1/procurement/purchase-orders/{self.po_id}/issue", json={})
            t_com1.latency_ms = round((time.time() - t0) * 1000, 1)

            if po_issue_resp.status_code == 200:
                async with AsyncSessionLocal() as db:
                    comm_row = (await db.execute(
                        text("""
                        SELECT committed_amount, invoiced_amount, outstanding_amount, status
                        FROM finance.commitments
                        WHERE organization_id=CAST(:org_id AS uuid) AND source_type='purchase_order' AND source_id=CAST(:po_id AS uuid)
                        """),
                        {"org_id": self.org_a_id, "po_id": self.po_id},
                    )).mappings().first()

                committed = float(comm_row["committed_amount"]) if comm_row else 0.0
                invoiced = float(comm_row["invoiced_amount"]) if comm_row else 0.0
                outstanding = float(comm_row["outstanding_amount"]) if comm_row else 0.0
                status = comm_row["status"] if comm_row else None

                t_com1.metrics = {
                    "committed_amount": committed,
                    "invoiced_amount": invoiced,
                    "outstanding_amount": outstanding,
                    "status": status,
                }

                if committed == 120000.00 and outstanding == 120000.00 and status == "active":
                    t_com1.status = "PASSED"
                    t_com1.actual_result = f"Commitment created: Committed=${committed:,.2f}, Outstanding=${outstanding:,.2f}, Status='{status}'"
                else:
                    t_com1.status = "FAILED"
                    t_com1.actual_result = f"Commitment verification failed: Committed={committed}, Outstanding={outstanding}, Status={status}"
            else:
                t_com1.status = "FAILED"
                t_com1.actual_result = f"PO Issue failed: HTTP {po_issue_resp.status_code}: {po_issue_resp.text}"

            # --- Test CYC3-COM-002: 3-Way Match Evidence Gate Rejection ---
            t_com2 = self.add("CYC3-COM-002", "Package B (Commitments)", "Evidence Gating: Payment decision without document evidence rejected with HTTP 409", "P0")
            t0 = time.time()

            async with AsyncSessionLocal() as db:
                inv_row1 = (await db.execute(
                    text("""
                    INSERT INTO procurement.supplier_invoices (
                        organization_id, invoice_number, supplier_invoice_ref, supplier_id, po_id, grn_id, project_id,
                        invoice_date, due_date, subtotal, tax_amount, total_amount, match_status, status,
                        is_deleted, created_by, created_at, updated_at
                    ) VALUES (
                        CAST(:org_id AS uuid), :inv_num, :ref, CAST(:sup_id AS uuid), CAST(:po_id AS uuid), CAST(:grn_id AS uuid), CAST(:proj_id AS uuid),
                        CURRENT_DATE, CURRENT_DATE + 30, 40000.00, 0.00, 40000.00, 'matched', 'matched',
                        false, CAST(:user_id AS uuid), NOW(), NOW()
                    ) RETURNING id
                    """),
                    {
                        "org_id": self.org_a_id,
                        "inv_num": f"INV-C3-001-{suffix}",
                        "ref": f"REF-C3-001-{suffix}",
                        "sup_id": self.supplier_id,
                        "po_id": self.po_id,
                        "grn_id": self.grn_id,
                        "proj_id": self.project_a_id,
                        "user_id": self.user_a_id,
                    },
                )).first()
                self.inv1_id = str(inv_row1.id)
                await db.commit()

            # Attempt payment approval without document links
            ungated_resp = await client_a.post(
                f"/api/v1/procurement/invoices/{self.inv1_id}/payment-decision",
                json={"decision": "approved", "approval_document_id": self.doc_id},
            )
            t_com2.latency_ms = round((time.time() - t0) * 1000, 1)
            t_com2.metrics = {"status_code": ungated_resp.status_code, "detail": ungated_resp.text}

            if ungated_resp.status_code == 409 and "evidence" in ungated_resp.text.lower():
                t_com2.status = "PASSED"
                t_com2.actual_result = "HTTP 409 Conflict: Payment approval blocked due to missing 3-way match document evidence."
            else:
                t_com2.status = "FAILED"
                t_com2.actual_result = f"Gating bypass error: HTTP {ungated_resp.status_code}: {ungated_resp.text}"

            # --- Test CYC3-COM-003: Partial Invoice 1 Approval ($40k) ---
            t_com3 = self.add("CYC3-COM-003", "Package B (Commitments)", "Approve Partial Invoice 1 ($40k): Decrements commitment to $80k (status='partially_invoiced')", "P0")
            t0 = time.time()

            # Seed required document links for 3-way match
            async with AsyncSessionLocal() as db:
                for ent_type, ent_id, role in [
                    ("purchase_order", self.po_id, "evidence"),
                    ("goods_received_note", self.grn_id, "evidence"),
                    ("supplier_invoice", self.inv1_id, "evidence"),
                ]:
                    await db.execute(
                        text("""
                        INSERT INTO core.document_links (
                            organization_id, document_id, entity_type, entity_id, link_role, project_id, linked_by, linked_at
                        ) VALUES (
                            CAST(:org_id AS uuid), CAST(:doc_id AS uuid), :ent_type, CAST(:ent_id AS uuid), :role, CAST(:proj_id AS uuid), CAST(:user_id AS uuid), NOW()
                        )
                        """),
                        {
                            "org_id": self.org_a_id,
                            "doc_id": self.doc_id,
                            "ent_type": ent_type,
                            "ent_id": ent_id,
                            "role": role,
                            "proj_id": self.project_a_id,
                            "user_id": self.user_a_id,
                        },
                    )
                await db.commit()

            pay1_resp = await client_a.post(
                f"/api/v1/procurement/invoices/{self.inv1_id}/payment-decision",
                json={"decision": "approved", "approval_document_id": self.doc_id},
            )
            t_com3.latency_ms = round((time.time() - t0) * 1000, 1)

            if pay1_resp.status_code == 200:
                async with AsyncSessionLocal() as db:
                    comm1 = (await db.execute(
                        text("""
                        SELECT committed_amount, invoiced_amount, outstanding_amount, status
                        FROM finance.commitments
                        WHERE organization_id=CAST(:org_id AS uuid) AND source_type='purchase_order' AND source_id=CAST(:po_id AS uuid)
                        """),
                        {"org_id": self.org_a_id, "po_id": self.po_id},
                    )).mappings().first()

                inv1 = float(comm1["invoiced_amount"])
                out1 = float(comm1["outstanding_amount"])
                st1 = comm1["status"]

                t_com3.metrics = {"invoiced_amount": inv1, "outstanding_amount": out1, "status": st1}

                if inv1 == 40000.00 and out1 == 80000.00 and st1 == "partially_invoiced":
                    t_com3.status = "PASSED"
                    t_com3.actual_result = f"Commitment consumed: Invoiced=${inv1:,.2f}, Outstanding=${out1:,.2f}, Status='{st1}'"
                else:
                    t_com3.status = "FAILED"
                    t_com3.actual_result = f"Consumption error: Invoiced=${inv1} (exp 40k), Outstanding=${out1} (exp 80k), Status='{st1}'"
            else:
                t_com3.status = "FAILED"
                t_com3.actual_result = f"Payment decision 1 failed: HTTP {pay1_resp.status_code}: {pay1_resp.text}"

            # --- Test CYC3-COM-004: Duplicate Payment Decision Idempotency Guard ---
            t_com4 = self.add("CYC3-COM-004", "Package B (Commitments)", "Idempotency Guard: Re-approving Invoice 1 returns already_approved=True without double-decrementing", "P0")
            t0 = time.time()
            repay_resp = await client_a.post(
                f"/api/v1/procurement/invoices/{self.inv1_id}/payment-decision",
                json={"decision": "approved", "approval_document_id": self.doc_id},
            )
            t_com4.latency_ms = round((time.time() - t0) * 1000, 1)

            async with AsyncSessionLocal() as db:
                comm_re = (await db.execute(
                    text("""
                    SELECT committed_amount, invoiced_amount, outstanding_amount, status
                    FROM finance.commitments
                    WHERE organization_id=CAST(:org_id AS uuid) AND source_type='purchase_order' AND source_id=CAST(:po_id AS uuid)
                    """),
                    {"org_id": self.org_a_id, "po_id": self.po_id},
                )).mappings().first()

            inv_re = float(comm_re["invoiced_amount"])
            out_re = float(comm_re["outstanding_amount"])
            is_already = repay_resp.json().get("already_approved", False)

            t_com4.metrics = {"already_approved": is_already, "invoiced_amount": inv_re, "outstanding_amount": out_re}

            if repay_resp.status_code == 200 and is_already is True and inv_re == 40000.00 and out_re == 80000.00:
                t_com4.status = "PASSED"
                t_com4.actual_result = f"Idempotency verified: already_approved=True, Invoiced remains ${inv_re:,.2f}, Outstanding remains ${out_re:,.2f}"
            else:
                t_com4.status = "FAILED"
                t_com4.actual_result = f"Idempotency violated: code={repay_resp.status_code}, already_approved={is_already}, Invoiced={inv_re}, Outstanding={out_re}"

            # --- Test CYC3-COM-005: Rejected Invoice Leaves Commitment Intact ---
            t_com5 = self.add("CYC3-COM-005", "Package B (Commitments)", "Rejected Invoice Isolation: Rejecting Invoice 2 leaves commitment outstanding unchanged at $80k", "P0")
            t0 = time.time()

            async with AsyncSessionLocal() as db:
                inv_row2 = (await db.execute(
                    text("""
                    INSERT INTO procurement.supplier_invoices (
                        organization_id, invoice_number, supplier_invoice_ref, supplier_id, po_id, grn_id, project_id,
                        invoice_date, due_date, subtotal, tax_amount, total_amount, match_status, status,
                        is_deleted, created_by, created_at, updated_at
                    ) VALUES (
                        CAST(:org_id AS uuid), :inv_num, :ref, CAST(:sup_id AS uuid), CAST(:po_id AS uuid), CAST(:grn_id AS uuid), CAST(:proj_id AS uuid),
                        CURRENT_DATE, CURRENT_DATE + 30, 30000.00, 0.00, 30000.00, 'matched', 'matched',
                        false, CAST(:user_id AS uuid), NOW(), NOW()
                    ) RETURNING id
                    """),
                    {
                        "org_id": self.org_a_id,
                        "inv_num": f"INV-C3-002-{suffix}",
                        "ref": f"REF-C3-002-{suffix}",
                        "sup_id": self.supplier_id,
                        "po_id": self.po_id,
                        "grn_id": self.grn_id,
                        "proj_id": self.project_a_id,
                        "user_id": self.user_a_id,
                    },
                )).first()
                self.inv2_id = str(inv_row2.id)

                await db.execute(
                    text("""
                    INSERT INTO core.document_links (
                        organization_id, document_id, entity_type, entity_id, link_role, project_id, linked_by, linked_at
                    ) VALUES (
                        CAST(:org_id AS uuid), CAST(:doc_id AS uuid), 'supplier_invoice', CAST(:ent_id AS uuid), 'evidence', CAST(:proj_id AS uuid), CAST(:user_id AS uuid), NOW()
                    )
                    """),
                    {"org_id": self.org_a_id, "doc_id": self.doc_id, "ent_id": self.inv2_id, "proj_id": self.project_a_id, "user_id": self.user_a_id},
                )
                await db.commit()

            rej_resp = await client_a.post(
                f"/api/v1/procurement/invoices/{self.inv2_id}/payment-decision",
                json={"decision": "rejected", "reason": "Incorrect unit pricing on item 3"},
            )
            t_com5.latency_ms = round((time.time() - t0) * 1000, 1)

            async with AsyncSessionLocal() as db:
                comm_rej = (await db.execute(
                    text("""
                    SELECT committed_amount, invoiced_amount, outstanding_amount, status
                    FROM finance.commitments
                    WHERE organization_id=CAST(:org_id AS uuid) AND source_type='purchase_order' AND source_id=CAST(:po_id AS uuid)
                    """),
                    {"org_id": self.org_a_id, "po_id": self.po_id},
                )).mappings().first()

            inv_rej = float(comm_rej["invoiced_amount"])
            out_rej = float(comm_rej["outstanding_amount"])
            st_rej = comm_rej["status"]

            t_com5.metrics = {"invoiced_amount": inv_rej, "outstanding_amount": out_rej, "status": st_rej}

            if rej_resp.status_code == 200 and inv_rej == 40000.00 and out_rej == 80000.00 and st_rej == "partially_invoiced":
                t_com5.status = "PASSED"
                t_com5.actual_result = f"Rejection isolated: Invoiced remains ${inv_rej:,.2f}, Outstanding remains ${out_rej:,.2f}"
            else:
                t_com5.status = "FAILED"
                t_com5.actual_result = f"Rejection side effect: code={rej_resp.status_code}, Invoiced={inv_rej}, Outstanding={out_rej}"

            # --- Test CYC3-COM-006: Final Fulfillment & Over-Invoice Handling ($85k against $80k open) ---
            t_com6 = self.add("CYC3-COM-006", "Package B (Commitments)", "Over-Invoice Cap: Invoice 3 ($85k) caps invoiced at $120k with status='fully_invoiced' and $0 outstanding", "P0")
            t0 = time.time()

            async with AsyncSessionLocal() as db:
                inv_row3 = (await db.execute(
                    text("""
                    INSERT INTO procurement.supplier_invoices (
                        organization_id, invoice_number, supplier_invoice_ref, supplier_id, po_id, grn_id, project_id,
                        invoice_date, due_date, subtotal, tax_amount, total_amount, match_status, status,
                        is_deleted, created_by, created_at, updated_at
                    ) VALUES (
                        CAST(:org_id AS uuid), :inv_num, :ref, CAST(:sup_id AS uuid), CAST(:po_id AS uuid), CAST(:grn_id AS uuid), CAST(:proj_id AS uuid),
                        CURRENT_DATE, CURRENT_DATE + 30, 85000.00, 0.00, 85000.00, 'matched', 'matched',
                        false, CAST(:user_id AS uuid), NOW(), NOW()
                    ) RETURNING id
                    """),
                    {
                        "org_id": self.org_a_id,
                        "inv_num": f"INV-C3-003-{suffix}",
                        "ref": f"REF-C3-003-{suffix}",
                        "sup_id": self.supplier_id,
                        "po_id": self.po_id,
                        "grn_id": self.grn_id,
                        "proj_id": self.project_a_id,
                        "user_id": self.user_a_id,
                    },
                )).first()
                self.inv3_id = str(inv_row3.id)

                await db.execute(
                    text("""
                    INSERT INTO core.document_links (
                        organization_id, document_id, entity_type, entity_id, link_role, project_id, linked_by, linked_at
                    ) VALUES (
                        CAST(:org_id AS uuid), CAST(:doc_id AS uuid), 'supplier_invoice', CAST(:ent_id AS uuid), 'evidence', CAST(:proj_id AS uuid), CAST(:user_id AS uuid), NOW()
                    )
                    """),
                    {"org_id": self.org_a_id, "doc_id": self.doc_id, "ent_id": self.inv3_id, "proj_id": self.project_a_id, "user_id": self.user_a_id},
                )
                await db.commit()

            pay3_resp = await client_a.post(
                f"/api/v1/procurement/invoices/{self.inv3_id}/payment-decision",
                json={"decision": "approved", "approval_document_id": self.doc_id},
            )
            t_com6.latency_ms = round((time.time() - t0) * 1000, 1)

            async with AsyncSessionLocal() as db:
                comm_final = (await db.execute(
                    text("""
                    SELECT committed_amount, invoiced_amount, outstanding_amount, status
                    FROM finance.commitments
                    WHERE organization_id=CAST(:org_id AS uuid) AND source_type='purchase_order' AND source_id=CAST(:po_id AS uuid)
                    """),
                    {"org_id": self.org_a_id, "po_id": self.po_id},
                )).mappings().first()

            inv_fin = float(comm_final["invoiced_amount"])
            out_fin = float(comm_final["outstanding_amount"])
            st_fin = comm_final["status"]

            t_com6.metrics = {
                "invoiced_amount": inv_fin,
                "outstanding_amount": out_fin,
                "status": st_fin,
            }

            if pay3_resp.status_code == 200 and inv_fin == 120000.00 and out_fin == 0.00 and st_fin == "fully_invoiced":
                t_com6.status = "PASSED"
                t_com6.actual_result = f"Commitment fully fulfilled: Invoiced=${inv_fin:,.2f}, Outstanding=${out_fin:,.2f}, Status='{st_fin}'"
            else:
                t_com6.status = "FAILED"
                t_com6.actual_result = f"Fulfillment error: code={pay3_resp.status_code}, Invoiced=${inv_fin} (exp 120k), Outstanding=${out_fin} (exp 0), Status='{st_fin}'"

            # ==================================================================
            # WORK PACKAGE C: TENANT & ROLE ISOLATION ROUTE MATRIX
            # ==================================================================

            # --- Test CYC3-ISOL-001: 10 Project Child Read Routes Under Tenant B ---
            t_iso1 = self.add("CYC3-ISOL-001", "Package C (Isolation)", "Route Read Matrix: 10 Tenant A child routes probed by Tenant B return HTTP 404 (Zero Leakage)", "P0")
            t0 = time.time()
            routes_to_probe = [
                f"/api/v1/projects/{self.project_a_id}",
                f"/api/v1/projects/{self.project_a_id}/leadership-dossier",
                f"/api/v1/projects/{self.project_a_id}/progress-pack",
                f"/api/v1/projects/{self.project_a_id}/evm-analytics",
                f"/api/v1/projects/{self.project_a_id}/plant/analytics",
                f"/api/v1/projects/{self.project_a_id}/drawings",
                f"/api/v1/projects/{self.project_a_id}/delays",
                f"/api/v1/projects/{self.project_a_id}/pour-cards",
                f"/api/v1/projects/{self.project_a_id}/subcontracts",
                f"/api/v1/projects/{self.project_a_id}/budget/category-summary",
            ]
            probe_results = {}
            for r_url in routes_to_probe:
                res = await client_b.get(r_url)
                route_key = r_url.replace(self.project_a_id, "{id}")
                probe_results[route_key] = res.status_code

            t_iso1.latency_ms = round((time.time() - t0) * 1000, 1)
            t_iso1.metrics = probe_results

            if all(sc == 404 for sc in probe_results.values()):
                t_iso1.status = "PASSED"
                t_iso1.actual_result = f"10/10 routes returned HTTP 404: Complete tenant read isolation."
            else:
                t_iso1.status = "FAILED"
                t_iso1.actual_result = f"Isolation leak detected: {probe_results}"

            # --- Test CYC3-ISOL-002: 5 Mutation Endpoints Probed by Tenant B ---
            t_iso2 = self.add("CYC3-ISOL-002", "Package C (Isolation)", "Route Write Matrix: 5 mutation endpoints probed by Tenant B return HTTP 404 (Zero Mutation)", "P0")
            t0 = time.time()
            mutations = {
                "post_subcontract": (await client_b.post(
                    f"/api/v1/projects/{self.project_a_id}/subcontracts",
                    json={
                        "package_number": "SUB-HACK",
                        "title": "Hacked Subcontract",
                        "subcontractor_id": self.supplier_id,
                        "trade": "Electrical",
                        "award_value": 10000.00,
                    }
                )).status_code,
                "post_delay": (await client_b.post(
                    f"/api/v1/projects/{self.project_a_id}/delays",
                    json={
                        "event_number": "DEL-HACK-01",
                        "title": "Hacked Delay",
                        "cause_category": "access_delay",
                        "event_occurred_date": date.today().isoformat(),
                    }
                )).status_code,
                "post_drawing": (await client_b.post(
                    f"/api/v1/projects/{self.project_a_id}/drawings",
                    json={
                        "drawing_number": "HACK-01",
                        "title": "Hacked Drawing",
                        "discipline": "structural",
                    }
                )).status_code,
                "post_pour": (await client_b.post(
                    f"/api/v1/projects/{self.project_a_id}/pour-cards",
                    json={
                        "pour_number": "PC-HACK-01",
                        "element_name": "Slab Hack",
                        "concrete_grade": "C30",
                        "design_volume_m3": 10.0,
                    }
                )).status_code,
                "delete_project": (await client_b.delete(f"/api/v1/projects/{self.project_a_id}")).status_code,
            }
            t_iso2.latency_ms = round((time.time() - t0) * 1000, 1)
            t_iso2.metrics = mutations

            if all(sc == 404 for sc in mutations.values()):
                t_iso2.status = "PASSED"
                t_iso2.actual_result = f"5/5 mutation routes returned HTTP 404: Complete tenant mutation isolation."
            else:
                t_iso2.status = "FAILED"
                t_iso2.actual_result = f"Unauthorized mutation breach: {mutations}"

            # ==================================================================
            # WORK PACKAGE D: DYNAMIC PROJECT HEALTH GOVERNANCE
            # ==================================================================

            # --- Test CYC3-HLTH-001: Project Health Truthfulness on Inactive Site ---
            t_hlth1 = self.add("CYC3-HLTH-001", "Package D (Health)", "Dynamic Health Evaluator: Project with elapsed calendar days & 0 daily reports flags critical (no on_track fallback)", "P1")
            t0 = time.time()
            dossier_resp = await client_a.get(f"/api/v1/projects/{self.project_a_id}/leadership-dossier")
            t_hlth1.latency_ms = round((time.time() - t0) * 1000, 1)

            if dossier_resp.status_code == 200:
                dossier = dossier_resp.json().get("data", {})
                evaluated_health = dossier.get("project", {}).get("health_status")
                disp_score = dossier.get("discipline_score")
                t_hlth1.metrics = {
                    "health_status": evaluated_health,
                    "discipline_score": disp_score,
                    "reporting_compliance_pct": dossier.get("engineer", {}).get("reporting_compliance_pct"),
                }
                if evaluated_health in ("at_risk", "critical"):
                    t_hlth1.status = "PASSED"
                    t_hlth1.actual_result = f"Truthful dynamic evaluation: health_status='{evaluated_health}' (discipline score {disp_score}, 0 false passes)"
                else:
                    t_hlth1.status = "FAILED"
                    t_hlth1.actual_result = f"Health defaulted to '{evaluated_health}', masking absence of daily reporting!"
            else:
                t_hlth1.status = "FAILED"
                t_hlth1.actual_result = f"Dossier fetch failed: HTTP {dossier_resp.status_code}"

            # --- Test CYC3-HLTH-002: Project Health Critical Escalation on Active Delays ---
            t_hlth2 = self.add("CYC3-HLTH-002", "Package D (Health)", "Dynamic Health Evaluator: Project with >= 3 active delays escalates to 'critical'", "P1")
            t0 = time.time()
            async with AsyncSessionLocal() as db:
                for d_idx in range(1, 4):
                    report_d = date.today() - timedelta(days=d_idx)
                    await db.execute(
                        text("""
                        INSERT INTO projects.daily_site_reports (
                            organization_id, project_id, report_date, shift, status, delays, is_deleted, created_at, updated_at
                        ) VALUES (
                            CAST(:org_id AS uuid), CAST(:proj_id AS uuid), :report_d, 'day', 'approved', 'Severe access delay due to municipal grid failure', false, NOW(), NOW()
                        )
                        """),
                        {"org_id": self.org_a_id, "proj_id": self.project_a_id, "report_d": report_d},
                    )
                await db.commit()

            dossier_crit_resp = await client_a.get(f"/api/v1/projects/{self.project_a_id}/leadership-dossier")
            t_hlth2.latency_ms = round((time.time() - t0) * 1000, 1)

            if dossier_crit_resp.status_code == 200:
                crit_dossier = dossier_crit_resp.json().get("data", {})
                crit_health = crit_dossier.get("project", {}).get("health_status")
                crit_delays = crit_dossier.get("engineer", {}).get("reports_with_delays")
                t_hlth2.metrics = {"health_status": crit_health, "reports_with_delays": crit_delays}

                if crit_health == "critical" and crit_delays >= 3:
                    t_hlth2.status = "PASSED"
                    t_hlth2.actual_result = f"Escalated to '{crit_health}' with {crit_delays} active delay reports."
                else:
                    t_hlth2.status = "FAILED"
                    t_hlth2.actual_result = f"Critical escalation failed: health='{crit_health}', delays={crit_delays}"
            else:
                t_hlth2.status = "FAILED"
                t_hlth2.actual_result = f"Dossier fetch failed: HTTP {dossier_crit_resp.status_code}"

            # ==================================================================
            # WORK PACKAGE E: DETERMINISTIC SCOPED TEARDOWN & CLEANUP
            # ==================================================================
            t_cln = self.add("CYC3-CLN-001", "Package E (Cleanup)", "Scoped Teardown: Purge all synthetic records by exact ID and verify 0 residual records", "P2")
            t0 = time.time()
            async with AsyncSessionLocal() as db:
                if self.project_a_id:
                    await self.purge_project(db, self.project_a_id)
                if self.supplier_id:
                    await db.execute(text("DELETE FROM procurement.suppliers WHERE id=CAST(:sid AS uuid)"), {"sid": self.supplier_id})
                if self.doc_id:
                    await db.execute(text("DELETE FROM core.documents WHERE id=CAST(:did AS uuid)"), {"did": self.doc_id})
                await db.execute(text("DELETE FROM core.file_attachments WHERE file_name LIKE :pfx"), {"pfx": f"{TEST_PREFIX}%"})

                # Tenant B cleanup
                await db.execute(text("DELETE FROM core.user_roles WHERE user_id=CAST(:uid AS uuid)"), {"uid": self.tenant_b_user_id})
                await db.execute(text("DELETE FROM core.roles WHERE organization_id=CAST(:oid AS uuid)"), {"oid": self.tenant_b_org_id})
                await db.execute(text("DELETE FROM core.users WHERE id=CAST(:uid AS uuid)"), {"uid": self.tenant_b_user_id})
                await db.execute(text("UPDATE core.organizations SET is_deleted=true WHERE id=CAST(:oid AS uuid)"), {"oid": self.tenant_b_org_id})

                # Residual check
                rem_projs = (await db.execute(text("SELECT COUNT(*) FROM projects.projects WHERE name LIKE :pfx"), {"pfx": f"{TEST_PREFIX}%"})).scalar()
                rem_commitments = (await db.execute(text("SELECT COUNT(*) FROM finance.commitments WHERE source_id=CAST(:poid AS uuid)"), {"poid": self.po_id})).scalar() if self.po_id else 0
                rem_invoices = (await db.execute(text("SELECT COUNT(*) FROM procurement.supplier_invoices WHERE invoice_number LIKE :pfx"), {"pfx": f"%C3-%{suffix}"})).scalar()

                await db.commit()

            t_cln.latency_ms = round((time.time() - t0) * 1000, 1)
            t_cln.metrics = {
                "remaining_projects": rem_projs,
                "remaining_commitments": rem_commitments,
                "remaining_invoices": rem_invoices,
            }

            if rem_projs == 0 and rem_commitments == 0 and rem_invoices == 0:
                t_cln.status = "PASSED"
                t_cln.actual_result = "Complete deterministic cleanup: 0 orphaned projects, commitments, or invoices remaining."
            else:
                t_cln.status = "FAILED"
                t_cln.actual_result = f"Cleanup failure: projs={rem_projs}, comms={rem_commitments}, invs={rem_invoices}"

        self.print_summary()
        return self

    def print_summary(self):
        print("\n" + "=" * 80)
        print(" AEGIS LIVING ASSURANCE LOOP — CYCLE 3 VERIFICATION REPORT")
        print("=" * 80)
        for r in self.results:
            tag = f"[{'PASS' if r.status == 'PASSED' else 'FAIL'}]"
            print(f"{tag} {r.test_id} ({r.priority}) [{r.package}] {r.description}")
            print(f"       Result:  {r.actual_result}")
            if r.latency_ms > 0:
                print(f"       Latency: {r.latency_ms}ms")
            if r.metrics:
                import json
                print(f"       Metrics: {json.dumps(r.metrics)}")

        total = len(self.results)
        passed = sum(1 for r in self.results if r.status == "PASSED")
        failed = sum(1 for r in self.results if r.status == "FAILED")
        blocked = sum(1 for r in self.results if r.status == "BLOCKED")
        pass_rate = (passed / max(total, 1)) * 100

        print("-" * 80)
        print(f" TOTAL PLANNED: {total}")
        print(f" EXECUTED:      {total}")
        print(f" PASSED:        {passed}")
        print(f" FAILED:        {failed}")
        print(f" BLOCKED:       {blocked}")
        print(f" PASS RATE:     {pass_rate:.1f}%")
        print("=" * 80 + "\n")


if __name__ == "__main__":
    runner = Cycle3AssuranceRunner()
    asyncio.run(runner.run())
