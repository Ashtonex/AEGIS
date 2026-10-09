"""
Tender / project cash curve.

Answers the bid/no-bid question "how much cash do we have to put into this
job before it pays for itself, and when?" for a quotation (or a live
project) - before the bid goes in.

The curve is built from dated cash events, not from the cost S-curve alone:

* Outflows: the job's project cost (BOQ direct cost + preliminaries +
  provisional sums + contingency, which is assumed to be consumed) spread
  over the programme on a cost profile. Labour and preliminaries are paid as
  incurred, materials and plant hire ``supplier_payment_days`` after the work
  that consumes them, subcontractors ``subcontractor_payment_days`` after.
  Mobilisation is paid on day 0.
* Inflows: the deposit/advance on ``deposit_day``; a progress claim every
  ``claim_frequency_days`` valuing the work done since the last claim, less
  retention and less pro-rata recovery of the deposit, collected
  ``client_payment_days`` after the claim date; retention released in two
  parts - at practical completion and after the defects period - each also
  collected ``client_payment_days`` later.

Head-office overhead and profit are not project cash outflows, so the margin
reported is the contribution (contract value less project cost). VAT is a
pass-through and is excluded throughout: contract value is the taxable
(ex-VAT) amount.

``build_cash_curve`` is pure (no DB) so the maths is unit-testable; the async
loaders below only work out sensible default assumptions from real data.
Nothing here writes to the database.
"""

from __future__ import annotations

import calendar
from dataclasses import asdict, dataclass, fields
from datetime import date, timedelta
from typing import Any, Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.finance.cash_position import CLIENT_COLLECTION_DAYS_AFTER_SUBMISSION
from app.services.finance.client_collection import MIN_PAID_CLAIMS, client_collection_days

COST_PROFILES = ("front", "even", "s_curve", "back")
GRANULARITIES = ("auto", "week", "month")

# Used only when the quotation carries no cost build-up at all.
DEFAULT_COST_MIX = {"materials": 0.45, "labour": 0.25, "plant": 0.10, "subcontract": 0.20}
DEFAULT_MARKUP_WHEN_UNKNOWN = 0.20
DEFAULT_SUPPLIER_PAYMENT_DAYS = 30
# Weekly periods up to this programme length, monthly beyond it.
AUTO_WEEKLY_MAX_DURATION_WEEKS = 26


@dataclass
class CashCurveAssumptions:
    contract_value: float = 0.0
    project_cost: float = 0.0
    duration_weeks: int = 16
    start_date: Optional[date] = None
    cost_profile: str = "s_curve"
    # Share of the non-preliminaries cost by category; normalised on use.
    materials_share: float = DEFAULT_COST_MIX["materials"]
    labour_share: float = DEFAULT_COST_MIX["labour"]
    plant_share: float = DEFAULT_COST_MIX["plant"]
    subcontract_share: float = DEFAULT_COST_MIX["subcontract"]
    preliminaries: float = 0.0
    mobilisation_cost: float = 0.0
    deposit_pct: float = 0.0
    deposit_day: int = 0
    retention_pct: float = 10.0
    retention_release_at_pc_pct: float = 50.0
    defects_period_days: int = 180
    claim_frequency_days: int = 30
    client_payment_days: int = CLIENT_COLLECTION_DAYS_AFTER_SUBMISSION
    supplier_payment_days: int = DEFAULT_SUPPLIER_PAYMENT_DAYS
    subcontractor_payment_days: int = 30
    finance_rate_pct: float = 15.0
    granularity: str = "auto"

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "CashCurveAssumptions":
        known = {f.name for f in fields(cls)}
        values: dict[str, Any] = {}
        for key, raw in (data or {}).items():
            if key not in known or raw is None or raw == "":
                continue
            values[key] = raw
        obj = cls(**values)
        obj._coerce()
        return obj

    def merged(self, overrides: Optional[dict[str, Any]]) -> "CashCurveAssumptions":
        base = self.to_dict()
        base.update({k: v for k, v in (overrides or {}).items() if v is not None and v != ""})
        return CashCurveAssumptions.from_dict(base)

    def to_dict(self) -> dict[str, Any]:
        out = asdict(self)
        out["start_date"] = self.start_date.isoformat() if self.start_date else None
        return out

    def _coerce(self) -> None:
        for name in ("contract_value", "project_cost", "materials_share", "labour_share", "plant_share",
                     "subcontract_share", "preliminaries", "mobilisation_cost", "deposit_pct",
                     "retention_pct", "retention_release_at_pc_pct", "finance_rate_pct"):
            setattr(self, name, max(0.0, float(getattr(self, name) or 0)))
        for name in ("duration_weeks", "deposit_day", "defects_period_days", "claim_frequency_days",
                     "client_payment_days", "supplier_payment_days", "subcontractor_payment_days"):
            setattr(self, name, max(0, int(round(float(getattr(self, name) or 0)))))
        self.duration_weeks = min(max(1, self.duration_weeks), 520)
        self.claim_frequency_days = max(7, self.claim_frequency_days)
        self.deposit_pct = min(self.deposit_pct, 100.0)
        self.retention_pct = min(self.retention_pct, 100.0)
        self.retention_release_at_pc_pct = min(self.retention_release_at_pc_pct, 100.0)
        if isinstance(self.start_date, str):
            self.start_date = date.fromisoformat(self.start_date[:10])
        if self.cost_profile not in COST_PROFILES:
            self.cost_profile = "s_curve"
        if self.granularity not in GRANULARITIES:
            self.granularity = "auto"


