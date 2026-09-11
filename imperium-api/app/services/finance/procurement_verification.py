"""
Procurement verification - anomaly *flags*, never blockers, for the
PO -> GRN -> Supplier Invoice -> Payment chain.

Per the master spec ("Flag discrepancies... do not blindly reject"), every
check here writes to the existing finance.ccb_monitor_findings table
(upsert-by-natural_key, same shape as app/services/finance/ccb_monitor.py)
and never raises past its own boundary - a bug in a check must never block
an invoice being created or a payment being approved. Nothing here changes
the existing header-level match_invoice computation or payment_decision's
approval gate; findings are advisory only.

Deliberately NOT checked: finance.commitments and finance.variations are
untouched (out of scope, see gl_bridge.py's own docstring for why), and no
finding is generated when supplier_invoice_lines don't exist for an invoice
(the common case today) - manufacturing a finding for every legacy
PO-based invoice would be noise, not signal.
"""

import json
from decimal import Decimal
from typing import Any
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

LINE_TOLERANCE_PCT = Decimal("0.01")
LINE_TOLERANCE_ABS = Decimal("1.00")
DUPLICATE_WINDOW_DAYS = 5


async def record_finding(
    db: AsyncSession,
    *,
    org_id: str,
    project_id: str,
    check_type: str,
    natural_key: str,
    severity: str,
    summary: str,
    evidence: dict[str, Any],
) -> None:
    """Upsert-by-natural_key, same shape as ccb_monitor.py's _upsert_finding
    (kept as an independent copy rather than a cross-module import of a
    private helper, so this file has no dependency on ccb_monitor.py's
    internals)."""
    existing = (
        await db.execute(
            text("""
                SELECT status FROM finance.ccb_monitor_findings
                WHERE organization_id = :org_id AND natural_key = :natural_key
            """),
            {"org_id": org_id, "natural_key": natural_key},
        )
    ).first()
    newly_open = existing is None or existing.status == "resolved"

    await db.execute(
        text("""
            INSERT INTO finance.ccb_monitor_findings (
                organization_id, project_id, check_type, natural_key,
                severity, status, summary, evidence,
                first_detected_at, last_seen_at, last_notified_at
            ) VALUES (
                :org_id, :project_id, :check_type, :natural_key,
                :severity, 'open', :summary, CAST(:evidence AS jsonb),
                NOW(), NOW(), CASE WHEN :newly_open THEN NOW() ELSE NULL END
            )
            ON CONFLICT (organization_id, natural_key) DO UPDATE SET
                severity = EXCLUDED.severity,
                summary = EXCLUDED.summary,
                evidence = EXCLUDED.evidence,
                last_seen_at = NOW(),
                status = CASE WHEN :newly_open THEN 'open' ELSE finance.ccb_monitor_findings.status END,
                resolved_at = CASE WHEN :newly_open THEN NULL ELSE finance.ccb_monitor_findings.resolved_at END,
                resolved_by = CASE WHEN :newly_open THEN NULL ELSE finance.ccb_monitor_findings.resolved_by END,
                last_notified_at = CASE WHEN :newly_open THEN NOW() ELSE finance.ccb_monitor_findings.last_notified_at END
        """),
        {
            "org_id": org_id,
            "project_id": project_id,
            "check_type": check_type,
            "natural_key": natural_key,
            "severity": severity,
            "summary": summary,
            "evidence": json.dumps(evidence, default=str),
            "newly_open": newly_open,
        },
    )


