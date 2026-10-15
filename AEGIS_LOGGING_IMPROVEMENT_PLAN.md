# AEGIS Logging & Observability Improvement Plan

This plan formalizes log structuring, correlation tracing, and redaction standards across AEGIS.

---

## 1. Structured Logging Standard

All backend logs generated in `imperium-api` must adhere to structured JSON key-value formatting:

```json
{
  "timestamp": "2026-10-15T20:25:00.000Z",
  "level": "INFO",
  "correlation_id": "c1f728c3-f09b-4e12-8947-f5793bc4e92b",
  "user_id": "056de1c7-b526-4771-8279-18747f0c0759",
  "org_id": "d3b07384-d113-42c4-ab8e-d01b3047ec92",
  "method": "POST",
  "path": "/api/v1/procurement/goods-receipt",
  "status_code": 200,
  "duration_seconds": 0.0452,
  "message": "HTTP POST /api/v1/procurement/goods-receipt - Status: 200 - IP: 197.221.254.12"
}
```

---

## 2. Sensitive Data Redaction Policy

Under no circumstances should the following data elements appear in application logs or frontend error messages:
1. Passwords, hashes, or temporary credentials.
2. Bearer tokens, JWT signatures, or API keys (`RESEND_API_KEY`, `SUPABASE_SERVICE_KEY`).
3. Bank account IBAN/numbers or cardholder credentials.
4. Unredacted personal identity numbers (National IDs/SSNs).

---

## 3. Log Aggregation & Analysis

- **Local & Container**: Stored in `journald` and Docker stdout/stderr (`docker compose logs`).
- **Retention**: Max 100MB per container (`max-size: 100m`) with log rotation enabled.
- **Trace Lookup**: Any user error surfacing `(Ref: <8-char-hash>)` can be immediately located via:
  ```bash
  docker compose logs imperium-api | grep "<8-char-hash>"
  ```
