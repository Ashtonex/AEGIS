import asyncio
import time
import os
import json
from urllib.parse import urlparse
from uuid import UUID
import httpx
from arq import Retry
from arq.connections import RedisSettings
from arq.cron import cron
from sqlalchemy import text
from core.config import settings
from core.database import AsyncSessionLocal, supabase
from core.email import send_email
from core.logging import logger, correlation_id_ctx, worker_job_id_ctx
from app.services.quotations.calculator import QuotationCalculator
from app.services.documents.renderers import (
    QuotationPDFRenderer,
    QuotationExcelExporter,
)
from app.services.documents.extraction import extract_text, ExtractionStatus
from app.services.microsoft.document_service import get_download_url as get_sharepoint_download_url
from app.services.microsoft import data_room_sync
from app.services.microsoft import bank_workbook
from app.services.crm.automation_engine import evaluate_and_run_automations
from app.services.finance.ccb_monitor import (
    run_budget_overrun_check,
    run_requisition_budget_breach_check,
    run_variance_staleness_check,
    run_weekly_boq_pace_variance_check,
    run_gl_proposal_stale_review_check,
    run_labour_headcount_mismatch_check,
    run_fuel_hours_variance_check,
    run_stock_consumption_variance_check,
)
from app.services.finance.tax_calendar import list_deadline_candidates, notify_deadline
from app.services.workforce_events import dispatch_workforce_events
from app.events.bus import EventBus
from app.shared.events import emit_notification
from app.shared.task_stacks import generate_task_stack
from app.services.microsoft.tender_calendar import cancel_all_for_tender
from routers.tender_bids import _record_tender_closeout


async def dispatch_compliance_events_job(ctx):
    bus = EventBus(settings.REDIS_URL)
    try:
        return await dispatch_workforce_events(AsyncSessionLocal, bus,
            event_filter="event_type LIKE 'compliance.%'", transport="redis:compliance:v1", stream="compliance.events")
    finally:
        await bus.disconnect()


async def dispatch_workforce_events_job(ctx):
    bus = EventBus(settings.REDIS_URL)
    try:
        return await dispatch_workforce_events(AsyncSessionLocal, bus)
    finally:
        await bus.disconnect()


# 1. Retry Policy Helper
# Retries up to 3 times with exponential backoff: 5s, 10s, 20s
def exponential_backoff_retry(ctx):
    job_try = ctx.get("job_try", 1)
    if job_try >= 3:
        return None  # Max retries exceeded
    return 5 * (2 ** (job_try - 1))


# 2. Registered Jobs
async def generate_quotation_documents_job(
    ctx, quotation_payload: dict, pdf_path: str, excel_path: str
):
    """
    Background job to run the pricing estimation engine and generate PDF/Excel sheets.
    """
    job_id = ctx.get("job_id", "unknown")
    worker_job_id_ctx.set(job_id)

    # Trace correlation context
    correlation_id = quotation_payload.get("correlation_id") or f"job-{job_id}"
    correlation_id_ctx.set(correlation_id)

    logger.info(
        f"Worker beginning document generation for quotation {quotation_payload.get('quotation_id')}"
    )

    # Idempotency safety verification
    redis_pool = ctx["redis"]
    idempotency_key = f"aegis:job_completed:{job_id}"
    is_completed = await redis_pool.get(idempotency_key)
    if is_completed:
        logger.info(f"Job {job_id} has already been completed. Skipping duplicate run.")
        return True

    start_time = time.time()

    try:
        # Execute estimation calculation
        calc_result = QuotationCalculator.calculate(quotation_payload)
        calc_data = dict(quotation_payload)
        calc_data.update(calc_result.model_dump(mode="json"))

        # Render PDF document using ReportLab
        pdf_renderer = QuotationPDFRenderer()
        pdf_success = pdf_renderer.render_pdf(calc_data, pdf_path)
        if not pdf_success:
            raise RuntimeError("ReportLab PDF generation returned false.")

        # Export Excel report using XlsxWriter
        excel_exporter = QuotationExcelExporter()
        excel_success = excel_exporter.export_to_excel(calc_data, excel_path)
        if not excel_success:
            raise RuntimeError("XlsxWriter Excel generation returned false.")

        # Set idempotency flag in Redis (expires in 24 hours)
        await redis_pool.setex(idempotency_key, 86400, "true")

        duration = time.time() - start_time
        logger.info(
            f"Quotation document generation completed successfully in {duration:.4f}s."
        )
        return True

    except Exception as e:
        logger.exception(f"Quotation document generation job failed: {str(e)}")
        raise e
    finally:
        correlation_id_ctx.set("")
        worker_job_id_ctx.set("")


