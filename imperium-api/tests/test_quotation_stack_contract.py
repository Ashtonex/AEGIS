from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
QUOTATION_ROUTER = (ROOT / "routers" / "quotations.py").read_text(encoding="utf-8")
WORKER = (ROOT / "app" / "workers" / "arq_worker.py").read_text(encoding="utf-8")
REQUIREMENTS = (ROOT / "requirements.txt").read_text(encoding="utf-8")
ENV_EXAMPLE_PATH = ROOT.parent / ".env.example"
ENV_EXAMPLE = ENV_EXAMPLE_PATH.read_text(encoding="utf-8") if ENV_EXAMPLE_PATH.exists() else ""


class QuotationStackContractTests(unittest.TestCase):
    def test_quotation_router_exposes_integrated_service_endpoints(self):
        self.assertIn('@router.post("/calculate")', QUOTATION_ROUTER)
        self.assertIn('@router.post("/boq/import")', QUOTATION_ROUTER)
        self.assertIn('@router.post("/exports/pdf")', QUOTATION_ROUTER)
        self.assertIn('@router.post("/exports/excel")', QUOTATION_ROUTER)
        self.assertIn("QuotationCalculator.calculate", QUOTATION_ROUTER)
        self.assertIn("BOQImporter.import_boq", QUOTATION_ROUTER)
        self.assertIn("QuotationPDFRenderer().render_pdf", QUOTATION_ROUTER)
        self.assertIn("QuotationExcelExporter().export_to_excel", QUOTATION_ROUTER)

    def test_intelligence_engine_persists_evaluations_for_audit_history(self):
        self.assertIn('@router.post("/intelligence/evaluate")', QUOTATION_ROUTER)
        self.assertIn('@router.get("/intelligence/baselines")', QUOTATION_ROUTER)
        self.assertIn("INSERT INTO finance.project_commercial_baselines", QUOTATION_ROUTER)
        self.assertIn("SELECT * FROM finance.project_commercial_baselines", QUOTATION_ROUTER)

    def test_commercial_guard_persists_audits_for_evidence_log(self):
        self.assertIn('@router.post("/guard/audit")', QUOTATION_ROUTER)
        self.assertIn('@router.get("/guard/audits")', QUOTATION_ROUTER)
        self.assertIn("INSERT INTO finance.commercial_guard_audits", QUOTATION_ROUTER)
        self.assertIn("SELECT * FROM finance.commercial_guard_audits", QUOTATION_ROUTER)

    def test_document_watcher_persists_revision_change_log(self):
        self.assertIn('@router.post("/documents/watch")', QUOTATION_ROUTER)
        self.assertIn('@router.get("/documents/changes")', QUOTATION_ROUTER)
        self.assertIn("INSERT INTO finance.document_change_logs", QUOTATION_ROUTER)
        self.assertIn("SELECT * FROM finance.document_change_logs", QUOTATION_ROUTER)

    def test_ccb_override_endpoint_records_md_approval_on_the_quotation(self):
        self.assertIn('@router.post("/intelligence/override")', QUOTATION_ROUTER)
        self.assertIn("ccb_overrides", QUOTATION_ROUTER)
        self.assertIn("UPDATE finance.quotations", QUOTATION_ROUTER)

    def test_ccb_override_is_gated_by_permission_and_stamped_with_baseline(self):
        self.assertIn(
            'user: dict = Depends(require_permission("quotations.approve_ccb_override"))',
            QUOTATION_ROUTER,
        )
        self.assertIn("approver_role = user.get(\"role\")", QUOTATION_ROUTER)
        self.assertIn("baseline_id", QUOTATION_ROUTER)

    def test_critical_guard_findings_open_an_investigation_case(self):
        self.assertIn('if audit["risk_level"] == "CRITICAL"', QUOTATION_ROUTER)
        self.assertIn("INSERT INTO finance.investigation_cases", QUOTATION_ROUTER)

    def test_high_risk_events_notify_md_and_commercial_manager_roles(self):
        self.assertIn("emit_role_notification", QUOTATION_ROUTER)
        self.assertIn('role_names=["MD", "COMMERCIAL_MANAGER", "EXECUTIVE", SUPERADMIN_ROLE]', QUOTATION_ROUTER)

    def test_assemblies_and_rate_benchmarks_have_org_scoped_admin_crud(self):
        self.assertIn('@router.post("/assemblies")', QUOTATION_ROUTER)
        self.assertIn('@router.delete("/assemblies/{assembly_id}")', QUOTATION_ROUTER)
        self.assertIn('@router.get("/rates/benchmarks")', QUOTATION_ROUTER)
        self.assertIn('@router.post("/rates/benchmarks")', QUOTATION_ROUTER)
        self.assertIn('@router.delete("/rates/benchmarks/{benchmark_id}")', QUOTATION_ROUTER)
        self.assertIn('require_permission("quotations.manage_assemblies")', QUOTATION_ROUTER)
        self.assertIn('require_permission("quotations.manage_rate_intelligence")', QUOTATION_ROUTER)
        self.assertIn("INSERT INTO finance.construction_assemblies", QUOTATION_ROUTER)
        self.assertIn("INSERT INTO finance.rate_intelligence", QUOTATION_ROUTER)

    def test_evaluate_and_benchmark_endpoints_merge_org_specific_overrides(self):
        self.assertIn("_load_org_rate_benchmarks", QUOTATION_ROUTER)
        self.assertIn("_load_org_assemblies", QUOTATION_ROUTER)
        self.assertIn("QuotationBrain.evaluate_project(payload, rate_benchmarks=org_rate_benchmarks)", QUOTATION_ROUTER)

    def test_ccb_control_file_pdf_export_endpoint_exists(self):
        self.assertIn('@router.post("/intelligence/export-pdf")', QUOTATION_ROUTER)
        self.assertIn("CommercialControlPDFRenderer().render_pdf", QUOTATION_ROUTER)
        self.assertIn("FileResponse(", QUOTATION_ROUTER)

    def test_manual_quotation_save_path_serializes_json_columns_before_binding(self):
        # create_item/update_item bind payload["metadata"] (a dict) to a jsonb column.
        # asyncpg's jsonb codec calls .encode() on the bound value, so it must already
        # be a json.dumps string, and the SQL side needs the matching CAST(... AS jsonb).
        self.assertIn(
            "json_columns = [k for k in safe_keys if isinstance(payload[k], (dict, list))]",
            QUOTATION_ROUTER,
        )
        self.assertIn(
            'insert_returning_id_sql("finance.quotations", safe_keys, safe_keys, json_columns=json_columns)',
            QUOTATION_ROUTER,
        )
        self.assertIn(
            'update_returning_id_sql("finance.quotations", safe_keys, safe_keys, json_columns=json_columns)',
            QUOTATION_ROUTER,
        )

    def test_ccb_permission_keys_are_seeded_in_the_catalog(self):
        migration = (ROOT / "migrations" / "039_ccb_permission_catalog.sql").read_text(encoding="utf-8")
        self.assertIn("quotations.approve_ccb_override", migration)
        self.assertIn("quotations.manage_assemblies", migration)
        self.assertIn("quotations.manage_rate_intelligence", migration)

    def test_worker_keeps_real_quotation_document_job_registered(self):
        self.assertIn("async def generate_quotation_documents_job", WORKER)
        self.assertIn("generate_quotation_documents_job", WORKER)
        self.assertIn("idempotency_key", WORKER)
        self.assertIn("settings.WORKER_JOB_MAX_TRIES", WORKER)
        self.assertIn("settings.WORKER_JOB_TIMEOUT_SECONDS", WORKER)

    def test_security_stack_uses_single_jwt_library_and_direct_argon2(self):
        self.assertIn("PyJWT==", REQUIREMENTS)
        self.assertIn("argon2-cffi==", REQUIREMENTS)
        self.assertNotIn("python-jose", REQUIREMENTS)
        self.assertNotIn("passlib", REQUIREMENTS)

    def test_environment_example_documents_operational_settings(self):
        if not ENV_EXAMPLE:
            self.skipTest("Repository-root .env.example is not mounted in this runtime.")
        for key in [
            "WORKER_JOB_TIMEOUT_SECONDS",
            "WORKER_JOB_MAX_TRIES",
            "FILE_STORAGE_MAX_BYTES",
            "GENERATED_DOCUMENT_DIR",
            "JWT_ISSUER",
            "JWT_AUDIENCE",
        ]:
            self.assertIn(key, ENV_EXAMPLE)


if __name__ == "__main__":
    unittest.main()
