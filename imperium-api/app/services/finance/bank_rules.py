"""Bank statement auto-tagging rules.

A rule: "if the bank description (or reference) contains <text> - spaces and
case ignored - optionally only for money in / out, an amount range and a
date range, then set category / project / who / note".

Guarantees:
- A rule only fills fields that are still EMPTY on a line. It never
  overwrites a tag someone set by hand (or an earlier rule's).
- Rules run in priority order (lowest first); the first rule to fill a
  field wins.
- Nothing changes without a preview being available first (plan() is pure).
- Applying goes through reconciliation.tag_lines + bank_books.sync - the same
  path as tagging by hand - so claims, costs, petty cash and the ledger
  follow. bank_statement_lines.tag_rule_id records which rule tagged a line.

suggest() learns rules from what has already been tagged: for each group of
lines tagged the same way it looks for a phrase that is in (nearly) all of
them and (nearly) nowhere else.
"""

from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Any, Optional
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.finance import bank_books
from app.services.finance import bank_reconciliation as reconciliation
from app.services.finance.general_ledger import GeneralLedgerError

KNOWN_CATEGORIES = {
    "client_receipt", "capital_injection", "internal_transfer", "cash_withdrawal", "supplier_payment",
    "subcontractor", "equipment_hire", "fuel_transport", "salaries_wages", "tax_statutory", "bank_charges",
    "card_purchase", "owner_drawings", "tithe_donation", "refund", "reversal", "other",
}
RULE_FIELDS = {"set_category": "category", "set_project_id": "project_id",
               "set_counterparty": "counterparty_name", "set_note": "notes"}
_NON_ALNUM = re.compile(r"[^A-Z0-9]+")
_WHITESPACE = re.compile(r"\s+")


def normalise(value: Optional[str]) -> str:
    return _WHITESPACE.sub("", (value or "")).upper()


@dataclass
class Rule:
    row: dict

    @property
    def id(self) -> Optional[str]:
        return str(self.row["id"]) if self.row.get("id") else None

    def matches(self, line: dict) -> bool:
        needle = normalise(self.row["match_text"])
        if not needle or needle not in line["_haystack"]:
            return False
        amount = Decimal(str(line["amount"]))
        direction = self.row.get("direction") or "any"
        if direction == "in" and amount <= 0 or direction == "out" and amount >= 0:
            return False
        size = abs(amount)
        if self.row.get("amount_min") is not None and size < Decimal(str(self.row["amount_min"])):
            return False
        if self.row.get("amount_max") is not None and size > Decimal(str(self.row["amount_max"])):
            return False
        on: date = line["transaction_date"]
        if self.row.get("date_from") and on < _as_date(self.row["date_from"]):
            return False
        if self.row.get("date_to") and on > _as_date(self.row["date_to"]):
            return False
        return True

    def sets(self) -> dict[str, Any]:
        out = {}
        for rule_field, line_field in RULE_FIELDS.items():
            value = self.row.get(rule_field)
            if value not in (None, ""):
                out[line_field] = str(value) if rule_field == "set_project_id" else value
        return out


def _as_date(value: Any) -> date:
    return value if isinstance(value, date) else date.fromisoformat(str(value)[:10])


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------

async def list_rules(db: AsyncSession, *, org_id: str) -> list[dict]:
    rows = await db.execute(
        text("""
            SELECT r.*, p.name AS project_name,
                   (SELECT count(*) FROM finance.bank_statement_lines l WHERE l.tag_rule_id = r.id) AS lines_tagged
            FROM finance.bank_tag_rules r LEFT JOIN projects.projects p ON p.id = r.set_project_id
            WHERE r.organization_id = :org_id
            ORDER BY r.priority, r.created_at
        """),
        {"org_id": org_id},
    )
    return [dict(r) for r in rows.mappings()]


async def _validate(db: AsyncSession, org_id: str, values: dict) -> None:
    if values.get("set_category") and values["set_category"] not in KNOWN_CATEGORIES:
        raise GeneralLedgerError(f"Unknown category '{values['set_category']}'.", status_code=422)
    if values.get("set_project_id"):
        ok = (await db.execute(
            text("SELECT 1 FROM projects.projects WHERE id = :id AND organization_id = :org_id AND is_deleted = false"),
            {"id": values["set_project_id"], "org_id": org_id},
        )).first()
        if not ok:
            raise GeneralLedgerError("Project not found.", status_code=404)
    if not any(values.get(f) not in (None, "") for f in RULE_FIELDS):
        raise GeneralLedgerError("A rule has to set at least one of category, project, who or note.", status_code=422)
    if len(normalise(values.get("match_text"))) < 3:
        raise GeneralLedgerError("The text to look for needs at least 3 characters.", status_code=422)


