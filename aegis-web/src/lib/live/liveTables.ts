// Table lists shared by more than one live screen. Pages may also pass their
// own `tables: [...]` inline. Every name, here or inline, must be relayed by
// imperium-api/core/realtime.py (TABLE_PERMISSION_MAP) and have a
// live_change_notify trigger; imperium-api/tests/test_live_table_contract.py
// checks both.

export const TENDER_DISCOVERY_TABLES = ["crm.tender_candidates", "crm.tender_discovery_runs"] as const;
