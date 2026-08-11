# Multi-stage build: gcc/libpq-dev and pip's build artifacts (needed only to
# compile a handful of C-extension wheels) never reach the final image - they
# added real disk weight on every deploy for zero runtime benefit, since
# asyncpg/cryptography/argon2-cffi don't dynamically link against them once
# built. requirements.txt itself is also the production-only dependency set
# (see requirements-dev.txt for test/lint tooling that has no reason to ship
# on a running server).

FROM python:3.13-slim AS builder

ENV PYTHONDONTWRITEBYTECODE 1
ENV PYTHONUNBUFFERED 1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends gcc libpq-dev && rm -rf /var/lib/apt/lists/*

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY requirements.txt .
RUN pip install --upgrade pip && pip install --no-cache-dir -r requirements.txt

FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE 1
ENV PYTHONUNBUFFERED 1

WORKDIR /app

COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Copy backend source code
COPY . .

# Expose port for FastAPI
EXPOSE 8000

# Command to run the application.
# --proxy-headers/--forwarded-allow-ips trust Caddy's X-Forwarded-Proto so
# Starlette knows the original request was HTTPS. Without this, uvicorn only
# sees the plain-HTTP hop from Caddy and builds trailing-slash redirect
# Location headers as http://, which both browsers and Node's fetch treat as
# an insecure downgrade and strip the Authorization header from - causing
# spurious 401s on any endpoint whose collection route needs the redirect
# (crm-leads, notifications, etc). imperium-api is only reachable from Caddy
# on the internal compose network (not published to the host), so trusting
# all forwarded-for IPs here is safe.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips=*"]