async def send_notification_job(
    ctx,
    recipient_email: str,
    subject: str,
    message_body: str,
    correlation_id: str | None = None,
):
    """
    Asynchronous notification dispatcher with correlation tracing.
    """
    job_id = ctx.get("job_id", "unknown")
    worker_job_id_ctx.set(job_id)
    correlation_id_ctx.set(correlation_id or f"job-{job_id}")

    logger.info(
        f"Worker sending notification email to {recipient_email} (Subject: {subject})"
    )
    sent = await send_email(
        to=recipient_email,
        subject=subject,
        html=message_body,
    )
    if sent:
        logger.info(f"Notification email dispatched successfully to {recipient_email}.")
    else:
        logger.warning(f"Notification email failed to dispatch to {recipient_email}.")

    correlation_id_ctx.set("")
    worker_job_id_ctx.set("")
    return sent


async def compliance_check_reminder_job(
    ctx,
    item_id: str,
    document_type: str,
    expiry_date: str,
    correlation_id: str | None = None,
):
    """
    Background worker job for checking HSE/regulatory compliance reminders.
    """
    job_id = ctx.get("job_id", "unknown")
    worker_job_id_ctx.set(job_id)
    correlation_id_ctx.set(correlation_id or f"job-{job_id}")

    logger.warning(
        f"COMPLIANCE ALERT: Document '{document_type}' (ID: {item_id}) expires on {expiry_date}!"
    )

    correlation_id_ctx.set("")
    worker_job_id_ctx.set("")
    return True


DOCUMENTS_BUCKET = "documents"

# The two document stacks this job knows how to read from - see
# app/services/documents/extraction.py for why PDF/Word text extraction
# lives here rather than being run synchronously in the upload request.
_EXTRACTION_TABLES = {
    "file_attachment": "core.file_attachments",
    "data_room_document": "finance.data_room_documents",
}


async def _fetch_extraction_target(db, source_table: str, record_id: str):
    table = _EXTRACTION_TABLES[source_table]
    row = (
        await db.execute(
            text(f"""
                SELECT id, organization_id, provider, storage_path, mime_type, file_name,
                       provider_drive_id, provider_item_id
                FROM {table}
                WHERE id = :id AND is_deleted = false
            """),  # nosec B608 - source_table is resolved through the fixed _EXTRACTION_TABLES map above, never user input
            {"id": record_id},
        )
    ).mappings().first()
    return dict(row) if row else None


async def _fetch_bytes_for_row(db, source_table: str, row: dict) -> bytes:
    if row["provider"] == "sharepoint":
        if source_table == "file_attachment":
            download_url = await get_sharepoint_download_url(
                db, organization_id=row["organization_id"], file_attachment_id=row["id"]
            )
            async with httpx.AsyncClient(timeout=60.0) as http_client:
                response = await http_client.get(download_url)
                response.raise_for_status()
                return response.content
        # finance.data_room_documents already has a direct bytes accessor -
        # reuse it rather than re-deriving a download URL ourselves.
        return await data_room_sync.fetch_bytes(
            db, organization_id=row["organization_id"],
            drive_id=row["provider_drive_id"], item_id=row["provider_item_id"],
        )

    content = supabase.storage.from_(DOCUMENTS_BUCKET).download(row["storage_path"])
    if not content:
        raise RuntimeError(f"Supabase Storage returned no content for {row['storage_path']!r}.")
    return content


async def _write_extraction_result(db, source_table: str, record_id: str, result) -> None:
    table = _EXTRACTION_TABLES[source_table]
    await db.execute(
        text(f"""
            UPDATE {table}
            SET extracted_text = :text, extraction_status = :status,
                extraction_error = :error, text_extracted_at = NOW()
            WHERE id = :id
        """),  # nosec B608 - source_table is resolved through the fixed _EXTRACTION_TABLES map above, never user input
        {
            "text": result.text,
            "status": result.status.value,
            "error": result.error,
            "id": record_id,
        },
    )


