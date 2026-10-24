-- ============================================================================
-- Migration 271: Revoke RPC access to SECURITY DEFINER trigger functions
-- ============================================================================
-- Supabase's security advisor flags public.process_audit_log() (row trigger,
-- 36 triggers) and public.rls_auto_enable() (event trigger) as executable by
-- anon/authenticated via /rest/v1/rpc. Neither is meant to be called directly,
-- and firing a trigger does not check EXECUTE, so revoking is safe.
-- public.get_jwt_org_id() is deliberately left alone: 87 RLS policies call it
-- as the querying role.
-- ============================================================================

REVOKE EXECUTE ON FUNCTION public.process_audit_log() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
