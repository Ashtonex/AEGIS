"""Routes open CRM tasks to people by kind of work, importance and urgency.

Every task is placed in a routing category (crm.task_routing_rules: e.g.
commercial follow-ups, QS budgets & figures, finance, project delivery) by
keyword on its title, then by the kind of record it hangs off, then by
keyword on its description, then the org's fallback category. Each category
has a pool of people; all of one record's tasks in one category go to the
same person (whoever in the pool carries the least open work, or whoever
already holds part of that stack), so a QS owns a whole tender's pricing
rather than one line of it.

Importance/urgency is scored from the parent record (active projects and
tenders closing soon score highest; lost tenders and converted leads score
lowest) plus the task's own criticality, gate effect and risk flag. The score
sets the priority, the priority sets the deadline window, and the deadline is
pulled in before any hard date on the parent (a tender's submission
deadline, a project's planned completion). Normal/low work is also spread
over a per-person daily capacity so forty tasks don't all fall due on one
day.

plan_distribution() is pure read + compute; apply_plan() writes it. The
caller decides whether a plan is a preview or gets applied, and owns
notifications (see notify_assignments).
"""

from __future__ import annotations

import asyncio
import json
import math
import re
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Any, Iterable, Optional
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.shared.events import emit_notification
from core.logging import logger

OPEN_STATUS_EXCLUSIONS = ("completed", "cancelled", "superseded", "not_applicable")
PRIORITY_RANK = {"low": 0, "normal": 1, "high": 2, "urgent": 3}

# Seeded once per org on first read, with empty pools. Evaluation order is
# sort_order: finance's "cost centre" must win before QS's "cost", and
# project delivery's "handover" before follow-ups' catch-alls.
DEFAULT_RULES: list[dict[str, Any]] = [
    {
        "category_key": "finance",
        "label": "Finance",
        "sort_order": 10,
        "keywords": [
            "payment", "invoice", "cost centre", "cost center", "cash-flow", "cash flow",
            "bid bond", "bond", "guarantee", "finance", "financial", "tax", "zimra", "vat",
            "paye", "nssa", "deposit", "bank", "insurance", "retention", "itf263",
        ],
        "entity_types": [],
    },
    {
        "category_key": "qs_figures",
        "label": "QS - budgets & figures",
        "sort_order": 20,
        "keywords": [
            "boq", "bill of quantities", "rate", "price", "pricing", "margin", "budget",
            "quotation", "quote", "valuation", "measurement", "variation", "estimate",
            "cost", "baseline", "reconciliation", "claim", "figures", "take-off", "takeoff",
        ],
        "entity_types": ["award", "commercial_readiness"],
    },
    {
        "category_key": "project_delivery",
        "label": "Project delivery",
        "sort_order": 30,
        "keywords": [
            "mobilis", "mobiliz", "site", "handover", "plant", "workforce", "hse", "safety",
            "quality", "construction", "programme", "risk register", "appoint",
            "procurement", "stores", "subcontract package", "equipment",
        ],
        "entity_types": [
            "project", "fleet", "machinery", "plant_request", "plant_dispatch",
            "plant_breakdown", "plant_return", "plant_closure",
        ],
    },
    {
        "category_key": "commercial_follow_up",
        "label": "Commercial - follow-ups",
        "sort_order": 40,
        "keywords": [
            "follow", "call", "feedback", "notify", "contact", "client", "supplier",
            "qualification", "compliance", "document", "collection", "submit", "sourcing",
            "relationship", "lessons", "archive", "logging", "obtain", "request", "clarification",
        ],
        "entity_types": ["lead", "opportunity", "tender", "loss", "clarification", "tender_requirement"],
    },
]
DEFAULT_FALLBACK_CATEGORY = "commercial_follow_up"

# Parent-record states that mean the work no longer moves anything. Tasks
# under them are still distributed (so nothing sits orphaned) but always at
# low priority, behind every live item.
_DEAD_STATES = {
    "lost", "cancelled", "canceled", "withdrawn", "no bid", "not submitted", "closed",
    "completed", "converted", "disqualified", "rejected", "archived", "abandoned",
}


@dataclass
class RoutingSettings:
    auto_distribute: bool = False
    teams_webhook_url: Optional[str] = None
    fallback_category: Optional[str] = DEFAULT_FALLBACK_CATEGORY
    due_days: dict[str, int] = field(
        default_factory=lambda: {"urgent": 2, "high": 5, "normal": 10, "low": 20}
    )
    daily_capacity: int = 4