def cumulative_progress(p: float, profile: str) -> float:
    """Fraction of the measured work done at fraction ``p`` of the programme."""
    p = min(1.0, max(0.0, p))
    if profile == "even":
        return p
    if profile == "front":
        return 1 - (1 - p) ** 2
    if profile == "back":
        return p ** 2
    return 3 * p ** 2 - 2 * p ** 3


def _add_months(d: date, months: int) -> date:
    month_index = d.month - 1 + months
    year = d.year + month_index // 12
    month = month_index % 12 + 1
    return date(year, month, min(d.day, calendar.monthrange(year, month)[1]))


def _event(day: int, amount: float, direction: str, category: str) -> dict:
    return {"day": int(day), "amount": float(amount), "direction": direction, "category": category}


def build_cash_events(a: CashCurveAssumptions) -> list[dict]:
    duration_days = a.duration_weeks * 7
    events: list[dict] = []

    # --- Outflows ---------------------------------------------------------
    mobilisation = min(a.mobilisation_cost, a.project_cost)
    prelims = min(a.preliminaries, max(0.0, a.project_cost - mobilisation))
    measured = max(0.0, a.project_cost - mobilisation - prelims)
    shares = {
        "materials": a.materials_share, "labour": a.labour_share,
        "plant": a.plant_share, "subcontract": a.subcontract_share,
    }
    share_total = sum(shares.values()) or 1.0
    pay_lag = {
        "materials": a.supplier_payment_days, "plant": a.supplier_payment_days,
        "subcontract": a.subcontractor_payment_days, "labour": 0,
    }

    if mobilisation > 0:
        events.append(_event(0, mobilisation, "outflow", "mobilisation"))
    weekly_prelims = prelims / a.duration_weeks
    for w in range(a.duration_weeks):
        week_end = (w + 1) * 7
        work_fraction = (cumulative_progress((w + 1) / a.duration_weeks, a.cost_profile)
                         - cumulative_progress(w / a.duration_weeks, a.cost_profile))
        week_cost = measured * work_fraction
        for category, share in shares.items():
            amount = week_cost * share / share_total
            if amount > 0:
                events.append(_event(week_end + pay_lag[category], amount, "outflow", category))
        if weekly_prelims > 0:
            events.append(_event(week_end, weekly_prelims, "outflow", "preliminaries"))

    # --- Inflows ----------------------------------------------------------
    deposit = a.contract_value * a.deposit_pct / 100.0
    if deposit > 0:
        events.append(_event(a.deposit_day, deposit, "inflow", "deposit"))

    claim_days = list(range(a.claim_frequency_days, duration_days, a.claim_frequency_days)) + [duration_days]
    valued_so_far = 0.0
    for claim_day in claim_days:
        valued_to_date = a.contract_value * cumulative_progress(claim_day / duration_days, a.cost_profile)
        gross = valued_to_date - valued_so_far
        valued_so_far = valued_to_date
        if gross <= 0:
            continue
        retention = gross * a.retention_pct / 100.0
        deposit_recovery = gross * a.deposit_pct / 100.0
        net = gross - retention - deposit_recovery
        if net > 0:
            events.append(_event(claim_day + a.client_payment_days, net, "inflow", "claims"))

    retention_total = a.contract_value * a.retention_pct / 100.0
    first_release = retention_total * a.retention_release_at_pc_pct / 100.0
    second_release = retention_total - first_release
    if first_release > 0:
        events.append(_event(duration_days + a.client_payment_days, first_release, "inflow", "retention_release"))
    if second_release > 0:
        events.append(_event(duration_days + a.defects_period_days + a.client_payment_days,
                             second_release, "inflow", "retention_release"))
    return events


