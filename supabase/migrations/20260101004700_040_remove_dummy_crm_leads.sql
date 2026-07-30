-- ============================================================================
-- AEGIS MIGRATION 040 — REMOVE DUMMY DEMO LEADS FROM CRM
-- Migration 003_crm_leads_engine.sql originally inserted 3 hardcoded demo
-- leads ("Insert some dummy leads for testing the Intelligence Grid") directly
-- into crm.leads for every organization present at the time it ran. Those rows
-- are indistinguishable from real leads in the CRM UI. This removes them by
-- exact match on the fabricated content, so it cannot touch any real lead a
-- user has since created — even one that happens to share a company name.
-- ============================================================================

DELETE FROM crm.leads
WHERE lead_source = 'Government Gazette'
  AND company_name = 'Ministry of Transport'
  AND contact_name = 'Dir. of Roads'
  AND estimated_budget = 15000000.00
  AND ai_score = 92
  AND ai_rationale = 'High historical win-rate in Government sector. Budget matches heavy-equipment capability.';

DELETE FROM crm.leads
WHERE lead_source = 'Website Enquiry'
  AND company_name = 'Zimplats'
  AND contact_name = 'Procurement Manager'
  AND estimated_budget = 450000.00
  AND ai_score = 85
  AND ai_rationale = 'Mining sector has fast payment terms. High propensity to convert.';

DELETE FROM crm.leads
WHERE lead_source = 'Manual Entry'
  AND company_name = 'Local Supermarket Chain'
  AND contact_name = 'Facilities Manager'
  AND estimated_budget = 25000.00
  AND ai_score = 31
  AND ai_rationale = 'Low margin, low budget. Deprioritized based on opportunity cost.';
