"""Scoring of Microsoft Forms candidate-assessment exports.

Expected numbers were produced by SNC_Candidate_Assessment_Scoring_Workbook.xlsx
(recalculated in Excel on 2026-09-24) from the same synthetic answers, so the
AEGIS scorer and the workbook are held to the same result.
"""
import io
import json
from pathlib import Path

import pytest
from openpyxl import Workbook

from app.services.hr.recruitment_assessments import (
    AssessmentImportError,
    parse_forms_export,
    score_answers,
)

ROOT = Path(__file__).resolve().parents[1]
QUESTIONS = json.loads((Path(__file__).parent / "fixtures" / "snc_assessment_questions.json").read_text())
LIKERT = ["1 - Strongly disagree", "2 - Disagree", "3 - Neutral/unsure", "4 - Agree", "5 - Strongly agree"]
REVERSE = {"acc": {36, 37, 39}, "fd": {34, 36, 39}}


def _questions(key):
    return [q for q in QUESTIONS[key] if "n" in q]


def _export(key, candidates):
    """Build a workbook shaped like a Forms quiz export (answer, Points, Feedback per question)."""
    wb = Workbook()
    ws = wb.active
    header = ["ID", "Start time", "Completion time", "Email", "Name", "Total points", "Quiz feedback"]
    for f in ["Full Legal Name", "Email Address", "Phone Number", "Position Applied For", "Assessment Date"]:
        header += [f, f"Points - {f}", f"Feedback - {f}"]
    for q in _questions(key):
        title = f"{q['n']}. {q['t']}"
        header += [title, f"Points - {title}", f"Feedback - {title}"]
    ws.append(header)
    for i, (name, email, pick) in enumerate(candidates, start=1):
        row = [i, "9/25/26 9:00:00", "9/25/26 9:45:00", "anonymous", "", "", ""]
        row += [name, "", "", email, "", "", "0772 000 000", "", "", "", "", "", "2026-09-25", "", ""]
        for q in _questions(key):
            row += [pick(q), "", ""]
        ws.append(row)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _perfect(key):
    def pick(q):
        if q["n"] <= 30:
            return q["o"][q["a"]]
        return LIKERT[0] if q["n"] in REVERSE[key] else LIKERT[4]
    return pick


def test_perfect_and_guessing_candidates_match_workbook():
    content = _export("acc", [
        ("Tariro Perfect", "Tariro@Example.com", _perfect("acc")),
        ("Chipo Guess", "chipo@example.com", lambda q: q["o"][0] if q["n"] <= 30 else LIKERT[2]),
    ])
    perfect, guess = parse_forms_export("snc_accounting_2026", content)

    assert perfect.candidate_name == "Tariro Perfect"
    assert perfect.email == "tariro@example.com"
    assert perfect.objective_score == 60 and perfect.objective_max == 60
    assert perfect.overall_score == 100.0
    assert set(perfect.dimension_scores.values()) == {100.0}

    assert guess.objective_score == 8
    assert guess.dimension_scores == {
        "Cognitive": 20.0, "Accuracy": 11.9, "Pressure": 50.0, "Controls": 15.2, "Work Style": 50.0,
    }
    assert guess.overall_score == 29.4
    assert guess.unanswered_count == 0


def test_reverse_scored_work_style_items():
    # Front Desk Q34 is reverse scored: "1 - Strongly disagree" earns the full point.
    base = {n: "" for n in range(1, 41)}
    high = score_answers("Front Desk", {**base, 34: "1 - Strongly disagree"})
    low = score_answers("Front Desk", {**base, 34: "5 - Strongly agree"})
    assert high["question_points"]["Q34"] == 1.0
    assert low["question_points"]["Q34"] == 0.0
    assert high["unanswered_count"] == 39


def test_export_from_the_other_quiz_is_rejected():
    content = _export("fd", [("Rudo", "rudo@example.com", _perfect("fd"))])
    with pytest.raises(AssessmentImportError, match="not from"):
        parse_forms_export("snc_accounting_2026", content)
    assert parse_forms_export("snc_front_desk_2026", content)[0].overall_score == 100.0


def test_non_excel_upload_is_rejected():
    with pytest.raises(AssessmentImportError, match="readable Excel"):
        parse_forms_export("snc_front_desk_2026", b"not a workbook")


def test_import_endpoint_and_recruitment_ui_are_wired():
    router = (ROOT / "routers" / "hr_operations.py").read_text(encoding="utf-8")
    migration = (ROOT / "migrations" / "230_recruitment_assessments.sql").read_text(encoding="utf-8")
    web = ROOT.parent / "aegis-web" / "src"
    api = (web / "lib" / "api" / "hr.ts").read_text(encoding="utf-8")
    panel = (web / "app" / "dashboard" / "hr" / "RecruitmentAssessmentsPanel.tsx").read_text(encoding="utf-8")

    assert '@router.post("/assessments/import")' in router
    assert 'require_permission("hr.operations.create")' in router
    assert "hr.recruitment_assessments" in migration
    assert "FORCE ROW LEVEL SECURITY" in migration
    assert "/api/v1/hr/operations/assessments/import" in api
    assert "importRecruitmentAssessments" in panel
