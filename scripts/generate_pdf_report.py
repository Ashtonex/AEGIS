import os
import sys
from datetime import datetime
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.lib.units import inch
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether, HRFlowable
)
from reportlab.pdfgen import canvas

class NumberedCanvas(canvas.Canvas):
    def __init__(self, *args, **kwargs):
        super(NumberedCanvas, self).__init__(*args, **kwargs)
        self._saved_page_states = []

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        num_pages = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self.draw_page_number(num_pages)
            canvas.Canvas.showPage(self)
        canvas.Canvas.save(self)

    def draw_page_number(self, page_count):
        self.saveState()
        self.setFont("Helvetica", 8)
        self.setFillColor(colors.HexColor("#64748B"))
        
        # Header line & text on subsequent pages
        if self._pageNumber > 1:
            self.drawString(36, 756, "AEGIS Enterprise System — Daily Audit & User Activity Log")
            self.drawRightString(576, 756, "Date: 10 September 2026")
            self.setStrokeColor(colors.HexColor("#E2E8F0"))
            self.setLineWidth(0.5)
            self.line(36, 750, 576, 750)
            
        # Footer
        self.setStrokeColor(colors.HexColor("#E2E8F0"))
        self.setLineWidth(0.5)
        self.line(36, 45, 576, 45)
        self.drawString(36, 32, "Confidential — AEGIS Internal System Audit Log")
        page_text = f"Page {self._pageNumber} of {page_count}"
        self.drawRightString(576, 32, page_text)
        self.restoreState()

