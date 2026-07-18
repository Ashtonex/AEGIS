ALTER TABLE hr.employee_profiles
    ADD COLUMN IF NOT EXISTS theme_preference TEXT NOT NULL DEFAULT 'ink';
