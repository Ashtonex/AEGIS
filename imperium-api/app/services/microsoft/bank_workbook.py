"""Bank & Project Money workbook - a read-only Excel mirror in the Data Room.

Phase 1 of "Excel in Teams": AEGIS builds one workbook from the bank
statement, its splits / cash uses, per-project money and the books check,
and uploads it into the Financial Data Room's SharePoint folder (the same
connected site/drive data_room_sync.py uses, so no new Graph permission is
needed). Pinned as a Teams tab, everyone sees the live figures.

- Built with openpyxl as real Excel tables (BankLines, Allocations, Projects)
  so Phase 2 can read edits back by table and row ID.
- Sheets are protected: in Excel for the web they open read-only. Phase 1
  is one-way on purpose - AEGIS stays the only place changes are made.
- A publish is skipped when the data hasn't changed (content_signature),
  so the debounced job fired after every tag doesn't create a new SharePoint
  version each time.

publish() does its own commit of the status row only after the upload, so
callers can run it from a background job without a surrounding transaction.
"""

from __future__ import annotations

import hashlib
import io
import json
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any
from uuid import UUID

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.table import Table, TableStyleInfo
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from core.logging import logger
from app.services.finance import bank_books
from app.services.microsoft import data_room_sync, sharepoint
from app.services.microsoft.graph_client import GraphClient

WORKBOOK_FILE_NAME = "AEGIS Bank & Project Money.xlsx"
XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
MONEY_FORMAT = '#,##0.00;[Red]-#,##0.00'
HEADER_FILL = PatternFill("solid", fgColor="1F2937")
HEADER_FONT = Font(bold=True, color="FFFFFF")

CATEGORY_LABELS = {
    "client_receipt": "Client receipt", "capital_injection": "Capital / owner injection",
    "internal_transfer": "Internal transfer", "cash_withdrawal": "Cash withdrawal",
    "supplier_payment": "Supplier / materials", "subcontractor": "Subcontractor",
    "equipment_hire": "Equipment / plant hire", "fuel_transport": "Fuel & transport",
    "salaries_wages": "Salaries & wages", "tax_statutory": "Tax & statutory",
    "bank_charges": "Bank charges & IMTT", "card_purchase": "Card / POS purchase",
    "owner_drawings": "Owner drawings", "tithe_donation": "Tithe / donation", "refund": "Refund",
    "reversal": "Bank reversal", "site_petty_cash": "Handed to site petty cash", "other": "Other",
}


def _label(category: str | None) -> str:
    return CATEGORY_LABELS.get(category or "", (category or "").replace("_", " "))


def _num(value: Any) -> float | None:
    return None if value is None else float(value)


# ---------------------------------------------------------------------------
# Data
# ---------------------------------------------------------------------------

async def collect(db: AsyncSession, org_id: str) -> dict:
    q = lambda sql, **p: db.execute(text(sql), {"org_id": org_id, **p})
    lines = [dict(r) for r in (await q(r"""
        SELECT l.id, l.transaction_date, l.reference,
               regexp_replace(COALESCE(l.description, ''), '\s+', ' ', 'g') AS description,
               l.counterparty_name, l.amount, l.category, p.name AS project, l.notes,
               SUM(l.amount) OVER (PARTITION BY l.import_id ORDER BY l.transaction_date, l.line_number) AS balance,
               je.journal_number,
               (SELECT count(*) FROM finance.bank_line_allocations a WHERE a.line_id = l.id) AS parts,
               ca.account_name AS bank_account
        FROM finance.bank_statement_lines l
        LEFT JOIN projects.projects p ON p.id = l.project_id
        LEFT JOIN finance.journal_entries je ON je.id = l.gl_journal_id
        LEFT JOIN finance.cash_accounts ca ON ca.id = l.cash_account_id
        WHERE l.organization_id = :org_id
        ORDER BY l.transaction_date, l.line_number
    """)).mappings()]
    allocations = [dict(r) for r in (await q("""
        SELECT a.id, a.line_id, l.transaction_date AS line_date, l.reference, l.amount AS line_amount,
               l.category AS line_category, p.name AS project, a.category, a.amount, a.allocation_date, a.description
        FROM finance.bank_line_allocations a
        JOIN finance.bank_statement_lines l ON l.id = a.line_id
        LEFT JOIN projects.projects p ON p.id = a.project_id
        WHERE a.organization_id = :org_id
        ORDER BY l.transaction_date, a.created_at
    """)).mappings()]
    projects = [dict(r) for r in (await q("""
        SELECT p.name, p.project_code, p.client_name, p.status, COALESCE(p.contract_value, 0) AS contract_value,
               COALESCE((SELECT sum(certified_amount) FROM finance.progress_claims pc
                         WHERE pc.project_id = p.id AND pc.status IN ('certified', 'paid') AND NOT pc.is_deleted), 0) AS certified,
               COALESCE((SELECT sum(net_claim_amount) FROM finance.progress_claims pc
                         WHERE pc.project_id = p.id AND pc.status = 'paid' AND NOT pc.is_deleted), 0) AS collected,
               COALESCE((SELECT sum(amount) FROM finance.cost_transactions ct WHERE ct.project_id = p.id), 0) AS actual_cost,
               COALESCE((SELECT sum(amount) FROM finance.bank_statement_lines l WHERE l.project_id = p.id AND l.amount > 0), 0) AS bank_in,
               COALESCE((SELECT -sum(amount) FROM finance.bank_statement_lines l WHERE l.project_id = p.id AND l.amount < 0), 0) AS bank_out,
               COALESCE((SELECT sum(a.amount) FROM finance.bank_line_allocations a
                         JOIN finance.bank_statement_lines l ON l.id = a.line_id AND l.category = 'cash_withdrawal'
                         WHERE a.project_id = p.id), 0) AS cash_used
        FROM projects.projects p
        WHERE p.organization_id = :org_id AND p.is_deleted = false
        ORDER BY collected DESC, p.name
    """)).mappings()]
    audit = await bank_books.audit(db, org_id=org_id)
    return {"lines": lines, "allocations": allocations, "projects": projects, "audit": audit}


