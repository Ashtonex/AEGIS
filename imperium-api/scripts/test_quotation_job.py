import asyncio
from arq import create_pool
from arq.connections import RedisSettings
import os
import sys

# Ensure core and app can be imported
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

async def main():
    print("Connecting to Redis...")
    redis_settings = RedisSettings(host="localhost", port=6379)
    redis_pool = await create_pool(redis_settings)
    
    quotation_payload = {
        "quotation_id": "TEST-QT-999",
        "revision_number": 1,
        "items": [
            {
                "description": "Foundation works",
                "quantity": 1,
                "unit": "ls",
                "rate": 15000.00
            }
        ],
        "profit_rate": 0.15,
        "overhead_rate": 0.10,
        "tax_rate": 0.15,
        "preliminaries": 2000.00
    }
    
    pdf_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "test_arq_output.pdf"))
    excel_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "test_arq_output.xlsx"))
    
    print("Enqueueing generate_quotation_documents_job...")
    job = await redis_pool.enqueue_job(
        "generate_quotation_documents_job",
        quotation_payload,
        pdf_path,
        excel_path
    )
    
    print(f"Job {job.job_id} enqueued. Waiting for completion...")
    
    # Wait for the result
    try:
        result = await job.result(timeout=10)
        print(f"Job completed successfully. Result: {result}")
        print(f"PDF Path: {pdf_path}")
        print(f"Excel Path: {excel_path}")
    except Exception as e:
        print(f"Job failed or timed out: {e}")

if __name__ == "__main__":
    asyncio.run(main())
