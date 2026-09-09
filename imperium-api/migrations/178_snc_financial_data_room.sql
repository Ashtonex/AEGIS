-- ============================================================================
-- AEGIS MIGRATION: SNC FINANCIAL DATA ROOM & BANKABILITY ENGINE
-- Adds authoritative 18-folder data room hierarchy, BS-100 through BS-800
-- bankability and audit checklist criteria, document storage routing, and
-- RBAC permissions.
-- ============================================================================

CREATE TABLE IF NOT EXISTS finance.data_room_folders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id),
    parent_path TEXT NOT NULL DEFAULT '',
    folder_name TEXT NOT NULL,
    folder_path TEXT NOT NULL,
    section_code VARCHAR(50),
    project_id UUID REFERENCES projects.projects(id),
    is_system BOOLEAN DEFAULT FALSE,
    created_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    is_deleted BOOLEAN DEFAULT FALSE,
    CONSTRAINT uq_data_room_folder_path UNIQUE (organization_id, folder_path)
);

CREATE INDEX IF NOT EXISTS idx_data_room_folders_org_path ON finance.data_room_folders(organization_id, folder_path) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_data_room_folders_parent ON finance.data_room_folders(organization_id, parent_path) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_data_room_folders_proj ON finance.data_room_folders(organization_id, project_id) WHERE is_deleted = false;

CREATE TABLE IF NOT EXISTS finance.data_room_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id),
    folder_path TEXT NOT NULL,
    title VARCHAR(255) NOT NULL,
    section_code VARCHAR(50) NOT NULL,
    audit_code VARCHAR(50),
    audit_subitem VARCHAR(150),
    project_id UUID REFERENCES projects.projects(id),
    fiscal_year INT,
    document_date DATE,
    amount NUMERIC(15,2),
    currency VARCHAR(10) DEFAULT 'USD',
    file_name VARCHAR(255) NOT NULL,
    file_size_bytes BIGINT DEFAULT 0,
    mime_type VARCHAR(100),
    storage_path TEXT NOT NULL,
    verification_status VARCHAR(50) NOT NULL DEFAULT 'unverified',
    verified_by UUID REFERENCES core.users(id),
    verified_at TIMESTAMPTZ,
    audit_notes TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    is_deleted BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_data_room_docs_org_folder ON finance.data_room_documents(organization_id, folder_path) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_data_room_docs_section ON finance.data_room_documents(organization_id, section_code) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_data_room_docs_audit ON finance.data_room_documents(organization_id, audit_code) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_data_room_docs_proj ON finance.data_room_documents(organization_id, project_id) WHERE is_deleted = false;

CREATE TABLE IF NOT EXISTS finance.bankability_checklists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id),
    audit_code VARCHAR(50) NOT NULL,
    category_name VARCHAR(100) NOT NULL,
    item_name VARCHAR(150) NOT NULL,
    is_mandatory BOOLEAN DEFAULT TRUE,
    description TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    verified_by UUID REFERENCES core.users(id),
    verified_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    is_deleted BOOLEAN DEFAULT FALSE,
    CONSTRAINT uq_bankability_checklist_item UNIQUE (organization_id, audit_code, item_name)
);

CREATE INDEX IF NOT EXISTS idx_bankability_org_code ON finance.bankability_checklists(organization_id, audit_code) WHERE is_deleted = false;

-- ----------------------------------------------------------------------------
-- Permissions Catalog Insertion
-- ----------------------------------------------------------------------------
INSERT INTO core.permissions (key, description) VALUES
    ('finance.data_room.read', 'View SNC Financial Data Room and audit checklists'),
    ('finance.data_room.upload', 'Upload and route documents into the SNC Financial Data Room'),
    ('finance.data_room.verify', 'Verify or flag audit readiness and balance sheet items in the Data Room'),
    ('finance.data_room.manage', 'Create custom folders and restructure the Financial Data Room'),
    ('finance.data_room.export', 'Export the Financial Data Room or project audit archives as structured packages')
ON CONFLICT (key) DO NOTHING;

-- Grant permissions to standard functional roles
INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.organizations o
JOIN core.roles r ON r.organization_id = o.id AND r.is_deleted = false
JOIN core.permissions p ON p.key IN (
    'finance.data_room.read',
    'finance.data_room.upload',
    'finance.data_room.verify',
    'finance.data_room.manage',
    'finance.data_room.export'
)
WHERE o.is_deleted = false
  AND r.name IN ('Executive (Admin)', 'Finance Manager', 'SUPERADMIN')
