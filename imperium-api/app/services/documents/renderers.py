import os
import logging
import math
from typing import Dict, Any, List
from reportlab.lib import colors
from reportlab.platypus import Flowable
from app.services.documents.interfaces import (
    DocumentRenderer,
    ExcelExporter,
    TextExtractor,
    PDFMergeService,
)
from app.services.quotations.intelligence_engine import SpendForecaster


class BarChartFlowable(Flowable):
    def __init__(self, labels: list[str], values: list[float], width: float, height: float):
        super().__init__()
        self.labels = labels
        self.values = values
        self.width = width
        self.height = height

    def draw(self) -> None:
        max_value = max(self.values) if self.values else 1.0
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
            self.canv.saveState()
            self.canv.translate(x + bar_w / 2, 8)
            self.canv.rotate(35)
            self.canv.drawCentredString(0, 0, label)
            self.canv.restoreState()
            self.canv.saveState()
            self.canv.translate(x + bar_w / 2, bottom + h + 4)
            self.canv.rotate(65)
            self.canv.drawString(0, 0, f"{int(value / 1000)}k")
            self.canv.restoreState()


class QuotationPDFRenderer(DocumentRenderer):
    def render_pdf(self, data: Dict[str, Any], output_path: str) -> bool:
        """
        Generates a professional A4 ReportLab PDF for Six Nine Construction.
        If grand_total >= 100k or generate_master_pack is true, compiles a 47-page
        Grade-1 Master Construction Pack with Cover, TOC, Gantt schedules, and cash flows.
        """
        logging.info(f"Rendering PDF to {output_path}")
        try:
            from reportlab.lib.pagesizes import A4
            from reportlab.platypus import (
                SimpleDocTemplate,
                Paragraph,
                Spacer,
                Table,
                TableStyle,
                PageBreak,
            )
            from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
            from reportlab.lib import colors
            from decimal import Decimal

            # Setup margins and dimensions
            is_master = data.get("generate_master_pack") or (float(data.get("grand_total", 0)) >= 100000)

            # Real project figures - the master pack below is derived entirely from
            # these instead of a fixed fictional narrative, so a $150k warehouse and
            # a $2M residence each get their own numbers, not the same boilerplate.
            grand_total_f = float(data.get("grand_total", 0))
            direct_costs_f = float(data.get("direct_costs", 0))
            profit_amount_f = float(data.get("profit_amount", 0))
            profit_pct = round((profit_amount_f / grand_total_f * 100.0), 1) if grand_total_f > 0 else 0.0
            duration_weeks = int(data.get("project_duration_weeks") or 12)
            built_area_sqm = float(data.get("built_area_sqm", 0) or 0)
            items_list = data.get("items") or []
            cost_breakdown = (data.get("breakdown_log") or {}).get("direct_costs_breakdown") or {}

            doc = SimpleDocTemplate(
                output_path,
                pagesize=A4,
                rightMargin=36,
                leftMargin=36,
                topMargin=54,
                bottomMargin=45,
            )
            styles = getSampleStyleSheet()

            # Custom styles
            title_style = ParagraphStyle(
                name="BrandedTitle",
                parent=styles["Heading1"],
                textColor=colors.HexColor("#0F172A"),
                fontSize=20,
                spaceAfter=10,
            )
            section_style = ParagraphStyle(
                name="SectionHeading",
                parent=styles["Heading2"],
                textColor=colors.HexColor("#1E293B"),
                fontSize=12,
                spaceBefore=10,
                spaceAfter=6,
            )
            body_style = ParagraphStyle(
                name="SmallBody",
                parent=styles["Normal"],
                fontSize=8,
                textColor=colors.HexColor("#475569"),
            )
            cell_style = ParagraphStyle(
                name="PDFCell",
                parent=styles["Normal"],
                fontSize=7,
                leading=9,
                textColor=colors.HexColor("#0F172A"),
            )
            right_style = ParagraphStyle(
                name="PDFRight",
                parent=cell_style,
                alignment=2, # Right alignment
            )

            story = []

            # Page header/footer routine
            def page_header_footer(canvas, doc_obj):
                canvas.saveState()
                width, height = A4
                canvas.setFillColor(colors.HexColor("#0F172A"))
                canvas.rect(0, height - 45, width, 45, fill=1, stroke=0)
                canvas.setFillColor(colors.white)
                canvas.setFont("Helvetica-Bold", 8)
                canvas.drawString(36, height - 26, "SIX NINE CONSTRUCTION (PVT) LTD - RESIDENTIAL PROJECT PACK")
                canvas.setFont("Helvetica", 7)
                canvas.drawRightString(width - 36, height - 26, f"{data.get('quotation_id', 'SNC-HOUSE-500K')} | Page {doc_obj.page}")
                canvas.setFillColor(colors.HexColor("#475569"))
                canvas.setFont("Helvetica", 7)
                canvas.drawString(36, 20, "Simulation only - validate with drawings, site visit and approvals.")
                canvas.drawRightString(width - 36, 20, "Quote, BOQ, programme, QA/HSE and closeout pack")
                canvas.restoreState()

            # Helper for tables
            def build_table(table_data, col_widths, font_size=7, header=True):
                formatted_data = []
                for row in table_data:
                    formatted_data.append([
                        Paragraph(str(cell), cell_style) if not isinstance(cell, Paragraph) else cell
                        for cell in row
                    ])
                t = Table(formatted_data, colWidths=col_widths)
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

            # --- RENDER LOGIC SWITCH ---
            if is_master:
                # 1. COVER PAGE
                styles.add(ParagraphStyle(
                    name="CoverTitle",
                    parent=styles["Title"],
                    fontName="Helvetica-Bold",
                    fontSize=24,
                    leading=28,
                    textColor=colors.HexColor("#0F172A"),
                    alignment=1, # Center
                    spaceAfter=15,
                ))
                styles.add(ParagraphStyle(
                    name="CoverSub",
                    parent=styles["Normal"],
                    fontSize=11,
                    leading=15,
                    alignment=1,
                    textColor=colors.HexColor("#334155"),
                    spaceAfter=8,
                ))

                story.append(Spacer(1, 100))
                story.append(Paragraph("SIX NINE CONSTRUCTION (PVT) LTD", styles["CoverTitle"]))
                story.append(Paragraph("Grade-1 Complete Construction Project Brief & Pack", styles["CoverTitle"]))
                story.append(Paragraph(f"Client contract value: USD {grand_total_f:,.2f} | {profit_pct:.1f}% protected margin | {duration_weeks}-week programme", styles["CoverSub"]))
                story.append(Paragraph(f"Project Reference ID: {data.get('quotation_id', 'SNC-HOUSE-500K')}", styles["CoverSub"]))
                story.append(Spacer(1, 50))

                story.append(build_table([
                    ["Prepared For", data.get("client_name", "Corporate Client")],
                    ["Project Name", data.get("project_title", "Construction Project")],
                    ["Contract Value", f"${grand_total_f:,.2f}"],
                    ["Project Duration", f"{duration_weeks} Weeks / {duration_weeks * 5} Workdays"],
                    ["Status", "Grade-1 Construction & Estimating Blueprint"],
                ], [120, 380], header=False, font_size=9))
                story.append(PageBreak())

                # 2. TABLE OF CONTENTS PAGE
                story.append(Paragraph("<b>Table of Contents</b>", section_style))
                story.append(Spacer(1, 10))
                toc_rows = [
                    ["Section Name", "Page Number"],
                    ["Section 1: Executive Summary & Project brief", "Page 2"],
                    ["Section 2: Assumptions, Exclusions & Clarifications", "Page 3"],
                    ["Section 3: Quotation Financial Summary", "Page 4"],
                    ["Section 4: BOQ Section Totals Analysis", "Page 5"],
                    ["Section 5: Detailed Bill of Quantities (BOQ) Ledger", "Page 6"],
                    ["Section 6: Margin Protection Control Sheet", "Page 7"],
                    ["Section 7: Required Materials & Price Targets", "Page 8"],
                    ["Section 8: Supplier RFQ & Verification Controls", "Page 10"],
                    ["Section 9: Material Margin Controls by Package", "Page 11"],
                    ["Section 10: Construction Operations & Controls", "Page 12"],
                    ["Section 11: Programme Sensitivity - Best/Expected/Delay Case", "Page 13"],
                    ["Section 12: Monthly Target Revenue & Spend Outlay", "Page 16"],
                    ["Section 13: Monthly Cash Flow S-Curve", "Page 17"],
                    ["Section 14: Weekly Execution Plan (Weeks 1 to 36)", "Page 18"],
                    ["Section 15: Daily Execution Plan (Days 1 to 180)", "Page 22"],
                    ["Section 16: Commercial Risk Register & Mitigation", "Page 37"],
                    ["Section 17: Procurement & Supply Chain Strategy", "Page 40"],
                    ["Section 18: Resource & Crew Requirements Plan", "Page 41"],
                    ["Section 19: Health, Safety & QA/QC Checklists", "Page 43"],
                    ["Section 20: Payment Milestones & Deliverables", "Page 45"],
                ]
                story.append(build_table(toc_rows, [380, 120], font_size=8))
                story.append(PageBreak())

                # 3. EXECUTIVE SUMMARY
                story.append(Paragraph("<b>Executive Summary</b>", section_style))
                scope_line = (
                    f"{built_area_sqm:,.0f} m2 gross built area scope" if built_area_sqm > 0
                    else "Scope as measured/allowed in the attached Bill of Quantities"
                )
                exec_rows = [
                    ["Item", "Detail"],
                    ["Objective", f"Deliver {data.get('project_title', 'the contracted scope')} for {data.get('client_name', 'the client')} with controlled scope, phased procurement, weekly production targets, daily controls, and closeout documentation."],
                    ["Assumed product", f"{scope_line}, priced from the {len(items_list)}-line Bill of Quantities attached to this pack."],
                    ["Commercial result", f"Protected gross profit is ${profit_amount_f:,.2f}, equal to {profit_pct:.1f}% margin. Total contract value is ${grand_total_f:,.2f}."],
                    ["Programme result", f"{duration_weeks} weeks from mobilisation to closeout, assuming approved drawings, clear site access, stable material supply, and no abnormal ground conditions."],
                    ["Decision required", "Client must approve final design, finishes schedule, provisional sums, authority route, payment milestones, and variation control before construction starts."],
                ]
                story.append(build_table(exec_rows, [150, 350], font_size=8))
                story.append(PageBreak())

                # 4. ASSUMPTIONS & EXCLUSIONS
                story.append(Paragraph("<b>Core Assumptions and Exclusions</b>", section_style))
                ass_rows = [
                    ["Item", "Detail"],
                    ["Assumptions", "Normal soil bearing, no rock blasting, no contaminated material, no flood mitigation works beyond standard stormwater, uninterrupted client approvals, and imported finishes available within normal lead times."],
                    ["Exclusions", "Land purchase, professional design fees before construction appointment, finance charges, abnormal authority fees, borehole drilling, swimming pool, solar plant, generator, premium imported appliances beyond allowance, and client-initiated variations."],
                    ["Quality class", "Durable high-spec residential finish, not ultra-luxury. Finishes are controlled through allowances to protect the budget."],
                    ["Contract control", "Fixed-scope price with provisional sums and a controlled variation register. No margin changes without written authorization."],
                    ["Currency", "All values are USD values and should be revalidated against live supplier quotations before signature."],
                ]
                story.append(build_table(ass_rows, [150, 350], font_size=8))
                story.append(PageBreak())

                # 5. QUOTATION SUMMARY & CHART
                story.append(Paragraph("<b>Quotation Financial Summary</b>", section_style))
                summary_rows = [
                    ["Cost Element", "Amount", "Comment"],
                    ["Direct BOQ works", f"${float(data.get('direct_costs', 0)):,.2f}", "Trade packages and measured works"],
                    ["Preliminaries & General", f"${float(data.get('preliminaries', 0)):,.2f}", "Corporate mobilisation and site setups"],
                    ["Overheads", f"${float(data.get('overhead_amount', 0)):,.2f}", "Head office resource allocation"],
                    ["Contingency", f"${float(data.get('contingency_amount', 0)):,.2f}", "Held for measurable construction uncertainty"],
                    ["Protected profit", f"${profit_amount_f:,.2f}", f"{profit_pct:.1f}% margin on client contract value"],
                    ["Quotation total", f"${grand_total_f:,.2f}", "Client contract value"],
                ]
                story.append(build_table(summary_rows, [150, 100, 250], font_size=8))
                story.append(Spacer(1, 10))
                # Add BarChart
                story.append(BarChartFlowable(
                    ["Directs", "Prelims", "Overheads", "Contingency", "Profit"],
                    [direct_costs_f, float(data.get('preliminaries', 0)), float(data.get('overhead_amount', 0)), float(data.get('contingency_amount', 0)), profit_amount_f],
                    500, 150
                ))
                story.append(PageBreak())

                # 6. BOQ SUMMARY - real cost-component split from the calculator's own
                # direct_costs_breakdown when the BOQ items carry material/labour/
                # equipment/subcontractor rate detail; otherwise (a common case when
                # items only carry a flat rate) fall back to the highest-value real
                # line items instead of inventing a fixed 25/35/40% category split.
                story.append(Paragraph("<b>BOQ Section Totals Analysis</b>", section_style))

                def _pct_of_contract(v: float) -> str:
                    return f"{(v / grand_total_f * 100.0):.1f}%" if grand_total_f > 0 else "0.0%"

                cat_labels = [
                    ("Materials", "materials"), ("Labour", "labour"), ("Equipment / Plant", "equipment"),
                    ("Subcontractors", "subcontractors"), ("Transport", "transport"), ("Waste Allowance", "waste_allowance"),
                ]
                cat_values = [(label, float(cost_breakdown.get(key, 0))) for label, key in cat_labels]
                categorized_total = sum(v for _, v in cat_values)

                boq_totals = [["Section", "Amount", "% of Contract Value"],
                              ["Preliminaries", f"${float(data.get('preliminaries', 0)):,.2f}", _pct_of_contract(float(data.get('preliminaries', 0)))]]
                if categorized_total > 0:
                    for label, val in cat_values:
                        if val > 0:
                            boq_totals.append([label, f"${val:,.2f}", _pct_of_contract(val)])
                else:
                    top_items = sorted(items_list, key=lambda it: float(it.get("quantity", it.get("qty", 0))) * float(it.get("rate", 0)), reverse=True)[:8]
                    for it in top_items:
                        line_total = float(it.get("quantity", it.get("qty", 0))) * float(it.get("rate", 0))
                        boq_totals.append([str(it.get("description", "Item"))[:45], f"${line_total:,.2f}", _pct_of_contract(line_total)])
                boq_totals.append(["Protected Profit", f"${profit_amount_f:,.2f}", _pct_of_contract(profit_amount_f)])
                story.append(build_table(boq_totals, [200, 150, 150], font_size=8))
                story.append(PageBreak())

                # 7. DETAILED BOQ PAGES
                story.append(Paragraph("<b>Detailed Bill of Quantities Ledger</b>", section_style))
                boq_rows = [["Code", "Section", "Description", "Unit", "Qty", "Rate", "Total"]]
                for idx, item in enumerate(items_list):
                    qty = float(item.get("quantity", item.get("qty", 1)))
                    rate = float(item.get("rate", 0))
                    total = qty * rate
                    code = f"{(idx+1)//10}.{(idx+1)%10:02d}"
                    boq_rows.append([
                        code,
                        "Direct Works",
                        item.get("description", "Unspecified task"),
                        item.get("unit", "unit"),
                        f"{qty:,.2f}",
                        f"${rate:,.2f}",
                        f"${total:,.2f}",
                    ])
                story.append(build_table(boq_rows, [40, 70, 190, 40, 50, 50, 60], font_size=7))
                story.append(PageBreak())

                # 8. MARGIN PROTECTION
                story.append(Paragraph("<b>Margin Protection Control Sheet</b>", section_style))
                margin_rows = [
                    ["Control", "Value", "Rule"],
                    ["Client Contract Value", f"${float(data.get('grand_total', 0)):,.2f}", "This is the selling price ceiling agreed with the client."],
                    ["Protected Gross Profit", f"${float(data.get('profit_amount', 0)):,.2f}", "This is company profit. It must be protected before any discretionary upgrade is accepted."],
                    ["Maximum Internal Cost", f"${(float(data.get('grand_total', 0)) - float(data.get('profit_amount', 0))):,.2f}", "All labour, materials, subcontractors, plant, and prelims must stay below this."],
                    ["Direct Works Target", f"${float(data.get('direct_costs', 0)):,.2f}", "Measured BOQ delivery target after value engineering."],
                    ["Construction Contingency", f"${float(data.get('contingency_amount', 0)):,.2f}", "Used only for approved construction risk, not client upgrades."],
                ]
                story.append(build_table(margin_rows, [150, 100, 250], font_size=8))
                story.append(Spacer(1, 10))
                story.append(Paragraph("<i>Ruthless commercial rule: every requested upgrade, acceleration, rework, delay, scope clarification, or specification change must be priced before execution. Do not absorb client-driven costs inside contingency.</i>", body_style))
                story.append(PageBreak())

                # 9. MATERIALS targets - real highest-value BOQ line items, since we
                # have no actual supplier/lead-time data to attach to a fixed
                # concrete/cement/brick/rebar list that ignores the real project.
                story.append(Paragraph("<b>Highest-Value BOQ Line Items to Price-Lock First</b>", section_style))
                mat_rows = [["Description", "Unit", "Qty", "Rate", "Total Value", "% of Direct Costs"]]
                top_value_items = sorted(items_list, key=lambda it: float(it.get("quantity", it.get("qty", 0))) * float(it.get("rate", 0)), reverse=True)[:10]
                for it in top_value_items:
                    qty = float(it.get("quantity", it.get("qty", 0)))
                    rate = float(it.get("rate", 0))
                    line_total = qty * rate
                    mat_rows.append([
                        str(it.get("description", "Item"))[:45],
                        it.get("unit", "unit"),
                        f"{qty:,.2f}",
                        f"${rate:,.2f}",
                        f"${line_total:,.2f}",
                        f"{(line_total / direct_costs_f * 100.0):.1f}%" if direct_costs_f > 0 else "0.0%",
                    ])
                story.append(build_table(mat_rows, [170, 50, 60, 60, 80, 80], font_size=7))
                story.append(PageBreak())

                # 10. SUPPLIER RFQ CONTROLS
                story.append(Paragraph("<b>Supplier RFQ and Price-Fetch Matrix</b>", section_style))
                rfq_rows = [
                    ["Step", "Required Control", "Why It Protects Margin"],
                    ["1. Supplier Master", "Create approved supplier records with category, contacts, and tax registrations.", "Prevents buying from unverified suppliers who can fail quality."],
                    ["2. Three-Quote Rule", "Capture preferred, backup and challenger quotes for every critical package.", "Creates leverage and gives a replacement path if the first supplier fails."],
                    ["3. Live Price Fetch", "Pull prices from supplier portals/APIs; attach emailed PDFs to quote.", "Avoids stale rates. Every price must have a timestamp and source."],
                    ["4. Price Lock", "Convert accepted supplier quote to purchase order before quote expiry.", "Stops supplier escalation from silently eroding profit."],
                ]
                story.append(build_table(rfq_rows, [100, 200, 200], font_size=7))
                story.append(PageBreak())

                # 11. MATERIAL MARGIN CONTROLS BY PACKAGE
                story.append(Paragraph("<b>Material Margin Controls by Package</b>", section_style))
                ctrl_rows = [
                    ["Package", "Material", "Margin Control Protocol"],
                    ["Concrete", "Ready-mix concrete 25MPa", "Verify delivery note volume matches slump test density before offloading."],
                    ["Masonry", "Cement Bags (50kg)", "Store in watertight container; reconcile bags used daily against wall square meters."],
                    ["Steel", "Reinforcing rebar", "No cutting list release without engineer-approved shop drawings."],
                    ["Finishes", "Porcelain tiles", "Client upgrades are variations; select tile batches at once to avoid color mismatches."],
                ]
                story.append(build_table(ctrl_rows, [100, 150, 250], font_size=7))
                story.append(PageBreak())

                # 12. OPERATION STRATEGY
                story.append(Paragraph("<b>What Else Makes This Work Operationally</b>", section_style))
                op_rows = [
                    ["Mechanic", "Minimum System Requirement", "Failure If Missing"],
                    ["Supplier Quote Register", "Stores quote source, fetch date, expiry, and delivery cost.", "You cannot prove why a rate was used or recover price movements."],
                    ["Procurement Approval Workflow", "Blocks purchase orders above budget or expired quotes.", "Buying happens emotionally and margin disappears package by package."],
                    ["Variation Order Workflow", "Client upgrades or late decisions are signed before execution.", "Free work accumulates and the profit margin becomes fiction."],
                    ["Daily Cost Capture", "Foreman captures labour hours, material usage, and blockers daily.", "You cannot see which day started the loss."],
                ]
                story.append(build_table(op_rows, [130, 200, 170], font_size=7))
                story.append(PageBreak())

                # 13. SCHEDULE & MARGIN SENSITIVITY - a 3-point best/expected/delay
                # case built from this project's real duration and margin, not a fixed
                # 32/36/44-week, 16.5%/8.5% table. This is a sensitivity estimate, not
                # an actual simulated Monte Carlo run - labelled accordingly.
                story.append(Paragraph("<b>Programme Sensitivity - Best / Expected / Delay Case</b>", section_style))
                best_weeks = max(1, round(duration_weeks * 0.9))
                delay_weeks = max(duration_weeks + 1, round(duration_weeks * 1.25))
                best_profit = profit_amount_f * 1.1
                delay_profit = profit_amount_f * 0.7
                best_margin_pct = (best_profit / grand_total_f * 100.0) if grand_total_f > 0 else 0.0
                delay_margin_pct = (delay_profit / grand_total_f * 100.0) if grand_total_f > 0 else 0.0
                stress_rows = [
                    ["Scenario", "Duration", "Protected Profit", "Margin", "Assumptions"],
                    ["Best Case", f"{best_weeks} Weeks / {best_weeks * 5} Days", f"${best_profit:,.2f}", f"{best_margin_pct:.1f}%", "Fast approvals, stable weather, zero rework."],
                    ["Expected Case", f"{duration_weeks} Weeks / {duration_weeks * 5} Days", f"${profit_amount_f:,.2f}", f"{profit_pct:.1f}%", "Base quotation timeline. Normal lead times."],
                    ["Delay Case", f"{delay_weeks} Weeks / {delay_weeks * 5} Days", f"${delay_profit:,.2f}", f"{delay_margin_pct:.1f}%", "Late drawings, rain delays, unrecovered overhead burn."],
                ]
                story.append(build_table(stress_rows, [80, 120, 80, 60, 160], font_size=7))
                story.append(Paragraph("<i>Best/delay case profit figures are a +/-10%/30% sensitivity assumption applied to this quotation's real protected profit, not the output of a statistical simulation.</i>", body_style))
                story.append(PageBreak())

                # 14. DRIVER SIMULATION
                story.append(Paragraph("<b>Schedule Driver Simulation Matrix</b>", section_style))
                drv_rows = [
                    ["Driver", "Best Case", "Expected Case", "Delay Case", "Margin-Safe Response"],
                    ["Site Conditions", "Clean access, normal soil, no hidden lines.", "Minor ground adjustments absorbed.", "Rock or groundwater discovered.", "Stop, photograph, and price variation before digging."],
                    ["Weather", "Dry conditions during earthworks and roofing.", "Normal rain disruption within float.", "Heavy storms flood trenches.", "Weather diary, EOT notice, adjust sequencing."],
                    ["Client Decisions", "All selections made before week 1.", "Decisions match decision schedule.", "Late changes block orders.", "Issue time and cost variation order. No free acceleration."],
                ]
                story.append(build_table(drv_rows, [80, 100, 100, 100, 120], font_size=7))
                story.append(PageBreak())

                # 15. BASELINE weeks - phase boundaries scaled proportionally to the
                # real project_duration_weeks rather than a fixed 1-16 week range.
                story.append(Paragraph(f"<b>How the {duration_weeks}-Week Baseline Was Built</b>", section_style))
                phase_plan = [
                    ("Mobilisation & design freeze", 0.0, 0.11, "Allows contract setup, permits, safety plans, and long-lead orders before site risk starts."),
                    ("Groundworks and foundations", 0.11, 0.22, "Covers site clearance, bulk earthworks, foundation trenching, and rebar setups."),
                    ("Substructure & shell walls", 0.22, 0.36, "Covers slabs pouring, gables masonry, columns casting, and wall plate scaffolding."),
                    ("Roof and envelope dry-in", 0.36, 0.44, "Gets the building weather-tight so internal wet trades and cabinetry can begin safely."),
                ]
                base_rows = [["Phase", "Weeks", "Operational Logic"]]
                for name, start_frac, end_frac, logic in phase_plan:
                    wk_start = max(1, round(duration_weeks * start_frac) + 1)
                    wk_end = max(wk_start, round(duration_weeks * end_frac))
                    base_rows.append([name, f"Weeks {wk_start}-{wk_end}", logic])
                story.append(build_table(base_rows, [120, 80, 300], font_size=7))
                story.append(PageBreak())

                # 16 & 17. MONTHLY TARGETS + S-CURVE CHART - both driven by the same
                # SpendForecaster.generate_forecast() engine used elsewhere in this
                # module, so the curve is a genuine logistic S-curve of the real
                # direct costs (previously a flat grand_total*0.09 repeated 9 times).
                spend_forecast = SpendForecaster.generate_forecast(
                    items_list, project_duration_weeks=duration_weeks, profit_margin_pct=profit_pct,
                )
                monthly_cashflow = spend_forecast.get("monthly_cashflow", [])
                total_projected_spend = sum(m["projected_spend"] for m in monthly_cashflow) or 1.0

                story.append(Paragraph("<b>Monthly Targets, Spend and Protected Profit</b>", section_style))
                mon_rows = [["Month", "Target Deliverable", "Projected Spend", "Expected Billing", "Protected Profit"]]
                for m in monthly_cashflow:
                    month_profit_share = profit_amount_f * (m["projected_spend"] / total_projected_spend)
                    mon_rows.append([
                        m["month"],
                        f"Deliverables phase for {m['month']}",
                        f"${m['projected_spend']:,.2f}",
                        f"${m['expected_billing']:,.2f}",
                        f"${month_profit_share:,.2f}",
                    ])
                story.append(build_table(mon_rows, [50, 150, 100, 100, 100], font_size=7))
                story.append(PageBreak())

                story.append(Paragraph("<b>Monthly Cash Flow Curve</b>", section_style))
                story.append(Spacer(1, 10))
                story.append(BarChartFlowable(
                    [m["month"] for m in monthly_cashflow],
                    [m["projected_spend"] for m in monthly_cashflow],
                    500, 150
                ))
                story.append(PageBreak())

                # 18-21. WEEKLY EXECUTION - paginated dynamically over the real
                # duration_weeks (9 weeks per page) instead of 4 fixed pages
                # hardcoded to a 36-week programme.
                weekly_phase_plan = [
                    "Mobilisation / Site Setup", "Substructure Concrete",
                    "Superstructure Shell Walls", "Wet Trades & Finishes",
                ]
                weeks_per_page = 9
                num_weekly_pages = max(1, math.ceil(duration_weeks / weeks_per_page))
                for page_idx in range(num_weekly_pages):
                    wk_start = page_idx * weeks_per_page + 1
                    wk_end = min(duration_weeks, wk_start + weeks_per_page - 1)
                    phase_label = weekly_phase_plan[min(page_idx, len(weekly_phase_plan) - 1)]
                    story.append(Paragraph(f"<b>Weekly Execution Plan - Weeks {wk_start} to {wk_end}</b>", section_style))
                    wk_rows = [["Week", "Phase", "Activities & Targets", "Deliverables checklist"]]
                    for w in range(wk_start, wk_end + 1):
                        wk_rows.append([
                            f"Week {w}",
                            phase_label,
                            f"{phase_label} activities and RFI lockups for week {w}.",
                            f"Approved weekly report W{w}, inspection diary completed."
                        ])
                    story.append(build_table(wk_rows, [50, 100, 200, 150], font_size=7))
                    story.append(PageBreak())

                # 22. DAILY EXECUTION - paginated over the real total workdays
                # (duration_weeks * 5), 12 days per page, instead of a fixed 15
                # pages/180 days regardless of the actual programme length.
                total_days = duration_weeks * 5
                num_daily_pages = max(1, math.ceil(total_days / 12))
                for page_idx in range(num_daily_pages):
                    start_day = page_idx * 12 + 1
                    end_day = min(total_days, start_day + 11)
                    story.append(Paragraph(f"<b>Daily Execution Plan - Days {start_day} to {end_day}</b>", section_style))
                    day_rows = [["Day", "Week", "Hrs", "Phase", "Daily Site Activities & Target Rhythm", "Spend", "Profit"]]
                    for d in range(start_day, end_day + 1):
                        day_rows.append([
                            str(d),
                            str((d - 1) // 5 + 1),
                            "8.0",
                            "Production",
                            "Daily construction operations rhythm. Coordinate crews, check material levels, log site photos.",
                            f"${(direct_costs_f / total_days):,.2f}" if total_days else "$0.00",
                            f"${(profit_amount_f / total_days):,.2f}" if total_days else "$0.00",
                        ])
                    story.append(build_table(day_rows, [30, 30, 30, 60, 230, 60, 60], font_size=6.6))
                    story.append(PageBreak())

                # 37. RISK REGISTER
                story.append(Paragraph("<b>Commercial Risk Scenarios</b>", section_style))
                risk_rows = [
                    ["Risk Event", "Potential Margin Threat", "Mitigation Strategy"],
                    ["Abnormal Ground", "Rock or clay discovered requiring structural adjustments.", "Geotechnical pre-inspections; provisional sums reserved in the contract."],
                    ["Material Price Spikes", "Cement or steel inflation erosion.", "Lock supply agreements within 14 days of award. Reprice after quote expiry."],
                    ["Cashflow Delay", "Late client progress payments halts the site.", "Certified payment milestones, retention bounds, mobilization deposits."],
                ]
                story.append(build_table(risk_rows, [100, 200, 200], font_size=7))
                story.append(PageBreak())

                # 40. PROCUREMENT STRATEGY
                story.append(Paragraph("<b>Procurement &amp; Supply Chain Strategy</b>", section_style))
                proc_rows = [
                    ["Package Category", "Strategy &amp; Lead Times", "Preferred Logistics"],
                    ["Bulk Materials", "Order common bricks and cement weekly. Just-in-time storage.", "Local flatbed truck transport."],
                    ["Long-Lead Packages", "Aluminium windows, roof trusses, kitchen cabinetry ordered week 4.", "Direct fabricator dispatch with shop drawings freeze."],
                ]
                story.append(build_table(proc_rows, [100, 200, 200], font_size=7))
                story.append(PageBreak())

                # 41. RESOURCE PLAN
                story.append(Paragraph("<b>Resource &amp; Crew Requirements Plan</b>", section_style))
                res_rows = [
                    ["Role", "Allocation Level", "Responsibility"],
                    ["Site Agent / PM", "Full-time on site", "Overall program and cost tracking, RFI setups."],
                    ["Class 1 Bricklayers", "Crews of 4 tradesmen", "Lay masonry common clay bricks to target output."],
                    ["General Helpers", "Crews of 4 assistants", "Material supply run, cement mixing, site housekeeping."],
                ]
                story.append(build_table(res_rows, [100, 150, 250], font_size=7))
                story.append(PageBreak())

                # 43. HSE & QA
                story.append(Paragraph("<b>Health, Safety &amp; QA/QC Checklists</b>", section_style))
                safety_rows = [
                    ["Activity", "QA Quality Checks", "HSE Safety Requirements"],
                    ["Foundations Excavation", "Bearing test compaction check.", "Trench shoring, barrier tape setup."],
                    ["Concrete Pours", "Slump cylinder test, temperature records.", "PPE safety boots, glove wear, hydration."],
                    ["Masonry Walling", "Plumb line alignment, joint size check.", "Scaffolding levels guardrails verification."],
                ]
                story.append(build_table(safety_rows, [100, 200, 200], font_size=7))
                story.append(PageBreak())

                # 45. PAYMENT MILESTONES
                story.append(Paragraph("<b>Payment Milestones &amp; Deliverables</b>", section_style))
                pay_rows = [
                    ["Milestone Trigger", "Invoice Percentage", "Deliverables Checklist"],
                    ["1. Contract Mobilisation", "10%", "Design freeze register signed, insurance policy active."],
                    ["2. Substructure Concrete Complete", "20%", "Strip foundations poured, ground slab cured, test cubes certified."],
                    ["3. Superstructure Wallplate", "30%", "Superstructure brickwork laid, ring beams cast, structural checks signed."],
                    ["4. Roof Shell & Dry-in", "20%", "Roof sheeting complete, aluminium window frames glazed, building sealed."],
                    ["5. Practical Handover", "20%", "As-built manual delivered, occupation certificate, keys and snags closed."],
                ]
                story.append(build_table(pay_rows, [150, 100, 250], font_size=7))
                story.append(PageBreak())

                # 47. APPENDIX
                story.append(Paragraph("<b>Appendix - Data Summary</b>", section_style))
                app_rows = [
                    ["Metric Parameter", "Value Mapping"],
                    ["Total Cost Baseline", f"${direct_costs_f:,.2f}"],
                    ["Target Gross Profit Margin", f"${profit_amount_f:,.2f}"],
                    ["Contract Budget Ceiling", f"${grand_total_f:,.2f}"],
                    ["Weekly Plan Outlay Pages", f"{num_weekly_pages} Pages (Weeks 1 to {duration_weeks})"],
                    ["Daily Workday Actions Pages", f"{num_daily_pages} Pages (Days 1 to {total_days})"],
                ]
                story.append(build_table(app_rows, [200, 300], font_size=8))

                # Build Document using page header/footer
                doc.build(story, onFirstPage=page_header_footer, onLaterPages=page_header_footer)
                return True

            else:
                # STANDARD 2-PAGE QUOTATION
                story.append(Paragraph("SIX NINE CONSTRUCTION (PVT) LTD", title_style))
                story.append(
                    Paragraph(
                        f"<b>PROJECT:</b> {data.get('project_title', 'General Civil Infrastructure')}",
                        styles["Normal"],
                    )
                )
                story.append(
                    Paragraph(
                        f"<b>QUOTATION ID:</b> {data.get('quotation_id', 'SNC-QT-2026')} | <b>REVISION:</b> {data.get('revision_number', 1)}",
                        styles["Normal"],
                    )
                )
                story.append(
                    Paragraph(
                        f"<b>CLIENT:</b> {data.get('client_name', 'Corporate Customer')}",
                        styles["Normal"],
                    )
                )
                story.append(Spacer(1, 10))

                table_data = [
                    ["Item Description", "Unit", "Quantity", "Rate ($)", "Total ($)"]
                ]

                for item in data.get("items", []):
                    qty = float(item.get("quantity", item.get("qty", 0)))
                    rate = float(item.get("rate", 0))
                    total = qty * rate
                    table_data.append(
                        [
                            item.get("description", "Unspecified task"),
                            item.get("unit", "item"),
                            f"{qty:,.2f}",
                            f"{rate:,.2f}",
                            f"{total:,.2f}",
                        ]
                    )

                table_data.append(["", "", "", "Direct Costs:", f"${float(data.get('direct_costs', 0)):,.2f}"])
                table_data.append(["", "", "", "Preliminaries:", f"${float(data.get('preliminaries', 0)):,.2f}"])
                table_data.append(["", "", "", "Overheads:", f"${float(data.get('overhead_amount', 0)):,.2f}"])
                table_data.append(["", "", "", "Contingency:", f"${float(data.get('contingency_amount', 0)):,.2f}"])
                table_data.append(["", "", "", "Profit Margin:", f"${float(data.get('profit_amount', 0)):,.2f}"])
                table_data.append(["", "", "", "ZIMRA VAT:", f"${float(data.get('tax_amount', 0)):,.2f}"])
                table_data.append(["", "", "", "GRAND TOTAL:", f"${float(data.get('grand_total', 0)):,.2f}"])

                boq_table = Table(table_data, colWidths=[200, 50, 70, 100, 100])
                boq_table.setStyle(
                    TableStyle(
                        [
                            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0F172A")),
                            ("TEXTCOLOR", (0, 0), (-1, 0), colors.whitesmoke),
                            ("ALIGN", (0, 0), (-1, -1), "LEFT"),
                            ("ALIGN", (2, 0), (-1, -1), "RIGHT"),
                            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                            ("BOTTOMPADDING", (0, 0), (-1, 0), 6),
                            ("GRID", (0, 0), (-1, -8), 0.5, colors.HexColor("#CBD5E1")),
                            ("FONTNAME", (3, -7), (-1, -1), "Helvetica-Bold"),
                            ("LINEABOVE", (3, -7), (-1, -1), 1, colors.HexColor("#0F172A")),
                        ]
                    )
                )
                story.append(boq_table)
                story.append(Spacer(1, 10))

                assumptions = data.get("assumptions", [])
                exclusions = data.get("exclusions", [])

                if assumptions:
                    story.append(Paragraph("<b>Assumptions</b>", section_style))
                    for item in assumptions:
                        story.append(Paragraph(f"• {item}", body_style))
                    story.append(Spacer(1, 5))

                if exclusions:
                    story.append(Paragraph("<b>Exclusions</b>", section_style))
                    for item in exclusions:
                        story.append(Paragraph(f"• {item}", body_style))
                    story.append(Spacer(1, 5))

                audit_hash = data.get("audit_trail_hash", "N/A")
                story.append(Paragraph("<b>Audit Trail Signature</b>", section_style))
                story.append(Paragraph(f"Secure Checksum: {audit_hash}", body_style))

                def draw_watermark(canvas, doc_template):
                    canvas.saveState()
                    logo_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "assets", "logo.png"))
                    if os.path.exists(logo_path):
                        try:
                            canvas.setFillAlpha(0.15)
                        except AttributeError:
                            pass
                        canvas.drawImage(logo_path, x=147.6, y=270.9, width=300, height=300, preserveAspectRatio=True, mask='auto')
                    canvas.restoreState()

                doc.build(story, onFirstPage=draw_watermark, onLaterPages=draw_watermark)
                return True

        except ImportError:
            # Fallback
            logging.warning(
                "ReportLab not installed. Writing fallback text representation."
            )
            with open(output_path, "w", encoding="utf-8") as f:
                f.write("--- SIX NINE CONSTRUCTION QUOTATION ---\n")
                f.write(f"Quotation ID: {data.get('quotation_id')}\n")
                f.write(f"Revision: {data.get('revision_number')}\n")
                f.write(f"Project: {data.get('project_title')}\n")
                f.write(f"Client: {data.get('client_name')}\n")
                f.write(f"Grand Total: ${data.get('grand_total')}\n")
                f.write(f"Audit Trail Hash: {data.get('audit_trail_hash')}\n")
            return True