@dataclass
class Rule:
    category_key: str
    label: str
    keywords: list[str]
    entity_types: list[str]
    pool: list[str]  # active user ids, in configured order
    patterns: list[re.Pattern] = field(default_factory=list)

    def __post_init__(self) -> None:
        # Leading word boundary only, so "mobilis" matches "Pre-mobilisation"
        # and "rate" matches "Rates" but not "separate".
        self.patterns = [re.compile(r"\b" + re.escape(k.lower())) for k in self.keywords if k.strip()]

    def matches(self, value: str) -> bool:
        return any(p.search(value) for p in self.patterns)


@dataclass
class PlannedTask:
    task_id: str
    title: str
    entity_type: Optional[str]
    entity_id: Optional[str]
    entity_name: Optional[str]
    parent_state: Optional[str]
    category_key: Optional[str]
    category_label: Optional[str]
    assignee_id: Optional[str]
    assignee_name: Optional[str]
    previous_assignee_id: Optional[str]
    old_priority: str
    new_priority: str
    old_due_date: Optional[date]
    due_date: Optional[date]
    hard_deadline: Optional[date]
    score: int
    reason: str
    reassign: bool

    def as_dict(self) -> dict[str, Any]:
        return {
            "task_id": self.task_id,
            "title": self.title,
            "entity_type": self.entity_type,
            "entity_id": self.entity_id,
            "entity_name": self.entity_name,
            "parent_state": self.parent_state,
            "category_key": self.category_key,
            "category_label": self.category_label,
            "assignee_id": self.assignee_id,
            "assignee_name": self.assignee_name,
            "old_priority": self.old_priority,
            "new_priority": self.new_priority,
            "old_due_date": self.old_due_date.isoformat() if self.old_due_date else None,
            "due_date": self.due_date.isoformat() if self.due_date else None,
            "hard_deadline": self.hard_deadline.isoformat() if self.hard_deadline else None,
            "score": self.score,
            "reason": self.reason,
        }


# ---------------------------------------------------------------------------
# Settings and rules
# ---------------------------------------------------------------------------


async def ensure_default_rules(db: AsyncSession, org_id: str) -> None:
    """Seeds DEFAULT_RULES for an org that has none yet. Never overwrites."""
    existing = (
        await db.execute(
            text("SELECT 1 FROM crm.task_routing_rules WHERE organization_id = :org_id LIMIT 1"),
            {"org_id": org_id},
        )
    ).first()
    if existing:
        return
    for rule in DEFAULT_RULES:
        await db.execute(
            text("""
                INSERT INTO crm.task_routing_rules (
                    organization_id, category_key, label, keywords, entity_types, sort_order
                ) VALUES (:org_id, :category_key, :label, :keywords, :entity_types, :sort_order)
                ON CONFLICT (organization_id, category_key) DO NOTHING
            """),
            {"org_id": org_id, **rule},
        )


async def load_settings(db: AsyncSession, org_id: str) -> RoutingSettings:
    row = (
        await db.execute(
            text("SELECT * FROM crm.task_routing_settings WHERE organization_id = :org_id"),
            {"org_id": org_id},
        )
    ).mappings().first()
    if not row:
        return RoutingSettings()
    return RoutingSettings(
        auto_distribute=bool(row["auto_distribute"]),
        teams_webhook_url=row["teams_webhook_url"],
        fallback_category=row["fallback_category"] or DEFAULT_FALLBACK_CATEGORY,
        due_days={
            "urgent": row["due_days_urgent"],
            "high": row["due_days_high"],
            "normal": row["due_days_normal"],
            "low": row["due_days_low"],
        },
        daily_capacity=row["daily_capacity"],
    )


async def load_rules(db: AsyncSession, org_id: str) -> list[Rule]:
    await ensure_default_rules(db, org_id)
    rows = (
        await db.execute(
            text("""
                SELECT r.category_key, r.label, r.keywords, r.entity_types,
                       COALESCE(
                           ARRAY(
                               SELECT u.id::text
                               FROM unnest(r.assignee_user_ids) WITH ORDINALITY AS a(user_id, ord)
                               JOIN core.users u ON u.id = a.user_id
                               WHERE u.organization_id = r.organization_id
                                 AND u.is_active = true AND u.is_deleted = false
                               ORDER BY a.ord
                           ),
                           '{}'
                       ) AS pool
                FROM crm.task_routing_rules r
                WHERE r.organization_id = :org_id AND r.is_active = true
                ORDER BY r.sort_order, r.category_key
            """),
            {"org_id": org_id},
        )
    ).mappings().all()
    return [
        Rule(
            category_key=row["category_key"],
            label=row["label"],
            keywords=list(row["keywords"] or []),
            entity_types=[e.lower() for e in (row["entity_types"] or [])],
            pool=list(row["pool"] or []),
        )
        for row in rows
    ]


