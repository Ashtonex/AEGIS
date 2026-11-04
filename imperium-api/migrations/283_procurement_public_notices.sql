-- ============================================================================
-- Migration 283: Public procurement notices (SNC tenders on the website)
-- ============================================================================
-- Every request for quotation and every purchase order SNC issues gets a
-- public notice with its own reference (SNC-PN-2026-0001). The website tender
-- board lists them and /tenders/<reference> shows each one's live status:
-- Active, Under evaluation, Awarded, In delivery, Fulfilled, Dormant or
-- Cancelled. The status is worked out when the notice is read, from the RFQ,
-- its purchase orders and their deliveries; this table only holds the public
-- reference, which source it follows, whether it is shown, and when anything
-- last moved.
--
-- One notice per RFQ; purchase orders raised from that RFQ move the same
-- notice to Awarded. A purchase order raised without an RFQ gets a notice of
-- its own. Triggers create the notice the moment an RFQ or PO is issued,
-- whichever route issued it, and bump last_activity_at whenever its RFQ or
-- POs change status or goods are received against them (Dormant = no
-- movement for 30 days).
--
-- The public never sees amounts, supplier names or PO notes: the public API
-- selects title, project, dates and status only.
--
-- Additive and idempotent: one new table, one sequence, three triggers.
-- ============================================================================

CREATE SEQUENCE IF NOT EXISTS procurement.public_notice_seq;

CREATE TABLE IF NOT EXISTS procurement.public_notices (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id    uuid NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    reference          text NOT NULL UNIQUE,
    rfq_id             uuid UNIQUE REFERENCES procurement.rfqs(id) ON DELETE CASCADE,
    purchase_order_id  uuid UNIQUE REFERENCES procurement.purchase_orders(id) ON DELETE CASCADE,
    is_published       boolean NOT NULL DEFAULT true,
    hidden_reason      text,
    hidden_by          uuid REFERENCES core.users(id),
    hidden_at          timestamptz,
    published_at       timestamptz NOT NULL DEFAULT now(),
    last_activity_at   timestamptz NOT NULL DEFAULT now(),
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    -- An RFQ notice, or a direct-PO notice; never both, never neither.
    CONSTRAINT public_notices_one_source_chk CHECK ((rfq_id IS NULL) <> (purchase_order_id IS NULL))
);

CREATE INDEX IF NOT EXISTS public_notices_board_idx
    ON procurement.public_notices (organization_id, is_published, published_at DESC);

ALTER TABLE procurement.public_notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement.public_notices FORCE ROW LEVEL SECURITY;
REVOKE ALL ON procurement.public_notices FROM anon, authenticated;
GRANT ALL ON procurement.public_notices TO service_role;
GRANT USAGE ON SEQUENCE procurement.public_notice_seq TO service_role;
DROP POLICY IF EXISTS "public_notices service role only" ON procurement.public_notices;
CREATE POLICY "public_notices service role only" ON procurement.public_notices
    FOR ALL TO service_role USING (true) WITH CHECK (true);


-- Next public reference: SNC-PN-<year>-<0001>.
CREATE OR REPLACE FUNCTION procurement.next_public_notice_reference(at_time timestamptz)
RETURNS text
LANGUAGE sql
SET search_path = procurement, pg_catalog
AS $$
    SELECT 'SNC-PN-' || to_char(at_time AT TIME ZONE 'Africa/Harare', 'YYYY') || '-'
           || lpad(nextval('procurement.public_notice_seq')::text, 4, '0');
$$;


-- RFQ issued (or later stages): make sure its notice exists; any status change
-- counts as movement.
CREATE OR REPLACE FUNCTION procurement.sync_rfq_public_notice()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = procurement, pg_catalog
AS $$
BEGIN
    IF NEW.is_deleted OR NEW.status = 'draft' THEN
        RETURN NEW;
    END IF;
    -- A draft cancelled before it was ever issued never went public.
    IF NEW.status = 'cancelled' AND NEW.issued_at IS NULL THEN
        RETURN NEW;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM procurement.public_notices WHERE rfq_id = NEW.id) THEN
        INSERT INTO procurement.public_notices (organization_id, reference, rfq_id, published_at, last_activity_at)
        VALUES (NEW.organization_id, procurement.next_public_notice_reference(COALESCE(NEW.issued_at, now())),
                NEW.id, COALESCE(NEW.issued_at, now()), now());
    ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
        UPDATE procurement.public_notices SET last_activity_at = now(), updated_at = now() WHERE rfq_id = NEW.id;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS rfqs_public_notice ON procurement.rfqs;
CREATE TRIGGER rfqs_public_notice
    AFTER INSERT OR UPDATE OF status, issued_at, is_deleted ON procurement.rfqs
    FOR EACH ROW EXECUTE FUNCTION procurement.sync_rfq_public_notice();


-- PO issued (or later stages): a PO from an RFQ moves the RFQ's notice; a
-- direct PO gets its own notice. Drafts and approved-but-unissued POs are
-- not public.
CREATE OR REPLACE FUNCTION procurement.sync_po_public_notice()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = procurement, pg_catalog
AS $$
DECLARE
    rfq_org uuid;
    rfq_issued timestamptz;