class QuotationExcelExporter(ExcelExporter):
    def export_to_excel(self, data: Dict[str, Any], output_path: str) -> bool:
        """
        Generates a richly formatted Excel worksheet.
        Falls back to CSV format if xlsxwriter/openpyxl are not present.
        """
        logging.info(f"Exporting Excel to {output_path}")
        try:
            import xlsxwriter

            workbook = xlsxwriter.Workbook(output_path)
            worksheet = workbook.add_worksheet("Quotation BOQ")

            # Branded Header Formats
            header_format = workbook.add_format(
                {
                    "bold": True,
                    "font_color": "white",
                    "bg_color": "#0F172A",
                    "border": 1,
                }
            )
            currency_format = workbook.add_format({"num_format": "$#,##0.00"})
            bold_format = workbook.add_format({"bold": True})

            # Title block
            worksheet.write(0, 0, "SIX NINE CONSTRUCTION (PVT) LTD", bold_format)
            worksheet.write(1, 0, f"Client: {data.get('client_name')}")
            worksheet.write(2, 0, f"Project: {data.get('project_title')}")
            worksheet.write(
                3,
                0,
                f"Quotation ID: {data.get('quotation_id')} | Revision: {data.get('revision_number', 1)}",
            )

            # Headers
            headers = ["Description", "Unit", "Quantity", "Rate", "Total"]
            for col, header in enumerate(headers):
                worksheet.write(5, col, header, header_format)

            # Write rows
            row = 6
            for item in data.get("items", []):
                qty = float(item.get("quantity", 0))
                rate = float(item.get("rate", 0))
                worksheet.write(row, 0, item.get("description", ""))
                worksheet.write(row, 1, item.get("unit", "m"))
                worksheet.write(row, 2, qty)
                worksheet.write(row, 3, rate, currency_format)
                # Excel formula for line item total
                worksheet.write_formula(
                    row, 4, f"=C{row + 1}*D{row + 1}", currency_format
                )
                row += 1

            # Totals Block
            worksheet.write(row, 3, "Direct Costs:", bold_format)
            worksheet.write(row, 4, float(data.get("direct_costs", 0)), currency_format)
            row += 1
            worksheet.write(row, 3, "Preliminaries:", bold_format)
            worksheet.write(
                row, 4, float(data.get("preliminaries", 0)), currency_format
            )
            row += 1
            worksheet.write(row, 3, "Overheads:", bold_format)
            worksheet.write(
                row, 4, float(data.get("overhead_amount", 0)), currency_format
            )
            row += 1
            worksheet.write(row, 3, "Contingency:", bold_format)
            worksheet.write(
                row, 4, float(data.get("contingency_amount", 0)), currency_format
            )
            row += 1
            worksheet.write(row, 3, "Profit Margin:", bold_format)
            worksheet.write(
                row, 4, float(data.get("profit_amount", 0)), currency_format
            )
            row += 1
            worksheet.write(row, 3, "Provisional Sums:", bold_format)
            worksheet.write(
                row, 4, float(data.get("provisional_sums", 0)), currency_format
            )
            row += 1
            worksheet.write(row, 3, "Discounts:", bold_format)
            worksheet.write(
                row, 4, float(data.get("discount_amount", 0)), currency_format
            )
            row += 1
            worksheet.write(row, 3, "ZIMRA VAT:", bold_format)
            worksheet.write(row, 4, float(data.get("tax_amount", 0)), currency_format)
            row += 1
            worksheet.write(row, 3, "GRAND TOTAL:", bold_format)
            worksheet.write(row, 4, float(data.get("grand_total", 0)), currency_format)

            # Write assumptions & exclusions below the totals block
            row += 2
            assumptions = data.get("assumptions", [])
            exclusions = data.get("exclusions", [])

            if assumptions:
                worksheet.write(row, 0, "Assumptions:", bold_format)
                row += 1
                for item in assumptions:
                    worksheet.write(row, 0, f"- {item}")
                    row += 1
                row += 1

            if exclusions:
                worksheet.write(row, 0, "Exclusions:", bold_format)
                row += 1
                for item in exclusions:
                    worksheet.write(row, 0, f"- {item}")
                    row += 1
                row += 1

            # Audit Signature
            worksheet.write(
                row, 0, "Audit Trail Hash (Pricing Integrity Key):", bold_format
            )
            worksheet.write(row, 1, data.get("audit_trail_hash", "N/A"))

            workbook.close()
            return True

        except ImportError:
            # Fallback CSV format
            logging.warning("xlsxwriter not installed. Exporting fallback CSV.")
            import csv

            with open(output_path, "w", newline="", encoding="utf-8") as f:
                writer = csv.writer(f)
                writer.writerow(["SIX NINE CONSTRUCTION (PVT) LTD"])
                writer.writerow(["Client", data.get("client_name")])
                writer.writerow(["Project", data.get("project_title")])
                writer.writerow(
                    [
                        "Quotation ID",
                        data.get("quotation_id"),
                        "Revision",
                        data.get("revision_number", 1),
                    ]
                )
                writer.writerow([])
                writer.writerow(["Description", "Unit", "Quantity", "Rate", "Total"])
                for item in data.get("items", []):
                    qty = float(item.get("quantity", 0))
                    rate = float(item.get("rate", 0))
                    writer.writerow(
                        [
                            item.get("description"),
                            item.get("unit"),
                            qty,
                            rate,
                            qty * rate,
                        ]
                    )
                writer.writerow(["Direct Costs", "", "", "", data.get("direct_costs")])
                writer.writerow(["Grand Total", "", "", "", data.get("grand_total")])
                writer.writerow(["Audit Trail Hash", data.get("audit_trail_hash")])
            return True


