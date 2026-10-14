"use client";

import React, { useMemo } from "react";
import { useParams } from "next/navigation";
import { Package, Truck, Receipt, AlertCircle, ShoppingCart } from "lucide-react";
import { useProject } from "@/context/ProjectWorkspaceContext";
import { formatCurrency } from "@/lib/utils";
import { number } from "@/lib/projects/types";

export default function ProjectMaterialsPage() {
  const params = useParams();
  const projectId = typeof params?.id === "string" ? params.id : "";
  const { detail, loading } = useProject();

  const materialRecords = useMemo(() => detail?.material_records ?? [], [detail]);
  const procurementOrders = useMemo(() => detail?.procurement_orders ?? [], [detail]);

  const summary = useMemo(() => {
    return materialRecords.reduce((acc, row) => {
      const name = String(row.item_name || row.item_code || "General Materials");
      const unit = String(row.unit_of_measure || "units");
      const key = `${name}::${unit}`;
      const qty = number(row.quantity_used) ?? 0;
      const unitCost = number(row.unit_cost) ?? 0;
      const cost = qty * unitCost;

      const existing = acc.get(key) ?? { name, unit, quantity: 0, cost: 0, records: 0 };
      existing.quantity += qty;
      existing.cost += cost;
      existing.records += 1;
      acc.set(key, existing);
      return acc;
    }, new Map<string, { name: string; unit: string; quantity: number; cost: number; records: number }>());
  }, [materialRecords]);

  const summaryRows = Array.from(summary.values()).sort((a, b) => b.cost - a.cost);
  const totalCost = summaryRows.reduce((sum, r) => sum + r.cost, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-bold text-paper sm:text-2xl">
            Materials Consumption & Supply Chain Radar
          </h2>
          <p className="mt-1 text-xs text-slate-light">
            Live consumption derived from site deliveries, stock issues, and purchase commitments.
          </p>
        </div>

        <div className="border border-ink-mid bg-ink px-4 py-2 font-mono text-xs">
          <span className="text-slate">Total Consumed Value:</span>{" "}
          <strong className="text-signal font-bold">{formatCurrency(totalCost)}</strong>
        </div>
      </div>

      {/* Material Summary Table */}
      <section className="border border-ink-mid bg-ink">
        <div className="border-b border-ink-mid p-4 flex items-center justify-between">
          <span className="font-mono text-xs font-bold uppercase tracking-wider text-paper">
            Consumed Materials Register
          </span>
          <span className="font-mono text-xs text-slate-light">
            {summaryRows.length} Categorized Items
          </span>
        </div>

        {summaryRows.length === 0 ? (
          <div className="py-12 text-center text-xs text-slate-light font-mono">
            No material consumption records found for this project yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-ink-mid bg-ink-light/50 font-mono text-[11px] text-slate uppercase tracking-wider">
                  <th className="py-2.5 px-4">Material / Item</th>
                  <th className="py-2.5 px-4 text-right">Consumed Quantity</th>
                  <th className="py-2.5 px-4">UOM</th>
                  <th className="py-2.5 px-4 text-right">Calculated Cost</th>
                  <th className="py-2.5 px-4 text-center">Receipt Batches</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-mid/40 font-mono">
                {summaryRows.map((row, idx) => (
                  <tr key={idx} className="hover:bg-ink-light/30 transition-colors">
                    <td className="py-3 px-4 font-medium text-paper">
                      {row.name}
                    </td>
                    <td className="py-3 px-4 text-right font-bold text-paper">
                      {row.quantity.toLocaleString()}
                    </td>
                    <td className="py-3 px-4 uppercase text-slate-light">
                      {row.unit}
                    </td>
                    <td className="py-3 px-4 text-right text-signal font-bold">
                      {formatCurrency(row.cost)}
                    </td>
                    <td className="py-3 px-4 text-center text-slate">
                      {row.records}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Procurement Orders */}
      <section className="border border-ink-mid bg-ink p-5">
        <div className="flex items-center justify-between border-b border-ink-mid/60 pb-3">
          <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-paper flex items-center gap-2">
            <ShoppingCart className="h-4 w-4 text-emerald-400" />
            Linked Purchase Orders
          </h3>
          <span className="font-mono text-xs text-slate-light">
            {procurementOrders.length} Orders
          </span>
        </div>

        {procurementOrders.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-light font-mono">
            No purchase orders directly associated with this project.
          </div>
        ) : (
          <div className="mt-3 divide-y divide-ink-mid/40 font-mono text-xs">
            {procurementOrders.map((po, idx) => (
              <div key={idx} className="py-2.5 flex items-center justify-between">
                <div>
                  <span className="text-paper font-medium">{String(po.po_number || `PO-${idx + 1}`)}</span>
                  <p className="text-[11px] text-slate-light">{String(po.supplier_name || "Supplier")}</p>
                </div>
                <div className="text-right">
                  <span className="text-signal font-bold">{formatCurrency(number(po.total_amount) ?? 0)}</span>
                  <span className="block text-[10px] uppercase text-slate-light">{String(po.status || "open")}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