def signature(data: dict) -> str:
    """Hash of the published content (not of the file bytes, which embed a
    timestamp) - equal signatures mean there is nothing new to upload."""
    return hashlib.sha256(json.dumps(data, sort_keys=True, default=str).encode()).hexdigest()


# ---------------------------------------------------------------------------
# Workbook
# ---------------------------------------------------------------------------

def _table_sheet(wb: Workbook, title: str, table_name: str, headers: list[str], rows: list[list[Any]],
                 widths: list[int], money_cols: set[int], date_cols: set[int]) -> None:
    ws = wb.create_sheet(title)
    ws.append(headers)
    for row in rows:
        ws.append(row)
    for i, width in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = width
    for cell in ws[1]:
        cell.fill, cell.font = HEADER_FILL, HEADER_FONT
        cell.alignment = Alignment(vertical="center")
    for col in money_cols:
        for (cell,) in ws.iter_rows(min_row=2, min_col=col, max_col=col):
            cell.number_format = MONEY_FORMAT
    for col in date_cols:
        for (cell,) in ws.iter_rows(min_row=2, min_col=col, max_col=col):
            cell.number_format = "yyyy-mm-dd"
    ws.freeze_panes = "A2"
    last = f"{get_column_letter(len(headers))}{max(2, len(rows) + 1)}"
    if not rows:  # an Excel table needs at least one data row
        ws.append([None] * len(headers))
    table = Table(displayName=table_name, ref=f"A1:{last}")
    table.tableStyleInfo = TableStyleInfo(name="TableStyleMedium2", showRowStripes=True)
    ws.add_table(table)
    ws.protection.sheet = True
    ws.protection.autoFilter = False   # filtering/sorting still works on a protected sheet
    ws.protection.sort = False


