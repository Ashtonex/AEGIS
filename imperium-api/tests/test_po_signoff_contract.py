"""Two-step purchase order sign-off: Finance, then a director, then issue.
SUPERADMIN can sign either step and can issue without them (audited)."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROC = (ROOT / "routers" / "procurement.py").read_text(encoding="utf-8")
MIGRATION = (ROOT / "migrations" / "274_po_two_step_signoff.sql").read_text(encoding="utf-8")


def _fn(name: str) -> str:
    return PROC.split(f"async def {name}(")[1].split("\n@router")[0]


def test_migration_adds_signoff_columns_and_grants():
    for col in (
        "finance_signed_off_by", "finance_signed_off_at",
        "director_signed_off_by", "director_signed_off_at",
        "signoff_override_by", "signoff_override_at", "signoff_override_reason",
    ):
        assert f"ADD COLUMN IF NOT EXISTS {col}" in MIGRATION
    assert "ON CONFLICT (key) DO NOTHING" in MIGRATION
    assert "ON CONFLICT (role_id, permission_id) DO NOTHING" in MIGRATION
    assert "'Finance Manager' AND p.key IN ('procurement.po.finance_signoff', 'procurement.po.read')" in MIGRATION
    assert "'Executive (Admin)' AND p.key IN ('procurement.po.director_signoff', 'procurement.po.read')" in MIGRATION


def test_signoff_endpoint_enforces_order_and_separation():
    assert '@router.post("/purchase-orders/{po_id}/signoff")' in PROC
    body = _fn("sign_off_purchase_order")
    assert "FOR UPDATE" in body
    assert "Finance must sign off before the director." in body
    assert "You can't sign off a purchase order you raised." in body
    assert "someone other than the Finance signer" in body
    assert "if not superadmin:" in body  # superadmin skips the separation rules
    assert "user_has_permission(db, user, SIGNOFF_PERMISSIONS[stage])" in body
    # Rejection keeps the PO a draft (the status CHECK has no 'rejected') and restarts both sign-offs.
    assert "SET status='draft'" in body
    assert "finance_signed_off_by=NULL" in body and "director_signed_off_by=NULL" in body
    assert "status='approved', approved_by=CAST(:user_id AS uuid)" in body


def test_legacy_decision_routes_through_signoff():
    body = _fn("decide_purchase_order")
    assert "sign_off_purchase_order(" in body
    assert "status_value" not in body


def test_issue_requires_both_signoffs_unless_superadmin_with_reason():
    body = _fn("issue_purchase_order")
    assert 'po["finance_signed_off_at"] is not None' in body
    assert 'po["director_signed_off_at"] is not None' in body
    assert "if not is_superadmin(user):" in body
    assert "Give a reason to issue this purchase order without its sign-offs." in body
    assert "procurement.purchase_order.signoff_overridden.v1" in body
    assert "signoff_override_reason=CASE WHEN CAST(:override AS boolean)" in body
