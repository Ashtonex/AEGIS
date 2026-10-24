"use client";

import React, { useEffect, useState, useMemo } from "react";
import Link from "next/link";
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
  FileText,
  Plus,
  Percent,
  ShieldCheck,
  ShieldAlert,
  Scale,
  X,
  Send,
} from "lucide-react";
import { useProject } from "@/context/ProjectWorkspaceContext";
import { formatCurrency } from "@/lib/utils";
import { number } from "@/lib/projects/types";
import {
  getProjectSupplyChain,
  requestSiteMaterial,
  type ProjectSupplyChainResponse,
} from "@/lib/api";

type TabKey = "inventory" | "wastage" | "requisitions" | "rfqs" | "orders" | "deliveries" | "consumption";

export default function ProjectMaterialsPage() {
  const params = useParams();
  const projectId = typeof params?.id === "string" ? params.id : "";
  const { detail, loading: projectLoading } = useProject();

  const [supplyChain, setSupplyChain] = useState<ProjectSupplyChainResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("inventory");

  // Site Requisition Modal State
  const [isReqModalOpen, setIsReqModalOpen] = useState(false);
  const [reqStoreId, setReqStoreId] = useState("");
  const [reqItemDesc, setReqItemDesc] = useState("");
  const [reqSelectedItemId, setReqSelectedItemId] = useState("");
  const [reqQuantity, setReqQuantity] = useState("");
  const [reqUom, setReqUom] = useState("bags");
  const [reqWorkPackage, setReqWorkPackage] = useState("Substructure & Foundation");
  const [reqPriority, setReqPriority] = useState("normal");
  const [reqRequiredDate, setReqRequiredDate] = useState("");
  const [reqJustification, setReqJustification] = useState("");
  const [submittingReq, setSubmittingReq] = useState(false);
  const [reqNotice, setReqNotice] = useState<string | null>(null);
  const [reqError, setReqError] = useState<string | null>(null);

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
  const rfqs = supplyChain?.rfqs ?? [];
  const consumptionLogs = supplyChain?.consumption_logs?.length ? supplyChain.consumption_logs : fallbackMaterials;
  const wastageRecords = supplyChain?.wastage_records ?? [];
  const financeVerification = supplyChain?.finance_verification;

  const totalOnHandValue = supplyChain?.summary?.on_hand_inventory_value ?? 0;
  const openPOValue = supplyChain?.summary?.open_committed_po_value ?? 0;
  const totalWastageCost = supplyChain?.summary?.total_wastage_cost ?? 0;
  const avgWastagePercent = supplyChain?.summary?.average_wastage_percent ?? 0;
  const totalStores = siteStores.length;

  const handleCreateRequisition = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!reqItemDesc.trim() && !reqSelectedItemId) || !reqQuantity || Number(reqQuantity) <= 0) {
      setReqError("Please specify a material item/description and a valid quantity.");
      return;
    }
    setSubmittingReq(true);
    setReqError(null);
    setReqNotice(null);
    try {
      const res = await requestSiteMaterial({
        project_id: projectId,
        site_id: (detail as any)?.sites?.[0]?.id || siteStores[0]?.site_id || undefined,
        store_id: reqStoreId || siteStores[0]?.id || undefined,
        item_id: reqSelectedItemId || undefined,
        material_description: reqItemDesc.trim() || undefined,
        quantity: Number(reqQuantity),
        unit_of_measure: reqUom,
        work_package: reqWorkPackage,
        priority: reqPriority,
        required_by_date: reqRequiredDate || undefined,
        justification: reqJustification.trim() || `Material requested on site for ${reqWorkPackage}`,
      });
      if (res.success || res.data) {
        setReqNotice("Site material requisition successfully logged and routed for project approval.");
        setReqItemDesc("");
        setReqSelectedItemId("");
        setReqQuantity("");
        setReqJustification("");
        setIsReqModalOpen(false);
        await loadSupplyChain();
        setActiveTab("requisitions");
      } else {
        setReqError(res.message || "Failed to submit requisition.");
      }
    } catch (err: any) {
      setReqError(err?.message || "Failed to submit requisition.");
    } finally {
      setSubmittingReq(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & KPI Summary */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-bold text-paper sm:text-2xl flex items-center gap-2">
            <Warehouse className="h-6 w-6 text-emerald-400" />
            Project Supply Chain &amp; Site Inventory Radar
          </h2>
          <p className="mt-1 text-xs text-slate-light">
            Live integration tracking site stores, on-hand inventory, material requisitions, RFQs, purchase orders, wastage, and daily consumption.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setReqError(null);
              setReqNotice(null);
              setIsReqModalOpen(true);
            }}
            className="inline-flex items-center gap-1.5 border border-signal bg-signal px-3.5 py-2 sm:py-1.5 min-h-[38px] sm:min-h-0 font-mono text-xs font-bold uppercase text-ink hover:bg-signal/90 active:scale-[0.98] transition-all"
            title="Raise a site material requisition (Engineers, Foremen, Site Clerks, Agents)"
          >
            <Plus className="h-3.5 w-3.5 text-ink stroke-[3]" />
            <span>Raise Site Requisition</span>
          </button>
          <Link
            href={`/dashboard/procurement?projectId=${projectId}`}
            className="inline-flex items-center gap-1.5 border border-signal/50 bg-signal/10 px-3 py-2 sm:py-1.5 min-h-[38px] sm:min-h-0 font-mono text-xs text-signal hover:bg-signal/20 active:scale-[0.98] transition-all"
            title="Open Procurement Command for this project"
          >
            <Truck className="h-3.5 w-3.5" />
            <span>Procurement Command</span>
          </Link>
          <button
            onClick={() => void loadSupplyChain()}
            disabled={loading}
            className="inline-flex items-center gap-2 border border-ink-mid bg-ink px-3 py-2 sm:py-1.5 min-h-[38px] sm:min-h-0 font-mono text-xs text-paper hover:bg-ink-light active:scale-[0.98] transition-all disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Sync Radar
          </button>
        </div>
      </div>

      {/* Cross-Module Finance & Commercial Sanity Verification */}
      {financeVerification && (
        <div
          className={`border p-4 transition-all ${
            financeVerification.is_deposit_backed && financeVerification.is_within_budget
              ? "border-emerald-500/40 bg-emerald-950/20"
              : !financeVerification.is_deposit_backed
              ? "border-amber-500/40 bg-amber-950/20"
              : "border-rose-500/40 bg-rose-950/20"
          }`}
        >
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              {financeVerification.is_deposit_backed && financeVerification.is_within_budget ? (
                <ShieldCheck className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <ShieldAlert className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
              )}
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs font-bold uppercase tracking-wider text-paper">
                    Cross-Module Finance &amp; Procurement Verification
                  </span>
                  <span
                    className={`px-2 py-0.5 text-[10px] font-mono font-bold uppercase rounded ${
                      financeVerification.is_deposit_backed && financeVerification.is_within_budget
                        ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                        : "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                    }`}
                  >
                    {financeVerification.verdict.replace(/_/g, " ")}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-light leading-relaxed">
                  {financeVerification.message}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-4 text-xs font-mono shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-ink-mid/40">
              <div>
                <span className="text-slate block text-[10px] uppercase">Material Exposure</span>
                <span className="font-bold text-paper">
                  {formatCurrency(financeVerification.total_material_exposure)}
                </span>
              </div>
              <div>
                <span className="text-slate block text-[10px] uppercase">Advance Deposit</span>
                <span className="font-bold text-signal">
                  {formatCurrency(financeVerification.deposit_received_amount)}
                </span>
              </div>
              <div>
                <span className="text-slate block text-[10px] uppercase">Deposit Coverage</span>
                <span
                  className={`font-bold ${
                    financeVerification.deposit_coverage_percent >= 100 ? "text-emerald-400" : "text-amber-400"
                  }`}
                >
                  {financeVerification.deposit_coverage_percent}%
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="border border-ink-mid bg-ink p-4">
          <div className="flex items-center justify-between text-slate-light">
            <span className="font-mono text-xs uppercase tracking-wider">Available Site Stores</span>
            <Warehouse className="h-4 w-4 text-emerald-400" />
          </div>
          <div className="mt-2 font-mono text-2xl font-bold text-paper">
            {totalStores}
          </div>
          <div className="mt-1 text-[11px] text-slate font-mono truncate">
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
            {inventoryOnHand.length} distinct item lines held in site stores
          </div>
        </div>

        <div className="border border-ink-mid bg-ink p-4">
          <div className="flex items-center justify-between text-slate-light">
            <span className="font-mono text-xs uppercase tracking-wider">Wastage &amp; Variance Cost</span>
            <Percent className="h-4 w-4 text-rose-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-bold text-rose-400">
              {formatCurrency(totalWastageCost)}
            </span>
            <span className="text-xs font-mono text-slate-light">({avgWastagePercent}% avg)</span>
          </div>
          <div className="mt-1 text-[11px] text-slate font-mono">
            {wastageRecords.filter((w) => w.status_flag === "critical_loss").length} items exceeding scrap allowance
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
            {supplyChain?.summary?.total_open_pos ?? 0} active purchase commitments
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-ink-mid flex space-x-1 font-mono text-xs overflow-x-auto">
        <button
          onClick={() => setActiveTab("inventory")}
          className={`px-4 py-2.5 font-bold border-b-2 transition-colors flex items-center gap-2 whitespace-nowrap ${
            activeTab === "inventory"
              ? "border-emerald-400 text-emerald-400 bg-ink-light/40"
              : "border-transparent text-slate-light hover:text-paper"
          }`}
        >
          <Package className="h-3.5 w-3.5" />
          Site Store Inventory ({inventoryOnHand.length})
        </button>
        <button
          onClick={() => setActiveTab("wastage")}
          className={`px-4 py-2.5 font-bold border-b-2 transition-colors flex items-center gap-2 whitespace-nowrap ${
            activeTab === "wastage"
              ? "border-rose-400 text-rose-400 bg-ink-light/40"
              : "border-transparent text-slate-light hover:text-paper"
          }`}
        >
          <Scale className="h-3.5 w-3.5" />
          Material Wastage &amp; Usage ({wastageRecords.length})
        </button>
        <button
          onClick={() => setActiveTab("requisitions")}
          className={`px-4 py-2.5 font-bold border-b-2 transition-colors flex items-center gap-2 whitespace-nowrap ${
            activeTab === "requisitions"
              ? "border-cyan-400 text-cyan-400 bg-ink-light/40"
              : "border-transparent text-slate-light hover:text-paper"
          }`}
        >
          <ClipboardList className="h-3.5 w-3.5" />
          Site Requisitions ({requisitions.length})
        </button>
        <button
          onClick={() => setActiveTab("rfqs")}
          className={`px-4 py-2.5 font-bold border-b-2 transition-colors flex items-center gap-2 whitespace-nowrap ${
            activeTab === "rfqs"
              ? "border-sky-400 text-sky-400 bg-ink-light/40"
              : "border-transparent text-slate-light hover:text-paper"
          }`}
        >
          <FileText className="h-3.5 w-3.5" />
          RFQs &amp; Sourcing ({rfqs.length})
        </button>
        <button
          onClick={() => setActiveTab("orders")}
          className={`px-4 py-2.5 font-bold border-b-2 transition-colors flex items-center gap-2 whitespace-nowrap ${
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
          className={`px-4 py-2.5 font-bold border-b-2 transition-colors flex items-center gap-2 whitespace-nowrap ${
            activeTab === "deliveries"
              ? "border-purple-400 text-purple-400 bg-ink-light/40"
              : "border-transparent text-slate-light hover:text-paper"
          }`}
        >
          <Truck className="h-3.5 w-3.5" />
          Deliveries &amp; GRNs ({deliveries.length})
        </button>
        <button
          onClick={() => setActiveTab("consumption")}
          className={`px-4 py-2.5 font-bold border-b-2 transition-colors flex items-center gap-2 whitespace-nowrap ${
            activeTab === "consumption"
              ? "border-lime-400 text-lime-400 bg-ink-light/40"
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

      {/* Tab Content: Material Wastage & Usage Radar */}
      {activeTab === "wastage" && (
        <section className="space-y-4">
          <div className="border border-ink-mid bg-ink p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div>
              <span className="font-mono text-xs font-bold uppercase tracking-wider text-paper flex items-center gap-2">
                <Scale className="h-4 w-4 text-rose-400" />
                Material Wastage, Leakage &amp; In-Situ Consumption Radar
              </span>
              <p className="mt-0.5 text-[11px] text-slate-light">
                Reconciliation comparing physical store issues against engineer daily site report logs (actual structural installation).
              </p>
            </div>
            <div className="flex items-center gap-3 font-mono text-xs">
              <span className="text-slate">Total Scrap/Variance Cost:</span>
              <strong className="text-rose-400 text-sm">{formatCurrency(totalWastageCost)}</strong>
            </div>
          </div>

          {/* Tolerance Legend & Metrics */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="border border-emerald-500/30 bg-emerald-950/20 p-3">
              <span className="font-mono text-[10px] uppercase text-emerald-400 font-bold flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                Normal Allowance (&le; 3.5%)
              </span>
              <p className="mt-1 text-xs text-slate-light">
                Standard construction fabrication cuts, batch over-pour &amp; allowable handling scrap.
              </p>
            </div>
            <div className="border border-amber-500/30 bg-amber-950/20 p-3">
              <span className="font-mono text-[10px] uppercase text-amber-400 font-bold flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-amber-400" />
                Elevated Variance (3.5% - 7.0%)
              </span>
              <p className="mt-1 text-xs text-slate-light">
                Requires site agent inspection to verify work quality and over-excavation dimensions.
              </p>
            </div>
            <div className="border border-rose-500/30 bg-rose-950/20 p-3">
              <span className="font-mono text-[10px] uppercase text-rose-400 font-bold flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-rose-400 animate-pulse" />
                Critical Leakage Alert (&gt; 7.0%)
              </span>
              <p className="mt-1 text-xs text-slate-light">
                Potential site theft, severe off-spec pours, or unrecorded store issues. Escalated to PM.
              </p>
            </div>
          </div>

          {/* Wastage Table */}
          <div className="border border-ink-mid bg-ink">
            {wastageRecords.length === 0 ? (
              <div className="py-12 text-center text-xs text-slate-light font-mono">
                No material wastage or variance records recorded yet. Data populates automatically as store issues are reconciled against daily site reports.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-ink-mid bg-ink-light/50 font-mono text-[11px] text-slate uppercase tracking-wider">
                      <th className="py-2.5 px-4">Item Code</th>
                      <th className="py-2.5 px-4">Material Description</th>
                      <th className="py-2.5 px-4 text-right">Store Issued Qty</th>
                      <th className="py-2.5 px-4 text-right">Installed In-Situ</th>
                      <th className="py-2.5 px-4 text-right">Variance (Scrap)</th>
                      <th className="py-2.5 px-4">UOM</th>
                      <th className="py-2.5 px-4 text-right">Wastage %</th>
                      <th className="py-2.5 px-4 text-right">Financial Exposure</th>
                      <th className="py-2.5 px-4 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-mid/40 font-mono">
                    {wastageRecords.map((w, idx) => (
                      <tr key={idx} className="hover:bg-ink-light/30 transition-colors">
                        <td className="py-3 px-4 font-bold text-paper">{w.item_code}</td>
                        <td className="py-3 px-4 text-paper">{w.item_name}</td>
                        <td className="py-3 px-4 text-right font-bold text-paper">
                          {Number(w.quantity_issued || 0).toLocaleString()}
                        </td>
                        <td className="py-3 px-4 text-right text-emerald-400 font-bold">
                          {Number(w.quantity_consumed || 0).toLocaleString()}
                        </td>
                        <td className="py-3 px-4 text-right text-rose-400 font-bold">
                          {Number(w.variance_quantity || 0).toLocaleString()}
                        </td>
                        <td className="py-3 px-4 uppercase text-slate-light">{w.unit_of_measure}</td>
                        <td className="py-3 px-4 text-right">
                          <span
                            className={`font-bold ${
                              w.status_flag === "critical_loss"
                                ? "text-rose-400"
                                : w.status_flag === "elevated"
                                ? "text-amber-400"
                                : "text-emerald-400"
                            }`}
                          >
                            {w.wastage_percent}%
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right font-bold text-paper">
                          {formatCurrency(Number(w.wastage_cost || 0))}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span
                            className={`inline-block px-2 py-0.5 text-[10px] uppercase font-bold border ${
                              w.status_flag === "critical_loss"
                                ? "border-rose-500/50 bg-rose-950/40 text-rose-300"
                                : w.status_flag === "elevated"
                                ? "border-amber-500/50 bg-amber-950/40 text-amber-300"
                                : "border-emerald-500/50 bg-emerald-950/40 text-emerald-300"
                            }`}
                          >
                            {w.status_flag.replace(/_/g, " ")}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
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

      {/* Tab Content: RFQs & Tenders */}
      {activeTab === "rfqs" && (
        <section className="border border-ink-mid bg-ink">
          <div className="border-b border-ink-mid p-4 flex items-center justify-between">
            <div>
              <span className="font-mono text-xs font-bold uppercase tracking-wider text-paper">
                Request for Quotations (RFQs) &amp; Package Sourcing
              </span>
              <p className="mt-0.5 text-[11px] text-slate-light">
                Live supplier packages and competitive quotation invitations issued for this project.
              </p>
            </div>
            <span className="font-mono text-xs text-slate-light">{rfqs.length} Packages</span>
          </div>

          {rfqs.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-light font-mono">
              No RFQs or sourcing packages open for this project yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-ink-mid bg-ink-light/50 font-mono text-[11px] text-slate uppercase tracking-wider">
                    <th className="py-2.5 px-4">RFQ #</th>
                    <th className="py-2.5 px-4">Package Title</th>
                    <th className="py-2.5 px-4">Status</th>
                    <th className="py-2.5 px-4">Closing Date</th>
                    <th className="py-2.5 px-4">Created Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-mid/40 font-mono">
                  {rfqs.map((rfq, idx) => (
                    <tr key={idx} className="hover:bg-ink-light/30 transition-colors">
                      <td className="py-3 px-4 font-bold text-paper">{rfq.rfq_number}</td>
                      <td className="py-3 px-4 text-paper">{rfq.title}</td>
                      <td className="py-3 px-4">
                        <span className="inline-block px-2 py-0.5 text-[10px] uppercase font-bold bg-ink-light border border-ink-mid text-sky-400">
                          {rfq.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-light">
                        {rfq.closing_date ? new Date(rfq.closing_date).toLocaleDateString() : "-"}
                      </td>
                      <td className="py-3 px-4 text-slate-light">
                        {rfq.created_at ? new Date(rfq.created_at).toLocaleDateString() : "-"}
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

      {/* Inline Raise Site Requisition Modal */}
      {isReqModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-4">
          <div className="w-full max-w-xl border border-signal/50 bg-ink p-5 sm:p-6 shadow-2xl space-y-4 max-h-[90dvh] overflow-y-auto pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:pb-6 rounded-t-xl sm:rounded-none">
            <div className="flex items-center justify-between border-b border-ink-mid/60 pb-3">
              <div>
                <h3 className="font-display text-lg font-bold text-paper flex items-center gap-2">
                  <ClipboardList className="h-5 w-5 text-signal" />
                  Raise Site Material Requisition
                </h3>
                <p className="text-xs text-slate-light mt-0.5">
                  Demands raised by site engineers, agents, foremen &amp; clerks. Checked against site budget &amp; stores.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsReqModalOpen(false)}
                className="text-slate hover:text-paper p-1"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {reqError && (
              <div className="border border-rose-500/50 bg-rose-950/20 p-3 text-xs text-rose-300">
                {reqError}
              </div>
            )}

            <form onSubmit={handleCreateRequisition} className="space-y-4">
              {/* Site Store */}
              <div>
                <label className="block text-xs font-mono uppercase text-slate">
                  Target Site Store *
                </label>
                <select
                  value={reqStoreId}
                  onChange={(e) => setReqStoreId(e.target.value)}
                  className="mt-1 w-full border border-ink-mid bg-ink-light p-2.5 text-base sm:text-xs text-paper outline-none focus:border-signal font-mono min-h-[44px] sm:min-h-0"
                >
                  <option value="">-- Project Site Store (Auto-assigned) --</option>
                  {siteStores.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.code || s.store_type})
                    </option>
                  ))}
                </select>
                <span className="text-[10px] text-slate-light mt-0.5 block">
                  Store clerk will review live inventory before issuing or forwarding to procurement.
                </span>
              </div>

              {/* Material Item / Description */}
              <div className="space-y-2">
                <label className="block text-xs font-mono uppercase text-slate">
                  Material Item *
                </label>
                {inventoryOnHand.length > 0 && (
                  <div>
                    <select
                      value={reqSelectedItemId}
                      onChange={(e) => {
                        setReqSelectedItemId(e.target.value);
                        const matched = inventoryOnHand.find((i) => i.item_id === e.target.value);
                        if (matched) {
                          setReqItemDesc(matched.item_name);
                          setReqUom(matched.unit_of_measure || "each");
                        }
                      }}
                      className="w-full border border-ink-mid bg-ink-light p-2.5 text-base sm:text-xs text-paper outline-none focus:border-signal font-mono min-h-[44px] sm:min-h-0"
                    >
                      <option value="">-- Select from Project Store On-Hand Catalogue --</option>
                      {inventoryOnHand.map((item) => (
                        <option key={item.item_id} value={item.item_id}>
                          {item.item_name} [{item.item_code}] - Available: {Number(item.on_hand_quantity).toLocaleString()} {item.unit_of_measure}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <input
                    value={reqItemDesc}
                    onChange={(e) => setReqItemDesc(e.target.value)}
                    placeholder="Or type custom description (e.g. 32.5R Portland Cement, Y12 High-Yield Rebar)"
                    className="w-full border border-ink-mid bg-ink-light p-2.5 text-base sm:text-xs text-paper outline-none focus:border-signal min-h-[44px] sm:min-h-0"
                  />
                </div>
              </div>

              {/* Quantity & UOM */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-mono uppercase text-slate">
                    Required Quantity *
                  </label>
                  <input
                    type="number"
                    min="0.1"
                    step="any"
                    value={reqQuantity}
                    onChange={(e) => setReqQuantity(e.target.value)}
                    placeholder="e.g. 50"
                    className="mt-1 w-full border border-ink-mid bg-ink-light p-2.5 text-base sm:text-xs text-paper outline-none focus:border-signal font-mono min-h-[44px] sm:min-h-0"
                  />
                </div>
                <div>
                  <label className="block text-xs font-mono uppercase text-slate">
                    Unit of Measure *
                  </label>
                  <select
                    value={reqUom}
                    onChange={(e) => setReqUom(e.target.value)}
                    className="mt-1 w-full border border-ink-mid bg-ink-light p-2.5 text-base sm:text-xs text-paper outline-none focus:border-signal font-mono min-h-[44px] sm:min-h-0"
                  >
                    <option value="bags">Bags (50kg)</option>
                    <option value="tonnes">Tonnes</option>
                    <option value="kg">Kilograms (kg)</option>
                    <option value="m3">Cubic Metres (m³)</option>
                    <option value="linear_m">Linear Metres</option>
                    <option value="pcs">Pieces / Units</option>
                    <option value="sheets">Sheets / Boards</option>
                    <option value="litres">Litres</option>
                  </select>
                </div>
              </div>

              {/* Work Package & Priority */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-mono uppercase text-slate">
                    Work Package / Milestone
                  </label>
                  <select
                    value={reqWorkPackage}
                    onChange={(e) => setReqWorkPackage(e.target.value)}
                    className="mt-1 w-full border border-ink-mid bg-ink-light p-2.5 text-base sm:text-xs text-paper outline-none focus:border-signal font-mono min-h-[44px] sm:min-h-0"
                  >
                    <option value="Substructure & Foundation">Substructure &amp; Foundation</option>
                    <option value="Superstructure Columns & Beams">Superstructure Columns &amp; Beams</option>
                    <option value="Floor Slab Pour">Floor Slab Pour</option>
                    <option value="Brickwork & Masonry">Brickwork &amp; Masonry</option>
                    <option value="Structural Steel & Roofing">Structural Steel &amp; Roofing</option>
                    <option value="Plastering & Wet Works">Plastering &amp; Wet Works</option>
                    <option value="MEP & Conduits">MEP &amp; Conduits</option>
                    <option value="External Works & Civil Drainage">External Works &amp; Drainage</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-mono uppercase text-slate">
                    Urgency / Priority
                  </label>
                  <select
                    value={reqPriority}
                    onChange={(e) => setReqPriority(e.target.value)}
                    className="mt-1 w-full border border-ink-mid bg-ink-light p-2.5 text-base sm:text-xs text-paper outline-none focus:border-signal font-mono min-h-[44px] sm:min-h-0"
                  >
                    <option value="normal">Normal (Standard Delivery)</option>
                    <option value="urgent">Urgent (Within 24-48 Hours)</option>
                    <option value="critical">Critical (Work Stoppage Risk)</option>
                  </select>
                </div>
              </div>

              {/* Required By Date */}
              <div>
                <label className="block text-xs font-mono uppercase text-slate">
                  Required on Site By Date
                </label>
                <input
                  type="date"
                  value={reqRequiredDate}
                  onChange={(e) => setReqRequiredDate(e.target.value)}
                  className="mt-1 w-full border border-ink-mid bg-ink-light p-2.5 text-base sm:text-xs text-paper outline-none focus:border-signal font-mono min-h-[44px] sm:min-h-0"
                />
              </div>

              {/* Justification / Notes */}
              <div>
                <label className="block text-xs font-mono uppercase text-slate">
                  Field Justification / Specific Section Location
                </label>
                <textarea
                  rows={2}
                  value={reqJustification}
                  onChange={(e) => setReqJustification(e.target.value)}
                  placeholder="e.g. Block B grid line 4 foundation rebar cage reinforcement."
                  className="mt-1 w-full border border-ink-mid bg-ink-light p-2.5 text-base sm:text-xs text-paper outline-none focus:border-signal"
                />
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-ink-mid/60">
                <button
                  type="button"
                  onClick={() => setIsReqModalOpen(false)}
                  className="border border-ink-mid px-4 py-2.5 min-h-[44px] sm:min-h-[36px] font-mono text-xs text-slate-light hover:text-paper"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingReq || (!reqItemDesc.trim() && !reqSelectedItemId) || !reqQuantity}
                  className="border border-signal bg-signal px-4 py-2.5 min-h-[44px] sm:min-h-[36px] font-mono text-xs font-bold uppercase text-ink hover:bg-signal/90 disabled:opacity-50 flex items-center gap-1.5"
                >
                  {submittingReq ? "Submitting..." : "Submit Requisition"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
