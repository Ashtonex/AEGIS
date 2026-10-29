"""HTTP access to the official PRAZ e-GP portal.

Source verification (2026-10-26): https://www.praz.org.zw links its "eGP
System" to https://egp.praz.org.zw. That portal's public Bulletin Board
(/Indexes/index) and tender detail pages (/Indexes/viewLiveTenderDetails/{id})
are served without a login.

Re-checked 2026-10-28: the public notice page's own "Documents: Preview" and
"Schedule of activity: View all activity" buttons load
/Tenders/tender_doc_view/{id}/{id} and /Tenders/tender_shedule/{id} with an
XMLHttpRequest, and the portal answers those for anonymous visitors (a plain
page load gets the signed-out shell instead). The document links in that
popup (/privateUploads/downloads/?id=..&h=..) download without a session.
So AEGIS reads documents and the schedule exactly as an anonymous visitor
clicking those buttons does. It never signs in: the supplier login page has a
CAPTCHA, and a CAPTCHA is never automated.

Rules enforced here, not left to callers:
  * only https://egp.praz.org.zw, only the read-only paths below;
  * at least ``min_interval`` seconds between requests (default 3 s);
  * bounded retries with exponential backoff on timeouts and 5xx;
  * HTTP 429 / 403, a CAPTCHA, or the login shell stop the run as
    ``access_restricted`` - they are never worked around;
  * downloads are size-capped and only from the portal's download path;
  * no cookies are persisted between runs and none are logged.
"""

from __future__ import annotations

import asyncio
import random
import time
from dataclasses import dataclass, field
from email.utils import parsedate_to_datetime
from typing import Any, Awaitable, Callable, Optional
from urllib.parse import urlencode, urlsplit

import httpx

SOURCE_KEY = "praz_egp"
SOURCE_NAME = "PRAZ e-GP (Zimbabwe)"
BASE_URL = "https://egp.praz.org.zw"
ALLOWED_HOST = "egp.praz.org.zw"
VERIFIED_FROM = "https://www.praz.org.zw (eGP System link), checked 2026-10-26"
BULLETIN_PATH = "/Indexes/index"
DETAIL_PATH = "/Indexes/viewLiveTenderDetails/{notice_id}"
DOCUMENTS_PATH = "/Tenders/tender_doc_view/{notice_id}/{notice_id}"
SCHEDULE_PATH = "/Tenders/tender_shedule/{notice_id}"
DOWNLOAD_PATH = "/privateUploads/downloads/"
LOGIN_URL = f"{BASE_URL}/Indexes/login"
# Headers the notice page's own popup buttons send.
POPUP_HEADERS = {"X-Requested-With": "XMLHttpRequest", "Accept": "text/html, */*; q=0.01"}
TERMS_NOTE = (
    "The e-GP supplier terms allow notice information to be used and stored only to evaluate "
    "an opportunity or prepare a response; AEGIS keeps it internal and never republishes it."
)
USER_AGENT = "AEGIS-TenderDiscovery/1.0 (Six Nine Construction internal tender intake)"

# Query parameters the Bulletin Board's own search form submits (GET).
PORTAL_FILTER_PARAMS = {
    "category_code": "searchSuppCode",
    "category_name": "searchSuppName",
    "procuring_entity_id": "searchDept",
    "notice_id": "searchRefNo",
    "reference": "searchtenderRefNo",
    "title": "searchNoticeTitle",
    "published_from": "searchPublishDateFrom",
    "published_to": "searchPublishDateTo",
    "closing_from": "searchClosingDateFrom",
    "closing_to": "searchClosingDateTo",
}


class PortalAccessError(Exception):
    """Base class: the page could not be obtained."""

    kind = "connection_error"

    def __init__(self, message: str, *, url: str, status_code: Optional[int] = None):
        super().__init__(message)
        self.url = url
        self.status_code = status_code


class PortalRestricted(PortalAccessError):
    """The portal refused or gated access (429/403/CAPTCHA/login). Stop - do not retry around it."""

    kind = "access_restricted"


class PortalUnavailable(PortalAccessError):
    """Network failure, timeout or 5xx after the bounded retries."""

    kind = "connection_error"


class PortalNotFound(PortalAccessError):
    """404 / empty page for one notice - the notice may have been withdrawn."""

    kind = "not_found"


