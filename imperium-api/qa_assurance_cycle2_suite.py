"""
AEGIS LIVING ASSURANCE LOOP — CYCLE 2 COMPREHENSIVE VERIFICATION SUITE
Package A: Certificate Accounting & Project Health Truthfulness
Package B: Multi-Tenant & RBAC Isolation Verification
Package C: Commitment Consumption via Live Supplier Invoice Workflow
"""

import os
os.environ["OPENBLAS_NUM_THREADS"] = "1"

import time
import json
import asyncio
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Dict, Any, List, Optional
from uuid import uuid4

import httpx
import jwt
from sqlalchemy import text
from core.database import AsyncSessionLocal
from core.config import settings
from core.cache import cache_set_json_sync

BASE_URL = "http://127.0.0.1:8000"
TEST_PREFIX = "AEGIS_QA_ECOSYSTEM_CYCLE2_"


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


class Cycle2AssuranceRunner:
    def __init__(self):
        self.results: List[TestResult] = []
        self.user_a_token: Optional[str] = None
        self.user_a_id: Optional[str] = None
        self.org_a_id: Optional[str] = None

        self.tenant_b_org_id = str(uuid4())
        self.tenant_b_user_id = str(uuid4())
        self.tenant_b_role_id = str(uuid4())
        self.user_b_token: Optional[str] = None
        self.subcontractor_id: Optional[str] = None

        # Shared test fixtures for cleanup
        self.project_a_id: Optional[str] = None
        self.site_a_id: Optional[str] = None
        self.package_a_id: Optional[str] = None
        self.cert1_id: Optional[str] = None
        self.cert2_id: Optional[str] = None
        self.supplier_id: Optional[str] = None
        self.po_id: Optional[str] = None
        self.grn_id: Optional[str] = None
        self.inv1_id: Optional[str] = None
        self.inv2_id: Optional[str] = None
        self.doc_id: Optional[str] = None

    def add(self, test_id: str, package: str, description: str, priority: str = "P0") -> TestResult:
        res = TestResult(test_id, package, description, priority)
        self.results.append(res)
        return res

    def print_summary(self):
        print("\n" + "=" * 80)
        print(" AEGIS LIVING ASSURANCE LOOP — CYCLE 2 VERIFICATION REPORT")
        print("=" * 80)
        passed = sum(1 for r in self.results if r.status == "PASSED")
        failed = sum(1 for r in self.results if r.status == "FAILED")
        blocked = sum(1 for r in self.results if r.status == "BLOCKED")
        total = len(self.results)
        executed = passed + failed
        rate = round((passed / executed) * 100, 1) if executed > 0 else 0.0

        for r in self.results:
            icon = "PASS" if r.status == "PASSED" else ("FAIL" if r.status == "FAILED" else "BLOK")
            print(f"[{icon}] {r.test_id} ({r.priority}) [{r.package}] {r.description}")
            print(f"       Result:  {r.actual_result}")
            if r.latency_ms > 0:
                print(f"       Latency: {r.latency_ms}ms")
            if r.metrics:
                print(f"       Metrics: {json.dumps(r.metrics)}")

        print("-" * 80)
        print(f" TOTAL PLANNED: {total}")
        print(f" EXECUTED:      {executed}")
        print(f" PASSED:        {passed}")
        print(f" FAILED:        {failed}")
        print(f" BLOCKED:       {blocked}")
        print(f" PASS RATE:     {rate}%")
        print("=" * 80 + "\n")

    async def purge_project(self, db, p_id: str):
        if not p_id:
            return
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
                text("SELECT id FROM projects.projects WHERE name LIKE :pfx OR project_code LIKE 'C2-%'"),
                {"pfx": f"{TEST_PREFIX}%"}
            )).scalars().all()
            for p_id in stale_projs:
                await self.purge_project(db, p_id)

            await db.execute(text("DELETE FROM procurement.suppliers WHERE supplier_name LIKE :pfx"), {"pfx": f"{TEST_PREFIX}%"})
            await db.execute(text("DELETE FROM core.documents WHERE title LIKE :pfx"), {"pfx": f"{TEST_PREFIX}%"})
            await db.commit()

            print(f"[SETUP] Provisioning Isolated Synthetic Tenant B...")

            # Find or insert Tenant B Org safely
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

            # Clean up any leftover users and roles for this test org
            await db.execute(text("DELETE FROM core.user_roles WHERE organization_id = CAST(:oid AS uuid)"), {"oid": self.tenant_b_org_id})
            await db.execute(text("DELETE FROM core.roles WHERE organization_id = CAST(:oid AS uuid)"), {"oid": self.tenant_b_org_id})
            await db.execute(text("DELETE FROM core.users WHERE organization_id = CAST(:oid AS uuid)"), {"oid": self.tenant_b_org_id})

            self.tenant_b_email = f"cycle2_tenant_b_{uuid4().hex[:8]}@assurance.aegis"

            # 2. Insert Tenant B User
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
                    "name": "Cycle2 Tenant B Auditor",
                },
            )

            # 3. Insert Tenant B SUPERADMIN Role
            await db.execute(
                text("""
                INSERT INTO core.roles (id, organization_id, name, description, is_deleted, created_at, updated_at)
                VALUES (CAST(:id AS uuid), CAST(:org_id AS uuid), 'SUPERADMIN', 'Tenant B Superadmin', false, NOW(), NOW())
                ON CONFLICT (id) DO NOTHING
                """),
                {"id": self.tenant_b_role_id, "org_id": self.tenant_b_org_id},
            )

            # 4. Assign Role to User B
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

            # Query a valid subcontractor ID for testing
            sub_res = await db.execute(text("SELECT id FROM crm.subcontractors WHERE is_deleted=false LIMIT 1"))
            self.subcontractor_id = str(sub_res.scalar() or "79b10a7a-b717-4d19-b741-664dfe123aba")

            await db.commit()

        # 5. Generate User B Cached Token
        payload_b = {
            "sub": self.tenant_b_user_id,
            "email": self.tenant_b_email,
            "app_metadata": {"org_id": self.tenant_b_org_id, "role": "SUPERADMIN"},
            "user_metadata": {"full_name": "Cycle2 Tenant B Auditor"},
            "role": "authenticated",
            "exp": time.time() + 3600,
        }
        self.user_b_token = jwt.encode(payload_b, "cycle2_tenant_b_secret_key_32bytes_long!!", algorithm="HS256")
        token_hash = jwt.decode(self.user_b_token, options={"verify_signature": False})
        import hashlib
        key = hashlib.sha256(self.user_b_token.encode("utf-8")).hexdigest()
        cache_set_json_sync(
            f"auth:token:{key}",
            {
                "id": self.tenant_b_user_id,
                "email": self.tenant_b_email,
                "app_metadata": {"org_id": self.tenant_b_org_id},
                "user_metadata": {"full_name": "Cycle2 Tenant B Auditor"},
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

            # ==================================================================
            # 1. FIXTURE INITIALIZATION (TENANT A PROJECT & BASELINE)
            # ==================================================================
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
            proj_resp = await client_a.post(
                "/api/v1/projects/",
                json={
                    "name": f"{TEST_PREFIX}Project_{suffix}",
                    "project_code": f"C2-{suffix}",
                    "project_type": "commercial_building",
                    "status": "in progress",
                    "contract_value": 500000.00,
                    "target_margin_pct": 18.0,
                    "start_date": (date.today() - timedelta(days=30)).isoformat(),
                    "planned_completion_date": (date.today() + timedelta(days=120)).isoformat(),
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
                    "location_label": "Harare Commercial Complex, Stand 889",
                    "status": "active",
                },
            )
            if site_resp.status_code == 201:
                self.site_a_id = _extract_id(site_resp)

            # ==================================================================
            # WORK PACKAGE A: CERTIFICATE ACCOUNTING & PROJECT HEALTH REPAIRS
            # ==================================================================

            # --- Test CYC2-CERT-001: Subcontract Package & Certificate 1 Post to Finance ---
            t_cert1 = self.add("CYC2-CERT-001", "Package A (Certificates)", "Post Subcontract Certificate 1: Gross Incurred Cost ($30k) & Retention Held ($3k)", "P0")
            t0 = time.time()
            pkg_resp = await client_a.post(
                f"/api/v1/projects/{self.project_a_id}/subcontracts",
                json={
                    "package_number": f"PKG-C2-{suffix}",
                    "title": f"{TEST_PREFIX}HVAC_Installation",
                    "trade": "HVAC",
                    "subcontractor_id": self.subcontractor_id,
                    "award_value": 200000.00,
                    "retention_percentage": 10.0,
                    "retention_cap": 20000.00,
                    "start_date": date.today().isoformat(),
                    "scope_description": "Full chilled water HVAC installation across 4 levels",
                },
            )
            self.package_a_id = _extract_id(pkg_resp)
            if pkg_resp.status_code == 201 and self.package_a_id:
                cert1_resp = await client_a.post(
                    f"/api/v1/projects/{self.project_a_id}/subcontracts/{self.package_a_id}/certificates",
                    json={
                        "certificate_number": f"IPC-C2-001-{suffix}",
                        "valuation_date": date.today().isoformat(),
                        "period_start": (date.today() - timedelta(days=30)).isoformat(),
                        "period_end": date.today().isoformat(),
                        "claimed_amount": 30000.00,
                        "certified_gross_amount": 30000.00,
                        "notes": "First valuation of ductwork and chillers",
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

                        if cost_amt == 30000.00 and ret_amt == 3000.00:
                            t_cert1.status = "PASSED"
                            t_cert1.actual_result = f"Gross liability recognized: ${cost_amt:,.2f}; Retention held: ${ret_amt:,.2f} (Accounting Truthful)"
                        else:
                            t_cert1.status = "FAILED"
                            t_cert1.actual_result = f"Accounting discrepancy: Cost=${cost_amt} (expected 30000.0), Ret=${ret_amt} (expected 3000.0)"
                    else:
                        t_cert1.status = "FAILED"
                        t_cert1.actual_result = f"Post to finance failed: HTTP {post1_resp.status_code}: {post1_resp.text}"
                else:
                    t_cert1.status = "FAILED"
                    t_cert1.actual_result = f"Certificate 1 creation failed: HTTP {cert1_resp.status_code}: {cert1_resp.text}"
            else:
                t_cert1.status = "FAILED"
                t_cert1.actual_result = f"Subcontract creation failed: HTTP {pkg_resp.status_code}: {pkg_resp.text}"

            # --- Test CYC2-CERT-002: Certificate 2 Incremental Work & Retention ---
            t_cert2 = self.add("CYC2-CERT-002", "Package A (Certificates)", "Post Certificate 2: Cumulative $50k reflects Incremental Work ($20k) and Incremental Retention ($2k)", "P0")
            t0 = time.time()
            cert2_resp = await client_a.post(
                f"/api/v1/projects/{self.project_a_id}/subcontracts/{self.package_a_id}/certificates",
                json={
                    "certificate_number": f"IPC-C2-002-{suffix}",
                    "valuation_date": date.today().isoformat(),
                    "period_start": (date.today() - timedelta(days=15)).isoformat(),
                    "period_end": date.today().isoformat(),
                    "claimed_amount": 50000.00,
                    "certified_gross_amount": 50000.00,
                    "notes": "Second valuation for piping and terminal units",
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
                        total_ret = (await db.execute(
                            text("SELECT SUM(amount) FROM finance.retention_ledger WHERE project_id=CAST(:pid AS uuid)"),
                            {"pid": self.project_a_id},
                        )).scalar()

                    inc_cost = float(cost2_row[0]) if cost2_row else None
                    tot_cost = float(total_costs or 0)
                    tot_ret = float(total_ret or 0)

                    t_cert2.metrics = {"incremental_cost_amount": inc_cost, "total_subcontract_cost": tot_cost, "total_retention_held": tot_ret}

                    # Total recognized gross across Cert 1 ($30k) and Cert 2 ($20k incremental) must equal $50k, NOT $80k!
                    if inc_cost == 20000.00 and tot_cost == 50000.00 and tot_ret == 5000.00:
                        t_cert2.status = "PASSED"
                        t_cert2.actual_result = f"Incremental Gross: ${inc_cost:,.2f}; Total Package Cost: ${tot_cost:,.2f} (Zero double-counting); Total Retention: ${tot_ret:,.2f}"
                    else:
                        t_cert2.status = "FAILED"
                        t_cert2.actual_result = f"Cumulative calculation error: Incremental=${inc_cost} (exp 20k), Total=${tot_cost} (exp 50k), Ret=${tot_ret} (exp 5k)"
                else:
                    t_cert2.status = "FAILED"
                    t_cert2.actual_result = f"Post Certificate 2 failed: HTTP {post2_resp.status_code}"
            else:
                t_cert2.status = "FAILED"
                t_cert2.actual_result = f"Certificate 2 creation failed: HTTP {cert2_resp.status_code}"

            # --- Test CYC2-CERT-003: Idempotent Re-posting of Certificate 2 ---
            t_idem = self.add("CYC2-CERT-003", "Package A (Certificates)", "Idempotent Re-posting: Duplicate post returns already_posted=True and creates zero duplicate rows", "P0")
            t0 = time.time()
            repost_resp = await client_a.post(
                f"/api/v1/projects/{self.project_a_id}/subcontracts/{self.package_a_id}/certificates/{self.cert2_id}/post-to-finance"
            )
            t_idem.latency_ms = round((time.time() - t0) * 1000, 1)

            if repost_resp.status_code == 200:
                repost_data = repost_resp.json().get("data", {})
                async with AsyncSessionLocal() as db:
                    count_tx = (await db.execute(
                        text("SELECT COUNT(*) FROM finance.cost_transactions WHERE source_id=CAST(:cid AS uuid)"),
                        {"cid": self.cert2_id},
                    )).scalar()
                    count_ret = (await db.execute(
                        text("SELECT COUNT(*) FROM finance.retention_ledger WHERE source_id=CAST(:cid AS uuid)"),
                        {"cid": self.cert2_id},
                    )).scalar()

                t_idem.metrics = {"already_posted": repost_data.get("already_posted"), "cost_rows": count_tx, "retention_rows": count_ret}

                if repost_data.get("already_posted") is True and count_tx == 1 and count_ret == 1:
                    t_idem.status = "PASSED"
                    t_idem.actual_result = "Idempotency guaranteed: already_posted=True, duplicate financial postings prevented."
                else:
                    t_idem.status = "FAILED"
                    t_idem.actual_result = f"Idempotency violation: already_posted={repost_data.get('already_posted')}, cost_rows={count_tx}, ret_rows={count_ret}"
            else:
                t_idem.status = "FAILED"
                t_idem.actual_result = f"Re-post failed: HTTP {repost_resp.status_code}"

            # --- Test CYC2-HLTH-001: Project Health Truthfulness on Inactive Site ---
            t_hlth1 = self.add("CYC2-HLTH-001", "Package A (Health)", "Dynamic Health Evaluator: Project with elapsed calendar days & 0 daily reports flags at_risk (no on_track fallback)", "P1")
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
                # Since start_date was 30 days ago and 0 daily reports were filed, discipline is 0% -> must evaluate to at_risk or critical, NEVER on_track!
                if evaluated_health in ("at_risk", "critical"):
                    t_hlth1.status = "PASSED"
                    t_hlth1.actual_result = f"Truthful dynamic evaluation: health_status='{evaluated_health}' (discipline score {disp_score}, 0 false passes)"
                else:
                    t_hlth1.status = "FAILED"
                    t_hlth1.actual_result = f"Health defaulted to '{evaluated_health}', masking absence of daily reporting!"
            else:
                t_hlth1.status = "FAILED"
                t_hlth1.actual_result = f"Dossier fetch failed: HTTP {dossier_resp.status_code}"

            # --- Test CYC2-HLTH-002: Project Health Critical Escalation on Active Delays ---
            t_hlth2 = self.add("CYC2-HLTH-002", "Package A (Health)", "Dynamic Health Evaluator: Project with >= 3 active delays escalates to 'critical'", "P1")
            t0 = time.time()
            async with AsyncSessionLocal() as db:
                for d_idx in range(1, 4):
                    report_d = date.today() - timedelta(days=d_idx)
                    await db.execute(
                        text("""
                        INSERT INTO projects.daily_site_reports (
                            organization_id, project_id, report_date, shift, status, delays, is_deleted, created_at, updated_at
                        ) VALUES (
                            CAST(:org_id AS uuid), CAST(:proj_id AS uuid), :report_d, 'day', 'approved', 'Critical access obstruction and delays', false, NOW(), NOW()
                        )
                        """),
                        {
                            "org_id": self.org_a_id,
                            "proj_id": self.project_a_id,
                            "report_d": report_d,
                        },
                    )
                await db.commit()

            dossier2_resp = await client_a.get(f"/api/v1/projects/{self.project_a_id}/leadership-dossier")
            t_hlth2.latency_ms = round((time.time() - t0) * 1000, 1)

            if dossier2_resp.status_code == 200:
                dossier2 = dossier2_resp.json().get("data", {})
                crit_health = dossier2.get("project", {}).get("health_status")
                reports_with_delays = dossier2.get("engineer", {}).get("reports_with_delays", 0)
                t_hlth2.metrics = {"health_status": crit_health, "reports_with_delays": reports_with_delays}

                if crit_health == "critical" and reports_with_delays >= 3:
                    t_hlth2.status = "PASSED"
                    t_hlth2.actual_result = f"Escalated to '{crit_health}' with {reports_with_delays} active delay reports."
                else:
                    t_hlth2.status = "FAILED"
                    t_hlth2.actual_result = f"Failed to escalate: health_status='{crit_health}', reports_with_delays={reports_with_delays}"
            else:
                t_hlth2.status = "FAILED"
                t_hlth2.actual_result = f"Dossier fetch failed: HTTP {dossier2_resp.status_code}"

            # ==================================================================
            # WORK PACKAGE B: TENANT & ROLE ISOLATION
            # ==================================================================

            # --- Test CYC2-ISOL-001: Tenant B Cross-Tenant Read Rejection ---
            t_isol1 = self.add("CYC2-ISOL-001", "Package B (Isolation)", "Cross-Tenant Read: Tenant B user reading Tenant A project returns HTTP 404 (Zero Leakage)", "P0")
            t0 = time.time()
            r_b_proj = await client_b.get(f"/api/v1/projects/{self.project_a_id}")
            t_isol1.latency_ms = round((time.time() - t0) * 1000, 1)

            t_isol1.metrics = {"status_code": r_b_proj.status_code}
            if r_b_proj.status_code == 404:
                t_isol1.status = "PASSED"
                t_isol1.actual_result = "HTTP 404 Not Found returned: Tenant A project completely invisible to Tenant B."
            else:
                t_isol1.status = "FAILED"
                t_isol1.actual_result = f"Cross-tenant data leakage! Returned HTTP {r_b_proj.status_code}: {r_b_proj.text[:100]}"

            # --- Test CYC2-ISOL-002: Tenant B Cross-Tenant Dossier & Subcontracts Read Rejection ---
            t_isol2 = self.add("CYC2-ISOL-002", "Package B (Isolation)", "Cross-Tenant Sub-resources: Tenant B reading Tenant A leadership dossier & subcontracts returns HTTP 404", "P0")
            t0 = time.time()
            r_b_dossier = await client_b.get(f"/api/v1/projects/{self.project_a_id}/leadership-dossier")
            r_b_subcontracts = await client_b.get(f"/api/v1/projects/{self.project_a_id}/subcontracts")
            t_isol2.latency_ms = round((time.time() - t0) * 1000, 1)

            t_isol2.metrics = {"dossier_status": r_b_dossier.status_code, "subcontracts_status": r_b_subcontracts.status_code}
            if r_b_dossier.status_code == 404 and r_b_subcontracts.status_code == 404:
                t_isol2.status = "PASSED"
                t_isol2.actual_result = "HTTP 404 on both dossier and subcontracts: Complete tenant boundary enforcement."
            else:
                t_isol2.status = "FAILED"
                t_isol2.actual_result = f"Isolation failure: Dossier HTTP {r_b_dossier.status_code}, Subcontracts HTTP {r_b_subcontracts.status_code}"

            # --- Test CYC2-ISOL-003: Tenant B Cross-Tenant Write Mutation Rejection ---
            t_isol3 = self.add("CYC2-ISOL-003", "Package B (Isolation)", "Cross-Tenant Write: Tenant B attempting to create subcontract or site report on Tenant A project is rejected", "P0")
            t0 = time.time()
            r_b_write = await client_b.post(
                f"/api/v1/projects/{self.project_a_id}/subcontracts",
                json={
                    "package_number": f"PKG-C2-MALICIOUS-{suffix}",
                    "title": f"{TEST_PREFIX}Malicious_Subcontract",
                    "trade": "General",
                    "subcontractor_id": self.subcontractor_id,
                    "award_value": 50000.00,
                    "retention_percentage": 5.0,
                    "retention_cap": 2500.00,
                    "start_date": date.today().isoformat(),
                },
            )
            t_isol3.latency_ms = round((time.time() - t0) * 1000, 1)

            t_isol3.metrics = {"write_response_status": r_b_write.status_code}
            if r_b_write.status_code in (404, 403):
                t_isol3.status = "PASSED"
                t_isol3.actual_result = f"Mutation rejected with HTTP {r_b_write.status_code}: Tenant B cannot mutate Tenant A records."
            else:
                t_isol3.status = "FAILED"
                t_isol3.actual_result = f"Security vulnerability! Tenant B created record on Tenant A: HTTP {r_b_write.status_code}"

            # --- Test CYC2-ISOL-004: Token Tenant Claim Spoofing Guard ---
            t_isol4 = self.add("CYC2-ISOL-004", "Package B (Isolation)", "Tamper Guard: User presenting token claiming Tenant A's org_id while assigned to Tenant B is rejected with HTTP 403", "P0")
            t0 = time.time()
            spoofed_payload = {
                "sub": self.tenant_b_user_id,
                "email": "cycle2_tenant_b@assurance.aegis",
                "app_metadata": {"org_id": self.org_a_id}, # Spoofing Tenant A
                "user_metadata": {"full_name": "Spoofed Token"},
                "role": "authenticated",
                "exp": time.time() + 3600,
            }
            spoofed_token = jwt.encode(spoofed_payload, "spoofed_secret", algorithm="HS256")
            import hashlib
            spoofed_key = hashlib.sha256(spoofed_token.encode("utf-8")).hexdigest()
            cache_set_json_sync(
                f"auth:token:{spoofed_key}",
                {
                    "id": self.tenant_b_user_id,
                    "email": "cycle2_tenant_b@assurance.aegis",
                    "app_metadata": {"org_id": self.org_a_id},
                },
                3600,
            )

            async with httpx.AsyncClient(
                base_url=BASE_URL,
                headers={"Authorization": f"Bearer {spoofed_token}", "Content-Type": "application/json"},
                timeout=15.0,
            ) as client_spoofed:
                r_spoof = await client_spoofed.get("/api/v1/projects/")
                t_isol4.latency_ms = round((time.time() - t0) * 1000, 1)

            t_isol4.metrics = {"spoofed_status": r_spoof.status_code}
            if r_spoof.status_code == 403:
                t_isol4.status = "PASSED"
                t_isol4.actual_result = f"HTTP 403 Forbidden: Tenant spoofing detected and rejected ('{r_spoof.json().get('detail')}')"
            else:
                t_isol4.status = "FAILED"
                t_isol4.actual_result = f"Tenant spoofing allowed! Returned HTTP {r_spoof.status_code}"

            # ==================================================================
            # WORK PACKAGE C: COMMITMENT CONSUMPTION VIA SUPPLIER INVOICE WORKFLOW
            # ==================================================================

            # Fixtures for Procurement & Commitment Testing:
            # Create a supplier and document evidence in database
            async with AsyncSessionLocal() as db:
                sup_row = (await db.execute(
                    text("""
                    INSERT INTO procurement.suppliers (
                        organization_id, supplier_code, supplier_name, primary_contact_name, primary_contact_email, primary_contact_phone,
                        status, compliance_status, is_deleted, created_at, updated_at
                    ) VALUES (
                        CAST(:org_id AS uuid), :code, :name, 'Tinashe Muriro', 'orders@turnall.co.zw', '+263772111222',
                        'active', 'compliant', false, NOW(), NOW()
                    ) RETURNING id
                    """),
                    {
                        "org_id": self.org_a_id,
                        "code": f"SUP-C2-{suffix}",
                        "name": f"{TEST_PREFIX}Turnall_Pipes_{suffix}",
                    },
                )).fetchone()
                self.supplier_id = str(sup_row[0])

                # Create document evidence
                doc_row = (await db.execute(
                    text("""
                    INSERT INTO core.documents (organization_id, title, category, file_name, created_at, updated_at)
                    VALUES (CAST(:org_id AS uuid), :title, 'financial', 'invoice_approval_pack.pdf', NOW(), NOW())
                    RETURNING id
                    """),
                    {"org_id": self.org_a_id, "title": f"{TEST_PREFIX}Delivery_and_Invoice_Evidence"},
                )).fetchone()
                self.doc_id = str(doc_row[0])

                # Create Purchase Order directly in approved state so we can issue it via API
                po_row = (await db.execute(
                    text("""
                    INSERT INTO procurement.purchase_orders (
                        organization_id, po_number, supplier_id, project_id, title,
                        subtotal, tax_amount, total_amount, status, created_by, created_at, updated_at
                    ) VALUES (
                        CAST(:org_id AS uuid), :num, CAST(:sup_id AS uuid), CAST(:proj_id AS uuid), :title,
                        100000.00, 0.00, 100000.00, 'approved', CAST(:u_id AS uuid), NOW(), NOW()
                    ) RETURNING id
                    """),
                    {
                        "org_id": self.org_a_id,
                        "num": f"PO-C2-{suffix}",
                        "sup_id": self.supplier_id,
                        "proj_id": self.project_a_id,
                        "title": f"{TEST_PREFIX}Structural Steel & Pipes Supply",
                        "u_id": self.user_a_id,
                    },
                )).fetchone()
                self.po_id = str(po_row[0])
                await db.commit()

            # --- Test CYC2-COM-001: Issue Purchase Order and Recognize Commitment ---
            t_com1 = self.add("CYC2-COM-001", "Package C (Commitments)", "Issue Purchase Order: Creates finance.commitments with $100k committed and $100k outstanding", "P0")
            t0 = time.time()
            issue_resp = await client_a.post(f"/api/v1/procurement/purchase-orders/{self.po_id}/issue", json={"notes": "Issued by QA runner"})
            t_com1.latency_ms = round((time.time() - t0) * 1000, 1)

            if issue_resp.status_code == 200:
                async with AsyncSessionLocal() as db:
                    comm = (await db.execute(
                        text("""
                        SELECT committed_amount, invoiced_amount, outstanding_amount, status
                        FROM finance.commitments
                        WHERE organization_id=CAST(:org_id AS uuid) AND source_type='purchase_order' AND source_id=CAST(:po_id AS uuid)
                        """),
                        {"org_id": self.org_a_id, "po_id": self.po_id},
                    )).mappings().first()

                if comm:
                    committed = float(comm["committed_amount"])
                    invoiced = float(comm["invoiced_amount"])
                    outstanding = float(comm["outstanding_amount"])
                    comm_status = comm["status"]

                    t_com1.metrics = {
                        "committed_amount": committed,
                        "invoiced_amount": invoiced,
                        "outstanding_amount": outstanding,
                        "status": comm_status,
                    }

                    if committed == 100000.00 and invoiced == 0.00 and outstanding == 100000.00 and comm_status == "active":
                        t_com1.status = "PASSED"
                        t_com1.actual_result = f"Commitment created: Committed=${committed:,.2f}, Outstanding=${outstanding:,.2f}, Status='{comm_status}'"
                    else:
                        t_com1.status = "FAILED"
                        t_com1.actual_result = f"Commitment state invalid: Committed={committed}, Invoiced={invoiced}, Outstanding={outstanding}, Status={comm_status}"
                else:
                    t_com1.status = "FAILED"
                    t_com1.actual_result = "finance.commitments row was not created upon PO issue!"
            else:
                t_com1.status = "FAILED"
                t_com1.actual_result = f"PO issue failed: HTTP {issue_resp.status_code}: {issue_resp.text}"

            # --- Test CYC2-COM-002: Supplier Invoice Payment Approval & Commitment Consumption ($35k) ---
            t_com2 = self.add("CYC2-COM-002", "Package C (Commitments)", "Approve Supplier Invoice 1 ($35k): Decrements outstanding commitment to $65k (status='partially_invoiced')", "P0")
            t0 = time.time()
            async with AsyncSessionLocal() as db:
                # 1. Create GRN
                grn_row = (await db.execute(
                    text("""
                    INSERT INTO procurement.goods_received_notes (
                        organization_id, grn_number, po_id, supplier_id, project_id, delivery_date, status, received_by, created_at, updated_at
                    ) VALUES (
                        CAST(:org_id AS uuid), :num, CAST(:po_id AS uuid), CAST(:sup_id AS uuid), CAST(:proj_id AS uuid), CURRENT_DATE, 'confirmed', CAST(:u_id AS uuid), NOW(), NOW()
                    ) RETURNING id
                    """),
                    {
                        "org_id": self.org_a_id,
                        "num": f"GRN-C2-{suffix}",
                        "po_id": self.po_id,
                        "sup_id": self.supplier_id,
                        "proj_id": self.project_a_id,
                        "u_id": self.user_a_id,
                    },
                )).fetchone()
                self.grn_id = str(grn_row[0])

                # 2. Create Supplier Invoice 1 ($35,000)
                inv1_row = (await db.execute(
                    text("""
                    INSERT INTO procurement.supplier_invoices (
                        organization_id, invoice_number, po_id, grn_id, supplier_id, project_id,
                        invoice_date, subtotal, tax_amount, total_amount, match_status, status, created_at, updated_at
                    ) VALUES (
                        CAST(:org_id AS uuid), :num, CAST(:po_id AS uuid), CAST(:grn_id AS uuid), CAST(:sup_id AS uuid), CAST(:proj_id AS uuid),
                        CURRENT_DATE, 35000.00, 0.00, 35000.00, 'matched', 'matched', NOW(), NOW()
                    ) RETURNING id
                    """),
                    {
                        "org_id": self.org_a_id,
                        "num": f"INV-C2-001-{suffix}",
                        "po_id": self.po_id,
                        "grn_id": self.grn_id,
                        "sup_id": self.supplier_id,
                        "proj_id": self.project_a_id,
                    },
                )).fetchone()
                self.inv1_id = str(inv1_row[0])

                # 3. Create required document evidence links
                for entity_type, entity_id, role in [
                    ("purchase_order", self.po_id, "purchase_order"),
                    ("purchase_order", self.po_id, "evidence"),
                    ("goods_received_note", self.grn_id, "goods_receipt"),
                    ("goods_received_note", self.grn_id, "evidence"),
                    ("supplier_invoice", self.inv1_id, "supplier_invoice"),
                    ("supplier_invoice", self.inv1_id, "evidence"),
                ]:
                    await db.execute(
                        text("""
                        INSERT INTO core.document_links (
                            organization_id, document_id, entity_type, entity_id, project_id, link_role, linked_by
                        ) VALUES (
                            CAST(:org_id AS uuid), CAST(:doc_id AS uuid), :entity_type, CAST(:entity_id AS uuid), CAST(:proj_id AS uuid), :link_role, CAST(:u_id AS uuid)
                        ) ON CONFLICT DO NOTHING
                        """),
                        {
                            "org_id": self.org_a_id,
                            "doc_id": self.doc_id,
                            "entity_type": entity_type,
                            "entity_id": entity_id,
                            "proj_id": self.project_a_id,
                            "link_role": role,
                            "u_id": self.user_a_id,
                        },
                    )
                await db.commit()

            # Execute Payment Decision (Approval) via API
            pay_resp = await client_a.post(
                f"/api/v1/procurement/invoices/{self.inv1_id}/payment-decision",
                json={
                    "decision": "approved",
                    "reason": "Verified with site receiving supervisor",
                    "approval_document_id": self.doc_id,
                },
            )
            t_com2.latency_ms = round((time.time() - t0) * 1000, 1)

            if pay_resp.status_code == 200:
                async with AsyncSessionLocal() as db:
                    comm1 = (await db.execute(
                        text("""
                        SELECT committed_amount, invoiced_amount, outstanding_amount, status
                        FROM finance.commitments
                        WHERE organization_id=CAST(:org_id AS uuid) AND source_type='purchase_order' AND source_id=CAST(:po_id AS uuid)
                        """),
                        {"org_id": self.org_a_id, "po_id": self.po_id},
                    )).mappings().first()

                invoiced1 = float(comm1["invoiced_amount"])
                outstanding1 = float(comm1["outstanding_amount"])
                status1 = comm1["status"]

                t_com2.metrics = {
                    "invoiced_amount": invoiced1,
                    "outstanding_amount": outstanding1,
                    "status": status1,
                }

                if invoiced1 == 35000.00 and outstanding1 == 65000.00 and status1 == "partially_invoiced":
                    t_com2.status = "PASSED"
                    t_com2.actual_result = f"Commitment successfully consumed: Invoiced=${invoiced1:,.2f}, Remaining Outstanding=${outstanding1:,.2f}, Status='{status1}'"
                else:
                    t_com2.status = "FAILED"
                    t_com2.actual_result = f"Consumption calculation error: Invoiced=${invoiced1} (exp 35k), Outstanding=${outstanding1} (exp 65k), Status='{status1}'"
            else:
                t_com2.status = "FAILED"
                t_com2.actual_result = f"Payment decision failed: HTTP {pay_resp.status_code}: {pay_resp.text}"

            # --- Test CYC2-COM-003: Headroom Invariance & Zero Double-Counting ---
            t_com3 = self.add("CYC2-COM-003", "Package C (Commitments)", "Project Financial Headroom Invariance: Invoiced liability ($35k) + Open commitment ($65k) = $100k Total Exposure", "P0")
            t0 = time.time()
            async with AsyncSessionLocal() as db:
                # Query project commitments and total exposure
                comm_stats = (await db.execute(
                    text("""
                    SELECT
                        COALESCE(SUM(c.committed_amount), 0) AS total_committed,
                        COALESCE(SUM(c.invoiced_amount), 0) AS total_invoiced,
                        COALESCE(SUM(c.outstanding_amount), 0) AS total_open
                    FROM finance.commitments c
                    WHERE c.organization_id = CAST(:org_id AS uuid)
                      AND c.project_id = CAST(:proj_id AS uuid)
                      AND c.status <> 'cancelled'
                      AND c.is_deleted = false
                    """),
                    {"org_id": self.org_a_id, "proj_id": self.project_a_id},
                )).mappings().first()

            t_com3.latency_ms = round((time.time() - t0) * 1000, 1)
            tot_comm = float(comm_stats["total_committed"])
            tot_inv = float(comm_stats["total_invoiced"])
            tot_open = float(comm_stats["total_open"])
            exposure = tot_inv + tot_open

            t_com3.metrics = {
                "total_committed": tot_comm,
                "invoiced_portion": tot_inv,
                "open_outstanding": tot_open,
                "combined_exposure": exposure,
            }

            if tot_comm == 100000.00 and tot_open == 65000.00 and exposure == 100000.00:
                t_com3.status = "PASSED"
                t_com3.actual_result = f"Mathematical truth preserved: Open=${tot_open:,.2f} + Invoiced=${tot_inv:,.2f} = Total Exposure ${exposure:,.2f} (Zero double-counting against budget)"
            else:
                t_com3.status = "FAILED"
                t_com3.actual_result = f"Double counting detected: Total committed={tot_comm}, Open={tot_open}, Exposure={exposure}"

            # --- Test CYC2-COM-004: Full Invoice Consumption ($65k) & Transition to fully_invoiced ---
            t_com4 = self.add("CYC2-COM-004", "Package C (Commitments)", "Approve Final Invoice 2 ($65k): Transitions commitment to status='fully_invoiced' and $0 outstanding", "P0")
            t0 = time.time()
            async with AsyncSessionLocal() as db:
                inv2_row = (await db.execute(
                    text("""
                    INSERT INTO procurement.supplier_invoices (
                        organization_id, invoice_number, po_id, grn_id, supplier_id, project_id,
                        invoice_date, subtotal, tax_amount, total_amount, match_status, status, created_at, updated_at
                    ) VALUES (
                        CAST(:org_id AS uuid), :num, CAST(:po_id AS uuid), CAST(:grn_id AS uuid), CAST(:sup_id AS uuid), CAST(:proj_id AS uuid),
                        CURRENT_DATE, 65000.00, 0.00, 65000.00, 'matched', 'matched', NOW(), NOW()
                    ) RETURNING id
                    """),
                    {
                        "org_id": self.org_a_id,
                        "num": f"INV-C2-002-{suffix}",
                        "po_id": self.po_id,
                        "grn_id": self.grn_id,
                        "sup_id": self.supplier_id,
                        "proj_id": self.project_a_id,
                    },
                )).fetchone()
                self.inv2_id = str(inv2_row[0])

                for role in ["supplier_invoice", "evidence"]:
                    await db.execute(
                        text("""
                        INSERT INTO core.document_links (
                            organization_id, document_id, entity_type, entity_id, project_id, link_role, linked_by
                        ) VALUES (
                            CAST(:org_id AS uuid), CAST(:doc_id AS uuid), 'supplier_invoice', CAST(:entity_id AS uuid), CAST(:proj_id AS uuid), :link_role, CAST(:u_id AS uuid)
                        ) ON CONFLICT DO NOTHING
                        """),
                        {
                            "org_id": self.org_a_id,
                            "doc_id": self.doc_id,
                            "entity_id": self.inv2_id,
                            "proj_id": self.project_a_id,
                            "link_role": role,
                            "u_id": self.user_a_id,
                        },
                    )
                await db.commit()

            pay2_resp = await client_a.post(
                f"/api/v1/procurement/invoices/{self.inv2_id}/payment-decision",
                json={
                    "decision": "approved",
                    "reason": "Final milestone delivery approved",
                    "approval_document_id": self.doc_id,
                },
            )
            t_com4.latency_ms = round((time.time() - t0) * 1000, 1)

            if pay2_resp.status_code == 200:
                async with AsyncSessionLocal() as db:
                    comm2 = (await db.execute(
                        text("""
                        SELECT committed_amount, invoiced_amount, outstanding_amount, status
                        FROM finance.commitments
                        WHERE organization_id=CAST(:org_id AS uuid) AND source_type='purchase_order' AND source_id=CAST(:po_id AS uuid)
                        """),
                        {"org_id": self.org_a_id, "po_id": self.po_id},
                    )).mappings().first()

                invoiced2 = float(comm2["invoiced_amount"])
                outstanding2 = float(comm2["outstanding_amount"])
                status2 = comm2["status"]

                t_com4.metrics = {
                    "invoiced_amount": invoiced2,
                    "outstanding_amount": outstanding2,
                    "status": status2,
                }

                if invoiced2 == 100000.00 and outstanding2 == 0.00 and status2 == "fully_invoiced":
                    t_com4.status = "PASSED"
                    t_com4.actual_result = f"Commitment fully fulfilled: Invoiced=${invoiced2:,.2f}, Outstanding=${outstanding2:,.2f}, Status='{status2}'"
                else:
                    t_com4.status = "FAILED"
                    t_com4.actual_result = f"Final fulfillment error: Invoiced=${invoiced2} (exp 100k), Outstanding=${outstanding2} (exp 0.0), Status='{status2}'"
            else:
                t_com4.status = "FAILED"
                t_com4.actual_result = f"Payment decision 2 failed: HTTP {pay2_resp.status_code}: {pay2_resp.text}"

            # ==================================================================
            # TEARDOWN & SYNTHETIC DATA PURGE
            # ==================================================================
            print("\n[TEARDOWN] Purging synthetic test data under prefix...")
            async with AsyncSessionLocal() as db:
                if self.project_a_id:
                    await self.purge_project(db, self.project_a_id)

                if self.supplier_id:
                    await db.execute(text("DELETE FROM procurement.suppliers WHERE id=CAST(:sid AS uuid)"), {"sid": self.supplier_id})
                if self.doc_id:
                    await db.execute(text("DELETE FROM core.documents WHERE id=CAST(:did AS uuid)"), {"did": self.doc_id})

                # Clean up Tenant B
                await db.execute(text("DELETE FROM core.user_roles WHERE user_id=CAST(:uid AS uuid)"), {"uid": self.tenant_b_user_id})
                await db.execute(text("DELETE FROM core.roles WHERE organization_id=CAST(:oid AS uuid)"), {"oid": self.tenant_b_org_id})
                await db.execute(text("DELETE FROM core.users WHERE id=CAST(:uid AS uuid)"), {"uid": self.tenant_b_user_id})
                await db.execute(text("UPDATE core.organizations SET is_deleted=true WHERE id=CAST(:oid AS uuid)"), {"oid": self.tenant_b_org_id})

                await db.commit()
                print("[TEARDOWN] Complete synthetic test data cleanup verified.")

        self.print_summary()
        return self


if __name__ == "__main__":
    runner = Cycle2AssuranceRunner()
    asyncio.run(runner.run())
