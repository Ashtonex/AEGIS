"""Emails for the weekly performance scorecards (app/services/hr/performance.py):
the employee's own scorecard, their line manager's team summary and the
management digest (the only one sent in shadow mode)."""

from __future__ import annotations

from datetime import date, timedelta
from html import escape
from typing import Any, Optional

from app.services.hr.performance import (
    DISPUTE_HOURS, LABELS, STANDING_LABELS, WEIGHTS, final_score, grade_for as _grade_of,
)

_FONT = "font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;"
_HEAD = "text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#777;padding:6px 8px;border-bottom:2px solid #ddd;"
_CELL = "font-size:13px;padding:7px 8px;border-bottom:1px solid #eee;vertical-align:top;"
GRADE_COLOURS = {"A": "#067647", "B": "#2e7d32", "C": "#b8860b", "D": "#c4320a", "F": "#b42318"}


def _period(card: dict[str, Any]) -> str:
    ws, we = card["week_start"], card["week_end"]
    return f"Friday {ws.day} {ws:%b} to Thursday {we.day} {we:%b %Y}"


def _score_text(value: Optional[float]) -> str:
    return "–" if value is None else f"{value:.0f}"


def _grade_badge(grade: Optional[str], score: Optional[float]) -> str:
    if not grade:
        return '<span style="font-size:13px;color:#777;font-weight:600;">Not graded</span>'
    colour = GRADE_COLOURS.get(grade, "#333")
    return (f'<span style="display:inline-block;min-width:44px;text-align:center;font-size:26px;font-weight:800;'
            f'color:#fff;background:{colour};border-radius:6px;padding:6px 10px;">{grade}</span>'
            f'<span style="font-size:22px;font-weight:700;margin-left:12px;vertical-align:middle;">{_score_text(score)}/100</span>')


def _table(headers: list[str], rows: list[list[str]]) -> str:
    head = "".join(f'<th style="{_HEAD}">{escape(h)}</th>' for h in headers)
    body = "".join("<tr>" + "".join(f'<td style="{_CELL}">{c}</td>' for c in row) + "</tr>" for row in rows)
    return f'<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;"><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table>'


def _list(items: list[str], empty: str) -> str:
    if not items:
        return f'<p style="font-size:13px;color:#555;margin:0;">{escape(empty)}</p>'
    return '<ul style="margin:0;padding-left:18px;">' + "".join(
        f'<li style="font-size:13px;line-height:1.5;margin-bottom:4px;">{escape(i)}</li>' for i in items) + "</ul>"


def standing_text(card: dict[str, Any], par: float, period: Optional[dict[str, Any]] = None) -> str:
    standing = card["standing"]
    if standing == "watch":
        return (f"Below par ({par:g}) this week. A second week below par in a row starts a two-week "
                "assisted working period with your line manager.")
    if standing == "assisted_opened" and period:
        return (f"Two weeks below par in a row. A two-week assisted working period starts now, supervised by your "
                f"line manager: weeks ending {period['first_week_end']:%d %b} and {period['last_week_end']:%d %b}. "
                f"Target: {period.get('targets') or f'score at or above {par:g} both weeks'}. If the target is not met "
                "the matter is referred to HR.")
    if standing == "assisted" and period:
        return (f"Assisted working period in progress (ends with the week of {period['last_week_end']:%d %b}). "
                f"Target: {period.get('targets') or f'score at or above {par:g} every week'}.")
    if standing == "passed":
        return "Assisted working period completed - target met. Keep it there."
    if standing == "escalated":
        return "The assisted working period target was not met. This has been referred to HR, who will contact you."
    if standing == "not_onboarded":
        return "Not graded: you have not signed in to AEGIS yet."
    if standing == "insufficient_data":
        return "Not graded: AEGIS could not see enough of your week."
    return STANDING_LABELS.get(standing, standing)


def _component_rows(card: dict[str, Any], previous: Optional[dict[str, Any]]) -> list[list[str]]:
    rows = []
    prev_components = (previous or {}).get("components") or {}
    for key in WEIGHTS:
        comp = card["components"].get(key) or {}
        prev = (prev_components.get(key) or {}).get("score")
        score = comp.get("score")
        colour = "#777" if score is None else "#b42318" if score < 60 else "#b8860b" if score < 85 else "#067647"
        rows.append([
            f"<strong>{escape(LABELS[key])}</strong><br><span style='color:#777;font-size:11px;'>{escape(comp.get('target', ''))}</span>",
            f"{WEIGHTS[key]}%",
            f"<strong style='color:{colour};'>{'Not measured' if score is None else _score_text(score)}</strong>",
            _score_text(prev),
        ])
    return rows


