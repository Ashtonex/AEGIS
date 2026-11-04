"""Every table a dashboard page subscribes to with useLiveTable must be
relayed by core/realtime.py and have a live_change_notify trigger. A gap
in either is silent: the page simply never updates until reloaded."""

import re
import unittest
from pathlib import Path

from core.realtime import TABLE_PERMISSION_MAP

ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT.parent / "aegis-web" / "src"
MIGRATIONS = ROOT / "migrations"

SUBSCRIBE_RE = re.compile(r'useLiveTable\(\s*"([a-z_]+\.[a-z_]+)"')
TRIGGER_TARGET_RE = re.compile(r"'([a-z_]+\.[a-z_]+)'")


def _subscribed_tables() -> dict[str, set[str]]:
    found: dict[str, set[str]] = {}
    for path in WEB_ROOT.rglob("*.ts*"):
        for table in SUBSCRIBE_RE.findall(path.read_text(encoding="utf-8")):
            found.setdefault(table, set()).add(str(path.relative_to(WEB_ROOT)))
    return found


def _triggered_tables() -> set[str]:
    tables: set[str] = set()
    for path in MIGRATIONS.glob("*.sql"):
        sql = path.read_text(encoding="utf-8")
        if "live_change_notify" not in sql:
            continue
        # Array-loop style (075, 285): quoted schema.table literals.
        tables.update(TRIGGER_TARGET_RE.findall(sql))
        # Direct style: CREATE TRIGGER live_change_notify ... ON schema.table
        tables.update(
            re.findall(r"live_change_notify\s+AFTER[^;]*?\bON\s+([a-z_]+\.[a-z_]+)", sql, re.S | re.I)
        )
        # Per-schema loop style (193, 247, 252): ON finance.%I over an array
        # of bare table names - credit every bare name in that file's arrays.
        for schema in re.findall(r"live_change_notify\s+AFTER[^']*?\bON\s+([a-z_]+)\.%[Is]", sql, re.I):
            for array_body in re.findall(r"ARRAY\s*\[([^\]]*)\]", sql, re.I):
                for name in re.findall(r"'([a-z_]+)'", array_body):
                    tables.add(f"{schema}.{name}")
    return tables


class LiveTableContractTest(unittest.TestCase):
    def test_web_scan_finds_subscriptions(self):
        self.assertGreater(len(_subscribed_tables()), 10)

    def test_every_subscribed_table_is_relayed(self):
        missing = {t: sorted(p) for t, p in _subscribed_tables().items() if t not in TABLE_PERMISSION_MAP}
        self.assertEqual(missing, {}, "Add these to TABLE_PERMISSION_MAP in core/realtime.py")

    def test_every_relayed_table_has_a_trigger(self):
        missing = sorted(set(TABLE_PERMISSION_MAP) - _triggered_tables())
        self.assertEqual(missing, [], "Add a live_change_notify trigger migration for these")

    def test_every_relayed_table_is_gated_by_a_permission(self):
        for table, keys in TABLE_PERMISSION_MAP.items():
            self.assertTrue(keys, table)
            for key in keys:
                self.assertRegex(key, r"^[a-z_]+(\.[a-z_]+)+$", table)


if __name__ == "__main__":
    unittest.main()
