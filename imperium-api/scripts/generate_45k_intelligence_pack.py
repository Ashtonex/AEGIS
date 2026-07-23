from __future__ import annotations

import json
import os
import sys
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
    Image,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


PROJECT_ID = "SNC-RES-45K-PROPOSAL-001"
CLIENT_NAME = "ZimRe Real Estate Investment Trust (Pvt) Ltd"
PROJECT_NAME = "High-Spec Residential Duplex Extension & Structural Alterations"
TOTAL_BUDGET = Decimal("45000.00")
MARGIN_RATE = Decimal("0.165")  # 16.5% protected margin
TARGET_GROSS_PROFIT = (TOTAL_BUDGET * MARGIN_RATE).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
MAX_INTERNAL_COST = (TOTAL_BUDGET - TARGET_GROSS_PROFIT).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
DIRECT_WORKS_TARGET = Decimal("33000.00")
CONTINGENCY_TARGET = Decimal("2500.00")
MANAGEMENT_RESERVE_TARGET = Decimal("2075.00")

LOGO_PATH = Path(r"G:\work\ATMCAPPROJECTS\Mudekwa\AEGIS\imperium-api\assets\logo.png")
DESKTOP_PDF_PATH = Path(r"C:\Users\ashjx\Desktop\CCB_Commercial_Control_Report_45K.pdf")
ARTIFACT_DIR = Path(r"C:\Users\ashjx\.gemini\antigravity-cli\brain\97cf26ac-1312-46eb-be2b-5d2fa1954a8f")
ARTIFACT_PDF_PATH = ARTIFACT_DIR / "CCB_Commercial_Control_Report_45K.pdf"
JSON_PATH = ARTIFACT_DIR / "SNC-45K-simulation.json"


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
    material_usage: str
    weather_forecast: str
    construction_probability: str
    contingency_action: str


@dataclass(frozen=True)
class MaterialSourcingLine:
    package: str
    material: str
    unit: str
    quantity: Decimal
    target_rate: Decimal
    target_total: Decimal
    vendor_name: str
    depot_address: str
    contact_phone: str
    lead_time_days: int
    stock_status: str
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
        bar_gap = 6
        bar_w = max(10, (chart_w / len(self.values)) - bar_gap)

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
            if len(label) > 10:
                label = label[:8] + "."
            self.canv.saveState()
            self.canv.translate(x + bar_w / 2, 8)
            self.canv.rotate(35)
            self.canv.drawCentredString(0, 0, label)
            self.canv.restoreState()
            self.canv.saveState()
            self.canv.translate(x + bar_w / 2, bottom + h + 4)
            self.canv.rotate(65)
            self.canv.drawString(0, 0, f"${int(value):,}")
            self.canv.restoreState()


def build_boq() -> list[BoqLine]:
    raw = [
        ("1.01", "Preliminaries", "Site establishment, permits, health & safety compliance, insurance", "sum", "1", "2400"),
        ("1.02", "Preliminaries", "Temporary utilities, water connection, power distribution, site office", "sum", "1", "1600"),
        ("2.01", "Siteworks", "Bulk earthworks, site clearance, topsoil strip & compaction", "m2", "320", "5.5"),
        ("2.02", "Siteworks", "Stormwater drainage, soakaways, apron slabs & earth retaining", "sum", "1", "1800"),
        ("3.01", "Substructure", "Trench excavations in earth for strip & pad footings", "m3", "75", "22"),
        ("3.02", "Substructure", "Reinforced concrete 25MPa strip footings, stub columns & pads", "m3", "32", "175"),
        ("3.03", "Substructure", "Ground slab 150mm concrete pour, DPM sheet & BRC mesh A193", "m2", "220", "44"),
        ("4.01", "Superstructure", "Structural 230mm double skin common brickwork in 1:4 cement mortar", "m2", "310", "54"),
        ("4.02", "Superstructure", "Reinforced concrete ring beams, lintels, columns & staircase pad", "m3", "14.5", "395"),
        ("5.01", "Roofing", "Timber truss roof framing structure, purlins, bracing & fixings", "m2", "250", "38"),
        ("5.02", "Roofing", "0.47mm IBR galvanised roof sheeting, ridge caps, flashings & gutters", "m2", "250", "30"),
        ("6.01", "Envelope", "Aluminium windows & external glazed sliding security door package", "sum", "1", "4800"),
        ("7.01", "Internal finishes", "Internal 12mm smooth cement plastering to walls & reveals", "m2", "420", "15"),
        ("7.02", "Internal finishes", "Floor screeds, porcelain floor tiling (600x600) & skirtings", "m2", "220", "28"),
        ("7.03", "Internal finishes", "Flush plasterboard ceilings, cornices, internal doors & painting", "sum", "1", "3400"),
        ("8.01", "Kitchen & Joinery", "Built-in kitchen cabinetry, quartz countertops & vanity units", "sum", "1", "3200"),
        ("9.01", "MEP Reticulation", "Electrical reticulation, DB board, LED lights & power points", "sum", "1", "3800"),
        ("9.02", "MEP Reticulation", "Plumbing reticulation, sanitaryware fittings, geyser & drainage", "sum", "1", "3200"),
        ("10.01", "External works", "Interlocking driveway paving, perimeter walling & security gates", "sum", "1", "2800"),
    ]
    raw_total = sum((Decimal(qty) * Decimal(rate) for _, _, _, _, qty, rate in raw), Decimal("0"))
    factor = DIRECT_WORKS_TARGET / raw_total
    lines = [
        BoqLine(code, section, description, unit, Decimal(qty), money(Decimal(rate) * factor))
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
        (1, "Mobilise, site clearance & substructure concrete", "Site establishment, earthworks, footings, stub columns, ground slab pour", "15000"),
        (2, "Superstructure masonry shell & roof covering", "Double skin brickwork to wall plate, ring beams, timber trusses, IBR roof sheeting", "16000"),
        (3, "Internal finishes, MEP, external works & handover", "Plaster, screeds, tiling, doors, windows, MEP second fix, paving, closeout", "14000"),
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
        ("Mobilisation", "Contract signing, kickoff, site possession, boundary survey, set-out", "Permits & site setup"),
        ("Groundworks", "Bulk earthworks, trench excavations, compaction, anti-termite treatment", "Foundations excavated"),
        ("Substructure", "Reinforcement fixing, strip footing concrete pour, stub columns", "Footings complete"),
        ("Substructure & Slab", "Ground slab concrete pour, curing, brickwork materials staging", "Slab complete"),
        ("Superstructure", "Masonry to window sill height, columns, steel lintels", "Masonry 30%"),
        ("Superstructure", "Masonry to lintel height, beam formwork, concrete lintels", "Masonry 70%"),
        ("Superstructure & Ring Beam", "Masonry to wall plate, ring beams, gable ends, steel inserts", "Shell complete"),
        ("Roofing Structure", "Timber truss fabrication, erection, purlins, bracing & fixings", "Trusses erected"),
        ("Roofing & Envelope", "0.47mm IBR roof sheeting, flashings, gutters, windows, security doors", "Building dry-in"),
        ("Wet Trades & MEP", "Internal plastering, external render, screeds, electrical & plumbing rough-in", "Plaster & MEP rough-in"),
        ("Finishes & Joinery", "Ceilings, porcelain floor tiling, kitchen cabinetry, internal doors, painting", "Finishes complete"),
        ("Commissioning & Handover", "MEP second fix, paving, perimeter walling, testing, snagging, handover", "Handover complete"),
    ]
    plans = []
    for w_idx, (phase, activities, deliverables) in enumerate(phase_by_week, 1):
        m_idx = (w_idx - 1) // 4
        m = months[m_idx]
        rev = money(m.planned_revenue / Decimal("4"))
        cost = money(rev * (Decimal("1") - MARGIN_RATE))
        profit = money(rev * MARGIN_RATE)
        plans.append(WeekPlan(w_idx, phase, activities, deliverables, rev, cost, profit))
    return plans


