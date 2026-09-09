import html
import io
import json
import re
import zipfile
from datetime import date, datetime, timezone
from typing import Any, Dict, List, Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.shared.pagination import ok
from core.database import get_db, supabase
from core.logging import logger
from core.security import require_permission

router = APIRouter()

DOCUMENTS_BUCKET = "documents"
SIGNED_URL_TTL_SECONDS = 3600
DATA_ROOM_STORAGE_ROOT = "documents/data-room"
_UNSAFE_PATH_CHARS = re.compile(r"[\x00-\x1f\\]")


def _org_storage_prefix(org_id: str) -> str:
    """The only storage path prefix an organization's uploads may register
    under. Binding uploads to this prefix stops one tenant from pointing a
    document record at a storage object it does not own: without it, any
    authenticated user who learns another object's path (e.g. from a shared
    export or a guessed name) could register it as their own organization's
    evidence and mint a signed URL for it."""
    return f"{DATA_ROOM_STORAGE_ROOT}/{org_id}/"


def _is_storage_path_bound_to_org(storage_path: str, org_id: str) -> bool:
    if not storage_path or "\x00" in storage_path:
        return False
    if any(part in ("", ".", "..") for part in storage_path.split("/")[:-1]) and ".." in storage_path:
        return False
    return storage_path.startswith(_org_storage_prefix(org_id))


def _safe_zip_path(folder_path: str, file_name: str, fallback_name: str) -> str:
    """Builds a ZIP-safe relative path from untrusted folder/file names,
    dropping traversal segments and control characters instead of trusting
    caller-supplied strings directly as archive paths."""
    raw = f"{(folder_path or '').strip('/')}/{file_name or ''}"
    segments: List[str] = []
    for part in raw.split("/"):
        cleaned = _UNSAFE_PATH_CHARS.sub("", part).strip()
        if cleaned in ("", ".", ".."):
            continue
        segments.append(cleaned)
    return "/".join(segments) if segments else fallback_name

# Canonical 18 Data Room Root Folders
STANDARD_SECTIONS = [
    {"code": "01_CORPORATE", "name": "01 CORPORATE", "description": "Statutory registrations, CR6/CR14/CR2, memorandum & articles, tax clearance"},
    {"code": "02_BANKING", "name": "02 BANKING", "description": "Bank statements, facility letters, signed reconciliations by fiscal year"},
    {"code": "03_SALES_CLIENTS", "name": "03 SALES & CLIENTS", "description": "Client register, tenders won, commercial invoices, aged debtor listings"},
    {"code": "04_SUPPLIERS", "name": "04 SUPPLIERS", "description": "Approved vendor list, vendor statements, credit applications, trade agreements"},
    {"code": "05_PROJECTS", "name": "05 PROJECTS", "description": "Per-project auditable workspaces with contracts, claims, receipts, and close-outs"},
    {"code": "06_PROCUREMENT", "name": "06 PROCUREMENT", "description": "Purchase orders, goods received notes, RFQs, three-way match records"},
    {"code": "07_PAYROLL", "name": "07 PAYROLL", "description": "Monthly payroll summaries, NSSA remittances, ZIMRA PAYE P2 forms"},
    {"code": "08_TAX", "name": "08 TAX", "description": "Annual ITF12C tax returns, VAT returns, withholding tax vouchers, ITF263 clearance"},
    {"code": "09_ASSETS", "name": "09 ASSETS", "description": "Fixed asset registers, title deeds, capital expenditure approvals, depreciation schedules"},
    {"code": "10_PLANT_EQUIPMENT", "name": "10 PLANT & EQUIPMENT", "description": "Yellow plant fleet registers, vehicle log books, maintenance and inspection logs"},
    {"code": "11_LOANS_LIABILITIES", "name": "11 LOANS & LIABILITIES", "description": "Commercial loan facilities, equipment lease agreements, debentures, director guarantees"},
    {"code": "12_DIRECTORS", "name": "12 DIRECTORS", "description": "Director identification, board minutes, resolutions, conflict of interest declarations"},
    {"code": "13_QUICKBOOKS", "name": "13 QUICKBOOKS", "description": "Accounting software backups, chart of accounts, trial balances, journal entries"},
    {"code": "14_CONTRACTS", "name": "14 CONTRACTS", "description": "Master service agreements, joint venture agreements, subcontracts, non-disclosure agreements"},
    {"code": "15_RECONCILIATIONS", "name": "15 RECONCILIATIONS", "description": "Monthly bank, supplier, debtor, and intercompany reconciliation workpapers"},
    {"code": "16_MANAGEMENT_ACCOUNTS", "name": "16 MANAGEMENT ACCOUNTS", "description": "Monthly and quarterly P&L, balance sheets, cashflow forecasts, variance analyses"},
    {"code": "17_AUDIT", "name": "17 AUDIT", "description": "Annual signed audited financial statements, management letters, auditor inquiries"},
    {"code": "18_BANKABILITY", "name": "18 BANKABILITY", "description": "Bankability audit packs (BS-100 to BS-800), credit rating dossiers, institutional packs"},
]