RULE_COLUMNS = ("name", "match_text", "direction", "amount_min", "amount_max", "date_from", "date_to",
                "set_category", "set_project_id", "set_counterparty", "set_note", "priority", "is_active")


async def create_rule(db: AsyncSession, *, org_id: str, user_id: str, values: dict) -> dict:
    await _validate(db, org_id, values)
    cols = [c for c in RULE_COLUMNS if c in values]
    row = (await db.execute(
        text(f"""
            INSERT INTO finance.bank_tag_rules (organization_id, created_by, {', '.join(cols)})
            VALUES (:org_id, :user_id, {', '.join(':' + c for c in cols)}) RETURNING id
        """),
        {"org_id": org_id, "user_id": user_id, **{c: values[c] for c in cols}},
    )).scalar()
    return {"id": str(row)}


async def update_rule(db: AsyncSession, *, org_id: str, rule_id: UUID, values: dict) -> dict:
    current = (await db.execute(
        text("SELECT * FROM finance.bank_tag_rules WHERE id = :id AND organization_id = :org_id"),
        {"id": rule_id, "org_id": org_id},
    )).mappings().first()
    if not current:
        raise GeneralLedgerError("Rule not found.", status_code=404)
    merged = {**dict(current), **values}
    await _validate(db, org_id, merged)
    cols = [c for c in RULE_COLUMNS if c in values]
    if cols:
        await db.execute(
            text(f"""
                UPDATE finance.bank_tag_rules SET {', '.join(f'{c} = :{c}' for c in cols)}, updated_at = NOW()
                WHERE id = :id AND organization_id = :org_id
            """),
            {"id": rule_id, "org_id": org_id, **{c: values[c] for c in cols}},
        )
    return {"id": str(rule_id)}


async def delete_rule(db: AsyncSession, *, org_id: str, rule_id: UUID) -> None:
    """Deleting a rule never un-tags what it already tagged (the tags stay;
    tag_rule_id just goes NULL)."""
    result = await db.execute(
        text("DELETE FROM finance.bank_tag_rules WHERE id = :id AND organization_id = :org_id RETURNING id"),
        {"id": rule_id, "org_id": org_id},
    )
    if not result.first():
        raise GeneralLedgerError("Rule not found.", status_code=404)


# ---------------------------------------------------------------------------
# Plan (preview) and apply
# ---------------------------------------------------------------------------

async def _load_lines(db: AsyncSession, org_id: str, line_ids: Optional[list[UUID]] = None) -> list[dict]:
    where = "l.organization_id = :org_id"
    params: dict[str, Any] = {"org_id": org_id}
    if line_ids is not None:
        where += " AND l.id = ANY(:ids)"
        params["ids"] = list(line_ids)
    rows = await db.execute(
        text(f"""
            SELECT l.id, l.transaction_date, l.amount, l.reference, l.category, l.project_id,
                   l.counterparty_name, l.notes,
                   regexp_replace(COALESCE(l.description, ''), '\\s+', ' ', 'g') AS description
            FROM finance.bank_statement_lines l WHERE {where}
            ORDER BY l.transaction_date, l.line_number
        """),
        params,
    )
    lines = []
    for r in rows.mappings():
        line = dict(r)
        line["_haystack"] = normalise(f"{line['description']} {line['reference'] or ''}")
        lines.append(line)
    return lines


async def _active_rules(db: AsyncSession, org_id: str, rule_ids: Optional[list[UUID]] = None) -> list[Rule]:
    where = "organization_id = :org_id AND is_active"
    params: dict[str, Any] = {"org_id": org_id}
    if rule_ids:
        where = "organization_id = :org_id AND id = ANY(:ids)"
        params["ids"] = list(rule_ids)
    rows = await db.execute(text(f"SELECT * FROM finance.bank_tag_rules WHERE {where} ORDER BY priority, created_at"), params)
    return [Rule(dict(r)) for r in rows.mappings()]


def plan(rules: list[Rule], lines: list[dict]) -> dict[str, dict]:
    """{line_id: {"updates": {field: value}, "rule_id": first rule that
    changed it}} - only for lines where some rule fills an EMPTY field."""
    out: dict[str, dict] = {}
    for line in lines:
        filled: dict[str, Any] = {}
        first_rule = None
        for rule in rules:
            if not rule.matches(line):
                continue
            for field, value in rule.sets().items():
                if line.get(field) in (None, "") and field not in filled:
                    filled[field] = value
                    first_rule = first_rule or rule.id
        if filled:
            out[str(line["id"])] = {"updates": filled, "rule_id": first_rule}
    return out


