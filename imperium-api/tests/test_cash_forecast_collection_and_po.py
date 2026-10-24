from datetime import date, timedelta

from app.services.finance import cash_position
from app.services.finance.cash_position import DEFAULT_SUPPLIER_PAYMENT_TERMS_DAYS, _bucket_events, open_po_events
from app.services.finance.client_collection import (
    CLIENT_COLLECTION_DAYS_AFTER_CERTIFICATION,
    CLIENT_COLLECTION_DAYS_AFTER_SUBMISSION,
    client_key,
    summarise_collection_delays,
)

D = date(2026, 1, 1)


def _claim(submitted, certified, received):
    return {
        "submitted_on": D + timedelta(days=submitted),
        "certified_on": D + timedelta(days=certified),
        "received_on": D + timedelta(days=received) if received is not None else None,
    }


# --- measured client collection delay (DSO) ---------------------------------

def test_measured_delay_is_median_days_from_certification_and_submission():
    profile = summarise_collection_delays([
        _claim(0, 10, 30),   # 20 after cert, 30 after sub
        _claim(0, 5, 65),    # 60 / 65
        _claim(0, 0, 40),    # 40 / 40
    ])
    assert profile["source"] == "measured"
    assert profile["paid_claims_measured"] == 3
    assert profile["days_after_certification"] == 40
    assert profile["days_after_submission"] == 40


def test_one_slow_payment_does_not_swing_the_median():
    profile = summarise_collection_delays([_claim(0, 0, 20), _claim(0, 0, 25), _claim(0, 0, 30), _claim(0, 0, 400)])
    assert profile["days_after_certification"] == 28  # median of 20, 25, 30, 400 = 27.5 -> 28


def test_too_little_history_falls_back_to_defaults():
    profile = summarise_collection_delays([_claim(0, 0, 5), _claim(0, 0, 6)])
    assert profile["source"] == "default"
    assert profile["paid_claims_measured"] == 2
    assert profile["days_after_certification"] == CLIENT_COLLECTION_DAYS_AFTER_CERTIFICATION
    assert profile["days_after_submission"] == CLIENT_COLLECTION_DAYS_AFTER_SUBMISSION


def test_claims_without_a_receipt_are_not_measured():
    profile = summarise_collection_delays([_claim(0, 0, 5), _claim(0, 0, 6), _claim(0, 0, None)])
    assert profile["source"] == "default"
    assert profile["paid_claims_measured"] == 2


def test_receipt_before_certification_counts_as_zero_days_not_negative():
    profile = summarise_collection_delays([_claim(0, 10, 8), _claim(0, 10, 9), _claim(0, 10, 10)])
    assert profile["days_after_certification"] == 0
    assert profile["days_after_submission"] >= profile["days_after_certification"]


def test_submission_delay_is_never_shorter_than_certification_delay():
    # Claims certified with no earlier submission date recorded.
    samples = [{"submitted_on": None, "certified_on": D, "received_on": D + timedelta(days=n)} for n in (10, 20, 30)]
    profile = summarise_collection_delays(samples)
    assert profile["days_after_certification"] == 20
    assert profile["days_after_submission"] == 20


def test_client_key_prefers_org_then_client_then_normalised_name():
    assert client_key("org-1", "cli-1", "Troutbeck") == "org-1"
    assert client_key(None, "cli-1", "Troutbeck") == "cli-1"
    assert client_key(None, None, "  Troutbeck ") == "name:troutbeck"
    assert client_key(None, None, "  ") is None


# --- committed purchase orders, de-duplicated against invoices ---------------

def _po(po_id, total, terms=None, delivery=D):
    return {"id": po_id, "po_number": f"PO-{po_id}", "total_amount": total, "payment_terms_days": terms, "expected_delivery_date": delivery}


def test_uninvoiced_po_is_a_committed_outflow_at_delivery_plus_terms():
    events = open_po_events([_po("a", 1000, terms=14)], {})
    assert len(events) == 1
    assert events[0]["amount"] == 1000
    assert events[0]["direction"] == "outflow"
    assert events[0]["source_type"] == "purchase_order"
    assert events[0]["date"] == D + timedelta(days=14)


def test_missing_payment_terms_default_to_30_days():
    assert DEFAULT_SUPPLIER_PAYMENT_TERMS_DAYS == 30
    assert open_po_events([_po("a", 100)], {})[0]["date"] == D + timedelta(days=30)


def test_zero_day_terms_are_respected_not_defaulted():
    assert open_po_events([_po("a", 100, terms=0)], {})[0]["date"] == D


def test_fully_invoiced_po_adds_nothing():
    assert open_po_events([_po("a", 1155)], {"a": 1155.0}) == []


def test_over_invoiced_po_never_becomes_an_inflow():
    assert open_po_events([_po("a", 1000)], {"a": 1200.0}) == []


def test_part_invoiced_po_only_adds_the_uninvoiced_remainder():
    events = open_po_events([_po("a", 1000), _po("b", 500)], {"a": 400.0})
    assert {e["source_id"]: e["amount"] for e in events} == {"a": 600.0, "b": 500.0}


def test_po_and_its_invoice_together_total_the_po_value_once():
    # Invoice for 400 is already a forecast event; the PO must only add 600,
    # so the horizon total equals the PO value, not PO + invoice.
    invoice = {"date": D + timedelta(days=5), "amount": 400.0, "direction": "outflow", "source_type": "supplier_invoice"}
    events = [invoice] + open_po_events([_po("a", 1000, terms=10)], {"a": 400.0})
    result = _bucket_events(opening_cash=5000.0, events=events, horizons=[D + timedelta(days=30)])
    assert result[0]["projected_cash"] == 4000.0


def test_only_invoices_already_in_the_forecast_are_netted_off_pos():
    sql = cash_position._INVOICE_COUNTED_SQL
    assert "si.status IN ('approved', 'paid')" in sql
    assert "si.match_status IN ('matched', 'partial_match')" in sql
    assert "NOT IN ('rejected', 'cancelled')" in sql


def test_only_open_po_statuses_are_committed():
    assert cash_position.OPEN_PO_STATUSES == ("issued", "partially_received", "received")