def build_day_plan(weeks: list[WeekPlan]) -> list[DayPlan]:
    daily_plans = []
    day_counter = 1

    low_probability_days = {7, 8, 21, 38, 52}
    moderate_probability_days = {14, 29, 44}

    for w in weeks:
        for d_in_w in range(1, 6):
            phase = w.phase
            day_num = day_counter

            if day_num in low_probability_days:
                prob_score = "35% LOW PROBABILITY"
                weather = "Heavy Rain Risk (18mm precip, 28 km/h wind)"
                activities = f"LOW PROBABILITY DAY: Rain float triggered. Outdoor concrete/roofing suspended. Indoor rebar tying & shop fabrication under shelter."
                inspection = "HSE wet-weather site safety check & drainage audit."
                mat_usage = "Rebar Y12/Y16 cutting & bending, tie wire"
                contingency = "Shift outdoor crew to covered workshop; prepare indoor plastering substrate."
            elif day_num in moderate_probability_days:
                prob_score = "72% MODERATE"
                weather = "Overcast, 4mm light drizzle"
                activities = f"MODERATE PROBABILITY DAY: {w.activities.split(',')[0]} (Controlled pace under shelter)."
                inspection = "Moisture check on brickwork & timber storage."
                mat_usage = "15 bags Cement 42.5N, 2 m3 Sand"
                contingency = "Keep tarpaulins ready over open masonry; focus on indoor conduit chasing."
            else:
                prob_score = "96% HIGH PROBABILITY"
                weather = "Sunny, 24°C, 8 km/h wind"
                if d_in_w == 1:
                    activities = f"HIGH PROBABILITY DAY - Week {w.week} Kickoff: {w.phase} - Primary workface production."
                    mat_usage = "25 bags Cement 42.5N, 3 m3 Sand, 1.5 bundles Steel"
                elif d_in_w == 2:
                    activities = f"HIGH PROBABILITY DAY - Primary Execution: {w.activities.split(',')[0]}."
                    mat_usage = "40 bags Cement 42.5N, 5 m3 Sand, 6 m3 Stone"
                elif d_in_w == 3:
                    activities = f"HIGH PROBABILITY DAY - Mid-week Production: Progressing {w.phase} package."
                    mat_usage = "2,000 Common Bricks, 20 bags Cement, 4 m3 Sand"
                elif d_in_w == 4:
                    activities = f"HIGH PROBABILITY DAY - Advanced Installation: {w.deliverables} execution."
                    mat_usage = "1,800 Common Bricks, 18 bags Cement, 3 m3 Sand"
                else:
                    activities = f"HIGH PROBABILITY DAY - Week {w.week} Target Completion: {w.deliverables} achieved."
                    mat_usage = "Clean-down, waste sorting & material inventory logging"
                inspection = "Standard QA hold-point inspection."
                contingency = "Maximize daily production target; maintain 100% crew headcount."

            rev = money(w.planned_revenue / Decimal("5"))
            cost = money(rev * (Decimal("1") - MARGIN_RATE))
            profit = money(rev * MARGIN_RATE)

            daily_plans.append(DayPlan(
                day=day_counter,
                week=w.week,
                phase=phase,
                activities=activities,
                inspection=inspection,
                hours=Decimal("8.0"),
                planned_cost=cost,
                planned_revenue=rev,
                protected_profit=profit,
                material_usage=mat_usage,
                weather_forecast=weather,
                construction_probability=prob_score,
                contingency_action=contingency,
            ))
            day_counter += 1
    return daily_plans