def build(data: dict, *, published_at: datetime) -> bytes:
    wb = Workbook()
    readme = wb.active
    readme.title = "Read Me"
    audit = data["audit"]
    todo = audit["to_do"]
    info = [
        ("AEGIS Bank & Project Money", None),
        ("Published by AEGIS", published_at.strftime("%Y-%m-%d %H:%M UTC")),
        ("What this is", "A read-only mirror of the bank statement and where the money went, kept up to date by AEGIS."),
        ("How to change something", "Make changes in AEGIS (Finance > Bank Statement Review, or a project's money panel). "
                                    "This workbook refreshes about a minute later."),
        (None, None),
        ("Books check", "All checks pass" if audit["all_ok"] else "Something doesn't tie out - see below"),
    ]
    info += [(f"  {c['check']}", ("OK" if c["ok"] else "CHECK") + f" - {c['detail']}") for c in audit["checks"]]
    info += [
        (None, None),
        ("Still to do", None),
        ("  Lines with no category or project", int(todo["unclassified_lines"])),
        ("  Unidentified money in (in Suspense)", _num(todo["unclassified_money_in"])),
        ("  Unidentified money out (in Suspense)", _num(todo["unclassified_money_out"])),
        ("  Cash withdrawn, not yet accounted for", _num(todo["hq_petty_cash_not_yet_accounted_for"])),
        ("  Project costs with no cost type", _num(todo["unclassified_project_costs"])),
    ]
    for label, value in info:
        readme.append([label, value])
    readme["A1"].font = Font(bold=True, size=14)
    readme.column_dimensions["A"].width = 44
    readme.column_dimensions["B"].width = 100
    for row in readme.iter_rows(min_row=2):
        if isinstance(row[1].value, float):
            row[1].number_format = MONEY_FORMAT
    readme.protection.sheet = True

    _table_sheet(
        wb, "Bank Lines", "BankLines",
        ["Line ID", "Date", "Reference", "Description", "Who", "Money in", "Money out", "Balance",
         "Category", "Project", "Split into parts", "Note", "Journal", "Bank account"],
        [[str(l["id"]), l["transaction_date"], l["reference"], l["description"], l["counterparty_name"],
          _num(l["amount"]) if l["amount"] > 0 else None, _num(-l["amount"]) if l["amount"] < 0 else None,
          _num(l["balance"]), _label(l["category"]) or None, l["project"], int(l["parts"]) or None, l["notes"],
          l["journal_number"], l["bank_account"]] for l in data["lines"]],
        [38, 12, 20, 70, 26, 14, 14, 14, 24, 34, 10, 30, 20, 16], money_cols={6, 7, 8}, date_cols={2},
    )
    _table_sheet(
        wb, "Splits & Cash Uses", "Allocations",
        ["Allocation ID", "Line ID", "Line date", "Reference", "Line amount", "Kind", "Project", "Category",
         "Amount", "Date", "What it paid for"],
        [[str(a["id"]), str(a["line_id"]), a["line_date"], a["reference"], _num(abs(a["line_amount"])),
          "Use of withdrawn cash" if a["line_category"] == "cash_withdrawal" else "Split of bank line",
          a["project"], _label(a["category"]) or None, _num(a["amount"]), a["allocation_date"], a["description"]]
         for a in data["allocations"]],
        [38, 38, 12, 20, 14, 22, 34, 24, 14, 12, 50], money_cols={5, 9}, date_cols={3, 10},
    )
    _table_sheet(
        wb, "Projects", "Projects",
        ["Project", "Code", "Client", "Status", "Contract value", "Certified", "Collected", "Actual cost",
         "Margin to date", "Bank in", "Bank out", "Cash used"],
        [[p["name"], p["project_code"], p["client_name"], p["status"], _num(p["contract_value"]), _num(p["certified"]),
          _num(p["collected"]), _num(p["actual_cost"]), _num(Decimal(str(p["collected"])) - Decimal(str(p["actual_cost"]))),
          _num(p["bank_in"]), _num(p["bank_out"]), _num(p["cash_used"])] for p in data["projects"]],
        [38, 10, 26, 16, 16, 16, 16, 16, 16, 16, 16, 14], money_cols={5, 6, 7, 8, 9, 10, 11, 12}, date_cols=set(),
    )
    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()


# ---------------------------------------------------------------------------
# Publish
# ---------------------------------------------------------------------------

async def status(db: AsyncSession, org_id: str) -> dict | None:
    row = (await db.execute(
        text("SELECT * FROM finance.bank_workbook_publications WHERE organization_id = :org_id"), {"org_id": org_id},
    )).mappings().first()
    return dict(row) if row else None


async def _record(db: AsyncSession, org_id: str, **values: Any) -> None:
    cols = ", ".join(values)
    params = ", ".join(f":{k}" for k in values)
    updates = ", ".join(f"{k} = EXCLUDED.{k}" for k in values)
    await db.execute(
        text(f"""
            INSERT INTO finance.bank_workbook_publications (organization_id, file_name, {cols})
            VALUES (:org_id, :file_name, {params})
            ON CONFLICT (organization_id) DO UPDATE SET {updates}, updated_at = NOW()
        """),
        {"org_id": org_id, "file_name": WORKBOOK_FILE_NAME, **values},
    )
    await db.commit()


async def publish(db: AsyncSession, *, org_id: str, force: bool = False) -> dict:
    """Build and upload the workbook. Returns the publication row. Never
    raises for Microsoft-side failures - they are recorded on the row
    (last_status='failed') so the UI can show them."""
    now = datetime.now(timezone.utc)
    data = await collect(db, org_id)
    sig = signature(data)
    previous = await status(db, org_id) or {}
    if not force and previous.get("content_signature") == sig and previous.get("item_id"):
        await _record(db, org_id, last_attempt_at=now, last_status="unchanged", last_error=None)
        return await status(db, org_id)

    try:
        connection = await data_room_sync._load_connection(db, UUID(org_id))
        content = build(data, published_at=now)
        client = GraphClient(tenant_id=connection.tenant_id)
        uploader = sharepoint.upload_small_file if len(content) <= sharepoint.SIMPLE_UPLOAD_MAX_BYTES else sharepoint.upload_large_file
        item = await uploader(client, connection.drive_id, connection.root_item_id, WORKBOOK_FILE_NAME, content, XLSX_MIME)
    except Exception as exc:  # noqa: BLE001 - recorded on the row, never breaks the caller
        await db.rollback()
        logger.error("bank_workbook.publish_failed", organization_id=org_id, error=str(exc))
        await _record(db, org_id, last_attempt_at=now, last_status="failed", last_error=str(exc)[:2000])
        return await status(db, org_id)

    await _record(
        db, org_id, drive_id=connection.drive_id, item_id=item.item_id, web_url=item.web_url, content_signature=sig,
        last_published_at=now, last_attempt_at=now, last_status="published", last_error=None,
        rows_published=len(data["lines"]),
    )
    return await status(db, org_id)
