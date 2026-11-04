-- ============================================================================
-- Migration 281: AEGIS document attestation (signed, verifiable documents)
-- ============================================================================
-- Additive only: two new tables, no change to existing ones.
--
-- Every official document AEGIS issues as a PDF (purchase orders first) gets
-- a row in core.document_attestations: a unique verification code printed on
-- the PDF with a QR link, the SHA-256 of the exact file issued, and an
-- Ed25519 signature over the canonical record. The public verify page looks
-- the code up, re-checks the signature with the public key in
-- core.document_signing_keys, and lets anyone drop the PDF in to compare its
-- hash with the one on record.
--
-- Signing keys are derived on each AEGIS host from its own secret; only the
-- public half is stored here, so a signature made on one host verifies
-- everywhere. Revoking a document sets revoked_at; rows are never deleted.

CREATE TABLE IF NOT EXISTS core.document_signing_keys (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    key_id      text NOT NULL UNIQUE,
    algorithm   text NOT NULL DEFAULT 'ed25519',
    public_key  text NOT NULL,
    label       text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    retired_at  timestamptz
);

CREATE TABLE IF NOT EXISTS core.document_attestations (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id   uuid NOT NULL,
    verification_code text NOT NULL UNIQUE,
    document_type     text NOT NULL,
    document_number   text NOT NULL,
    title             text,
    entity_type       text,
    entity_id         uuid,
    project_id        uuid,
    project_name      text,
    counterparty      text,
    amount            numeric(18, 2),
    currency          varchar(10),
    document_status   text,
    file_sha256       text NOT NULL,
    file_size         integer NOT NULL,
    filename          text,
    payload           jsonb NOT NULL,
    signature         text NOT NULL,
    key_id            text NOT NULL REFERENCES core.document_signing_keys(key_id),
    issued_by         uuid,
    issued_by_name    text,
    issued_at         timestamptz NOT NULL DEFAULT now(),
    revoked_at        timestamptz,
    revoked_by        uuid,
    revoked_reason    text,
    CONSTRAINT document_attestations_sha256_chk CHECK (file_sha256 ~ '^[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS document_attestations_entity_idx
    ON core.document_attestations (organization_id, entity_type, entity_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS document_attestations_number_idx
    ON core.document_attestations (organization_id, document_number);
CREATE INDEX IF NOT EXISTS document_attestations_sha256_idx
    ON core.document_attestations (file_sha256);

DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['document_signing_keys', 'document_attestations'] LOOP
        EXECUTE format('ALTER TABLE core.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE core.%I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('REVOKE ALL ON core.%I FROM anon, authenticated', t);
        EXECUTE format('GRANT ALL ON core.%I TO service_role', t);
        EXECUTE format('DROP POLICY IF EXISTS "%s service role only" ON core.%I', t, t);
        EXECUTE format('CREATE POLICY "%s service role only" ON core.%I FOR ALL TO service_role USING (true) WITH CHECK (true)', t, t);
    END LOOP;
END $$;
