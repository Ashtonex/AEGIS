-- Compliance Phase 2. Requires the existing Core/Workforce foundation migration 176.
-- Runtime role is provisioned by the existing provisioning tool; no user/role grants seeded.
CREATE SCHEMA IF NOT EXISTS compliance;
CREATE UNIQUE INDEX IF NOT EXISTS projects_compliance_tenant_id ON projects.projects(organization_id,id);
CREATE TABLE compliance.domains (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES core.organizations(id),
 created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 version integer NOT NULL DEFAULT 1 CHECK(version>0), is_deleted boolean NOT NULL DEFAULT false,
 UNIQUE(organization_id,id), FOREIGN KEY(organization_id,created_by) REFERENCES core.users(organization_id,id),
 code varchar(40) NOT NULL, name varchar(200) NOT NULL, jurisdiction varchar(120) NOT NULL, UNIQUE(organization_id,code)
);
CREATE INDEX domains_compliance_tenant_idx ON compliance.domains(organization_id,created_at,id);
CREATE TABLE compliance.authorities (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES core.organizations(id),
 created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 version integer NOT NULL DEFAULT 1 CHECK(version>0), is_deleted boolean NOT NULL DEFAULT false,
 UNIQUE(organization_id,id), FOREIGN KEY(organization_id,created_by) REFERENCES core.users(organization_id,id),
 code varchar(40) NOT NULL, name varchar(200) NOT NULL, jurisdiction varchar(120) NOT NULL, UNIQUE(organization_id,code)
);
CREATE INDEX authorities_compliance_tenant_idx ON compliance.authorities(organization_id,created_at,id);
CREATE TABLE compliance.sources (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES core.organizations(id),
 created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 version integer NOT NULL DEFAULT 1 CHECK(version>0), is_deleted boolean NOT NULL DEFAULT false,
 UNIQUE(organization_id,id), FOREIGN KEY(organization_id,created_by) REFERENCES core.users(organization_id,id),
 authority_id uuid NOT NULL, title varchar(200) NOT NULL, citation text NOT NULL, jurisdiction varchar(120) NOT NULL,
 effective_from date NOT NULL, review_on date NOT NULL CHECK(review_on>=effective_from),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','verified')), verified_by uuid, verified_at timestamptz, verification_reason text,
 FOREIGN KEY(organization_id,authority_id) REFERENCES compliance.authorities(organization_id,id),
 FOREIGN KEY(organization_id,verified_by) REFERENCES core.users(organization_id,id),
 CHECK(status!='verified' OR (verified_by IS NOT NULL AND verified_by<>created_by AND verified_at IS NOT NULL AND length(trim(verification_reason))>=10))
);
CREATE INDEX sources_compliance_tenant_idx ON compliance.sources(organization_id,created_at,id);
CREATE TABLE compliance.obligations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES core.organizations(id),
 created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 version integer NOT NULL DEFAULT 1 CHECK(version>0), is_deleted boolean NOT NULL DEFAULT false,
 UNIQUE(organization_id,id), FOREIGN KEY(organization_id,created_by) REFERENCES core.users(organization_id,id),
 code varchar(40) NOT NULL, domain_id uuid NOT NULL,
 UNIQUE(organization_id,code), FOREIGN KEY(organization_id,domain_id) REFERENCES compliance.domains(organization_id,id)
);
CREATE INDEX obligations_compliance_tenant_idx ON compliance.obligations(organization_id,created_at,id);
CREATE TABLE compliance.obligation_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES core.organizations(id),
 created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 version integer NOT NULL DEFAULT 1 CHECK(version>0), is_deleted boolean NOT NULL DEFAULT false,
 UNIQUE(organization_id,id), FOREIGN KEY(organization_id,created_by) REFERENCES core.users(organization_id,id),
 obligation_id uuid NOT NULL, revision integer NOT NULL CHECK(revision>0), predecessor_id uuid,
 source_id uuid NOT NULL, title varchar(200) NOT NULL, requirement text NOT NULL,
 effective_from date NOT NULL, effective_to date, review_on date NOT NULL,
 owner_id uuid NOT NULL, rule jsonb NOT NULL CHECK(jsonb_typeof(rule)='object'),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','under_review','applicable','active','superseded','archived','rejected')),
 approval_id uuid, change_reason text NOT NULL,
 FOREIGN KEY(organization_id,obligation_id) REFERENCES compliance.obligations(organization_id,id),
 FOREIGN KEY(organization_id,source_id) REFERENCES compliance.sources(organization_id,id),
 FOREIGN KEY(organization_id,owner_id) REFERENCES core.users(organization_id,id),
 FOREIGN KEY(organization_id,predecessor_id) REFERENCES compliance.obligation_versions(organization_id,id),
 FOREIGN KEY(organization_id,approval_id) REFERENCES core.approval_instances(organization_id,id),
 UNIQUE(organization_id,obligation_id,revision), CHECK(effective_to IS NULL OR effective_to>effective_from), CHECK(review_on>=effective_from)
);
CREATE INDEX obligation_versions_compliance_tenant_idx ON compliance.obligation_versions(organization_id,created_at,id);
CREATE TABLE compliance.scope_grants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES core.organizations(id),
 created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 version integer NOT NULL DEFAULT 1 CHECK(version>0), is_deleted boolean NOT NULL DEFAULT false,
 UNIQUE(organization_id,id), FOREIGN KEY(organization_id,created_by) REFERENCES core.users(organization_id,id),
 user_id uuid NOT NULL, project_id uuid NOT NULL,
 FOREIGN KEY(organization_id,user_id) REFERENCES core.users(organization_id,id),
 FOREIGN KEY(organization_id,project_id) REFERENCES projects.projects(organization_id,id), UNIQUE(organization_id,user_id,project_id)
);
CREATE INDEX scope_grants_compliance_tenant_idx ON compliance.scope_grants(organization_id,created_at,id);
CREATE TABLE compliance.applicability_assessments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES core.organizations(id),
 created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 version integer NOT NULL DEFAULT 1 CHECK(version>0), is_deleted boolean NOT NULL DEFAULT false,
 UNIQUE(organization_id,id), FOREIGN KEY(organization_id,created_by) REFERENCES core.users(organization_id,id),
 obligation_version_id uuid NOT NULL, subject_kind text NOT NULL CHECK(subject_kind IN ('organisation','project','worker','supplier','subcontractor','asset')),
 subject_id uuid NOT NULL, project_id uuid, outcome text NOT NULL CHECK(outcome IN ('applicable','not_applicable')),
 reason text NOT NULL CHECK(length(trim(reason))>=10), basis text NOT NULL CHECK(length(trim(basis))>=10), review_on date NOT NULL,
 status text NOT NULL DEFAULT 'under_review' CHECK(status IN ('under_review','approved','rejected')),
 approval_id uuid, FOREIGN KEY(organization_id,obligation_version_id) REFERENCES compliance.obligation_versions(organization_id,id),
 FOREIGN KEY(organization_id,project_id) REFERENCES projects.projects(organization_id,id),
 FOREIGN KEY(organization_id,approval_id) REFERENCES core.approval_instances(organization_id,id),
 CHECK(subject_kind!='project' OR (project_id IS NOT NULL AND project_id=subject_id))
);
CREATE INDEX applicability_assessments_compliance_tenant_idx ON compliance.applicability_assessments(organization_id,created_at,id);
CREATE TABLE compliance.assignments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES core.organizations(id),
 created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 version integer NOT NULL DEFAULT 1 CHECK(version>0), is_deleted boolean NOT NULL DEFAULT false,
 UNIQUE(organization_id,id), FOREIGN KEY(organization_id,created_by) REFERENCES core.users(organization_id,id),
 assessment_id uuid NOT NULL, owner_id uuid NOT NULL, project_id uuid, reason text NOT NULL,
 status text NOT NULL DEFAULT 'action_required' CHECK(status='action_required'),
 FOREIGN KEY(organization_id,assessment_id) REFERENCES compliance.applicability_assessments(organization_id,id),
 FOREIGN KEY(organization_id,owner_id) REFERENCES core.users(organization_id,id),
 FOREIGN KEY(organization_id,project_id) REFERENCES projects.projects(organization_id,id), UNIQUE(organization_id,assessment_id)
);
CREATE INDEX assignments_compliance_tenant_idx ON compliance.assignments(organization_id,created_at,id);