# Standard Balance Sheet / Bankability Categories
BS_CATEGORIES = {
    "BS-100": {
        "category": "CASH",
        "items": ["Bank reconciliation", "Bank statements", "Cash count", "GL extract"],
    },
    "BS-200": {
        "category": "RECEIVABLES",
        "items": ["Aged debtors", "Invoice population", "Contracts", "Subsequent receipts"],
    },
    "BS-300": {
        "category": "INVENTORY",
        "items": ["Inventory listing", "Physical count", "Valuation"],
    },
    "BS-400": {
        "category": "PPE",
        "items": ["Asset register", "Purchase documents", "Ownership", "Physical verification", "Depreciation"],
    },
    "BS-500": {
        "category": "PAYABLES",
        "items": ["Supplier ledger", "Supplier statements", "Invoices", "Subsequent payments"],
    },
    "BS-600": {
        "category": "TAX",
        "items": ["Tax returns", "ZIMRA tax clearance (ITF263)", "VAT reconciliations", "PAYE returns", "Withholding tax certificates"],
    },
    "BS-700": {
        "category": "LOANS",
        "items": ["Facility agreements", "Amortization schedules", "Security pledges", "Director guarantees"],
    },
    "BS-800": {
        "category": "EQUITY",
        "items": ["Share register", "Shareholder agreements", "Capital contributions", "Retained earnings"],
    },
}


class FolderCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    folder_name: str = Field(min_length=1, max_length=150)
    parent_path: str = Field(default="")
    section_code: Optional[str] = Field(default=None, max_length=50)
    project_id: Optional[UUID] = None


class ClassifyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    title: str = Field(min_length=1, max_length=255)
    file_name: Optional[str] = None
    project_id: Optional[UUID] = None
    document_date: Optional[date] = None


class UploadPathRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    file_name: str = Field(min_length=1, max_length=255)


