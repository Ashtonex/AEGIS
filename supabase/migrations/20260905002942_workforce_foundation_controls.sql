-- Phase 2: extend the existing HR and Core foundations. No personnel or role grants are seeded.
-- Provision the NOLOGIN runtime role with scripts/provision_workforce_runtime.py first.
ALTER TABLE hr.employees ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE hr.employees ADD COLUMN IF NOT EXISTS archived_reason text;
ALTER TABLE hr.employees ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE core.audit_log ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES core.organizations(id);

CREATE TABLE IF NOT EXISTS hr.worker_categories (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES core.organizations(id),
 code varchar(40) NOT NULL, name varchar(160) NOT NULL, payroll_eligible boolean NOT NULL DEFAULT false,
 created_by uuid REFERENCES core.users(id), created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(), is_deleted boolean NOT NULL DEFAULT false,
 version integer NOT NULL DEFAULT 1, UNIQUE(organization_id,code), UNIQUE(organization_id,id)
);
CREATE TABLE IF NOT EXISTS hr.positions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES core.organizations(id),
 code varchar(40) NOT NULL, name varchar(160) NOT NULL, department_id uuid REFERENCES finance.departments(id),
 trade varchar(160), grade varchar(80), created_by uuid REFERENCES core.users(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 is_deleted boolean NOT NULL DEFAULT false, version integer NOT NULL DEFAULT 1,
 UNIQUE(organization_id,code), UNIQUE(organization_id,id)
);
ALTER TABLE hr.employees ADD COLUMN IF NOT EXISTS category_id uuid;
ALTER TABLE hr.employees ADD COLUMN IF NOT EXISTS position_id uuid;
ALTER TABLE hr.employees ADD COLUMN IF NOT EXISTS department_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS employees_tenant_id ON hr.employees(organization_id,id);
-- Archival never releases an existing worker number for a different person.
CREATE UNIQUE INDEX IF NOT EXISTS workforce_number_permanent ON hr.employees(organization_id,employee_number) WHERE employee_number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS departments_tenant_id ON finance.departments(organization_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS users_tenant_id ON core.users(organization_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS documents_tenant_id ON core.documents(organization_id,id);
ALTER TABLE hr.employees ADD CONSTRAINT workforce_category_tenant_fk FOREIGN KEY(organization_id,category_id) REFERENCES hr.worker_categories(organization_id,id);
ALTER TABLE hr.employees ADD CONSTRAINT workforce_position_tenant_fk FOREIGN KEY(organization_id,position_id) REFERENCES hr.positions(organization_id,id);
ALTER TABLE hr.employees ADD CONSTRAINT workforce_department_tenant_fk FOREIGN KEY(organization_id,department_id) REFERENCES finance.departments(organization_id,id);
ALTER TABLE hr.positions ADD CONSTRAINT position_department_tenant_fk FOREIGN KEY(organization_id,department_id) REFERENCES finance.departments(organization_id,id);
ALTER TABLE hr.employees ADD CONSTRAINT workforce_login_tenant_fk FOREIGN KEY(organization_id,linked_user_id) REFERENCES core.users(organization_id,id) NOT VALID;

CREATE TABLE IF NOT EXISTS hr.worker_engagements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES core.organizations(id),
 employee_id uuid NOT NULL, category_id uuid NOT NULL, document_id uuid NOT NULL,
 document_snapshot jsonb NOT NULL,
 starts_on date NOT NULL, ends_on date, normal_minutes integer NOT NULL CHECK(normal_minutes BETWEEN 1 AND 1440),
 employer_name varchar(200), jurisdiction varchar(80) NOT NULL,
 status varchar(24) NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','verified','rejected','ended')),
 version integer NOT NULL DEFAULT 1, created_by uuid NOT NULL REFERENCES core.users(id),
 verified_by uuid REFERENCES core.users(id), verified_at timestamptz, decision_reason text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 is_deleted boolean NOT NULL DEFAULT false, CHECK(ends_on IS NULL OR ends_on>=starts_on),
 FOREIGN KEY(organization_id,employee_id) REFERENCES hr.employees(organization_id,id),
 FOREIGN KEY(organization_id,category_id) REFERENCES hr.worker_categories(organization_id,id),
 FOREIGN KEY(organization_id,document_id) REFERENCES core.documents(organization_id,id),
 UNIQUE(organization_id,id)
);
CREATE INDEX IF NOT EXISTS engagements_worker_period ON hr.worker_engagements(organization_id,employee_id,starts_on,ends_on);

CREATE UNIQUE INDEX IF NOT EXISTS domain_events_tenant_id ON core.domain_events(organization_id,id);
CREATE TABLE IF NOT EXISTS core.event_receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES core.organizations(id),
 event_id uuid NOT NULL, consumer_key varchar(160) NOT NULL,
 completed_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,event_id) REFERENCES core.domain_events(organization_id,id),
 UNIQUE(organization_id,event_id,consumer_key)
);
CREATE TABLE IF NOT EXISTS core.event_dispatch_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES core.organizations(id),
 event_id uuid NOT NULL, attempts integer NOT NULL DEFAULT 0,
 next_attempt_at timestamptz NOT NULL DEFAULT now(), last_error varchar(160),
 FOREIGN KEY(organization_id,event_id) REFERENCES core.domain_events(organization_id,id),
 UNIQUE(organization_id,event_id)
);

