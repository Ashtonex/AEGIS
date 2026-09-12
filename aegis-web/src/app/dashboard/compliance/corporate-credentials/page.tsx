"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, BadgeCheck, Loader2, Plus, ShieldAlert, X } from "lucide-react";
import { RBACGuard } from "@/components/auth/RBACGuard";
import {
  getCorporateCredentials,
  createCorporateCredential,
  updateCorporateCredential,
  deleteCorporateCredential,
  describeActionError,
} from "@/lib/api";

type RecordData = Record<string, any>;

// Mirrors migrations/198_corporate_credentials_vault.sql credential_type CHECK.
const CREDENTIAL_TYPE_GROUPS: { label: string; types: { value: string; label: string }[] }[] = [
  {
    label: "Corporate & Legal",
    types: [
      { value: "certificate_of_incorporation", label: "Certificate of Incorporation" },
      { value: "cr6", label: "CR6" },
      { value: "cr14", label: "CR14 / Current Company Particulars" },
      { value: "cr5", label: "CR5" },
      { value: "company_constitution", label: "Company Constitution" },
      { value: "company_profile", label: "Company Profile" },
      { value: "registered_address", label: "Registered Address" },
      { value: "director_particulars", label: "Director Particulars" },
      { value: "signing_authority", label: "Signing Authority" },
      { value: "power_of_attorney", label: "Power of Attorney" },
    ],
  },
  {
    label: "PRAZ",
    types: [
      { value: "praz_registration", label: "PRAZ Registration" },
      { value: "praz_supplier_category", label: "PRAZ Supplier Category" },
      { value: "praz_contractor_category", label: "PRAZ Contractor Category" },
    ],
  },
  {
    label: "ZIMRA / Tax",
    types: [
      { value: "zimra_tax_clearance", label: "ZIMRA Tax Clearance / ITF263" },
      { value: "vat_registration", label: "VAT Registration" },
      { value: "other_tax_evidence", label: "Other Tax Evidence" },
    ],
  },
  { label: "NSSA", types: [{ value: "nssa_compliance", label: "NSSA Compliance Certificate" }] },
  {
    label: "Construction Registration",
    types: [
      { value: "cifoz_registration", label: "CIFOZ Registration" },
      { value: "cifoz_category", label: "CIFOZ Category" },
      { value: "cifoz_classification", label: "CIFOZ Classification / Grade" },
      { value: "zbca_registration", label: "ZBCA Registration" },
      { value: "zbca_category", label: "ZBCA Category" },
      { value: "zbca_classification", label: "ZBCA Classification / Grade" },
      { value: "other_construction_registration", label: "Other Construction Registration" },
      { value: "engineering_registration", label: "Engineering / Professional Registration" },
      { value: "local_authority_registration", label: "Local Authority Registration" },
      { value: "specialist_contractor_registration", label: "Specialist Contractor Registration" },
    ],
  },
  {
    label: "Insurance",
    types: [
      { value: "insurance_public_liability", label: "Public Liability Insurance" },
      { value: "insurance_contractors_all_risks", label: "Contractors All Risks Insurance" },
      { value: "insurance_workers_liability", label: "Workers / Employer Liability Insurance" },
      { value: "insurance_motor", label: "Motor Insurance" },
      { value: "insurance_plant", label: "Plant Insurance" },
      { value: "insurance_professional_indemnity", label: "Professional Indemnity Insurance" },
      { value: "insurance_other", label: "Other Insurance" },
    ],
  },
  {
    label: "HSE / Policy",
    types: [
      { value: "hse_policy", label: "HSE Policy" },
      { value: "environmental_policy", label: "Environmental Policy" },
      { value: "quality_policy", label: "Quality Policy" },
      { value: "risk_management_policy", label: "Risk Management Policy" },
    ],
  },
  {
    label: "Financial",
    types: [
      { value: "audited_financial_statements", label: "Audited Financial Statements" },
      { value: "management_accounts", label: "Management Accounts" },
      { value: "bank_statements", label: "Bank Statements" },
      { value: "bank_reference_letter", label: "Bank Reference Letter" },
      { value: "facility_letter", label: "Facility Letter" },
      { value: "turnover_evidence", label: "Turnover Evidence" },
    ],
  },
  {
    label: "Technical",
    types: [
      { value: "plant_register", label: "Plant Register" },
      { value: "equipment_ownership_records", label: "Equipment Ownership Records" },
      { value: "hire_agreements", label: "Hire Agreements" },
      { value: "personnel_cvs", label: "Personnel CVs" },
      { value: "professional_qualifications", label: "Professional Qualifications" },
      { value: "project_references", label: "Project References" },
      { value: "completion_certificates", label: "Completion Certificates" },
      { value: "award_letters", label: "Award Letters" },
    ],
  },
];

