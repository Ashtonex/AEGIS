"""Transparent relevance scoring and bid-readiness for staged e-GP notices.

Relevance (strong / possible / weak) says how well a notice fits the work
SNC wants; it is NOT a statement that SNC is eligible. Readiness
(unverified / requirements_missing / ready_for_internal_decision) is kept
separate and only moves forward on evidence actually held in AEGIS:
fetched notice details, official documents whose text was extracted, and
corporate credentials configured in the vault. Nothing here assumes SNC
holds a registration, capacity, equipment or experience.

Every point added or removed is returned as a reason, so the reviewer sees
exactly why a notice scored what it did.
"""

from __future__ import annotations

import re
from datetime import date, datetime, timezone
from typing import Any, Iterable, Optional

from app.services.tenders.egp.parser import HARARE

DEFAULT_PROFILE_NAME = "SNC Civil Works"

# Official e-GP supplier category names as listed on the Bulletin Board's
# "Required Supplier Category Name" filter (checked 2026-10-26). Only SC006
# was seen with its code; the rest match by name.
DEFAULT_PROFILE: dict[str, Any] = {
    "name": DEFAULT_PROFILE_NAME,
    "description": (
        "Roads, concrete, drainage and structures, earthworks and civil infrastructure, with "
        "relevant building works; ready-mix and plant hire only where the notice explicitly asks. "
        "Mutare / Manicaland preferred; nationwide notices are kept for review."
    ),
    "work_types": [
        {"key": "roads", "label": "Road construction, rehabilitation, resurfacing and maintenance", "weight": 35,
         # Bare "road" is deliberately absent: it matches street addresses
         # ("... Coventry Road") and road-marking equipment supply.
         "terms": ["road construction", "construction of road", "road rehabilitation", "rehabilitation of road",
                   "resurfacing", "resealing", "reseal", "regravelling", "regravellimg", "re-gravelling", "gravelling",
                   "gravel works", "tarring", "surfacing", "road maintenance", "pothole", "patching", "asphalt",
                   "bitumen", "paving", "road works", "roads"]},
        {"key": "concrete", "label": "Concrete works and concrete repairs", "weight": 25,
         "terms": ["concrete", "reinforced concrete", "concrete repair", "slab", "precast"]},
        {"key": "drainage_structures", "label": "Drainage, culverts, stormwater, bridges and structures", "weight": 30,
         "terms": ["drainage", "culvert", "stormwater", "storm water", "bridge", "drift", "kerb", "kerbing",
                   "side drains", "channel lining", "headwall"]},
        {"key": "earthworks", "label": "Earthworks and site preparation", "weight": 25,
         "terms": ["earthworks", "earth works", "site preparation", "site clearance", "excavation",
                   "bulk earthworks", "levelling", "grading", "stands servicing", "servicing of stands"]},
        {"key": "civil_infrastructure", "label": "Civil infrastructure", "weight": 25,
         "terms": ["civil works", "civil engineering", "infrastructure", "water reticulation", "sewer reticulation",
                   "sewer", "reticulation", "dam construction", "weir"]},
        {"key": "building", "label": "Relevant building works", "weight": 12,
         "terms": ["building works", "construction of a", "classroom block", "refurbishment", "renovation",
                   "extension of", "roof repairs"]},
        {"key": "ready_mix", "label": "Ready-mix supply (explicit only)", "weight": 15,
         "terms": ["ready mix", "ready-mix", "readymix", "supply of concrete", "premixed concrete"]},
        {"key": "plant_hire", "label": "Plant hire (explicit only)", "weight": 15,
         "terms": ["plant hire", "hire of plant", "equipment hire", "hire of construction equipment", "hire of grader",
                   "hire of excavator", "tipper hire", "hire of tipper", "hire of tlb"]},
    ],
    "category_terms": [
        {"term": "Construction and Civil Works", "code": "SC006", "weight": 30},
        {"term": "Road Maintenance Services", "code": None, "weight": 25},
        {"term": "Water And Sewer Engineering and Utilities", "code": None, "weight": 15},
        {"term": "Hire of Construction Equipment", "code": None, "weight": 12},
        {"term": "Building and Roof Repairs & Maintenance Services", "code": None, "weight": 10},
        {"term": "Construction Materials", "code": None, "weight": 5},
        {"term": "Mechanical and Structural Engineering", "code": "SM003", "weight": 5},
    ],
    "category_codes": ["SC006"],
    "preferred_locations": ["Mutare", "Manicaland", "Sakubva", "Dangamvura", "Chikanga", "Penhalonga", "Odzi",
                            "Rusape", "Makoni", "Nyanga", "Mutasa", "Chipinge", "Chimanimani", "Buhera",
                            "Birchenough", "Hauna", "Headlands", "Nyazura", "Chisumbanje"],
    "nearby_locations": ["Marondera", "Mashonaland East", "Hwedza", "Wedza", "Murehwa", "Mutoko", "Masvingo",
                         "Bikita", "Zaka", "Gutu", "Chiredzi"],
    "exclude_terms": [
        {"term": "consultant", "penalty": 20}, {"term": "consultancy", "penalty": 20},
        {"term": "feasibility study", "penalty": 15}, {"term": "supervision services", "penalty": 15},
        {"term": "road marking machine", "penalty": 25}, {"term": "supply and delivery of", "penalty": 10},
        {"term": "software", "penalty": 25}, {"term": "stationery", "penalty": 25},
        {"term": "uniforms", "penalty": 25}, {"term": "transformer", "penalty": 15},
    ],
    "default_filters": {"board": "live"},
    "scoring": {"strong_at": 55, "possible_at": 30, "preferred_location_points": 20, "nearby_location_points": 10,
                "extra_work_type_points": 5, "extra_work_type_cap": 10, "max_exclusion_penalty": 40,
                "credential_points": 10},
}