-- Typed subject integrity is validated against authoritative tables, not arbitrary SQL names.
CREATE OR REPLACE FUNCTION compliance.validate_subject() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog AS $$
DECLARE target text; found boolean;
BEGIN
 IF NEW.subject_kind='organisation' THEN
   IF NEW.subject_id<>NEW.organization_id THEN RAISE EXCEPTION 'Subject tenant mismatch' USING ERRCODE='23514'; END IF;
   RETURN NEW;
 END IF;
 target := CASE NEW.subject_kind WHEN 'project' THEN 'projects.projects' WHEN 'worker' THEN 'hr.employees'
   WHEN 'supplier' THEN 'procurement.suppliers' WHEN 'subcontractor' THEN 'crm.subcontractors' WHEN 'asset' THEN 'fleet.fleet' END;
 EXECUTE format('SELECT EXISTS(SELECT 1 FROM %s WHERE organization_id=$1 AND id=$2 AND is_deleted=false)',target)
 INTO found USING NEW.organization_id,NEW.subject_id;
 IF NOT found THEN RAISE EXCEPTION 'Subject is unavailable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER assessment_subject_integrity BEFORE INSERT ON compliance.applicability_assessments FOR EACH ROW EXECUTE FUNCTION compliance.validate_subject();

CREATE OR REPLACE FUNCTION compliance.guard_history() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Compliance history cannot be deleted' USING ERRCODE='23514'; END IF;
 IF NEW.organization_id<>OLD.organization_id OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at OR NEW.is_deleted THEN
  RAISE EXCEPTION 'Compliance identity and history are immutable' USING ERRCODE='23514';
 END IF;
 IF TG_TABLE_NAME='sources' AND OLD.status='verified' THEN
  RAISE EXCEPTION 'Verified source requires a successor' USING ERRCODE='23514';
 END IF;
 IF TG_TABLE_NAME='obligation_versions' THEN
  IF (to_jsonb(NEW)-ARRAY['status','version','approval_id'])<>(to_jsonb(OLD)-ARRAY['status','version','approval_id']) THEN
   RAISE EXCEPTION 'Obligation content requires a successor version' USING ERRCODE='23514';
  END IF;
  IF NOT ((OLD.status='draft' AND NEW.status='under_review') OR
    (OLD.status='under_review' AND NEW.status IN ('applicable','rejected')) OR
    (OLD.status='applicable' AND NEW.status IN ('active','archived')) OR
    (OLD.status='active' AND NEW.status IN ('superseded','archived'))) THEN
   RAISE EXCEPTION 'Invalid obligation transition' USING ERRCODE='23514';
  END IF;
 ELSIF TG_TABLE_NAME='applicability_assessments' THEN
  IF OLD.status<>'under_review' OR NEW.status NOT IN ('under_review','approved','rejected') OR
    (to_jsonb(NEW)-ARRAY['status','version','approval_id'])<>(to_jsonb(OLD)-ARRAY['status','version','approval_id']) THEN
   RAISE EXCEPTION 'Assessment decision is immutable' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION compliance.guard_history(),compliance.validate_subject() FROM PUBLIC,anon,authenticated;