@dataclass
class PortalResponse:
    url: str
    status_code: int
    text: str
    fetched_at: float
    server_date: Optional[str] = None
    elapsed_ms: int = 0
    attempts: int = 1


def build_url(path: str, params: Optional[dict[str, Any]] = None) -> str:
    query = urlencode({k: v for k, v in (params or {}).items() if v not in (None, "")})
    url = f"{BASE_URL}{path}"
    return f"{url}?{query}" if query else url


def bulletin_url(page: int = 1, filters: Optional[dict[str, Any]] = None) -> str:
    params: dict[str, Any] = {}
    for key, param in PORTAL_FILTER_PARAMS.items():
        value = (filters or {}).get(key)
        if value not in (None, ""):
            params[param] = value
    if page > 1:
        params["page"] = page
    return build_url(BULLETIN_PATH, params)


def detail_url(notice_id: str) -> str:
    return build_url(DETAIL_PATH.format(notice_id=_safe_notice_id(notice_id)))


def documents_url(notice_id: str) -> str:
    safe = _safe_notice_id(notice_id)
    return build_url(DOCUMENTS_PATH.format(notice_id=safe))


def schedule_url(notice_id: str) -> str:
    return build_url(SCHEDULE_PATH.format(notice_id=_safe_notice_id(notice_id)))


def is_download_url(url: str) -> bool:
    return is_allowed_url(url) and urlsplit(url).path == DOWNLOAD_PATH


def _safe_notice_id(notice_id: str) -> str:
    value = str(notice_id).strip()
    if not value.isdigit() or len(value) > 12:
        raise ValueError("e-GP notice ids are numeric.")
    return value


def is_allowed_url(url: str) -> bool:
    parts = urlsplit(url)
    return parts.scheme == "https" and parts.hostname == ALLOWED_HOST and not parts.username and not parts.password


def normalize_notice_url(url: str) -> Optional[str]:
    """Canonical form used for dedupe: https, lower-case host, no query/fragment/trailing slash."""
    if not url:
        return None
    parts = urlsplit(url.strip())
    if not parts.hostname:
        return None
    path = parts.path.rstrip("/")
    return f"https://{parts.hostname.lower()}{path}"


Sleeper = Callable[[float], Awaitable[None]]


