"""Stage-move logging, BOQ green light / knowledge base, client quotation."""

import asyncio
from pathlib import Path

import pytest
from fastapi import HTTPException

from app.services.quotations import boq_knowledge
from app.shared import stage_moves

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT.parent / "aegis-web" / "src"


# --- stage moves -----------------------------------------------------------

@pytest.mark.parametrize("note", [None, "", "   ", "moved"])
def test_stage_move_without_a_real_note_is_refused(note):
    with pytest.raises(HTTPException) as exc:
        stage_moves.require_stage_note(note)
    assert exc.value.status_code == 422


def test_stage_note_is_whitespace_normalised():
    assert stage_moves.require_stage_note("  Site  visit\n done, scope agreed ") == "Site visit done, scope agreed"


class _RecordingDb:
    def __init__(self, returned_rows=()):
        self.calls = []
        self.returned_rows = list(returned_rows)

    async def execute(self, statement, params):
        self.calls.append((str(statement), params))
        rows = self.returned_rows

        class _R:
            def fetchall(self_inner):
                return rows

        return _R()


def test_completing_stage_tasks_marks_them_completed_not_superseded():
    db = _RecordingDb(returned_rows=[(1,), (2,)])
    count = asyncio.run(stage_moves.complete_open_stage_tasks(
        db, org_id="org", entity_type="opportunity", entity_id="00000000-0000-0000-0000-000000000001",
        from_stage="Site Visit", to_stage="Quotation", note="Measured up, ready to price", user_id=None,
    ))
    sql, params = db.calls[0]
    assert count == 2
    assert "status = 'completed'" in sql
    # Gate-linked tasks are left for their project gate to settle.
    assert "contribution_target_id IS NULL" in sql
    assert "Measured up, ready to price" in params["outcome"]


def test_stage_move_log_targets_the_right_record_column():
    db = _RecordingDb()
    asyncio.run(stage_moves.log_stage_move(
        db, org_id="org", entity_type="tender", entity_id="t1", from_stage="Bid Prep",
        to_stage="Submitted", note="Hand-delivered, receipt stamped", user_id=None, tasks_completed=3,
    ))
    sql, params = db.calls[0]
    assert "tender_id" in sql and "'Stage Change'" in sql
    assert "3 open task(s)" in params["description"]
    with pytest.raises(ValueError):
        asyncio.run(stage_moves.log_stage_move(
            _RecordingDb(), org_id="org", entity_type="project", entity_id="p", from_stage=None,
            to_stage="x", note="whatever note", user_id=None,
        ))


def test_both_pipelines_require_the_note_server_side():
    crm = (ROOT / "routers" / "crm.py").read_text(encoding="utf-8")
    tenders = (ROOT / "routers" / "tender_bids.py").read_text(encoding="utf-8")
    assert 'require_stage_note(values.get("stage_note"))' in crm
    assert "require_stage_note(raw_stage_note)" in tenders
    assert "complete_open_stage_tasks(" in crm and "complete_open_stage_tasks(" in tenders


def test_boards_send_the_stage_note():
    opps = (WEB / "app" / "dashboard" / "crm" / "opportunities" / "page.tsx").read_text(encoding="utf-8")
    tenders = (WEB / "app" / "dashboard" / "crm" / "tenders" / "page.tsx").read_text(encoding="utf-8")
    assert "stage_note: nextActionForm.stageLog.trim()" in opps
    assert "stage_note: note" in tenders


# --- BOQ knowledge ---------------------------------------------------------

def test_tokenize_drops_filler_and_keeps_specifics():
    tokens = boq_knowledge.tokenize("Supply and fix 25MPa concrete to strip footings, including formwork")
    assert "25mpa" in tokens and "concrete" in tokens and "footings" in tokens
    assert "and" not in tokens and "supply" not in tokens and "including" not in tokens


def test_similarity_rewards_same_unit():
    q = set(boq_knowledge.tokenize("25MPa concrete strip footings"))
    c = set(boq_knowledge.tokenize("Concrete 25MPa in strip footings and bases"))
    assert boq_knowledge._score(q, c, same_unit=True) > boq_knowledge._score(q, c, same_unit=False) > 0.5
    assert boq_knowledge._score(q, q, same_unit=True) == 1.0
    assert boq_knowledge._score(q, set(boq_knowledge.tokenize("Steel roof trusses")), True) == 0


def test_unit_aliases():
    assert boq_knowledge._normalize_unit("m²") == boq_knowledge._normalize_unit("sqm") == "m2"
    assert boq_knowledge._normalize_unit("Nr") == "no"


def test_snapshot_skips_blank_lines_and_replaces_previous():
    db = _RecordingDb()
    stored = asyncio.run(boq_knowledge.snapshot_approved_boq(
        db, org_id="org", quotation_id="q", approved_by=None,
        metadata={"items": [
            {"description": "Excavate trenches", "unit": "m3", "quantity": 10, "rate": 5},
            {"description": "   ", "unit": "m3", "quantity": 1, "rate": 1},
            "not-a-dict",
        ]},
        source_type="opportunity", source_id=None, client_name="Client",
    ))
    assert stored == 1
    assert db.calls[0][0].strip().startswith("DELETE FROM finance.boq_knowledge_lines")
    assert db.calls[1][1]["amount"] == 50.0


def test_builder_save_cannot_forge_approval():
    src = (ROOT / "routers" / "quotations.py").read_text(encoding="utf-8")
    assert '_SERVER_OWNED_METADATA_KEYS = ("boq_approval", "client_copy", "uploaded_boq")' in src
    assert "_preserve_server_owned_metadata(db" in src


def test_migration_244_creates_library_and_tender_activity_link():
    sql = (ROOT / "migrations" / "244_boq_knowledge_and_stage_logs.sql").read_text(encoding="utf-8")
    assert "CREATE TABLE IF NOT EXISTS finance.boq_knowledge_lines" in sql
    assert "ADD COLUMN IF NOT EXISTS tender_id" in sql


def test_create_quote_needs_note_only_when_it_moves_the_deal():
    crm = (ROOT / "routers" / "crm.py").read_text(encoding="utf-8")
    section = crm.split('@router.post("/opportunities/{opportunity_id}/create-quotation"', 1)[1].split("@router.post(", 1)[0]
    assert "stage_note = require_stage_note(payload.stage_note) if moves_stage else None" in section
    # No longer drags a Negotiation deal back to Quotation.
    assert "stage=CASE WHEN :move THEN 'Quotation' ELSE stage END" in section
    assert "log_stage_move(" in section and "complete_open_stage_tasks(" in section
    opps = (WEB / "app" / "dashboard" / "crm" / "opportunities" / "page.tsx").read_text(encoding="utf-8")
    assert "stage_note: stageNote" in opps
