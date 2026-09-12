from datetime import date, timedelta
from pathlib import Path
import unittest

from app.services.tenders.compliance_matching import match_requirement_to_credential
from app.services.tenders.compliance_readiness import compute_compliance_readiness

ROOT = Path(__file__).resolve().parents[1]

MIGRATION = (ROOT / "migrations" / "199_tender_requirements_library_and_matrix.sql").read_text(encoding="utf-8")
SUPABASE_MIGRATION = (
    ROOT.parent / "supabase" / "migrations" / "20260911001200_tender_requirements_library_and_matrix.sql"
).read_text(encoding="utf-8")
TENDER_BIDS_ROUTER = (ROOT / "routers" / "tender_bids.py").read_text(encoding="utf-8")


def _tender(**overrides):
    base = {"id": "t1", "submission_deadline": date.today() + timedelta(days=14)}
    base.update(overrides)
    return base


def _requirement(**overrides):
    base = {
        "id": "r1",
        "maps_to_credential_type": "praz_registration",
        "required_category": None,
        "required_classification": None,
        "status": "PENDING",
    }
    base.update(overrides)
    return base


def _credential(**overrides):
    base = {
        "id": "c1",
        "credential_type": "praz_registration",
        "category": None,
        "classification_grade": None,
        "status": "valid",
        "expiry_date": date.today() + timedelta(days=180),
        "is_deleted": False,
    }
    base.update(overrides)
    return base


class ComplianceMatrixMigrationContractTests(unittest.TestCase):
    def test_migration_mirrored_byte_identical_into_supabase_tree(self):
        self.assertEqual(MIGRATION, SUPABASE_MIGRATION)

    def test_requirements_library_has_18_categories_and_no_bundled_checkbox(self):
        categories = (
            "CORPORATE_LEGAL", "PRAZ", "ZIMRA_TAX", "NSSA", "CONSTRUCTION_REGISTRATION",
            "TENDER_FORMS_DECLARATIONS", "BID_SECURITY", "FINANCIAL_CAPACITY",
            "COMMERCIAL_BOQ", "TECHNICAL_CAPABILITY", "EXPERIENCE_REFERENCES",
            "KEY_PERSONNEL", "PLANT_EQUIPMENT", "HSE_ENVIRONMENTAL", "INSURANCE",
            "SITE_VISIT", "TENDER_SPECIFIC_FEES", "POST_AWARD",
        )
        self.assertEqual(len(categories), 18)
        for category in categories:
            self.assertIn(f"'{category}'", MIGRATION)
        self.assertNotIn("'Company Documents'", MIGRATION)
        # Individually named, not one bundled row.
        self.assertIn("'Certificate of Incorporation'", MIGRATION)
        self.assertIn("'CR6'", MIGRATION)
        self.assertIn("'CR14 / Current Company Particulars'", MIGRATION)

    def test_matrix_extends_existing_table_without_dropping_columns(self):
        self.assertIn("ALTER TABLE crm.tender_requirements", MIGRATION)
        self.assertNotIn("DROP COLUMN", MIGRATION)
        self.assertIn("ADD COLUMN IF NOT EXISTS severity", MIGRATION)
        self.assertIn("ADD COLUMN IF NOT EXISTS status", MIGRATION)

    def test_backfill_never_invents_missing_or_fatal_for_historical_rows(self):
        self.assertIn("CASE WHEN is_satisfied THEN 'SATISFIED' ELSE 'PENDING' END", MIGRATION)
        # The false/null-flag branch must not exist for the legacy booleans.
        self.assertNotIn("t.praz_registration IS FALSE", MIGRATION)
        self.assertNotIn("t.nssa_clearance IS FALSE", MIGRATION)

    def test_status_enum_matches_spec_ten_values(self):
        for status_value in (
            "PRESENT", "MISSING", "EXPIRED", "EXPIRING", "WRONG_CATEGORY",
            "WRONG_CLASSIFICATION", "UNVERIFIED", "PENDING", "SATISFIED", "NOT_APPLICABLE",
        ):
            self.assertIn(f"'{status_value}'", MIGRATION)

    def test_source_column_reserves_ai_extracted_unverified_for_future_phase(self):
        self.assertIn("'AI_EXTRACTED_UNVERIFIED'", MIGRATION)


class TenderBidsRouterContractTests(unittest.TestCase):
    def test_new_compliance_endpoints_exist(self):
        self.assertIn('@router.post("/{tender_id}/requirements/seed-from-library")', TENDER_BIDS_ROUTER)
        self.assertIn('@router.post("/{tender_id}/requirements/{requirement_id}/match-credential")', TENDER_BIDS_ROUTER)
        self.assertIn('@router.get("/{tender_id}/compliance-summary")', TENDER_BIDS_ROUTER)

    def test_seed_from_library_uses_one_set_based_insert_not_a_per_row_loop(self):
        # Regression: this endpoint used to loop one INSERT per library
        # template (~80 rows) - 80 sequential awaited round-trips. Under
        # this deployment's slower pooler connections that reliably timed
        # out as a 502 in the browser. Confirm it's a single INSERT...
        # SELECT instead.
        section = TENDER_BIDS_ROUTER.split("async def seed_requirements_from_library")[1].split(
            "async def match_requirement_credential"
        )[0]
        self.assertIn("INSERT INTO crm.tender_requirements", section)
        self.assertIn("SELECT :org_id, :tender_id, tpl.requirement_name", section)
        self.assertNotIn("for template in templates:", section)

    def test_compliance_summary_labeled_compliance_only(self):
        self.assertIn("is_compliance_only", TENDER_BIDS_ROUTER)


