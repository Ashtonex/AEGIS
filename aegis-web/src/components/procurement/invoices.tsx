"use client";

import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, DollarSign, Loader2, Search, ShieldAlert, X } from "lucide-react";
import { getDocuments } from "@/lib/api";
import { Banner, EmptyState, type PaymentEvidencePayload, type Rec, type Tab, dt, matchStatusClass, money, normalizeActionError, prStatusClass, tx } from "@/components/procurement/shared";


// ─── Invoices Tab ─────────────────────────────────────────────────────────────

export function InvoicesTab({
  rows,
  unmatchedCount,
  saving,
  onMatch,
  onInspect,
  onApprovePayment,
}: {
  rows: Rec[];
  unmatchedCount: number;
  saving: string | null;
  onMatch: (row: Rec) => void;
  onInspect: (row: Rec) => void;
  onApprovePayment: (row: Rec) => void;
}) {
  return (
    <>
      {unmatchedCount > 0 && (
        <div className="flex items-center gap-3 border-b border-amber-500/30 bg-amber-950/20 p-4 text-sm text-amber-300">
          <ShieldAlert className="h-5 w-5 shrink-0" />
          <span><strong>{unmatchedCount}</strong> invoice{unmatchedCount !== 1 ? "s" : ""} have no matching order or delivery — review before approving payment.</span>
        </div>
      )}
      <div className="border-b border-blue-500/20 bg-blue-950/10 p-4 text-xs text-blue-200">
        Payment approval is evidence-gated for PO invoices. Store-only invoice intakes remain visible here for audit, but they are not sent through three-way matching.
      </div>
      {rows.length === 0 ? (
        <EmptyState label="No invoices match this filter." sub="PO invoices and store invoice intakes appear here." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px] text-sm">
            <thead>
              <tr className="border-b border-ink-mid bg-ink-light/50 text-left">
                {["Invoice #", "Supplier Ref", "Supplier", "PO #", "Invoice Date", "Total", "Match Status", "Status", "Actions"].map((h) => (
                  <th key={h} className="px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-slate">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-mid">
              {rows.map((row) => {
                const matchSt = tx(row.match_status ?? row.matching_status, "unmatched").toLowerCase();
                const isRisk = matchSt === "unmatched" || matchSt === "disputed";
                const isMatched = matchSt === "matched";
                const canMatch = Boolean(row.po_id && row.grn_id);
                const status = tx(row.status, "received").toLowerCase();
                return (
                  <tr key={row.id} className={`hover:bg-ink-light/40 ${isRisk ? "bg-red-950/10" : ""}`}>
                    <td className="px-4 py-3 font-mono text-xs text-signal">{tx(row.invoice_number ?? row.reference_number, row.id.slice(0, 8).toUpperCase())}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-light">{tx(row.supplier_invoice_ref ?? row.external_reference)}</td>
                    <td className="px-4 py-3 text-paper">{tx(row.supplier_name)}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-light">{tx(row.po_number ?? row.purchase_order_number)}</td>
                    <td className="px-4 py-3 text-slate-light">{dt(row.invoice_date)}</td>
                    <td className="px-4 py-3 font-mono text-paper">{money(row.total_amount ?? row.amount ?? 0)}</td>
                    <td className="px-4 py-3"><span className={`border px-2 py-0.5 font-mono text-[10px] uppercase ${matchStatusClass(matchSt)}`}>{matchSt}</span></td>
                    <td className="px-4 py-3"><span className={`border px-2 py-0.5 font-mono text-[10px] uppercase ${prStatusClass(row.status)}`}>{tx(row.status, "pending")}</span></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => onInspect(row)}
                          className="inline-flex items-center gap-1 border border-ink-mid px-2 py-1 font-mono text-[10px] uppercase text-paper hover:border-signal transition"
                          title="Compare invoice, order and delivery"
                        >
                          <Search className="h-3 w-3" />Inspect
                        </button>
                        {!isMatched && canMatch && (
                          <button onClick={() => onMatch(row)} disabled={saving === `match-invoice-${row.id}`}
                            className="inline-flex items-center gap-1 border border-blue-500/40 px-2 py-1 font-mono text-[10px] uppercase text-blue-300 hover:bg-blue-950/30 disabled:opacity-40">
                            <BadgeCheck className="h-3 w-3" />Match
                          </button>
                        )}
                        {!isMatched && !canMatch && (
                          <span className="border border-slate-500/30 bg-slate-950/20 px-2 py-1 font-mono text-[10px] uppercase text-slate-light">
                            Store intake
                          </span>
                        )}
                        {isMatched && status !== "approved" && (
                          <button onClick={() => onApprovePayment(row)} disabled={saving === `pay-invoice-${row.id}`}
                            className="inline-flex items-center gap-1 border border-emerald-500/40 px-2 py-1 font-mono text-[10px] uppercase text-emerald-300 hover:bg-emerald-950/30 disabled:opacity-40">
                            <DollarSign className="h-3 w-3" />Approve with evidence
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}


export function PaymentEvidenceModal({ invoice, saving, onSubmit, onClose }: { invoice: Rec; saving: boolean; onSubmit: (payload: PaymentEvidencePayload) => void; onClose: () => void; }) {
  const [form, setForm] = useState<PaymentEvidencePayload>({
    poDocumentId: "",
    grnDocumentId: "",
    invoiceDocumentId: "",
    approvalDocumentId: "",
    reason: "Order, delivery, supplier invoice and payment approval documents verified.",
  });
  const [error, setError] = useState<string | null>(null);
  const setField = (field: keyof PaymentEvidencePayload, value: string) => setForm((prev) => ({ ...prev, [field]: value }));

  const submit = () => {
    const required: Array<keyof PaymentEvidencePayload> = ["poDocumentId", "grnDocumentId", "invoiceDocumentId", "approvalDocumentId"];
    if (required.some((field) => !form[field].trim())) {
      setError("All four document IDs are required before payment approval.");
      return;
    }
    setError(null);
    onSubmit(form);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm">
      <aside className="ml-auto flex h-full w-full max-w-2xl flex-col overflow-y-auto border-l border-ink-mid bg-ink text-paper shadow-2xl">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-ink-mid bg-ink p-5">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-signal">Payment Evidence Gate</p>
            <h2 className="mt-1 text-xl font-semibold">Approve supplier invoice payment</h2>
            <p className="mt-1 text-sm text-slate-light">{tx(invoice.invoice_number ?? invoice.reference_number, invoice.id)} · {money(invoice.total_amount ?? invoice.amount ?? 0)}</p>
          </div>
          <button onClick={onClose} disabled={saving} className="border border-ink-mid p-2 text-slate-light hover:border-signal hover:text-paper disabled:opacity-40"><X className="h-5 w-5" /></button>
        </header>
        <div className="flex-1 space-y-5 p-5">
          {error && <Banner tone="error" message={error} />}
          <div className="border border-blue-500/25 bg-blue-950/10 p-4 text-sm text-blue-100">
            Finance approval requires linked evidence for the purchase order, confirmed goods receipt, supplier invoice and the payment approval decision. Search and select existing controlled documents from Enterprise Document Management.
          </div>
          <div className="grid gap-4">
            <DocumentPicker label="Purchase order evidence" value={form.poDocumentId} onChange={(v) => setField("poDocumentId", v)} entityId={tx(invoice.po_id)} projectId={typeof invoice.project_id === "string" ? invoice.project_id : undefined} searchHint={tx(invoice.po_number ?? invoice.purchase_order_number, "purchase order")} />
            <DocumentPicker label="Goods received evidence" value={form.grnDocumentId} onChange={(v) => setField("grnDocumentId", v)} entityId={tx(invoice.grn_id)} projectId={typeof invoice.project_id === "string" ? invoice.project_id : undefined} searchHint="Delivery note / goods received" />
            <DocumentPicker label="Supplier invoice evidence" value={form.invoiceDocumentId} onChange={(v) => setField("invoiceDocumentId", v)} entityId={invoice.id} projectId={typeof invoice.project_id === "string" ? invoice.project_id : undefined} searchHint={tx(invoice.supplier_invoice_ref ?? invoice.invoice_number, "supplier invoice")} />
            <DocumentPicker label="Payment approval evidence" value={form.approvalDocumentId} onChange={(v) => setField("approvalDocumentId", v)} entityId={invoice.id} projectId={typeof invoice.project_id === "string" ? invoice.project_id : undefined} searchHint="payment approval" />
            <div>
              <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate">Approval reason</label>
              <textarea value={form.reason} onChange={(e) => setField("reason", e.target.value)} rows={3} className="w-full border border-ink-mid bg-ink-light p-3 text-sm text-paper outline-none focus:border-signal" />
            </div>
          </div>
        </div>
        <footer className="sticky bottom-0 flex justify-end gap-3 border-t border-ink-mid bg-ink p-5">
          <button onClick={onClose} disabled={saving} className="border border-ink-mid px-4 py-2 text-sm text-slate-light hover:text-paper disabled:opacity-40">Cancel</button>
          <button onClick={submit} disabled={saving} className="inline-flex items-center gap-2 bg-signal px-5 py-2 font-mono text-xs uppercase text-ink hover:bg-signal-light disabled:opacity-40">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <DollarSign className="h-4 w-4" />}Link evidence and approve
          </button>
        </footer>
      </aside>
    </div>
  );
}


export function DocumentPicker({ label, value, onChange, entityId, projectId, searchHint }: { label: string; value: string; onChange: (value: string) => void; entityId: string; projectId?: string; searchHint: string; }) {
  const [search, setSearch] = useState(searchHint);
  const [documents, setDocuments] = useState<Rec[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = documents.find((doc) => doc.id === value);
  const loadDocuments = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getDocuments({
        search: search.trim() || undefined,
        project_id: projectId,
      });
      setDocuments(Array.isArray(res.data) ? res.data : []);
    } catch (e) {
      setError(normalizeActionError(e, "Documents could not be loaded."));
    } finally {
      setLoading(false);
    }
  }, [projectId, search]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      void loadDocuments();
    }, 250);
    return () => window.clearTimeout(handle);
  }, [loadDocuments]);

  return (
    <div className="border border-ink-mid bg-ink-light/40 p-3">
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <label className="block font-mono text-[10px] uppercase tracking-wider text-slate">{label} *</label>
        <span className="truncate font-mono text-[10px] text-slate">Target: {entityId}</span>
      </div>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by document title, file name or document number" className="w-full border border-ink-mid bg-ink px-9 py-2 text-sm text-paper outline-none focus:border-signal" />
        {loading && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-signal" />}
      </div>
      {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
      <div className="mt-3 max-h-44 space-y-2 overflow-y-auto">
        {documents.length === 0 && !loading ? (
          <p className="border border-dashed border-ink-mid p-3 text-xs text-slate-light">No controlled documents found. Upload or register the document in Document Management, then search again.</p>
        ) : documents.map((doc) => {
          const active = doc.id === value;
          return (
            <button key={doc.id} type="button" onClick={() => onChange(doc.id)}
              className={`w-full border p-3 text-left transition ${active ? "border-signal bg-signal/10" : "border-ink-mid bg-ink hover:border-signal/50"}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-paper">{tx(doc.title, "Untitled document")}</p>
                  <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-slate">{tx(doc.doc_number ?? doc.document_number)} · {tx(doc.file_name)}</p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <span className="border border-blue-500/30 px-1.5 py-0.5 font-mono text-[9px] uppercase text-blue-300">{tx(doc.category, "document")}</span>
                  <span className="border border-emerald-500/30 px-1.5 py-0.5 font-mono text-[9px] uppercase text-emerald-300">{tx(doc.status, "draft")}</span>
                </div>
              </div>
              {active && <p className="mt-2 font-mono text-[10px] text-signal">Selected: {doc.id}</p>}
            </button>
          );
        })}
      </div>
      {value && !selected && <p className="mt-2 font-mono text-[10px] text-signal">Selected document ID: {value}</p>}
    </div>
  );
}
