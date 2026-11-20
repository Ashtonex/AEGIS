"""Executive "Needs you" list: one ranked to-do list built from

* decisions - items waiting in their own module's approval queue
  (GET /executive/approvals/pending),
* exceptions - the source-backed conditions of GET /executive/exceptions,
  grouped per project so five reports on one site read as one item,
* sites - the red/amber flags of GET /executive/sites, one item per site.

Everything is recomputed on read, so an item disappears once its condition
is fixed. core.executive_action_states (migration 306) only records what an
executive did with an item: assigned it, snoozed it or dismissed it. A
snoozed or dismissed item comes back by itself when something new appears
under it (its signature grows) or the snooze date passes.

Pure functions only; the SQL lives in routers/executive.py.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Dict, Iterable, List, Optional

SEVERITY_ORDER = {"critical": 0, "warning": 1, "info": 2}
KIND_ORDER = {"site": 0, "decision": 1, "exception": 2}
DECISION_CRITICAL_DAYS = 7
DECISION_WARNING_DAYS = 3
DEFAULT_SNOOZE_DAYS = 7

# Site flag code -> which key person should own fixing it.
_RECORDING_FLAGS = {"not_clocked_out", "hours_unrecorded", "missing_rates", "unreported_days"}
_TARGET_FLAGS = {"no_targets", "targets_missed"}
_BUDGET_FLAGS = {"over_budget", "budget_at_risk"}

# category -> (plural noun for a grouped title, link builder)
_EXCEPTION_CATEGORIES: Dict[str, Dict[str, Any]] = {
    "HSE incident": {"noun": "high-severity HSE incidents", "url": "/dashboard/compliance/incidents"},
    "Compliance expiry": {"noun": "certificates expiring", "url": "/dashboard/compliance/corporate-credentials"},
    "Project viability": {"noun": "viability warnings", "url": None},
    "Financial forecast": {"noun": "forecast risks", "url": None},
    "Supplier performance": {"noun": "supplier performance issues", "url": "/dashboard/procurement/suppliers"},
    "Equipment utilisation": {"noun": "idle assets on site", "url": "/dashboard/fleet"},
    "Plant request control": {"noun": "plant requests needing control", "url": "/dashboard/fleet/requests"},
    "Plant incident": {"noun": "open plant incidents", "url": "/dashboard/fleet/maintenance"},
    "Site report exception": {"noun": "approved site reports with cost, delay or safety issues", "url": None},
    "Site variance gate": {"noun": "site variances awaiting approval", "url": None},
    "Blocked execution item": {"noun": "blocked material requests", "url": "/dashboard/procurement/requisitions"},
}


def _as_date(value: Any) -> Optional[date]:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str) and len(value) >= 10:
        try:
            return date.fromisoformat(value[:10])
        except ValueError:
            return None
    return None


def _num(value: Any) -> Optional[float]:
    try:
        return float(value) if value is not None and value != "" else None
    except (TypeError, ValueError):
        return None


def _money(value: Optional[float]) -> str:
    return f"${value:,.0f}" if value is not None else ""


def _key_person(people: Dict[str, List[Dict[str, Any]]], order: Iterable[str]) -> Optional[Dict[str, Any]]:
    for role in order:
        for member in people.get(role) or []:
            if member.get("account_active") and member.get("user_id"):
                return {"user_id": str(member["user_id"]), "name": member.get("name"), "role": member.get("role")}
    return None


def _item(**fields: Any) -> Dict[str, Any]:
    base = {
        "key": None, "kind": None, "severity": "warning", "title": "", "detail": None, "points": [],
        "category": None, "project_id": None, "project_name": None, "amount": None,
        "since": None, "due": None, "age_days": None, "signature": [], "suggested_owner": None,
        "action_url": None, "action_label": "Open", "decide": None,
    }
    base.update(fields)
    base["signature"] = sorted({str(value) for value in base["signature"]})
    return base


# ---------------------------------------------------------------- decisions

def decision_items(approvals: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    items = []
    for row in approvals:
        waiting = row.get("waiting_days")
        if waiting is not None and waiting >= DECISION_CRITICAL_DAYS:
            severity = "critical"
        elif waiting is not None and waiting >= DECISION_WARNING_DAYS:
            severity = "warning"
        else:
            severity = "info"
        label = str(row.get("type") or "item").replace("_", " ")
        reference = row.get("reference") or "untitled"
        amount = _num(row.get("amount"))
        title = f"Decide {label} {reference}" + (f" ({_money(amount)})" if amount else "")
        items.append(_item(
            key=f"decision:{row.get('type')}:{row.get('id')}",
            kind="decision",
            severity=severity,
            title=title,
            detail=row.get("reason"),
            points=[str(row["detail"])] if row.get("detail") else [],
            category=row.get("module"),
            amount=amount,
            since=_as_date(row.get("created_at")),
            age_days=waiting,
            signature=[row.get("id")],
            action_url=row.get("action_url"),
            action_label="Decide",
            decide={"type": row.get("type"), "id": str(row.get("id"))}
            if row.get("type") in ("leave_request", "plant_request") else None,
        ))
    return items


# --------------------------------------------------------------- exceptions

def _exception_severity(row: Dict[str, Any], today: date) -> str:
    category = row.get("category")
    severity = str(row.get("severity") or "").lower()
    if category == "HSE incident":
        return "critical"
    if category == "Compliance expiry":
        expiry = _as_date(row.get("expiry_date"))
        return "critical" if expiry is not None and expiry <= today else "warning"
    if category == "Project viability":
        status = str(row.get("viability_status") or "").lower()
        return "critical" if status in ("blocked", "critical") else "warning"
    if severity in SEVERITY_ORDER:
        return severity
    return "warning"


def _exception_amount(row: Dict[str, Any]) -> Optional[float]:
    evidence = row.get("evidence") or {}
    category = row.get("category")
    if category == "Site report exception":
        return _num(evidence.get("cost_exposure"))
    if category == "Site variance gate":
        return _num(evidence.get("cost_impact"))
    if category == "Plant request control":
        return _num(evidence.get("estimated_cost")) or None
    if category == "Financial forecast":
        eac, budget = _num(evidence.get("estimate_at_completion")), _num(evidence.get("approved_budget"))
        if eac is not None and budget is not None and eac > budget:
            return eac - budget
    return None


def _exception_date(row: Dict[str, Any]) -> Optional[date]:
    for field in ("evidence_date", "incident_date", "expiry_date"):
        value = _as_date(row.get(field))
        if value is not None:
            return value
    return None


def exception_items(exceptions: List[Dict[str, Any]], sites_by_project: Dict[str, Dict[str, Any]],
                    today: date) -> List[Dict[str, Any]]:
    groups: Dict[tuple, List[Dict[str, Any]]] = {}
    for row in exceptions:
        project_id = str(row["project_id"]) if row.get("project_id") else None
        anchor = project_id or str(row.get("id"))
        groups.setdefault((row.get("category"), anchor), []).append(row)

    items = []
    for (category, anchor), rows in groups.items():
        meta = _EXCEPTION_CATEGORIES.get(category, {"noun": "issues", "url": None})
        project_id = str(rows[0]["project_id"]) if rows[0].get("project_id") else None
        site = sites_by_project.get(project_id) if project_id else None
        subject = (site or {}).get("name") or rows[0].get("title") or category
        severities = [_exception_severity(row, today) for row in rows]
        severity = min(severities, key=lambda level: SEVERITY_ORDER[level])
        amounts = [amount for amount in (_exception_amount(row) for row in rows) if amount]
        dates = [value for value in (_exception_date(row) for row in rows) if value is not None]
        past = [value for value in dates if value <= today]
        future = [value for value in dates if value > today]
        since = min(past) if past else None
        if len(rows) == 1:
            title = f"{subject}: {rows[0].get('action') or category}"
            points = []
        else:
            title = f"{subject}: {len(rows)} {meta['noun']}"
            points = sorted({str(row.get("action")) for row in rows if row.get("action")})
        if project_id and meta["url"] is None:
            action_url = f"/dashboard/projects/{project_id}"
        else:
            action_url = meta["url"] or "/dashboard"
        owner = _key_person((site or {}).get("people") or {}, ("engineer", "clerk", "foreman")) if site else None
        items.append(_item(
            key=f"exception:{category}:{anchor}",
            kind="exception",
            severity=severity,
            title=title,
            detail=category if len(rows) > 1 else None,
            points=points,
            category=category,
            project_id=project_id,
            project_name=(site or {}).get("name") or (rows[0].get("title") if project_id else None),
            amount=round(sum(amounts), 2) if amounts else None,
            since=since,
            due=min(future) if future else None,
            age_days=(today - since).days if since else None,
            signature=[row.get("id") for row in rows],
            suggested_owner=owner,
            action_url=action_url,
            action_label="Review",
        ))
    return items


# -------------------------------------------------------------------- sites

def _site_owner(site: Dict[str, Any], top_code: str) -> Optional[Dict[str, Any]]:
    people = site.get("people") or {}
    if top_code in _RECORDING_FLAGS:
        order = ("clerk", "engineer", "foreman")
    elif top_code in _TARGET_FLAGS or top_code in _BUDGET_FLAGS:
        order = ("engineer", "clerk", "foreman")
    else:
        # Missing or deactivated key people: that's a decision for the executive.
        return None
    return _key_person(people, order)


def site_items(sites: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    items = []
    for site in sites:
        flags = [flag for flag in site.get("flags") or [] if flag.get("level") in ("critical", "warning")]
        if not flags:
            continue
        top = flags[0]
        week = site.get("week") or {}
        last_worked = _as_date(week.get("last_worked_date"))
        items.append(_item(
            key=f"site:{site['project_id']}",
            kind="site",
            severity=top["level"],
            title=f"{site.get('name')}: {top['message']}",
            detail=(f"{len(flags) - 1} more problem(s) on this site" if len(flags) > 1 else None),
            points=[flag["message"] for flag in flags[1:]],
            category="Site",
            project_id=str(site["project_id"]),
            project_name=site.get("name"),
            amount=None,
            since=last_worked,
            signature=[flag["code"] for flag in flags],
            suggested_owner=_site_owner(site, top["code"]),
            action_url=f"/dashboard/projects/{site['project_id']}",
            action_label="Open site",
        ))
    return items


# ------------------------------------------------------------------- states

def apply_states(items: List[Dict[str, Any]], states: List[Dict[str, Any]], today: date) -> None:
    """Attach the stored executive action to each item and decide whether it
    is hidden (snoozed / dismissed and nothing new since)."""
    by_key = {row["item_key"]: row for row in states}
    for item in items:
        state = by_key.get(item["key"])
        item["state"] = {
            "status": "open", "snoozed_until": None, "assigned_to": None, "assigned_at": None,
            "note": None, "returned": None,
        }
        item["hidden"] = False
        if not state:
            continue
        stored_signature = set(state.get("signature") or [])
        nothing_new = set(item["signature"]) <= stored_signature
        snoozed_until = _as_date(state.get("snoozed_until"))
        assigned = None
        if state.get("assigned_to"):
            assigned = {"user_id": str(state["assigned_to"]), "name": state.get("assigned_name")}
        item["state"].update({
            "assigned_to": assigned,
            "assigned_at": state["assigned_at"].isoformat() if isinstance(state.get("assigned_at"), datetime)
            else state.get("assigned_at"),
            "note": state.get("note"),
        })
        status = state.get("status")
        if status == "dismissed":
            if nothing_new:
                item["state"]["status"] = "dismissed"
                item["hidden"] = True
            else:
                item["state"]["returned"] = "Something new since it was dismissed"
        elif status == "snoozed" and snoozed_until is not None:
            if snoozed_until > today and nothing_new:
                item["state"]["status"] = "snoozed"
                item["state"]["snoozed_until"] = snoozed_until.isoformat()
                item["hidden"] = True
            elif snoozed_until > today:
                item["state"]["returned"] = "Something new while it was snoozed"
            else:
                item["state"]["returned"] = "Snooze ended"


def state_refreshes(items: List[Dict[str, Any]], states: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Keep snoozes and dismissals honest about recurrence. A snoozed or
    dismissed item whose condition has cleared (it is no longer on the list)
    is reset, and part of a signature that has cleared is dropped - so when
    the same problem comes back later it counts as new and reappears.

    Returns {"reset": [item_key, ...], "shrink": {item_key: signature}}."""
    by_key = {item["key"]: item for item in items}
    reset: List[str] = []
    shrink: Dict[str, List[str]] = {}
    for state in states:
        if state.get("status") not in ("snoozed", "dismissed"):
            continue
        item = by_key.get(state["item_key"])
        if item is None:
            reset.append(state["item_key"])
            continue
        stored = set(state.get("signature") or [])
        current = set(item["signature"])
        if stored - current:
            # Keep only what is still present; anything that cleared and
            # returns later is then new.
            shrink[state["item_key"]] = sorted(stored & current)
    return {"reset": sorted(reset), "shrink": shrink}


