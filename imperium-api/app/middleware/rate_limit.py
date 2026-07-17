from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
import time
import logging


class RateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # Simple placeholder for rate limiting.
        # In production, use Redis to track request rates per IP/User/Tenant
        client_ip = request.client.host
        # Example logic: redis.incr(client_ip) -> if > limit -> return 429

        start_time = time.time()
        response = await call_next(request)
        process_time = time.time() - start_time

        # Centralized Request Logging
        logging.info(
            f"{request.method} {request.url.path} - Status: {response.status_code} - "
            f"IP: {client_ip} - Time: {process_time:.4f}s"
        )

        response.headers["X-Process-Time"] = str(process_time)
        return response
