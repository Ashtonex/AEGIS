import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
QUOTATIONS_PY = (ROOT / "routers" / "quotations.py").read_text(encoding="utf-8")
HSE_INCIDENTS_PY = (ROOT / "routers" / "hse_incidents.py").read_text(encoding="utf-8")


class Wave6ModuleCompletionContractTests(unittest.TestCase):
    """Pin the operational gates for Wave 6 module completion:
    1. Quotations: Closed quotations (won or lost) cannot be mutated via PUT /{item_id}
       without administrative authority, preserving execution budget reconciliation.
    2. Quotations: Winning or losing a quotation emits finance.quotation.decided.v1 to
       core.audit_events.
    3. HSE Incidents: Incidents cannot transition to 'resolved' without documented
       investigation/CAPA details (HTTP 422 if description missing or < 10 chars).
    4. HSE Incidents: Resolution emits hse.incident.resolved.v1 to core.audit_events.
    """

    def test_quotation_locks_against_updates_when_decided(self):
        self.assertIn('SELECT status, row_version FROM finance.quotations', QUOTATIONS_PY)
        self.assertIn('current_row.status in ("won", "lost")', QUOTATIONS_PY)
        self.assertIn('status_code=409', QUOTATIONS_PY)
        self.assertIn('Quotation cannot be edited because it has already been decided', QUOTATIONS_PY)

    def test_quotation_decision_emits_audit_event(self):
        self.assertIn('event_type="finance.quotation.decided.v1"', QUOTATIONS_PY)
        self.assertIn('aggregate_type="quotation"', QUOTATIONS_PY)

    def test_hse_incident_requires_capa_description_to_resolve(self):
        self.assertIn('resolving = values.get("status") == "resolved"', HSE_INCIDENTS_PY)
        self.assertIn('SELECT description FROM projects.hse_incidents', HSE_INCIDENTS_PY)
        self.assertIn('len(desc.strip()) < 10', HSE_INCIDENTS_PY)
        self.assertIn('status_code=422', HSE_INCIDENTS_PY)
        self.assertIn('Cannot resolve an HSE incident without documented investigation', HSE_INCIDENTS_PY)

    def test_hse_incident_emits_reported_and_resolved_audit_events(self):
        self.assertIn('event_type="hse.incident.reported.v1"', HSE_INCIDENTS_PY)
        self.assertIn('event_type="hse.incident.resolved.v1"', HSE_INCIDENTS_PY)
        self.assertIn('aggregate_type="hse_incident"', HSE_INCIDENTS_PY)


if __name__ == "__main__":
    unittest.main()
