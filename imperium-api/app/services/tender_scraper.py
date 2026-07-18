from __future__ import annotations

import hashlib
import json
import logging
import os
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Iterable, Optional, Sequence
from urllib.parse import urlparse

import httpx
import openai
from bs4 import BeautifulSoup
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from tenacity import retry, stop_after_attempt, wait_exponential

from core.config import settings

try:
    from playwright.async_api import async_playwright
    PLAYWRIGHT_AVAILABLE = True
except ImportError:
    PLAYWRIGHT_AVAILABLE = False

logger = logging.getLogger(__name__)

TENDER_KEYWORDS = (
    "tender",
    "procurement",
    "bid",
    "rfp",
    "rfx",
    "quotation",
    "proposal",
    "notice",
)

SECTOR_KEYWORDS = {
    "mining": "Mining",
    "roads": "Roads",
    "civil": "Civil",
    "construction": "Civil",
    "commercial": "Commercial",
    "water": "Utilities",
    "energy": "Utilities",
    "health": "Commercial",
}

CURRENCY_PATTERN = re.compile(
    r"(?:(?:USD|US\$|ZWL|ZWG|R|K|P)\s*)?(\d[\d,]*(?:\.\d{1,2})?)",
    re.IGNORECASE,
)
REFERENCE_PATTERN = re.compile(
    r"(?:(?:tender|reference|ref|bid|notice)(?:\s*(?:no\.?|number|id))?[:#\-\s]*)"
    r"([A-Z0-9][A-Z0-9./_\-]{2,})",
    re.IGNORECASE,
)
DEADLINE_PATTERN = re.compile(
    r"(?:(?:deadline|closing date|submission date|closing)\s*[:\-\s]*)"
    r"([A-Za-z0-9,\- /:.]+)",
    re.IGNORECASE,
)


class TenderComplianceItem(BaseModel):
    label: str
    status: str
    desc: str