def rank(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return sorted(items, key=lambda item: (
        item["hidden"],
        SEVERITY_ORDER.get(item["severity"], 3),
        KIND_ORDER.get(item["kind"], 3),
        -(item["amount"] or 0),
        -(item["age_days"] or 0),
        item["title"],
    ))


def summarise(items: List[Dict[str, Any]], user_id: Optional[str]) -> Dict[str, Any]:
    visible = [item for item in items if not item["hidden"]]
    by_kind: Dict[str, int] = {}
    for item in visible:
        by_kind[item["kind"]] = by_kind.get(item["kind"], 0) + 1
    return {
        "open": len(visible),
        "critical": sum(1 for item in visible if item["severity"] == "critical"),
        "unassigned": sum(1 for item in visible if not item["state"]["assigned_to"]),
        "mine": sum(1 for item in visible
                    if user_id and (item["state"]["assigned_to"] or {}).get("user_id") == str(user_id)),
        "snoozed": sum(1 for item in items if item["state"]["status"] == "snoozed"),
        "dismissed": sum(1 for item in items if item["state"]["status"] == "dismissed"),
        "by_kind": by_kind,
    }


def build(approvals: List[Dict[str, Any]], exceptions: List[Dict[str, Any]], sites: List[Dict[str, Any]],
          states: List[Dict[str, Any]], today: date, user_id: Optional[str]) -> Dict[str, Any]:
    sites_by_project = {str(site["project_id"]): site for site in sites}
    items = decision_items(approvals) + exception_items(exceptions, sites_by_project, today) + site_items(sites)
    apply_states(items, states, today)
    refreshes = state_refreshes(items, states)
    items = rank(items)
    for item in items:
        for field in ("since", "due"):
            if isinstance(item[field], date):
                item[field] = item[field].isoformat()
    return {"items": items, "summary": summarise(items, user_id), "state_refreshes": refreshes}


def find_item(items: List[Dict[str, Any]], key: str) -> Optional[Dict[str, Any]]:
    return next((item for item in items if item["key"] == key), None)