async def extract_document_text_job(ctx, *, source_table: str, record_id: str):
    """Reads a PDF/Word file's text content in the background so uploads
    stay fast - enqueued by routers/documents.py and routers/data_room.py
    right after a document is registered. See app/services/documents/
    extraction.py for the actual parsing and app/services/jobs/queue.py for
    how this gets enqueued.

    Idempotent by construction (unlike generate_quotation_documents_job,
    which needs a Redis idempotency key because it writes files to disk
    outside its DB transaction) - this job's only side effect is the UPDATE
    above, safe to re-run with the same result.
    """
    job_id = ctx.get("job_id", "unknown")
    worker_job_id_ctx.set(job_id)
    try:
        async with AsyncSessionLocal() as db:
            row = await _fetch_extraction_target(db, source_table, record_id)
            if row is None:
                # Soft-deleted/removed between enqueue and run - nothing to do.
                return {"skipped": True}

            try:
                content = await _fetch_bytes_for_row(db, source_table, row)
            except Exception as exc:
                # Fetching the file itself failed - storage/SharePoint being
                # unreachable is transient, so this is worth retrying rather
                # than recording a permanent 'failed' status.
                raise Retry(defer=exponential_backoff_retry(ctx)) from exc

            result = await asyncio.to_thread(
                extract_text, content, file_name=row["file_name"], mime_type=row["mime_type"]
            )
            await _write_extraction_result(db, source_table, record_id, result)
            await db.commit()
            return {"status": result.status.value}
    except Retry:
        raise
    except Exception as exc:
        logger.exception(f"Document text extraction failed for {source_table}:{record_id}: {exc}")
        raise Retry(defer=exponential_backoff_retry(ctx)) from exc
    finally:
        worker_job_id_ctx.set("")


async def poll_ticket_sla_triggers_job(ctx):
    """Periodic cron job (Phase 9 automation engine): finds support tickets whose
    resolution SLA is about to breach or already has, and fires the matching
    automation trigger for each org's active rules. Dedupes per ticket per day via
    a Redis key so the same ticket doesn't re-fire every poll interval.
    """
    job_id = ctx.get("job_id", "unknown")
    worker_job_id_ctx.set(job_id)
    redis_pool = ctx["redis"]
    fired = 0
    try:
        async with AsyncSessionLocal() as db:
            rows = (
                (
                    await db.execute(
                        text("""
                SELECT id, organization_id, assigned_to, resolution_due_at
                FROM crm.support_tickets
                WHERE is_deleted = false
                  AND status NOT IN ('resolved', 'closed')
                  AND resolution_due_at IS NOT NULL
                  AND resolution_due_at < NOW() + INTERVAL '2 hours'
                LIMIT 500
            """)
                    )
                )
                .mappings()
                .all()
            )

            for row in rows:
                ticket_id = str(row["id"])
                org_id = str(row["organization_id"])
                trigger_type = (
                    "ticket_overdue"
                    if row["resolution_due_at"] < time_now()
                    else "ticket_sla_near_breach"
                )
                dedupe_key = (
                    f"aegis:automation:{trigger_type}:{ticket_id}:{time_today()}"
                )
                if await redis_pool.get(dedupe_key):
                    continue
                await evaluate_and_run_automations(
                    db,
                    org_id,
                    str(row["assigned_to"]) if row["assigned_to"] else None,
                    trigger_type,
                    {"id": ticket_id, "ticket_id": ticket_id},
                )
                await redis_pool.setex(dedupe_key, 86400, "true")
                fired += 1

        if fired:
            logger.info(f"Ticket SLA automation poll fired {fired} trigger(s).")
        return True
    except Exception as exc:
        logger.exception(f"Ticket SLA automation poll failed: {exc}")
        raise Retry(defer=exponential_backoff_retry(ctx)) from exc
    finally:
        worker_job_id_ctx.set("")


