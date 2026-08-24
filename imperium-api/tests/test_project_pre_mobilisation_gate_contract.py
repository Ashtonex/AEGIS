from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
TASK_STACKS = (ROOT / "app" / "shared" / "task_stacks.py").read_text(encoding="utf-8")
MIGRATION = (ROOT / "migrations" / "149_project_pre_mobilisation_gate.sql").read_text(encoding="utf-8")
SUPABASE_MIGRATION = (
    ROOT.parent
    / "supabase"
    / "migrations"
    / "20260823155919_project_pre_mobilisation_gate.sql"
).read_text(encoding="utf-8")


class ProjectPreMobilisationGateContractTests(unittest.TestCase):
    def test_project_task_stack_can_receive_new_templates_after_initial_generation(self):
        self.assertNotIn("if existing.first():\n            return 0", TASK_STACKS)
        self.assertIn("template_id = :template_id", TASK_STACKS)
        self.assertIn("created += 1", TASK_STACKS)
        self.assertIn("return created", TASK_STACKS)

    def test_migration_records_authorisation_and_seeds_task_packs(self):
        for sql in (MIGRATION, SUPABASE_MIGRATION):
            self.assertIn("mobilisation_approved_at", sql)
            self.assertIn("mobilisation_authorisation_number", sql)
            self.assertIn("Contract and award confirmation", sql)
            self.assertIn("Pre-mobilisation review", sql)
            self.assertIn("Mobilisation authorisation", sql)


if __name__ == "__main__":
    unittest.main()
