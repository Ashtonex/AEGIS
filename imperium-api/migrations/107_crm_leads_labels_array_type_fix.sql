-- ============================================================================
-- Fix crm.leads.labels: stuck as VARCHAR(255), should be TEXT[]
-- ============================================================================
-- 004_crm_leads_assignment.sql originally added `labels VARCHAR(255)`.
-- 041_crm_completion_phases_1_6.sql later tried to change it to
-- `labels TEXT[] NOT NULL DEFAULT '{}'::text[]` via ADD COLUMN IF NOT
-- EXISTS - since the column already existed, that silently no-op'd and
-- never actually changed the type. Every piece of code downstream (the
-- merge-leads SQL's `unnest(COALESCE(labels, '{}'::text[]) || ...)`, the
-- frontend's `Lead.labels?: string[] | null` type and `.join(', ')` calls
-- on it, and the manual-lead-creation form sending a JS array) has always
-- assumed the TEXT[] migration actually landed. It didn't, so any manual
-- lead create/update sending a `labels` array has always failed with an
-- asyncpg "expected str, got list" error - masked by the generic "Could
-- not save manual lead" toast on the frontend.
--
-- Safe to convert directly: zero existing rows have a non-empty labels
-- value (confirmed before writing this migration).
-- ============================================================================

ALTER TABLE crm.leads
    ALTER COLUMN labels DROP DEFAULT,
    ALTER COLUMN labels TYPE TEXT[] USING (
        CASE WHEN labels IS NULL OR labels = '' THEN '{}'::text[] ELSE string_to_array(labels, ',') END
    ),
    ALTER COLUMN labels SET NOT NULL,
    ALTER COLUMN labels SET DEFAULT '{}'::text[];