ON CONFLICT DO NOTHING;

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.organizations o
JOIN core.roles r ON r.organization_id = o.id AND r.is_deleted = false
JOIN core.permissions p ON p.key IN (
    'finance.data_room.read',
    'finance.data_room.verify',
    'finance.data_room.export'
)
WHERE o.is_deleted = false
  AND r.name IN ('External Auditor', 'Authorising Officer', 'Internal Auditor')
ON CONFLICT DO NOTHING;

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.organizations o
JOIN core.roles r ON r.organization_id = o.id AND r.is_deleted = false
JOIN core.permissions p ON p.key IN (
    'finance.data_room.read',
    'finance.data_room.upload',
    'finance.data_room.export'
)
WHERE o.is_deleted = false
  AND r.name IN ('Project Manager', 'Commercial Manager', 'Contracts Manager')
ON CONFLICT DO NOTHING;

-- ----------------------------------------------------------------------------
-- Seed Standard Bankability Checklist Items across all active organizations
-- ----------------------------------------------------------------------------
INSERT INTO finance.bankability_checklists (organization_id, audit_code, category_name, item_name, description)
SELECT o.id, item.audit_code, item.category_name, item.item_name, item.description
FROM core.organizations o
CROSS JOIN (VALUES
    -- BS-100 CASH
    ('BS-100', 'CASH', 'Bank reconciliation', 'Monthly signed bank reconciliations matching general ledger to statement'),
    ('BS-100', 'CASH', 'Bank statements', 'Original stamped bank statements for all active operating and project accounts'),
    ('BS-100', 'CASH', 'Cash count', 'Periodic petty cash certificates and physical count sheets signed by cash custodian'),
    ('BS-100', 'CASH', 'GL extract', 'Complete general ledger extract showing all cash and bank ledger debit/credit postings'),

    -- BS-200 RECEIVABLES
    ('BS-200', 'RECEIVABLES', 'Aged debtors', 'Detailed 30/60/90/120+ day debtor aging schedule broken down by client and project'),
    ('BS-200', 'RECEIVABLES', 'Invoice population', 'Authoritative register and copies of all certified client tax invoices and progress claims'),
    ('BS-200', 'RECEIVABLES', 'Contracts', 'Fully executed client construction contracts, letters of award, and variation agreements'),
    ('BS-200', 'RECEIVABLES', 'Subsequent receipts', 'Post-balance sheet bank deposits proving subsequent debt liquidation and creditworthiness'),

    -- BS-300 INVENTORY
    ('BS-300', 'INVENTORY', 'Inventory listing', 'Line-item inventory stock valuation report across central stores and site containers'),
    ('BS-300', 'INVENTORY', 'Physical count', 'Annual and quarterly physical stock count sheets with independent stocktake counters'),
    ('BS-300', 'INVENTORY', 'Valuation', 'Inventory costing methodology evidence (FIFO / weighted average) and obsolescence review'),

    -- BS-400 PPE
    ('BS-400', 'PPE', 'Asset register', 'Master plant, machinery, vehicle and equipment register with serials and asset tag IDs'),
    ('BS-400', 'PPE', 'Purchase documents', 'Supplier purchase invoices, import documentation, and bill of lading for heavy machinery'),
    ('BS-400', 'PPE', 'Ownership', 'Vehicle registration books, title deeds, and clear proof of unencumbered asset ownership'),
    ('BS-400', 'PPE', 'Physical verification', 'Visual asset inspection sign-offs, machine condition logs, and telematics reports'),
    ('BS-400', 'PPE', 'Depreciation', 'Depreciation schedule matching tax depreciation and accounting policy with residual values'),

    -- BS-500 PAYABLES
    ('BS-500', 'PAYABLES', 'Supplier ledger', 'Detailed sub-ledger listing all active trade creditors, subcontractors, and balances'),
    ('BS-500', 'PAYABLES', 'Supplier statements', 'Third-party monthly supplier statement reconciliations against purchase orders and GRNs'),
    ('BS-500', 'PAYABLES', 'Invoices', 'Tax invoices, delivery notes, and verified goods received notes from approved vendors'),
    ('BS-500', 'PAYABLES', 'Subsequent payments', 'Proof of post-balance sheet supplier clearance proving normal payment terms'),

    -- BS-600 TAX
    ('BS-600', 'TAX', 'Tax returns', 'Annual corporate income tax returns (ITF12C) filed and assessed with ZIMRA'),
    ('BS-600', 'TAX', 'ZIMRA tax clearance (ITF263)', 'Current, valid ZIMRA Tax Clearance Certificate (ITF263) with good standing status'),
    ('BS-600', 'TAX', 'VAT reconciliations', 'Monthly VAT input/output schedules reconciling with certified client claims and GRNs'),
    ('BS-600', 'TAX', 'PAYE returns', 'Monthly P2 PAYE and NSSA remittances reconciling to company payroll records'),
    ('BS-600', 'TAX', 'Withholding tax certificates', 'Withholding tax remittance proofs and client withholding tax exemption/deduction vouchers'),

    -- BS-700 LOANS
    ('BS-700', 'LOANS', 'Facility agreements', 'Signed loan, overdraft, lease, and trade finance facility agreements with commercial banks'),
    ('BS-700', 'LOANS', 'Amortization schedules', 'Updated principal and interest repayment schedules and bank loan confirmation certificates'),
    ('BS-700', 'LOANS', 'Security pledges', 'Notarial general debentures, bond registrations, and security pledge agreements'),
    ('BS-700', 'LOANS', 'Director guarantees', 'Executed personal or cross-corporate director deeds of suretyship and guarantee'),

    -- BS-800 EQUITY
    ('BS-800', 'EQUITY', 'Share register', 'Certified share register, CR6 / CR2 forms showing statutory share capital and ownership'),
    ('BS-800', 'EQUITY', 'Shareholder agreements', 'Shareholders agreement and memorandum & articles of association'),
    ('BS-800', 'EQUITY', 'Capital contributions', 'Bank deposit proof of paid-up share capital and equity shareholder injections'),
    ('BS-800', 'EQUITY', 'Retained earnings', 'Audited historical retained earnings reconciliation and dividend declaration resolutions')
) AS item(audit_code, category_name, item_name, description)
WHERE o.is_deleted = false
ON CONFLICT (organization_id, audit_code, item_name) DO NOTHING;