CREATE TABLE IF NOT EXISTS core.command_receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES core.organizations(id),
 actor_id uuid NOT NULL REFERENCES core.users(id), action varchar(120) NOT NULL, command_key uuid NOT NULL,
 payload_hash varchar(64) NOT NULL, result jsonb, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,actor_id,action,command_key)
);
CREATE TABLE IF NOT EXISTS core.approval_decisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES core.organizations(id),
 approval_instance_id uuid NOT NULL REFERENCES core.approval_instances(id),
 step_number integer NOT NULL CHECK(step_number>0), actor_id uuid NOT NULL REFERENCES core.users(id),
 decision varchar(24) NOT NULL CHECK(decision IN ('approved','rejected')), reason text NOT NULL CHECK(length(trim(reason))>0),
 target_version integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,approval_instance_id,step_number)
);
ALTER TABLE core.approval_instances ADD COLUMN IF NOT EXISTS target_version integer NOT NULL DEFAULT 1;
ALTER TABLE core.approval_steps ADD COLUMN IF NOT EXISTS permission_key varchar(120);
CREATE UNIQUE INDEX IF NOT EXISTS approvals_tenant_id ON core.approval_instances(organization_id,id);
ALTER TABLE core.approval_decisions ADD CONSTRAINT decision_approval_tenant_fk FOREIGN KEY(organization_id,approval_instance_id) REFERENCES core.approval_instances(organization_id,id);

CREATE OR REPLACE FUNCTION core.workforce_evidence_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
 RAISE EXCEPTION 'Approved evidence is immutable; use a controlled successor' USING ERRCODE='23514';
END $$;
REVOKE ALL ON FUNCTION core.workforce_evidence_immutable() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER workforce_decision_immutable BEFORE UPDATE OR DELETE ON core.approval_decisions
 FOR EACH ROW EXECUTE FUNCTION core.workforce_evidence_immutable();
CREATE TRIGGER workforce_engagement_locked BEFORE UPDATE OR DELETE ON hr.worker_engagements
 FOR EACH ROW WHEN (OLD.status = 'verified') EXECUTE FUNCTION core.workforce_evidence_immutable();
CREATE OR REPLACE FUNCTION core.workforce_number_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
 RAISE EXCEPTION 'An assigned workforce number is permanent' USING ERRCODE='23514';
END $$;
REVOKE EXECUTE ON FUNCTION core.workforce_number_immutable() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER workforce_number_locked BEFORE UPDATE OF employee_number ON hr.employees
 FOR EACH ROW WHEN (OLD.employee_number IS NOT NULL AND OLD.employee_number IS DISTINCT FROM NEW.employee_number)
 EXECUTE FUNCTION core.workforce_number_immutable();

