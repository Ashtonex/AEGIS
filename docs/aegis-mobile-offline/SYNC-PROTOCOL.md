# AEGIS Synchronization Protocol

## 1. Submission Lifecycle States
```
[DRAFT] (Local IndexedDB editing)
   │
   ▼ User taps "Submit"
[QUEUED] (Immutable record in local outbox with client_operation_id)
   │
   ├─► [SYNCING] (Network in flight with Bearer token)
   │      │
   │      ├─► [ACKNOWLEDGED] (Server 200/201 committed -> outbox item marked done)
   │      │
   │      ├─► [RETRY_WAIT] (Transient 5xx or Network offline -> exponential backoff)
   │      │
   │      └─► [CONFLICT / BLOCKED] (400 validation error / 409 conflict -> user alerted)
```

## 2. Operation Payload Schema
```json
{
  "operation_id": "urn:uuid:f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "client_timestamp": "2026-10-17T19:50:00.000Z",
  "tenant_id": "snc-org-001",
  "project_id": "proj-snc-house-500k",
  "user_id": "usr-123",
  "entity_type": "site_daily_report",
  "action": "create",
  "payload": {
    "project_id": "proj-snc-house-500k",
    "work_date": "2026-10-17",
    "shift": "day",
    "planned_work": "Pouring concrete strip footings",
    "actual_work": "Completed block 1 & 2 footings",
    "delays": "Rain delay from 14:00 to 15:30"
  },
  "attachments": [
    {
      "id": "att-991",
      "blob_key": "photos/site-20261017-001.jpg",
      "mime_type": "image/jpeg",
      "size": 184020
    }
  ]
}
```

## 3. Server-Side Idempotency Guarantee
The backend verifies `operation_id` in `imperium_api.idempotency_log` or `client_operation_id` column. If an operation was already committed, the prior committed response is returned without re-executing business mutations.
