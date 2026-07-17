from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    Flowable,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


PROJECT_ID = "SNC-HOUSE-500K-001"
CLIENT_NAME = "Residential Client"
PROJECT_NAME = "Private Residence Construction Simulation"
TOTAL_BUDGET = Decimal("500000.00")
MARGIN_RATE = Decimal("0.15")
TARGET_GROSS_PROFIT = (TOTAL_BUDGET * MARGIN_RATE).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
MAX_INTERNAL_COST = (TOTAL_BUDGET - TARGET_GROSS_PROFIT).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
DIRECT_WORKS_TARGET = Decimal("385000.00")
CONTINGENCY_TARGET = Decimal("25000.00")
MANAGEMENT_RESERVE_TARGET = Decimal("15000.00")
OUTPUT_DIR = Path("output/pdf")
DATA_DIR = Path("generated/quotations/residential_500k")
PDF_PATH = OUTPUT_DIR / "SNC-HOUSE-500K-Complete-Construction-Pack.pdf"
JSON_PATH = DATA_DIR / "SNC-HOUSE-500K-simulation.json"


@dataclass(frozen=True)
class BoqLine:
    code: str
    section: str
    description: str
    unit: str
    quantity: Decimal
    rate: Decimal

    @property
    def total(self) -> Decimal:
        return money(self.quantity * self.rate)


@dataclass(frozen=True)
class MonthTarget:
    month: int
    target: str
    deliverables: str
    planned_revenue: Decimal
    planned_cost: Decimal
    protected_profit: Decimal


@dataclass(frozen=True)
class WeekPlan:
    week: int
    phase: str
    activities: str
    deliverables: str
    planned_revenue: Decimal
    planned_cost: Decimal
    protected_profit: Decimal


@dataclass(frozen=True)
class DayPlan:
    day: int
    week: int
    phase: str
    activities: str
    inspection: str
    hours: Decimal
    planned_cost: Decimal
    planned_revenue: Decimal
    protected_profit: Decimal


@dataclass(frozen=True)
class MaterialLine:
    package: str
    material: str
    unit: str
    quantity: Decimal
    target_rate: Decimal
    target_total: Decimal
    preferred_supplier: str
    backup_supplier: str
    lead_time_days: int
    order_by_week: int
    quote_validity_days: int
    margin_control: str


@dataclass(frozen=True)
class ScheduleScenario:
    scenario: str
    duration_weeks: int
    duration_days: int
    gross_profit: Decimal
    margin_percentage: Decimal
    assumptions: str
    commercial_position: str


@dataclass(frozen=True)
class ScenarioDriver:
    driver: str
    best_case: str
    expected_case: str
    delay_case: str
    margin_response: str


def money(value: Decimal) -> Decimal:
    return Decimal(value).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def money_text(value: Decimal) -> str:
    return f"${money(value):,.2f}"


def para(text: str, style: ParagraphStyle) -> Paragraph:
    return Paragraph(str(text).replace("\n", "<br/>"), style)


class BarChart(Flowable):
    def __init__(self, labels: list[str], values: list[Decimal], width: float, height: float):
        super().__init__()
        self.labels = labels
        self.values = values
        self.width = width
        self.height = height

    def draw(self) -> None:
        max_value = max(self.values) if self.values else Decimal("1")
        left = 30
        bottom = 22
        chart_w = self.width - 50
        chart_h = self.height - 45
        bar_gap = 4
        bar_w = max(8, (chart_w / len(self.values)) - bar_gap)

        self.canv.setStrokeColor(colors.HexColor("#CBD5E1"))
        self.canv.line(left, bottom, left, bottom + chart_h)
        self.canv.line(left, bottom, left + chart_w, bottom)

        for idx, value in enumerate(self.values):
            x = left + idx * (bar_w + bar_gap)
            h = float(value / max_value) * chart_h
            self.canv.setFillColor(colors.HexColor("#1D4ED8"))
            self.canv.rect(x, bottom, bar_w, h, stroke=0, fill=1)
            self.canv.setFillColor(colors.HexColor("#0F172A"))
            self.canv.setFont("Helvetica", 6)
            label = self.labels[idx]
            if any(len(item) > 8 for item in self.labels):
                label = f"S{idx + 1}"
            if len(label) > 12:
                label = label[:10] + "."
            self.canv.saveState()
            self.canv.translate(x + bar_w / 2, 8)
            self.canv.rotate(35)
            self.canv.drawCentredString(0, 0, label)
            self.canv.restoreState()
            self.canv.saveState()
            self.canv.translate(x + bar_w / 2, bottom + h + 4)
            self.canv.rotate(65)
            self.canv.drawString(0, 0, f"{int(value / Decimal('1000'))}k")
            self.canv.restoreState()


def build_boq() -> list[BoqLine]:
    raw = [
        ("1.01", "Preliminaries", "Permits, setting out, temporary services, site offices", "sum", "1", "18500"),
        ("1.02", "Preliminaries", "Insurance, compliance, security, HSE controls", "sum", "1", "9500"),
        ("2.01", "Siteworks", "Clearing, grubbing, bulk earthworks and compaction", "m2", "1850", "12"),
        ("2.02", "Siteworks", "Stormwater, soakaways and external drainage", "sum", "1", "14500"),
        ("3.01", "Substructure", "Excavations, anti-termite treatment and cart-away", "m3", "420", "38"),
        ("3.02", "Substructure", "Reinforced concrete strip and pad foundations", "m3", "115", "235"),
        ("3.03", "Substructure", "Ground slab, damp proofing and mesh reinforcement", "m2", "430", "82"),
        ("4.01", "Superstructure", "Brick/block walls including lintels and wall ties", "m2", "1320", "48"),
        ("4.02", "Superstructure", "Reinforced concrete columns, beams and ring beams", "m3", "58", "410"),
        ("4.03", "Superstructure", "Structural steel feature supports and fixings", "ton", "7.5", "1850"),
        ("5.01", "Roofing", "Timber/steel trusses, bracing and roof framing", "m2", "510", "72"),
        ("5.02", "Roofing", "Roof covering, insulation, flashings and gutters", "m2", "510", "78"),
        ("6.01", "Envelope", "Aluminium windows and external glazed doors", "m2", "96", "330"),
        ("6.02", "Envelope", "Main entrance, garage doors and security ironmongery", "sum", "1", "18200"),
        ("7.01", "Internal finishes", "Floor screeds, porcelain tiles and skirtings", "m2", "420", "74"),
        ("7.02", "Internal finishes", "Ceilings, bulkheads and cornices", "m2", "420", "42"),
        ("7.03", "Internal finishes", "Internal doors, wardrobes and joinery allowance", "sum", "1", "38500"),
        ("7.04", "Internal finishes", "Painting, wall finishes and decorative coatings", "m2", "2100", "12"),
        ("8.01", "Kitchen and bathrooms", "Kitchen cabinetry, countertops and appliances allowance", "sum", "1", "42000"),
        ("8.02", "Kitchen and bathrooms", "Sanitaryware, vanities, mixers and accessories", "sum", "1", "27500"),
        ("9.01", "MEP", "Electrical reticulation, DBs, lighting and power points", "sum", "1", "38500"),
        ("9.02", "MEP", "Plumbing, hot water systems and pressure pumps", "sum", "1", "29800"),
        ("9.03", "MEP", "HVAC and ventilation allowance", "sum", "1", "16500"),
        ("9.04", "MEP", "Data, CCTV, access control and smart-home rough-in", "sum", "1", "14500"),
        ("10.01", "External works", "Driveway paving, walkways and apron slabs", "m2", "520", "46"),
        ("10.02", "External works", "Boundary works, gates and perimeter lighting allowance", "sum", "1", "22500"),
        ("10.03", "External works", "Landscaping, irrigation and final clean", "sum", "1", "16500"),
        ("11.01", "Professional and closeout", "Testing, inspections, as-builts and handover manuals", "sum", "1", "9500"),
    ]
    raw_total = sum((Decimal(qty) * Decimal(rate) for _, _, _, _, qty, rate in raw), Decimal("0"))
    value_engineering_factor = DIRECT_WORKS_TARGET / raw_total
    lines = [
        BoqLine(code, section, description, unit, Decimal(qty), money(Decimal(rate) * value_engineering_factor))
        for code, section, description, unit, qty, rate in raw
    ]
    delta = money(DIRECT_WORKS_TARGET - sum((line.total for line in lines), Decimal("0")))
    if delta:
        last = lines[-1]
        adjusted_rate = money(last.rate + (delta / last.quantity))
        lines[-1] = BoqLine(last.code, last.section, last.description, last.unit, last.quantity, adjusted_rate)
    return lines


