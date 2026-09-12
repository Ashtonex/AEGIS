"""Matches a tender compliance-matrix row against the Corporate Credentials
Vault (compliance.corporate_credentials, migration 198).

Deliberately never treats PRAZ / CIFOZ / ZBCA (or any other credential
type) as interchangeable - a candidate credential only counts if its
``credential_type`` is in the accepted-types list for the requirement.
Never treats an expired credential as valid even if it is still flagged
'valid' today - validity is always recomputed against the tender's own
submission_deadline.

Pure functions (no DB access) so they can be unit-tested directly - the
caller (routers/tender_bids.py) is responsible for loading the
requirement/tender/candidate rows and persisting the result.
"""

from __future__ import annotations

from datetime import date
from typing import Any, Iterable, Optional

EXPIRING_SOON_DAYS = 30


def _parse_date(value: Any) -> Optional[date]:
    if value is None:
        return None
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value)[:10])


def match_requirement_to_credential(
    requirement: dict,
    tender: dict,
    candidate_credentials: Iterable[dict],
    *,
    acceptable_credential_types: Optional[list[str]] = None,
) -> dict:
    """Returns the fields to persist back onto the crm.tender_requirements
    row: credential_id, valid_through_closing, correct_category,
    correct_classification, status.

    ``candidate_credentials`` must already be scoped to the tender's
    organization. ``acceptable_credential_types`` lets a caller express an
    explicit OR-list (e.g. "CIFOZ OR ZBCA satisfies this requirement");
    when omitted, only the requirement's own
    ``maps_to_credential_type`` is accepted.
    """
    accepted_types = acceptable_credential_types or (
        [requirement["maps_to_credential_type"]] if requirement.get("maps_to_credential_type") else []
    )
    if not accepted_types:
        # Nothing to match against (e.g. a declaration/form with no vault
        # analog) - leave whatever status the requirement already has.
        return {
            "credential_id": None,
            "valid_through_closing": None,
            "correct_category": None,
            "correct_classification": None,
            "status": requirement.get("status") or "PENDING",
        }

    matches = [
        credential
        for credential in candidate_credentials
        if credential.get("credential_type") in accepted_types and not credential.get("is_deleted")
    ]
    if not matches:
        return {
            "credential_id": None,
            "valid_through_closing": None,
            "correct_category": None,
            "correct_classification": None,
            "status": "MISSING",
        }

    # If more than one credential of an accepted type exists, prefer the
    # one with the latest expiry - the most defensible evidence available.
    def _expiry_key(credential: dict) -> date:
        return _parse_date(credential.get("expiry_date")) or date.min

    credential = max(matches, key=_expiry_key)

    closing_date = _parse_date(tender.get("submission_deadline"))
    expiry_date = _parse_date(credential.get("expiry_date"))

    if expiry_date is not None and closing_date is not None:
        valid_through_closing = expiry_date >= closing_date
    elif expiry_date is not None:
        valid_through_closing = expiry_date >= date.today()
    else:
        valid_through_closing = None

    required_category = (requirement.get("required_category") or "").strip().lower()
    required_classification = (requirement.get("required_classification") or "").strip().lower()
    credential_category = (credential.get("category") or "").strip().lower()
    credential_classification = (credential.get("classification_grade") or "").strip().lower()

    correct_category: Optional[bool] = None
    if required_category:
        correct_category = bool(credential_category) and credential_category == required_category

    correct_classification: Optional[bool] = None
    if required_classification:
        correct_classification = bool(credential_classification) and credential_classification == required_classification

    if credential.get("status") == "expired" or valid_through_closing is False:
        status = "EXPIRED"
    elif correct_classification is False:
        status = "WRONG_CLASSIFICATION"
    elif correct_category is False:
        status = "WRONG_CATEGORY"
    elif credential.get("status") in ("unverified", "pending_verification"):
        status = "UNVERIFIED"
    elif required_classification and correct_classification is None:
        # A classification was demanded but the vault entry doesn't record
        # one to compare against - genuinely unverified, not satisfied.
        status = "UNVERIFIED"
    elif credential.get("status") == "expiring" or (
        expiry_date is not None and (expiry_date - date.today()).days <= EXPIRING_SOON_DAYS
    ):
        status = "EXPIRING"
    else:
        status = "SATISFIED"

    return {
        "credential_id": credential.get("id"),
        "valid_through_closing": valid_through_closing,
        "correct_category": correct_category,
        "correct_classification": correct_classification,
        "status": status,
    }
