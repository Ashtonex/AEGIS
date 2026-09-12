"""
Hard-coded, read-only tool allow-list for the AI Financial Control
Assistant (Phase 10B).

This module is deliberately the ONLY place the assistant's available
"tools" are defined. Every entry wraps an already-existing, already
permission-gated read function - never a write/mutating one. This file
must never gain a function that proposes, approves, posts, settles, or
deletes anything: get_available_tools() is the sole source the OpenAI
tool-calling schema and the orchestration loop's own allow-list are built
from, so a write tool accidentally added here would be directly callable
by the model. There is no other path to widen what the assistant can do.

Two of the tools below (list_ccb_findings, get_historical_reconciliation)
duplicate a read query that today lives inline in a router rather than a
service module, instead of importing from the router - matching the
precedent set in Phase 5A (company_budget.py writing its own department
P&L query rather than importing financial_performance.py's private
helper), since importing router -> service would invert this codebase's
established service -> router dependency direction.
"""

from dataclasses import dataclass
from datetime import date
from typing import Any, Awaitable, Callable, Dict, Optional
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.finance import cash_position, company_budget, general_ledger, gl_bridge, tax_calendar, vat_engine


@dataclass(frozen=True)
class ToolSpec:
    name: str
    permission_key: str
    description: str
    parameters_schema: Dict[str, Any]
    fn: Callable[..., Awaitable[Any]]

    def to_openai_schema(self) -> Dict[str, Any]:
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters_schema,
            },
        }


async def _tool_get_trial_balance(
    db: AsyncSession, org_id: str, *, as_of_date: Optional[str] = None
) -> list:
    parsed = date.fromisoformat(as_of_date) if as_of_date else None
    return await general_ledger.get_trial_balance(db, org_id=org_id, as_of_date=parsed)


async def _tool_get_project_ledger(
    db: AsyncSession, org_id: str, *, project_id: str, date_from: Optional[str] = None, date_to: Optional[str] = None
) -> list:
    return await gl_bridge.get_project_ledger(
        db,
        org_id=org_id,
        project_id=UUID(project_id),
        date_from=date.fromisoformat(date_from) if date_from else None,
        date_to=date.fromisoformat(date_to) if date_to else None,
    )


async def _tool_get_project_gl_reconciliation(db: AsyncSession, org_id: str, *, project_id: str) -> dict:
    return await gl_bridge.get_project_gl_reconciliation(db, org_id=org_id, project_id=UUID(project_id))


async def _tool_list_ccb_findings(
    db: AsyncSession,
    org_id: str,
    *,
    status: Optional[str] = None,
    check_type: Optional[str] = None,
    project_id: Optional[str] = None,
) -> list:
    """Mirrors routers/finance_ccb_findings.py's list_ccb_findings query -
    same filters, same ordering - without importing from the router."""
    rows = await db.execute(
        text("""
            SELECT f.id, f.project_id, p.name AS project_title, f.check_type,
                   f.severity, f.status, f.summary, f.first_detected_at, f.last_seen_at
            FROM finance.ccb_monitor_findings f
            JOIN projects.projects p ON p.id = f.project_id
            WHERE f.organization_id = :org_id AND f.is_deleted = false
              AND (CAST(:status AS varchar) IS NULL OR f.status = CAST(:status AS varchar))
              AND (CAST(:check_type AS varchar) IS NULL OR f.check_type = CAST(:check_type AS varchar))
              AND (CAST(:project_id AS uuid) IS NULL OR f.project_id = CAST(:project_id AS uuid))
            ORDER BY
                CASE f.status WHEN 'open' THEN 0 WHEN 'acknowledged' THEN 1 ELSE 2 END,
                f.last_seen_at DESC
            LIMIT 50
        """),
        {"org_id": org_id, "status": status, "check_type": check_type, "project_id": project_id},
    )
    return [dict(r) for r in rows.mappings()]


async def _tool_get_vat_net_position(
    db: AsyncSession, org_id: str, *, period_start: Optional[str] = None, period_end: Optional[str] = None
) -> dict:
    return await vat_engine.get_vat_net_position(
        db,
        org_id=org_id,
        period_start=date.fromisoformat(period_start) if period_start else None,
        period_end=date.fromisoformat(period_end) if period_end else None,
    )


async def _tool_get_upcoming_tax_deadlines(db: AsyncSession, org_id: str) -> list:
    return await tax_calendar.get_upcoming_deadlines(db, org_id=org_id)


async def _tool_get_cash_forecast(db: AsyncSession, org_id: str) -> dict:
    return await cash_position.compute_cash_forecast(db, org_id)


async def _tool_get_cash_runway(db: AsyncSession, org_id: str) -> dict:
    return await cash_position.compute_cash_runway(db, org_id)


