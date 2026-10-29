"""Parse e-GP Bulletin Board and tender detail pages.

Pure functions: HTML in, structured data out. Every extracted field carries
its provenance (page URL, section, the exact excerpt it came from, when).
Nothing is inferred: a label that is absent, hidden (display:none) or
commented out in the portal's markup produces no value - the field stays
null and is listed as an unresolved question for the reviewer.

Notice text is untrusted third-party content. It is stored and displayed as
text only; nothing here interprets it as an instruction.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import asdict, dataclass, field
from datetime import date, datetime, timezone
from typing import Any, Optional
from urllib.parse import parse_qs, urlsplit
from zoneinfo import ZoneInfo

from bs4 import BeautifulSoup, Comment, NavigableString, Tag

HARARE = ZoneInfo("Africa/Harare")
SOURCE_TIMEZONE = "Africa/Harare"
_DATETIME_FORMATS = ("%d-%b-%Y %I:%M %p", "%d-%b-%Y %H:%M")
_DATE_FORMATS = ("%d-%b-%Y",)
_SUMMARY_RE = re.compile(
    r"Page\s+(\d+)\s+of\s+(\d+),\s*showing\s+(\d+)\s+record\(s\)\s+out\s+of\s+(\d+)\s+total", re.I
)
_PAGE_CLOCK_RE = re.compile(r"var\s+dt\s*=\s*'(\d{4}/\d{2}/\d{2} \d{2}:\d{2}:\d{2})'")
# The signed-out application shell the portal serves for login-only pages
# (documents, activity schedule), and its login form.
_LOGIN_SHELL_MARKERS = (
    "your session has been expired, please login",
    "/pendingtasks/pendingtaskgrid",
    "name=\"data[user][password]\"",
    "id=\"userloginform\"",
)
_CAPTCHA_MARKERS = ("g-recaptcha", "hcaptcha", "cf-challenge", "captcha-container")
_MAX_EXCERPT = 600

# Volatile values that change without the notice changing.
VOLATILE_FIELDS = {"number_of_downloads"}


def clean(value: Optional[str]) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class ParsedDate:
    raw: str
    at: Optional[datetime]  # timezone-aware, Africa/Harare, only when a time is stated
    day: Optional[date]
    time_specified: bool


def parse_portal_datetime(raw: Optional[str]) -> Optional[ParsedDate]:
    text_value = clean(raw)
    if not text_value:
        return None
    for fmt in _DATETIME_FORMATS:
        try:
            naive = datetime.strptime(text_value, fmt)
        except ValueError:
            continue
        aware = naive.replace(tzinfo=HARARE)
        return ParsedDate(raw=text_value, at=aware, day=aware.date(), time_specified=True)
    for fmt in _DATE_FORMATS:
        try:
            day = datetime.strptime(text_value, fmt).date()
        except ValueError:
            continue
        # A date without a time: never assume one.
        return ParsedDate(raw=text_value, at=None, day=day, time_specified=False)
    return ParsedDate(raw=text_value, at=None, day=None, time_specified=False)


def detect_login_shell(html: str) -> bool:
    lowered = clean(html).lower()
    return any(marker in lowered for marker in _LOGIN_SHELL_MARKERS)


def detect_captcha(html: str) -> bool:
    lowered = html.lower()
    return any(marker in lowered for marker in _CAPTCHA_MARKERS)


def page_clock(html: str) -> Optional[str]:
    match = _PAGE_CLOCK_RE.search(html)
    return match.group(1) if match else None


def evidence(value: Any, *, raw: Optional[str], url: str, section: str, excerpt: Optional[str], confidence: str = "high") -> dict:
    return {
        "value": value,
        "raw": raw,
        "source_url": url,
        "section": section,
        "excerpt": (excerpt or "")[:_MAX_EXCERPT] or None,
        "extracted_at": now_iso(),
        "confidence": confidence,
        "method": "html_label",
    }


# ----------------------------------------------------------------------------
# Bulletin Board
# ----------------------------------------------------------------------------

@dataclass
class BulletinRow:
    notice_id: str
    notice_url: str
    reference: Optional[str]
    title: Optional[str]
    category_codes: list[str]
    category_names_raw: Optional[str]
    procuring_entity: Optional[str]
    status: Optional[str]
    published_raw: Optional[str]
    closing_raw: Optional[str]
    row_excerpt: str

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class BulletinPage:
    url: str
    rows: list[BulletinRow] = field(default_factory=list)
    page: Optional[int] = None
    pages_total: Optional[int] = None
    records_total: Optional[int] = None
    has_next: bool = False
    table_found: bool = False
    is_login_shell: bool = False
    has_captcha: bool = False
    row_errors: list[str] = field(default_factory=list)
    page_clock: Optional[str] = None


def parse_bulletin_page(html: str, url: str) -> BulletinPage:
    result = BulletinPage(url=url, page_clock=page_clock(html))
    result.has_captcha = detect_captcha(html)
    soup = BeautifulSoup(html, "html.parser")
    table = _find_tender_table(soup)
    if table is None:
        result.is_login_shell = detect_login_shell(html)
        return result
    result.table_found = True

    for tr in table.find_all("tr"):
        cells = tr.find_all("td", recursive=False)
        if not cells:
            continue
        if len(cells) < 9:
            result.row_errors.append(f"Row with {len(cells)} cells (expected 9): {clean(tr.get_text(' '))[:160]}")
            continue
        link = cells[0].find("a", href=True)
        notice_id = clean(cells[0].get_text())
        href = link["href"] if link else ""
        if not notice_id.isdigit():
            result.row_errors.append(f"Row without a numeric Tender Id: {clean(tr.get_text(' '))[:160]}")
            continue
        # Column order is fixed by the header (Tender Id, Tender Reference
        # Number, Tender Title, Category Code, Category Name, Procuring
        # Entity, Scope, Publish Date, Closing Date). The portal's per-cell
        # data-label attributes are off by one and are ignored.
        codes = [c.strip() for c in clean(cells[3].get_text()).split(",") if c.strip()]
        result.rows.append(
            BulletinRow(
                notice_id=notice_id,
                notice_url=href if href.startswith("https://") else f"https://egp.praz.org.zw/Indexes/viewLiveTenderDetails/{notice_id}",
                reference=clean(cells[1].get_text()) or None,
                title=clean(cells[2].get_text()) or None,
                category_codes=codes,
                category_names_raw=clean(cells[4].get_text()) or None,
                procuring_entity=clean(cells[5].get_text()) or None,
                status=clean(cells[6].get_text()) or None,
                published_raw=clean(cells[7].get_text()) or None,
                closing_raw=clean(cells[8].get_text()) or None,
                row_excerpt=clean(tr.get_text(" | "))[:_MAX_EXCERPT],
            )
        )

    summary = _SUMMARY_RE.search(soup.get_text(" "))
    if summary:
        result.page, result.pages_total = int(summary.group(1)), int(summary.group(2))
        result.records_total = int(summary.group(4))
    result.has_next = soup.find("a", rel="next") is not None or bool(soup.select("li.next a[href]"))
    return result


def _find_tender_table(soup: BeautifulSoup) -> Optional[Tag]:
    for table in soup.find_all("table"):
        headers = [clean(th.get_text()).lower() for th in table.find_all("th")]
        if "tender id" in headers and "closing date" in headers:
            return table
    return None


# ----------------------------------------------------------------------------
# Tender detail
# ----------------------------------------------------------------------------

# Portal label (lower-cased, colon stripped) -> field key.
DETAIL_LABELS = {
    "tender id": "notice_id",
    "status": "notice_status",
    "bid validity period (in days)": "bid_validity_days",
    "tender reference number": "official_reference",
    "lot type": "lot_type",
    "procurement method": "procurement_method",
    "class of procurement": "procurement_class",
    "applicable procurement rules": "procurement_rules",
    "funding source": "funding_source",
    "delivery/project location": "project_location",
    "required supplier categories": "required_categories",
    "delivery period": "delivery_period",
    "procuring entity": "procuring_entity",
    "date created": "date_created",
    "published date": "published_at",
    "closing date": "closing_at",
    "date last updated": "last_updated_at",
    "bid form fee": "bid_form_fee",
    "tender addendums": "addenda_count",
    "number of downloads": "number_of_downloads",
    "documents": "documents",
    "schedule of activity": "schedule_of_activity",
    "shortlisted suppliers": "shortlisted_suppliers",
    # Shown only on notices that set them (hidden labels are skipped).
    "bid security amount(domestic)": "bid_security_amount",
    "bid security amount (domestic)": "bid_security_amount",
    "establishment amount(domestic)": "bid_bond_establishment_fee",
    "establishment amount (domestic)": "bid_bond_establishment_fee",
    "spoc fee": "spoc_fee",
}
DATE_FIELDS = {"published_at", "closing_at", "last_updated_at", "date_created"}
LINK_FIELDS = {"documents", "schedule_of_activity", "shortlisted_suppliers"}

# Fields the public page does not publish. They stay null and become
# questions unless an official document supplies them.
NOT_ON_PUBLIC_PAGE = {
    "site_visit": "Site visit / pre-bid meeting: read from the e-GP activity schedule when documents are collected - the bidding documents can add a compulsory site visit the schedule does not show.",
    "clarification_deadline": "Clarification deadline: read from the e-GP activity schedule when documents are collected.",
    "bid_security": "Bid security form and validity: only in the bidding documents (the notice shows an amount at most).",
    "required_bid_documents": "Required bid documents: only in the bidding documents.",
    "estimated_value": "Estimated value / budget: not published on the notice.",
    "official_contact": "Official contact details: not published on the public notice.",
}


@dataclass
class DetailResult:
    url: str
    fields: dict[str, dict] = field(default_factory=dict)
    line_items: list[dict] = field(default_factory=list)
    attachments: list[dict] = field(default_factory=list)
    unresolved: list[str] = field(default_factory=list)
    is_login_shell: bool = False
    has_captcha: bool = False
    structure_found: bool = False
    source_text: str = ""
    page_clock: Optional[str] = None

    def value(self, key: str) -> Any:
        item = self.fields.get(key)
        return item.get("value") if item else None


def parse_detail_page(html: str, url: str) -> DetailResult:
    result = DetailResult(url=url, page_clock=page_clock(html), has_captcha=detect_captcha(html))
    soup = BeautifulSoup(html, "html.parser")
    block = soup.find(id="block_content")
    if block is None:
        result.is_login_shell = detect_login_shell(html)
        return result
    result.structure_found = True
    result.source_text = clean(block.get_text(" "))[:20000]

    for label in block.find_all("label"):
        if _is_hidden(label):
            continue
        label_text = clean(label.get_text())
        name, _, inline_value = label_text.partition(":")
        key = DETAIL_LABELS.get(clean(name).lower())
        if not key:
            continue
        section = clean(name)
        if key in LINK_FIELDS:
            link = _following_link(label)
            if link is not None:
                result.fields[key] = evidence(
                    {"label": clean(link.get_text()) or section, "path": link.get("href_path") or link.get("href")},
                    raw=clean(link.get_text()), url=url, section=section, excerpt=f"{section}: {clean(link.get_text())}",
                )
            continue
        raw_value = clean(inline_value) or _following_text(label)
        if not raw_value:
            continue
        result.fields[key] = _typed_field(key, raw_value, url=url, section=section)

    title_node = block.select_one("center.verdhana_fourteenpx")
    if title_node and clean(title_node.get_text()):
        title = clean(title_node.get_text())
        result.fields["title"] = evidence(title, raw=title, url=url, section="Notice heading", excerpt=title)
    for cell in block.find_all("td"):
        bold = cell.find("b")
        heading = clean(bold.get_text()).rstrip(":").lower() if bold else ""
        if heading == "project name":
            value = clean(cell.get_text(" ")).split(":", 1)[-1].strip()
            if value:
                result.fields["project_name"] = evidence(value, raw=value, url=url, section="Project Name", excerpt=value)
        elif heading == "description":
            value = clean(cell.get_text(" ")).split(":", 1)[-1].strip()
            if value:
                result.fields["description"] = evidence(value, raw=value, url=url, section="Description", excerpt=value)

    address_lines = [clean(c.get_text(" ")) for c in block.select("center.verdhana_twelvepx") if clean(c.get_text())]
    if address_lines:
        joined = ", ".join(address_lines)
        result.fields["entity_address"] = evidence(joined, raw=joined, url=url, section="Procuring entity address", excerpt=joined, confidence="medium")

    result.line_items = _line_items(block)
    docs = result.fields.get("documents")
    if docs:
        result.attachments.append({
            "label": "Bidding documents (e-GP 'Documents: Preview')",
            "official_url": _absolute(docs["value"].get("path")),
            "access": "login_required",
        })
    for key, question in NOT_ON_PUBLIC_PAGE.items():
        result.unresolved.append(question)
    closing = result.fields.get("closing_at")
    if closing is None:
        result.unresolved.append("Closing date not found on the notice page.")
    elif not closing["value"].get("time_specified"):
        result.unresolved.append("Closing time is not stated - do not assume one; confirm from the bidding documents.")
    return result


def _typed_field(key: str, raw_value: str, *, url: str, section: str) -> dict:
    excerpt = f"{section}: {raw_value}"
    if key in DATE_FIELDS:
        parsed = parse_portal_datetime(raw_value)
        value = {
            "at": parsed.at.isoformat() if parsed and parsed.at else None,
            "date": parsed.day.isoformat() if parsed and parsed.day else None,
            "time_specified": bool(parsed and parsed.time_specified),
            "timezone": SOURCE_TIMEZONE if parsed and parsed.at else None,
        }
        confidence = "high" if parsed and parsed.at else ("medium" if parsed and parsed.day else "low")
        return evidence(value, raw=raw_value, url=url, section=section, excerpt=excerpt, confidence=confidence)
    if key in {"bid_validity_days", "addenda_count", "number_of_downloads"}:
        digits = re.match(r"^\d+$", raw_value)
        return evidence(int(raw_value) if digits else None, raw=raw_value, url=url, section=section, excerpt=excerpt,
                        confidence="high" if digits else "low")
    if key == "required_categories":
        return evidence(raw_value, raw=raw_value, url=url, section=section, excerpt=excerpt)
    return evidence(raw_value, raw=raw_value, url=url, section=section, excerpt=excerpt)


def _is_hidden(node: Tag) -> bool:
    for parent in [node, *node.parents]:
        if isinstance(parent, Tag):
            style = (parent.get("style") or "").replace(" ", "").lower()
            if "display:none" in style:
                return True
    return False


def _following_text(label: Tag) -> str:
    parts: list[str] = []
    for sibling in label.next_siblings:
        if isinstance(sibling, Comment):
            continue
        if isinstance(sibling, Tag):
            if sibling.name == "label" or sibling.find("label") is not None:
                break
            parts.append(sibling.get_text(" "))
        elif isinstance(sibling, NavigableString):
            parts.append(str(sibling))
    return clean(" ".join(parts)).replace("\xa0", " ").strip()


def _following_link(label: Tag) -> Optional[Tag]:
    for sibling in label.next_siblings:
        if isinstance(sibling, Tag):
            if sibling.name == "label":
                return None
            if sibling.name == "a":
                return sibling
    return None


def _line_items(block: Tag) -> list[dict]:
    items: list[dict] = []
    for table in block.find_all("table"):
        headers = [clean(th.get_text()).lower() for th in table.find_all("th")]
        if "unspsc" not in headers:
            continue
        for tr in table.find_all("tr"):
            cells = [clean(td.get_text(" ")) for td in tr.find_all("td")]
            if len(cells) == len(headers) and cells:
                items.append(dict(zip(headers, cells)))
    return items


def _absolute(path: Optional[str]) -> Optional[str]:
    if not path:
        return None
    if path.startswith("https://"):
        return path
    return f"https://egp.praz.org.zw{path if path.startswith('/') else '/' + path}"


# ----------------------------------------------------------------------------
# Normalisation shared by discovery and recheck
# ----------------------------------------------------------------------------

def summary_fields(row: BulletinRow, url: str) -> dict[str, dict]:
    """Fields from one Bulletin Board row, with the row as evidence."""
    excerpt = row.row_excerpt
    section = "Bulletin Board row"
    fields: dict[str, dict] = {}
    if row.reference:
        fields["official_reference"] = evidence(row.reference, raw=row.reference, url=url, section=section, excerpt=excerpt)
    if row.title:
        fields["title"] = evidence(row.title, raw=row.title, url=url, section=section, excerpt=excerpt)
    if row.procuring_entity:
        fields["procuring_entity"] = evidence(row.procuring_entity, raw=row.procuring_entity, url=url, section=section, excerpt=excerpt)
    if row.status:
        # The board's "Scope" column (e.g. "Open") - not the notice page's
        # "Status" (e.g. "Published"); both are kept.
        fields["board_status"] = evidence(row.status, raw=row.status, url=url, section=section, excerpt=excerpt)
    if row.category_codes:
        fields["category_codes"] = evidence(row.category_codes, raw=", ".join(row.category_codes), url=url, section=section, excerpt=excerpt)
    if row.category_names_raw:
        fields["required_categories"] = evidence(row.category_names_raw, raw=row.category_names_raw, url=url, section=section, excerpt=excerpt)
    for key, raw in (("published_at", row.published_raw), ("closing_at", row.closing_raw)):
        if raw:
            fields[key] = _typed_field(key, raw, url=url, section=section)
            fields[key]["excerpt"] = excerpt
    return fields


# Fields compared between the list row and the detail page.
CONFLICT_FIELDS = ("official_reference", "title", "procuring_entity", "closing_at", "published_at")


def comparable(key: str, item: Optional[dict]) -> Any:
    if not item:
        return None
    value = item.get("value")
    if key in DATE_FIELDS and isinstance(value, dict):
        return value.get("at") or value.get("date")
    if isinstance(value, str):
        return clean(value).casefold()
    return value


def merge_fields(summary: dict[str, dict], detail: Optional[DetailResult]) -> tuple[dict[str, dict], list[dict]]:
    """Detail page values take precedence; disagreements are kept, not resolved."""
    merged = dict(summary)
    conflicts: list[dict] = []
    if detail is None:
        return merged, conflicts
    for key, item in detail.fields.items():
        if key in summary and key in CONFLICT_FIELDS:
            left, right = comparable(key, summary[key]), comparable(key, item)
            if left is not None and right is not None and left != right:
                conflicts.append({
                    "field": key,
                    "values": [
                        {"value": summary[key]["value"], "raw": summary[key]["raw"], "source": "bulletin_board", "source_url": summary[key]["source_url"], "excerpt": summary[key]["excerpt"]},
                        {"value": item["value"], "raw": item["raw"], "source": "notice_page", "source_url": item["source_url"], "excerpt": item["excerpt"]},
                    ],
                })
        merged[key] = item
    if detail.line_items:
        merged["line_items"] = evidence(detail.line_items, raw=None, url=detail.url, section="Line Item Details",
                                        excerpt="; ".join(i.get("lot name", "") for i in detail.line_items)[:_MAX_EXCERPT])
    return merged, conflicts


def content_hash(fields: dict[str, dict]) -> str:
    stable = {k: comparable(k, v) if k in DATE_FIELDS else (v or {}).get("value") for k, v in fields.items() if k not in VOLATILE_FIELDS}
    payload = json.dumps(stable, sort_keys=True, default=str)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


# ----------------------------------------------------------------------------
# Popups the notice page loads for every visitor (its "Documents: Preview" and
# "Schedule of activity: View all activity" buttons). Served without a login
# when requested the way the page requests them (XMLHttpRequest).
# ----------------------------------------------------------------------------

DOCUMENT_DOWNLOAD_PATH = "/privateUploads/downloads/"


@dataclass
class OfficialDocument:
    key: str            # the portal's document id - stable across reads
    name: str
    url: str
    published_raw: Optional[str]
    published_at: Optional[str]


def parse_document_list(html: str, url: str) -> tuple[list[OfficialDocument], bool]:
    """Returns (documents, structure_found). Only links to the portal's own
    download endpoint count; anything else in the popup is ignored."""
    soup = BeautifulSoup(html, "html.parser")
    structure_found = "document name" in clean(soup.get_text(" ")).lower()
    documents: list[OfficialDocument] = []
    seen: set[str] = set()
    for link in soup.find_all("a", href=True):
        href = link["href"].strip()
        absolute = _absolute(href) if href.startswith("/") else href
        parts = urlsplit(absolute)
        if parts.scheme != "https" or parts.hostname != "egp.praz.org.zw" or parts.path != DOCUMENT_DOWNLOAD_PATH:
            continue
        key = (parse_qs(parts.query).get("id") or [""])[0]
        if not key.isdigit() or key in seen:
            continue
        seen.add(key)
        name = clean(link.get_text()) or f"document-{key}"
        row = link.find_parent("tr")
        cells = [clean(td.get_text(" ")) for td in row.find_all("td")] if row else []
        raw_date = cells[-1] if len(cells) >= 3 else None
        parsed = parse_portal_datetime(raw_date)
        documents.append(OfficialDocument(key=key, name=name[:255], url=absolute, published_raw=raw_date,
                                          published_at=parsed.at.isoformat() if parsed and parsed.at else None))
    return documents, structure_found


SCHEDULE_LABELS = {
    "pre-bid meeting": "pre_bid_mode",
    "pre-bid venue": "pre_bid_venue",
    "pre-bid meeting start date and time": "pre_bid_start",
    "pre-bid meeting end date and time": "pre_bid_end",
    "tender published date": "published_at",
    "request for clarification": "clarification_deadline",
    "bid addendum issuance last date and time": "addendum_last",
    "bid submission deadline date and time": "submission_deadline",
    "bid opening start date and time": "bid_opening",
}
SCHEDULE_DATE_KEYS = {"pre_bid_start", "pre_bid_end", "published_at", "clarification_deadline", "addendum_last",
                      "submission_deadline", "bid_opening"}


def parse_schedule(html: str, url: str) -> tuple[dict[str, dict], bool]:
    """The 'Schedule of activity' popup as evidence-carrying fields. A label
    with nothing after it (e.g. an empty venue) yields no field."""
    soup = BeautifulSoup(html, "html.parser")
    lines = [clean(line) for line in soup.get_text("\n").split("\n")]
    lines = [line for line in lines if line and line != "×"]
    structure_found = any(line.lower().startswith("schedule of activity") for line in lines)
    fields: dict[str, dict] = {}
    i = 0
    while i < len(lines):
        line = lines[i]
        label, value = None, None
        if line.endswith(":"):
            label = line[:-1].strip()
            nxt = lines[i + 1] if i + 1 < len(lines) else ""
            if nxt and not nxt.endswith(":"):
                value, i = nxt, i + 1
        elif ":" in line:
            head, _, tail = line.partition(":")
            if head.strip().lower() in SCHEDULE_LABELS:
                label, value = head.strip(), tail.strip()
        i += 1
        key = SCHEDULE_LABELS.get((label or "").lower())
        if not key or not value:
            continue
        excerpt = f"{label}: {value}"
        if key in SCHEDULE_DATE_KEYS:
            parsed = parse_portal_datetime(value)
            typed = {"at": parsed.at.isoformat() if parsed and parsed.at else None,
                     "date": parsed.day.isoformat() if parsed and parsed.day else None,
                     "time_specified": bool(parsed and parsed.time_specified)}
            fields[key] = evidence(typed, raw=value, url=url, section="Schedule of activity", excerpt=excerpt,
                                   confidence="high" if parsed and parsed.at else "low")
        else:
            fields[key] = evidence(value, raw=value, url=url, section="Schedule of activity", excerpt=excerpt)
    return fields, structure_found


def parse_amount(raw: Optional[str]) -> Optional[float]:
    """'500', '1,500.00', 'USD 500' -> 500.0; anything else -> None."""
    match = re.search(r"\d[\d,]*(?:\.\d+)?", clean(raw).replace("\xa0", " "))
    if not match:
        return None
    try:
        return float(match.group(0).replace(",", ""))
    except ValueError:
        return None