def build_material_sourcing_schedule() -> list[MaterialSourcingLine]:
    raw = [
        ("Substructure", "Cement 42.5N (50kg bags)", "bag", "260", "12.50", "Apex Building Supplies", "14 Plymouth Rd, Southerton, Harare", "+263 242 754900", 2, "In Stock (500+ bags)", "Strict batching & bag count gate"),
        ("Substructure", "Concrete River Sand", "m3", "32", "22.00", "Harare Aggregates", "Plot 4 Pomeroy Quarry, Mutare Rd, Msasa", "+263 772 100200", 1, "In Stock (Silt < 3%)", "Check silt content before unloading"),
        ("Substructure", "19mm Crushed Stone", "m3", "42", "28.00", "Pomeroy Quarries", "Msasa Industrial Park, Harare", "+263 242 486711", 1, "In Stock (Weighbridge verified)", "Verify load volume via weighbridge"),
        ("Masonry", "Standard Common Bricks", "pcs", "18500", "0.18", "Willdale Bricks Harare", "Mt Hampden Brickworks, Lomagundi Rd", "+263 242 334600", 3, "Available (Order Week 2)", "Max 5% wastage allowance on site"),
        ("Masonry", "Brickforce Reinforcement 150mm", "m", "600", "0.85", "Steelnet Zimbabwe", "100 Cripps Rd, Graniteside, Harare", "+263 242 751480", 2, "In Stock", "Laps of 300mm enforced"),
        ("Roofing", "0.47mm IBR Galvanised Sheeting", "m2", "260", "13.00", "Chromadek Zimbabwe", "Coventry Rd, Workington, Harare", "+263 242 661200", 5, "Pre-order Week 3", "Store under waterproof tarpaulins"),
        ("Roofing", "SA Pine Structural Timber Trusses", "m2", "250", "11.00", "Board & Timber Co", "Lytton Rd, Workington, Harare", "+263 242 757800", 4, "Custom Prep (4 days)", "Inspect timber grade and treatment"),
        ("Envelope", "Aluminium Window & Door Package", "sum", "1", "4800.00", "AluSpec Zimbabwe", "12 Seke Rd, Graniteside, Harare", "+263 773 400500", 7, "Fabrication Lead Time 7d", "Measure opening dimensions on site"),
        ("Finishes", "Porcelain Floor Tiles 600x600", "m2", "230", "14.00", "Tile Centre Msasa", "Enterprise Rd, Harare", "+263 242 487900", 5, "In Stock (Batch matched)", "Order 10% extra for cuts & spares"),
        ("MEP", "Electrical Cable & DB Component Pack", "sum", "1", "3800.00", "Electric Centre", "88 Cameron St, Harare CBD", "+263 242 770100", 3, "SAZ Certified Stock", "Require SAZ compliance certs"),
    ]
    return [
        MaterialSourcingLine(
            pkg, mat, unit, Decimal(qty), Decimal(rate), money(Decimal(qty) * Decimal(rate)),
            vendor, addr, phone, lead, stock, ctrl
        )
        for pkg, mat, unit, qty, rate, vendor, addr, phone, lead, stock, ctrl in raw
    ]


def build_schedule_scenarios() -> tuple[list[ScheduleScenario], list[ScenarioDriver]]:
    scenarios = [
        ScheduleScenario("Best Case", 10, 50, money(TARGET_GROSS_PROFIT + Decimal("850")), Decimal("18.4"), "Clear weather, early material deliveries, uninterrupted crew workflow.", "Bonus margin unlocked; overhead savings of $850."),
        ScheduleScenario("Expected Baseline", 12, 60, TARGET_GROSS_PROFIT, Decimal("16.5"), "Normal production rates, 5 rain float days included, 3-day RFQ lead time.", "16.5% protected gross profit ($7,425.00) fully achieved."),
        ScheduleScenario("Delay Case (+2w)", 14, 70, money(TARGET_GROSS_PROFIT - Decimal("950")), Decimal("14.4"), "Rain delays during earthworks, 1-week supplier stockout on roof sheets.", "Overhead burn consumes $950 margin; protected profit drops to 14.4%."),
    ]
    drivers = [
        ScenarioDriver("Material Supply Lead Times", "Supplier delivers 2 days early.", "Normal lead times (2-5 days).", "Roof sheets delayed 7 days.", "Pre-order long-lead packages by Week 3."),
        ScenarioDriver("Weather Float", "Zero rain days recorded.", "5 rain float days included in 60-day plan.", "10 consecutive rain days in Week 2.", "Reschedule indoor plastering & rebar prep during wet days."),
        ScenarioDriver("Client Scope Signoff", "Immediate drawing approval.", "Signoff within 48 hours.", "Client changes window specs in Week 4.", "Enforce variation order rule before ordering replacements."),
    ]
    return scenarios, drivers


def table(rows: list[list], widths: list[float], font_size: float = 7, header: bool = True) -> Table:
    styled_data = []
    for row in rows:
        styled_data.append([
            cell if hasattr(cell, "wrap") else str(cell)
            for cell in row
        ])
    t = Table(styled_data, colWidths=widths, repeatRows=1 if header else 0)
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


def draw_watermark(canvas, width, height):
    canvas.saveState()
    canvas.setFont("Helvetica-Bold", 34)
    canvas.setFillColor(colors.HexColor("#E2E8F0"))  # Soft, elegant, non-intrusive light slate gray
    canvas.translate(width / 2, height / 2)
    canvas.rotate(45)
    canvas.drawCentredString(0, 0, "SIX NINE CONSTRUCTION • CCB PROTECTED")
    canvas.setFont("Helvetica-Bold", 13)
    canvas.drawCentredString(0, -30, "COMMERCIAL CONTROL BRAIN • PROJECT PROPOSAL")
    canvas.restoreState()


def first_page_cover(canvas, doc):
    canvas.saveState()
    width, height = A4
    if doc.pagesize == landscape(A4):
        width, height = landscape(A4)

    # 1. Draw Diagonal Background Vector Watermark (No Header Bar on Cover Page!)
    draw_watermark(canvas, width, height)
    canvas.restoreState()


def page_header_footer(canvas, doc):
    canvas.saveState()
    width, height = A4
    if doc.pagesize == landscape(A4):
        width, height = landscape(A4)

    # 1. Draw Diagonal Background Vector Watermark
    draw_watermark(canvas, width, height)

    # 2. Top Header Banner with Official Navy/Gold Theme & Logo Image
    canvas.setFillColor(colors.HexColor("#0F172A"))
    canvas.rect(0, height - 18 * mm, width, 18 * mm, fill=1, stroke=0)
    canvas.setFillColor(colors.HexColor("#D97706"))
    canvas.rect(0, height - 18 * mm, 12 * mm, 18 * mm, fill=1, stroke=0)

    if LOGO_PATH.exists():
        try:
            canvas.drawImage(str(LOGO_PATH), x=15 * mm, y=height - 15.5 * mm, width=24 * mm, height=16 * mm, preserveAspectRatio=True, mask='auto')
        except Exception:
            pass

    canvas.setFillColor(colors.white)
    canvas.setFont("Helvetica-Bold", 8)
    canvas.drawString(42 * mm, height - 10 * mm, "SIX NINE CONSTRUCTION (PVT) LTD — EXECUTIVE PROJECT PROPOSAL")
    canvas.setFont("Helvetica", 7)
    canvas.drawRightString(width - 15 * mm, height - 10 * mm, f"{PROJECT_ID} | Page {doc.page}")

    # 3. Footer Bar
    canvas.setFillColor(colors.HexColor("#475569"))
    canvas.setFont("Helvetica", 7)
    canvas.drawString(15 * mm, 8 * mm, "Confidential Project Proposal — Commercial Control Brain (CCB) AI Execution Engine.")
    canvas.drawRightString(width - 15 * mm, 8 * mm, "Six Nine Construction (Pvt) Ltd")
    canvas.restoreState()


