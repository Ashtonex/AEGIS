from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TENDERS_PAGE = (
    ROOT.parent / "aegis-web" / "src" / "app" / "dashboard" / "crm" / "tenders" / "page.tsx"
).read_text(encoding="utf-8")
TENDER_BIDS_ROUTER = (ROOT / "routers" / "tender_bids.py").read_text(encoding="utf-8")
TENDER_CLOSEOUT_MIGRATION = (
    ROOT / "migrations" / "171_tender_closeout_reason_next_steps.sql"
).read_text(encoding="utf-8")


def test_submitted_tender_status_supersedes_deadline_countdown():
    assert "const POST_SUBMISSION_STAGES = ['Submitted', 'Adjudication', ...RESOLVED_STAGES];" in TENDERS_PAGE
    assert "const isPostSubmissionStage = (stage: string) => POST_SUBMISSION_STAGES.includes(stage);" in TENDERS_PAGE
    assert "if (isPostSubmissionStage(tender.stage))" in TENDERS_PAGE
    assert "Submitted for review" in TENDERS_PAGE
    assert "Under adjudication" in TENDERS_PAGE
    assert "t.submission_deadline || isPostSubmissionStage(t.stage)" in TENDERS_PAGE
    assert "selectedTender.submission_deadline || isPostSubmissionStage(selectedTender.stage)" in TENDERS_PAGE


def test_tender_create_sends_user_bid_number_immediately():
    assert "payload.bid_number = newTender.bid_number.trim();" in TENDERS_PAGE


def test_tender_stage_commit_happens_before_best_effort_task_generation():
    update_section = TENDER_BIDS_ROUTER[
        TENDER_BIDS_ROUTER.index('@router.put("/{item_id}")') : TENDER_BIDS_ROUTER.index('@router.delete("/{item_id}")')
    ]
    first_commit = update_section.index("await db.commit()")
    task_generation = update_section.index("await generate_task_stack(")

    assert first_commit < task_generation
    assert "tender_bids.stage_task_supersede_failed" in update_section
    assert '"data": {"id": item_id, "stage": next_stage if stage_changed else params.get("stage")}' in update_section


def test_tender_resolved_stage_requires_closeout_reason_and_next_steps():
    assert "TENDER_RESOLVED_STAGES = {\"Awarded\", \"Lost\", \"Awarded/Lost\"}" in TENDER_BIDS_ROUTER
    assert "Moving a tender to Awarded or Lost requires a close-out reason and enforced next steps." in TENDER_BIDS_ROUTER
    assert "class TenderCloseoutPayload" in TENDER_BIDS_ROUTER
    assert '@router.post("/{tender_id}/closeout")' in TENDER_BIDS_ROUTER
    assert "closeout_reason" in TENDER_BIDS_ROUTER
    assert "closeout_next_steps" in TENDER_BIDS_ROUTER
    assert "tender.closeout.recorded.v1" in TENDER_BIDS_ROUTER
    assert "tender_closeout_next_step" in TENDER_BIDS_ROUTER
    assert "ADD COLUMN IF NOT EXISTS closeout_status" in TENDER_CLOSEOUT_MIGRATION
    assert "ADD COLUMN IF NOT EXISTS closeout_reason" in TENDER_CLOSEOUT_MIGRATION
    assert "ADD COLUMN IF NOT EXISTS closeout_next_steps" in TENDER_CLOSEOUT_MIGRATION
    assert "ADD COLUMN IF NOT EXISTS closeout_recorded_by" in TENDER_CLOSEOUT_MIGRATION


def test_tender_board_collects_won_lost_reason_and_next_steps():
    assert "closeoutCrmTender" in TENDERS_PAGE
    assert "parseNextSteps" in TENDERS_PAGE
    assert "Why was this tender won?" in TENDERS_PAGE
    assert "Why was this tender lost?" in TENDERS_PAGE
    assert "Enforced next steps" in TENDERS_PAGE
    assert "handleOpenCloseout" in TENDERS_PAGE
    assert "Record why this tender was won and at least one next step." in TENDERS_PAGE
    assert "Record why this tender was lost and at least one next step." in TENDERS_PAGE
