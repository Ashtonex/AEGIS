"""AEGIS's memory of past BOQs.

Every BOQ green-lit for production is snapshotted line by line into
finance.boq_knowledge_lines (migration 244). When a new BOQ is being priced,
find_similar_lines() looks each line up against that history so the
estimator sees what the same kind of work cost on earlier projects - rates,
units, which project, when - instead of AEGIS only knowing the hard-coded
RATE_BENCHMARKS seed.

Matching is deliberately plain and explainable (no pg_trgm on this
database): descriptions are normalised to lowercase word tokens, candidate
rows are pre-filtered in SQL by their strongest keywords, then ranked by
token overlap (Jaccard), with a bonus when the unit matches. Nothing is
ever auto-applied - matches are suggestions a person picks from.
"""

import json
import re
from statistics import median
from typing import Any, Dict, Iterable, List, Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

# Filler words that appear in nearly every BOQ line and say nothing about
# what the work is.
_STOPWORDS = frozenset(
    """
    a an and as at be by for from in into of on or per the to with without incl including
    all any each other etc item items rate supply supplying fix fixing provide providing
    complete including allow approved as described similar ditto do ref note
    """.split()
)
_TOKEN_RE = re.compile(r"[a-z0-9]+(?:\.[0-9]+)?")
MIN_SCORE = 0.3
_CANDIDATE_LIMIT = 400


def normalize_description(description: str) -> str:
    return " ".join(tokenize(description))


def tokenize(description: str) -> List[str]:
    tokens = _TOKEN_RE.findall((description or "").lower())
    return [t for t in tokens if t not in _STOPWORDS and (len(t) > 1 or t.isdigit())]


def _normalize_unit(unit: Optional[str]) -> str:
    u = (unit or "").strip().lower().replace("²", "2").replace("³", "3").replace(" ", "")
    aliases = {"sqm": "m2", "m^2": "m2", "cum": "m3", "m^3": "m3", "no.": "no", "nr": "no", "each": "no", "ea": "no", "lm": "m", "item": "item", "sum": "item", "ls": "item"}
    return aliases.get(u, u)


def _score(query_tokens: set[str], candidate_tokens: set[str], same_unit: bool) -> float:
    if not query_tokens or not candidate_tokens:
        return 0.0
    overlap = len(query_tokens & candidate_tokens)
    if not overlap:
        return 0.0
    jaccard = overlap / len(query_tokens | candidate_tokens)
    return min(1.0, jaccard + (0.15 if same_unit else 0.0))


