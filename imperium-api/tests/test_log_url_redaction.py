"""uvicorn's access/handshake log lines bypass structlog; the live WebSocket
carries the session JWT as ?token=, which was being written to the
container logs in full. core.logging installs a filter that strips it."""

import logging

from core.logging import RedactUrlSecretsFilter, install_uvicorn_log_redaction, redact_url_secrets

JWT = "eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJl"


def test_token_query_value_is_removed():
    line = f'127.0.0.1:1 - "WebSocket /api/v1/notifications/ws?token={JWT}" [accepted]'
    out = redact_url_secrets(line)
    assert JWT not in out
    assert "?token=[REDACTED]" in out
    assert out.endswith('" [accepted]')


def test_other_query_params_survive():
    out = redact_url_secrets("/x?limit=12&access_token=abc.def&page=2")
    assert out == "/x?limit=12&access_token=[REDACTED]&page=2"


def test_filter_rewrites_uvicorn_style_args():
    # uvicorn.access formats '%s - "%s %s HTTP/%s" %d' with the path in args.
    record = logging.LogRecord("uvicorn.access", logging.INFO, __file__, 1,
                               '%s - "%s %s HTTP/%s" %d',
                               ("127.0.0.1:1", "GET", f"/api/v1/x?token={JWT}", "1.1", 200), None)
    RedactUrlSecretsFilter().filter(record)
    assert JWT not in record.getMessage()
    assert "token=[REDACTED]" in record.getMessage()


def test_installed_on_uvicorn_loggers_once():
    install_uvicorn_log_redaction()
    install_uvicorn_log_redaction()
    for name in ("uvicorn.access", "uvicorn.error"):
        filters = [f for f in logging.getLogger(name).filters if isinstance(f, RedactUrlSecretsFilter)]
        assert len(filters) == 1
