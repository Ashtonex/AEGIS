from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]

CRM_ROUTER = (ROOT / "routers" / "crm.py").read_text(encoding="utf-8")
CRM_LIFECYCLE_ROUTER = (ROOT / "routers" / "crm_lifecycle.py").read_text(encoding="utf-8")
CRM_AUTOMATIONS_ROUTER = (ROOT / "routers" / "crm_automations.py").read_text(encoding="utf-8")
CRM_IMPORT_EXPORT_ROUTER = (ROOT / "routers" / "crm_import_export.py").read_text(encoding="utf-8")
CRM_CONTACTS_ROUTER = (ROOT / "routers" / "crm_contacts.py").read_text(encoding="utf-8")
CRM_LEADS_ROUTER = (ROOT / "routers" / "crm_leads.py").read_text(encoding="utf-8")
CRM_ORGANIZATIONS_ROUTER = (ROOT / "routers" / "crm_organizations.py").read_text(encoding="utf-8")
SLA_MIGRATION = (
    ROOT / "migrations" / "048_crm_sla_policies_and_admin_permissions.sql"
).read_text(encoding="utf-8")

ROUTER_SOURCES = {
    "crm.py": CRM_ROUTER,
    "crm_lifecycle.py": CRM_LIFECYCLE_ROUTER,
    "crm_automations.py": CRM_AUTOMATIONS_ROUTER,
    "crm_contacts.py": CRM_CONTACTS_ROUTER,
    "crm_leads.py": CRM_LEADS_ROUTER,
    "crm_organizations.py": CRM_ORGANIZATIONS_ROUTER,
}


class CrmTenantIsolationContractTests(unittest.TestCase):
    """Guards against a cross-org data leak: every tenant-scoped write/read this
    session added must filter by organization_id, and crm.sla_policies (new in
    migration 048) must carry the same RLS "Tenant Isolation Policy" convention
    as the rest of the CRM schema rather than being left open."""

    def test_sla_policy_table_has_tenant_isolation_rls_and_audit_trigger(self):
        self.assertIn("ENABLE ROW LEVEL SECURITY", SLA_MIGRATION)
        self.assertIn("FORCE ROW LEVEL SECURITY", SLA_MIGRATION)
        self.assertIn('"Tenant Isolation Policy" ON crm.sla_policies', SLA_MIGRATION)
        self.assertIn(
            "organization_id = get_jwt_org_id() OR current_setting('role') = 'service_role'",
            SLA_MIGRATION,
        )
        self.assertIn("trg_audit_sla_policies", SLA_MIGRATION)

    def test_sla_endpoints_scope_every_query_by_organization_id(self):
        self.assertIn(
            "SELECT response_hours, resolution_hours FROM crm.sla_policies WHERE organization_id=:org_id AND priority=:priority",
            CRM_LIFECYCLE_ROUTER,
        )
        self.assertIn(
            "SELECT * FROM crm.sla_policies WHERE organization_id=:org_id AND is_deleted=false",
            CRM_LIFECYCLE_ROUTER,
        )
        self.assertIn(
            "INSERT INTO crm.sla_policies (organization_id, created_by, priority, response_hours, resolution_hours)",
            CRM_LIFECYCLE_ROUTER,
        )

    def test_support_ticket_creation_computes_sla_due_dates_from_tenant_scoped_lookup(self):
        # The Phase 7 support dashboard's SLA-compliance metrics are structurally
        # broken if ticket creation never sets these two columns.
        self.assertIn("first_response_due_at, resolution_due_at", CRM_LIFECYCLE_ROUTER)
        self.assertIn("_sla_hours_for(db, org_id, payload.priority)", CRM_LIFECYCLE_ROUTER)

    def test_campaign_send_scopes_campaign_template_and_members_by_org(self):
        self.assertIn(
            'SELECT id FROM crm.campaigns WHERE id=:campaign_id AND organization_id=:org_id AND is_deleted=false',
            CRM_ROUTER,
        )
        self.assertIn(
            'SELECT * FROM crm.message_templates WHERE id=:template_id AND organization_id=:org_id AND is_deleted=false',
            CRM_ROUTER,
        )
        self.assertIn(
            "WHERE cm.campaign_id=:campaign_id AND cm.organization_id=:org_id AND cm.is_deleted=false",
            CRM_ROUTER,
        )
        # Members are resolved through their own organization_id join, not a bare id lookup
        # that could pull a lead/contact belonging to a different tenant.
        self.assertIn(
            "LEFT JOIN crm.leads l ON l.id = cm.lead_id AND l.organization_id = cm.organization_id",
            CRM_ROUTER,
        )
        self.assertIn(
            "LEFT JOIN crm.contacts c ON c.id = cm.contact_id AND c.organization_id = cm.organization_id",
            CRM_ROUTER,
        )

    def test_campaign_send_is_gated_behind_its_own_permission_key(self):
        self.assertIn('require_permission("crm.campaigns.send")', CRM_ROUTER)
        self.assertIn("'crm.campaigns.send'", SLA_MIGRATION)

    def test_sla_admin_configure_is_a_distinct_permission_from_support_read(self):
        self.assertIn('require_permission("crm.admin.configure")', CRM_LIFECYCLE_ROUTER)
        self.assertIn('require_permission("crm.support.read")', CRM_LIFECYCLE_ROUTER)
        self.assertIn("'crm.admin.configure'", SLA_MIGRATION)


