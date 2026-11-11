"""Payroll phase 2: where employees are paid, bank payment files, monthly PAYE
and NSSA return schedules, export layouts and the export log.

Mounted at /api/v1/payroll next to payroll_config (same prefix, distinct paths).
"""
from __future__ import annotations

from datetime import date
from typing import Any, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.finance import payroll_exports as px
from app.services.finance.payroll_service import PayrollServiceError
from app.shared.pagination import ok
from core.database import get_db
from core.security import require_permission

router = APIRouter()


def _org(user: dict) -> str:
    org_id = user.get("org_id")
    if not org_id:
        raise HTTPException(status_code=403, detail="No organisation linked to this account.")
    return str(org_id)


def _http(exc: PayrollServiceError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=exc.detail)


def _month(value: str) -> date:
    try:
        year, month = value.split("-")
        return date(int(year), int(month), 1)
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=422, detail="Month must be YYYY-MM.") from exc


def _layout_path_id(layout_id: str) -> str:
    if layout_id.startswith("builtin:"):
        raise HTTPException(status_code=409, detail="Built-in layouts can't be changed or removed. Save a copy under a new name.")
    try:
        return str(UUID(layout_id))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Export layout not found.") from exc


def _currency(value: str) -> str:
    value = (value or "").strip().upper()
    if len(value) != 3 or not value.isalpha():
        raise HTTPException(status_code=422, detail="Currency must be a 3-letter code.")
    return value


# ---------------------------------------------------------------------------
# Field catalogue and layouts
# ---------------------------------------------------------------------------

@router.get("/export-fields", summary="Columns available for bank files and return schedules")
async def get_export_fields(user: dict = Depends(require_permission("finance.payroll.read"))):
    return ok({
        "fields": {kind: [{"key": f.key, "label": f.label, "type": f.type} for f in defs.values()]
                   for kind, defs in px.FIELDS.items()},
        "delimiters": list(px.DELIMITERS),
        "date_formats": list(px.DATE_FORMATS),
    }, "Export fields listed.")


class LayoutColumn(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    field: str = Field(min_length=1, max_length=40)
    header: Optional[str] = Field(default=None, max_length=80)
    value: Optional[str] = Field(default=None, max_length=80)


class LayoutBase(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    description: Optional[str] = Field(default=None, max_length=1000)
    delimiter: Optional[str] = None
    include_header: Optional[bool] = None
    date_format: Optional[str] = None
    columns: Optional[list[LayoutColumn]] = None


class LayoutCreate(LayoutBase):
    kind: str = Field(pattern=r"^(bank|paye|nssa)$")
    name: str = Field(min_length=1, max_length=120)
    delimiter: str = ","
    include_header: bool = True
    date_format: str = "DD/MM/YYYY"
    columns: list[LayoutColumn] = Field(min_length=1)


@router.get("/export-layouts", summary="Export layouts (built-in and the organisation's own)")
async def get_export_layouts(
    kind: Optional[str] = Query(default=None, pattern=r"^(bank|paye|nssa)$"),
    user: dict = Depends(require_permission("finance.payroll.read")),
    db: AsyncSession = Depends(get_db),
):
    return ok(await px.list_layouts(db, _org(user), kind), "Export layouts listed.")


@router.post("/export-layouts", status_code=status.HTTP_201_CREATED, summary="Save an export layout")
async def create_export_layout(
    payload: LayoutCreate,
    user: dict = Depends(require_permission("finance.payroll.export")),
    db: AsyncSession = Depends(get_db),
):
    org_id = _org(user)
    try:
        columns = px.validate_layout(payload.kind, [c.model_dump() for c in payload.columns],
                                     payload.delimiter, payload.date_format)
        new_id = (await db.execute(
            text("""
                INSERT INTO finance.payroll_export_layouts (
                    organization_id, kind, name, description, delimiter, include_header, date_format, columns,
                    created_by, updated_by
                ) VALUES (
                    :org_id, :kind, :name, :description, :delimiter, :include_header, :date_format,
                    CAST(:columns AS jsonb), :user_id, :user_id
                ) RETURNING id
            """),
            {"org_id": org_id, "kind": payload.kind, "name": payload.name, "description": payload.description,
             "delimiter": payload.delimiter, "include_header": payload.include_header,
             "date_format": payload.date_format, "columns": _json(columns), "user_id": user.get("sub")},
        )).scalar_one()
        await db.commit()
    except PayrollServiceError as exc:
        await db.rollback()
        raise _http(exc) from exc
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=409, detail=f"A {payload.kind} layout called '{payload.name}' already exists.") from exc
    return ok({"id": str(new_id)}, "Export layout saved.")


@router.patch("/export-layouts/{layout_id}", summary="Change an export layout")
async def update_export_layout(
    layout_id: str,
    payload: LayoutBase,
    user: dict = Depends(require_permission("finance.payroll.export")),
    db: AsyncSession = Depends(get_db),
):
    org_id = _org(user)
    layout_id = _layout_path_id(layout_id)
    current = (await db.execute(
        text("""
            SELECT kind, name, description, delimiter, include_header, date_format, columns
            FROM finance.payroll_export_layouts
            WHERE id = CAST(:id AS uuid) AND organization_id = :org_id AND is_active = true
        """),
        {"id": layout_id, "org_id": org_id},
    )).mappings().first()
    if not current:
        raise HTTPException(status_code=404, detail="Export layout not found.")
    changes = payload.model_dump(exclude_unset=True)
    merged = {**dict(current), **{k: v for k, v in changes.items() if v is not None or k == "description"}}
    try:
        merged["columns"] = px.validate_layout(current["kind"], merged["columns"], merged["delimiter"], merged["date_format"])
        await db.execute(
            text("""
                UPDATE finance.payroll_export_layouts
                SET name = :name, description = :description, delimiter = :delimiter,
                    include_header = :include_header, date_format = :date_format,
                    columns = CAST(:columns AS jsonb), updated_by = :user_id, updated_at = NOW()
                WHERE id = CAST(:id AS uuid) AND organization_id = :org_id
            """),
            {"id": layout_id, "org_id": org_id, "name": merged["name"], "description": merged["description"],
             "delimiter": merged["delimiter"], "include_header": merged["include_header"],
             "date_format": merged["date_format"], "columns": _json(merged["columns"]), "user_id": user.get("sub")},
        )
        await db.commit()
    except PayrollServiceError as exc:
        await db.rollback()
        raise _http(exc) from exc
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=409, detail=f"A layout called '{merged['name']}' already exists.") from exc
    return ok({"id": layout_id}, "Export layout updated.")


