import time
import uuid
import jwt
from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from core.logging import logger, correlation_id_ctx, user_id_ctx, duration_ctx


class StructuredLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # 1. Resolve or generate Correlation ID
        correlation_id = request.headers.get("X-Correlation-ID") or request.headers.get(
            "X-Request-ID"
        )
        if not correlation_id:
            correlation_id = str(uuid.uuid4())

        correlation_id_token = correlation_id_ctx.set(correlation_id)

        # 2. Extract User ID from JWT token (if present) for tracing
        user_id = ""
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header.split(" ")[1]
            try:
                # Fast decode without verification to extract 'sub' claim for correlation
                payload = jwt.decode(token, options={"verify_signature": False})
                user_id = payload.get("sub", "")
            except Exception as exc:
                logger.debug(f"Unable to decode JWT subject for request tracing: {exc}")

        user_id_token = user_id_ctx.set(user_id)

        start_time = time.time()

        try:
            response = await call_next(request)
            duration = time.time() - start_time
            duration_ctx.set(duration)

            # Log structured event
            logger.info(
                f"HTTP {request.method} {request.url.path} - Status: {response.status_code} - "
                f"IP: {request.client.host if request.client else 'unknown'}"
            )

            response.headers["X-Correlation-ID"] = correlation_id
            response.headers["X-Process-Time"] = f"{duration:.4f}s"
            return response

        except Exception as e:
            duration = time.time() - start_time
            duration_ctx.set(duration)
            logger.exception(
                f"HTTP {request.method} {request.url.path} failed: {str(e)}"
            )
            raise e
        finally:
            # Safely reset contextvars
            correlation_id_ctx.reset(correlation_id_token)
            user_id_ctx.reset(user_id_token)
            duration_ctx.set(None)
