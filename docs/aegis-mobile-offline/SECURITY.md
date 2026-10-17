# AEGIS Offline & Mobile Security Baseline

## 1. Local Storage Partitioning
- All IndexedDB object stores must be partitioned with composite keys:
  `[organization_id, user_id, project_id, entity_id]`.
- Under no circumstances shall user B on a shared field tablet view or sync drafts belonging to user A.

## 2. Token & Credential Rules
- Long-lived database credentials, service role keys, or admin tokens must **never** be stored in IndexedDB or localStorage.
- Supabase session JWT tokens are managed strictly through the client SDK with standard expiration and refresh cycles.
- Disconnected devices cannot make authoritative authorization decisions; the backend enforces full RBAC and RLS upon synchronization.

## 3. Disconnection & Access Revocation
- Offline cached references have a bounded Maximum Offline Period (7 days). After this period without connection, cached sensitive financial/client summaries expire.
- Signing out clears all session credentials while preserving unsubmitted local drafts with an explicit warning banner.
