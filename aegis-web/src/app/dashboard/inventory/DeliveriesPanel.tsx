"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, PackageCheck, PackagePlus, Search, Truck, X } from "lucide-react";
import { DELIVERY_BUCKETS, deliveryBucket, expectedDate, matchesDeliverySearch, outstandingLines, sortedOpenDeliveries } from "@/components/procurement/deliveries";
import { tx, money, qty, type Rec } from "./page";
import { StatStrip } from "./InventoryTabPanels";

const dayFmt = new Intl.DateTimeFormat("en-ZW", { dateStyle: "medium" });
const poLabel = (po: Rec) => tx(po.po_number ?? po.reference_number, po.id.slice(0, 8).toUpperCase());

function LinesSummary({ po }: { po: Rec }) {
  const lines = outstandingLines(po);
  if (!lines.length) return <p className="text-xs text-slate">Line detail not available - the full outstanding order will be booked.</p>;
  const shown = lines.slice(0, 3);
  return (
    <p className="truncate text-xs text-slate-light">
      {shown.map((l) => `${qty(l.outstanding)} ${tx(l.unit_of_measure ?? l.uom, "")} ${tx(l.description ?? l.item_description)}`.replace(/\s+/g, " ")).join(" · ")}
      {lines.length > shown.length && <span className="text-slate"> · +{lines.length - shown.length} more</span>}
    </p>
  );
}

// ─── Expected deliveries: the storekeeper's day ─────────────────────────────

