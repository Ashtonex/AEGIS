from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
HR_PAGE = (
    ROOT.parent / "aegis-web" / "src" / "app" / "dashboard" / "hr" / "page.tsx"
).read_text(encoding="utf-8")


class HRFrontendContractTests(unittest.TestCase):
    """Guard HR workspace failures from being presented as empty operational records."""

    def test_hr_workspace_surfaces_data_load_failures(self):
        self.assertIn("HR data could not be loaded.", HR_PAGE)
        self.assertIn("Failed to load HR Workspace data.", HR_PAGE)
        self.assertIn(
            "The HR feed is still synchronizing. Please retry once the connection is ready.",
            HR_PAGE,
        )
        self.assertIn("Promise.allSettled", HR_PAGE)
        self.assertIn("Employee register could not be loaded.", HR_PAGE)
        self.assertIn("Attendance register could not be loaded.", HR_PAGE)
        self.assertIn("Leave register could not be loaded.", HR_PAGE)

    def test_hr_operational_sources_are_not_silently_masked_as_empty(self):
        self.assertNotIn("getHRLeaveRequests().catch", HR_PAGE)
        self.assertNotIn("getHREmployeeSkills(id).catch", HR_PAGE)
        self.assertNotIn("getHREmployeeCertifications(id).catch", HR_PAGE)
        self.assertNotIn("success: true, data: []", HR_PAGE)


if __name__ == "__main__":
    unittest.main()
