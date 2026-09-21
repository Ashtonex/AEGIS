-- ============================================================================
-- AEGIS MIGRATION 224 — ZIMRA VAT OUTPUT RATE TABLE (15.5%)
-- ============================================================================
-- Records the ZIMRA VAT output rate table requested by Finance (2026-09-21)
-- as a tracked migration, matching what was already applied directly to
-- production so this session's git history and the live database agree.
--
-- Without an active vat_output rate table, every VAT accrual call site
-- (progress-claim certification, deposit recognition, historical revenue
-- backfill - all via app/services/finance/tax_rates.py) silently computes
-- $0 VAT rather than guessing a rate (see tax_rates.py's NoRateTableError:
-- "a silently wrong tax figure is a compliance failure, not a degraded
-- feature"). This is what unblocks that for every org going forward.
--
-- Idempotent via the table's own UNIQUE (organization_id, tax_type,
-- currency, period_basis, effective_from) constraint - re-running this on
-- an environment that already has the row is a no-op, not a duplicate.
-- Applies org-wide (there is currently one org, Six Nine Construction) by
-- iterating core.organizations rather than hardcoding its id.
-- ============================================================================

DO $$
DECLARE
    org RECORD;
    new_table_id UUID;
BEGIN
    FOR org IN SELECT id FROM core.organizations WHERE is_deleted = false LOOP
        INSERT INTO finance.tax_rate_tables (
            organization_id, tax_type, currency, period_basis, effective_from, effective_to,
            name, source_reference
        ) VALUES (
            org.id, 'vat_output', 'USD', 'per_transaction', DATE '2026-01-01', NULL,
            'ZIMRA VAT Output 15.5%', 'Configured per Finance request 2026-09-21'
        )
        ON CONFLICT (organization_id, tax_type, currency, period_basis, effective_from) DO NOTHING
        RETURNING id INTO new_table_id;

        IF new_table_id IS NOT NULL THEN
            INSERT INTO finance.tax_rate_bands (
                organization_id, rate_table_id, band_order, lower_bound, upper_bound,
                rate_pct, fixed_deduction, band_cap_amount, notes
            ) VALUES (
                org.id, new_table_id, 1, 0, NULL, 15.5, 0, NULL, 'Flat VAT output rate'
            );
        END IF;

        new_table_id := NULL;
    END LOOP;
END $$;