@router.delete("/export-layouts/{layout_id}", summary="Retire an export layout")
async def delete_export_layout(
    layout_id: str,
    user: dict = Depends(require_permission("finance.payroll.export")),
    db: AsyncSession = Depends(get_db),
):
    layout_id = _layout_path_id(layout_id)
    result = await db.execute(
        text("""
            UPDATE finance.payroll_export_layouts
            SET is_active = false, updated_by = :user_id, updated_at = NOW(),
                name = name || ' (retired ' || to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS') || ')'
            WHERE id = CAST(:id AS uuid) AND organization_id = :org_id AND is_active = true
        """),
        {"id": layout_id, "org_id": _org(user), "user_id": user.get("sub")},
    )
    if not result.rowcount:
        raise HTTPException(status_code=404, detail="Export layout not found.")
    await db.commit()
    return ok({"id": layout_id}, "Export layout retired.")


def _json(value: Any) -> str:
    import json
    return json.dumps(value)


# ---------------------------------------------------------------------------
# Where employees are paid
# ---------------------------------------------------------------------------

class PaymentAccountCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    employee_id: UUID
    currency: str = Field(min_length=3, max_length=3)
    method: str = Field(pattern=r"^(bank|mobile_money|cash)$")
    bank_name: Optional[str] = Field(default=None, max_length=120)
    branch_code: Optional[str] = Field(default=None, max_length=40)
    branch_name: Optional[str] = Field(default=None, max_length=120)
    account_number: Optional[str] = Field(default=None, max_length=60)
    account_name: Optional[str] = Field(default=None, max_length=160)
    mobile_number: Optional[str] = Field(default=None, max_length=40)
    effective_from: Optional[date] = None

    @model_validator(mode="after")
    def check_method(self) -> "PaymentAccountCreate":
        if self.method == "bank" and not (self.bank_name and self.account_number):
            raise ValueError("A bank account needs the bank name and account number.")
        if self.method == "mobile_money" and not self.mobile_number:
            raise ValueError("Mobile money needs the wallet number.")
        if self.account_number and not self.account_number.replace(" ", "").replace("-", "").isalnum():
            raise ValueError("Account number may only contain letters, digits, spaces and dashes.")
        if self.method != "bank":
            self.bank_name = self.branch_code = self.branch_name = self.account_number = None
        if self.method != "mobile_money":
            self.mobile_number = None
        return self


