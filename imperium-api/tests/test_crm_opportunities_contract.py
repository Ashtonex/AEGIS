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


if __name__ == "__main__":
    unittest.main()

