from pathlib import Path
from tempfile import TemporaryDirectory

from scripts.validate_production_migrations import _without_comments, validate_sql_file


def test_comment_prose_is_not_a_table_declaration():
    with TemporaryDirectory() as folder:
        path = Path(folder) / "067_example.sql"
        path.write_text("-- The CREATE TABLE was supplied earlier.\nSELECT 1;\n")
        assert not validate_sql_file(path, False, "")


def test_quotes_and_line_numbers_survive_comment_removal():
    sql = "SELECT '-- literal', '/* literal */'; -- comment\n/* comment\n */ SELECT 1;"
    cleaned = _without_comments(sql)
    assert "'-- literal'" in cleaned
    assert "'/* literal */'" in cleaned
    assert len(cleaned) == len(sql)
    assert cleaned.count("\n") == sql.count("\n")


def test_real_unreviewed_table_still_warns():
    with TemporaryDirectory() as folder:
        path = Path(folder) / "067_example.sql"
        path.write_text("CREATE TABLE core.unreviewed(id uuid);\n")
        assert any(
            "GRANT/REVOKE" in issue.message
            for issue in validate_sql_file(path, False, "")
        )