async def preview(db: AsyncSession, *, org_id: str, rule: Optional[dict] = None, rule_ids: Optional[list[UUID]] = None,
                  sample: int = 15) -> dict:
    """What applying would change. rule= previews an unsaved rule definition."""
    rules = [Rule(rule)] if rule is not None else await _active_rules(db, org_id, rule_ids)
    lines = await _load_lines(db, org_id)
    changes = plan(rules, lines)
    matched = sum(1 for line in lines if any(r.matches(line) for r in rules))
    by_id = {str(l["id"]): l for l in lines}
    money_in = sum((Decimal(str(by_id[i]["amount"])) for i in changes if by_id[i]["amount"] > 0), Decimal("0"))
    money_out = sum((-Decimal(str(by_id[i]["amount"])) for i in changes if by_id[i]["amount"] < 0), Decimal("0"))
    return {
        "lines_matched": matched,
        "lines_to_tag": len(changes),
        "already_tagged": matched - len(changes),
        "money_in": money_in,
        "money_out": money_out,
        "sample": [
            {"line_id": i, "transaction_date": by_id[i]["transaction_date"], "amount": by_id[i]["amount"],
             "description": by_id[i]["description"][:160], "sets": c["updates"]}
            for i, c in list(changes.items())[:sample]
        ],
    }


async def apply(db: AsyncSession, *, org_id: str, user_id: Optional[str], rule_ids: Optional[list[UUID]] = None,
                line_ids: Optional[list[UUID]] = None) -> dict:
    """Tag every line the rules can fill (only empty fields). Returns counts.
    Caller commits."""
    rules = await _active_rules(db, org_id, rule_ids)
    if not rules:
        return {"lines_tagged": 0, "books": None}
    changes = plan(rules, await _load_lines(db, org_id, line_ids))
    if not changes:
        return {"lines_tagged": 0, "books": None}
    groups: dict[str, list[UUID]] = defaultdict(list)
    for line_id, change in changes.items():
        groups[json.dumps(change["updates"], sort_keys=True)].append(UUID(line_id))
    for updates_json, ids in groups.items():
        await reconciliation.tag_lines(db, org_id=org_id, user_id=user_id, updates=json.loads(updates_json), line_ids=ids)
    await db.execute(
        text("""
            UPDATE finance.bank_statement_lines l SET tag_rule_id = x.rule_id
            FROM jsonb_to_recordset(CAST(:links AS jsonb)) AS x(line_id uuid, rule_id uuid)
            WHERE l.id = x.line_id
        """),
        {"links": json.dumps([{"line_id": i, "rule_id": c["rule_id"]} for i, c in changes.items()])},
    )
    per_rule = Counter(c["rule_id"] for c in changes.values())
    await db.execute(
        text("""
            UPDATE finance.bank_tag_rules r SET times_applied = times_applied + x.n, last_applied_at = NOW()
            FROM jsonb_to_recordset(CAST(:counts AS jsonb)) AS x(rule_id uuid, n int)
            WHERE r.id = x.rule_id
        """),
        {"counts": json.dumps([{"rule_id": k, "n": v} for k, v in per_rule.items()])},
    )
    books = await bank_books.sync(db, org_id=org_id, user_id=user_id, line_ids=[UUID(i) for i in changes])
    return {"lines_tagged": len(changes), "books": books}


# ---------------------------------------------------------------------------
# Suggestions learned from existing tags
# ---------------------------------------------------------------------------

def _phrases(description: str, max_words: int = 4) -> set[str]:
    words = [w for w in _NON_ALNUM.split(description.upper()) if len(w) >= 3 and not w.isdigit()]
    out = set()
    for n in range(1, max_words + 1):
        for i in range(len(words) - n + 1):
            phrase = " ".join(words[i:i + n])
            if len(phrase.replace(" ", "")) >= 5:
                out.add(phrase)
    return out