def render_employee_email(card: dict[str, Any], *, name: str, par: float, app_url: Optional[str],
                          previous: Optional[dict[str, Any]] = None, trend: Optional[list[Optional[float]]] = None,
                          period: Optional[dict[str, Any]] = None) -> str:
    first = escape(name.split()[0]) if name else "there"
    score = final_score(card)
    overridden = card.get("override_score") is not None
    trend_text = " · ".join(_score_text(s) for s in (trend or [])) or "First week"
    focus = [f"{f['title']} (due {date.fromisoformat(f['due_date']):%a %d %b})" for f in card.get("next_focus") or []]
    link = ""
    if app_url:
        href = escape(f"{app_url.rstrip('/')}/dashboard/workforce/my-performance", quote=True)
        link = f'<a href="{href}" style="color:#b8860b;font-weight:600;">Open your scorecard in AEGIS</a>'
    override_note = ""
    if overridden:
        override_note = (f'<p style="font-size:12px;color:#555;margin:6px 0 0;">Score adjusted by management from '
                         f'{_score_text(card.get("score"))}: {escape(card.get("override_reason") or "")}</p>')
    return f"""<div style="{_FONT}max-width:720px;margin:0 auto;color:#1a1a1a;">
  <p style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#b8860b;font-weight:700;margin:0 0 4px;">AEGIS · Weekly performance</p>
  <h1 style="font-size:21px;margin:0 0 4px;">{first}, here is your week</h1>
  <p style="font-size:13px;color:#555;margin:0 0 16px;">{_period(card)}</p>
  <div style="padding:14px 16px;border:1px solid #e5e5e5;border-radius:8px;margin-bottom:16px;">
    {_grade_badge(_grade_of(score), score)}
    <p style="font-size:12px;color:#555;margin:10px 0 0;">Par is {par:g}. Last four weeks: {escape(trend_text)}</p>
    {override_note}
    <p style="font-size:13px;margin:10px 0 0;"><strong>Standing:</strong> {escape(standing_text(card, par, period))}</p>
  </div>

  <h2 style="font-size:15px;margin:0 0 8px;">Scorecard</h2>
  {_table(["Area", "Weight", "This week", "Last week"], _component_rows(card, previous))}

  <h2 style="font-size:15px;margin:20px 0 8px;">What went well</h2>
  {_list(card.get('went_well') or [], "Nothing reached the target this week.")}

  <h2 style="font-size:15px;margin:20px 0 8px;">Areas to improve</h2>
  {_list(card.get('to_improve') or [], "Nothing below target. Hold this standard.")}

  <h2 style="font-size:15px;margin:20px 0 8px;">Your focus for next week</h2>
  {_list(focus, "No overdue tasks. Keep every task moving before its due date.")}

  <table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;margin-top:20px;">
    <tr><td style="{_CELL}"><strong>Bonus</strong></td><td style="{_CELL}">N/A</td></tr>
    <tr><td style="{_CELL}"><strong>Salary increase</strong></td><td style="{_CELL}">N/A</td></tr>
  </table>

  <p style="font-size:13px;margin:16px 0 0;">{link}</p>
  <p style="font-size:11px;color:#777;margin-top:16px;line-height:1.5;">
    Scored only from what AEGIS recorded this week: tasks, sign-ins, hours confirmations and the work you saved.
    Approved leave and public holidays are excluded. If something is wrong, contest it from your scorecard in AEGIS
    within {DISPUTE_HOURS} hours - say which line and why.
  </p>
</div>"""


def render_employee_text(card: dict[str, Any], *, name: str, par: float, period: Optional[dict[str, Any]] = None) -> str:
    score = final_score(card)
    lines = [f"Weekly performance - {_period(card)}", "",
             f"Grade: {_grade_of(score) or 'Not graded'}  Score: {_score_text(score)}/100  (par {par:g})",
             f"Standing: {standing_text(card, par, period)}", ""]
    for key in WEIGHTS:
        comp = card["components"].get(key) or {}
        lines.append(f"{LABELS[key]} ({WEIGHTS[key]}%): {'Not measured' if comp.get('score') is None else _score_text(comp['score'])}")
    lines += ["", "What went well:"] + [f"- {i}" for i in card.get("went_well") or ["-"]]
    lines += ["", "Areas to improve:"] + [f"- {i}" for i in card.get("to_improve") or ["-"]]
    lines += ["", "Bonus: N/A", "Salary increase: N/A"]
    return "\n".join(lines)


