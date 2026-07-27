-- ============================================================================
-- PROJECT IMPERIUM - SUPERADMIN PROVISIONING SAFETY
-- Migration: 038_superadmin_ashton_crafting.sql
-- ============================================================================

-- This migration previously attempted to craft a hardcoded SUPERADMIN identity
-- for ashton@admin.com. Production migrations must not create users, mutate
-- auth.users claims, or assign user roles. Identity provisioning belongs in the
-- approved auth onboarding flow or explicit seed migrations excluded from
-- production runs.

DO $$
BEGIN
    RAISE NOTICE '038_superadmin_ashton_crafting.sql is intentionally a no-op. Use the approved admin provisioning flow or explicit seed migrations outside production.';
END $$;
