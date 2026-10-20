from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
CRM_ROUTER = (ROOT / "routers" / "crm.py").read_text(encoding="utf-8")
CRM_PAGE = (
    ROOT.parent
    / "aegis-web"
    / "src"
    / "app"
    / "dashboard"
    / "crm"
    / "opportunities"
    / "page.tsx"
).read_text(encoding="utf-8")


class CrmOpportunitiesContractTests(unittest.TestCase):
    """Guard CRM opportunity loading against whole-page aborts."""

    def test_crm_opportunities_workspace_degrades_partial_sources(self):
        self.assertIn("Promise.allSettled", CRM_PAGE)
        self.assertIn(
            "The CRM feed is still synchronizing. Please retry once the connection is ready.",
            CRM_PAGE,
        )
        self.assertIn("Opportunities could not be loaded.", CRM_PAGE)
        self.assertIn("Contacts could not be loaded.", CRM_PAGE)
        self.assertIn("Activity log could not be loaded.", CRM_PAGE)

    def test_crm_opportunities_workspace_does_not_reintroduce_simple_hard_fail_loading(
        self,
    ):
        self.assertNotIn(
            "const [oppsRes, contactsRes, activitiesRes] = await Promise.all([",
            CRM_PAGE,
        )
        self.assertNotIn("getCrmOpportunities().catch", CRM_PAGE)
        self.assertNotIn("getCrmContacts().catch", CRM_PAGE)
        self.assertNotIn("getCrmActivities().catch", CRM_PAGE)

    def test_opportunity_stage_move_has_real_timestamp_and_failure_visibility(self):
        self.assertIn("next_activity_due_at: Optional[datetime]", CRM_ROUTER)
        self.assertIn("def normalize_next_activity_due_at", CRM_ROUTER)
        self.assertIn('isinstance(params.get("next_activity_due_at"), str)', CRM_ROUTER)
        self.assertIn("return rawMessage || fallback", CRM_PAGE)


    def test_opportunity_board_route_not_shadowed_by_parameterized_id(self):
        board_index = CRM_ROUTER.index('@router.get("/opportunities/board")')
        duplicates_index = CRM_ROUTER.index('@router.get("/opportunities/duplicates")')
        item_index = CRM_ROUTER.index('@router.get("/opportunities/{opportunity_id}")')
        self.assertLess(
            board_index,
            item_index,
            "FastAPI evaluates routes sequentially: /opportunities/board must be declared before /opportunities/{opportunity_id} to avoid 422 UUID validation failures.",
        )
        self.assertLess(
            duplicates_index,
            item_index,
            "FastAPI evaluates routes sequentially: /opportunities/duplicates must be declared before /opportunities/{opportunity_id}.",
        )

    def test_concurrent_duplicate_prevention_locking(self):
        """Verifies row-level locking (FOR UPDATE OF o) in quote creation and mark-won transactions."""
        quote_def = CRM_ROUTER.index('@router.post("/opportunities/{opportunity_id}/create-quotation"')
        won_def = CRM_ROUTER.index('@router.post("/opportunities/{opportunity_id}/mark-won")')
        lost_def = CRM_ROUTER.index('@router.post("/opportunities/{opportunity_id}/mark-lost")')

        quote_code = CRM_ROUTER[quote_def:won_def]
        won_code = CRM_ROUTER[won_def:lost_def]

        self.assertIn("FOR UPDATE OF o", quote_code, "Quote creation must serialize concurrent requests with row-level locking")
        self.assertIn("FOR UPDATE OF o", won_code, "Mark-won must serialize concurrent handoffs with row-level locking")
        self.assertIn("existing_proj", won_code, "Mark-won must check for existing linked project to prevent duplicate projects")

    def test_won_and_lost_are_alternative_terminal_outcomes(self):
        """Verifies Won and Lost are treated as terminal outcomes, not sequential steps."""
        self.assertIn("CLOSED_FRONTEND_STAGES", CRM_PAGE)
        self.assertIn("Terminal closed stages cannot be stepped sequentially", CRM_PAGE)
        self.assertIn("ACTIVE_STAGES = ['Qualification', 'Proposal', 'Negotiation']", CRM_PAGE)

    def test_operational_database_guard_blocks_mutations_when_live_pooler_detected(self):
        """Verifies that assert_mutation_allowed_for_testing raises OperationalDatabaseProtectionError when targeting operational db."""
        import sys
        from unittest.mock import patch
        if str(ROOT) not in sys.path:
            sys.path.insert(0, str(ROOT))
        from core.config import settings
        from core.database import assert_mutation_allowed_for_testing, OperationalDatabaseProtectionError
        with patch.object(settings, "DATABASE_URL", "postgresql://test@aws-0-eu-west-1.pooler.supabase.com/mzwwkwokpakdweyyscef"):
            with self.assertRaises(OperationalDatabaseProtectionError):
                assert_mutation_allowed_for_testing()


if __name__ == "__main__":
    unittest.main()


