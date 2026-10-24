import glob
import pathlib
import re
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]


class PermissionRegistryContractTests(unittest.TestCase):
    """Guarantees that every permission string required across all routers is
    seeded in the migration catalog, preventing silent 403 Forbidden errors."""

    def test_all_router_permission_keys_are_seeded_in_migrations(self):
        router_keys = set()
        for py_path in ROOT.glob("routers/*.py"):
            text = py_path.read_text(encoding="utf-8")
            for m in re.finditer(r'require_permission\(\s*["\']([^"\']+)["\']', text):
                router_keys.add(m.group(1))
            for m in re.finditer(r'require_any_permission\(\s*(?:\[|\()?([^\]\)]+)(?:\]|\))?\)', text):
                for raw in re.finditer(r'["\']([^"\']+)["\']', m.group(1)):
                    router_keys.add(raw.group(1))

        migration_keys = set()

        # 1. Add unnest resource-action generated permissions from 011_resource_action_permissions.sql
        resources = [
            'projects', 'site_operations', 'workforce', 'fleet', 'equipment_assets',
            'procurement_orders', 'inventory_items', 'budgets', 'financial_performance',
            'quotations', 'hr_records', 'compliance_items', 'hse_incidents', 'documents',
            'crm_contacts', 'crm_organizations', 'crm_activities', 'crm_automations',
            'client_portal_tickets', 'supplier_records', 'internal_messages', 'kpi_metrics',
            'bi_reports', 'risk_register', 'tender_bids', 'maintenance_schedules',
            'automated_reports', 'website_enquiries'
        ]
        actions = ['read', 'create', 'update', 'delete']
        for r in resources:
            for a in actions:
                migration_keys.add(f"{r}.{a}")

        # 2. Parse all migration files for explicitly inserted permission keys
        for sql_path in ROOT.glob("migrations/*.sql"):
            text = sql_path.read_text(encoding="utf-8")
            for m in re.finditer(r'core\.permissions\s*(?:\([^)]*\))?\s*VALUES\s*(.+?)(?:ON CONFLICT|;)', text, re.IGNORECASE | re.DOTALL):
                chunk = m.group(1)
                for val in re.finditer(r'\(\s*[\'"]([a-zA-Z0-9_\.]+)[\'"]', chunk):
                    migration_keys.add(val.group(1))

        missing_keys = router_keys - migration_keys
        self.assertEqual(
            missing_keys,
            set(),
            f"The following permission keys are required by routers but NOT seeded in any migration: {sorted(list(missing_keys))}"
        )


if __name__ == "__main__":
    unittest.main()
