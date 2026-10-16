# AEGIS Migration Governance & Schema Baseline Rules

**System**: Project AEGIS / Imperium Operations Platform  
**Target Enterprise**: Six Nine Construction (Pvt) Ltd (SNC)  
**Authority**: Master System Architect & Reliability Engineer  

---

## 1. Migration File Standards
1. **Immutable Historical Files**: Previously applied migration files (`001_*.sql` through `267_*.sql`) must never be renamed, modified, or reordered.
2. **Strict Sequential Numbering**: New migrations must increment monotonically from the latest applied number (e.g. `268_<description>.sql`).
3. **Dual-Tree Synchronization**: Any migration added to `imperium-api/migrations/` must be synchronized with `supabase/migrations/` using timestamped formatting (`YYYYMMDDHHMMSS_<description>.sql`).

---

## 2. Change Approval & Reversibility
1. **Forward-Compensating Scripts**: If a schema change must be reverted, create a new compensating migration script. Never edit applied SQL or attempt blind `DROP` commands.
2. **Reviewable Artifacts Required**: Destructive schema operations (`DROP COLUMN`, `ALTER TABLE ... TYPE`, `TRUNCATE`) require a written, approved migration plan and verified backup verification.
3. **Production Safety Check**: All DDL statements must be wrapped in transactions where supported by PostgreSQL, with explicit statements setting `statement_timeout = '30s'` to prevent table lock pileups.