async def auto_close_overdue_tenders_job(ctx):
    """Periodic cron: a tender still sitting pre-submission (never actually
    bid) whose submission deadline has passed was lost by default - the
    window to bid is closed. Auto-marks it Lost (with closeout_status/reason
    set the same way a manual close-out would) so it drops out of the
    morning briefing's tenders_due list instead of aging into silence, and
    shows up instead in that briefing's dedicated lost-tenders section.

    Deliberately scoped to pre-submission stages only ('Tender Identified',
    'Bid Prep'). A tender that was actually Submitted and is now in
    Adjudication has its deadline pass as a matter of course while awaiting
    an outcome - that is not a loss signal, and auto-closing it would
    falsely kill a live pending bid.
    """
    job_id = ctx.get("job_id", "unknown")
    worker_job_id_ctx.set(job_id)
    closed = 0
    try:
        async with AsyncSessionLocal() as db:
            rows = (
                (
                    await db.execute(
                        text("""
                SELECT id, organization_id
                FROM crm.tenders
                WHERE is_deleted = false
                  AND submission_deadline IS NOT NULL
                  AND submission_deadline < NOW()
                  AND lower(COALESCE(stage, '')) IN ('tender identified', 'bid prep')
                  AND COALESCE(closeout_status, '') NOT IN ('won', 'lost')
                LIMIT 500
            """)
                    )
                )
                .mappings()
                .all()
            )

            for row in rows:
                tender_id = str(row["id"])
                org_id = str(row["organization_id"])
                await _record_tender_closeout(
                    db,
                    org_id=org_id,
                    user_id=None,
                    tender_id=tender_id,
                    status="lost",
                    reason="Submission deadline passed with no bid submitted and no manual close-out recorded.",
                    next_steps=["Review lapsed tender for lessons learned."],
                    create_followups=False,
                )
                await db.commit()
                closed += 1

                # Mirror the manual close-out endpoint's post-steps
                # (tender_bids.py's closeout_tender) so an auto-lost tender
                # gets the same "Lost"-stage task pack and freed calendar
                # slots a human closing it out would trigger - best-effort,
                # must never undo the closeout that already committed.
                try:
                    await cancel_all_for_tender(db, organization_id=org_id, tender_id=UUID(tender_id))
                    await db.commit()
                except Exception as exc:  # noqa: BLE001
                    await db.rollback()
                    logger.warning("microsoft_graph.tender_calendar_auto_closeout_cancel_errored", tender_id=tender_id, error=str(exc))
                try:
                    await generate_task_stack(
                        db,
                        org_id=org_id,
                        entity_type="tender",
                        entity_id=tender_id,
                        created_by=None,
                        source_event="tender_closeout_recorded",
                        generation_reason="Tender auto-marked lost after its submission deadline passed unactioned.",
                        stage="Lost",
                    )
                    await db.commit()
                except Exception as exc:  # noqa: BLE001
                    await db.rollback()
                    logger.warning("tender.auto_closeout.task_stack_failed", tender_id=tender_id, error=str(exc))

        if closed:
            logger.info(f"Auto-closed {closed} tender(s) whose submission deadline passed.")
        return {"closed": closed}
    except Exception as exc:
        logger.exception(f"Auto-close overdue tenders job failed: {exc}")
        raise Retry(defer=exponential_backoff_retry(ctx)) from exc
    finally:
        worker_job_id_ctx.set("")


