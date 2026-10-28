"""Fixture tests for e-GP parsing, scoring and the portal client (no network, no DB)."""

from __future__ import annotations

import asyncio
from dataclasses import replace
from datetime import datetime, timezone

import httpx
import pytest

from app.services.tenders.egp import portal
from app.services.tenders.egp.matching import DEFAULT_PROFILE, assess_readiness, score_candidate
from app.services.tenders.egp.parser import (
    content_hash,
    merge_fields,
    parse_bulletin_page,
    parse_detail_page,
    summary_fields,
)
from tests.egp_fixtures import (
    CONSULTANCY,
    CULVERT_NYANGA,
    ROAD_MUTARE,
    STATIONERY,
    bulletin_page,
    captcha_page,
    login_shell,
    notice_page,
)

NOW = datetime(2026, 10, 26, 12, 0, tzinfo=timezone.utc)
LIST_URL = "https://egp.praz.org.zw/Indexes/index"


def _fields(notice):
    page = parse_bulletin_page(bulletin_page([notice]), LIST_URL)
    detail = parse_detail_page(notice_page(notice), portal.detail_url(notice.notice_id))
    return merge_fields(summary_fields(page.rows[0], LIST_URL), detail)


# --- Bulletin Board ---------------------------------------------------------

def test_bulletin_rows_pagination_and_column_order():
    page = parse_bulletin_page(bulletin_page([ROAD_MUTARE, STATIONERY], page=1, pages=3, total=45), LIST_URL)
    assert page.table_found and not page.is_login_shell
    assert (page.page, page.pages_total, page.records_total, page.has_next) == (1, 3, 45, True)
    row = page.rows[0]
    # The portal's data-label attributes are off by one; parsing is by header order.
    assert row.reference == "MCC/RD/01/2026"
    assert row.title.startswith("REHABILITATION OF SAKUBVA")
    assert row.category_codes == ["SC006"] and row.status == "Open"


def test_last_page_and_unpaginated_search_results():
    last = parse_bulletin_page(bulletin_page([ROAD_MUTARE], page=3, pages=3, total=45), LIST_URL)
    assert last.has_next is False
    search = parse_bulletin_page(bulletin_page([ROAD_MUTARE], summary=False), LIST_URL)
    assert search.pages_total is None and search.has_next is False and len(search.rows) == 1


def test_empty_board_is_a_table_with_no_rows_not_a_failure():
    page = parse_bulletin_page(bulletin_page([], total=0), LIST_URL)
    assert page.table_found and page.rows == [] and page.records_total == 0


def test_login_shell_and_captcha_are_detected_not_parsed():
    shell = parse_bulletin_page(login_shell(), LIST_URL)
    assert not shell.table_found and shell.is_login_shell
    assert parse_bulletin_page(captcha_page(), LIST_URL).has_captcha
    detail = parse_detail_page(login_shell(), "u")
    assert not detail.structure_found and detail.is_login_shell


def test_malformed_row_is_reported():
    html = bulletin_page([ROAD_MUTARE]).replace("</table>", "<tr><td>broken</td><td>row</td></tr></table>")
    page = parse_bulletin_page(html, LIST_URL)
    assert len(page.rows) == 1 and len(page.row_errors) == 1


# --- Notice page -------------------------------------------------------------

def test_notice_fields_have_provenance_and_harare_times():
    detail = parse_detail_page(notice_page(ROAD_MUTARE), portal.detail_url("900001"))
    closing = detail.fields["closing_at"]
    assert closing["value"] == {"at": "2026-11-20T10:00:00+02:00", "date": "2026-11-20", "time_specified": True,
                                "timezone": "Africa/Harare"}
    assert closing["raw"] == "20-Nov-2026 10:00 AM"
    assert closing["source_url"].endswith("/Indexes/viewLiveTenderDetails/900001")
    assert "Closing Date" in closing["excerpt"] and closing["extracted_at"]
    assert detail.value("procurement_method") == "Open Domestic Bidding"
    assert detail.value("addenda_count") == 0 and detail.value("bid_validity_days") == 90
    assert detail.value("project_location") == "Sakubva, Mutare"
    assert detail.attachments[0]["access"] == "login_required"


