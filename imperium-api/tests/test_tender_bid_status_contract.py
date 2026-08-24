from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TENDERS_PAGE = (
    ROOT.parent / "aegis-web" / "src" / "app" / "dashboard" / "crm" / "tenders" / "page.tsx"
).read_text(encoding="utf-8")


def test_submitted_tender_status_supersedes_deadline_countdown():
    assert "const POST_SUBMISSION_STAGES = ['Submitted', 'Adjudication', ...RESOLVED_STAGES];" in TENDERS_PAGE
    assert "const isPostSubmissionStage = (stage: string) => POST_SUBMISSION_STAGES.includes(stage);" in TENDERS_PAGE
    assert "if (isPostSubmissionStage(tender.stage))" in TENDERS_PAGE
    assert "Submitted for review" in TENDERS_PAGE
    assert "Under adjudication" in TENDERS_PAGE
    assert "t.submission_deadline || isPostSubmissionStage(t.stage)" in TENDERS_PAGE
    assert "selectedTender.submission_deadline || isPostSubmissionStage(selectedTender.stage)" in TENDERS_PAGE