def _period_edges(start: date, last_day: int, granularity: str) -> list[date]:
    """Period start dates, plus one trailing edge, covering day 0..last_day."""
    end = start + timedelta(days=last_day)
    edges = [start]
    while edges[-1] <= end:
        if granularity == "week":
            edges.append(edges[-1] + timedelta(days=7))
        else:
            edges.append(_add_months(start, len(edges)))
    return edges


def build_cash_curve(a: CashCurveAssumptions, today: Optional[date] = None) -> dict:
    start = a.start_date or ((today or date.today()) + timedelta(days=30))
    granularity = a.granularity
    if granularity == "auto":
        granularity = "week" if a.duration_weeks <= AUTO_WEEKLY_MAX_DURATION_WEEKS else "month"

    events = build_cash_events(a)
    last_day = max([e["day"] for e in events] + [a.duration_weeks * 7])
    edges = _period_edges(start, last_day, granularity)

    outflow_categories = ("mobilisation", "preliminaries", "labour", "materials", "plant", "subcontract")
    inflow_categories = ("deposit", "claims", "retention_release")
    periods: list[dict] = []
    for i in range(len(edges) - 1):
        periods.append({
            "index": i + 1,
            "label": f"{'W' if granularity == 'week' else 'M'}{i + 1}",
            "start_date": edges[i],
            "end_date": edges[i + 1] - timedelta(days=1),
            "outflows": {c: 0.0 for c in outflow_categories},
            "inflows": {c: 0.0 for c in inflow_categories},
        })

    for e in sorted(events, key=lambda ev: ev["day"]):
        when = start + timedelta(days=e["day"])
        idx = next(i for i in range(len(periods)) if periods[i]["start_date"] <= when <= periods[i]["end_date"])
        bucket = periods[idx]["outflows" if e["direction"] == "outflow" else "inflows"]
        bucket[e["category"]] += e["amount"]

    # Cost of funding: interest on the overdrawn balance, period by period.
    cumulative = 0.0
    peak_funding = 0.0
    peak_idx: Optional[int] = None
    last_negative_idx: Optional[int] = None
    funding_cost = 0.0
    for i, p in enumerate(periods):
        total_out = sum(p["outflows"].values())
        total_in = sum(p["inflows"].values())
        net = total_in - total_out
        cumulative += net
        days_in_period = (p["end_date"] - p["start_date"]).days + 1
        if cumulative < 0:
            funding_cost += -cumulative * (a.finance_rate_pct / 100.0) * days_in_period / 365.0
            last_negative_idx = i
        if -cumulative > peak_funding + 1e-9:
            peak_funding = -cumulative
            peak_idx = i
        p["total_outflow"] = round(total_out, 2)
        p["total_inflow"] = round(total_in, 2)
        p["net"] = round(net, 2)
        p["cumulative"] = round(cumulative, 2)
        p["outflows"] = {k: round(v, 2) for k, v in p["outflows"].items()}
        p["inflows"] = {k: round(v, 2) for k, v in p["inflows"].items()}
        p["start_date"] = p["start_date"].isoformat()
        p["end_date"] = p["end_date"].isoformat()

    duration_days = a.duration_weeks * 7
    retention_total = a.contract_value * a.retention_pct / 100.0

    cash_positive = None
    if last_negative_idx is None:
        cash_positive = {"index": 1, "label": periods[0]["label"], "date": periods[0]["start_date"]} if periods else None
    elif last_negative_idx + 1 < len(periods):
        nxt = periods[last_negative_idx + 1]
        cash_positive = {"index": nxt["index"], "label": nxt["label"], "date": nxt["end_date"]}

    total_in = sum(p["total_inflow"] for p in periods)
    total_out = sum(p["total_outflow"] for p in periods)
    margin = a.contract_value - a.project_cost
    pc_date = start + timedelta(days=duration_days)

    warnings = []
    if a.contract_value <= 0:
        warnings.append("No contract value - enter one to see the curve.")
    elif a.project_cost >= a.contract_value:
        warnings.append("Project cost is at or above the contract value - this job loses money before funding costs.")
    if a.deposit_pct + a.retention_pct >= 100:
        warnings.append("Deposit recovery plus retention take the whole of every claim.")

    return {
        "warnings": warnings,
        "granularity": granularity,
        "start_date": start.isoformat(),
        "practical_completion_date": pc_date.isoformat(),
        "final_retention_release_date": (pc_date + timedelta(days=a.defects_period_days + a.client_payment_days)).isoformat(),
        "periods": periods,
        "summary": {
            "contract_value": round(a.contract_value, 2),
            "project_cost": round(a.project_cost, 2),
            "margin": round(margin, 2),
            "margin_pct": round(margin / a.contract_value * 100, 2) if a.contract_value else None,
            "peak_funding": round(peak_funding, 2),
            "peak_funding_pct_of_contract": round(peak_funding / a.contract_value * 100, 2) if a.contract_value else None,
            "peak_period": periods[peak_idx]["label"] if peak_idx is not None else None,
            "peak_date": periods[peak_idx]["end_date"] if peak_idx is not None else None,
            "cash_positive_period": cash_positive["label"] if cash_positive else None,
            "cash_positive_date": cash_positive["date"] if cash_positive else None,
            "never_cash_positive": cash_positive is None,
            # Retention builds up claim by claim and peaks at practical completion.
            "retention_locked": round(retention_total, 2),
            "retention_held_through_defects": round(retention_total * (1 - a.retention_release_at_pc_pct / 100.0), 2),
            "deposit_amount": round(a.contract_value * a.deposit_pct / 100.0, 2),
            "funding_cost": round(funding_cost, 2),
            "margin_after_funding": round(margin - funding_cost, 2),
            "total_inflow": round(total_in, 2),
            "total_outflow": round(total_out, 2),
        },
    }