def _norm(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, (list, tuple)):
        return " ".join(_norm(v) for v in value)
    if isinstance(value, dict):
        return " ".join(_norm(v) for v in value.values())
    return re.sub(r"\s+", " ", str(value)).strip().casefold()


def _contains(haystack: str, term: str) -> bool:
    term = _norm(term)
    if not term:
        return False
    # Whole words/phrases only, allowing a plural "s" ("machine" -> "machines").
    return re.search(rf"(?<![a-z0-9]){re.escape(term)}s?(?![a-z0-9])", haystack) is not None


def _field_value(fields: dict, key: str) -> Any:
    item = fields.get(key)
    return item.get("value") if isinstance(item, dict) else None


def effective_fields(fields: dict, corrections: Optional[dict]) -> dict:
    """Reviewer corrections override source values for scoring and import;
    the source values themselves are never overwritten."""
    merged = dict(fields or {})
    for key, correction in (corrections or {}).items():
        if isinstance(correction, dict) and "value" in correction:
            merged[key] = {**(merged.get(key) or {}), "value": correction["value"], "corrected": True,
                           "corrected_by": correction.get("by"), "corrected_at": correction.get("at")}
    return merged


def closing_datetime(fields: dict) -> Optional[datetime]:
    value = _field_value(fields, "closing_at")
    if isinstance(value, dict) and value.get("at"):
        try:
            return datetime.fromisoformat(value["at"])
        except ValueError:
            return None
    return None


