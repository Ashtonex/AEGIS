import logging
import re
from contextvars import ContextVar
from typing import Any

import structlog

correlation_id_ctx: ContextVar[str] = ContextVar("correlation_id", default="")
user_id_ctx: ContextVar[str] = ContextVar("user_id", default="")
worker_job_id_ctx: ContextVar[str] = ContextVar("worker_job_id", default="")
duration_ctx: ContextVar[Any] = ContextVar("duration", default=None)

SENSITIVE_KEYWORDS = (
    "password",
    "token",
    "secret",
    "bearer",
    "api_key",
    "service_key",
)


def _add_context(_logger: Any, _method_name: str, event_dict: dict[str, Any]) -> dict[str, Any]:
    event_dict["correlation_id"] = correlation_id_ctx.get()
    event_dict["user_id"] = user_id_ctx.get()
    event_dict["worker_job_id"] = worker_job_id_ctx.get()
    event_dict["duration_seconds"] = duration_ctx.get()
    return event_dict


def _redact_sensitive_event(
    _logger: Any, _method_name: str, event_dict: dict[str, Any]
) -> dict[str, Any]:
    event = str(event_dict.get("event", ""))
    if any(keyword in event.lower() for keyword in SENSITIVE_KEYWORDS):
        event_dict["event"] = "[REDACTED - sensitive data detected]"
    return event_dict


# A browser WebSocket can't send an Authorization header, so the live
# channel (/api/v1/notifications/ws) carries the session JWT as ?token=.
# uvicorn's own access/handshake log lines bypass structlog and printed that
# full token for every connection - a usable credential sitting in the
# droplet's container logs. Strip it from uvicorn's records before they're
# formatted.
_URL_SECRET_RE = re.compile(r"([?&](?:token|access_token|refresh_token|apikey|api_key)=)[^&\s\"']+", re.IGNORECASE)


def redact_url_secrets(text: str) -> str:
    return _URL_SECRET_RE.sub(lambda m: m.group(1) + "[REDACTED]", text)


class RedactUrlSecretsFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.msg, str):
            record.msg = redact_url_secrets(record.msg)
        if record.args:
            args = record.args if isinstance(record.args, tuple) else (record.args,)
            record.args = tuple(redact_url_secrets(a) if isinstance(a, str) else a for a in args)
        return True


_url_secret_filter = RedactUrlSecretsFilter()


def install_uvicorn_log_redaction() -> None:
    """Idempotent: attach the redaction filter to uvicorn's loggers (access
    lines go to uvicorn.access, WebSocket handshake lines to uvicorn.error)."""
    for name in ("uvicorn.access", "uvicorn.error"):
        target = logging.getLogger(name)
        if _url_secret_filter not in target.filters:
            target.addFilter(_url_secret_filter)


def setup_logging(environment: str = "development", level: str | None = None):
    """
    Configure structlog for request, worker and security-audit traceability.
    """
    log_level = (level or "INFO").upper()
    renderer = (
        structlog.processors.JSONRenderer()
        if environment == "production"
        else structlog.dev.ConsoleRenderer(colors=False)
    )
    structlog.configure(
        processors=[
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            _add_context,
            _redact_sensitive_event,
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            renderer,
        ],
        wrapper_class=structlog.make_filtering_bound_logger(log_level),
        cache_logger_on_first_use=True,
    )

    install_uvicorn_log_redaction()
    logger.info("AEGIS structlog initialized", environment=environment)


logger = structlog.get_logger("aegis")
