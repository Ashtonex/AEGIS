"""Scoring for the SNC candidate assessments run in Microsoft Forms.

Candidates sit one of two quizzes ("SNC | Accounting Candidate Assessment |
2026" / "SNC | Front Desk Candidate Assessment | 2026"). Microsoft Forms has no
API for reading responses, so HR uploads the Forms "Open in Excel" export and
this module turns each row into a scored candidate profile.

The answer key mirrors the Scoring_Key sheet of
SNC_Candidate_Assessment_Scoring_Workbook.xlsx (corrected 2026-09-24) and the
rules match that workbook, so AEGIS and the workbook always agree:

* Q1-Q30: 2 points when the chosen option's letter ("C. USD 16,750" -> C)
  matches the key, else 0.
* Q31-Q40: 1-5 work-style ratings ("4 - Agree" -> 4), worth 1 point scaled
  as (rating-1)/4, or (5-rating)/4 for reverse-scored statements.
* Each question feeds one dimension; a dimension score is the % of that
  dimension's available points, and overall is the equal-weighted mean of the
  five dimensions.
"""
from __future__ import annotations

import hashlib
import io
import re
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any, Optional

DIMENSIONS = ("Cognitive", "Accuracy", "Pressure", "Controls", "Work Style")
QUESTION_COUNT = 40
OBJECTIVE_COUNT = 30

# (dimension, correct letter or preferred rating, points, reverse scored) for Q1..Q40
_KEYS: dict[str, list[tuple[str, str, int, bool]]] = {
    "Accounting": [
        ("Cognitive", "C", 2, False),  # Q1
        ("Cognitive", "B", 2, False),  # Q2
        ("Cognitive", "D", 2, False),  # Q3
        ("Cognitive", "A", 2, False),  # Q4
        ("Cognitive", "B", 2, False),  # Q5
        ("Cognitive", "C", 2, False),  # Q6
        ("Cognitive", "A", 2, False),  # Q7
        ("Cognitive", "D", 2, False),  # Q8
        ("Cognitive", "B", 2, False),  # Q9
        ("Cognitive", "C", 2, False),  # Q10
        ("Controls", "C", 2, False),  # Q11
        ("Controls", "B", 2, False),  # Q12
        ("Controls", "C", 2, False),  # Q13
        ("Controls", "A", 2, False),  # Q14
        ("Controls", "B", 2, False),  # Q15
        ("Controls", "D", 2, False),  # Q16
        ("Controls", "C", 2, False),  # Q17
        ("Controls", "B", 2, False),  # Q18
        ("Controls", "C", 2, False),  # Q19
        ("Controls", "B", 2, False),  # Q20
        ("Accuracy", "C", 2, False),  # Q21
        ("Accuracy", "C", 2, False),  # Q22
        ("Accuracy", "A", 2, False),  # Q23
        ("Accuracy", "C", 2, False),  # Q24
        ("Accuracy", "B", 2, False),  # Q25
        ("Accuracy", "C", 2, False),  # Q26
        ("Accuracy", "D", 2, False),  # Q27
        ("Accuracy", "C", 2, False),  # Q28
        ("Accuracy", "B", 2, False),  # Q29
        ("Accuracy", "B", 2, False),  # Q30
        ("Pressure", "5", 1, False),  # Q31
        ("Work Style", "5", 1, False),  # Q32
        ("Controls", "5", 1, False),  # Q33
        ("Pressure", "5", 1, False),  # Q34
        ("Work Style", "5", 1, False),  # Q35
        ("Controls", "1", 1, True),  # Q36
        ("Pressure", "1", 1, True),  # Q37
        ("Accuracy", "5", 1, False),  # Q38
        ("Work Style", "1", 1, True),  # Q39
        ("Controls", "5", 1, False),  # Q40
    ],
    "Front Desk": [
        ("Cognitive", "B", 2, False),  # Q1
        ("Cognitive", "B", 2, False),  # Q2
        ("Cognitive", "A", 2, False),  # Q3
        ("Cognitive", "D", 2, False),  # Q4
        ("Cognitive", "C", 2, False),  # Q5
        ("Cognitive", "C", 2, False),  # Q6
        ("Cognitive", "B", 2, False),  # Q7
        ("Cognitive", "A", 2, False),  # Q8
        ("Pressure", "B", 2, False),  # Q9
        ("Pressure", "C", 2, False),  # Q10
        ("Pressure", "B", 2, False),  # Q11
        ("Pressure", "A", 2, False),  # Q12
        ("Pressure", "C", 2, False),  # Q13
        ("Pressure", "A", 2, False),  # Q14
        ("Pressure", "B", 2, False),  # Q15
        ("Controls", "B", 2, False),  # Q16
        ("Controls", "C", 2, False),  # Q17
        ("Controls", "B", 2, False),  # Q18
        ("Controls", "C", 2, False),  # Q19
        ("Controls", "B", 2, False),  # Q20
        ("Controls", "B", 2, False),  # Q21
        ("Controls", "C", 2, False),  # Q22
        ("Accuracy", "C", 2, False),  # Q23
        ("Accuracy", "C", 2, False),  # Q24
        ("Accuracy", "A", 2, False),  # Q25
        ("Accuracy", "C", 2, False),  # Q26
        ("Accuracy", "C", 2, False),  # Q27
        ("Accuracy", "C", 2, False),  # Q28
        ("Accuracy", "D", 2, False),  # Q29
        ("Accuracy", "C", 2, False),  # Q30
        ("Pressure", "5", 1, False),  # Q31
        ("Work Style", "5", 1, False),  # Q32
        ("Controls", "5", 1, False),  # Q33
        ("Pressure", "1", 1, True),  # Q34
        ("Work Style", "5", 1, False),  # Q35
        ("Controls", "1", 1, True),  # Q36
        ("Accuracy", "5", 1, False),  # Q37
        ("Pressure", "5", 1, False),  # Q38
        ("Work Style", "1", 1, True),  # Q39
        ("Controls", "5", 1, False),  # Q40
    ],
}