const CREDENTIAL_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  CREDENTIAL_TYPE_GROUPS.flatMap((group) => group.types.map((t) => [t.value, t.label]))
);

const STATUS_OPTIONS = ["valid", "expiring", "expired", "pending_verification", "unverified", "not_applicable"];

function statusClass(status: string) {
  switch (status) {
    case "valid":
      return "border-emerald-500/30 bg-emerald-950/20 text-emerald-300";
    case "expiring":
      return "border-amber-500/30 bg-amber-950/20 text-amber-300";
    case "expired":
      return "border-red-500/30 bg-red-950/20 text-red-300";
    case "not_applicable":
      return "border-slate-500/30 bg-slate-950/20 text-slate-300";
    default:
      return "border-blue-500/30 bg-blue-950/20 text-blue-300";
  }
}

function statusLabel(status: string) {
  return status.replaceAll("_", " ");
}

function dateValue(value: unknown) {
  if (!value) return "Not recorded";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat("en-ZW", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

const EMPTY_FORM = {
  credential_type: "",
  issuing_organisation: "",
  registration_number: "",
  category: "",
  classification_grade: "",
  issue_date: "",
  expiry_date: "",
  status: "unverified",
  notes: "",
};

export default function CorporateCredentialsVaultPage() {
  return (
    <RBACGuard allowedRoles={["Executive (Admin)", "Managing Director", "Compliance Officer", "Tender / Bid Manager", "Commercial Manager"]}>
      <CorporateCredentialsVault />
    </RBACGuard>
  );
}

function CorporateCredentialsVault() {
  const [credentials, setCredentials] = useState<RecordData[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<string>("");
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getCorporateCredentials(statusFilter ? { status: statusFilter } : undefined);
      setCredentials(res.data || []);
    } catch (err) {
      setError(describeActionError(err, "You do not have permission to view the corporate credentials vault.", "Failed to load the corporate credentials vault."));
    } finally {
      setLoading(false);
      setHasLoadedOnce(true);
    }
  }, [statusFilter]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const kpis = useMemo(() => {
    const expired = credentials.filter((c) => c.status === "expired").length;
    const expiring = credentials.filter((c) => c.status === "expiring").length;
    const unverified = credentials.filter((c) => c.status === "unverified" || c.status === "pending_verification").length;
    return { total: credentials.length, expired, expiring, unverified };
  }, [credentials]);

  const grouped = useMemo(() => {
    const byCategory = new Map<string, RecordData[]>();
    for (const credential of credentials) {
      const key = credential.category || CREDENTIAL_TYPE_LABELS[credential.credential_type] || "Uncategorised";
      if (!byCategory.has(key)) byCategory.set(key, []);
      byCategory.get(key)!.push(credential);
    }
    return Array.from(byCategory.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [credentials]);

  function openCreateModal() {
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
    setShowModal(true);
  }

  function openEditModal(credential: RecordData) {
    setEditingId(credential.id);
    setForm({
      credential_type: credential.credential_type || "",
      issuing_organisation: credential.issuing_organisation || "",
      registration_number: credential.registration_number || "",
      category: credential.category || "",
      classification_grade: credential.classification_grade || "",
      issue_date: credential.issue_date ? String(credential.issue_date).slice(0, 10) : "",
      expiry_date: credential.expiry_date ? String(credential.expiry_date).slice(0, 10) : "",
      status: credential.status || "unverified",
      notes: credential.notes || "",
    });
    setShowModal(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.credential_type) return;
    const payload = {
      ...form,
      issue_date: form.issue_date || null,
      expiry_date: form.expiry_date || null,
    };
    try {
      if (editingId) {
        await updateCorporateCredential(editingId, payload);
        setNotice("Credential updated.");
      } else {
        await createCorporateCredential(payload);
        setNotice("Credential added to the vault.");
      }
      setShowModal(false);
      await loadData();
    } catch (err) {
      setNotice(describeActionError(err, "You do not have permission to manage the credentials vault.", "Failed to save this credential."));
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteCorporateCredential(id);
      setNotice("Credential removed.");
      await loadData();
    } catch (err) {
      setNotice(describeActionError(err, "You do not have permission to remove credentials.", "Failed to remove this credential."));
    }
  }

  if (loading && !hasLoadedOnce) {
    return (
      <div className="flex h-96 items-center justify-center bg-ink">
        <Loader2 className="h-8 w-8 animate-spin text-signal" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {notice && (
        <div className="bg-ink-light border border-signal/20 px-4 py-3 rounded flex items-center justify-between text-paper text-sm">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-slate hover:text-paper">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      {error && (
        <div className="flex items-start gap-2 rounded border border-red-500/40 bg-red-950/20 px-4 py-3 text-sm text-red-100">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
          <p>{error}</p>
        </div>
      )}

      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-semibold text-paper tracking-tight font-display">Corporate Credentials Vault</h1>
          <p className="text-sm text-slate-light font-sans mt-0.5">
            SNC&apos;s permanent registrations, certifications, insurance and financial evidence. Tenders read from here instead of re-collecting the same evidence per tender.
          </p>
        </div>
        <button
          onClick={openCreateModal}
          className="flex items-center space-x-2 bg-signal text-ink font-semibold px-4 py-2 rounded-sm text-sm hover:bg-signal/95 transition-colors"
        >
          <Plus className="h-4 w-4" />
          <span>Add Credential</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-ink-light border border-ink-mid p-4 rounded-lg">
          <p className="text-[10px] uppercase font-mono tracking-widest text-slate">Total Credentials</p>
          <p className="text-xl font-semibold text-paper tracking-tight mt-1">{kpis.total}</p>
        </div>
        <div className="bg-ink-light border border-ink-mid p-4 rounded-lg">
          <p className="text-[10px] uppercase font-mono tracking-widest text-slate">Expiring (30d)</p>
          <p className="text-xl font-semibold text-amber-500 tracking-tight mt-1">{kpis.expiring}</p>
        </div>
        <div className="bg-ink-light border border-ink-mid p-4 rounded-lg">
          <p className="text-[10px] uppercase font-mono tracking-widest text-slate">Expired</p>
          <p className="text-xl font-semibold text-red-500 tracking-tight mt-1">{kpis.expired}</p>
        </div>
        <div className="bg-ink-light border border-ink-mid p-4 rounded-lg">
          <p className="text-[10px] uppercase font-mono tracking-widest text-slate">Unverified</p>
          <p className="text-xl font-semibold text-blue-400 tracking-tight mt-1">{kpis.unverified}</p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase font-mono tracking-widest text-slate">Filter status</span>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-ink border border-ink-mid rounded px-3 py-1.5 text-xs text-paper focus:outline-none focus:border-signal/50"
        >
          <option value="">All</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>{statusLabel(s)}</option>
          ))}
        </select>
      </div>

      <div className="bg-ink-light border border-ink-mid rounded-lg overflow-hidden">
        {credentials.length === 0 ? (
          <div className="p-8 text-center text-slate text-sm">No verified data available. Add the company&apos;s first credential to start the vault.</div>
        ) : (
          grouped.map(([category, items]) => (
            <div key={category} className="border-b border-ink-mid last:border-b-0">
              <div className="px-4 py-2 bg-ink/40 text-[10px] uppercase font-mono tracking-widest text-slate">{category}</div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-ink-mid text-slate font-mono text-[11px] uppercase tracking-wider">
                      <th className="p-3">Credential</th>
                      <th className="p-3">Issuing Organisation</th>
                      <th className="p-3">Registration No.</th>
                      <th className="p-3">Classification</th>
                      <th className="p-3">Expiry</th>
                      <th className="p-3">Status</th>
                      <th className="p-3">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-mid">
                    {items.map((credential) => (
                      <tr key={credential.id} className="hover:bg-ink-mid/10">
                        <td className="p-3 font-semibold text-paper">
                          {CREDENTIAL_TYPE_LABELS[credential.credential_type] || credential.credential_type}
                        </td>
                        <td className="p-3 text-slate-light">{credential.issuing_organisation || "—"}</td>
                        <td className="p-3 font-mono text-slate-light">{credential.registration_number || "—"}</td>
                        <td className="p-3 text-slate-light">{credential.classification_grade || "—"}</td>
                        <td className="p-3 text-slate-light">{dateValue(credential.expiry_date)}</td>
                        <td className="p-3">
                          <span className={`px-2 py-0.5 rounded-sm text-[10px] uppercase font-mono tracking-wider border inline-flex items-center gap-1 ${statusClass(credential.status)}`}>
                            {credential.status === "valid" && <BadgeCheck className="h-3 w-3" />}
                            {(credential.status === "expired" || credential.status === "expiring") && <AlertTriangle className="h-3 w-3" />}
                            {statusLabel(credential.status)}
                          </span>
                        </td>
                        <td className="p-3 flex items-center gap-3">
                          <button onClick={() => openEditModal(credential)} className="text-xs font-semibold text-signal hover:text-signal/80">Edit</button>
                          <button onClick={() => handleDelete(credential.id)} className="text-xs font-semibold text-red-300 hover:text-red-200">Remove</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 backdrop-blur-sm">
          <div className="bg-ink-light border border-ink-mid w-full max-w-lg p-6 rounded-lg space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-ink-mid pb-3">
              <span className="text-base font-semibold text-paper">{editingId ? "Edit Credential" : "Add Credential"}</span>
              <button onClick={() => setShowModal(false)} className="text-slate hover:text-paper">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-mono uppercase text-slate mb-1">Credential Type</label>
                <select
                  required
                  value={form.credential_type}
                  onChange={(e) => setForm({ ...form, credential_type: e.target.value })}
                  className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                >
                  <option value="">Select credential type...</option>
                  {CREDENTIAL_TYPE_GROUPS.map((group) => (
                    <optgroup key={group.label} label={group.label}>
                      {group.types.map((t) => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-mono uppercase text-slate mb-1">Issuing Organisation</label>
                  <input
                    type="text"
                    value={form.issuing_organisation}
                    onChange={(e) => setForm({ ...form, issuing_organisation: e.target.value })}
                    className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                  />
                </div>
                <div>
                  <label className="block text-xs font-mono uppercase text-slate mb-1">Registration Number</label>
                  <input
                    type="text"
                    value={form.registration_number}
                    onChange={(e) => setForm({ ...form, registration_number: e.target.value })}
                    className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-mono uppercase text-slate mb-1">Category</label>
                  <input
                    type="text"
                    placeholder="e.g. Civil Engineering"
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                    className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                  />
                </div>
                <div>
                  <label className="block text-xs font-mono uppercase text-slate mb-1">Classification / Grade</label>
                  <input
                    type="text"
                    placeholder="e.g. Grade 3"
                    value={form.classification_grade}
                    onChange={(e) => setForm({ ...form, classification_grade: e.target.value })}
                    className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-mono uppercase text-slate mb-1">Issue Date</label>
                  <input
                    type="date"
                    value={form.issue_date}
                    onChange={(e) => setForm({ ...form, issue_date: e.target.value })}
                    className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                  />
                </div>
                <div>
                  <label className="block text-xs font-mono uppercase text-slate mb-1">Expiry Date</label>
                  <input
                    type="date"
                    value={form.expiry_date}
                    onChange={(e) => setForm({ ...form, expiry_date: e.target.value })}
                    className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-mono uppercase text-slate mb-1">Verification Status</label>
                <select
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                  className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>{statusLabel(s)}</option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-slate">Valid/Expiring/Expired are recomputed automatically from the expiry date once set - this only matters for pending_verification/unverified/not_applicable.</p>
              </div>
              <div>
                <label className="block text-xs font-mono uppercase text-slate mb-1">Notes</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50 h-20"
                />
              </div>
              <div className="flex justify-end space-x-3 pt-3 border-t border-ink-mid">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 border border-ink-mid text-paper rounded text-sm hover:bg-ink-mid/30">
                  Cancel
                </button>
                <button type="submit" className="px-4 py-2 bg-signal text-ink font-semibold rounded text-sm hover:bg-signal/95">
                  {editingId ? "Save Changes" : "Add Credential"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
