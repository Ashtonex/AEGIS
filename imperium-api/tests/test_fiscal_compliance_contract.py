from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
MIGRATION_208 = (ROOT / "migrations" / "208_finance_progress_claim_fiscal_invoice.sql").read_text(encoding="utf-8")
MIGRATION_209 = (ROOT / "migrations" / "209_finance_statutory_profile_fiscal_device.sql").read_text(encoding="utf-8")
MIGRATION_210 = (ROOT / "migrations" / "210_finance_statutory_profile_id_column.sql").read_text(encoding="utf-8")
FINANCIAL_PERFORMANCE_ROUTER = (ROOT / "routers" / "financial_performance.py").read_text(encoding="utf-8")
FINANCE_STATUTORY_ROUTER = (ROOT / "routers" / "finance_statutory.py").read_text(encoding="utf-8")


class MigrationContractTests(unittest.TestCase):
    def test_progress_claim_fiscal_columns_are_nullable_additions(self):
        self.assertIn("ADD COLUMN IF NOT EXISTS fiscal_invoice_number VARCHAR(80)", MIGRATION_208)
        self.assertIn("ADD COLUMN IF NOT EXISTS fiscal_invoice_issued_at TIMESTAMPTZ", MIGRATION_208)
        self.assertIn("ADD COLUMN IF NOT EXISTS fiscal_invoice_issued_by UUID REFERENCES core.users(id)", MIGRATION_208)
        # No NOT NULL / DEFAULT that would force a value onto existing rows.
        self.assertNotIn("NOT NULL", MIGRATION_208)

    def test_statutory_profile_fiscal_device_columns_are_nullable_additions(self):
        self.assertIn("ADD COLUMN IF NOT EXISTS fiscal_device_serial VARCHAR(60)", MIGRATION_209)
        self.assertIn("ADD COLUMN IF NOT EXISTS fiscal_device_model VARCHAR(100)", MIGRATION_209)
        self.assertIn("ADD COLUMN IF NOT EXISTS fiscal_device_registered_at DATE", MIGRATION_209)
        self.assertNotIn("NOT NULL", MIGRATION_209)

    def test_statutory_profile_gets_an_id_column_for_the_generic_audit_trigger(self):
        # Regression guard for a real bug found during Phase 8B live
        # testing: finance.statutory_profile used organization_id as its
        # literal primary key (the only table in the schema doing so), and
        # core.process_audit_log() hardcodes NEW.id/OLD.id for every
        # audited table - the first ever write to this table raised
        # 'record "new" has no field "id"'. Reshaping to id + unique
        # (organization_id) was safe because the table had zero rows.
        self.assertIn("ADD COLUMN IF NOT EXISTS id UUID NOT NULL DEFAULT gen_random_uuid()", MIGRATION_210)
        self.assertIn("ADD CONSTRAINT statutory_profile_pkey PRIMARY KEY (id)", MIGRATION_210)
        self.assertIn("ADD CONSTRAINT statutory_profile_organization_id_key UNIQUE (organization_id)", MIGRATION_210)


class RecordFiscalInvoiceContractTests(unittest.TestCase):
    def _fn_body(self) -> str:
        return FINANCIAL_PERFORMANCE_ROUTER.split("async def record_progress_claim_fiscal_invoice")[1].split("\n\n\n@router")[0]

    def test_endpoint_exists_and_reuses_certify_permission(self):
        self.assertIn('@router.post("/progress-claims/{claim_id}/record-fiscal-invoice")', FINANCIAL_PERFORMANCE_ROUTER)
        self.assertIn('require_permission("finance.claim.certify")', self._fn_body())

    def test_only_accepts_a_certified_claim(self):
        fn_body = self._fn_body()
        self.assertIn("status = 'certified'", fn_body)

    def test_sets_all_three_fiscal_fields_and_transitions_status(self):
        fn_body = self._fn_body()
        self.assertIn("fiscal_invoice_number = :fiscal_invoice_number", fn_body)
        self.assertIn("fiscal_invoice_issued_at = NOW()", fn_body)
        self.assertIn("fiscal_invoice_issued_by = :user_id", fn_body)
        self.assertIn("status = 'invoiced'", fn_body)

    def test_never_touches_certified_amount_or_gl(self):
        # Strip the docstring (which legitimately explains, in prose, that
        # certified_amount/the GL journal are untouched) before asserting
        # the actual code never references either.
        fn_body = self._fn_body()
        code_only = fn_body.split('"""', 2)[-1]
        self.assertNotIn("certified_amount", code_only)
        self.assertNotIn("gl_bridge", code_only)
        self.assertNotIn("journal", code_only.lower())


class StatutoryProfileContractTests(unittest.TestCase):
    def test_get_and_put_endpoints_exist_with_correct_permissions(self):
        self.assertIn('@router.get("/profile")', FINANCE_STATUTORY_ROUTER)
        self.assertIn('@router.put("/profile")', FINANCE_STATUTORY_ROUTER)
        get_fn = FINANCE_STATUTORY_ROUTER.split('@router.get("/profile")')[1].split("\n\n\n@router")[0]
        put_fn = FINANCE_STATUTORY_ROUTER.split('@router.put("/profile")')[1].split("\n\n\n@router")[0]
        self.assertIn('require_permission("finance.statutory.read")', get_fn)
        self.assertIn('require_permission("finance.statutory.manage")', put_fn)

    def test_put_is_a_single_row_upsert_not_a_growing_table(self):
        put_fn = FINANCE_STATUTORY_ROUTER.split('@router.put("/profile")')[1].split("\n\n\n@router")[0]
        self.assertIn("ON CONFLICT (organization_id) DO UPDATE SET", put_fn)


class FiscalComplianceSummaryContractTests(unittest.TestCase):
    def _fn_body(self) -> str:
        return FINANCE_STATUTORY_ROUTER.split('@router.get("/fiscal-compliance/summary")')[1]

    def test_endpoint_exists_with_read_permission(self):
        self.assertIn('@router.get("/fiscal-compliance/summary")', FINANCE_STATUTORY_ROUTER)
        self.assertIn('require_permission("finance.statutory.read")', self._fn_body())

    def test_missing_invoice_query_filters_certified_without_fiscal_number(self):
        fn_body = self._fn_body()
        self.assertIn("pc.status = 'certified' AND pc.fiscal_invoice_number IS NULL", fn_body)

    def test_is_a_live_read_never_writes_a_finding(self):
        # Regression guard for the Phase 8C boundary: this endpoint must stay
        # a live-computed view, never grow into a stored/cron-driven finding.
        fn_body = self._fn_body()
        self.assertNotIn("INSERT INTO", fn_body)
        self.assertNotIn("ccb_monitor_findings", fn_body)
        self.assertNotIn("UPDATE finance.progress_claims", fn_body)


if __name__ == "__main__":
    unittest.main()
