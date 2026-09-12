from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
MIGRATION_206 = (ROOT / "migrations" / "206_finance_input_vat_findings.sql").read_text(encoding="utf-8")
MIGRATION_207 = (ROOT / "migrations" / "207_finance_gl_vat_bridge_mapping.sql").read_text(encoding="utf-8")
VAT_ENGINE = (ROOT / "app" / "services" / "finance" / "vat_engine.py").read_text(encoding="utf-8")
STATUTORY_GL_BRIDGE = (ROOT / "app" / "services" / "finance" / "statutory_gl_bridge.py").read_text(encoding="utf-8")
GL_BRIDGE = (ROOT / "app" / "services" / "finance" / "gl_bridge.py").read_text(encoding="utf-8")
PROCUREMENT_ROUTER = (ROOT / "routers" / "procurement.py").read_text(encoding="utf-8")
FINANCE_STATUTORY_ROUTER = (ROOT / "routers" / "finance_statutory.py").read_text(encoding="utf-8")


class MigrationContractTests(unittest.TestCase):
    def test_check_type_widened_backward_compatibly(self):
        for value in (
            "budget_boq_overrun", "requisition_budget_breach", "variance_stale_approval",
            "weekly_boq_pace_variance", "invoice_line_price_variance", "invoice_line_quantity_variance",
            "invoice_missing_po_or_grn", "duplicate_invoice_suspected", "invoice_unapproved_supplier",
            "supplier_bank_changed", "input_vat_rate_mismatch",
        ):
            self.assertIn(f"'{value}'", MIGRATION_206)

    def test_vat_mapping_keys_seeded_no_new_account(self):
        self.assertIn("statutory.vat_payable", MIGRATION_207)
        self.assertIn("statutory.vat_settlement_cash", MIGRATION_207)
        self.assertIn("'8000'", MIGRATION_207)
        self.assertIn("'1000'", MIGRATION_207)
        # No new chart-of-accounts row - 8000/1000 already exist (migration 180).
        self.assertNotIn("INSERT INTO finance.chart_of_accounts", MIGRATION_207)


class VatEngineServiceContractTests(unittest.TestCase):
    def test_net_position_filters_by_liability_type_vat_only(self):
        self.assertIn("liability_type = 'vat'", VAT_ENGINE)

    def test_net_position_groups_output_and_input_via_gross_accrued_offset(self):
        self.assertIn("gross_accrued", VAT_ENGINE)
        self.assertIn("offset_amount", VAT_ENGINE)
        self.assertIn("net_vat_payable", VAT_ENGINE)

    def test_fallback_period_is_explicitly_labeled_not_silently_guessed(self):
        self.assertIn("is_fallback_period", VAT_ENGINE)

    def test_never_recomputes_the_suppliers_own_charged_vat(self):
        # accrue_input_vat must accrue tax_amount as-charged, never a
        # recomputed expected_vat figure.
        fn_body = VAT_ENGINE.split("async def accrue_input_vat")[1].split("\n\nasync def ")[0]
        self.assertIn('computed_amount=float(inv["tax_amount"])', fn_body)
        self.assertNotIn("expected_vat", fn_body)

    def test_compliance_check_never_raises_past_its_own_boundary(self):
        for fn_name in ("accrue_input_vat", "check_input_vat_rate_mismatch"):
            fn_body = VAT_ENGINE.split(f"async def {fn_name}")[1].split("\n\nasync def ")[0] if f"\n\nasync def " in VAT_ENGINE.split(f"async def {fn_name}")[1] else VAT_ENGINE.split(f"async def {fn_name}")[1]
            self.assertIn("except Exception:", fn_body)

    def test_compliance_check_only_flags_claimable_invoices(self):
        fn_body = VAT_ENGINE.split("async def check_input_vat_rate_mismatch")[1]
        self.assertIn('not inv["input_vat_claimable"]', fn_body)

    def test_compliance_check_writes_via_procurement_verification_upsert(self):
        self.assertIn("procurement_verification.record_finding", VAT_ENGINE)
        self.assertIn('check_type="input_vat_rate_mismatch"', VAT_ENGINE)