def build_pdf(desktop_path):
    pdf_filename = os.path.join(desktop_path, "AEGIS_User_Activity_Log_2026-09-10.pdf")
    doc = SimpleDocTemplate(
        pdf_filename,
        pagesize=letter,
        leftMargin=36,
        rightMargin=36,
        topMargin=54,
        bottomMargin=54
    )

    styles = getSampleStyleSheet()
    
    # Custom Palette
    c_primary = colors.HexColor("#0F172A")    # Deep Slate / Navy
    c_secondary = colors.HexColor("#1E293B")  # Dark Slate
    c_accent = colors.HexColor("#0284C7")     # Blue / Teal
    c_success = colors.HexColor("#059669")    # Green
    c_warning = colors.HexColor("#D97706")    # Amber
    c_bg_light = colors.HexColor("#F8FAFC")   # Light Slate
    c_border = colors.HexColor("#CBD5E1")     # Slate Border
    c_text = colors.HexColor("#1E293B")       # Main text

    # Styles
    title_style = ParagraphStyle(
        'DocTitle',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=20,
        leading=24,
        textColor=c_primary
    )
    subtitle_style = ParagraphStyle(
        'DocSubtitle',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=10,
        leading=14,
        textColor=colors.HexColor("#64748B")
    )
    h1_style = ParagraphStyle(
        'Heading1_Custom',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=13,
        leading=17,
        textColor=c_secondary,
        spaceBefore=12,
        spaceAfter=6
    )
    h2_style = ParagraphStyle(
        'Heading2_Custom',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=10.5,
        leading=14,
        textColor=c_accent,
        spaceBefore=8,
        spaceAfter=4
    )
    body_style = ParagraphStyle(
        'Body_Custom',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=8.5,
        leading=12,
        textColor=c_text
    )
    bold_style = ParagraphStyle(
        'Bold_Custom',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=8.5,
        leading=12,
        textColor=c_text
    )
    tag_green = ParagraphStyle(
        'TagGreen',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=8,
        leading=10,
        textColor=c_success
    )
    tag_muted = ParagraphStyle(
        'TagMuted',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=8,
        leading=10,
        textColor=colors.HexColor("#64748B")
    )
    table_cell = ParagraphStyle(
        'TableCell',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=8,
        leading=10,
        textColor=c_text
    )
    table_cell_bold = ParagraphStyle(
        'TableCellBold',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=8,
        leading=10,
        textColor=c_text
    )
    table_header = ParagraphStyle(
        'TableHeader',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=8,
        leading=10,
        textColor=colors.white
    )

    story = []

    # Title & Metadata Header
    story.append(Paragraph("AEGIS Enterprise System", ParagraphStyle('SuperTitle', fontName='Helvetica-Bold', fontSize=10, leading=12, textColor=c_accent)))
    story.append(Spacer(1, 2))
    story.append(Paragraph("System Audit & User Activity Log", title_style))
    story.append(Spacer(1, 3))
    story.append(Paragraph("<b>Report Date:</b> Thursday, September 10, 2026 &nbsp;|&nbsp; <b>Timezone:</b> UTC (CAT / UTC+2 referenced) &nbsp;|&nbsp; <b>Environment:</b> Production (AEGIS_SNC)", subtitle_style))
    story.append(Spacer(1, 10))
    story.append(HRFlowable(width="100%", thickness=1.5, color=c_accent, spaceBefore=2, spaceAfter=12))

    # KPI Summary Cards (Table)
    kpi_data = [
        [
            Paragraph("<font size=16><b>28</b></font><br/><font color='#64748B' size=7.5>TOTAL USERS</font>", styles['Normal']),
            Paragraph("<font size=16 color='#0284C7'><b>3</b></font><br/><font color='#64748B' size=7.5>INTERACTIVE LOGINS</font>", styles['Normal']),
            Paragraph("<font size=16 color='#059669'><b>3</b></font><br/><font color='#64748B' size=7.5>ACTIVE WRITE OPERATORS</font>", styles['Normal']),
            Paragraph("<font size=16 color='#D97706'><b>1</b></font><br/><font color='#64748B' size=7.5>FILE UPLOADED</font>", styles['Normal']),
            Paragraph("<font size=16><b>85</b></font><br/><font color='#64748B' size=7.5>SYSTEM AUDIT ACTIONS</font>", styles['Normal']),
        ]
    ]
    kpi_table = Table(kpi_data, colWidths=[108]*5)
    kpi_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), colors.HexColor("#F1F5F9")),
        ('ALIGN', (0,0), (-1,-1), 'CENTER'),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('BOX', (0,0), (-1,-1), 0.5, c_border),
        ('INNERGRID', (0,0), (-1,-1), 0.5, colors.HexColor("#E2E8F0")),
        ('TOPPADDING', (0,0), (-1,-1), 8),
        ('BOTTOMPADDING', (0,0), (-1,-1), 8),
    ]))
    story.append(kpi_table)
    story.append(Spacer(1, 14))

    # SECTION 1: Who Logged In Today
    story.append(Paragraph("1. Interactive Logins Today (New Sign-In Sessions)", h1_style))
    story.append(Paragraph("Users who initiated a fresh authenticated sign-in session today (September 10, 2026):", body_style))
    story.append(Spacer(1, 6))

    login_headers = [
        Paragraph("User Name", table_header),
        Paragraph("Email Address", table_header),
        Paragraph("System Role", table_header),
        Paragraph("Login Timestamp (UTC)", table_header),
        Paragraph("Login Timestamp (Local CAT)", table_header)
    ]
    login_rows = [
        login_headers,
        [
            Paragraph("<b>Ekow Imbeah</b>", table_cell),
            Paragraph("ekow@sixnineconstruction.com", table_cell),
            Paragraph("CRM Associate", table_cell),
            Paragraph("2026-09-10 09:50:44 UTC", table_cell),
            Paragraph("11:50:44 CAT (UTC+2)", table_cell_bold),
        ],
        [
            Paragraph("<b>Mcdonald Kamutembere</b>", table_cell),
            Paragraph("mcdonald@sixnineconstruction.com", table_cell),
            Paragraph("CRM Associate", table_cell),
            Paragraph("2026-09-10 09:54:28 UTC", table_cell),
            Paragraph("11:54:28 CAT (UTC+2)", table_cell_bold),
        ],
        [
            Paragraph("<b>Ashton (Admin)</b>", table_cell),
            Paragraph("ashton@admin.com", table_cell),
            Paragraph("Executive (Admin)", table_cell),
            Paragraph("2026-09-10 19:52:44 UTC", table_cell),
            Paragraph("21:52:44 CAT (UTC+2)", table_cell_bold),
        ]
    ]
    login_table = Table(login_rows, colWidths=[105, 150, 95, 100, 90])
    login_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), c_primary),
        ('ALIGN', (0,0), (-1,-1), 'LEFT'),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('BOX', (0,0), (-1,-1), 0.5, c_border),
        ('INNERGRID', (0,0), (-1,-1), 0.5, colors.HexColor("#E2E8F0")),
        ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, c_bg_light]),
        ('TOPPADDING', (0,0), (-1,-1), 5),
        ('BOTTOMPADDING', (0,0), (-1,-1), 5),
        ('LEFTPADDING', (0,0), (-1,-1), 6),
        ('RIGHTPADDING', (0,0), (-1,-1), 6),
    ]))
    story.append(login_table)
    story.append(Spacer(1, 14))

    # SECTION 2: Files Uploaded Today (SPECIAL HIGHLIGHT)
    story.append(Paragraph("2. Files & Documents Uploaded Today", h1_style))
    story.append(Paragraph("Full forensic details of any documents uploaded into AEGIS storage or document records today:", body_style))
    story.append(Spacer(1, 6))

    upload_box_data = [
        [
            Paragraph("<b>DOCUMENT TITLE</b>", table_cell_bold),
            Paragraph("FOUNDATION COLLEGE JUNIOR SCHOOL VERANDAH QUOTATION.xlsx", table_cell_bold)
        ],
        [
            Paragraph("<b>Original File Name</b>", table_cell),
            Paragraph("<code>FOUNDATION COLLEGE JUNIOR SCHOOL VERANDAH QUOTATION.xlsx</code>", table_cell)
        ],
        [
            Paragraph("<b>File Format / MIME</b>", table_cell),
            Paragraph("Microsoft Excel OpenXML (.xlsx) &nbsp;|&nbsp; <code>application/vnd.openxmlformats-officedocument.spreadsheetml.sheet</code>", table_cell)
        ],
        [
            Paragraph("<b>File Size</b>", table_cell),
            Paragraph("<b>60,960 Bytes</b> (~59.53 KB)", table_cell)
        ],
        [
            Paragraph("<b>Uploaded By</b>", table_cell),
            Paragraph("<b>Talent Makurumidze</b> &lt;talent@sixnineconstruction.com&gt; &nbsp;(Role: CRM Associate)", table_cell)
        ],
        [
            Paragraph("<b>Upload Timestamp</b>", table_cell),
            Paragraph("<b>2026-09-10 06:50:10 UTC</b> (Storage) &nbsp;|&nbsp; <b>08:50:32 CAT (Local Time)</b>", table_cell)
        ],
        [
            Paragraph("<b>Storage Destination</b>", table_cell),
            Paragraph("Bucket: <code>documents</code> &nbsp;|&nbsp; Key: <code>portal-uploads/1789022991904-h00vs72.xlsx</code>", table_cell)
        ],
        [
            Paragraph("<b>Category / Module</b>", table_cell),
            Paragraph("Category: <code>other</code> &nbsp;|&nbsp; Core Document ID: <code>645b01e7-3d61-492b-a9d1-7a63269a36b1</code>", table_cell)
        ]
    ]
    upload_table = Table(upload_box_data, colWidths=[130, 410])
    upload_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (0,-1), colors.HexColor("#F8FAFC")),
        ('BACKGROUND', (1,0), (1,-1), colors.white),
        ('ALIGN', (0,0), (-1,-1), 'LEFT'),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('BOX', (0,0), (-1,-1), 1, c_accent),
        ('INNERGRID', (0,0), (-1,-1), 0.5, colors.HexColor("#E2E8F0")),
        ('TOPPADDING', (0,0), (-1,-1), 4.5),
        ('BOTTOMPADDING', (0,0), (-1,-1), 4.5),
        ('LEFTPADDING', (0,0), (-1,-1), 8),
        ('RIGHTPADDING', (0,0), (-1,-1), 8),
    ]))
    story.append(upload_table)
    story.append(Spacer(1, 14))

    # SECTION 3: Detailed Breakdown of Actions Done Today
    story.append(Paragraph("3. Detailed Operator Actions Log (Who Did What Today)", h1_style))
    story.append(Paragraph("Itemized record of data creation, modifications, and system operations recorded in <code>core.audit_log</code>:", body_style))
    story.append(Spacer(1, 8))

    # Sub-operator: Talent Makurumidze
    story.append(Paragraph("<b>A. Talent Makurumidze</b> &lt;talent@sixnineconstruction.com&gt; &nbsp;—&nbsp; <i>CRM Associate</i>", h2_style))
    story.append(Paragraph("<b>Total Actions:</b> 2 &nbsp;|&nbsp; <b>Active Time:</b> 06:50 UTC (08:50 CAT)", body_style))
    story.append(Spacer(1, 3))
    t_actions = [
        [
            Paragraph("Time (UTC)", table_header),
            Paragraph("Action", table_header),
            Paragraph("Target Entity", table_header),
            Paragraph("Operational Details", table_header),
        ],
        [
            Paragraph("06:50:32", table_cell),
            Paragraph("<b>INSERT</b>", table_cell_bold),
            Paragraph("<code>core.documents</code>", table_cell),
            Paragraph("Created document record: 'FOUNDATION COLLEGE JUNIOR SCHOOL VERANDAH QUOTATION.xlsx' (Category: other, Size: 60,960 B).", table_cell)
        ],
        [
            Paragraph("06:50:32", table_cell),
            Paragraph("<b>INSERT</b>", table_cell_bold),
            Paragraph("<code>core.file_attachments</code>", table_cell),
            Paragraph("Linked uploaded spreadsheet to storage path: <code>portal-uploads/1789022991904-h00vs72.xlsx</code>.", table_cell)
        ]
    ]
    t_table = Table(t_actions, colWidths=[65, 55, 120, 300])
    t_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), c_secondary),
        ('ALIGN', (0,0), (-1,-1), 'LEFT'),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('BOX', (0,0), (-1,-1), 0.5, c_border),
        ('INNERGRID', (0,0), (-1,-1), 0.5, colors.HexColor("#E2E8F0")),
        ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, c_bg_light]),
        ('TOPPADDING', (0,0), (-1,-1), 4),
        ('BOTTOMPADDING', (0,0), (-1,-1), 4),
        ('LEFTPADDING', (0,0), (-1,-1), 5),
        ('RIGHTPADDING', (0,0), (-1,-1), 5),
    ]))
    story.append(t_table)
    story.append(Spacer(1, 10))

    # Sub-operator: Emmanuel Shumba
    story.append(Paragraph("<b>B. Emmanuel Shumba</b> &lt;emmanuel@sixnineconstruction.com&gt; &nbsp;—&nbsp; <i>CRM Associate</i>", h2_style))
    story.append(Paragraph("<b>Total Actions:</b> 8 &nbsp;|&nbsp; <b>Active Time Window:</b> 08:35 – 08:45 UTC (10:35 – 10:45 CAT)", body_style))
    story.append(Spacer(1, 3))
    e_actions = [
        [
            Paragraph("Time (UTC)", table_header),
            Paragraph("Action", table_header),
            Paragraph("Tender / Bid #", table_header),
            Paragraph("Tender Name & Captured Parameters", table_header),
        ],
        [
            Paragraph("08:35:36<br/>08:35:40", table_cell),
            Paragraph("<b>INSERT</b><br/><b>UPDATE</b>", table_cell_bold),
            Paragraph("Bid #99442", table_cell_bold),
            Paragraph("<b>Provision of storm water drainage construction</b><br/>&bull; Category: Civil Works &nbsp;|&nbsp; Stage: Tender Identified<br/>&bull; Submission Deadline: 2026-09-24 13:00 UTC &nbsp;|&nbsp; Mandatory Site Visit: Yes", table_cell)
        ],
        [
            Paragraph("08:38:34<br/>08:38:37", table_cell),
            Paragraph("<b>INSERT</b><br/><b>UPDATE</b>", table_cell_bold),
            Paragraph("Bid #100054", table_cell_bold),
            Paragraph("<b>Carry out construction of plinth , bandwall and shed for ethanol offloading pump area at msasa</b><br/>&bull; Category: Civil Works &nbsp;|&nbsp; Stage: Tender Identified<br/>&bull; Submission Deadline: 2026-09-17 08:00 UTC &nbsp;|&nbsp; Mandatory Site Visit: Yes", table_cell)
        ],
        [
            Paragraph("08:40:41<br/>08:40:44", table_cell),
            Paragraph("<b>INSERT</b><br/><b>UPDATE</b>", table_cell_bold),
            Paragraph("Bid #100206", table_cell_bold),
            Paragraph("<b>Zera Bulawayo office renovation</b><br/>&bull; Stage: Tender Identified &nbsp;|&nbsp; Captured into CRM pipeline", table_cell)
        ],
        [
            Paragraph("08:45:01<br/>08:45:04", table_cell),
            Paragraph("<b>INSERT</b><br/><b>UPDATE</b>", table_cell_bold),
            Paragraph("Bid #101341", table_cell_bold),
            Paragraph("<b>Construction of a clinic in Goromonzi District and a classroom block in Bulilima District</b><br/>&bull; Stage: Tender Identified &nbsp;|&nbsp; Captured into CRM pipeline", table_cell)
        ]
    ]
    e_table = Table(e_actions, colWidths=[65, 60, 85, 330])
    e_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), c_secondary),
        ('ALIGN', (0,0), (-1,-1), 'LEFT'),
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('BOX', (0,0), (-1,-1), 0.5, c_border),
        ('INNERGRID', (0,0), (-1,-1), 0.5, colors.HexColor("#E2E8F0")),
        ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, c_bg_light]),
        ('TOPPADDING', (0,0), (-1,-1), 4),
        ('BOTTOMPADDING', (0,0), (-1,-1), 4),
        ('LEFTPADDING', (0,0), (-1,-1), 5),
        ('RIGHTPADDING', (0,0), (-1,-1), 5),
    ]))
    story.append(e_table)
    story.append(Spacer(1, 10))

    # Page Break before Ashton & System actions
    story.append(PageBreak())

    # Sub-operator: Ashton
    story.append(Paragraph("<b>C. Ashton (Admin)</b> &lt;ashton@admin.com&gt; &nbsp;—&nbsp; <i>Executive (Admin)</i>", h2_style))
    story.append(Paragraph("<b>Total Actions:</b> 43 &nbsp;|&nbsp; <b>Active Time Window:</b> 17:29 – 19:58 UTC (19:29 – 21:58 CAT)", body_style))
    story.append(Spacer(1, 3))
    a_actions = [
        [
            Paragraph("Time (UTC)", table_header),
            Paragraph("Module / Entity", table_header),
            Paragraph("Actions", table_header),
            Paragraph("Operational Description & Transaction Flow", table_header),
        ],
        [
            Paragraph("17:29:52", table_cell),
            Paragraph("<code>core.notifications</code>", table_cell),
            Paragraph("8 INSERTS", table_cell_bold),
            Paragraph("Dispatched executive health alerts: 'Executive data needs attention' (Site Reports, Finance Quotes, Suppliers staleness warnings) to relevant team members.", table_cell)
        ],
        [
            Paragraph("18:29 – 18:30", table_cell),
            Paragraph("<code>finance.journal_entries</code><br/><code>finance.journal_lines</code><br/><code>accounting_periods</code>", table_cell),
            Paragraph("2 INSERTS<br/>8 UPDATES", table_cell_bold),
            Paragraph("<b>General Ledger & Journal Entry Cycle:</b><br/>&bull; Created & posted journal entry for 'Cement purchase test'.<br/>&bull; Tested reversal path: generated & posted reversal entry 'Reversal of JE-202609-000001'.<br/>&bull; Updated period lock status in <code>finance.accounting_periods</code>.", table_cell)
        ],
        [
            Paragraph("19:53:35 – 19:53:57", table_cell),
            Paragraph("<code>finance.journal_entries</code><br/><code>finance.journal_lines</code><br/><code>accounting_periods</code>", table_cell),
            Paragraph("2 INSERTS<br/>5 UPDATES", table_cell_bold),
            Paragraph("<b>Project Cost Allocation Cycle:</b><br/>&bull; Opened new accounting period record.<br/>&bull; Created and posted cost transaction journal entry: 'Cost transaction (project_setup_expense, materials): Site clearance labour' with associated debit/credit lines.", table_cell)
        ],
        [
            Paragraph("19:57:35 – 19:58:18", table_cell),
            Paragraph("<code>finance.progress_claims</code><br/><code>finance.journal_entries</code><br/><code>finance.journal_lines</code>", table_cell),
            Paragraph("2 INSERTS<br/>6 UPDATES", table_cell_bold),
            Paragraph("<b>Progress Claim & Certification Flow:</b><br/>&bull; Submitted and certified progress claim <code>GLBRIDGE-TEST-001</code>.<br/>&bull; Generated certified claim journal entry with associated lines.<br/>&bull; Executed rejection flow test: updated status to <code>[REJECTED: Testing rejection flow]</code>.", table_cell)
        ]
    ]
    a_table = Table(a_actions, colWidths=[70, 115, 65, 290])
    a_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), c_secondary),
        ('ALIGN', (0,0), (-1,-1), 'LEFT'),
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('BOX', (0,0), (-1,-1), 0.5, c_border),
        ('INNERGRID', (0,0), (-1,-1), 0.5, colors.HexColor("#E2E8F0")),
        ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, c_bg_light]),
        ('TOPPADDING', (0,0), (-1,-1), 4),
        ('BOTTOMPADDING', (0,0), (-1,-1), 4),
        ('LEFTPADDING', (0,0), (-1,-1), 5),
        ('RIGHTPADDING', (0,0), (-1,-1), 5),
    ]))
    story.append(a_table)
    story.append(Spacer(1, 10))

    # Sub-operator: Automated System / Service Role
    story.append(Paragraph("<b>D. Automated System / Service Role & Migration Scripts</b>", h2_style))
    story.append(Paragraph("<b>Total Actions:</b> 32 &nbsp;|&nbsp; <b>Active Time Window:</b> 18:22, 19:48, 19:58 – 19:59 UTC", body_style))
    story.append(Spacer(1, 3))
    s_actions = [
        [
            Paragraph("Time (UTC)", table_header),
            Paragraph("Module / Entity", table_header),
            Paragraph("Actions", table_header),
            Paragraph("Operational Description", table_header),
        ],
        [
            Paragraph("18:22 &amp; 19:48", table_cell),
            Paragraph("<code>core.permissions</code>", table_cell),
            Paragraph("16 INSERTS", table_cell_bold),
            Paragraph("Inserted granular security and domain permissions into the permissions registry.", table_cell)
        ],
        [
            Paragraph("19:58:52", table_cell),
            Paragraph("<code>finance.retention_ledger</code><br/><code>finance.journal_entries</code>", table_cell),
            Paragraph("2 INSERTS<br/>4 UPDATES", table_cell_bold),
            Paragraph("Automated reclassification trigger: 'Retention released - reclassified to receivable'.", table_cell)
        ],
        [
            Paragraph("19:59:34", table_cell),
            Paragraph("<code>finance.journal_lines</code><br/><code>finance.journal_entries</code><br/><code>progress_claims</code><br/><code>retention_ledger</code>", table_cell),
            Paragraph("10 DELETES", table_cell_bold),
            Paragraph("Automated test teardown / cleanup: cleanly deleted temporary progress claim <code>GLBRIDGE-TEST-001</code>, test retention records, and test journal lines.", table_cell)
        ]
    ]
    s_table = Table(s_actions, colWidths=[70, 115, 65, 290])
    s_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), c_secondary),
        ('ALIGN', (0,0), (-1,-1), 'LEFT'),
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('BOX', (0,0), (-1,-1), 0.5, c_border),
        ('INNERGRID', (0,0), (-1,-1), 0.5, colors.HexColor("#E2E8F0")),
        ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, c_bg_light]),
        ('TOPPADDING', (0,0), (-1,-1), 4),
        ('BOTTOMPADDING', (0,0), (-1,-1), 4),
        ('LEFTPADDING', (0,0), (-1,-1), 5),
        ('RIGHTPADDING', (0,0), (-1,-1), 5),
    ]))
    story.append(s_table)
    story.append(Spacer(1, 14))

    # SECTION 4: Complete Registered User Registry
    story.append(Paragraph("4. Complete Roster Status of All Registered Users (28 Accounts)", h1_style))
    story.append(Paragraph("Status, system role, login activity, and actions count across every registered account in AEGIS:", body_style))
    story.append(Spacer(1, 6))

    users_data = [
        ("Ashton (Admin)", "ashton@admin.com", "Executive (Admin)", "Yes", "2026-09-10 19:52 UTC", "43 Actions"),
        ("Ekow Imbeah", "ekow@sixnineconstruction.com", "CRM Associate", "Yes", "2026-09-10 09:50 UTC", "0 (Read-only)"),
        ("Mcdonald Kamutembere", "mcdonald@sixnineconstruction.com", "CRM Associate", "Yes", "2026-09-10 09:54 UTC", "0 (Read-only)"),
        ("Emmanuel Shumba", "emmanuel@sixnineconstruction.com", "CRM Associate", "No*", "2026-08-31 08:54 UTC", "8 Actions (Active)"),
        ("Talent Makurumidze", "talent@sixnineconstruction.com", "CRM Associate", "No*", "2026-09-01 13:42 UTC", "2 Actions (Upload)"),
        ("Gloria Nyasha Mudekwa", "gloriamudekwa@sixnineconstruction.com", "Executive (Admin)", "No", "2026-09-07 11:56 UTC", "0"),
        ("Gladmore Sithole", "gladmore@sixnineconstruction.com", "Procurement Manager", "No", "2026-09-07 09:12 UTC", "0"),
        ("Cosmas Mudekwa", "cosmas@sixnineconstruction.com", "Executive (Admin)", "No", "2026-09-04 10:49 UTC", "0"),
        ("AEGIS Test User", "test@aegis.com", "Superadmin", "No", "2026-09-04 21:14 UTC", "0"),
        ("Takudzwa Tagu", "takudzwa@sixnineconstruction.com", "Quantity Surveyor", "No", "2026-08-28 08:54 UTC", "0"),
        ("Pheobe Lifa", "pheobe@sixnineconstruction.com", "Sales Executive", "No", "2026-08-28 07:11 UTC", "0"),
        ("Gamuchirai Mufuka", "gamuchirai@sixnineconstruction.com", "Quantity Surveyor", "No", "2026-08-25 09:39 UTC", "0"),
        ("CRM Test User", "crmtest.aegis.20260729@gmail.com", "Executive (Admin)", "No", "2026-08-20 21:57 UTC", "0"),
        ("Hitler Adamant", "hitler@sixnineconstruction.com", "Finance Manager", "No", "2026-08-19 18:30 UTC", "0"),
        ("Simulation Manager", "simulation.manager.aegis@example.com", "Project Manager", "No", "2026-08-10 12:56 UTC", "0"),
        ("Aegis Admin", "admin@sixnineconstruction.com", "Executive (Admin)", "No", "2026-08-08 22:43 UTC", "0"),
        ("Simulation Sales Rep 1", "simulation.sales1.aegis@example.com", "Sales Executive", "No", "2026-08-08 06:47 UTC", "0"),
        ("Simulation Sales Rep 2", "simulation.sales2.aegis@example.com", "User", "No", "2026-08-08 06:47 UTC", "0"),
        ("Phoebe Lifa (Alias)", "phoebe@sixnineconstruction.com", "Sales Executive", "No", "Never", "0"),
        ("Test Invite User", "ashytana+aegis-invite-test@gmail.com", "User", "No", "Never", "0"),
        ("Prod Invite Test", "ashytana+aegis-prod-invite-test@gmail.com", "User", "No", "Never", "0"),
        ("Redirect Fix Test", "ashytana+aegis-redirect-test@gmail.com", "User", "No", "Never", "0"),
        ("Branded Email Test", "ashytana+aegis-branded-test@gmail.com", "User", "No", "Never", "0"),
        ("Branding Fallback Test", "ashytana+aegis-branding-test@gmail.com", "User", "No", "Never", "0"),
        ("Resend Notification Test", "ashytana+aegis-resend-test@gmail.com", "User", "No", "Never", "0"),
        ("Test Alias 1", "ashytana+aegis-redirect-test2@gmail.com", "User", "No", "Never", "0"),
        ("Test Alias 2", "ashytana+aegis-redirect-fresh-1786227028@gmail.com", "User", "No", "Never", "0"),
        ("Test Alias 3", "ashytana+aegis-redirect-fresh-1786227116@gmail.com", "User", "No", "Never", "0"),
    ]

    u_rows = [
        [
            Paragraph("User Name", table_header),
            Paragraph("Email Address", table_header),
            Paragraph("Role", table_header),
            Paragraph("Login Today?", table_header),
            Paragraph("Last Sign-In", table_header),
            Paragraph("Actions Today", table_header),
        ]
    ]

    for name, email, role, logged, last_in, acts in users_data:
        logged_p = Paragraph(f"<font color='#059669'><b>{logged}</b></font>", table_cell) if logged == "Yes" else Paragraph(f"<font color='#64748B'>{logged}</font>", table_cell)
        acts_p = Paragraph(f"<b>{acts}</b>", table_cell_bold) if "Action" in acts or "Upload" in acts else Paragraph(acts, table_cell)
        u_rows.append([
            Paragraph(name, table_cell),
            Paragraph(email, table_cell),
            Paragraph(role, table_cell),
            logged_p,
            Paragraph(last_in, table_cell),
            acts_p
        ])

    u_table = Table(u_rows, colWidths=[100, 140, 85, 55, 95, 65])
    u_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), c_primary),
        ('ALIGN', (0,0), (-1,-1), 'LEFT'),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('BOX', (0,0), (-1,-1), 0.5, c_border),
        ('INNERGRID', (0,0), (-1,-1), 0.5, colors.HexColor("#E2E8F0")),
        ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, c_bg_light]),
        ('TOPPADDING', (0,0), (-1,-1), 3.5),
        ('BOTTOMPADDING', (0,0), (-1,-1), 3.5),
        ('LEFTPADDING', (0,0), (-1,-1), 4),
        ('RIGHTPADDING', (0,0), (-1,-1), 4),
    ]))
    story.append(u_table)
    story.append(Spacer(1, 8))
    story.append(Paragraph("<font color='#64748B' size=7.5><i>*Note: 'No*' indicates the user operated today using an existing unexpired bearer/JWT session token without a fresh interactive login.</i></font>", styles['Normal']))

    doc.build(story, canvasmaker=NumberedCanvas)
    print(f"PDF successfully generated at: {pdf_filename}")
    return pdf_filename

if __name__ == "__main__":
    desktop = sys.argv[1] if len(sys.argv) > 1 else r"C:\Users\ashjx\Desktop"
    build_pdf(desktop)
