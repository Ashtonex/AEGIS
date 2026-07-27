-- ============================================================================
-- Production Data API exposure review for CRM and finance completion tables.
-- ============================================================================

-- AEGIS operational writes and reads for these schemas are mediated by the
-- authenticated FastAPI service layer. Keep direct Supabase Data API access
-- closed unless a later migration deliberately grants a narrow owner-scoped
-- table permission with matching RLS policy.

REVOKE ALL ON ALL TABLES IN SCHEMA crm FROM anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA finance FROM anon, authenticated;

GRANT USAGE ON SCHEMA crm, finance TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA crm TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA finance TO service_role;
