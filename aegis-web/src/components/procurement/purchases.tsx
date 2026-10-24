"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import { type Rec, EmptyState, dt, money } from "@/components/procurement/shared";
import { RequisitionsTable, RfqsTab } from "@/components/procurement/requests";
import { OrdersTable } from "@/components/procurement/orders";
import { InvoicesTab } from "@/components/procurement/invoices";
import { STAGES, type Purchase } from "@/components/procurement/journey";

export const PURCHASE_FILTERS: [string, string][] = [
  ["active", "In progress"],
  ["approval", "Awaiting approval"],
  ["order", "To order"],
  ["delivery", "Awaiting delivery"],
  ["invoice", "Invoicing"],
  ["payment", "To pay"],
  ["done", "Done"],
  ["stopped", "Rejected / cancelled"],
];

export function matchesPurchaseFilter(p: Purchase, filter: string): boolean {
  if (filter === "all") return true;
  if (filter === "active") return p.stage !== "done" && p.stage !== "stopped";
  if (filter === "overdue") return p.overdue;
  return p.stage === filter;
}

function StageBar({ purchase }: { purchase: Purchase }) {
  const steps = STAGES.slice(0, 6); // Request..Payment; "done" fills them all
  const reached = purchase.stage === "done" ? steps.length : purchase.stageIndex;
  return (
    <div className="flex items-center gap-1" title={STAGES.map((s) => s.label).join(" > ")}>
      {steps.map((step, index) => (
        <span
          key={step.key}
          className={`h-1.5 w-5 rounded-full ${
            purchase.stage === "stopped" ? "bg-red-900/60" : index < reached ? "bg-emerald-500" : index === reached ? "bg-signal" : "bg-ink-mid"
          }`}
        />
      ))}
    </div>
  );
}

function stageLabel(p: Purchase) {
  if (p.stage === "stopped") return "Stopped";
  return STAGES.find((s) => s.key === p.stage)?.label ?? p.stage;
}

export function PurchasesView({
  purchases,
  expandedId,
  onToggle,
  saving,
  requestHandlers,
  rfqHandlers,
  onViewOrder,
  invoiceHandlers,
}: {
  purchases: Purchase[];
  expandedId: string | null;
  onToggle: (id: string | null) => void;
  saving: string | null;
  requestHandlers: { onSubmit: (id: string) => void; onApprove: (row: Rec) => void; onCreateRFQ: (row: Rec) => void; onCreatePO: (row: Rec) => void };
  rfqHandlers: { onQuote: (row: Rec) => void; onDecideQuote: (rfq: Rec, response: Rec, decision: "selected" | "rejected" | "evaluated") => void; onCreatePO: (response: Rec) => void };
  onViewOrder: (row: Rec) => void;
  invoiceHandlers: { onMatch: (row: Rec) => void; onInspect: (row: Rec) => void; onApprovePayment: (row: Rec) => void };
}) {
  return (
    <div>
      {purchases.length === 0 ? (
        <EmptyState label="No purchases match this view." sub="A purchase starts as a request - use New request above." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-sm">
            <thead>
              <tr className="border-b border-ink-mid bg-ink-light/50 text-left">
                {["", "Purchase", "Project / what", "Stage", "Waiting on", "Amount", "Last activity"].map((h) => (
                  <th key={h} className="px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-slate">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-mid">
              {purchases.map((p) => {
                const open = expandedId === p.id;
                return (
                  <PurchaseRow key={p.id} purchase={p} open={open} onToggle={() => onToggle(open ? null : p.id)}>
                    {open && (
                      <tr>
                        <td colSpan={7} className="bg-ink-light/20 p-0">
                          <div className="space-y-3 border-l-2 border-signal p-4">
                            {p.request && (
                              <PurchasePart title="Request">
                                <RequisitionsTable rows={[p.request]} saving={saving} {...requestHandlers} />
                              </PurchasePart>
                            )}
                            {p.rfqs.length > 0 && (
                              <PurchasePart title={`Quotes (${p.rfqs.length})`}>
                                <RfqsTab rows={p.rfqs} saving={saving} {...rfqHandlers} />
                              </PurchasePart>
                            )}
                            {p.orders.length > 0 && (
                              <PurchasePart title={`Purchase orders (${p.orders.length}) - open one for its next step, PDF and deliveries`}>
                                <OrdersTable rows={p.orders} onView={onViewOrder} />
                              </PurchasePart>
                            )}
                            {p.invoices.length > 0 && (
                              <PurchasePart title={`Supplier invoices (${p.invoices.length})`}>
                                <InvoicesTab
                                  rows={p.invoices}
                                  unmatchedCount={p.invoices.filter((i) => String(i.match_status ?? "").toLowerCase() !== "matched").length}
                                  saving={saving}
                                  {...invoiceHandlers}
                                />
                              </PurchasePart>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </PurchaseRow>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="border-t border-ink-mid px-4 py-3 text-[11px] text-slate">
        Full lists:{" "}
        {[
          ["Purchase requests", "/dashboard/procurement/requisitions"],
          ["Quotes", "/dashboard/procurement/rfqs"],
          ["Purchase orders", "/dashboard/procurement/purchase-orders"],
          ["Supplier invoices", "/dashboard/procurement/invoices"],
          ["Pricing", "/dashboard/procurement/pricing"],
        ].map(([label, href], i) => (
          <span key={href}>
            {i > 0 && " · "}
            <Link href={href} className="text-slate-light underline-offset-2 hover:text-paper hover:underline">{label}</Link>
          </span>
        ))}
      </p>
    </div>
  );
}

function PurchaseRow({ purchase: p, open, onToggle, children }: { purchase: Purchase; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <>
      <tr onClick={onToggle} className={`cursor-pointer ${open ? "bg-signal/5" : "hover:bg-ink-light/40"}`}>
        <td className="w-8 px-3 py-3 text-slate">{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</td>
        <td className="px-4 py-3 font-mono text-xs text-signal">{p.number}</td>
        <td className="max-w-[320px] px-4 py-3">
          <p className="truncate text-paper">{p.project}</p>
          {p.title && <p className="truncate text-xs text-slate-light">{p.title}</p>}
        </td>
        <td className="px-4 py-3">
          <p className={`font-mono text-[10px] uppercase ${p.stage === "stopped" ? "text-red-300" : p.stage === "done" ? "text-emerald-300" : "text-paper"}`}>{stageLabel(p)}</p>
          <div className="mt-1"><StageBar purchase={p} /></div>
        </td>
        <td className={`px-4 py-3 text-xs ${p.overdue ? "text-red-300" : "text-slate-light"}`}>
          {p.waitingOn}
          {p.overdue && <span className="ml-2 border border-red-500/40 px-1 font-mono text-[9px] uppercase">Late</span>}
        </td>
        <td className="px-4 py-3 font-mono text-paper">{money(p.amount)}</td>
        <td className="px-4 py-3 text-xs text-slate-light">{p.updatedAt ? dt(new Date(p.updatedAt).toISOString()) : "—"}</td>
      </tr>
      {children}
    </>
  );
}

function PurchasePart({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border border-ink-mid bg-ink">
      <p className="border-b border-ink-mid px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-slate">{title}</p>
      {children}
    </section>
  );
}
