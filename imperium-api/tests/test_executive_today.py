from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest

import routers.executive as executive

ROOT = Path(__file__).resolve().parents[1]
T0 = datetime(2026, 9, 25, 12, 30, tzinfo=timezone.utc)


def activity(minutes_ago, actor="Gladmore", table="procurement.inventory_items", action="INSERT", count=1, label=None):
    return {
        "actor": actor,
        "table_name": table,
        "action": action,
        "record_count": count,
        "record_label": label,
        "happened_at": T0 - timedelta(minutes=minutes_ago),
    }


def test_same_person_same_action_run_merges_into_one_line():
    merged = executive._merge_activity_runs([activity(0), activity(3), activity(9, count=2), activity(25)])

    assert len(merged) == 1
    assert merged[0]["record_count"] == 5
    assert merged[0]["happened_at"] == T0  # newest time is kept


def test_run_breaks_on_gap_actor_table_or_action():
    rows = [
        activity(0),
        activity(45),  # > 30 min after the run's oldest row
        activity(46, actor="Emmanuel"),
        activity(47, actor="Emmanuel", table="crm.tenders"),
        activity(48, actor="Emmanuel", table="crm.tenders", action="UPDATE"),
    ]
    assert len(executive._merge_activity_runs(rows)) == 5


def test_merge_window_is_measured_from_the_run_oldest_row():
    # 0 -> 20 -> 40: each step is within 30 min of the previous row, so the
    # run keeps extending.
    assert len(executive._merge_activity_runs([activity(0), activity(20), activity(40)])) == 1


def test_activity_is_capped():
    rows = [activity(i * 60, actor=f"person {i}") for i in range(40)]
    assert len(executive._merge_activity_runs(rows)) == executive._ACTIVITY_MAX_LINES


def test_activity_line_wording_and_links():
    single = executive._activity_line(
        {**activity(0, table="crm.tenders", action="UPDATE", label="Norton fence"), "record_count": 1}
    )
    assert single == {
        "actor": "Gladmore",
        "verb": "updated",
        "count": 1,
        "noun": "tender",
        "label": "Norton fence",
        "happened_at": T0,
        "href": "/dashboard/crm/tenders",
    }

    many = executive._activity_line({**activity(0, label="ignored"), "record_count": 6})
    assert (many["noun"], many["label"], many["href"]) == ("inventory items", None, "/dashboard/procurement")


def test_activity_label_is_truncated():
    line = executive._activity_line({**activity(0, label="x" * 200), "record_count": 1})
    assert len(line["label"]) == 80 and line["label"].endswith("...")


def test_activity_query_is_tenant_scoped_on_the_audit_row():
    # Populated by core.process_audit_log() since migration 237.
    assert "a.organization_id = :org_id" in executive._TODAY_ACTIVITY_SQL


def test_bank_tab_only_lists_bank_accounts():
    assert "ca.account_type = 'bank'" in executive._TODAY_BANK_ACCOUNTS_SQL
    assert "account_number" not in executive._TODAY_BANK_ACCOUNTS_SQL


class FakeResult:
    def __init__(self, rows):
        self.rows = rows

    def __iter__(self):
        return iter(self.rows)


class Row:
    def __init__(self, mapping):
        self._mapping = mapping


class FakeDb:
    """Answers each Today query by recognising its SQL; not an AsyncSession,
    so gather_reads runs everything sequentially on it."""

    def __init__(self, fail_commercial=False):
        self.fail_commercial = fail_commercial
        self.rolled_back = 0

    async def execute(self, statement, params=None):
        sql = str(statement)
        if "procurement.material_requests" in sql:
            return FakeResult([Row({"id": "mr-1", "required_by_date": date.today() + timedelta(days=2)})])
        if "procurement.stock_ledger" in sql:
            return FakeResult([Row({"item_name": "Cement", "available_qty": 0, "reorder_level": 10})])
        if "core.audit_log" in sql:
            assert params["noise_tables"] == executive._ACTIVITY_NOISE_TABLES
            return FakeResult([Row(activity(0, label="Cement"))])
        if "LEFT JOIN LATERAL" in sql:
            return FakeResult([Row({"account_name": "Operations", "book_balance": 25140, "statement_balance": 15131})])
        if "untagged_count" in sql:
            return FakeResult([Row({"untagged_count": 270, "untagged_value": 164107.13, "oldest_untagged_date": None})])
        if "crm." in sql:
            if self.fail_commercial:
                raise RuntimeError("crm down")
            return FakeResult([])
        raise AssertionError(f"unexpected query: {sql[:80]}")

    async def rollback(self):
        self.rolled_back += 1


USER = {"user_id": "u-1", "org_id": "org-1", "role": "SUPERADMIN"}


@pytest.mark.asyncio
async def test_today_returns_all_four_sections():
    out = await executive.get_executive_today(user=USER, db=FakeDb())
    data = out["data"]

    assert out["meta"]["source_errors"] == []
    assert data["materials"]["at_risk_requests"][0]["days_left"] == 2
    assert data["materials"]["low_stock"][0]["item_name"] == "Cement"
    assert data["commercial"]["summary"]["urgent_tenders"] == 0
    assert data["activity"][0]["label"] == "Cement"
    assert data["bank"]["untagged_count"] == 270
    assert data["bank"]["untagged_value"] == 164107.13


@pytest.mark.asyncio
async def test_failing_commercial_section_degrades_alone():
    db = FakeDb(fail_commercial=True)
    out = await executive.get_executive_today(user=USER, db=db)

    assert out["data"]["commercial"] is None
    assert [e["source"] for e in out["meta"]["source_errors"]] == ["today.commercial_briefing"]
    assert out["data"]["bank"]["untagged_count"] == 270  # other sections unaffected
    assert db.rolled_back >= 1


def test_audit_log_activity_index_migration_matches_the_query():
    migration = (ROOT / "migrations" / "237_audit_log_organization_id.sql").read_text(encoding="utf-8")
    assert "ON core.audit_log (organization_id, created_at DESC)" in migration
    assert "WHERE created_by IS NOT NULL" in migration
    assert "a.created_by IS NOT NULL" in executive._TODAY_ACTIVITY_SQL


def test_audit_trigger_sets_organization_id_without_risking_the_write():
    migration = (ROOT / "migrations" / "237_audit_log_organization_id.sql").read_text(encoding="utf-8")
    function = migration[migration.index("CREATE OR REPLACE FUNCTION core.process_audit_log()"):migration.index("$function$;")]
    # every insert path writes the tenant
    assert function.count("organization_id)") == 3
    assert function.count("current_user_id, row_org_id)") == 3
    # resolution order: row -> organizations row itself -> acting user
    assert function.index("row_data->>'organization_id'") < function.index("TG_TABLE_NAME = 'organizations'") < function.index("FROM core.users u")
    # an unknown org is nulled rather than violating the FK and failing the audited write
    assert "NOT EXISTS (SELECT 1 FROM core.organizations o WHERE o.id = row_org_id)" in function
    # the backfill only fills gaps
    assert "WHERE src.organization_id IS NULL" in migration
