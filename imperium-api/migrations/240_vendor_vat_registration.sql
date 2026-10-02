-- ============================================================================
-- AEGIS MIGRATION 240 — VENDOR VAT REGISTRATION
-- ============================================================================
-- Vendor/subcontractor verification now keys on four things: the registered
-- company name, the company registration number, tax clearance, and VAT.
-- NSSA and PRAZ are still captured but no longer block verification.
--
-- crm.subcontractors had no VAT field at all. procurement.suppliers has
-- vat_registration_number and is_vat_registered, but is_vat_registered is
-- NOT NULL DEFAULT false, so "declared not VAT registered" can't be told
-- apart from "never asked". Both tables get vat_status:
--   'registered'      - VAT number (and certificate) required
--   'not_registered'  - vendor declared it isn't VAT registered
--   NULL              - not answered yet; blocks verification
-- crm.subcontractors also gets vat_number.
-- ============================================================================

ALTER TABLE crm.subcontractors
    ADD COLUMN IF NOT EXISTS vat_number VARCHAR(100),
    ADD COLUMN IF NOT EXISTS vat_status VARCHAR(20);

ALTER TABLE crm.subcontractors
    DROP CONSTRAINT IF EXISTS subcontractors_vat_status_check;
ALTER TABLE crm.subcontractors
    ADD CONSTRAINT subcontractors_vat_status_check
    CHECK (vat_status IN ('registered', 'not_registered'));

ALTER TABLE procurement.suppliers
    ADD COLUMN IF NOT EXISTS vat_status VARCHAR(20);

ALTER TABLE procurement.suppliers
    DROP CONSTRAINT IF EXISTS suppliers_vat_status_check;
ALTER TABLE procurement.suppliers
    ADD CONSTRAINT suppliers_vat_status_check
    CHECK (vat_status IN ('registered', 'not_registered'));

-- A supplier that already has a VAT number on file is VAT registered.
UPDATE procurement.suppliers
SET vat_status = 'registered'
WHERE vat_status IS NULL
  AND NULLIF(BTRIM(vat_registration_number), '') IS NOT NULL;
