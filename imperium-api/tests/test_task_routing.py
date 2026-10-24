from datetime import date

import pytest

from app.shared import task_routing as tr
from app.services.microsoft import teams_notify

# A Monday, so business-day arithmetic is easy to eyeball.
TODAY = date(2026, 9, 28)


def _rules(pools=None):
    pools = pools or {}
    return [
        tr.Rule(
            category_key=r["category_key"],
            label=r["label"],
            keywords=r["keywords"],
            entity_types=r["entity_types"],
            pool=pools.get(r["category_key"], []),
        )
        for r in sorted(tr.DEFAULT_RULES, key=lambda r: r["sort_order"])
    ]


@pytest.mark.parametrize(
    "title, entity_type, expected",
    [
        # Real template titles from the SNC task stacks.
        ("BOQ Buildup", "tender", "qs_figures"),
        ("Rate Buildup", "tender", "qs_figures"),
        ("Quotation Preparation", "opportunity", "qs_figures"),
        ("Build price and margin", "opportunity", "qs_figures"),
        ("Finalise project budget", "award", "qs_figures"),
        ("Measurement and valuation setup", "commercial_readiness", "qs_figures"),
        ("Bid Bond Arrangement", "tender", "finance"),
        ("Confirm payment terms", "award", "finance"),
        ("Open project cost centre", "award", "finance"),
        ("Cash-flow forecast", "commercial_readiness", "finance"),
        ("Finance readiness", "project", "finance"),
        ("Resolve: ZIMRA Tax Clearance / ITF263", "tender_requirement", "finance"),
        ("Initial Qualification Call", "lead", "commercial_follow_up"),
        ("Compliance Documents Gathering", "tender", "commercial_follow_up"),
        ("Follow Up on Submited Tenders", None, "commercial_follow_up"),
        ("Request client feedback", "loss", "commercial_follow_up"),
        ("Subcontractor Sourcing", "tender", "commercial_follow_up"),
        ("Site Handover", "project", "project_delivery"),
        ("Pre-mobilisation review", "project", "project_delivery"),
        ("Approve mobilisation", "award", "project_delivery"),
        ("HSE and quality readiness", "project", "project_delivery"),
        # No keyword: falls to the record type.
        ("Technical readiness", "project", "project_delivery"),
        ("Record winning competitor", "loss", "commercial_follow_up"),
        ("Identify contractual deviations", "award", "qs_figures"),
    ],
)
def test_classify_real_titles(title, entity_type, expected):
    rule, _ = tr.classify({"title": title, "entity_type": entity_type}, _rules(), "commercial_follow_up")
    assert rule is not None and rule.category_key == expected


def test_keyword_needs_word_start():
    rule, why = tr.classify({"title": "Separate the files", "entity_type": None}, _rules(), "commercial_follow_up")
    # "separate" must not hit QS's "rate"
    assert rule.category_key == "commercial_follow_up" and why == "fallback"


def test_active_project_outranks_lost_tender():
    active = {"entity_type": "project", "parent_state": "active", "criticality": "medium"}
    lost = {"entity_type": "tender", "parent_state": "Lost", "criticality": "medium"}
    active_score, _, active_dead = tr.score_task(active, TODAY)
    lost_score, _, lost_dead = tr.score_task(lost, TODAY)
    assert active_score > lost_score
    assert tr.priority_for(active_score, active_dead, "normal") == "high"
    assert tr.priority_for(lost_score, lost_dead, "normal") == "low"


def test_blocker_on_already_active_project_is_not_urgent():
    base = {"entity_type": "project", "criticality": "high", "gate_effect": "blocking"}
    active_score, _, _ = tr.score_task({**base, "parent_state": "active"}, TODAY)
    pre_mob_score, _, _ = tr.score_task({**base, "parent_state": "pending_deposit"}, TODAY)
    assert tr.priority_for(active_score, False, "normal") == "high"
    # Before activation the blocker bonus still applies: 20 (awaiting
    # deposit) + 20 (high criticality) + 15 (blocking).
    assert pre_mob_score == 55


def test_tender_closing_soon_is_urgent_when_critical():
    task = {
        "entity_type": "tender",
        "parent_state": "Tender Identified",
        "parent_deadline": date(2026, 9, 30),
        "criticality": "high",
    }
    score, reason, dead = tr.score_task(task, TODAY)
    assert "closes in 2d" in reason
    assert tr.priority_for(score, dead, "normal") == "urgent"


def test_manual_priority_is_never_downgraded():
    assert tr.priority_for(0, False, "urgent") == "urgent"
    assert tr.priority_for(0, True, "high") == "high"
    assert tr.priority_for(0, True, "normal") == "low"


def test_business_days_skip_weekends():
    friday = date(2026, 10, 2)
    assert tr.add_business_days(friday, 1) == date(2026, 10, 5)


