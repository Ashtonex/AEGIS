"use client";

import { useMemo, useState } from "react";
import { BadgeCheck, CheckCircle2, FileText, Loader2, Plus, Search, Send, ShieldAlert, ShoppingCart, Warehouse, X, XCircle } from "lucide-react";
import { createProcurementRequisition } from "@/lib/api";
import { Banner, EmptyState, InfoCard, type LineItem, type Rec, type Tab, dt, money, normalizeActionError, num, poStatusClass, prStatusClass, priorityClass, qty, supplierStatusClass, tx } from "@/components/procurement/shared";


// ─── Requisitions Table ───────────────────────────────────────────────────────

export function RequisitionsTable({ rows, saving, onSubmit, onApprove, onCreateRFQ, onCreatePO }: { rows: Rec[]; saving: string | null; onSubmit: (id: string) => void; onApprove: (row: Rec) => void; onCreateRFQ: (row: Rec) => void; onCreatePO: (row: Rec) => void; }) {
  if (rows.length === 0) return <EmptyState label="No purchase requests match this view." sub="Create the first request using the button above." />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] text-sm">
        <thead>
          <tr className="border-b border-ink-mid bg-ink-light/50 text-left">
            {["Request No.", "Project", "Priority", "Status", "Requested By", "Est. Total", "Required By", "Next step"].map((h) => (
              <th key={h} className="px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-slate">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-mid">
          {rows.map((row) => {
            const status = tx(row.status, "draft").toLowerCase();
            const isDraft = status === "draft" || status === "rejected";
            const isSubmitted = status === "submitted";
            const isApproved = status === "approved";
            return (
              <tr key={row.id} className="hover:bg-ink-light/40">
                <td className="px-4 py-3 font-mono text-xs text-signal">{tx(row.pr_number ?? row.reference_number, row.id.slice(0, 8).toUpperCase())}</td>
                <td className="px-4 py-3 text-paper">{tx(row.project_name ?? row.project)}</td>
                <td className="px-4 py-3"><span className={`border px-2 py-0.5 font-mono text-[10px] uppercase ${priorityClass(row.priority)}`}>{tx(row.priority, "normal")}</span></td>
                <td className="px-4 py-3"><span className={`border px-2 py-0.5 font-mono text-[10px] uppercase ${prStatusClass(row.status)}`}>{tx(row.status, "draft")}</span></td>
                <td className="px-4 py-3 text-slate-light">{tx(row.requested_by ?? row.created_by_name)}</td>
                <td className="px-4 py-3 font-mono text-paper">{money(row.total_estimated ?? row.estimated_total ?? 0)}</td>
                <td className="px-4 py-3 text-slate-light">{dt(row.required_by_date ?? row.required_by)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    {isDraft && (
                      <button onClick={() => onSubmit(row.id)} disabled={saving === `submit-${row.id}`}
                        className="inline-flex items-center gap-1 border border-blue-500/40 px-2 py-1 font-mono text-[10px] uppercase text-blue-300 hover:bg-blue-950/30 disabled:opacity-40">
                        <Send className="h-3 w-3" />Submit for approval
                      </button>
                    )}
                    {isSubmitted && (
                      <button onClick={() => onApprove(row)}
                        className="inline-flex items-center gap-1 border border-emerald-500/40 px-2 py-1 font-mono text-[10px] uppercase text-emerald-300 hover:bg-emerald-950/30">
                        <BadgeCheck className="h-3 w-3" />Approve or reject
                      </button>
                    )}
                    {isApproved && (
                      <>
                        <button onClick={() => onCreatePO(row)} disabled={saving === `po-${row.id}`}
                          className="inline-flex items-center gap-1 border border-signal bg-signal/15 px-2 py-1 font-mono text-[10px] uppercase text-signal hover:bg-signal/25 disabled:opacity-40">
                          <ShoppingCart className="h-3 w-3" />Create PO
                        </button>
                        <button onClick={() => onCreateRFQ(row)} disabled={saving === `rfq-${row.id}`} title="Optional: ask suppliers to quote first"
                          className="inline-flex items-center gap-1 border border-ink-mid px-2 py-1 font-mono text-[10px] uppercase text-slate-light hover:border-signal hover:text-paper disabled:opacity-40">
                          <Search className="h-3 w-3" />Get quotes
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}


// ─── Pending Pricing Tab ────────────────────────────────────────────────────

export function PendingPricingTable({ rows, saving, onConfirm }: { rows: Rec[]; saving: string | null; onConfirm: (id: string, unitCost: number) => void; }) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  if (rows.length === 0) return <EmptyState label="No material requests are waiting on pricing." sub="Site material requests submitted with no known price appear here until procurement or inventory confirms the real cost." />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] text-sm">
        <thead>
          <tr className="border-b border-ink-mid bg-ink-light/50 text-left">
            {["Request", "Project", "Item", "Qty", "Issued", "Required By", "Confirm Unit Cost"].map((h) => (
              <th key={h} className="px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-slate">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-mid">
          {rows.map((row) => {
            const draft = drafts[row.id] ?? "";
            const busy = saving === `price-${row.id}`;
            const parsed = Number(draft);
            const valid = draft.trim() !== "" && Number.isFinite(parsed) && parsed > 0;
            return (
              <tr key={row.id} className="hover:bg-ink-light/40">
                <td className="px-4 py-3 font-mono text-xs text-signal">{tx(row.request_number, row.id.slice(0, 8).toUpperCase())}</td>
                <td className="px-4 py-3 text-paper">{tx(row.project_name)}</td>
                <td className="px-4 py-3 text-paper">{tx(row.item_name ?? row.item_code)}</td>
                <td className="px-4 py-3 text-slate-light">{tx(String(row.requested_quantity ?? ""))} {tx(row.unit_of_measure, "")}</td>
                <td className="px-4 py-3 text-slate-light">{tx(String(row.issued_quantity ?? "0"))}</td>
                <td className="px-4 py-3 text-slate-light">{dt(row.required_by_date)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <input
                      value={draft}
                      onChange={(e) => setDrafts((prev) => ({ ...prev, [row.id]: e.target.value }))}
                      type="number" min="0" step="0.0001" placeholder="Unit cost ($)"
                      className="h-8 w-28 border border-ink-mid bg-ink px-2 text-xs text-paper"
                    />
                    <button
                      onClick={() => onConfirm(row.id, parsed)}
                      disabled={!valid || busy}
                      className="inline-flex items-center gap-1 border border-emerald-500/40 px-2 py-1 font-mono text-[10px] uppercase text-emerald-300 hover:bg-emerald-950/30 disabled:opacity-40"
                    >
                      <BadgeCheck className="h-3 w-3" />Confirm
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}


// ─── RFQs Tab ────────────────────────────────────────────────────────────────

export function RfqsTab({ rows, saving, onQuote, onDecideQuote, onCreatePO }: { rows: Rec[]; saving: string | null; onQuote: (row: Rec) => void; onDecideQuote: (rfq: Rec, response: Rec, decision: "selected" | "rejected" | "evaluated") => void; onCreatePO: (response: Rec) => void; }) {
  if (rows.length === 0) return <EmptyState label="No quote requests match this view." sub="Ask suppliers for quotes from an approved purchase request (optional)." />;
  return (
    <div className="divide-y divide-ink-mid">
      {rows.map((rfq) => {
        const responses: Rec[] = Array.isArray(rfq.responses) ? rfq.responses : [];
        const selected = responses.find((r) => tx(r.status).toLowerCase() === "selected");
        return (
          <article key={rfq.id} className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-xs uppercase tracking-wider text-signal">{tx(rfq.rfq_number, rfq.id.slice(0, 8).toUpperCase())}</p>
                <h3 className="mt-1 text-lg font-semibold text-paper">{tx(rfq.title, tx(rfq.requisition_number, "RFQ"))}</h3>
                <p className="mt-1 text-xs text-slate-light">{tx(rfq.project_name)} · PR {tx(rfq.requisition_number)} · closes {dt(rfq.closing_date)}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`border px-2 py-0.5 font-mono text-[10px] uppercase ${poStatusClass(rfq.status)}`}>{tx(rfq.status, "draft")}</span>
                <button onClick={() => onQuote(rfq)} className="inline-flex items-center gap-1 border border-blue-500/40 px-2 py-1 font-mono text-[10px] uppercase text-blue-300 hover:bg-blue-950/30">
                  <Plus className="h-3 w-3" />Quote
                </button>
                {selected && (
                  <button onClick={() => onCreatePO(selected)} disabled={saving === `po-rfq-${selected.id}`}
                    className="inline-flex items-center gap-1 border border-signal/40 px-2 py-1 font-mono text-[10px] uppercase text-signal hover:bg-signal/10 disabled:opacity-40">
                    <ShoppingCart className="h-3 w-3" />Create PO
                  </button>
                )}
              </div>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b border-ink-mid text-left">
                    {["Supplier", "Reference", "Amount", "Delivery", "Score", "Status", "Actions"].map((h) => <th key={h} className="px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-slate">{h}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-mid/70">
                  {responses.length === 0 ? (
                    <tr><td colSpan={7} className="px-3 py-4 text-sm text-slate-light">No supplier quotations captured yet.</td></tr>
                  ) : responses.map((response) => {
                    const responseStatus = tx(response.status, "received").toLowerCase();
                    return (
                      <tr key={response.id}>
                        <td className="px-3 py-2 text-paper">{tx(response.supplier_name)}</td>
                        <td className="px-3 py-2 font-mono text-xs text-slate-light">{tx(response.reference)}</td>
                        <td className="px-3 py-2 font-mono text-paper">{money(response.total_amount)}</td>
                        <td className="px-3 py-2 text-slate-light">{response.delivery_days ? `${response.delivery_days} days` : "—"}</td>
                        <td className="px-3 py-2 font-mono text-slate-light">{response.evaluation_score ?? "—"}</td>
                        <td className="px-3 py-2"><span className={`border px-2 py-0.5 font-mono text-[10px] uppercase ${supplierStatusClass(response.status)}`}>{tx(response.status)}</span></td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            {responseStatus !== "selected" && (
                              <button onClick={() => onDecideQuote(rfq, response, "selected")} disabled={saving === `quote-decision-${response.id}`}
                                className="border border-emerald-500/40 px-2 py-1 font-mono text-[10px] uppercase text-emerald-300 hover:bg-emerald-950/30 disabled:opacity-40">Select</button>
                            )}
                            {responseStatus === "selected" && (
                              <button onClick={() => onCreatePO(response)} disabled={saving === `po-rfq-${response.id}`}
                                className="border border-signal/40 px-2 py-1 font-mono text-[10px] uppercase text-signal hover:bg-signal/10 disabled:opacity-40">PO</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </article>
        );
      })}
    </div>
  );
}


// ─── Create PR Modal ──────────────────────────────────────────────────────────

export function CreatePRModal({
  projects,
  stores = [],
  stockLevels = [],
  onClose,
  onCreated,
}: {
  projects: Rec[];
  stores?: Rec[];
  stockLevels?: Rec[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState({ project_id: "", priority: "normal", required_by_date: "", justification: "" });
  const [lines, setLines] = useState<LineItem[]>([{ description: "", qty: "1", uom: "ea", unit_cost: "" }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addLine = () => setLines((prev) => [...prev, { description: "", qty: "1", uom: "ea", unit_cost: "" }]);
  const removeLine = (i: number) => setLines((prev) => prev.filter((_, idx) => idx !== i));
  const setLine = (i: number, field: keyof LineItem, val: string) => setLines((prev) => prev.map((l, idx) => idx === i ? { ...l, [field]: val } : l));
  const estimatedTotal = lines.reduce((s, l) => s + num(l.qty) * num(l.unit_cost), 0);

  // Store-First Availability matching: looks across stockLevels for any store with on-hand quantity
  const lineStoreMatches = useMemo(() => {
    return lines.map((l) => {
      const desc = l.description.trim().toLowerCase();
      if (!desc || desc.length < 2) return [];
      return stockLevels.filter((stock) => {
        const name = tx(stock.item_name ?? stock.description, "").toLowerCase();
        const code = tx(stock.item_code, "").toLowerCase();
        const avail = num(stock.available_qty ?? stock.quantity);
        return avail > 0 && (name.includes(desc) || desc.includes(name) || code === desc);
      });
    });
  }, [lines, stockLevels]);

  const submit = async () => {
    if (!form.required_by_date) { setError("Required-by date is mandatory."); return; }
    if (lines.some((l) => !l.description.trim())) { setError("All line items must have a description."); return; }
    setSaving(true); setError(null);
    try {
      await createProcurementRequisition({
        ...form,
        project_id: form.project_id || null,
        line_items: lines.map((l) => ({ ...l, qty: num(l.qty), unit_cost: num(l.unit_cost) })),
      });
      onCreated();
    } catch (e) { setError(normalizeActionError(e, "Could not create the purchase request.")); setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm">
      <aside className="ml-auto flex h-full w-full max-w-2xl flex-col overflow-y-auto border-l border-ink-mid bg-ink text-paper shadow-2xl">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-ink-mid bg-ink p-5">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-signal">New Purchase Request</p>
            <h2 className="mt-1 text-xl font-semibold">Create request</h2>
          </div>
          <button onClick={onClose} className="border border-ink-mid p-2 text-slate-light hover:border-signal hover:text-paper"><X className="h-5 w-5" /></button>
        </header>
        <div className="flex-1 space-y-5 p-5">
          {error && <Banner tone="error" message={error} />}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate">Project</label>
              <select value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })} className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper">
                <option value="">Not project-specific</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {tx(p.name ?? p.project_name ?? p.project_code, p.id)}{p.status === "field_intake" ? " (Field Intake)" : ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate">Priority</label>
              <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper">
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="urgent">Urgent</option>
                <option value="emergency">Emergency</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate">Required By *</label>
              <input type="date" value={form.required_by_date} onChange={(e) => setForm({ ...form, required_by_date: e.target.value })} className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate">Business Justification</label>
              <textarea value={form.justification} onChange={(e) => setForm({ ...form, justification: e.target.value })} placeholder="Explain why this procurement is required…" rows={3} className="w-full border border-ink-mid bg-ink-light p-3 text-sm text-paper resize-none" />
            </div>
          </div>
          {/* Line items */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="font-mono text-[10px] uppercase tracking-wider text-slate">Line Items</p>
              <button onClick={addLine} className="inline-flex items-center gap-1 border border-signal/40 px-2 py-1 font-mono text-[10px] uppercase text-signal hover:bg-signal/10">
                <Plus className="h-3 w-3" />Add Row
              </button>
            </div>
            <div className="space-y-3">
              {lines.map((line, i) => {
                const availableMatches = lineStoreMatches[i] || [];
                return (
                  <div key={i} className="border border-ink-mid bg-ink-light/20 p-3 rounded">
                    <div className="grid gap-2 sm:grid-cols-[1fr_70px_70px_100px_auto]">
                      <input value={line.description} onChange={(e) => setLine(i, "description", e.target.value)} placeholder="Item description (e.g. 50kg Cement, 12mm Rebar)" className="h-9 border border-ink-mid bg-ink px-3 text-sm text-paper" />
                      <input value={line.qty} onChange={(e) => setLine(i, "qty", e.target.value)} placeholder="Qty" type="number" min="1" className="h-9 border border-ink-mid bg-ink px-2 text-sm text-paper" />
                      <input value={line.uom} onChange={(e) => setLine(i, "uom", e.target.value)} placeholder="UOM" className="h-9 border border-ink-mid bg-ink px-2 text-sm text-paper" />
                      <input value={line.unit_cost} onChange={(e) => setLine(i, "unit_cost", e.target.value)} placeholder="Est. Unit cost" type="number" min="0" className="h-9 border border-ink-mid bg-ink px-2 text-sm text-paper" />
                      <button onClick={() => removeLine(i)} disabled={lines.length === 1} className="flex items-center justify-center border border-ink-mid p-2 text-slate hover:border-red-500/40 hover:text-red-400 disabled:opacity-30">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    {/* Store-First Recommendation Box */}
                    {availableMatches.length > 0 && (
                      <div className="mt-2.5 p-2 rounded bg-signal/10 border border-signal/30 text-xs">
                        <div className="flex items-center gap-1.5 font-mono text-[11px] text-signal font-semibold">
                          <Warehouse className="h-3.5 w-3.5" />
                          <span>Store-First Stock Available:</span>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-2 text-[11px]">
                          {availableMatches.slice(0, 3).map((match, idx) => (
                            <div key={idx} className="bg-ink px-2 py-0.5 border border-ink-mid rounded font-mono text-paper">
                              <span className="font-semibold text-emerald-300">{num(match.available_qty)} {tx(match.unit_of_measure, "ea")}</span> in <span className="text-slate-light">{tx(match.store_name, "Store")}</span>
                            </div>
                          ))}
                        </div>
                        <p className="mt-1 text-[10px] text-slate-light">
                          Tip: Internal store transfers avoid external purchasing costs and supplier lead time.
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="mt-2 flex justify-end">
              <p className="font-mono text-sm text-paper">Est. Total: <span className="text-signal">{money(estimatedTotal)}</span></p>
            </div>
          </div>
          {/* Self-approval warning */}
          <div className="flex items-start gap-3 border border-amber-500/20 bg-amber-950/10 p-3">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
            <p className="text-xs text-amber-300">
              <strong>Self-approval prevention:</strong> Once submitted, this requisition must be approved by a different authorised user. The submitter cannot approve their own PR.
            </p>
          </div>
        </div>
        <footer className="sticky bottom-0 flex justify-end gap-3 border-t border-ink-mid bg-ink p-4">
          <button onClick={onClose} className="h-10 border border-ink-mid px-4 font-mono text-xs uppercase text-slate-light hover:text-paper">Cancel</button>
          <button onClick={() => void submit()} disabled={saving} className="inline-flex h-10 items-center gap-2 bg-signal px-5 font-mono text-xs font-bold uppercase text-ink disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Submit Requisition
          </button>
        </footer>
      </aside>
    </div>
  );
}


export function CreateRfqModal({ pr, saving, onCreate, onClose }: { pr: Rec; saving: boolean; onCreate: (payload: Record<string, unknown>) => void; onClose: () => void; }) {
  const [form, setForm] = useState({ title: tx(pr.requisition_number ?? pr.pr_number, "RFQ"), closing_date: "", description: tx(pr.justification, "") });
  const submit = () => onCreate({ ...form, closing_date: form.closing_date || null, issue_now: true });
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg border border-ink-mid bg-ink p-5 shadow-2xl">
        <div className="flex items-start justify-between">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-signal">Send quote request</p>
            <h3 className="mt-1 text-xl font-semibold">Create request for quotation</h3>
            <p className="mt-1 text-xs text-slate-light">PR {tx(pr.requisition_number ?? pr.pr_number, pr.id)}</p>
          </div>
          <button onClick={onClose} className="text-slate hover:text-paper"><X className="h-5 w-5" /></button>
        </div>
        <div className="mt-5 space-y-3">
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Quote request title" className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
          <input type="date" value={form.closing_date} onChange={(e) => setForm({ ...form, closing_date: e.target.value })} className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
          <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Scope / supplier instructions" rows={4} className="w-full border border-ink-mid bg-ink-light p-3 text-sm text-paper" />
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="border border-ink-mid px-4 py-2 text-sm text-slate-light hover:text-paper">Cancel</button>
          <button onClick={submit} disabled={saving} className="inline-flex items-center gap-2 bg-signal px-4 py-2 font-mono text-xs uppercase text-ink disabled:opacity-40">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}Send quote request</button>
        </div>
      </div>
    </div>
  );
}


export function RfqResponseModal({ rfq, suppliers, saving, onSubmit, onClose }: { rfq: Rec; suppliers: Rec[]; saving: boolean; onSubmit: (payload: Record<string, unknown>) => void; onClose: () => void; }) {
  const [form, setForm] = useState({ supplier_id: "", reference: "", total_amount: "", delivery_days: "", validity_days: "30", notes: "" });
  const [error, setError] = useState<string | null>(null);
  const submit = () => {
    if (!form.supplier_id) { setError("Select a supplier."); return; }
    if (num(form.total_amount) < 0 || !form.total_amount) { setError("Enter a quotation amount."); return; }
    setError(null);
    onSubmit({
      supplier_id: form.supplier_id,
      reference: form.reference || null,
      total_amount: num(form.total_amount),
      delivery_days: form.delivery_days ? Number(form.delivery_days) : null,
      validity_days: Number(form.validity_days || 30),
      notes: form.notes || null,
      line_items: [],
    });
  };
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg border border-ink-mid bg-ink p-5 shadow-2xl">
        <div className="flex items-start justify-between">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-signal">Supplier quotation</p>
            <h3 className="mt-1 text-xl font-semibold">{tx(rfq.rfq_number, rfq.id)}</h3>
          </div>
          <button onClick={onClose} className="text-slate hover:text-paper"><X className="h-5 w-5" /></button>
        </div>
        {error && <div className="mt-4 border border-red-500/40 bg-red-950/20 p-3 text-sm text-red-200">{error}</div>}
        <div className="mt-5 space-y-3">
          <select value={form.supplier_id} onChange={(e) => setForm({ ...form, supplier_id: e.target.value })} className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper">
            <option value="">Select supplier</option>
            {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{tx(supplier.supplier_name ?? supplier.name, supplier.id)}</option>)}
          </select>
          <input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="Supplier quote reference" className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
          <div className="grid gap-3 sm:grid-cols-3">
            <input value={form.total_amount} onChange={(e) => setForm({ ...form, total_amount: e.target.value })} placeholder="Total amount" className="h-10 border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
            <input value={form.delivery_days} onChange={(e) => setForm({ ...form, delivery_days: e.target.value })} placeholder="Delivery days" className="h-10 border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
            <input value={form.validity_days} onChange={(e) => setForm({ ...form, validity_days: e.target.value })} placeholder="Validity days" className="h-10 border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
          </div>
          <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Evaluation notes" rows={3} className="w-full border border-ink-mid bg-ink-light p-3 text-sm text-paper" />
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="border border-ink-mid px-4 py-2 text-sm text-slate-light hover:text-paper">Cancel</button>
          <button onClick={submit} disabled={saving} className="inline-flex items-center gap-2 bg-signal px-4 py-2 font-mono text-xs uppercase text-ink disabled:opacity-40">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}Record quote</button>
        </div>
      </div>
    </div>
  );
}


export function CreatePOModal({ pr, suppliers, saving, onCreate, onClose }: { pr: Rec; suppliers: Rec[]; saving: boolean; onCreate: (supplierId: string, supplierSelectionReason: string) => void; onClose: () => void; }) {
  const [supplierId, setSupplierId] = useState("");
  const [supplierSelectionReason, setSupplierSelectionReason] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg border border-ink-mid bg-ink text-paper shadow-2xl">
        <header className="flex items-center justify-between border-b border-ink-mid p-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-signal">Create Purchase Order</p>
            <h2 className="mt-1 text-lg font-semibold">{tx(pr.requisition_number ?? pr.pr_number ?? pr.reference_number, pr.id.slice(0, 8).toUpperCase())}</h2>
          </div>
          <button onClick={onClose} className="text-slate-light hover:text-paper"><X className="h-4 w-4" /></button>
        </header>
        <div className="space-y-4 p-5">
          <InfoCard label="Estimated Total" value={money(pr.total_estimated ?? pr.estimated_total ?? 0)} tone="text-signal" />
          <div>
            <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate">Supplier *</label>
            <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper">
              <option value="">Select supplier…</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{tx(s.supplier_name ?? s.name, s.id)}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate">Supplier selection rationale *</label>
            <textarea
              value={supplierSelectionReason}
              onChange={(e) => setSupplierSelectionReason(e.target.value)}
              rows={3}
              placeholder="Record why this supplier was chosen without comparing quotes."
              className="w-full resize-none border border-ink-mid bg-ink-light p-3 text-sm text-paper placeholder:text-slate"
            />
            <p className="mt-1 text-[11px] text-slate-light">Required for direct POs to avoid unexplained supplier selection.</p>
          </div>
        </div>
        <footer className="flex justify-end gap-2 border-t border-ink-mid p-4">
          <button onClick={onClose} className="h-9 border border-ink-mid px-3 font-mono text-xs uppercase text-slate-light hover:text-paper">Cancel</button>
          <button onClick={() => onCreate(supplierId, supplierSelectionReason)} disabled={saving || !supplierId || supplierSelectionReason.trim().length < 12} className="inline-flex h-9 items-center gap-2 bg-signal px-4 font-mono text-xs font-bold uppercase text-ink disabled:opacity-40">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingCart className="h-4 w-4" />}Create PO
          </button>
        </footer>
      </div>
    </div>
  );
}


// ─── Approve Modal ────────────────────────────────────────────────────────────

export function ApproveModal({ pr, saving, onDecide, onClose }: { pr: Rec; saving: boolean; onDecide: (d: "approved" | "rejected", reason?: string) => void; onClose: () => void; }) {
  const [reason, setReason] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="w-full max-w-md border border-ink-mid bg-ink shadow-2xl">
        <header className="flex items-center justify-between border-b border-ink-mid p-4">
          <p className="font-mono text-xs uppercase tracking-widest text-signal">Approval Decision</p>
          <button onClick={onClose} className="text-slate-light hover:text-paper"><X className="h-4 w-4" /></button>
        </header>
        <div className="space-y-4 p-5">
          <div>
            <p className="text-sm font-semibold text-paper">PR: {tx(pr.pr_number ?? pr.reference_number, pr.id.slice(0, 8).toUpperCase())}</p>
            <p className="mt-0.5 text-xs text-slate-light">{tx(pr.project_name ?? pr.project)} · Est. {money(pr.total_estimated ?? 0)}</p>
          </div>
          {pr.justification && (
            <div className="border border-ink-mid p-3">
              <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-slate">Justification</p>
              <p className="text-sm text-slate-light">{pr.justification}</p>
            </div>
          )}
          <div className="flex items-start gap-3 border border-blue-500/20 bg-blue-950/10 p-3">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-blue-400" />
            <p className="text-xs text-blue-300">Budget check results are returned by the server on approval. Verify project budget allocation is sufficient before proceeding.</p>
          </div>
          <div>
            <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate">Reason / Notes (required for rejection)</label>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Provide rationale…" className="w-full border border-ink-mid bg-ink-light p-3 text-sm text-paper resize-none" />
          </div>
        </div>
        <footer className="flex justify-end gap-2 border-t border-ink-mid p-4">
          <button onClick={onClose} className="h-9 border border-ink-mid px-3 font-mono text-xs uppercase text-slate-light hover:text-paper">Cancel</button>
          <button onClick={() => onDecide("rejected", reason)} disabled={saving || !reason.trim()} className="inline-flex h-9 items-center gap-1.5 border border-red-500/40 px-3 font-mono text-xs uppercase text-red-300 hover:bg-red-950/30 disabled:opacity-40">
            <XCircle className="h-3.5 w-3.5" />Reject
          </button>
          <button onClick={() => onDecide("approved", reason || undefined)} disabled={saving} className="inline-flex h-9 items-center gap-1.5 bg-emerald-700 px-4 font-mono text-xs font-bold uppercase text-white hover:bg-emerald-600 disabled:opacity-40">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}Approve
          </button>
        </footer>
      </div>
    </div>
  );
}
