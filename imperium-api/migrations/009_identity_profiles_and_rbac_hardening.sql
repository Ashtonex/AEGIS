CREATE TABLE IF NOT EXISTS hr.employee_profiles (
    user_id UUID PRIMARY KEY REFERENCES core.users(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    preferred_name VARCHAR(100), first_name VARCHAR(100), last_name VARCHAR(100),
    work_phone VARCHAR(40), job_title VARCHAR(150), department VARCHAR(150),
    location VARCHAR(150), timezone VARCHAR(64), bio TEXT,
    linkedin_url TEXT, portfolio_url TEXT, website_url TEXT, avatar_path TEXT,
    skills JSONB NOT NULL DEFAULT '[]'::jsonb, languages JSONB NOT NULL DEFAULT '[]'::jsonb,
    profile_completed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT employee_profiles_linkedin_https CHECK (linkedin_url IS NULL OR linkedin_url ~* '^https://([a-z]{2,3}\\.)?linkedin\\.com/'),
    CONSTRAINT employee_profiles_portfolio_https CHECK (portfolio_url IS NULL OR portfolio_url ~* '^https://'),
    CONSTRAINT employee_profiles_website_https CHECK (website_url IS NULL OR website_url ~* '^https://')
);
CREATE INDEX IF NOT EXISTS employee_profiles_org_user_idx ON hr.employee_profiles (organization_id, user_id);
ALTER TABLE hr.employee_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr.employee_profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY "Profile owner read" ON hr.employee_profiles FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "Profile owner update" ON hr.employee_profiles FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, core AS $$
BEGIN
  INSERT INTO core.users (id, organization_id, email, full_name, is_active)
  VALUES (NEW.id, NULL, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)), FALSE)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "Global Read Policy" ON core.audit_log;
DROP POLICY IF EXISTS "Global Write Policy" ON core.audit_log;
REVOKE ALL ON core.audit_log FROM anon, authenticated;