async def _tool_get_historical_reconciliation(db: AsyncSession, org_id: str) -> list:
    """Mirrors routers/financial_performance.py's get_historical_reconciliation
    query set - same recorded-vs-baseline variance logic, same honest null
    (never a fabricated zero) when no baseline has been set."""
    projects_rows = await db.execute(
        text("""
            SELECT id, name, project_code
            FROM projects.projects
            WHERE organization_id = :org_id AND is_deleted = false AND is_historical = true
            ORDER BY name
        """),
        {"org_id": org_id},
    )
    projects_list = [dict(r) for r in projects_rows.mappings()]
    if not projects_list:
        return []
    project_ids = [p["id"] for p in projects_list]

    revenue_rows = await db.execute(
        text("""
            SELECT project_id, COALESCE(SUM(certified_amount), 0) AS recorded_revenue
            FROM finance.progress_claims
            WHERE organization_id = :org_id AND is_deleted = false AND project_id = ANY(:project_ids)
            GROUP BY project_id
        """),
        {"org_id": org_id, "project_ids": project_ids},
    )
    revenue_by_project = {r["project_id"]: dict(r) for r in revenue_rows.mappings()}

    cost_rows = await db.execute(
        text("""
            SELECT project_id, COALESCE(SUM(amount), 0) AS recorded_cost
            FROM finance.cost_transactions
            WHERE organization_id = :org_id AND source_type = 'historical_backfill' AND project_id = ANY(:project_ids)
            GROUP BY project_id
        """),
        {"org_id": org_id, "project_ids": project_ids},
    )
    cost_by_project = {r["project_id"]: dict(r) for r in cost_rows.mappings()}

    baseline_rows = await db.execute(
        text("""
            SELECT project_id, category, expected_amount
            FROM finance.historical_reconciliation_baselines
            WHERE organization_id = :org_id AND project_id = ANY(:project_ids)
        """),
        {"org_id": org_id, "project_ids": project_ids},
    )
    baselines_by_project: dict = {}
    for r in baseline_rows.mappings():
        baselines_by_project.setdefault(r["project_id"], {})[r["category"]] = r["expected_amount"]

    results = []
    for p in projects_list:
        pid = p["id"]
        recorded_revenue = float((revenue_by_project.get(pid, {}) or {}).get("recorded_revenue", 0) or 0)
        recorded_cost = float((cost_by_project.get(pid, {}) or {}).get("recorded_cost", 0) or 0)
        baselines = baselines_by_project.get(pid, {})
        expected_revenue = baselines.get("revenue")
        expected_cost = baselines.get("cost")
        results.append({
            "project_id": str(pid), "project_name": p["name"],
            "recorded_revenue": recorded_revenue,
            "recorded_cost": recorded_cost,
            "expected_revenue": float(expected_revenue) if expected_revenue is not None else None,
            "expected_cost": float(expected_cost) if expected_cost is not None else None,
            "revenue_variance": round(recorded_revenue - float(expected_revenue), 2) if expected_revenue is not None else None,
            "cost_variance": round(recorded_cost - float(expected_cost), 2) if expected_cost is not None else None,
        })
    return results


async def _tool_get_company_budget_variance(db: AsyncSession, org_id: str, *, fiscal_year: int) -> dict:
    return await company_budget.get_company_variance(db, org_id=org_id, fiscal_year=fiscal_year)


async def _tool_get_department_budget_variance(
    db: AsyncSession, org_id: str, *, department_id: str, fiscal_year: int
) -> dict:
    return await company_budget.get_department_variance(
        db, org_id=org_id, department_id=UUID(department_id), fiscal_year=fiscal_year
    )