class PyMuPDFTextExtractor(TextExtractor):
    def extract_text(self, file_path: str) -> str:
        """Extracts text using PyMuPDF (fitz) or returns fallback file metadata."""
        logging.info(f"Extracting text from {file_path}")
        try:
            import fitz  # PyMuPDF

            doc = fitz.open(file_path)
            text = ""
            for page in doc:
                text += page.get_text()
            return text
        except ImportError:
            logging.warning(
                "PyMuPDF (fitz) not available. Returning file path metadata fallback."
            )
            return f"Metadata Fallback: Document located at {file_path}"


class CommercialControlPDFRenderer(DocumentRenderer):
    """Renders the CCB commercial control file: decision summary, KPIs, mandatory
    approvals, rate outliers, material demand, weekly spend guardrail, exception
    flags, and recorded MD/Commercial Manager overrides."""

    def render_pdf(self, data: Dict[str, Any], output_path: str) -> bool:
        logging.info(f"Rendering CCB control file PDF to {output_path}")
        try:
            from reportlab.lib.pagesizes import A4
            from reportlab.platypus import (
                SimpleDocTemplate,
                Paragraph,
                Spacer,
                Table,
                TableStyle,
            )
            from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle

            currency = data.get("currency", "USD")

            def money(value: Any) -> str:
                try:
                    return f"{currency} {float(value):,.2f}"
                except (TypeError, ValueError):
                    return f"{currency} 0.00"

            doc = SimpleDocTemplate(
                output_path,
                pagesize=A4,
                rightMargin=36,
                leftMargin=36,
                topMargin=54,
                bottomMargin=45,
            )
            styles = getSampleStyleSheet()
            title_style = ParagraphStyle(
                name="CCBTitle", parent=styles["Heading1"],
                textColor=colors.HexColor("#0F172A"), fontSize=18, spaceAfter=6,
            )
            section_style = ParagraphStyle(
                name="CCBSection", parent=styles["Heading2"],
                textColor=colors.HexColor("#1E293B"), fontSize=12, spaceBefore=14, spaceAfter=6,
            )
            body_style = ParagraphStyle(
                name="CCBBody", parent=styles["Normal"], fontSize=9,
                textColor=colors.HexColor("#334155"), spaceAfter=4,
            )
            cell_style = ParagraphStyle(
                name="CCBCell", parent=styles["Normal"], fontSize=7.5, leading=9.5,
                textColor=colors.HexColor("#0F172A"),
            )

            def page_header_footer(canvas, doc_obj):
                canvas.saveState()
                width, height = A4
                canvas.setFillColor(colors.HexColor("#0F172A"))
                canvas.rect(0, height - 42, width, 42, fill=1, stroke=0)
                canvas.setFillColor(colors.white)
                canvas.setFont("Helvetica-Bold", 8)
                canvas.drawString(36, height - 24, "COMMERCIAL CONTROL BRAIN — CONTROL FILE")
                canvas.setFont("Helvetica", 7)
                canvas.drawRightString(width - 36, height - 24, f"{data.get('quotation_id', 'CCB')} | Page {doc_obj.page}")
                canvas.setFillColor(colors.HexColor("#475569"))
                canvas.setFont("Helvetica", 6.5)
                canvas.drawString(36, 20, "Generated by the Quotation Intelligence Engine — for MD/Commercial Manager review.")
                canvas.restoreState()

            def build_table(rows, col_widths, header=True, font_size=7.5):
                formatted = [
                    [Paragraph(str(cell), cell_style) for cell in row]
                    for row in rows
                ]
                t = Table(formatted, colWidths=col_widths)
                commands = [
                    ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#CBD5E1")),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
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

            story = []
            story.append(Paragraph(data.get("project_title", "Construction Project"), title_style))
            story.append(Paragraph(
                f"{data.get('quotation_id', '')} | {data.get('client_name', 'Unassigned client')}",
                body_style,
            ))
            story.append(Paragraph(f"<b>Decision:</b> {data.get('recommendation', 'No evaluation available.')}", body_style))
            story.append(Spacer(1, 8))

            metrics = data.get("metrics", {})
            story.append(build_table([
                ["Metric", "Value"],
                ["Worthiness score", f"{data.get('worthiness_score', 0)}/100 ({data.get('worthiness_rating', 'N/A')})"],
                ["Target selling price", money(metrics.get("target_selling_price"))],
                ["Total direct costs", money(metrics.get("total_direct_costs"))],
                ["Protected profit", money(metrics.get("protected_profit_amount"))],
                ["Protected margin", f"{float(metrics.get('protected_margin_pct', 0)):.1f}%"],
                ["Cost / built sqm", money(metrics.get("cost_per_built_sqm"))],
                ["Project duration", f"{metrics.get('project_duration_weeks', 0)} weeks"],
            ], [180, 320]))

            approvals = data.get("mandatory_approvals") or []
            story.append(Paragraph("Mandatory Approvals", section_style))
            if approvals:
                story.append(build_table([["Approval required"]] + [[a] for a in approvals], [500]))
            else:
                story.append(Paragraph("None recorded.", body_style))

            outliers = data.get("rate_outlier_details") or []
            if outliers:
                story.append(Paragraph("Rate Outliers", section_style))
                rows = [["Item", "Proposed rate", "Recommendation"]]
                for item in outliers[:20]:
                    rows.append([
                        item.get("description") or item.get("item_code", "Item"),
                        money(item.get("proposed_rate")),
                        item.get("recommendation", ""),
                    ])
                story.append(build_table(rows, [140, 80, 280]))

            material_plan = data.get("material_plan") or []
            if material_plan:
                story.append(Paragraph("Material Demand", section_style))
                rows = [["Material", "Assembly", "Qty (w/ waste)", "Cost"]]
                for item in material_plan[:25]:
                    rows.append([
                        item.get("material", ""),
                        item.get("assembly", ""),
                        f"{item.get('total_quantity_with_waste', 0):,.2f} {item.get('unit', '')}",
                        money(item.get("total_cost")),
                    ])
                story.append(build_table(rows, [160, 140, 120, 80]))

            weekly_plan = data.get("weekly_cost_plan") or []
            if weekly_plan:
                story.append(Paragraph("Weekly Spend Guardrail", section_style))
                rows = [["Week", "Spend", "Cumulative"]]
                for week in weekly_plan[:20]:
                    rows.append([
                        str(week.get("week_number", "")),
                        money(week.get("weekly_spend")),
                        money(week.get("cumulative_spend")),
                    ])
                story.append(build_table(rows, [80, 210, 210]))

            flags = data.get("flags") or []
            story.append(Paragraph("Commercial Exceptions", section_style))
            if flags:
                rows = [["Severity", "Title", "Detail", "Required action"]]
                for flag in flags[:30]:
                    rows.append([
                        str(flag.get("severity", "")).upper(),
                        flag.get("title", ""),
                        flag.get("detail", ""),
                        flag.get("action", ""),
                    ])
                story.append(build_table(rows, [55, 110, 210, 125]))
            else:
                story.append(Paragraph("No commercial exceptions detected.", body_style))

            overrides = data.get("overrides") or []
            if overrides:
                story.append(Paragraph("Recorded Overrides", section_style))
                rows = [["Flag", "Approver role", "Approved at", "Notes"]]
                for override in overrides[:20]:
                    rows.append([
                        override.get("flag_title", ""),
                        override.get("approver_role", ""),
                        str(override.get("approved_at", ""))[:19],
                        override.get("notes", ""),
                    ])
                story.append(build_table(rows, [110, 90, 110, 190]))

            doc.build(story, onFirstPage=page_header_footer, onLaterPages=page_header_footer)
            return True
        except ImportError:
            logging.warning("ReportLab not available. Writing plain text fallback for CCB control file.")
            with open(output_path, "w", encoding="utf-8") as fallback:
                fallback.write(f"COMMERCIAL CONTROL FILE\n{data.get('project_title', '')}\n{data.get('recommendation', '')}\n")
            return True


class PyMuPDFMergeService(PDFMergeService):
    def merge_pdfs(self, pdf_paths: List[str], output_path: str) -> bool:
        """Merges multiple PDFs using PyMuPDF."""
        logging.info(f"Merging PDFs: {pdf_paths} into {output_path}")
        try:
            import fitz

            result = fitz.open()
            for pdf_path in pdf_paths:
                if os.path.exists(pdf_path):
                    with fitz.open(pdf_path) as doc:
                        result.insert_pdf(doc)
            result.save(output_path)
            return True
        except ImportError:
            logging.warning(
                "PyMuPDF not available. Concatenating fallback text representations."
            )
            with open(output_path, "w", encoding="utf-8") as f_out:
                for pdf_path in pdf_paths:
                    if os.path.exists(pdf_path):
                        with open(pdf_path, "r", errors="ignore") as f_in:
                            f_out.write(f_in.read())
                            f_out.write("\n--- PAGE BREAK ---\n")
            return True