-- Freeze source metadata once it supports verified HR authority. A corrected
-- contract uses a new document and engagement, preserving the original evidence.
CREATE OR REPLACE FUNCTION core.protect_workforce_contract_source() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE doc_id uuid;
BEGIN
 IF TG_TABLE_NAME='documents' THEN
   PERFORM pg_advisory_xact_lock(hashtextextended('evidence:'||OLD.organization_id::text||':'||OLD.id::text,2));
   IF EXISTS(SELECT 1 FROM hr.worker_engagements WHERE organization_id=OLD.organization_id AND document_id=OLD.id AND status='verified') THEN
     RAISE EXCEPTION 'Verified contract source is immutable; register a successor document' USING ERRCODE='23514';
   END IF;
 ELSE
   FOR doc_id IN SELECT id FROM core.documents WHERE organization_id=OLD.organization_id AND file_attachment_id=OLD.id ORDER BY id LOOP
     PERFORM pg_advisory_xact_lock(hashtextextended('evidence:'||OLD.organization_id::text||':'||doc_id::text,2));
     IF EXISTS(SELECT 1 FROM hr.worker_engagements WHERE organization_id=OLD.organization_id AND document_id=doc_id AND status='verified') THEN
       RAISE EXCEPTION 'Verified contract attachment is immutable' USING ERRCODE='23514';
     END IF;
   END LOOP;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION core.protect_workforce_contract_source() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER workforce_contract_source_immutable BEFORE UPDATE OR DELETE ON core.documents
 FOR EACH ROW EXECUTE FUNCTION core.protect_workforce_contract_source();
CREATE TRIGGER workforce_contract_attachment_immutable BEFORE UPDATE OR DELETE ON core.file_attachments
 FOR EACH ROW EXECUTE FUNCTION core.protect_workforce_contract_source();

-- The existing upload UI already uses upsert:false. Remove the historical
-- bucket-wide overwrite policy so a verified attachment cannot be replaced
-- behind its immutable database reference. Corrections upload a new object.
DO $$ BEGIN
 IF to_regclass('storage.objects') IS NOT NULL THEN
   EXECUTE 'DROP POLICY IF EXISTS "Authenticated users can update their document uploads" ON storage.objects';
 END IF;
END $$;

-- Restrict prior SECURITY DEFINER audit function access without rewriting historical migrations.
REVOKE EXECUTE ON FUNCTION core.process_user_roles_audit_log() FROM PUBLIC,anon,authenticated;

-- Policies are restricted to a dedicated non-owner execution role. The backend enters
-- this role inside each Workforce transaction; no browser role receives table grants.
DO $$
DECLARE table_ref text;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='aegis_workforce_runtime' AND NOT rolsuper AND NOT rolbypassrls) THEN
   RAISE EXCEPTION 'Provision aegis_workforce_runtime (NOSUPERUSER NOBYPASSRLS) before migration';
 END IF;
 FOREACH table_ref IN ARRAY ARRAY[
  'hr.employees','hr.worker_categories','hr.positions','hr.worker_engagements',
  'hr.reporting_lines','hr.employee_availability','hr.employee_skills','hr.employee_certifications','hr.project_allocations',
  'hr.employee_documents','hr.employee_medicals','hr.employee_asset_assignments',
  'hr.training_requirements','hr.training_records','hr.leave_requests',
  'core.command_receipts','core.approval_instances','core.approval_steps','core.approval_decisions',
  'core.domain_events','core.event_receipts','core.event_dispatch_attempts','core.audit_log','core.documents','core.file_attachments','core.users','finance.departments'
 ] LOOP
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY',table_ref);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY',table_ref);
  EXECUTE format('REVOKE ALL ON %s FROM anon, authenticated',table_ref);
  EXECUTE format('CREATE POLICY workforce_runtime_tenant ON %s FOR ALL TO aegis_workforce_runtime USING (organization_id = NULLIF(current_setting(''app.organization_id'',true),'''')::uuid) WITH CHECK (organization_id = NULLIF(current_setting(''app.organization_id'',true),'''')::uuid)',table_ref);
  -- Restrictive policy prevents inherited legacy permissive policies widening this role.
  EXECUTE format('CREATE POLICY workforce_runtime_fence ON %s AS RESTRICTIVE FOR ALL TO aegis_workforce_runtime USING (organization_id = NULLIF(current_setting(''app.organization_id'',true),'''')::uuid) WITH CHECK (organization_id = NULLIF(current_setting(''app.organization_id'',true),'''')::uuid)',table_ref);
  EXECUTE format('GRANT SELECT ON %s TO aegis_workforce_runtime',table_ref);
 END LOOP;