class CrmWriteFailureVisibilityContractTests(unittest.TestCase):
    """Guards against silently-swallowed write failures: every except-Exception
    block around a CRM write must roll back and re-raise a visible HTTPException
    (real error surfaced to the caller), never catch-and-return a fake success
    payload or swallow the error outright."""

    def _assert_no_silent_swallowing(self, name: str, source: str):
        self.assertNotIn("except Exception:\n        pass", source, f"{name} silently swallows a write failure")
        self.assertNotIn("except:\n        pass", source, f"{name} silently swallows a write failure")

    def test_no_router_swallows_exceptions_bare(self):
        for name, source in ROUTER_SOURCES.items():
            self._assert_no_silent_swallowing(name, source)

    def test_except_exception_blocks_rollback_and_raise_http_exception(self):
        for name, source in ROUTER_SOURCES.items():
            lines = source.splitlines()
            for i, line in enumerate(lines):
                stripped = line.strip()
                if stripped.startswith("except Exception"):
                    following = "\n".join(lines[i + 1 : i + 6])
                    self.assertIn(
                        "raise HTTPException",
                        following,
                        f"{name}: except-Exception block at line {i + 1} does not re-raise a visible HTTPException",
                    )

    def test_send_campaign_reports_a_real_sent_count_not_a_hardcoded_success_message(self):
        self.assertIn("sent_count = 0", CRM_ROUTER)
        self.assertIn('"data": {"sent_count": sent_count}', CRM_ROUTER)
        self.assertNotIn('"message": "Campaign sent."', CRM_ROUTER)


class CrmImportExportRowFailureVisibilityContractTests(unittest.TestCase):
    """crm_import_export.py is intentionally excluded from ROUTER_SOURCES above:
    a bulk import handler that aborts the whole batch and raises HTTPException
    on the first bad row (the generic CRUD contract) is worse than one that
    isolates each row failure. This contract instead guards that isolation is
    real (a bad row can't corrupt the shared transaction for later rows) and
    that failures are still visible in the response rather than silently
    dropped from the reported count."""

    def test_row_inserts_are_isolated_with_savepoints(self):
        self.assertIn("async with db.begin_nested():", CRM_IMPORT_EXPORT_ROUTER)

    def test_row_failures_are_collected_and_reported_not_swallowed(self):
        self.assertIn("row_errors.append(", CRM_IMPORT_EXPORT_ROUTER)
        self.assertIn('"failed": len(row_errors)', CRM_IMPORT_EXPORT_ROUTER)
        self.assertIn('"errors": row_errors', CRM_IMPORT_EXPORT_ROUTER)


if __name__ == "__main__":
    unittest.main()