ALTER TABLE compliance.domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.domains FORCE ROW LEVEL SECURITY;
REVOKE ALL ON compliance.domains FROM anon,authenticated;
CREATE POLICY compliance_tenant ON compliance.domains TO aegis_workforce_runtime USING(organization_id=NULLIF(current_setting('app.organization_id',true),'')::uuid) WITH CHECK(organization_id=NULLIF(current_setting('app.organization_id',true),'')::uuid);
GRANT SELECT,INSERT ON compliance.domains TO aegis_workforce_runtime;
CREATE TRIGGER compliance_history BEFORE UPDATE OR DELETE ON compliance.domains FOR EACH ROW EXECUTE FUNCTION compliance.guard_history();
ALTER TABLE compliance.authorities ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.authorities FORCE ROW LEVEL SECURITY;
REVOKE ALL ON compliance.authorities FROM anon,authenticated;
CREATE POLICY compliance_tenant ON compliance.authorities TO aegis_workforce_runtime USING(organization_id=NULLIF(current_setting('app.organization_id',true),'')::uuid) WITH CHECK(organization_id=NULLIF(current_setting('app.organization_id',true),'')::uuid);
GRANT SELECT,INSERT ON compliance.authorities TO aegis_workforce_runtime;
CREATE TRIGGER compliance_history BEFORE UPDATE OR DELETE ON compliance.authorities FOR EACH ROW EXECUTE FUNCTION compliance.guard_history();
ALTER TABLE compliance.sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.sources FORCE ROW LEVEL SECURITY;
REVOKE ALL ON compliance.sources FROM anon,authenticated;
CREATE POLICY compliance_tenant ON compliance.sources TO aegis_workforce_runtime USING(organization_id=NULLIF(current_setting('app.organization_id',true),'')::uuid) WITH CHECK(organization_id=NULLIF(current_setting('app.organization_id',true),'')::uuid);
GRANT SELECT,INSERT ON compliance.sources TO aegis_workforce_runtime;
CREATE TRIGGER compliance_history BEFORE UPDATE OR DELETE ON compliance.sources FOR EACH ROW EXECUTE FUNCTION compliance.guard_history();
ALTER TABLE compliance.obligations ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.obligations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON compliance.obligations FROM anon,authenticated;
CREATE POLICY compliance_tenant ON compliance.obligations TO aegis_workforce_runtime USING(organization_id=NULLIF(current_setting('app.organization_id',true),'')::uuid) WITH CHECK(organization_id=NULLIF(current_setting('app.organization_id',true),'')::uuid);
GRANT SELECT,INSERT ON compliance.obligations TO aegis_workforce_runtime;
CREATE TRIGGER compliance_history BEFORE UPDATE OR DELETE ON compliance.obligations FOR EACH ROW EXECUTE FUNCTION compliance.guard_history();
ALTER TABLE compliance.obligation_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.obligation_versions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON compliance.obligation_versions FROM anon,authenticated;
CREATE POLICY compliance_tenant ON compliance.obligation_versions TO aegis_workforce_runtime USING(organization_id=NULLIF(current_setting('app.organization_id',true),'')::uuid) WITH CHECK(organization_id=NULLIF(current_setting('app.organization_id',true),'')::uuid);
GRANT SELECT,INSERT ON compliance.obligation_versions TO aegis_workforce_runtime;
CREATE TRIGGER compliance_history BEFORE UPDATE OR DELETE ON compliance.obligation_versions FOR EACH ROW EXECUTE FUNCTION compliance.guard_history();
ALTER TABLE compliance.scope_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.scope_grants FORCE ROW LEVEL SECURITY;
REVOKE ALL ON compliance.scope_grants FROM anon,authenticated;
CREATE POLICY compliance_tenant ON compliance.scope_grants TO aegis_workforce_runtime USING(organization_id=NULLIF(current_setting('app.organization_id',true),'')::uuid) WITH CHECK(organization_id=NULLIF(current_setting('app.organization_id',true),'')::uuid);
GRANT SELECT,INSERT ON compliance.scope_grants TO aegis_workforce_runtime;
CREATE TRIGGER compliance_history BEFORE UPDATE OR DELETE ON compliance.scope_grants FOR EACH ROW EXECUTE FUNCTION compliance.guard_history();
ALTER TABLE compliance.applicability_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.applicability_assessments FORCE ROW LEVEL SECURITY;
REVOKE ALL ON compliance.applicability_assessments FROM anon,authenticated;
CREATE POLICY compliance_tenant ON compliance.applicability_assessments TO aegis_workforce_runtime USING(organization_id=NULLIF(current_setting('app.organization_id',true),'')::uuid) WITH CHECK(organization_id=NULLIF(current_setting('app.organization_id',true),'')::uuid);
GRANT SELECT,INSERT ON compliance.applicability_assessments TO aegis_workforce_runtime;
CREATE TRIGGER compliance_history BEFORE UPDATE OR DELETE ON compliance.applicability_assessments FOR EACH ROW EXECUTE FUNCTION compliance.guard_history();
ALTER TABLE compliance.assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.assignments FORCE ROW LEVEL SECURITY;
REVOKE ALL ON compliance.assignments FROM anon,authenticated;
CREATE POLICY compliance_tenant ON compliance.assignments TO aegis_workforce_runtime USING(organization_id=NULLIF(current_setting('app.organization_id',true),'')::uuid) WITH CHECK(organization_id=NULLIF(current_setting('app.organization_id',true),'')::uuid);
GRANT SELECT,INSERT ON compliance.assignments TO aegis_workforce_runtime;
CREATE TRIGGER compliance_history BEFORE UPDATE OR DELETE ON compliance.assignments FOR EACH ROW EXECUTE FUNCTION compliance.guard_history();
GRANT USAGE ON SCHEMA compliance,projects,procurement,crm,fleet TO aegis_workforce_runtime;
GRANT UPDATE ON compliance.obligations,compliance.assignments,compliance.sources,compliance.obligation_versions,compliance.applicability_assessments TO aegis_workforce_runtime;
CREATE POLICY compliance_project_scope ON compliance.applicability_assessments AS RESTRICTIVE TO aegis_workforce_runtime
 USING (current_setting('app.compliance_all',true)='true' OR (project_id IS NULL AND created_by=NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid) OR EXISTS(SELECT 1 FROM compliance.scope_grants g WHERE g.organization_id=applicability_assessments.organization_id AND g.project_id=applicability_assessments.project_id AND g.user_id=NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid))
 WITH CHECK (current_setting('app.compliance_all',true)='true' OR (project_id IS NULL AND created_by=NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid) OR EXISTS(SELECT 1 FROM compliance.scope_grants g WHERE g.organization_id=applicability_assessments.organization_id AND g.project_id=applicability_assessments.project_id AND g.user_id=NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid));
