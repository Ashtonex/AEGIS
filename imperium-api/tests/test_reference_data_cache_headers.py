import ast
from pathlib import Path

import pytest
from fastapi import Response

from core.cache import REFERENCE_DATA_MAX_AGE_SECONDS, set_reference_data_cache_headers

ROOT = Path(__file__).resolve().parents[1]
FRONTEND_CORE = ROOT.parent / "aegis-web" / "src" / "lib" / "api" / "core.ts"

# Slow-changing, org-scoped lookups that are browser-cached (audit item 4.2).
REFERENCE_ENDPOINTS = {
    "crm": ["list_win_loss_reasons", "list_templates"],
    "crm_tasks": ["list_task_templates"],
    "sop_compliance": ["list_sop_templates"],
    "general_ledger": ["list_accounts"],
    "finance_statutory": ["list_rate_tables", "get_active_rate_table"],
    "crm_leads": ["list_compliance_requirement_types"],
    "quotations": ["list_rate_benchmarks"],
    "financial_performance": ["list_cost_codes"],
    "finance_departments": ["list_departments"],
}


def test_reference_headers_are_private_and_vary_on_authorization():
    response = Response()
    set_reference_data_cache_headers(response)

    assert response.headers["Cache-Control"] == f"private, max-age={REFERENCE_DATA_MAX_AGE_SECONDS}"
    # Without this, another user signing in on the same browser could be
    # served the previous user's cached copy of the same URL.
    assert response.headers["Vary"] == "Authorization"


def test_reference_headers_keep_existing_vary_values_and_are_idempotent():
    response = Response(headers={"Vary": "Origin"})
    set_reference_data_cache_headers(response)
    set_reference_data_cache_headers(response)

    assert response.headers["Vary"] == "Origin, Authorization"


@pytest.mark.parametrize(
    "module,function",
    [(module, function) for module, functions in REFERENCE_ENDPOINTS.items() for function in functions],
)
def test_reference_endpoint_sets_cache_headers(module, function):
    tree = ast.parse((ROOT / "routers" / f"{module}.py").read_text(encoding="utf-8"))
    node = next(
        n for n in ast.walk(tree) if isinstance(n, ast.AsyncFunctionDef) and n.name == function
    )
    assert any(
        isinstance(d, ast.Call) and getattr(d.func, "attr", "") == "get" for d in node.decorator_list
    ), "only GET endpoints may be cached"
    calls = {
        c.func.id
        for c in ast.walk(node)
        if isinstance(c, ast.Call) and isinstance(c.func, ast.Name)
    }
    assert "set_reference_data_cache_headers" in calls


def test_frontend_revalidates_after_writes_for_at_least_max_age():
    source = FRONTEND_CORE.read_text(encoding="utf-8")
    marker = "const REFERENCE_CACHE_BYPASS_MS = "
    bypass_ms = int(source.split(marker, 1)[1].split(";", 1)[0].replace("_", ""))
    # A window shorter than max-age would let a copy cached just before the
    # user's own edit be served back to them afterwards.
    assert bypass_ms >= REFERENCE_DATA_MAX_AGE_SECONDS * 1000
    assert 'requestOptions.cache = "no-cache"' in source
    assert "recordApiWrite();" in source