class StatutoryGlBridgeContractTests(unittest.TestCase):
    def test_lives_in_a_separate_module_from_gl_bridge(self):
        # Regression guard for the Phase 2 assertion that gl_bridge.py never
        # touches the statutory shadow ledger - this bridge must live here
        # instead, not be folded back into gl_bridge.py.
        self.assertIn("async def propose_journal_for_vat_settlement", STATUTORY_GL_BRIDGE)
        self.assertNotIn("async def propose_journal_for_vat_settlement", GL_BRIDGE)

    def test_guards_on_vat_liability_type_and_a_real_cash_leg(self):
        fn_body = STATUTORY_GL_BRIDGE.split("async def propose_journal_for_vat_settlement")[1]
        self.assertIn('settlement["liability_type"] != "vat"', fn_body)
        self.assertIn('settlement["cashbook_transaction_id"] is None', fn_body)
        self.assertIn("return None", fn_body)

    def test_journal_debits_vat_payable_credits_settlement_cash(self):
        fn_body = STATUTORY_GL_BRIDGE.split("async def propose_journal_for_vat_settlement")[1]
        self.assertIn('"account_id": vat_payable_account, "debit_amount": amount', fn_body)
        self.assertIn('"account_id": settlement_cash_account, "credit_amount": amount', fn_body)

    def test_dedup_check_mirrors_established_pattern(self):
        self.assertIn('_already_proposed(db, org_id, "statutory_settlement", settlement_id)', STATUTORY_GL_BRIDGE)


class GlBridgeVatExtensionContractTests(unittest.TestCase):
    def test_progress_claim_vat_line_only_added_when_present(self):
        fn_body = GL_BRIDGE.split("async def propose_journal_for_progress_claim")[1].split("\n\nasync def ")[0]
        self.assertIn("if vat_amount > 0:", fn_body)
        self.assertIn('get_account_mapping(db, org_id, "statutory.vat_payable")', fn_body)

    def test_supplier_invoice_vat_split_only_when_claimable(self):
        fn_body = GL_BRIDGE.split("async def propose_journal_for_supplier_invoice_approval")[1]
        self.assertIn('if invoice["input_vat_claimable"] else 0.0', fn_body)
        self.assertIn("if input_vat > 0:", fn_body)

    def test_vat_free_record_produces_no_new_line(self):
        # Both extensions must be additive-only: the line is appended, never
        # unconditionally present, so a VAT-free claim/invoice keeps its
        # exact pre-Phase-8A line count.
        claim_fn = GL_BRIDGE.split("async def propose_journal_for_progress_claim")[1].split("\n\nasync def ")[0]
        self.assertIn("lines.append({\"account_id\": vat_payable_account_id, \"credit_amount\": vat_amount", claim_fn)
        invoice_fn = GL_BRIDGE.split("async def propose_journal_for_supplier_invoice_approval")[1]
        self.assertIn("lines.append({\"account_id\": vat_payable_account_id, \"debit_amount\": input_vat", invoice_fn)


class HookIntegrationContractTests(unittest.TestCase):
    def test_procurement_hooks_are_additive_and_non_blocking(self):
        self.assertIn("vat_engine.accrue_input_vat(db, org_id=user[\"org_id\"], invoice_id=invoice_id)", PROCUREMENT_ROUTER)
        self.assertIn("vat_engine.check_input_vat_rate_mismatch(db, org_id=user[\"org_id\"], invoice_id=invoice_id)", PROCUREMENT_ROUTER)

    def test_settle_liability_hook_is_non_blocking(self):
        settle_fn = FINANCE_STATUTORY_ROUTER.split("async def settle_liability")[1].split("\n\n@router")[0]
        self.assertIn("statutory_gl_bridge.propose_journal_for_vat_settlement", settle_fn)
        self.assertIn("except GeneralLedgerError as exc:", settle_fn)
        self.assertIn("gl_proposal_warning", settle_fn)

    def test_net_position_endpoint_reuses_existing_permission(self):
        self.assertIn('@router.get("/vat/net-position")', FINANCE_STATUTORY_ROUTER)
        endpoint_fn = FINANCE_STATUTORY_ROUTER.split('@router.get("/vat/net-position")')[1].split("\n\n\n")[0]
        self.assertIn('require_permission("finance.statutory.read")', endpoint_fn)


if __name__ == "__main__":
    unittest.main()