@dataclass(frozen=True)
class PointsSection:
    name: str
    first: int
    last: int
    max_points: float
    # Pass minimum as a fraction of the section's marks (None = no minimum).
    minimum: Optional[float] = None


@dataclass(frozen=True)
class AssessmentDefinition:
    code: str
    title: str
    role: str
    minutes: int
    # Start of question 1's title, used to reject an export from the other quiz.
    q1_prefix: str
    question_count: int = 40
    # "key": AEGIS marks the answers against _KEYS (the 40-item tests).
    # "points": Forms has already marked every question (auto for choice
    # questions, the assessor for written ones) and AEGIS totals the
    # "Points - <question>" columns of the export by section.
    mode: str = "key"
    sections: tuple[PointsSection, ...] = ()
    written_questions: frozenset[int] = frozenset()


ASSESSMENTS: dict[str, AssessmentDefinition] = {
    # Replaced the 40-item Accounting test on 2026-09-26. Source and assessor
    # guide: "SNC ACCOUNTANT ONLINE ASSESSMENT" (100 marks, 60 minutes).
    # Section B's 7 choice marks were not allocated in the guide; SNC chose
    # Q12 = 3, Q13 = 2, Q14 = 2.
    "snc_accountant_2026": AssessmentDefinition(
        code="snc_accountant_2026",
        title="SNC | Accountant Online Assessment | 2026",
        role="Accounting",
        minutes=60,
        q1_prefix="Opening cash is USD 18,400",
        question_count=24,
        mode="points",
        sections=(
            PointsSection("Section A", 1, 10, 25, minimum=0.60),
            PointsSection("Section B", 11, 14, 15),
            PointsSection("Section C", 15, 21, 25, minimum=0.70),
            PointsSection("Section D", 22, 24, 35, minimum=0.60),
        ),
        written_questions=frozenset({11, 20, 21, 22, 23, 24}),
    ),
    "snc_accounting_2026": AssessmentDefinition(
        code="snc_accounting_2026",
        title="SNC | Accounting Candidate Assessment | 2026",
        role="Accounting",
        minutes=50,
        q1_prefix="A project account starts with USD 18,400",
    ),
    "snc_front_desk_2026": AssessmentDefinition(
        code="snc_front_desk_2026",
        title="SNC | Front Desk Candidate Assessment | 2026",
        role="Front Desk",
        minutes=40,
        q1_prefix="A meeting begins at 10:45",
    ),
}


class AssessmentImportError(ValueError):
    """The uploaded file cannot be read as this assessment's Forms export."""


