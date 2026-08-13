-- ============================================================================
-- Per-role landing pages, a CRM-only role, and finance segregation-of-duties
-- role templates.
-- ============================================================================
-- Part A: every internal role today lands on the Executive Dashboard after
-- login (portals.py's /resolve-access has no per-role concept at all - see
-- that router for the actual routing change). default_landing_path lets each
-- role carry its own "this is your actual working page" value; NULL keeps
-- today's fallback (/dashboard/executive) so any role left unseeded here is
-- unaffected.
--
-- Part B: "Sales Executive" is deliberately broad (migration 066 - full
-- working CRM access). A genuinely narrow role - Leads + Opportunities only,
-- nothing else - needs its own definition rather than trimming an existing
-- role that other people may already depend on being broad.
--
-- Part D: three new finance role TEMPLATES that split "can post cash" /
-- "can run payroll" / "can see numbers and prepare budgets" apart, so a
-- future re-assignment doesn't require inventing the split at that point.
-- These are additive and unassigned - nothing in the live system references
-- them yet, and the existing Finance Manager role's own grants are
-- deliberately left untouched by this migration.
-- ============================================================================

ALTER TABLE core.roles ADD COLUMN IF NOT EXISTS default_landing_path VARCHAR(255);

-- ----------------------------------------------------------------------------
-- Part A: default landing pages for existing roles.
-- Each mapping was checked against DashboardShell.tsx's current per-role nav
-- allowedRoles so nobody lands on a page their own sidebar can't reach.
-- SUPERADMIN/CLIENT/SUPPLIER/foreman-family roles are handled by dedicated
-- branches in portals.py regardless of this column, so they're left NULL.
-- ----------------------------------------------------------------------------
UPDATE core.roles SET default_landing_path = '/dashboard/executive' WHERE name = 'Executive (Admin)';
UPDATE core.roles SET default_landing_path = '/dashboard/projects' WHERE name = 'Project Manager';
UPDATE core.roles SET default_landing_path = '/dashboard/finance' WHERE name = 'Finance Manager';
UPDATE core.roles SET default_landing_path = '/dashboard/hr' WHERE name IN ('HR Manager', 'HR Officer');
UPDATE core.roles SET default_landing_path = '/dashboard/compliance' WHERE name IN ('Compliance Officer', 'Internal Auditor', 'HSE / Safety Officer');
UPDATE core.roles SET default_landing_path = '/dashboard/procurement' WHERE name = 'Procurement Manager';
UPDATE core.roles SET default_landing_path = '/dashboard/fleet' WHERE name = 'Fleet Supervisor';
UPDATE core.roles SET default_landing_path = '/dashboard/equipment' WHERE name IN ('Equipment Manager', 'Site Manager');
UPDATE core.roles SET default_landing_path = '/dashboard/quotations' WHERE name = 'Quantity Surveyor';
UPDATE core.roles SET default_landing_path = '/dashboard/crm/leads' WHERE name = 'Sales Executive';

-- ----------------------------------------------------------------------------
-- Part B: CRM Associate - Leads + Opportunities only. No contacts,
-- organizations, marketing, campaigns, tenders, or documents. Withholds
-- crm.opportunities.close_won (creates a real company project) the same way
-- Sales Executive does - front-line staff can work and lose a deal, not
-- unilaterally spin up a project.
-- ----------------------------------------------------------------------------
INSERT INTO core.roles (organization_id, name, description, default_landing_path)
SELECT o.id, 'CRM Associate', 'Front-line lead/opportunity handling only - no other CRM or module access', '/dashboard/crm/leads'
FROM core.organizations o
WHERE o.is_deleted = false
  AND NOT EXISTS (
      SELECT 1 FROM core.roles r
      WHERE r.organization_id = o.id AND r.name = 'CRM Associate' AND r.is_deleted = false
  );

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.organizations o
JOIN core.roles r ON r.organization_id = o.id AND r.name = 'CRM Associate' AND r.is_deleted = false
JOIN (VALUES
    ('crm_leads.read'), ('crm_leads.create'), ('crm_leads.update'), ('crm_leads.qualify'),
    ('crm.opportunities.read'), ('crm.opportunities.update'), ('crm.opportunities.quote'),
    ('crm.opportunities.close')
) AS grant_def(permission_key) ON true
JOIN core.permissions p ON p.key = grant_def.permission_key
WHERE o.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- Part D: finance segregation-of-duties role templates. Unassigned until an
-- admin moves someone into one via Settings -> Users. Finance Manager's own
-- permission grants are untouched by this migration.
-- ----------------------------------------------------------------------------
INSERT INTO core.roles (organization_id, name, description, default_landing_path)
SELECT o.id, role_def.name, role_def.description, role_def.landing_path
FROM core.organizations o
CROSS JOIN (VALUES
    ('Payroll Administrator',        'Runs and posts payroll only - no cash/bank, budget, or company-wide reporting access', '/dashboard/finance/payroll'),
    ('Accounts Payable / Cash Officer', 'Posts cash, allocates receipts, pays suppliers - no payroll, budget approval, or full financial reporting', '/dashboard/finance/cashbook'),
    ('Budget & Reporting Analyst',   'Sees financial reporting and prepares budgets/claims/variations - cannot post cash, run payroll, or give final sign-off', '/dashboard/finance/budgets')
) AS role_def(name, description, landing_path)
WHERE o.is_deleted = false
  AND NOT EXISTS (
      SELECT 1 FROM core.roles r
      WHERE r.organization_id = o.id AND r.name = role_def.name AND r.is_deleted = false
  );

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.organizations o
JOIN core.roles r ON r.organization_id = o.id AND r.is_deleted = false
JOIN (VALUES
    ('Payroll Administrator', 'finance.payroll.read'),
    ('Payroll Administrator', 'finance.payroll.manage'),
    ('Payroll Administrator', 'finance.payroll.post'),
    ('Payroll Administrator', 'finance.tax_rate.read'),

    ('Accounts Payable / Cash Officer', 'finance.cash.read'),
    ('Accounts Payable / Cash Officer', 'finance.cash.post'),
    ('Accounts Payable / Cash Officer', 'finance.receipt.allocate'),
    ('Accounts Payable / Cash Officer', 'finance.supplier_payment.post'),
    ('Accounts Payable / Cash Officer', 'procurement.invoice.read'),
    ('Accounts Payable / Cash Officer', 'procurement.invoice.approve_payment'),

    ('Budget & Reporting Analyst', 'finance.budget.read'),
    ('Budget & Reporting Analyst', 'finance.budget.create'),
    ('Budget & Reporting Analyst', 'financial_performance.read'),
    ('Budget & Reporting Analyst', 'finance.cost.read'),
    ('Budget & Reporting Analyst', 'finance.variation.read'),
    ('Budget & Reporting Analyst', 'finance.variation.create'),
    ('Budget & Reporting Analyst', 'finance.claim.read'),
    ('Budget & Reporting Analyst', 'finance.claim.create'),
    ('Budget & Reporting Analyst', 'bi_reports.read'),
    ('Budget & Reporting Analyst', 'kpi_metrics.read'),
    ('Budget & Reporting Analyst', 'automated_reports.read')
) AS grant_def(role_name, permission_key) ON grant_def.role_name = r.name
JOIN core.permissions p ON p.key = grant_def.permission_key
WHERE o.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;
