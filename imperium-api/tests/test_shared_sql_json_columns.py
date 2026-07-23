import unittest

from app.shared.sql import insert_returning_id_sql, update_returning_id_sql


class JsonColumnCastTests(unittest.TestCase):
    """asyncpg's jsonb codec calls .encode() on the bound value, so a raw Python
    dict/list bound to a jsonb column raises AttributeError at execute time.
    Callers must json.dumps() the value AND the SQL must CAST(:col AS jsonb) so
    Postgres describes the parameter as text, not native jsonb, before the cast."""

    def test_insert_wraps_only_json_columns_in_cast(self):
        stmt = str(
            insert_returning_id_sql(
                "finance.quotations",
                ["client_name", "metadata"],
                ["client_name", "metadata"],
                json_columns=["metadata"],
            )
        )
        self.assertIn("CAST(:metadata AS jsonb)", stmt)
        self.assertIn(":client_name", stmt)
        self.assertNotIn("CAST(:client_name AS jsonb)", stmt)

    def test_insert_without_json_columns_is_unchanged(self):
        stmt = str(
            insert_returning_id_sql(
                "finance.quotations",
                ["client_name"],
                ["client_name"],
            )
        )
        self.assertNotIn("CAST(", stmt)
        self.assertIn(":client_name", stmt)

    def test_update_wraps_only_json_columns_in_cast(self):
        stmt = str(
            update_returning_id_sql(
                "finance.quotations",
                ["status", "metadata"],
                ["status", "metadata"],
                json_columns=["metadata"],
            )
        )
        self.assertIn("metadata = CAST(:metadata AS jsonb)", stmt)
        self.assertIn("status = :status", stmt)
        self.assertNotIn("status = CAST(:status AS jsonb)", stmt)

    def test_update_without_json_columns_is_unchanged(self):
        stmt = str(
            update_returning_id_sql(
                "finance.quotations",
                ["status"],
                ["status"],
            )
        )
        self.assertNotIn("CAST(", stmt)
        self.assertIn("status = :status", stmt)


if __name__ == "__main__":
    unittest.main()