BEGIN
    IF NEW.is_deleted OR NEW.status IN ('draft', 'approved') THEN
        RETURN NEW;
    END IF;
    IF NEW.status = 'cancelled' AND NEW.issued_at IS NULL THEN
        RETURN NEW;
    END IF;
    IF NEW.rfq_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM procurement.public_notices WHERE rfq_id = NEW.rfq_id) THEN
            SELECT organization_id, issued_at INTO rfq_org, rfq_issued FROM procurement.rfqs WHERE id = NEW.rfq_id;
            INSERT INTO procurement.public_notices (organization_id, reference, rfq_id, published_at, last_activity_at)
            VALUES (COALESCE(rfq_org, NEW.organization_id),
                    procurement.next_public_notice_reference(COALESCE(rfq_issued, NEW.issued_at, now())),
                    NEW.rfq_id, COALESCE(rfq_issued, NEW.issued_at, now()), now());
        ELSE
            UPDATE procurement.public_notices SET last_activity_at = now(), updated_at = now() WHERE rfq_id = NEW.rfq_id;
        END IF;
    ELSIF NOT EXISTS (SELECT 1 FROM procurement.public_notices WHERE purchase_order_id = NEW.id) THEN
        INSERT INTO procurement.public_notices (organization_id, reference, purchase_order_id, published_at, last_activity_at)
        VALUES (NEW.organization_id, procurement.next_public_notice_reference(COALESCE(NEW.issued_at, now())),
                NEW.id, COALESCE(NEW.issued_at, now()), now());
    ELSE
        UPDATE procurement.public_notices SET last_activity_at = now(), updated_at = now() WHERE purchase_order_id = NEW.id;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS purchase_orders_public_notice ON procurement.purchase_orders;
CREATE TRIGGER purchase_orders_public_notice
    AFTER INSERT OR UPDATE OF status, issued_at, rfq_id, is_deleted ON procurement.purchase_orders
    FOR EACH ROW EXECUTE FUNCTION procurement.sync_po_public_notice();


-- Goods received against a PO is movement on its notice, even when the PO's
-- status does not change (a second part-delivery).
CREATE OR REPLACE FUNCTION procurement.touch_public_notice_on_grn()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = procurement, pg_catalog
AS $$
BEGIN
    UPDATE procurement.public_notices n
    SET last_activity_at = now(), updated_at = now()
    FROM procurement.purchase_orders po
    WHERE po.id = NEW.po_id
      AND (n.purchase_order_id = po.id OR (po.rfq_id IS NOT NULL AND n.rfq_id = po.rfq_id));
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS goods_received_public_notice ON procurement.goods_received_notes;
CREATE TRIGGER goods_received_public_notice
    AFTER INSERT ON procurement.goods_received_notes
    FOR EACH ROW EXECUTE FUNCTION procurement.touch_public_notice_on_grn();

REVOKE EXECUTE ON FUNCTION procurement.sync_rfq_public_notice() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION procurement.sync_po_public_notice() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION procurement.touch_public_notice_on_grn() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION procurement.next_public_notice_reference(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION procurement.next_public_notice_reference(timestamptz) TO service_role;


-- Backfill: notices for RFQs and POs already issued, oldest first so the
-- references run in issue order. Last activity is the source's own last
-- update, so an old untouched order shows as Dormant straight away rather
-- than looking fresh. Test records are created hidden.
DO $$
DECLARE
    src record;
BEGIN
    FOR src IN
        SELECT 'rfq' AS kind, r.id, r.organization_id, COALESCE(r.issued_at, r.created_at) AS issued,
               r.updated_at, false AS is_test
        FROM procurement.rfqs r
        WHERE r.is_deleted = false AND r.status <> 'draft'
          AND NOT (r.status = 'cancelled' AND r.issued_at IS NULL)
          AND NOT EXISTS (SELECT 1 FROM procurement.public_notices n WHERE n.rfq_id = r.id)
        UNION ALL
        SELECT 'po', po.id, po.organization_id, COALESCE(po.issued_at, po.created_at),
               po.updated_at, po.po_number ILIKE '%TEST%'
        FROM procurement.purchase_orders po
        WHERE po.is_deleted = false AND po.rfq_id IS NULL AND po.status NOT IN ('draft', 'approved')
          AND NOT (po.status = 'cancelled' AND po.issued_at IS NULL)
          AND NOT EXISTS (SELECT 1 FROM procurement.public_notices n WHERE n.purchase_order_id = po.id)
        ORDER BY 4
    LOOP
        INSERT INTO procurement.public_notices (
            organization_id, reference, rfq_id, purchase_order_id, published_at, last_activity_at,
            is_published, hidden_reason, hidden_at
        ) VALUES (
            src.organization_id, procurement.next_public_notice_reference(src.issued),
            CASE WHEN src.kind = 'rfq' THEN src.id END,
            CASE WHEN src.kind = 'po' THEN src.id END,
            src.issued, GREATEST(src.issued, src.updated_at),
            NOT src.is_test,
            CASE WHEN src.is_test THEN 'Test record - hidden when notices were introduced.' END,
            CASE WHEN src.is_test THEN now() END
        );
    END LOOP;
END $$;
