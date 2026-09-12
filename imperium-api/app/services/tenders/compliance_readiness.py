"""Compliance-only readiness score for one tender's requirements matrix.

This is deliberately NOT the full 7-dimension readiness engine from the
target Tender Intelligence spec (administrative / technical / plant /
financial / commercial / submission readiness) - none of those dimensions
have a data model yet. Every surface that renders this output (API
response keys, UI labels) must call it "compliance readiness", never
"overall readiness", to avoid implying a bigger engine exists.

Hard rule, never relaxed: any open (unresolved) FATAL requirement forces
``status`` to RED regardless of the computed percentage - a 99% score
with one missing bid security is still RED, not AMBER.
"""

from __future__ import annotations

from typing import Optional

CLOSED_STATUSES = {"SATISFIED", "PRESENT", "NOT_APPLICABLE"}
OPEN_STATUSES = {
    "MISSING",
    "EXPIRED",
    "EXPIRING",
    "WRONG_CATEGORY",
    "WRONG_CLASSIFICATION",
    "UNVERIFIED",
    "PENDING",
}


def compute_compliance_readiness(requirements: list[dict]) -> dict:
    applicable = [r for r in requirements if r.get("status") != "NOT_APPLICABLE"]
    applicable_count = len(applicable)
    satisfied_count = sum(1 for r in applicable if r.get("status") in ("SATISFIED", "PRESENT"))

    fatal_open = sum(
        1 for r in applicable if r.get("severity") == "FATAL" and r.get("status") in OPEN_STATUSES
    )
    critical_open = sum(
        1 for r in applicable if r.get("severity") == "CRITICAL" and r.get("status") in OPEN_STATUSES
    )
    missing = sum(1 for r in applicable if r.get("status") == "MISSING")
    expired = sum(1 for r in applicable if r.get("status") == "EXPIRED")
    expiring = sum(1 for r in applicable if r.get("status") == "EXPIRING")
    unverified = sum(1 for r in applicable if r.get("status") == "UNVERIFIED")

    percent: Optional[float] = None
    if applicable_count > 0:
        percent = round(100.0 * satisfied_count / applicable_count, 1)

    # Never invent a number when there is nothing to compute against.
    if fatal_open > 0:
        overall_status = "RED"
    elif percent is None:
        overall_status = "GREY"
    elif critical_open > 0 or percent < 100:
        overall_status = "AMBER"
    else:
        overall_status = "GREEN"

    # Compliance-only signal - not the multi-gate Bid/No-Bid decision from
    # the target spec's Gate 1-3 + MD approval flow, which needs
    # technical/financial/commercial data this phase doesn't collect.
    if fatal_open > 0:
        bid_gate_signal = "HOLD"
    elif critical_open > 0 or unverified > 0:
        bid_gate_signal = "REVIEW"
    else:
        bid_gate_signal = "BID"

    return {
        "applicable_count": applicable_count,
        "satisfied_count": satisfied_count,
        "percent": percent,
        "fatal_open": fatal_open,
        "critical_open": critical_open,
        "missing": missing,
        "expired": expired,
        "expiring": expiring,
        "unverified": unverified,
        "status": overall_status,
        "bid_gate_signal": bid_gate_signal,
    }
