from datetime import date, timedelta

from app.services import task_summary
from app.services.microsoft import teams_notify

TODAY = date(2026, 10, 1)


def _tasks():
    return [
        {"title": "Late one", "due_date": TODAY - timedelta(days=2), "priority": "urgent", "entity_name": "Tender A"},
        {"title": "Soon", "due_date": TODAY + timedelta(days=3), "priority": "high", "entity_name": "Project B"},
        {"title": "Later", "due_date": TODAY + timedelta(days=30), "priority": "low", "entity_name": None},
        {"title": "<script>x</script>", "due_date": None, "priority": "normal", "entity_name": "A & B"},
    ]


def test_counts():
    assert task_summary._counts(_tasks(), TODAY) == {"open": 4, "overdue": 1, "this_week": 1, "urgent": 1}


def test_sorted_most_urgent_first():
    titles = [t["title"] for t in sorted(_tasks(), key=task_summary._sort_key)]
    assert titles[0] == "Late one" and titles[-1] == "<script>x</script>"  # no deadline last


def test_summary_card_has_totals_and_both_links():
    payload = teams_notify.build_summary_payload(
        recipient_email="x_gmail.com#EXT#@t.onmicrosoft.com", recipient_name="Ekow Imbeah",
        tasks=_tasks(), counts={"open": 4, "overdue": 1, "this_week": 1, "urgent": 1},
    )
    card = payload["card"]
    assert payload["recipient"] == "x_gmail.com#EXT#@t.onmicrosoft.com"
    assert card["body"][0]["text"] == "Your AEGIS tasks: 4 open"
    assert {f["title"] for f in card["body"][2]["facts"]} == {"Overdue", "Due in 7 days", "Urgent"}
    assert card["actions"][-1]["url"] == "https://sixnineconstruction.com/dashboard/crm/tasks"


def test_email_escapes_task_text():
    body = task_summary._email_html("Ekow Imbeah", _tasks(), task_summary._counts(_tasks(), TODAY), TODAY)
    assert "<script>" not in body and "&lt;script&gt;" in body
    assert "A &amp; B" in body
    assert "Hi Ekow" in body
