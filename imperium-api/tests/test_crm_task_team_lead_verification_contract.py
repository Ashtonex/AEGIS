from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
ROUTER = (ROOT / "routers" / "crm_tasks.py").read_text(encoding="utf-8")
TASKS_PAGE = (
    ROOT.parent / "aegis-web" / "src" / "app" / "dashboard" / "crm" / "tasks" / "page.tsx"
).read_text(encoding="utf-8")
MIGRATION = (ROOT / "migrations" / "145_task_team_lead_verification.sql").read_text(encoding="utf-8")


class CrmTaskTeamLeadVerificationContractTests(unittest.TestCase):
    def test_task_schema_tracks_review_submission_before_verification(self):
        self.assertIn("review_submitted_at TIMESTAMPTZ", MIGRATION)
        self.assertIn("review_submitted_by_user_id UUID REFERENCES core.users", MIGRATION)
        self.assertIn("idx_crm_tasks_under_review_team", MIGRATION)
        self.assertIn("idx_crm_tasks_under_review_approver", MIGRATION)

    def test_assignee_completion_submits_for_review_and_alerts_lead(self):
        self.assertIn("async def _is_task_verifier", ROUTER)
        self.assertIn("async def _notify_task_reviewers", ROUTER)
        self.assertIn("Task ready for verification", ROUTER)
        self.assertIn("Proof must be attached before this task can be submitted for completion.", ROUTER)
        self.assertIn('values["status"] = "under_review"', ROUTER)
        self.assertIn("review_submitted_at = NOW()", ROUTER)
        self.assertIn("review_submitted_by_user_id = :review_submitter_id", ROUTER)
        self.assertIn("Only the team lead or assigned approver can verify and complete this task.", ROUTER)
        self.assertIn("verified_by_user_id = :verifier_id, verified_at = NOW()", ROUTER)

    def test_distributed_tasks_keep_team_context_for_lead_visibility(self):
        self.assertIn("team link is", ROUTER)
        self.assertNotIn("assigned_to_team_id = NULL", ROUTER)
        self.assertIn("Submit proof for completion", TASKS_PAGE)
        self.assertIn("Verify submitted work", TASKS_PAGE)
        self.assertIn("Proof required", TASKS_PAGE)
        self.assertIn("Proof attached", TASKS_PAGE)


if __name__ == "__main__":
    unittest.main()
