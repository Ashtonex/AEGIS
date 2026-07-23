from datetime import datetime, timezone
import json
from pathlib import Path
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.encoders import jsonable_encoder
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.services.documents.renderers import (
    CommercialControlPDFRenderer,
    QuotationExcelExporter,
    QuotationPDFRenderer,
)
from app.services.quotations.boq_importer import BOQImporter
from app.services.quotations.calculator import QuotationCalculator
from app.services.quotations.intelligence_engine import (
    QuotationBrain,
    AssemblyLibrary,
    RateIntelligenceEngine,
    SpendForecaster,
    CommercialGuard,
    DocumentWatcher,
    FuzzyAssemblyMatcher,
    InflationForecaster,
    ScenarioSimulator,
    SubcontractorBenchmarkEngine,
    AutonomousQuoteBuilder,
    DEFAULT_ASSEMBLIES,
    RATE_BENCHMARKS,
)
from app.shared.events import emit_role_notification
from core.config import settings
from core.database import get_db
from core.security import SUPERADMIN_ROLE, get_current_user, require_permission
from app.shared.sql import (
    insert_returning_id_sql,
    safe_payload_columns,
    update_returning_id_sql,
)

router = APIRouter()

"""
Module: quotations
Description: Auto-generated CRUD endpoints for finance.quotations.
"""


def _document_output_path(
    quotation_id: str, revision_number: int, extension: str
) -> Path:
    safe_quote = (
        "".join(ch for ch in quotation_id if ch.isalnum() or ch in ("-", "_"))[:80]
        or "quotation"
    )
    output_dir = Path(settings.GENERATED_DOCUMENT_DIR) / "quotations"
    output_dir.mkdir(parents=True, exist_ok=True)
    return output_dir / f"{safe_quote}_rev{revision_number}.{extension}"

async def _persist_commercial_baseline(
    db: AsyncSession,
    user: dict,
    payload: Dict[str, Any],
    result: Dict[str, Any],
) -> Optional[str]:
    forecast = result.get("spend_forecast", {})
    metrics = result.get("metrics", {})
    insert_result = await db.execute(
        text(
            """
            INSERT INTO finance.project_commercial_baselines (
                organization_id, quotation_id, project_id, project_title,
                total_direct_costs, target_selling_price, protected_margin_pct, worthiness_score,
                weekly_cost_plan, monthly_cashflow, labour_histogram, margin_at_risk_curve
            ) VALUES (
                :org_id, :quotation_id, :project_id, :project_title,
                :total_direct_costs, :target_selling_price, :protected_margin_pct, :worthiness_score,
                CAST(:weekly_cost_plan AS jsonb), CAST(:monthly_cashflow AS jsonb),
                CAST(:labour_histogram AS jsonb), CAST(:margin_at_risk_curve AS jsonb)
            )
            RETURNING id
            """
        ),
        {
            "org_id": user["org_id"],
            "quotation_id": str(payload.get("quotation_id")) if payload.get("quotation_id") else None,
            "project_id": str(payload.get("project_id")) if payload.get("project_id") else None,
            "project_title": result.get("project_title", "Construction Project"),
            "total_direct_costs": metrics.get("total_direct_costs", 0),
            "target_selling_price": metrics.get("target_selling_price", 0),
            "protected_margin_pct": metrics.get("protected_margin_pct", 0),
            "worthiness_score": result.get("worthiness_score", 0),
            "weekly_cost_plan": json.dumps(forecast.get("weekly_cost_plan", []), default=str),
            "monthly_cashflow": json.dumps(forecast.get("monthly_cashflow", []), default=str),
            "labour_histogram": json.dumps(forecast.get("labour_histogram", []), default=str),
            "margin_at_risk_curve": json.dumps(forecast.get("margin_at_risk_curve", []), default=str),
        },
    )
    baseline_id = str(insert_result.scalar())

    # Sync baseline contract value to linked project
    project_id = str(payload.get("project_id")) if payload.get("project_id") else None
    if project_id:
        try:
            await db.execute(
                text(
                    """
                    UPDATE projects.projects
                    SET contract_value = :contract_val,
                        updated_at = NOW()
                    WHERE id = :project_id AND organization_id = :org_id
                    """
                ),
                {
                    "project_id": project_id,
                    "org_id": user["org_id"],
                    "contract_val": metrics.get("target_selling_price", 0),
                },
            )
        except Exception:
            pass

    return baseline_id


async def _load_autonomous_quote_source(
    db: AsyncSession,
    org_id: str,
    source_type: str,
    source_id: Optional[str],
) -> Dict[str, Any]:
    normalized = source_type.strip().lower()
    if normalized == "manual":
        return {"source_type": "manual", "source_id": source_id}

    if not source_id:
        raise HTTPException(status_code=400, detail="source_id is required for CRM and project quote sources.")

    source_queries = {
        "lead": "SELECT to_jsonb(l.*) AS item FROM crm.leads l WHERE l.id = :source_id AND l.organization_id = :org_id AND COALESCE(l.is_deleted, false) = false",
        "opportunity": "SELECT to_jsonb(o.*) AS item FROM crm.opportunities o WHERE o.id = :source_id AND o.organization_id = :org_id AND COALESCE(o.is_deleted, false) = false",
        "tender": "SELECT to_jsonb(t.*) AS item FROM crm.tenders t WHERE t.id = :source_id AND t.organization_id = :org_id AND COALESCE(t.is_deleted, false) = false",
        "project": "SELECT to_jsonb(p.*) AS item FROM projects.projects p WHERE p.id = :source_id AND p.organization_id = :org_id AND COALESCE(p.is_deleted, false) = false",
    }
    query = source_queries.get(normalized)
    if query is None:
        raise HTTPException(status_code=400, detail="source_type must be lead, opportunity, tender, project, or manual.")

    result = await db.execute(text(query), {"source_id": source_id, "org_id": org_id})
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail=f"{normalized} source record not found.")

    item = dict(row._mapping["item"] or {})
    item["source_type"] = normalized
    item["source_id"] = source_id
    return item