_ALL_TOOLS: list = [
    ToolSpec(
        name="get_trial_balance",
        permission_key="finance.gl.read",
        description="Get the general ledger trial balance (every account's total debit/credit/net balance) as of a date, from posted journals only.",
        parameters_schema={
            "type": "object",
            "properties": {
                "as_of_date": {"type": "string", "description": "ISO date (YYYY-MM-DD). Omit for the current position."},
            },
        },
        fn=_tool_get_trial_balance,
    ),
    ToolSpec(
        name="get_project_ledger",
        permission_key="finance.gl.read",
        description="Get the posted general ledger lines tagged to one project, optionally bounded by date.",
        parameters_schema={
            "type": "object",
            "properties": {
                "project_id": {"type": "string", "description": "UUID of the project."},
                "date_from": {"type": "string", "description": "ISO date, inclusive lower bound."},
                "date_to": {"type": "string", "description": "ISO date, inclusive upper bound."},
            },
            "required": ["project_id"],
        },
        fn=_tool_get_project_ledger,
    ),
    ToolSpec(
        name="get_project_gl_reconciliation",
        permission_key="finance.gl.read",
        description="Compare GL-derived actual cost/certified revenue for a project against the operational (non-GL) forecast figures for the same project, surfacing any drift between the two sources.",
        parameters_schema={
            "type": "object",
            "properties": {"project_id": {"type": "string", "description": "UUID of the project."}},
            "required": ["project_id"],
        },
        fn=_tool_get_project_gl_reconciliation,
    ),
    ToolSpec(
        name="list_ccb_findings",
        permission_key="finance.ccb_findings.read",
        description="List automated Commercial Control Brain (CCB) anomaly findings - budget overruns, stale approvals, invoice/VAT/labour/fuel/stock variances, etc. Filterable by status, check_type, or project.",
        parameters_schema={
            "type": "object",
            "properties": {
                "status": {"type": "string", "enum": ["open", "acknowledged", "resolved"]},
                "check_type": {"type": "string", "description": "One of the CCB check_type values, e.g. budget_boq_overrun, gl_proposal_stale_review."},
                "project_id": {"type": "string", "description": "UUID of the project."},
            },
        },
        fn=_tool_list_ccb_findings,
    ),
    ToolSpec(
        name="get_vat_net_position",
        permission_key="finance.statutory.read",
        description="Get output VAT, input VAT, and net VAT payable for a filing period (defaults to the org's configured filing period, or the current calendar month if none is configured).",
        parameters_schema={
            "type": "object",
            "properties": {
                "period_start": {"type": "string", "description": "ISO date."},
                "period_end": {"type": "string", "description": "ISO date."},
            },
        },
        fn=_tool_get_vat_net_position,
    ),
    ToolSpec(
        name="get_upcoming_tax_deadlines",
        permission_key="finance.statutory.read",
        description="List upcoming and overdue statutory (VAT/PAYE/NSSA/etc.) filing deadlines with days until due and outstanding amounts.",
        parameters_schema={"type": "object", "properties": {}},
        fn=_tool_get_upcoming_tax_deadlines,
    ),
    ToolSpec(
        name="get_cash_forecast",
        permission_key="finance.cash.read",
        description="Get the multi-horizon (yesterday through 12 months) Committed/Probable cash position forecast, plus an undated weighted CRM pipeline figure shown separately.",
        parameters_schema={"type": "object", "properties": {}},
        fn=_tool_get_cash_forecast,
    ),
    ToolSpec(
        name="get_cash_runway",
        permission_key="finance.cash.read",
        description="Get total cash on hand, trailing monthly burn rate, and runway in months.",
        parameters_schema={"type": "object", "properties": {}},
        fn=_tool_get_cash_runway,
    ),
    ToolSpec(
        name="get_historical_reconciliation",
        permission_key="finance.historical_entry.read",
        description="For pre-AEGIS historical projects: recorded revenue/cost so far vs. an optionally-set baseline from old records, with the variance (null, never a fabricated zero, when no baseline was set).",
        parameters_schema={"type": "object", "properties": {}},
        fn=_tool_get_historical_reconciliation,
    ),
    ToolSpec(
        name="get_company_budget_variance",
        permission_key="finance.company_budget.read",
        description="Get company-wide budget vs. actual variance (revenue, cost, net) for a fiscal year.",
        parameters_schema={
            "type": "object",
            "properties": {"fiscal_year": {"type": "integer", "description": "e.g. 2026."}},
            "required": ["fiscal_year"],
        },
        fn=_tool_get_company_budget_variance,
    ),
    ToolSpec(
        name="get_department_budget_variance",
        permission_key="finance.company_budget.read",
        description="Get one department's budget vs. actual variance (revenue, cost, net) for a fiscal year.",
        parameters_schema={
            "type": "object",
            "properties": {
                "department_id": {"type": "string", "description": "UUID of the department."},
                "fiscal_year": {"type": "integer", "description": "e.g. 2026."},
            },
            "required": ["department_id", "fiscal_year"],
        },
        fn=_tool_get_department_budget_variance,
    ),
]

_TOOLS_BY_NAME: Dict[str, ToolSpec] = {t.name: t for t in _ALL_TOOLS}


def get_available_tools(user_permissions: set) -> list:
    """The only place the assistant's tool list is derived from - filtered
    strictly to what this specific caller already holds. A tool never
    offered here can also never be invoked (the orchestration loop
    independently re-checks against this same filtered set before
    executing any tool-call the model returns - see ai_assistant.py)."""
    return [t for t in _ALL_TOOLS if t.permission_key in user_permissions]


def get_tool_by_name(name: str, allowed_tools: list):
    """Returns the ToolSpec only if it is both a known tool AND present in
    the caller's own allowed_tools list - never resolves a name outside
    that filtered set, even if it exists in the full registry."""
    allowed_names = {t.name for t in allowed_tools}
    if name not in allowed_names:
        return None
    return _TOOLS_BY_NAME.get(name)
