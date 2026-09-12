"""AI-assisted analysis of an already-uploaded/imported BOQ ("Path B" in the
Quotations & Estimations spec: analyse an existing BOQ rather than draft a
new one from scratch).

Two layers of findings, always kept separate:

1. Deterministic checks (this module, no I/O) — duplicate line items,
   blank/zero rates, unit inconsistencies, and a partial-coverage rate-
   outlier check that reuses
   app.services.quotations.intelligence_engine.RateIntelligenceEngine.
   These always run, tagged value_class='system_calculated_value'.

2. AI findings (app.services.quotations.boq_ai_client) — missing scope
   items, unsupported lump sums, scope contradictions, market-rate context.
   These only run when PERPLEXITY_API_KEY is configured, are always tagged
   value_class='ai_proposal', and are skipped (not fabricated) on any
   failure — see boq_ai_client.run_boq_analysis's fail-closed contract.

Nothing in this module talks to a database. Callers (routers/quotations.py)
own persistence, idempotency-hash caching, and event emission, matching the
existing CommercialGuard.audit_request / RateIntelligenceEngine.evaluate_rate
pattern in intelligence_engine.py of keeping the analysis engine pure.
"""

from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from app.services.quotations.boq_ai_client import (
    run_boq_analysis,
    whitelist_items_for_external_research,
)
from app.services.quotations.calculator import BOQItem
from app.services.quotations.intelligence_engine import RateIntelligenceEngine

logger = logging.getLogger(__name__)

PROMPT_VERSION = "v1"

# Below this normalized-overlap length, a description match against a rate
# benchmark is too weak to trust — skip the item rather than risk a false
# rate-outlier finding built on a coincidental short-word match.
_MIN_ITEM_CODE_MATCH_OVERLAP = 6


@dataclass
class AnalysisResult:
    status: str  # 'completed' | 'deterministic_only' | 'degraded'
    findings: List[Dict[str, Any]] = field(default_factory=list)
    provider: str = "perplexity"
    model: Optional[str] = None
    latency_ms: Optional[int] = None
    token_usage: Optional[Dict[str, Any]] = None
    error: Optional[str] = None


def _normalize_description(desc: str) -> str:
    return " ".join((desc or "").strip().lower().split())


def _canonical_item_key(item: BOQItem) -> tuple:
    return (
        (item.section or "").strip().lower(),
        _normalize_description(item.description),
        (item.unit or "").strip().lower(),
    )


def compute_input_hash(items: List[BOQItem], project_scope_text: Optional[str]) -> str:
    """Stable hash of the BOQ content + scope text, used to avoid re-spending
    on an unchanged BOQ (callers check this against prior runs before
    invoking analyze_boq again unless force_refresh is set)."""
    canonical = {
        "items": sorted(
            (
                {
                    "section": it.section,
                    "item_no": it.item_no,
                    "description": it.description,
                    "quantity": str(it.quantity),
                    "unit": it.unit,
                    "rate": str(it.rate),
                }
                for it in items
            ),
            key=lambda d: (d["section"], d["item_no"], d["description"]),
        ),
        "project_scope_text": project_scope_text or "",
    }
    payload = json.dumps(canonical, sort_keys=True, default=str)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _item_ref(item: BOQItem) -> Dict[str, Any]:
    return {
        "item_no": item.item_no,
        "description": item.description,
        "section": item.section,
        "sheet": item.source_sheet,
        "row": item.source_row,
    }


def _finding(
    finding_type: str,
    reason: str,
    *,
    item_ref: Optional[Dict[str, Any]] = None,
    original_value: Optional[str] = None,
    proposed_value: Optional[str] = None,
    variance: Optional[str] = None,
    unit: Optional[str] = None,
    evidence_text: Optional[str] = None,
    citations: Optional[List[Any]] = None,
    confidence: float = 1.0,
    value_class: str = "system_calculated_value",
) -> Dict[str, Any]:
    return {
        "finding_type": finding_type,
        "item_ref": item_ref,
        "original_value": original_value,
        "proposed_value": proposed_value,
        "variance": variance,
        "unit": unit,
        "reason": reason,
        "evidence_text": evidence_text,
        "citations": citations or [],
        "confidence": confidence,
        "value_class": value_class,
    }


def detect_duplicate_items(items: List[BOQItem]) -> List[Dict[str, Any]]:
    """Flags line items sharing section+description+unit, appearing more than once."""
    groups: Dict[tuple, List[BOQItem]] = {}
    for item in items:
        if not _normalize_description(item.description):
            continue
        groups.setdefault(_canonical_item_key(item), []).append(item)

    findings = []
    for group in groups.values():
        if len(group) < 2:
            continue
        findings.append(_finding(
            "duplicate_line_item",
            f"'{group[0].description}' appears {len(group)} times in section "
            f"'{group[0].section}' with the same unit — likely a duplicate entry "
            "rather than distinct scope.",
            item_ref={"occurrences": [_item_ref(it) for it in group]},
            original_value=str(len(group)),
        ))
    return findings


def detect_blank_or_zero_rates(items: List[BOQItem]) -> List[Dict[str, Any]]:
    """Flags items with a non-zero quantity but a zero rate — almost always
    an unpriced item, not a genuine nil-cost one."""
    findings = []
    for item in items:
        if item.rate == 0 and item.quantity != 0:
            findings.append(_finding(
                "blank_or_zero_rate",
                f"Item has a quantity of {item.quantity} {item.unit} but a rate of 0 — "
                "likely unpriced rather than a genuine nil-cost item.",
                item_ref=_item_ref(item),
                original_value="0",
                unit=item.unit,
            ))
    return findings