END $$;
GRANT USAGE ON SCHEMA hr,core,finance TO aegis_workforce_runtime;
-- Storage references are accepted only when the uploader belongs to the same
-- organisation. No browser or operational list receives raw storage metadata.
CREATE OR REPLACE FUNCTION core.workforce_document_object(object_name text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE evidence jsonb;
BEGIN
 IF to_regclass('storage.objects') IS NULL THEN RETURN NULL; END IF;
 SELECT jsonb_build_object('id',o.id,'updated_at',o.updated_at,'metadata',o.metadata)
 INTO evidence FROM storage.objects o JOIN core.users u ON u.id::text=o.owner_id
 WHERE o.bucket_id='documents' AND o.name=object_name
   AND u.organization_id=NULLIF(current_setting('app.organization_id',true),'')::uuid;
 RETURN evidence;
END $$;
REVOKE EXECUTE ON FUNCTION core.workforce_document_object(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION core.workforce_document_object(text) TO aegis_workforce_runtime;
REVOKE ALL ON hr.worker_categories FROM anon, authenticated;
REVOKE ALL ON hr.positions FROM anon, authenticated;
GRANT INSERT,UPDATE ON hr.employees,hr.worker_categories,hr.positions,hr.worker_engagements,
 hr.reporting_lines,hr.employee_availability,hr.employee_skills,hr.employee_certifications,
 core.command_receipts,core.approval_instances,core.approval_steps TO aegis_workforce_runtime;
GRANT INSERT,UPDATE ON core.event_dispatch_attempts TO aegis_workforce_runtime;
GRANT INSERT ON core.event_receipts TO aegis_workforce_runtime;
GRANT INSERT ON core.approval_decisions,core.audit_log,core.domain_events TO aegis_workforce_runtime;
REVOKE UPDATE,DELETE,TRUNCATE ON core.audit_log,core.approval_decisions FROM aegis_workforce_runtime;

-- Composite FK backstops for the existing worker-owned foundations; validate legacy
-- rows in preflight, rather than deleting or silently reassigning historical evidence.
DO $$
DECLARE table_ref text;
BEGIN
 FOREACH table_ref IN ARRAY ARRAY['hr.reporting_lines','hr.employee_availability','hr.employee_skills','hr.employee_certifications','hr.employee_documents','hr.employee_medicals','hr.training_records'] LOOP
  EXECUTE format('ALTER TABLE %s ADD CONSTRAINT workforce_employee_tenant_fk FOREIGN KEY(organization_id,employee_id) REFERENCES hr.employees(organization_id,id) NOT VALID',table_ref);
 END LOOP;
END $$;
ALTER TABLE hr.reporting_lines ADD CONSTRAINT reporting_manager_tenant_fk FOREIGN KEY(organization_id,manager_employee_id) REFERENCES hr.employees(organization_id,id) NOT VALID;

INSERT INTO core.permissions(key,description) VALUES
 ('workforce.people.read','Read operational workforce fields'),
 ('workforce.people.create','Create workforce profiles'),
 ('workforce.people.update','Update operational workforce fields'),
 ('workforce.people.archive','Archive workforce profiles with a reason'),
 ('workforce.organisation.read','Read workforce categories positions and reporting lines'),
 ('workforce.organisation.manage','Manage workforce categories positions and reporting lines'),
 ('workforce.availability.read','Read effective worker availability'),
 ('workforce.availability.manage','Record manual workforce availability'),
 ('workforce.audit.read','Read redacted workforce action history'),
 ('hr.engagement.manage','Prepare workforce engagements'),
 ('hr.engagement.read','Read HR engagement evidence and review status'),
 ('hr.engagement.verify','Independently verify workforce engagements'),
 ('workforce.skills.manage','Record worker skills and credential evidence')
ON CONFLICT(key) DO NOTHING;