def _payload_with_calculation(payload: Dict[str, Any]) -> Dict[str, Any]:
    result = QuotationCalculator.calculate(payload)
    enriched = dict(payload)
    enriched.update(result.model_dump(mode="json"))
    enriched.setdefault(
        "project_title", payload.get("project_title", "Construction Quotation")
    )
    enriched.setdefault("reference_number", result.quotation_id)
    enriched.setdefault("items", payload.get("items", []))
    return enriched


def _assembly_row_to_dict(row: Any) -> Dict[str, Any]:
    return {
        "id": str(row.id),
        "assembly_code": row.assembly_code,
        "name": row.name,
        "category": row.category,
        "unit": row.unit,
        "material_recipe": row.material_recipe,
        "labour_gang": row.labour_gang,
        "plant_needs": row.plant_needs,
        "subcontractor_benchmark_rate": float(row.subcontractor_benchmark_rate),
        "wastage_tolerance_pct": float(row.wastage_tolerance_pct),
        "output_rate_per_day": float(row.output_rate_per_day),
    }


async def _load_org_assemblies(db: AsyncSession, org_id: str) -> Dict[str, Dict[str, Any]]:
    """Merges org-specific rows from finance.construction_assemblies over DEFAULT_ASSEMBLIES."""
    result = await db.execute(
        text(
            """
            SELECT id, assembly_code, name, category, unit, material_recipe, labour_gang,
                   plant_needs, subcontractor_benchmark_rate, wastage_tolerance_pct, output_rate_per_day
            FROM finance.construction_assemblies
            WHERE organization_id = :org_id AND is_deleted = false
            """
        ),
        {"org_id": org_id},
    )
    merged = dict(DEFAULT_ASSEMBLIES)
    for row in result:
        merged[row.assembly_code.upper()] = _assembly_row_to_dict(row)
    return merged


def _rate_row_to_dict(row: Any) -> Dict[str, Any]:
    return {
        "item_code": row.item_code,
        "category": row.category,
        "description": row.description,
        "unit": row.unit,
        "target_rate": float(row.target_rate),
        "supplier_rate": float(row.supplier_rate),
        "subcontractor_rate": float(row.subcontractor_rate),
        "last_po_rate": float(row.last_po_rate),
        "currency": row.currency,
        "escalation_pct": float(row.escalation_pct),
    }


async def _load_org_rate_benchmarks(db: AsyncSession, org_id: str) -> Dict[str, Dict[str, Any]]:
    """Merges org-specific rows from finance.rate_intelligence over RATE_BENCHMARKS."""
    result = await db.execute(
        text(
            """
            SELECT item_code, category, description, unit, target_rate, supplier_rate,
                   subcontractor_rate, last_po_rate, currency, escalation_pct
            FROM finance.rate_intelligence
            WHERE organization_id = :org_id AND is_deleted = false
            """
        ),
        {"org_id": org_id},
    )
    merged = dict(RATE_BENCHMARKS)
    for row in result:
        merged[row.item_code.upper()] = _rate_row_to_dict(row)
    return merged


@router.post("/calculate")
async def calculate_quotation(
    payload: Dict[str, Any],
    user: dict = Depends(get_current_user),
):
    result = QuotationCalculator.calculate(payload)
    return {
        "success": True,
        "data": jsonable_encoder(result.model_dump()),
        "message": "Quotation calculated.",
        "meta": {"user_id": user["user_id"]},
    }


@router.post("/boq/import")
async def import_boq(
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
):
    extension = Path(file.filename or "").suffix.lower()
    if extension not in {".xlsx", ".xls", ".csv"}:
        raise HTTPException(
            status_code=400,
            detail="Unsupported BOQ file type. Upload .xlsx, .xls, or .csv.",
        )

    content = await file.read()
    if len(content) > settings.FILE_STORAGE_MAX_BYTES:
        raise HTTPException(
            status_code=413, detail="BOQ file exceeds configured upload size limit."
        )

    result = BOQImporter.import_boq(content, extension)
    return {
        "success": bool(result.items),
        "data": jsonable_encoder(result.to_dict()),
        "message": "BOQ import completed.",
        "meta": {"user_id": user["user_id"], "filename": file.filename},
    }


@router.post("/exports/pdf")
async def export_quotation_pdf(
    payload: Dict[str, Any],
    user: dict = Depends(get_current_user),
):
    data = _payload_with_calculation(payload)
    output_path = _document_output_path(
        data.get("quotation_id", "quotation"),
        int(data.get("revision_number", 1)),
        "pdf",
    )
    QuotationPDFRenderer().render_pdf(data, str(output_path))
    return {
        "success": True,
        "data": {"path": str(output_path), "filename": output_path.name},
        "message": "Quotation PDF generated.",
        "meta": {"user_id": user["user_id"]},
    }


@router.post("/exports/excel")
async def export_quotation_excel(
    payload: Dict[str, Any],
    user: dict = Depends(get_current_user),
):
    data = _payload_with_calculation(payload)
    output_path = _document_output_path(
        data.get("quotation_id", "quotation"),
        int(data.get("revision_number", 1)),
        "xlsx",
    )
    QuotationExcelExporter().export_to_excel(data, str(output_path))
    return {
        "success": True,
        "data": {"path": str(output_path), "filename": output_path.name},
        "message": "Quotation Excel workbook generated.",
        "meta": {"user_id": user["user_id"]},
    }