def classify(task: dict, rules: list[Rule], fallback_category: Optional[str]) -> tuple[Optional[Rule], str]:
    """Returns (rule, why). Title keywords beat record type, which beats
    description keywords - titles are the curated template text, descriptions
    are free prose that mentions all sorts of things."""
    title = (task.get("title") or "").lower()
    description = (task.get("description") or "").lower()
    entity_type = (task.get("entity_type") or "").lower()

    for rule in rules:
        if rule.matches(title):
            return rule, "title keyword"
    for rule in rules:
        if entity_type and entity_type in rule.entity_types:
            return rule, f"{entity_type} work"
    for rule in rules:
        if description and rule.matches(description):
            return rule, "description keyword"
    for rule in rules:
        if rule.category_key == fallback_category:
            return rule, "fallback"
    return None, "no matching rule"


# ---------------------------------------------------------------------------
# Scoring and deadlines
# ---------------------------------------------------------------------------


def _is_dead(state: Optional[str]) -> bool:
    return bool(state) and state.strip().lower() in _DEAD_STATES


def score_task(task: dict, today: date) -> tuple[int, str, bool]:
    """Returns (score, headline reason, parent_is_dead)."""
    entity_type = (task.get("entity_type") or "").lower()
    state = (task.get("parent_state") or "").strip().lower()
    dead = _is_dead(state)
    score = 0
    reason = "standard work"

    if dead:
        reason = f"{entity_type or 'record'} is {state}"
    elif entity_type in ("project", "commercial_readiness"):
        if state == "active":
            score += 50
            reason = "active project"
        elif state == "pending_deposit":
            score += 20
            reason = "project awaiting deposit"
        else:
            reason = f"project {state or 'not started'}"
    elif entity_type == "tender":
        deadline = task.get("parent_deadline")
        if state == "submitted":
            score += 10
            reason = "tender submitted - awaiting result"
        elif deadline:
            days_left = (deadline - today).days
            if days_left < 0:
                reason = "tender deadline passed"
            elif days_left <= 3:
                score += 75
                reason = f"tender closes in {days_left}d"
            elif days_left <= 7:
                score += 50
                reason = f"tender closes in {days_left}d"
            elif days_left <= 14:
                score += 30
                reason = f"tender closes in {days_left}d"
            else:
                score += 15
                reason = f"tender closes in {days_left}d"
        else:
            score += 15
            reason = "open tender, no deadline"
    elif entity_type == "opportunity":
        if state in ("negotiation", "contract"):
            score += 35
        elif state in ("quotation", "proposal"):
            score += 30
        else:
            score += 15
        reason = f"opportunity at {state or 'open'}"
    elif entity_type in ("award", "clarification"):
        score += 30
        reason = "won work - handover"
    elif entity_type == "loss":
        reason = "loss review"
    elif entity_type == "lead":
        score += 10
        reason = f"lead {state or 'open'}"

    score += {"critical": 30, "high": 20, "medium": 10}.get(task.get("criticality") or "medium", 0)
    # A blocker only earns urgency while there's something left to block:
    # a project already active has passed its mobilisation gates.
    already_through_gate = entity_type in ("project", "commercial_readiness") and state == "active"
    if task.get("gate_effect") == "blocking" and not already_through_gate:
        score += 15
    if task.get("risk_flag"):
        score += 10
    # A priority someone set by hand still counts.
    score += {"urgent": 40, "high": 20}.get(task.get("priority") or "normal", 0)
    return score, reason, dead


def priority_for(score: int, dead: bool, current: str) -> str:
    if dead:
        computed = "low"
    elif score >= 85:
        computed = "urgent"
    elif score >= 55:
        computed = "high"
    elif score >= 25:
        computed = "normal"
    else:
        computed = "low"
    # Never downgrade a priority someone raised by hand.
    if PRIORITY_RANK.get(current, 1) > PRIORITY_RANK[computed] and current in ("high", "urgent"):
        return current
    return computed


