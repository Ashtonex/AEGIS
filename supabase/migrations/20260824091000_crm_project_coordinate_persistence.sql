-- Coordinate persistence for project and CRM regional coverage.
-- Projects already store coordinates on projects.project_profiles. CRM deals
-- and tenders now get the same latitude/longitude fields so saved regional
-- locations can feed the executive footprint instead of disappearing.

ALTER TABLE crm.opportunities
    ADD COLUMN IF NOT EXISTS latitude NUMERIC(9, 6),
    ADD COLUMN IF NOT EXISTS longitude NUMERIC(9, 6);

ALTER TABLE crm.tenders
    ADD COLUMN IF NOT EXISTS latitude NUMERIC(9, 6),
    ADD COLUMN IF NOT EXISTS longitude NUMERIC(9, 6);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'crm_opportunities_coordinate_range'
    ) THEN
        ALTER TABLE crm.opportunities
            ADD CONSTRAINT crm_opportunities_coordinate_range
            CHECK (
                (latitude IS NULL AND longitude IS NULL)
                OR (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)
            ) NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'crm_tenders_coordinate_range'
    ) THEN
        ALTER TABLE crm.tenders
            ADD CONSTRAINT crm_tenders_coordinate_range
            CHECK (
                (latitude IS NULL AND longitude IS NULL)
                OR (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)
            ) NOT VALID;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_crm_opportunities_coordinates
    ON crm.opportunities (organization_id, latitude, longitude)
    WHERE is_deleted = false AND latitude IS NOT NULL AND longitude IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_crm_tenders_coordinates
    ON crm.tenders (organization_id, latitude, longitude)
    WHERE is_deleted = false AND latitude IS NOT NULL AND longitude IS NOT NULL;