async def notify_stale_pipeline_items_job(ctx):
    """Daily cron: nags the owner (falling back to the creator, if
    unassigned) of any open lead or opportunity that has sat 3+ days without
    a logged action - the outreach/follow-up nudge the pipeline needs so
    deals don't quietly die from inattention. Deliberately fires again every
    day an item is still stale (no dedupe beyond the daily cadence) - the
    point is to keep making noise until someone acts.
    """
    job_id = ctx.get("job_id", "unknown")
    worker_job_id_ctx.set(job_id)
    notified = 0
    try:
        async with AsyncSessionLocal() as db:
            stale_opportunities = (
                (
                    await db.execute(
                        text("""
                SELECT id, organization_id, name,
                       COALESCE(owner_user_id, sales_owner_id, created_by) AS notify_user_id,
                       GREATEST(1, EXTRACT(DAY FROM (NOW() - COALESCE(next_activity_due_at, updated_at)))::int) AS days_stale
                FROM crm.opportunities
                WHERE is_deleted = false
                  AND win_loss_status IS NULL
                  AND (
                    (next_activity_due_at IS NOT NULL AND next_activity_due_at < NOW() - INTERVAL '3 days')
                    OR (next_activity_due_at IS NULL AND updated_at < NOW() - INTERVAL '3 days')
                  )
                LIMIT 500
            """)
                    )
                )
                .mappings()
                .all()
            )
            for row in stale_opportunities:
                if not row["notify_user_id"]:
                    continue
                await emit_notification(
                    db,
                    org_id=str(row["organization_id"]),
                    user_id=str(row["notify_user_id"]),
                    title="Opportunity needs a follow-up",
                    message=f'"{row["name"]}" has had no logged action for {row["days_stale"]}+ day(s). Log an outreach or move it forward.',
                    notification_type="opportunity_stale",
                    priority="normal",
                    action_url="/dashboard/crm/opportunities",
                    metadata={"opportunity_id": str(row["id"])},
                )
                notified += 1
            await db.commit()

            stale_leads = (
                (
                    await db.execute(
                        text("""
                SELECT id, organization_id, COALESCE(NULLIF(company_name, ''), NULLIF(contact_name, ''), 'Untitled lead') AS name,
                       COALESCE(owner_user_id, assigned_to, created_by) AS notify_user_id,
                       GREATEST(1, EXTRACT(DAY FROM (NOW() - updated_at))::int) AS days_stale
                FROM crm.leads
                WHERE is_deleted = false
                  AND lower(COALESCE(status, '')) NOT IN ('disqualified', 'converted')
                  AND converted_at IS NULL
                  AND updated_at < NOW() - INTERVAL '3 days'
                LIMIT 500
            """)
                    )
                )
                .mappings()
                .all()
            )
            for row in stale_leads:
                if not row["notify_user_id"]:
                    continue
                await emit_notification(
                    db,
                    org_id=str(row["organization_id"]),
                    user_id=str(row["notify_user_id"]),
                    title="Lead needs outreach",
                    message=f'"{row["name"]}" has had no activity for {row["days_stale"]}+ day(s). Do an outreach or follow-up.',
                    notification_type="lead_stale",
                    priority="normal",
                    action_url="/dashboard/crm/leads",
                    metadata={"lead_id": str(row["id"])},
                )
                notified += 1
            await db.commit()

        if notified:
            logger.info(f"Sent {notified} stale-pipeline nudge notification(s).")
        return {"notified": notified}
    except Exception as exc:
        logger.exception(f"Stale pipeline notification job failed: {exc}")
        raise Retry(defer=exponential_backoff_retry(ctx)) from exc
    finally:
        worker_job_id_ctx.set("")


async def run_ccb_budget_overrun_check_job(ctx):
    """Daily cron (CCB automation Phase 2): sweeps every organization for
    projects whose estimate-at-completion has drifted past their approved
    budget without a matching approved variation. Daily is the right cadence
    here - a project's cost position doesn't meaningfully swing hour to
    hour, and over-polling this specific check is pure alert-fatigue risk
    for no signal gain.
    """
    job_id = ctx.get("job_id", "unknown")
    worker_job_id_ctx.set(job_id)
    try:
        async with AsyncSessionLocal() as db:
            result = await run_budget_overrun_check(db)
            await db.commit()
        return result
    except Exception as exc:
        logger.exception(f"CCB budget overrun check failed: {exc}")
        raise Retry(defer=exponential_backoff_retry(ctx)) from exc
    finally:
        worker_job_id_ctx.set("")


async def run_ccb_requisition_breach_check_job(ctx):
    """Daily cron (CCB automation Phase 3): catches requisitions that were
    within budget when submitted/approved but whose project's budget
    position has since drifted, and resolves findings for requisitions no
    longer in an open state. The real-time case (a requisition breaching
    budget right at submit/approve) is handled synchronously by
    record_requisition_budget_breach in routers/procurement.py - this sweep
    only needs to run daily, same cadence rationale as the budget-overrun
    check above.
    """
    job_id = ctx.get("job_id", "unknown")
    worker_job_id_ctx.set(job_id)
    try:
        async with AsyncSessionLocal() as db:
            result = await run_requisition_budget_breach_check(db)
            await db.commit()
        return result
    except Exception as exc:
        logger.exception(f"CCB requisition budget-breach check failed: {exc}")
        raise Retry(defer=exponential_backoff_retry(ctx)) from exc
    finally:
        worker_job_id_ctx.set("")


