-- ============================================================================
-- AEGIS MIGRATION 263 — PLANT & EQUIPMENT CROSS-HIRE & SUB-LEASE BROKERAGE
-- ============================================================================
-- Implements the back-to-back cross-hire / sub-lease business model:
--   - Manager sources plant/equipment from Supplier/Owner A at Buy/Lease Rate
--   - Manager hires out to Client B at Sell/Hire Rate
--   - Company retains the spread / margin (e.g. $1.00 from A -> $1.50 to B = $0.50 margin)
--   - Tracks Supplier A payables, Client B receivables, and net realized profitability.
-- ============================================================================

ALTER TABLE fleet.external_hire_agreements
    ADD COLUMN IF NOT EXISTS fulfillment_type VARCHAR(32) NOT NULL DEFAULT 'owned_fleet',
    ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES procurement.suppliers(id),
    ADD COLUMN IF NOT EXISTS supplier_name VARCHAR(255),
    ADD COLUMN IF NOT EXISTS supplier_contact VARCHAR(255),
    ADD COLUMN IF NOT EXISTS supplier_agreement_number VARCHAR(120),
    ADD COLUMN IF NOT EXISTS sourcing_rate NUMERIC(15,4) NOT NULL DEFAULT 0 CHECK (sourcing_rate >= 0),
    ADD COLUMN IF NOT EXISTS sourcing_rate_unit VARCHAR(24) NOT NULL DEFAULT 'hourly',
    ADD COLUMN IF NOT EXISTS supplier_terms VARCHAR(32) NOT NULL DEFAULT 'dry_hire',
    ADD COLUMN IF NOT EXISTS supplier_fuel_responsibility VARCHAR(24) NOT NULL DEFAULT 'snc',
    ADD COLUMN IF NOT EXISTS supplier_deposit_paid NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (supplier_deposit_paid >= 0),
    ADD COLUMN IF NOT EXISTS supplier_mobilisation_cost NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (supplier_mobilisation_cost >= 0),
    ADD COLUMN IF NOT EXISTS supplier_demobilisation_cost NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (supplier_demobilisation_cost >= 0),
    ADD COLUMN IF NOT EXISTS supplier_standing_rate NUMERIC(15,4) CHECK (supplier_standing_rate IS NULL OR supplier_standing_rate >= 0),
    ADD COLUMN IF NOT EXISTS supplier_payable_amount NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (supplier_payable_amount >= 0),
    ADD COLUMN IF NOT EXISTS supplier_payment_status VARCHAR(32) NOT NULL DEFAULT 'not_invoiced',
    ADD COLUMN IF NOT EXISTS supplier_invoice_reference VARCHAR(120),
    ADD COLUMN IF NOT EXISTS sourced_asset_category VARCHAR(80),
    ADD COLUMN IF NOT EXISTS sourced_asset_make_model VARCHAR(160),
    ADD COLUMN IF NOT EXISTS sourced_asset_reg_serial VARCHAR(120),
    ADD COLUMN IF NOT EXISTS sourced_meter_start NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (sourced_meter_start >= 0),
    ADD COLUMN IF NOT EXISTS sourced_meter_end NUMERIC(14,2) CHECK (sourced_meter_end IS NULL OR sourced_meter_end >= 0),
    ADD COLUMN IF NOT EXISTS unit_spread NUMERIC(15,4) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS unit_spread_percentage NUMERIC(6,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS projected_hours_or_units NUMERIC(10,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS projected_revenue NUMERIC(15,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS projected_cost NUMERIC(15,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS projected_gross_profit NUMERIC(15,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS realized_gross_profit NUMERIC(15,2) NOT NULL DEFAULT 0;

ALTER TABLE fleet.external_hire_agreements
    DROP CONSTRAINT IF EXISTS fleet_fulfillment_type_check,
    DROP CONSTRAINT IF EXISTS fleet_sourcing_rate_unit_check,
    DROP CONSTRAINT IF EXISTS fleet_supplier_terms_check,
    DROP CONSTRAINT IF EXISTS fleet_supplier_fuel_resp_check,
    DROP CONSTRAINT IF EXISTS fleet_supplier_payment_status_check;

ALTER TABLE fleet.external_hire_agreements
    ADD CONSTRAINT fleet_fulfillment_type_check
        CHECK (fulfillment_type IN ('owned_fleet', 'cross_hire', 'sub_lease')) NOT VALID,
    ADD CONSTRAINT fleet_sourcing_rate_unit_check
        CHECK (sourcing_rate_unit IN ('hourly', 'daily', 'weekly', 'monthly', 'output_based', 'flat')) NOT VALID,
    ADD CONSTRAINT fleet_supplier_terms_check
        CHECK (supplier_terms IN ('dry_hire', 'wet_hire', 'dry_with_maintenance', 'other')) NOT VALID,
    ADD CONSTRAINT fleet_supplier_fuel_resp_check
        CHECK (supplier_fuel_responsibility IN ('supplier', 'snc', 'client')) NOT VALID,
    ADD CONSTRAINT fleet_supplier_payment_status_check
        CHECK (supplier_payment_status IN ('not_invoiced', 'invoice_received', 'approved', 'paid', 'disputed')) NOT VALID;

ALTER TABLE fleet.external_hire_agreements VALIDATE CONSTRAINT fleet_fulfillment_type_check;
ALTER TABLE fleet.external_hire_agreements VALIDATE CONSTRAINT fleet_sourcing_rate_unit_check;
ALTER TABLE fleet.external_hire_agreements VALIDATE CONSTRAINT fleet_supplier_terms_check;
ALTER TABLE fleet.external_hire_agreements VALIDATE CONSTRAINT fleet_supplier_fuel_resp_check;
ALTER TABLE fleet.external_hire_agreements VALIDATE CONSTRAINT fleet_supplier_payment_status_check;

CREATE INDEX IF NOT EXISTS ix_external_hire_fulfillment
    ON fleet.external_hire_agreements (organization_id, fulfillment_type, status)
    WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS ix_external_hire_supplier
    ON fleet.external_hire_agreements (organization_id, supplier_name)
    WHERE supplier_name IS NOT NULL AND is_deleted = false;
