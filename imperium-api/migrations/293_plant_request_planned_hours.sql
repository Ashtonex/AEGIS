-- ============================================================================
-- AEGIS MIGRATION 293 — PLANNED HOURS ON PLANT REQUESTS
-- ============================================================================
-- A plant request records how many machine hours the job is planned for.
-- Hours worked are the sum of the request's utilisation logs (rejected logs
-- excluded), so hours left = planned_hours - hours worked. NULL means no plan
-- has been set yet.
-- ============================================================================

ALTER TABLE fleet.plant_requests
    ADD COLUMN IF NOT EXISTS planned_hours NUMERIC(10,2);

ALTER TABLE fleet.plant_requests
    DROP CONSTRAINT IF EXISTS plant_requests_planned_hours_check;
ALTER TABLE fleet.plant_requests
    ADD CONSTRAINT plant_requests_planned_hours_check
    CHECK (planned_hours IS NULL OR planned_hours >= 0);

COMMENT ON COLUMN fleet.plant_requests.planned_hours IS
    'Machine hours the job is planned for. Hours left = planned_hours - SUM(utilization_logs.operating_hours).';

CREATE INDEX IF NOT EXISTS idx_utilization_logs_plant_request
    ON fleet.utilization_logs (organization_id, plant_request_id)
    WHERE is_deleted = false;