def test_commented_out_and_hidden_values_are_never_extracted():
    detail = parse_detail_page(notice_page(ROAD_MUTARE), "u")
    assert "estimated_value" not in detail.fields  # "Approved Budget" is commented out in the markup
    assert all("999999" not in str(v["value"]) for v in detail.fields.values())
    assert all("Hidden Person" not in str(v["value"]) for v in detail.fields.values())
    assert any("Estimated value" in q for q in detail.unresolved)
    assert any("site visit" in q.lower() for q in detail.unresolved)


def test_missing_and_untimed_closing_dates_stay_explicit():
    no_closing = parse_detail_page(notice_page(replace(ROAD_MUTARE, detail_closing="")), "u")
    assert "closing_at" not in no_closing.fields
    assert any("Closing date not found" in q for q in no_closing.unresolved)
    untimed = parse_detail_page(notice_page(replace(ROAD_MUTARE, detail_closing="20-Nov-2026")), "u")
    value = untimed.fields["closing_at"]["value"]
    assert value["at"] is None and value["date"] == "2026-11-20" and value["time_specified"] is False
    assert any("do not assume" in q.lower() for q in untimed.unresolved)


def test_conflicting_list_and_notice_values_are_both_kept():
    notice = replace(ROAD_MUTARE, detail_closing="27-Nov-2026 10:00 AM")
    fields, conflicts = _fields(notice)
    assert len(conflicts) == 1 and conflicts[0]["field"] == "closing_at"
    sources = {v["source"]: v["raw"] for v in conflicts[0]["values"]}
    assert sources == {"bulletin_board": "20-Nov-2026 10:00 AM", "notice_page": "27-Nov-2026 10:00 AM"}
    assert fields["board_status"]["value"] == "Open" and fields["notice_status"]["value"] == "Published"


def test_content_hash_ignores_download_counter_only():
    a, _ = _fields(ROAD_MUTARE)
    b, _ = _fields(replace(ROAD_MUTARE, downloads="999"))
    c, _ = _fields(replace(ROAD_MUTARE, addenda="1"))
    assert content_hash(a) == content_hash(b) != content_hash(c)


# --- Scoring and readiness ---------------------------------------------------

def test_mutare_road_works_score_strong_with_reasons():
    fields, _ = _fields(ROAD_MUTARE)
    result = score_candidate(fields, DEFAULT_PROFILE, now=NOW)
    assert result["band"] == "strong"
    factors = {r["factor"] for r in result["reasons"] if r["points"] > 0}
    assert {"work_type", "category", "location", "time"} <= factors


def test_nearby_manicaland_culvert_and_irrelevant_goods():
    assert score_candidate(_fields(CULVERT_NYANGA)[0], DEFAULT_PROFILE, now=NOW)["band"] == "strong"
    assert score_candidate(_fields(STATIONERY)[0], DEFAULT_PROFILE, now=NOW)["band"] == "weak"
    consult = score_candidate(_fields(CONSULTANCY)[0], DEFAULT_PROFILE, now=NOW)
    assert any(r["factor"] == "exclusion" for r in consult["reasons"])
    assert consult["band"] != "strong"


def test_closed_notice_is_weak_and_says_why():
    fields, _ = _fields(replace(ROAD_MUTARE, closing="01-Oct-2026 10:00 AM", detail_closing="01-Oct-2026 10:00 AM"))
    result = score_candidate(fields, DEFAULT_PROFILE, now=NOW)
    assert result["closed"] and result["band"] == "weak"