async def suggest(db: AsyncSession, *, org_id: str, limit: int = 20) -> list[dict]:
    lines = await _load_lines(db, org_id)
    existing = {normalise(r["match_text"]) for r in await list_rules(db, org_id=org_id)}
    names = {str(r.id): r.name for r in await db.execute(
        text("SELECT id, name FROM projects.projects WHERE organization_id = :o AND is_deleted = false"), {"o": org_id})}
    haystacks = [(l, l["_haystack"]) for l in lines]
    suggestions: list[dict] = []
    seen_phrases: set[tuple] = set()

    def best_phrase(group: list[dict], same_tag) -> Optional[tuple[str, int]]:
        counts: Counter = Counter()
        for line in group:
            counts.update(_phrases(line["description"]))
        best = None
        for phrase, n in counts.items():
            if n < max(3, 0.9 * len(group)):
                continue
            needle = normalise(phrase)
            if needle in existing:
                continue
            hits = [l for l, hay in haystacks if needle in hay and (l["amount"] > 0) == (group[0]["amount"] > 0)]
            tagged_hits = [l for l in hits if l["category"] or l["project_id"] or l["counterparty_name"]]
            agreeing = [l for l in tagged_hits if same_tag(l)]
            if not tagged_hits or len(agreeing) / len(tagged_hits) < 0.9:
                continue
            untagged = sum(1 for l in hits if not (l["category"] or l["project_id"] or l["counterparty_name"]))
            score = (len(needle), untagged)
            if best is None or score > best[0]:
                best = (score, phrase, untagged)
        return (best[1], best[2]) if best else None

    def key_full(l):
        return (l["counterparty_name"], l["category"], str(l["project_id"]) if l["project_id"] else None, l["amount"] > 0)

    groups: dict[tuple, list[dict]] = defaultdict(list)
    for line in lines:
        if line["counterparty_name"] or line["project_id"]:
            groups[key_full(line)].append(line)

    for (who, category, project, money_in), group in sorted(groups.items(), key=lambda kv: -len(kv[1])):
        if len(group) < 3:
            continue
        found = best_phrase(group, lambda l, k=(who, category, project, money_in): key_full(l) == k)
        rule_project = project
        date_from = date_to = None
        if not found and project:
            # The same payer spread over several projects (e.g. by phase) -
            # suggest a date-ranged rule for this project's slice.
            found = best_phrase(group, lambda l, k=(who, category, money_in): (l["counterparty_name"], l["category"], l["amount"] > 0) == k)
            if found:
                date_from = min(l["transaction_date"] for l in group)
                date_to = max(l["transaction_date"] for l in group)
        if not found:
            continue
        phrase, untagged = found
        marker = (normalise(phrase), rule_project, date_from, date_to)
        if marker in seen_phrases:
            continue
        seen_phrases.add(marker)
        label = who or names.get(project or "", "")
        suggestions.append({
            "name": f"{phrase.title()} → {label}" + (f" ({date_from:%b %Y} - {date_to:%b %Y})" if date_from else ""),
            "match_text": phrase,
            "direction": "in" if money_in else "out",
            "set_counterparty": who,
            "set_category": category,
            "set_project_id": rule_project,
            "project_name": names.get(rule_project or ""),
            "date_from": date_from,
            "date_to": date_to,
            "supported_by": len(group),
            "would_tag_now": untagged,
        })
        if len(suggestions) >= limit:
            break
    # Standard BancABC patterns (the ones the statement was bulk-tagged with).
    # Fee rules run first (priority 10) so "Cash Withdrawal Charge" is a fee
    # before the withdrawal rules (priority 20) can claim it.
    for match_text, category, who, priority, direction in STARTER_RULES:
        needle = normalise(match_text)
        if needle in existing:
            continue
        hits = [l for l, hay in haystacks if needle in hay and (l["amount"] < 0 if direction == "out" else True)]
        if not hits:
            continue
        suggestions.append({
            "name": f"{match_text} → {_CATEGORY_NAMES.get(category, category)}",
            "match_text": match_text, "direction": direction, "set_counterparty": who, "set_category": category,
            "set_project_id": None, "project_name": None, "date_from": None, "date_to": None, "priority": priority,
            "supported_by": sum(1 for l in hits if l["category"] == category),
            "would_tag_now": sum(1 for l in hits if not l["category"]),
            "standard": True,
        })
    suggestions.sort(key=lambda s: (-s["would_tag_now"], -s["supported_by"]))
    return suggestions


_CATEGORY_NAMES = {"bank_charges": "Bank charges & IMTT", "tax_statutory": "Tax & statutory",
                   "cash_withdrawal": "Cash withdrawal"}
# (text, category, who, priority, direction)
STARTER_RULES = [
    ("Intermediated Money Transfer Tax", "bank_charges", "BancABC", 10, "out"),
    ("Intermediary Money Transfer", "bank_charges", "BancABC", 10, "out"),
    ("Outgoing Transfer Fee", "bank_charges", "BancABC", 10, "out"),
    ("Cash Withdrawal Charge", "bank_charges", "BancABC", 10, "out"),
    ("Withdrawal Fees", "bank_charges", "BancABC", 10, "out"),
    ("POS PURCHASE FEE", "bank_charges", "BancABC", 10, "out"),
    ("POS Transaction Tax", "bank_charges", "BancABC", 10, "out"),
    ("LEDGER FEE", "bank_charges", "BancABC", 10, "out"),
    ("Transaction Charges", "bank_charges", "BancABC", 10, "out"),
    ("Commission", "bank_charges", "BancABC", 10, "out"),
    ("Zimra", "tax_statutory", "ZIMRA", 15, "out"),
    ("FCA Cash Withdrawal", "cash_withdrawal", None, 20, "out"),
    ("ATM-Cash Withdrawal", "cash_withdrawal", None, 20, "out"),
]
