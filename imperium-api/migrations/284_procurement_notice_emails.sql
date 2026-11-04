-- ============================================================================
-- Migration 284: Supplier emails for procurement notices
-- ============================================================================
-- A notice that opens for quotations is announced by email to the active
-- suppliers on the register; when it is awarded, cancelled or closed without
-- an award, every supplier that quoted is told the outcome (never who won).
-- The scheduled job (app/services/procurement_notice_emails.py) records each
-- email here before sending it, so every email goes out once, a failed send
-- is retried on the next run, and nothing is sent twice.
--
-- Notices that already existed before this migration are not announced
-- retroactively (announce = false); their outcomes are still sent.
--
-- Additive and idempotent: one new table, one new column.
-- ============================================================================

ALTER TABLE procurement.public_notices
    ADD COLUMN IF NOT EXISTS announce boolean NOT NULL DEFAULT true;

DO $$
BEGIN
    -- Only on the first run: once the email log exists the backfill is done.
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'procurement' AND table_name = 'notice_email_log'
    ) THEN
        UPDATE procurement.public_notices SET announce = false;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS procurement.notice_email_log (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  uuid NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    notice_id        uuid NOT NULL REFERENCES procurement.public_notices(id) ON DELETE CASCADE,
    kind             text NOT NULL CHECK (kind IN ('new_notice', 'outcome')),
    supplier_id      uuid REFERENCES procurement.suppliers(id) ON DELETE SET NULL,
    recipient_email  text NOT NULL,
    outcome          text,
    status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
    attempts         integer NOT NULL DEFAULT 0,
    last_error       text,
    sent_at          timestamptz,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT notice_email_log_once UNIQUE (notice_id, kind, recipient_email)
);

CREATE INDEX IF NOT EXISTS notice_email_log_pending_idx
    ON procurement.notice_email_log (status, attempts) WHERE status <> 'sent';

ALTER TABLE procurement.notice_email_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement.notice_email_log FORCE ROW LEVEL SECURITY;
REVOKE ALL ON procurement.notice_email_log FROM anon, authenticated;
GRANT ALL ON procurement.notice_email_log TO service_role;
DROP POLICY IF EXISTS "notice_email_log service role only" ON procurement.notice_email_log;
CREATE POLICY "notice_email_log service role only" ON procurement.notice_email_log
    FOR ALL TO service_role USING (true) WITH CHECK (true);
