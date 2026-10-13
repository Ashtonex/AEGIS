-- Migration 259: Add assigned_to_user_id to fleet.fleet for unified entity assignments
ALTER TABLE fleet.fleet
    ADD COLUMN IF NOT EXISTS assigned_to_user_id UUID REFERENCES core.users(id);

CREATE INDEX IF NOT EXISTS ix_fleet_assigned_to_user_id
    ON fleet.fleet (assigned_to_user_id);
