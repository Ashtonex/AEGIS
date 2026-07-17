from pathlib import Path
from typing import Any, Dict

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.encoders import jsonable_encoder
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.services.documents.renderers import (
    QuotationExcelExporter,
    QuotationPDFRenderer,
)
from app.services.quotations.boq_importer import BOQImporter
from app.services.quotations.calculator import QuotationCalculator
from core.config import settings
from core.database import get_db
from core.security import get_current_user
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

    params = {k: payload[k] for k in safe_keys}
    params["org_id"] = user["org_id"]
    params["user_id"] = user["sub"]

    query = insert_returning_id_sql("finance.quotations", safe_keys, safe_keys)

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

    params = {k: payload[k] for k in safe_keys}
    params["item_id"] = item_id
    params["org_id"] = user["org_id"]

    query = update_returning_id_sql("finance.quotations", safe_keys, safe_keys)

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