def grouped_totals(boq: list[BoqLine]) -> dict[str, Decimal]:
    totals: dict[str, Decimal] = {}
    for line in boq:
        totals[line.section] = money(totals.get(line.section, Decimal("0")) + line.total)
    return totals


def build_quote(boq: list[BoqLine]) -> dict[str, Decimal]:
    direct = money(sum((line.total for line in boq), Decimal("0")))
    contingency = money(CONTINGENCY_TARGET)
    management_reserve = money(MANAGEMENT_RESERVE_TARGET)
    internal_cost_ceiling = money(direct + contingency + management_reserve)
    gross_profit = money(TOTAL_BUDGET - internal_cost_ceiling)
    margin_percentage = money((gross_profit / TOTAL_BUDGET) * Decimal("100"))
    return {
        "direct_costs": direct,
        "contingency": contingency,
        "management_reserve": management_reserve,
        "internal_cost_ceiling": internal_cost_ceiling,
        "gross_profit": gross_profit,
        "margin_percentage": margin_percentage,
        "quotation_total": TOTAL_BUDGET,
        "max_cost_to_protect_margin": MAX_INTERNAL_COST,
        "cost_variance_buffer": money(MAX_INTERNAL_COST - internal_cost_ceiling),
    }


def build_month_targets() -> list[MonthTarget]:
    raw = [
        (1, "Mobilise and lock design", "Permits, setting out, procurement baseline, site establishment", "36000"),
        (2, "Complete earthworks and foundations", "Excavations, foundations, substructure inspections", "54000"),
        (3, "Slab and structural shell", "Ground slab, columns, beams, masonry to wall plate", "62000"),
        (4, "Roof and envelope dry-in", "Roof structure, covering, windows and external doors", "68000"),
        (5, "MEP rough-ins and wet trades", "Electrical, plumbing, HVAC first fix, plastering, screeds", "60000"),
        (6, "Internal finishes start", "Ceilings, tiling, joinery manufacture, painting first coats", "64000"),
        (7, "Fit-out and external works", "Kitchen, bathrooms, paving, boundary works, services testing", "67000"),
        (8, "Commissioning and defects", "MEP commissioning, snag closure, landscaping, authority inspections", "56000"),
        (9, "Handover and closeout", "Final clean, manuals, as-builts, client training, occupation support", "33000"),
    ]
    return [
        MonthTarget(
            month,
            target,
            deliverables,
            money(Decimal(value)),
            money(Decimal(value) * (Decimal("1") - MARGIN_RATE)),
            money(Decimal(value) * MARGIN_RATE),
        )
        for month, target, deliverables, value in raw
    ]


def build_week_plan(months: list[MonthTarget]) -> list[WeekPlan]:
    phase_by_week = [
        ("Mobilisation", "Contract signing, kickoff, design freeze register, site possession"),
        ("Mobilisation", "Survey, geotechnical confirmation, site establishment, temporary utilities"),
        ("Mobilisation", "Long-lead procurement, shop drawing log, council/authority coordination"),
        ("Mobilisation", "Final mobilisation gate, safety induction, baseline programme approval"),
        ("Groundworks", "Clear site, strip topsoil, bulk earthworks, benching and compaction"),
        ("Groundworks", "Excavate foundations, inspect bearing, anti-termite treatment"),
        ("Groundworks", "Fix reinforcement, pour strip/pad foundations, cube tests"),
        ("Groundworks", "Backfill, compact, install underground drainage and sleeves"),
        ("Substructure", "Ground slab preparation, DPM, mesh, edge formwork"),
        ("Substructure", "Pour ground slab, cure, dimensional check, start wall materials staging"),
        ("Superstructure", "Masonry to lintel height, columns and service sleeves"),
        ("Superstructure", "Masonry to wall plate, ring beams, lintels, structural inspections"),
        ("Superstructure", "Roof truss fabrication verification, gables, parapets, steel inserts"),
        ("Roofing", "Install roof structure, bracing, fascia backing, rainwater goods prep"),
        ("Roofing", "Roof sheeting/tiles, insulation, flashings, gutters"),
        ("Envelope", "Install windows, external doors, waterproofing, dry-in certificate"),
        ("MEP rough-in", "Electrical conduits, plumbing first fix, drainage pressure testing"),
        ("MEP rough-in", "HVAC sleeves, data/security rough-in, wall chasing closure"),
        ("Wet trades", "Internal plastering, external render, screeds, waterproofing wet areas"),
        ("Wet trades", "Tiling substrate checks, ceiling framing, joinery site measures"),
        ("Finishes", "Ceilings and bulkheads, first paint coats, tile installation begins"),
        ("Finishes", "Floor and wall tiling, internal door frames, cabinetry manufacture"),
        ("Finishes", "Painting second coats, sanitaryware backing, joinery delivery"),
        ("Finishes", "Kitchen install, wardrobes, vanities, feature finishes"),
        ("Fit-out", "Electrical second fix, plumbing second fix, HVAC equipment install"),
        ("Fit-out", "Appliance install, lighting, switches, smart-home commissioning prep"),
        ("External works", "Driveway base, paving, boundary works, gates and site drainage"),
        ("External works", "Landscaping, irrigation, external lighting and final grading"),
        ("Commissioning", "MEP testing, pressure tests, insulation tests, equipment startup"),
        ("Commissioning", "Snagging round 1, quality inspections, client walkthrough 1"),
        ("Commissioning", "Snag closeout, deep clean phase 1, as-built markups"),
        ("Commissioning", "Authority inspections, occupancy readiness, client training draft"),
        ("Handover", "Final paint touchups, appliance manuals, attic/roof inspection"),
        ("Handover", "Client walkthrough 2, defects closure, warranties compilation"),
        ("Handover", "Final clean, occupation certificate support, keys and controls"),
        ("Closeout", "Final account, retention schedule, maintenance plan, lessons learned"),
    ]
    weekly_revenue_values = []
    for month in months:
        for _ in range(4):
            weekly_revenue_values.append(money(month.planned_revenue / Decimal("4")))
    return [
        WeekPlan(
            week=idx + 1,
            phase=phase,
            activities=activity,
            deliverables=f"Approved weekly report W{idx + 1}, updated risk log, cost tracker, margin check",
            planned_revenue=weekly_revenue_values[idx],
            planned_cost=money(weekly_revenue_values[idx] * (Decimal("1") - MARGIN_RATE)),
            protected_profit=money(weekly_revenue_values[idx] * MARGIN_RATE),
        )
        for idx, (phase, activity) in enumerate(phase_by_week)
    ]


