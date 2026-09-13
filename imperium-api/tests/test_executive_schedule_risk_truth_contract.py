from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parent.parent
EXECUTIVE = (ROOT / "routers" / "executive.py").read_text(encoding="utf-8")


class ExecutiveScheduleRiskTruthContractTests(unittest.TestCase):
    """GET /executive/projects/{id}/schedule-risk used to run the exact
    same Monte Carlo simulation for every project in the organization,
    off 4 hardcoded "standard civil engineering milestones" with fixed
    optimistic/most-likely/pessimistic durations - it never varied by
    project at all, and there was no fallback path because it was the
    only path. These tests pin the fix: task durations are now derived
    from the project's own projects.project_milestones dates, and a
    project with no usable milestone data returns UNKNOWN with a reason
    instead of the same fabricated 4-task template every time.
    """

    def test_hardcoded_milestone_template_is_gone(self):
        self.assertNotIn("Site Mobilization & Excavation", EXECUTIVE)
        self.assertNotIn("Substructure & Foundation Concrete", EXECUTIVE)
        self.assertNotIn('"baseline_weeks": 15.0', EXECUTIVE)

    def test_tasks_are_derived_from_real_project_milestones(self):
        self.assertIn("FROM projects.project_milestones", EXECUTIVE)
        self.assertIn("status NOT IN ('complete', 'cancelled')", EXECUTIVE)
        self.assertIn('"truth_status": "SYSTEM_GENERATED"', EXECUTIVE)

    def test_no_usable_milestone_reports_unknown_not_fabricated_data(self):
        self.assertIn('"truth_status": "UNKNOWN"', EXECUTIVE)
        self.assertIn("cannot be simulated without any milestone data", EXECUTIVE)

    def test_excluded_milestones_are_counted_not_silently_dropped(self):
        self.assertIn("milestones_excluded_no_dates", EXECUTIVE)


if __name__ == "__main__":
    unittest.main()
