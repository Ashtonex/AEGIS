import asyncio
from arq import create_pool
from arq.connections import RedisSettings
import logging

async def generate_pdf_report(ctx, report_id: str):
    logging.info(f"Worker generating PDF report for {report_id}...")
    await asyncio.sleep(2) # Simulate work
    logging.info(f"PDF generated for {report_id}.")
    return True

async def send_email_notification(ctx, email: str, subject: str, body: str):
    logging.info(f"Worker sending email to {email} - {subject}...")
    await asyncio.sleep(1) # Simulate work
    logging.info(f"Email sent to {email}.")
    return True

class WorkerSettings:
    functions = [generate_pdf_report, send_email_notification]
    redis_settings = RedisSettings(host='redis', port=6379)
    
    async def on_startup(ctx):
        logging.info("Arq worker starting up...")
        
    async def on_shutdown(ctx):
        logging.info("Arq worker shutting down...")