def score_candidate(
    fields: dict,
    profile: dict,
    *,
    credentials: Iterable[dict] = (),
    now: Optional[datetime] = None,
) -> dict:
    now = now or datetime.now(timezone.utc)
    scoring = {**DEFAULT_PROFILE["scoring"], **(profile.get("scoring") or {})}
    reasons: list[dict] = []
    missing: list[str] = []
    score = 0

    work_text = _norm([_field_value(fields, k) for k in ("title", "project_name", "description")] +
                      [_field_value(fields, "line_items")])
    category_text = _norm(_field_value(fields, "required_categories"))
    codes = {c.strip().upper() for c in (_field_value(fields, "category_codes") or []) if isinstance(c, str)}

    # Work type
    matched_types: list[tuple[int, str, list[str]]] = []
    for work_type in profile.get("work_types") or []:
        hits = [t for t in work_type.get("terms") or [] if _contains(work_text, t)]
        if hits:
            matched_types.append((int(work_type.get("weight") or 0), work_type.get("label") or work_type.get("key"), hits[:4]))
    matched_types.sort(key=lambda item: item[0], reverse=True)
    if matched_types:
        weight, label, hits = matched_types[0]
        score += weight
        reasons.append({"factor": "work_type", "points": weight, "detail": f"{label}: notice mentions {', '.join(repr(h) for h in hits)}"})
        extra = min(scoring["extra_work_type_cap"], scoring["extra_work_type_points"] * (len(matched_types) - 1))
        if extra:
            score += extra
            reasons.append({"factor": "work_type", "points": extra, "detail": "Also matches: " + "; ".join(t[1] for t in matched_types[1:])})
    else:
        reasons.append({"factor": "work_type", "points": 0, "detail": "No configured work-type term found in the title, description or line items."})

    # Official procurement category
    best_category: Optional[tuple[int, str]] = None
    for category in profile.get("category_terms") or []:
        code = (category.get("code") or "").upper()
        if _contains(category_text, category.get("term")) or (code and code in codes):
            weight = int(category.get("weight") or 0)
            if best_category is None or weight > best_category[0]:
                best_category = (weight, category.get("term"))
    if best_category:
        score += best_category[0]
        reasons.append({"factor": "category", "points": best_category[0], "detail": f"Required supplier category includes '{best_category[1]}'"})
    elif category_text or codes:
        reasons.append({"factor": "category", "points": 0, "detail": "Required supplier categories are outside the profile's categories."})
    else:
        missing.append("Required supplier category not captured.")

    # Exclusions
    penalty = 0
    for exclusion in profile.get("exclude_terms") or []:
        term = exclusion.get("term")
        if _contains(work_text, term):
            penalty += int(exclusion.get("penalty") or 0)
            reasons.append({"factor": "exclusion", "points": -int(exclusion.get("penalty") or 0), "detail": f"Notice mentions '{term}'"})
    penalty = min(penalty, scoring["max_exclusion_penalty"])
    score -= penalty

    # Location
    location_sources = [
        ("project location", _norm(_field_value(fields, "project_location"))),
        ("title, description or line items", work_text),
        ("procuring entity", _norm(_field_value(fields, "procuring_entity"))),
        ("entity address (may differ from the project site)", _norm(_field_value(fields, "entity_address"))),
    ]
    location_hit: Optional[tuple[int, str, str]] = None
    for points_key, places in (("preferred_location_points", profile.get("preferred_locations")),
                               ("nearby_location_points", profile.get("nearby_locations"))):
        for source_label, text_value in location_sources:
            hit = next((p for p in places or [] if _contains(text_value, p)), None)
            if hit:
                location_hit = (int(scoring[points_key]), hit, source_label)
                break
        if location_hit:
            break
    if location_hit:
        score += location_hit[0]
        reasons.append({"factor": "location", "points": location_hit[0], "detail": f"'{location_hit[1]}' in {location_hit[2]}"})
    elif not _field_value(fields, "project_location"):
        missing.append("Project location not stated on the captured notice.")
        reasons.append({"factor": "location", "points": 0, "detail": "Location unknown - kept for nationwide review."})
    else:
        reasons.append({"factor": "location", "points": 0, "detail": "Outside the preferred area - kept for nationwide review."})

    # Time remaining
    closing = closing_datetime(fields)
    closed = False
    if closing is None:
        missing.append("Closing date/time not confirmed.")
        reasons.append({"factor": "time", "points": 0, "detail": "Closing date/time unknown."})
    else:
        days = (closing - now).total_seconds() / 86400
        if days < 0:
            closed = True
            score -= 100
            reasons.append({"factor": "time", "points": -100, "detail": f"Closed on {closing.astimezone(HARARE):%d %b %Y %H:%M} (Africa/Harare)."})
        else:
            points = -15 if days < 3 else -5 if days < 7 else 5 if days < 21 else 10
            score += points
            reasons.append({"factor": "time", "points": points, "detail": f"{days:.1f} days to closing ({closing.astimezone(HARARE):%d %b %Y %H:%M} Africa/Harare)."})

    # Eligibility evidence actually held in AEGIS
    credential_list = list(credentials)
    if not credential_list:
        missing.append("No SNC registrations/credentials are configured in AEGIS - eligibility cannot be assessed.")
        reasons.append({"factor": "eligibility", "points": 0, "detail": "No configured SNC credentials to compare with the required categories."})
    else:
        matched = [c for c in credential_list if c.get("category") and _contains(category_text, c["category"])]
        if matched:
            points = int(scoring["credential_points"])
            score += points
            reasons.append({"factor": "eligibility", "points": points,
                            "detail": "Configured credential category matches: " + ", ".join(f"{c.get('credential_type')} {c.get('category')}" for c in matched[:3]) + " (verify validity before bidding)."})
        else:
            missing.append("No configured SNC credential matches the required supplier categories.")
            reasons.append({"factor": "eligibility", "points": 0, "detail": "Configured credentials do not match the required categories."})

    score = max(-100, min(100, score))
    if closed or (not matched_types and not best_category):
        band = "weak"
    elif score >= scoring["strong_at"]:
        band = "strong"
    elif score >= scoring["possible_at"]:
        band = "possible"
    else:
        band = "weak"
    return {"score": score, "band": band, "reasons": reasons, "missing_evidence": missing, "closed": closed}


def assess_readiness(
    *,
    detail_status: str,
    conflicts: list,
    missing_evidence: list[str],
    documents: Iterable[dict] = (),
) -> tuple[str, list[str]]:
    """unverified -> requirements_missing -> ready_for_internal_decision.
    Ready only when the notice was read in full, an official document was
    actually read (text extracted), there are no open conflicts and no
    evidence gaps. A failed or empty extraction never counts as reviewed."""
    gaps: list[str] = []
    if detail_status != "fetched":
        return "unverified", ["Notice detail page has not been read successfully."]
    reviewed = [d for d in documents if d.get("extraction_status") == "extracted"]
    if not reviewed:
        gaps.append("No official tender document has been obtained and read (documents need an e-GP login).")
    if conflicts:
        gaps.append(f"{len(conflicts)} conflicting value(s) between source pages need review.")
    gaps.extend(missing_evidence)
    return ("requirements_missing" if gaps else "ready_for_internal_decision"), gaps


def is_detail_worthy(score: dict) -> bool:
    return not score["closed"] and score["band"] in ("strong", "possible")


def today_harare() -> date:
    return datetime.now(HARARE).date()
