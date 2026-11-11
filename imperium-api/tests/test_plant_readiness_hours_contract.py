"""Readiness checklist, cross-hire swap and planned-vs-worked hours on plant
requests, and the variation register's QS-review step. Behaviour against the
database is checked by scripts/verify_plant_readiness_hours.py."""

from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT.parent / "aegis-web" / "src"
FLEET = (ROOT / "routers" / "fleet.py").read_text(encoding="utf-8")
MIGRATION = (ROOT / "migrations" / "293_plant_request_planned_hours.sql").read_text(encoding="utf-8")
PLANT_PAGE = (WEB / "app" / "dashboard" / "fleet" / "requests" / "page.tsx").read_text(encoding="utf-8")
FINANCE_PAGE = (WEB / "app" / "dashboard" / "finance" / "page.tsx").read_text(encoding="utf-8")
FLEET_API = (WEB / "lib" / "api" / "fleet.ts").read_text(encoding="utf-8")


class PlantReadinessHoursContract(unittest.TestCase):
    def test_migration_adds_planned_hours(self):
        self.assertIn("ADD COLUMN IF NOT EXISTS planned_hours NUMERIC(10,2)", MIGRATION)

    def test_readiness_endpoint_saves_without_moving_status(self):
        self.assertIn('@router.patch("/plant/requests/{plant_request_id}/readiness")', FLEET)
        self.assertIn("class PlantReadinessUpdatePayload", FLEET)
        self.assertIn("/readiness`", FLEET_API)

    def test_switch_accepts_internal_fleet_or_cross_hire(self):
        self.assertIn("cross_hire: Optional[CrossHireAssetPayload]", FLEET)
        self.assertIn("'hired_in', 'hired_in'", FLEET)
        self.assertIn('"cross_hire"', PLANT_PAGE)

    def test_request_list_returns_hours_and_current_machine(self):
        for column in ("AS hours_worked", "current_fleet_id", "current_asset_ownership", "current_assignment_id"):
            self.assertIn(column, FLEET)

    def test_every_backend_readiness_control_is_in_the_ui(self):
        start = FLEET.index("PLANT_READINESS_CONTROLS: dict[str, str] = {")
        block = FLEET[start : FLEET.index("}", start)]
        keys = [line.split('"')[1] for line in block.splitlines() if line.strip().startswith('"')]
        self.assertEqual(len(keys), 13)
        for key in keys:
            self.assertIn(f'key: "{key}"', PLANT_PAGE)

    def test_dispatch_sends_ticks_and_uses_reserved_machine(self):
        self.assertIn("dispatch_pack: { readiness_pack: readiness }", PLANT_PAGE)
        self.assertIn("payload.fleet_id = fleet_id", FLEET)

    def test_swap_only_moves_this_requests_assignment(self):
        self.assertIn('"assignment_id": live_assignment.id,', FLEET)
        self.assertNotIn("WHERE organization_id = :org_id AND fleet_id = :old_fleet_id", FLEET)

    def test_end_date_change_on_hire_moves_assignment(self):
        self.assertIn("The machine is booked for another job in the extended period", FLEET)
        self.assertIn("SET ends_at = CAST(:ends_at AS timestamptz)", FLEET)

    def test_hour_log_form_gated_on_fleet_create(self):
        self.assertIn('permissions?.has("fleet.create")', PLANT_PAGE)

    def test_swap_checks_the_new_machine(self):
        self.assertIn("That machine is already on this request.", FLEET)
        self.assertIn("is booked for another job in this hire period", FLEET)
        self.assertIn("if new_asset.get(\"operational_status\") in FLEET_UNUSABLE_STATUSES", FLEET)
        self.assertIn("if plant_request[\"status\"] not in PLANT_SWAPPABLE_STATUSES", FLEET)

    def test_release_keeps_disposed_and_busy_machines(self):
        self.assertIn("WHEN f.operational_status <> ALL(CAST(:job_statuses AS text[])) THEN f.operational_status", FLEET)
        self.assertIn("WHEN f.ownership_type = 'hired_in' THEN 'hired_in'", FLEET)

    def test_dispatch_refuses_unusable_machine(self):
        self.assertIn("- swap the machine", FLEET)

    def test_hours_only_once_dispatched_and_costed_to_request(self):
        self.assertIn("Hours are logged once the machine is dispatched", FLEET)
        self.assertIn("explicit_project_id = explicit_project_id or plant_req.project_id", FLEET)
        self.assertIn("HOURS_LOGGABLE_STATUSES.includes(status)", PLANT_PAGE)

    def test_dates_before_dispatch_move_reservation(self):
        self.assertIn("SET reserved_from = CAST(:period_from AS timestamptz)", FLEET)
        self.assertIn("The machine has been returned, so the hire dates can no longer change.", FLEET)

    def test_list_prefers_machine_on_site(self):
        self.assertIn("ORDER BY m.pri, m.created_at DESC LIMIT 1", FLEET)

    def test_untyped_binds_fixed(self):
        self.assertNotIn("CAST(:old_fleet_id AS text)", FLEET)
        self.assertNotIn("(:approval_status IS NULL", FLEET)


class VariationRegisterQsReviewContract(unittest.TestCase):
    def test_register_shows_server_reason_and_qs_review_step(self):
        self.assertIn("variationNextStep", FINANCE_PAGE)
        self.assertIn("reviewSiteVarianceQs", FINANCE_PAGE)
        self.assertIn("decideSiteVarianceClient", FINANCE_PAGE)
        self.assertIn("${rawMessage}", FINANCE_PAGE)

    def test_decided_variance_cannot_be_reopened(self):
        site = (ROOT / "routers" / "site_reports.py").read_text(encoding="utf-8")
        self.assertEqual(site.count('if row["status"] not in ("pending", "submitted"):'), 2)


if __name__ == "__main__":
    unittest.main()