def test_keyword_match_never_implies_eligibility():
    fields, _ = _fields(ROAD_MUTARE)
    result = score_candidate(fields, DEFAULT_PROFILE, credentials=[], now=NOW)
    assert any("No SNC registrations" in m for m in result["missing_evidence"])
    eligibility = [r for r in result["reasons"] if r["factor"] == "eligibility"]
    assert eligibility and eligibility[0]["points"] == 0
    readiness, gaps = assess_readiness(detail_status="fetched", conflicts=[], missing_evidence=result["missing_evidence"],
                                       documents=[])
    assert readiness == "requirements_missing" and gaps


def test_readiness_ladder_and_failed_extraction_is_not_review():
    assert assess_readiness(detail_status="not_fetched", conflicts=[], missing_evidence=[])[0] == "unverified"
    failed = [{"extraction_status": "failed"}, {"extraction_status": "no_text_found"}]
    assert assess_readiness(detail_status="fetched", conflicts=[], missing_evidence=[], documents=failed)[0] == "requirements_missing"
    read = [{"extraction_status": "extracted"}]
    assert assess_readiness(detail_status="fetched", conflicts=[], missing_evidence=[], documents=read)[0] == "ready_for_internal_decision"


# --- Portal client -------------------------------------------------------------

def _client(handler, sleeps=None):
    async def sleeper(seconds):
        if sleeps is not None:
            sleeps.append(seconds)

    return portal.PortalClient(min_interval=3.0, transport=httpx.MockTransport(handler), sleeper=sleeper)


def test_only_the_official_portal_is_fetched():
    assert portal.is_allowed_url("https://egp.praz.org.zw/Indexes/index")
    for bad in ("http://egp.praz.org.zw/Indexes/index", "https://evil.example/Indexes/index",
                "https://user:pw@egp.praz.org.zw/", "https://egp.praz.org.zw.evil.example/"):
        assert not portal.is_allowed_url(bad)
    with pytest.raises(ValueError):
        portal.detail_url("1/../../x")

    async def run():
        async with _client(lambda r: httpx.Response(200, text="x")) as client:
            with pytest.raises(portal.PortalRestricted):
                await client.get("https://evil.example/")

    asyncio.run(run())


def test_rate_limit_is_never_retried_and_server_errors_are_bounded():
    calls = {"n": 0}

    def too_many(request):
        calls["n"] += 1
        return httpx.Response(429)

    async def run_429():
        async with _client(too_many) as client:
            with pytest.raises(portal.PortalRestricted):
                await client.get(portal.bulletin_url(1))

    asyncio.run(run_429())
    assert calls["n"] == 1

    calls["n"] = 0

    def broken(request):
        calls["n"] += 1
        return httpx.Response(503)

    sleeps: list[float] = []

    async def run_503():
        async with _client(broken, sleeps) as client:
            with pytest.raises(portal.PortalUnavailable):
                await client.get(portal.bulletin_url(1))

    asyncio.run(run_503())
    assert calls["n"] == 3 and len(sleeps) >= 2


def test_requests_are_paced_and_login_redirect_is_restricted():
    sleeps: list[float] = []

    async def run():
        async with _client(lambda r: httpx.Response(200, text="ok"), sleeps) as client:
            await client.get(portal.bulletin_url(1))
            await client.get(portal.bulletin_url(2))
        async with _client(lambda r: httpx.Response(302, headers={"location": "/Indexes/login"})) as client:
            with pytest.raises(portal.PortalRestricted):
                await client.get(portal.bulletin_url(1))

    asyncio.run(run())
    assert sleeps and sleeps[0] > 2.5


def test_filters_map_to_the_portal_search_form():
    url = portal.bulletin_url(2, {"title": "road", "closing_from": "01-Nov-2026", "closing_to": "30-Nov-2026", "procuring_entity_id": "207"})
    assert "searchNoticeTitle=road" in url and "searchDept=207" in url and "page=2" in url
    assert "searchClosingDateFrom=01-Nov-2026" in url


def test_portal_clock_offset_matches_harare():
    assert portal.server_clock_offset_minutes("2026/10/26 14:10:28", "Mon, 26 Oct 2026 12:10:30 GMT") == 120
