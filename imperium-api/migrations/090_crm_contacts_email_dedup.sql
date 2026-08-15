-- crm.contacts has never had a uniqueness guard on email, and the "+ New
-- Client Contact" quick-add inside the opportunity-create modal does an
-- unconditional INSERT with no existence check - so the same person typed
-- in twice becomes two rows, both surfaced in every contact picker. The
-- application-level fix (look up by email before inserting) lands in
-- crm_contacts.py and crm_leads.py; this is the database-level backstop for
-- any other/future code path that bypasses it.
--
-- Partial (real, non-blank email only) and scoped to non-deleted rows, since
-- a contact can legitimately have no email, and a soft-deleted duplicate
-- shouldn't block re-adding the same email later. Checked against live data
-- before writing this: the existing "Innocent Dube" x3 / "Ashton" duplicates
-- all have an empty-string email, not NULL, which is why this excludes ''
-- explicitly rather than only checking IS NOT NULL.

CREATE UNIQUE INDEX IF NOT EXISTS crm_contacts_org_email_unique
    ON crm.contacts (organization_id, lower(email))
    WHERE email IS NOT NULL AND email <> '' AND is_deleted = false;