class DocumentUpload(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    title: str = Field(min_length=1, max_length=255)
    folder_path: Optional[str] = None
    section_code: Optional[str] = None
    audit_code: Optional[str] = None
    audit_subitem: Optional[str] = None
    project_id: Optional[UUID] = None
    fiscal_year: Optional[int] = None
    document_date: Optional[date] = None
    amount: Optional[float] = None
    currency: Optional[str] = "USD"
    file_name: str = Field(min_length=1, max_length=255)
    file_size_bytes: Optional[int] = 0
    mime_type: Optional[str] = None
    storage_path: str = Field(min_length=1)
    metadata: Optional[Dict[str, Any]] = None


class DocumentStatusUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    verification_status: str = Field(min_length=1, max_length=50)
    audit_notes: Optional[str] = None


class ChecklistVerify(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    status: str = Field(min_length=1, max_length=50)
    notes: Optional[str] = None


async def _ensure_folder_exists(
    db: AsyncSession, *, org_id: str, folder_path: str, section_code: Optional[str] = None, project_id: Optional[UUID] = None, user_id: Optional[str] = None
) -> None:
    """Recursively ensures a folder path and all intermediate parent folders
    exist in finance.data_room_folders for the given organization."""
    clean_path = folder_path.strip().strip("/")
    if not clean_path:
        return

    parts = [p.strip() for p in clean_path.split("/") if p.strip()]
    accumulated_path = ""
    parent_path = ""

    for i, part in enumerate(parts):
        parent_path = accumulated_path
        accumulated_path = f"{accumulated_path}/{part}" if accumulated_path else part
        inferred_section = section_code or (parts[0].replace(" ", "_").upper() if parts else "01_CORPORATE")

        await db.execute(
            text("""
                INSERT INTO finance.data_room_folders (
                    organization_id, parent_path, folder_name, folder_path, section_code, project_id, created_by
                ) VALUES (
                    :org_id, :parent_path, :folder_name, :folder_path, :section_code, :project_id, :created_by
                ) ON CONFLICT (organization_id, folder_path) DO UPDATE
                SET updated_at = NOW()
            """),
            {
                "org_id": org_id,
                "parent_path": parent_path,
                "folder_name": part,
                "folder_path": accumulated_path,
                "section_code": inferred_section,
                "project_id": project_id if i > 0 else None,
                "created_by": user_id,
            },
        )


@router.get("/tree")
async def get_data_room_tree(
    user: dict = Depends(require_permission("finance.data_room.read")),
    db: AsyncSession = Depends(get_db),
):
    """Returns the full hierarchical data room folder tree with item counts,
    sizes, and audit indicators."""
    org_id = user["org_id"]

    # 1. Fetch all registered projects to mirror live project folders under 05 PROJECTS
    projects_res = await db.execute(
        text("""
            SELECT id, name, project_code, status
            FROM projects.projects
            WHERE organization_id = :org_id AND is_deleted = false
            ORDER BY name ASC
        """),
        {"org_id": org_id},
    )
    projects = [dict(r._mapping) for r in projects_res]

    # Ensure system default folders are populated if missing
    for sec in STANDARD_SECTIONS:
        await db.execute(
            text("""
                INSERT INTO finance.data_room_folders (
                    organization_id, parent_path, folder_name, folder_path, section_code, is_system
                ) VALUES (
                    :org_id, '', :name, :name, :code, true
                ) ON CONFLICT (organization_id, folder_path) DO NOTHING
            """),
            {"org_id": org_id, "name": sec["name"], "code": sec["code"]},
        )
    # Ensure banking years
    for yr in ["2024", "2025", "2026"]:
        await db.execute(
            text("""
                INSERT INTO finance.data_room_folders (
                    organization_id, parent_path, folder_name, folder_path, section_code, is_system
                ) VALUES (
                    :org_id, '02 BANKING', :yr, :path, '02_BANKING', true
                ) ON CONFLICT (organization_id, folder_path) DO NOTHING
            """),
            {"org_id": org_id, "yr": yr, "path": f"02 BANKING/{yr}"},
        )

    # Ensure registered projects have subfolders under 05 PROJECTS
    for p in projects:
        p_name = p["name"]
        p_root = f"05 PROJECTS/{p_name}"
        await db.execute(
            text("""
                INSERT INTO finance.data_room_folders (
                    organization_id, parent_path, folder_name, folder_path, section_code, project_id, is_system
                ) VALUES (
                    :org_id, '05 PROJECTS', :name, :path, '05_PROJECTS', :project_id, true
                ) ON CONFLICT (organization_id, folder_path) DO NOTHING
            """),
            {"org_id": org_id, "name": p_name, "path": p_root, "project_id": p["id"]},
        )
        for sub in ["Receipts & Invoices", "Contracts & Agreements", "Progress Claims", "BOQ & Variations"]:
            sub_path = f"{p_root}/{sub}"
            await db.execute(
                text("""
                    INSERT INTO finance.data_room_folders (
                        organization_id, parent_path, folder_name, folder_path, section_code, project_id, is_system
                    ) VALUES (
                        :org_id, :parent, :sub, :sub_path, '05_PROJECTS', :project_id, true
                    ) ON CONFLICT (organization_id, folder_path) DO NOTHING
                """),
                {"org_id": org_id, "parent": p_root, "sub": sub, "sub_path": sub_path, "project_id": p["id"]},
            )

    await db.commit()

    # 2. Fetch all folders
    folders_res = await db.execute(
        text("""
            SELECT f.*, p.name AS project_name, p.project_code
            FROM finance.data_room_folders f
            LEFT JOIN projects.projects p ON p.id = f.project_id
            WHERE f.organization_id = :org_id AND f.is_deleted = false
            ORDER BY f.folder_path ASC
        """),
        {"org_id": org_id},
    )
    folders = [dict(r._mapping) for r in folders_res]

    # 3. Aggregate documents count and size per folder_path
    docs_stat_res = await db.execute(
        text("""
            SELECT folder_path,
                   COUNT(id) AS document_count,
                   COALESCE(SUM(file_size_bytes), 0) AS total_size_bytes,
                   COUNT(CASE WHEN verification_status = 'verified' THEN 1 END) AS verified_count
            FROM finance.data_room_documents
            WHERE organization_id = :org_id AND is_deleted = false
            GROUP BY folder_path
        """),
        {"org_id": org_id},
    )
    doc_stats = {r["folder_path"]: dict(r._mapping) for r in docs_stat_res}

    # Merge stats into folder objects
    for f in folders:
        stat = doc_stats.get(f["folder_path"], {})
        f["document_count"] = stat.get("document_count", 0)
        f["total_size_bytes"] = stat.get("total_size_bytes", 0)
        f["verified_count"] = stat.get("verified_count", 0)

    # 4. Bankability overall score
    checklist_score_res = await db.execute(
        text("""
            SELECT
                COUNT(id) AS total_items,
                COUNT(CASE WHEN status = 'verified' THEN 1 END) AS verified_items,
                COUNT(CASE WHEN status = 'in_progress' THEN 1 END) AS in_progress_items
            FROM finance.bankability_checklists
            WHERE organization_id = :org_id AND is_deleted = false
        """),
        {"org_id": org_id},
    )
    score_row = checklist_score_res.mappings().first() or {}
    total_items = score_row.get("total_items", 0) or 1
    verified_items = score_row.get("verified_items", 0) or 0
    readiness_pct = round((verified_items / total_items) * 100, 1)

    return ok(
        {
            "folders": folders,
            "standard_sections": STANDARD_SECTIONS,
            "readiness": {
                "score_pct": readiness_pct,
                "verified_items": verified_items,
                "total_items": total_items,
                "in_progress_items": score_row.get("in_progress_items", 0),
            },
        },
        "Data Room hierarchy retrieved.",
    )


@router.get("/documents")
async def list_data_room_documents(
    folder_path: Optional[str] = None,
    section_code: Optional[str] = None,
    audit_code: Optional[str] = None,
    project_id: Optional[UUID] = None,
    search: Optional[str] = None,
    verification_status: Optional[str] = None,
    user: dict = Depends(require_permission("finance.data_room.read")),
    db: AsyncSession = Depends(get_db),
):
    """Lists documents in the Financial Data Room matching filters."""
    query_str = """
        SELECT d.*, u.full_name AS uploaded_by_name, v.full_name AS verified_by_name,
               p.name AS project_name, p.project_code
        FROM finance.data_room_documents d
        LEFT JOIN core.users u ON u.id = d.created_by AND u.organization_id = d.organization_id
        LEFT JOIN core.users v ON v.id = d.verified_by AND v.organization_id = d.organization_id
        LEFT JOIN projects.projects p ON p.id = d.project_id AND p.organization_id = d.organization_id
        WHERE d.organization_id = :org_id AND d.is_deleted = false
    """
    params: Dict[str, Any] = {"org_id": user["org_id"]}

    if folder_path:
        clean_prefix = folder_path.strip().strip("/")
        query_str += " AND (d.folder_path = :folder_path OR d.folder_path LIKE :folder_prefix)"
        params["folder_path"] = clean_prefix
        params["folder_prefix"] = f"{clean_prefix}/%"

    if section_code:
        query_str += " AND d.section_code = :section_code"
        params["section_code"] = section_code

    if audit_code:
        query_str += " AND d.audit_code = :audit_code"
        params["audit_code"] = audit_code

    if project_id:
        query_str += " AND d.project_id = :project_id"
        params["project_id"] = project_id

    if verification_status:
        query_str += " AND d.verification_status = :verification_status"
        params["verification_status"] = verification_status

    if search:
        query_str += " AND (d.title ILIKE :search OR d.file_name ILIKE :search OR d.folder_path ILIKE :search)"
        params["search"] = f"%{search}%"

    query_str += " ORDER BY d.created_at DESC"

    result = await db.execute(text(query_str), params)
    items = [dict(r._mapping) for r in result]
    return ok(items, "Documents listed.")


@router.post("/classify")
async def auto_classify_document(
    payload: ClassifyRequest,
    user: dict = Depends(require_permission("finance.data_room.read")),
    db: AsyncSession = Depends(get_db),
):
    """Analyzes title, filename, and date to automatically recommend the
    target Data Room folder path, project linkage, and BS audit classification."""
    org_id = user["org_id"]
    text_corpus = f"{payload.title} {payload.file_name or ''}".lower()

    # 1. Detect Year
    year_match = re.search(r"\b(202[0-9])\b", text_corpus)
    fiscal_year = int(year_match.group(1)) if year_match else (payload.document_date.year if payload.document_date else datetime.now(timezone.utc).year)

    # 2. Match Project
    matched_project = None
    projects_res = await db.execute(
        text("SELECT id, name, project_code FROM projects.projects WHERE organization_id = :org_id AND is_deleted = false"),
        {"org_id": org_id},
    )
    all_projects = [dict(r._mapping) for r in projects_res]

    if payload.project_id:
        matched_project = next((p for p in all_projects if str(p["id"]) == str(payload.project_id)), None)

    if not matched_project:
        for p in all_projects:
            name_token = p["name"].strip().lower()
            code_token = (p["project_code"] or "").strip().lower()
            if (name_token and name_token in text_corpus) or (code_token and code_token in text_corpus):
                matched_project = p
                break

    # 3. Detect Document Category & BS Audit Code
    category = "general"
    audit_code = None
    audit_subitem = None
    section_code = "01_CORPORATE"
    target_subfolder = "General"

    if re.search(r"receipt|slip|invoice|bill|grn|purchase|pos\b", text_corpus):
        category = "receipts_invoices"
        target_subfolder = "Receipts & Invoices"
        audit_code = "BS-500"
        audit_subitem = "Invoices"
        section_code = "06_PROCUREMENT" if not matched_project else "05_PROJECTS"
    elif re.search(r"contract|agreement|award|subcontract|mou|addendum", text_corpus):
        category = "contracts"
        target_subfolder = "Contracts & Agreements"
        audit_code = "BS-200"
        audit_subitem = "Contracts"
        section_code = "14_CONTRACTS" if not matched_project else "05_PROJECTS"
    elif re.search(r"claim|certificate|valuation|ipc|progress\s*claim", text_corpus):
        category = "claims"
        target_subfolder = "Claims & Certificates"
        audit_code = "BS-200"
        audit_subitem = "Invoice population"
        section_code = "03_SALES_CLIENTS" if not matched_project else "05_PROJECTS"
    elif re.search(r"bank|statement|reconciliation|recon|cash count|teller", text_corpus):
        category = "banking"
        target_subfolder = "Bank Statements"
        audit_code = "BS-100"
        audit_subitem = "Bank reconciliation" if "recon" in text_corpus else "Bank statements"
        section_code = "02_BANKING"
    elif re.search(r"tax|zimra|itf263|vat|withholding|paye", text_corpus):
        category = "tax"
        target_subfolder = "Tax Filings"
        audit_code = "BS-600"
        audit_subitem = "ZIMRA tax clearance (ITF263)" if "clearance" in text_corpus or "itf263" in text_corpus else "Tax returns"
        section_code = "08_TAX"
    elif re.search(r"asset|equipment|plant|yellow plant|grader|excavator|truck|dozer", text_corpus):
        category = "assets"
        target_subfolder = "Plant & Equipment"
        audit_code = "BS-400"
        audit_subitem = "Purchase documents" if "purchase" in text_corpus or "invoice" in text_corpus else "Asset register"
        section_code = "10_PLANT_EQUIPMENT"
    elif re.search(r"payroll|salary|wage|payslip|nssa", text_corpus):
        category = "payroll"
        target_subfolder = "Payroll Records"
        audit_code = "BS-600"
        audit_subitem = "PAYE returns"
        section_code = "07_PAYROLL"
    elif re.search(r"loan|facility|repayment|debenture|borrowing|overdraft", text_corpus):
        category = "loans"
        target_subfolder = "Loan Agreements"
        audit_code = "BS-700"
        audit_subitem = "Facility agreements"
        section_code = "11_LOANS_LIABILITIES"
    elif re.search(r"share|cr6|cr14|cr2|memorandum|articles|equity", text_corpus):
        category = "equity"
        target_subfolder = "Statutory & Equity"
        audit_code = "BS-800"
        audit_subitem = "Share register"
        section_code = "01_CORPORATE"

    # 4. Synthesize Target Folder Path
    if matched_project:
        folder_path = f"05 PROJECTS/{matched_project['name']}/{target_subfolder}/{fiscal_year}"
    else:
        # Route by section
        sec_meta = next((s for s in STANDARD_SECTIONS if s["code"] == section_code), STANDARD_SECTIONS[0])
        folder_path = f"{sec_meta['name']}/{fiscal_year}"

    return ok(
        {
            "suggested_folder_path": folder_path,
            "section_code": section_code,
            "project_id": str(matched_project["id"]) if matched_project else None,
            "project_name": matched_project["name"] if matched_project else None,
            "project_code": matched_project.get("project_code") if matched_project else None,
            "fiscal_year": fiscal_year,
            "audit_code": audit_code,
            "audit_subitem": audit_subitem,
            "category": category,
        },
        "Document classified successfully.",
    )


@router.post("/upload-path")
async def issue_data_room_upload_path(
    payload: UploadPathRequest,
    user: dict = Depends(require_permission("finance.data_room.upload")),
):
    """Issues a storage path scoped to the caller's organization. The
    frontend must upload the file to exactly this path in Supabase Storage
    before calling /upload; /upload rejects any path outside this prefix so
    a document record can never be pointed at another tenant's object."""
    ext_match = re.search(r"\.([A-Za-z0-9]{1,10})$", payload.file_name)
    ext = f".{ext_match.group(1).lower()}" if ext_match else ""
    storage_path = f"{_org_storage_prefix(user['org_id'])}{uuid4().hex}{ext}"
    return ok({"storage_path": storage_path}, "Upload path issued.")


@router.post("/upload", status_code=status.HTTP_201_CREATED)
async def upload_data_room_document(
    payload: DocumentUpload,
    user: dict = Depends(require_permission("finance.data_room.upload")),
    db: AsyncSession = Depends(get_db),
):
    """Registers an uploaded file into the Financial Data Room.
    Automatically ensures destination folders exist and updates the audit checklist."""
    org_id = user["org_id"]
    user_id = user["user_id"]

    if not _is_storage_path_bound_to_org(payload.storage_path, org_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Storage path was not issued to your organization. Request a fresh upload path.",
        )

    # If folder_path is missing or empty, infer via classifier logic
    folder_path = (payload.folder_path or "").strip().strip("/")
    section_code = payload.section_code or "01_CORPORATE"

    if not folder_path:
        if payload.project_id:
            # Look up project name
            proj_row = (await db.execute(
                text("SELECT name FROM projects.projects WHERE id = :id AND organization_id = :org_id"),
                {"id": payload.project_id, "org_id": org_id},
            )).mappings().first()
            p_name = proj_row["name"] if proj_row else "Project"
            year = payload.fiscal_year or datetime.now(timezone.utc).year
            folder_path = f"05 PROJECTS/{p_name}/Receipts & Invoices/{year}"
            section_code = "05_PROJECTS"
        else:
            year = payload.fiscal_year or datetime.now(timezone.utc).year
            folder_path = f"01 CORPORATE/{year}"

    # Determine section_code from folder root
    root_token = folder_path.split("/")[0] if "/" in folder_path else folder_path
    sec_match = next((s for s in STANDARD_SECTIONS if s["name"].lower() == root_token.lower()), None)
    if sec_match:
        section_code = sec_match["code"]

    # Ensure folder and intermediate parents exist in finance.data_room_folders
    await _ensure_folder_exists(
        db,
        org_id=org_id,
        folder_path=folder_path,
        section_code=section_code,
        project_id=payload.project_id,
        user_id=user_id,
    )

    # Insert document record
    try:
        doc_id = (
            await db.execute(
                text("""
                    INSERT INTO finance.data_room_documents (
                        organization_id, folder_path, title, section_code, audit_code,
                        audit_subitem, project_id, fiscal_year, document_date, amount,
                        currency, file_name, file_size_bytes, mime_type, storage_path,
                        verification_status, metadata, created_by
                    ) VALUES (
                        :org_id, :folder_path, :title, :section_code, :audit_code,
                        :audit_subitem, :project_id, :fiscal_year, :document_date, :amount,
                        :currency, :file_name, :file_size_bytes, :mime_type, :storage_path,
                        'unverified', :metadata, :created_by
                    ) RETURNING id
                """),
                {
                    "org_id": org_id,
                    "folder_path": folder_path,
                    "title": payload.title,
                    "section_code": section_code,
                    "audit_code": payload.audit_code,
                    "audit_subitem": payload.audit_subitem,
                    "project_id": payload.project_id,
                    "fiscal_year": payload.fiscal_year or datetime.now(timezone.utc).year,
                    "document_date": payload.document_date or date.today(),
                    "amount": payload.amount,
                    "currency": payload.currency or "USD",
                    "file_name": payload.file_name,
                    "file_size_bytes": payload.file_size_bytes or 0,
                    "mime_type": payload.mime_type or "application/octet-stream",
                    "storage_path": payload.storage_path,
                    "metadata": json.dumps(payload.metadata or {}),
                    "created_by": user_id,
                },
            )
        ).scalar()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This storage object is already registered against a Data Room document.",
        )

    # If linked to an audit checklist item, mark as in_progress if still pending
    if payload.audit_code and payload.audit_subitem:
        await db.execute(
            text("""
                UPDATE finance.bankability_checklists
                SET status = 'in_progress', updated_at = NOW()
                WHERE organization_id = :org_id
                  AND audit_code = :audit_code
                  AND item_name = :audit_subitem
                  AND status = 'pending'
            """),
            {"org_id": org_id, "audit_code": payload.audit_code, "audit_subitem": payload.audit_subitem},
        )

    await db.commit()
    return ok({"id": str(doc_id), "folder_path": folder_path}, "Document registered in Data Room.")


@router.post("/create-folder", status_code=status.HTTP_201_CREATED)
async def create_data_room_folder(
    payload: FolderCreate,
    user: dict = Depends(require_permission("finance.data_room.manage")),
    db: AsyncSession = Depends(get_db),
):
    """Creates a custom folder or subfolder in the Data Room."""
    org_id = user["org_id"]
    parent = payload.parent_path.strip().strip("/")
    name = payload.folder_name.strip().strip("/")
    full_path = f"{parent}/{name}" if parent else name

    await _ensure_folder_exists(
        db,
        org_id=org_id,
        folder_path=full_path,
        section_code=payload.section_code,
        project_id=payload.project_id,
        user_id=user["user_id"],
    )
    await db.commit()
    return ok({"folder_path": full_path}, "Folder created successfully.")


@router.get("/documents/{document_id}/signed-url")
async def get_data_room_document_signed_url(
    document_id: UUID,
    user: dict = Depends(require_permission("finance.data_room.read")),
    db: AsyncSession = Depends(get_db),
):
    """Mints a signed download/preview URL for a Data Room document."""
    doc_row = (
        await db.execute(
            text("""
                SELECT storage_path, file_name, mime_type
                FROM finance.data_room_documents
                WHERE id = :id AND organization_id = :org_id AND is_deleted = false
            """),
            {"id": document_id, "org_id": user["org_id"]},
        )
    ).mappings().first()

    if not doc_row:
        raise HTTPException(status_code=404, detail="Document not found.")

    try:
        signed = supabase.storage.from_(DOCUMENTS_BUCKET).create_signed_url(
            doc_row["storage_path"], SIGNED_URL_TTL_SECONDS
        )
        url = signed.get("signedURL")
        if not url:
            raise HTTPException(status_code=502, detail="Failed to mint signed URL.")
        return ok({
            "url": url,
            "file_name": doc_row["file_name"],
            "mime_type": doc_row["mime_type"],
            "expires_in": SIGNED_URL_TTL_SECONDS,
        })
    except Exception as e:
        logger.exception("Failed to create signed URL for data room document", exc_info=e)
        raise HTTPException(status_code=502, detail="Storage service error.")


@router.patch("/documents/{document_id}/status")
async def update_data_room_document_status(
    document_id: UUID,
    payload: DocumentStatusUpdate,
    user: dict = Depends(require_permission("finance.data_room.verify")),
    db: AsyncSession = Depends(get_db),
):
    """Auditor or Finance Manager verification sign-off for a specific document."""
    result = await db.execute(
        text("""
            UPDATE finance.data_room_documents
            SET verification_status = :status,
                audit_notes = :notes,
                verified_by = :user_id,
                verified_at = NOW(),
                updated_at = NOW()
            WHERE id = :id AND organization_id = :org_id AND is_deleted = false
            RETURNING id
        """),
        {
            "id": document_id,
            "status": payload.verification_status,
            "notes": payload.audit_notes,
            "user_id": user["user_id"],
            "org_id": user["org_id"],
        },
    )
    if not result.first():
        await db.rollback()
        raise HTTPException(status_code=404, detail="Document not found.")
    await db.commit()
    return ok({"id": str(document_id)}, "Document verification status updated.")


@router.delete("/documents/{document_id}")
async def delete_data_room_document(
    document_id: UUID,
    user: dict = Depends(require_permission("finance.data_room.manage")),
    db: AsyncSession = Depends(get_db),
):
    """Soft deletes a document from the Financial Data Room."""
    result = await db.execute(
        text("""
            UPDATE finance.data_room_documents
            SET is_deleted = true, updated_at = NOW()
            WHERE id = :id AND organization_id = :org_id AND is_deleted = false
            RETURNING id
        """),
        {"id": document_id, "org_id": user["org_id"]},
    )
    if not result.first():
        await db.rollback()
        raise HTTPException(status_code=404, detail="Document not found.")
    await db.commit()
    return ok({"id": str(document_id)}, "Document removed from Data Room.")


@router.get("/bankability-matrix")
async def get_bankability_matrix(
    user: dict = Depends(require_permission("finance.data_room.read")),
    db: AsyncSession = Depends(get_db),
):
    """Returns the complete BS-100 through BS-800 bankability checklist with
    readiness metrics, attached proof count, and verification status."""
    org_id = user["org_id"]

    # 1. Fetch checklist items
    items_res = await db.execute(
        text("""
            SELECT c.*, u.full_name AS verified_by_name
            FROM finance.bankability_checklists c
            LEFT JOIN core.users u ON u.id = c.verified_by
            WHERE c.organization_id = :org_id AND c.is_deleted = false
            ORDER BY c.audit_code ASC, c.item_name ASC
        """),
        {"org_id": org_id},
    )
    checklist_items = [dict(r._mapping) for r in items_res]

    # 2. Count attached proof documents per checklist item
    proof_counts_res = await db.execute(
        text("""
            SELECT audit_code, audit_subitem, COUNT(id) AS proof_count
            FROM finance.data_room_documents
            WHERE organization_id = :org_id AND is_deleted = false AND audit_code IS NOT NULL
            GROUP BY audit_code, audit_subitem
        """),
        {"org_id": org_id},
    )
    proof_map = {(r["audit_code"], r["audit_subitem"]): r["proof_count"] for r in proof_counts_res}

    # Group by BS-xxx category
    grouped: Dict[str, Any] = {}
    for code, info in BS_CATEGORIES.items():
        grouped[code] = {
            "code": code,
            "category": info["category"],
            "items": [],
            "total": 0,
            "verified": 0,
            "in_progress": 0,
            "pending": 0,
        }

    for item in checklist_items:
        code = item["audit_code"]
        if code not in grouped:
            grouped[code] = {
                "code": code,
                "category": item["category_name"],
                "items": [],
                "total": 0,
                "verified": 0,
                "in_progress": 0,
                "pending": 0,
            }
        item["proof_count"] = proof_map.get((code, item["item_name"]), 0)
        grouped[code]["items"].append(item)
        grouped[code]["total"] += 1
        if item["status"] == "verified":
            grouped[code]["verified"] += 1
        elif item["status"] == "in_progress":
            grouped[code]["in_progress"] += 1
        else:
            grouped[code]["pending"] += 1

    total_all = len(checklist_items) or 1
    verified_all = sum(g["verified"] for g in grouped.values())
    overall_readiness_pct = round((verified_all / total_all) * 100, 1)

    return ok(
        {
            "categories": list(grouped.values()),
            "overall_readiness_pct": overall_readiness_pct,
            "total_items": len(checklist_items),
            "verified_items": verified_all,
        },
        "Bankability audit matrix retrieved.",
    )


@router.post("/bankability-matrix/{item_id}/verify")
async def verify_bankability_item(
    item_id: UUID,
    payload: ChecklistVerify,
    user: dict = Depends(require_permission("finance.data_room.verify")),
    db: AsyncSession = Depends(get_db),
):
    """Marks an audit criterion verified or waived."""
    result = await db.execute(
        text("""
            UPDATE finance.bankability_checklists
            SET status = :status,
                notes = :notes,
                verified_by = :user_id,
                verified_at = NOW(),
                updated_at = NOW()
            WHERE id = :id AND organization_id = :org_id AND is_deleted = false
            RETURNING id
        """),
        {
            "id": item_id,
            "status": payload.status,
            "notes": payload.notes,
            "user_id": user["user_id"],
            "org_id": user["org_id"],
        },
    )
    if not result.first():
        await db.rollback()
        raise HTTPException(status_code=404, detail="Checklist item not found.")
    await db.commit()
    return ok({"id": str(item_id)}, "Bankability checklist item updated.")


@router.get("/export")
async def export_data_room(
    folder_path: Optional[str] = None,
    project_id: Optional[UUID] = None,
    user: dict = Depends(require_permission("finance.data_room.export")),
    db: AsyncSession = Depends(get_db),
):
    """Streams a comprehensive, structured ZIP archive of the Data Room or an
    isolated project folder, preserving the authoritative directory hierarchy,
    accompanied by AUDIT_MANIFEST.json and INDEX.html for offline bank review."""
    org_id = user["org_id"]

    # 1. Query documents to include
    query_str = """
        SELECT d.*, p.name AS project_name, p.project_code, u.full_name AS author_name
        FROM finance.data_room_documents d
        LEFT JOIN projects.projects p ON p.id = d.project_id
        LEFT JOIN core.users u ON u.id = d.created_by
        WHERE d.organization_id = :org_id AND d.is_deleted = false
    """
    params: Dict[str, Any] = {"org_id": org_id}

    if folder_path:
        clean_prefix = folder_path.strip().strip("/")
        query_str += " AND (d.folder_path = :folder_path OR d.folder_path LIKE :folder_prefix)"
        params["folder_path"] = clean_prefix
        params["folder_prefix"] = f"{clean_prefix}/%"

    if project_id:
        query_str += " AND d.project_id = :project_id"
        params["project_id"] = project_id

    query_str += " ORDER BY d.folder_path ASC, d.file_name ASC"

    result = await db.execute(text(query_str), params)
    docs = [dict(r._mapping) for r in result]

    # 2. Build In-Memory ZIP Archive
    zip_buffer = io.BytesIO()
    manifest_entries = []

    with zipfile.ZipFile(zip_buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        for doc in docs:
            rel_file_path = _safe_zip_path(doc["folder_path"], doc["file_name"], f"UNNAMED_{doc['id']}")

            # Attempt to download binary from Supabase Storage
            file_bytes = None
            try:
                download_res = supabase.storage.from_(DOCUMENTS_BUCKET).download(doc["storage_path"])
                if download_res:
                    file_bytes = download_res
            except Exception as e:
                logger.warning(f"Could not download object {doc['storage_path']} for export: {e}")

            retrieval_status = "retrieved"
            if file_bytes is None:
                # Do not fabricate a "verified" record for evidence we could not
                # actually retrieve: record the gap under a distinct filename so
                # nobody mistakes this note for the original document.
                retrieval_status = "missing"
                missing_notice = f"""SNC FINANCIAL DATA ROOM - ATTACHMENT UNAVAILABLE
--------------------------------------------------
This file could not be retrieved from storage at export time.
Document Title: {doc['title']}
Original File Name: {doc['file_name']}
Audit Code: {doc.get('audit_code') or 'N/A'}
Audit Item: {doc.get('audit_subitem') or 'N/A'}
Verification Status: {doc['verification_status']}
Storage Identifier: {doc['storage_path']}
This note does not certify that the underlying document was reviewed or verified.
"""
                file_bytes = missing_notice.encode("utf-8")
                rel_file_path = f"{rel_file_path}.MISSING.txt"

            zf.writestr(rel_file_path, file_bytes)

            manifest_entries.append({
                "path": rel_file_path,
                "title": doc["title"],
                "section": doc["section_code"],
                "audit_code": doc.get("audit_code"),
                "audit_subitem": doc.get("audit_subitem"),
                "verification_status": doc["verification_status"],
                "retrieval_status": retrieval_status,
                "size_bytes": doc.get("file_size_bytes") or len(file_bytes),
                "date": str(doc["document_date"]),
                "author": doc.get("author_name") or "AEGIS Ledger",
            })

        # Generate AUDIT_MANIFEST.json
        manifest_data = {
            "export_timestamp": datetime.now(timezone.utc).isoformat(),
            "exported_by": user.get("email") or "AEGIS Finance System",
            "scope": folder_path or "FULL_SNC_FINANCIAL_DATA_ROOM",
            "total_documents": len(docs),
            "documents": manifest_entries,
        }
        zf.writestr("AUDIT_MANIFEST.json", json.dumps(manifest_data, indent=2))

        # Generate INDEX.html for offline browser inspection by bankers & auditors.
        # Every value below originates from user-supplied titles/paths/notes, so
        # it must be HTML-escaped before interpolation to avoid producing active
        # content when this offline index is opened in a browser.
        def esc(value: Any) -> str:
            return html.escape(str(value if value is not None else ""), quote=True)

        rows_html = "".join([
            f"""<tr>
                <td style="padding: 8px; border-bottom: 1px solid #334155; font-family: monospace; font-size: 11px;">{esc(m['path'])}</td>
                <td style="padding: 8px; border-bottom: 1px solid #334155; font-weight: 500;">{esc(m['title'])}</td>
                <td style="padding: 8px; border-bottom: 1px solid #334155; color: #38bdf8;">{esc(m['audit_code']) or '—'}</td>
                <td style="padding: 8px; border-bottom: 1px solid #334155;">{esc(m['audit_subitem']) or '—'}</td>
                <td style="padding: 8px; border-bottom: 1px solid #334155;">
                    <span style="background: {'#064e3b; color: #34d399' if m['verification_status'] == 'verified' else '#1e293b; color: #94a3b8'}; padding: 2px 8px; border-radius: 4px; font-size: 11px; text-transform: uppercase;">
                        {esc(m['verification_status'])}{' (missing)' if m['retrieval_status'] == 'missing' else ''}
                    </span>
                </td>
                <td style="padding: 8px; border-bottom: 1px solid #334155; font-size: 12px;">{esc(m['date'])}</td>
            </tr>"""
            for m in manifest_entries
        ])

        index_html = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>SNC Financial Data Room - Offline Audit Dossier</title>
    <style>
        body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; margin: 0; padding: 32px; }}
        h1 {{ font-size: 24px; color: #f8fafc; margin-bottom: 4px; }}
        p.sub {{ color: #94a3b8; font-size: 14px; margin-top: 0; margin-bottom: 24px; }}
        .badge {{ background: #0284c7; color: #ffffff; padding: 4px 10px; border-radius: 4px; font-weight: bold; font-size: 12px; }}
        table {{ width: 100%; border-collapse: collapse; background: #1e293b; border-radius: 8px; overflow: hidden; font-size: 13px; }}
        th {{ background: #0b1120; color: #94a3b8; text-align: left; padding: 10px 8px; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; }}
    </style>
</head>
<body>
    <h1>SNC FINANCIAL DATA ROOM — AUDIT PACKAGE</h1>
    <p class="sub">Generated by AEGIS Institutional Ledger on {esc(manifest_data['export_timestamp'])} | Scope: {esc(manifest_data['scope'])}</p>
    <div style="margin-bottom: 16px;">
        <span class="badge">{len(docs)} Files Indexed</span>
    </div>
    <table>
        <thead>
            <tr>
                <th>Directory Path</th>
                <th>Title</th>
                <th>Audit Code</th>
                <th>Audit Category</th>
                <th>Status</th>
                <th>Recorded Date</th>
            </tr>
        </thead>
        <tbody>
            {rows_html}
        </tbody>
    </table>
</body>
</html>"""
        zf.writestr("INDEX.html", index_html)

    zip_buffer.seek(0)
    filename = f"SNC_DATA_ROOM_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.zip"

    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