def test_due_date_respects_hard_deadline_and_capacity():
    settings = tr.RoutingSettings(daily_capacity=4)
    # Normal work, 20th in the queue at 4/day -> 5 business days out... but
    # the normal window (10) is later, so the window wins.
    assert tr.due_date_for(
        priority="normal", today=TODAY, settings=settings, hard_deadline=None, person_slot=20,
    ) == tr.add_business_days(TODAY, 10)
    # 60th in the queue -> 15 business days, past the window.
    assert tr.due_date_for(
        priority="normal", today=TODAY, settings=settings, hard_deadline=None, person_slot=60,
    ) == tr.add_business_days(TODAY, 15)
    # Urgent ignores the queue.
    assert tr.due_date_for(
        priority="urgent", today=TODAY, settings=settings, hard_deadline=None, person_slot=60,
    ) == tr.add_business_days(TODAY, 2)
    # High is spread over the queue too, but never past twice its window.
    assert tr.due_date_for(
        priority="high", today=TODAY, settings=settings, hard_deadline=None, person_slot=30,
    ) == tr.add_business_days(TODAY, 8)
    assert tr.due_date_for(
        priority="high", today=TODAY, settings=settings, hard_deadline=None, person_slot=200,
    ) == tr.add_business_days(TODAY, 10)
    # A tender closing Thursday: due the business day before.
    assert tr.due_date_for(
        priority="low", today=TODAY, settings=settings, hard_deadline=date(2026, 10, 1), person_slot=1,
    ) == date(2026, 9, 30)
    # Never in the past.
    assert tr.due_date_for(
        priority="low", today=TODAY, settings=settings, hard_deadline=TODAY, person_slot=1,
    ) == TODAY


def test_bulk_assignment_orders_by_importance_and_dates_each_task():
    tasks = [
        {"id": "a", "title": "Lost tender docs", "entity_type": "tender", "parent_state": "Lost", "priority": "normal"},
        {"id": "b", "title": "Site Handover", "entity_type": "project", "parent_state": "active", "priority": "normal"},
    ]
    planned = tr.plan_bulk_assignment(
        tasks, assignee_id="u1", existing_load=0, settings=tr.RoutingSettings(), today=TODAY,
    )
    assert [p.task_id for p in planned] == ["b", "a"]
    assert planned[0].new_priority == "high" and planned[1].new_priority == "low"
    assert planned[0].due_date == tr.add_business_days(TODAY, 5)
    assert all(p.reassign for p in planned)


def test_project_readiness_pack_shares_the_project_stack():
    project_id = "11111111-1111-1111-1111-111111111111"
    assert tr._entity_key({"id": "a", "entity_type": "commercial_readiness", "entity_id": project_id}) == \
        tr._entity_key({"id": "b", "entity_type": "project", "entity_id": project_id})


def test_bulk_assignment_single_deadline_override():
    tasks = [{"id": "a", "title": "x", "entity_type": None, "priority": "normal"}]
    planned = tr.plan_bulk_assignment(
        tasks, assignee_id="u1", existing_load=0, settings=tr.RoutingSettings(), today=TODAY,
        due_date_override=date(2026, 10, 9), priority_override="urgent",
    )
    assert planned[0].due_date == date(2026, 10, 9)
    assert planned[0].new_priority == "urgent"


def test_webhook_url_allowlist():
    ok = "https://prod-12.westeurope.logic.azure.com:443/workflows/abc/triggers/manual/paths/invoke?sig=x"
    assert teams_notify.validate_webhook_url(ok) == ok
    ok2 = "https://default123.ab.environment.api.powerplatform.com:443/powerautomate/automations/direct/workflows/x"
    assert teams_notify.validate_webhook_url(ok2) == ok2
    for bad in ("http://prod-12.westeurope.logic.azure.com/x", "https://example.com/hook", "https://169.254.169.254/"):
        with pytest.raises(ValueError):
            teams_notify.validate_webhook_url(bad)


def test_teams_payload_carries_recipient_and_card():
    payload = teams_notify.build_payload(
        recipient_email="gamuchirai@example.com",
        recipient_name="Gamuchirai Mufuka",
        tasks=[{"title": f"Task {i}", "due_date": TODAY, "priority": "high", "entity_name": "Tender"} for i in range(15)],
        assigned_by="Takudzwa Tagu",
    )
    assert payload["recipient"] == "gamuchirai@example.com"
    card = payload["card"]
    assert payload["attachments"][0]["content"] is card
    assert card["body"][0]["text"] == "15 new tasks assigned to you"
    assert "more in AEGIS" in card["body"][-1]["text"]
    # Live-site links, never whatever host happened to send the card.
    assert card["actions"][-1]["url"] == "https://sixnineconstruction.com/dashboard/crm/tasks"
    assert card["actions"][0]["url"].startswith("https://teams.microsoft.com/l/entity/")
    assert card["actions"][0]["url"].endswith("/aegis-my-tasks")


def test_teams_messages_address_the_teams_account_not_the_login_email():
    # SNC staff are Microsoft guests on personal addresses; their AEGIS login
    # email has no mailbox. Deliveries must prefer core.users.teams_account.
    from pathlib import Path

    root = Path(__file__).resolve().parents[1]
    notify = (root / "app" / "services" / "microsoft" / "teams_notify.py").read_text(encoding="utf-8")
    router = (root / "routers" / "crm_tasks.py").read_text(encoding="utf-8")
    assert "COALESCE(NULLIF(TRIM(teams_account), ''), email)" in notify
    assert "COALESCE(NULLIF(TRIM(teams_account), ''), email)" in router  # the Send-a-test path too