def build_day_plan(weeks: list[WeekPlan]) -> list[DayPlan]:
    day_plan: list[DayPlan] = []
    day = 1
    weekday_tasks = [
        ("Monday", "Plan crews, confirm materials, inspect previous work, release permits"),
        ("Tuesday", "Execute primary trade package, update drawings/RFIs, verify dimensions"),
        ("Wednesday", "Continue production, supervisor quality hold point, coordinate next trade"),
        ("Thursday", "Complete weekly production targets, test/inspect concealed work"),
        ("Friday", "Close snags, update programme, certify quantities, site clean and safety review"),
    ]
    for week in weeks:
        for weekday, rhythm in weekday_tasks:
            day_plan.append(
                DayPlan(
                    day=day,
                    week=week.week,
                    phase=week.phase,
                    activities=f"{weekday}: {week.activities}. {rhythm}.",
                    inspection="Daily diary, HSE checklist, photo record, foreman sign-off",
                    hours=Decimal("8"),
                    planned_cost=money(week.planned_cost / Decimal("5")),
                    planned_revenue=money(week.planned_revenue / Decimal("5")),
                    protected_profit=money(week.protected_profit / Decimal("5")),
                )
            )
            day += 1
    return day_plan


def build_material_schedule() -> list[MaterialLine]:
    raw = [
        ("Earthworks", "Diesel and plant fuel allowance", "litre", "5200", "1.45", "Fuel supplier A", "Fuel supplier B", 3, 1, 7, "Reconcile daily plant hours to fuel slips."),
        ("Concrete", "Ready-mix concrete 25-30MPa", "m3", "173", "112.00", "Batch plant A", "Batch plant B", 5, 4, 14, "Lock pour rates before foundation and slab sequence starts."),
        ("Concrete", "Reinforcing steel", "ton", "18", "980.00", "Steel supplier A", "Steel supplier B", 10, 3, 10, "No cutting list release without engineer-approved drawings."),
        ("Masonry", "Cement", "bag", "1850", "8.25", "Cement distributor A", "Cement distributor B", 5, 5, 7, "Weekly cement reconciliation against masonry and plaster output."),
        ("Masonry", "Blocks/bricks", "unit", "62000", "0.42", "Block supplier A", "Block supplier B", 7, 4, 14, "Reject under-strength/broken deliveries at gate."),
        ("Roofing", "Roof trusses/framing", "m2", "510", "28.00", "Truss fabricator A", "Truss fabricator B", 21, 8, 14, "Shop drawings approved before fabrication deposit."),
        ("Roofing", "Roof sheets/tiles, flashings, gutters", "m2", "510", "43.00", "Roof supplier A", "Roof supplier B", 14, 10, 10, "Confirm colour, gauge, coating warranty and wastage before order."),
        ("Envelope", "Aluminium windows and glazed doors", "m2", "96", "195.00", "Aluminium fabricator A", "Aluminium fabricator B", 28, 8, 14, "Site measure after openings; client approval on finish before deposit."),
        ("Finishes", "Porcelain floor and wall tiles", "m2", "620", "24.00", "Tile supplier A", "Tile supplier B", 14, 14, 7, "Client upgrades are variation orders, not contingency drawdowns."),
        ("Finishes", "Paint, primer and specialist coatings", "m2", "2100", "4.10", "Paint supplier A", "Paint supplier B", 5, 18, 14, "Approve paint schedule and sample wall before bulk purchase."),
        ("Joinery", "Kitchen, wardrobes and vanities", "sum", "1", "39000.00", "Joinery contractor A", "Joinery contractor B", 35, 12, 14, "Signed shop drawings and appliance list before manufacture."),
        ("MEP", "Electrical cable, DBs, conduits and fittings", "sum", "1", "22500.00", "Electrical wholesaler A", "Electrical wholesaler B", 10, 12, 7, "Material issue sheets matched to room-by-room point schedule."),
        ("MEP", "Lighting, switches and smart-home rough-in", "sum", "1", "13500.00", "Lighting supplier A", "Lighting supplier B", 21, 16, 7, "Client-selected fittings beyond allowance require signed VO."),
        ("MEP", "Plumbing pipes, valves, pumps and tanks", "sum", "1", "18200.00", "Plumbing supplier A", "Plumbing supplier B", 10, 12, 7, "Pressure-test before covering; supplier warranty captured."),
        ("Bathrooms", "Sanitaryware, mixers and accessories", "sum", "1", "24500.00", "Sanitaryware supplier A", "Sanitaryware supplier B", 21, 15, 7, "Finish/spec changes after order are client cost."),
        ("External works", "Pavers, kerbs and bedding material", "m2", "520", "22.00", "Paver supplier A", "Paver supplier B", 10, 22, 14, "Reject off-colour batches; measure installed area weekly."),
        ("External works", "Boundary gate automation and external lights", "sum", "1", "14200.00", "Gate/security supplier A", "Gate/security supplier B", 21, 21, 10, "Commissioning certificate before final payment."),
    ]
    return [
        MaterialLine(
            package=package,
            material=material,
            unit=unit,
            quantity=Decimal(quantity),
            target_rate=money(Decimal(rate)),
            target_total=money(Decimal(quantity) * Decimal(rate)),
            preferred_supplier=preferred,
            backup_supplier=backup,
            lead_time_days=lead_time,
            order_by_week=order_week,
            quote_validity_days=validity,
            margin_control=control,
        )
        for package, material, unit, quantity, rate, preferred, backup, lead_time, order_week, validity, control in raw
    ]