-- ----------------------------------------------------------------------------
-- Seed Standard 18-Folder Data Room Hierarchy across all active organizations
-- ----------------------------------------------------------------------------
INSERT INTO finance.data_room_folders (organization_id, parent_path, folder_name, folder_path, section_code, is_system)
SELECT o.id, f.parent_path, f.folder_name, f.folder_path, f.section_code, true
FROM core.organizations o
CROSS JOIN (VALUES
    ('', '01 CORPORATE', '01 CORPORATE', '01_CORPORATE'),
    ('', '02 BANKING', '02 BANKING', '02_BANKING'),
    ('02 BANKING', '2024', '02 BANKING/2024', '02_BANKING'),
    ('02 BANKING', '2025', '02 BANKING/2025', '02_BANKING'),
    ('02 BANKING', '2026', '02 BANKING/2026', '02_BANKING'),
    ('', '03 SALES & CLIENTS', '03 SALES & CLIENTS', '03_SALES_CLIENTS'),
    ('', '04 SUPPLIERS', '04 SUPPLIERS', '04_SUPPLIERS'),
    ('', '05 PROJECTS', '05 PROJECTS', '05_PROJECTS'),
    ('', '06 PROCUREMENT', '06 PROCUREMENT', '06_PROCUREMENT'),
    ('', '07 PAYROLL', '07 PAYROLL', '07_PAYROLL'),
    ('', '08 TAX', '08 TAX', '08_TAX'),
    ('', '09 ASSETS', '09 ASSETS', '09_ASSETS'),
    ('', '10 PLANT & EQUIPMENT', '10 PLANT & EQUIPMENT', '10_PLANT_EQUIPMENT'),
    ('', '11 LOANS & LIABILITIES', '11 LOANS & LIABILITIES', '11_LOANS_LIABILITIES'),
    ('', '12 DIRECTORS', '12 DIRECTORS', '12_DIRECTORS'),
    ('', '13 QUICKBOOKS', '13 QUICKBOOKS', '13_QUICKBOOKS'),
    ('', '14 CONTRACTS', '14 CONTRACTS', '14_CONTRACTS'),
    ('', '15 RECONCILIATIONS', '15 RECONCILIATIONS', '15_RECONCILIATIONS'),
    ('', '16 MANAGEMENT ACCOUNTS', '16 MANAGEMENT ACCOUNTS', '16_MANAGEMENT_ACCOUNTS'),
    ('', '17 AUDIT', '17 AUDIT', '17_AUDIT'),
    ('', '18 BANKABILITY', '18 BANKABILITY', '18_BANKABILITY')
) AS f(parent_path, folder_name, folder_path, section_code)
WHERE o.is_deleted = false
ON CONFLICT (organization_id, folder_path) DO NOTHING;