export function ExpectedDeliveriesTab({ orders, loading, loadFailed, canReceive, onReceive, onReceiveWithoutPO }: {
  orders: Rec[];
  loading: boolean;
  loadFailed: boolean;
  canReceive: boolean;
  onReceive: (po: Rec) => void;
  onReceiveWithoutPO: () => void;
}) {
  const [search, setSearch] = useState("");
  const open = useMemo(() => sortedOpenDeliveries(orders), [orders]);
  const rows = useMemo(() => open.filter((po) => matchesDeliverySearch(po, search)), [open, search]);
  const counts = useMemo(() => {
    const c = { overdue: 0, today: 0, week: 0, later: 0, undated: 0 };
    open.forEach((po) => { c[deliveryBucket(po)] += 1; });
    return c;
  }, [open]);

  if (loadFailed) {
    return (
      <div className="border border-ink-mid bg-ink p-8 text-center">
        <Truck className="mx-auto h-8 w-8 text-slate" />
        <p className="mt-3 text-sm text-paper">Purchase orders could not be loaded.</p>
        <p className="mt-1 text-xs text-slate-light">Your role may not be able to see purchase orders yet. You can still receive stock without a PO.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <StatStrip stats={[
        { label: "Overdue", value: String(counts.overdue), tone: counts.overdue ? "text-red-300" : "text-slate-light" },
        { label: "Due today", value: String(counts.today), tone: counts.today ? "text-amber-300" : "text-slate-light" },
        { label: "Next 7 days", value: String(counts.week) },
        { label: "Later / no date", value: String(counts.later + counts.undated) },
      ]} />

      <section className="border border-ink-mid bg-ink">
        <div className="flex flex-wrap items-center gap-2 border-b border-ink-mid p-3">
          <label className="flex h-9 min-w-[12rem] flex-1 items-center gap-2 border border-ink-mid bg-ink-light px-3 sm:max-w-xs">
            <Search className="h-4 w-4 shrink-0 text-slate" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="PO, supplier, project, material…" className="w-full bg-transparent text-sm outline-none placeholder:text-slate" />
            {search && <button type="button" onClick={() => setSearch("")} className="text-slate hover:text-paper"><X className="h-3.5 w-3.5" /></button>}
          </label>
          <p className="ml-auto text-xs text-slate-light">Orders sent to suppliers that still have goods to arrive.</p>
        </div>

        {loading && orders.length === 0 ? (
          <p className="p-8 text-center text-sm text-slate-light">Loading deliveries…</p>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center">
            <PackageCheck className="mx-auto h-8 w-8 text-emerald-300" />
            <p className="mt-3 text-sm text-paper">{open.length ? "No deliveries match this search." : "Nothing is waiting to be delivered."}</p>
            <p className="mt-1 text-xs text-slate-light">Deliveries show up here once a purchase order is sent to the supplier.</p>
          </div>
        ) : (
          DELIVERY_BUCKETS.map((bucket) => {
            const group = rows.filter((po) => deliveryBucket(po) === bucket.key);
            if (!group.length) return null;
            const hot = bucket.key === "overdue";
            return (
              <div key={bucket.key}>
                <p className={`border-b border-ink-mid bg-ink-light/40 px-4 py-2 font-mono text-[10px] uppercase tracking-widest ${hot ? "text-red-300" : bucket.key === "today" ? "text-amber-300" : "text-signal"}`}>
                  {bucket.label} ({group.length})
                </p>
                <ul className="divide-y divide-ink-mid">
                  {group.map((po) => {
                    const due = expectedDate(po);
                    return (
                      <li key={po.id} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-ink-light/30">
                        <div className="min-w-0 flex-1">
                          <p className={`flex flex-wrap items-center gap-x-2 text-sm font-semibold ${hot ? "text-red-300" : "text-paper"}`}>
                            {hot && <AlertTriangle className="h-3.5 w-3.5 shrink-0" />}
                            <span className="font-mono text-signal">{poLabel(po)}</span>
                            <span>{tx(po.supplier_name)}</span>
                          </p>
                          <p className="mt-0.5 text-xs text-slate-light">
                            {tx(po.project_name, "No project")} · {due ? `due ${dayFmt.format(due)}` : "no delivery date"}
                            {tx(po.status) === "partially_received" && <span className="ml-1 text-amber-300">· part delivered</span>}
                          </p>
                          <LinesSummary po={po} />
                        </div>
                        <span className="font-mono text-sm text-paper">{money(po.total_amount ?? po.amount)}</span>
                        {canReceive && (
                          <button type="button" onClick={() => onReceive(po)}
                            className="inline-flex h-9 items-center gap-1.5 border border-emerald-500/50 bg-emerald-950/30 px-3 font-mono text-[11px] font-bold uppercase text-emerald-300 hover:bg-emerald-950/50">
                            <PackageCheck className="h-3.5 w-3.5" />Receive
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-mid px-4 py-2">
          <span className="font-mono text-[10px] uppercase text-slate">{rows.length} of {open.length} open orders</span>
          <button type="button" onClick={onReceiveWithoutPO} className="inline-flex items-center gap-1 font-mono text-[10px] uppercase text-slate-light hover:text-paper">
            Delivery with no purchase order<ArrowRight className="h-3 w-3" />
          </button>
        </div>
      </section>
    </div>
  );
}

// ─── Receive: "Which PO is this delivery for?" ──────────────────────────────

export function ReceiveChooserModal({ orders, onPickPO, onNoPO, onClose }: {
  orders: Rec[];
  onPickPO: (po: Rec) => void;
  onNoPO: () => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const open = useMemo(() => sortedOpenDeliveries(orders), [orders]);
  const rows = useMemo(() => open.filter((po) => matchesDeliverySearch(po, search)), [open, search]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col border border-ink-mid bg-ink text-paper shadow-2xl">
        <header className="flex items-center justify-between border-b border-ink-mid p-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-emerald-300">Receive a delivery</p>
            <h2 className="mt-1 text-lg font-semibold">Which purchase order is this for?</h2>
          </div>
          <button onClick={onClose} className="text-slate-light hover:text-paper" aria-label="Close"><X className="h-4 w-4" /></button>
        </header>
        <div className="border-b border-ink-mid p-3">
          <label className="flex h-10 items-center gap-2 border border-ink-mid bg-ink-light px-3">
            <Search className="h-4 w-4 shrink-0 text-slate" />
            <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Type the PO number, supplier or material on the delivery note…" className="w-full bg-transparent text-sm outline-none placeholder:text-slate" />
          </label>
        </div>
        <ul className="flex-1 divide-y divide-ink-mid overflow-y-auto">
          {rows.length === 0 ? (
            <li className="p-6 text-center text-sm text-slate-light">{open.length ? "No open order matches. Check the delivery note, or receive it without a PO below." : "No purchase orders are waiting for delivery."}</li>
          ) : rows.map((po) => {
            const bucket = deliveryBucket(po);
            const due = expectedDate(po);
            return (
              <li key={po.id}>
                <button type="button" onClick={() => onPickPO(po)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-ink-light/40">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-x-2 text-sm">
                      <span className="font-mono text-signal">{poLabel(po)}</span>
                      <span className="font-semibold text-paper">{tx(po.supplier_name)}</span>
                      {bucket === "overdue" && <span className="border border-red-500/40 px-1 font-mono text-[9px] uppercase text-red-300">Late</span>}
                      {bucket === "today" && <span className="border border-amber-500/40 px-1 font-mono text-[9px] uppercase text-amber-300">Today</span>}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-light">{tx(po.project_name, "No project")}{due ? ` · due ${dayFmt.format(due)}` : ""}</p>
                    <LinesSummary po={po} />
                  </div>
                  <ArrowRight className="h-4 w-4 shrink-0 text-slate" />
                </button>
              </li>
            );
          })}
        </ul>
        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-mid p-4">
          <p className="max-w-sm text-xs text-slate-light">Cash buy, emergency purchase or transfer-in with no PO? Record it separately - you will be asked why.</p>
          <button type="button" onClick={onNoPO} className="inline-flex h-9 items-center gap-2 border border-ink-mid px-3 font-mono text-xs uppercase text-slate-light hover:border-signal hover:text-paper">
            <PackagePlus className="h-4 w-4" />No PO
          </button>
        </footer>
      </div>
    </div>
  );
}
