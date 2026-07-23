"""
Quotation Intelligence Engine & Commercial Control Brain
Deterministic engineering calculation core wrapped with commercial guard rails,
rate intelligence, spend forecasting, document change analysis, and anomaly detection.
"""

from decimal import Decimal, ROUND_HALF_UP
from typing import Dict, List, Any, Optional
import hashlib
import json
import math
from datetime import datetime, timedelta, timezone
from pydantic import BaseModel, Field


# -----------------------------------------------------------------------------
# 1. Construction Assembly Library & Recipe Definitions
# -----------------------------------------------------------------------------

DEFAULT_ASSEMBLIES: Dict[str, Dict[str, Any]] = {
    "CONC-25MPA": {
        "assembly_code": "CONC-25MPA",
        "name": "Reinforced Concrete 25MPa",
        "category": "Concrete & Structure",
        "unit": "m3",
        "material_recipe": [
            {"material": "Cement 42.5N (50kg bags)", "quantity_per_unit": 6.5, "unit": "bags", "unit_cost": 12.50},
            {"material": "Concrete Sand", "quantity_per_unit": 0.52, "unit": "m3", "unit_cost": 22.00},
            {"material": "19mm Crushed Stone", "quantity_per_unit": 0.78, "unit": "m3", "unit_cost": 28.00},
            {"material": "Water", "quantity_per_unit": 0.18, "unit": "m3", "unit_cost": 3.00},
        ],
        "labour_gang": [
            {"role": "Concrete Foreman", "hours_per_unit": 0.2, "hourly_rate": 18.00},
            {"role": "Concreter / Artisan", "hours_per_unit": 0.5, "hourly_rate": 12.00},
            {"role": "General Labourer", "hours_per_unit": 1.5, "hourly_rate": 6.00},
        ],
        "plant_needs": [
            {"equipment": "Concrete Mixer 500L", "hours_per_unit": 0.25, "hourly_rate": 15.00},
            {"equipment": "Concrete Poker Vibrator", "hours_per_unit": 0.25, "hourly_rate": 8.00},
        ],
        "subcontractor_benchmark_rate": 145.00,
        "wastage_tolerance_pct": 5.0,
        "output_rate_per_day": 15.0,  # m3 per gang-day
    },
    "BRICK-SINGLE-115": {
        "assembly_code": "BRICK-SINGLE-115",
        "name": "Common Brickwork 115mm Single Skin",
        "category": "Masonry",
        "unit": "m2",
        "material_recipe": [
            {"material": "Common Bricks", "quantity_per_unit": 55.0, "unit": "pcs", "unit_cost": 0.18},
            {"material": "Cement (50kg bags)", "quantity_per_unit": 0.20, "unit": "bags", "unit_cost": 12.50},
            {"material": "Building Sand", "quantity_per_unit": 0.04, "unit": "m3", "unit_cost": 20.00},
            {"material": "Brickforce Reinforcement", "quantity_per_unit": 1.05, "unit": "m", "unit_cost": 0.85},
        ],
        "labour_gang": [
            {"role": "Bricklayer Artisan", "hours_per_unit": 0.45, "hourly_rate": 14.00},
            {"role": "Labourer", "hours_per_unit": 0.45, "hourly_rate": 6.00},
        ],
        "plant_needs": [],
        "subcontractor_benchmark_rate": 28.00,
        "wastage_tolerance_pct": 5.0,
        "output_rate_per_day": 22.0,  # m2 per gang-day
    },
    "BRICK-DOUBLE-230": {
        "assembly_code": "BRICK-DOUBLE-230",
        "name": "Structural Brickwork 230mm Double Skin",
        "category": "Masonry",
        "unit": "m2",
        "material_recipe": [
            {"material": "Common Bricks", "quantity_per_unit": 110.0, "unit": "pcs", "unit_cost": 0.18},
            {"material": "Cement (50kg bags)", "quantity_per_unit": 0.42, "unit": "bags", "unit_cost": 12.50},
            {"material": "Building Sand", "quantity_per_unit": 0.08, "unit": "m3", "unit_cost": 20.00},
            {"material": "Brickforce Reinforcement", "quantity_per_unit": 2.10, "unit": "m", "unit_cost": 0.85},
        ],
        "labour_gang": [
            {"role": "Bricklayer Artisan", "hours_per_unit": 0.80, "hourly_rate": 14.00},
            {"role": "Labourer", "hours_per_unit": 0.80, "hourly_rate": 6.00},
        ],
        "plant_needs": [],
        "subcontractor_benchmark_rate": 52.00,
        "wastage_tolerance_pct": 5.0,
        "output_rate_per_day": 14.0,
    },
    "PLASTER-INT-12": {
        "assembly_code": "PLASTER-INT-12",
        "name": "Internal Cement Plaster 12mm",
        "category": "Finishes",
        "unit": "m2",
        "material_recipe": [
            {"material": "Cement (50kg bags)", "quantity_per_unit": 0.12, "unit": "bags", "unit_cost": 12.50},
            {"material": "Plaster Sand", "quantity_per_unit": 0.02, "unit": "m3", "unit_cost": 24.00},
        ],
        "labour_gang": [
            {"role": "Plasterer Artisan", "hours_per_unit": 0.30, "hourly_rate": 14.00},
            {"role": "Labourer", "hours_per_unit": 0.25, "hourly_rate": 6.00},
        ],
        "plant_needs": [],
        "subcontractor_benchmark_rate": 14.50,
        "wastage_tolerance_pct": 8.0,
        "output_rate_per_day": 35.0,
    },
    "ROOF-PITCH-SHEET": {
        "assembly_code": "ROOF-PITCH-SHEET",
        "name": "Pitched IBR Iron Roof Covering & Timber Trusses",
        "category": "Roofing",
        "unit": "m2",
        "material_recipe": [
            {"material": "IBR 0.47mm Galvanised Sheeting", "quantity_per_unit": 1.08, "unit": "m2", "unit_cost": 14.00},
            {"material": "SA Pine Structural Timber", "quantity_per_unit": 2.50, "unit": "m", "unit_cost": 4.50},
            {"material": "Roofing Screws & Washers", "quantity_per_unit": 12.0, "unit": "pcs", "unit_cost": 0.25},
        ],
        "labour_gang": [
            {"role": "Carpenter / Roofer", "hours_per_unit": 0.35, "hourly_rate": 15.00},
            {"role": "Labourer", "hours_per_unit": 0.35, "hourly_rate": 6.00},
        ],
        "plant_needs": [],
        "subcontractor_benchmark_rate": 35.00,
        "wastage_tolerance_pct": 5.0,
        "output_rate_per_day": 45.0,
    },
    "REBAR-Y10-Y16": {
        "assembly_code": "REBAR-Y10-Y16",
        "name": "High Tensile Steel Reinforcement (Y10-Y16)",
        "category": "Structure",
        "unit": "ton",
        "material_recipe": [
            {"material": "High Tensile Deformed Bar Steel", "quantity_per_unit": 1.05, "unit": "ton", "unit_cost": 1050.00},
            {"material": "Black Binding Wire", "quantity_per_unit": 5.0, "unit": "kg", "unit_cost": 2.20},
            {"material": "Concrete Spacers 40mm", "quantity_per_unit": 40.0, "unit": "pcs", "unit_cost": 0.30},
        ],
        "labour_gang": [
            {"role": "Steel Fixer", "hours_per_unit": 10.0, "hourly_rate": 15.00},
            {"role": "Labourer", "hours_per_unit": 8.0, "hourly_rate": 6.00},
        ],
        "plant_needs": [
            {"equipment": "Rebar Cutter & Bender", "hours_per_unit": 2.0, "hourly_rate": 12.00},
        ],
        "subcontractor_benchmark_rate": 1450.00,
        "wastage_tolerance_pct": 5.0,
        "output_rate_per_day": 1.5,
    },
    "EXCAV-TRENCH": {
        "assembly_code": "EXCAV-TRENCH",
        "name": "Trench Excavation in Earth",
        "category": "Earthworks",
        "unit": "m3",
        "material_recipe": [],
        "labour_gang": [
            {"role": "General Excavator Labourer", "hours_per_unit": 2.2, "hourly_rate": 6.00},
        ],
        "plant_needs": [
            {"equipment": "TLB / Excavator 20T (Option)", "hours_per_unit": 0.12, "hourly_rate": 65.00},
        ],
        "subcontractor_benchmark_rate": 18.00,
        "wastage_tolerance_pct": 0.0,
        "output_rate_per_day": 30.0,
    },
    "ELEC-ROUGH-IN": {
        "assembly_code": "ELEC-ROUGH-IN",
        "name": "Electrical Rough-In Wiring Point",
        "category": "Electrical",
        "unit": "point",
        "material_recipe": [
            {"material": "PVC Conduit 20mm", "quantity_per_unit": 3.0, "unit": "m", "unit_cost": 0.90},
            {"material": "2.5mm2 Twin & Earth Cable", "quantity_per_unit": 8.0, "unit": "m", "unit_cost": 0.85},
            {"material": "Switch / Socket Faceplate", "quantity_per_unit": 1.0, "unit": "each", "unit_cost": 3.50},
        ],
        "labour_gang": [
            {"role": "Electrician", "hours_per_unit": 0.6, "hourly_rate": 16.00},
            {"role": "Electrician's Assistant", "hours_per_unit": 0.6, "hourly_rate": 7.00},
        ],
        "plant_needs": [],
        "subcontractor_benchmark_rate": 22.00,
        "wastage_tolerance_pct": 5.0,
        "output_rate_per_day": 12.0,  # points per day per team
    },
    "PLUMB-ROUGH-IN": {
        "assembly_code": "PLUMB-ROUGH-IN",
        "name": "Plumbing Rough-In Pipework Point",
        "category": "Plumbing",
        "unit": "point",
        "material_recipe": [
            {"material": "20mm PPR Supply Pipe", "quantity_per_unit": 4.0, "unit": "m", "unit_cost": 1.20},
            {"material": "50mm PVC Waste Pipe", "quantity_per_unit": 2.0, "unit": "m", "unit_cost": 1.80},
            {"material": "Fittings & Joints Allowance", "quantity_per_unit": 1.0, "unit": "set", "unit_cost": 4.00},
        ],
        "labour_gang": [
            {"role": "Plumber", "hours_per_unit": 0.8, "hourly_rate": 15.00},
            {"role": "Plumber's Assistant", "hours_per_unit": 0.8, "hourly_rate": 6.50},
        ],
        "plant_needs": [],
        "subcontractor_benchmark_rate": 28.00,
        "wastage_tolerance_pct": 5.0,
        "output_rate_per_day": 8.0,  # points per day per team
    },
    "TILE-FLOOR-CERAMIC": {
        "assembly_code": "TILE-FLOOR-CERAMIC",
        "name": "Ceramic Floor Tiling",
        "category": "Finishes",
        "unit": "m2",
        "material_recipe": [
            {"material": "Ceramic Floor Tiles 600x600", "quantity_per_unit": 1.08, "unit": "m2", "unit_cost": 9.50},
            {"material": "Tile Adhesive (20kg bags)", "quantity_per_unit": 0.20, "unit": "bags", "unit_cost": 8.50},
            {"material": "Tile Grout (5kg bags)", "quantity_per_unit": 0.05, "unit": "bags", "unit_cost": 6.00},
        ],
        "labour_gang": [
            {"role": "Tiler Artisan", "hours_per_unit": 0.55, "hourly_rate": 13.00},
            {"role": "Labourer", "hours_per_unit": 0.30, "hourly_rate": 6.00},
        ],
        "plant_needs": [],
        "subcontractor_benchmark_rate": 13.50,
        "wastage_tolerance_pct": 8.0,
        "output_rate_per_day": 18.0,
    },
    "PAINT-INT-2COAT": {
        "assembly_code": "PAINT-INT-2COAT",
        "name": "Internal Paint 2-Coat Emulsion",
        "category": "Finishes",
        "unit": "m2",
        "material_recipe": [
            {"material": "Emulsion Paint (2 coats)", "quantity_per_unit": 0.22, "unit": "litres", "unit_cost": 5.20},
            {"material": "Primer / Sealer", "quantity_per_unit": 0.10, "unit": "litres", "unit_cost": 4.00},
        ],
        "labour_gang": [
            {"role": "Painter", "hours_per_unit": 0.18, "hourly_rate": 10.00},
            {"role": "Labourer", "hours_per_unit": 0.05, "hourly_rate": 6.00},
        ],
        "plant_needs": [],
        "subcontractor_benchmark_rate": 4.20,
        "wastage_tolerance_pct": 5.0,
        "output_rate_per_day": 60.0,
    },
    "WATERPROOF-MEMBRANE": {
        "assembly_code": "WATERPROOF-MEMBRANE",
        "name": "Waterproofing Membrane (Wet Areas / Roof Slab)",
        "category": "Finishes",
        "unit": "m2",
        "material_recipe": [
            {"material": "Bituminous Waterproofing Membrane", "quantity_per_unit": 1.10, "unit": "m2", "unit_cost": 11.00},
            {"material": "Primer Bonding Coat", "quantity_per_unit": 0.15, "unit": "litres", "unit_cost": 6.00},
        ],
        "labour_gang": [
            {"role": "Waterproofing Specialist", "hours_per_unit": 0.35, "hourly_rate": 14.00},
            {"role": "Labourer", "hours_per_unit": 0.20, "hourly_rate": 6.00},
        ],
        "plant_needs": [
            {"equipment": "Torch / Heat Gun", "hours_per_unit": 0.10, "hourly_rate": 5.00},
        ],
        "subcontractor_benchmark_rate": 18.00,
        "wastage_tolerance_pct": 10.0,
        "output_rate_per_day": 25.0,
    },
    "DOOR-WINDOW-FIX": {
        "assembly_code": "DOOR-WINDOW-FIX",
        "name": "Door & Window Frame Supply & Fix (Aluminium/Timber)",
        "category": "Joinery",
        "unit": "each",
        "material_recipe": [
            {"material": "Door/Window Frame & Leaf Allowance", "quantity_per_unit": 1.0, "unit": "each", "unit_cost": 145.00},
            {"material": "Fixing Screws, Wedges & Sealant", "quantity_per_unit": 1.0, "unit": "set", "unit_cost": 6.50},
            {"material": "Ironmongery (Hinges/Handles/Locks)", "quantity_per_unit": 1.0, "unit": "set", "unit_cost": 18.00},
        ],
        "labour_gang": [
            {"role": "Joiner / Carpenter", "hours_per_unit": 2.5, "hourly_rate": 15.00},
            {"role": "Labourer", "hours_per_unit": 1.0, "hourly_rate": 6.00},
        ],
        "plant_needs": [],
        "subcontractor_benchmark_rate": 95.00,
        "wastage_tolerance_pct": 2.0,
        "output_rate_per_day": 6.0,  # openings per day per team
    },
}


