"""Connection probe and resumable discovery runs against the e-GP Bulletin Board.

A run records its source, filters, profile snapshot and start time, then
walks the live Bulletin Board page by page. Each page is committed as a
checkpoint (``last_page_completed``) so an interrupted run - portal outage,
rate limit, API restart - is resumed from the next page rather than
restarted, and resuming can never duplicate a candidate (candidates are
unique per organisation + source + official notice id).

Outcomes are kept distinct on purpose:
  completed + matches_found / no_matches   - every page in scope was read
  completed + no_notices_listed            - the board listed nothing
  partial   + interrupted / restricted ... - some pages or details missing
  failed    + access_failed / extraction_failed - nothing usable was read
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Optional

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.tenders.egp import portal
from app.services.tenders.egp.matching import (
    DEFAULT_PROFILE,
    DEFAULT_PROFILE_NAME,
    assess_readiness,
    effective_fields,
    is_detail_worthy,
    score_candidate,
)
from app.services.tenders.egp.parser import (
    DetailResult,
    SOURCE_TIMEZONE,
    content_hash,
    merge_fields,
    parse_bulletin_page,
    parse_detail_page,
    summary_fields,
)
from app.shared.events import emit_notification
from core.logging import logger

ClientFactory = Callable[[], portal.PortalClient]
STALE_RUN_AFTER = timedelta(minutes=10)
ACTIVE_STATUSES = ("queued", "running")
MAX_FAILURES_KEPT = 200

# Field -> (change kind, material?) for version-to-version comparison.
TRACKED_FIELDS: dict[str, tuple[str, bool]] = {
    "closing_at": ("closing_date_changed", True),
    "site_visit": ("site_visit_changed", True),
    "addenda_count": ("addenda_changed", True),
    "documents": ("attachments_changed", True),
    "required_categories": ("eligibility_changed", True),
    "category_codes": ("eligibility_changed", True),
    "notice_status": ("status_changed", True),
    "board_status": ("status_changed", True),
    "official_reference": ("other_amendment", True),
    "procuring_entity": ("other_amendment", True),
    "procurement_method": ("other_amendment", True),
    "project_location": ("other_amendment", True),
    "bid_validity_days": ("other_amendment", True),
    "bid_form_fee": ("other_amendment", True),
    "delivery_period": ("other_amendment", True),
    "title": ("other_amendment", False),
    "description": ("other_amendment", False),
    "line_items": ("other_amendment", False),
}


def _client_factory(source: dict) -> ClientFactory:
    interval = max(1.5, (source.get("min_request_interval_ms") or 3000) / 1000)
    return lambda: portal.PortalClient(min_interval=interval)


def _j(value: Any) -> str:
    return json.dumps(value, default=str)


def _dt(value: Optional[str]) -> Optional[datetime]:
    return datetime.fromisoformat(value) if value else None


async def _rows(db: AsyncSession, sql: str, params: dict) -> list[dict]:
    return [dict(r) for r in (await db.execute(text(sql), params)).mappings().all()]


async def _row(db: AsyncSession, sql: str, params: dict) -> Optional[dict]:
    row = (await db.execute(text(sql), params)).mappings().first()
    return dict(row) if row else None


# ----------------------------------------------------------------------------
# Source + profile bootstrap
# ----------------------------------------------------------------------------

async def ensure_source(db: AsyncSession, org_id: str) -> dict:
    await db.execute(
        text("""
            INSERT INTO crm.tender_sources (organization_id, source_key, display_name, base_url, verified_from)
            VALUES (:org_id, :key, :name, :base, :verified)
            ON CONFLICT (organization_id, source_key) DO NOTHING
        """),
        {"org_id": org_id, "key": portal.SOURCE_KEY, "name": portal.SOURCE_NAME, "base": portal.BASE_URL,
         "verified": portal.VERIFIED_FROM},
    )
    return await _row(db, "SELECT * FROM crm.tender_sources WHERE organization_id = :org_id AND source_key = :key",
                      {"org_id": org_id, "key": portal.SOURCE_KEY})


async def ensure_default_profile(db: AsyncSession, org_id: str, user_id: Optional[str]) -> dict:
    existing = await _row(
        db,
        "SELECT * FROM crm.tender_discovery_profiles WHERE organization_id = :org_id AND lower(name) = lower(:name) AND is_deleted = false",
        {"org_id": org_id, "name": DEFAULT_PROFILE_NAME},
    )
    if existing:
        return existing
    params = {key: _j(DEFAULT_PROFILE[key]) for key in (
        "work_types", "category_terms", "category_codes", "preferred_locations", "nearby_locations",
        "exclude_terms", "default_filters", "scoring")}
    await db.execute(
        text("""
            INSERT INTO crm.tender_discovery_profiles (
                organization_id, name, description, work_types, category_terms, category_codes,
                preferred_locations, nearby_locations, exclude_terms, default_filters, scoring, created_by, updated_by
            ) VALUES (
                :org_id, :name, :description, CAST(:work_types AS jsonb), CAST(:category_terms AS jsonb),
                CAST(:category_codes AS jsonb), CAST(:preferred_locations AS jsonb), CAST(:nearby_locations AS jsonb),
                CAST(:exclude_terms AS jsonb), CAST(:default_filters AS jsonb), CAST(:scoring AS jsonb), :user_id, :user_id
            )
            ON CONFLICT DO NOTHING
        """),
        {**params, "org_id": org_id, "name": DEFAULT_PROFILE_NAME, "description": DEFAULT_PROFILE["description"],
         "user_id": user_id},
    )
    return await _row(
        db,
        "SELECT * FROM crm.tender_discovery_profiles WHERE organization_id = :org_id AND lower(name) = lower(:name) AND is_deleted = false",
        {"org_id": org_id, "name": DEFAULT_PROFILE_NAME},
    )


def profile_dict(row: dict) -> dict:
    return {key: row.get(key) for key in (
        "id", "name", "description", "work_types", "category_terms", "category_codes", "preferred_locations",
        "nearby_locations", "exclude_terms", "default_filters", "scoring")}


async def load_credentials(db: AsyncSession, org_id: str) -> list[dict]:
    """SNC credentials actually configured in AEGIS. Expired ones never count."""
    return await _rows(
        db,
        """
        SELECT credential_type, category, classification_grade, expiry_date, status
        FROM compliance.corporate_credentials
        WHERE organization_id = :org_id AND is_deleted = false
          AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE)
        """,
        {"org_id": org_id},
    )


# ----------------------------------------------------------------------------
# Connection probe
# ----------------------------------------------------------------------------

async def probe_connection(db: AsyncSession, *, org_id: str, user_id: Optional[str],
                           client_factory: Optional[ClientFactory] = None) -> dict:
    """Reads the live Bulletin Board once and records what actually happened.
    The state is only 'connected_verified' when the notice table was parsed."""
    source = await ensure_source(db, org_id)
    factory = client_factory or _client_factory(source)
    url = portal.bulletin_url(1)
    probe: dict[str, Any] = {"checked_url": url, "checked_at": datetime.now(timezone.utc).isoformat()}
    state, reason = "connection_error", None
    try:
        async with factory() as client:
            response = await client.get(url)
        page = parse_bulletin_page(response.text, url)
        offset = portal.server_clock_offset_minutes(page.page_clock, response.server_date)
        probe.update({"http_status": response.status_code, "elapsed_ms": response.elapsed_ms,
                      "clock_offset_minutes": offset, "timezone_consistent": offset == 120 if offset is not None else None})
        if page.has_captcha:
            state, reason = "access_restricted", "The portal presented a CAPTCHA. AEGIS does not bypass it - open the portal yourself."
        elif page.is_login_shell:
            state, reason = "access_restricted", "The Bulletin Board now requires an e-GP login."
        elif not page.table_found:
            state, reason = "connection_error", "The Bulletin Board loaded but its notice table was not recognised (page layout may have changed)."
        else:
            state = "connected_verified"
            reason = (f"Read the live Bulletin Board: {page.records_total} notices on {page.pages_total} pages."
                      if page.records_total is not None else f"Read the live Bulletin Board: {len(page.rows)} notices on the first page.")
            probe.update({"records_total": page.records_total, "pages_total": page.pages_total,
                          "rows_on_first_page": len(page.rows), "sample_notice_ids": [r.notice_id for r in page.rows[:3]]})
            if offset is not None and offset != 120:
                probe["timezone_note"] = f"Portal clock is UTC{offset / 60:+.1f}h, not Africa/Harare (UTC+2) - review notice times."
    except portal.PortalRestricted as exc:
        state, reason = "access_restricted", str(exc)
        probe["http_status"] = exc.status_code
    except portal.PortalAccessError as exc:
        state, reason = "connection_error", str(exc)
        probe["http_status"] = exc.status_code

    await db.execute(
        text("""
            UPDATE crm.tender_sources
            SET connection_state = :state, state_reason = :reason, last_probe_at = NOW(),
                last_verified_at = CASE WHEN :state_v = 'connected_verified' THEN NOW() ELSE last_verified_at END,
                last_probe = CAST(:probe AS jsonb), updated_by = :user_id, updated_at = NOW()
            WHERE id = :id
        """),
        {"state": state, "state_v": state, "reason": reason, "probe": _j(probe), "user_id": user_id, "id": source["id"]},
    )
    return {"connection_state": state, "state_reason": reason, "probe": probe}


# ----------------------------------------------------------------------------
# Runs
# ----------------------------------------------------------------------------

class ActiveRunExists(Exception):
    def __init__(self, run_id: str):
        super().__init__("A discovery run is already in progress.")
        self.run_id = run_id


def portal_filters(filters: dict) -> dict:
    """Map AEGIS filters onto the Bulletin Board's own search parameters.
    The portal needs both ends of a date range, so a half range is closed
    with a wide bound rather than silently dropped."""
    out: dict[str, str] = {}
    for key in ("category_code", "category_name", "procuring_entity_id", "reference", "title"):
        value = (filters.get(key) or "").strip() if isinstance(filters.get(key), str) else filters.get(key)
        if value:
            out[key] = str(value)[:50]
    for prefix in ("published", "closing"):
        start, end = filters.get(f"{prefix}_from"), filters.get(f"{prefix}_to")
        if start or end:
            out[f"{prefix}_from"] = _portal_date(start or "2000-01-01")
            out[f"{prefix}_to"] = _portal_date(end or "2099-12-31")
    return out


def _portal_date(value: str) -> str:
    return datetime.fromisoformat(str(value)[:10]).strftime("%d-%b-%Y")


async def mark_stale_runs(db: AsyncSession, org_id: str) -> int:
    """A run whose heartbeat stopped (API restart, crash) is closed as
    partial/interrupted so it can be resumed and no longer blocks new runs."""
    result = await db.execute(
        text("""
            UPDATE crm.tender_discovery_runs
            SET status = 'partial', outcome = 'interrupted', finished_at = NOW(),
                summary = COALESCE(summary, '') || ' Run stopped responding and was marked interrupted - resume continues from page ' || (last_page_completed + 1) || '.'
            WHERE organization_id = :org_id AND status IN ('queued', 'running')
              AND COALESCE(heartbeat_at, created_at) < NOW() - make_interval(secs => :secs)
            RETURNING id
        """),
        {"org_id": org_id, "secs": int(STALE_RUN_AFTER.total_seconds())},
    )
    return len(result.fetchall())


async def create_run(db: AsyncSession, *, org_id: str, user_id: Optional[str], profile: dict, filters: dict,
                     page_limit: Optional[int], resumed_from: Optional[dict] = None) -> dict:
    source = await ensure_source(db, org_id)
    await mark_stale_runs(db, org_id)
    active = await _row(db, "SELECT id FROM crm.tender_discovery_runs WHERE organization_id = :org_id AND source_key = :key AND status IN ('queued','running')",
                        {"org_id": org_id, "key": portal.SOURCE_KEY})
    if active:
        raise ActiveRunExists(str(active["id"]))
    limit = min(int(page_limit or source["max_pages_per_run"]), int(source["max_pages_per_run"]))
    try:
        async with db.begin_nested():
            run = await _row(
                db,
                """
                INSERT INTO crm.tender_discovery_runs (
                    organization_id, source_key, profile_id, profile_snapshot, filters, status, started_by,
                    page_limit, last_page_completed, resumed_from_run_id, pages_total, records_total, executor
                ) VALUES (
                    :org_id, :key, :profile_id, CAST(:snapshot AS jsonb), CAST(:filters AS jsonb), 'queued', :user_id,
                    :page_limit, :start_after, :resumed_from, :pages_total, :records_total, 'api_background'
                ) RETURNING *
                """,
                {"org_id": org_id, "key": portal.SOURCE_KEY, "profile_id": profile.get("id"),
                 "snapshot": _j(profile_dict(profile)), "filters": _j(filters), "user_id": user_id,
                 "page_limit": limit, "start_after": (resumed_from or {}).get("last_page_completed", 0),
                 "resumed_from": (resumed_from or {}).get("id"), "pages_total": (resumed_from or {}).get("pages_total"),
                 "records_total": (resumed_from or {}).get("records_total")},
            )
    except IntegrityError:
        active = await _row(db, "SELECT id FROM crm.tender_discovery_runs WHERE organization_id = :org_id AND source_key = :key AND status IN ('queued','running')",
                            {"org_id": org_id, "key": portal.SOURCE_KEY})
        raise ActiveRunExists(str(active["id"]) if active else "")
    return run


async def _heartbeat(db: AsyncSession, run_id: str, **counters: Any) -> None:
    sets = ", ".join(f"{key} = :{key}" for key in counters)
    await db.execute(
        text(f"UPDATE crm.tender_discovery_runs SET heartbeat_at = NOW(){', ' + sets if sets else ''} WHERE id = :run_id"),  # nosec B608 - keys are internal counter names
        {"run_id": run_id, **counters},
    )


async def execute_run(db: AsyncSession, run_id: str, *, client_factory: Optional[ClientFactory] = None) -> dict:
    """Runs (or resumes) one discovery run to a final state. Never raises for
    portal problems - they are recorded on the run."""
    run = await _row(db, "SELECT * FROM crm.tender_discovery_runs WHERE id = :id", {"id": run_id})
    if not run or run["status"] not in ACTIVE_STATUSES:
        return run or {}
    org_id = str(run["organization_id"])
    source = await ensure_source(db, org_id)
    factory = client_factory or _client_factory(source)
    profile = run["profile_snapshot"] or DEFAULT_PROFILE
    credentials = await load_credentials(db, org_id)
    filters = run["filters"] or {}
    search = portal_filters(filters)
    detail_budget = int(source["max_details_per_run"])

    counters = {key: int(run[key] or 0) for key in (
        "pages_fetched", "pages_failed", "notices_seen", "notices_matched", "details_attempted", "details_fetched",
        "details_failed", "details_skipped", "candidates_new", "candidates_updated", "changes_detected")}
    failures: list[dict] = list(run["failures"] or [])
    row_errors: list[str] = []
    pages_total, records_total = run["pages_total"], run["records_total"]
    page = int(run["last_page_completed"] or 0) + 1
    page_limit = int(run["page_limit"] or source["max_pages_per_run"])
    stop_reason: Optional[str] = None
    reached_end = False

    await db.execute(text("UPDATE crm.tender_discovery_runs SET status = 'running', started_at = COALESCE(started_at, NOW()), heartbeat_at = NOW() WHERE id = :id"),
                     {"id": run_id})
    await db.commit()

    def fail(stage: str, url: str, error: str) -> None:
        if len(failures) < MAX_FAILURES_KEPT:
            failures.append({"stage": stage, "url": url, "error": error[:300], "at": datetime.now(timezone.utc).isoformat()})

    try:
        async with factory() as client:
            while page <= page_limit:
                flag = (await db.execute(text("SELECT cancel_requested FROM crm.tender_discovery_runs WHERE id = :id"), {"id": run_id})).scalar()
                if flag:
                    stop_reason = "cancelled"
                    break
                url = portal.bulletin_url(page, search)
                try:
                    response = await client.get(url)
                except portal.PortalRestricted as exc:
                    fail("bulletin_page", url, str(exc))
                    counters["pages_failed"] += 1
                    stop_reason = "restricted"
                    break
                except portal.PortalAccessError as exc:
                    # Stop here rather than skip ahead: the checkpoint must
                    # never move past an unread page, so resume re-reads it.
                    fail("bulletin_page", url, str(exc))
                    counters["pages_failed"] += 1
                    stop_reason = "access_failed"
                    break
                parsed = parse_bulletin_page(response.text, url)
                if parsed.has_captcha or parsed.is_login_shell:
                    fail("bulletin_page", url, "CAPTCHA or login required - not bypassed.")
                    counters["pages_failed"] += 1
                    stop_reason = "restricted"
                    break
                if not parsed.table_found:
                    fail("bulletin_page", url, "Notice table not recognised on this page.")
                    counters["pages_failed"] += 1
                    stop_reason = "extraction_failed"
                    break
                counters["pages_fetched"] += 1
                row_errors.extend(parsed.row_errors)
                if parsed.pages_total is not None:
                    pages_total, records_total = parsed.pages_total, parsed.records_total
                elif page == 1 and not parsed.has_next:
                    pages_total, records_total = 1, len(parsed.rows)

                for row in parsed.rows:
                    counters["notices_seen"] += 1
                    outcome = await _process_row(db, org_id=org_id, run_id=run_id, row=row, page_url=url, profile=profile,
                                                 credentials=credentials, client=client,
                                                 fetch_detail=counters["details_attempted"] < detail_budget, fail=fail)
                    for key, delta in outcome.items():
                        counters[key] = counters.get(key, 0) + delta
                    if outcome.get("restricted"):
                        stop_reason = "restricted"
                        break
                counters.pop("restricted", None)
                if stop_reason == "restricted":
                    await _heartbeat(db, run_id, last_page_completed=page - 1, pages_total=pages_total,
                                     records_total=records_total, **counters)
                    await db.commit()
                    break

                await _heartbeat(db, run_id, last_page_completed=page, pages_total=pages_total,
                                 records_total=records_total, **counters)
                await db.commit()
                if not parsed.has_next or (pages_total is not None and page >= pages_total):
                    reached_end = True
                    break
                page += 1
    except Exception as exc:  # noqa: BLE001 - recorded on the run, never reported as success
        await db.rollback()
        logger.exception("egp_discovery.run_crashed", run_id=run_id)
        fail("run", "", f"Unexpected error: {type(exc).__name__}")
        stop_reason = "interrupted"

    counters.pop("restricted", None)
    return await _finalise(db, run_id, counters=counters, failures=failures, row_errors=row_errors,
                           pages_total=pages_total, records_total=records_total, page_limit=page_limit,
                           reached_end=reached_end, stop_reason=stop_reason,
                           detail_budget_exhausted=counters["details_attempted"] >= detail_budget)


async def _finalise(db: AsyncSession, run_id: str, *, counters: dict, failures: list, row_errors: list,
                    pages_total: Optional[int], records_total: Optional[int], page_limit: int, reached_end: bool,
                    stop_reason: Optional[str], detail_budget_exhausted: bool) -> dict:
    run = await _row(db, "SELECT last_page_completed FROM crm.tender_discovery_runs WHERE id = :id", {"id": run_id})
    last_page = int(run["last_page_completed"] or 0) if run else 0
    page_cap_hit = not reached_end and stop_reason is None
    complete_coverage = reached_end and counters["pages_failed"] == 0
    detail_gaps = counters["details_failed"] > 0 or (detail_budget_exhausted and counters["details_skipped"] > 0)

    if stop_reason == "cancelled":
        status, outcome = "cancelled", "cancelled"
    elif counters["pages_fetched"] == 0:
        status = "failed"
        outcome = {"restricted": "restricted", "extraction_failed": "extraction_failed"}.get(stop_reason or "", "access_failed")
    elif complete_coverage and not detail_gaps and not row_errors:
        status = "completed"
        outcome = ("no_notices_listed" if counters["notices_seen"] == 0
                   else "matches_found" if counters["notices_matched"] else "no_matches")
    else:
        status = "partial"
        outcome = {"restricted": "restricted", "extraction_failed": "extraction_failed"}.get(
            stop_reason or "", "matches_found" if counters["notices_matched"] else "interrupted")

    coverage = {
        "pages_total": pages_total, "records_total": records_total, "last_page_completed": last_page,
        "page_limit": page_limit, "page_limit_hit": page_cap_hit, "reached_last_page": reached_end,
        "detail_budget_exhausted": detail_budget_exhausted, "row_parse_errors": row_errors[:20],
        "stop_reason": stop_reason,
    }
    parts = [f"Read {counters['pages_fetched']} of {pages_total if pages_total is not None else '?'} page(s), "
             f"{counters['notices_seen']} notice(s); {counters['notices_matched']} matched the profile."]
    if counters["details_fetched"] or counters["details_failed"]:
        parts.append(f"Notice pages read: {counters['details_fetched']}, failed: {counters['details_failed']}.")
    if page_cap_hit:
        parts.append(f"Stopped at the {page_limit}-page limit before the last page - coverage is incomplete.")
    if detail_budget_exhausted and counters["details_skipped"]:
        parts.append(f"{counters['details_skipped']} matching notice(s) were not opened (per-run detail limit).")
    if stop_reason == "restricted":
        parts.append("The portal restricted access; nothing was bypassed.")
    elif stop_reason == "extraction_failed":
        parts.append("A page could not be read as a notice table - the portal layout may have changed.")
    elif stop_reason in ("access_failed", "interrupted"):
        parts.append(f"Stopped early; resume continues from page {last_page + 1}.")
    if row_errors:
        parts.append(f"{len(row_errors)} row(s) could not be parsed.")
    if status == "completed" and outcome == "no_matches":
        parts.append("Every page was read and no notice matched - this is a genuine 'no matching tenders' result.")

    await db.execute(
        text("""
            UPDATE crm.tender_discovery_runs
            SET status = :status, outcome = :outcome, finished_at = NOW(), heartbeat_at = NOW(),
                failures = CAST(:failures AS jsonb), coverage = CAST(:coverage AS jsonb), summary = :summary,
                pages_total = :pages_total, records_total = :records_total,
                pages_fetched = :pages_fetched, pages_failed = :pages_failed, notices_seen = :notices_seen,
                notices_matched = :notices_matched, details_attempted = :details_attempted,
                details_fetched = :details_fetched, details_failed = :details_failed, details_skipped = :details_skipped,
                candidates_new = :candidates_new, candidates_updated = :candidates_updated, changes_detected = :changes_detected
            WHERE id = :id
        """),
        {"status": status, "outcome": outcome, "failures": _j(failures), "coverage": _j(coverage), "summary": " ".join(parts),
         "pages_total": pages_total, "records_total": records_total, "id": run_id, **counters},
    )
    await db.commit()
    return await _row(db, "SELECT * FROM crm.tender_discovery_runs WHERE id = :id", {"id": run_id})


# ----------------------------------------------------------------------------
# One notice: stage, score, read detail, version, detect changes
# ----------------------------------------------------------------------------

async def _process_row(db: AsyncSession, *, org_id: str, run_id: Optional[str], row, page_url: str, profile: dict,
                       credentials: list[dict], client: portal.PortalClient, fetch_detail: bool, fail) -> dict:
    counts = {"notices_matched": 0, "details_attempted": 0, "details_fetched": 0, "details_failed": 0,
              "details_skipped": 0, "candidates_new": 0, "candidates_updated": 0, "changes_detected": 0}
    summary = summary_fields(row, page_url)
    existing = await _row(db, "SELECT * FROM crm.tender_candidates WHERE organization_id = :org_id AND source_key = :key AND source_notice_id = :nid FOR UPDATE",
                          {"org_id": org_id, "key": portal.SOURCE_KEY, "nid": row.notice_id})
    base_fields = _combine(existing["fields"] if existing else {}, summary)
    pre_score = score_candidate(effective_fields(base_fields, existing["corrections"] if existing else {}), profile, credentials=credentials)
    matched = is_detail_worthy(pre_score)
    if matched:
        counts["notices_matched"] = 1
    if existing is None and not matched:
        # Not relevant and never seen: record nothing beyond the run counters.
        return counts

    detail: Optional[DetailResult] = None
    detail_status: Optional[str] = None  # None = not attempted this time
    detail_error = None
    needs_detail = matched or (existing is not None and existing.get("tender_id") is not None)
    if needs_detail and fetch_detail:
        counts["details_attempted"] = 1
        detail, detail_status, detail_error = await fetch_detail_page(client, row.notice_id)
        if detail_status == "restricted":
            counts["details_failed"] = 1
            fail("notice_page", portal.detail_url(row.notice_id), detail_error or "restricted")
            counts["restricted"] = 1
        elif detail is None:
            counts["details_failed"] = 1
            fail("notice_page", portal.detail_url(row.notice_id), detail_error or "failed")
        else:
            counts["details_fetched"] = 1
    elif needs_detail:
        counts["details_skipped"] = 1

    saved = await save_candidate_version(
        db, org_id=org_id, run_id=run_id, existing=existing, notice_id=row.notice_id, summary=summary,
        detail=detail, detail_status=detail_status, detail_error=detail_error, profile=profile,
        credentials=credentials, capture_kind="discovery", user_id=None,
    )
    counts["candidates_new" if saved["created"] else "candidates_updated"] = 1
    counts["changes_detected"] = saved["changes"]
    return counts


async def fetch_detail_page(client: portal.PortalClient, notice_id: str) -> tuple[Optional[DetailResult], str, Optional[str]]:
    url = portal.detail_url(notice_id)
    try:
        response = await client.get(url)
    except portal.PortalRestricted as exc:
        return None, "restricted", str(exc)
    except portal.PortalNotFound as exc:
        return None, "unavailable", str(exc)
    except portal.PortalAccessError as exc:
        return None, "failed", str(exc)
    detail = parse_detail_page(response.text, url)
    if detail.has_captcha or detail.is_login_shell:
        return None, "restricted", "Notice page requires login or a CAPTCHA - not bypassed."
    if not detail.structure_found or not detail.fields:
        return None, "unavailable", "Notice page did not contain tender details (it may have been withdrawn)."
    return detail, "fetched", None


def _combine(existing_fields: dict, summary: dict) -> dict:
    """Refresh Bulletin Board values without overwriting values read from
    the notice page itself."""
    combined = dict(existing_fields or {})
    for key, item in summary.items():
        current = combined.get(key)
        if current is None or current.get("section") == "Bulletin Board row":
            combined[key] = item
    return combined


def next_detail_status(existing: Optional[dict], attempt: Optional[str]) -> str:
    """'fetched' / 'unavailable' from this attempt win; a failed or restricted
    attempt never erases an earlier good read; no attempt keeps what was."""
    previous = existing["detail_status"] if existing else "not_fetched"
    if attempt is None:
        return previous
    if attempt in ("fetched", "unavailable"):
        return attempt
    return previous if previous == "fetched" else attempt


async def save_candidate_version(db: AsyncSession, *, org_id: str, run_id: Optional[str], existing: Optional[dict],
                                 notice_id: str, summary: dict, detail: Optional[DetailResult], detail_status: Optional[str],
                                 detail_error: Optional[str], profile: dict, credentials: list[dict],
                                 capture_kind: str, user_id: Optional[str]) -> dict:
    final_status = next_detail_status(existing, detail_status)
    if detail is not None:
        fields, conflicts = merge_fields(summary, detail)
        unresolved = list(detail.unresolved)
        attachments = detail.attachments
    else:
        fields = _combine(existing["fields"] if existing else {}, summary)
        conflicts = list(existing["conflicts"] or []) if existing else []
        unresolved = list(existing["unresolved_questions"] or []) if existing else [
            "Notice page not read yet - only the Bulletin Board row is captured."]
        attachments = []
    corrections = existing["corrections"] if existing else {}
    effective = effective_fields(fields, corrections)
    scored = score_candidate(effective, profile, credentials=credentials)
    documents = await _candidate_documents(db, existing["id"]) if existing else []
    readiness, gaps = assess_readiness(detail_status=final_status, conflicts=conflicts,
                                       missing_evidence=scored["missing_evidence"], documents=documents)
    confidence = "high" if detail is not None and not conflicts else ("medium" if detail is not None else "low")
    if existing and detail is None and final_status == "fetched":
        confidence = existing["extraction_confidence"]
    closing = (effective.get("closing_at") or {}).get("value") or {}
    published = (effective.get("published_at") or {}).get("value") or {}
    digest = content_hash(fields)
    values = {
        "org_id": org_id, "key": portal.SOURCE_KEY, "nid": notice_id, "url": portal.detail_url(notice_id),
        "reference": (effective.get("official_reference") or {}).get("value"),
        "title": (effective.get("title") or {}).get("value"),
        "entity": (effective.get("procuring_entity") or {}).get("value"),
        "status": (effective.get("notice_status") or effective.get("board_status") or {}).get("value"),
        # asyncpg binds timestamptz parameters as datetime objects, not ISO strings.
        "published_at": _dt(published.get("at")), "closing_at": _dt(closing.get("at")),
        "time_specified": closing.get("time_specified") if closing else None,
        "tz": SOURCE_TIMEZONE if closing.get("at") else None,
        "codes": _j((fields.get("category_codes") or {}).get("value") or []),
        "names": _j([(fields.get("required_categories") or {}).get("value")] if fields.get("required_categories") else []),
        "location": (effective.get("project_location") or {}).get("value"),
        "fields": _j(fields), "conflicts": _j(conflicts), "unresolved": _j(unresolved), "confidence": confidence,
        "detail_status": final_status,
        "detail_error": detail_error,
        "score": scored["score"], "band": scored["band"], "reasons": _j(scored["reasons"]), "missing": _j(gaps),
        "readiness": readiness, "hash": digest, "run_id": run_id,
        "checked": detail_status is not None,
    }
    created = existing is None
    row = await _row(
        db,
        """
        INSERT INTO crm.tender_candidates (
            organization_id, source_key, source_notice_id, notice_url, official_reference, title, procuring_entity,
            notice_status, published_at, closing_at, closing_time_specified, source_timezone, category_codes,
            category_names, location_text, fields, conflicts, unresolved_questions, extraction_confidence,
            detail_status, detail_error, relevance_score, relevance_band, match_reasons, missing_evidence, readiness,
            content_hash, first_run_id, last_run_id, last_checked_at
        ) VALUES (
            :org_id, :key, :nid, :url, :reference, :title, :entity, :status, CAST(:published_at AS timestamptz),
            CAST(:closing_at AS timestamptz), :time_specified, :tz, CAST(:codes AS jsonb), CAST(:names AS jsonb), :location,
            CAST(:fields AS jsonb), CAST(:conflicts AS jsonb), CAST(:unresolved AS jsonb), :confidence, :detail_status,
            :detail_error, :score, :band, CAST(:reasons AS jsonb), CAST(:missing AS jsonb), :readiness, :hash,
            :run_id, :run_id, CASE WHEN :checked THEN NOW() ELSE NULL END
        )
        ON CONFLICT (organization_id, source_key, source_notice_id) DO UPDATE SET
            official_reference = EXCLUDED.official_reference, title = EXCLUDED.title,
            procuring_entity = EXCLUDED.procuring_entity, notice_status = EXCLUDED.notice_status,
            published_at = EXCLUDED.published_at, closing_at = EXCLUDED.closing_at,
            closing_time_specified = EXCLUDED.closing_time_specified, source_timezone = EXCLUDED.source_timezone,
            category_codes = EXCLUDED.category_codes, category_names = EXCLUDED.category_names,
            location_text = EXCLUDED.location_text, fields = EXCLUDED.fields, conflicts = EXCLUDED.conflicts,
            unresolved_questions = EXCLUDED.unresolved_questions, extraction_confidence = EXCLUDED.extraction_confidence,
            detail_status = EXCLUDED.detail_status, detail_error = EXCLUDED.detail_error,
            relevance_score = EXCLUDED.relevance_score, relevance_band = EXCLUDED.relevance_band,
            match_reasons = EXCLUDED.match_reasons, missing_evidence = EXCLUDED.missing_evidence,
            readiness = EXCLUDED.readiness, content_hash = EXCLUDED.content_hash,
            last_run_id = COALESCE(EXCLUDED.last_run_id, crm.tender_candidates.last_run_id),
            last_seen_at = NOW(),
            last_checked_at = COALESCE(EXCLUDED.last_checked_at, crm.tender_candidates.last_checked_at),
            updated_at = NOW()
        RETURNING id, tender_id, responsible_user_id
        """,
        values,
    )
    candidate_id = str(row["id"])
    for attachment in attachments:
        await db.execute(
            text("""
                INSERT INTO crm.tender_candidate_documents (organization_id, candidate_id, tender_id, label, official_url, access)
                VALUES (:org_id, :cid, :tid, :label, :url, :access)
                ON CONFLICT (candidate_id, official_url) WHERE official_url IS NOT NULL DO UPDATE SET updated_at = NOW()
            """),
            {"org_id": org_id, "cid": candidate_id, "tid": row["tender_id"], "label": attachment["label"],
             "url": attachment["official_url"], "access": attachment["access"]},
        )

    changes = 0
    if detail is not None or detail_status == "unavailable":
        changes = await _record_version(db, org_id=org_id, candidate_id=candidate_id, tender_id=row["tender_id"],
                                        responsible_user_id=row["responsible_user_id"], run_id=run_id, fields=fields,
                                        digest=digest, source_text=detail.source_text if detail else None,
                                        capture_kind=capture_kind, user_id=user_id,
                                        unavailable=detail is None and detail_status == "unavailable" and not created)
    return {"candidate_id": candidate_id, "created": created, "changes": changes}


async def _candidate_documents(db: AsyncSession, candidate_id: Any) -> list[dict]:
    return await _rows(
        db,
        """
        SELECT cd.id, cd.access, cd.document_id, fa.extraction_status
        FROM crm.tender_candidate_documents cd
        LEFT JOIN core.documents d ON d.id = cd.document_id AND d.is_deleted = false
        LEFT JOIN core.file_attachments fa ON fa.id = d.file_attachment_id AND fa.is_deleted = false
        WHERE cd.candidate_id = :cid
        """,
        {"cid": candidate_id},
    )


def _comparable(key: str, item: Optional[dict]) -> Any:
    if not item:
        return None
    value = item.get("value")
    if isinstance(value, dict) and "at" in value:
        return value.get("at") or value.get("date")
    if isinstance(value, dict) and "path" in value:
        return value.get("path")
    return value


async def _record_version(db: AsyncSession, *, org_id: str, candidate_id: str, tender_id: Any, responsible_user_id: Any,
                          run_id: Optional[str], fields: dict, digest: str, source_text: Optional[str],
                          capture_kind: str, user_id: Optional[str], unavailable: bool) -> int:
    previous = await _row(
        db,
        "SELECT id, fields, content_hash FROM crm.tender_source_snapshots WHERE candidate_id = :cid ORDER BY captured_at DESC LIMIT 1",
        {"cid": candidate_id},
    )
    if unavailable:
        if previous is None:
            return 0
        digest = f"unavailable:{previous['content_hash'][:48]}"
    if previous and previous["content_hash"] == digest:
        return 0
    snapshot = await _row(
        db,
        """
        INSERT INTO crm.tender_source_snapshots (organization_id, candidate_id, run_id, captured_by, capture_kind, content_hash, fields, source_text)
        VALUES (:org_id, :cid, :run_id, :user_id, :kind, :hash, CAST(:fields AS jsonb), :source_text)
        ON CONFLICT (candidate_id, content_hash) DO NOTHING
        RETURNING id
        """,
        {"org_id": org_id, "cid": candidate_id, "run_id": run_id, "user_id": user_id, "kind": capture_kind,
         "hash": digest, "fields": _j({} if unavailable else fields), "source_text": source_text},
    )
    if previous is None or snapshot is None:
        return 0

    diffs: list[tuple[str, str, bool, Any, Any, Any, Any]] = []
    old_fields = previous["fields"] or {}
    if unavailable:
        diffs.append(("notice_page", "withdrawn_or_unavailable", True, "available", "unavailable", None,
                      {"note": "The notice page no longer returned tender details. It may be withdrawn or cancelled - verify on the portal; AEGIS has not assumed either."}))
    else:
        for key, (kind, material) in TRACKED_FIELDS.items():
            old, new = _comparable(key, old_fields.get(key)), _comparable(key, fields.get(key))
            if old != new and not (old is None and new is None):
                if kind == "status_changed" and isinstance(new, str) and any(w in new.lower() for w in ("cancel", "withdraw", "suspend", "terminat")):
                    kind = "withdrawn_or_unavailable"
                diffs.append((key, kind, material, old, new, old_fields.get(key), fields.get(key)))

    created = 0
    for key, kind, material, old, new, old_ev, new_ev in diffs:
        result = await db.execute(
            text("""
                INSERT INTO crm.tender_source_changes (
                    organization_id, candidate_id, tender_id, from_snapshot_id, to_snapshot_id, field_key, change_kind,
                    is_material, old_value, new_value, old_evidence, new_evidence
                ) VALUES (
                    :org_id, :cid, :tid, :from_id, :to_id, :field, :kind, :material, CAST(:old AS jsonb), CAST(:new AS jsonb),
                    CAST(:old_ev AS jsonb), CAST(:new_ev AS jsonb)
                ) ON CONFLICT (candidate_id, to_snapshot_id, field_key) DO NOTHING
                RETURNING id
            """),
            {"org_id": org_id, "cid": candidate_id, "tid": tender_id, "from_id": previous["id"], "to_id": snapshot["id"],
             "field": key, "kind": kind, "material": material, "old": _j(old), "new": _j(new), "old_ev": _j(old_ev),
             "new_ev": _j(new_ev)},
        )
        if result.first():
            created += 1

    material_kinds = sorted({kind for _, kind, material, *_ in diffs if material})
    if created and tender_id and material_kinds:
        recipient = responsible_user_id or (await db.execute(
            text("SELECT COALESCE(assigned_to_user_id, imported_by, created_by) FROM crm.tenders WHERE id = :id"), {"id": tender_id})).scalar()
        if recipient:
            await emit_notification(
                db, org_id=org_id, user_id=str(recipient),
                title="e-GP notice changed",
                message="The official notice for an imported tender changed: " + ", ".join(k.replace("_", " ") for k in material_kinds)
                        + ". Review the change before it is applied.",
                notification_type="tender", priority="high",
                action_url=f"/dashboard/crm/tenders/discovery?candidate={candidate_id}&tab=changes",
                metadata={"candidate_id": candidate_id, "tender_id": str(tender_id), "kinds": material_kinds},
            )
    return created
