"""Live cost sources for rate build-ups, and build-up templates.

Every candidate carries where it came from (source_type + source_ref), the
date of that price and its currency (None when the source does not record
one - never guessed). A build-up resource picked from here keeps those keys,
so a later refresh can look the same source up again and show what moved.

  inventory        procurement.inventory_items: unit price ex VAT, else the
                   standard cost.
  purchase_order   latest approved/issued PO line for the stock item (or the
                   exact PO line when it has no stock item).
  vendor_rate      active supplier / subcontractor rate card lines.
  fleet_operating  fleet.fleet hourly operating cost (what running it costs).
  fleet_charge     fleet.fleet internal hourly charge rate (what a project
                   is charged for it).
  site_labour      median hourly rate of ACTIVE site workers per trade and
                   currency. Only trades with at least LABOUR_MIN_SAMPLE
                   workers are shown and no names, so one person's pay is
                   never readable from the estimate.

Templates: finance.construction_assemblies (migration 280). Workspace
templates keep resources natively; legacy/default assemblies are converted
from their recipes. Applying a template copies its resources.
"""

from __future__ import annotations

import json
from decimal import Decimal
from typing import Any, Dict, Iterable, List, Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

SOURCE_TYPES = ("inventory", "purchase_order", "vendor_rate", "fleet_operating", "fleet_charge", "site_labour")
PO_PRICED_STATUSES = ("approved", "issued", "partially_received", "received", "invoiced", "closed")
LABOUR_MIN_SAMPLE = 3
VENDOR_RESOURCE_TYPE = {"material": "material", "transport": "transport", "service": "subcontractor"}
RESOURCE_TYPES = ("material", "labour", "equipment", "subcontractor", "transport", "waste_allowance")