def detect_unit_inconsistencies(items: List[BOQItem]) -> List[Dict[str, Any]]:
    """Flags the same normalized description appearing with different units
    across the BOQ (possible data-entry error or genuinely different scope
    hiding under one description)."""
    by_desc: Dict[str, Dict[str, List[BOQItem]]] = {}
    for item in items:
        desc_key = _normalize_description(item.description)
        if not desc_key:
            continue
        unit_key = (item.unit or "").strip().lower()
        by_desc.setdefault(desc_key, {}).setdefault(unit_key, []).append(item)

    findings = []
    for unit_groups in by_desc.values():
        if len(unit_groups) < 2:
            continue
        all_items = [it for group in unit_groups.values() for it in group]
        units_seen = sorted(unit_groups.keys())
        findings.append(_finding(
            "unit_mismatch",
            f"'{all_items[0].description}' appears with inconsistent units across the "
            f"BOQ ({', '.join(units_seen)}) — verify these are genuinely different "
            "measures, not a data-entry error.",
            item_ref={"occurrences": [_item_ref(it) for it in all_items]},
            proposed_value=", ".join(units_seen),
        ))
    return findings


def _resolve_item_code(item: BOQItem, rate_benchmarks: Dict[str, Dict[str, Any]]) -> Optional[str]:
    """BOQItem carries no item_code (only free-text description) —
    RateIntelligenceEngine.evaluate_rate() keys on item_code, so this
    resolves one via a normalized-substring match against known
    finance.rate_intelligence descriptions. Returns None (never a forced or
    fabricated match) when nothing corresponds closely enough; callers must
    skip the rate-outlier check for that item rather than guess. This is a
    partial-coverage check, not full reuse of the rate benchmark engine."""
    desc_key = _normalize_description(item.description)
    if not desc_key:
        return None
    best_code: Optional[str] = None
    best_score = 0
    for code, bm in rate_benchmarks.items():
        bm_desc = _normalize_description(bm.get("description") or "")
        if not bm_desc:
            continue
        if bm_desc == desc_key:
            return code
        if bm_desc in desc_key or desc_key in bm_desc:
            score = min(len(bm_desc), len(desc_key))
            if score > best_score:
                best_score = score
                best_code = code
    if best_code and best_score >= _MIN_ITEM_CODE_MATCH_OVERLAP:
        return best_code
    return None


def detect_rate_outliers(
    items: List[BOQItem], rate_benchmarks: Dict[str, Dict[str, Any]]
) -> List[Dict[str, Any]]:
    """Reuses RateIntelligenceEngine.evaluate_rate() for items whose
    description can be resolved to a known item_code. Items with no
    resolvable benchmark are silently skipped, not guessed at — partial
    coverage by design."""
    findings = []
    for item in items:
        if item.rate <= 0:
            continue
        item_code = _resolve_item_code(item, rate_benchmarks)
        if not item_code:
            continue
        evaluation = RateIntelligenceEngine.evaluate_rate(
            item_code, float(item.rate), benchmarks=rate_benchmarks
        )
        if evaluation.get("status") in ("OUTLIER_HIGH", "BELOW_MARKET"):
            findings.append(_finding(
                "rate_outlier",
                evaluation.get(
                    "recommendation",
                    "Rate falls outside acceptable tolerance vs. the resolved benchmark.",
                ),
                item_ref=_item_ref(item),
                original_value=str(item.rate),
                proposed_value=str(evaluation.get("target_rate")),
                variance=f"{evaluation.get('variance_vs_target_pct')}%",
                unit=item.unit,
                confidence=0.8,
            ))
    return findings


def run_deterministic_checks(
    items: List[BOQItem], rate_benchmarks: Dict[str, Dict[str, Any]]
) -> List[Dict[str, Any]]:
    findings: List[Dict[str, Any]] = []
    findings.extend(detect_duplicate_items(items))
    findings.extend(detect_blank_or_zero_rates(items))
    findings.extend(detect_unit_inconsistencies(items))
    findings.extend(detect_rate_outliers(items, rate_benchmarks))
    return findings


def _ai_findings_to_records(response) -> List[Dict[str, Any]]:
    records = []
    for f in response.findings:
        records.append(_finding(
            f.finding_type,
            f.reason,
            item_ref={"description": f.related_item_description} if f.related_item_description else None,
            evidence_text=f.evidence_text,
            citations=list(f.citations),
            confidence=f.confidence,
            value_class="ai_proposal",
        ))
    return records


async def analyze_boq(
    items: List[BOQItem],
    rate_benchmarks: Dict[str, Dict[str, Any]],
    project_scope_text: Optional[str] = None,
    perplexity_configured: bool = False,
) -> AnalysisResult:
    """Runs deterministic checks always, then AI findings if configured.
    Never raises on AI failure — degrades to deterministic-only findings
    with status='degraded' and `error` populated instead."""
    deterministic_findings = run_deterministic_checks(items, rate_benchmarks)

    if not perplexity_configured:
        return AnalysisResult(status="deterministic_only", findings=deterministic_findings)

    whitelisted_items = whitelist_items_for_external_research(items)
    ai_response, usage_meta, error = await run_boq_analysis(whitelisted_items, project_scope_text)

    if ai_response is None:
        return AnalysisResult(
            status="degraded",
            findings=deterministic_findings,
            model=usage_meta.get("model"),
            latency_ms=usage_meta.get("latency_ms"),
            token_usage=usage_meta.get("token_usage"),
            error=error,
        )

    all_findings = deterministic_findings + _ai_findings_to_records(ai_response)
    return AnalysisResult(
        status="completed",
        findings=all_findings,
        model=usage_meta.get("model"),
        latency_ms=usage_meta.get("latency_ms"),
        token_usage=usage_meta.get("token_usage"),
    )
