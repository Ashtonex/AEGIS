-- ============================================================================
-- AEGIS MIGRATION 250 — CONTRACTS, CREDENTIALS, ASSETS + PEOPLE ACCESS
-- ============================================================================
-- HR & Workforce re-engineering, phase 2 (docs/HR_WORKFORCE_REENGINEERING_PLAN.md).
--
--  1. hr.employee_contracts: every contract a person has had with SNC, its
--     signed copy (SharePoint 06_HR_WORKFORCE via core.file_attachments), dates and status.
--  2. Credentials: hr.employee_certifications gains a type (driver's licence,
--     professional registration, vehicle registration, medical, induction…),
--     licence class, vehicle registration and an attached scan.
--  3. Assets: hr.employee_asset_assignments gains quantity, serial, value,
--     who issued / received it back, acknowledgement and a scan.
--  4. hr.expiry_alerts: one row per (thing, threshold) so the daily expiry job
--     never emails the same warning twice.
--  5. Access gap found 2026-10-04: no role except SUPERADMIN held
--     workforce.people.read/create/update, so directors and HR could not use
--     the People Register at all. Granted here to the roles that run people.
--
-- Additive only.
-- ============================================================================

-- 1. Contracts ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hr.employee_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES core.organizations(id),
  employee_id uuid NOT NULL,
  contract_number varchar(40) NOT NULL,
  contract_type varchar(24) NOT NULL CHECK (contract_type IN ('permanent','fixed_term','probation','casual','internship','consultancy')),
  title varchar(200),
  starts_on date NOT NULL,
  ends_on date,
  signed_on date,
  probation_ends_on date,
  notice_period_days integer CHECK (notice_period_days IS NULL OR notice_period_days BETWEEN 0 AND 365),
  basic_salary numeric(14,2) CHECK (basic_salary IS NULL OR basic_salary >= 0),
  currency varchar(3),
  status varchar(20) NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','renewed','terminated','superseded')),
  ended_reason text,
  renewal_of uuid REFERENCES hr.employee_contracts(id),
  file_attachment_id uuid REFERENCES core.file_attachments(id),
  review_meeting_at timestamptz,
  notes text,
  created_by uuid REFERENCES core.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  is_deleted boolean NOT NULL DEFAULT false,
  CHECK (ends_on IS NULL OR ends_on >= starts_on),
  FOREIGN KEY (organization_id, employee_id) REFERENCES hr.employees(organization_id, id),
  UNIQUE (organization_id, contract_number)
);
CREATE INDEX IF NOT EXISTS employee_contracts_worker ON hr.employee_contracts(organization_id, employee_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS employee_contracts_ending ON hr.employee_contracts(organization_id, ends_on) WHERE is_deleted = false AND status = 'active';

-- 2. Credentials -------------------------------------------------------------------
ALTER TABLE hr.employee_certifications
  ADD COLUMN IF NOT EXISTS credential_type varchar(40) NOT NULL DEFAULT 'certification',
  ADD COLUMN IF NOT EXISTS licence_class varchar(40),
  ADD COLUMN IF NOT EXISTS vehicle_registration varchar(40),
  ADD COLUMN IF NOT EXISTS file_attachment_id uuid REFERENCES core.file_attachments(id),
  ADD COLUMN IF NOT EXISTS notes text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employee_certifications_credential_type_check') THEN
    ALTER TABLE hr.employee_certifications ADD CONSTRAINT employee_certifications_credential_type_check
      CHECK (credential_type IN ('certification','drivers_licence','professional_registration','vehicle_registration',
                                 'medical','induction','work_permit','passport','other'));
  END IF;
END $$;

-- 3. Assets ---------------------------------------------------------------------------
ALTER TABLE hr.employee_asset_assignments
  ADD COLUMN IF NOT EXISTS quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  ADD COLUMN IF NOT EXISTS serial_number varchar(120),
  ADD COLUMN IF NOT EXISTS asset_value numeric(14,2),
  ADD COLUMN IF NOT EXISTS issued_by uuid REFERENCES core.users(id),
  ADD COLUMN IF NOT EXISTS returned_to uuid REFERENCES core.users(id),
  ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz,
  ADD COLUMN IF NOT EXISTS file_attachment_id uuid REFERENCES core.file_attachments(id);

-- 4. Alert log ------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hr.expiry_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES core.organizations(id),
  source_type varchar(20) NOT NULL CHECK (source_type IN ('contract','credential','asset')),
  source_id uuid NOT NULL,
  threshold_days integer NOT NULL,
  expires_on date NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  channels jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (organization_id, source_type, source_id, threshold_days, expires_on)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['hr.employee_contracts','hr.expiry_alerts'] LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON %s FROM anon, authenticated', t);
    EXECUTE format('DROP POLICY IF EXISTS workforce_runtime_tenant ON %s', t);
    EXECUTE format('CREATE POLICY workforce_runtime_tenant ON %s FOR SELECT TO aegis_workforce_runtime USING (organization_id = NULLIF(current_setting(''app.organization_id'',true),'''')::uuid)', t);
    EXECUTE format('GRANT SELECT ON %s TO aegis_workforce_runtime', t);
  END LOOP;
END $$;

-- 5. Access ---------------------------------------------------------------------------
INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.organizations o
JOIN core.roles r ON r.organization_id = o.id AND r.is_deleted = false
JOIN (VALUES
  ('SUPERADMIN',          'workforce.people.read'),
  ('SUPERADMIN',          'workforce.people.create'),
  ('SUPERADMIN',          'workforce.people.update'),
  ('SUPERADMIN',          'workforce.organisation.read'),
  ('SUPERADMIN',          'workforce.organisation.manage'),
  ('SUPERADMIN',          'workforce.audit.read'),
  ('SUPERADMIN',          'hr.payroll.manage'),
  ('Executive (Admin)',   'workforce.people.read'),
  ('Executive (Admin)',   'workforce.people.create'),
  ('Executive (Admin)',   'workforce.people.update'),
  ('Executive (Admin)',   'workforce.organisation.read'),
  ('Executive (Admin)',   'workforce.organisation.manage'),
  ('Executive (Admin)',   'workforce.audit.read'),
  ('Executive (Admin)',   'workforce.availability.read'),
  ('Executive (Admin)',   'workforce.availability.manage'),
  ('Executive (Admin)',   'hr.payroll.manage'),
  ('HR Manager',          'workforce.people.read'),
  ('HR Manager',          'workforce.people.create'),
  ('HR Manager',          'workforce.people.update'),
  ('HR Manager',          'workforce.organisation.read'),
  ('HR Manager',          'workforce.organisation.manage'),
  ('HR Manager',          'workforce.audit.read'),
  ('HR Manager',          'workforce.availability.read'),
  ('HR Manager',          'workforce.availability.manage'),
  ('HR Manager',          'hr.payroll.manage'),
  ('HR Officer',          'workforce.read'),
  ('HR Officer',          'workforce.people.read'),
  ('HR Officer',          'workforce.people.create'),
  ('HR Officer',          'workforce.people.update'),
  ('HR Officer',          'workforce.organisation.read'),
  ('HR Officer',          'workforce.audit.read'),
  ('HR Officer',          'workforce.availability.read'),
  ('HR Officer',          'workforce.availability.manage'),
  ('Finance Manager',     'workforce.people.read'),
  ('Finance Manager',     'workforce.organisation.read'),
  ('Project Manager',     'workforce.people.read'),
  ('Project Manager',     'workforce.organisation.read'),
  ('Project Manager',     'workforce.availability.read'),
  ('Executive Read Only', 'workforce.people.read'),
  ('Executive Read Only', 'workforce.organisation.read')
) AS g(role_name, permission_key) ON g.role_name = r.name
JOIN core.permissions p ON p.key = g.permission_key
WHERE o.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;