# ---------------------------------------------------------------------------
# Defaults from real data
# ---------------------------------------------------------------------------

def _num(value: Any) -> Optional[float]:
    try:
        return float(value) if value not in (None, "") else None
    except (TypeError, ValueError):
        return None


def default_duration_weeks(contract_value: float) -> int:
    """Rough programme length by job size - used only when nothing better is
    recorded. Always shown as an editable estimate."""
    if contract_value < 50_000:
        return 8
    if contract_value < 250_000:
        return 16
    if contract_value < 1_000_000:
        return 26
    return 52


def derive_quotation_economics(quote_amount: Any, metadata: Optional[dict]) -> dict:
    """Contract value (ex-VAT), project cost, preliminaries and cost mix from
    a quotation's stored metadata, with a ``source`` note for each."""
    md = metadata or {}
    notes: dict[str, str] = {}

    taxable = _num(md.get("taxable_amount"))
    subtotal = _num(md.get("subtotal"))
    discount = _num(md.get("discount_amount")) or _num(md.get("discount")) or 0.0
    tax = _num(md.get("tax_amount")) or 0.0
    if taxable:
        contract_value = taxable
        notes["contract_value"] = "Quotation taxable amount (ex-VAT)."
    elif subtotal:
        contract_value = max(0.0, subtotal - discount)
        notes["contract_value"] = "Quotation subtotal less discount (ex-VAT)."
    else:
        contract_value = max(0.0, (_num(quote_amount) or _num(md.get("grand_total")) or 0.0) - tax)
        notes["contract_value"] = "Quotation amount."

    direct = _num(md.get("direct_costs"))
    prelims = _num(md.get("preliminaries")) or 0.0
    prov_sums = _num(md.get("provisional_sums")) or 0.0
    o = (_num(md.get("overhead_pct")) or 0.0) / 100.0
    c = (_num(md.get("contingency_pct")) or 0.0) / 100.0
    pr = (_num(md.get("profit_pct")) or 0.0) / 100.0
    priced_boq_without_markup = bool(direct) and not (o or c or pr) and direct + prelims >= contract_value * 0.999
    if direct and not priced_boq_without_markup:
        base = direct + prelims
        contingency = _num(md.get("contingency_amount"))
        contingency = contingency if contingency is not None else base * c
        project_cost = base + contingency + prov_sums
        notes["project_cost"] = "BOQ direct cost + preliminaries + provisional sums + contingency (assumed spent)."
    elif o or c or pr:
        base = max(0.0, contract_value + discount - prov_sums) / (1 + o + c + pr)
        project_cost = base * (1 + c) + prov_sums
        notes["project_cost"] = "Back-calculated from the quotation's overhead/contingency/profit %."
    elif priced_boq_without_markup:
        project_cost = contract_value / (1 + DEFAULT_MARKUP_WHEN_UNKNOWN)
        notes["project_cost"] = (
            "The BOQ rates equal the selling price (no overhead/profit recorded), so they look like client rates, "
            f"not costs - assumed a {int(DEFAULT_MARKUP_WHEN_UNKNOWN * 100)}% markup. Edit it."
        )
    else:
        project_cost = contract_value / (1 + DEFAULT_MARKUP_WHEN_UNKNOWN)
        notes["project_cost"] = f"No cost build-up on this quotation - assumed a {int(DEFAULT_MARKUP_WHEN_UNKNOWN * 100)}% markup. Edit it."

    mix = dict(DEFAULT_COST_MIX)
    breakdown = ((md.get("breakdown_log") or {}).get("direct_costs_breakdown") or {})
    categories = {
        "materials": (_num(breakdown.get("materials")) or 0) + (_num(breakdown.get("transport")) or 0) + (_num(breakdown.get("waste_allowance")) or 0),
        "labour": _num(breakdown.get("labour")) or 0,
        "plant": _num(breakdown.get("equipment")) or 0,
        "subcontract": _num(breakdown.get("subcontractors")) or 0,
    }
    if sum(categories.values()) > 0:
        total = sum(categories.values())
        mix = {k: round(v / total, 4) for k, v in categories.items()}
        notes["cost_mix"] = "From the quotation's rate build-up."
    else:
        notes["cost_mix"] = "No rate build-up recorded - typical mix (45% materials, 25% labour, 10% plant, 20% subcontract)."

    return {
        "contract_value": round(contract_value, 2),
        "project_cost": round(project_cost, 2),
        "preliminaries": round(prelims, 2),
        "mix": mix,
        "notes": notes,
    }


