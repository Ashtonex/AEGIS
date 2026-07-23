import os
import logging
from typing import Dict, Any, List
from reportlab.lib import colors
from reportlab.platypus import Flowable
from app.services.documents.interfaces import (
    DocumentRenderer,
    ExcelExporter,
    TextExtractor,
    PDFMergeService,
)


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
                story.append(Paragraph(f"Client budget: USD {float(data.get('grand_total', 0)):,.2f} | 15% protected margin | 36-week programme", styles["CoverSub"]))
                story.append(Paragraph(f"Project Reference ID: {data.get('quotation_id', 'SNC-HOUSE-500K')}", styles["CoverSub"]))
                story.append(Spacer(1, 50))
                
                story.append(build_table([
                    ["Prepared For", data.get("client_name", "Corporate Client")],
                    ["Project Name", data.get("project_title", "Private Residence Construction Design")],
                    ["Target Budget", f"${float(data.get('grand_total', 0)):,.2f}"],
                    ["Project Duration", "36 Weeks / 180 Workdays"],
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
                    ["Section 11: Monte Carlo Schedule Stress Test", "Page 13"],
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
                exec_rows = [
                    ["Item", "Detail"],
                    ["Objective", "Simulate how a client with a USD 500,000 budget can deliver a complete private residence with controlled scope, phased procurement, weekly production targets, daily controls, and closeout documentation."],
                    ["Assumed product", "Turnkey 4-bedroom high-spec residence, approximately 400-430 m2 gross built area, with garage, external works, basic landscaping, MEP systems, security/data rough-in, and quality-controlled handover."],
                    ["Commercial result", f"Protected gross profit is ${float(data.get('profit_amount', 0)):,.2f}, equal to {data.get('profit_pct', 12)}% margin. Total contract budget is ${float(data.get('grand_total', 0)):,.2f}."],
                    ["Programme result", "36 weeks from mobilisation to closeout, assuming approved drawings, clear site access, stable material supply, and no abnormal ground conditions."],
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
                    ["Protected profit", f"${float(data.get('profit_amount', 0)):,.2f}", f"{data.get('profit_pct', 12)}% margin on client contract value"],
                    ["Quotation total", f"${float(data.get('grand_total', 0)):,.2f}", "Client contract value"],
                ]
                story.append(build_table(summary_rows, [150, 100, 250], font_size=8))
                story.append(Spacer(1, 10))
                # Add BarChart
                story.append(BarChartFlowable(
                    ["Directs", "Prelims", "Overheads", "Contingency", "Profit"],
                    [float(data.get('direct_costs', 0)), float(data.get('preliminaries', 0)), float(data.get('overhead_amount', 0)), float(data.get('contingency_amount', 0)), float(data.get('profit_amount', 0))],
                    500, 150
                ))
                story.append(PageBreak())

                # 6. BOQ SUMMARY
                story.append(Paragraph("<b>BOQ Section Totals Analysis</b>", section_style))
                boq_totals = [
                    ["Section", "Amount", "% of Budget"],
                    ["Preliminaries", f"${float(data.get('preliminaries', 0)):,.2f}", "3.7%"],
                    ["Earthworks & Substructures", f"${(float(data.get('direct_costs', 0)) * 0.25):,.2f}", "25.0%"],
                    ["Superstructure Masonry & Shell", f"${(float(data.get('direct_costs', 0)) * 0.35):,.2f}", "35.0%"],
                    ["Finishes & MEP Services", f"${(float(data.get('direct_costs', 0)) * 0.40):,.2f}", "40.0%"],
                    ["Protected Profit", f"${float(data.get('profit_amount', 0)):,.2f}", f"{data.get('profit_pct', 12)}.0%"],
                ]
                story.append(build_table(boq_totals, [200, 150, 150], font_size=8))
                story.append(PageBreak())

                # 7. DETAILED BOQ PAGES
                story.append(Paragraph("<b>Detailed Bill of Quantities Ledger</b>", section_style))
                boq_rows = [["Code", "Section", "Description", "Unit", "Qty", "Rate", "Total"]]
                for idx, item in enumerate(data.get("items", [])):
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

                # 9. MATERIALS targets
                story.append(Paragraph("<b>Required Materials and Supplier Price Targets</b>", section_style))
                mat_rows = [
                    ["Package", "Material", "Qty", "Target Rate", "Preferred Supplier", "Lead Time", "Order Week"],
                    ["Concrete", "Ready-mix concrete 25MPa", "175 m3", "$112.00", "Batch Plant A", "5 Days", "Week 4"],
                    ["Masonry", "Cement Bags (50kg)", "1,850 bags", "$8.25", "Cement Dist A", "5 Days", "Week 5"],
                    ["Masonry", "Common Clay Bricks", "62,000 pcs", "$0.12", "Brick Supplier A", "7 Days", "Week 4"],
                    ["Steel", "Reinforcement rebar Y20", "18 Ton", "$980.00", "Steel Supplier A", "10 Days", "Week 3"],
                ]
                story.append(build_table(mat_rows, [80, 120, 70, 70, 100, 30, 30], font_size=7))
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

                # 13. MONTE CARLO STRESS TEST
                story.append(Paragraph("<b>Programme Stress Test - Monte Carlo Schedule Risk</b>", section_style))
                stress_rows = [
                    ["Scenario", "Duration", "Protected Profit", "Margin", "Assumptions"],
                    ["Best Case", "32 Weeks / 160 Days", f"${(float(data.get('profit_amount', 0)) * 1.1):,.2f}", "16.5%", "Fast approvals, stable weather, zero rework."],
                    ["Expected Case", "36 Weeks / 180 Days", f"${float(data.get('profit_amount', 0)):,.2f}", f"{data.get('profit_pct', 12)}.0%", "Base quotation timeline. Normal lead times."],
                    ["Delay Case", "44 Weeks / 220 Days", f"${(float(data.get('profit_amount', 0)) * 0.7):,.2f}", "8.5%", "Late drawings, rain delays, unrecovered overhead burn."],
                ]
                story.append(build_table(stress_rows, [80, 120, 80, 60, 160], font_size=7))
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

                # 15. BASELINE weeks
                story.append(Paragraph("<b>How the 36-Week Baseline Was Built</b>", section_style))
                base_rows = [
                    ["Phase", "Weeks", "Operational Logic"],
                    ["Mobilisation & design freeze", "Weeks 1-4", "Allows contract setup, permits, safety plans, and long-lead orders before site risk starts."],
                    ["Groundworks and foundations", "Weeks 5-8", "Covers site clearance, bulk earthworks, foundation trenching, and rebar setups."],
                    ["Substructure & shell walls", "Weeks 9-13", "Covers slabs pouring, gables masonry, columns casting, and wall plate scaffolding."],
                    ["Roof and envelope dry-in", "Weeks 14-16", "Gets the building weather-tight so internal wet trades and cabinetry can begin safely."],
                ]
                story.append(build_table(base_rows, [120, 80, 300], font_size=7))
                story.append(PageBreak())

                # 16. MONTHLY TARGETS
                story.append(Paragraph("<b>Monthly Targets, Spend and Protected Profit</b>", section_style))
                mon_rows = [["Month", "Target Deliverable", "Spend Ceiling", "Planned Revenue", "Protected Profit"]]
                for i in range(1, 10):
                    mon_rows.append([
                        f"Month {i}",
                        f"Deliverables phase for M{i}",
                        f"${(float(data.get('grand_total', 0)) * 0.09):,.2f}",
                        f"${(float(data.get('grand_total', 0)) * 0.11):,.2f}",
                        f"${(float(data.get('profit_amount', 0)) * 0.11):,.2f}",
                    ])
                story.append(build_table(mon_rows, [50, 150, 100, 100, 100], font_size=7))
                story.append(PageBreak())

                # 17. S-CURVE CHART
                story.append(Paragraph("<b>Monthly Cash Flow Curve</b>", section_style))
                story.append(Spacer(1, 10))
                # Add S-Curve BarChart
                story.append(BarChartFlowable(
                    [f"M{i}" for i in range(1, 10)],
                    [float(data.get('grand_total', 0)) * 0.09 for _ in range(1, 10)],
                    500, 150
                ))
                story.append(PageBreak())

                # 18. WEEKLY EXECUTION
                story.append(Paragraph("<b>Weekly Execution Plan - Weeks 1 to 9</b>", section_style))
                wk_rows = [["Week", "Phase", "Activities & Targets", "Deliverables checklist"]]
                for w in range(1, 10):
                    wk_rows.append([
                        f"Week {w}",
                        "Mobilisation / Site Setup",
                        f"Detailed site clearing, setting out, RFI lockups for week {w}.",
                        f"Approved weekly report W{w}, inspection diary completed."
                    ])
                story.append(build_table(wk_rows, [50, 100, 200, 150], font_size=7))
                story.append(PageBreak())

                # 19. WEEKLY EXECUTION 10-18
                story.append(Paragraph("<b>Weekly Execution Plan - Weeks 10 to 18</b>", section_style))
                wk_rows2 = [["Week", "Phase", "Activities & Targets", "Deliverables checklist"]]
                for w in range(10, 19):
                    wk_rows2.append([
                        f"Week {w}",
                        "Substructure Concrete",
                        f"Reinforcement fixing, formwork setups, ready-mix batch checks week {w}.",
                        f"Concrete cube tests results logged, slump test certifications."
                    ])
                story.append(build_table(wk_rows2, [50, 100, 200, 150], font_size=7))
                story.append(PageBreak())

                # 20. WEEKLY EXECUTION 19-27
                story.append(Paragraph("<b>Weekly Execution Plan - Weeks 19 to 27</b>", section_style))
                wk_rows3 = [["Week", "Phase", "Activities & Targets", "Deliverables checklist"]]
                for w in range(19, 28):
                    wk_rows3.append([
                        f"Week {w}",
                        "Superstructure Shell Walls",
                        f"Masonry blockwork, lintel pouring, brick force setup week {w}.",
                        f"Wall plate level inspection, joint size compliance checks."
                    ])
                story.append(build_table(wk_rows3, [50, 100, 200, 150], font_size=7))
                story.append(PageBreak())

                # 21. WEEKLY EXECUTION 28-36
                story.append(Paragraph("<b>Weekly Execution Plan - Weeks 28 to 36</b>", section_style))
                wk_rows4 = [["Week", "Phase", "Activities & Targets", "Deliverables checklist"]]
                for w in range(28, 37):
                    wk_rows4.append([
                        f"Week {w}",
                        "Wet Trades & Finishes",
                        f"Ceiling installation, first coat painting, cabinetry manufacture week {w}.",
                        f"Tiling substrate check, plaster level certification logged."
                    ])
                story.append(build_table(wk_rows4, [50, 100, 200, 150], font_size=7))
                story.append(PageBreak())

                # 22. DAILY EXECUTION (Days 1 to 180) - Compress to 15 pages (12 days per page)
                # To make it exactly 15 pages of daily plans matching the template:
                for page_idx in range(15):
                    start_day = page_idx * 12 + 1
                    end_day = start_day + 11
                    story.append(Paragraph(f"<b>Daily Execution Plan - Days {start_day} to {end_day}</b>", section_style))
                    day_rows = [["Day", "Week", "Hrs", "Phase", "Daily Site Activities & Target Rhythm", "Spend", "Profit"]]
                    for d in range(start_day, end_day + 1):
                        day_rows.append([
                            str(d),
                            str((d-1)//5 + 1),
                            "8.0",
                            "Production",
                            f"Daily construction operations rhythm. Coordinate crews, check material levels, log site photos.",
                            f"${(float(data.get('direct_costs', 0)) / 180):,.2f}",
                            f"${(float(data.get('profit_amount', 0)) / 180):,.2f}",
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
                story.append(Paragraph("<b>Appendix - Simulation Data Summary</b>", section_style))
                app_rows = [
                    ["Metric Parameter", "Value Mapping"],
                    ["Total Cost Baseline", f"${float(data.get('direct_costs', 0)):,.2f}"],
                    ["Target Gross Profit Margin", f"${float(data.get('profit_amount', 0)):,.2f}"],
                    ["Contract Budget Ceiling", f"${float(data.get('grand_total', 0)):,.2f}"],
                    ["Weekly Plan Outlay Pages", "4 Pages (Weeks 1 to 36)"],
                    ["Daily Workday Actions Pages", "15 Pages (Days 1 to 180)"],
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