def add_business_days(start: date, days: int) -> date:
    current = start
    remaining = max(days, 0)
    while remaining > 0:
        current += timedelta(days=1)
        if current.weekday() < 5:
            remaining -= 1
    return current


def _previous_business_day(value: date) -> date:
    current = value - timedelta(days=1)
    while current.weekday() >= 5:
        current -= timedelta(days=1)
    return current


def due_date_for(
    *,
    priority: str,
    today: date,
    settings: RoutingSettings,
    hard_deadline: Optional[date],
    person_slot: int,
) -> date:
    """person_slot is this task's 1-based position in the assignee's queue.
    Work is spread at daily_capacity per business day: urgent keeps its
    window regardless, high is spread but never past twice its window,
    normal/low are spread as far as the queue needs. Callers hand out slots
    most-important first, so urgent/high work gets the early days.
    Everything lands before a hard parent deadline (but never in the past)."""
    window = settings.due_days.get(priority, 10)
    due = add_business_days(today, window)
    if priority != "urgent":
        queue_days = math.ceil(person_slot / max(settings.daily_capacity, 1))
        if priority == "high":
            queue_days = min(queue_days, window * 2)
        due = max(due, add_business_days(today, queue_days))
    if hard_deadline:
        due = min(due, _previous_business_day(hard_deadline))
    return max(due, today)


# ---------------------------------------------------------------------------
# Planning
# ---------------------------------------------------------------------------

_TASK_CONTEXT_SQL = """
    SELECT t.id, t.title, t.description, t.entity_type, t.entity_id, t.priority,
           t.criticality, t.gate_effect, t.risk_flag, t.due_date,
           t.assigned_to_user_id, t.routing_category,
           COALESCE(tender.stage, proj.status, cr_proj.status, opp.stage,
                    pur.status, lead.status) AS parent_state,
           COALESCE(tender.submission_deadline::date, proj.planned_completion_date,
                    cr_proj.planned_completion_date, opp.expected_close_date,
                    lead.expected_close_date) AS parent_deadline,
           COALESCE(lead.company_name, opp.name, tender.tender_name, proj.name,
                    cr_proj.name, pur_tender.tender_name, pur_opp.name,
                    pur_lead.company_name) AS entity_name
    FROM crm.tasks t
    LEFT JOIN crm.tenders tender
           ON t.entity_type = 'tender' AND tender.id = t.entity_id
          AND tender.organization_id = t.organization_id
    LEFT JOIN projects.projects proj
           ON t.entity_type = 'project' AND proj.id = t.entity_id
          AND proj.organization_id = t.organization_id
    LEFT JOIN projects.projects cr_proj
           ON t.entity_type = 'commercial_readiness' AND cr_proj.id = t.entity_id
          AND cr_proj.organization_id = t.organization_id
    LEFT JOIN crm.opportunities opp
           ON t.entity_type = 'opportunity' AND opp.id = t.entity_id
          AND opp.organization_id = t.organization_id
    LEFT JOIN crm.leads lead
           ON t.entity_type = 'lead' AND lead.id = t.entity_id
          AND lead.organization_id = t.organization_id
    LEFT JOIN crm.pursuits pur
           ON t.entity_type IN ('award', 'loss', 'clarification') AND pur.id = t.entity_id
          AND pur.organization_id = t.organization_id
    LEFT JOIN crm.tenders pur_tender ON pur_tender.id = pur.tender_id
    LEFT JOIN crm.opportunities pur_opp ON pur_opp.id = pur.opportunity_id
    LEFT JOIN crm.leads pur_lead ON pur_lead.id = pur.lead_id
    WHERE t.organization_id = :org_id
      AND t.is_deleted = false
      AND t.status NOT IN ('completed', 'cancelled', 'superseded', 'not_applicable')
"""


async def _load_tasks(
    db: AsyncSession,
    org_id: str,
    *,
    task_ids: Optional[list[str]] = None,
    entity_id: Optional[str] = None,
) -> list[dict]:
    sql = _TASK_CONTEXT_SQL
    params: dict[str, Any] = {"org_id": org_id}
    if task_ids is not None:
        sql += " AND t.id = ANY(CAST(:task_ids AS uuid[]))"
        params["task_ids"] = task_ids
    if entity_id is not None:
        sql += " AND t.entity_id = CAST(:entity_id AS uuid)"
        params["entity_id"] = entity_id
    rows = (await db.execute(text(sql), params)).mappings().all()
    return [dict(row) for row in rows]