async def run_ccb_variance_staleness_check_job(ctx):
    """Daily cron (CCB automation Phase 4): flags document/drawing revisions
    that required MD approval and have sat unapproved for 3+ days.
    """
    job_id = ctx.get("job_id", "unknown")
    worker_job_id_ctx.set(job_id)
    try:
        async with AsyncSessionLocal() as db:
            result = await run_variance_staleness_check(db)
            await db.commit()
        return result
    except Exception as exc:
        logger.exception(f"CCB variance staleness check failed: {exc}")
        raise Retry(defer=exponential_backoff_retry(ctx)) from exc
    finally:
        worker_job_id_ctx.set("")


async def run_ccb_weekly_boq_pace_variance_check_job(ctx):
    """Daily cron (CCB automation Phase 5): cross-checks planned weekly BOQ
    quantities against approved measured progress for the same week and
    against daily site report presence, same daily cadence rationale as the
    other CCB sweeps above - a week's pace doesn't meaningfully change
    hour to hour.
    """
    job_id = ctx.get("job_id", "unknown")
    worker_job_id_ctx.set(job_id)
    try:
        async with AsyncSessionLocal() as db:
            result = await run_weekly_boq_pace_variance_check(db)
            await db.commit()
        return result
    except Exception as exc:
        logger.exception(f"CCB weekly BOQ pace-variance check failed: {exc}")
        raise Retry(defer=exponential_backoff_retry(ctx)) from exc
    finally:
        worker_job_id_ctx.set("")


async def run_ccb_gl_proposal_stale_review_check_job(ctx):
    """Daily cron (CCB automation Phase 10A): flags system-proposed GL
    journals (gl_bridge.py) stuck in pending_review for 5+ days.
    """
    job_id = ctx.get("job_id", "unknown")
    worker_job_id_ctx.set(job_id)
    try:
        async with AsyncSessionLocal() as db:
            result = await run_gl_proposal_stale_review_check(db)
            await db.commit()
        return result
    except Exception as exc:
        logger.exception(f"CCB GL proposal staleness check failed: {exc}")
        raise Retry(defer=exponential_backoff_retry(ctx)) from exc
    finally:
        worker_job_id_ctx.set("")


async def run_ccb_labour_headcount_mismatch_check_job(ctx):
    """Daily cron (CCB automation Phase 10A): compares posted-payroll
    headcount against approved-timesheet headcount per project/period.
    """
    job_id = ctx.get("job_id", "unknown")
    worker_job_id_ctx.set(job_id)
    try:
        async with AsyncSessionLocal() as db:
            result = await run_labour_headcount_mismatch_check(db)
            await db.commit()
        return result
    except Exception as exc:
        logger.exception(f"CCB labour headcount mismatch check failed: {exc}")
        raise Retry(defer=exponential_backoff_retry(ctx)) from exc
    finally:
        worker_job_id_ctx.set("")


async def run_ccb_fuel_hours_variance_check_job(ctx):
    """Daily cron (CCB automation Phase 10A): flags fuel transactions whose
    already-computed variance against expected consumption exceeds 15%.
    """
    job_id = ctx.get("job_id", "unknown")
    worker_job_id_ctx.set(job_id)
    try:
        async with AsyncSessionLocal() as db:
            result = await run_fuel_hours_variance_check(db)
            await db.commit()
        return result
    except Exception as exc:
        logger.exception(f"CCB fuel-vs-hours variance check failed: {exc}")
        raise Retry(defer=exponential_backoff_retry(ctx)) from exc
    finally:
        worker_job_id_ctx.set("")


async def run_ccb_stock_consumption_variance_check_job(ctx):
    """Daily cron (CCB automation Phase 10A): compares stock issued to a
    project against reported material usage+wastage per project/item/week.
    """
    job_id = ctx.get("job_id", "unknown")
    worker_job_id_ctx.set(job_id)
    try:
        async with AsyncSessionLocal() as db:
            result = await run_stock_consumption_variance_check(db)
            await db.commit()
        return result
    except Exception as exc:
        logger.exception(f"CCB stock-vs-consumption variance check failed: {exc}")
        raise Retry(defer=exponential_backoff_retry(ctx)) from exc
    finally:
        worker_job_id_ctx.set("")


