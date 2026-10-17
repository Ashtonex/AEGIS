# AEGIS Rollout and Recovery Protocol

## 1. Rollout Gates
1. **Local Automated Verification**: Typechecks, unit tests, and contract tests pass 100%.
2. **Offline Resilience Verification**: Submission interrupted mid-flight succeeds on retry with idempotent receipt.
3. **PWA & Cache Rollout**: Backward-compatible service worker caching. Never wipe IndexedDB on service worker update.
4. **Field Pilot Acceptance**: Tested by designated site engineer on mobile network before full organization deployment.

## 2. Recovery Procedures
- **Rollback Compatibility**: If a frontend release is rolled back, the local database schema must remain backwards-compatible or safely migrate without dropping pending outbox entries.
- **Dead-Letter Recovery**: Any submission that permanently fails server validation is moved to a "Blocked Operations" review drawer where the user can inspect errors and export or correct the payload.