class TenderSignal(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    title: str
    source: str
    sector: str
    budget: float
    scraped_at: str = Field(alias="scrapedAt")
    ref: str
    score: int
    rationale: str
    compliance: list[TenderComplianceItem]
    source_url: Optional[str] = Field(default=None, alias="sourceUrl")


class LLMExtractedTender(BaseModel):
    title: str = Field(..., description="The title of the tender")
    budget: float = Field(0.0, description="The budget or value of the tender (as float, 0 if not found)")
    reference: str = Field("", description="The reference number or ID of the tender")
    deadline: str = Field("", description="The closing date or submission deadline")
    sector: str = Field("Commercial", description="The sector (e.g. Civil, Mining, Commercial, Utilities)")


def _clean_text(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _source_name(source_url: str) -> str:
    parsed = urlparse(source_url)
    if parsed.scheme in {"http", "https"} and parsed.netloc:
        return parsed.netloc.replace("www.", "")
    return source_url.replace("internal:", "").replace("_", " ").title()


def _stable_id(*parts: str) -> str:
    payload = "||".join(parts).encode("utf-8")
    return hashlib.sha1(payload).hexdigest()[:16]


def _extract_reference(text_value: str) -> str:
    for segment in re.split(r"[\n\r•|]+", text_value):
        lowered = segment.casefold()
        label_index = -1
        for label in ("reference", "ref", "tender", "bid", "notice"):
            label_index = lowered.find(label)
            if label_index >= 0:
                break
        if label_index < 0:
            continue
        tail = segment[label_index + len(label):]
        tail = re.sub(r"(?i)^(?:\s*(?:no\.?|number|id))?\s*[:#\-\s]*", "", tail)
        candidate = re.split(r"[\s,;|()]+", tail.strip(), maxsplit=1)[0].strip(" .,:;")
        if not candidate or candidate.casefold() in {"reference", "ref", "tender", "bid", "notice"}:
            continue
        return candidate
    return ""


def _extract_budget(text_value: str) -> float:
    matches = []
    for chunk in CURRENCY_PATTERN.findall(text_value):
        try:
            matches.append(float(chunk.replace(",", "")))
        except ValueError:
            continue
    return max(matches) if matches else 0.0


def _extract_sector(text_value: str) -> str:
    haystack = text_value.casefold()
    for keyword, sector in SECTOR_KEYWORDS.items():
        if keyword in haystack:
            return sector
    return "Commercial"


def _extract_deadline(text_value: str) -> str:
    match = DEADLINE_PATTERN.search(text_value)
    if match:
        return _clean_text(match.group(1))
    return ""


def _score_signal(title: str, text_value: str, budget: float, ref: str, deadline: str) -> int:
    score = 40
    haystack = f"{title} {text_value}".casefold()

    if budget > 0:
        score += 15
    if ref:
        score += 15
    if deadline:
        score += 10
    if any(keyword in haystack for keyword in ("open", "invitation", "published", "notice")):
        score += 10
    if any(keyword in haystack for keyword in ("mining", "roads", "civil", "commercial")):
        score += 5

    return max(0, min(score, 95))


def _compliance_items(*, deadline: str, ref: str, budget: float) -> list[TenderComplianceItem]:
    return [
        TenderComplianceItem(
            label="Reference Trace",
            status="Compliant" if ref else "Review",
            desc="A reference number is present." if ref else "Add a reference code before importing.",
        ),
        TenderComplianceItem(
            label="Submission Window",
            status="Compliant" if deadline else "Review",
            desc="A closing date or deadline was found." if deadline else "Deadline was not detected in the source.",
        ),
        TenderComplianceItem(
            label="Budget Signal",
            status="Compliant" if budget > 0 else "Review",
            desc="A budget or value signal was extracted." if budget > 0 else "No budget signal was detected in the source.",
        ),
    ]


async def _extract_with_llm(text_content: str) -> Optional[LLMExtractedTender]:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return None
    try:
        client = openai.AsyncOpenAI(api_key=api_key)
        response = await client.beta.chat.completions.parse(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are a specialized tender extraction assistant. Extract tender details from the provided text."},
                {"role": "user", "content": text_content[:4000]} # Limit context
            ],
            response_format=LLMExtractedTender,
            temperature=0.1,
            timeout=15.0
        )
        return response.choices[0].message.parsed
    except Exception as e:
        logger.warning(f"LLM extraction failed: {e}")
        return None


def _build_signal_from_text(title: str, text_value: str, source: str, source_url: str) -> TenderSignal:
    title = _clean_text(title) or "Untitled tender"
    ref = _extract_reference(text_value) or _stable_id(title, source, source_url or "")
    budget = _extract_budget(text_value)
    deadline = _extract_deadline(text_value)
    sector = _extract_sector(text_value)
    score = _score_signal(title, text_value, budget, ref, deadline)
    rationale = (
        f"Scraped from {source} with {('a closing date' if deadline else 'no closing date')}, "
        f"{('a reference' if ref else 'no reference')}, and "
        f"{('a budget signal' if budget > 0 else 'no budget signal')}."
    )

    return TenderSignal(
        id=_stable_id(title, source, ref, source_url or ""),
        title=title,
        source=source,
        sector=sector,
        budget=budget,
        scrapedAt=_now_iso(),
        ref=ref,
        score=score,
        rationale=rationale,
        compliance=_compliance_items(deadline=deadline, ref=ref, budget=budget),
        sourceUrl=source_url,
    )


async def _process_candidate_block(text_value: str, source: str, source_url: str) -> Optional[TenderSignal]:
    if not text_value:
        return None
    
    use_llm = os.getenv("TENDER_SCRAPER_USE_LLM", "true").lower() == "true"
    if use_llm and os.getenv("OPENAI_API_KEY"):
        llm_extracted = await _extract_with_llm(text_value)
        if llm_extracted:
            score = _score_signal(llm_extracted.title, text_value, llm_extracted.budget, llm_extracted.reference, llm_extracted.deadline)
            rationale = "Structured via AI extraction."
            return TenderSignal(
                id=_stable_id(llm_extracted.title, source, llm_extracted.reference, source_url),
                title=llm_extracted.title,
                source=source,
                sector=llm_extracted.sector,
                budget=llm_extracted.budget,
                scrapedAt=_now_iso(),
                ref=llm_extracted.reference or _stable_id(llm_extracted.title, source, source_url),
                score=score,
                rationale=rationale,
                compliance=_compliance_items(deadline=llm_extracted.deadline, ref=llm_extracted.reference, budget=llm_extracted.budget),
                sourceUrl=source_url,
            )
            
    # Fallback to regex/heuristics
    lines = [line.strip() for line in text_value.splitlines() if line.strip()]
    title = lines[0] if lines else "Untitled tender"
    return _build_signal_from_text(title, text_value, source, source_url)


async def _extract_from_html(html: str, source: str, source_url: str) -> list[TenderSignal]:
    soup = BeautifulSoup(html, "html.parser")
    candidates = []
    
    # Simple heuristic: find elements that likely contain tender cards
    for tag in soup.find_all(['article', 'section', 'div', 'li']):
        # Ignore small tags or massive container tags
        classes = tag.get("class", [])
        tag_text = tag.get_text(separator="\n", strip=True)
        if len(tag_text) > 50 and len(tag_text) < 3000:
            haystack = (tag_text + " " + " ".join(classes)).casefold()
            if any(kw in haystack for kw in TENDER_KEYWORDS):
                candidates.append(tag_text)

    # De-duplicate nested candidates (very rough approach: check if substring)
    unique_texts = []
    candidates.sort(key=len) # Sort by length ascending
    for cand in candidates:
        is_subset = False
        for ut in unique_texts:
            if cand in ut:
                is_subset = True
                break
        if not is_subset:
            unique_texts.append(cand)

    signals: list[TenderSignal] = []
    for text_val in unique_texts:
        signal = await _process_candidate_block(text_val, source, source_url)
        if signal:
            signals.append(signal)

    unique: dict[str, TenderSignal] = {}
    for signal in signals:
        unique[signal.id] = signal
    return list(unique.values())


def _extract_from_json_payload(payload: Any, source: str, source_url: str) -> list[TenderSignal]:
    # Similar structure to before but simplified
    items: list[Any]
    if isinstance(payload, list):
        items = payload
    elif isinstance(payload, dict):
        for key in ("items", "results", "data", "tenders", "signals"):
            if isinstance(payload.get(key), list):
                items = payload[key]
                break
        else:
            items = [payload]
    else:
        return []

    signals: list[TenderSignal] = []
    for item in items:
        if not isinstance(item, dict):
            continue

        title = _clean_text(str(item.get("title") or item.get("name") or item.get("tender_name") or ""))
        if not title:
            continue

        description = _clean_text(" ".join(str(item.get(key) or "") for key in ("description", "summary", "details")))
        sector = _clean_text(str(item.get("sector") or item.get("category") or ""))
        if not sector:
            sector = _extract_sector(f"{title} {description}")

        budget_raw = item.get("budget") or item.get("amount") or item.get("value")
        budget = 0.0
        if budget_raw:
            try:
                budget = float(str(budget_raw).replace(",", ""))
            except ValueError:
                budget = _extract_budget(f"{budget_raw} {description}")

        ref = _clean_text(str(item.get("ref") or item.get("reference") or item.get("tender_ref") or ""))
        deadline = _clean_text(str(item.get("deadline") or item.get("submission_deadline") or item.get("closing_date") or ""))
        score = int(item.get("score") or _score_signal(title, description, budget, ref, deadline))
        
        signals.append(
            TenderSignal(
                id=_stable_id(title, source, ref, source_url),
                title=title,
                source=source,
                sector=sector or "Commercial",
                budget=budget,
                scrapedAt=_now_iso(),
                ref=ref or _stable_id(title, source, source_url),
                score=max(0, min(score, 100)),
                rationale="Parsed structured JSON tender payload.",
                compliance=_compliance_items(deadline=deadline, ref=ref, budget=budget),
                sourceUrl=source_url,
            )
        )
    return signals


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
async def _fetch_html_playwright(source_url: str, proxy: Optional[str] = None) -> str:
    if not PLAYWRIGHT_AVAILABLE:
        raise RuntimeError("Playwright is not available")
    
    proxy_settings = {"server": proxy} if proxy else None
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, proxy=proxy_settings)
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        )
        page = await context.new_page()
        try:
            await page.goto(source_url, wait_until="networkidle", timeout=20000)
            return await page.content()
        finally:
            await browser.close()


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
async def _fetch_remote_source(source_url: str) -> list[TenderSignal]:
    proxy = os.getenv("TENDER_SCRAPER_PROXY")
    use_playwright = os.getenv("TENDER_SCRAPER_USE_PLAYWRIGHT", "false").lower() == "true"
    
    source = _source_name(source_url)

    if use_playwright and PLAYWRIGHT_AVAILABLE:
        try:
            body = await _fetch_html_playwright(source_url, proxy)
            if body.strip():
                return await _extract_from_html(body, source, source_url)
        except Exception as e:
            logger.warning(f"Playwright fetch failed for {source_url}: {e}, falling back to httpx")
            # Fallback to httpx below if playwright fails

    # HTTPX fallback
    proxies = {"all://": proxy} if proxy else None
    async with httpx.AsyncClient(
        timeout=settings.EXTERNAL_API_TIMEOUT_SECONDS,
        headers={"User-Agent": "AEGIS Tender Scraper/2.0"},
        follow_redirects=True,
        proxies=proxies
    ) as client:
        response = await client.get(source_url)
        response.raise_for_status()

    content_type = response.headers.get("content-type", "").lower()
    body = response.text

    if "json" in content_type or source_url.lower().endswith(".json"):
        try:
            payload = response.json()
        except json.JSONDecodeError:
            return []
        return _extract_from_json_payload(payload, source, source_url)

    if not body.strip():
        return []
    return await _extract_from_html(body, source, source_url)