CREATE POLICY compliance_project_scope ON compliance.assignments AS RESTRICTIVE TO aegis_workforce_runtime
 USING (current_setting('app.compliance_all',true)='true' OR (project_id IS NULL AND created_by=NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid) OR EXISTS(SELECT 1 FROM compliance.scope_grants g WHERE g.organization_id=assignments.organization_id AND g.project_id=assignments.project_id AND g.user_id=NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid))
 WITH CHECK (current_setting('app.compliance_all',true)='true' OR (project_id IS NULL AND created_by=NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid) OR EXISTS(SELECT 1 FROM compliance.scope_grants g WHERE g.organization_id=assignments.organization_id AND g.project_id=assignments.project_id AND g.user_id=NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid));
ALTER TABLE projects.projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY compliance_master_tenant ON projects.projects TO aegis_workforce_runtime USING(organization_id=NULLIF(current_setting('app.organization_id',true),'')::uuid);
CREATE POLICY compliance_master_fence ON projects.projects AS RESTRICTIVE TO aegis_workforce_runtime USING(organization_id=NULLIF(current_setting('app.organization_id',true),'')::uuid);
GRANT SELECT ON projects.projects TO aegis_workforce_runtime;
ALTER TABLE procurement.suppliers ENABLE ROW LEVEL SECURITY;
CREATE POLICY compliance_master_tenant ON procurement.suppliers TO aegis_workforce_runtime USING(organization_id=NULLIF(current_setting('app.organization_id',true),'')::uuid);
CREATE POLICY compliance_master_fence ON procurement.suppliers AS RESTRICTIVE TO aegis_workforce_runtime USING(organization_id=NULLIF(current_setting('app.organization_id',true),'')::uuid);
GRANT SELECT ON procurement.suppliers TO aegis_workforce_runtime;
ALTER TABLE crm.subcontractors ENABLE ROW LEVEL SECURITY;
CREATE POLICY compliance_master_tenant ON crm.subcontractors TO aegis_workforce_runtime USING(organization_id=NULLIF(current_setting('app.organization_id',true),'')::uuid);
CREATE POLICY compliance_master_fence ON crm.subcontractors AS RESTRICTIVE TO aegis_workforce_runtime USING(organization_id=NULLIF(current_setting('app.organization_id',true),'')::uuid);
GRANT SELECT ON crm.subcontractors TO aegis_workforce_runtime;
ALTER TABLE fleet.fleet ENABLE ROW LEVEL SECURITY;
CREATE POLICY compliance_master_tenant ON fleet.fleet TO aegis_workforce_runtime USING(organization_id=NULLIF(current_setting('app.organization_id',true),'')::uuid);
CREATE POLICY compliance_master_fence ON fleet.fleet AS RESTRICTIVE TO aegis_workforce_runtime USING(organization_id=NULLIF(current_setting('app.organization_id',true),'')::uuid);
GRANT SELECT ON fleet.fleet TO aegis_workforce_runtime;
INSERT INTO core.permissions(key,description) VALUES
('compliance.foundation.read','Compliance foundation read'),
('compliance.foundation.manage','Compliance foundation manage'),
('compliance.foundation.approve','Compliance foundation approve'),
('compliance.foundation.legal_review','Compliance foundation legal_review'),
('compliance.foundation.assign','Compliance foundation assign'),
('compliance.foundation.scope.all','Compliance foundation scope.all'),
('compliance.foundation.scope.manage','Compliance foundation scope.manage'),
('compliance.foundation.audit.read','Compliance foundation audit.read'),
('compliance.foundation.export','Compliance foundation export')
ON CONFLICT(key) DO NOTHING;

