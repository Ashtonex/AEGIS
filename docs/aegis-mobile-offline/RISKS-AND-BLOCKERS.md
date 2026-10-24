# AEGIS Risks and Blockers Register

| Risk / Blocker ID | Description | Impact | Mitigation / Status |
| :--- | :--- | :--- | :--- |
| **RB-001** | Physical mobile device testing unavailable in automated headless CI | Cannot claim physical touchscreen tactile testing automatically | Test with responsive viewport simulations + produce structured manual field test protocol |
| **RB-002** | iOS Safari WebKit IndexedDB background eviction under low storage | User draft might be evicted if device disk is completely full | Request `navigator.storage.persist()` and surface storage quota warnings |
| **RB-003** | Concurrent edits from desktop and mobile simultaneously | Stale write overwrite | Optimistic concurrency checking with server `updated_at` / version checks |