async def _previous_stack_owners(db: AsyncSession, org_id: str, tasks: list[dict]) -> dict[tuple[str, str], str]:
    """Who last owned each record's work per category, across ANY status -
    so an opportunity's Negotiation pack goes to the QS who priced its
    Quotation pack, even though that earlier work is now completed or
    superseded."""
    entity_ids = list({str(t["entity_id"]) for t in tasks if t.get("entity_id")})
    if not entity_ids:
        return {}
    rows = await db.execute(
        text("""
            SELECT DISTINCT ON (t.entity_type, t.entity_id, t.routing_category)
                   t.entity_type, t.entity_id::text AS entity_id, t.routing_category,
                   t.assigned_to_user_id::text AS owner
            FROM crm.tasks t
            JOIN core.users u ON u.id = t.assigned_to_user_id
                             AND u.is_active = true AND u.is_deleted = false
            WHERE t.organization_id = :org_id
              AND t.entity_id = ANY(CAST(:entity_ids AS uuid[]))
              AND t.routing_category IS NOT NULL
              AND t.is_deleted = false
            ORDER BY t.entity_type, t.entity_id, t.routing_category, t.updated_at DESC
        """),
        {"org_id": org_id, "entity_ids": entity_ids},
    )
    owners: dict[tuple[str, str], str] = {}
    for row in rows:
        key = (_entity_key({"entity_type": row.entity_type, "entity_id": row.entity_id, "id": None}), row.routing_category)
        owners.setdefault(key, row.owner)
    return owners


async def _open_load(db: AsyncSession, org_id: str) -> dict[str, int]:
    rows = await db.execute(
        text("""
            SELECT assigned_to_user_id::text AS user_id, COUNT(*) AS n
            FROM crm.tasks
            WHERE organization_id = :org_id AND is_deleted = false
              AND assigned_to_user_id IS NOT NULL
              AND status NOT IN ('completed', 'cancelled', 'superseded', 'not_applicable')
            GROUP BY assigned_to_user_id
        """),
        {"org_id": org_id},
    )
    return {row.user_id: int(row.n) for row in rows}


async def user_names(db: AsyncSession, user_ids: Iterable[str]) -> dict[str, str]:
    ids = [uid for uid in set(user_ids) if uid]
    if not ids:
        return {}
    rows = await db.execute(
        text("SELECT id::text AS id, full_name FROM core.users WHERE id = ANY(CAST(:ids AS uuid[]))"),
        {"ids": ids},
    )
    return {row.id: row.full_name for row in rows}


# Packs that hang off another record's id: a project's commercial-readiness
# pack is the same job as its project stack, so it shares an owner with it.
_STACK_ALIASES = {"commercial_readiness": "project"}


def _entity_key(task: dict) -> str:
    if task.get("entity_type") and task.get("entity_id"):
        entity_type = _STACK_ALIASES.get(task["entity_type"], task["entity_type"])
        return f"{entity_type}:{task['entity_id']}"
    return f"task:{task['id']}"


