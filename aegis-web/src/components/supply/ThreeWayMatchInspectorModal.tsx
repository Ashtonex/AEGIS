"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronRight, DollarSign, FileText, Loader2, Package, ShieldAlert, X } from "lucide-react";
import { getInvoiceMatchInspection } from "@/lib/api";

interface InvoiceRecord extends Record<string, any> {
  id: string;
}

interface Props {
  invoice: InvoiceRecord;
  onClose: () => void;
  onMatch: (invoice: InvoiceRecord) => void | Promise<void>;
  onApprovePayment: (invoice: InvoiceRecord) => void;
  saving: string | null;
}

export function ThreeWayMatchInspectorModal({
  invoice,
  onClose,
  onMatch,
  onApprovePayment,
  saving,
}: Props) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const res = await getInvoiceMatchInspection(invoice.id);
        if (!cancelled && res.data) {
          setData(res.data);
          setError(null);
        }
      } catch (err: any) {
        if (!cancelled) setError(err?.message || "Failed to load 3-way match details.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [invoice.id]);

  const money = (val: number | string) => {
    const n = typeof val === "number" ? val : Number(val);
    return new Intl.NumberFormat("en-ZW", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(Number.isFinite(n) ? n : 0);
  };

  const qty = (val: number | string) => {
    const n = typeof val === "number" ? val : Number(val);
    return new Intl.NumberFormat("en-ZW", { maximumFractionDigits: 3 }).format(Number.isFinite(n) ? n : 0);
  };

  const summary = data?.summary;
  const isMatched = invoice.match_status === "matched" || summary?.match_status === "matched";
  const hasPO = Boolean(invoice.po_id);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col border border-ink-mid bg-ink text-paper shadow-2xl rounded-lg overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-ink-mid px-5 py-4 bg-ink-light/50">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs uppercase tracking-wider text-signal font-semibold">
                3-Way Match Inspector
              </span>
              <span className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase border ${
                isMatched ? "border-emerald-500/40 bg-emerald-950/20 text-emerald-300" :
                summary?.is_within_tolerance ? "border-amber-500/40 bg-amber-950/20 text-amber-300" :
                "border-rose-500/40 bg-rose-950/20 text-rose-300"
              }`}>
                {summary?.match_status || invoice.match_status || "Pending"}
              </span>
            </div>
            <h2 className="mt-1 text-lg font-semibold text-paper">
              Invoice #{invoice.invoice_number} · {invoice.supplier_name}
            </h2>
          </div>
          <button onClick={onClose} className="p-2 text-slate-light hover:text-paper border border-ink-mid rounded">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-light">
              <Loader2 className="h-8 w-8 animate-spin text-signal mb-2" />
              <p className="font-mono text-xs">Reconciling PO lines, GRN deliveries and invoice items...</p>
            </div>
          ) : error ? (
            <div className="p-4 rounded border border-rose-800/40 bg-rose-950/20 text-rose-300 text-xs font-mono">
              {error}
            </div>
          ) : (
            <>
              {/* Summary Reconciliation Strip */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div className="p-3 border border-ink-mid bg-ink-light rounded">
                  <span className="text-[10px] font-mono uppercase text-slate">Purchase Order Total</span>
                  <p className="mt-1 text-base font-mono font-semibold text-paper">{money(summary?.po_total ?? 0)}</p>
                  <p className="text-[10px] font-mono text-slate-light mt-0.5">PO #{invoice.po_number || "—"}</p>
                </div>
                <div className="p-3 border border-ink-mid bg-ink-light rounded">
                  <span className="text-[10px] font-mono uppercase text-slate">Billed Invoice Total</span>
                  <p className="mt-1 text-base font-mono font-semibold text-paper">{money(summary?.invoice_total ?? 0)}</p>
                  <p className="text-[10px] font-mono text-slate-light mt-0.5">Ref: {invoice.supplier_invoice_ref || "—"}</p>
                </div>
                <div className="p-3 border border-ink-mid bg-ink-light rounded">
                  <span className="text-[10px] font-mono uppercase text-slate">Matched / Approved</span>
                  <p className="mt-1 text-base font-mono font-semibold text-emerald-300">{money(summary?.matched_amount ?? 0)}</p>
                  <p className="text-[10px] font-mono text-slate-light mt-0.5">Legitimate goods received</p>
                </div>
                <div className={`p-3 border rounded ${Math.abs(summary?.variance_amount ?? 0) > 0.01 ? "border-amber-500/40 bg-amber-950/15" : "border-ink-mid bg-ink-light"}`}>
                  <span className="text-[10px] font-mono uppercase text-slate">Variance</span>
                  <p className={`mt-1 text-base font-mono font-semibold ${summary?.variance_amount > 0 ? "text-amber-300" : "text-emerald-300"}`}>
                    {money(summary?.variance_amount ?? 0)}
                  </p>
                  <p className="text-[10px] font-mono text-slate-light mt-0.5">{summary?.tolerance_note}</p>
                </div>
              </div>

              {/* Line-level Reconciliation Matrix */}
              <div className="space-y-4">
                <div>
                  <h3 className="font-mono text-xs uppercase tracking-wider text-slate mb-2">
                    Line Item Comparison: Purchase Order vs Confirmed Receipts
                  </h3>
                  <div className="border border-ink-mid rounded overflow-hidden">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-ink-mid bg-ink-light text-left text-slate font-mono uppercase text-[10px]">
                          <th className="p-2.5">Item Description</th>
                          <th className="p-2.5">PO Ordered</th>
                          <th className="p-2.5">PO Unit Price</th>
                          <th className="p-2.5">GRN Received</th>
                          <th className="p-2.5">Rejected</th>
                          <th className="p-2.5 text-right">Line Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-ink-mid font-mono">
                        {(data?.po_lines || []).length === 0 ? (
                          <tr>
                            <td colSpan={6} className="p-4 text-center text-slate">No PO lines linked (Store direct intake).</td>
                          </tr>
                        ) : (
                          data.po_lines.map((pol: any) => {
                            const grnMatches = (data?.grn_lines || []).filter((g: any) => g.po_line_id === pol.id);
                            const totalReceived = grnMatches.reduce((s: number, g: any) => s + Number(g.quantity_received || 0), 0);
                            const totalRejected = grnMatches.reduce((s: number, g: any) => s + Number(g.quantity_rejected || 0), 0);
                            const isQtyMatched = totalReceived >= Number(pol.po_qty);

                            return (
                              <tr key={pol.id} className="hover:bg-ink-light/30">
                                <td className="p-2.5 text-paper font-sans">{pol.description}</td>
                                <td className="p-2.5">{qty(pol.po_qty)} {pol.uom}</td>
                                <td className="p-2.5">{money(pol.po_unit_price)}</td>
                                <td className={`p-2.5 font-semibold ${isQtyMatched ? "text-emerald-300" : "text-amber-300"}`}>
                                  {qty(totalReceived)} {pol.uom}
                                </td>
                                <td className="p-2.5 text-rose-400">
                                  {totalRejected > 0 ? `${qty(totalRejected)} rej` : "0"}
                                </td>
                                <td className="p-2.5 text-right text-paper">{money(pol.po_line_total)}</td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Invoice Billed Lines */}
                {data?.invoice_lines && data.invoice_lines.length > 0 && (
                  <div>
                    <h3 className="font-mono text-xs uppercase tracking-wider text-slate mb-2">
                      Supplier Invoice Billed Lines
                    </h3>
                    <div className="border border-ink-mid rounded overflow-hidden">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-ink-mid bg-ink-light text-left text-slate font-mono uppercase text-[10px]">
                            <th className="p-2.5">Billed Description</th>
                            <th className="p-2.5">Billed Qty</th>
                            <th className="p-2.5">Ex-VAT Rate</th>
                            <th className="p-2.5">VAT</th>
                            <th className="p-2.5 text-right">Line Total</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-ink-mid font-mono">
                          {data.invoice_lines.map((il: any) => (
                            <tr key={il.id} className="hover:bg-ink-light/30">
                              <td className="p-2.5 text-paper font-sans">{il.description}</td>
                              <td className="p-2.5">{qty(il.inv_qty)}</td>
                              <td className="p-2.5">{money(il.inv_unit_cost)}</td>
                              <td className="p-2.5">{il.vat_rate}% ({money(il.vat_amount)})</td>
                              <td className="p-2.5 text-right text-paper">{money(il.inv_line_total)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between border-t border-ink-mid px-5 py-3 bg-ink-light/40">
          <div className="text-[11px] font-mono text-slate">
            {summary?.can_approve_payment ? (
              <span className="text-emerald-400 flex items-center gap-1">
                <CheckCircle2 className="h-3.5 w-3.5" /> Reconciled & eligible for payment evidence gate
              </span>
            ) : (
              <span className="text-amber-400 flex items-center gap-1">
                <AlertTriangle className="h-3.5 w-3.5" /> Match required before payment authorisation
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 border border-ink-mid rounded text-xs font-mono uppercase text-slate-light hover:text-paper"
            >
              Close
            </button>
            {!isMatched && hasPO && (
              <button
                onClick={() => {
                  onMatch(invoice);
                  onClose();
                }}
                disabled={saving === `match-invoice-${invoice.id}`}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-xs font-mono font-semibold uppercase text-white transition disabled:opacity-50"
              >
                Execute 3-Way Match
              </button>
            )}
            {summary?.can_approve_payment && invoice.status !== "approved" && (
              <button
                onClick={() => {
                  onClose();
                  onApprovePayment(invoice);
                }}
                disabled={saving === `pay-invoice-${invoice.id}`}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 rounded text-xs font-mono font-semibold uppercase text-white transition disabled:opacity-50"
              >
                Approve with Evidence
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