async def check_invoice_at_creation(db: AsyncSession, *, org_id: str, invoice_id: UUID) -> None:
    """Called once, additively, at the end of create_invoice. Never raises -
    any failure here must not block invoice registration."""
    try:
        row = await db.execute(
            text("""
                SELECT inv.id, inv.project_id, inv.supplier_id, inv.grn_id, inv.total_amount,
                       inv.invoice_date, inv.supplier_invoice_ref,
                       s.status AS supplier_status, s.supplier_name
                FROM procurement.supplier_invoices inv
                JOIN procurement.suppliers s ON s.id = inv.supplier_id AND s.organization_id = inv.organization_id
                WHERE inv.id = :id AND inv.organization_id = :org_id
            """),
            {"id": invoice_id, "org_id": org_id},
        )
        inv = row.mappings().first()
        if not inv:
            return

        if inv["grn_id"] is None:
            await record_finding(
                db, org_id=org_id, project_id=str(inv["project_id"]),
                check_type="invoice_missing_po_or_grn",
                natural_key=f"supplier_invoice:{invoice_id}:missing_grn",
                severity="medium",
                summary=f"Supplier invoice {inv['supplier_invoice_ref']} was registered without a confirmed GRN.",
                evidence={"invoice_id": str(invoice_id), "supplier_id": str(inv["supplier_id"])},
            )

        if inv["supplier_status"] in ("suspended", "blacklisted", "pending_approval"):
            await record_finding(
                db, org_id=org_id, project_id=str(inv["project_id"]),
                check_type="invoice_unapproved_supplier",
                natural_key=f"supplier_invoice:{invoice_id}:unapproved_supplier",
                severity="critical",
                summary=f"Supplier invoice {inv['supplier_invoice_ref']} was registered against supplier '{inv['supplier_name']}' whose status is '{inv['supplier_status']}'.",
                evidence={"invoice_id": str(invoice_id), "supplier_status": inv["supplier_status"]},
            )

        dup = await db.execute(
            text("""
                SELECT id, supplier_invoice_ref FROM procurement.supplier_invoices
                WHERE organization_id = :org_id AND supplier_id = :supplier_id AND id != :id
                  AND total_amount = :total_amount AND is_deleted = false
                  AND ABS(invoice_date - CAST(:invoice_date AS date)) <= :window_days
                LIMIT 1
            """),
            {
                "org_id": org_id, "supplier_id": inv["supplier_id"], "id": invoice_id,
                "total_amount": inv["total_amount"], "invoice_date": inv["invoice_date"],
                "window_days": DUPLICATE_WINDOW_DAYS,
            },
        )
        dup_row = dup.mappings().first()
        if dup_row:
            await record_finding(
                db, org_id=org_id, project_id=str(inv["project_id"]),
                check_type="duplicate_invoice_suspected",
                natural_key=f"supplier_invoice:{invoice_id}:duplicate_of:{dup_row['id']}",
                severity="high",
                summary=f"Supplier invoice {inv['supplier_invoice_ref']} matches supplier, amount and date window of existing invoice {dup_row['supplier_invoice_ref']}.",
                evidence={"invoice_id": str(invoice_id), "possible_duplicate_of": str(dup_row["id"])},
            )
    except Exception:
        return