@dataclass
class PortalClient:
    """Paced, read-only client. One instance per run so pacing spans the run."""

    min_interval: float = 3.0
    max_attempts: int = 3
    backoff_base: float = 2.0
    timeout: float = 30.0
    transport: Optional[httpx.AsyncBaseTransport] = None
    sleeper: Sleeper = asyncio.sleep
    requests_made: int = 0
    _last_request_at: Optional[float] = None
    _client: Optional[httpx.AsyncClient] = field(default=None, repr=False)

    async def __aenter__(self) -> "PortalClient":
        self._client = httpx.AsyncClient(
            timeout=self.timeout,
            headers={"User-Agent": USER_AGENT, "Accept": "text/html"},
            follow_redirects=False,
            transport=self.transport,
        )
        return self

    async def __aexit__(self, *exc: Any) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    async def _pace(self) -> None:
        if self._last_request_at is not None:
            wait = self.min_interval - (time.monotonic() - self._last_request_at)
            if wait > 0:
                await self.sleeper(wait)
        self._last_request_at = time.monotonic()

    async def get(self, url: str, *, popup: bool = False) -> PortalResponse:
        """popup=True sends the headers the notice page's own popup buttons
        send (documents list, activity schedule)."""
        if not is_allowed_url(url):
            raise PortalRestricted("Refusing to fetch a URL outside the official e-GP portal.", url=url)
        if self._client is None:
            raise RuntimeError("PortalClient must be used as an async context manager.")

        last_error: Optional[PortalAccessError] = None
        for attempt in range(1, self.max_attempts + 1):
            await self._pace()
            started = time.monotonic()
            self.requests_made += 1
            try:
                response = await self._client.get(url, headers=POPUP_HEADERS if popup else None)
            except (httpx.TimeoutException, httpx.TransportError) as exc:
                last_error = PortalUnavailable(f"{type(exc).__name__} contacting the portal.", url=url)
            else:
                status = response.status_code
                if status == 200:
                    return PortalResponse(
                        url=url,
                        status_code=status,
                        text=response.text,
                        fetched_at=time.time(),
                        server_date=response.headers.get("date"),
                        elapsed_ms=int((time.monotonic() - started) * 1000),
                        attempts=attempt,
                    )
                if status in (401, 403, 429):
                    raise PortalRestricted(
                        f"The portal refused the request (HTTP {status}).", url=url, status_code=status
                    )
                if status in (301, 302, 303, 307, 308):
                    location = response.headers.get("location", "")
                    if "login" in location.lower():
                        raise PortalRestricted("The portal redirected to its login page.", url=url, status_code=status)
                    raise PortalUnavailable(f"Unexpected redirect (HTTP {status}).", url=url, status_code=status)
                if status == 404:
                    raise PortalNotFound("The portal returned HTTP 404.", url=url, status_code=status)
                if 500 <= status < 600:
                    last_error = PortalUnavailable(f"Portal server error (HTTP {status}).", url=url, status_code=status)
                else:
                    raise PortalUnavailable(f"Unexpected HTTP {status}.", url=url, status_code=status)
            if attempt < self.max_attempts:
                delay = self.backoff_base ** attempt + random.uniform(0, 0.5)  # nosec B311 - jitter only
                await self.sleeper(delay)
        assert last_error is not None
        last_error.args = (f"{last_error.args[0]} Gave up after {self.max_attempts} attempts.",)
        raise last_error

    async def download(self, url: str, *, max_bytes: int) -> "PortalDownload":
        """One official document. Paced like every other request; refuses
        anything but the portal's download path; stops reading past
        max_bytes. Not retried here - the caller records a failure and a
        later collection retries it."""
        if not is_download_url(url):
            raise PortalRestricted("Refusing to download from outside the e-GP document path.", url=url)
        if self._client is None:
            raise RuntimeError("PortalClient must be used as an async context manager.")
        await self._pace()
        self.requests_made += 1
        try:
            async with self._client.stream("GET", url, headers={"Accept": "*/*"}) as response:
                if response.status_code in (401, 403, 429):
                    raise PortalRestricted(f"The portal refused the download (HTTP {response.status_code}).",
                                           url=url, status_code=response.status_code)
                if response.status_code in (301, 302, 303, 307, 308):
                    raise PortalRestricted("The portal redirected the download (login required).",
                                           url=url, status_code=response.status_code)
                if response.status_code != 200:
                    raise PortalUnavailable(f"Download failed (HTTP {response.status_code}).",
                                            url=url, status_code=response.status_code)
                declared = response.headers.get("content-length")
                if declared and declared.isdigit() and int(declared) > max_bytes:
                    raise PortalUnavailable(f"File is larger than {max_bytes // (1024 * 1024)} MB.", url=url)
                chunks: list[bytes] = []
                size = 0
                async for chunk in response.aiter_bytes():
                    size += len(chunk)
                    if size > max_bytes:
                        raise PortalUnavailable(f"File is larger than {max_bytes // (1024 * 1024)} MB.", url=url)
                    chunks.append(chunk)
                return PortalDownload(url=url, content=b"".join(chunks),
                                      disposition=response.headers.get("content-disposition"),
                                      content_type=response.headers.get("content-type"))
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            raise PortalUnavailable(f"{type(exc).__name__} downloading the document.", url=url) from exc


@dataclass
class PortalDownload:
    url: str
    content: bytes
    disposition: Optional[str]
    content_type: Optional[str]


def server_clock_offset_minutes(page_clock: Optional[str], server_date: Optional[str]) -> Optional[int]:
    """Offset of the portal's displayed clock from UTC, from the page's own
    clock string (``var dt = 'YYYY/MM/DD HH:MM:SS'``) and the HTTP Date
    header. Rounded to 30 minutes. None when either is missing."""
    if not page_clock or not server_date:
        return None
    from datetime import datetime, timezone

    try:
        local = datetime.strptime(page_clock, "%Y/%m/%d %H:%M:%S")
        utc = parsedate_to_datetime(server_date).astimezone(timezone.utc).replace(tzinfo=None)
    except (ValueError, TypeError):
        return None
    minutes = (local - utc).total_seconds() / 60
    return int(round(minutes / 30) * 30)