async def org_supplier_payment_days(db: AsyncSession, org_id: str) -> Optional[int]:
    row = (await db.execute(
        text("""
            SELECT AVG(payment_terms_days) AS avg_days
            FROM procurement.suppliers
            WHERE organization_id = :org_id AND is_deleted = false AND payment_terms_days IS NOT NULL
        """),
        {"org_id": org_id},
    )).mappings().first()
    return int(round(float(row["avg_days"]))) if row and row["avg_days"] is not None else None


async def _shared_defaults(
    db: AsyncSession, org_id: str, client_org_id: Optional[str], client_name: Optional[str]
) -> tuple[dict, dict]:
    values: dict[str, Any] = {}
    sources: dict[str, str] = {}
    collection = await client_collection_days(db, org_id, client_org_id, client_name=client_name)
    values["client_payment_days"] = collection["days_after_submission"]
    if collection["source"] == "measured":
        sources["client_payment_days"] = (
            f"This client's actual median over {collection['paid_claims_measured']} paid claims "
            "(claim submission to final receipt)."
        )
    else:
        sources["client_payment_days"] = (
            f"Company default ({collection['days_after_submission']} days from claim to receipt) - "
            f"fewer than {MIN_PAID_CLAIMS} paid claims with receipts on record for this client."
        )
    supplier_days = await org_supplier_payment_days(db, org_id)
    if supplier_days is not None:
        values["supplier_payment_days"] = supplier_days
        sources["supplier_payment_days"] = "Average payment terms across your suppliers."
    return values, sources


