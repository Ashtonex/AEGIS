from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parent.parent
EXECUTIVE = (ROOT / "routers" / "executive.py").read_text(encoding="utf-8")


class ExecutiveProjectDetailMaterialRecordsContractTests(unittest.TestCase):
    """GET /executive/projects/{id}/detail's material_records sub-query
    selected `i.name` from procurement.inventory_items, a column that
    doesn't exist there (the real column is `item_name` - the same
    mismatch already found and fixed in materials/forecast-alerts). Unlike
    that endpoint, this one already reported the failure honestly via
    source_errors (status="degraded", reason="ProgrammingError" on every
    call), but material_records itself was always empty in production
    regardless of how many material lines a project's daily reports
    actually recorded. This test pins the fix.
    """

    def test_material_records_query_uses_the_real_inventory_item_column(self):
        query_start = EXECUTIVE.index('"material_records": await _rows(')
        query_end = EXECUTIVE.index('"quotations": await _rows(')
        section = EXECUTIVE[query_start:query_end]
        self.assertIn("i.item_name", section)
        self.assertNotIn("i.name,", section)


if __name__ == "__main__":
    unittest.main()