class EndPaymentAccount(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    reason: str = Field(min_length=5, max_length=500)


@router.get("/payment-accounts", summary="Where employees are paid (account numbers masked)")
async def get_payment_accounts(
    employee_id: Optional[UUID] = Query(default=None),
    include_ended: bool = Query(default=False),
    user: dict = Depends(require_permission("finance.payroll.read")),
    db: AsyncSession = Depends(get_db),
):
    return ok(await px.list_payment_accounts(db, _org(user), str(employee_id) if employee_id else None, include_ended), "Payment accounts listed.")


@router.post("/payment-accounts", status_code=status.HTTP_201_CREATED, summary="Set where an employee is paid in a currency")
async def create_payment_account(
    payload: PaymentAccountCreate,
    user: dict = Depends(require_permission("finance.payroll.payment_details.manage")),
    db: AsyncSession = Depends(get_db),
):
    values = payload.model_dump()
    values["currency"] = _currency(payload.currency)
    try:
        new_id, replaced = await px.add_payment_account(db, org_id=_org(user), user_id=user.get("sub"),
                                              employee_id=str(payload.employee_id), values=values)
        await db.commit()
    except PayrollServiceError as exc:
        await db.rollback()
        raise _http(exc) from exc
    message = ("Payment account saved. The previous one in this currency was ended and kept in the history."
               if replaced else "Payment account saved.")
    return ok({"id": new_id, "replaced": replaced}, message)


@router.post("/payment-accounts/{account_id}/end", summary="Stop paying into an account")
async def end_payment_account(
    account_id: UUID,
    payload: EndPaymentAccount,
    user: dict = Depends(require_permission("finance.payroll.payment_details.manage")),
    db: AsyncSession = Depends(get_db),
):
    try:
        await px.end_payment_account(db, org_id=_org(user), user_id=user.get("sub"),
                                     account_id=str(account_id), reason=payload.reason)
        await db.commit()
    except PayrollServiceError as exc:
        await db.rollback()
        raise _http(exc) from exc
    return ok({"id": str(account_id)}, "Payment account ended.")


# ---------------------------------------------------------------------------
# Bank file
# ---------------------------------------------------------------------------

class BankFileRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    currency: str = Field(min_length=3, max_length=3)
    layout_id: Optional[str] = Field(default=None, max_length=60)
    # The file can be produced again (lost file, bank rejected it), but only
    # knowingly: paying the same run twice is the costly mistake.
    confirm_repeat: bool = False
    # Accounts added or changed in the last 30 days must be acknowledged.
    confirm_recent_changes: bool = False


@router.get("/runs/{run_id}/bank-file", summary="Preview a run's bank file for one currency")
async def preview_bank_file(
    run_id: UUID,
    currency: str = Query(min_length=3, max_length=3),
    user: dict = Depends(require_permission("finance.payroll.export")),
    db: AsyncSession = Depends(get_db),
):
    try:
        preview = await px.bank_file_preview(db, _org(user), str(run_id), _currency(currency))
    except PayrollServiceError as exc:
        raise _http(exc) from exc
    return ok(px.preview_for_client(preview), "Bank file preview.")


@router.post("/runs/{run_id}/bank-file", summary="Produce a run's bank file for one currency")
async def produce_bank_file(
    run_id: UUID,
    payload: BankFileRequest,
    user: dict = Depends(require_permission("finance.payroll.export")),
    db: AsyncSession = Depends(get_db),
):
    org_id = _org(user)
    currency = _currency(payload.currency)
    try:
        layout = await px.get_layout(db, org_id, "bank", payload.layout_id)
        preview = await px.bank_file_preview(db, org_id, str(run_id), currency)
        if preview["problems"]:
            raise PayrollServiceError(409, " ".join(preview["problems"]))
        if not preview["rows"]:
            raise PayrollServiceError(409, f"Nobody on this run is paid into a bank account in {currency}.")
        if preview["previous_exports"] and not payload.confirm_repeat:
            last = preview["previous_exports"][0]
            raise PayrollServiceError(
                409, f"A {currency} bank file for this run was already produced on {last['generated_at']:%Y-%m-%d %H:%M}"
                     f" by {last['generated_by_name'] or 'someone'}. Confirm to produce it again.")
        if preview["recent_changes"] and not payload.confirm_recent_changes:
            names = ", ".join(c["employee_name"] for c in preview["recent_changes"])
            raise PayrollServiceError(409, f"Payment accounts changed in the last {px.RECENT_CHANGE_DAYS} days: {names}. Confirm them before paying.")
        content = px.render_csv(layout, "bank", preview["rows"])
        run = preview["run"]
        file_name = f"{run['run_number']}-{currency}-bank-{run['payment_date']:%Y%m%d}.csv"
        total = preview["totals"]["bank"]
        export_id = await px.log_export(
            db, org_id=org_id, user_id=user.get("sub"), kind="bank", layout=layout, currency=currency,
            file_name=file_name, rows=len(preview["rows"]), total=total, content=content, run_id=str(run_id),
            warnings=[f"Recent account change: {c['employee_name']}" for c in preview["recent_changes"]],
        )
        await db.commit()
    except PayrollServiceError as exc:
        await db.rollback()
        raise _http(exc) from exc
    return ok({
        "export_id": export_id, "file_name": file_name, "content": content, "rows": len(preview["rows"]),
        "total": total, "cash": preview["totals"]["cash"], "mobile_money": preview["totals"]["mobile_money"],
        "sha256": px.sha256(content),
    }, "Bank file produced.")


# ---------------------------------------------------------------------------
# Monthly PAYE / NSSA schedules
# ---------------------------------------------------------------------------

class ReturnRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    month: str = Field(pattern=r"^\d{4}-\d{2}$")
    currency: str = Field(min_length=3, max_length=3)
    layout_id: Optional[str] = Field(default=None, max_length=60)


@router.get("/returns/{kind}", summary="Preview a month's PAYE or NSSA schedule")
async def preview_return(
    kind: str,
    month: str = Query(pattern=r"^\d{4}-\d{2}$"),
    currency: str = Query(min_length=3, max_length=3),
    user: dict = Depends(require_permission("finance.payroll.read")),
    db: AsyncSession = Depends(get_db),
):
    if kind not in ("paye", "nssa"):
        raise HTTPException(status_code=404, detail="Returns are 'paye' or 'nssa'.")
    try:
        data = await px.returns_preview(db, _org(user), kind, _month(month), _currency(currency))
    except PayrollServiceError as exc:
        raise _http(exc) from exc
    return ok(data, f"{kind.upper()} schedule preview.")


@router.post("/returns/{kind}/export", summary="Produce a month's PAYE or NSSA schedule file")
async def export_return(
    kind: str,
    payload: ReturnRequest,
    user: dict = Depends(require_permission("finance.payroll.export")),
    db: AsyncSession = Depends(get_db),
):
    if kind not in ("paye", "nssa"):
        raise HTTPException(status_code=404, detail="Returns are 'paye' or 'nssa'.")
    org_id = _org(user)
    month = _month(payload.month)
    currency = _currency(payload.currency)
    try:
        layout = await px.get_layout(db, org_id, kind, payload.layout_id)
        data = await px.returns_preview(db, org_id, kind, month, currency)
        if not data["rows"]:
            raise PayrollServiceError(409, f"No posted {currency} payroll with {kind.upper()} in {payload.month}.")
        content = px.render_csv(layout, kind, data["rows"])
        file_name = f"{kind.upper()}-{payload.month}-{currency}.csv"
        export_id = await px.log_export(
            db, org_id=org_id, user_id=user.get("sub"), kind=kind, layout=layout, currency=currency,
            file_name=file_name, rows=len(data["rows"]), total=data["total"], content=content, month=month,
            warnings=data["warnings"],
        )
        await db.commit()
    except PayrollServiceError as exc:
        await db.rollback()
        raise _http(exc) from exc
    return ok({
        "export_id": export_id, "file_name": file_name, "content": content, "rows": len(data["rows"]),
        "total": data["total"], "warnings": data["warnings"], "sha256": px.sha256(content),
    }, f"{kind.upper()} schedule produced.")


@router.get("/exports", summary="Files produced (bank files and return schedules)")
async def get_exports(
    limit: int = Query(default=50, ge=1, le=200),
    user: dict = Depends(require_permission("finance.payroll.read")),
    db: AsyncSession = Depends(get_db),
):
    return ok(await px.list_exports(db, _org(user), limit), "Exports listed.")