def _assemble(economics: dict, extra: dict, sources: dict) -> tuple[CashCurveAssumptions, dict]:
    mix = economics["mix"]
    base = {
        "contract_value": economics["contract_value"],
        "project_cost": economics["project_cost"],
        "preliminaries": economics["preliminaries"],
        "mobilisation_cost": round(economics["preliminaries"] * 0.25, 2),
        "materials_share": mix["materials"],
        "labour_share": mix["labour"],
        "plant_share": mix["plant"],
        "subcontract_share": mix["subcontract"],
        "duration_weeks": default_duration_weeks(economics["contract_value"]),
    }
    base.update(extra)
    all_sources = {
        "contract_value": economics["notes"]["contract_value"],
        "project_cost": economics["notes"]["project_cost"],
        "cost_mix": economics["notes"]["cost_mix"],
        "duration_weeks": "Estimated from job size - set the real programme length.",
        "mobilisation_cost": "25% of preliminaries, paid before work starts.",
        "retention_pct": "Typical 10% retention.",
        "deposit_pct": "No deposit assumed - enter the tender's advance payment terms.",
        "finance_rate_pct": "Assumed overdraft rate used to cost the funding requirement.",
    }
    all_sources.update(sources)
    return CashCurveAssumptions.from_dict(base), all_sources


async def load_quotation_defaults(db: AsyncSession, org_id: str, quotation_id: str) -> Optional[tuple[CashCurveAssumptions, dict, dict]]:
    row = (await db.execute(
        text("""
            SELECT q.id, q.quote_amount, q.metadata, q.client_name, q.client_org_id, q.project_id, q.tender_id,
                   q.opportunity_id, q.status,
                   p.deposit_required_amount, p.contract_value AS project_contract_value,
                   p.start_date, p.planned_completion_date
            FROM finance.quotations q
            LEFT JOIN projects.projects p ON p.id = q.project_id AND p.organization_id = q.organization_id AND p.is_deleted = false
            WHERE q.id = CAST(:qid AS uuid) AND q.organization_id = :org_id AND q.is_deleted = false
        """),
        {"qid": quotation_id, "org_id": org_id},
    )).mappings().first()
    if not row:
        return None
    md = row["metadata"] if isinstance(row["metadata"], dict) else {}
    economics = derive_quotation_economics(row["quote_amount"], md)
    extra, sources = await _shared_defaults(db, org_id, row["client_org_id"], row["client_name"])
    _apply_project_terms(row, economics["contract_value"], extra, sources)
    assumptions, all_sources = _assemble(economics, extra, sources)
    context = {
        "kind": "quotation",
        "id": str(row["id"]),
        "label": md.get("reference_number") or md.get("project_title") or row["client_name"] or "Quotation",
        "project_title": md.get("project_title"),
        "client_name": row["client_name"],
        "status": row["status"],
        "project_id": str(row["project_id"]) if row["project_id"] else None,
    }
    return assumptions, all_sources, context