class MatchRequirementToCredentialTests(unittest.TestCase):
    """Covers the target spec's Part 43 test cases that apply to this phase."""

    def test_test1_valid_matching_praz_credential_is_satisfied(self):
        result = match_requirement_to_credential(_requirement(), _tender(), [_credential()])
        self.assertEqual(result["status"], "SATISFIED")
        self.assertEqual(result["credential_id"], "c1")
        self.assertTrue(result["valid_through_closing"])

    def test_test2_wrong_classification_is_flagged_not_silently_satisfied(self):
        requirement = _requirement(
            maps_to_credential_type="zbca_registration",
            required_category="civil engineering",
            required_classification="grade x",
        )
        credential = _credential(
            credential_type="zbca_registration",
            category="civil engineering",
            classification_grade="grade y",
        )
        result = match_requirement_to_credential(requirement, _tender(), [credential])
        self.assertEqual(result["status"], "WRONG_CLASSIFICATION")
        self.assertFalse(result["correct_classification"])
        self.assertTrue(result["correct_category"])

    def test_test3_cifoz_or_zbca_satisfied_by_qualifying_zbca(self):
        requirement = _requirement(maps_to_credential_type=None)
        credential = _credential(credential_type="zbca_registration")
        result = match_requirement_to_credential(
            requirement, _tender(), [credential],
            acceptable_credential_types=["cifoz_registration", "zbca_registration"],
        )
        self.assertEqual(result["status"], "SATISFIED")
        self.assertEqual(result["credential_id"], "c1")

    def test_praz_credential_never_satisfies_a_cifoz_requirement(self):
        requirement = _requirement(maps_to_credential_type="cifoz_registration")
        credential = _credential(credential_type="praz_registration")
        result = match_requirement_to_credential(requirement, _tender(), [credential])
        self.assertEqual(result["status"], "MISSING")
        self.assertIsNone(result["credential_id"])

    def test_test11_credential_expiring_before_closing_fails_even_if_valid_today(self):
        tender = _tender(submission_deadline=date.today() + timedelta(days=60))
        credential = _credential(status="valid", expiry_date=date.today() + timedelta(days=10))
        result = match_requirement_to_credential(_requirement(), tender, [credential])
        self.assertFalse(result["valid_through_closing"])
        self.assertNotEqual(result["status"], "SATISFIED")
        self.assertEqual(result["status"], "EXPIRED")

    def test_no_candidates_yields_missing(self):
        result = match_requirement_to_credential(_requirement(), _tender(), [])
        self.assertEqual(result["status"], "MISSING")
        self.assertIsNone(result["credential_id"])


class ComplianceReadinessTests(unittest.TestCase):
    def test_test5_fatal_gap_overrides_high_percentage_to_red(self):
        requirements = [{"status": "SATISFIED", "severity": "MAJOR"} for _ in range(98)]
        requirements.append({"status": "MISSING", "severity": "FATAL"})
        requirements.append({"status": "SATISFIED", "severity": "MAJOR"})
        summary = compute_compliance_readiness(requirements)
        self.assertGreaterEqual(summary["percent"], 99.0)
        self.assertEqual(summary["status"], "RED")
        self.assertEqual(summary["bid_gate_signal"], "HOLD")

    def test_all_satisfied_is_green_and_bid(self):
        requirements = [{"status": "SATISFIED", "severity": "MAJOR"} for _ in range(5)]
        summary = compute_compliance_readiness(requirements)
        self.assertEqual(summary["percent"], 100.0)
        self.assertEqual(summary["status"], "GREEN")
        self.assertEqual(summary["bid_gate_signal"], "BID")

    def test_no_applicable_requirements_never_fabricates_a_percentage(self):
        summary = compute_compliance_readiness([{"status": "NOT_APPLICABLE", "severity": "MAJOR"}])
        self.assertIsNone(summary["percent"])
        self.assertEqual(summary["status"], "GREY")

    def test_open_critical_without_fatal_is_amber_review(self):
        requirements = [
            {"status": "SATISFIED", "severity": "MAJOR"},
            {"status": "MISSING", "severity": "CRITICAL"},
        ]
        summary = compute_compliance_readiness(requirements)
        self.assertEqual(summary["status"], "AMBER")
        self.assertEqual(summary["bid_gate_signal"], "REVIEW")


if __name__ == "__main__":
    unittest.main()
