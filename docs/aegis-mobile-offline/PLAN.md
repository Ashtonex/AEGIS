# AEGIS Mobile-First & Offline Operations — Master Execution Plan

**Organization**: Six Nine Construction (Private) Limited (SNC)  
**System**: Project AEGIS / Imperium Operations Platform  

---

## Phase Breakdown & Execution Sequence

### Phase 0: Audit & Baseline (COMPLETED)
- Verified working tree cleanliness (`main`).
- Verified backend testing apparatus (`pytest` 9.1.1, test suites passing).
- Verified frontend type checking (`tsc --noEmit` cleanly passing).
- Audited PWA push failure: diagnosed missing `pywebpush` dependency in virtual environment, dummy class fallback returning `mock_public_bytes`, and Docker compose empty string override.

### Phase 1: Push Configuration Repair & Offline Contracts
1. **Fix Push Configuration**:
   - Update `imperium-api/core/config.py` with validator ensuring `PWA_VAPID_SUBJECT` never resolves to an empty string.
   - Update `deploy/digitalocean/docker-compose.yml` with sensible default fallback.
   - Decouple `Vapid` generation in `imperium-api/app/shared/pwa.py` so real EC keys are always loaded/generated.
   - Adjust `PwaPushButton.tsx` to handle dev/preview/production states gracefully.
2. **Offline Architecture Contract**:
   - Establish IndexedDB schema partitioning by `tenant_id`, `user_id`, `project_id`.
   - Define immutable outbox payload structure (`operation_id`, `entity_type`, `action`, `payload`, `status`, `retry_count`, `created_at`).
   - Define server idempotency contract with transaction boundary.

### Phase 2: First End-to-End Vertical Slice (Site Daily Report)
- Implement `OfflineStorage` and `OutboxQueue` in frontend.
- Wire Site Operations daily report draft into IndexedDB.
- Support offline photo capture queue.
- Implement server-side idempotent acknowledgment.
- Test crash recovery and reconnect sync.

### Phase 3: Mobile Field Ergonomics & Shell
- Add mobile bottom navigation dock in `DashboardShell.tsx`.
- Add viewport safe-area styling in `globals.css` and `layout.tsx`.
- Upgrade `OperationalTable.tsx` with responsive mobile card fallback.
- Enforce 48px touch targets and `inputMode` in `FormField.tsx`.

### Phase 4: Module Expansion & Verification
- Expand offline draft capability to Inventory counts, Plant equipment shift logs, and Attendance.
- Run complete test suite and produce test evidence.
