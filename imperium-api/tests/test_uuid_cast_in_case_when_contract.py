"""
Regression contract for two related raw-SQL bug shapes that unit/contract
tests can't otherwise catch, both rooted in the same cause: asyncpg cannot
always infer the type of a bound parameter from context alone, and silently
defaults it to text - which then fails at execution time if the real column
is a different type (DatatypeMismatchError) or fails during PREPARE if the
parameter is used in two contexts that don't agree (AmbiguousParameterError).
Both only surface live, the first time the code path actually runs.

Shape 1: `CASE WHEN <cond> THEN :param ELSE <untyped-NULL-or-column> END`
when :param is assigned into a non-text column. Confirmed via browser
testing against routers/sop_compliance.py's complete_sop_item and
routers/drawings.py's set_checklist_item before they were fixed with an
explicit CAST(:param AS uuid).

Shape 2: `(:param IS NULL OR col = :param)` - an optional-filter pattern used
throughout the app. Confirmed via browser testing against
routers/quotations.py's guard-audit and document-change-history endpoints
(finance.commercial_guard_audits.project_id and
finance.document_change_logs.project_id, both VARCHAR - proving this shape
fails regardless of the column's actual type, it's the OR/IS-NULL
combination that breaks asyncpg's inference, not the type itself). Fixed
with CAST(:param AS <matching type>) on both occurrences of the parameter.

Since the existing test suite is schema/contract-based and does not execute
against a live Postgres instance, these assertions just pin the CAST so it
can't be silently reverted - they are not a substitute for a live check when
either bug shape resurfaces elsewhere.
"""

from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


def _read(relative_path: str) -> str:
    return (ROOT / relative_path).read_text(encoding="utf-8")


PROCUREMENT = _read("routers/procurement.py")
SITE_REPORTS = _read("routers/site_reports.py")
HR_RECORDS = _read("routers/hr_records.py")
FLEET = _read("routers/fleet.py")
SOP_COMPLIANCE = _read("routers/sop_compliance.py")
DRAWINGS = _read("routers/drawings.py")
QUOTATIONS = _read("routers/quotations.py")
CRM_LIFECYCLE = _read("routers/crm_lifecycle.py")
WORKFORCE = _read("routers/workforce.py")
AUTOMATED_REPORTS = _read("routers/automated_reports.py")


class UuidCastInCaseWhenContractTests(unittest.TestCase):
    def test_procurement_requisition_decision_casts_approved_by(self):
        self.assertIn(
            "approved_by=CASE WHEN CAST(:decision AS varchar)='approved' THEN CAST(:user_id AS uuid) ELSE approved_by END",
            PROCUREMENT,
        )

    def test_procurement_rfq_issue_casts_issued_by(self):
        self.assertIn(
            "CASE WHEN CAST(:status AS varchar)='issued' THEN CAST(:user_id AS uuid) ELSE NULL END",
            PROCUREMENT,
        )

    def test_procurement_invoice_payment_decision_casts_payment_approved_by(self):
        self.assertIn(
            "payment_approved_by=CASE WHEN CAST(:status AS varchar)='approved' THEN CAST(:user_id AS uuid) ELSE payment_approved_by END",
            PROCUREMENT,
        )

    def test_site_reports_shortfall_requisition_casts_submitted_by(self):
        self.assertIn(
            "CASE WHEN CAST(:status AS varchar)='submitted' THEN CAST(:user_id AS uuid) ELSE NULL END",
            SITE_REPORTS,
        )

    def test_hr_leave_decision_casts_approved_by(self):
        self.assertIn(
            "approved_by = CASE WHEN :decision = 'approved' THEN CAST(:user_id AS uuid) ELSE approved_by END",
            HR_RECORDS,
        )

    def test_fleet_defect_decision_casts_resolved_by(self):
        self.assertIn(
            "resolved_by=CASE WHEN :status='resolved' THEN CAST(:user_id AS uuid) ELSE NULL END",
            FLEET,
        )

    def test_fleet_work_order_decision_casts_completed_by(self):
        self.assertIn(
            "completed_by=CASE WHEN CAST(:status AS varchar)='completed' THEN CAST(:user_id AS uuid) ELSE completed_by END",
            FLEET,
        )

    def test_sop_compliance_item_completion_casts_checked_by(self):
        self.assertIn(
            "checked_by = CASE WHEN :checked THEN CAST(:user_id AS uuid) ELSE NULL END",
            SOP_COMPLIANCE,
        )

    def test_drawing_checklist_item_casts_checked_by(self):
        self.assertIn(
            "checked_by = CASE WHEN :checked THEN CAST(:user_id AS uuid) ELSE NULL END",
            DRAWINGS,
        )


class OptionalFilterIsNullOrContractTests(unittest.TestCase):
    """Shape 2: `(:param IS NULL OR col = :param)` - pins the CAST fix at
    every site found this session, across all 4 files touched."""

    def test_quotations_baseline_history_casts_quotation_and_project_filters(self):
        self.assertIn(
            "(CAST(:quotation_id AS varchar) IS NULL OR quotation_id = CAST(:quotation_id AS varchar))",
            QUOTATIONS,
        )
        self.assertIn(
            "(CAST(:project_id AS varchar) IS NULL OR project_id = CAST(:project_id AS varchar))",
            QUOTATIONS,
        )

    def test_quotations_guard_audits_and_document_changes_cast_project_filter(self):
        self.assertEqual(
            QUOTATIONS.count(
                "(CAST(:project_id AS varchar) IS NULL OR project_id = CAST(:project_id AS varchar))"
            ),
            3,
            "expected this exact cast pattern at 3 sites: guard/audits, "
            "documents/changes, and intelligence/baselines",
        )

    def test_crm_lifecycle_support_tickets_casts_status_filter(self):
        self.assertIn(
            "(CAST(:status_filter AS varchar) IS NULL OR t.status = CAST(:status_filter AS varchar))",
            CRM_LIFECYCLE,
        )

    def test_workforce_allocations_casts_project_filter(self):
        self.assertIn(
            "(CAST(:project_id AS uuid) IS NULL OR a.project_id=CAST(:project_id AS uuid))",
            WORKFORCE,
        )

    def test_automated_reports_evidence_snapshot_casts_project_filter(self):
        self.assertEqual(
            AUTOMATED_REPORTS.count(
                "CAST(:project_id AS text) IS NULL OR project_id::text = CAST(:project_id AS text)"
            )
            + AUTOMATED_REPORTS.count(
                "CAST(:project_id AS text) IS NULL OR r.project_id::text = CAST(:project_id AS text)"
            ),
            7,
            "expected all 7 evidence-source count queries to cast the "
            "optional project_id filter",
        )
        self.assertNotIn(":project_id IS NULL OR", AUTOMATED_REPORTS)


if __name__ == "__main__":
    unittest.main()