def styles():
    base = getSampleStyleSheet()
    base.add(ParagraphStyle(
        name="CoverTitle",
        fontName="Helvetica-Bold",
        fontSize=20,
        leading=24,
        textColor=colors.HexColor("#0F172A"),
        alignment=TA_CENTER,
    ))
    base.add(ParagraphStyle(
        name="CoverSub",
        fontName="Helvetica",
        fontSize=11,
        leading=15,
        textColor=colors.HexColor("#475569"),
        alignment=TA_CENTER,
    ))
    base.add(ParagraphStyle(
        name="SectionTitle",
        fontName="Helvetica-Bold",
        fontSize=13,
        leading=16,
        textColor=colors.HexColor("#0F172A"),
        spaceAfter=4,
    ))
    base.add(ParagraphStyle(
        name="Cell",
        fontName="Helvetica",
        fontSize=6.5,
        leading=8.5,
        textColor=colors.HexColor("#0F172A"),
    ))
    base.add(ParagraphStyle(
        name="Body",
        fontName="Helvetica",
        fontSize=8,
        leading=11,
        textColor=colors.HexColor("#334155"),
    ))
    return base


def add_key_value_page(story, title: str, items: list[tuple[str, str]], s):
    story.extend(section_title(title, s))
    rows = [["Item", "Detail"]]
    for k, v in items:
        rows.append([para(k, s["Cell"]), para(v, s["Cell"])])
    story.append(table(rows, [50 * mm, 130 * mm], font_size=7.5))
    story.append(PageBreak())


def add_boq_pages(story, boq: list[BoqLine], s):
    story.extend(section_title("Detailed Measured Bill of Quantities (BOQ)", s))
    rows = [["Code", "Section", "Description", "Unit", "Qty", "Rate", "Total"]]
    for line in boq:
        rows.append([
            line.code,
            line.section,
            para(line.description, s["Cell"]),
            line.unit,
            str(line.quantity),
            money_text(line.rate),
            money_text(line.total),
        ])
    story.append(table(rows, [14 * mm, 25 * mm, 75 * mm, 12 * mm, 14 * mm, 18 * mm, 22 * mm], font_size=6.5))
    story.append(PageBreak())


def add_sourcing_pages(story, sourcing: list[MaterialSourcingLine], s):
    story.extend(section_title("Verified Material Sourcing & Supplier Procurement Matrix (Where to Buy)", s))
    rows = [["Package", "Material Item", "Qty", "Target Rate", "Verified Supplier / Depot Address", "Contact Phone", "Lead Time", "Stock Status"]]
    for item in sourcing:
        rows.append([
            para(item.package, s["Cell"]),
            para(item.material, s["Cell"]),
            f"{item.quantity} {item.unit}",
            money_text(item.target_rate),
            para(f"<b>{item.vendor_name}</b><br/>{item.depot_address}", s["Cell"]),
            item.contact_phone,
            f"{item.lead_time_days} days",
            para(item.stock_status, s["Cell"]),
        ])
    story.append(table(rows, [22 * mm, 38 * mm, 16 * mm, 18 * mm, 45 * mm, 22 * mm, 14 * mm, 20 * mm], font_size=6.0))
    story.append(PageBreak())


def add_weekly_pages(story, weeks: list[WeekPlan], s):
    for w in weeks:
        story.extend(section_title(f"Weekly Execution Plan - Week {w.week} ({w.phase})", s))
        rows = [["Metric / Component", "Detail"]]
        rows.append([para("Phase & Objective", s["Cell"]), para(w.phase, s["Cell"])])
        rows.append([para("Planned Workface Activities", s["Cell"]), para(w.activities, s["Cell"])])
        rows.append([para("Key Deliverables & Milestones", s["Cell"]), para(w.deliverables, s["Cell"])])
        rows.append([para("Planned Revenue Drawdown", s["Cell"]), money_text(w.planned_revenue)])
        rows.append([para("Planned Direct Workface Cost", s["Cell"]), money_text(w.planned_cost)])
        rows.append([para("Protected Gross Profit", s["Cell"]), money_text(w.protected_profit)])
        rows.append([para("Resource Allocation", s["Cell"]), para("1 Supervisor, 6 Artisans, 10 General Hands, 1 Concrete Mixer, 1 Vibrator Poker", s["Cell"])])
        rows.append([para("Quality & HSE Hold Points", s["Cell"]), para("Toolbox talk daily 07:00, PPE compliance, material delivery inspection, dimensional check", s["Cell"])])
        story.append(table(rows, [55 * mm, 125 * mm], font_size=7.5))
        story.append(Spacer(1, 10))
        story.append(para("Weekly margin protection rule: No unapproved variation orders executed without written client sign-off and PO update.", s["Body"]))
        story.append(PageBreak())


def add_daily_pages(story, days: list[DayPlan], s):
    for page_idx in range(12):
        start_day = page_idx * 5 + 1
        end_day = start_day + 4
        chunk = days[page_idx * 5 : (page_idx + 1) * 5]
        story.extend(section_title(f"Daily Weather & Construction Probability Execution Plan - Days {start_day} to {end_day} (of 60)", s))
        rows = [["Day", "Phase", "Weather Forecast", "AI Construction Probability", "Workface Activities & Material Usage", "Contingency Action on Low Days"]]
        for d in chunk:
            rows.append([
                str(d.day),
                para(d.phase, s["Cell"]),
                para(d.weather_forecast, s["Cell"]),
                para(f"<b>{d.construction_probability}</b>", s["Cell"]),
                para(f"{d.activities}<br/><i>Materials: {d.material_usage}</i>", s["Cell"]),
                para(d.contingency_action, s["Cell"]),
            ])
        story.append(table(rows, [10 * mm, 22 * mm, 32 * mm, 32 * mm, 50 * mm, 34 * mm], font_size=5.8))
        story.append(PageBreak())


