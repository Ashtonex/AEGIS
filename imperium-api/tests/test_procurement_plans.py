"""Procurement plans: BOQ pre-fill, lifecycle stages, task routing, endpoints."""

import asyncio
import re
from pathlib import Path

from app.services import procurement_plans as plans
from app.shared.task_routing import DEFAULT_RULES, Rule, classify

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = (ROOT / "migrations" / "273_procurement_plans_and_lifecycle_tasks.sql").read_text(encoding="utf-8")


def test_boq_prefill_keeps_measured_material_lines_only():
    items = [
        {"section": "Quantities", "item_no": "3.1", "description": "Y12 reinforcement to footings", "unit": "kg", "quantity": "1250"},
        {"section": "Quantities", "description": "Concrete 25MPa to bases", "unit": "m3", "quantity": "18.5"},
        {"section": "BoQ", "description": "Site establishment", "unit": "sum", "quantity": "1"},
        {"section": "BoQ", "description": "Supervision", "unit": "week", "quantity": "6"},
        {"section": "Inputs", "description": "Cement 42.5N", "unit": "bag", "quantity": "0"},
        {"section": "BoQ", "description": "", "unit": "kg", "quantity": "10"},
        "not a dict",
    ]
    lines = plans.boq_material_lines(items)
    assert [(l["description"], float(l["quantity"]), l["unit_of_measure"]) for l in lines] == [
        ("Y12 reinforcement to footings", 1250.0, "kg"),
        ("Concrete 25MPa to bases", 18.5, "m3"),
    ]
    assert lines[0]["source_ref"] == "Quantities 3.1"


class _Result:
    def __init__(self, row=None):
        self._row = row

    def mappings(self):
        return self

    def first(self):
        return self._row


class _ProjectDb:
    def __init__(self, status, deposit_confirmed_at=None):
        self.row = {"status": status, "deposit_confirmed_at": deposit_confirmed_at}

    async def execute(self, *_args, **_kwargs):
        return _Result(self.row)


def test_stage_follows_the_project_lifecycle():
    cases = {
        ("pending_deposit", None): "ordering",
        ("pending_deposit", "2026-10-24"): "executing",
        ("active", None): "executing",
        ("completed", "2026-01-01"): "reconciling",
        ("on_hold", None): "sourcing",
    }
    for (status, deposit), expected in cases.items():
        got = asyncio.run(plans._stage_for(_ProjectDb(status, deposit), "org", {"project_id": "p"}))
        assert got == expected, (status, deposit, got)


def test_opportunity_plan_is_planning_until_won():
    class OppDb:
        def __init__(self, won):
            self.won = won

        async def execute(self, *_a, **_k):
            return _Result({"x": 1} if self.won else None)

    assert asyncio.run(plans._stage_for(OppDb(False), "org", {"opportunity_id": "o"})) == "planning"
    assert asyncio.run(plans._stage_for(OppDb(True), "org", {"opportunity_id": "o"})) == "sourcing"


def test_sync_never_raises_into_the_lifecycle_action():
    class BrokenDb:
        rolled_back = False

        async def execute(self, *_a, **_k):
            raise RuntimeError("database unavailable")

        async def rollback(self):
            BrokenDb.rolled_back = True

    assert asyncio.run(plans.sync_procurement_plan(BrokenDb(), org_id="o", user_id="u", project_id="p")) is None
    assert BrokenDb.rolled_back


def test_every_stage_has_a_pack_and_routes_to_the_right_pool():
    rows = re.findall(r"\('(\w+)', \d+, '(\w+)', '((?:[^']|'')+)'", MIGRATION)
    stages = {stage for stage, _, _ in rows}
    assert stages == set(plans.STAGES)
    rules = [Rule(category_key=r["category_key"], label=r["label"], keywords=r["keywords"], entity_types=r["entity_types"], pool=[])
             for r in sorted(DEFAULT_RULES, key=lambda r: r["sort_order"])]
    for stage, code, title in rows:
        title = title.replace("''", "'")
        rule, _ = classify({"title": title, "entity_type": "procurement_plan"}, rules, None)
        expected = "finance" if code == "PROC_ORDER_FINANCE_SIGNOFF" else "procurement"
        assert rule.category_key == expected, (title, rule.category_key)


def test_procurement_titles_do_not_steal_other_teams_tasks():
    rules = [Rule(category_key=r["category_key"], label=r["label"], keywords=r["keywords"], entity_types=r["entity_types"], pool=[])
             for r in sorted(DEFAULT_RULES, key=lambda r: r["sort_order"])]
    rule, _ = classify({"title": "Issue deposit invoice", "entity_type": "project"}, rules, None)
    assert rule.category_key == "finance"
    rule, _ = classify({"title": "Send the quotation to the client", "entity_type": "opportunity"}, rules, None)
    assert rule.category_key != "procurement"


def test_plan_routes_are_permission_gated():
    from fastapi.routing import APIRoute

    from routers import procurement

    expected = {
        ("GET", "/plans"): "procurement.requisition.read",
        ("GET", "/plans/{plan_id}"): "procurement.requisition.read",
        ("POST", "/plans/sync"): "procurement.requisition.create",
        ("POST", "/plans/{plan_id}/items"): "procurement.requisition.create",
        ("PATCH", "/plans/{plan_id}/items/{item_id}"): "procurement.requisition.create",
        ("DELETE", "/plans/{plan_id}/items/{item_id}"): "procurement.requisition.create",
    }
    found = set()
    for route in procurement.router.routes:
        if isinstance(route, APIRoute):
            for method in route.methods:
                if (method, route.path) in expected:
                    found.add((method, route.path))
                    assert any("require_permission" in d.call.__qualname__ for d in route.dependant.dependencies)
    assert found == set(expected)


def test_lifecycle_hooks_are_wired():
    sources = {name: (ROOT / "routers" / f"{name}.py").read_text(encoding="utf-8") for name in ("quotations", "crm", "projects")}
    assert sources["quotations"].count("sync_procurement_plan(") >= 2  # BOQ import + quotation won
    assert "sync_procurement_plan(" in sources["crm"]  # opportunity marked won
    assert sources["projects"].count("sync_procurement_plan(") >= 2  # deposit confirmed + status change