async def plan_distribution(
    db: AsyncSession,
    org_id: str,
    *,
    today: Optional[date] = None,
    task_ids: Optional[list[str]] = None,
    entity_id: Optional[str] = None,
) -> dict[str, Any]:
    """Plans every open task that has no person yet (or, with task_ids /
    entity_id, only those). Tasks that already have a person but no
    deadline get a deadline and priority without being moved."""
    today = today or date.today()
    settings = await load_settings(db, org_id)
    rules = await load_rules(db, org_id)
    rules_by_key = {rule.category_key: rule for rule in rules}
    tasks = await _load_tasks(db, org_id, task_ids=task_ids, entity_id=entity_id)
    load = await _open_load(db, org_id)
    previous_owners = await _previous_stack_owners(db, org_id, tasks)

    for task in tasks:
        task["score"], task["reason"], task["dead"] = score_task(task, today)
        task["priority_new"] = priority_for(task["score"], task["dead"], task.get("priority") or "normal")
    # Most important first: they get first pick of people and the earliest
    # capacity slots.
    tasks.sort(key=lambda t: (-t["score"], str(t.get("title") or "")))

    # Who already holds part of each record's stack, per category - keeps a
    # whole stack with one person when new tasks are added to it later.
    # Whoever holds open work now wins; failing that, the record's previous
    # owner in that category, so a new stage pack follows the person who
    # carried the last one.
    current_owner_of: dict[tuple[str, str], str] = {}
    for task in tasks:
        if task.get("assigned_to_user_id") and task.get("routing_category"):
            current_owner_of.setdefault(
                (_entity_key(task), task["routing_category"]), str(task["assigned_to_user_id"])
            )
    stack_owner: dict[tuple[str, str], str] = {**previous_owners, **current_owner_of}

    batch_count: dict[str, int] = {}
    planned: list[PlannedTask] = []
    unroutable: list[dict[str, Any]] = []

    for task in tasks:
        current_owner = str(task["assigned_to_user_id"]) if task.get("assigned_to_user_id") else None
        rule, why = classify(task, rules, settings.fallback_category)
        if current_owner:
            if task.get("due_date"):
                continue  # has an owner and a deadline: nothing to do
            assignee = current_owner
        else:
            pool = rule.pool if rule else []
            if not pool and settings.fallback_category in rules_by_key and rule is not rules_by_key[settings.fallback_category]:
                rule = rules_by_key[settings.fallback_category]
                pool = rule.pool
                why = "fallback - category has nobody"
            if not pool:
                unroutable.append({
                    "task_id": str(task["id"]),
                    "title": task["title"],
                    "category_label": rule.label if rule else None,
                    "reason": "no people in this category" if rule else why,
                })
                continue
            key = (_entity_key(task), rule.category_key)
            owner = stack_owner.get(key)
            if owner not in pool:
                owner = min(
                    pool,
                    key=lambda uid: (load.get(uid, 0) + batch_count.get(uid, 0), pool.index(uid)),
                )
                stack_owner[key] = owner
            assignee = owner

        batch_count[assignee] = batch_count.get(assignee, 0) + 1
        slot = load.get(assignee, 0) + batch_count[assignee]
        hard_deadline = task.get("parent_deadline") if not task["dead"] else None
        if hard_deadline and hard_deadline < today:
            hard_deadline = None
        due = task.get("due_date") or due_date_for(
            priority=task["priority_new"],
            today=today,
            settings=settings,
            hard_deadline=hard_deadline,
            person_slot=slot,
        )
        planned.append(
            PlannedTask(
                task_id=str(task["id"]),
                title=task["title"],
                entity_type=task.get("entity_type"),
                entity_id=str(task["entity_id"]) if task.get("entity_id") else None,
                entity_name=task.get("entity_name"),
                parent_state=task.get("parent_state"),
                category_key=rule.category_key if rule else task.get("routing_category"),
                category_label=rule.label if rule else None,
                assignee_id=assignee,
                assignee_name=None,
                previous_assignee_id=current_owner,
                old_priority=task.get("priority") or "normal",
                new_priority=task["priority_new"],
                old_due_date=task.get("due_date"),
                due_date=due,
                hard_deadline=hard_deadline,
                score=task["score"],
                reason=f"{task['reason']} · {why}",
                reassign=current_owner is None,
            )
        )

    names = await user_names(db, [p.assignee_id for p in planned if p.assignee_id])
    for item in planned:
        item.assignee_name = names.get(item.assignee_id or "")

    return {"planned": planned, "unroutable": unroutable, "settings": settings}


def plan_bulk_assignment(
    tasks: list[dict],
    *,
    assignee_id: str,
    existing_load: int,
    settings: RoutingSettings,
    today: date,
    due_date_override: Optional[date] = None,
    priority_override: Optional[str] = None,
    keep_existing_due: bool = True,
) -> list[PlannedTask]:
    """Everything to one person, still scored and dated individually."""
    for task in tasks:
        task["score"], task["reason"], task["dead"] = score_task(task, today)
    tasks.sort(key=lambda t: (-t["score"], str(t.get("title") or "")))
    planned: list[PlannedTask] = []
    for index, task in enumerate(tasks, start=1):
        priority = priority_override or priority_for(task["score"], task["dead"], task.get("priority") or "normal")
        hard_deadline = task.get("parent_deadline") if not task["dead"] else None
        if hard_deadline and hard_deadline < today:
            hard_deadline = None
        if due_date_override:
            due = due_date_override
        elif keep_existing_due and task.get("due_date"):
            due = task["due_date"]
        else:
            due = due_date_for(
                priority=priority,
                today=today,
                settings=settings,
                hard_deadline=hard_deadline,
                person_slot=existing_load + index,
            )
        current_owner = str(task["assigned_to_user_id"]) if task.get("assigned_to_user_id") else None
        planned.append(
            PlannedTask(
                task_id=str(task["id"]),
                title=task["title"],
                entity_type=task.get("entity_type"),
                entity_id=str(task["entity_id"]) if task.get("entity_id") else None,
                entity_name=task.get("entity_name"),
                parent_state=task.get("parent_state"),
                category_key=task.get("routing_category"),
                category_label=None,
                assignee_id=assignee_id,
                assignee_name=None,
                previous_assignee_id=current_owner,
                old_priority=task.get("priority") or "normal",
                new_priority=priority,
                old_due_date=task.get("due_date"),
                due_date=due,
                hard_deadline=hard_deadline,
                score=task["score"],
                reason=task["reason"],
                reassign=current_owner != assignee_id,
            )
        )
    return planned


