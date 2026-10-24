"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, ClipboardList, FileText, Loader2, Plus, Send, ShieldAlert, ShieldCheck, Star, X } from "lucide-react";
import { createDocument, createSupplierRecord, decideSupplierComplianceDocument, getSupplierComplianceDocuments, getSupplierComplianceDocumentSignedUrl, getProcurementInvoices, getProcurementOrders, getProcurementRfqs, getSupplierCatalogue, issueSupplierPortalLogin, recordSupplierComplianceDocument, updateSupplierRecord, type SupplierComplianceDocumentStatus, type SupplierComplianceDocumentType, type VendorDocument } from "@/lib/api";
import { PortalDocumentUpload, type UploadedDocumentResult } from "@/components/portal/PortalDocumentUpload";
import { Banner, EmptyState, LoadingState, type Rec, dt, money, normalizeActionError, num, pct, supplierStatusClass, tx } from "@/components/procurement/shared";


// ─── Suppliers Table ──────────────────────────────────────────────────────────

export function SuppliersTable({ rows, onView }: { rows: Rec[]; onView: (row: Rec) => void; }) {
  if (rows.length === 0) return <EmptyState label="No suppliers registered." sub="Use New Supplier above to register one, or wait for supplier portal self-registrations." />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[960px] text-sm">
        <thead>
          <tr className="border-b border-ink-mid bg-ink-light/50 text-left">
            {["Supplier Name", "Code", "Status", "PRAZ Number", "Performance", "On-Time %", "Open POs", "Outstanding Balance"].map((h) => (
              <th key={h} className="px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-slate">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-mid">
          {rows.map((row) => {
            const score = num(row.performance_score ?? row.rating ?? 0);
            const stars = Math.round(Math.min(score, 5));
            const otd = num(row.on_time_delivery_pct);
            return (
              <tr key={row.id} onClick={() => onView(row)} className="cursor-pointer hover:bg-ink-light/40" title="Open Supplier 360">
                <td className="px-4 py-3 font-semibold text-paper">{tx(row.name ?? row.supplier_name)}</td>
                <td className="px-4 py-3 font-mono text-xs text-slate-light">{tx(row.code ?? row.supplier_code)}</td>
                <td className="px-4 py-3"><span className={`border px-2 py-0.5 font-mono text-[10px] uppercase ${supplierStatusClass(row.status)}`}>{tx(row.status, "active")}</span></td>
                <td className="px-4 py-3 font-mono text-xs text-slate-light">{tx(row.praz_number ?? row.registration_number)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-0.5">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Star key={i} className={`h-3 w-3 ${i < stars ? "fill-signal text-signal" : "text-slate"}`} />
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className={`font-mono text-xs ${row.on_time_delivery_pct != null ? (otd >= 90 ? "text-emerald-300" : otd >= 70 ? "text-amber-300" : "text-red-300") : "text-slate"}`}>
                    {row.on_time_delivery_pct != null ? pct(otd) : "—"}
                  </span>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-paper">{num(row.outstanding_pos ?? 0)}</td>
                <td className="px-4 py-3 font-mono text-xs text-paper">{money(row.outstanding_balance ?? 0)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}


export const SUPPLIER_STATUSES = ["active", "pending_approval", "suspended", "blacklisted"] as const;

export const SUPPLIER_COMPLIANCE_STATUSES = ["pending", "compliant", "non_compliant", "exempt"] as const;

export type SupplierModalTab = "overview" | "documents" | "dealings";


// Tax clearance, company registration and VAT (unless not VAT registered)
// are required for verification; NSSA and PRAZ are optional.
export const SUPPLIER_REQUIRED_DOCUMENTS: Array<{ key: SupplierComplianceDocumentType; label: string; optional?: boolean }> = [
  { key: "tax_clearance", label: "Tax Clearance" },
  { key: "company_registration", label: "Company Registration" },
  { key: "vat", label: "VAT" },
  { key: "nssa", label: "NSSA", optional: true },
  { key: "praz", label: "PRAZ", optional: true },
];


export const VAT_STATUS_OPTIONS = [
  { value: "", label: "Not answered" },
  { value: "registered", label: "VAT registered" },
  { value: "not_registered", label: "Not VAT registered" },
] as const;


export function VatStatusSelect({ value, onChange, className }: { value: string; onChange: (value: string) => void; className: string }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={className}>
      {VAT_STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  );
}


export function vatPayload(vatStatus: string, vatNumber: string) {
  return {
    vat_status: vatStatus || null,
    vat_registration_number: vatStatus === "registered" ? vatNumber.trim() || null : null,
  };
}


export function supplierEditDraft(supplier: Rec) {
  return {
    supplier_name: tx(supplier.supplier_name ?? supplier.name, ""),
    supplier_code: tx(supplier.supplier_code ?? supplier.code, ""),
    trading_name: tx(supplier.trading_name, ""),
    registration_number: tx(supplier.registration_number, ""),
    tax_number: tx(supplier.tax_number, ""),
    vat_status: tx(supplier.vat_status, ""),
    vat_registration_number: tx(supplier.vat_registration_number, ""),
    praz_number: tx(supplier.praz_number, ""),
    nssa_number: tx(supplier.nssa_number, ""),
    address: tx(supplier.address, ""),
    primary_contact_name: tx(supplier.primary_contact_name, ""),
    primary_contact_email: tx(supplier.primary_contact_email, ""),
    primary_contact_phone: tx(supplier.primary_contact_phone, ""),
    payment_terms_days: String(supplier.payment_terms_days ?? 30),
    currency: tx(supplier.currency, "USD"),
    status: tx(supplier.status, "pending_approval"),
    compliance_status: tx(supplier.compliance_status, "pending"),
    performance_score: supplier.performance_score == null ? "" : String(supplier.performance_score),
    on_time_delivery_pct: supplier.on_time_delivery_pct == null ? "" : String(supplier.on_time_delivery_pct),
  };
}


export function Supplier360Modal({
  supplier,
  onClose,
  onSaved,
  onCredentials,
}: {
  supplier: Rec;
  onClose: () => void;
  onSaved: (supplier: Rec) => void;
  onCredentials: (credentials: { email: string; temporary_password: string }) => void;
}) {
  const [items, setItems] = useState<Rec[]>([]);
  const [orders, setOrders] = useState<Rec[]>([]);
  const [invoices, setInvoices] = useState<Rec[]>([]);
  const [quotes, setQuotes] = useState<Rec[]>([]);
  const [form, setForm] = useState(() => supplierEditDraft(supplier));
  const [activeTab, setActiveTab] = useState<SupplierModalTab>("overview");
  const [loading, setLoading] = useState(true);
  const [dealingsLoading, setDealingsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [issuingLogin, setIssuingLogin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dealingsError, setDealingsError] = useState<string | null>(null);
  const [copiedPortalCard, setCopiedPortalCard] = useState(false);
  const portalUrl = typeof window !== "undefined" ? `${window.location.origin}/portal/supplier` : "/portal/supplier";

  useEffect(() => {
    let cancelled = false;
    setForm(supplierEditDraft(supplier));
    setLoading(true);
    setDealingsLoading(true);
    setError(null);
    setDealingsError(null);
    getSupplierCatalogue(supplier.id)
      .then((res) => {
        if (cancelled) return;
        if (res.success && Array.isArray(res.data)) setItems(res.data);
        else setError("Catalogue could not be loaded.");
      })
      .catch(() => { if (!cancelled) setError("Catalogue could not be loaded."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    Promise.allSettled([
      getProcurementOrders({ supplier_id: supplier.id }),
      getProcurementInvoices(),
      getProcurementRfqs(),
    ])
      .then(([ordersRes, invoicesRes, rfqsRes]) => {
        if (cancelled) return;
        if (ordersRes.status === "fulfilled" && Array.isArray(ordersRes.value.data)) setOrders(ordersRes.value.data);
        else setDealingsError("Some supplier dealings could not be loaded.");

        if (invoicesRes.status === "fulfilled" && Array.isArray(invoicesRes.value.data)) {
          setInvoices(invoicesRes.value.data.filter((invoice) => invoice.supplier_id === supplier.id || tx(invoice.supplier_name, "").toLowerCase() === tx(supplier.supplier_name ?? supplier.name, "").toLowerCase()));
        } else {
          setDealingsError("Some supplier dealings could not be loaded.");
        }

        if (rfqsRes.status === "fulfilled" && Array.isArray(rfqsRes.value.data)) {
          const supplierQuotes = rfqsRes.value.data.flatMap((rfq) => {
            const responses = Array.isArray(rfq.responses) ? rfq.responses : [];
            return responses
              .filter((response: Rec) => response.supplier_id === supplier.id || tx(response.supplier_name, "").toLowerCase() === tx(supplier.supplier_name ?? supplier.name, "").toLowerCase())
              .map((response: Rec) => ({
                ...response,
                rfq_number: rfq.rfq_number,
                rfq_title: rfq.title,
                closing_date: rfq.closing_date,
              }));
          });
          setQuotes(supplierQuotes);
        } else {
          setDealingsError("Some supplier dealings could not be loaded.");
        }
      })
      .catch(() => { if (!cancelled) setDealingsError("Supplier dealings could not be loaded."); })
      .finally(() => { if (!cancelled) setDealingsLoading(false); });
    return () => { cancelled = true; };
  }, [supplier]);

  const updateField = (field: keyof ReturnType<typeof supplierEditDraft>, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const save = async () => {
    if (!form.supplier_name.trim()) { setError("Registered company name is required."); return; }
    const score = form.performance_score === "" ? null : Number(form.performance_score);
    if (score != null && !(score >= 0 && score <= 5)) { setError("Performance score is a 0-5 rating (shown as stars). Enter a value between 0 and 5."); return; }
    const otd = form.on_time_delivery_pct === "" ? null : Number(form.on_time_delivery_pct);
    if (otd != null && !(otd >= 0 && otd <= 100)) { setError("On-time delivery % must be between 0 and 100."); return; }
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        supplier_name: form.supplier_name.trim(),
        supplier_code: form.supplier_code.trim() || null,
        trading_name: form.trading_name.trim() || null,
        registration_number: form.registration_number.trim() || null,
        tax_number: form.tax_number.trim() || null,
        ...vatPayload(form.vat_status, form.vat_registration_number),
        praz_number: form.praz_number.trim() || null,
        nssa_number: form.nssa_number.trim() || null,
        address: form.address.trim() || null,
        primary_contact_name: form.primary_contact_name.trim() || null,
        primary_contact_email: form.primary_contact_email.trim() || null,
        primary_contact_phone: form.primary_contact_phone.trim() || null,
        payment_terms_days: Number(form.payment_terms_days || 30),
        currency: form.currency.trim() || "USD",
        status: form.status,
        compliance_status: form.compliance_status,
        performance_score: form.performance_score === "" ? null : Number(form.performance_score),
        on_time_delivery_pct: form.on_time_delivery_pct === "" ? null : Number(form.on_time_delivery_pct),
      };
      await updateSupplierRecord(supplier.id, payload);
      onSaved({ ...supplier, ...payload });
    } catch (e) {
      setError(normalizeActionError(e, "Supplier could not be updated."));
    } finally {
      setSaving(false);
    }
  };

  const issueLogin = async () => {
    if (!form.primary_contact_email.trim()) {
      setError("Add and save a primary contact email before issuing login details.");
      return;
    }
    setIssuingLogin(true);
    setError(null);
    try {
      const res = await issueSupplierPortalLogin(supplier.id);
      if (!res.success || !res.data?.temporary_password) throw new Error("No password returned.");
      onCredentials({ email: res.data.email, temporary_password: res.data.temporary_password });
    } catch (e) {
      setError(normalizeActionError(e, "Supplier portal login could not be issued."));
    } finally {
      setIssuingLogin(false);
    }
  };

  const copyPortalCard = async () => {
    const card = [
      `Supplier portal: ${portalUrl}`,
      `Supplier: ${form.supplier_name}`,
      `Email: ${form.primary_contact_email || "Add contact email first"}`,
    ].join("\n");
    try {
      await navigator.clipboard.writeText(card);
      setCopiedPortalCard(true);
      window.setTimeout(() => setCopiedPortalCard(false), 1800);
    } catch {
      setError("Could not copy portal details.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="w-full max-w-6xl border border-ink-mid bg-ink shadow-2xl">
        <header className="flex items-center justify-between border-b border-ink-mid p-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-signal">Supplier 360</p>
            <h2 className="mt-1 text-lg font-semibold text-paper">{tx(form.supplier_name)}</h2>
            <p className="mt-1 text-xs text-slate-light">Profile, compliance status, portal access and receipt-backed catalogue in one place.</p>
          </div>
          <button onClick={onClose} className="border border-ink-mid p-2 text-slate-light hover:border-signal hover:text-paper"><X className="h-5 w-5" /></button>
        </header>
        <div className="flex border-b border-ink-mid bg-ink-light/40">
          {([
            ["overview", "360 view"],
            ["documents", "Documents"],
            ["dealings", "Business dealings"],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`h-11 border-r border-ink-mid px-4 font-mono text-[10px] font-bold uppercase tracking-wider ${activeTab === id ? "bg-signal text-ink" : "text-slate-light hover:bg-ink-light hover:text-paper"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="max-h-[76vh] overflow-y-auto p-4">
          {error && <div className="mb-4"><Banner tone="error" message={error} /></div>}
          {activeTab === "overview" ? (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]">
            <section className="space-y-4">
              <div className="border border-ink-mid bg-ink-light/40 p-4">
                <div className="mb-3 flex items-center justify-between gap-3 border-b border-ink-mid pb-3">
                  <h3 className="font-mono text-xs font-bold uppercase tracking-widest text-paper">Company and compliance</h3>
                  <span className={`border px-2 py-0.5 font-mono text-[10px] uppercase ${supplierStatusClass(form.status)}`}>{form.status}</span>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <SupplierField label="Registered company name" value={form.supplier_name} onChange={(v) => updateField("supplier_name", v)} required />
                  <SupplierField label="Company registration number" value={form.registration_number} onChange={(v) => updateField("registration_number", v)} required />
                  <SupplierField label="Tax clearance number" value={form.tax_number} onChange={(v) => updateField("tax_number", v)} required />
                  <label className="block">
                    <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate">VAT registration *</span>
                    <VatStatusSelect value={form.vat_status} onChange={(v) => updateField("vat_status", v)} className="h-10 w-full border border-ink-mid bg-ink px-3 text-sm text-paper outline-none focus:border-signal" />
                  </label>
                  {form.vat_status === "registered" && (
                    <SupplierField label="VAT number" value={form.vat_registration_number} onChange={(v) => updateField("vat_registration_number", v)} required />
                  )}
                  <SupplierField label="Supplier code" value={form.supplier_code} onChange={(v) => updateField("supplier_code", v)} />
                  <SupplierField label="Trading name" value={form.trading_name} onChange={(v) => updateField("trading_name", v)} />
                  <SupplierField label="PRAZ number (optional)" value={form.praz_number} onChange={(v) => updateField("praz_number", v)} />
                  <SupplierField label="NSSA number (optional)" value={form.nssa_number} onChange={(v) => updateField("nssa_number", v)} />
                  <SupplierField label="Address" value={form.address} onChange={(v) => updateField("address", v)} />
                  <SupplierField label="Currency" value={form.currency} onChange={(v) => updateField("currency", v.toUpperCase().slice(0, 3))} />
                  <SupplierSelect label="Supplier status" value={form.status} options={SUPPLIER_STATUSES} onChange={(v) => updateField("status", v)} />
                  <SupplierSelect label="Compliance status" value={form.compliance_status} options={SUPPLIER_COMPLIANCE_STATUSES} onChange={(v) => updateField("compliance_status", v)} />
                  <SupplierField label="Payment terms days" type="number" value={form.payment_terms_days} onChange={(v) => updateField("payment_terms_days", v)} />
                  <SupplierField label="Performance score (0-5)" type="number" min={0} max={5} step="0.1" value={form.performance_score} onChange={(v) => updateField("performance_score", v)} />
                  <SupplierField label="On-time delivery % (0-100)" type="number" min={0} max={100} step="0.1" value={form.on_time_delivery_pct} onChange={(v) => updateField("on_time_delivery_pct", v)} />
                </div>
              </div>

              <div className="border border-ink-mid bg-ink-light/40 p-4">
                <h3 className="mb-3 border-b border-ink-mid pb-3 font-mono text-xs font-bold uppercase tracking-widest text-paper">Primary contact</h3>
                <div className="grid gap-3 md:grid-cols-2">
                  <SupplierField label="Contact name" value={form.primary_contact_name} onChange={(v) => updateField("primary_contact_name", v)} />
                  <SupplierField label="Contact phone" value={form.primary_contact_phone} onChange={(v) => updateField("primary_contact_phone", v)} />
                  <div className="md:col-span-2">
                    <SupplierField label="Contact email" type="email" value={form.primary_contact_email} onChange={(v) => updateField("primary_contact_email", v)} />
                  </div>
                </div>
              </div>
            </section>

            <section className="space-y-4">
              <div className="border border-signal/30 bg-signal/5 p-4">
                <h3 className="font-mono text-xs font-bold uppercase tracking-widest text-paper">Supplier portal access</h3>
                <p className="mt-2 text-xs leading-relaxed text-slate-light">Issue or reset login details for the supplier contact. The password is shown once so it can be copied and shared directly.</p>
                <div className="mt-3 space-y-2 border border-ink-mid bg-ink p-3">
                  <p className="font-mono text-[10px] uppercase tracking-widest text-slate">Portal link</p>
                  <p className="break-all font-mono text-xs text-paper">{portalUrl}</p>
                  <p className="font-mono text-[10px] uppercase tracking-widest text-slate">Login email</p>
                  <p className="break-all font-mono text-xs text-paper">{form.primary_contact_email || "Add contact email first"}</p>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button onClick={() => void copyPortalCard()} className="inline-flex h-9 items-center gap-2 border border-ink-mid px-3 font-mono text-[10px] uppercase text-slate-light hover:border-signal hover:text-paper">
                    <ClipboardList className="h-3.5 w-3.5" />{copiedPortalCard ? "Copied" : "Copy details"}
                  </button>
                  <button onClick={() => void issueLogin()} disabled={issuingLogin || !form.primary_contact_email.trim()} className="inline-flex h-9 items-center gap-2 bg-signal px-3 font-mono text-[10px] font-bold uppercase text-ink disabled:opacity-50">
                    {issuingLogin ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}Issue login
                  </button>
                </div>
              </div>
            </section>
          </div>
          ) : activeTab === "documents" ? (
            <SupplierComplianceDocumentsPanel supplier={supplier} />
          ) : (
            <SupplierBusinessDealings
              items={items}
              loading={loading || dealingsLoading}
              error={dealingsError}
              orders={orders}
              invoices={invoices}
              quotes={quotes}
            />
          )}
        </div>
        <footer className="flex justify-end gap-3 border-t border-ink-mid p-4">
          <button onClick={onClose} className="h-10 border border-ink-mid px-4 font-mono text-xs uppercase text-slate-light hover:text-paper">Close</button>
          {activeTab === "overview" && (
            <button onClick={() => void save()} disabled={saving} className="inline-flex h-10 items-center gap-2 bg-signal px-5 font-mono text-xs font-bold uppercase text-ink disabled:opacity-50">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Save supplier
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}


export function supplierDocStatusClass(status: string) {
  const normalized = status.toLowerCase();
  if (normalized === "verified") return "border-emerald-500/30 bg-emerald-950/20 text-emerald-300";
  if (normalized === "rejected") return "border-red-500/30 bg-red-950/20 text-red-300";
  if (normalized === "needs_update") return "border-amber-500/30 bg-amber-950/20 text-amber-300";
  return "border-blue-500/30 bg-blue-950/20 text-blue-300";
}


export function latestSupplierDocs(docs: VendorDocument[]) {
  const latest: Partial<Record<SupplierComplianceDocumentType, VendorDocument>> = {};
  for (const doc of docs) {
    const key = doc.document_type ?? (doc.category as SupplierComplianceDocumentType);
    if (!SUPPLIER_REQUIRED_DOCUMENTS.some((item) => item.key === key)) continue;
    if (!latest[key]) latest[key] = doc;
  }
  return latest;
}


export function SupplierComplianceDocumentsPanel({ supplier }: { supplier: Rec }) {
  const [documents, setDocuments] = useState<VendorDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getSupplierComplianceDocuments(supplier.id);
      setDocuments(res.data ?? []);
    } catch (e) {
      setError(normalizeActionError(e, "Supplier documents could not be loaded."));
    } finally {
      setLoading(false);
    }
  }, [supplier.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const docsByType = useMemo(() => latestSupplierDocs(documents), [documents]);

  async function upload(result: UploadedDocumentResult, documentType: SupplierComplianceDocumentType) {
    setBusyKey(documentType);
    setError(null);
    setNotice(null);
    try {
      const created = await createDocument({
        title: `${SUPPLIER_REQUIRED_DOCUMENTS.find((d) => d.key === documentType)?.label ?? "Supplier document"} - ${tx(supplier.supplier_name ?? supplier.name)}`,
        category: documentType,
        file_name: result.file_name,
        file_size_bytes: result.size_bytes,
        storage_path: result.storage_path,
        mime_type: result.mime_type,
      });
      const documentId = created.data?.id;
      if (!documentId) throw new Error("The document could not be registered.");
      const recorded = await recordSupplierComplianceDocument(supplier.id, { document_id: documentId, document_type: documentType });
      setDocuments(recorded.data ?? []);
      setNotice("Document uploaded and sent for verification.");
    } catch (e) {
      setError(normalizeActionError(e, "Document could not be uploaded."));
    } finally {
      setBusyKey(null);
    }
  }

  async function view(documentId?: string) {
    if (!documentId) return;
    setError(null);
    try {
      const res = await getSupplierComplianceDocumentSignedUrl(supplier.id, documentId);
      if (res.data?.url) window.open(res.data.url, "_blank", "noopener,noreferrer");
    } catch (e) {
      setError(normalizeActionError(e, "Document could not be opened."));
    }
  }

  async function decide(documentId: string, status: SupplierComplianceDocumentStatus) {
    const review_notes = status === "verified" ? undefined : window.prompt("Record the reason or correction needed:") ?? undefined;
    if (status !== "verified" && !review_notes?.trim()) return;
    setBusyKey(documentId);
    setError(null);
    setNotice(null);
    try {
      await decideSupplierComplianceDocument(supplier.id, documentId, { status, review_notes: review_notes?.trim() });
      setNotice(status === "verified" ? "Document verified." : "Document marked for correction.");
      await load();
    } catch (e) {
      setError(normalizeActionError(e, "Document decision could not be saved."));
    } finally {
      setBusyKey(null);
    }
  }

  if (loading) return <LoadingState label="Loading supplier documents..." />;

  return (
    <div className="space-y-4">
      {error && <Banner tone="error" message={error} />}
      {notice && <Banner tone="info" message={notice} />}
      <div className="grid gap-3 md:grid-cols-5">
        <SupplierDealMetric label="Required" value="5" detail="Compliance set" />
        <SupplierDealMetric label="Uploaded" value={String(Object.keys(docsByType).length)} detail="Current files" />
        <SupplierDealMetric label="Verified" value={String(documents.filter((d) => (d.status ?? d.review_status) === "verified").length)} detail="Accepted by staff" />
        <SupplierDealMetric label="Pending" value={String(documents.filter((d) => (d.status ?? d.review_status ?? "pending_review") === "pending_review").length)} detail="Needs review" />
        <SupplierDealMetric label="Corrections" value={String(documents.filter((d) => ["needs_update", "rejected"].includes(d.status ?? d.review_status ?? "")).length)} detail="Supplier action" />
      </div>
      <div className="divide-y divide-ink-mid border border-ink-mid bg-ink-light/40">
        {SUPPLIER_REQUIRED_DOCUMENTS.map((required) => {
          const doc = docsByType[required.key];
          const documentId = doc?.document_id ?? doc?.id;
          const status = doc?.status ?? doc?.review_status ?? "pending_review";
          return (
            <div key={required.key} className="grid gap-4 p-4 lg:grid-cols-[220px_minmax(0,1fr)_auto] lg:items-center">
              <div>
                <p className="font-semibold text-paper">{required.label}</p>
                <p className="mt-1 font-mono text-[10px] uppercase text-slate-light">
                  {required.optional || (required.key === "vat" && supplier.vat_status === "not_registered") ? "Optional supplier document" : "Required supplier document"}
                </p>
              </div>
              <div className="min-w-0">
                {doc ? (
                  <>
                    <p className="truncate text-sm text-paper">{tx(doc.file_name ?? doc.title)}</p>
                    <p className="mt-1 text-xs text-slate-light">
                      Uploaded {dt(doc.created_at)} · {tx(doc.uploaded_by_party, "staff")}
                      {doc.reviewed_by_name ? ` · reviewed by ${doc.reviewed_by_name}` : ""}
                    </p>
                    {doc.review_notes && <p className="mt-1 text-xs text-amber-300">{doc.review_notes}</p>}
                  </>
                ) : (
                  <p className="text-sm text-slate-light">No document uploaded yet.</p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                <span className={`border px-2 py-1 font-mono text-[10px] uppercase ${supplierDocStatusClass(status)}`}>
                  {status.replace("_", " ")}
                </span>
                <PortalDocumentUpload
                  label={doc ? "Replace" : "Upload"}
                  disabled={busyKey === required.key}
                  onUploaded={(result) => upload(result, required.key)}
                />
                {doc && (
                  <>
                    <button onClick={() => void view(documentId)} className="inline-flex h-10 items-center gap-2 border border-ink-mid px-3 font-mono text-[10px] uppercase text-slate-light hover:border-signal hover:text-paper">
                      <FileText className="h-3.5 w-3.5" />View
                    </button>
                    <button onClick={() => void decide(documentId!, "verified")} disabled={busyKey === documentId} className="inline-flex h-10 items-center gap-2 bg-emerald-600 px-3 font-mono text-[10px] uppercase text-white disabled:opacity-50">
                      <ShieldCheck className="h-3.5 w-3.5" />Verify
                    </button>
                    <button onClick={() => void decide(documentId!, "needs_update")} disabled={busyKey === documentId} className="inline-flex h-10 items-center gap-2 border border-amber-500/40 px-3 font-mono text-[10px] uppercase text-amber-300 disabled:opacity-50">
                      <ShieldAlert className="h-3.5 w-3.5" />Needs update
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}


export function SupplierBusinessDealings({
  items,
  loading,
  error,
  orders,
  invoices,
  quotes,
}: {
  items: Rec[];
  loading: boolean;
  error: string | null;
  orders: Rec[];
  invoices: Rec[];
  quotes: Rec[];
}) {
  const poTotal = orders.reduce((sum, row) => sum + num(row.total_amount ?? row.amount ?? 0), 0);
  const invoiceTotal = invoices.reduce((sum, row) => sum + num(row.total_amount ?? row.amount ?? 0), 0);
  const receivedValue = items.reduce((sum, row) => sum + (num(row.total_quantity_received) * num(row.last_unit_cost ?? 0)), 0);
  const selectedQuotes = quotes.filter((row) => tx(row.status, "").toLowerCase() === "selected").length;

  if (loading) return <LoadingState label="Loading supplier dealings..." />;

  return (
    <div className="space-y-4">
      {error && <Banner tone="info" message={error} />}
      <div className="grid gap-3 md:grid-cols-4">
        <SupplierDealMetric label="Purchase orders" value={String(orders.length)} detail={money(poTotal)} />
        <SupplierDealMetric label="Invoices" value={String(invoices.length)} detail={money(invoiceTotal)} />
        <SupplierDealMetric label="Quotes given" value={String(quotes.length)} detail={`${selectedQuotes} selected`} />
        <SupplierDealMetric label="Received catalogue" value={String(items.length)} detail={money(receivedValue)} />
      </div>

      <SupplierDealTable
        title="Purchase orders"
        empty="No purchase orders with this supplier yet."
        headers={["PO", "Project", "Status", "Total", "Issued", "Expected"]}
        rows={orders.map((row) => [
          tx(row.po_number ?? row.reference_number, row.id?.slice(0, 8)),
          tx(row.project_name ?? row.project),
          tx(row.status),
          money(row.total_amount ?? row.amount ?? 0),
          dt(row.issued_at ?? row.created_at),
          dt(row.expected_delivery_date ?? row.required_by_date),
        ])}
      />

      <SupplierDealTable
        title="Supplier invoices"
        empty="No supplier invoices captured for this supplier yet."
        headers={["Invoice", "Supplier ref", "PO", "Date", "Total", "Match", "Status"]}
        rows={invoices.map((row) => [
          tx(row.invoice_number ?? row.reference_number, row.id?.slice(0, 8)),
          tx(row.supplier_invoice_ref ?? row.external_reference),
          tx(row.po_number),
          dt(row.invoice_date ?? row.created_at),
          money(row.total_amount ?? row.amount ?? 0),
          tx(row.match_status ?? row.matching_status),
          tx(row.status),
        ])}
      />

      <SupplierDealTable
        title="Quotes"
        empty="No quotes recorded for this supplier yet."
        headers={["RFQ", "Reference", "Amount", "Delivery", "Score", "Status"]}
        rows={quotes.map((row) => [
          tx(row.rfq_number ?? row.rfq_title),
          tx(row.reference),
          money(row.total_amount ?? 0),
          row.delivery_days ? `${num(row.delivery_days)} days` : "-",
          row.evaluation_score == null ? "-" : String(row.evaluation_score),
          tx(row.status),
        ])}
      />

      <SupplierDealTable
        title="Received materials and tools"
        empty="No stock has been received from this supplier yet."
        headers={["Item", "Category", "Receipts", "Quantity", "Last cost", "Last received"]}
        rows={items.map((row) => [
          `${tx(row.item_code)} - ${tx(row.item_name)}`,
          tx(row.category),
          String(num(row.receipt_count)),
          String(num(row.total_quantity_received)),
          money(row.last_unit_cost ?? 0),
          row.last_received_at ? new Date(row.last_received_at).toLocaleDateString() : "-",
        ])}
      />
    </div>
  );
}


export function SupplierDealMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="border border-ink-mid bg-ink-light/40 p-3">
      <p className="font-mono text-[10px] uppercase tracking-widest text-slate">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-paper">{value}</p>
      <p className="mt-1 font-mono text-xs text-signal">{detail}</p>
    </div>
  );
}


export function SupplierDealTable({ title, empty, headers, rows }: { title: string; empty: string; headers: string[]; rows: string[][] }) {
  return (
    <section className="border border-ink-mid bg-ink-light/40 p-4">
      <h3 className="mb-3 border-b border-ink-mid pb-3 font-mono text-xs font-bold uppercase tracking-widest text-paper">{title}</h3>
      {rows.length === 0 ? (
        <EmptyState label={empty} sub="Activity will appear here once it is recorded in procurement." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-ink-mid bg-ink/60 text-left">
                {headers.map((header) => <th key={header} className="px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-slate">{header}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-mid">
              {rows.map((row, rowIndex) => (
                <tr key={`${title}-${rowIndex}`}>
                  {row.map((cell, cellIndex) => (
                    <td key={`${title}-${rowIndex}-${cellIndex}`} className={`px-3 py-2 ${cellIndex === 0 ? "text-paper" : "text-xs text-slate-light"}`}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}


export function SupplierField({ label, value, onChange, type = "text", required = false, min, max, step }: { label: string; value: string; onChange: (value: string) => void; type?: string; required?: boolean; min?: number; max?: number; step?: string; }) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate">{label}{required ? " *" : ""}</span>
      <input type={type} value={value} min={min} max={max} step={step} onChange={(e) => onChange(e.target.value)} className="h-10 w-full border border-ink-mid bg-ink px-3 text-sm text-paper outline-none focus:border-signal" />
    </label>
  );
}


export function SupplierSelect({ label, value, options, onChange }: { label: string; value: string; options: readonly string[]; onChange: (value: string) => void; }) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="h-10 w-full border border-ink-mid bg-ink px-3 text-sm text-paper outline-none focus:border-signal">
        {options.map((option) => <option key={option} value={option}>{option.replace("_", " ")}</option>)}
      </select>
    </label>
  );
}


export function AddSupplierModal({ onClose, onCreated }: { onClose: () => void; onCreated: (temporaryPassword?: string, email?: string) => void; }) {
  const [form, setForm] = useState({
    supplier_name: "",
    trading_name: "",
    registration_number: "",
    tax_number: "",
    vat_status: "",
    vat_registration_number: "",
    praz_number: "",
    nssa_number: "",
    address: "",
    primary_contact_name: "",
    primary_contact_email: "",
    primary_contact_phone: "",
  });
  const [issuePortalLogin, setIssuePortalLogin] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!form.supplier_name.trim()) { setError("Registered company name is required."); return; }
    if (issuePortalLogin && !form.primary_contact_email.trim()) { setError("A contact email is required to issue a portal login."); return; }
    setSaving(true); setError(null);
    try {
      const payload: Record<string, unknown> = {
        supplier_name: form.supplier_name.trim(),
        trading_name: form.trading_name.trim() || undefined,
        registration_number: form.registration_number.trim() || undefined,
        tax_number: form.tax_number.trim() || undefined,
        ...vatPayload(form.vat_status, form.vat_registration_number),
        praz_number: form.praz_number.trim() || undefined,
        nssa_number: form.nssa_number.trim() || undefined,
        address: form.address.trim() || undefined,
        primary_contact_name: form.primary_contact_name.trim() || undefined,
        primary_contact_email: form.primary_contact_email.trim() || undefined,
        primary_contact_phone: form.primary_contact_phone.trim() || undefined,
        currency: "USD",
        status: "pending_approval",
        compliance_status: "pending",
        issue_portal_login: issuePortalLogin,
      };
      const res = await createSupplierRecord(payload);
      if (!res?.data?.id) throw new Error("Supplier response did not include an id.");
      onCreated(res.data.temporary_password, form.primary_contact_email.trim() || undefined);
    } catch (e) {
      setError(normalizeActionError(e, "Could not create supplier."));
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg border border-ink-mid bg-ink p-5 shadow-2xl">
        <div className="flex items-start justify-between border-b border-ink-mid pb-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-signal">Register Supplier</p>
            <h2 className="mt-1 text-xl font-semibold text-paper">New Supplier</h2>
          </div>
          <button onClick={onClose} className="border border-ink-mid p-2 text-slate-light hover:border-signal hover:text-paper"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-3.5 py-4">
          {error && <Banner tone="error" message={error} />}
          <div>
            <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate">Registered Company Name *</label>
            <input value={form.supplier_name} onChange={(e) => setForm({ ...form, supplier_name: e.target.value })} className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate">Trading Name</label>
              <input value={form.trading_name} onChange={(e) => setForm({ ...form, trading_name: e.target.value })} className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
            </div>
            <div>
              <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate">Company Registration Number *</label>
              <input value={form.registration_number} onChange={(e) => setForm({ ...form, registration_number: e.target.value })} className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
            </div>
            <div>
              <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate">Tax Clearance Number *</label>
              <input value={form.tax_number} onChange={(e) => setForm({ ...form, tax_number: e.target.value })} className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
            </div>
            <div>
              <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate">VAT Registration *</label>
              <VatStatusSelect value={form.vat_status} onChange={(v) => setForm({ ...form, vat_status: v })} className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
            </div>
            {form.vat_status === "registered" && (
              <div>
                <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate">VAT Number *</label>
                <input value={form.vat_registration_number} onChange={(e) => setForm({ ...form, vat_registration_number: e.target.value })} className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
              </div>
            )}
            <div>
              <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate">PRAZ Number (optional)</label>
              <input value={form.praz_number} onChange={(e) => setForm({ ...form, praz_number: e.target.value })} className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
            </div>
            <div>
              <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate">NSSA Number (optional)</label>
              <input value={form.nssa_number} onChange={(e) => setForm({ ...form, nssa_number: e.target.value })} className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate">Address</label>
              <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
            </div>
          </div>
          <div className="border-t border-ink-mid pt-3.5">
            <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-slate">Primary Contact</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate">Name</label>
                <input value={form.primary_contact_name} onChange={(e) => setForm({ ...form, primary_contact_name: e.target.value })} className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
              </div>
              <div>
                <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate">Phone</label>
                <input value={form.primary_contact_phone} onChange={(e) => setForm({ ...form, primary_contact_phone: e.target.value })} className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate">Email</label>
                <input type="email" value={form.primary_contact_email} onChange={(e) => setForm({ ...form, primary_contact_email: e.target.value })} className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
              </div>
            </div>
          </div>
          <label className="flex items-start gap-2 border border-ink-mid p-3 text-xs text-slate-light">
            <input type="checkbox" checked={issuePortalLogin} onChange={(e) => setIssuePortalLogin(e.target.checked)} className="mt-0.5" />
            <span>Issue a supplier portal login for this contact now, using the email above. A one-time password is generated for you to hand over directly. Requires elevated (settings) access — if you don&apos;t have it, uncheck this and the supplier is still registered normally.</span>
          </label>
        </div>
        <div className="flex justify-end gap-3 border-t border-ink-mid pt-4">
          <button onClick={onClose} className="h-10 border border-ink-mid px-4 font-mono text-xs uppercase text-slate-light hover:text-paper">Cancel</button>
          <button onClick={() => void submit()} disabled={saving} className="inline-flex h-10 items-center gap-2 bg-signal px-5 font-mono text-xs font-bold uppercase text-ink disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Register Supplier
          </button>
        </div>
      </div>
    </div>
  );
}


export function CredentialsIssuedModal({ credentials, onClose }: { credentials: { email: string; temporary_password: string }; onClose: () => void; }) {
  const [copied, setCopied] = useState(false);
  const portalUrl = typeof window !== "undefined" ? `${window.location.origin}/portal/supplier` : "/portal/supplier";
  const copyLoginCard = async () => {
    try {
      await navigator.clipboard.writeText([
        `Supplier portal: ${portalUrl}`,
        `Email: ${credentials.email}`,
        `Temporary password: ${credentials.temporary_password}`,
      ].join("\n"));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md border border-signal/40 bg-ink p-5 shadow-2xl">
        <h2 className="text-xl font-semibold text-paper">Portal Login Issued</h2>
        <p className="mt-2 text-xs text-slate-light">Copy this password now and hand it to them directly — it will not be shown again, and they must change it on first login.</p>
        <div className="mt-4 space-y-2">
          <div className="border border-ink-mid bg-ink-light p-2">
            <p className="font-mono text-[10px] uppercase tracking-widest text-slate">Supplier portal</p>
            <p className="mt-1 break-all font-mono text-xs text-paper">{portalUrl}</p>
          </div>
          <div className="border border-ink-mid bg-ink-light p-2">
            <p className="font-mono text-[10px] uppercase tracking-widest text-slate">Sign-in email</p>
            <p className="mt-1 break-all font-mono text-xs text-paper">{credentials.email}</p>
          </div>
          <div className="border border-signal/40 bg-signal/5 p-2">
            <p className="font-mono text-[10px] uppercase tracking-widest text-slate">Temporary password</p>
            <p className="mt-1 break-all font-mono text-xs text-paper">{credentials.temporary_password}</p>
          </div>
        </div>
        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          <button onClick={() => void copyLoginCard()} className="h-10 border border-ink-mid font-mono text-xs font-bold uppercase text-paper hover:border-signal">{copied ? "Copied" : "Copy login"}</button>
          <button onClick={onClose} className="h-10 bg-signal font-mono text-xs font-bold uppercase text-ink hover:bg-signal/90">Done</button>
        </div>
      </div>
    </div>
  );
}
