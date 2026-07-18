from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT.parent / "aegis-web"
PROFILES_ROUTER = (ROOT / "routers" / "profiles.py").read_text(encoding="utf-8")
MIGRATION = (ROOT / "migrations" / "032_employee_onboarding_tour.sql").read_text(
    encoding="utf-8"
)
SHELL = (WEB_ROOT / "src" / "app" / "dashboard" / "DashboardShell.tsx").read_text(
    encoding="utf-8"
)
TOUR = (WEB_ROOT / "src" / "components" / "onboarding" / "DashboardTour.tsx").read_text(
    encoding="utf-8"
)


class OnboardingTourContractTests(unittest.TestCase):
    def test_backend_profile_persists_onboarding_completion(self):
        self.assertIn("onboarding_completed_at", PROFILES_ROUTER)
        self.assertIn("ProfileUpdate.model_fields", PROFILES_ROUTER)
        self.assertIn("touch_profile_completed_at=True", PROFILES_ROUTER)

    def test_database_migration_adds_onboarding_marker(self):
        self.assertIn("ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ", MIGRATION)

    def test_dashboard_shell_wires_tour_anchors_and_replay(self):
        self.assertIn('data-tour="dashboard-search"', SHELL)
        self.assertIn('data-tour="dashboard-nav"', SHELL)
        self.assertIn('data-tour="dashboard-profile"', SHELL)
        self.assertIn("Replay onboarding tour", SHELL)
        self.assertIn("onboarding_completed_at", SHELL)

    def test_tour_component_is_step_based_and_dismissible(self):
        self.assertIn("Step {stepIndex + 1} of {STEPS.length}", TOUR)
        self.assertIn("Skip tour", TOUR)
        self.assertIn("Finish", TOUR)
        self.assertIn("createPortal", TOUR)


if __name__ == "__main__":
    unittest.main()
