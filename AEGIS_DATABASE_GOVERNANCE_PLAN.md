# AEGIS Database & Migration Governance Plan

**System**: Project AEGIS / Imperium Operations Platform  
**Target Enterprise**: Six Nine Construction (Pvt) Ltd (SNC)  
**Authority**: Master System Architect & Reliability Engineer  
**Governance Principle**: Irreversible schema chaos ends here. Authoritative migration tracking, zero unversioned SQL modifications, and strict forward/compensating change management.

---

## 1. Migration Inventory & Current Reality

- **Runner**: Custom Python script (`run_aegis_migrations.py`) tracking applied migrations in table `public._migrations` or `core._migrations`.
- **Migration Count**: 267 raw `.sql` migration files located in `imperium-api/migrations/` and mirrored in `supabase/migrations/`.
- **Alembic Status**: `alembic/` exists but is historically frozen at migration `042`; current deployments rely on sequential execution of raw `.sql` files.
- **Rollback Capability**: Raw SQL files lack automated down-migrations; schema rollbacks must be planned and executed via forward-compensating migrations (`*_revert.sql` or compensating schema additions).

---

## 2. Target Migration Governance Rules

### Rule 1: No In-Place Mutation of Applied Migrations
Once a migration has run against any staging or production database, its file content and file name are permanently locked. Modifying an existing migration file is strictly prohibited.

### Rule 2: Forward-Compensating Changes Only
To revert a table, drop an index, or modify a constraint, create a new numbered migration that applies the compensating SQL:
```text
268_compensate_revert_legacy_table.sql
```

### Rule 3: Four-Phase Expand/Contract Protocol for Destructive Operations
Never rename or drop a live column in a single step. Follow the industry-standard four-phase cycle:
1. **Expand**: Add the new column as nullable (`ALTER TABLE ... ADD COLUMN new_name ...`).
2. **Backfill**: Mirror writes in the application layer and run an asynchronous background job to copy historical data.
3. **Validate**: Verify 100% parity between old and new columns.
4. **Contract**: Switch application reads to the new column; drop or deprecate the old column in a subsequent release.

### Rule 4: Mandatory Idempotency
Every migration script must be idempotent:
```sql
CREATE TABLE IF NOT EXISTS procurement.example (...);
CREATE INDEX IF NOT EXISTS idx_example ON procurement.example (organization_id);
ALTER TABLE procurement.example ADD COLUMN IF NOT EXISTS notes text;
```

---

## 3. Database Connection & Pool Safety Policy
1. **Supavisor Compatibility**: Because production routes through Supavisor port 6543 in transaction mode, statements must avoid session-level locks or transaction-leaking `LISTEN/NOTIFY`.
2. **Timeout Boundaries**: Every migration runner connection must enforce `SET statement_timeout = '30s'` to prevent table-lock pileups.
3. **Zero Data Deletion in Incidental Repairs**: Migrations must never contain unvetted `TRUNCATE` or `DROP TABLE` statements without an approved, verified database snapshot and management sign-off.