async def check_line_level_match(db: AsyncSession, *, org_id: str, invoice_id: UUID) -> None:
    """Only acts if supplier_invoice_lines rows with a non-null po_line_id
    exist for this invoice - the common case today has none, and correctly
    produces no finding rather than a fabricated one."""
    try:
        rows = await db.execute(
            text("""
                SELECT sil.id AS line_id, sil.quantity, sil.unit_cost_ex_vat,
                       pol.quantity AS po_quantity, pol.unit_price AS po_unit_price,
                       inv.project_id, inv.supplier_invoice_ref
                FROM procurement.supplier_invoice_lines sil
                JOIN procurement.purchase_order_lines pol ON pol.id = sil.po_line_id
                JOIN procurement.supplier_invoices inv ON inv.id = sil.supplier_invoice_id
                WHERE sil.supplier_invoice_id = :invoice_id AND sil.organization_id = :org_id
                  AND sil.po_line_id IS NOT NULL AND sil.is_deleted = false
            """),
            {"invoice_id": invoice_id, "org_id": org_id},
        )
        lines = rows.mappings().all()
        for line in lines:
            qty, po_qty = Decimal(str(line["quantity"])), Decimal(str(line["po_quantity"]))
            price, po_price = Decimal(str(line["unit_cost_ex_vat"])), Decimal(str(line["po_unit_price"]))

            qty_tolerance = max(po_qty * LINE_TOLERANCE_PCT, Decimal("0.01"))
            if abs(qty - po_qty) > qty_tolerance:
                await record_finding(
                    db, org_id=org_id, project_id=str(line["project_id"]),
                    check_type="invoice_line_quantity_variance",
                    natural_key=f"supplier_invoice_line:{line['line_id']}:quantity_variance",
                    severity="medium",
                    summary=f"Invoice {line['supplier_invoice_ref']} line quantity ({qty}) differs from PO line quantity ({po_qty}).",
                    evidence={"invoice_line_id": str(line["line_id"]), "invoiced_quantity": str(qty), "po_quantity": str(po_qty)},
                )

            price_tolerance = max(po_price * LINE_TOLERANCE_PCT, LINE_TOLERANCE_ABS)
            if abs(price - po_price) > price_tolerance:
                await record_finding(
                    db, org_id=org_id, project_id=str(line["project_id"]),
                    check_type="invoice_line_price_variance",
                    natural_key=f"supplier_invoice_line:{line['line_id']}:price_variance",
                    severity="medium",
                    summary=f"Invoice {line['supplier_invoice_ref']} line unit price ({price}) differs from PO line unit price ({po_price}).",
                    evidence={"invoice_line_id": str(line["line_id"]), "invoiced_unit_price": str(price), "po_unit_price": str(po_price)},
                )
    except Exception:
        return


async def check_supplier_bank_changed(db: AsyncSession, *, org_id: str, invoice_id: UUID) -> None:
    """Called additively at the end of payment_decision on approval. Flags
    the classic BEC/vendor-fraud window: bank details changed after the PO
    was placed. Also re-checks supplier status, since it can change between
    invoice creation and payment approval."""
    try:
        row = await db.execute(
            text("""
                SELECT inv.project_id, inv.supplier_invoice_ref, inv.supplier_id,
                       po.issued_at, s.bank_updated_at, s.status AS supplier_status, s.supplier_name
                FROM procurement.supplier_invoices inv
                JOIN procurement.purchase_orders po ON po.id = inv.po_id AND po.organization_id = inv.organization_id
                JOIN procurement.suppliers s ON s.id = inv.supplier_id AND s.organization_id = inv.organization_id
                WHERE inv.id = :id AND inv.organization_id = :org_id
            """),
            {"id": invoice_id, "org_id": org_id},
        )
        inv = row.mappings().first()
        if not inv:
            return

        if inv["bank_updated_at"] and inv["issued_at"] and inv["bank_updated_at"] > inv["issued_at"]:
            await record_finding(
                db, org_id=org_id, project_id=str(inv["project_id"]),
                check_type="supplier_bank_changed",
                natural_key=f"supplier_invoice:{invoice_id}:bank_changed",
                severity="critical",
                summary=f"Supplier '{inv['supplier_name']}' bank details were changed after PO issuance and before payment approval of invoice {inv['supplier_invoice_ref']}.",
                evidence={"invoice_id": str(invoice_id), "supplier_id": str(inv["supplier_id"]), "bank_updated_at": inv["bank_updated_at"], "po_issued_at": inv["issued_at"]},
            )

        if inv["supplier_status"] in ("suspended", "blacklisted", "pending_approval"):
            await record_finding(
                db, org_id=org_id, project_id=str(inv["project_id"]),
                check_type="invoice_unapproved_supplier",
                natural_key=f"supplier_invoice:{invoice_id}:unapproved_supplier",
                severity="critical",
                summary=f"Payment for invoice {inv['supplier_invoice_ref']} was approved against supplier '{inv['supplier_name']}' whose status is '{inv['supplier_status']}'.",
                evidence={"invoice_id": str(invoice_id), "supplier_status": inv["supplier_status"]},
            )
    except Exception:
        return
