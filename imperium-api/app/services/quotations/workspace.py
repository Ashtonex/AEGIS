"""Quotation workspace domain: the server side of the estimating workspace.

Everything here works on the existing canonical record - finance.quotations
with its metadata.items BOQ - and the one canonical calculation,
QuotationCalculator via build_calc_input_from_metadata. Nothing in this module
re-derives totals its own way.

  apply_server_calculation()  every save: stable line ids, the effective-dated
                              VAT rate resolved server-side, and the persisted
                              totals / quote_amount taken from the calculator
                              (browser totals are only a preview).
  commercial_breakdown()      the cost -> selling build with each percentage's
                              base spelled out, plus markup AND margin.
  review_flags()              actionable checks, each pointing at a line or a
                              required action.
  issue_revision()            freezes an immutable snapshot (migration 279).
  compare_snapshots()         stable-id diff with quantity / rate / interaction
                              variance that reconciles to the direct-cost delta.
  build_materials_schedule()  awarded revision -> planning materials list from
                              rate build-ups, traceable to every BOQ line.
"""

from __future__ import annotations

import json
import uuid
from datetime import date, datetime, timezone
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Dict, Iterable, List, Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.quotations.calculator import (
    QuotationCalculator,
    build_calc_input_from_metadata,
    quotation_item_qty_rate,
)

LEGACY_DEFAULT_VAT_RATE = Decimal("0.155")
# The existing CCB rule (QuotationBrain.evaluate: is_worth_taking needs a
# profit rate of at least 10%) - reused, not a new threshold.
CCB_MIN_PROFIT_PCT = Decimal("10")
CENT = Decimal("0.01")

# Line types the estimate can hold. "note" lines (headings, exclusions,
# clarifications) carry no price; the calculator mapping prices them at 0.
ITEM_TYPES = ("measured", "lump_sum", "provisional", "note")

# Written only by the workspace endpoints, never by a client save.
REVISION_STATE_KEY = "revision_state"


def _d(value: Any) -> Decimal:
    return QuotationCalculator.sanitize_decimal(value)


def _money(value: Decimal) -> Decimal:
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


def parse_metadata(raw: Any) -> Dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str) and raw.strip():
        try:
            parsed = json.loads(raw)
            return parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            return {}
    return {}


# ---------------------------------------------------------------------------
# Save path
# ---------------------------------------------------------------------------

def ensure_line_ids(items: Iterable[Any]) -> List[Any]:
    """Every BOQ line gets a stable internal id (line_id), separate from its
    editable display code (item_no). Existing ids are kept; a duplicated id
    (a copied row) is replaced on the later copy only."""
    seen: set[str] = set()
    out: List[Any] = []
    for item in items:
        if not isinstance(item, dict):
            out.append(item)
            continue
        line_id = str(item.get("line_id") or "").strip()
        if not line_id or line_id in seen:
            item = {**item, "line_id": str(uuid.uuid4())}
            line_id = item["line_id"]
        seen.add(line_id)
        out.append(item)
    return out


async def resolve_vat_rate(
    db: AsyncSession, org_id: str, currency: Optional[str], as_at: Optional[date]
) -> tuple[Decimal, str]:
    """The VAT rate a quotation is priced at, from the org's effective-dated
    Finance > Statutory rate table for vat_output. With no table configured
    the long-standing 15.5% default still applies (existing quotes must not
    change price), but the source says so and the review flags it."""
    row = (
        await db.execute(
            text("""
                SELECT t.id, b.rate_pct
                FROM finance.tax_rate_tables t
                JOIN finance.tax_rate_bands b ON b.rate_table_id = t.id
                WHERE t.organization_id = :org_id AND t.tax_type = 'vat_output'
                  AND t.currency = :currency AND t.is_active = true AND t.is_deleted = false
                  AND t.effective_from <= :as_at AND (t.effective_to IS NULL OR t.effective_to >= :as_at)
                ORDER BY t.effective_from DESC, b.band_order
                LIMIT 1
            """),
            {"org_id": org_id, "currency": (currency or "USD")[:10], "as_at": as_at or date.today()},
        )
    ).first()
    if row and row.rate_pct is not None:
        return (_d(row.rate_pct) / Decimal("100")).normalize(), f"rate_table:{row.id}"
    return LEGACY_DEFAULT_VAT_RATE, "legacy_default"