def _apply_project_terms(row: Any, contract_value: float, extra: dict, sources: dict) -> None:
    deposit = _num(row.get("deposit_required_amount"))
    if deposit and contract_value:
        extra["deposit_pct"] = round(min(100.0, deposit / contract_value * 100), 2)
        sources["deposit_pct"] = "Deposit required on the linked project."
    start, end = row.get("start_date"), row.get("planned_completion_date")
    if start:
        extra["start_date"] = start
        sources["start_date"] = "Linked project start date."
    if start and end and end > start:
        extra["duration_weeks"] = max(1, round((end - start).days / 7))
        sources["duration_weeks"] = "Linked project start to planned completion."


async def load_project_defaults(db: AsyncSession, org_id: str, project_id: str) -> Optional[tuple[CashCurveAssumptions, dict, dict]]:
    row = (await db.execute(
        text("""
            SELECT p.id, p.name, p.project_code, p.contract_value, p.client_name, p.client_org_id,
                   p.start_date, p.planned_completion_date, p.deposit_required_amount, p.status,
                   q.quote_amount, q.metadata,
                   (SELECT pc.retention_pct FROM finance.progress_claims pc
                    WHERE pc.project_id = p.id AND pc.organization_id = p.organization_id AND pc.is_deleted = false
                      AND pc.retention_pct IS NOT NULL
                    ORDER BY pc.claim_period_end DESC NULLS LAST, pc.created_at DESC LIMIT 1) AS claim_retention_pct
            FROM projects.projects p
            LEFT JOIN finance.quotations q ON q.id = p.quotation_id AND q.organization_id = p.organization_id AND q.is_deleted = false
            WHERE p.id = CAST(:pid AS uuid) AND p.organization_id = :org_id AND p.is_deleted = false
        """),
        {"pid": project_id, "org_id": org_id},
    )).mappings().first()
    if not row:
        return None
    md = row["metadata"] if isinstance(row["metadata"], dict) else {}
    economics = derive_quotation_economics(row["quote_amount"] if row["quote_amount"] is not None else row["contract_value"], md)
    project_value = _num(row["contract_value"])
    if project_value:
        if economics["contract_value"] and economics["contract_value"] != project_value:
            ratio = economics["project_cost"] / economics["contract_value"]
            economics["project_cost"] = round(project_value * ratio, 2)
            economics["notes"]["project_cost"] += " Scaled to the project's contract value."
        economics["contract_value"] = project_value
        economics["notes"]["contract_value"] = "Project contract value."
    extra, sources = await _shared_defaults(db, org_id, row["client_org_id"], row["client_name"])
    _apply_project_terms(row, economics["contract_value"], extra, sources)
    if row["claim_retention_pct"] is not None:
        extra["retention_pct"] = float(row["claim_retention_pct"])
        sources["retention_pct"] = "Retention % on this project's latest progress claim."
    assumptions, all_sources = _assemble(economics, extra, sources)
    context = {
        "kind": "project",
        "id": str(row["id"]),
        "label": row["project_code"] or row["name"],
        "project_title": row["name"],
        "client_name": row["client_name"],
        "status": row["status"],
        "project_id": str(row["id"]),
    }
    return assumptions, all_sources, context


def compute_scenarios(defaults: CashCurveAssumptions, scenarios: list[dict], today: Optional[date] = None) -> list[dict]:
    """One curve per requested scenario, each = defaults + its overrides."""
    if not scenarios:
        scenarios = [{"name": "Base case", "assumptions": {}}]
    results = []
    for i, sc in enumerate(scenarios):
        assumptions = defaults.merged(sc.get("assumptions") or {})
        curve = build_cash_curve(assumptions, today=today)
        results.append({
            "name": (sc.get("name") or f"Scenario {i + 1}")[:80],
            "assumptions": assumptions.to_dict(),
            **curve,
        })
    return results


__all__ = [
    "CashCurveAssumptions", "build_cash_events", "build_cash_curve", "compute_scenarios",
    "cumulative_progress", "derive_quotation_economics", "load_project_defaults",
    "load_quotation_defaults",
]