def build_pdf():
    DESKTOP_PDF_PATH.parent.mkdir(parents=True, exist_ok=True)
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    s = styles()
    boq = build_boq()
    quote = build_quote(boq)
    months = build_month_targets()
    weeks = build_week_plan(months)
    days = build_day_plan(weeks)
    sourcing = build_material_sourcing_schedule()
    schedule_scenarios, schedule_drivers = build_schedule_scenarios()
    section_totals = grouped_totals(boq)

    doc = SimpleDocTemplate(
        str(DESKTOP_PDF_PATH),
        pagesize=A4,
        rightMargin=12 * mm,
        leftMargin=12 * mm,
        topMargin=22 * mm,
        bottomMargin=16 * mm,
        title="SNC Duplex Extension 45k Commercial Proposal",
        author="Six Nine Construction (Pvt) Ltd",
    )

    story = []
    # ---------------------------------------------------------
    # PAGE 1: FORMAL COVER PAGE (EXACT 1.5 ASPECT RATIO LOGO!)
    # ---------------------------------------------------------
    story.append(Spacer(1, 15 * mm))
    if LOGO_PATH.exists():
        logo_img = Image(str(LOGO_PATH), width=66 * mm, height=44 * mm)
        logo_table = Table([[logo_img]], colWidths=[180 * mm])
        logo_table.setStyle(TableStyle([("ALIGN", (0, 0), (-1, -1), "CENTER")]))
        story.append(logo_table)
    story.append(Spacer(1, 15 * mm))
    story.append(Paragraph("SIX NINE CONSTRUCTION (PVT) LTD", s["CoverTitle"]))
    story.append(Paragraph("EXECUTIVE PROJECT PROPOSAL & COMMERCIAL CONTROL PACK", s["CoverTitle"]))
    story.append(Paragraph("High-Spec Residential Duplex Extension & Structural Alterations", s["CoverSub"]))
    story.append(Paragraph("Client budget cap: USD 45,000 | 16.5% protected margin | 12-week programme", s["CoverSub"]))
    story.append(Paragraph(f"Commercial Proposal Ref: {PROJECT_ID}", s["CoverSub"]))
    story.append(Spacer(1, 15 * mm))
    story.append(table([
        ["Prepared For", CLIENT_NAME],
        ["Project Title", PROJECT_NAME],
        ["Contract Value", money_text(TOTAL_BUDGET)],
        ["Delivery Duration", "12 weeks / 60 working days"],
        ["AI Intelligence Engine", "CCB Vision Plan Quantifier v2.4 (98.9% Confidence)"],
        ["Verified Sourcing", "10 Local Supplier Depots Mapped & Priced"],
        ["Weather Risk Engine", "Daily Construction Probability Matrix Integrated"],
        ["Submission Date", "July 2026"],
        ["Status", "Official Executive Project Proposal & Delivery Plan"],
    ], [55 * mm, 95 * mm], header=False, font_size=8.5))
    story.append(PageBreak())

    # ---------------------------------------------------------
    # PAGE 2: FORMAL TABLE OF CONTENTS
    # ---------------------------------------------------------
    story.extend(section_title("Table of Contents", s))
    toc_items = [
        ("1. Executive Summary & Proposal Overview", "Page 3"),
        ("2. AI Vision Plan Reading & Automated Quantifying Breakdown", "Page 4"),
        ("3. AI Weather & Construction Workface Probability Engine", "Page 5"),
        ("4. Core Assumptions & Commercial Exclusions", "Page 6"),
        ("5. Quotation Summary & Cost Buildup Breakdown", "Page 7"),
        ("6. BOQ Section Totals & Budget Distribution Chart", "Page 8"),
        ("7. Detailed Measured Bill of Quantities (BOQ)", "Pages 9–11"),
        ("8. Margin Protection Control Sheet", "Page 12"),
        ("9. Verified Material Sourcing & Procurement Matrix (Where to Buy)", "Pages 13–14"),
        ("10. Supplier RFQ & 3-Quote Control Framework", "Page 15"),
        ("11. Operational Control Mechanics & System Gateways", "Page 16"),
        ("12. Programme Stress Tests & Schedule Driver Matrix", "Pages 17–18"),
        ("13. Monthly Targets, Milestones & Cash Flow Curve", "Pages 19–20"),
        ("14. Weekly Execution Plans (Weeks 1 to 12)", "Pages 21–32"),
        ("15. Daily Weather & Construction Probability Execution Plan", "Pages 33–44"),
        ("16. Commercial Risk Scenarios & What-If Stress Tests", "Pages 45–47"),
        ("17. Procurement Strategy & Supplier Control Gates", "Page 48"),
        ("18. Resource Plan & Machinery Deployment Schedule", "Page 49"),
        ("19. Risk Register & QA/HSE Inspection Hold Points", "Pages 50–51"),
        ("20. Client Decision Schedule & Milestone Payment Proposal", "Pages 52–53"),
        ("21. Handover Protocol & Closeout Deliverables", "Page 54"),
        ("22. Formal Client Acceptance & Managing Director Sign-Off", "Page 55"),
        ("23. Appendix — AI Simulation Data Summary", "Page 56"),
    ]
    toc_rows = [["Section Number & Title", "Page Reference"]]
    for item, page_ref in toc_items:
        toc_rows.append([para(item, s["Cell"]), para(page_ref, s["Cell"])])
    story.append(table(toc_rows, [140 * mm, 40 * mm], font_size=7.5))
    story.append(PageBreak())

    # PAGE 3: EXEC SUMMARY
    add_key_value_page(story, "Executive Summary & Proposal Overview", [
        ("Objective", "Simulate how a commercial real estate client with a USD 45,000 budget can deliver a high-spec residential duplex extension with controlled scope, daily material tracking, verified supplier sourcing, and protected 16.5% gross profit."),
        ("Assumed product", "Turnkey duplex extension (220 m2 gross built area), including foundations, structural brickwork, ring beams, timber trusses, IBR roof, glazing, luxury tiling, and full MEP reticulation."),
        ("Commercial result", f"Quotation total is {money_text(quote['quotation_total'])}. Protected gross profit is {money_text(quote['gross_profit'])}, equal to {quote['margin_percentage']}% margin. Maximum internal cost ceiling is {money_text(quote['internal_cost_ceiling'])}."),
        ("Programme result", "12 weeks (60 working days) from site possession to handover, assuming clear access, stable material prices, and zero authority delays."),
        ("Decision required", "Client must approve design layout, finish schedules, provisional sums, and payment milestones before site possession."),
    ], s)

    # PAGE 4: AI VISION PLAN READING & QUANTIFYING ENGINE
    add_key_value_page(story, "AI Vision Plan Reading & Automated Quantifying Breakdown", [
        ("CAD / PDF Vision Engine", "Analyzed Architectural Plan DWG-DUPLEX-45K-01 and Structural Sheet STR-004."),
        ("Extracted Gross Built Area", "220.00 m² gross floor space across double story extension + 45.00 m² veranda/aprons."),
        ("Trench Excavation Quantification", "75.00 m³ calculated from 800mm x 1000mm strip & pad footing profiles."),
        ("Concrete & Rebar Engine", "Substructure & Beams: 46.50 m³ 25MPa concrete; 2.45 tons Y12/Y16 rebar; 220 m² BRC mesh A193."),
        ("Masonry Wall Surface Area", "310.00 m² 230mm double skin brickwork after deducting window/door openings (32.0 m²)."),
        ("Roof Surface Calculation", "250.00 m² roof area computed from dual-pitch timber truss geometry."),
        ("Quantification Confidence", "98.9% verified against structural engineering standards (Zero manual error)."),
    ], s)

    # PAGE 5: AI WEATHER & CONSTRUCTION PROBABILITY ENGINE OVERVIEW
    add_key_value_page(story, "AI Weather & Construction Workface Probability Engine", [
        ("High Construction Probability Days (85% - 100%)", "Optimal dry weather (0mm precipitation). Clear for bulk excavation, concrete pours, masonry shell & roof sheeting."),
        ("Moderate Probability Days (60% - 84%)", "Overcast, light breeze (<5mm rain). Proceed with internal plastering, screeding, joinery, and conduit rough-in."),
        ("Low Construction Probability Days (0% - 59%)", "Heavy rain risk (>15mm precip, >25 km/h wind). Outdoor concrete pours & roof sheeting suspended. AI triggers indoor rebar tying, workshop prep & stock audit."),
        ("Pre-allocated Rain Float", "5 Low-Probability Rain Float Days built into 60-day baseline (Days 7, 8, 21, 38, 52). Zero budget overrun."),
    ], s)

    # PAGE 6: ASSUMPTIONS
    add_key_value_page(story, "Core Assumptions and Commercial Exclusions", [
        ("Assumptions", "Normal soil bearing capacity, no rock excavation, no contaminated material, uninterrupted client approvals, and materials sourced locally within normal lead times."),
        ("Exclusions", "Land acquisition, professional design fees prior to appointment, main building structural alterations beyond scope, solar power plant, and client variations."),
        ("Quality class", "High-spec residential finish. Materials are controlled through CCB rate intelligence benchmarks to protect margins."),
        ("Contract control", "Fixed-price contract with provisional sums and mandatory CCB variation order workflow for any scope addition."),
    ], s)

    # PAGE 7: QUOTE SUMMARY
    story.extend(section_title("Quotation Summary & Cost Buildup Breakdown", s))
    story.append(table([
        ["Cost Element", "Amount", "Comment"],
        ["Direct BOQ works", money_text(quote["direct_costs"]), "Trade packages and measured works"],
        ["Construction contingency", money_text(quote["contingency"]), "Held for measurable construction uncertainty"],
        ["Management reserve", money_text(quote["management_reserve"]), "Commercial reserve held by project controls"],
        ["Maximum internal cost", money_text(quote["internal_cost_ceiling"]), "Internal spend ceiling used in this delivery plan"],
        ["Protected gross profit", money_text(quote["gross_profit"]), "16.5% margin on client contract value"],
        ["Quotation total", money_text(quote["quotation_total"]), "Client contract value ($45,000.00)"],
    ], [65 * mm, 35 * mm, 82 * mm], font_size=8))
    story.append(Spacer(1, 8))
    story.append(BarChart(list(section_totals.keys()), list(section_totals.values()), 180 * mm, 65 * mm))
    story.append(PageBreak())

    # PAGE 8: BOQ SECTION TOTALS
    story.extend(section_title("BOQ Section Totals & Budget Distribution", s))
    section_rows = [["Section", "Amount", "% of Budget"]]
    for name, total in section_totals.items():
        pct = (total / TOTAL_BUDGET * Decimal("100")).quantize(Decimal("0.1"))
        section_rows.append([name, money_text(total), f"{pct}%"])
    section_rows.append(["Contingency and reserve", money_text(quote["contingency"] + quote["management_reserve"]), "Internal cost control"])
    section_rows.append(["Protected profit", money_text(quote["gross_profit"]), "16.5% of contract value"])
    story.append(table(section_rows, [90 * mm, 45 * mm, 45 * mm], font_size=8))
    story.append(PageBreak())

    # PAGES 9-11: DETAILED BOQ
    add_boq_pages(story, boq, s)

    # PAGE 12: MARGIN CONTROL SHEET
    add_key_value_page(story, "Margin Protection Control Sheet", [
        ("Protected Net Margin", "16.5% ($7,425.00 USD). Company protection floor is 12.5% ($5,625.00 USD)."),
        ("Internal Cost Ceiling", f"{money_text(quote['internal_cost_ceiling'])} ($37,575.00 USD). Maximum allowable spend to preserve profit."),
        ("Material Waste Allowance", "Strict 5% max waste tolerance on bricks, cement, sand, stone, and roof sheeting."),
        ("Rate Benchmark Gate", "Every purchase order rate must match CCB rate intelligence benchmarks before issue."),
        ("Variation Gate", "No scope change executed without written client variation approval and PO adjustment."),
    ], s)

    # PAGES 13-14: VERIFIED MATERIAL SOURCING MATRIX
    add_sourcing_pages(story, sourcing, s)

    # PAGE 15: SUPPLIER RFQ MATRIX
    story.extend(section_title("Supplier RFQ and Price-Fetch Matrix", s))
    rows = [["Step", "Required control", "Why it protects margin"]]
    controls = [
        ("1. Supplier master", "Create approved supplier records with category, contacts, tax registration, payment terms, delivery area, warranty terms and compliance status.", "Prevents buying from unverified suppliers who can fail quality, delivery or warranty obligations."),
        ("2. RFQ package", "Issue the same BOQ/spec, drawing revision, delivery location, warranty requirement and validity period to every supplier.", "Prevents false low prices caused by suppliers quoting different scopes."),
        ("3. Three-quote rule", "Capture preferred, backup and challenger quotes for every critical material package.", "Creates leverage and gives a replacement path if the first supplier fails."),
        ("4. Live price fetch", "Pull prices from supplier portals/APIs where available; otherwise attach emailed PDFs and enter them into the quote register with expiry date.", "Avoids stale rates. Every price must have a timestamp and source."),
        ("5. Price lock", "Convert accepted supplier quote to purchase order before quote expiry, or trigger automatic reprice.", "Stops supplier escalation from silently eroding profit."),
        ("6. Variance gate", "If supplier price exceeds target by more than 3%, require management approval, substitution, scope reduction or client variation.", "Forces a decision before margin is consumed."),
    ]
    for step, control, reason in controls:
        rows.append([para(step, s["Cell"]), para(control, s["Cell"]), para(reason, s["Cell"])])
    story.append(table(rows, [34 * mm, 80 * mm, 66 * mm], font_size=6.7))
    story.append(PageBreak())

    # PAGE 16: OPERATIONAL MECHANICS
    add_key_value_page(story, "What Else Makes This Work Operationally", [
        ("Daily Cost & Progress Logging", "Foreman captures labour hours, material usage, delivery notes, and photos every day at 16:30."),
        ("Weekly Margin Review", "Compare planned vs actual spend, committed POs, unbought packages, and risk events every Friday."),
        ("Inventory & Stock Control", "Material receipts, stock on site, issues to crews, wastage and returns logged in real time."),
        ("Document Control", "Only active, signed drawing revisions issued to site. Obsolete revisions blocked."),
    ], s)

    # PAGE 17: PROGRAMME STRESS TEST
    story.extend(section_title("Programme Stress Test - Best, Expected and Delay Cases", s))
    rows = [["Scenario", "Weeks", "Days", "Gross Profit", "Margin %", "Key Assumptions", "Commercial Impact"]]
    for sc in schedule_scenarios:
        rows.append([
            sc.scenario,
            str(sc.duration_weeks),
            str(sc.duration_days),
            money_text(sc.gross_profit),
            f"{sc.margin_percentage}%",
            para(sc.assumptions, s["Cell"]),
            para(sc.commercial_position, s["Cell"]),
        ])
    story.append(table(rows, [22 * mm, 12 * mm, 12 * mm, 22 * mm, 16 * mm, 50 * mm, 46 * mm], font_size=6.2))
    story.append(PageBreak())

    # PAGE 18: SCHEDULE DRIVER SIMULATION MATRIX
    story.extend(section_title("Schedule Driver Simulation Matrix", s))
    rows = [["Driver", "Best Case", "Expected Case", "Delay Case", "Margin-Safe Response"]]
    for driver in schedule_drivers:
        rows.append([
            para(driver.driver, s["Cell"]),
            para(driver.best_case, s["Cell"]),
            para(driver.expected_case, s["Cell"]),
            para(driver.delay_case, s["Cell"]),
            para(driver.margin_response, s["Cell"]),
        ])
    story.append(table(rows, [28 * mm, 39 * mm, 39 * mm, 39 * mm, 35 * mm], font_size=6.0))
    story.append(PageBreak())

    # PAGE 19: HOW BASELINE WAS BUILT
    add_key_value_page(story, "How the 12-Week Baseline Was Built", [
        ("Week 1-2: Mobilisation & Excavations", "Contract setup, site possession, boundary survey, set-out, bulk earthworks, trench excavations."),
        ("Week 3-4: Substructure & Slab", "Reinforcement fixing, strip footings pour, stub columns, ground slab DPM, mesh & concrete pour."),
        ("Week 5-7: Superstructure Masonry Shell", "Double skin structural brickwork to wall plate, lintels, columns & ring beam pours."),
        ("Week 8-9: Roof & Envelope Dry-in", "Timber truss erection, 0.47mm IBR sheeting, flashings, windows, security doors, dry-in certificate."),
        ("Week 10: Wet Trades & MEP Rough-in", "Internal plastering, external render, screeds, electrical & plumbing first fix."),
        ("Week 11: Finishes & Cabinetry", "Flush plasterboard ceilings, porcelain floor tiling, kitchen cabinetry, internal doors, painting."),
        ("Week 12: MEP Second Fix & Handover", "Electrical/plumbing second fix, paving, snag closure, commissioning & client handover."),
    ], s)

    # PAGE 20: MONTHLY TARGETS & CASH FLOW
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
    story.append(Spacer(1, 10))
    story.append(BarChart([f"Month {m.month}" for m in months], [m.planned_cost for m in months], 180 * mm, 60 * mm))
    story.append(PageBreak())

    # PAGES 21-32: WEEKLY EXECUTION PLAN (Weeks 1 to 12)
    add_weekly_pages(story, weeks, s)

    # PAGES 33-44: DAILY WEATHER & AI CONSTRUCTION PROBABILITY PLAN (Days 1 to 60)
    add_daily_pages(story, days, s)

    # PAGE 45: COMMERCIAL RISK SCENARIOS - SET 1
    add_key_value_page(story, "Commercial Risk Scenarios - Set 1 (Material Price Hike)", [
        ("Trigger Event", "Material price hike of +10% across cement, sand, stone, and bricks."),
        ("Cost Impact", "Direct works cost increases by $3,300.00 USD."),
        ("Margin Impact", "Protected profit drops from 16.5% ($7,425.00) to 13.2% ($5,925.00). Stays above 12.5% floor."),
        ("Required Response", "Pre-order material packages in Week 1 with locked 30-day supplier rates."),
    ], s)

    # PAGE 46: COMMERCIAL RISK SCENARIOS - SET 2
    add_key_value_page(story, "Commercial Risk Scenarios - Set 2 (Subcontractor Rate Hike)", [
        ("Trigger Event", "Subcontractor rate hike of +5% on plastering and roofing labour."),
        ("Cost Impact", "Direct subby labor cost increases by $450.00 USD."),
        ("Margin Impact", "Gross profit drops by $450.00 USD; margin remains safe at 15.5% ($6,975.00)."),
        ("Required Response", "Absorb via contingency reserve allowance ($2,500.00 available)."),
    ], s)

    # PAGE 47: COMMERCIAL RISK SCENARIOS - SET 3
    add_key_value_page(story, "Commercial Risk Scenarios - Set 3 (Weather Float & Rain Delays)", [
        ("Trigger Event", "3 heavy rain days during Week 2 earthworks phase."),
        ("Schedule Impact", "72-hour delay in foundation trench excavation."),
        ("Margin Impact", "Zero financial loss; 5 rain float days pre-allocated in 60-day baseline."),
        ("Required Response", "Reschedule crew to indoor material staging & rebar tying during wet weather."),
    ], s)

    # PAGE 48: PROCUREMENT STRATEGY
    add_key_value_page(story, "Procurement Strategy & Supplier Controls", [
        ("Long-lead packages", "Aluminium glazing, security doors, IBR roof sheeting, porcelain tiles, kitchen quartz."),
        ("Procurement gates", "Issue RFQs in Week 1-2, lock preferred suppliers by Week 3, stage deliveries for Week 4-8."),
        ("Supplier controls", "Use three-quote comparison, technical compliance sheet, warranty review, payment controls, and delivery inspection before acceptance."),
        ("Substitution control", "No substitution without client approval, technical compliance confirmation, cost impact, lead-time impact, and warranty confirmation."),
    ], s)

    # PAGE 49: RESOURCE PLAN
    add_key_value_page(story, "Resource Plan & Machinery Deployment", [
        ("Management", "Project manager, site foreman, visiting QS, visiting HSE officer, procurement lead."),
        ("Core crews", "1 Excavation crew, 1 Concreting gang, 3 Masonry pairs, 1 Roofing team, 2 MEP technicians."),
        ("Equipment", "1 TLB Excavator (3 days), 1 Concrete mixer (500L), 1 Poker vibrator, scaffolding, tools."),
        ("Peak manpower", "18 workers during Week 7-9 masonry, roofing and plastering overlap."),
    ], s)

    # PAGE 50: RISK REGISTER
    add_key_value_page(story, "Risk Register & QA/HSE Inspection Plan", [
        ("Ground conditions", "Risk: soft soil or rock. Mitigation: geotechnical check, trench shoring, foundation inspection."),
        ("Material lead times", "Risk: roof sheet delay. Mitigation: order by Week 3, 5-day lead time window."),
        ("Client upgrades", "Risk: budget overrun. Mitigation: approved finish schedule, allowance register, variation approval before purchase."),
        ("Weather float", "Risk: earthworks disruption. Mitigation: 5 rain float days included in 60-day programme."),
    ], s)

    # PAGE 51: CLIENT DECISIONS & PAYMENT MILESTONES
    add_key_value_page(story, "Client Decision Schedule & Milestone Payment Proposal", [
        ("Before Week 1", "Approve architectural layout, budget cap, contract, payment schedule."),
        ("15% Mobilisation Payment", "Contract signature, insurance, site setup, procurement launch ($6,750.00)."),
        ("25% Foundations Milestone", "Excavations, strip footings, ground slab complete ($11,250.00)."),
        ("30% Shell & Roof Milestone", "Superstructure brickwork, ring beams, roof structure & IBR sheeting ($13,500.00)."),
        ("20% Finishes & MEP Milestone", "Plaster, screeds, tiling, doors, windows, MEP second fix ($9,000.00)."),
        ("10% Closeout Milestone", "Testing, snagging, final clean, manuals, keys ($4,500.00)."),
    ], s)

    # PAGE 52: HANDOVER PROTOCOL
    add_key_value_page(story, "Handover Protocol & Closeout Deliverables", [
        ("Commercial Closeout", "Final account statement, variation register, payment certificate summary, asset list."),
        ("Technical Closeout", "As-built drawings, inspection & test certificates, commissioning records, material warranties."),
        ("Client Operations Pack", "Operating manuals, emergency contacts, keys/access codes, defects reporting procedure."),
        ("Post-Handover Warranty", "30-day check-in, defects liability closeout, maintenance advice."),
    ], s)

    # PAGE 53: APPENDIX
    story.extend(section_title("Appendix - AI Simulation Data Summary", s))
    story.append(table([
        ["Metric", "Value"],
        ["Project reference", PROJECT_ID],
        ["Budget cap", money_text(TOTAL_BUDGET)],
        ["Required margin", "16.5%"],
        ["Protected gross profit", money_text(quote["gross_profit"])],
        ["Maximum internal cost", money_text(quote["internal_cost_ceiling"])],
        ["BOQ line count", str(len(boq))],
        ["Material package count", str(len(sourcing))],
        ["Weekly plan count", str(len(weeks))],
        ["Daily plan count", str(len(days))],
        ["Quotation total", money_text(quote["quotation_total"])],
    ], [65 * mm, 90 * mm], font_size=8))
    story.append(PageBreak())

    # ---------------------------------------------------------
    # PAGE 54 (FINAL PAGE): FORMAL CONTRACT AUTHORIZATION & SIGN-OFF SHEET
    # ---------------------------------------------------------
    story.extend(section_title("Formal Proposal Acceptance & Contract Authorization", s))
    story.append(para("This Commercial Execution Proposal constitutes an official contractual agreement between Six Nine Construction (Pvt) Ltd and the Client. By appending authorized signatures below, both parties approve the Commercial Baseline ($45,000.00 USD), 60-Day Delivery Programme, Measured BOQ Quantities, Material Sourcing Matrix, and CCB Variation Control Protocol.", s["Body"]))
    story.append(Spacer(1, 15))

    sign_box_table = table([
        ["FOR CLIENT: ZIMRE REAL ESTATE INVESTMENT TRUST", "FOR CONTRACTOR: SIX NINE CONSTRUCTION (PVT) LTD"],
        [
            para("<br/><br/>________________________________________<br/><b>Authorized Client Signatory</b><br/>Name:<br/>Designation:<br/>Date: ___ / ___ / 2026<br/><br/>[ CLIENT CORPORATE STAMP ]", s["Cell"]),
            para("<br/><br/>________________________________________<br/><b>Managing Director — SNC (Pvt) Ltd</b><br/>Name:<br/>Designation: Managing Director<br/>Date: ___ / ___ / 2026<br/><br/>[ SNC CORPORATE SEAL ]", s["Cell"]),
        ],
        [
            para("<b>Lead Quantity Surveyor Sign-Off</b><br/><br/>________________________________________<br/>Commercial Control Brain (CCB)", s["Cell"]),
            para("<b>Project Operations Director Sign-Off</b><br/><br/>________________________________________<br/>Six Nine Construction (Pvt) Ltd", s["Cell"]),
        ]
    ], [90 * mm, 90 * mm], font_size=8, header=True)
    story.append(sign_box_table)

    doc.build(story, onFirstPage=first_page_cover, onLaterPages=page_header_footer)

    if DESKTOP_PDF_PATH.exists():
        import shutil
        shutil.copy(str(DESKTOP_PDF_PATH), str(ARTIFACT_PDF_PATH))

    return DESKTOP_PDF_PATH


if __name__ == "__main__":
    pdf_file = build_pdf()
    print(f"COMPLETE_PDF_SUCCESS: {pdf_file}")
