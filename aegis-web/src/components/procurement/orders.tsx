"use client";

import { type ReactNode, useState } from "react";
import { ArrowRight, CheckCircle2, FileText, Loader2, PackageCheck, Send, ShieldAlert, Truck, X, Download } from "lucide-react";
import { downloadPurchaseOrderPdf } from "@/lib/api";
import { poReadyToIssue, poSignoffStep } from "@/components/procurement/journey";
import { EmptyState, InfoCard, type Rec, dt, isPoOverdue, matchStatusClass, money, num, pct, poStatusClass, prStatusClass, tx } from "@/components/procurement/shared";


// ─── Orders Table ─────────────────────────────────────────────────────────────

export function OrdersTable({ rows, onView }: { rows: Rec[]; onView: (row: Rec) => void; }) {
  if (rows.length === 0) return <EmptyState label="No purchase orders match this view." sub="Orders are created from approved purchase requests." />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1000px] text-sm">
        <thead>
          <tr className="border-b border-ink-mid bg-ink-light/50 text-left">
            {["PO Number", "Supplier", "Project", "Total Amount", "Status", "Issued", "Exp. Delivery", "% Received", ""].map((h) => (
              <th key={h} className="px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-slate">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-mid">
          {rows.map((row) => {
            const received = num(row.percent_received ?? row.qty_received_pct ?? 0);
            return (
              <tr key={row.id} className="hover:bg-ink-light/40">
                <td className="px-4 py-3 font-mono text-xs text-signal">{tx(row.po_number ?? row.reference_number, row.id.slice(0, 8).toUpperCase())}</td>
                <td className="px-4 py-3 text-paper">{tx(row.supplier_name)}</td>
                <td className="px-4 py-3 text-slate-light">{tx(row.project_name ?? row.project)}</td>
                <td className="px-4 py-3 font-mono text-paper">{money(row.total_amount ?? row.amount ?? 0)}</td>
                <td className="px-4 py-3"><span className={`border px-2 py-0.5 font-mono text-[10px] uppercase ${poStatusClass(row.status)}`}>{tx(row.status, "draft")}</span></td>
                <td className="px-4 py-3 text-slate-light">{dt(row.issued_at ?? row.issued_date ?? row.created_at)}</td>
                <td className={`px-4 py-3 ${isPoOverdue(row) ? "text-red-300" : "text-slate-light"}`}>{dt(row.required_by_date ?? row.expected_delivery_date ?? row.expected_delivery)}{isPoOverdue(row) && <span className="ml-2 border border-red-500/40 px-1 font-mono text-[9px] uppercase">Late</span>}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-16 overflow-hidden rounded-full bg-ink-mid">
                      <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.min(received, 100)}%` }} />
                    </div>
                    <span className="font-mono text-[10px] text-slate-light">{pct(received)}</span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => onView(row)} className="inline-flex items-center gap-1 border border-ink-mid px-2 py-1 font-mono text-[10px] uppercase text-slate-light hover:border-signal hover:text-paper">
                      <ArrowRight className="h-3 w-3" />View
                    </button>
                    <PoPdfButton po={row} compact />
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


// ─── Purchase Order PDF ───────────────────────────────────────────────────────

export function PoPdfButton({ po, compact = false }: { po: Rec; compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const download = async () => {
    setBusy(true);
    setError(null);
    try {
      const blob = await downloadPurchaseOrderPdf(po.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `SNC_Purchase_Order_${tx(po.po_number, po.id.slice(0, 8))}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate the purchase order PDF.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="inline-flex flex-col">
      <button
        onClick={download}
        disabled={busy}
        title="Download Six Nine branded purchase order PDF"
        className={compact
          ? "inline-flex items-center gap-1 border border-ink-mid px-2 py-1 font-mono text-[10px] uppercase text-slate-light hover:border-signal hover:text-paper disabled:opacity-40"
          : "inline-flex h-9 items-center gap-2 border border-signal/50 px-3 font-mono text-xs uppercase text-signal hover:bg-signal/10 disabled:opacity-40"}
      >
        {busy ? <Loader2 className={compact ? "h-3 w-3 animate-spin" : "h-4 w-4 animate-spin"} /> : <Download className={compact ? "h-3 w-3" : "h-4 w-4"} />}
        {compact ? "PDF" : "Download PO (PDF)"}
      </button>
      {error && <span className="mt-1 max-w-[220px] text-[10px] text-red-300">{error}</span>}
    </span>
  );
}


export function ReceiveGoodsModal({ po, stores, saving, onSubmit, onClose }: { po: Rec; stores: Rec[]; saving: boolean; onSubmit: (payload: Record<string, unknown>) => void; onClose: () => void; }) {
  const [form, setForm] = useState({ store_id: "", delivery_date: new Date().toISOString().slice(0, 10), delivery_note_ref: "", condition_notes: "" });
  const set = (key: string, value: string) => setForm((prev) => ({ ...prev, [key]: value }));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg border border-ink-mid bg-ink text-paper shadow-2xl">
        <header className="flex items-center justify-between border-b border-ink-mid p-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-signal">Goods Received Note</p>
            <h2 className="mt-1 text-lg font-semibold">{tx(po.po_number ?? po.reference_number, po.id.slice(0, 8).toUpperCase())}</h2>
          </div>
          <button onClick={onClose} className="text-slate-light hover:text-paper"><X className="h-4 w-4" /></button>
        </header>
        <div className="grid gap-3 p-5">
          <div>
            <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate">Delivery Date *</label>
            <input type="date" value={form.delivery_date} onChange={(e) => set("delivery_date", e.target.value)} className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
          </div>
          <div>
            <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate">Receiving Store</label>
            <select value={form.store_id} onChange={(e) => set("store_id", e.target.value)} className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper">
              <option value="">No stock store selected</option>
              {stores.map((store) => <option key={store.id} value={store.id}>{tx(store.name ?? store.store_code, store.id)}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate">Delivery Note Ref</label>
            <input value={form.delivery_note_ref} onChange={(e) => set("delivery_note_ref", e.target.value)} className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
          </div>
          <div>
            <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate">Condition Notes</label>
            <textarea value={form.condition_notes} onChange={(e) => set("condition_notes", e.target.value)} rows={3} className="w-full resize-none border border-ink-mid bg-ink-light p-3 text-sm text-paper" />
          </div>
        </div>
        <footer className="flex justify-end gap-2 border-t border-ink-mid p-4">
          <button onClick={onClose} className="h-9 border border-ink-mid px-3 font-mono text-xs uppercase text-slate-light hover:text-paper">Cancel</button>
          <button onClick={() => onSubmit({ po_id: po.id, store_id: form.store_id || null, delivery_date: form.delivery_date, delivery_note_ref: form.delivery_note_ref || null, condition_notes: form.condition_notes || null })} disabled={saving || !form.delivery_date} className="inline-flex h-9 items-center gap-2 border border-emerald-500/50 bg-emerald-950/30 px-4 font-mono text-xs font-bold uppercase text-emerald-300 disabled:opacity-40">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />}Confirm delivery
          </button>
        </footer>
      </div>
    </div>
  );
}


export function SupplierInvoiceModal({ po, saving, onSubmit, onClose }: { po: Rec; saving: boolean; onSubmit: (payload: Record<string, unknown>) => void; onClose: () => void; }) {
  const [form, setForm] = useState({ grn_id: "", supplier_invoice_ref: "", invoice_date: new Date().toISOString().slice(0, 10), due_date: "", subtotal: String(num(po.total_amount ?? 0)), tax_amount: "0", notes: "" });
  const grns: Rec[] = Array.isArray(po.grns) ? po.grns : Array.isArray(po.goods_receipts) ? po.goods_receipts : [];
  const set = (key: string, value: string) => setForm((prev) => ({ ...prev, [key]: value }));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg border border-ink-mid bg-ink text-paper shadow-2xl">
        <header className="flex items-center justify-between border-b border-ink-mid p-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-signal">Register Supplier Invoice</p>
            <h2 className="mt-1 text-lg font-semibold">{tx(po.po_number ?? po.reference_number, po.id.slice(0, 8).toUpperCase())}</h2>
          </div>
          <button onClick={onClose} className="text-slate-light hover:text-paper"><X className="h-4 w-4" /></button>
        </header>
        <div className="grid gap-3 p-5">
          <div>
            <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate">Supplier Invoice Ref *</label>
            <input value={form.supplier_invoice_ref} onChange={(e) => set("supplier_invoice_ref", e.target.value)} className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
          </div>
          <div>
            <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate">Confirmed delivery</label>
            <select value={form.grn_id} onChange={(e) => set("grn_id", e.target.value)} className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper">
              <option value="">No delivery selected</option>
              {grns.map((grn) => <option key={grn.id} value={grn.id}>{tx(grn.grn_number, grn.id)}</option>)}
            </select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate">Invoice Date *</label>
              <input type="date" value={form.invoice_date} onChange={(e) => set("invoice_date", e.target.value)} className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
            </div>
            <div>
              <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate">Due Date</label>
              <input type="date" value={form.due_date} onChange={(e) => set("due_date", e.target.value)} className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
            </div>
            <div>
              <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate">Subtotal *</label>
              <input type="number" min="0" value={form.subtotal} onChange={(e) => set("subtotal", e.target.value)} className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
            </div>
            <div>
              <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate">Tax</label>
              <input type="number" min="0" value={form.tax_amount} onChange={(e) => set("tax_amount", e.target.value)} className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
            </div>
          </div>
        </div>
        <footer className="flex justify-end gap-2 border-t border-ink-mid p-4">
          <button onClick={onClose} className="h-9 border border-ink-mid px-3 font-mono text-xs uppercase text-slate-light hover:text-paper">Cancel</button>
          <button onClick={() => onSubmit({ po_id: po.id, grn_id: form.grn_id || null, supplier_invoice_ref: form.supplier_invoice_ref, invoice_date: form.invoice_date, due_date: form.due_date || null, subtotal: num(form.subtotal), tax_amount: num(form.tax_amount), notes: form.notes || null })} disabled={saving || !form.supplier_invoice_ref || !form.invoice_date} className="inline-flex h-9 items-center gap-2 border border-blue-500/50 bg-blue-950/30 px-4 font-mono text-xs font-bold uppercase text-blue-300 disabled:opacity-40">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}Register Invoice
          </button>
        </footer>
      </div>
    </div>
  );
}


// ─── PO Detail Drawer ─────────────────────────────────────────────────────────

export function PODetailDrawer({ po, saving, can = () => false, isSuperAdmin = false, userId = null, onApprove, onReject, onIssue, onReceive, onInvoice, onMatchInvoice, onApprovePayment, onClose }: { po: Rec; saving: string | null; can?: (permission: string) => boolean; isSuperAdmin?: boolean; userId?: string | null; onApprove: (po: Rec) => void; onReject?: (po: Rec) => void; onIssue: (po: Rec, override?: boolean) => void; onReceive: (po: Rec) => void; onInvoice: (po: Rec) => void; onMatchInvoice: (invoice: Rec) => void; onApprovePayment: (invoice: Rec) => void; onClose: () => void; }) {
  const lines: Rec[] = Array.isArray(po.lines) ? po.lines : Array.isArray(po.line_items) ? po.line_items : [];
  const grns: Rec[] = Array.isArray(po.grns) ? po.grns : Array.isArray(po.goods_receipts) ? po.goods_receipts : [];
  const invLines: Rec[] = Array.isArray(po.invoices) ? po.invoices : [];
  const status = tx(po.status, "draft").toLowerCase();
  const hasIssued = ["issued", "partially_received", "received", "invoiced", "closed"].includes(status) || Boolean(po.issued_at ?? po.issued_date);
  const hasGrn = grns.length > 0 || ["partially_received", "received", "closed"].includes(status);
  const hasInvoice = invLines.length > 0;
  const hasMatchedInvoice = invLines.some((inv) => tx(inv.match_status ?? inv.matching_status).toLowerCase() === "matched");
  const hasPaymentApproval = invLines.some((inv) => ["approved", "payment_approved", "approved_for_payment", "paid"].includes(tx(inv.status).toLowerCase()) || ["approved", "paid"].includes(tx(inv.payment_status).toLowerCase()));
  const signoff = poSignoffStep(po);
  const signedBy = (name: unknown, at: unknown, fallback: string) => (at ? `${tx(name, "Signed")} · ${dt(at)}` : fallback);
  const progressSteps = [
    { label: "Ordered", detail: "Supplier and approved request captured", complete: true },
    { label: "Finance sign-off", detail: signedBy(po.finance_signed_off_by_name, po.finance_signed_off_at, hasIssued && po.signoff_override_reason ? "Skipped - superadmin override" : "Finance checks the order against the budget"), complete: Boolean(po.finance_signed_off_at) || hasIssued },
    { label: "Director sign-off", detail: signedBy(po.director_signed_off_by_name, po.director_signed_off_at, hasIssued && po.signoff_override_reason ? "Skipped - superadmin override" : "A director approves the order for issue"), complete: Boolean(po.director_signed_off_at) || hasIssued },
    { label: "Sent to supplier", detail: "PO issued; budget reserved for the project", complete: hasIssued },
    { label: "Delivered", detail: "Goods received on site and booked into stock", complete: hasGrn },
    { label: "Invoice received", detail: "Supplier invoice registered against this PO", complete: hasInvoice },
    { label: "Invoice checked", detail: "Invoice matches the order and what was delivered", complete: hasMatchedInvoice },
    { label: "Ready to pay", detail: "Payment approved with the supporting documents", complete: hasPaymentApproval },
  ];
  const doneCount = progressSteps.filter((step) => step.complete).length;
  const openInvoice = invLines.find((inv) => tx(inv.match_status ?? inv.matching_status).toLowerCase() !== "matched");
  const unpaidMatchedInvoice = invLines.find(
    (inv) =>
      tx(inv.match_status ?? inv.matching_status).toLowerCase() === "matched" &&
      !["approved", "payment_approved", "approved_for_payment", "paid"].includes(tx(inv.status).toLowerCase()) &&
      !["approved", "paid"].includes(tx(inv.payment_status).toLowerCase()),
  );

  // Every action this PO allows right now. One is "the next step"; the rest
  // sit under "More actions" so the drawer never shows a wall of buttons.
  type DrawerAction = { key: string; label: string; hint: string; icon: ReactNode; onClick: () => void; busy?: boolean };
  const actions: DrawerAction[] = [];
  const unissued = ["draft", "approved"].includes(status);
  const raisedByMe = !isSuperAdmin && Boolean(userId) && String(po.created_by ?? "") === userId;
  if (unissued && signoff !== "done" && !raisedByMe && can(`procurement.po.${signoff}_signoff`)) {
    const finance = signoff === "finance";
    actions.push({ key: "approve", label: finance ? "Finance sign-off" : "Director sign-off", hint: finance ? "Approve this order against the budget. A director signs off next." : "Final approval. Procurement can then send it to the supplier.", icon: <CheckCircle2 className="h-4 w-4" />, onClick: () => onApprove(po), busy: saving === `approve-po-${po.id}` });
    if (onReject) actions.push({ key: "reject", label: "Send back to procurement", hint: "Reject with a reason. The order returns to draft and both sign-offs restart.", icon: <X className="h-4 w-4" />, onClick: () => onReject(po), busy: saving === `reject-po-${po.id}` });
  }
  if (poReadyToIssue(po) && can("procurement.po.issue")) {
    actions.push({ key: "issue", label: "Send to supplier (issue PO)", hint: "Issues the order and reserves the budget for this project.", icon: <Send className="h-4 w-4" />, onClick: () => onIssue(po), busy: saving === `issue-po-${po.id}` });
  } else if (unissued && isSuperAdmin) {
    actions.push({ key: "override", label: "Override sign-offs and send", hint: "Superadmin: issue now without the missing sign-offs. You'll be asked for a reason, which is recorded on the PO.", icon: <ShieldAlert className="h-4 w-4" />, onClick: () => onIssue(po, true), busy: saving === `issue-po-${po.id}` });
  }
  if (["issued", "partially_received"].includes(status)) {
    actions.push({ key: "receive", label: "Record delivery", hint: "Log what arrived on site and book it into stock.", icon: <PackageCheck className="h-4 w-4" />, onClick: () => onReceive(po) });
  }
  if (["received", "partially_received"].includes(status)) {
    actions.push({ key: "invoice", label: "Register supplier invoice", hint: "Capture the supplier invoice for this order.", icon: <FileText className="h-4 w-4" />, onClick: () => onInvoice(po) });
  }
  if (openInvoice) {
    actions.push({ key: "check", label: "Check invoice", hint: "Compare the invoice with the order and the delivery before paying.", icon: <ShieldAlert className="h-4 w-4" />, onClick: () => onMatchInvoice(openInvoice), busy: saving === `match-invoice-${openInvoice.id}` });
  }
  if (unpaidMatchedInvoice) {
    actions.push({ key: "pay", label: "Approve payment", hint: "Approve paying this invoice, with its supporting documents.", icon: <CheckCircle2 className="h-4 w-4" />, onClick: () => onApprovePayment(unpaidMatchedInvoice), busy: saving === `pay-invoice-${unpaidMatchedInvoice.id}` });
  }
  // The furthest-along action is the one that moves the order forward.
  // A partly delivered order should finish its delivery before invoicing.
  const preferred = ["pay", "check", "invoice", "receive", "issue", "approve"].find(
    (key) => !(key === "invoice" && status === "partially_received") && actions.some((a) => a.key === key),
  );
  const nextAction = actions.find((a) => a.key === preferred) ?? actions[0];
  const moreActions = actions.filter((a) => a !== nextAction);

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm">
      <aside className="ml-auto flex h-full w-full max-w-3xl flex-col overflow-y-auto border-l border-ink-mid bg-ink text-paper shadow-2xl">
        <header className="sticky top-0 z-10 flex items-start justify-between border-b border-ink-mid bg-ink p-5">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-signal">Purchase Order</p>
            <h2 className="mt-1 text-2xl font-semibold">{tx(po.po_number ?? po.reference_number, po.id.slice(0, 8).toUpperCase())}</h2>
            <p className="mt-1 text-xs text-slate-light">
              {tx(po.supplier_name)} · {tx(po.project_name ?? po.project)} ·{" "}
              <span className={`border px-1.5 py-0.5 font-mono text-[10px] uppercase ${poStatusClass(po.status)}`}>{tx(po.status).replace(/_/g, " ")}</span>
            </p>
          </div>
          <button onClick={onClose} className="border border-ink-mid p-2 text-slate-light hover:border-signal hover:text-paper"><X className="h-5 w-5" /></button>
        </header>
        <div className="space-y-5 p-5">
          <section className="border border-signal/25 bg-signal/5 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="font-mono text-[10px] uppercase tracking-widest text-signal">Progress</p>
              <span className="font-mono text-[10px] uppercase text-slate-light">{doneCount} of {progressSteps.length} done</span>
            </div>
            <ol className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {progressSteps.map((step, index) => (
                <li key={step.label} title={step.detail}
                  className={`border p-2 ${step.complete ? "border-emerald-500/30 bg-emerald-950/10" : "border-ink-mid bg-ink/60"}`}>
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className={`h-3.5 w-3.5 shrink-0 ${step.complete ? "text-emerald-300" : "text-slate"}`} />
                    <span className="font-mono text-[9px] text-slate">{index + 1}</span>
                  </div>
                  <p className={`mt-1 text-xs font-semibold ${step.complete ? "text-emerald-200" : "text-slate-light"}`}>{step.label}</p>
                </li>
              ))}
            </ol>
          </section>

          <section className="border border-ink-mid bg-ink-light/30 p-4">
            {nextAction ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-[10px] uppercase tracking-widest text-slate">Next step</p>
                  <p className="mt-1 text-sm text-slate-light">{nextAction.hint}</p>
                </div>
                <button onClick={nextAction.onClick} disabled={nextAction.busy}
                  className="inline-flex h-10 items-center gap-2 border border-signal bg-signal px-4 font-mono text-xs font-bold uppercase tracking-wider text-ink hover:bg-signal/90 disabled:opacity-50">
                  {nextAction.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : nextAction.icon}{nextAction.label}
                </button>
              </div>
            ) : (
              <p className="text-sm text-slate-light">
                <CheckCircle2 className="mr-1.5 inline h-4 w-4 text-emerald-300" />
                Nothing to do on this order right now.
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-start gap-2 border-t border-ink-mid pt-3">
              <PoPdfButton po={po} />
              {moreActions.length > 0 && (
                <details>
                  <summary className="inline-flex h-9 cursor-pointer list-none items-center gap-2 border border-ink-mid px-3 font-mono text-xs uppercase text-slate-light hover:border-signal hover:text-paper">
                    More actions ({moreActions.length})
                  </summary>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {moreActions.map((action) => (
                      <button key={action.key} onClick={action.onClick} disabled={action.busy} title={action.hint}
                        className="inline-flex h-9 items-center gap-2 border border-ink-mid px-3 font-mono text-xs uppercase text-slate-light hover:border-signal hover:text-paper disabled:opacity-40">
                        {action.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : action.icon}{action.label}
                      </button>
                    ))}
                  </div>
                </details>
              )}
            </div>
          </section>

          <div className="grid gap-3 sm:grid-cols-3">
            <InfoCard label="Total Amount" value={money(po.total_amount ?? po.amount ?? 0)} tone="text-signal" />
            <InfoCard label="Issued Date" value={dt(po.issued_at ?? po.issued_date ?? po.created_at)} />
            <InfoCard label="Expected Delivery" value={dt(po.required_by_date ?? po.expected_delivery_date ?? po.expected_delivery)} />
          </div>

          {/* Delivery & Logistics Milestone Stepper */}
          <section className="border border-ink-mid bg-ink/70 p-4">
            <div className="flex items-center justify-between pb-3 border-b border-ink-mid">
              <div className="flex items-center gap-2">
                <Truck className="h-4 w-4 text-signal" />
                <h4 className="font-mono text-xs font-semibold uppercase tracking-wider text-paper">
                  Delivery Milestones & ETA Tracking
                </h4>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] uppercase text-slate">ETA:</span>
                <span className={`font-mono text-xs font-semibold ${isPoOverdue(po) ? "text-red-300" : "text-signal"}`}>
                  {dt(po.expected_delivery_date ?? po.expected_delivery)}
                </span>
                {isPoOverdue(po) && (
                  <span className="border border-red-500/50 bg-red-950/40 px-1.5 py-0.5 font-mono text-[9px] uppercase text-red-300">
                    Overdue
                  </span>
                )}
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 sm:grid-cols-5 gap-2">
              {[
                { key: "sent", label: "1. Sent", detail: "PO issued to vendor", done: hasIssued },
                { key: "confirmed", label: "2. Confirmed", detail: "Vendor acknowledged", done: hasIssued && (po.delivery_milestone === "confirmed" || po.delivery_milestone === "dispatched" || po.delivery_milestone === "gate_arrival" || hasGrn) },
                { key: "dispatched", label: "3. Dispatched", detail: "In transit / dispatch ref", done: hasIssued && (po.delivery_milestone === "dispatched" || po.delivery_milestone === "gate_arrival" || hasGrn) },
                { key: "gate_arrival", label: "4. At Gate", detail: "Site delivery arrived", done: hasIssued && (po.delivery_milestone === "gate_arrival" || hasGrn) },
                { key: "stocked", label: "5. Stocked", detail: "Delivery checked & booked into stock", done: hasGrn },
              ].map((step) => (
                <div
                  key={step.key}
                  className={`border p-2.5 flex flex-col justify-between ${
                    step.done
                      ? "border-emerald-500/40 bg-emerald-950/15"
                      : "border-ink-mid bg-ink-light/20"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className={`font-mono text-[11px] font-bold uppercase ${step.done ? "text-emerald-300" : "text-slate"}`}>
                      {step.label}
                    </span>
                    {step.done ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                    ) : (
                      <div className="h-2 w-2 rounded-full bg-slate/40" />
                    )}
                  </div>
                  <p className="mt-1 text-[10px] text-slate-light leading-tight">{step.detail}</p>
                </div>
              ))}
            </div>
          </section>

          {/* PO Lines */}
          <section className="border border-ink-mid">
            <div className="border-b border-ink-mid bg-ink-light/40 px-4 py-3">
              <p className="font-mono text-[10px] uppercase tracking-wider text-slate">Order lines ({lines.length})</p>
            </div>
            {lines.length === 0 ? <p className="p-4 text-sm text-slate-light">No line items on this PO.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[500px] text-sm">
                  <thead><tr className="border-b border-ink-mid text-left">{["Description", "Qty", "UOM", "Unit Price", "Line Total"].map((h) => <th key={h} className="px-4 py-2 font-mono text-[10px] uppercase text-slate">{h}</th>)}</tr></thead>
                  <tbody className="divide-y divide-ink-mid">
                    {lines.map((line, i) => (
                      <tr key={line.id ?? i}>
                        <td className="px-4 py-2 text-paper">{tx(line.description ?? line.item_description)}</td>
                        <td className="px-4 py-2 font-mono text-slate-light">{num(line.qty ?? line.quantity)}</td>
                        <td className="px-4 py-2 text-slate-light">{tx(line.uom ?? line.unit_of_measure)}</td>
                        <td className="px-4 py-2 font-mono text-paper">{money(line.unit_price ?? line.unit_cost ?? 0)}</td>
                        <td className="px-4 py-2 font-mono text-paper">{money(num(line.qty ?? line.quantity) * num(line.unit_price ?? line.unit_cost ?? 0))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          {/* GRN history */}
          <section className="border border-ink-mid">
            <div className="border-b border-ink-mid bg-ink-light/40 px-4 py-3 flex items-center gap-2">
              <Truck className="h-4 w-4 text-slate" />
              <p className="font-mono text-[10px] uppercase tracking-wider text-slate">Deliveries ({grns.length})</p>
            </div>
            {grns.length === 0 ? <p className="p-4 text-sm text-slate-light">No goods receipts recorded yet.</p> : (
              <div className="divide-y divide-ink-mid">
                {grns.map((grn, i) => (
                  <div key={grn.id ?? i} className="grid grid-cols-[1fr_auto] gap-4 px-4 py-3">
                    <div>
                      <p className="text-sm text-paper">{tx(grn.grn_number ?? grn.reference_number)}</p>
                      <p className="mt-0.5 text-xs text-slate-light">{dt(grn.received_date ?? grn.created_at)} · Received by {tx(grn.received_by)}</p>
                    </div>
                    <span className={`self-start border px-2 py-0.5 font-mono text-[10px] uppercase ${prStatusClass(grn.status)}`}>{tx(grn.status)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
          {/* Invoice matching */}
          <section className="border border-ink-mid">
            <div className="border-b border-ink-mid bg-ink-light/40 px-4 py-3 flex items-center gap-2">
              <FileText className="h-4 w-4 text-slate" />
              <p className="font-mono text-[10px] uppercase tracking-wider text-slate">Supplier invoices ({invLines.length})</p>
            </div>
            {invLines.length === 0 ? <p className="p-4 text-sm text-slate-light">No invoices linked to this PO.</p> : (
              <div className="divide-y divide-ink-mid">
                {invLines.map((inv, i) => {
                  const matchStatus = tx(inv.match_status ?? inv.matching_status, "unmatched").toLowerCase();
                  const paymentStatus = tx(inv.payment_status ?? inv.status, "pending").toLowerCase();
                  const matched = matchStatus === "matched";
                  const paymentApproved = ["payment_approved", "approved_for_payment", "approved", "paid"].includes(paymentStatus);
                  return (
                  <div key={inv.id ?? i} className="grid gap-4 px-4 py-3 md:grid-cols-[1fr_auto]">
                    <div>
                      <p className="text-sm text-paper">{tx(inv.invoice_number ?? inv.reference_number)}</p>
                      <p className="mt-0.5 text-xs text-slate-light">{dt(inv.invoice_date)} · {money(inv.total_amount ?? 0)}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <span className={`border px-2 py-0.5 font-mono text-[10px] uppercase ${matchStatusClass(inv.match_status ?? inv.matching_status)}`}>{tx(inv.match_status ?? inv.matching_status, "unmatched")}</span>
                        <span className={`border px-2 py-0.5 font-mono text-[10px] uppercase ${prStatusClass(inv.status)}`}>{tx(inv.status)}</span>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-start justify-end gap-2">
                      {!matched && (
                        <button onClick={() => onMatchInvoice(inv)} disabled={saving === `match-invoice-${inv.id}`}
                          className="inline-flex h-8 items-center gap-1.5 border border-emerald-500/40 px-2 font-mono text-[10px] uppercase text-emerald-300 hover:bg-emerald-950/30 disabled:opacity-40">
                          {saving === `match-invoice-${inv.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}Three-way match
                        </button>
                      )}
                      {matched && !paymentApproved && (
                        <button onClick={() => onApprovePayment(inv)} disabled={saving === `pay-invoice-${inv.id}`}
                          className="inline-flex h-8 items-center gap-1.5 border border-signal/50 px-2 font-mono text-[10px] uppercase text-signal hover:bg-signal/10 disabled:opacity-40">
                          {saving === `pay-invoice-${inv.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldAlert className="h-3.5 w-3.5" />}Approve with evidence
                        </button>
                      )}
                      {paymentApproved && <span className="border border-emerald-500/40 bg-emerald-950/20 px-2 py-1 font-mono text-[10px] uppercase text-emerald-300">Payment gate cleared</span>}
                    </div>
                  </div>
                );})}
              </div>
            )}
          </section>
        </div>
      </aside>
    </div>
  );
}
