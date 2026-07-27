from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]

CONSOLIDATION_MIGRATION = (
    ROOT / "migrations" / "043_crm_schema_consolidation.sql"
).read_text(encoding="utf-8")
SUPPORT_DESK_MIGRATION = (
    ROOT / "migrations" / "044_crm_support_desk_hardening.sql"
).read_text(encoding="utf-8")
FORWARD_COMPAT_REPAIR_MIGRATION = (
    ROOT / "migrations" / "047_crm_forward_compatibility_repair.sql"
).read_text(encoding="utf-8")
PUBLIC_INTAKE_ROUTER = (ROOT / "routers" / "public_intake.py").read_text(encoding="utf-8")
CRM_COMMUNICATIONS_ROUTER = (ROOT / "routers" / "crm_communications.py").read_text(encoding="utf-8")
CRM_IMPORT_EXPORT_ROUTER = (ROOT / "routers" / "crm_import_export.py").read_text(encoding="utf-8")


class CrmPhase12ProductionReadinessContract(unittest.TestCase):
    """Guards the Phase 12 production-hardening work: schema consolidation,
    RLS/audit trigger reconciliation, orphaned permission cleanup, and public
    endpoint rate limiting. These are migration/router-content checks (this
    repo's established convention for guarding SQL/permission drift) rather
    than live-database assertions."""

    def test_applied_consolidation_migration_is_not_rewritten(self):
        # 043 has already been applied in Supabase-backed environments. Its contents
        # stay immutable so the migration ledger checksum remains honest.
        self.assertIn('DROP COLUMN IF EXISTS channel', CONSOLIDATION_MIGRATION)
        self.assertIn('DROP TABLE IF EXISTS crm.win_loss_reasons', CONSOLIDATION_MIGRATION)

    def test_consolidation_migration_reconciles_rls_to_tenant_isolation_policy(self):
        self.assertIn('CRM tenant service role', CONSOLIDATION_MIGRATION)
        self.assertIn('Tenant Isolation Policy', CONSOLIDATION_MIGRATION)
        self.assertIn('CRM communication service role only', CONSOLIDATION_MIGRATION)
        for table in ('nurture_sequences', 'pipeline_stages', 'sequence_steps'):
            self.assertIn(table, CONSOLIDATION_MIGRATION)

    def test_forward_compatibility_repair_is_additive_and_restores_legacy_surface(self):
        self.assertNotIn('DROP COLUMN', FORWARD_COMPAT_REPAIR_MIGRATION)
        self.assertNotIn('DROP TABLE', FORWARD_COMPAT_REPAIR_MIGRATION)
        self.assertNotIn('DELETE FROM core.role_permissions', FORWARD_COMPAT_REPAIR_MIGRATION)
        self.assertNotIn('DELETE FROM core.permissions', FORWARD_COMPAT_REPAIR_MIGRATION)
        for column in (
            'ADD COLUMN IF NOT EXISTS channel',
            'ADD COLUMN IF NOT EXISTS rules JSONB',
            'ADD COLUMN IF NOT EXISTS member_status',
        ):
            self.assertIn(column, FORWARD_COMPAT_REPAIR_MIGRATION)
        for key in (
            'crm.campaigns.read', 'crm.segments.read', 'crm.templates.read',
            'crm.opportunities.read', 'crm.opportunities.update',
        ):
            self.assertIn(key, FORWARD_COMPAT_REPAIR_MIGRATION)

    def test_automation_rules_gains_the_crud_columns_the_router_actually_uses(self):
        # crm_automations.py's CRUD reads/writes trigger_conditions/action_type/action_config;
        # crm.automation_rules was only ever created with conditions/actions/retry_policy.
        self.assertIn('trigger_conditions', CONSOLIDATION_MIGRATION)
        self.assertIn('action_type', CONSOLIDATION_MIGRATION)
        self.assertIn('action_config', CONSOLIDATION_MIGRATION)

    def test_support_desk_migration_adds_escalation_and_reopen_tracking(self):
        self.assertIn('reopen_count', SUPPORT_DESK_MIGRATION)
        self.assertIn('escalated_at', SUPPORT_DESK_MIGRATION)
        self.assertIn('escalated_to', SUPPORT_DESK_MIGRATION)
        self.assertIn('escalation_reason', SUPPORT_DESK_MIGRATION)

    def test_public_intake_endpoints_are_rate_limited(self):
        for endpoint_marker in ('"/enquiry"', '"/supplier"', '"/application"', '"/tender-interest/{tender_id}"'):
            self.assertIn(endpoint_marker, PUBLIC_INTAKE_ROUTER)
        self.assertIn('from core.rate_limit import limiter', PUBLIC_INTAKE_ROUTER)
        self.assertGreaterEqual(PUBLIC_INTAKE_ROUTER.count('@limiter.limit('), 4)

    def test_webhook_tenant_resolution_no_longer_blindly_picks_first_organization(self):
        self.assertIn('_single_tenant_org_id', CRM_COMMUNICATIONS_ROUTER)
        self.assertNotIn(
            'for item in row:\n        return str(item["organization_id"])',
            CRM_COMMUNICATIONS_ROUTER,
        )

    def test_import_export_permissions_are_distinct_from_generic_crud_keys(self):
        self.assertIn('crm.import', CRM_IMPORT_EXPORT_ROUTER)
        self.assertIn('crm.export', CRM_IMPORT_EXPORT_ROUTER)


if __name__ == "__main__":
    unittest.main()
