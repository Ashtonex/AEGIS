-- ============================================================================
-- AEGIS MIGRATION: SNC FINANCIAL DATA ROOM - ACCESS CONTROL HARDENING
-- Follow-up to 20260908000000_snc_financial_data_room.sql. That migration
-- left its three new tables without row level security, so the Supabase
-- Data API would default-allow anon/authenticated access to raw financial
-- records if these tables were ever exposed there. This restricts direct
-- table access to the service role, matching the existing convention for
-- finance.* tables (see 097_boq_line_items.sql); the API enforces
-- organization_id scoping in application code as it already does for every
-- other finance table.
--
-- Also adds a uniqueness constraint so the same physical storage object
-- cannot be registered against more than one Data Room document record.
-- ============================================================================

ALTER TABLE finance.data_room_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.data_room_folders FORCE ROW LEVEL SECURITY;
CREATE POLICY "Data Room folders service role only" ON finance.data_room_folders FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE finance.data_room_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.data_room_documents FORCE ROW LEVEL SECURITY;
CREATE POLICY "Data Room documents service role only" ON finance.data_room_documents FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE finance.bankability_checklists ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.bankability_checklists FORCE ROW LEVEL SECURITY;
CREATE POLICY "Bankability checklists service role only" ON finance.bankability_checklists FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE finance.data_room_documents ADD CONSTRAINT uq_data_room_documents_storage_path UNIQUE (storage_path);
