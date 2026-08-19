-- Site material requests can now be submitted with no known price (sites
-- don't have supplier quotations). Rather than silently substituting the
-- item's standard_cost, an unpriced request is flagged so procurement or
-- inventory must confirm the real price before it's treated as settled.

ALTER TABLE procurement.material_requests
    ADD COLUMN IF NOT EXISTS is_price_confirmed BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS priced_by UUID REFERENCES core.users(id),
    ADD COLUMN IF NOT EXISTS priced_at TIMESTAMPTZ;

ALTER TABLE procurement.requisition_lines
    ADD COLUMN IF NOT EXISTS is_price_confirmed BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS material_requests_pending_pricing_idx
    ON procurement.material_requests (organization_id, is_price_confirmed)
    WHERE is_price_confirmed = false;
