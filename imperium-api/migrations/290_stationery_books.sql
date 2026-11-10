-- ============================================================================
-- Migration 290: AEGIS registered stationery (printed books with QR leaves)
-- ============================================================================
-- Finance and Front Desk keep paper books: payment requests, payment
-- vouchers, purchase orders, petty cash vouchers, main cash funding requests,
-- the petty cash book, acknowledgements of receipt and petty cash
-- replenishment requests. Every leaf AEGIS prints carries a serial number and
-- a QR code that opens <PUBLIC_APP_URL>/q/<token>.
--
-- The token is random and exists only here, so a leaf AEGIS did not print
-- has no valid QR code: anyone who scans it is told it is not an SNC
-- document. A genuine leaf shows its book, who the book was issued to and
-- whether the leaf has been recorded (later: captured and approved) in AEGIS.
--
--   core.stationery_counters  last serial used per book type (blocks are
--                             reserved atomically, so serials never repeat)
--   core.stationery_books     one row per printed book
--   core.stationery_leaves    one row per leaf (copies share the leaf)
--
-- Additive only. Idempotent: safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS core.stationery_counters (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  uuid NOT NULL,
    book_type        text NOT NULL,
    last_serial      integer NOT NULL DEFAULT 0,
    last_book_number integer NOT NULL DEFAULT 0,
    updated_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT stationery_counters_uq UNIQUE (organization_id, book_type)
);

CREATE TABLE IF NOT EXISTS core.stationery_books (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     uuid NOT NULL,
    book_type           text NOT NULL,
    book_number         integer NOT NULL,
    book_label          text NOT NULL,
    first_serial        integer NOT NULL,
    last_serial         integer NOT NULL,
    leaf_count          integer NOT NULL,
    copies              smallint NOT NULL DEFAULT 2,
    page_size           text NOT NULL,
    holder_group        text NOT NULL,
    status              text NOT NULL DEFAULT 'generated',
    batch_id            uuid,
    issued_to_user_id   uuid REFERENCES core.users(id),
    issued_to_name      text,
    issued_department   text,
    issued_at           timestamptz,
    issued_by           uuid REFERENCES core.users(id),
    printed_at          timestamptz,
    closed_at           timestamptz,
    closed_by           uuid REFERENCES core.users(id),
    closed_reason       text,
    notes               text,
    created_by          uuid REFERENCES core.users(id),
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT stationery_books_number_uq UNIQUE (organization_id, book_type, book_number),
    CONSTRAINT stationery_books_status_chk CHECK (status IN ('generated', 'printed', 'issued', 'completed', 'lost', 'cancelled')),
    CONSTRAINT stationery_books_copies_chk CHECK (copies BETWEEN 1 AND 3),
    CONSTRAINT stationery_books_size_chk CHECK (page_size IN ('A4', 'A5', 'A5L')),
    CONSTRAINT stationery_books_holder_chk CHECK (holder_group IN ('finance', 'front_desk')),
    CONSTRAINT stationery_books_range_chk CHECK (last_serial >= first_serial AND leaf_count = last_serial - first_serial + 1)
);

CREATE INDEX IF NOT EXISTS stationery_books_org_idx
    ON core.stationery_books (organization_id, book_type, book_number DESC);
CREATE INDEX IF NOT EXISTS stationery_books_batch_idx
    ON core.stationery_books (batch_id) WHERE batch_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS core.stationery_leaves (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id       uuid NOT NULL,
    book_id               uuid NOT NULL REFERENCES core.stationery_books(id) ON DELETE RESTRICT,
    book_type             text NOT NULL,
    serial                integer NOT NULL,
    serial_label          text NOT NULL,
    leaf_index            integer NOT NULL,
    token                 text NOT NULL,
    status                text NOT NULL DEFAULT 'blank',
    captured_entity_type  text,
    captured_entity_id    uuid,
    captured_at           timestamptz,
    captured_by           uuid REFERENCES core.users(id),
    voided_at             timestamptz,
    voided_by             uuid REFERENCES core.users(id),
    void_reason           text,
    scan_count            integer NOT NULL DEFAULT 0,
    first_scanned_at      timestamptz,
    last_scanned_at       timestamptz,
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT stationery_leaves_token_uq UNIQUE (token),
    CONSTRAINT stationery_leaves_serial_uq UNIQUE (organization_id, book_type, serial),
    CONSTRAINT stationery_leaves_status_chk CHECK (status IN ('blank', 'captured', 'approved', 'voided', 'spoiled')),
    CONSTRAINT stationery_leaves_token_chk CHECK (token ~ '^[0-9A-HJKMNP-TV-Z]{10}$')
);

CREATE INDEX IF NOT EXISTS stationery_leaves_book_idx
    ON core.stationery_leaves (book_id, leaf_index);
CREATE INDEX IF NOT EXISTS stationery_leaves_entity_idx
    ON core.stationery_leaves (captured_entity_type, captured_entity_id) WHERE captured_entity_id IS NOT NULL;

DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['stationery_counters', 'stationery_books', 'stationery_leaves'] LOOP
        EXECUTE format('ALTER TABLE core.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE core.%I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('REVOKE ALL ON core.%I FROM anon, authenticated', t);
        EXECUTE format('GRANT ALL ON core.%I TO service_role', t);
        EXECUTE format('DROP POLICY IF EXISTS "%s service role only" ON core.%I', t, t);
        EXECUTE format('CREATE POLICY "%s service role only" ON core.%I FOR ALL TO service_role USING (true) WITH CHECK (true)', t, t);
    END LOOP;
END $$;

INSERT INTO core.permissions (key, description)
VALUES
    ('finance.stationery.read', 'See AEGIS registered stationery books (payment vouchers, petty cash books, ...) and their leaves.'),
    ('finance.stationery.manage', 'Generate print-ready stationery books, issue them to holders, and void leaves or report books lost.')
ON CONFLICT (key) DO NOTHING;

-- Finance runs the books; executives, Commercial and auditors can look them up.
INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
JOIN core.permissions p ON (
       (r.name IN ('Finance Manager', 'Accounts Payable / Cash Officer')
            AND p.key IN ('finance.stationery.read', 'finance.stationery.manage'))
    OR (r.name IN ('Executive (Admin)', 'Commercial Manager', 'Internal Auditor', 'External Auditor')
            AND p.key = 'finance.stationery.read')
)
ON CONFLICT (role_id, permission_id) DO NOTHING;
