"""Stage-pack transitions and task <-> project gate links."""

import asyncio
from pathlib import Path

from app.shared import task_stacks

ROOT = Path(__file__).resolve().parents[1]


class _Result:
    def __init__(self, row):
        self._row = row

    def first(self):
        return self._row


class _StubDb:
    """Answers stage_has_pack's lookup with a fixed set of stages that have
    templates."""

    def __init__(self, stages_with_packs):
        self.stages = {s.lower() for s in stages_with_packs}

    async def execute(self, _statement, params):
        return _Result((1,) if params["stage"].lower() in self.stages else None)


def _should_supersede(entity_type, next_stage, stages_with_packs=()):
    return asyncio.run(
        task_stacks.should_supersede_on_stage_change(
            _StubDb(stages_with_packs), org_id="org", entity_type=entity_type, next_stage=next_stage,
        )
    )


def test_stage_without_pack_keeps_work_in_flight():
    # Tender Identified -> Bid Prep: no Bid Prep pack, so prep work stays.
    assert _should_supersede("tender", "Bid Prep", stages_with_packs={"Submitted", "Lost"}) is False


def test_stage_with_pack_replaces_work():
    assert _should_supersede("tender", "Submitted", stages_with_packs={"Submitted"}) is True
    assert _should_supersede("opportunity", "Negotiation", stages_with_packs={"Negotiation"}) is True


def test_terminal_stage_always_closes_work():
    assert _should_supersede("tender", "Lost") is True
    assert _should_supersede("tender", "Awarded/Lost") is True
    assert _should_supersede("opportunity", "Lost") is True


def test_migration_links_every_pre_mobilisation_gate_and_control():
    from routers.projects import COMMERCIAL_READINESS_CONTROLS, PRE_MOBILISATION_GATES

    sql = (ROOT / "migrations" / "242_stage_task_packs_and_gate_links.sql").read_text(encoding="utf-8")
    for gate, _evidence in PRE_MOBILISATION_GATES:
        assert f"'project_check', '{gate}'" in sql, f"no task clears pre-mobilisation gate {gate!r}"
    for control in COMMERCIAL_READINESS_CONTROLS:
        assert f"'commercial_readiness', '{control}'" in sql, f"no task clears commercial control {control!r}"


def test_gate_sync_is_wired_both_ways():
    crm_tasks = (ROOT / "routers" / "crm_tasks.py").read_text(encoding="utf-8")
    projects = (ROOT / "routers" / "projects.py").read_text(encoding="utf-8")
    assert "await sync_gate_from_task(" in crm_tasks
    assert projects.count("await sync_tasks_from_gate(") >= 2  # pre-mobilisation + commercial readiness
    assert "await complete_stage_pack(" in projects  # deposit pack closes on Confirm Deposit


def test_new_packs_are_distributed_as_generated():
    source = (ROOT / "app" / "shared" / "task_stacks.py").read_text(encoding="utf-8")
    assert "schedule_entity_distribution(" in source
