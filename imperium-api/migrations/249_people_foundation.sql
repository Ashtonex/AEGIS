-- ============================================================================
-- AEGIS MIGRATION 249 — PEOPLE FOUNDATION (HR & Workforce re-engineering, phase 1)
-- ============================================================================
-- Found 2026-10-04: 0 worker categories, 0 positions and no worker numbers had
-- ever been issued, so every register row read "Not assigned" and the register
-- form could not be submitted. Leavers (Phoebe Lifa) stayed "active" because
-- nothing recorded that someone had left. See docs/HR_WORKFORCE_REENGINEERING_PLAN.md.
--
--  1. Personal details and leaver fields on hr.employees.
--  2. hr.positions gains a discipline (category_id); categories gain sort order.
--  3. Construction catalogue seeded per organisation: 15 disciplines, ~55 roles.
--  4. hr.next_worker_number(): SNC-0001 style, permanent, never reused.
--  5. Back-fill numbers for staff with a working login (leavers / dead
--     duplicate logins deliberately get no number) and map known job titles to roles.
--  6. hr.employee_psychometrics for assessment results on the person card.
--
-- Additive only. No row is deleted and no login is changed.
-- ============================================================================

-- 1. Personal details and leaving -------------------------------------------
ALTER TABLE hr.employees
    ADD COLUMN IF NOT EXISTS national_id varchar(40),
    ADD COLUMN IF NOT EXISTS date_of_birth date,
    ADD COLUMN IF NOT EXISTS gender varchar(20),
    ADD COLUMN IF NOT EXISTS nationality varchar(80),
    ADD COLUMN IF NOT EXISTS marital_status varchar(20),
    ADD COLUMN IF NOT EXISTS personal_phone varchar(40),
    ADD COLUMN IF NOT EXISTS personal_email varchar(255),
    ADD COLUMN IF NOT EXISTS home_address text,
    ADD COLUMN IF NOT EXISTS highest_qualification varchar(160),
    ADD COLUMN IF NOT EXISTS professional_body varchar(160),
    ADD COLUMN IF NOT EXISTS professional_registration_number varchar(80),
    ADD COLUMN IF NOT EXISTS self_profile_updated_at timestamptz,
    ADD COLUMN IF NOT EXISTS left_reason text,
    ADD COLUMN IF NOT EXISTS left_recorded_at timestamptz,
    ADD COLUMN IF NOT EXISTS left_recorded_by uuid REFERENCES core.users(id);

-- 2. Catalogue structure -----------------------------------------------------
ALTER TABLE hr.worker_categories
    ADD COLUMN IF NOT EXISTS description text,
    ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 100;
ALTER TABLE hr.positions
    ADD COLUMN IF NOT EXISTS category_id uuid,
    ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 100;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='position_category_tenant_fk') THEN
    ALTER TABLE hr.positions ADD CONSTRAINT position_category_tenant_fk
      FOREIGN KEY (organization_id, category_id) REFERENCES hr.worker_categories(organization_id, id);
  END IF;
END $$;

-- 3. Construction catalogue --------------------------------------------------
WITH seed(code, name, payroll_eligible, sort_order, description) AS (VALUES
  ('EXEC', 'Executive Management',            true,  10, 'Directors and executive leadership'),
  ('PM',   'Project Management',              true,  20, 'Project and construction managers, coordinators'),
  ('ENG',  'Engineering',                     true,  30, 'Civil, structural, site and services engineers, drafting'),
  ('QS',   'Quantity Surveying & Commercial', true,  40, 'Quantity surveyors, estimators, commercial management'),
  ('SITE', 'Site Supervision',                true,  50, 'Site managers, agents, foremen, clerks of works'),
  ('HSE',  'Health, Safety & Environment',    true,  60, 'HSE and compliance'),
  ('PROC', 'Procurement & Stores',            true,  70, 'Buying, stores and inventory'),
  ('FIN',  'Finance & Accounts',              true,  80, 'Finance, accounts and payroll'),
  ('ADM',  'Administration & HR',             true,  90, 'HR, administration, reception, drivers'),
  ('BD',   'Business Development & CRM',      true, 100, 'Sales, CRM and tendering support'),
  ('TRD',  'Skilled Trades & Artisans',       true, 110, 'Bricklayers, carpenters, plumbers, electricians and other trades'),
  ('PLT',  'Plant & Equipment Operators',     true, 120, 'Machine operators, truck drivers, plant mechanics'),
  ('LAB',  'General Labour',                  true, 130, 'General hands, security, cleaning'),
  ('INT',  'Interns & Graduate Trainees',     true, 140, 'Interns, attachments and graduate trainees'),
  ('CON',  'Consultants & Specialists',       false, 150, 'External specialists engaged on contract, paid by invoice')
)
INSERT INTO hr.worker_categories (organization_id, code, name, payroll_eligible, sort_order, description)
SELECT o.id, s.code, s.name, s.payroll_eligible, s.sort_order, s.description
FROM core.organizations o CROSS JOIN seed s
ON CONFLICT (organization_id, code) DO NOTHING;

