FROM python:3.13-slim

# Prevent python from writing pyc files and keep stdout unbuffered
ENV PYTHONDONTWRITEBYTECODE 1
ENV PYTHONUNBUFFERED 1

WORKDIR /app

# Install system dependencies if required by asyncpg or cryptography
RUN apt-get update && apt-get install -y --no-install-recommends gcc libpq-dev && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --upgrade pip && pip install --no-cache-dir -r requirements.txt

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