async def load_tasks_for_bulk(db: AsyncSession, org_id: str, task_ids: list[str]) -> list[dict]:
    return await _load_tasks(db, org_id, task_ids=task_ids)


async def open_load_for(db: AsyncSession, org_id: str, user_id: str) -> int:
    return (await _open_load(db, org_id)).get(user_id, 0)


# ---------------------------------------------------------------------------
# Applying
# ---------------------------------------------------------------------------


async def apply_plan(
    db: AsyncSession,
    org_id: str,
    planned: list[PlannedTask],
    *,
    source_event: str,
    actor_id: Optional[str],
) -> dict[str, list[PlannedTask]]:
    """Writes the plan. Guards on the task still being open and (for
    auto-distribution) still unowned, so a person who grabbed a task between
    preview and apply keeps it. Returns the newly-assigned tasks grouped by
    assignee - the notification fan-out. Does not commit. Bulk assignment is
    an explicit "give these to X" and is the one event allowed to move a
    task off its current owner."""
    newly_assigned: dict[str, list[PlannedTask]] = {}
    history = json.dumps({
        "event": source_event,
        "at": datetime.now(timezone.utc).isoformat(),
        "by": actor_id,
    })
    if not planned:
        return newly_assigned
    # One set-based UPDATE for the whole plan: a per-task loop is one
    # round trip each to the remote DB and took minutes for ~500 tasks.
    rows = await db.execute(
        text("""
            UPDATE crm.tasks t
            SET assigned_to_user_id = p.assignee,
                due_date = p.due_date,
                priority = p.priority,
                routing_category = COALESCE(p.category, t.routing_category),
                auto_assigned_at = CASE WHEN p.reassign THEN NOW() ELSE t.auto_assigned_at END,
                source_history = COALESCE(t.source_history, '[]'::jsonb)
                                 || jsonb_build_array(CAST(:history AS jsonb)),
                updated_at = NOW()
            FROM unnest(
                CAST(:task_ids AS uuid[]), CAST(:assignees AS uuid[]), CAST(:due_dates AS date[]),
                CAST(:priorities AS varchar[]), CAST(:categories AS varchar[]), CAST(:reassigns AS boolean[])
            ) AS p(task_id, assignee, due_date, priority, category, reassign)
            WHERE t.id = p.task_id
              AND t.organization_id = :org_id
              AND t.is_deleted = false
              AND t.status NOT IN ('completed', 'cancelled', 'superseded', 'not_applicable')
              AND (
                    NOT CAST(:only_if_unowned AS boolean)
                    OR t.assigned_to_user_id IS NULL
                    OR t.assigned_to_user_id = p.assignee
              )
            RETURNING t.id::text AS id
        """),
        {
            "task_ids": [item.task_id for item in planned],
            "assignees": [item.assignee_id for item in planned],
            "due_dates": [item.due_date for item in planned],
            "priorities": [item.new_priority for item in planned],
            "categories": [item.category_key for item in planned],
            "reassigns": [item.reassign for item in planned],
            "history": history,
            "org_id": org_id,
            "only_if_unowned": source_event != "bulk_assignment",
        },
    )
    written = {row.id for row in rows}
    for item in planned:
        if item.task_id in written and item.reassign and item.assignee_id:
            newly_assigned.setdefault(item.assignee_id, []).append(item)
    return newly_assigned


