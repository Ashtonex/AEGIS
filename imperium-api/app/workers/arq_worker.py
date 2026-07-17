import asyncio
import time
import os
import json
from urllib.parse import urlparse
from arq.connections import RedisSettings
from core.config import settings
from core.logging import logger, correlation_id_ctx, worker_job_id_ctx
from app.services.quotations.calculator import QuotationCalculator
from app.services.documents.renderers import (
    QuotationPDFRenderer,
    QuotationExcelExporter,
)


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
    await asyncio.sleep(1)  # Simulate network latency of SMTP relay
    logger.info(f"Notification email dispatched successfully to {recipient_email}.")

    correlation_id_ctx.set("")
    worker_job_id_ctx.set("")
    return True


async def compliance_check_reminder_job(
    ctx, item_id: str, document_type: str, expiry_date: str, correlation_id: str | None = None
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


# 3. Failed Job Handling
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
if redis_url and redis_url.startswith("redis://"):
    try:
        url = urlparse(redis_url)
        db_num = 0
        if url.path:
            try:
                db_num = int(url.path.lstrip("/"))
            except ValueError:
                pass
        redis_settings = RedisSettings(
            host=url.hostname or "localhost",
            port=url.port or 6379,
            password=url.password,
            database=db_num,
        )
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
        generate_quotation_documents_job,
        send_notification_job,
        compliance_check_reminder_job,
    ]
    redis_settings = redis_settings
    on_startup = startup
    on_shutdown = shutdown
    on_job_failure = on_job_failure

    # Retry policy and timeout are controlled by typed settings.
    max_tries = settings.WORKER_JOB_MAX_TRIES
    job_timeout = settings.WORKER_JOB_TIMEOUT_SECONDS
    keep_result = 3600