def _quote_date(metadata: Dict[str, Any]) -> Optional[date]:
    raw = metadata.get("quote_date")
    if not raw:
        return None
    try:
        return date.fromisoformat(str(raw)[:10])
    except ValueError:
        return None


def has_priced_structure(metadata: Dict[str, Any]) -> bool:
    items = metadata.get("items")
    return isinstance(items, list) and len(items) > 0


async def apply_server_calculation(
    db: AsyncSession, org_id: str, quotation_id: str, metadata: Dict[str, Any]
) -> Optional[Decimal]:
    """Mutates metadata in place with server-authoritative totals and returns
    the grand total for quote_amount. Returns None (metadata untouched) when
    the record has no BOQ lines - e.g. a client-copy-only quotation whose
    amount was entered by hand - so those keep their recorded amount."""
    if not has_priced_structure(metadata):
        return None
    metadata["items"] = ensure_line_ids(metadata["items"])
    if metadata.get("apply_vat"):
        rate, source = await resolve_vat_rate(db, org_id, metadata.get("currency"), _quote_date(metadata))
    else:
        rate, source = Decimal("0"), "not_applied"
    metadata["vat_rate"] = str(rate)
    metadata["vat_rate_source"] = source
    calc = QuotationCalculator.calculate(build_calc_input_from_metadata(quotation_id, metadata))
    metadata.update({
        "direct_costs": float(calc.direct_costs),
        "overhead_amount": float(calc.overhead_amount),
        "contingency_amount": float(calc.contingency_amount),
        "profit_amount": float(calc.profit_amount),
        "subtotal": float(calc.subtotal),
        "taxable_amount": float(calc.taxable_amount),
        "vat": float(calc.tax_amount),
        "grand_total": float(calc.grand_total),
        "audit_trail_hash": calc.audit_trail_hash,
        "calculation_alerts": calc.breakdown_log.get("margin_alerts", []),
        "calculated_at": datetime.now(timezone.utc).isoformat(),
        "calculated_by": "server",
    })
    return calc.grand_total


# ---------------------------------------------------------------------------
# Commercial review
# ---------------------------------------------------------------------------

def calculate(quotation_id: str, metadata: Dict[str, Any]):
    return QuotationCalculator.calculate(build_calc_input_from_metadata(quotation_id, metadata))