def build_schedule_scenarios() -> tuple[list[ScheduleScenario], list[ScenarioDriver]]:
    delay_cost_per_week = Decimal("3750.00")
    scenarios_raw = [
        (
            "Best case",
            32,
            "Drawings frozen before mobilisation, clean site, fast inspections, client decisions on time, long-lead suppliers locked by week 3, stable weather and no abnormal ground.",
            "Do not discount the contract price for finishing early. Early completion protects overhead and gives capacity back to the business.",
        ),
        (
            "Expected case",
            36,
            "Normal approvals, normal supplier lead times, manageable weather, standard rework allowance, client decisions made by the decision schedule.",
            "Base quotation programme. Margin remains protected if spend follows the weekly cost ceiling and variations are signed before execution.",
        ),
        (
            "Delay case",
            44,
            "Late drawings, slow client finish decisions, one authority inspection delay, supplier slippage on glazing/joinery, weather disruption and moderate productivity loss.",
            "Issue delay notices and variation orders. Unrecoverable delay overhead beyond 36 weeks reduces gross profit unless recovered from the client.",
        ),
    ]
    scenarios: list[ScheduleScenario] = []
    for name, weeks, assumptions, position in scenarios_raw:
        extra_weeks = max(0, weeks - 36)
        delay_cost = money(Decimal(extra_weeks) * delay_cost_per_week)
        profit = money(TARGET_GROSS_PROFIT - delay_cost)
        margin = money((profit / TOTAL_BUDGET) * Decimal("100"))
        scenarios.append(
            ScheduleScenario(
                scenario=name,
                duration_weeks=weeks,
                duration_days=weeks * 5,
                gross_profit=profit,
                margin_percentage=margin,
                assumptions=assumptions,
                commercial_position=position,
            )
        )

    drivers = [
        ScenarioDriver(
            "Drawings and engineering",
            "All IFC drawings, structural details and MEP layouts approved before week 1.",
            "Minor clarifications handled through RFIs without stopping work.",
            "Missing details stop procurement/site work and create rework risk.",
            "No work from sketch or verbal instruction. Price drawing changes as variation orders.",
        ),
        ScenarioDriver(
            "Site conditions",
            "Clean access, normal soil, no hidden services, no boundary dispute.",
            "Minor ground adjustments handled inside measured BOQ quantities.",
            "Rock, groundwater, soft spots, hidden services or access restrictions appear.",
            "Stop, measure, photograph, engineer instruction, price before proceeding.",
        ),
        ScenarioDriver(
            "Authority approvals",
            "Permits and inspections happen on first booked dates.",
            "One or two inspection comments corrected without critical delay.",
            "Permit, foundation, drainage, electrical or occupation approvals slip.",
            "Separate contractor delay from authority delay; claim EOT and standing cost where allowed.",
        ),
        ScenarioDriver(
            "Crew capacity",
            "Core trades available on planned dates with stable productivity.",
            "Some trade overlap requires zone control but remains manageable.",
            "Absenteeism, congestion, rework or subcontractor underperformance slows output.",
            "Daily production review. Add crews/overtime only through approved recovery budget.",
        ),
        ScenarioDriver(
            "Supplier lead times",
            "Glazing, roof, joinery, sanitaryware and electrical packages ordered before expiry.",
            "Normal supplier slippage absorbed through resequencing.",
            "Late or wrong-spec delivery blocks follow-on trades.",
            "Use quote expiry tracker, backup supplier and back-charge/variation route.",
        ),
        ScenarioDriver(
            "Client decisions",
            "Finishes, kitchen, lighting, tiles and sanitaryware approved by decision schedule.",
            "Some choices are late but within procurement float.",
            "Client upgrades or indecision affects procurement and completion.",
            "Late decisions become time and cost variations. No free acceleration.",
        ),
        ScenarioDriver(
            "Weather",
            "Dry conditions through earthworks, roof and external works.",
            "Normal rain disruption contained within float.",
            "Heavy rain delays earthworks, roofing, paving or landscaping.",
            "Weather diary, photos, EOT notice and resequencing. Do not absorb abnormal delay.",
        ),
    ]
    return scenarios, drivers


