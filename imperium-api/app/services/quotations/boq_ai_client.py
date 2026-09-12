"""Perplexity provider client for AI-assisted BOQ analysis.

Perplexity's chat-completions API is OpenAI-SDK-compatible, so this reuses
the `openai` package (already a dependency — see
app/services/finance/ai_assistant.py) pointed at
base_url="https://api.perplexity.ai" rather than adding a new SDK. Mirrors
ai_assistant.py's CircuitBreaker + tenacity scaffolding exactly, so the two
AI integrations in this codebase behave identically under failure.

Structured-output validation is NOT delegated to the OpenAI SDK's
`.beta.chat.completions.parse()` helper — that helper's parsing guarantees
are tuned to OpenAI's own backend and are not confirmed against a
third-party base_url. Instead this always independently validates the
returned JSON against the Pydantic schema below, retries once with a
repair instruction on failure, and fails closed (returns None) on a second
failure — callers keep whatever deterministic findings they already have.

Every finding this returns is a proposal, never a fact: the caller
(boq_ai_analysis.py) tags every one of these with value_class='ai_proposal'
and a reviewer_decision starting at 'pending'. Nothing here writes to a
database or approves anything.
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any, Dict, List, Literal, Optional, Tuple

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from core.config import settings
from core.resilience import CircuitBreaker

logger = logging.getLogger(__name__)

_boq_analysis_breaker = CircuitBreaker(
    "perplexity_boq_analysis", failure_threshold=5, reset_timeout_seconds=60.0
)


class AiBoqFinding(BaseModel):
    model_config = ConfigDict(extra="forbid")

    finding_type: Literal[
        "missing_scope_item",
        "unsupported_lump_sum",
        "scope_contradiction",
        "market_rate_context",
    ]
    related_item_description: Optional[str] = None
    reason: str
    evidence_text: Optional[str] = None
    citations: List[str] = Field(default_factory=list)
    confidence: float = Field(ge=0.0, le=1.0)


class AiBoqAnalysisResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    findings: List[AiBoqFinding] = Field(default_factory=list)
    summary: Optional[str] = None


_SYSTEM_PROMPT = (
    "You are a construction quantity-surveying research assistant supporting AEGIS, "
    "a system of record that performs all commercial calculations itself. Your job is "
    "ONLY to research and flag issues in a Bill of Quantities (BOQ) — you never calculate "
    "totals, taxes, or approve any commercial position. Given a BOQ (description/section/"
    "unit/quantity/rate per line — no internal cost breakdown, no client identity) and an "
    "optional scope-of-works description, identify: (1) scope items described in the scope "
    "text but missing from the BOQ, (2) lump-sum items with no supporting description or "
    "breakdown, (3) contradictions between the scope text and the BOQ, (4) external market-"
    "rate context worth flagging for review. For each finding, cite your evidence (quote the "
    "scope text passage, or cite an external source) and state a confidence between 0 and 1. "
    "Never invent quantities, prices, suppliers, or facts not present in the input or in a "
    "citable source — if you are unsure, omit the finding rather than guess. Return ONLY JSON "
    "matching the provided schema."
)


def _build_user_payload(items: List[Dict[str, Any]], project_scope_text: Optional[str]) -> str:
    # Deliberately whitelisted: description/section/unit/quantity/rate only.
    # Never send material_rate/labour_rate/equipment_rate/subcontractor_rate/
    # transport_rate/waste_allowance_rate (internal cost build-up = private
    # margin) or any client-identifying field.
    return json.dumps(
        {"boq_items": items, "project_scope_text": project_scope_text or ""},
        default=str,
    )


def whitelist_items_for_external_research(items: List[Any]) -> List[Dict[str, Any]]:
    """Strips a BOQItem list down to the fields safe to send to an external
    research provider. Call this, never pass raw BOQItem/quotation dicts,
    when building a Perplexity request."""
    result = []
    for item in items:
        raw = item.model_dump(mode="json") if hasattr(item, "model_dump") else dict(item)
        result.append({
            "item_no": raw.get("item_no") or "",
            "section": raw.get("section") or "",
            "description": raw.get("description") or "",
            "unit": raw.get("unit") or "",
            "quantity": raw.get("quantity"),
            "rate": raw.get("rate"),
        })
    return result


def _validate(raw_content: Optional[str]) -> Tuple[Optional[AiBoqAnalysisResponse], Optional[str]]:
    if not raw_content:
        return None, "empty_response"
    try:
        return AiBoqAnalysisResponse.model_validate_json(raw_content), None
    except (ValidationError, json.JSONDecodeError) as exc:
        return None, str(exc)


async def run_boq_analysis(
    items: List[Dict[str, Any]],
    project_scope_text: Optional[str],
) -> Tuple[Optional[AiBoqAnalysisResponse], Dict[str, Any], Optional[str]]:
    """Returns (parsed_response_or_None, usage_meta, error_message_or_None).

    Fails closed (parsed_response is None) when PERPLEXITY_API_KEY is unset,
    on a transport error after retries, or when the model's JSON still fails
    schema validation after one repair attempt. The caller must treat a
    None result as "AI findings unavailable this run", not as a hard error —
    deterministic findings still stand on their own.
    """
    api_key = settings.PERPLEXITY_API_KEY
    usage_meta: Dict[str, Any] = {"model": settings.QUOTATION_AI_ANALYSIS_MODEL}
    if not api_key:
        return None, usage_meta, "not_configured"

    import openai  # deferred import, mirrors ai_assistant.py's cold-path avoidance
    from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

    schema_json = AiBoqAnalysisResponse.model_json_schema()
    messages: List[Dict[str, str]] = [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {"role": "user", "content": _build_user_payload(items, project_scope_text)},
    ]

    @retry(
        retry=retry_if_exception_type(
            (openai.RateLimitError, openai.APITimeoutError, openai.APIConnectionError)
        ),
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=1, max=8),
        reraise=True,
    )
    async def _call(msgs: List[Dict[str, str]]):
        client = openai.AsyncOpenAI(api_key=api_key, base_url="https://api.perplexity.ai")
        return await client.chat.completions.create(
            model=settings.QUOTATION_AI_ANALYSIS_MODEL,
            messages=msgs,
            temperature=0.1,
            timeout=60.0,
            response_format={
                "type": "json_schema",
                "json_schema": {"name": "boq_findings", "schema": schema_json, "strict": True},
            },
        )

    started = time.monotonic()
    try:
        response = await _boq_analysis_breaker.call_async(lambda: _call(messages))
    except Exception as exc:
        logger.warning("Perplexity BOQ analysis call failed: %s", exc)
        return None, usage_meta, str(exc)

    usage_meta["latency_ms"] = int((time.monotonic() - started) * 1000)
    usage = getattr(response, "usage", None)
    if usage is not None:
        usage_meta["token_usage"] = {
            "prompt_tokens": getattr(usage, "prompt_tokens", None),
            "completion_tokens": getattr(usage, "completion_tokens", None),
            "total_tokens": getattr(usage, "total_tokens", None),
        }

    raw_content = response.choices[0].message.content if response.choices else None
    parsed, error = _validate(raw_content)
    if parsed is not None:
        return parsed, usage_meta, None

    # One repair retry: tell the model exactly what was wrong with its own output.
    repair_messages = messages + [
        {"role": "assistant", "content": raw_content or ""},
        {
            "role": "user",
            "content": (
                f"Your previous response did not match the required schema: {error}. "
                "Return ONLY valid JSON matching the schema, nothing else."
            ),
        },
    ]
    try:
        response = await _boq_analysis_breaker.call_async(lambda: _call(repair_messages))
    except Exception as exc:
        logger.warning("Perplexity BOQ analysis repair retry failed: %s", exc)
        return None, usage_meta, str(exc)

    raw_content = response.choices[0].message.content if response.choices else None
    parsed, error = _validate(raw_content)
    if parsed is None:
        logger.warning("Perplexity BOQ analysis response failed schema validation twice: %s", error)
        return None, usage_meta, error or "invalid_response_schema"
    return parsed, usage_meta, None