-- Database backstops for polymorphic subject references: generated typed keys preserve history.
CREATE UNIQUE INDEX IF NOT EXISTS compliance_worker_tenant_id ON hr.employees(organization_id,id);
ALTER TABLE compliance.applicability_assessments ADD COLUMN worker_id uuid GENERATED ALWAYS AS (CASE WHEN subject_kind='worker' THEN subject_id ELSE NULL END) STORED;
ALTER TABLE compliance.applicability_assessments ADD CONSTRAINT assessment_worker_fk FOREIGN KEY(organization_id,worker_id) REFERENCES hr.employees(organization_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS compliance_supplier_tenant_id ON procurement.suppliers(organization_id,id);
ALTER TABLE compliance.applicability_assessments ADD COLUMN supplier_id uuid GENERATED ALWAYS AS (CASE WHEN subject_kind='supplier' THEN subject_id ELSE NULL END) STORED;
ALTER TABLE compliance.applicability_assessments ADD CONSTRAINT assessment_supplier_fk FOREIGN KEY(organization_id,supplier_id) REFERENCES procurement.suppliers(organization_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS compliance_subcontractor_tenant_id ON crm.subcontractors(organization_id,id);
ALTER TABLE compliance.applicability_assessments ADD COLUMN subcontractor_id uuid GENERATED ALWAYS AS (CASE WHEN subject_kind='subcontractor' THEN subject_id ELSE NULL END) STORED;
ALTER TABLE compliance.applicability_assessments ADD CONSTRAINT assessment_subcontractor_fk FOREIGN KEY(organization_id,subcontractor_id) REFERENCES crm.subcontractors(organization_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS compliance_asset_tenant_id ON fleet.fleet(organization_id,id);
ALTER TABLE compliance.applicability_assessments ADD COLUMN asset_id uuid GENERATED ALWAYS AS (CASE WHEN subject_kind='asset' THEN subject_id ELSE NULL END) STORED;
ALTER TABLE compliance.applicability_assessments ADD CONSTRAINT assessment_asset_fk FOREIGN KEY(organization_id,asset_id) REFERENCES fleet.fleet(organization_id,id);

CREATE OR REPLACE FUNCTION compliance.require_approval() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='INSERT' THEN
   IF TG_TABLE_NAME='obligation_versions' AND NEW.status<>'draft' THEN RAISE EXCEPTION 'Obligations start as drafts' USING ERRCODE='23514'; END IF;
   IF TG_TABLE_NAME='applicability_assessments' AND NEW.status<>'under_review' THEN RAISE EXCEPTION 'Applicability needs review' USING ERRCODE='23514'; END IF;
 ELSE
   IF (TG_TABLE_NAME='obligation_versions' AND NEW.status='applicable') OR (TG_TABLE_NAME='applicability_assessments' AND NEW.status='approved') THEN
    IF NOT EXISTS(SELECT 1 FROM core.approval_instances a WHERE a.organization_id=NEW.organization_id AND a.id=NEW.approval_id AND a.target_id=NEW.id AND a.target_type='compliance.'||TG_TABLE_NAME AND a.target_version=OLD.version AND a.status='approved') THEN
     RAISE EXCEPTION 'Independent approval is required' USING ERRCODE='23514';
    END IF;
   END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION compliance.require_approval() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER require_obligation_approval BEFORE INSERT OR UPDATE ON compliance.obligation_versions FOR EACH ROW EXECUTE FUNCTION compliance.require_approval();
CREATE TRIGGER require_applicability_approval BEFORE INSERT OR UPDATE ON compliance.applicability_assessments FOR EACH ROW EXECUTE FUNCTION compliance.require_approval();
CREATE UNIQUE INDEX compliance_one_active_revision ON compliance.obligation_versions(organization_id,obligation_id) WHERE status='active';
ALTER TABLE core.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY compliance_notification_tenant ON core.notifications TO aegis_workforce_runtime USING(organization_id=NULLIF(current_setting('app.organization_id',true),'')::uuid) WITH CHECK(organization_id=NULLIF(current_setting('app.organization_id',true),'')::uuid);
CREATE POLICY compliance_notification_fence ON core.notifications AS RESTRICTIVE TO aegis_workforce_runtime USING(organization_id=NULLIF(current_setting('app.organization_id',true),'')::uuid) WITH CHECK(organization_id=NULLIF(current_setting('app.organization_id',true),'')::uuid);
GRANT INSERT,SELECT ON core.notifications TO aegis_workforce_runtime;
