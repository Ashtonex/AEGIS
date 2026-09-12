from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]

MIGRATION = (ROOT / "migrations" / "198_corporate_credentials_vault.sql").read_text(encoding="utf-8")
SUPABASE_MIGRATION = (
    ROOT.parent / "supabase" / "migrations" / "20260911001100_corporate_credentials_vault.sql"
).read_text(encoding="utf-8")
ROUTER = (ROOT / "routers" / "corporate_credentials.py").read_text(encoding="utf-8")
MAIN = (ROOT / "main.py").read_text(encoding="utf-8")


class CorporateCredentialsVaultContractTests(unittest.TestCase):
    def test_migration_mirrored_byte_identical_into_supabase_tree(self):
        self.assertEqual(MIGRATION, SUPABASE_MIGRATION)

    def test_migration_creates_vault_table_with_audit_trigger(self):
        self.assertIn("CREATE TABLE IF NOT EXISTS compliance.corporate_credentials", MIGRATION)
        self.assertIn(
            "CREATE TRIGGER trg_audit_corporate_credentials AFTER INSERT OR UPDATE OR DELETE ON compliance.corporate_credentials",
            MIGRATION,
        )
        self.assertIn("EXECUTE FUNCTION core.process_audit_log();", MIGRATION)

    def test_registration_bodies_are_never_merged(self):
        # PRAZ, CIFOZ and ZBCA must stay distinct credential_type values -
        # the target spec explicitly forbids treating them as interchangeable.
        for distinct_type in ("praz_registration", "cifoz_registration", "zbca_registration"):
            self.assertIn(f"'{distinct_type}'", MIGRATION)

    def test_status_vocabulary_matches_spec(self):
        for status_value in ("valid", "expiring", "expired", "pending_verification", "unverified", "not_applicable"):
            self.assertIn(f"'{status_value}'", MIGRATION)

    def test_permissions_seeded_for_compliance_and_md_roles(self):
        for permission_key in (
            "compliance_credentials.read",
            "compliance_credentials.create",
            "compliance_credentials.update",
            "compliance_credentials.delete",
        ):
            self.assertIn(f"'{permission_key}'", MIGRATION)
        for role in ("Compliance Officer", "Managing Director", "Executive (Admin)"):
            self.assertIn(f"'{role}'", MIGRATION)

    def test_router_endpoints_enforce_granular_permissions(self):
        self.assertIn('require_permission("compliance_credentials.read")', ROUTER)
        self.assertIn('require_permission("compliance_credentials.create")', ROUTER)
        self.assertIn('require_permission("compliance_credentials.update")', ROUTER)
        self.assertIn('require_permission("compliance_credentials.delete")', ROUTER)

    def test_router_validates_credential_type_against_allowlist(self):
        self.assertIn("_valid_type", ROUTER)

    def test_router_never_json_serializes_date_fields_before_asyncpg(self):
        # Regression: model_dump(mode="json") turns issue_date/expiry_date
        # into plain ISO strings, and asyncpg's date codec requires a real
        # datetime.date (raises AttributeError: 'str' object has no
        # attribute 'toordinal' on INSERT/UPDATE). Caught live via the
        # browser-driven "Add Credential" flow - confirm it can't return.
        self.assertNotIn('model_dump(mode="json")', ROUTER)
        self.assertIn("Unknown credential_type", ROUTER)

    def test_router_registered_in_main(self):
        self.assertIn("from routers import corporate_credentials", MAIN)
        self.assertIn('prefix="/api/v1/compliance/corporate-credentials"', MAIN)


if __name__ == "__main__":
    unittest.main()