async def check_tax_deadline_alerts_job(ctx):
    """Daily cron (Phase 8C): staged tax-deadline alerts at 30/14/7/3/1 days
    out and overdue, for every organization. Unlike poll_ticket_sla_triggers_job's
    per-day dedupe key, a liability's due_date is fixed once accrued, so each
    (liability_id, stage) pair mathematically matches on exactly one calendar
    day - the dedupe key here is long-lived (no date component) so a stage
    can never re-fire for the same liability once it has.
    """
    job_id = ctx.get("job_id", "unknown")
    worker_job_id_ctx.set(job_id)
    redis_pool = ctx["redis"]
    notified = 0
    try:
        async with AsyncSessionLocal() as db:
            candidates = await list_deadline_candidates(db, org_id=None)
            for candidate in candidates:
                dedupe_key = f"aegis:tax_deadline:{candidate['id']}:{candidate['stage']}"
                if await redis_pool.get(dedupe_key):
                    continue
                await notify_deadline(db, candidate=candidate)
                await redis_pool.setex(dedupe_key, 180 * 86400, "true")
                notified += 1
            await db.commit()
        if notified:
            logger.info(f"Tax deadline alert sweep notified {notified} liabilit(y/ies).")
        return {"checked": len(candidates), "notified": notified}
    except Exception as exc:
        logger.exception(f"Tax deadline alert sweep failed: {exc}")
        raise Retry(defer=exponential_backoff_retry(ctx)) from exc
    finally:
        worker_job_id_ctx.set("")


def time_now():
    from datetime import datetime, timezone

    return datetime.now(timezone.utc)


def time_today():
    return time_now().date().isoformat()


# 3. Failed Job Handling
async def publish_bank_workbook_job(ctx, *, org_id: str, force: bool = False):
    """Rebuilds the read-only "AEGIS Bank & Project Money" workbook in the
    Financial Data Room (pinned as a Teams tab). Enqueued (debounced to one
    per minute) after every bank-line tag / split / books sync; skips the
    upload when nothing changed. Failures are recorded on
    finance.bank_workbook_publications, not retried - the next change or the
    nightly run publishes again."""
    worker_job_id_ctx.set(ctx.get("job_id", "unknown"))
    try:
        async with AsyncSessionLocal() as db:
            row = await bank_workbook.publish(db, org_id=org_id, force=force)
            return {"status": (row or {}).get("last_status")}
    finally:
        worker_job_id_ctx.set("")


async def sync_bank_workbooks_job(ctx):
    """Every 2 minutes: read edits people made in the Teams workbook back into
    AEGIS (only downloads when SharePoint says the file changed), then
    republish. One Graph metadata call per organisation when nothing changed."""
    async with AsyncSessionLocal() as db:
        org_ids = [str(r[0]) for r in await db.execute(text(
            "SELECT organization_id FROM finance.bank_workbook_publications WHERE item_id IS NOT NULL"))]
    results = {}
    for org_id in org_ids:
        async with AsyncSessionLocal() as db:
            row = await bank_workbook.sync(db, org_id=org_id)
            results[org_id] = (row or {}).get("last_status", "busy")
    return results


async def publish_bank_workbooks_nightly_job(ctx):
    """Nightly safety net: republish every organisation that has a bank
    statement, even if no change event fired."""
    async with AsyncSessionLocal() as db:
        org_ids = [str(r[0]) for r in await db.execute(text(
            "SELECT DISTINCT organization_id FROM finance.bank_statement_lines"))]
    results = {}
    for org_id in org_ids:
        async with AsyncSessionLocal() as db:
            row = await bank_workbook.publish(db, org_id=org_id)
            results[org_id] = (row or {}).get("last_status")
    return results


async def on_job_failure(ctx, exp: Exception):
    job_id = ctx.get("job_id", "unknown")
    logger.error(f"Arq Job {job_id} encountered execution failure: {str(exp)}")


# 4. Connection Lifecycle and Health Checks
async def startup(ctx):
    logger.info("Arq background worker starting up...")
    # Write local healthcheck status file
    health_data = {
        "status": "healthy",
        "startup_time": time.time(),
        "pid": os.getpid(),
        "redis_target": settings.REDIS_URL,
    }
    with open("worker_health.json", "w") as f:
        json.dump(health_data, f)
    logger.info("Worker healthcheck status file written to worker_health.json.")