WITH seed(code, name, category_code, department_code, grade, sort_order) AS (VALUES
  ('MD',     'Managing Director',              'EXEC', 'corporate_control_services', 'Executive', 10),
  ('ED',     'Executive Director',             'EXEC', 'corporate_control_services', 'Executive', 11),
  ('OD',     'Operations Director',            'EXEC', 'construction',               'Executive', 12),
  ('PM',     'Project Manager',                'PM',   'construction',               'Senior',    20),
  ('CM',     'Construction Manager',           'PM',   'construction',               'Senior',    21),
  ('APM',    'Assistant Project Manager',      'PM',   'construction',               'Mid',       22),
  ('PC',     'Project Coordinator',            'PM',   'construction',               'Mid',       23),
  ('CE',     'Civil Engineer',                 'ENG',  'construction',               'Professional', 30),
  ('SE',     'Structural Engineer',            'ENG',  'construction',               'Professional', 31),
  ('SITEENG','Site Engineer',                  'ENG',  'construction',               'Professional', 32),
  ('ME',     'Mechanical Engineer',            'ENG',  'construction',               'Professional', 33),
  ('EE',     'Electrical Engineer',            'ENG',  'construction',               'Professional', 34),
  ('DRA',    'Draughtsperson',                 'ENG',  'construction',               'Technical', 35),
  ('CMGR',   'Commercial Manager',             'QS',   'commercial',                 'Senior',    40),
  ('SQS',    'Senior Quantity Surveyor',       'QS',   'commercial',                 'Senior',    41),
  ('QS',     'Quantity Surveyor',              'QS',   'commercial',                 'Professional', 42),
  ('EST',    'Estimator',                      'QS',   'commercial',                 'Technical', 43),
  ('SM',     'Site Manager',                   'SITE', 'construction',               'Senior',    50),
  ('SA',     'Site Agent',                     'SITE', 'construction',               'Mid',       51),
  ('GF',     'General Foreman',                'SITE', 'construction',               'Supervisory', 52),
  ('FM',     'Foreman',                        'SITE', 'construction',               'Supervisory', 53),
  ('CW',     'Clerk of Works',                 'SITE', 'construction',               'Technical', 54),
  ('HSEO',   'HSE Officer',                    'HSE',  'risk',                       'Mid',       60),
  ('CO',     'Compliance Officer',             'HSE',  'risk',                       'Mid',       61),
  ('PROCM',  'Procurement Manager',            'PROC', 'commercial',                 'Senior',    70),
  ('PROCA',  'Procurement Associate',          'PROC', 'commercial',                 'Junior',    71),
  ('IC',     'Inventory Controller',           'PROC', 'commercial',                 'Mid',       72),
  ('STK',    'Storekeeper',                    'PROC', 'construction',               'Junior',    73),
  ('FINM',   'Finance Manager',                'FIN',  'corporate_control_services', 'Senior',    80),
  ('ACC',    'Accountant',                     'FIN',  'corporate_control_services', 'Professional', 81),
  ('AA',     'Accounts Assistant',             'FIN',  'corporate_control_services', 'Junior',    82),
  ('PAY',    'Payroll Officer',                'FIN',  'corporate_control_services', 'Mid',       83),
  ('HRM',    'HR Manager',                     'ADM',  'corporate_control_services', 'Senior',    90),
  ('HRO',    'HR Officer',                     'ADM',  'corporate_control_services', 'Mid',       91),
  ('ADMO',   'Administrator',                  'ADM',  'corporate_control_services', 'Junior',    92),
  ('REC',    'Receptionist',                   'ADM',  'corporate_control_services', 'Junior',    93),
  ('DRV',    'Driver',                         'ADM',  'plant_equipment',            'Junior',    94),
  ('BDM',    'Business Development Manager',   'BD',   'commercial',                 'Senior',   100),
  ('SALES',  'Sales Executive',                'BD',   'commercial',                 'Mid',      101),
  ('CRMA',   'CRM Associate',                  'BD',   'commercial',                 'Junior',   102),
  ('BRK',    'Bricklayer',                     'TRD',  'construction',               'Artisan',  110),
  ('CRP',    'Carpenter',                      'TRD',  'construction',               'Artisan',  111),
  ('PLB',    'Plumber',                        'TRD',  'construction',               'Artisan',  112),
  ('ELC',    'Electrician',                    'TRD',  'construction',               'Artisan',  113),
  ('WLD',    'Welder',                         'TRD',  'construction',               'Artisan',  114),
  ('PNT',    'Painter',                        'TRD',  'construction',               'Artisan',  115),
  ('STF',    'Steel Fixer',                    'TRD',  'construction',               'Artisan',  116),
  ('TIL',    'Tiler',                          'TRD',  'construction',               'Artisan',  117),
  ('RFR',    'Roofer',                         'TRD',  'construction',               'Artisan',  118),
  ('EXO',    'Excavator Operator',             'PLT',  'plant_equipment',            'Operator', 120),
  ('TLB',    'TLB Operator',                   'PLT',  'plant_equipment',            'Operator', 121),
  ('GRO',    'Grader Operator',                'PLT',  'plant_equipment',            'Operator', 122),
  ('TRK',    'Truck Driver',                   'PLT',  'plant_equipment',            'Operator', 123),
  ('PMEC',   'Plant Mechanic',                 'PLT',  'plant_equipment',            'Artisan',  124),
  ('GH',     'General Hand',                   'LAB',  'construction',               'General',  130),
  ('SEC',    'Security Guard',                 'LAB',  'construction',               'General',  131),
  ('CLN',    'Cleaner',                        'LAB',  'corporate_control_services', 'General',  132),
  ('INTE',   'Engineering Intern',             'INT',  'construction',               'Trainee',  140),
  ('INTQ',   'QS Intern',                      'INT',  'commercial',                 'Trainee',  141),
  ('GT',     'Graduate Trainee',               'INT',  'construction',               'Trainee',  142),
  ('ATT',    'Industrial Attachment',          'INT',  'construction',               'Trainee',  143),
  ('CONS',   'Consultant',                     'CON',  'commercial',                 'Specialist', 150)
)
INSERT INTO hr.positions (organization_id, code, name, category_id, department_id, grade, trade, sort_order)
SELECT o.id, s.code, s.name, c.id, d.id, s.grade, c.name, s.sort_order
FROM core.organizations o
CROSS JOIN seed s
JOIN hr.worker_categories c ON c.organization_id = o.id AND c.code = s.category_code
LEFT JOIN finance.departments d ON d.organization_id = o.id AND d.code = s.department_code AND d.is_deleted = false
ON CONFLICT (organization_id, code) DO NOTHING;

