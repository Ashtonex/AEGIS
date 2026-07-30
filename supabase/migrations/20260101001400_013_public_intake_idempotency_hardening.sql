-- Public receipts are deliberately distinct from internal UUID primary keys.
ALTER TABLE crm.web_intakes
    ADD COLUMN IF NOT EXISTS public_reference VARCHAR(32);

UPDATE crm.web_intakes
SET public_reference = 'AEG-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16))
WHERE public_reference IS NULL;

ALTER TABLE crm.web_intakes
    ALTER COLUMN public_reference SET NOT NULL,
    ALTER COLUMN public_reference SET DEFAULT ('AEG-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)));

CREATE UNIQUE INDEX IF NOT EXISTS web_intakes_public_reference_uidx
    ON crm.web_intakes (public_reference);

-- The old index remains compatible with existing requests. The application
-- requires an idempotency key and claims it before creating any CRM/HR record.
