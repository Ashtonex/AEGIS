import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[2]
CRM_CONTACTS_PAGE = (
    ROOT / "aegis-web" / "src" / "app" / "dashboard" / "crm" / "contacts" / "page.tsx"
)
CRM_ORGS_PAGE = (
    ROOT
    / "aegis-web"
    / "src"
    / "app"
    / "dashboard"
    / "crm"
    / "organizations"
    / "page.tsx"
)
CRM_SUBS_PAGE = (
    ROOT
    / "aegis-web"
    / "src"
    / "app"
    / "dashboard"
    / "crm"
    / "subcontractors"
    / "page.tsx"
)
CRM_DOCUMENTS_PAGE = (
    ROOT / "aegis-web" / "src" / "app" / "dashboard" / "crm" / "documents" / "page.tsx"
)
CRM_INBOX_PAGE = (
    ROOT / "aegis-web" / "src" / "app" / "dashboard" / "crm" / "inbox" / "page.tsx"
)
CRM_LEADS_PAGE = (
    ROOT / "aegis-web" / "src" / "app" / "dashboard" / "crm" / "leads" / "page.tsx"
)
CRM_AUTOMATIONS_PAGE = (
    ROOT
    / "aegis-web"
    / "src"
    / "app"
    / "dashboard"
    / "crm"
    / "automations"
    / "page.tsx"
)


class CrmNoFakeRecordsContract(unittest.TestCase):
    """CRM dashboard records are enterprise records; failures must not inject demo companies or people."""

    def test_contacts_registry_has_no_runtime_fallback_records_or_local_failed_writes(
        self,
    ):
        source = CRM_CONTACTS_PAGE.read_text(encoding="utf-8")

        self.assertNotIn("FALLBACK_CONTACTS", source)
        self.assertNotIn("FALLBACK_ACTIVITIES", source)
        self.assertNotIn("Dr. Davison Mpofu", source)
        self.assertNotIn("Sarah Jenkins", source)
        self.assertNotIn("Activity logged locally", source)
        self.assertNotIn("Updated contact details locally", source)
        self.assertNotIn("Contact added locally", source)
        self.assertIn("Contacts could not be loaded from the CRM service.", source)
        self.assertIn("Contact details were not saved.", source)
        self.assertIn("Contact was not created.", source)
        self.assertNotIn("`contact-${Date.now()}`", source)
        self.assertNotIn("`act-${Date.now()}`", source)
        self.assertIn("CRM contact response did not include an id.", source)
        self.assertIn("CRM activity response did not include an id.", source)

    def test_client_organizations_registry_has_no_runtime_fallback_records_or_local_failed_writes(
        self,
    ):
        source = CRM_ORGS_PAGE.read_text(encoding="utf-8")

        self.assertNotIn("FALLBACK_ORGS", source)
        self.assertNotIn("FALLBACK_CONTACTS", source)
        self.assertNotIn("FALLBACK_ACTIVITIES", source)
        self.assertNotIn("Apex Mining Corporation", source)
        self.assertNotIn("National Housing & Infrastructure Agency", source)
        self.assertNotIn("Updated credit limits locally", source)
        self.assertNotIn("Logged CRM activity locally", source)
        self.assertNotIn("Account registered locally", source)
        self.assertIn(
            "Client organizations could not be loaded from the CRM service.", source
        )
        self.assertIn("Credit limits were not saved.", source)
        self.assertIn("Client account was not created.", source)
        self.assertNotIn("`org-${Date.now()}`", source)
        self.assertNotIn("`act-${Date.now()}`", source)
        self.assertIn("CRM organization response did not include an id.", source)
        self.assertIn("CRM activity response did not include an id.", source)

    def test_subcontractor_registry_does_not_use_legacy_sample_records_at_runtime(self):
        source = CRM_SUBS_PAGE.read_text(encoding="utf-8")

        self.assertNotIn("FALLBACK_SUBS", source)
        self.assertNotIn("Apex Earthworks Ltd", source)
        self.assertNotIn("Zesa Tech Electricals", source)
        self.assertNotIn("setSubs(FALLBACK_SUBS)", source)
        self.assertNotIn("`sub-${Date.now()}`", source)
        self.assertIn("setSubs([])", source)
        self.assertIn("Subcontractor response did not include an id.", source)

    def test_crm_documents_do_not_synthesize_version_history(self):
        source = CRM_DOCUMENTS_PAGE.read_text(encoding="utf-8")

        self.assertNotIn("generateSyntheticVersions", source)
        self.assertNotIn("Inject synthetic version history", source)
        self.assertNotIn("Math.random()", source)
        self.assertNotIn("S. Nzewi", source)
        self.assertIn(
            "versions: Array.isArray(doc.versions) ? doc.versions : []", source
        )
        self.assertIn(
            "CRM documents could not be loaded from the document service.", source
        )

    def test_crm_inbox_does_not_append_mock_threads_or_mark_failed_replies_sent(self):
        source = CRM_INBOX_PAGE.read_text(encoding="utf-8")

        self.assertNotIn("mockWhatsAppThreads", source)
        self.assertNotIn("Dr. Davison Mpofu", source)
        self.assertNotIn("Apex Mining Corporation", source)
        self.assertNotIn("Message sent via", source)
        self.assertNotIn("Gateway (Local)", source)
        self.assertIn("Reply was not recorded.", source)

    def test_crm_leads_external_source_panels_are_not_seeded_with_mock_opportunities(
        self,
    ):
        source = CRM_LEADS_PAGE.read_text(encoding="utf-8")

        self.assertNotIn("mockProspects", source)
        self.assertNotIn("mockScrapedTenders", source)
        self.assertNotIn("mockLinkedInProfiles", source)
        self.assertNotIn("Mutare Bypass Dualization", source)
        self.assertNotIn("Zimplats Vendor Portal", source)
        self.assertNotIn("Lead queued locally", source)
        self.assertNotIn("Telemetry saved locally", source)
        self.assertIn("const externalProspects: ExternalProspectSignal[] = [];", source)
        self.assertIn("getCrmTenderSignals", source)
        self.assertIn("setExternalTenderSignals(response.data)", source)
        self.assertIn(
            "const externalLinkedInProfiles: ExternalLinkedInProfile[] = [];", source
        )

    def test_crm_automations_do_not_seed_fallback_rules_or_fake_execution_logs(self):
        source = CRM_AUTOMATIONS_PAGE.read_text(encoding="utf-8")

        self.assertNotIn("fallbackRules", source)
        self.assertNotIn("High Value Lead Routing", source)
        self.assertNotIn("Tender Watchdog Protocol", source)
        self.assertNotIn("Workflow deployed locally", source)
        self.assertNotIn("Rule state modified locally", source)
        self.assertNotIn("Rule deleted locally", source)
        self.assertNotIn("Math.random()", source)
        self.assertIn(
            "Automation rules could not be loaded from the CRM service.", source
        )
        self.assertIn("No production telemetry was written.", source)


if __name__ == "__main__":
    unittest.main()