-- 4. Worker numbers ------------------------------------------------------------
-- Serialised per organisation by a transaction advisory lock; the permanent
-- unique index from migration 176 is the backstop. Numbers are never reused
-- because archived and left rows keep theirs.
CREATE OR REPLACE FUNCTION hr.next_worker_number(org uuid) RETURNS text
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE n integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('worker-number:' || org::text, 0));
  SELECT COALESCE(MAX(substring(employee_number FROM '^SNC-([0-9]+)$')::integer), 0) + 1
    INTO n FROM hr.employees WHERE organization_id = org AND employee_number ~ '^SNC-[0-9]+$';
  RETURN 'SNC-' || lpad(n::text, 4, '0');
END $$;
REVOKE EXECUTE ON FUNCTION hr.next_worker_number(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hr.next_worker_number(uuid) TO aegis_workforce_runtime;

-- 5. Back-fill ---------------------------------------------------------------------
-- Map known job titles to roles first so the person card opens populated.
UPDATE hr.employees e
SET position_id = p.id,
    category_id = COALESCE(e.category_id, p.category_id),
    department_id = COALESCE(e.department_id, p.department_id)
FROM hr.positions p
WHERE p.organization_id = e.organization_id
  AND e.position_id IS NULL
  AND lower(trim(e.job_title)) = lower(p.name);

-- Numbers only for people with a working login (or no login at all). Rows whose
-- login is disabled are leavers or dead duplicate accounts; HR decides those.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT e.id, e.organization_id
    FROM hr.employees e
    LEFT JOIN core.users u ON u.id = e.linked_user_id
    WHERE e.employee_number IS NULL AND e.is_deleted = false
      AND e.employment_status <> 'terminated'
      AND (e.linked_user_id IS NULL OR u.is_active = true)
    ORDER BY e.created_at, e.employee_name
  LOOP
    UPDATE hr.employees SET employee_number = hr.next_worker_number(r.organization_id)
    WHERE id = r.id;
  END LOOP;
END $$;

-- 6. Psychometric / assessment results ------------------------------------------
CREATE TABLE IF NOT EXISTS hr.employee_psychometrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES core.organizations(id),
  employee_id uuid NOT NULL,
  test_name varchar(160) NOT NULL,
  provider varchar(160),
  assessed_on date,
  overall_score numeric(7,2),
  max_score numeric(7,2),
  dimension_scores jsonb NOT NULL DEFAULT '{}'::jsonb,
  interpretation text,
  recruitment_assessment_id uuid REFERENCES hr.recruitment_assessments(id),
  document_id uuid REFERENCES core.documents(id),
  created_by uuid REFERENCES core.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  is_deleted boolean NOT NULL DEFAULT false,
  FOREIGN KEY (organization_id, employee_id) REFERENCES hr.employees(organization_id, id)
);
CREATE INDEX IF NOT EXISTS employee_psychometrics_worker ON hr.employee_psychometrics(organization_id, employee_id) WHERE is_deleted = false;
ALTER TABLE hr.employee_psychometrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr.employee_psychometrics FORCE ROW LEVEL SECURITY;
REVOKE ALL ON hr.employee_psychometrics FROM anon, authenticated;
DROP POLICY IF EXISTS workforce_runtime_tenant ON hr.employee_psychometrics;
CREATE POLICY workforce_runtime_tenant ON hr.employee_psychometrics FOR ALL TO aegis_workforce_runtime
  USING (organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid);
GRANT SELECT ON hr.employee_psychometrics TO aegis_workforce_runtime;

-- Who may see and change the person card's sensitive tabs. Pay stays on the
-- existing finance.payroll.manage / hr.payroll.manage keys.
INSERT INTO core.permissions (key, description) VALUES
  ('hr.people.personal.read',   'Read employee personal details (ID, date of birth, contacts, next of kin)'),
  ('hr.people.personal.manage', 'Edit employee personal details and psychometric results'),
  ('hr.people.offboard',        'Record that an employee has left the organisation and disable their login')
ON CONFLICT (key) DO NOTHING;

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.organizations o
JOIN core.roles r ON r.organization_id = o.id AND r.is_deleted = false
JOIN core.permissions p ON p.key IN ('hr.people.personal.read', 'hr.people.personal.manage', 'hr.people.offboard')
WHERE o.is_deleted = false
  AND r.name IN ('SUPERADMIN', 'Executive (Admin)', 'HR Manager', 'HR Officer')
ON CONFLICT (role_id, permission_id) DO NOTHING;