async def notify_assignments(
    db: AsyncSession,
    org_id: str,
    newly_assigned: dict[str, list[PlannedTask]],
    *,
    actor_id: Optional[str],
) -> None:
    """One in-app notification per person per batch (not per task). The
    Teams DM is separate - see app/services/microsoft/teams_notify.py."""
    for user_id, items in newly_assigned.items():
        if actor_id and user_id == actor_id:
            continue
        urgent = sum(1 for i in items if i.new_priority == "urgent")
        earliest = min((i.due_date for i in items if i.due_date), default=None)
        if len(items) == 1:
            title = "New task assigned to you"
            message = f'"{items[0].title}" was assigned to you'
        else:
            title = f"{len(items)} new tasks assigned to you"
            message = f"{len(items)} tasks were assigned to you"
        if earliest:
            message += f" - first due {earliest.strftime('%a %d %b')}"
        if urgent:
            message += f" ({urgent} urgent)"
        await emit_notification(
            db,
            org_id=org_id,
            user_id=user_id,
            title=title,
            message=message + ".",
            notification_type="task",
            priority="high" if urgent else "normal",
            action_url="/dashboard/crm/tasks",
            metadata={"task_ids": [i.task_id for i in items], "source": "task_distribution"},
        )


def summarize(planned: list[PlannedTask], unroutable: list[dict]) -> dict[str, Any]:
    by_person: dict[str, dict[str, Any]] = {}
    for item in planned:
        key = item.assignee_id or "none"
        entry = by_person.setdefault(key, {
            "user_id": item.assignee_id,
            "full_name": item.assignee_name,
            "count": 0,
            "urgent": 0,
            "high": 0,
            "earliest_due": None,
            "latest_due": None,
        })
        entry["count"] += 1
        if item.new_priority == "urgent":
            entry["urgent"] += 1
        elif item.new_priority == "high":
            entry["high"] += 1
        if item.due_date:
            iso = item.due_date.isoformat()
            entry["earliest_due"] = min(filter(None, [entry["earliest_due"], iso]))
            entry["latest_due"] = max(filter(None, [entry["latest_due"], iso]))
    return {
        "total": len(planned),
        "newly_assigned": sum(1 for p in planned if p.reassign),
        "deadline_only": sum(1 for p in planned if not p.reassign),
        "unroutable": len(unroutable),
        "by_person": sorted(by_person.values(), key=lambda e: -e["count"]),
    }


def coerce_uuid_list(values: Iterable[Any]) -> list[str]:
    return [str(UUID(str(v))) for v in values]


# ---------------------------------------------------------------------------
# Unattended runs (new packs + the worker sweep)
# ---------------------------------------------------------------------------


async def run_auto_distribution(org_id: str, *, entity_id: Optional[str] = None) -> int:
    """Plans, applies, notifies in-app and DMs on Teams, on its own session.
    No-op unless the org switched auto-distribution on. entity_id limits it
    to one record's tasks (a pack that was just generated). Returns the
    number of tasks newly assigned."""
    from core.database import AsyncSessionLocal
    from app.services.microsoft import teams_notify

    async with AsyncSessionLocal() as db:
        if not (await load_settings(db, org_id)).auto_distribute:
            return 0
        plan = await plan_distribution(db, org_id, entity_id=entity_id)
        newly_assigned = await apply_plan(
            db, org_id, plan["planned"], source_event="auto_distribution", actor_id=None,
        )
        await notify_assignments(db, org_id, newly_assigned, actor_id=None)
        if entity_id is None:
            await db.execute(
                text("UPDATE crm.task_routing_settings SET last_auto_run_at = NOW() WHERE organization_id = :org_id"),
                {"org_id": org_id},
            )
        await db.commit()
        deliveries = await teams_notify.prepare_deliveries(
            db, org_id, {uid: teams_notify.tasks_from_plan(items) for uid, items in newly_assigned.items()},
        )
    await teams_notify.deliver(deliveries)
    return sum(len(items) for items in newly_assigned.values())


# Strong references so detached runs aren't garbage-collected mid-flight.
_background_runs: set[asyncio.Task] = set()


def schedule_entity_distribution(*, org_id: str, entity_type: str, entity_id: str) -> None:
    """Fire-and-forget distribution of one record's freshly generated pack,
    so the people get it (and the Teams DM) straight away instead of at the
    next worker sweep. Never raises into the caller; the sweep is the
    safety net if this run fails."""
    async def _run() -> None:
        try:
            await run_auto_distribution(org_id, entity_id=entity_id)
        except Exception:
            logger.exception("task_routing.entity_distribution_failed", org_id=org_id,
                              entity_type=entity_type, entity_id=entity_id)

    try:
        task = asyncio.get_running_loop().create_task(_run())
    except RuntimeError:
        return  # no running loop (sync context) - leave it to the sweep
    _background_runs.add(task)
    task.add_done_callback(_background_runs.discard)