@dataclass
class ScoredResponse:
    response_ref: str
    candidate_name: str
    email: Optional[str]
    phone: Optional[str]
    submitted_at: Optional[datetime]
    answers: dict[str, str]
    question_points: dict[str, float]
    objective_score: float
    objective_max: float
    dimension_scores: dict[str, float]
    overall_score: float
    unanswered_count: int
    verdict: Optional[str] = None
    warnings: list[str] = field(default_factory=list)


_QUESTION_HEADER = re.compile(r"^\s*(\d{1,2})\.\s+(.*)$", re.DOTALL)


def _clean(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    return str(value).strip()


def _first_char(answer: str) -> str:
    return answer.strip()[:1].upper()


def score_answers(role: str, answers: dict[int, str]) -> dict[str, Any]:
    """Score one candidate's answers ({question number: answer text})."""
    key = _KEYS[role]
    earned = {d: 0.0 for d in DIMENSIONS}
    available = {d: 0.0 for d in DIMENSIONS}
    points: dict[str, float] = {}
    objective = objective_max = 0.0
    unanswered = 0
    for n, (dimension, correct, max_points, reverse) in enumerate(key, start=1):
        available[dimension] += max_points
        if n <= OBJECTIVE_COUNT:
            objective_max += max_points
        raw = answers.get(n, "")
        if not raw.strip():
            unanswered += 1
            points[f"Q{n}"] = 0.0
            continue
        first = _first_char(raw)
        if n <= OBJECTIVE_COUNT:
            got = float(max_points) if first == correct else 0.0
            objective += got
        else:
            if first not in "12345":
                got = 0.0
            else:
                rating = int(first)
                got = ((5 - rating) / 4 if reverse else (rating - 1) / 4) * max_points
        earned[dimension] += got
        points[f"Q{n}"] = round(got, 4)

    dimension_scores = {
        d: round(earned[d] / available[d] * 100, 1) if available[d] else 0.0 for d in DIMENSIONS
    }
    overall = round(sum(dimension_scores.values()) / len(DIMENSIONS), 1)
    return {
        "question_points": points,
        "objective_score": objective,
        "objective_max": objective_max,
        "dimension_scores": dimension_scores,
        "overall_score": overall,
        "unanswered_count": unanswered,
    }


def _band(total: float) -> str:
    # Thresholds from the assessor guide.
    if total >= 80:
        return "Strong"
    if total >= 65:
        return "Suitable subject to interview"
    if total >= 50:
        return "Borderline"
    return "Do not progress"


def score_points(definition: AssessmentDefinition, points: dict[int, Optional[float]]) -> dict[str, Any]:
    """Total Forms-awarded points ({question number: points or None if unmarked}) by section."""
    section_scores: dict[str, float] = {}
    below_minimum = []
    total = 0.0
    for section in definition.sections:
        earned = sum(points.get(n) or 0.0 for n in range(section.first, section.last + 1))
        total += earned
        pct = round(earned / section.max_points * 100, 1)
        section_scores[section.name] = pct
        if section.minimum is not None and earned < section.minimum * section.max_points:
            below_minimum.append(section.name)
    choice_questions = [n for n in range(1, definition.question_count + 1) if n not in definition.written_questions]
    objective = sum(points.get(n) or 0.0 for n in choice_questions)
    objective_max = sum(s.max_points for s in definition.sections) - _written_max(definition)
    unmarked = sorted(n for n in definition.written_questions if points.get(n) is None)

    if unmarked:
        verdict = "Awaiting marking"
    else:
        verdict = _band(total)
        if below_minimum:
            verdict += f"; below minimum in {', '.join(below_minimum)}"
    return {
        "question_points": {f"Q{n}": points.get(n) for n in range(1, definition.question_count + 1)},
        "objective_score": round(objective, 2),
        "objective_max": objective_max,
        "dimension_scores": section_scores,
        "overall_score": round(total, 1),
        "unanswered_count": 0,
        "verdict": verdict,
        "unmarked": unmarked,
    }


# Marks available on the written (assessor-marked) questions, by assessment.
_WRITTEN_MAX = {"snc_accountant_2026": {11: 8, 20: 5, 21: 5, 22: 12, 23: 10, 24: 13}}


def _written_max(definition: AssessmentDefinition) -> float:
    return float(sum(_WRITTEN_MAX.get(definition.code, {}).values()))


def _parse_points(value: Any) -> Optional[float]:
    text = _clean(value)
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _parse_datetime(value: Any) -> Optional[datetime]:
    if isinstance(value, datetime):
        return value
    if isinstance(value, date):
        return datetime(value.year, value.month, value.day)
    text = _clean(value)
    for fmt in ("%m/%d/%y %H:%M:%S", "%m/%d/%Y %H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    return None


def parse_forms_export(assessment_code: str, content: bytes) -> list[ScoredResponse]:
    """Read a Microsoft Forms Excel export and score every response row."""
    definition = ASSESSMENTS.get(assessment_code)
    if definition is None:
        raise AssessmentImportError(f"Unknown assessment '{assessment_code}'.")

    from openpyxl import load_workbook

    try:
        workbook = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    except Exception as exc:  # openpyxl raises several unrelated types for bad files
        raise AssessmentImportError("The file is not a readable Excel (.xlsx) workbook.") from exc

    sheet = workbook.worksheets[0]
    rows = sheet.iter_rows(values_only=True)
    try:
        headers = [_clean(h) for h in next(rows)]
    except StopIteration:
        raise AssessmentImportError("The workbook is empty.")

    count = definition.question_count
    question_cols: dict[int, int] = {}
    points_cols: dict[int, int] = {}
    for idx, header in enumerate(headers):
        if header.startswith("Points - "):
            match = _QUESTION_HEADER.match(header[len("Points - "):])
            if match and 1 <= int(match.group(1)) <= count:
                points_cols.setdefault(int(match.group(1)), idx)
            continue
        match = _QUESTION_HEADER.match(header)
        if match:
            n = int(match.group(1))
            if 1 <= n <= count and n not in question_cols:
                question_cols[n] = idx
                if n == 1 and not match.group(2).startswith(definition.q1_prefix):
                    raise AssessmentImportError(
                        f"This export is not from '{definition.title}' (question 1 does not match)."
                    )
    missing = [n for n in range(1, count + 1) if n not in question_cols]
    if missing:
        raise AssessmentImportError(
            f"The export is missing question columns {missing[:5]}{'...' if len(missing) > 5 else ''}. "
            "Upload the unmodified Forms 'Open in Excel' file."
        )
    if definition.mode == "points":
        missing = [n for n in range(1, count + 1) if n not in points_cols]
        if missing:
            raise AssessmentImportError(
                f"The export has no 'Points' columns for questions {missing[:5]}. Download it from the "
                "quiz's Responses tab (Open in Excel) after marking the written answers."
            )

    def col(*names: str) -> Optional[int]:
        lowered = [h.lower() for h in headers]
        for name in names:
            if name.lower() in lowered:
                return lowered.index(name.lower())
        return None

    id_col = col("ID")
    name_col = col("Full Legal Name", "Name")
    email_col = col("Email Address", "Email")
    phone_col = col("Phone Number")
    done_col = col("Completion time")

    results: list[ScoredResponse] = []
    for row in rows:
        values = list(row)
        if not any(_clean(v) for v in values):
            continue

        def cell(i: Optional[int]) -> str:
            return _clean(values[i]) if i is not None and i < len(values) else ""

        answers = {n: cell(i) for n, i in question_cols.items()}
        name = cell(name_col) or "(name not given)"
        email = cell(email_col).lower() or None
        if email in ("anonymous",):
            email = None
        submitted_at = _parse_datetime(values[done_col]) if done_col is not None and done_col < len(values) else None
        ref = cell(id_col)
        if not ref:
            digest = hashlib.sha1(f"{name}|{email}|{submitted_at}".encode()).hexdigest()[:16]
            ref = f"row-{digest}"

        warnings = []
        if definition.mode == "points":
            scored = score_points(
                definition,
                {n: _parse_points(values[i]) if i < len(values) else None for n, i in points_cols.items()},
            )
            unmarked = scored.pop("unmarked")
            if unmarked:
                warnings.append(f"written answers not yet marked in Forms: Q{', Q'.join(map(str, unmarked))}")
        else:
            scored = score_answers(definition.role, answers)
            if scored["unanswered_count"]:
                warnings.append(f"{scored['unanswered_count']} question(s) unanswered")
        if not email:
            warnings.append("no email given; matched by name")
        results.append(
            ScoredResponse(
                response_ref=ref,
                candidate_name=name,
                email=email,
                phone=cell(phone_col) or None,
                submitted_at=submitted_at,
                answers={f"Q{n}": a for n, a in sorted(answers.items())},
                warnings=warnings,
                **scored,
            )
        )
    if not results:
        raise AssessmentImportError("The export has no responses yet.")
    return results
