from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = (ROOT / "migrations" / "152_context_aware_task_engine.sql").read_text(
    encoding="utf-8"
)
TASK_STACKS = (ROOT / "app" / "shared" / "task_stacks.py").read_text(encoding="utf-8")
ROUTER = (ROOT / "routers" / "crm_tasks.py").read_text(encoding="utf-8")
API = (ROOT.parent / "aegis-web" / "src" / "lib" / "api.ts").read_text(
    encoding="utf-8"
)
TASK_PAGE = (
    ROOT.parent / "aegis-web" / "src" / "app" / "dashboard" / "crm" / "tasks" / "page.tsx"
).read_text(encoding="utf-8")


class ContextAwareTaskEngineContractTests(unittest.TestCase):
    """Protect the system-wide task engine from regressing to flat to-dos."""

    def test_schema_adds_context_identity_pack_and_requirement_fields(self):
        for marker in [
            "crm.task_pack_instances",
            "crm.task_related_entities",
            "primary_entity_type",
            "primary_entity_id",
            "source_history JSONB",
            "expected_outcome",
            "deduplication_key",
            "applicability_result",
            "responsible_role",
            "criticality",
            "gate_effect",
            "completion_criteria",
            "required_evidence",
            "contribution_target_type",
            "idx_crm_tasks_dedupe_active",
        ]:
            self.assertIn(marker, MIGRATION)

    def test_generated_task_stacks_are_idempotent_and_pack_based(self):
        for marker in [
            "_dedupe_key",
            "task_pack_instances",
            "ON CONFLICT (organization_id, entity_type, entity_id, stage, template_key, template_version)",
            "deduplication_key = :deduplication_key",
            "source_history = source_history || jsonb_build_array",
            "parent_pack_id",
            "requirement_code",
            "gate_effect",
        ]:
            self.assertIn(marker, TASK_STACKS)

    def test_router_rejects_floating_control_tasks_and_detects_duplicates(self):
        for marker in [
            "Control tasks need a primary entity",
            "@router.post(\"/duplicates\")",
            "A related task already exists.",
            "deduplication_key",
            "Blocking requirements can only be marked not applicable",
            "contribution_percent = weight",
            "status = 'cancelled'",
            "cancellation_authorized_by",
        ]:
            self.assertIn(marker, ROUTER)

    def test_frontend_understands_engine_states_and_duplicate_api(self):
        for marker in [
            "findCrmTaskDuplicates",
            "planned",
            "ready",
            "rejected",
            "not_applicable",
            "superseded",
            "CLOSED_STATUSES",
            "task_type: \"personal_action\"",
            "gate_effect === \"blocking\"",
        ]:
            self.assertIn(marker, API + TASK_PAGE)


if __name__ == "__main__":
    unittest.main()