def _num(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


async def snapshot_approved_boq(
    db: AsyncSession,
    *,
    org_id: str,
    quotation_id: str,
    approved_by: Optional[str],
    metadata: Dict[str, Any],
    source_type: Optional[str],
    source_id: Optional[str],
    client_name: Optional[str],
) -> int:
    """Replaces this quotation's lines in the knowledge base with its current
    items. Returns the number of lines stored. Lines with no description are
    skipped - they can't be matched later anyway."""
    await db.execute(
        text("DELETE FROM finance.boq_knowledge_lines WHERE organization_id = :org_id AND quotation_id = :qid"),
        {"org_id": org_id, "qid": quotation_id},
    )
    items = metadata.get("items") or []
    currency = metadata.get("currency") or "USD"
    project_title = metadata.get("project_title") or client_name
    stored = 0
    for item in items:
        if not isinstance(item, dict):
            continue
        description = str(item.get("description") or "").strip()
        normalized = normalize_description(description)
        if not normalized:
            continue
        qty = _num(item.get("quantity", item.get("qty")))
        rate = _num(item.get("rate"))
        await db.execute(
            text("""
                INSERT INTO finance.boq_knowledge_lines (
                    organization_id, quotation_id, source_type, source_id, project_title, client_name,
                    section, item_no, description, normalized_description, unit, quantity, rate, amount,
                    currency, approved_by
                ) VALUES (
                    :org_id, :qid, :source_type, CAST(:source_id AS uuid), :project_title, :client_name,
                    :section, :item_no, :description, :normalized, :unit, :quantity, :rate, :amount,
                    :currency, CAST(:approved_by AS uuid)
                )
            """),
            {
                "org_id": org_id,
                "qid": quotation_id,
                "source_type": source_type,
                "source_id": source_id,
                "project_title": project_title,
                "client_name": client_name,
                "section": str(item.get("section") or "")[:500] or None,
                "item_no": str(item.get("item_no") or "")[:60] or None,
                "description": description,
                "normalized": normalized,
                "unit": str(item.get("unit") or "")[:40] or None,
                "quantity": qty,
                "rate": rate,
                "amount": round(qty * rate, 2),
                "currency": str(currency)[:10],
                "approved_by": approved_by,
            },
        )
        stored += 1
    return stored


async def find_similar_lines(
    db: AsyncSession,
    *,
    org_id: str,
    queries: Iterable[Dict[str, Any]],
    exclude_quotation_id: Optional[str] = None,
    per_item: int = 5,
) -> List[Dict[str, Any]]:
    """For each {description, unit} query, the closest approved lines from
    past BOQs plus a rate summary (median/min/max over matches in the same
    unit). Output order matches input order."""
    results: List[Dict[str, Any]] = []
    for query in queries:
        description = str(query.get("description") or "")
        unit = _normalize_unit(query.get("unit"))
        q_tokens = set(tokenize(description))
        entry: Dict[str, Any] = {"description": description, "unit": query.get("unit"), "matches": [], "rate_summary": None}
        if not q_tokens:
            results.append(entry)
            continue
        # Strongest keywords first: longer tokens are rarer and more specific.
        keywords = sorted(q_tokens, key=len, reverse=True)[:4]
        rows = (
            await db.execute(
                text("""
                    SELECT k.id, k.quotation_id, k.project_title, k.client_name, k.section, k.item_no,
                           k.description, k.normalized_description, k.unit, k.quantity, k.rate,
                           k.currency, k.approved_at
                    FROM finance.boq_knowledge_lines k
                    WHERE k.organization_id = :org_id
                      AND k.is_deleted = false
                      AND (CAST(:exclude AS uuid) IS NULL OR k.quotation_id <> CAST(:exclude AS uuid))
                      AND k.normalized_description ILIKE ANY(:patterns)
                    ORDER BY k.approved_at DESC
                    LIMIT :limit
                """),
                {
                    "org_id": org_id,
                    "exclude": exclude_quotation_id,
                    "patterns": [f"%{kw}%" for kw in keywords],
                    "limit": _CANDIDATE_LIMIT,
                },
            )
        ).mappings().all()
        scored = []
        for row in rows:
            same_unit = bool(unit) and _normalize_unit(row["unit"]) == unit
            score = _score(q_tokens, set(row["normalized_description"].split()), same_unit)
            if score >= MIN_SCORE:
                scored.append((score, same_unit, row))
        scored.sort(key=lambda s: (s[0], s[2]["approved_at"]), reverse=True)
        top = scored[:per_item]
        entry["matches"] = [
            {
                "id": str(row["id"]),
                "quotation_id": str(row["quotation_id"]),
                "project_title": row["project_title"],
                "client_name": row["client_name"],
                "section": row["section"],
                "item_no": row["item_no"],
                "description": row["description"],
                "unit": row["unit"],
                "quantity": _num(row["quantity"]),
                "rate": _num(row["rate"]),
                "currency": row["currency"],
                "approved_at": row["approved_at"].isoformat() if row["approved_at"] else None,
                "score": round(score, 2),
                "same_unit": same_unit,
            }
            for score, same_unit, row in top
        ]
        unit_rates = [_num(r["rate"]) for _, same, r in scored if same and _num(r["rate"]) > 0]
        if unit_rates:
            entry["rate_summary"] = {
                "unit": query.get("unit"),
                "samples": len(unit_rates),
                "median": round(median(unit_rates), 2),
                "min": round(min(unit_rates), 2),
                "max": round(max(unit_rates), 2),
            }
        results.append(entry)
    return results


def parse_metadata(raw: Any) -> Dict[str, Any]:
    if isinstance(raw, str):
        try:
            return json.loads(raw) or {}
        except ValueError:
            return {}
    return dict(raw or {})
