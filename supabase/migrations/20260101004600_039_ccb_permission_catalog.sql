-- ============================================================================
-- AEGIS MIGRATION 039 — COMMERCIAL CONTROL BRAIN PERMISSION CATALOG
-- Adds permission keys enforced by the CCB override, assembly library, and
-- rate intelligence management endpoints in routers/quotations.py.
-- ============================================================================

INSERT INTO core.permissions (key, description) VALUES
  ('quotations.approve_ccb_override', 'Approve or record an MD/Commercial Manager override on a flagged CCB commercial exception'),
  ('quotations.manage_assemblies', 'Create, update, or retire org-specific construction assembly recipes'),
  ('quotations.manage_rate_intelligence', 'Create, update, or retire org-specific rate intelligence benchmarks')
ON CONFLICT (key) DO NOTHING;
