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
class AssessmentDefinition:
    code: str
    title: str
    role: str
    minutes: int
    # Start of question 1's title, used to reject an export from the other quiz.
    q1_prefix: str


ASSESSMENTS: dict[str, AssessmentDefinition] = {
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

    question_cols: dict[int, int] = {}
    for idx, header in enumerate(headers):
        match = _QUESTION_HEADER.match(header)
        if match:
            n = int(match.group(1))
            if 1 <= n <= QUESTION_COUNT and n not in question_cols:
                question_cols[n] = idx
                if n == 1 and not match.group(2).startswith(definition.q1_prefix):
                    raise AssessmentImportError(
                        f"This export is not from '{definition.title}' (question 1 does not match)."
                    )
    missing = [n for n in range(1, QUESTION_COUNT + 1) if n not in question_cols]
    if missing:
        raise AssessmentImportError(
            f"The export is missing question columns {missing[:5]}{'...' if len(missing) > 5 else ''}. "
            "Upload the unmodified Forms 'Open in Excel' file."
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

        scored = score_answers(definition.role, answers)
        warnings = []
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