def employee_subject(card: dict[str, Any]) -> str:
    score = final_score(card)
    grade = _grade_of(score)
    head = f"{grade} ({_score_text(score)})" if grade else "Not graded"
    return f"Your weekly performance: {head} - week ending {card['week_end']:%a %d %b}"


def _team_rows(cards: list[dict[str, Any]]) -> list[list[str]]:
    rows = []
    for c in sorted(cards, key=lambda c: (final_score(c) is None, final_score(c) or 0)):
        score = final_score(c)
        grade = _grade_of(score)
        colour = GRADE_COLOURS.get(grade or "", "#777")
        weakest = min(((v.get("score"), LABELS[k]) for k, v in c["components"].items() if v.get("score") is not None), default=None)
        rows.append([
            f"<strong>{escape(c['employee_name'])}</strong>" + (f"<br><span style='color:#777;font-size:11px;'>{escape(c.get('job_title') or '')}</span>"),
            f"<strong style='color:{colour};'>{grade or '–'}</strong> {_score_text(score)}",
            escape(STANDING_LABELS.get(c["standing"], c["standing"])),
            escape(f"{weakest[1]} ({weakest[0]:.0f})") if weakest else "–",
            escape((c.get("to_improve") or [""])[0]),
        ])
    return rows


def render_team_email(cards: list[dict[str, Any]], *, manager_name: str, par: float, week_start: date, week_end: date,
                      app_url: Optional[str], shadow: bool = False, title: str = "Your team's week") -> str:
    graded = [final_score(c) for c in cards if final_score(c) is not None]
    below = sum(1 for s in graded if s < par)
    avg = sum(graded) / len(graded) if graded else None
    flagged = [c for c in cards if c["standing"] in ("assisted_opened", "would_assist", "escalated", "insufficient_data", "not_onboarded")]
    link = ""
    if app_url:
        href = escape(f"{app_url.rstrip('/')}/dashboard/hr/performance?week={week_end.isoformat()}", quote=True)
        link = f'<p style="margin:14px 0 0;"><a href="{href}" style="color:#b8860b;font-weight:600;">Open the scorecards in AEGIS</a></p>'
    banner = ""
    if shadow:
        banner = ('<p style="font-size:13px;background:#fff7e0;border:1px solid #f0d58a;padding:10px 12px;border-radius:6px;">'
                  "<strong>Shadow mode.</strong> Nothing has been sent to staff. Check these scores against what you know, "
                  "then switch scorecards live on the Performance page.</p>")
    actions = ""
    if flagged:
        actions = "<h2 style='font-size:15px;margin:20px 0 8px;'>Needs your action</h2>" + _list([
            f"{c['employee_name']}: {STANDING_LABELS.get(c['standing'], c['standing'])}" for c in flagged], "")
    stats = [("People", str(len(cards))), ("Average", _score_text(avg)), (f"Below par ({par:g})", str(below)),
             ("Not graded", str(len(cards) - len(graded)))]
    stats_html = "".join(
        f'<td style="padding:10px 12px;border:1px solid #e5e5e5;"><div style="font-size:11px;text-transform:uppercase;color:#777;">{escape(k)}</div>'
        f'<div style="font-size:18px;font-weight:700;margin-top:4px;">{escape(v)}</div></td>' for k, v in stats)
    return f"""<div style="{_FONT}max-width:860px;margin:0 auto;color:#1a1a1a;">
  <p style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#b8860b;font-weight:700;margin:0 0 4px;">AEGIS · Weekly performance</p>
  <h1 style="font-size:21px;margin:0 0 4px;">{escape(title)}</h1>
  <p style="font-size:13px;color:#555;margin:0 0 12px;">{escape(manager_name)} · Friday {week_start.day} {week_start:%b} to Thursday {week_end.day} {week_end:%b %Y}</p>
  {banner}
  <table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;margin:8px 0 16px;"><tr>{stats_html}</tr></table>
  {actions}
  <h2 style="font-size:15px;margin:20px 0 8px;">Scores, lowest first</h2>
  {_table(["Person", "Grade", "Standing", "Weakest area", "Top issue"], _team_rows(cards))}
  {link}
  <p style="font-size:11px;color:#777;margin-top:16px;line-height:1.5;">
    A second live week below par opens a two-week assisted working period that you supervise. If it is failed the
    case goes to HR with every scorecard as evidence; HR, not the system, decides the outcome.
  </p>
</div>"""


def previous_week_end(week_end: date) -> date:
    return week_end - timedelta(days=7)