async def shutdown(ctx):
    logger.info("Arq background worker shutting down...")
    if os.path.exists("worker_health.json"):
        try:
            os.remove("worker_health.json")
        except Exception as exc:
            logger.debug(f"Unable to remove worker healthcheck file: {exc}")
    logger.info("Graceful shutdown completed.")


# 5. Parse Redis settings safely
redis_url = settings.REDIS_URL
if redis_url and urlparse(redis_url).scheme in ("redis", "rediss", "unix"):
    try:
        redis_settings = RedisSettings.from_dsn(redis_url)
    except Exception as parse_err:
        logger.error(
            f"Failed to parse REDIS_URL '{redis_url}', falling back to defaults. Error: {str(parse_err)}"
        )
        redis_settings = RedisSettings(host="localhost", port=6379)
else:
    redis_settings = RedisSettings(
        host=settings.REDIS_HOST,
        port=settings.REDIS_PORT,
        password=settings.REDIS_PASSWORD,
    )


class WorkerSettings:
    functions = [
        dispatch_compliance_events_job,
        dispatch_workforce_events_job,
        generate_quotation_documents_job,
        send_notification_job,
        compliance_check_reminder_job,
        extract_document_text_job,
        poll_ticket_sla_triggers_job,
        auto_close_overdue_tenders_job,
        notify_stale_pipeline_items_job,
        run_ccb_budget_overrun_check_job,
        run_ccb_requisition_breach_check_job,
        run_ccb_variance_staleness_check_job,
        run_ccb_weekly_boq_pace_variance_check_job,
        check_tax_deadline_alerts_job,
        run_ccb_gl_proposal_stale_review_check_job,
        run_ccb_labour_headcount_mismatch_check_job,
        run_ccb_fuel_hours_variance_check_job,
        run_ccb_stock_consumption_variance_check_job,
        publish_bank_workbook_job,
        publish_bank_workbooks_nightly_job,
        sync_bank_workbooks_job,
    ]
    cron_jobs = [
        cron(dispatch_compliance_events_job, second=35, run_at_startup=False),
        cron(dispatch_workforce_events_job, second=15, run_at_startup=False),
        cron(
            poll_ticket_sla_triggers_job, minute={0, 15, 30, 45}, run_at_startup=False
        ),
        cron(
            auto_close_overdue_tenders_job, minute={0, 15, 30, 45}, run_at_startup=False
        ),
        cron(notify_stale_pipeline_items_job, hour=6, minute=0, run_at_startup=False),
        cron(run_ccb_budget_overrun_check_job, hour=3, minute=0, run_at_startup=False),
        cron(
            run_ccb_requisition_breach_check_job,
            hour=3,
            minute=15,
            run_at_startup=False,
        ),
        cron(
            run_ccb_variance_staleness_check_job,
            hour=3,
            minute=30,
            run_at_startup=False,
        ),
        cron(
            run_ccb_weekly_boq_pace_variance_check_job,
            hour=3,
            minute=45,
            run_at_startup=False,
        ),
        cron(check_tax_deadline_alerts_job, hour=4, minute=0, run_at_startup=False),
        cron(
            run_ccb_gl_proposal_stale_review_check_job,
            hour=3,
            minute=50,
            run_at_startup=False,
        ),
        cron(
            run_ccb_labour_headcount_mismatch_check_job,
            hour=3,
            minute=55,
            run_at_startup=False,
        ),
        cron(
            run_ccb_fuel_hours_variance_check_job,
            hour=4,
            minute=5,
            run_at_startup=False,
        ),
        cron(
            run_ccb_stock_consumption_variance_check_job,
            hour=4,
            minute=10,
            run_at_startup=False,
        ),
        cron(publish_bank_workbooks_nightly_job, hour=2, minute=30, run_at_startup=False),
        cron(sync_bank_workbooks_job, minute=set(range(1, 60, 2)), run_at_startup=False),
    ]
    redis_settings = redis_settings
    on_startup = startup
    on_shutdown = shutdown
    on_job_failure = on_job_failure

    # Retry policy and timeout are controlled by typed settings.
    max_tries = settings.WORKER_JOB_MAX_TRIES
    job_timeout = settings.WORKER_JOB_TIMEOUT_SECONDS
    keep_result = 3600
