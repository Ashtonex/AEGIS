-- Managed account password reset gating.
-- New provisioned accounts must change their temporary password before entering a portal.

ALTER TABLE core.users
ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS core_users_must_change_password_idx
    ON core.users (organization_id, must_change_password)
    WHERE is_deleted = false;