def table(data, widths, header=True, font_size=7, repeat_rows=1):
    styled_data = []
    for row in data:
        styled_data.append([
            cell if hasattr(cell, "wrap") else str(cell)
            for cell in row
        ])
    t = Table(styled_data, colWidths=widths, repeatRows=repeat_rows if header else 0)
    commands = [
        ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#CBD5E1")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), font_size),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]
    if header:
        commands.extend([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0F172A")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ])
    t.setStyle(TableStyle(commands))
    return t


def section_title(text: str, styles) -> list:
    return [Paragraph(text, styles["SectionTitle"]), Spacer(1, 5)]


def page_header_footer(canvas, doc):
    canvas.saveState()
    width, height = A4
    if doc.pagesize == landscape(A4):
        width, height = landscape(A4)
    canvas.setFillColor(colors.HexColor("#0F172A"))
    canvas.rect(0, height - 16 * mm, width, 16 * mm, fill=1, stroke=0)
    canvas.setFillColor(colors.white)
    canvas.setFont("Helvetica-Bold", 8)
    canvas.drawString(15 * mm, height - 10 * mm, "SIX NINE CONSTRUCTION (PVT) LTD - RESIDENTIAL PROJECT PACK")
    canvas.setFont("Helvetica", 7)
    canvas.drawRightString(width - 15 * mm, height - 10 * mm, f"{PROJECT_ID} | Page {doc.page}")
    canvas.setFillColor(colors.HexColor("#475569"))
    canvas.setFont("Helvetica", 7)
    canvas.drawString(15 * mm, 8 * mm, "Simulation only - validate with drawings, site visit and approvals.")
    canvas.drawRightString(width - 15 * mm, 8 * mm, "Quote, BOQ, programme, QA/HSE and closeout pack")
    canvas.restoreState()


def styles():
    base = getSampleStyleSheet()
    base.add(ParagraphStyle(
        name="CoverTitle",
        parent=base["Title"],
        fontName="Helvetica-Bold",
        fontSize=24,
        leading=29,
        textColor=colors.HexColor("#0F172A"),
        alignment=TA_CENTER,
        spaceAfter=16,
    ))
    base.add(ParagraphStyle(
        name="CoverSub",
        parent=base["Normal"],
        fontSize=11,
        leading=15,
        alignment=TA_CENTER,
        textColor=colors.HexColor("#334155"),
        spaceAfter=8,
    ))
    base.add(ParagraphStyle(
        name="SectionTitle",
        parent=base["Heading1"],
        fontSize=14,
        leading=18,
        textColor=colors.HexColor("#0F172A"),
        spaceBefore=4,
        spaceAfter=6,
    ))
    base.add(ParagraphStyle(
        name="Small",
        parent=base["Normal"],
        fontSize=7,
        leading=9,
        textColor=colors.HexColor("#334155"),
    ))
    base.add(ParagraphStyle(
        name="Cell",
        parent=base["Normal"],
        fontSize=7,
        leading=8.5,
        textColor=colors.HexColor("#0F172A"),
    ))
    base.add(ParagraphStyle(
        name="Right",
        parent=base["Normal"],
        fontSize=7,
        leading=8.5,
        alignment=TA_RIGHT,
    ))
    base.add(ParagraphStyle(
        name="Body",
        parent=base["BodyText"],
        fontSize=9,
        leading=12,
        alignment=TA_LEFT,
    ))
    return base


def add_key_value_page(story, title, items, s):
    story.extend(section_title(title, s))
    rows = [["Item", "Detail"]]
    for key, value in items:
        rows.append([para(key, s["Cell"]), para(value, s["Cell"])])
    story.append(table(rows, [55 * mm, 120 * mm], font_size=8))
    story.append(PageBreak())


def add_boq_pages(story, boq: list[BoqLine], s):
    story.extend(section_title("Detailed Bill of Quantities", s))
    rows = [["Code", "Section", "Description", "Unit", "Qty", "Rate", "Total"]]
    for line in boq:
        rows.append([
            line.code,
            line.section,
            para(line.description, s["Cell"]),
            line.unit,
            f"{line.quantity:,.2f}",
            money_text(line.rate),
            money_text(line.total),
        ])
    rows.append(["", "", "Direct BOQ subtotal", "", "", "", money_text(sum((line.total for line in boq), Decimal("0")))])
    story.append(table(rows, [16 * mm, 28 * mm, 69 * mm, 14 * mm, 18 * mm, 22 * mm, 26 * mm], font_size=6.6))
    story.append(PageBreak())


def add_weekly_pages(story, weeks: list[WeekPlan], s):
    for start in range(0, len(weeks), 9):
        story.extend(section_title(f"Weekly Execution Plan - Weeks {start + 1} to {min(start + 9, len(weeks))}", s))
        rows = [["Week", "Phase", "Activities", "Deliverables", "Spend", "Revenue", "Profit"]]
        for week in weeks[start:start + 9]:
            rows.append([
                str(week.week),
                para(week.phase, s["Cell"]),
                para(week.activities, s["Cell"]),
                para(week.deliverables, s["Cell"]),
                money_text(week.planned_cost),
                money_text(week.planned_revenue),
                money_text(week.protected_profit),
            ])
        story.append(table(rows, [11 * mm, 24 * mm, 58 * mm, 40 * mm, 20 * mm, 20 * mm, 18 * mm], font_size=6.2))
        story.append(PageBreak())


def add_daily_pages(story, days: list[DayPlan], s):
    for start in range(0, len(days), 12):
        end = min(start + 12, len(days))
        story.extend(section_title(f"Daily Execution Plan - Days {start + 1} to {end}", s))
        rows = [["Day", "Week", "Hr", "Phase", "Activities", "Spend", "Profit", "Control"]]
        for day in days[start:start + 12]:
            rows.append([
                str(day.day),
                str(day.week),
                f"{day.hours}",
                para(day.phase, s["Cell"]),
                para(day.activities, s["Cell"]),
                money_text(day.planned_cost),
                money_text(day.protected_profit),
                para(day.inspection, s["Cell"]),
            ])
        story.append(table(rows, [9 * mm, 9 * mm, 8 * mm, 22 * mm, 76 * mm, 21 * mm, 19 * mm, 27 * mm], font_size=5.8))
        story.append(PageBreak())


def add_margin_control_pages(story, quote: dict[str, Decimal], s):
    story.extend(section_title("Margin Protection Control Sheet", s))
    rows = [
        ["Control", "Value", "Rule"],
        ["Client contract value", money_text(TOTAL_BUDGET), "This is the selling price ceiling agreed with the client."],
        ["Required gross margin", "15.0%", "Profit must be protected before any discretionary upgrade is accepted."],
        ["Protected gross profit", money_text(quote["gross_profit"]), "This is not contingency. It is company profit."],
        ["Maximum internal cost", money_text(quote["max_cost_to_protect_margin"]), "All labour, materials, subcontractors, plant, preliminaries and reserves must stay below this."],
        ["Direct works target", money_text(quote["direct_costs"]), "Measured BOQ delivery target after value engineering."],
        ["Construction contingency", money_text(quote["contingency"]), "Used only for approved construction risk, not client upgrades."],
        ["Management reserve", money_text(quote["management_reserve"]), "Released only by management approval."],
        ["Uncommitted cost buffer", money_text(quote["cost_variance_buffer"]), "If this falls below zero, margin is already under attack."],
    ]
    story.append(table(rows, [55 * mm, 35 * mm, 90 * mm], font_size=7.2))
    story.append(Spacer(1, 8))
    story.append(para("Ruthless commercial rule: every requested upgrade, acceleration, rework, delay, scope clarification, or specification change must be priced before execution. Do not absorb client-driven costs inside contingency. Contingency protects construction uncertainty; variation orders protect margin.", s["Body"]))
    story.append(PageBreak())


def add_scenario_pages(story, s):
    scenarios = [
        ("Abnormal ground", "Rock, soft spots, collapsible soil, groundwater or unsuitable bearing appears.", "Stop affected work, issue site instruction, measure quantities, engineer direction, price variation before proceeding beyond making safe."),
        ("Client upgrades finishes", "Client selects higher-grade tiles, sanitaryware, kitchen, lighting or appliances.", "Use allowance register. Quote delta plus time impact. No procurement before signed variation and deposit."),
        ("Design information late", "Drawings, structural details, window schedules or MEP layouts arrive late.", "Record delay notice, protect programme float, resequence only if no cost impact, otherwise quote acceleration or standing time."),
        ("Authority approval delay", "Permit, inspection or occupation approval slips.", "Separate authority delay from contractor delay. Keep evidence log and revise handover date if critical path is affected."),
        ("Material price escalation", "Cement, steel, aluminium, fuel, imported finishes or exchange rates move.", "Lock prices with supplier validity, include escalation clause after quote validity, require reprice after validity expiry."),
        ("Supplier failure", "Supplier misses delivery, delivers wrong spec, or quality fails.", "Use approved supplier list, retain purchase terms, back-charge if applicable, keep second-source options for critical items."),
        ("Labour productivity loss", "Crew output below plan due to congestion, rework, absenteeism or supervision gaps.", "Daily productivity review, zone control, remove blockers, do not add overtime without approved recovery budget."),
        ("Weather disruption", "Rain affects earthworks, roofing, external works or curing.", "Record weather days with photos, protect works, claim EOT where contract allows, avoid absorbing delay costs."),
        ("Hidden services", "Unknown pipes, cables, septic systems, drains or boundary conflicts discovered.", "Stop, mark, protect, notify client, price diversion/remediation before continuing."),
        ("Quality defect/rework", "Work fails inspection or client rejects finish.", "Identify cause. Contractor-caused rework is internal cost. Client/spec change is variation. Supplier defect is back-charge."),
        ("Cash-flow late payment", "Client delays milestone payment.", "Suspend procurement for next packages where contract allows, issue notice, protect supplier payments and demobilisation rights."),
        ("Security/theft", "Material, tools, fittings or fuel stolen.", "Secure high-value deliveries, just-in-time delivery, access log, insurance report, client-funded extra security if risk increases."),
        ("Scope creep by instruction", "Verbal instruction adds small extras repeatedly.", "No verbal free work. Convert every instruction to written RFI/VO, even if value is small."),
        ("Acceleration demand", "Client asks for earlier completion.", "Quote acceleration separately: overtime, extra crews, supervision, logistics, quality risk and disruption premium."),
        ("Late client decisions", "Paint, tile, cabinetry, appliance or fixture choices are late.", "Decision schedule controls. Late decision shifts procurement and completion dates unless acceleration is paid."),
        ("Neighbour/community issue", "Noise, access, dust, traffic or boundary complaints disrupt work.", "Community control plan, working hours, dust/noise mitigation, variation if restrictions exceed baseline."),
        ("Health and safety incident", "Injury, near miss, unsafe condition or regulatory intervention.", "Stop work, make safe, investigate, notify, corrective action. Do not restart until controls are verified."),
        ("Practical completion dispute", "Client wants occupation but defects or documents remain open.", "Use signed snag list, define practical completion, retain defects liability process, separate occupation from free extra work."),
    ]
    for start in range(0, len(scenarios), 6):
        story.extend(section_title(f"Commercial Risk Scenarios - Set {start // 6 + 1}", s))
        rows = [["Scenario", "What can happen", "Margin-safe response"]]
        for name, trigger, response in scenarios[start:start + 6]:
            rows.append([para(name, s["Cell"]), para(trigger, s["Cell"]), para(response, s["Cell"])])
        story.append(table(rows, [38 * mm, 66 * mm, 82 * mm], font_size=6.7))
        story.append(PageBreak())


def add_material_pages(story, materials: list[MaterialLine], s):
    for start in range(0, len(materials), 9):
        story.extend(section_title(f"Required Materials and Supplier Price Targets - Set {start // 9 + 1}", s))
        rows = [["Package", "Material", "Qty", "Target Rate", "Target Total", "Supplier / Backup", "Lead", "Order"]]
        for item in materials[start:start + 9]:
            rows.append([
                para(item.package, s["Cell"]),
                para(item.material, s["Cell"]),
                f"{item.quantity:,.2f} {item.unit}",
                money_text(item.target_rate),
                money_text(item.target_total),
                para(f"{item.preferred_supplier}<br/>Backup: {item.backup_supplier}", s["Cell"]),
                f"{item.lead_time_days}d",
                f"W{item.order_by_week}",
            ])
        story.append(table(rows, [20 * mm, 45 * mm, 24 * mm, 22 * mm, 24 * mm, 45 * mm, 12 * mm, 12 * mm], font_size=5.8))
        story.append(PageBreak())

    story.extend(section_title("Supplier RFQ and Price-Fetch Matrix", s))
    rows = [["Step", "Required control", "Why it protects margin"]]
    controls = [
        ("1. Supplier master", "Create approved supplier records with category, contacts, tax registration, payment terms, delivery area, warranty terms and compliance status.", "Prevents buying from unverified suppliers who can fail quality, delivery or warranty obligations."),
        ("2. RFQ package", "Issue the same BOQ/spec, drawing revision, delivery location, warranty requirement and validity period to every supplier.", "Prevents false low prices caused by suppliers quoting different scopes."),
        ("3. Three-quote rule", "Capture preferred, backup and challenger quotes for every critical material package.", "Creates leverage and gives a replacement path if the first supplier fails."),
        ("4. Live price fetch", "Pull prices from supplier portals/APIs where available; otherwise attach emailed PDFs and enter them into the quote register with expiry date.", "Avoids stale rates. Every price must have a timestamp and source."),
        ("5. Price lock", "Convert accepted supplier quote to purchase order before quote expiry, or trigger automatic reprice.", "Stops supplier escalation from silently eroding profit."),
        ("6. Variance gate", "If supplier price exceeds target by more than 3%, require management approval, substitution, scope reduction or client variation.", "Forces a decision before margin is consumed."),
        ("7. Delivery and GRN", "Match purchase order, delivery note, goods received note, and quality inspection before supplier payment.", "Prevents paying for short, damaged, wrong-spec or late material."),
        ("8. Cost-to-complete", "Update remaining material exposure every week against committed POs and unbought packages.", "Shows margin risk before it becomes unrecoverable."),
    ]
    for step, control, reason in controls:
        rows.append([para(step, s["Cell"]), para(control, s["Cell"]), para(reason, s["Cell"])])
    story.append(table(rows, [34 * mm, 80 * mm, 72 * mm], font_size=6.7))
    story.append(PageBreak())

    story.extend(section_title("Material Margin Controls by Package", s))
    rows = [["Package", "Material", "Margin control"]]
    for item in materials:
        rows.append([para(item.package, s["Cell"]), para(item.material, s["Cell"]), para(item.margin_control, s["Cell"])])
    story.append(table(rows, [35 * mm, 62 * mm, 88 * mm], font_size=6.2))
    story.append(PageBreak())

    story.extend(section_title("What Else Makes This Work Operationally", s))
    rows = [["Mechanic", "Minimum system requirement", "Failure if missing"]]
    mechanics = [
        ("Supplier quote register", "Stores quote source, date fetched, expiry, currency, VAT treatment, delivery cost, exclusions and attachment.", "You cannot prove why a rate was used or recover price movement."),
        ("Procurement approval workflow", "Blocks purchase orders above budget, expired quote, unapproved supplier, missing spec, or over 3% variance.", "Buying happens emotionally and margin disappears package by package."),
        ("Variation order workflow", "Every client upgrade, late decision, scope change, acceleration request or rework cause is priced and signed before execution.", "Free work accumulates and the 15% profit becomes fiction."),
        ("Daily cost capture", "Foreman captures labour hours, plant hours, material usage, delivery notes, photos and blockers every day.", "You cannot see which day started the loss."),
        ("Weekly margin meeting", "Compares planned spend/revenue/profit to actuals, committed POs, uncommitted exposure and risk events.", "Problems are discovered after money is already spent."),
        ("Document control", "Only current drawings/specs are buildable. Old revisions are blocked from procurement and site issue.", "Rework and claims become impossible to allocate."),
        ("Inventory and wastage controls", "Material receipts, stock on site, issues to crews, wastage and returns are logged.", "Theft, waste and over-ordering become hidden margin leaks."),
        ("Payment discipline", "Milestone claims are tied to measured progress, signed inspections and client payment calendar.", "Cash flow breaks the programme even if the quote is profitable."),
        ("Closeout controls", "Defects, warranties, manuals, certificates and retention are tracked from the start.", "Final payment and retention get trapped at the end."),
    ]
    for mechanic, requirement, failure in mechanics:
        rows.append([para(mechanic, s["Cell"]), para(requirement, s["Cell"]), para(failure, s["Cell"])])
    story.append(table(rows, [42 * mm, 78 * mm, 65 * mm], font_size=6.4))
    story.append(PageBreak())


def add_schedule_simulation_pages(
    story,
    scenarios: list[ScheduleScenario],
    drivers: list[ScenarioDriver],
    s,
):
    story.extend(section_title("Programme Stress Test - Best, Expected and Delay Cases", s))
    rows = [["Scenario", "Duration", "Protected Profit", "Margin", "Assumptions", "Commercial Position"]]
    for item in scenarios:
        rows.append([
            item.scenario,
            f"{item.duration_weeks} weeks / {item.duration_days} workdays",
            money_text(item.gross_profit),
            f"{item.margin_percentage}%",
            para(item.assumptions, s["Cell"]),
            para(item.commercial_position, s["Cell"]),
        ])
    story.append(table(rows, [22 * mm, 28 * mm, 26 * mm, 18 * mm, 58 * mm, 44 * mm], font_size=5.9))
    story.append(Spacer(1, 8))
    story.append(para("Delay-case profit assumes unrecovered overhead burn of $3,750 per delayed week after week 36. If delay is caused by client decisions, authority delay, scope change, abnormal ground or late information, the quotation must recover the cost through extension-of-time and variation mechanisms.", s["Body"]))
    story.append(PageBreak())

    story.extend(section_title("Schedule Driver Simulation Matrix", s))
    rows = [["Driver", "Best Case", "Expected Case", "Delay Case", "Margin-Safe Response"]]
    for driver in drivers:
        rows.append([
            para(driver.driver, s["Cell"]),
            para(driver.best_case, s["Cell"]),
            para(driver.expected_case, s["Cell"]),
            para(driver.delay_case, s["Cell"]),
            para(driver.margin_response, s["Cell"]),
        ])
    story.append(table(rows, [28 * mm, 39 * mm, 39 * mm, 39 * mm, 43 * mm], font_size=5.8))
    story.append(PageBreak())

    story.extend(section_title("How the 36-Week Baseline Was Built", s))
    rows = [
        ["Phase", "Weeks", "Logic"],
        ["Mobilisation and design freeze", "1-4", "Allows contract setup, site possession, surveys, permits, long-lead procurement and HSE mobilisation before production risk starts."],
        ["Groundworks and foundations", "5-8", "Covers site clearance, bulk earthworks, foundation excavation, reinforcement, concrete pours, drainage sleeves and inspections."],
        ["Substructure and shell", "9-13", "Covers slab, masonry, columns, beams, ring beams, gables and roof-support readiness."],
        ["Roof and envelope dry-in", "14-16", "Gets the building weather-tight so internal works can start with lower damage/rework risk."],
        ["MEP rough-in and wet trades", "17-20", "Coordinates electrical, plumbing, HVAC, data/security, plastering, screeds and waterproofing before finishes."],
        ["Finishes", "21-24", "Tiles, ceilings, painting, joinery manufacture and internal finish sequencing."],
        ["Fit-out and external works", "25-28", "Second fix, kitchen, bathrooms, paving, gates, landscaping and external services."],
        ["Commissioning and authority readiness", "29-32", "Testing, snagging, inspections, as-builts and client walkthroughs."],
        ["Handover and closeout", "33-36", "Final clean, manuals, warranties, keys, final account, retention and maintenance setup."],
    ]
    story.append(table(rows, [45 * mm, 22 * mm, 118 * mm], font_size=6.7))
    story.append(PageBreak())


def build_pdf():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    s = styles()
    boq = build_boq()
    quote = build_quote(boq)
    months = build_month_targets()
    weeks = build_week_plan(months)
    days = build_day_plan(weeks)
    materials = build_material_schedule()
    schedule_scenarios, schedule_drivers = build_schedule_scenarios()
    section_totals = grouped_totals(boq)

    doc = SimpleDocTemplate(
        str(PDF_PATH),
        pagesize=A4,
        rightMargin=12 * mm,
        leftMargin=12 * mm,
        topMargin=22 * mm,
        bottomMargin=16 * mm,
        title="SNC Residential 500k Complete Construction Pack",
        author="Six Nine Construction (Pvt) Ltd",
    )

    story = []
    story.append(Spacer(1, 50 * mm))
    story.append(Paragraph("SIX NINE CONSTRUCTION (PVT) LTD", s["CoverTitle"]))
    story.append(Paragraph("Complete Residential Construction Simulation Pack", s["CoverTitle"]))
    story.append(Paragraph("Client budget: USD 500,000 | 15% protected margin | 36-week programme", s["CoverSub"]))
    story.append(Paragraph(f"Project reference: {PROJECT_ID}", s["CoverSub"]))
    story.append(Spacer(1, 20 * mm))
    story.append(table([
        ["Prepared for", CLIENT_NAME],
        ["Project", PROJECT_NAME],
        ["Budget cap", money_text(TOTAL_BUDGET)],
        ["Programme", "36 weeks / 180 working days"],
        ["Status", "Simulation for feasibility, planning and client briefing"],
    ], [45 * mm, 105 * mm], header=False, font_size=9))
    story.append(PageBreak())

    add_key_value_page(story, "Executive Summary", [
        ("Objective", "Simulate how a client with a USD 500,000 budget can deliver a complete private residence with controlled scope, phased procurement, weekly production targets, daily controls, and closeout documentation."),
        ("Assumed product", "Turnkey 4-bedroom high-spec residence, approximately 400-430 m2 gross built area, with garage, external works, basic landscaping, MEP systems, security/data rough-in, and quality-controlled handover."),
        ("Commercial result", f"Quotation total is {money_text(quote['quotation_total'])}. Protected gross profit is {money_text(quote['gross_profit'])}, equal to {quote['margin_percentage']}% margin. Maximum internal cost is {money_text(quote['max_cost_to_protect_margin'])}."),
        ("Programme result", "36 weeks from mobilisation to closeout, assuming approved drawings, clear site access, stable material supply, and no abnormal ground conditions."),
        ("Decision required", "Client must approve final design, finishes schedule, provisional sums, authority route, payment milestones, and variation control before construction starts."),
    ], s)

    add_key_value_page(story, "Core Assumptions and Exclusions", [
        ("Assumptions", "Normal soil bearing, no rock blasting, no contaminated material, no flood mitigation works beyond standard stormwater, uninterrupted client approvals, and imported finishes available within normal lead times."),
        ("Exclusions", "Land purchase, professional design fees before construction appointment, finance charges, abnormal authority fees, borehole drilling, swimming pool, solar plant, generator, premium imported appliances beyond allowance, and client-initiated variations."),
        ("Quality class", "Durable high-spec residential finish, not ultra-luxury. Finishes are controlled through allowances to protect the budget."),
        ("Contract control", "Fixed-scope price with provisional sums and a controlled variation register. No margin changes without written authorization."),
        ("Currency", "All values are USD simulation values and should be revalidated against live supplier quotations before signature."),
    ], s)

    story.extend(section_title("Quotation Summary", s))
    story.append(table([
        ["Cost Element", "Amount", "Comment"],
        ["Direct BOQ works", money_text(quote["direct_costs"]), "Trade packages and measured works"],
        ["Construction contingency", money_text(quote["contingency"]), "Held for measurable construction uncertainty"],
        ["Management reserve", money_text(quote["management_reserve"]), "Commercial reserve held by project controls"],
        ["Maximum internal cost", money_text(quote["internal_cost_ceiling"]), "Internal spend ceiling used in this delivery plan"],
        ["Protected gross profit", money_text(quote["gross_profit"]), "15% margin on client contract value"],
        ["Quotation total", money_text(quote["quotation_total"]), "Client contract value"],
    ], [65 * mm, 35 * mm, 82 * mm], font_size=8))
    story.append(Spacer(1, 8))
    story.append(BarChart(list(section_totals.keys()), list(section_totals.values()), 180 * mm, 65 * mm))
    story.append(PageBreak())

    story.extend(section_title("BOQ Section Totals", s))
    section_rows = [["Section", "Amount", "% of Budget"]]
    for name, total in section_totals.items():
        pct = (total / TOTAL_BUDGET * Decimal("100")).quantize(Decimal("0.1"))
        section_rows.append([name, money_text(total), f"{pct}%"])
    section_rows.append(["Contingency and reserve", money_text(quote["contingency"] + quote["management_reserve"]), "Internal cost control"])
    section_rows.append(["Protected profit", money_text(quote["gross_profit"]), "15.0% of contract value"])
    story.append(table(section_rows, [90 * mm, 45 * mm, 45 * mm], font_size=8))
    story.append(PageBreak())

    add_boq_pages(story, boq, s)
    add_margin_control_pages(story, quote, s)
    add_material_pages(story, materials, s)
    add_schedule_simulation_pages(story, schedule_scenarios, schedule_drivers, s)

    story.extend(section_title("Monthly Targets, Spend and Protected Profit", s))
    month_rows = [["Month", "Target", "Deliverables", "Spend", "Revenue", "Profit"]]
    for m in months:
        month_rows.append([
            str(m.month),
            para(m.target, s["Cell"]),
            para(m.deliverables, s["Cell"]),
            money_text(m.planned_cost),
            money_text(m.planned_revenue),
            money_text(m.protected_profit),
        ])
    story.append(table(month_rows, [12 * mm, 40 * mm, 76 * mm, 22 * mm, 22 * mm, 20 * mm], font_size=6.6))
    story.append(PageBreak())

    story.extend(section_title("Monthly Cash Flow Curve", s))
    story.append(BarChart([f"M{m.month}" for m in months], [m.planned_cost for m in months], 180 * mm, 70 * mm))
    story.append(Spacer(1, 8))
    story.append(para("Cash-flow drawdown should be governed by certified progress, not merely calendar dates. Retain variation approval discipline before releasing provisional sums.", s["Body"]))
    story.append(PageBreak())

    add_weekly_pages(story, weeks, s)
    add_daily_pages(story, days, s)
    add_scenario_pages(story, s)

    add_key_value_page(story, "Procurement Strategy", [
        ("Long-lead packages", "Roof covering, aluminium glazing, kitchen appliances, sanitaryware, specialty lighting, gate automation, HVAC equipment, and smart-home components."),
        ("Procurement gates", "Issue RFQs in weeks 1-3, award long-lead items by week 4, confirm shop drawings by week 8, stage deliveries from week 14 onward."),
        ("Supplier controls", "Use three-quote comparison, technical compliance sheet, warranty review, payment controls, and delivery inspection before acceptance."),
        ("Substitution control", "No substitution without client approval, technical compliance confirmation, cost impact, lead-time impact, and warranty confirmation."),
    ], s)

    add_key_value_page(story, "Resource Plan", [
        ("Management", "Project manager, site foreman, quantity surveyor, procurement lead, HSE officer visiting, QA inspector visiting."),
        ("Core crews", "Earthworks crew, concrete crew, masonry crew, roofing crew, MEP subcontractors, finishes crews, external works crew, cleaning/closeout crew."),
        ("Equipment", "TLB/excavator, compactor, concrete poker, scaffolding, hoists, small tools, testing equipment, temporary power and water."),
        ("Peak manpower", "Expected peak is 32-42 people during MEP rough-in and finishes overlap. Crew stacking must be controlled through daily work zones."),
    ], s)

    add_key_value_page(story, "Risk Register", [
        ("Ground conditions", "Risk: abnormal soil or rock. Mitigation: geotechnical confirmation, provisional excavation allowance, early foundation inspection."),
        ("Client finish upgrades", "Risk: budget overrun. Mitigation: approved finishes schedule, allowance register, variation approval before purchase."),
        ("Material lead times", "Risk: programme delay. Mitigation: long-lead procurement by week 4 and weekly expediting."),
        ("Weather", "Risk: earthworks, roofing and external works disruption. Mitigation: weather float, temporary protection, sequence dry-in quickly."),
        ("Quality rework", "Risk: cost and time loss. Mitigation: hold points, mockups, first-off approvals, daily photo records."),
        ("Cash-flow delay", "Risk: supplier/crew disruption. Mitigation: certified milestones, payment calendar, retention schedule."),
    ], s)

    add_key_value_page(story, "QA, HSE and Inspection Plan", [
        ("Daily", "Toolbox talk, housekeeping check, PPE compliance, workface permit review, daily diary and photo register."),
        ("Weekly", "Programme update, quantity certification, safety walkdown, quality snag list, procurement tracker review."),
        ("Hold points", "Foundation bearing, reinforcement before pour, slab DPM/mesh, concealed MEP, waterproofing flood test, roof dry-in, final commissioning."),
        ("Testing", "Concrete cube tests, compaction checks, pressure tests, insulation resistance tests, drainage flow tests, appliance commissioning."),
        ("Closeout", "As-built drawings, warranties, manuals, compliance certificates, keys, access codes, maintenance plan, defects liability log."),
    ], s)

    add_key_value_page(story, "Client Decision Schedule", [
        ("Before week 1", "Approve design, budget cap, contract, finishes allowance, payment plan, authority route, and communication protocol."),
        ("Week 2", "Approve windows, external doors, roof finish, sanitaryware direction, kitchen design brief."),
        ("Week 6", "Approve electrical point schedule, lighting concept, smart-home scope, tile ranges."),
        ("Week 12", "Approve cabinetry drawings, paint palette, feature finishes, landscape brief."),
        ("Week 22", "Approve appliances, ironmongery, final fittings, handover format."),
    ], s)

    add_key_value_page(story, "Payment Milestone Proposal", [
        ("10% mobilisation", "Contract signature, insurance, site setup, procurement launch."),
        ("15% foundations complete", "Excavations, foundation pour, backfill and underground sleeves complete."),
        ("20% shell complete", "Walls, columns, beams and roof support complete."),
        ("15% roof and envelope", "Roof complete, windows/doors installed, building dry-in achieved."),
        ("15% MEP and wet trades", "First fix, plastering, screeds and waterproofing complete."),
        ("15% finishes and fit-out", "Tiles, paint, joinery, kitchen, sanitaryware, electrical/plumbing second fix."),
        ("8% commissioning", "Testing, snagging, authority inspection support, final clean."),
        ("2% closeout", "Handover documents, manuals, keys, final account. Retention can be held separately."),
    ], s)

    add_key_value_page(story, "Handover Deliverables", [
        ("Commercial", "Final account, variation register, payment certificate summary, retention schedule, asset list."),
        ("Technical", "As-built drawings, inspection and test plan, test certificates, commissioning records, material data sheets."),
        ("Client pack", "Operating manuals, warranties, maintenance schedule, emergency contacts, keys/access devices, defects reporting procedure."),
        ("Post-handover", "30-day check-in, 90-day seasonal inspection, defects liability closeout, maintenance advice."),
    ], s)

    story.extend(section_title("Appendix - Simulation Data Summary", s))
    story.append(table([
        ["Metric", "Value"],
        ["Project reference", PROJECT_ID],
        ["Budget cap", money_text(TOTAL_BUDGET)],
        ["Required margin", "15.0%"],
        ["Protected gross profit", money_text(quote["gross_profit"])],
        ["Maximum internal cost", money_text(quote["max_cost_to_protect_margin"])],
        ["BOQ line count", str(len(boq))],
        ["Material package count", str(len(materials))],
        ["Schedule scenarios", str(len(schedule_scenarios))],
        ["Weekly plan count", str(len(weeks))],
        ["Daily plan count", str(len(days))],
        ["Quotation total", money_text(quote["quotation_total"])],
    ], [65 * mm, 90 * mm], font_size=8))

    simulation = {
        "project_id": PROJECT_ID,
        "client_name": CLIENT_NAME,
        "project_name": PROJECT_NAME,
        "budget": str(TOTAL_BUDGET),
        "quote": {k: str(v) for k, v in quote.items()},
        "boq": [asdict(line) | {"total": str(line.total)} for line in boq],
        "section_totals": {k: str(v) for k, v in section_totals.items()},
        "materials": [asdict(item) for item in materials],
        "schedule_scenarios": [asdict(item) for item in schedule_scenarios],
        "schedule_drivers": [asdict(item) for item in schedule_drivers],
        "months": [asdict(m) for m in months],
        "weeks": [asdict(w) for w in weeks],
        "days": [asdict(d) for d in days],
    }
    JSON_PATH.write_text(json.dumps(simulation, indent=2, default=str), encoding="utf-8")

    doc.build(story, onFirstPage=page_header_footer, onLaterPages=page_header_footer)
    return PDF_PATH


if __name__ == "__main__":
    path = build_pdf()
    print(path)
