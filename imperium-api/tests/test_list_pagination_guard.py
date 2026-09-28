"""Regression guard for AEGIS audit item 4.3 (unbounded list endpoints).

Any GET endpoint whose own SQL reads a high-volume table must bound its
result - a limit/page parameter, a SQL LIMIT (including LIST_SAFETY_CAP) -
or be listed in ALLOWED_UNBOUNDED with the reason it can't grow without
bound. A new unbounded list over one of these tables fails here instead of
shipping.

Limits of the check: it reads SQL written inside the route function itself.
Endpoints that query through a service module (e.g. the GL journals and
bank statement-line search) aren't seen - those were checked by hand and
are paged.
"""

import ast
import re
from pathlib import Path

import pytest

from app.shared.pagination import LIST_SAFETY_CAP, apply_safety_cap, limited

ROOT = Path(__file__).resolve().parents[1]

# Tables that already hold thousands of rows or grow with every transaction.
HIGH_VOLUME_TABLES = {
    "core.audit_log",
    "core.documents",
    "core.notifications",
    "crm.activities",
    "crm.communication_events",
    "crm.tasks",
    "finance.bank_statement_lines",
    "finance.cashbook_transactions",
    "finance.cost_transactions",
    "finance.journal_entries",
    "finance.journal_lines",
    "procurement.stock_ledger",
}

PAGE_PARAMS = {"limit", "page", "page_size", "offset", "cursor", "per_page"}

# (module, function) -> why its size is bounded without a limit.
ALLOWED_UNBOUNDED = {
    ("bi_reports", "get_project_performance_analytics"): "one row per project (aggregate)",
    ("compliance_foundation", "history"): "audit history of a single record",
    ("crm", "sales_report"): "aggregate report",
    ("crm_tasks", "get_progress_summary"): "aggregate per person/team",
    ("documents", "get_signed_url"): "single document",
    ("documents", "get_access"): "single document",
    ("executive", "get_executive_stats"): "counts only",
    ("financial_performance", "get_historical_reconciliation"): "one row per historical project",
    ("financial_performance", "get_project_petty_cash"): "a single project's petty cash",
    ("notifications", "notification_summary"): "counts only",
    ("procurement", "supplier_catalogue"): "a single supplier's catalogue",
    ("projects", "list_production_expenses"): "a single project",
    ("projects", "list_production_revenue"): "a single project",
    ("quotations", "get_quotation_history"): "audit history of a single quotation",
}


def _get_endpoints():
    for path in sorted((ROOT / "routers").glob("*.py")):
        source = path.read_text(encoding="utf-8")
        for node in ast.walk(ast.parse(source)):
            if not isinstance(node, ast.AsyncFunctionDef):
                continue
            route = next(
                (
                    d.args[0].value
                    for d in node.decorator_list
                    if isinstance(d, ast.Call)
                    and getattr(d.func, "attr", "") == "get"
                    and d.args
                    and isinstance(d.args[0], ast.Constant)
                ),
                None,
            )
            if route is None:
                continue
            yield path.stem, node, route, ast.get_source_segment(source, node) or ""


def _unbounded_high_volume_readers():
    found = {}
    for module, node, route, body in _get_endpoints():
        if route.rstrip("/").endswith("}"):
            continue  # single-entity detail route
        tables = set(re.findall(r"\bFROM\s+([a-z_]+\.[a-z_]+)", body, re.I)) & HIGH_VOLUME_TABLES
        if not tables:
            continue
        params = {a.arg for a in node.args.args + node.args.kwonlyargs}
        if params & PAGE_PARAMS or re.search(r"\bLIMIT\b", body, re.I):
            continue
        found[(module, node.name)] = sorted(tables)
    return found


def test_high_volume_list_endpoints_are_bounded():
    unexpected = {
        key: tables for key, tables in _unbounded_high_volume_readers().items() if key not in ALLOWED_UNBOUNDED
    }
    assert not unexpected, (
        "GET endpoints reading high-volume tables with no limit/page parameter or SQL LIMIT: "
        f"{unexpected}. Page them (app.shared.pagination.limited), cap them (LIST_SAFETY_CAP), "
        "or add them to ALLOWED_UNBOUNDED with the reason their size is bounded."
    )


def test_allow_list_has_no_stale_entries():
    # An allow-listed endpoint that is now bounded (or gone) should be removed,
    # so the list keeps meaning something.
    current = _unbounded_high_volume_readers()
    stale = sorted(key for key in ALLOWED_UNBOUNDED if key not in current)
    assert not stale, f"Remove these from ALLOWED_UNBOUNDED: {stale}"


@pytest.mark.parametrize(
    "module,function",
    [
        ("bank_transactions", "list_bank_statement_lines"),
        ("financial_performance", "get_cashbook"),
        ("general_ledger", "account_ledger"),
    ],
)
def test_paged_endpoints_take_limit_and_offset(module, function):
    source = (ROOT / "routers" / f"{module}.py").read_text(encoding="utf-8")
    node = next(
        n for n in ast.walk(ast.parse(source)) if isinstance(n, ast.AsyncFunctionDef) and n.name == function
    )
    params = {a.arg for a in node.args.args + node.args.kwonlyargs}
    assert {"limit", "offset"} <= params
    assert "limited(" in ast.get_source_segment(source, node)


def test_limited_envelope():
    rows = [{"id": i, "_total": 5} for i in range(2)]
    out = limited(rows, limit=2, offset=0)
    assert out["data"] == [{"id": 0}, {"id": 1}]
    assert out["meta"] == {"total": 5, "limit": 2, "offset": 0, "has_more": True}

    last = limited([{"id": 4, "_total": 5}], limit=2, offset=4)
    assert last["meta"]["has_more"] is False

    assert limited([], limit=2, offset=0)["meta"] == {"total": 0, "limit": 2, "offset": 0, "has_more": False}
    # past the end there's no row to read the total from - unknown, not 0
    assert limited([], limit=2, offset=10)["meta"]["total"] is None


def test_safety_cap():
    assert apply_safety_cap(list(range(LIST_SAFETY_CAP))) == (list(range(LIST_SAFETY_CAP)), False)
    rows, truncated = apply_safety_cap(list(range(LIST_SAFETY_CAP + 1)))
    assert truncated and len(rows) == LIST_SAFETY_CAP