def _pct(part: Decimal, whole: Decimal) -> Optional[float]:
    if whole <= 0:
        return None
    return float((part / whole * Decimal("100")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def commercial_breakdown(quotation_id: str, metadata: Dict[str, Any]) -> Dict[str, Any]:
    """The calculator's actual build-up, in order, with each step's base.

    QuotationCalculator applies overhead, contingency and profit each to
    (direct costs + preliminaries) independently - none compounds on another.
    Provisional sums are added after markups, discount comes off before tax.

    Markup and margin both use realised profit = selling (ex tax, after
    discount) - cost, where cost = direct + preliminaries + overhead +
    contingency + provisional sums (contingency is a cost/risk allowance, not
    profit). Markup = profit / cost; margin = profit / selling."""
    calc = calculate(quotation_id, metadata)
    base = calc.direct_costs + calc.preliminaries
    cost = base + calc.overhead_amount + calc.contingency_amount + calc.provisional_sums
    selling = calc.taxable_amount
    profit = selling - cost
    log = calc.breakdown_log
    rate = _d(metadata.get("vat_rate")) if metadata.get("apply_vat") and metadata.get("vat_rate") is not None else None
    return {
        "currency": metadata.get("currency") or "USD",
        "steps": [
            {"key": "direct_costs", "label": "Direct costs (BOQ qty x rate)", "amount": str(calc.direct_costs), "basis": "sum of priced lines"},
            {"key": "preliminaries", "label": "Preliminaries", "amount": str(calc.preliminaries), "basis": "fixed amount"},
            {"key": "overhead", "label": f"Overheads ({log.get('overhead_percentage')})", "amount": str(calc.overhead_amount), "basis": "% of direct costs + preliminaries"},
            {"key": "contingency", "label": f"Contingency ({log.get('contingency_percentage')})", "amount": str(calc.contingency_amount), "basis": "% of direct costs + preliminaries"},
            {"key": "profit", "label": f"Profit ({log.get('profit_percentage')})", "amount": str(calc.profit_amount), "basis": "% of direct costs + preliminaries (not compounded)"},
            {"key": "provisional_sums", "label": "Provisional sums", "amount": str(calc.provisional_sums), "basis": "fixed amount, after markups"},
            {"key": "discount", "label": "Discount", "amount": str(-calc.discount_amount), "basis": "fixed amount, before tax"},
            {"key": "taxable", "label": "Selling value excl. tax", "amount": str(calc.taxable_amount), "basis": "subtotal - discount"},
            {"key": "tax", "label": f"VAT ({log.get('tax_percentage')})", "amount": str(calc.tax_amount), "basis": "% of selling value excl. tax"},
            {"key": "grand_total", "label": "Client total", "amount": str(calc.grand_total), "basis": "selling value + tax"},
        ],
        "cost_total": str(_money(cost)),
        "selling_ex_tax": str(selling),
        "profit_realised": str(_money(profit)),
        "markup_pct": _pct(profit, cost),
        "margin_pct": _pct(profit, selling),
        "definitions": {
            "markup": "profit / cost",
            "margin": "profit / selling value excl. tax",
            "cost": "direct + preliminaries + overhead + contingency + provisional sums",
        },
        "direct_cost_components": log.get("direct_costs_breakdown", {}),
        "section_totals": log.get("boq_section_totals", []),
        "tax": {
            "applied": bool(metadata.get("apply_vat")),
            "rate": str(rate) if rate is not None else None,
            "source": metadata.get("vat_rate_source"),
        },
        "policy_alerts": log.get("margin_alerts", []),
        "margin_policy_violated": log.get("margin_policy_violated", False),
        "audit_trail_hash": calc.audit_trail_hash,
        "grand_total": str(calc.grand_total),
        "direct_costs": str(calc.direct_costs),
    }


def _flag(code: str, severity: str, message: str, *, line_id: Optional[str] = None, action: Optional[str] = None) -> Dict[str, Any]:
    return {"code": code, "severity": severity, "message": message, "line_id": line_id, "action": action}


def line_flags(items: List[Any], takeoff_status: Optional[Dict[str, str]] = None) -> List[Dict[str, Any]]:
    """takeoff_status: drawing_revision_id -> current status, so a line's
    takeoff follows the drawing (committed = verified, superseded = re-check)."""
    flags: List[Dict[str, Any]] = []
    for index, item in enumerate(items):
        if not isinstance(item, dict):
            continue
        line_id = item.get("line_id")
        label = str(item.get("item_no") or f"line {index + 1}")
        item_type = item.get("item_type") or "measured"
        description = str(item.get("description") or "").strip()
        if not description:
            flags.append(_flag("missing_description", "error", f"{label}: no description.", line_id=line_id))
        if item_type == "note":
            continue
        qty, rate, unit = quotation_item_qty_rate(item)
        qty, rate = _d(qty), _d(rate)
        if item_type == "measured":
            if qty <= 0:
                flags.append(_flag("missing_quantity", "error", f"{label}: quantity is zero or missing.", line_id=line_id))
            if not str(unit or "").strip():
                flags.append(_flag("missing_unit", "error", f"{label}: unit is missing.", line_id=line_id))
        if rate <= 0:
            if str(item.get("zero_rate_reason") or "").strip():
                flags.append(_flag("zero_rate_explained", "info", f"{label}: priced at zero - {item['zero_rate_reason']}", line_id=line_id))
            else:
                flags.append(_flag("unpriced", "error", f"{label}: no rate. Price it or record why it is zero.", line_id=line_id))
        buildup = item.get("buildup") or []
        if rate > 0 and not buildup and not item.get("rate_source"):
            flags.append(_flag("rate_without_evidence", "info", f"{label}: rate has no build-up or recorded source.", line_id=line_id))
        if buildup:
            built = sum((_d(b.get("qty")) * _d(b.get("rate")) for b in buildup if isinstance(b, dict)), Decimal("0"))
            if rate > 0 and _money(built) != _money(rate):
                flags.append(_flag(
                    "buildup_mismatch", "warning",
                    f"{label}: rate {_money(rate)} differs from its build-up {_money(built)}.", line_id=line_id,
                ))
            has_waste_line = any(isinstance(b, dict) and b.get("type") == "waste_allowance" for b in buildup)
            if has_waste_line and any(isinstance(b, dict) and _d(b.get("waste_pct")) > 0 for b in buildup):
                flags.append(_flag("wastage_double_count", "warning", f"{label}: wastage is entered both as a line and as a percentage.", line_id=line_id))
        takeoff = item.get("takeoff") if isinstance(item.get("takeoff"), dict) else None
        if takeoff:
            drawing_status = (takeoff_status or {}).get(str(takeoff.get("drawing_revision_id") or ""))
            if drawing_status == "superseded":
                flags.append(_flag("takeoff_superseded", "warning", f"{label}: its drawing has been revised - re-check the quantity.", line_id=line_id, action="drawings"))
            elif drawing_status != "committed" and not (drawing_status is None and takeoff.get("verified")):
                flags.append(_flag("takeoff_unverified", "warning", f"{label}: quantity comes from an unverified drawing takeoff.", line_id=line_id, action="drawings"))
    return flags


async def review_flags(
    db: AsyncSession, org_id: str, quotation: Dict[str, Any], metadata: Dict[str, Any]
) -> List[Dict[str, Any]]:
    from routers.sop_compliance import get_missing_required_sops

    items = metadata.get("items") if isinstance(metadata.get("items"), list) else []
    drawing_ids = sorted({
        str(i["takeoff"]["drawing_revision_id"]) for i in items
        if isinstance(i, dict) and isinstance(i.get("takeoff"), dict) and i["takeoff"].get("drawing_revision_id")
    })
    takeoff_status: Dict[str, str] = {}
    if drawing_ids:
        rows = (
            await db.execute(
                text("""
                    SELECT CAST(id AS text) AS id, status FROM takeoff.drawing_revisions
                    WHERE organization_id = :org_id AND CAST(id AS text) = ANY(:ids)
                """),
                {"org_id": org_id, "ids": drawing_ids},
            )
        ).all()
        takeoff_status = {r.id: r.status for r in rows}
    flags = line_flags(items, takeoff_status)
    if not items:
        flags.append(_flag("no_boq", "error", "No BOQ lines yet - the estimate is unpriced.", action="boq"))
    if not str(quotation.get("client_name") or "").strip():
        flags.append(_flag("missing_client", "error", "Client name is missing.", action="overview"))
    if not metadata.get("quote_date"):
        flags.append(_flag("missing_quote_date", "warning", "Quote date is missing - validity cannot be stated.", action="overview"))
    if metadata.get("apply_vat") and metadata.get("vat_rate_source") in (None, "legacy_default"):
        flags.append(_flag(
            "tax_rate_unconfigured", "warning",
            "VAT is priced at the legacy 15.5% default - no effective vat_output rate table is configured in Finance > Statutory.",
            action="commercial",
        ))
    approval = (metadata.get("boq_approval") or {}).get("status")
    if approval != "approved":
        flags.append(_flag(
            "boq_not_approved", "warning",
            "BOQ has no independent approval for the current lines" + (f" (status: {approval})." if approval else "."),
            action="commercial",
        ))
    if items and _d(metadata.get("profit_pct")) < CCB_MIN_PROFIT_PCT:
        flags.append(_flag(
            "low_margin", "warning",
            f"Profit rate {_d(metadata.get('profit_pct'))}% is below the Commercial Control Brain's "
            f"{CCB_MIN_PROFIT_PCT}% worthiness floor.",
            action="commercial",
        ))
    for alert in metadata.get("calculation_alerts") or []:
        if "threshold" in str(alert):
            flags.append(_flag("margin_policy", "error", str(alert), action="commercial"))
    missing_sops = await get_missing_required_sops(db, org_id, str(quotation["id"]))
    if missing_sops:
        flags.append(_flag(
            "sop_incomplete", "warning",
            f"Required SOP checklist(s) incomplete before award: {', '.join(missing_sops)}.", action="commercial",
        ))
    drafts = (
        await db.execute(
            text("""
                SELECT drawing_name, revision_label
                FROM takeoff.drawing_revisions
                WHERE organization_id = :org_id AND quotation_id = :qid AND is_deleted = false AND status = 'draft'
                ORDER BY created_at
            """),
            {"org_id": org_id, "qid": quotation["id"]},
        )
    ).all()
    for row in drafts:
        flags.append(_flag(
            "takeoff_uncommitted", "warning",
            f"Drawing {row.drawing_name} {row.revision_label}: takeoff not yet checked and committed.", action="drawings",
        ))
    return flags


# ---------------------------------------------------------------------------
# Revisions
# ---------------------------------------------------------------------------

def item_key(item: Dict[str, Any]) -> str:
    """Stable identity for diffing. Lines saved through the workspace carry
    line_id; older snapshots fall back to their display code + description."""
    if item.get("line_id"):
        return f"id:{item['line_id']}"
    return "legacy:" + "|".join(
        str(item.get(k) or "").strip().lower() for k in ("section", "item_no", "description")
    )


def _line_values(item: Dict[str, Any]) -> tuple[Decimal, Decimal, Decimal]:
    if (item.get("item_type") or "measured") == "note":
        return Decimal("0"), Decimal("0"), Decimal("0")
    qty, rate, _unit = quotation_item_qty_rate(item)
    qty, rate = _d(qty), _d(rate)
    return qty, rate, _money(qty * rate)


def compare_snapshots(
    base_meta: Dict[str, Any], target_meta: Dict[str, Any], base_calc, target_calc
) -> Dict[str, Any]:
    """Line diff with variance attribution that reconciles exactly:

        amount delta = qty effect (dQ x R0) + rate effect (dR x Q0)
                     + interaction (dQ x dR)       for a line in both,
        amount delta = +/- full amount             for an added/removed line.

    Line amounts are rounded per line exactly as QuotationCalculator rounds
    them; the interaction column carries each line's cent residue. Anything
    left against the calculator's direct-cost delta is reported in
    'rounding' (expected 0) so the columns always reconcile."""
    base_items = {item_key(i): i for i in base_meta.get("items") or [] if isinstance(i, dict)}
    target_items = {item_key(i): i for i in target_meta.get("items") or [] if isinstance(i, dict)}
    lines = []
    totals = {"qty_effect": Decimal("0"), "rate_effect": Decimal("0"), "interaction": Decimal("0"), "added": Decimal("0"), "removed": Decimal("0")}
    for key in list(base_items.keys()) + [k for k in target_items if k not in base_items]:
        old, new = base_items.get(key), target_items.get(key)
        if old and new:
            q0, r0, a0 = _line_values(old)
            q1, r1, a1 = _line_values(new)
            dq, dr = q1 - q0, r1 - r0
            qty_effect, rate_effect = _money(dq * r0), _money(dr * q0)
            # dQ x dR, carrying the line's cent-rounding residue so the
            # three effects sum exactly to the rounded amount movement.
            interaction = (a1 - a0) - qty_effect - rate_effect
            text_changed = any(
                str(old.get(f) or "").strip() != str(new.get(f) or "").strip()
                for f in ("description", "unit", "section", "item_no", "item_type")
            )
            if a0 == a1 and not text_changed and dq == 0 and dr == 0:
                continue
            totals["qty_effect"] += qty_effect
            totals["rate_effect"] += rate_effect
            totals["interaction"] += interaction
            change = "changed"
        elif new:
            q1, r1, a1 = _line_values(new)
            q0 = r0 = a0 = Decimal("0")
            qty_effect = rate_effect = interaction = Decimal("0")
            totals["added"] += a1
            change = "added"
        else:
            q0, r0, a0 = _line_values(old)
            q1 = r1 = a1 = Decimal("0")
            qty_effect = rate_effect = interaction = Decimal("0")
            totals["removed"] -= a0
            change = "removed"
        ref = new or old
        lines.append({
            "key": key,
            "line_id": ref.get("line_id"),
            "item_no": ref.get("item_no"),
            "section": ref.get("section"),
            "change": change,
            "description_before": (old or {}).get("description"),
            "description_after": (new or {}).get("description"),
            "unit_before": (old or {}).get("unit"),
            "unit_after": (new or {}).get("unit"),
            "qty_before": str(q0), "qty_after": str(q1),
            "rate_before": str(r0), "rate_after": str(r1),
            "amount_before": str(a0), "amount_after": str(a1),
            "amount_delta": str(a1 - a0),
            "qty_effect": str(qty_effect), "rate_effect": str(rate_effect), "interaction": str(interaction),
        })
    direct_delta = target_calc.direct_costs - base_calc.direct_costs
    explained = sum(totals.values(), Decimal("0"))

    def summary(calc, meta):
        b = commercial_breakdown("compare", meta)
        return {
            "direct_costs": str(calc.direct_costs), "grand_total": str(calc.grand_total),
            "selling_ex_tax": str(calc.taxable_amount), "margin_pct": b["margin_pct"], "markup_pct": b["markup_pct"],
        }

    return {
        "lines": lines,
        "variance": {k: str(v) for k, v in totals.items()},
        "direct_cost_delta": str(direct_delta),
        "rounding": str(direct_delta - explained),
        "grand_total_delta": str(target_calc.grand_total - base_calc.grand_total),
        "before": summary(base_calc, base_meta),
        "after": summary(target_calc, target_meta),
        "counts": {
            "added": sum(1 for line in lines if line["change"] == "added"),
            "removed": sum(1 for line in lines if line["change"] == "removed"),
            "changed": sum(1 for line in lines if line["change"] == "changed"),
        },
    }


def snapshot_metadata(metadata: Dict[str, Any]) -> Dict[str, Any]:
    """What a revision freezes: the full commercial blob minus server
    bookkeeping that belongs to the live record (approval history, revision
    pointers), so a snapshot is the priced estimate exactly as issued."""
    frozen = {k: v for k, v in metadata.items() if k not in (REVISION_STATE_KEY,)}
    return json.loads(json.dumps(frozen, default=str))


async def list_revisions(db: AsyncSession, org_id: str, quotation_id: str) -> List[Dict[str, Any]]:
    rows = (
        await db.execute(
            text("""
                SELECT r.id, r.revision_number, r.parent_revision_id, r.kind, r.change_reason,
                       r.currency, r.tax_rate, r.tax_rate_source, r.direct_costs, r.grand_total,
                       r.item_count, r.audit_trail_hash, r.source_row_version, r.created_at,
                       r.created_by, u.full_name AS created_by_name
                FROM finance.quotation_revisions r
                LEFT JOIN core.users u ON u.id = r.created_by
                WHERE r.organization_id = :org_id AND r.quotation_id = :qid
                ORDER BY r.revision_number DESC
            """),
            {"org_id": org_id, "qid": quotation_id},
        )
    ).mappings().all()
    return [dict(r) for r in rows]


async def load_revision(db: AsyncSession, org_id: str, quotation_id: str, revision_id: str) -> Optional[Dict[str, Any]]:
    row = (
        await db.execute(
            text("""
                SELECT * FROM finance.quotation_revisions
                WHERE id = CAST(:rid AS uuid) AND organization_id = :org_id AND quotation_id = :qid
            """),
            {"rid": revision_id, "org_id": org_id, "qid": quotation_id},
        )
    ).mappings().first()
    if not row:
        return None
    out = dict(row)
    out["snapshot"] = parse_metadata(out.get("snapshot"))
    out["calculation"] = parse_metadata(out.get("calculation"))
    return out


async def insert_revision(
    db: AsyncSession,
    *,
    org_id: str,
    quotation_id: str,
    metadata: Dict[str, Any],
    kind: str,
    change_reason: Optional[str],
    created_by: str,
    source_row_version: Optional[int],
) -> Dict[str, Any]:
    latest = (
        await db.execute(
            text("""
                SELECT id, revision_number FROM finance.quotation_revisions
                WHERE quotation_id = :qid ORDER BY revision_number DESC LIMIT 1
            """),
            {"qid": quotation_id},
        )
    ).first()
    number = (latest.revision_number + 1) if latest else 1
    frozen = snapshot_metadata(metadata)
    frozen["revision_number"] = number
    calc = calculate(quotation_id, frozen)
    row = (
        await db.execute(
            text("""
                INSERT INTO finance.quotation_revisions (
                    organization_id, quotation_id, revision_number, parent_revision_id, kind,
                    change_reason, snapshot, calculation, currency, tax_rate, tax_rate_source,
                    direct_costs, grand_total, item_count, audit_trail_hash, source_row_version, created_by
                ) VALUES (
                    :org_id, :qid, :number, :parent, :kind,
                    :reason, CAST(:snapshot AS jsonb), CAST(:calculation AS jsonb), :currency, :tax_rate, :tax_source,
                    :direct_costs, :grand_total, :item_count, :hash, :row_version, :created_by
                )
                RETURNING id, revision_number, created_at
            """),
            {
                "org_id": org_id,
                "qid": quotation_id,
                "number": number,
                "parent": latest.id if latest else None,
                "kind": kind,
                "reason": change_reason,
                "snapshot": json.dumps(frozen, default=str),
                "calculation": json.dumps(calc.model_dump(mode="json"), default=str),
                "currency": str(frozen.get("currency") or "USD")[:10],
                "tax_rate": _d(frozen.get("vat_rate")) if frozen.get("apply_vat") else Decimal("0"),
                "tax_source": str(frozen.get("vat_rate_source") or "")[:40] or None,
                "direct_costs": calc.direct_costs,
                "grand_total": calc.grand_total,
                "item_count": len(frozen.get("items") or []),
                "hash": calc.audit_trail_hash,
                "row_version": source_row_version,
                "created_by": created_by,
            },
        )
    ).mappings().first()
    return {
        "id": str(row["id"]),
        "revision_number": row["revision_number"],
        "created_at": row["created_at"],
        "grand_total": str(calc.grand_total),
        "audit_trail_hash": calc.audit_trail_hash,
        "parent_revision_id": str(latest.id) if latest else None,
    }


# ---------------------------------------------------------------------------
# Handoff
# ---------------------------------------------------------------------------

def _norm(value: Any) -> str:
    return " ".join(str(value or "").strip().lower().split())


def build_materials_schedule(snapshot: Dict[str, Any]) -> Dict[str, Any]:
    """Planning materials list from the awarded revision's rate build-ups.

    A build-up line is per unit of its BOQ line, so required quantity =
    BOQ qty x build-up qty. Lines aggregate only when name, unit and
    specification match exactly (after whitespace/case normalisation) - a
    different unit is a different line, never a silent conversion. Every
    aggregate keeps the BOQ lines it came from."""
    groups: Dict[tuple, Dict[str, Any]] = {}
    lines_without_buildup = 0
    for item in snapshot.get("items") or []:
        if not isinstance(item, dict) or (item.get("item_type") or "measured") == "note":
            continue
        qty, _rate, _unit = quotation_item_qty_rate(item)
        qty = _d(qty)
        materials = [b for b in (item.get("buildup") or []) if isinstance(b, dict) and b.get("type") == "material"]
        if not materials:
            lines_without_buildup += 1
            continue
        for b in materials:
            name = str(b.get("name") or "").strip() or "Unnamed material"
            unit = str(b.get("unit") or "").strip() or "unit"
            spec = str(b.get("spec") or b.get("specification") or "").strip()
            key = (_norm(name), _norm(unit), _norm(spec))
            per_unit = _d(b.get("qty"))
            required = qty * per_unit
            unit_cost = _d(b.get("rate"))
            group = groups.setdefault(key, {
                "material": name, "unit": unit, "specification": spec or None,
                "quantity": Decimal("0"), "budget_cost": Decimal("0"), "unit_costs": set(), "sources": [],
            })
            group["quantity"] += required
            group["budget_cost"] += required * unit_cost
            group["unit_costs"].add(str(unit_cost))
            group["sources"].append({
                "line_id": item.get("line_id"), "item_no": item.get("item_no"),
                "description": item.get("description"), "boq_quantity": str(qty),
                "per_unit": str(per_unit), "quantity": str(required), "unit_cost": str(unit_cost),
                "supplier": b.get("supplier") or b.get("source"),
            })
    lines = []
    for group in groups.values():
        lines.append({
            "material": group["material"],
            "unit": group["unit"],
            "specification": group["specification"],
            "quantity": str(group["quantity"].quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)),
            "budget_cost": str(_money(group["budget_cost"])),
            "mixed_unit_costs": len(group["unit_costs"]) > 1,
            "sources": group["sources"],
        })
    lines.sort(key=lambda line: (line["material"].lower(), line["unit"].lower()))
    return {
        "lines": lines,
        "summary": {
            "material_lines": len(lines),
            "boq_lines_without_material_buildup": lines_without_buildup,
            "budget_cost": str(_money(sum((_d(line["budget_cost"]) for line in lines), Decimal("0")))),
            "note": "Planning output only - no purchase order, requisition or commitment is created.",
        },
    }
