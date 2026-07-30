-- Add a durable onboarding completion marker for first-login dashboard tours.

ALTER TABLE hr.employee_profiles
    ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;