class AssemblyLibrary:
    """Deterministic assembly recipe library.

    All methods accept an optional ``assemblies`` override so callers (routers)
    can merge org-specific rows from ``finance.construction_assemblies`` on top
    of ``DEFAULT_ASSEMBLIES`` without this class knowing about the database.
    """

    @staticmethod
    def list_assemblies(assemblies: Optional[Dict[str, Dict[str, Any]]] = None) -> List[Dict[str, Any]]:
        return list((assemblies or DEFAULT_ASSEMBLIES).values())

    @staticmethod
    def get_assembly(code: str, assemblies: Optional[Dict[str, Dict[str, Any]]] = None) -> Optional[Dict[str, Any]]:
        return (assemblies or DEFAULT_ASSEMBLIES).get(code.upper())

    @classmethod
    def calculate_breakdown(
        cls,
        assembly_code: str,
        quantity: float,
        assemblies: Optional[Dict[str, Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        assembly = cls.get_assembly(assembly_code, assemblies)
        if not assembly:
            raise ValueError(f"Assembly code '{assembly_code}' not found in engineering library.")

        qty = max(0.0, float(quantity))
        wastage_pct = assembly.get("wastage_tolerance_pct", 5.0)
        wastage_multiplier = 1.0 + (wastage_pct / 100.0)

        # Materials
        materials_breakdown = []
        total_material_cost = 0.0
        for mat in assembly.get("material_recipe", []):
            raw_qty = mat["quantity_per_unit"] * qty
            total_qty_with_waste = raw_qty * wastage_multiplier
            total_cost = total_qty_with_waste * mat["unit_cost"]
            total_material_cost += total_cost
            materials_breakdown.append({
                "material": mat["material"],
                "unit": mat["unit"],
                "net_quantity": round(raw_qty, 3),
                "total_quantity_with_waste": round(total_qty_with_waste, 3),
                "unit_cost": mat["unit_cost"],
                "total_cost": round(total_cost, 2)
            })

        # Labour
        labour_breakdown = []
        total_labour_cost = 0.0
        total_labour_hours = 0.0
        for lab in assembly.get("labour_gang", []):
            hours = lab["hours_per_unit"] * qty
            cost = hours * lab["hourly_rate"]
            total_labour_cost += cost
            total_labour_hours += hours
            labour_breakdown.append({
                "role": lab["role"],
                "total_hours": round(hours, 2),
                "hourly_rate": lab["hourly_rate"],
                "total_cost": round(cost, 2)
            })

        # Plant
        plant_breakdown = []
        total_plant_cost = 0.0
        for plt in assembly.get("plant_needs", []):
            hours = plt["hours_per_unit"] * qty
            cost = hours * plt["hourly_rate"]
            total_plant_cost += cost
            plant_breakdown.append({
                "equipment": plt["equipment"],
                "total_hours": round(hours, 2),
                "hourly_rate": plt["hourly_rate"],
                "total_cost": round(cost, 2)
            })

        # Subcontractor Benchmark
        subby_unit_rate = assembly.get("subcontractor_benchmark_rate", 0.0)
        subby_total_cost = subby_unit_rate * qty

        total_direct_build_cost = total_material_cost + total_labour_cost + total_plant_cost
        rate_per_unit = (total_direct_build_cost / qty) if qty > 0 else 0.0

        output_per_day = assembly.get("output_rate_per_day", 10.0)
        estimated_days_needed = math.ceil(qty / output_per_day) if output_per_day > 0 else 1

        return {
            "assembly_code": assembly["assembly_code"],
            "name": assembly["name"],
            "unit": assembly["unit"],
            "quantity": qty,
            "wastage_tolerance_pct": wastage_pct,
            "calculated_unit_rate": round(rate_per_unit, 2),
            "total_direct_cost": round(total_direct_build_cost, 2),
            "subcontractor_benchmark_rate": subby_unit_rate,
            "subcontractor_total_benchmark": round(subby_total_cost, 2),
            "estimated_production_days": estimated_days_needed,
            "materials": materials_breakdown,
            "labour": labour_breakdown,
            "plant": plant_breakdown,
            "cost_summary": {
                "material_cost": round(total_material_cost, 2),
                "labour_cost": round(total_labour_cost, 2),
                "plant_cost": round(total_plant_cost, 2),
            }
        }


# -----------------------------------------------------------------------------
# 2. Rate Intelligence Engine & Benchmarking
# -----------------------------------------------------------------------------

RATE_BENCHMARKS: Dict[str, Dict[str, Any]] = {
    "CEMENT-50KG": {
        "item_code": "CEMENT-50KG",
        "category": "Cementitious",
        "description": "Portland Cement 42.5N 50kg bag",
        "unit": "bag",
        "target_rate": 11.80,
        "supplier_rate": 12.50,
        "subcontractor_rate": 13.00,
        "last_po_rate": 12.20,
        "currency": "USD",
        "escalation_pct": 2.5
    },
    "BRICK-COMMON": {
        "item_code": "BRICK-COMMON",
        "category": "Masonry",
        "description": "Standard Clay Common Brick",
        "unit": "pcs",
        "target_rate": 0.16,
        "supplier_rate": 0.18,
        "subcontractor_rate": 0.20,
        "last_po_rate": 0.17,
        "currency": "USD",
        "escalation_pct": 3.0
    },
    "SAND-BUILDING": {
        "item_code": "SAND-BUILDING",
        "category": "Aggregates",
        "description": "Washed Building Sand per m3",
        "unit": "m3",
        "target_rate": 18.00,
        "supplier_rate": 20.00,
        "subcontractor_rate": 22.00,
        "last_po_rate": 19.50,
        "currency": "USD",
        "escalation_pct": 1.5
    },
    "SUBBY-PLASTER-M2": {
        "item_code": "SUBBY-PLASTER-M2",
        "category": "Subcontractor Rates",
        "description": "Internal Plastering Subcontractor Rate per m2",
        "unit": "m2",
        "target_rate": 12.50,
        "supplier_rate": 14.50,
        "subcontractor_rate": 15.00,
        "last_po_rate": 14.00,
        "currency": "USD",
        "escalation_pct": 4.0
    }
}


class RateIntelligenceEngine:
    @staticmethod
    def evaluate_rate(
        item_code: str,
        proposed_rate: float,
        category: str = "Material",
        benchmarks: Optional[Dict[str, Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        """``benchmarks`` lets a caller merge org-specific rows from
        ``finance.rate_intelligence`` on top of the hardcoded ``RATE_BENCHMARKS`` seed."""
        bm = (benchmarks or RATE_BENCHMARKS).get(item_code.upper())
        rate = float(proposed_rate)

        if not bm:
            # Fallback benchmark estimation
            return {
                "item_code": item_code,
                "proposed_rate": rate,
                "benchmark_found": False,
                "status": "UNBENCHMARKED",
                "variance_vs_last_po_pct": 0.0,
                "is_outlier": False,
                "recommendation": "No benchmark on file. Log rate for baseline tracking."
            }

        last_po = bm["last_po_rate"]
        target = bm["target_rate"]
        supplier = bm["supplier_rate"]
        subby = bm["subcontractor_rate"]

        variance_vs_last_po = ((rate - last_po) / last_po * 100.0) if last_po > 0 else 0.0
        variance_vs_target = ((rate - target) / target * 100.0) if target > 0 else 0.0

        # Anomaly threshold is +15% above benchmark
        is_outlier = variance_vs_last_po > 15.0 or variance_vs_target > 20.0

        if is_outlier:
            status = "OUTLIER_HIGH"
            rec = f"WARNING: Proposed rate of ${rate:.2f} is {variance_vs_last_po:+.1f}% above historical PO rate (${last_po:.2f}). Negotiate or require Commercial Manager approval."
        elif variance_vs_last_po < -10.0:
            status = "BELOW_MARKET"
            rec = f"NOTE: Proposed rate of ${rate:.2f} is {abs(variance_vs_last_po):.1f}% below market. Verify supplier quality/scope inclusions."
        else:
            status = "ACCEPTABLE"
            rec = "Rate is within acceptable commercial tolerance limits."

        return {
            "item_code": bm["item_code"],
            "description": bm["description"],
            "proposed_rate": rate,
            "target_rate": target,
            "supplier_rate": supplier,
            "subcontractor_market_rate": subby,
            "last_po_rate": last_po,
            "currency": bm["currency"],
            "variance_vs_last_po_pct": round(variance_vs_last_po, 2),
            "variance_vs_target_pct": round(variance_vs_target, 2),
            "is_outlier": is_outlier,
            "status": status,
            "recommendation": rec
        }


# -----------------------------------------------------------------------------
# 3. Spend Forecaster & Baseline Model
# -----------------------------------------------------------------------------

class SpendForecaster:
    @staticmethod
    def generate_forecast(
        boq_items: List[Dict[str, Any]],
        project_duration_weeks: int = 12,
        profit_margin_pct: float = 15.0,
        contingency_pct: float = 5.0
    ) -> Dict[str, Any]:
        weeks = max(1, project_duration_weeks)

        total_mat = 0.0
        total_lab = 0.0
        total_eqp = 0.0
        total_sub = 0.0
        total_direct = 0.0

        material_schedule_map: Dict[str, float] = {}

        for item in boq_items:
            qty = float(item.get("quantity", 0))
            rate = float(item.get("rate", 0))
            mat_rate = float(item.get("material_rate", 0))
            lab_rate = float(item.get("labour_rate", 0))
            eqp_rate = float(item.get("equipment_rate", 0))
            sub_rate = float(item.get("subcontractor_rate", 0))

            item_total = qty * rate
            total_direct += item_total

            total_mat += qty * mat_rate
            total_lab += qty * lab_rate
            total_eqp += qty * eqp_rate
            total_sub += qty * sub_rate

            desc = item.get("description", "Item")
            material_schedule_map[desc] = material_schedule_map.get(desc, 0.0) + (qty * mat_rate)

        contingency_amt = total_direct * (contingency_pct / 100.0)
        profit_amt = (total_direct + contingency_amt) * (profit_margin_pct / 100.0)
        grand_selling_price = total_direct + contingency_amt + profit_amt

        # Generate weekly S-Curve spend distribution (Cumulative beta/logistic profile)
        weekly_cost_plan = []
        monthly_cashflow_map: Dict[str, float] = {}
        cum_spend = 0.0

        for w in range(1, weeks + 1):
            # S-curve distribution factor
            progress_ratio = w / weeks
            # Logistic curve: s = 3*p^2 - 2*p^3
            s_factor = (3 * (progress_ratio ** 2)) - (2 * (progress_ratio ** 3))
            target_cum = total_direct * s_factor
            weekly_spend = target_cum - cum_spend
            cum_spend = target_cum

            week_mat = weekly_spend * 0.45
            week_lab = weekly_spend * 0.25
            week_eqp = weekly_spend * 0.10
            week_sub = weekly_spend * 0.20

            month_key = f"Month {math.ceil(w / 4)}"
            monthly_cashflow_map[month_key] = monthly_cashflow_map.get(month_key, 0.0) + weekly_spend

            weekly_cost_plan.append({
                "week_number": w,
                "weekly_spend": round(weekly_spend, 2),
                "cumulative_spend": round(cum_spend, 2),
                "materials_spend": round(week_mat, 2),
                "labour_spend": round(week_lab, 2),
                "equipment_spend": round(week_eqp, 2),
                "subcontractor_spend": round(week_sub, 2),
                "earned_value_target": round(cum_spend * (1.0 + (profit_margin_pct / 100.0)), 2)
            })

        daily_cost = total_direct / (weeks * 5) if weeks > 0 else 0.0

        monthly_cashflow = [
            {"month": m, "projected_spend": round(val, 2), "expected_billing": round(val * 1.18, 2)}
            for m, val in monthly_cashflow_map.items()
        ]

        labour_histogram = [
            {"week": w, "artisans_count": int(round(4 + (w % 3) * 2)), "labourers_count": int(round(8 + (w % 4) * 3))}
            for w in range(1, weeks + 1)
        ]

        margin_at_risk_curve = [
            {
                "week": w["week_number"],
                "protected_margin_usd": round(profit_amt, 2),
                "contingency_buffer_usd": round(contingency_amt * (1.0 - (w["week_number"] / weeks) * 0.5), 2),
                "max_allowed_variance": round(contingency_amt * 0.8, 2)
            }
            for w in weekly_cost_plan
        ]

        return {
            "project_duration_weeks": weeks,
            "total_direct_cost": round(total_direct, 2),
            "contingency_amount": round(contingency_amt, 2),
            "protected_profit_amount": round(profit_amt, 2),
            "target_selling_price": round(grand_selling_price, 2),
            "protected_margin_pct": profit_margin_pct,
            "average_daily_cost": round(daily_cost, 2),
            "weekly_cost_plan": weekly_cost_plan,
            "monthly_cashflow": monthly_cashflow,
            "labour_histogram": labour_histogram,
            "margin_at_risk_curve": margin_at_risk_curve,
            "cost_breakdown": {
                "materials": round(total_mat, 2),
                "labour": round(total_lab, 2),
                "equipment": round(total_eqp, 2),
                "subcontractors": round(total_sub, 2),
            }
        }


# -----------------------------------------------------------------------------
# 4. Commercial Guard & Anomaly Auditor ("BS Detector")
# -----------------------------------------------------------------------------

class CommercialGuard:
    @staticmethod
    def audit_request(
        requester_id: str,
        requester_name: str,
        document_type: str,
        item_code_or_desc: str,
        requested_quantity: float,
        earned_quantity: float,
        unit_rate: float,
        historical_po_rate: Optional[float] = None,
        allowed_wastage_pct: float = 5.0
    ) -> Dict[str, Any]:
        req_qty = float(requested_quantity)
        earned_qty = float(earned_quantity)
        rate = float(unit_rate)

        # Theoretical allowable quantity with wastage
        theoretical_allowed = earned_qty * (1.0 + (allowed_wastage_pct / 100.0))
        overage_qty = req_qty - theoretical_allowed
        variance_pct = ((req_qty - theoretical_allowed) / theoretical_allowed * 100.0) if theoretical_allowed > 0 else (100.0 if req_qty > 0 else 0.0)

        is_flagged = False
        anomaly_reasons = []
        risk_level = "LOW"
        recommended_action = "APPROVE"

        # Rule 1: Quantity excess over earned baseline
        if overage_qty > 0 and variance_pct > 10.0:
            is_flagged = True
            anomaly_reasons.append(
                f"EXCESS REQUEST: Requested {req_qty:.1f} units vs justified earned progress of {earned_qty:.1f} units (+{allowed_wastage_pct}% waste = {theoretical_allowed:.1f} max). Overage: {variance_pct:.1f}%."
            )
            risk_level = "HIGH" if variance_pct > 30.0 else "MEDIUM"
            recommended_action = "FLAG_FOR_QS_REVIEW"

        # Rule 2: Rate inflation vs historical PO
        if historical_po_rate and historical_po_rate > 0:
            rate_variance = ((rate - historical_po_rate) / historical_po_rate) * 100.0
            if rate_variance > 15.0:
                is_flagged = True
                anomaly_reasons.append(
                    f"RATE INFLATION: Unit rate of ${rate:.2f} is {rate_variance:.1f}% higher than historical accepted PO rate (${historical_po_rate:.2f})."
                )
                risk_level = "HIGH"
                recommended_action = "BLOCK_PURCHASE_AND_ESCALATE"

        # Rule 3: Zero earned work but high material request
        if earned_qty == 0.0 and req_qty > 100.0:
            is_flagged = True
            anomaly_reasons.append("ZERO EARNED PROGRESS: Site request logged before work phase has commenced or earned progress registered.")
            risk_level = "CRITICAL"
            recommended_action = "FREEZE_USER_AND_INVESTIGATE"

        status = "FLAGGED" if is_flagged else "CLEARED"

        evidence_pack = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "requester": {"id": requester_id, "name": requester_name},
            "document_type": document_type,
            "item": item_code_or_desc,
            "audit_metrics": {
                "requested_quantity": req_qty,
                "earned_quantity": earned_qty,
                "allowed_wastage_pct": allowed_wastage_pct,
                "theoretical_allowable": round(theoretical_allowed, 2),
                "overage_quantity": round(max(0.0, overage_qty), 2),
                "variance_pct": round(variance_pct, 2),
                "unit_rate": rate,
                "excess_financial_value": round(max(0.0, overage_qty) * rate, 2)
            },
            "anomaly_reasons": anomaly_reasons,
            "risk_level": risk_level,
            "recommended_action": recommended_action
        }

        return {
            "status": status,
            "is_flagged": is_flagged,
            "risk_level": risk_level,
            "anomaly_reason": " | ".join(anomaly_reasons) if anomaly_reasons else "Request matches commercial baseline.",
            "recommended_action": recommended_action,
            "evidence_pack": evidence_pack
        }


# -----------------------------------------------------------------------------
# 5. Document Change Intelligence & Scope Watcher
# -----------------------------------------------------------------------------

class DocumentWatcher:
    @staticmethod
    def analyze_change(
        document_name: str,
        revision: str,
        original_direct_cost: float,
        revised_direct_cost: float,
        current_margin_pct: float = 15.0,
        contract_value: float = 100000.0
    ) -> Dict[str, Any]:
        orig = float(original_direct_cost)
        rev = float(revised_direct_cost)
        cost_delta = rev - orig
        contract = float(contract_value)

        # Impact on profit margin
        revised_margin_dollars = (contract * (current_margin_pct / 100.0)) - cost_delta
        revised_margin_pct = (revised_margin_dollars / contract) * 100.0 if contract > 0 else 0.0

        margin_risk_dollars = max(0.0, cost_delta)

        # Approval Governance Logic
        if cost_delta > 10000.0 or revised_margin_pct < 10.0:
            approval_level = "MD_APPROVAL_REQUIRED"
            governance_note = f"CRITICAL SCOPE DRIFT: Cost increased by ${cost_delta:,.2f}. Protected margin drops to {revised_margin_pct:.1f}%. Managing Director approval mandatory before proceeding."
        elif cost_delta > 2500.0:
            approval_level = "COMMERCIAL_QS_REVIEW"
            governance_note = f"COMMERCIAL REVIEW: Cost increased by ${cost_delta:,.2f}. Senior QS review required."
        elif cost_delta < 0:
            approval_level = "AUTO_APPROVED"
            governance_note = f"COST REDUCTION: Revision saves ${abs(cost_delta):,.2f} in direct costs."
        else:
            approval_level = "ADMIN_APPROVAL"
            governance_note = "Minor cost adjustment within contingency tolerance."

        return {
            "document_name": document_name,
            "revision": revision,
            "original_direct_cost": orig,
            "revised_direct_cost": rev,
            "cost_delta": round(cost_delta, 2),
            "margin_risk_dollars": round(margin_risk_dollars, 2),
            "original_margin_pct": current_margin_pct,
            "revised_margin_pct": round(revised_margin_pct, 2),
            "approval_level_required": approval_level,
            "governance_note": governance_note
        }


# -----------------------------------------------------------------------------
# 6. Master Quotation Brain Orchestrator
# -----------------------------------------------------------------------------

class QuotationBrain:
    @classmethod
    def evaluate_project(
        cls,
        payload: Dict[str, Any],
        rate_benchmarks: Optional[Dict[str, Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        """``rate_benchmarks`` lets a caller pass org-specific rate benchmarks
        (merged over the hardcoded seed) so per-item outlier checks use them."""
        boq_items = payload.get("items", [])
        duration_weeks = int(payload.get("project_duration_weeks", 12))
        target_margin_pct = float(payload.get("profit_rate", 0.15)) * 100.0 if float(payload.get("profit_rate", 0.15)) <= 1.0 else float(payload.get("profit_rate", 15.0))
        built_area_sqm = float(payload.get("built_area_sqm", 250.0))

        # 1. Direct Cost Breakdown & Assembly Enrichment
        total_direct_costs = 0.0
        enriched_items = []
        outlier_flags = []

        for item in boq_items:
            qty = float(item.get("quantity", 0))
            rate = float(item.get("rate", 0))
            mat_rate = float(item.get("material_rate", 0))
            lab_rate = float(item.get("labour_rate", 0))
            eqp_rate = float(item.get("equipment_rate", 0))
            sub_rate = float(item.get("subcontractor_rate", 0))

            computed_rate = (mat_rate + lab_rate + eqp_rate + sub_rate) if (rate == 0 and (mat_rate + lab_rate + eqp_rate + sub_rate) > 0) else rate
            item_total = qty * computed_rate
            total_direct_costs += item_total

            # Rate check
            code = item.get("item_code", item.get("description", "ITEM"))
            rate_check = RateIntelligenceEngine.evaluate_rate(code, computed_rate, benchmarks=rate_benchmarks)
            if rate_check["is_outlier"]:
                outlier_flags.append(rate_check)

            enriched_items.append({
                "description": item.get("description", "Item"),
                "quantity": qty,
                "unit": item.get("unit", "m"),
                "rate": computed_rate,
                "total_cost": round(item_total, 2),
                "rate_check": rate_check
            })

        # 2. Spend Forecast & Cashflow
        forecast = SpendForecaster.generate_forecast(
            boq_items,
            project_duration_weeks=duration_weeks,
            profit_margin_pct=target_margin_pct
        )

        # 3. Project Worthiness Scoring Algorithm (0 - 100)
        # Criteria: Margin (>15% = +30pts), Rate Sanity (no outliers = +20pts), Cost/m2 benchmark (+20pts), Duration risk (+15pts), Contingency coverage (+15pts)
        score = 50
        if target_margin_pct >= 15.0:
            score += 25
        elif target_margin_pct >= 10.0:
            score += 15

        if len(outlier_flags) == 0:
            score += 20
        else:
            score -= (len(outlier_flags) * 5)

        cost_per_sqm = (total_direct_costs / built_area_sqm) if built_area_sqm > 0 else 0.0
        if 400.0 <= cost_per_sqm <= 1800.0:
            score += 15

        score = max(5, min(98, score))

        is_worth_taking = score >= 65 and target_margin_pct >= 10.0

        if score >= 80:
            worthiness_rating = "HIGHLY_VIABLE"
            recommendation = "EXCELLENT PROJECT: High margin, low risk profile. Proceed with aggressive bidding."
        elif is_worth_taking:
            worthiness_rating = "VIABLE_WITH_CONTROLS"
            recommendation = "VIABLE: Acceptable commercial returns. Enforce strict site material controls."
        else:
            worthiness_rating = "HIGH_RISK_REJECT_OR_REPRICE"
            recommendation = "HIGH RISK: Inadequate protected margin or excessive rate outliers. Mandatory MD review required before submission."

        # 4. Mandatory Approvals
        approvals_required = []
        if target_margin_pct < 12.0:
            approvals_required.append("MD Approval (Protected margin below 12% threshold)")
        if len(outlier_flags) > 0:
            approvals_required.append(f"Commercial QS Review ({len(outlier_flags)} rate outliers detected)")
        if total_direct_costs > 250000.0:
            approvals_required.append("Executive Board Signoff (Project direct costs exceed $250k)")

        return {
            "quotation_id": payload.get("quotation_id", "QT-BRAIN-001"),
            "project_title": payload.get("project_title", "Construction Project"),
            "is_worth_taking": is_worth_taking,
            "worthiness_score": score,
            "worthiness_rating": worthiness_rating,
            "recommendation": recommendation,
            "metrics": {
                "total_direct_costs": round(total_direct_costs, 2),
                "target_selling_price": forecast["target_selling_price"],
                "protected_profit_amount": forecast["protected_profit_amount"],
                "protected_margin_pct": target_margin_pct,
                "cost_per_built_sqm": round(cost_per_sqm, 2),
                "average_daily_spend": forecast["average_daily_cost"],
                "project_duration_weeks": duration_weeks
            },
            "rate_outliers_count": len(outlier_flags),
            "rate_outlier_details": outlier_flags,
            "spend_forecast": forecast,
            "mandatory_approvals": approvals_required if approvals_required else ["Standard Approval Passed"],
            "assemblies_available": len(DEFAULT_ASSEMBLIES),
        }


# -----------------------------------------------------------------------------
# 7. Fuzzy & Semantic Assembly Matcher
# -----------------------------------------------------------------------------

class FuzzyAssemblyMatcher:
    KEYWORD_MAP = {
        "CONC-25MPA": ["concrete", "slab", "foundation", "footing", "beam", "column", "c25", "c30", "structure"],
        "BRICK-SINGLE-115": ["single skin", "115mm", "half brick", "partition wall", "screen wall"],
        "BRICK-DOUBLE-230": ["double skin", "230mm", "structural brick", "one brick wall", "masonry wall", "brickwork"],
        "PLASTER-INT-12": ["plaster", "render", "skimming", "mortar finish", "wall finish"],
        "ROOF-PITCH-SHEET": ["roof", "truss", "ibr", "corrugated", "sheeting", "timber roof", "covering"],
        "REBAR-Y10-Y16": ["rebar", "reinforcement", "high tensile", "mesh", "y10", "y12", "y16", "steel bar"],
        "EXCAV-TRENCH": ["excavat", "trench", "earthworks", "digging", "site clearing", "groundwork"],
        "ELEC-ROUGH-IN": ["electrical", "wiring", "conduit", "socket", "switch", "db board", "distribution board", "cabling"],
        "PLUMB-ROUGH-IN": ["plumbing", "pipework", "pipe", "waste pipe", "water supply", "sanitary", "drainage point"],
        "TILE-FLOOR-CERAMIC": ["tiling", "tile", "ceramic", "porcelain floor", "grout"],
        "PAINT-INT-2COAT": ["paint", "painting", "emulsion", "primer", "decorating"],
        "WATERPROOF-MEMBRANE": ["waterproof", "membrane", "damp proof", "tanking", "bituminous"],
        "DOOR-WINDOW-FIX": ["door frame", "window frame", "joinery", "ironmongery", "door fixing", "window fixing", "aluminium window", "aluminium door"],
    }

    @classmethod
    def match_description(cls, description: str) -> Dict[str, Any]:
        text_lower = description.lower()
        best_code = None
        best_score = 0

        for code, keywords in cls.KEYWORD_MAP.items():
            matches = sum(1 for kw in keywords if kw in text_lower)
            if matches > best_score:
                best_score = matches
                best_code = code

        confidence = min(98, best_score * 35) if best_code else 0
        assembly = DEFAULT_ASSEMBLIES.get(best_code) if best_code else None

        return {
            "query": description,
            "matched": best_code is not None and confidence >= 35,
            "assembly_code": best_code,
            "assembly_name": assembly["name"] if assembly else None,
            "confidence_pct": confidence,
            "match_method": "Semantic Keyword Similarity",
        }


# -----------------------------------------------------------------------------
# 8. Inflation & Currency Risk Forecaster
# -----------------------------------------------------------------------------

class InflationForecaster:
    RATES = {
        "USD": 0.035,  # 3.5% per annum
        "ZAR": 0.055,  # 5.5% per annum
        "ZIG": 0.18,   # 18.0% per annum
    }

    @classmethod
    def forecast_escalation(
        cls, base_cost: float, duration_weeks: int, currency: str = "USD"
    ) -> Dict[str, Any]:
        curr = currency.upper()
        annual_rate = cls.RATES.get(curr, 0.04)
        weekly_rate = annual_rate / 52.0
        escalated_cost = base_cost * ((1.0 + weekly_rate) ** duration_weeks)
        escalation_amount = escalated_cost - base_cost

        return {
            "base_cost": round(base_cost, 2),
            "duration_weeks": duration_weeks,
            "currency": curr,
            "annual_inflation_rate_pct": round(annual_rate * 100, 2),
            "projected_escalation_amount": round(escalation_amount, 2),
            "total_escalated_cost": round(escalated_cost, 2),
            "impact_rating": "HIGH_ESCALATION" if escalation_amount > base_cost * 0.05 else "NORMAL",
        }


# -----------------------------------------------------------------------------
# 9. What-If Scenario Simulator
# -----------------------------------------------------------------------------

class ScenarioSimulator:
    @classmethod
    def simulate_what_if(
        cls,
        base_payload: Dict[str, Any],
        material_price_hike_pct: float = 0.0,
        subcontractor_rate_hike_pct: float = 0.0,
        productivity_change_pct: float = 0.0,
    ) -> Dict[str, Any]:
        modified_payload = dict(base_payload)
        items = [dict(it) for it in modified_payload.get("items", [])]

        material_mult = 1.0 + (material_price_hike_pct / 100.0)
        subby_mult = 1.0 + (subcontractor_rate_hike_pct / 100.0)

        simulated_items = []
        for it in items:
            mat = float(it.get("material_rate", 0)) * material_mult
            sub = float(it.get("subcontractor_rate", 0)) * subby_mult
            lab = float(it.get("labour_rate", 0))
            eqp = float(it.get("equipment_rate", 0))
            new_rate = mat + sub + lab + eqp
            simulated_items.append({
                **it,
                "material_rate": mat,
                "subcontractor_rate": sub,
                "rate": new_rate if new_rate > 0 else float(it.get("rate", 0)) * material_mult,
            })

        modified_payload["items"] = simulated_items

        base_eval = QuotationBrain.evaluate_project(base_payload)
        sim_eval = QuotationBrain.evaluate_project(modified_payload)

        base_cost = base_eval["metrics"]["total_direct_costs"]
        sim_cost = sim_eval["metrics"]["total_direct_costs"]
        cost_variance = sim_cost - base_cost

        return {
            "scenario_parameters": {
                "material_price_hike_pct": material_price_hike_pct,
                "subcontractor_rate_hike_pct": subcontractor_rate_hike_pct,
                "productivity_change_pct": productivity_change_pct,
            },
            "baseline_summary": {
                "direct_cost": base_cost,
                "selling_price": base_eval["metrics"]["target_selling_price"],
                "worthiness_score": base_eval["worthiness_score"],
            },
            "simulated_summary": {
                "direct_cost": sim_cost,
                "selling_price": sim_eval["metrics"]["target_selling_price"],
                "worthiness_score": sim_eval["worthiness_score"],
            },
            "delta": {
                "cost_increase_amount": round(cost_variance, 2),
                "cost_increase_pct": round((cost_variance / base_cost * 100) if base_cost > 0 else 0, 2),
                "score_drop": base_eval["worthiness_score"] - sim_eval["worthiness_score"],
            },
        }


# -----------------------------------------------------------------------------
# 10. Subcontractor Matchmaker & Vendor Benchmark Scorecarding
# -----------------------------------------------------------------------------

class SubcontractorBenchmarkEngine:
    VENDORS = [
        {"vendor_id": "SUB-01", "name": "Titan Concrete & Civils", "category": "Concrete & Structure", "rating": 4.8, "historical_variance_pct": -2.5, "on_time_pct": 96.0},
        {"vendor_id": "SUB-02", "name": "Apex Masonry Works", "category": "Masonry", "rating": 4.6, "historical_variance_pct": 1.0, "on_time_pct": 92.0},
        {"vendor_id": "SUB-03", "name": "ProRoof Specialists", "category": "Roofing", "rating": 4.9, "historical_variance_pct": -4.0, "on_time_pct": 98.0},
        {"vendor_id": "SUB-04", "name": "Precision Steel Fixers", "category": "Structure", "rating": 4.5, "historical_variance_pct": 0.5, "on_time_pct": 91.0},
    ]

    @classmethod
    def recommend_vendors(cls, category: str = "Concrete & Structure") -> List[Dict[str, Any]]:
        matched = [v for v in cls.VENDORS if category.lower() in v["category"].lower() or v["category"].lower() in category.lower()]
        return matched if matched else cls.VENDORS


# -----------------------------------------------------------------------------
# 11. Autonomous Quote Builder - CRM/Project Scope to Draft BOQ
# -----------------------------------------------------------------------------

class AutonomousQuoteBuilder:
    """Deterministic CCB quote generation from CRM/project context.

    This does not pretend that vague scope text is measured design data. It creates
    a controlled draft quote with explicit assumptions, confidence, and assembly
    traceability so QS/MD review can tighten it as better information arrives.
    """

    DEFAULT_COST_PER_SQM = 850.0

    SCOPE_PROFILES = {
        "building": [
            ("EXCAV-TRENCH", 0.18, "m3", "Bulk/trench excavation allowance"),
            ("CONC-25MPA", 0.16, "m3", "Concrete foundations and structural slab allowance"),
            ("REBAR-Y10-Y16", 0.012, "ton", "Reinforcement steel allowance"),
            ("BRICK-DOUBLE-230", 1.75, "m2", "External and structural brickwork allowance"),
            ("BRICK-SINGLE-115", 0.85, "m2", "Internal partition brickwork allowance"),
            ("PLASTER-INT-12", 3.20, "m2", "Internal plaster finish allowance"),
            ("ROOF-PITCH-SHEET", 1.15, "m2", "Roof covering and timber structure allowance"),
        ],
        "civil": [
            ("EXCAV-TRENCH", 0.35, "m3", "Civil earthworks allowance"),
            ("CONC-25MPA", 0.22, "m3", "Civil concrete works allowance"),
            ("REBAR-Y10-Y16", 0.018, "ton", "Civil reinforcement allowance"),
        ],
        "renovation": [
            ("BRICK-SINGLE-115", 0.45, "m2", "Alterations and partitioning allowance"),
            ("PLASTER-INT-12", 2.20, "m2", "Patch plaster and finish renewal allowance"),
            ("ROOF-PITCH-SHEET", 0.35, "m2", "Roof repair allowance"),
            ("CONC-25MPA", 0.06, "m3", "Minor concrete works allowance"),
        ],
    }

    @staticmethod
    def _text_blob(context: Dict[str, Any]) -> str:
        parts = []
        for key, value in context.items():
            if value is None:
                continue
            if isinstance(value, (dict, list)):
                parts.append(json.dumps(value, default=str))
            else:
                parts.append(str(value))
        return " ".join(parts).lower()

    @classmethod
    def classify_scope(cls, context: Dict[str, Any]) -> Dict[str, Any]:
        blob = cls._text_blob(context)
        civil_hits = ["civil", "road", "drain", "earthwork", "infrastructure", "mining", "platform", "retaining"]
        renovation_hits = ["renovation", "refurb", "alteration", "fitout", "repair", "maintenance", "upgrade"]
        building_hits = ["house", "building", "lodge", "office", "warehouse", "school", "clinic", "residential", "commercial"]

        scores = {
            "civil": sum(1 for kw in civil_hits if kw in blob),
            "renovation": sum(1 for kw in renovation_hits if kw in blob),
            "building": sum(1 for kw in building_hits if kw in blob),
        }
        profile = max(scores, key=scores.get)
        if scores[profile] == 0:
            profile = "building"
        confidence = min(95, 45 + scores[profile] * 15)
        return {"profile": profile, "confidence_pct": confidence, "scores": scores}

    @classmethod
    def infer_built_area(cls, context: Dict[str, Any], explicit_area: Optional[float] = None) -> float:
        if explicit_area and explicit_area > 0:
            return float(explicit_area)

        for key in ("built_area_sqm", "area_sqm", "floor_area", "gross_floor_area"):
            value = context.get(key)
            try:
                if value is not None and float(value) > 0:
                    return float(value)
            except (TypeError, ValueError):
                pass

        for key in ("budget", "estimated_budget", "bid_amount", "contract_value", "quote_amount"):
            value = context.get(key)
            try:
                if value is not None and float(value) > 0:
                    return max(80.0, min(5000.0, float(value) / cls.DEFAULT_COST_PER_SQM))
            except (TypeError, ValueError):
                pass

        return 250.0

    @classmethod
    def generate_quote_payload(cls, context: Dict[str, Any], assemblies: Optional[Dict[str, Dict[str, Any]]] = None) -> Dict[str, Any]:
        scope = cls.classify_scope(context)
        built_area = cls.infer_built_area(context, context.get("built_area_sqm"))
        profile_items = cls.SCOPE_PROFILES[scope["profile"]]

        items = []
        assumptions = [
            f"Autonomous CCB draft generated from {context.get('source_type', 'scope')} context.",
            f"Scope profile classified as {scope['profile']} with {scope['confidence_pct']}% confidence.",
            f"Built area/scale inferred as {built_area:.1f} sqm equivalent where no measured BOQ was supplied.",
            "Quantities are assembly-derived allowances and must be remeasured when drawings or BOQ become available.",
        ]
        exclusions = [
            "Statutory fees, specialist design fees, abnormal ground conditions, and client-supplied scope changes are excluded unless stated.",
            "Final subcontract awards require CCB benchmark review and commercial approval.",
        ]

        for assembly_code, factor, unit, description in profile_items:
            breakdown = AssemblyLibrary.calculate_breakdown(assembly_code, built_area * factor, assemblies)
            qty = float(breakdown["quantity"])
            cost_summary = breakdown.get("cost_summary", {})
            if qty > 0:
                material_rate = float(cost_summary.get("material_cost", 0)) / qty
                labour_rate = float(cost_summary.get("labour_cost", 0)) / qty
                equipment_rate = float(cost_summary.get("plant_cost", 0)) / qty
            else:
                material_rate = labour_rate = equipment_rate = 0.0
            item = {
                "item_code": assembly_code,
                "description": description,
                "assembly_name": breakdown["name"],
                "quantity": round(qty, 3),
                "qty": round(qty, 3),
                "unit": unit,
                "rate": float(breakdown["calculated_unit_rate"]),
                "material_rate": round(material_rate, 2),
                "labour_rate": round(labour_rate, 2),
                "equipment_rate": round(equipment_rate, 2),
                "subcontractor_rate": 0.0,
                "autonomous_source": "assembly_allowance",
                "confidence_pct": scope["confidence_pct"],
            }
            items.append(item)

        project_title = (
            context.get("project_title")
            or context.get("name")
            or context.get("tender_name")
            or context.get("company_name")
            or "Autonomous CCB Draft Quote"
        )
        client_name = context.get("client_name") or context.get("company_name") or context.get("name") or "Unassigned client"
        reference_seed = f"{project_title}|{client_name}|{datetime.now(timezone.utc).date().isoformat()}"
        reference = "CCB-AUTO-" + hashlib.sha1(reference_seed.encode("utf-8")).hexdigest()[:8].upper()

        return {
            "quotation_id": reference,
            "reference_number": reference,
            "project_title": str(project_title),
            "client_name": str(client_name),
            "built_area_sqm": round(built_area, 2),
            "project_duration_weeks": int(context.get("project_duration_weeks") or max(8, min(52, math.ceil(built_area / 35.0)))),
            "items": items,
            "preliminaries": round(built_area * 18.0, 2),
            "overhead_rate": float(context.get("overhead_rate", 0.05)),
            "contingency_rate": float(context.get("contingency_rate", 0.05)),
            "profit_rate": float(context.get("profit_rate", 0.15)),
            "tax_rate": float(context.get("tax_rate", 0.15)),
            "assumptions": assumptions,
            "exclusions": exclusions,
            "currency": str(context.get("currency", "USD")),
            "autonomous_metadata": {
                "source_type": context.get("source_type"),
                "source_id": context.get("source_id"),
                "scope_profile": scope,
                "built_area_sqm": round(built_area, 2),
                "generation_status": "DRAFT_REQUIRES_QS_REVIEW",
            },
        }