# -----------------------------------------------------------------------------
# Quotation Intelligence Engine Endpoints
# -----------------------------------------------------------------------------

@router.post("/intelligence/evaluate")
async def evaluate_quotation_intelligence(
    payload: Dict[str, Any],
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Master Commercial Brain evaluation. Assesses project worthiness, selling price,
    protected margin, risk score, rate outliers, spend timeline, and approval rules.
    Persists the outcome as a commercial baseline so it can be audited later.
    """
    org_rate_benchmarks = await _load_org_rate_benchmarks(db, user["org_id"])
    result = QuotationBrain.evaluate_project(payload, rate_benchmarks=org_rate_benchmarks)

    baseline_id = None
    try:
        baseline_id = await _persist_commercial_baseline(db, user, payload, result)

        if result["worthiness_rating"] == "HIGH_RISK_REJECT_OR_REPRICE":
            await emit_role_notification(
                db,
                org_id=user["org_id"],
                role_names=["MD", "COMMERCIAL_MANAGER", "EXECUTIVE", SUPERADMIN_ROLE],
                title="CCB flagged a high-risk quotation",
                message=f"{result.get('project_title', 'Quotation')} scored {result['worthiness_score']}/100 — {result['recommendation']}",
                notification_type="ccb_evaluation",
                priority="high",
                action_url="/dashboard/quotations/ccb",
                metadata={"baseline_id": baseline_id, "quotation_id": payload.get("quotation_id")},
            )

        await db.commit()
    except Exception:
        await db.rollback()

    return {
        "success": True,
        "data": jsonable_encoder(result),
        "message": "Quotation Intelligence evaluation complete.",
        "meta": {"user_id": user["user_id"], "baseline_id": baseline_id},
    }


@router.post("/intelligence/generate-quote")
async def generate_autonomous_quote(
    payload: Dict[str, Any],
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Builds a controlled autonomous draft quote from a CRM lead/opportunity/tender, project, or manual scope."""
    source_type = str(payload.get("source_type", "manual"))
    source_id = str(payload["source_id"]) if payload.get("source_id") else None
    source_context = await _load_autonomous_quote_source(db, user["org_id"], source_type, source_id)

    context = dict(source_context)
    for key in (
        "scope_text", "built_area_sqm", "area_sqm", "project_duration_weeks", "profit_rate",
        "overhead_rate", "contingency_rate", "tax_rate", "currency", "client_name",
        "project_title", "estimated_budget", "budget", "bid_amount", "contract_value",
    ):
        if payload.get(key) not in (None, ""):
            context[key] = payload[key]

    org_assemblies = await _load_org_assemblies(db, user["org_id"])
    quote_payload = AutonomousQuoteBuilder.generate_quote_payload(context, assemblies=org_assemblies)
    calculation = QuotationCalculator.calculate(quote_payload)
    calculation_data = calculation.model_dump(mode="json")
    project_id = None
    normalized_source_type = source_type.strip().lower()
    if normalized_source_type == "project":
        project_id = source_id
    elif context.get("project_id"):
        project_id = str(context.get("project_id"))

    brain_payload = dict(quote_payload)
    brain_payload["project_id"] = project_id
    brain = QuotationBrain.evaluate_project(brain_payload)

    metadata = {
        "project_title": quote_payload["project_title"],
        "reference_number": quote_payload["reference_number"],
        "quote_date": datetime.now(timezone.utc).date().isoformat(),
        "direct_costs": calculation_data.get("direct_costs"),
        "preliminaries": calculation_data.get("preliminaries"),
        "overhead_pct": quote_payload["overhead_rate"] * 100,
        "contingency_pct": quote_payload["contingency_rate"] * 100,
        "profit_pct": quote_payload["profit_rate"] * 100,
        "subtotal": calculation_data.get("subtotal"),
        "vat": calculation_data.get("tax_amount"),
        "currency": quote_payload["currency"],
        "items": quote_payload["items"],
        "assumptions": quote_payload["assumptions"],
        "exclusions": quote_payload["exclusions"],
        "autonomous_ccb": quote_payload["autonomous_metadata"],
        "status": "autonomous_draft",
    }

    try:
        insert_result = await db.execute(
            text(
                """
                INSERT INTO finance.quotations (
                    organization_id, created_by, client_name, quote_amount, project_id, metadata, status
                ) VALUES (
                    :org_id, :created_by, :client_name, :quote_amount, :project_id, CAST(:metadata AS jsonb), :status
                )
                RETURNING id
                """
            ),
            {
                "org_id": user["org_id"],
                "created_by": user["sub"],
                "client_name": quote_payload["client_name"],
                "quote_amount": calculation_data.get("grand_total", 0),
                "project_id": project_id,
                "metadata": json.dumps(metadata, default=str),
                "status": "draft",
            },
        )
        quotation_id = str(insert_result.scalar())
        brain_payload["quotation_id"] = quotation_id
        brain = QuotationBrain.evaluate_project(brain_payload)
        baseline_id = await _persist_commercial_baseline(db, user, brain_payload, brain)
        await db.commit()
    except Exception as exc:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Autonomous quote generation failed: {str(exc)}")

    return {
        "success": True,
        "data": jsonable_encoder({
            "quotation": {
                "id": quotation_id,
                "client_name": quote_payload["client_name"],
                "quote_amount": calculation_data.get("grand_total", 0),
                "project_id": project_id,
                "metadata": metadata,
                "status": "draft",
            },
            "calculation": calculation_data,
            "brain": brain,
            "generated_payload": quote_payload,
        }),
        "message": "Autonomous CCB draft quote generated and baseline evaluated.",
        "meta": {"user_id": user["user_id"], "baseline_id": baseline_id},
    }

@router.get("/intelligence/baselines")
async def list_commercial_baselines(
    quotation_id: Optional[str] = None,
    project_id: Optional[str] = None,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Returns persisted commercial baseline evaluations, most recent first."""
    query = text(
        """
        SELECT * FROM finance.project_commercial_baselines
        WHERE organization_id = :org_id AND is_deleted = false
          AND (:quotation_id IS NULL OR quotation_id = :quotation_id)
          AND (:project_id IS NULL OR project_id = :project_id)
        ORDER BY created_at DESC
        LIMIT 20
        """
    )
    result = await db.execute(
        query, {"org_id": user["org_id"], "quotation_id": quotation_id, "project_id": project_id}
    )
    items = [dict(row._mapping) for row in result]
    return {
        "success": True,
        "data": jsonable_encoder(items),
        "message": "Commercial baseline history retrieved.",
        "meta": {"total": len(items)},
    }


@router.post("/intelligence/export-pdf")
async def export_ccb_control_file_pdf(
    payload: Dict[str, Any],
    user: dict = Depends(get_current_user),
):
    """Renders the CCB decision, KPIs, flags, material demand, spend guardrail, and
    recorded overrides into a signed-off-style commercial control file PDF."""
    quotation_id = str(payload.get("quotation_id") or "CCB-CONTROL-FILE")
    output_path = _document_output_path(quotation_id, 1, "pdf")
    CommercialControlPDFRenderer().render_pdf(payload, str(output_path))
    return FileResponse(
        path=str(output_path),
        media_type="application/pdf",
        filename=f"{output_path.stem}.pdf",
    )


@router.post("/intelligence/override")
async def save_commercial_override(
    payload: Dict[str, Any],
    user: dict = Depends(require_permission("quotations.approve_ccb_override")),
    db: AsyncSession = Depends(get_db),
):
    """Saves an MD or Commercial Manager approval override for flagged commercial exceptions.

    Gated by the ``quotations.approve_ccb_override`` permission — the approver_role recorded
    is the caller's actual authenticated role, not client-supplied input. The override is
    stamped with the baseline_id it was approved against so a later re-evaluation can tell
    whether the approval is stale.
    """
    quotation_id = payload.get("quotation_id")
    flag_title = payload.get("flag_title", "Commercial Risk Flag")
    approver_role = user.get("role") or "MD"
    baseline_id = payload.get("baseline_id")
    notes = payload.get("notes", "Approved under commercial discretion.")

    if quotation_id:
        try:
            await db.execute(
                text(
                    """
                    UPDATE finance.quotations
                    SET metadata = jsonb_set(
                        COALESCE(metadata, '{}'::jsonb),
                        '{ccb_overrides}',
                        COALESCE(metadata->'ccb_overrides', '[]'::jsonb) || jsonb_build_object(
                            'flag_title', :flag_title,
                            'approver_role', :approver_role,
                            'approved_by', :user_id,
                            'approved_at', NOW(),
                            'baseline_id', :baseline_id,
                            'notes', :notes
                        )::jsonb
                    )
                    WHERE id = :quotation_id AND organization_id = :org_id
                    """
                ),
                {
                    "quotation_id": quotation_id,
                    "org_id": user["org_id"],
                    "flag_title": flag_title,
                    "approver_role": approver_role,
                    "user_id": user["sub"],
                    "baseline_id": baseline_id,
                    "notes": notes,
                },
            )
            await db.commit()
        except Exception:
            await db.rollback()

    return {
        "success": True,
        "data": {
            "quotation_id": quotation_id,
            "flag_title": flag_title,
            "approver_role": approver_role,
            "baseline_id": baseline_id,
            "status": "APPROVED_OVERRIDE",
        },
        "message": f"Commercial override recorded by {approver_role}.",
        "meta": {"user_id": user["user_id"]},
    }


@router.post("/intelligence/simulate-scenario")
async def simulate_scenario(
    payload: Dict[str, Any],
    user: dict = Depends(get_current_user),
):
    """Simulates what-if scenario for price hikes, subcontractor rate hikes, and productivity changes."""
    base_payload = payload.get("base_payload", payload)
    mat_hike = float(payload.get("material_price_hike_pct", 0.0))
    sub_hike = float(payload.get("subcontractor_rate_hike_pct", 0.0))
    prod_change = float(payload.get("productivity_change_pct", 0.0))

    sim_res = ScenarioSimulator.simulate_what_if(
        base_payload=base_payload,
        material_price_hike_pct=mat_hike,
        subcontractor_rate_hike_pct=sub_hike,
        productivity_change_pct=prod_change,
    )
    return {
        "success": True,
        "data": jsonable_encoder(sim_res),
        "message": "Scenario simulation complete.",
        "meta": {"user_id": user["user_id"]},
    }


@router.get("/intelligence/subcontractors/recommended")
async def get_recommended_subcontractors(
    category: str = "Concrete & Structure",
    user: dict = Depends(get_current_user),
):
    """Recommends pre-vetted subcontractors matching category and target subby benchmarks."""
    vendors = SubcontractorBenchmarkEngine.recommend_vendors(category)
    return {
        "success": True,
        "data": vendors,
        "message": "Recommended subcontractor vendors loaded.",
        "meta": {"total": len(vendors)},
    }


@router.post("/intelligence/inflation-forecast")
async def forecast_inflation_impact(
    payload: Dict[str, Any],
    user: dict = Depends(get_current_user),
):
    """Forecasts currency and inflation escalation impact over project duration."""
    cost = float(payload.get("base_cost", 100000.0))
    weeks = int(payload.get("duration_weeks", 16))
    currency = str(payload.get("currency", "USD"))
    res = InflationForecaster.forecast_escalation(cost, weeks, currency)
    return {
        "success": True,
        "data": jsonable_encoder(res),
        "message": "Inflation forecast complete.",
        "meta": {"user_id": user["user_id"]},
    }


@router.post("/intelligence/classify-description")
async def classify_boq_description(
    payload: Dict[str, Any],
    user: dict = Depends(get_current_user),
):
    """Performs semantic keyword matching to classify raw BOQ descriptions into engineering assemblies."""
    desc = str(payload.get("description", ""))
    match_res = FuzzyAssemblyMatcher.match_description(desc)
    return {
        "success": True,
        "data": jsonable_encoder(match_res),
        "message": "BOQ line description classification complete.",
        "meta": {"user_id": user["user_id"]},
    }


@router.get("/assemblies")
async def list_construction_assemblies(
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Retrieves the default assembly library merged with org-specific assemblies."""
    org_assemblies = await _load_org_assemblies(db, user["org_id"])
    assemblies = AssemblyLibrary.list_assemblies(org_assemblies)
    for item in assemblies:
        item["source"] = "custom" if item["assembly_code"] not in DEFAULT_ASSEMBLIES else "default"
    return {
        "success": True,
        "data": assemblies,
        "message": "Construction assembly library loaded.",
        "meta": {"total": len(assemblies)},
    }


@router.post("/assemblies/calculate")
async def calculate_assembly_breakdown(
    payload: Dict[str, Any],
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Calculates deterministic material, labour, and plant recipe for a given assembly and volume/area."""
    code = str(payload.get("assembly_code", "CONC-25MPA"))
    qty = float(payload.get("quantity", 1.0))
    try:
        org_assemblies = await _load_org_assemblies(db, user["org_id"])
        breakdown = AssemblyLibrary.calculate_breakdown(code, qty, org_assemblies)
        return {
            "success": True,
            "data": jsonable_encoder(breakdown),
            "message": f"Assembly breakdown calculated for {qty} {breakdown['unit']}.",
            "meta": {"user_id": user["user_id"]},
        }
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err))


@router.post("/assemblies")
async def create_construction_assembly(
    payload: Dict[str, Any],
    user: dict = Depends(require_permission("quotations.manage_assemblies")),
    db: AsyncSession = Depends(get_db),
):
    """Creates or replaces an org-specific assembly recipe, overriding the default of the same code."""
    assembly_code = str(payload.get("assembly_code", "")).strip().upper()
    if not assembly_code:
        raise HTTPException(status_code=400, detail="assembly_code is required.")

    result = await db.execute(
        text(
            """
            INSERT INTO finance.construction_assemblies (
                organization_id, assembly_code, name, category, unit,
                material_recipe, labour_gang, plant_needs,
                subcontractor_benchmark_rate, wastage_tolerance_pct, output_rate_per_day
            ) VALUES (
                :org_id, :assembly_code, :name, :category, :unit,
                CAST(:material_recipe AS jsonb), CAST(:labour_gang AS jsonb), CAST(:plant_needs AS jsonb),
                :subcontractor_benchmark_rate, :wastage_tolerance_pct, :output_rate_per_day
            )
            RETURNING id
            """
        ),
        {
            "org_id": user["org_id"],
            "assembly_code": assembly_code,
            "name": payload.get("name", assembly_code),
            "category": payload.get("category", "Custom"),
            "unit": payload.get("unit", "m2"),
            "material_recipe": json.dumps(payload.get("material_recipe", []), default=str),
            "labour_gang": json.dumps(payload.get("labour_gang", []), default=str),
            "plant_needs": json.dumps(payload.get("plant_needs", []), default=str),
            "subcontractor_benchmark_rate": float(payload.get("subcontractor_benchmark_rate", 0)),
            "wastage_tolerance_pct": float(payload.get("wastage_tolerance_pct", 5.0)),
            "output_rate_per_day": float(payload.get("output_rate_per_day", 10.0)),
        },
    )
    await db.commit()
    return {
        "success": True,
        "data": {"id": str(result.scalar()), "assembly_code": assembly_code},
        "message": "Custom assembly saved.",
        "meta": {"user_id": user["user_id"]},
    }


@router.delete("/assemblies/{assembly_id}")
async def delete_construction_assembly(
    assembly_id: str,
    user: dict = Depends(require_permission("quotations.manage_assemblies")),
    db: AsyncSession = Depends(get_db),
):
    """Soft-deletes an org-specific custom assembly (default assemblies cannot be deleted)."""
    result = await db.execute(
        text(
            """
            UPDATE finance.construction_assemblies
            SET is_deleted = true, updated_at = NOW()
            WHERE id = :assembly_id AND organization_id = :org_id
            RETURNING id
            """
        ),
        {"assembly_id": assembly_id, "org_id": user["org_id"]},
    )
    if not result.first():
        raise HTTPException(status_code=404, detail="Custom assembly not found.")
    await db.commit()
    return {"success": True, "data": None, "message": "Custom assembly deleted.", "meta": {}}


@router.get("/rates/benchmark")
async def benchmark_rate(
    item_code: str,
    rate: float,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Benchmarks a requested item rate against internal target, supplier, subby market, and last PO rates."""
    org_rate_benchmarks = await _load_org_rate_benchmarks(db, user["org_id"])
    result = RateIntelligenceEngine.evaluate_rate(item_code, rate, benchmarks=org_rate_benchmarks)
    return {
        "success": True,
        "data": jsonable_encoder(result),
        "message": "Rate benchmark evaluation complete.",
        "meta": {"user_id": user["user_id"]},
    }


@router.get("/rates/benchmarks")
async def list_rate_benchmarks(
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Lists org-specific rate intelligence benchmarks (custom entries only, for admin management)."""
    result = await db.execute(
        text(
            """
            SELECT id, item_code, category, description, unit, target_rate, supplier_rate,
                   subcontractor_rate, last_po_rate, currency, escalation_pct
            FROM finance.rate_intelligence
            WHERE organization_id = :org_id AND is_deleted = false
            ORDER BY item_code
            """
        ),
        {"org_id": user["org_id"]},
    )
    items = [dict(row._mapping) for row in result]
    return {
        "success": True,
        "data": jsonable_encoder(items),
        "message": "Custom rate benchmarks loaded.",
        "meta": {"total": len(items)},
    }


@router.post("/rates/benchmarks")
async def create_rate_benchmark(
    payload: Dict[str, Any],
    user: dict = Depends(require_permission("quotations.manage_rate_intelligence")),
    db: AsyncSession = Depends(get_db),
):
    """Creates or replaces an org-specific rate benchmark, overriding the default of the same code."""
    item_code = str(payload.get("item_code", "")).strip().upper()
    if not item_code:
        raise HTTPException(status_code=400, detail="item_code is required.")

    result = await db.execute(
        text(
            """
            INSERT INTO finance.rate_intelligence (
                organization_id, item_code, category, description, unit,
                target_rate, supplier_rate, subcontractor_rate, last_po_rate, currency, escalation_pct
            ) VALUES (
                :org_id, :item_code, :category, :description, :unit,
                :target_rate, :supplier_rate, :subcontractor_rate, :last_po_rate, :currency, :escalation_pct
            )
            RETURNING id
            """
        ),
        {
            "org_id": user["org_id"],
            "item_code": item_code,
            "category": payload.get("category", "Material"),
            "description": payload.get("description", item_code),
            "unit": payload.get("unit", "unit"),
            "target_rate": float(payload.get("target_rate", 0)),
            "supplier_rate": float(payload.get("supplier_rate", 0)),
            "subcontractor_rate": float(payload.get("subcontractor_rate", 0)),
            "last_po_rate": float(payload.get("last_po_rate", 0)),
            "currency": payload.get("currency", "USD"),
            "escalation_pct": float(payload.get("escalation_pct", 0)),
        },
    )
    await db.commit()
    return {
        "success": True,
        "data": {"id": str(result.scalar()), "item_code": item_code},
        "message": "Rate benchmark saved.",
        "meta": {"user_id": user["user_id"]},
    }


@router.delete("/rates/benchmarks/{benchmark_id}")
async def delete_rate_benchmark(
    benchmark_id: str,
    user: dict = Depends(require_permission("quotations.manage_rate_intelligence")),
    db: AsyncSession = Depends(get_db),
):
    """Soft-deletes an org-specific rate benchmark."""
    result = await db.execute(
        text(
            """
            UPDATE finance.rate_intelligence
            SET is_deleted = true, updated_at = NOW()
            WHERE id = :benchmark_id AND organization_id = :org_id
            RETURNING id
            """
        ),
        {"benchmark_id": benchmark_id, "org_id": user["org_id"]},
    )
    if not result.first():
        raise HTTPException(status_code=404, detail="Rate benchmark not found.")
    await db.commit()
    return {"success": True, "data": None, "message": "Rate benchmark deleted.", "meta": {}}


@router.post("/spend-forecast")
async def generate_spend_forecast(
    payload: Dict[str, Any],
    user: dict = Depends(get_current_user),
):
    """Generates daily/weekly/monthly cost plans, cashflows, material schedules, and labour histograms."""
    items = payload.get("items", [])
    duration_weeks = int(payload.get("project_duration_weeks", 12))
    profit_margin = float(payload.get("profit_margin_pct", 15.0))
    forecast = SpendForecaster.generate_forecast(items, duration_weeks, profit_margin)
    return {
        "success": True,
        "data": jsonable_encoder(forecast),
        "message": "Project spend forecast generated.",
        "meta": {"user_id": user["user_id"]},
    }


@router.post("/guard/audit")
async def audit_site_request(
    payload: Dict[str, Any],
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Commercial Guard & BS Detector. Real-time audit of site requests, RFQs, subby claims,
    material over-requests, and pricing anomalies against baseline earned progress.
    Persists flagged and cleared audits to the evidence log.
    """
    requester_id = str(payload.get("requester_id", user["sub"]))
    requester_name = str(payload.get("requester_name", "Site User"))
    doc_type = str(payload.get("document_type", "SITE_MATERIAL_REQUEST"))
    item = str(payload.get("item", "Cement 50kg bags"))
    requested_qty = float(payload.get("requested_quantity", 0))
    earned_qty = float(payload.get("earned_quantity", 0))
    unit_rate = float(payload.get("unit_rate", 0))
    hist_rate = payload.get("historical_po_rate")

    audit = CommercialGuard.audit_request(
        requester_id=requester_id,
        requester_name=requester_name,
        document_type=doc_type,
        item_code_or_desc=item,
        requested_quantity=requested_qty,
        earned_quantity=earned_qty,
        unit_rate=unit_rate,
        historical_po_rate=float(hist_rate) if hist_rate is not None else None,
    )
    audit_metrics = audit.get("evidence_pack", {}).get("audit_metrics", {})
    project_id = str(payload.get("project_id")) if payload.get("project_id") else None

    audit_id = None
    investigation_case_id = None
    try:
        insert_result = await db.execute(
            text(
                """
                INSERT INTO finance.commercial_guard_audits (
                    organization_id, project_id, requester_id, requester_name, document_type,
                    item_description, input_amount, theoretical_amount, variance_pct,
                    status, anomaly_reason, evidence_pack
                ) VALUES (
                    :org_id, :project_id, :requester_id, :requester_name, :document_type,
                    :item_description, :input_amount, :theoretical_amount, :variance_pct,
                    :status, :anomaly_reason, CAST(:evidence_pack AS jsonb)
                )
                RETURNING id
                """
            ),
            {
                "org_id": user["org_id"],
                "project_id": project_id,
                "requester_id": requester_id,
                "requester_name": requester_name,
                "document_type": doc_type,
                "item_description": item,
                "input_amount": requested_qty,
                "theoretical_amount": audit_metrics.get("theoretical_allowable", 0),
                "variance_pct": audit_metrics.get("variance_pct", 0),
                "status": audit["status"],
                "anomaly_reason": audit["anomaly_reason"],
                "evidence_pack": json.dumps(audit["evidence_pack"], default=str),
            },
        )
        audit_id = str(insert_result.scalar())

        if audit["risk_level"] == "CRITICAL":
            case_result = await db.execute(
                text(
                    """
                    INSERT INTO finance.investigation_cases (
                        organization_id, project_id, subject_employee_id, employee_name,
                        risk_score, violation_count, status, summary, evidence_details
                    ) VALUES (
                        :org_id, :project_id, :subject_employee_id, :employee_name,
                        :risk_score, 1, 'OPEN', :summary, CAST(:evidence_details AS jsonb)
                    )
                    RETURNING id
                    """
                ),
                {
                    "org_id": user["org_id"],
                    "project_id": project_id,
                    "subject_employee_id": requester_id,
                    "employee_name": requester_name,
                    "risk_score": 90,
                    "summary": audit["anomaly_reason"],
                    "evidence_details": json.dumps(audit["evidence_pack"], default=str),
                },
            )
            investigation_case_id = str(case_result.scalar())

        if audit["risk_level"] in ("HIGH", "CRITICAL"):
            await emit_role_notification(
                db,
                org_id=user["org_id"],
                role_names=["MD", "COMMERCIAL_MANAGER", "EXECUTIVE", SUPERADMIN_ROLE],
                title=f"Commercial Guard flagged a {audit['risk_level'].lower()}-risk site request",
                message=f"{requester_name}: {item} — {audit['anomaly_reason']}",
                notification_type="commercial_guard",
                priority="urgent" if audit["risk_level"] == "CRITICAL" else "high",
                metadata={"audit_id": audit_id, "investigation_case_id": investigation_case_id},
            )

        await db.commit()
    except Exception:
        await db.rollback()
        audit_id = None
        investigation_case_id = None

    return {
        "success": True,
        "data": jsonable_encoder(audit),
        "message": "Commercial guard audit complete.",
        "meta": {"user_id": user["user_id"], "audit_id": audit_id, "investigation_case_id": investigation_case_id},
    }


@router.get("/guard/audits")
async def list_guard_audits(
    project_id: Optional[str] = None,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Returns commercial guard audit history, most recent first."""
    query = text(
        """
        SELECT * FROM finance.commercial_guard_audits
        WHERE organization_id = :org_id
          AND (:project_id IS NULL OR project_id = :project_id)
        ORDER BY created_at DESC
        LIMIT 50
        """
    )
    result = await db.execute(query, {"org_id": user["org_id"], "project_id": project_id})
    items = [dict(row._mapping) for row in result]
    return {
        "success": True,
        "data": jsonable_encoder(items),
        "message": "Commercial guard audit history retrieved.",
        "meta": {"total": len(items)},
    }


@router.post("/documents/watch")
async def watch_document_revision(
    payload: Dict[str, Any],
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Document change watcher. Calculates commercial margin impact and required MD/QS approval levels.
    Persists every revision review to the document change log."""
    doc_name = str(payload.get("document_name", "Drawing / BOQ Update"))
    rev = str(payload.get("revision", "R2"))
    orig_cost = float(payload.get("original_direct_cost", 100000.0))
    revised_cost = float(payload.get("revised_direct_cost", 118400.0))
    margin_pct = float(payload.get("current_margin_pct", 15.0))
    contract_val = float(payload.get("contract_value", 130000.0))

    result = DocumentWatcher.analyze_change(
        document_name=doc_name,
        revision=rev,
        original_direct_cost=orig_cost,
        revised_direct_cost=revised_cost,
        current_margin_pct=margin_pct,
        contract_value=contract_val,
    )

    change_type = (
        "COST_INCREASE" if result["cost_delta"] > 0
        else "COST_DECREASE" if result["cost_delta"] < 0
        else "NO_CHANGE"
    )
    change_id = None
    try:
        insert_result = await db.execute(
            text(
                """
                INSERT INTO finance.document_change_logs (
                    organization_id, project_id, document_name, revision, change_type,
                    margin_impact_amount, approval_level_required
                ) VALUES (
                    :org_id, :project_id, :document_name, :revision, :change_type,
                    :margin_impact_amount, :approval_level_required
                )
                RETURNING id
                """
            ),
            {
                "org_id": user["org_id"],
                "project_id": str(payload.get("project_id")) if payload.get("project_id") else None,
                "document_name": doc_name,
                "revision": rev,
                "change_type": change_type,
                "margin_impact_amount": result["margin_risk_dollars"],
                "approval_level_required": result["approval_level_required"],
            },
        )
        change_id = str(insert_result.scalar())

        if result["approval_level_required"] == "MD_APPROVAL_REQUIRED":
            await emit_role_notification(
                db,
                org_id=user["org_id"],
                role_names=["MD", "COMMERCIAL_MANAGER", "EXECUTIVE", SUPERADMIN_ROLE],
                title="Document revision requires MD approval",
                message=f"{doc_name} ({rev}): {result['governance_note']}",
                notification_type="document_watcher",
                priority="urgent",
                action_url="/dashboard/quotations/ccb",
                metadata={"change_id": change_id},
            )

        await db.commit()
    except Exception:
        await db.rollback()
        change_id = None

    return {
        "success": True,
        "data": jsonable_encoder(result),
        "message": "Document revision commercial impact analyzed.",
        "meta": {"user_id": user["user_id"], "change_id": change_id},
    }


@router.get("/documents/changes")
async def list_document_changes(
    project_id: Optional[str] = None,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Returns document/BOQ revision change history, most recent first."""
    query = text(
        """
        SELECT * FROM finance.document_change_logs
        WHERE organization_id = :org_id
          AND (:project_id IS NULL OR project_id = :project_id)
        ORDER BY created_at DESC
        LIMIT 50
        """
    )
    result = await db.execute(query, {"org_id": user["org_id"], "project_id": project_id})
    items = [dict(row._mapping) for row in result]
    return {
        "success": True,
        "data": jsonable_encoder(items),
        "message": "Document change history retrieved.",
        "meta": {"total": len(items)},
    }


@router.get("/")
async def list_items(
    user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    # Fetch active records scoped to the user's organization
    query = text("""
        SELECT *
        FROM finance.quotations
        WHERE organization_id = :org_id AND is_deleted = false
        ORDER BY created_at DESC
        LIMIT 100
    """)
    result = await db.execute(query, {"org_id": user["org_id"]})
    items = [dict(row._mapping) for row in result]

    return {
        "success": True,
        "data": items,
        "message": "quotations listed.",
        "meta": {"total": len(items)},
    }


@router.post("/")
async def create_item(
    request: Request,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    payload = await request.json()

    # Extract keys and values from JSON payload dynamically
    # Exclude reserved keys to prevent override
    safe_keys = safe_payload_columns(payload.keys())

    if not safe_keys:
        raise HTTPException(status_code=400, detail="Empty or invalid payload.")

    # dict/list values (e.g. metadata) bind to jsonb columns; asyncpg's jsonb codec
    # requires an already-serialized string, so these need CAST(:col AS jsonb) too.
    json_columns = [k for k in safe_keys if isinstance(payload[k], (dict, list))]
    params = {
        k: (json.dumps(payload[k], default=str) if k in json_columns else payload[k])
        for k in safe_keys
    }
    params["org_id"] = user["org_id"]
    params["user_id"] = user["sub"]

    query = insert_returning_id_sql("finance.quotations", safe_keys, safe_keys, json_columns=json_columns)

    try:
        result = await db.execute(query, params)
        await db.commit()
        new_id = str(result.scalar())
        return {
            "success": True,
            "data": {"id": new_id},
            "message": "quotations created.",
            "meta": {},
        }
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


@router.get("/{item_id}")
async def get_item(
    item_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = text("""
        SELECT *
        FROM finance.quotations
        WHERE id = :item_id AND organization_id = :org_id AND is_deleted = false
    """)
    result = await db.execute(query, {"item_id": item_id, "org_id": user["org_id"]})
    item = result.first()

    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    return {
        "success": True,
        "data": dict(item._mapping),
        "message": "quotations retrieved.",
        "meta": {},
    }


@router.put("/{item_id}")
async def update_item(
    item_id: str,
    request: Request,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    payload = await request.json()
    safe_keys = safe_payload_columns(payload.keys())

    if not safe_keys:
        return {
            "success": True,
            "data": {"id": item_id},
            "message": "No fields to update.",
        }

    json_columns = [k for k in safe_keys if isinstance(payload[k], (dict, list))]
    params = {
        k: (json.dumps(payload[k], default=str) if k in json_columns else payload[k])
        for k in safe_keys
    }
    params["item_id"] = item_id
    params["org_id"] = user["org_id"]

    query = update_returning_id_sql("finance.quotations", safe_keys, safe_keys, json_columns=json_columns)

    try:
        result = await db.execute(query, params)
        if not result.first():
            raise HTTPException(status_code=404, detail="Item not found")

        await db.commit()
        return {
            "success": True,
            "data": {"id": item_id},
            "message": "quotations updated.",
            "meta": {},
        }
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


@router.delete("/{item_id}")
async def delete_item(
    item_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = text("""
        UPDATE finance.quotations
        SET is_deleted = true, updated_at = NOW()
        WHERE id = :item_id AND organization_id = :org_id
        RETURNING id
    """)

    result = await db.execute(query, {"item_id": item_id, "org_id": user["org_id"]})
    if not result.first():
        raise HTTPException(status_code=404, detail="Item not found")

    await db.commit()
    return {
        "success": True,
        "data": None,
        "message": "quotations deleted (soft delete).",
        "meta": {},
    }






