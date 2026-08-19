-- Prior-progress capture for a project registered into AEGIS after it was
-- already underway - honest percent-complete instead of starting at 0%,
-- plus (handled at the application layer, not here) an opening cost
-- transaction for spend incurred before AEGIS registration.

ALTER TABLE projects.project_profiles
    ADD COLUMN IF NOT EXISTS initial_percent_complete NUMERIC(5, 2)
        CHECK (initial_percent_complete IS NULL OR (initial_percent_complete >= 0 AND initial_percent_complete <= 100)),
    ADD COLUMN IF NOT EXISTS initial_costs_incurred NUMERIC(15, 2)
        CHECK (initial_costs_incurred IS NULL OR initial_costs_incurred >= 0);
