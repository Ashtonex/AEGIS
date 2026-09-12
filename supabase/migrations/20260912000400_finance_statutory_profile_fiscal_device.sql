-- ============================================================================
-- AEGIS MIGRATION 209 — STATUTORY PROFILE: FISCAL DEVICE REGISTRATION (PHASE 8B)
-- ============================================================================
-- finance.statutory_profile (migration 080) has never had a read or write
-- endpoint anywhere in the backend - Phase 8A's VAT net-position view reads
-- vat_filing_frequency but nothing could ever set it. This phase adds the
-- fiscal device registration fields it needs anyway and, in routers/
-- finance_statutory.py, the first GET/PUT endpoints for the whole table -
-- closing that adjacent gap at the same time rather than leaving it.
--
-- Purely additive - all columns nullable, no existing row affected.
-- ============================================================================

ALTER TABLE finance.statutory_profile
    ADD COLUMN IF NOT EXISTS fiscal_device_serial VARCHAR(60),
    ADD COLUMN IF NOT EXISTS fiscal_device_model VARCHAR(100),
    ADD COLUMN IF NOT EXISTS fiscal_device_registered_at DATE;
