-- ============================================================================
-- Namecheap Private Email connector support.
-- Namecheap Private Email is standard IMAP/SMTP, not OAuth.
-- ============================================================================

DO $$
DECLARE
    constraint_name text;
BEGIN
    FOR constraint_name IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'crm.connected_accounts'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%provider%'
    LOOP
        EXECUTE format('ALTER TABLE crm.connected_accounts DROP CONSTRAINT %I', constraint_name);
    END LOOP;
END $$;

ALTER TABLE crm.connected_accounts
    ADD CONSTRAINT connected_accounts_provider_check
    CHECK (provider IN (
        'gmail',
        'outlook',
        'google_calendar',
        'microsoft_calendar',
        'namecheap_private_email',
        'whatsapp',
        'maps',
        'documents',
        'accounting'
    ));

DO $$
DECLARE
    constraint_name text;
BEGIN
    FOR constraint_name IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'crm.connected_accounts'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%auth_type%'
    LOOP
        EXECUTE format('ALTER TABLE crm.connected_accounts DROP CONSTRAINT %I', constraint_name);
    END LOOP;
END $$;

ALTER TABLE crm.connected_accounts
    ADD CONSTRAINT connected_accounts_auth_type_check
    CHECK (auth_type IN ('oauth2', 'api_key', 'webhook', 'system', 'imap_smtp'));

CREATE INDEX IF NOT EXISTS connected_accounts_namecheap_email_idx
    ON crm.connected_accounts (organization_id, lower(account_email))
    WHERE provider = 'namecheap_private_email' AND is_deleted = false;
