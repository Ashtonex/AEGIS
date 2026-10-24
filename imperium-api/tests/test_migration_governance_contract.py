import unittest
from pathlib import Path

from scripts.validate_production_migrations import (
    discover_files,
    validate_filenames,
    validate_sql_file,
)

ROOT = Path(__file__).resolve().parent.parent
MIGRATIONS_DIR = ROOT / "migrations"


class MigrationGovernanceContractTests(unittest.TestCase):
    """Enforce migration governance rules across all SQL migrations:
    1. Zero syntax/ordering errors detected by the static preflight validator.
    2. All migration files are non-empty and well-formed.
    3. Monotonic ordering prefixes are deterministic.
    """

    def test_all_migrations_pass_static_preflight_validation(self):
        files = discover_files(include_seed=False)
        corpus_lower = "\n".join(path.read_text(encoding="utf-8") for path in files).lower()
        issues = validate_filenames(files)
        for path in files:
            issues.extend(
                validate_sql_file(path, include_seed=False, corpus_lower=corpus_lower)
            )
        errors = [issue for issue in issues if issue.severity == "ERROR"]
        self.assertEqual(
            len(errors),
            0,
            f"Found {len(errors)} migration errors: {[e.message for e in errors]}",
        )

    def test_migration_files_are_non_empty(self):
        files = list(MIGRATIONS_DIR.glob("*.sql"))
        self.assertGreaterEqual(len(files), 260)
        for sql_file in files:
            size = sql_file.stat().st_size
            self.assertGreater(
                size,
                0,
                f"Migration {sql_file.name} is completely empty.",
            )


if __name__ == "__main__":
    unittest.main()
