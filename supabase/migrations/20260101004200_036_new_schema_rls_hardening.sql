-- =============================================================================
-- 036_new_schema_rls_hardening.sql
-- Harden Row Level Security on all tables introduced in migrations 033-035.
-- These tables were created without explicit service-role-only policies,
-- leaving them potentially readable by the Supabase Data API if the
-- corresponding schema is exposed.  This migration closes that gap without
-- altering any existing data or application logic.
--
-- Also creates DB sequences required by the payments and payroll_runs
-- routers for generating human-readable reference numbers.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Sequences for human-readable reference numbers
-- ---------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS finance.supplier_payment_batch_seq
    START WITH 1 INCREMENT BY 1 NO CYCLE;

CREATE SEQUENCE IF NOT EXISTS finance.payroll_run_seq
    START WITH 1 INCREMENT BY 1 NO CYCLE;


-- ---------------------------------------------------------------------------
-- 1. core.notifications
--    Already has RLS ENABLED in migration 033 but only a service-role policy
--    for SELECT.  Confirm the policy covers ALL operations and force RLS so
--    no superuser bypass is possible at the application layer.
-- ---------------------------------------------------------------------------
ALTER TABLE core.notifications FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Notifications service role only" ON core.notifications;
CREATE POLICY "Notifications service role only" ON core.notifications
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 2. core.pwa_push_subscriptions
--    Created in migration 034 with no RLS at all.
--    These rows contain browser endpoint URLs, p256dh and auth keys —
--    extremely sensitive; must be owner-scoped.
-- ---------------------------------------------------------------------------
ALTER TABLE core.pwa_push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.pwa_push_subscriptions FORCE ROW LEVEL SECURITY;

REVOKE ALL ON core.pwa_push_subscriptions FROM anon;

-- Service role can manage all subscriptions (needed for push dispatch)
DROP POLICY IF EXISTS "PWA subscriptions service role" ON core.pwa_push_subscriptions;
CREATE POLICY "PWA subscriptions service role" ON core.pwa_push_subscriptions
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Authenticated users can only see and manage their own subscriptions
DROP POLICY IF EXISTS "PWA subscriptions owner read" ON core.pwa_push_subscriptions;
CREATE POLICY "PWA subscriptions owner read" ON core.pwa_push_subscriptions
    FOR SELECT TO authenticated
    USING (user_id = (current_setting('request.jwt.claim.sub', true))::uuid);

DROP POLICY IF EXISTS "PWA subscriptions owner write" ON core.pwa_push_subscriptions;
CREATE POLICY "PWA subscriptions owner write" ON core.pwa_push_subscriptions
    FOR INSERT TO authenticated
    WITH CHECK (user_id = (current_setting('request.jwt.claim.sub', true))::uuid);

DROP POLICY IF EXISTS "PWA subscriptions owner delete" ON core.pwa_push_subscriptions;
CREATE POLICY "PWA subscriptions owner delete" ON core.pwa_push_subscriptions
    FOR DELETE TO authenticated
    USING (user_id = (current_setting('request.jwt.claim.sub', true))::uuid);

-- ---------------------------------------------------------------------------
-- 3. finance.cash_accounts, finance.cashbook_transactions,
--    finance.receipt_allocations, finance.supplier_payment_batches,
--    finance.supplier_payment_items, finance.employee_pay_profiles,
--    finance.payroll_runs, finance.payroll_items
--
--    Migration 034 called ENABLE ROW LEVEL SECURITY + FORCE, but did NOT
--    create any policies.  Without a policy, ALL access is denied by default
--    even for the service role — which means the API would silently return
--    empty result sets rather than errors.  Add explicit service-role policies.
-- ---------------------------------------------------------------------------

-- cash_accounts
DROP POLICY IF EXISTS "Finance cash accounts service role" ON finance.cash_accounts;
CREATE POLICY "Finance cash accounts service role" ON finance.cash_accounts
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- cashbook_transactions
DROP POLICY IF EXISTS "Finance cashbook service role" ON finance.cashbook_transactions;
CREATE POLICY "Finance cashbook service role" ON finance.cashbook_transactions
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- receipt_allocations
DROP POLICY IF EXISTS "Finance receipt allocations service role" ON finance.receipt_allocations;
CREATE POLICY "Finance receipt allocations service role" ON finance.receipt_allocations
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- supplier_payment_batches
DROP POLICY IF EXISTS "Finance supplier payment batches service role" ON finance.supplier_payment_batches;
CREATE POLICY "Finance supplier payment batches service role" ON finance.supplier_payment_batches
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- supplier_payment_items
DROP POLICY IF EXISTS "Finance supplier payment items service role" ON finance.supplier_payment_items;
CREATE POLICY "Finance supplier payment items service role" ON finance.supplier_payment_items
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- employee_pay_profiles
DROP POLICY IF EXISTS "Finance employee pay profiles service role" ON finance.employee_pay_profiles;
CREATE POLICY "Finance employee pay profiles service role" ON finance.employee_pay_profiles
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- payroll_runs
DROP POLICY IF EXISTS "Finance payroll runs service role" ON finance.payroll_runs;
CREATE POLICY "Finance payroll runs service role" ON finance.payroll_runs
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- payroll_items
DROP POLICY IF EXISTS "Finance payroll items service role" ON finance.payroll_items;
CREATE POLICY "Finance payroll items service role" ON finance.payroll_items
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 4. Harden the audit trigger: ensure it fires on the new finance tables.
--    The trigger function already exists from migration 031.  We only need
--    to attach it to tables that were added later.
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS audit_cash_accounts ON finance.cash_accounts;
CREATE TRIGGER audit_cash_accounts
    AFTER INSERT OR UPDATE OR DELETE ON finance.cash_accounts
    FOR EACH ROW EXECUTE FUNCTION core.process_audit_log();

DROP TRIGGER IF EXISTS audit_cashbook_transactions ON finance.cashbook_transactions;
CREATE TRIGGER audit_cashbook_transactions
    AFTER INSERT OR UPDATE OR DELETE ON finance.cashbook_transactions
    FOR EACH ROW EXECUTE FUNCTION core.process_audit_log();

DROP TRIGGER IF EXISTS audit_supplier_payment_batches ON finance.supplier_payment_batches;
CREATE TRIGGER audit_supplier_payment_batches
    AFTER INSERT OR UPDATE OR DELETE ON finance.supplier_payment_batches
    FOR EACH ROW EXECUTE FUNCTION core.process_audit_log();

DROP TRIGGER IF EXISTS audit_payroll_runs ON finance.payroll_runs;
CREATE TRIGGER audit_payroll_runs
    AFTER INSERT OR UPDATE OR DELETE ON finance.payroll_runs
    FOR EACH ROW EXECUTE FUNCTION core.process_audit_log();

DROP TRIGGER IF EXISTS audit_notifications ON core.notifications;
CREATE TRIGGER audit_notifications
    AFTER INSERT OR UPDATE OR DELETE ON core.notifications
    FOR EACH ROW EXECUTE FUNCTION core.process_audit_log();