async def _fetch_internal_public_tenders(
    db: AsyncSession,
    *,
    org_id: Any,
    limit: int,
) -> list[TenderSignal]:
    result = await db.execute(
        text(
            """
            SELECT id, tender_name, stage, bid_amount, submission_deadline, created_at
            FROM crm.tenders
            WHERE is_deleted = false
              AND organization_id = :org_id
              AND lower(trim(COALESCE(stage, ''))) IN ('open', 'published', 'tender identified', 'submitted', 'adjudication')
            ORDER BY created_at DESC
            LIMIT :limit
            """
        ),
        {"limit": limit, "org_id": org_id},
    )
    rows = [dict(row._mapping) for row in result]
    source = "AEGIS Public Tender Feed"
    signals: list[TenderSignal] = []
    for row in rows:
        title = str(row.get("tender_name") or "Untitled tender")
        deadline = row.get("submission_deadline")
        deadline_text = deadline.isoformat() if hasattr(deadline, "isoformat") else ""
        budget = float(row.get("bid_amount") or 0)
        ref = str(row.get("id"))
        text_value = " ".join(filter(None, [title, str(row.get("stage") or ""), deadline_text]))
        score = 55
        if budget > 0:
            score += 10
        if deadline_text:
            score += 10
        signals.append(
            TenderSignal(
                id=_stable_id(title, source, ref),
                title=title,
                source=source,
                sector=_extract_sector(text_value),
                budget=budget,
                scrapedAt=_now_iso(),
                ref=ref,
                score=min(score, 95),
                rationale="Published from the CRM tender register and surfaced through the public feed.",
                compliance=_compliance_items(
                    deadline=deadline_text, ref=ref, budget=budget
                ),
                sourceUrl="/api/v1/public/intake/tenders",
            )
        )

    return signals


async def collect_tender_signals(
    db: AsyncSession,
    org_id: Any,
    sources: Sequence[str],
    *,
    include_internal_public_feed: bool = True,
    limit: int = 12,
) -> list[TenderSignal]:
    collected: list[TenderSignal] = []
    if include_internal_public_feed:
        collected.extend(
            await _fetch_internal_public_tenders(db, org_id=org_id, limit=limit)
        )

    for source_url in sources:
        if len(collected) >= limit:
            break
        source_url = source_url.strip()
        if not source_url:
            continue
        try:
            collected.extend(await _fetch_remote_source(source_url))
        except Exception as e:
            logger.error(f"Failed to fetch remote source {source_url} after retries: {e}")
            continue

    unique: dict[str, TenderSignal] = {}
    for signal in collected:
        unique[signal.id] = signal
        if len(unique) >= limit:
            break

    return list(unique.values())[:limit]


def configured_tender_sources() -> list[str]:
    raw_sources = settings.TENDER_SCRAPER_SOURCES
    return [source.strip() for source in raw_sources.split(",") if source.strip()]
