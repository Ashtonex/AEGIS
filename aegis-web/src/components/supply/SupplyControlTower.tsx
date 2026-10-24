"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Clock, CheckCircle, FileText, DollarSign, Package, ShoppingCart, RefreshCw, Loader2 } from "lucide-react";
import { getSupplyControlTowerKPIs, type SupplyControlTowerKPIs } from "@/lib/api";
import { useLiveTable } from "@/lib/live/LiveDataProvider";

interface Props {
  currentModule: "procurement" | "inventory";
  onFilterClick?: (queue: string) => void;
  className?: string;
}

export function SupplyControlTower({ currentModule, onFilterClick, className = "" }: Props) {
  const [data, setData] = useState<SupplyControlTowerKPIs | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchKPIs = async () => {
    try {
      setLoading(true);
      const res = await getSupplyControlTowerKPIs();
      if (res.data) {
        setData(res.data);
        setLastUpdated(new Date());
        setError(null);
      }
    } catch (err: any) {
      const msg = err?.message || "";
      if (msg.toLowerCase().includes("not found")) {
        setError("Control tower endpoint is initializing on the server. Retry shortly.");
      } else {
        setError(msg || "Failed to load supply control tower metrics");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchKPIs();
  }, []);

  // Auto-refresh when relevant tables mutate
  useLiveTable("procurement.stock_ledger", () => void fetchKPIs());
  useLiveTable("procurement.purchase_requisitions", () => void fetchKPIs());
  useLiveTable("procurement.purchase_orders", () => void fetchKPIs());
  useLiveTable("procurement.supplier_invoices", () => void fetchKPIs());
  useLiveTable("finance.commitments", () => void fetchKPIs());

  const formatMoney = (val: number) => {
    return new Intl.NumberFormat("en-ZW", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(val);
  };

  return (
    <div className={`border border-ink-mid bg-ink p-3 rounded-lg mb-4 shadow-sm ${className}`}>
      <div className="flex items-center justify-between pb-2 border-b border-ink-mid text-xs">
        <div className="flex items-center gap-2">
          <span className="font-mono uppercase font-semibold text-signal text-[11px] tracking-wider">
            Supply Control Tower
          </span>
          <span className="text-[10px] text-slate font-mono">
            Unified Procurement & Inventory Pulse
          </span>
        </div>
        <div className="flex items-center gap-3">
          {lastUpdated && (
            <span className="text-[10px] font-mono text-slate-light">
              Updated {lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          <button
            onClick={() => fetchKPIs()}
            disabled={loading}
            className="text-slate hover:text-paper transition p-1"
            title="Refresh Supply KPIs"
          >
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          </button>
        </div>
      </div>

      {error ? (
        <div className="py-2 text-xs font-mono text-rose-400 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => fetchKPIs()} className="underline hover:text-paper ml-2">Retry</button>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5 pt-3">
          {/* 1. Critical Low Stock */}
          <Link
            href="/dashboard/inventory/stock?below_reorder=true"
            className="p-2.5 rounded border border-ink-mid bg-ink-light hover:border-signal transition block group"
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase font-mono text-slate-light">Critical Low Stock</span>
              <AlertTriangle className={`h-3.5 w-3.5 ${(data?.critical_low_stock.count ?? 0) > 0 ? "text-amber-400" : "text-slate"}`} />
            </div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className={`text-base font-mono font-bold ${(data?.critical_low_stock.count ?? 0) > 0 ? "text-amber-300" : "text-paper"}`}>
                {loading && !data ? "..." : data?.critical_low_stock.count ?? 0}
              </span>
              <span className="text-[10px] text-slate-light">SKUs</span>
            </div>
            <div className="text-[9px] font-mono text-slate mt-0.5">
              {(data?.critical_low_stock.out_of_stock ?? 0) > 0 ? `${data?.critical_low_stock.out_of_stock} depleted` : "Stock above zero"}
            </div>
          </Link>

          {/* 2. Expected In-Transit Goods */}
          <Link
            href="/dashboard/procurement/purchase-orders?status=issued"
            className="p-2.5 rounded border border-ink-mid bg-ink-light hover:border-signal transition block group"
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase font-mono text-slate-light">In-Transit / Orders</span>
              <Package className="h-3.5 w-3.5 text-blue-400" />
            </div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="text-base font-mono font-bold text-paper">
                {loading && !data ? "..." : data?.expected_deliveries.count ?? 0}
              </span>
              <span className="text-[10px] text-slate-light">POs active</span>
            </div>
            <div className="text-[9px] font-mono text-slate mt-0.5">
              {(data?.expected_deliveries.overdue_count ?? 0) > 0 ? (
                <span className="text-rose-400">{data?.expected_deliveries.overdue_count} overdue delivery</span>
              ) : (
                `Value ${formatMoney(data?.expected_deliveries.value ?? 0)}`
              )}
            </div>
          </Link>

          {/* 3. Decisions Awaiting Approval */}
          <Link
            href="/dashboard/procurement/requisitions?status=submitted"
            className="p-2.5 rounded border border-ink-mid bg-ink-light hover:border-signal transition block group"
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase font-mono text-slate-light">Pending Approvals</span>
              <Clock className="h-3.5 w-3.5 text-amber-400" />
            </div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className={`text-base font-mono font-bold ${(data?.pending_approvals.total ?? 0) > 0 ? "text-amber-300" : "text-paper"}`}>
                {loading && !data ? "..." : data?.pending_approvals.total ?? 0}
              </span>
              <span className="text-[10px] text-slate-light">items</span>
            </div>
            <div className="text-[9px] font-mono text-slate mt-0.5">
              {data ? `${data.pending_approvals.requisitions} PRs · ${data.pending_approvals.orders} POs` : "Awaiting review"}
            </div>
          </Link>

          {/* 4. Unmatched & Disputed Invoices */}
          <Link
            href="/dashboard/procurement/invoices?match_status=unmatched"
            className="p-2.5 rounded border border-ink-mid bg-ink-light hover:border-signal transition block group"
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase font-mono text-slate-light">Unmatched Invoices</span>
              <FileText className={`h-3.5 w-3.5 ${(data?.unmatched_invoices.count ?? 0) > 0 ? "text-amber-400" : "text-slate"}`} />
            </div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className={`text-base font-mono font-bold ${(data?.unmatched_invoices.count ?? 0) > 0 ? "text-amber-300" : "text-paper"}`}>
                {loading && !data ? "..." : data?.unmatched_invoices.count ?? 0}
              </span>
              <span className="text-[10px] text-slate-light">pending</span>
            </div>
            <div className="text-[9px] font-mono text-slate mt-0.5">
              {(data?.unmatched_invoices.disputed_count ?? 0) > 0 ? (
                <span className="text-rose-400">{data?.unmatched_invoices.disputed_count} disputed / over</span>
              ) : (
                `Value ${formatMoney(data?.unmatched_invoices.value ?? 0)}`
              )}
            </div>
          </Link>

          {/* 5. Spend Committed vs Budget */}
          <Link
            href="/dashboard/finance/budgets"
            className="p-2.5 rounded border border-ink-mid bg-ink-light hover:border-signal transition block group"
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase font-mono text-slate-light">Committed Spend</span>
              <DollarSign className="h-3.5 w-3.5 text-emerald-400" />
            </div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="text-base font-mono font-bold text-paper">
                {loading && !data ? "..." : formatMoney(data?.financial_commitments.committed_amount ?? 0)}
              </span>
            </div>
            <div className="text-[9px] font-mono text-slate mt-0.5 truncate">
              {data && data.financial_commitments.approved_budget > 0
                ? `${Math.round(((data.financial_commitments.committed_amount / data.financial_commitments.approved_budget) * 100))}% of ${formatMoney(data.financial_commitments.approved_budget)}`
                : "Active commitments"}
            </div>
          </Link>
        </div>
      )}
    </div>
  );
}
