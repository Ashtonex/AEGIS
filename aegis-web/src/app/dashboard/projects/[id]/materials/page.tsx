"use client";

import React, { useEffect, useState, useMemo } from "react";
import { useParams } from "next/navigation";
import {
  Package,
  Truck,
  Receipt,
  AlertCircle,
  ShoppingCart,
  Warehouse,
  ClipboardList,
  Layers,
  ArrowRightLeft,
  CheckCircle2,
  Clock,
  RefreshCw,
} from "lucide-react";
import { useProject } from "@/context/ProjectWorkspaceContext";
import { formatCurrency } from "@/lib/utils";
import { number } from "@/lib/projects/types";
import { getProjectSupplyChain, type ProjectSupplyChainResponse } from "@/lib/api";

type TabKey = "inventory" | "requisitions" | "orders" | "deliveries" | "consumption";

export default function ProjectMaterialsPage() {
  const params = useParams();
  const projectId = typeof params?.id === "string" ? params.id : "";
  const { detail, loading: projectLoading } = useProject();

  const [supplyChain, setSupplyChain] = useState<ProjectSupplyChainResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("inventory");

  const loadSupplyChain = async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await getProjectSupplyChain(projectId);
      if (res.success && res.data) {
        setSupplyChain(res.data);
      } else {
        setError(res.message || "Failed to load project supply chain.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error connecting to supply chain service.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSupplyChain();
  }, [projectId]);

  // Fallback material consumption from daily reports if present in detail
  const fallbackMaterials = useMemo(() => detail?.material_records ?? [], [detail]);
  const fallbackOrders = useMemo(() => detail?.procurement_orders ?? [], [detail]);

  const siteStores = supplyChain?.site_stores ?? [];
  const inventoryOnHand = supplyChain?.inventory_on_hand ?? [];
  const requisitions = supplyChain?.requisitions ?? [];
  const purchaseOrders = supplyChain?.purchase_orders?.length ? supplyChain.purchase_orders : fallbackOrders;
  const deliveries = supplyChain?.deliveries ?? [];
  const consumptionLogs = supplyChain?.consumption_logs?.length ? supplyChain.consumption_logs : fallbackMaterials;

  const totalOnHandValue = supplyChain?.summary?.on_hand_inventory_value ?? 0;
  const openPOValue = supplyChain?.summary?.open_committed_po_value ?? 0;
  const totalStores = siteStores.length;

  return (
    <div className="space-y-6">
      {/* Header & KPI Summary */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-bold text-paper sm:text-2xl flex items-center gap-2">
            <Warehouse className="h-6 w-6 text-emerald-400" />
            Project Supply Chain & Site Inventory Radar
          </h2>
          <p className="mt-1 text-xs text-slate-light">
            Live integration tracking site stores, on-hand inventory, material requisitions, purchase orders, and daily consumption.
          </p>
        </div>

        <button
          onClick={() => void loadSupplyChain()}
          disabled={loading}
          className="inline-flex items-center gap-2 border border-ink-mid bg-ink px-3 py-1.5 font-mono text-xs text-paper hover:bg-ink-light transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Sync Radar
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="border border-ink-mid bg-ink p-4">
          <div className="flex items-center justify-between text-slate-light">
            <span className="font-mono text-xs uppercase tracking-wider">Site Stores</span>
            <Warehouse className="h-4 w-4 text-emerald-400" />
          </div>
          <div className="mt-2 font-mono text-2xl font-bold text-paper">
            {totalStores}
          </div>
          <div className="mt-1 text-[11px] text-slate font-mono">
            {siteStores.map((s) => s.name).join(", ") || "No dedicated site store registered"}
          </div>
        </div>

        <div className="border border-ink-mid bg-ink p-4">
          <div className="flex items-center justify-between text-slate-light">
            <span className="font-mono text-xs uppercase tracking-wider">On-Hand Stock Value</span>
            <Package className="h-4 w-4 text-cyan-400" />
          </div>
          <div className="mt-2 font-mono text-2xl font-bold text-cyan-400">
            {formatCurrency(totalOnHandValue)}
          </div>
          <div className="mt-1 text-[11px] text-slate font-mono">
            {inventoryOnHand.length} distinct items held on site
          </div>
        </div>

        <div className="border border-ink-mid bg-ink p-4">
          <div className="flex items-center justify-between text-slate-light">
            <span className="font-mono text-xs uppercase tracking-wider">Open PO Commitments</span>
            <ShoppingCart className="h-4 w-4 text-amber-400" />
          </div>
          <div className="mt-2 font-mono text-2xl font-bold text-amber-400">
            {formatCurrency(openPOValue)}
          </div>
          <div className="mt-1 text-[11px] text-slate font-mono">
            {supplyChain?.summary?.total_open_pos ?? 0} active procurement orders
          </div>
        </div>

        <div className="border border-ink-mid bg-ink p-4">
          <div className="flex items-center justify-between text-slate-light">
            <span className="font-mono text-xs uppercase tracking-wider">Deliveries (GRNs)</span>
            <Truck className="h-4 w-4 text-purple-400" />
          </div>
          <div className="mt-2 font-mono text-2xl font-bold text-paper">
            {deliveries.length}
          </div>
          <div className="mt-1 text-[11px] text-slate font-mono">
            Received & inspected at site stores
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-ink-mid flex space-x-1 font-mono text-xs">
        <button
          onClick={() => setActiveTab("inventory")}
          className={`px-4 py-2.5 font-bold border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === "inventory"
              ? "border-emerald-400 text-emerald-400 bg-ink-light/40"
              : "border-transparent text-slate-light hover:text-paper"
          }`}
        >
          <Package className="h-3.5 w-3.5" />
          Site Store Inventory ({inventoryOnHand.length})
        </button>
        <button
          onClick={() => setActiveTab("requisitions")}
          className={`px-4 py-2.5 font-bold border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === "requisitions"
              ? "border-cyan-400 text-cyan-400 bg-ink-light/40"
              : "border-transparent text-slate-light hover:text-paper"
          }`}
        >
          <ClipboardList className="h-3.5 w-3.5" />
          Material Requisitions ({requisitions.length})
        </button>
        <button
          onClick={() => setActiveTab("orders")}
          className={`px-4 py-2.5 font-bold border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === "orders"
              ? "border-amber-400 text-amber-400 bg-ink-light/40"
              : "border-transparent text-slate-light hover:text-paper"
          }`}
        >
          <ShoppingCart className="h-3.5 w-3.5" />
          Purchase Orders ({purchaseOrders.length})
        </button>
        <button
          onClick={() => setActiveTab("deliveries")}
          className={`px-4 py-2.5 font-bold border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === "deliveries"
              ? "border-purple-400 text-purple-400 bg-ink-light/40"
              : "border-transparent text-slate-light hover:text-paper"
          }`}
        >
          <Truck className="h-3.5 w-3.5" />
          Deliveries & GRNs ({deliveries.length})
        </button>
        <button
          onClick={() => setActiveTab("consumption")}
          className={`px-4 py-2.5 font-bold border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === "consumption"
              ? "border-rose-400 text-rose-400 bg-ink-light/40"
              : "border-transparent text-slate-light hover:text-paper"
          }`}
        >
          <Receipt className="h-3.5 w-3.5" />
          Consumption Logs ({consumptionLogs.length})
        </button>
      </div>

      {/* Tab Content: Site Store Inventory */}
      {activeTab === "inventory" && (
        <section className="border border-ink-mid bg-ink">
          <div className="border-b border-ink-mid p-4 flex items-center justify-between">
            <div>
              <span className="font-mono text-xs font-bold uppercase tracking-wider text-paper">
                Site Store Physical Balances (Stock Ledger)
              </span>
              <p className="mt-0.5 text-[11px] text-slate-light">
                Live quantities held in project site stores available for construction activities.
              </p>
            </div>
            <div className="font-mono text-xs">
              <span className="text-slate">Total Value:</span>{" "}
              <strong className="text-emerald-400">{formatCurrency(totalOnHandValue)}</strong>
            </div>
          </div>

          {inventoryOnHand.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-light font-mono">
              No on-hand stock found in this project&apos;s site stores.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-ink-mid bg-ink-light/50 font-mono text-[11px] text-slate uppercase tracking-wider">
                    <th className="py-2.5 px-4">Item Code</th>
                    <th className="py-2.5 px-4">Description</th>
                    <th className="py-2.5 px-4">Category</th>
                    <th className="py-2.5 px-4">Site Store</th>
                    <th className="py-2.5 px-4 text-right">On-Hand Qty</th>
                    <th className="py-2.5 px-4">UOM</th>
                    <th className="py-2.5 px-4 text-right">Avg Unit Cost</th>
                    <th className="py-2.5 px-4 text-right">Total Valuation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-mid/40 font-mono">
                  {inventoryOnHand.map((row, idx) => (
                    <tr key={idx} className="hover:bg-ink-light/30 transition-colors">
                      <td className="py-3 px-4 font-bold text-paper">{row.item_code}</td>
                      <td className="py-3 px-4 text-paper">{row.item_name}</td>
                      <td className="py-3 px-4 text-slate-light">{row.category}</td>
                      <td className="py-3 px-4 text-emerald-400">{row.store_name}</td>
                      <td className="py-3 px-4 text-right font-bold text-paper">
                        {Number(row.on_hand_quantity).toLocaleString()}
                      </td>
                      <td className="py-3 px-4 uppercase text-slate-light">{row.unit_of_measure}</td>
                      <td className="py-3 px-4 text-right text-slate-light">
                        {formatCurrency(Number(row.avg_unit_cost || 0))}
                      </td>
                      <td className="py-3 px-4 text-right text-emerald-400 font-bold">
                        {formatCurrency(Number(row.total_value || 0))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* Tab Content: Material Requisitions */}
      {activeTab === "requisitions" && (
        <section className="border border-ink-mid bg-ink">
          <div className="border-b border-ink-mid p-4 flex items-center justify-between">
            <div>
              <span className="font-mono text-xs font-bold uppercase tracking-wider text-paper">
                Site Material Requisitions
              </span>
              <p className="mt-0.5 text-[11px] text-slate-light">
                Demands raised from site personnel for materials required for work packages.
              </p>
            </div>
            <span className="font-mono text-xs text-slate-light">{requisitions.length} Requisitions</span>
          </div>

          {requisitions.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-light font-mono">
              No material requisitions logged for this project yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-ink-mid bg-ink-light/50 font-mono text-[11px] text-slate uppercase tracking-wider">
                    <th className="py-2.5 px-4">Req #</th>
                    <th className="py-2.5 px-4">Title</th>
                    <th className="py-2.5 px-4">Originating Site</th>
                    <th className="py-2.5 px-4">Priority</th>
                    <th className="py-2.5 px-4">Status</th>
                    <th className="py-2.5 px-4 text-right">Items</th>
                    <th className="py-2.5 px-4 text-right">Estimated Total</th>
                    <th className="py-2.5 px-4">Required Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-mid/40 font-mono">
                  {requisitions.map((req, idx) => (
                    <tr key={idx} className="hover:bg-ink-light/30 transition-colors">
                      <td className="py-3 px-4 font-bold text-paper">{req.requisition_number}</td>
                      <td className="py-3 px-4 text-paper">{req.title}</td>
                      <td className="py-3 px-4 text-slate-light">{req.site_name || "Project Main Site"}</td>
                      <td className="py-3 px-4 uppercase text-amber-400">{req.priority}</td>
                      <td className="py-3 px-4">
                        <span className="inline-block px-2 py-0.5 text-[10px] uppercase font-bold bg-ink-light border border-ink-mid text-paper">
                          {req.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right text-paper">{req.item_count}</td>
                      <td className="py-3 px-4 text-right font-bold text-signal">
                        {formatCurrency(Number(req.estimated_total || 0))}
                      </td>
                      <td className="py-3 px-4 text-slate-light">
                        {req.required_by_date ? new Date(req.required_by_date).toLocaleDateString() : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* Tab Content: Purchase Orders */}
      {activeTab === "orders" && (
        <section className="border border-ink-mid bg-ink">
          <div className="border-b border-ink-mid p-4 flex items-center justify-between">
            <div>
              <span className="font-mono text-xs font-bold uppercase tracking-wider text-paper">
                Linked Purchase Orders & Procurement Commitments
              </span>
              <p className="mt-0.5 text-[11px] text-slate-light">
                Legally committed purchase orders with suppliers directly tied to this project budget.
              </p>
            </div>
            <span className="font-mono text-xs text-slate-light">{purchaseOrders.length} Orders</span>
          </div>

          {purchaseOrders.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-light font-mono">
              No purchase orders directly associated with this project.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-ink-mid bg-ink-light/50 font-mono text-[11px] text-slate uppercase tracking-wider">
                    <th className="py-2.5 px-4">PO Number</th>
                    <th className="py-2.5 px-4">Supplier</th>
                    <th className="py-2.5 px-4">Status</th>
                    <th className="py-2.5 px-4 text-right">Order Amount</th>
                    <th className="py-2.5 px-4">Expected Delivery</th>
                    <th className="py-2.5 px-4">Payment Terms</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-mid/40 font-mono">
                  {purchaseOrders.map((po, idx) => (
                    <tr key={idx} className="hover:bg-ink-light/30 transition-colors">
                      <td className="py-3 px-4 font-bold text-paper">{String(po.po_number || `PO-${idx + 1}`)}</td>
                      <td className="py-3 px-4 text-paper">{String(po.supplier_name || "Supplier")}</td>
                      <td className="py-3 px-4">
                        <span className="inline-block px-2 py-0.5 text-[10px] uppercase font-bold bg-ink-light border border-ink-mid text-amber-400">
                          {String(po.status || "open")}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right font-bold text-signal">
                        {formatCurrency(number(po.total_amount) ?? 0)}
                      </td>
                      <td className="py-3 px-4 text-slate-light">
                        {po.expected_delivery_date ? new Date(String(po.expected_delivery_date)).toLocaleDateString() : "-"}
                      </td>
                      <td className="py-3 px-4 text-slate-light">{String(po.payment_terms || "Standard 30 Days")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* Tab Content: Deliveries & GRNs */}
      {activeTab === "deliveries" && (
        <section className="border border-ink-mid bg-ink">
          <div className="border-b border-ink-mid p-4 flex items-center justify-between">
            <div>
              <span className="font-mono text-xs font-bold uppercase tracking-wider text-paper">
                Goods Received Notes (Site Store Receipts)
              </span>
              <p className="mt-0.5 text-[11px] text-slate-light">
                Verified delivery notes and quality inspection records received at the project site store.
              </p>
            </div>
            <span className="font-mono text-xs text-slate-light">{deliveries.length} Deliveries</span>
          </div>

          {deliveries.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-light font-mono">
              No delivery receipts (GRNs) recorded for this project yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-ink-mid bg-ink-light/50 font-mono text-[11px] text-slate uppercase tracking-wider">
                    <th className="py-2.5 px-4">GRN #</th>
                    <th className="py-2.5 px-4">PO Reference</th>
                    <th className="py-2.5 px-4">Receiving Site Store</th>
                    <th className="py-2.5 px-4">Supplier Delivery Note</th>
                    <th className="py-2.5 px-4">Received Date</th>
                    <th className="py-2.5 px-4">Inspection</th>
                    <th className="py-2.5 px-4 text-right">Items Count</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-mid/40 font-mono">
                  {deliveries.map((grn, idx) => (
                    <tr key={idx} className="hover:bg-ink-light/30 transition-colors">
                      <td className="py-3 px-4 font-bold text-purple-400">{grn.grn_number}</td>
                      <td className="py-3 px-4 text-paper">{grn.po_number || "-"}</td>
                      <td className="py-3 px-4 text-paper">{grn.store_name}</td>
                      <td className="py-3 px-4 text-slate-light">{grn.delivery_note_number || "-"}</td>
                      <td className="py-3 px-4 text-slate-light">
                        {new Date(grn.received_at).toLocaleDateString()}
                      </td>
                      <td className="py-3 px-4">
                        <span className="inline-block px-2 py-0.5 text-[10px] uppercase font-bold bg-ink-light border border-ink-mid text-emerald-400">
                          {grn.inspection_status || "Passed"}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right font-bold text-paper">{grn.item_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* Tab Content: Consumption Logs */}
      {activeTab === "consumption" && (
        <section className="border border-ink-mid bg-ink">
          <div className="border-b border-ink-mid p-4 flex items-center justify-between">
            <div>
              <span className="font-mono text-xs font-bold uppercase tracking-wider text-paper">
                Daily Site Report Material Consumption
              </span>
              <p className="mt-0.5 text-[11px] text-slate-light">
                Materials logged by site engineers as consumed into permanent structural works.
              </p>
            </div>
            <span className="font-mono text-xs text-slate-light">{consumptionLogs.length} Records</span>
          </div>

          {consumptionLogs.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-light font-mono">
              No material consumption records found for this project yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-ink-mid bg-ink-light/50 font-mono text-[11px] text-slate uppercase tracking-wider">
                    <th className="py-2.5 px-4">Date</th>
                    <th className="py-2.5 px-4">Material / Item</th>
                    <th className="py-2.5 px-4 text-right">Quantity Used</th>
                    <th className="py-2.5 px-4">UOM</th>
                    <th className="py-2.5 px-4">Work / Usage Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-mid/40 font-mono">
                  {consumptionLogs.map((log: any, idx: number) => (
                    <tr key={idx} className="hover:bg-ink-light/30 transition-colors">
                      <td className="py-3 px-4 font-mono text-slate-light">
                        {log.report_date ? new Date(log.report_date).toLocaleDateString() : "-"}
                      </td>
                      <td className="py-3 px-4 font-medium text-paper">
                        {log.item_name || log.item_code || log.description || "General Material"}
                      </td>
                      <td className="py-3 px-4 text-right font-bold text-paper">
                        {Number(log.quantity_used || 0).toLocaleString()}
                      </td>
                      <td className="py-3 px-4 uppercase text-slate-light">{log.unit_of_measure || "units"}</td>
                      <td className="py-3 px-4 text-slate-light">{log.notes || log.description || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