def _num(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _day(value: Any) -> Optional[str]:
    return value.date().isoformat() if hasattr(value, "date") and callable(value.date) else (value.isoformat() if value else None)


def _candidate(**kw: Any) -> Dict[str, Any]:
    kw["rate"] = round(kw["rate"], 4)
    return kw


async def _inventory(db: AsyncSession, org_id: str, q: str, ids: Optional[List[str]], limit: int) -> List[Dict[str, Any]]:
    rows = await db.execute(
        text(
            """
            SELECT id, item_code, item_name, unit_of_measure, unit_price_ex_vat, standard_cost, updated_at
            FROM procurement.inventory_items
            WHERE organization_id = :org AND COALESCE(is_deleted, false) = false
              AND COALESCE(unit_price_ex_vat, standard_cost, 0) > 0
              AND (CAST(:ids AS uuid[]) IS NULL OR id = ANY(CAST(:ids AS uuid[])))
              AND (CAST(:q AS text) = '' OR item_name ILIKE '%' || CAST(:q AS text) || '%'
                   OR item_code ILIKE '%' || CAST(:q AS text) || '%')
            ORDER BY item_name
            LIMIT :limit
            """
        ),
        {"org": org_id, "q": q, "ids": ids, "limit": limit},
    )
    out = []
    for r in rows:
        ex_vat = _num(r.unit_price_ex_vat)
        rate = ex_vat if ex_vat and ex_vat > 0 else _num(r.standard_cost)
        out.append(_candidate(
            source_type="inventory", source_ref=str(r.id), resource_type="material",
            name=r.item_name, code=r.item_code, unit=r.unit_of_measure or "", rate=rate,
            currency=None, date=_day(r.updated_at),
            detail="Stock item, unit price ex VAT" if ex_vat and ex_vat > 0 else "Stock item, standard cost",
        ))
    return out


async def _purchase_orders(db: AsyncSession, org_id: str, q: str, refs: Optional[List[str]], limit: int) -> List[Dict[str, Any]]:
    """Latest priced PO line per stock item (or per PO line without one).
    ref 'item:<inventory id>' follows the item to its newest PO; 'line:<po
    line id>' is that one PO line."""
    item_ids = [r[5:] for r in refs or [] if r.startswith("item:")] or None
    line_ids = [r[5:] for r in refs or [] if r.startswith("line:")] or None
    by_ref = refs is not None
    rows = await db.execute(
        text(
            """
            SELECT DISTINCT ON (COALESCE(l.item_id::text, l.id::text))
                   l.id, l.item_id, l.description, l.unit_of_measure, l.unit_price,
                   po.po_number, po.currency,
                   COALESCE(po.issued_at, po.approved_at, po.created_at) AS priced_at,
                   COALESCE(s.trading_name, s.supplier_name) AS supplier
            FROM procurement.purchase_order_lines l
            JOIN procurement.purchase_orders po ON po.id = l.po_id AND po.organization_id = l.organization_id
            LEFT JOIN procurement.suppliers s ON s.id = po.supplier_id
            WHERE l.organization_id = :org
              AND COALESCE(l.is_deleted, false) = false AND COALESCE(po.is_deleted, false) = false
              AND po.status = ANY(CAST(:statuses AS text[]))
              AND l.unit_price > 0
              AND (NOT CAST(:by_ref AS boolean)
                   OR l.item_id = ANY(COALESCE(CAST(:item_ids AS uuid[]), '{}'))
                   OR (l.item_id IS NULL AND l.id = ANY(COALESCE(CAST(:line_ids AS uuid[]), '{}'))))
              AND (CAST(:q AS text) = '' OR l.description ILIKE '%' || CAST(:q AS text) || '%'
                   OR po.po_number ILIKE '%' || CAST(:q AS text) || '%')
            ORDER BY COALESCE(l.item_id::text, l.id::text), COALESCE(po.issued_at, po.approved_at, po.created_at) DESC
            LIMIT :limit
            """
        ),
        {"org": org_id, "q": q, "statuses": list(PO_PRICED_STATUSES), "by_ref": by_ref,
         "item_ids": item_ids, "line_ids": line_ids, "limit": limit},
    )
    return [
        _candidate(
            source_type="purchase_order",
            source_ref=f"item:{r.item_id}" if r.item_id else f"line:{r.id}",
            resource_type="material", name=r.description or "PO line", code=r.po_number,
            unit=r.unit_of_measure or "", rate=_num(r.unit_price), currency=r.currency,
            date=_day(r.priced_at), detail=f"{r.po_number}{' · ' + r.supplier if r.supplier else ''} (latest PO price, ex VAT)",
        )
        for r in rows
    ]


async def _vendor_rates(db: AsyncSession, org_id: str, q: str, ids: Optional[List[str]], limit: int) -> List[Dict[str, Any]]:
    rows = await db.execute(
        text(
            """
            SELECT v.id, v.rate_type, v.item_code, v.description, v.unit_of_measure, v.unit_price,
                   v.currency, v.effective_from, v.updated_at, v.route_from, v.route_to, s.name AS vendor
            FROM procurement.vendor_rate_items v
            LEFT JOIN crm.subcontractors s ON s.id = v.subcontractor_id
            WHERE v.organization_id = :org AND COALESCE(v.is_deleted, false) = false AND v.is_active
              AND (v.effective_from IS NULL OR v.effective_from <= CURRENT_DATE)
              AND (v.effective_to IS NULL OR v.effective_to >= CURRENT_DATE)
              AND (CAST(:ids AS uuid[]) IS NULL OR v.id = ANY(CAST(:ids AS uuid[])))
              AND (CAST(:q AS text) = '' OR v.description ILIKE '%' || CAST(:q AS text) || '%'
                   OR v.item_code ILIKE '%' || CAST(:q AS text) || '%' OR s.name ILIKE '%' || CAST(:q AS text) || '%')
            ORDER BY v.description
            LIMIT :limit
            """
        ),
        {"org": org_id, "q": q, "ids": ids, "limit": limit},
    )
    out = []
    for r in rows:
        route = f" {r.route_from}→{r.route_to}" if r.route_from or r.route_to else ""
        out.append(_candidate(
            source_type="vendor_rate", source_ref=str(r.id),
            resource_type=VENDOR_RESOURCE_TYPE.get(r.rate_type, "subcontractor"),
            name=(r.description or r.item_code or "Rate card line") + route, code=r.item_code,
            unit=r.unit_of_measure or "", rate=_num(r.unit_price), currency=r.currency,
            date=_day(r.effective_from or r.updated_at), detail=f"Rate card{' · ' + r.vendor if r.vendor else ''}",
        ))
    return out


async def _fleet(db: AsyncSession, org_id: str, q: str, ids: Optional[List[str]], kinds: Iterable[str], limit: int) -> List[Dict[str, Any]]:
    rows = await db.execute(
        text(
            """
            SELECT id, asset_code, vehicle_registration, make, model, vehicle_type, asset_type,
                   capacity_description, hourly_operating_cost, hourly_charge_rate, updated_at
            FROM fleet.fleet
            WHERE organization_id = :org AND COALESCE(is_deleted, false) = false
              AND retired_on IS NULL AND COALESCE(disposal_status, '') NOT IN ('disposed', 'sold', 'written_off')
              AND (COALESCE(hourly_operating_cost, 0) > 0 OR COALESCE(hourly_charge_rate, 0) > 0)
              AND (CAST(:ids AS uuid[]) IS NULL OR id = ANY(CAST(:ids AS uuid[])))
              AND (CAST(:q AS text) = '' OR concat_ws(' ', asset_code, vehicle_registration, make, model,
                       vehicle_type, asset_type, capacity_description) ILIKE '%' || CAST(:q AS text) || '%')
            ORDER BY COALESCE(vehicle_type, asset_type), asset_code
            LIMIT :limit
            """
        ),
        {"org": org_id, "q": q, "ids": ids, "limit": limit},
    )
    out = []
    for r in rows:
        kind = " ".join(p for p in (r.make, r.model) if p) or r.vehicle_type or r.asset_type or "Plant"
        label = f"{kind}{' ' + r.capacity_description if r.capacity_description else ''} ({r.asset_code or r.vehicle_registration or 'fleet'})"
        if "fleet_operating" in kinds and _num(r.hourly_operating_cost):
            out.append(_candidate(
                source_type="fleet_operating", source_ref=str(r.id), resource_type="equipment", name=label,
                code=r.asset_code, unit="hr", rate=_num(r.hourly_operating_cost), currency=None,
                date=_day(r.updated_at), detail="Own fleet, hourly operating cost",
            ))
        if "fleet_charge" in kinds and _num(r.hourly_charge_rate):
            out.append(_candidate(
                source_type="fleet_charge", source_ref=str(r.id), resource_type="equipment", name=label,
                code=r.asset_code, unit="hr", rate=_num(r.hourly_charge_rate), currency=None,
                date=_day(r.updated_at), detail="Own fleet, internal hourly charge rate",
            ))
    return out


async def _labour(db: AsyncSession, org_id: str, q: str, refs: Optional[List[str]], limit: int) -> List[Dict[str, Any]]:
    """ref = '<trade lower-case>|<currency>'."""
    rows = await db.execute(
        text(
            """
            SELECT lower(trim(trade)) AS trade_key, min(trim(trade)) AS trade, currency,
                   percentile_cont(0.5) WITHIN GROUP (ORDER BY hourly_rate) AS median_rate,
                   count(*) AS workers, max(updated_at) AS latest
            FROM finance.site_workers
            WHERE organization_id = :org AND COALESCE(is_deleted, false) = false AND status = 'active'
              AND hourly_rate > 0 AND COALESCE(trim(trade), '') <> ''
              AND (CAST(:q AS text) = '' OR trade ILIKE '%' || CAST(:q AS text) || '%')
            GROUP BY lower(trim(trade)), currency
            HAVING count(*) >= :min_sample
            ORDER BY 2
            LIMIT :limit
            """
        ),
        {"org": org_id, "q": q, "min_sample": LABOUR_MIN_SAMPLE, "limit": limit if refs is None else 1000},
    )
    wanted = set(refs) if refs is not None else None
    out = []
    for r in rows:
        ref = f"{r.trade_key}|{r.currency or ''}"
        if wanted is not None and ref not in wanted:
            continue
        out.append(_candidate(
            source_type="site_labour", source_ref=ref, resource_type="labour", name=r.trade, code=None,
            unit="hr", rate=_num(r.median_rate), currency=r.currency, date=_day(r.latest),
            detail=f"Median hourly rate of {r.workers} active site workers",
        ))
    return out


def _sources_for(resource_type: Optional[str]) -> List[str]:
    return {
        "material": ["inventory", "purchase_order", "vendor_rate"],
        "transport": ["vendor_rate"],
        "subcontractor": ["vendor_rate"],
        "equipment": ["fleet_operating", "fleet_charge"],
        "labour": ["site_labour"],
    }.get(resource_type or "", list(SOURCE_TYPES))


async def search_rate_sources(db: AsyncSession, org_id: str, q: str = "", resource_type: Optional[str] = None, limit: int = 15) -> List[Dict[str, Any]]:
    q = (q or "").strip()[:100]
    sources = _sources_for(resource_type)
    out: List[Dict[str, Any]] = []
    if "inventory" in sources:
        out += await _inventory(db, org_id, q, None, limit)
    if "purchase_order" in sources:
        out += await _purchase_orders(db, org_id, q, None, limit)
    if "vendor_rate" in sources:
        found = await _vendor_rates(db, org_id, q, None, limit)
        out += [c for c in found if resource_type in (None, "", c["resource_type"])]
    fleet_kinds = [s for s in ("fleet_operating", "fleet_charge") if s in sources]
    if fleet_kinds:
        out += await _fleet(db, org_id, q, None, fleet_kinds, limit)
    if "site_labour" in sources:
        out += await _labour(db, org_id, q, None, limit)
    return out


async def resolve_rate_sources(db: AsyncSession, org_id: str, refs: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    """Current value of each (source_type, source_ref). Keyed
    'source_type:source_ref'; a source that no longer exists (deleted item,
    retired plant, trade below the sample size) is absent from the result."""
    grouped: Dict[str, List[str]] = {}
    for ref in refs[:2000]:
        st, sr = str(ref.get("source_type") or ""), str(ref.get("source_ref") or "")
        if st in SOURCE_TYPES and sr:
            grouped.setdefault(st, [])
            if sr not in grouped[st]:
                grouped[st].append(sr)
    found: List[Dict[str, Any]] = []
    big = 5000

    def _uuids(values: List[str]) -> List[str]:
        import uuid as _uuid
        ok = []
        for v in values:
            try:
                ok.append(str(_uuid.UUID(v)))
            except ValueError:
                continue
        return ok

    if grouped.get("inventory"):
        found += await _inventory(db, org_id, "", _uuids(grouped["inventory"]) or ["00000000-0000-0000-0000-000000000000"], big)
    if grouped.get("purchase_order"):
        po_refs = [r for r in grouped["purchase_order"] if r[:5] in ("item:", "line:") and _uuids([r[5:]])]
        if po_refs:
            found += await _purchase_orders(db, org_id, "", po_refs, big)
    if grouped.get("vendor_rate"):
        found += await _vendor_rates(db, org_id, "", _uuids(grouped["vendor_rate"]) or ["00000000-0000-0000-0000-000000000000"], big)
    fleet_ids = _uuids(grouped.get("fleet_operating", []) + grouped.get("fleet_charge", []))
    if fleet_ids:
        fleet = await _fleet(db, org_id, "", fleet_ids, ("fleet_operating", "fleet_charge"), big)
        wanted = {("fleet_operating", r) for r in grouped.get("fleet_operating", [])} | {("fleet_charge", r) for r in grouped.get("fleet_charge", [])}
        found += [c for c in fleet if (c["source_type"], c["source_ref"]) in wanted]
    if grouped.get("site_labour"):
        found += await _labour(db, org_id, "", grouped["site_labour"], big)
    return {f"{c['source_type']}:{c['source_ref']}": c for c in found}


# ---------------------------------------------------------------- templates

def _dec(value: Any) -> float:
    try:
        return float(Decimal(str(value)))
    except Exception:
        return 0.0


def clean_buildup(buildup: Any) -> List[Dict[str, Any]]:
    """Validated resources for a template: known type, a name, non-negative
    numbers. Source keys are kept so the template stays traceable."""
    out = []
    for b in buildup if isinstance(buildup, list) else []:
        if not isinstance(b, dict):
            continue
        rtype = b.get("type") if b.get("type") in RESOURCE_TYPES else None
        name = str(b.get("name") or "").strip()
        qty, rate = _dec(b.get("qty")), _dec(b.get("rate"))
        if not rtype or not name or qty < 0 or rate < 0:
            continue
        row = {"type": rtype, "name": name[:200], "qty": qty, "unit": str(b.get("unit") or "")[:30], "rate": rate}
        for key in ("currency", "source", "source_date", "source_type", "source_ref", "spec", "conversion_note"):
            if b.get(key) not in (None, ""):
                row[key] = str(b[key])[:300]
        out.append(row)
    return out


def buildup_to_legacy_recipe(resources: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    """The subset the legacy assembly calculator understands. Wastage is
    already inside the workspace quantities (or a waste_allowance line), so
    templates are stored with wastage_tolerance_pct = 0."""
    return {
        "material_recipe": [{"material": r["name"], "quantity_per_unit": r["qty"], "unit": r["unit"], "unit_cost": r["rate"]} for r in resources if r["type"] == "material"],
        "labour_gang": [{"role": r["name"], "hours_per_unit": r["qty"], "hourly_rate": r["rate"]} for r in resources if r["type"] == "labour"],
        "plant_needs": [{"equipment": r["name"], "hours_per_unit": r["qty"], "hourly_rate": r["rate"]} for r in resources if r["type"] == "equipment"],
    }


def assembly_to_buildup(assembly: Dict[str, Any]) -> List[Dict[str, Any]]:
    """A template as workspace build-up lines. Native resources when saved
    from the workspace; otherwise converted from the legacy recipe, with the
    assembly's wastage % applied to material quantities and noted."""
    if isinstance(assembly.get("resources"), list) and assembly["resources"]:
        return [dict(r) for r in assembly["resources"]]
    wastage = _dec(assembly.get("wastage_tolerance_pct"))
    factor = 1 + wastage / 100.0
    out: List[Dict[str, Any]] = []
    for m in assembly.get("material_recipe") or []:
        out.append({
            "type": "material", "name": m.get("material") or "Material", "qty": round(_dec(m.get("quantity_per_unit")) * factor, 6),
            "unit": m.get("unit") or "", "rate": _dec(m.get("unit_cost")),
            **({"conversion_note": f"includes {wastage:g}% wastage from the library recipe"} if wastage else {}),
        })
    for lab in assembly.get("labour_gang") or []:
        out.append({"type": "labour", "name": lab.get("role") or "Labour", "qty": _dec(lab.get("hours_per_unit")), "unit": "hr", "rate": _dec(lab.get("hourly_rate"))})
    for p in assembly.get("plant_needs") or []:
        out.append({"type": "equipment", "name": p.get("equipment") or "Plant", "qty": _dec(p.get("hours_per_unit")), "unit": "hr", "rate": _dec(p.get("hourly_rate"))})
    return out


async def list_templates(db: AsyncSession, org_id: str, defaults: Dict[str, Dict[str, Any]]) -> List[Dict[str, Any]]:
    rows = await db.execute(
        text(
            """
            SELECT id, assembly_code, name, category, unit, material_recipe, labour_gang, plant_needs,
                   wastage_tolerance_pct, resources, template_version, currency, source_quotation_id,
                   created_by, created_at, updated_at, notes
            FROM finance.construction_assemblies
            WHERE organization_id = :org AND is_deleted = false
            ORDER BY updated_at DESC
            """
        ),
        {"org": org_id},
    )
    custom: Dict[str, Dict[str, Any]] = {}
    for r in rows:
        code = (r.assembly_code or "").upper()
        if code in custom:  # legacy duplicates: newest wins, as the list is newest first
            continue
        a = {
            "id": str(r.id), "assembly_code": code, "name": r.name, "category": r.category, "unit": r.unit,
            "material_recipe": r.material_recipe, "labour_gang": r.labour_gang, "plant_needs": r.plant_needs,
            "wastage_tolerance_pct": _dec(r.wastage_tolerance_pct), "resources": r.resources,
        }
        custom[code] = {
            "id": a["id"], "code": code, "name": r.name, "category": r.category, "unit": r.unit or "",
            "version": r.template_version, "currency": r.currency, "origin": "workspace" if r.resources else "custom",
            "source_quotation_id": str(r.source_quotation_id) if r.source_quotation_id else None,
            "updated_at": _day(r.updated_at or r.created_at), "notes": r.notes, "buildup": assembly_to_buildup(a),
        }
    out = list(custom.values())
    for code, a in defaults.items():
        if code.upper() in custom:
            continue
        out.append({
            "id": None, "code": code, "name": a.get("name"), "category": a.get("category"), "unit": a.get("unit") or "",
            "version": None, "currency": None, "origin": "default", "source_quotation_id": None, "updated_at": None,
            "notes": "Built-in library recipe - unit costs are illustrative, not sourced. Re-price before use.",
            "buildup": assembly_to_buildup(a),
        })
    return out


async def save_template(
    db: AsyncSession, org_id: str, user_id: str, *, code: str, name: str, category: str, unit: str,
    currency: Optional[str], resources: List[Dict[str, Any]], source_quotation_id: Optional[str],
    source_line_id: Optional[str], notes: Optional[str],
) -> Dict[str, Any]:
    """New version row; the previous current row for the code is retired.
    Serialised per (org, code) by a transaction advisory lock. Caller commits."""
    await db.execute(text("SELECT pg_advisory_xact_lock(hashtext(CAST(:k AS text)))"), {"k": f"assembly:{org_id}:{code}"})
    prev = (await db.execute(
        text(
            """
            SELECT id, template_version FROM finance.construction_assemblies
            WHERE organization_id = :org AND upper(assembly_code) = :code AND is_deleted = false
            ORDER BY template_version DESC, updated_at DESC
            """
        ),
        {"org": org_id, "code": code},
    )).fetchall()
    version = (max((p.template_version or 1) for p in prev) + 1) if prev else 1
    legacy = buildup_to_legacy_recipe(resources)
    new_id = (await db.execute(
        text(
            """
            INSERT INTO finance.construction_assemblies (
                organization_id, assembly_code, name, category, unit,
                material_recipe, labour_gang, plant_needs,
                subcontractor_benchmark_rate, wastage_tolerance_pct, output_rate_per_day,
                resources, template_version, currency, source_quotation_id, source_line_id, created_by, notes
            ) VALUES (
                :org, :code, :name, :category, :unit,
                CAST(:mat AS jsonb), CAST(:lab AS jsonb), CAST(:plant AS jsonb),
                0, 0, 0,
                CAST(:resources AS jsonb), :version, :currency, CAST(:sq AS uuid), :sl, CAST(:uid AS uuid), :notes
            ) RETURNING id
            """
        ),
        {
            "org": org_id, "code": code, "name": name, "category": category, "unit": unit,
            "mat": json.dumps(legacy["material_recipe"]), "lab": json.dumps(legacy["labour_gang"]),
            "plant": json.dumps(legacy["plant_needs"]), "resources": json.dumps(resources), "version": version,
            "currency": currency, "sq": source_quotation_id, "sl": source_line_id, "uid": user_id, "notes": notes,
        },
    )).scalar_one()
    if prev:
        await db.execute(
            text(
                """
                UPDATE finance.construction_assemblies
                SET is_deleted = true, superseded_by = :new_id, updated_at = NOW()
                WHERE id = ANY(CAST(:ids AS uuid[]))
                """
            ),
            {"new_id": new_id, "ids": [str(p.id) for p in prev]},
        )
    return {"id": str(new_id), "code": code, "version": version, "superseded": [str(p.id) for p in prev]}
