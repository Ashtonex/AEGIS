from datetime import date, datetime, timezone

import pytest

from app.services.hr import performance as perf
from app.services.hr import performance_email as pe
from app.services.hr.performance import WeekMetrics


def utc(*args):
    return datetime(*args, tzinfo=timezone.utc)


# 2026-10-09 is a Friday; Harare is UTC+2.
def test_scoring_week_is_friday_to_the_thursday_before():
    assert perf.scoring_week(utc(2026, 10, 9, 5, 0)) == (date(2026, 10, 2), date(2026, 10, 8))
    # On Thursday itself the week isn't over: the previous one is the latest.
    assert perf.scoring_week(utc(2026, 10, 8, 20, 0)) == (date(2026, 9, 25), date(2026, 10, 1))


def test_sends_from_friday_0700_harare():
    assert not perf.is_send_time(utc(2026, 10, 9, 4, 59))  # 06:59 Harare
    assert perf.is_send_time(utc(2026, 10, 9, 5, 0))
    assert not perf.is_send_time(utc(2026, 10, 10, 5, 0))  # Saturday


def test_week_must_end_on_thursday():
    with pytest.raises(ValueError):
        perf.week_for_end(date(2026, 10, 9))


def test_grade_bands():
    assert [perf.grade_for(s) for s in (85, 84.9, 70, 60, 59.9, 50, 49.9)] == ["A", "B", "B", "C", "D", "D", "F"]
    assert perf.grade_for(None) is None


def test_working_days_skip_weekends_holidays_leave_and_before_start():
    days = perf.working_days(date(2026, 10, 2), date(2026, 10, 8), holidays={date(2026, 10, 5)},
                             leave={date(2026, 10, 6)}, employed_from=date(2026, 10, 3))
    assert days == [date(2026, 10, 7), date(2026, 10, 8)]


def full_week(**overrides) -> WeekMetrics:
    days = [date(2026, 10, d) for d in (2, 5, 6, 7, 8)]
    m = WeekMetrics(workdays=days, attendance_tracked_days=days, present_days=5, late_days=0,
                    tasks_due=10, tasks_on_time=10, open_tasks=5, overdue_tasks=0, completed=10,
                    new_tasks=4, picked_up=4, hours_confirmation_applies=True, hours_confirmed=True,
                    hours_week_end=date(2026, 10, 2), productive_days=5)
    for k, v in overrides.items():
        setattr(m, k, v)
    return m


def test_a_clean_week_scores_100():
    score, grade, weight = perf.overall(perf.score_components(full_week()))
    assert (score, grade, weight) == (100.0, "A", 100)


def test_delivery_mixes_on_time_rate_and_overdue_share_and_penalises_missing_evidence():
    c = perf.score_components(full_week(tasks_on_time=5, overdue_tasks=1, missing_evidence=1))
    # 70*0.5 + 30*(1-1/5) - 10
    assert c["delivery"]["score"] == 49.0


def test_reliability_is_presence_then_punctuality():
    c = perf.score_components(full_week(present_days=4, late_days=2))
    assert c["reliability"]["score"] == 74.0  # 80*4/5 + 20*2/4


def test_unmeasurable_areas_are_reweighted():
    m = full_week(tasks_due=0, open_tasks=0, new_tasks=0, completed=0)
    c = perf.score_components(m)
    assert c["delivery"]["score"] is None and c["responsiveness"]["score"] is None
    score, grade, weight = perf.overall(c)
    assert weight == 45 and score == 100.0


def test_too_little_to_measure_is_not_graded():
    m = WeekMetrics(workdays=[date(2026, 10, 2)])  # only work recorded is measurable
    score, grade, weight = perf.overall(perf.score_components(m))
    assert (score, grade, weight) == (None, None, 10)


def test_narrative_names_the_numbers():
    c = perf.score_components(full_week(tasks_on_time=3, overdue_tasks=4, present_days=3, late_days=1))
    score, _, _ = perf.overall(c)
    well, improve = perf.narrative(c, score)
    assert any("3 of 10 tasks due this week were closed on time" in i for i in improve)
    assert any("signed in on 3 of 5 working days, late on 1" in i for i in improve)
    assert any(w.startswith("Responsiveness") for w in well)


def test_override_moves_good_and_watch_and_cancels_an_opening():
    assert perf.standing_after_override({"score": 40, "override_score": 65, "standing": "watch", "mode": "live"}, 60) == "good"
    assert perf.standing_after_override({"score": 70, "override_score": 50, "standing": "good", "mode": "live"}, 60) == "watch"
    assert perf.standing_after_override({"score": 40, "override_score": 62, "standing": "assisted_opened", "mode": "live"}, 60) == "good"
    # Never opens an assisted working period retroactively or touches one in progress.
    assert perf.standing_after_override({"score": 70, "override_score": 40, "standing": "assisted", "mode": "live"}, 60) is None


def card(**overrides):
    base = {
        "week_start": date(2026, 10, 2), "week_end": date(2026, 10, 8), "score": 54.1, "grade": "D",
        "override_score": None, "standing": "watch", "mode": "live",
        "components": perf.score_components(full_week(tasks_on_time=4)),
        "went_well": ["Reliability: signed in on 5 of 5 working days."],
        "to_improve": ["Delivery: 4 of 10 tasks due this week were closed on time."],
        "next_focus": [{"title": "Submit BOQ <Troutbeck>", "due_date": "2026-10-05"}],
    }
    base.update(overrides)
    return base


def test_employee_email_has_grade_standing_focus_and_pay_lines():
    html = pe.render_employee_email(card(), name="Ekow Imbeah", par=60, app_url="https://aegis.example", trend=[40.0, 54.1])
    assert "Ekow, here is your week" in html
    assert "Below par (60) this week" in html
    assert "Submit BOQ &lt;Troutbeck&gt;" in html  # escaped
    assert "Bonus" in html and "Salary increase" in html and html.count("N/A") == 2
    assert "/dashboard/workforce/my-performance" in html


def test_subject_uses_the_override_when_set():
    assert pe.employee_subject(card(override_score=72)) == "Your weekly performance: B (72) - week ending Thu 08 Oct"
    assert pe.employee_subject(card(score=None, grade=None)).startswith("Your weekly performance: Not graded")
