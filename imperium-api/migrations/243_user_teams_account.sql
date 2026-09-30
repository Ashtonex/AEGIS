-- ============================================================================
-- AEGIS MIGRATION 243 — USER TEAMS ACCOUNT
-- ============================================================================
-- A person's AEGIS login email is not necessarily a Microsoft account. At
-- SNC every staff member is a *guest* in the Microsoft 365 tenant, signed in
-- with a personal address (e.g. someone_gmail.com#EXT#@<tenant>), while their
-- AEGIS login is a @sixnineconstruction.com address that has no mailbox - so
-- Teams notifications addressed to the AEGIS email reached no one.
--
-- teams_account holds the identity Teams knows the person by (their user
-- principal name, or any address Teams resolves to them). Notifications use
-- it when set and fall back to the login email. It never affects sign-in.
-- ============================================================================

ALTER TABLE core.users
    ADD COLUMN IF NOT EXISTS teams_account VARCHAR(320);
