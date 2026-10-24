"use client";

import { type ReactNode } from "react";
import { AlertTriangle, MapPin, Package, PackageCheck, ShieldAlert, ShoppingCart, Truck, Warehouse, XCircle } from "lucide-react";
import { KpiCard, LoadingState, type Rec, dt, money, num, poStatusClass, qty, tx } from "@/components/procurement/shared";


// ─── Procurement Manager Command Dashboard ───────────────────────────────────

export function ProcurementCommandDashboard({ command, loading }: { command: any; loading: boolean }) {
  if (loading && !command) return <LoadingState label="Loading command dashboard…" />;
  return (
    <div className="space-y-5 p-4">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <KpiCard icon={<Warehouse />} label="Stock Value" value={money(command.stockValueTotal)} tone="text-signal" />
        <KpiCard icon={<Package />} label="Materials" value={money(command.materialsValue)} />
        <KpiCard icon={<Truck />} label="Tools" value={money(command.toolsValue)} />
        <KpiCard icon={<AlertTriangle />} label="Low Stock" value={String(command.lowStock.length)} tone={command.lowStock.length ? "text-amber-300" : undefined} />
        <KpiCard icon={<XCircle />} label="Out of Stock" value={String(command.outOfStock.length)} tone={command.outOfStock.length ? "text-red-300" : undefined} />
        <KpiCard icon={<ShoppingCart />} label="Incoming PO Value" value={money(command.incomingValue)} tone="text-purple-300" />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.1fr_1.2fr_.9fr]">
        <CommandPanel title="Stores and Stock Position" icon={<MapPin />}>
          <div className="space-y-2">
            {command.storeSummaries.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-light">No stores registered yet.</p>
            ) : command.storeSummaries.slice(0, 10).map((store: Rec) => (
              <div key={store.id} className="grid grid-cols-[1fr_auto] gap-3 border-b border-ink-mid/70 pb-2">
                <div>
                  <p className="text-sm font-semibold text-paper">{tx(store.name ?? store.store_name)}</p>
                  <p className="mt-0.5 text-xs text-slate-light">{tx(store.project_name ?? store.client_name ?? store.store_type, "Company store")}</p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-sm text-paper">{money(store.value)}</p>
                  <p className="font-mono text-[10px] uppercase text-slate">{num(store.itemCount)} items</p>
                </div>
              </div>
            ))}
          </div>
        </CommandPanel>

        <CommandPanel title="Live Movement Feed" icon={<PackageCheck />}>
          <div className="mb-3 grid grid-cols-4 gap-2">
            <MiniMetric label="Added" value={String(command.additions.length)} tone="text-emerald-300" />
            <MiniMetric label="Reduced" value={String(command.subtractions.length)} tone="text-blue-300" />
            <MiniMetric label="Transfers" value={String(command.transfers.length)} tone="text-purple-300" />
            <MiniMetric label="Adjust" value={String(command.adjustments.length)} tone="text-amber-300" />
          </div>
          <div className="max-h-80 space-y-2 overflow-auto">
            {command.recentMovements.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-light">No stock movements recorded.</p>
            ) : command.recentMovements.map((movement: Rec) => {
              const quantity = num(movement.quantity);
              const isAdd = quantity > 0;
              return (
                <div key={movement.id} className="flex items-start justify-between gap-3 border-b border-ink-mid/70 pb-2">
                  <div>
                    <p className="text-sm text-paper">{tx(movement.item_name ?? movement.item_code)}</p>
                    <p className="mt-0.5 text-xs text-slate-light">{tx(movement.movement_type)} · {tx(movement.store_name)} · {tx(movement.project_name, "No project")}</p>
                  </div>
                  <div className="text-right">
                    <p className={`font-mono text-sm font-semibold ${isAdd ? "text-emerald-300" : "text-blue-300"}`}>{isAdd ? "+" : ""}{qty(quantity)}</p>
                    <p className="font-mono text-[10px] text-slate">{dt(movement.movement_at ?? movement.created_at)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </CommandPanel>

        <CommandPanel title="Action and Risk Queue" icon={<ShieldAlert />}>
          <div className="space-y-2">
            {command.actionQueue.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-light">No urgent procurement or inventory actions.</p>
            ) : command.actionQueue.map((item: { id: string; tone: "amber" | "blue" | "red" | "slate"; label: string; title: string; meta: string }) => (
              <div key={item.id} className="border border-ink-mid/70 p-3">
                <span className={`inline-block border px-2 py-0.5 font-mono text-[10px] uppercase ${queueToneClass(item.tone)}`}>{item.label}</span>
                <p className="mt-2 text-sm font-semibold text-paper">{item.title}</p>
                <p className="mt-0.5 text-xs text-slate-light">{item.meta}</p>
              </div>
            ))}
          </div>
        </CommandPanel>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <CommandPanel title="Incoming Purchase Orders" icon={<ShoppingCart />}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm">
              <thead>
                <tr className="border-b border-ink-mid text-left">
                  {["PO", "Supplier", "Project", "Status", "Remaining Value", "Expected"].map((h) => <th key={h} className="px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-slate">{h}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-mid/70">
                {command.incomingPOs.length === 0 ? (
                  <tr><td colSpan={6} className="px-3 py-8 text-center text-sm text-slate-light">No issued or partially received POs waiting for delivery.</td></tr>
                ) : command.incomingPOs.slice(0, 10).map((po: Rec) => {
                  const pctReceived = Math.min(100, Math.max(0, num(po.percent_received ?? 0)));
                  const remaining = num(po.total_amount ?? po.amount) * (1 - pctReceived / 100);
                  return (
                    <tr key={po.id}>
                      <td className="px-3 py-2 font-mono text-xs text-signal">{tx(po.po_number, po.id)}</td>
                      <td className="px-3 py-2 text-paper">{tx(po.supplier_name)}</td>
                      <td className="px-3 py-2 text-slate-light">{tx(po.project_name)}</td>
                      <td className="px-3 py-2"><span className={`border px-2 py-0.5 font-mono text-[10px] uppercase ${poStatusClass(po.status)}`}>{tx(po.status)}</span></td>
                      <td className="px-3 py-2 font-mono text-paper">{money(remaining)}</td>
                      <td className="px-3 py-2 text-slate-light">{dt(po.expected_delivery_date ?? po.required_by_date)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CommandPanel>

        <CommandPanel title="Stock Exceptions" icon={<AlertTriangle />}>
          <div className="grid gap-3 md:grid-cols-2">
            <ExceptionList title="Below reorder" rows={command.lowStock.slice(0, 8)} tone="amber" />
            <ExceptionList title="Out of stock" rows={command.outOfStock.slice(0, 8)} tone="red" />
          </div>
        </CommandPanel>
      </section>
    </div>
  );
}


export function CommandPanel({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="border border-ink-mid bg-ink p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-mono text-xs font-bold uppercase tracking-wider text-paper">{title}</h2>
        <span className="text-signal [&_svg]:h-4 [&_svg]:w-4">{icon}</span>
      </div>
      {children}
    </section>
  );
}


export function MiniMetric({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="border border-ink-mid bg-ink-light/30 p-2 text-center">
      <p className={`font-mono text-lg font-semibold ${tone}`}>{value}</p>
      <p className="font-mono text-[9px] uppercase text-slate">{label}</p>
    </div>
  );
}


export function queueToneClass(tone: "amber" | "blue" | "red" | "slate") {
  if (tone === "amber") return "border-amber-500/40 bg-amber-950/20 text-amber-300";
  if (tone === "blue") return "border-blue-500/40 bg-blue-950/20 text-blue-300";
  if (tone === "red") return "border-red-500/40 bg-red-950/20 text-red-300";
  return "border-slate-500/40 bg-slate-800/40 text-slate-400";
}


export function ExceptionList({ title, rows, tone }: { title: string; rows: Rec[]; tone: "amber" | "red" }) {
  return (
    <div className="border border-ink-mid/70 p-3">
      <h3 className={`mb-2 font-mono text-[10px] uppercase tracking-wider ${tone === "red" ? "text-red-300" : "text-amber-300"}`}>{title}</h3>
      {rows.length === 0 ? <p className="text-sm text-slate-light">Clear.</p> : rows.map((row) => (
        <div key={`${row.item_id ?? row.id}-${row.store_id ?? row.store_name}`} className="border-b border-ink-mid/60 py-2 last:border-0">
          <p className="text-sm text-paper">{tx(row.item_name ?? row.item_code)}</p>
          <p className="text-xs text-slate-light">{tx(row.store_name, "No store")} · available {qty(row.available_qty ?? row.quantity ?? row.stock_quantity)}</p>
        </div>
      ))}
    </div>
  );
}
