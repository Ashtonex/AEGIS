"use client";

import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Box,
  Building2,
  ChevronRight,
  FileText,
  Loader2,
  Package,
  PackageMinus,
  PackagePlus,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  Store,
  Truck,
  Warehouse,
  X,
} from "lucide-react";
import { RBACGuard } from "@/components/auth/RBACGuard";
import {
  addInventoryItem,
  addInventoryStore,
  getInventoryCatalogue,
  getInventoryStockLevels,
  getInventoryStores,
  getInternalProjects,
  getStockMovements,
  issueStock,
  receiveStock,
} from "@/lib/api";

type Rec = Record<string, any> & { id: string };
type ActiveTab = "stock" | "catalogue" | "stores" | "movements";

function tx(v: unknown, fallback = "\u2014") {
  return typeof v === "string" && v.trim() ? v.trim() : (v != null && String(v).trim() ? String(v).trim() : fallback);
}
function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}
function money(v: unknown) {
  return new Intl.NumberFormat("en-ZW", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num(v));
}
function qty(v: unknown) {
  return new Intl.NumberFormat("en-ZW", { maximumFractionDigits: 3 }).format(num(v));
}
function dateShort(v: unknown) {
  if (!v) return "\u2014";
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? String(v) : new Intl.DateTimeFormat("en-ZW", { dateStyle: "medium", timeStyle: "short" }).format(d);
}

function loadFailureMessage(reason: unknown) {
  const rawMessage = reason instanceof Error ? reason.message : String(reason ?? "");
  const normalizedMessage = rawMessage.toLowerCase();
  if (
    normalizedMessage.includes("signal is aborted") ||
    normalizedMessage.includes("operation was aborted") ||
    normalizedMessage.includes("aborterror") ||
    normalizedMessage.includes("timeouterror")
  ) {
    return "The inventory feed is still synchronizing. Please retry once the connection is ready.";
  }
  return "Inventory data could not be loaded.";
}

function normalizeActionError(reason: unknown, fallback: string) {
  const rawMessage = reason instanceof Error ? reason.message : String(reason ?? "");
  if (/aborted|cancelled|timed out|network error|fetch failed|not found/i.test(rawMessage)) {
    return fallback;
  }
  return fallback;
}

export default function InventoryPage() {
  return (
    <RBACGuard allowedRoles={["Executive (Admin)", "Project Manager", "Site Agent", "Site Clerk", "Quantity Surveyor", "Store Keeper"]}>
      <InventoryWorkspace />
    </RBACGuard>
  );
}

function InventoryWorkspace() {
  const [tab, setTab] = useState<ActiveTab>("stock");
  const [stockLevels, setStockLevels] = useState<Rec[]>([]);
  const [catalogue, setCatalogue] = useState<Rec[]>([]);
  const [stores, setStores] = useState<Rec[]>([]);
  const [movements, setMovements] = useState<Rec[]>([]);
  const [projects, setProjects] = useState<Rec[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [sourceWarnings, setSourceWarnings] = useState<string[]>([]);

  const [stockSearch, setStockSearch] = useState("");
  const [storeFilter, setStoreFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [belowReorder, setBelowReorder] = useState(false);
  const [catSearch, setCatSearch] = useState("");
  const [movDateFrom, setMovDateFrom] = useState("");
  const [movDateTo, setMovDateTo] = useState("");
  const [movTypeFilter, setMovTypeFilter] = useState("");
  const [movStoreFilter, setMovStoreFilter] = useState("");

  const [showIssue, setShowIssue] = useState(false);
  const [showReceive, setShowReceive] = useState(false);
  const [showAddItem, setShowAddItem] = useState(false);
  const [showAddStore, setShowAddStore] = useState(false);
  const [catalogueDetail, setCatalogueDetail] = useState<Rec | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [stockRes, catRes, storeRes, movRes, projRes] = await Promise.allSettled([
        getInventoryStockLevels(),
        getInventoryCatalogue(),
        getInventoryStores(),
        getStockMovements({ limit: 200 }),
        getInternalProjects(),
      ]);
      const warnings: string[] = [];
      if (stockRes.status === "fulfilled") setStockLevels(Array.isArray(stockRes.value.data) ? stockRes.value.data : []);
      else warnings.push("Stock levels could not be loaded.");
      if (catRes.status === "fulfilled") setCatalogue(Array.isArray(catRes.value.data) ? catRes.value.data : []);
      else warnings.push("Inventory catalogue could not be loaded.");
      if (storeRes.status === "fulfilled") setStores(Array.isArray(storeRes.value.data) ? storeRes.value.data : []);
      else warnings.push("Store register could not be loaded.");
      if (movRes.status === "fulfilled") setMovements(Array.isArray(movRes.value.data) ? movRes.value.data : []);
      else warnings.push("Movement history could not be loaded.");
      if (projRes.status === "fulfilled") setProjects(Array.isArray(projRes.value.data) ? projRes.value.data : []);
      else warnings.push("Project register could not be loaded.");
      setSourceWarnings(warnings);
      if (stockRes.status === "rejected") {
        throw new Error(loadFailureMessage(stockRes.reason));
      }
    } catch (e) {
      setError(loadFailureMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const metrics = useMemo(() => {
    const outOfStock = stockLevels.filter((r) => num(r.available_qty ?? r.quantity ?? r.stock_quantity) <= 0);
    const belowReorderItems = stockLevels.filter((r) => {
      const q = num(r.available_qty ?? r.quantity ?? r.stock_quantity);
      const reorder = num(r.reorder_level ?? r.reorder_point);
      return q > 0 && reorder > 0 && q <= reorder;
    });
    const totalValue = stockLevels.reduce((sum, r) => {
      const q = num(r.available_qty ?? r.quantity ?? r.stock_quantity);
      const c = num(r.standard_cost ?? r.unit_cost);
      return sum + q * c;
    }, 0);
    const yesterday = Date.now() - 86_400_000;
    const recentMovements = movements.filter((m) => new Date(m.created_at ?? m.movement_date ?? 0).getTime() > yesterday);
    return {
      totalSKUs: catalogue.length,
      totalValue,
      belowReorder: belowReorderItems.length,
      outOfStock: outOfStock.length,
      storesCount: stores.length,
      recentMovements: recentMovements.length,
    };
  }, [stockLevels, catalogue, stores, movements]);

  const filteredStock = useMemo(() => {
    return stockLevels.filter((r) => {
      const q = num(r.available_qty ?? r.quantity ?? r.stock_quantity);
      const reorder = num(r.reorder_level ?? r.reorder_point);
      if (belowReorder && q > reorder) return false;
      if (storeFilter && tx(r.store_id) !== storeFilter && tx(r.store_name) !== storeFilter) return false;
      if (categoryFilter && tx(r.category).toLowerCase() !== categoryFilter.toLowerCase()) return false;
      const hay = `${tx(r.item_code)} ${tx(r.item_name)} ${tx(r.category)} ${tx(r.store_name)}`.toLowerCase();
      return hay.includes(stockSearch.toLowerCase());
    });
  }, [stockLevels, belowReorder, storeFilter, categoryFilter, stockSearch]);

  const filteredCatalogue = useMemo(() => {
    const q = catSearch.toLowerCase();
    return catalogue.filter((r) => `${tx(r.item_code)} ${tx(r.item_name ?? r.name)} ${tx(r.category)}`.toLowerCase().includes(q));
  }, [catalogue, catSearch]);

  const filteredMovements = useMemo(() => {
    return movements.filter((m) => {
      if (movTypeFilter && tx(m.movement_type).toLowerCase() !== movTypeFilter.toLowerCase()) return false;
      if (movStoreFilter && tx(m.store_id) !== movStoreFilter && tx(m.store_name) !== movStoreFilter) return false;
      const date = new Date(m.created_at ?? m.movement_date ?? 0);
      if (movDateFrom && date < new Date(movDateFrom)) return false;
      if (movDateTo && date > new Date(movDateTo + "T23:59:59")) return false;
      return true;
    });
  }, [movements, movTypeFilter, movStoreFilter, movDateFrom, movDateTo]);

  const categories = useMemo(() => {
    const cats = new Set<string>();
    [...stockLevels, ...catalogue].forEach((r) => { if (r.category) cats.add(tx(r.category)); });
    return Array.from(cats).sort();
  }, [stockLevels, catalogue]);

  const flash = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 5000);
  };

  return (
    <main className="min-h-full bg-ink p-4 text-paper sm:p-6">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-ink-mid pb-5">
        <div>
          <p className="mb-1 flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-signal">
            <Package className="h-4 w-4" /> Inventory &amp; Materials Control
          </p>
          <h1 className="font-display text-3xl font-bold uppercase tracking-tight">Stock Management</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-light">
            Real-time stock balances, catalogue management, store configuration and full movement ledger for all sites and warehouses.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowReceive(true)}
            className="inline-flex h-10 items-center gap-2 border border-emerald-500/40 bg-emerald-950/20 px-3 font-mono text-xs uppercase tracking-wider text-emerald-300 hover:border-emerald-400 hover:bg-emerald-950/40"
          >
            <PackagePlus className="h-4 w-4" /> Receive Stock
          </button>
          <button
            onClick={() => setShowIssue(true)}
            className="inline-flex h-10 items-center gap-2 bg-signal px-4 font-mono text-xs font-bold uppercase text-ink"
          >
            <PackageMinus className="h-4 w-4" /> Issue Stock
          </button>
          <button onClick={() => void load()} disabled={loading} className="inline-flex h-10 items-center gap-2 border border-ink-mid bg-ink-light px-3 font-mono text-xs uppercase tracking-wider text-slate-light hover:border-signal hover:text-paper disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
      </header>

      <section className="mb-6 grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Metric icon={<Box />} label="Total SKUs" value={loading ? "..." : String(metrics.totalSKUs)} />
        <Metric icon={<Truck />} label="Stock Value" value={loading ? "..." : money(metrics.totalValue)} />
        <Metric
          icon={<AlertTriangle />}
          label="Below Reorder"
          value={loading ? "..." : String(metrics.belowReorder)}
          tone={metrics.belowReorder > 0 ? "text-amber-300" : "text-slate-light"}
          pulse={metrics.belowReorder > 0}
        />
        <Metric
          icon={<ShieldAlert />}
          label="Out of Stock"
          value={loading ? "..." : String(metrics.outOfStock)}
          tone={metrics.outOfStock > 0 ? "text-red-300" : "text-slate-light"}
          pulse={metrics.outOfStock > 0}
        />
        <Metric icon={<Warehouse />} label="Stores" value={loading ? "..." : String(metrics.storesCount)} />
        <Metric icon={<RefreshCw />} label="Movements 24h" value={loading ? "..." : String(metrics.recentMovements)} tone="text-blue-300" />
      </section>

      {error && <Banner tone="error" message={error} />}
      {sourceWarnings.length > 0 && (
        <div className="mb-6 space-y-2">
          {sourceWarnings.map((warning) => <Banner key={warning} tone="info" message={warning} />)}
        </div>
      )}
      {notice && <Banner tone="info" message={notice} />}

      <div className="mb-0 flex border-b border-ink-mid">
        {(["stock", "catalogue", "stores", "movements"] as ActiveTab[]).map((t) => {
          const labels: Record<ActiveTab, string> = { stock: "Stock Levels", catalogue: "Item Catalogue", stores: "Stores", movements: "Stock Movements" };
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-5 py-3 font-mono text-xs uppercase tracking-wider transition-colors ${
                tab === t ? "border-b-2 border-signal text-signal" : "text-slate-light hover:text-paper"
              }`}
            >
              {labels[t]}
            </button>
          );
        })}
      </div>

      {/* Stock Levels Tab */}
      {tab === "stock" && (
        <section className="border border-t-0 border-ink-mid bg-ink">
          <div className="flex flex-wrap gap-2 border-b border-ink-mid p-4">
            <label className="flex h-9 items-center gap-2 border border-ink-mid bg-ink-light px-3">
              <Search className="h-4 w-4 text-slate" />
              <input value={stockSearch} onChange={(e) => setStockSearch(e.target.value)} placeholder="Search items…" className="bg-transparent text-sm outline-none placeholder:text-slate" />
            </label>
            <select value={storeFilter} onChange={(e) => setStoreFilter(e.target.value)} className="h-9 border border-ink-mid bg-ink-light px-3 text-sm text-paper">
              <option value="">All Stores</option>
              {stores.map((s) => <option key={s.id} value={tx(s.store_code ?? s.id)}>{tx(s.name ?? s.store_name, s.id)} ({tx(s.store_code, "")})</option>)}
            </select>
            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="h-9 border border-ink-mid bg-ink-light px-3 text-sm text-paper">
              <option value="">All Categories</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <label className="flex h-9 cursor-pointer items-center gap-2 border border-amber-500/30 bg-amber-950/10 px-3 text-xs text-amber-300">
              <input type="checkbox" checked={belowReorder} onChange={(e) => setBelowReorder(e.target.checked)} className="accent-amber-400" />
              Below Reorder Only
            </label>
          </div>
          {loading ? (
            <Loading label="Loading stock levels" />
          ) : filteredStock.length === 0 ? (
            <Empty label="No stock records match this view." sub="Receive stock or adjust filters to see balances." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-ink-mid bg-ink-light/40">
                    {["Item Code", "Item Name", "Category", "UOM", "Store / Site", "Available Qty", "Reserved Qty", "Reorder Level", "Std Cost", "Total Value"].map((h) => (
                      <th key={h} className="px-3 py-3 text-left font-mono text-[10px] uppercase tracking-wider text-slate">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-mid">
                  {filteredStock.map((r) => {
                    const avail = num(r.available_qty ?? r.quantity ?? r.stock_quantity);
                    const reorder = num(r.reorder_level ?? r.reorder_point);
                    const cost = num(r.standard_cost ?? r.unit_cost);
                    const isOut = avail <= 0;
                    const isLow = !isOut && reorder > 0 && avail <= reorder;
                    const rowClass = isOut
                      ? "bg-red-950/15 hover:bg-red-950/25"
                      : isLow
                      ? "bg-amber-950/15 hover:bg-amber-950/25"
                      : "hover:bg-ink-light/40";
                    return (
                      <tr key={r.id} className={rowClass}>
                        <td className="px-3 py-2.5 font-mono text-xs text-signal">{tx(r.item_code)}</td>
                        <td className="px-3 py-2.5 font-medium text-paper">
                          <div className="flex items-center gap-2">
                            {isOut && <span className="inline-block rounded-sm bg-red-500/20 px-1.5 py-0.5 font-mono text-[9px] uppercase text-red-300">Out</span>}
                            {isLow && <span className="inline-block rounded-sm bg-amber-500/20 px-1.5 py-0.5 font-mono text-[9px] uppercase text-amber-300">Low</span>}
                            {tx(r.item_name ?? r.name)}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-slate-light">{tx(r.category)}</td>
                        <td className="px-3 py-2.5 text-slate-light">{tx(r.uom ?? r.unit_of_measure)}</td>
                        <td className="px-3 py-2.5 text-slate-light">{tx(r.store_name ?? r.store_code)}</td>
                        <td className={`px-3 py-2.5 font-mono font-semibold ${isOut ? "text-red-300" : isLow ? "text-amber-300" : "text-emerald-300"}`}>{qty(avail)}</td>
                        <td className="px-3 py-2.5 font-mono text-slate-light">{qty(r.reserved_qty ?? 0)}</td>
                        <td className={`px-3 py-2.5 font-mono ${reorder > 0 ? "text-slate-light" : "text-slate"}`}>{reorder > 0 ? qty(reorder) : "\u2014"}</td>
                        <td className="px-3 py-2.5 font-mono text-slate-light">{cost > 0 ? money(cost) : "\u2014"}</td>
                        <td className="px-3 py-2.5 font-mono font-semibold text-paper">{cost > 0 ? money(avail * cost) : "\u2014"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="border-t border-ink-mid px-4 py-2 text-right font-mono text-xs text-slate-light">{filteredStock.length} records</div>
            </div>
          )}
        </section>
      )}

      {/* Item Catalogue Tab */}
      {tab === "catalogue" && (
        <section className="border border-t-0 border-ink-mid bg-ink">
          <div className="flex flex-wrap items-center gap-2 border-b border-ink-mid p-4">
            <label className="flex h-9 items-center gap-2 border border-ink-mid bg-ink-light px-3">
              <Search className="h-4 w-4 text-slate" />
              <input value={catSearch} onChange={(e) => setCatSearch(e.target.value)} placeholder="Search catalogue…" className="bg-transparent text-sm outline-none placeholder:text-slate" />
            </label>
            <div className="ml-auto">
              <button onClick={() => setShowAddItem(true)} className="inline-flex h-9 items-center gap-2 bg-signal px-4 font-mono text-xs font-bold uppercase text-ink">
                <Plus className="h-4 w-4" /> Add Item
              </button>
            </div>
          </div>
          {loading ? (
            <Loading label="Loading item catalogue" />
          ) : filteredCatalogue.length === 0 ? (
            <Empty label="No items in catalogue." sub="Add items to start tracking stock across stores." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-ink-mid bg-ink-light/40">
                    {["Item Code", "Description", "Category", "UOM", "Std Cost", "Hazardous", "Total Stock"].map((h) => (
                      <th key={h} className="px-3 py-3 text-left font-mono text-[10px] uppercase tracking-wider text-slate">{h}</th>
                    ))}
                    <th className="px-3 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-mid">
                  {filteredCatalogue.map((r) => {
                    const totalStock = stockLevels
                      .filter((s) => tx(s.item_code) === tx(r.item_code) || tx(s.item_id) === r.id)
                      .reduce((sum, s) => sum + num(s.available_qty ?? s.quantity ?? s.stock_quantity), 0);
                    return (
                      <tr key={r.id} className="cursor-pointer hover:bg-ink-light/40" onClick={() => setCatalogueDetail(r)}>
                        <td className="px-3 py-2.5 font-mono text-xs text-signal">{tx(r.item_code)}</td>
                        <td className="px-3 py-2.5 font-medium text-paper">{tx(r.item_name ?? r.name ?? r.description)}</td>
                        <td className="px-3 py-2.5 text-slate-light">{tx(r.category)}</td>
                        <td className="px-3 py-2.5 text-slate-light">{tx(r.uom ?? r.unit_of_measure)}</td>
                        <td className="px-3 py-2.5 font-mono text-slate-light">{num(r.standard_cost) > 0 ? money(r.standard_cost) : "\u2014"}</td>
                        <td className="px-3 py-2.5">
                          {r.is_hazardous ? (
                            <span className="inline-block border border-red-500/40 bg-red-950/20 px-2 py-0.5 font-mono text-[10px] uppercase text-red-300">Yes</span>
                          ) : (
                            <span className="font-mono text-[10px] text-slate">No</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 font-mono font-semibold text-emerald-300">{qty(totalStock)}</td>
                        <td className="px-3 py-2.5 text-slate"><ChevronRight className="h-4 w-4" /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="border-t border-ink-mid px-4 py-2 text-right font-mono text-xs text-slate-light">{filteredCatalogue.length} items</div>
            </div>
          )}
        </section>
      )}

      {/* Stores Tab */}
      {tab === "stores" && (
        <section className="border border-t-0 border-ink-mid bg-ink p-4">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-mono text-xs font-bold uppercase tracking-wider text-paper">Store Register</h2>
            <button onClick={() => setShowAddStore(true)} className="inline-flex h-9 items-center gap-2 bg-signal px-4 font-mono text-xs font-bold uppercase text-ink">
              <Plus className="h-4 w-4" /> Add Store
            </button>
          </div>
          {loading ? (
            <Loading label="Loading stores" />
          ) : stores.length === 0 ? (
            <Empty label="No stores registered." sub="Add a warehouse, site store, or yard to begin tracking stock." />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {stores.map((s) => {
                const storeItems = stockLevels.filter((r) => tx(r.store_id) === s.id || tx(r.store_name) === tx(s.name));
                const storeValue = storeItems.reduce((sum, r) => {
                  const q = num(r.available_qty ?? r.quantity ?? r.stock_quantity);
                  const c = num(r.standard_cost ?? r.unit_cost);
                  return sum + q * c;
                }, 0);
                const typeLabel = tx(s.store_type ?? s.type, "store");
                const typeIcon = typeLabel.toLowerCase().includes("warehouse")
                  ? <Warehouse className="h-4 w-4" />
                  : typeLabel.toLowerCase().includes("yard")
                  ? <Truck className="h-4 w-4" />
                  : <Store className="h-4 w-4" />;
                return (
                  <div key={s.id} className="border border-ink-mid bg-ink-light/30 p-4 hover:border-signal/30">
                    <div className="mb-3 flex items-start justify-between gap-2">
                      <div>
                        <p className="font-mono text-xs uppercase tracking-wider text-signal">{tx(s.store_code)}</p>
                        <p className="mt-0.5 font-semibold text-paper">{tx(s.name ?? s.store_name)}</p>
                      </div>
                      <span className="flex items-center gap-1 border border-ink-mid bg-ink px-2 py-1 font-mono text-[10px] uppercase text-slate-light">
                        {typeIcon} {typeLabel}
                      </span>
                    </div>
                    {(s.project_name || s.site_name) ? (
                      <p className="mb-3 text-xs text-slate-light"><Building2 className="mr-1 inline h-3 w-3" />{tx(s.project_name ?? s.site_name)}</p>
                    ) : null}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="border border-ink-mid/60 bg-ink p-2 text-center">
                        <p className="font-mono text-lg font-semibold text-paper">{storeItems.length}</p>
                        <p className="font-mono text-[10px] uppercase text-slate">Items</p>
                      </div>
                      <div className="border border-ink-mid/60 bg-ink p-2 text-center">
                        <p className="font-mono text-sm font-semibold text-paper">{money(storeValue)}</p>
                        <p className="font-mono text-[10px] uppercase text-slate">Value</p>
                      </div>
                    </div>
                    {s.location && <p className="mt-3 truncate text-xs text-slate">{tx(s.location)}</p>}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* Stock Movements Tab */}
      {tab === "movements" && (
        <section className="border border-t-0 border-ink-mid bg-ink">
          <div className="flex flex-wrap gap-2 border-b border-ink-mid p-4">
            <input type="date" value={movDateFrom} onChange={(e) => setMovDateFrom(e.target.value)} className="h-9 border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
            <input type="date" value={movDateTo} onChange={(e) => setMovDateTo(e.target.value)} className="h-9 border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
            <select value={movTypeFilter} onChange={(e) => setMovTypeFilter(e.target.value)} className="h-9 border border-ink-mid bg-ink-light px-3 text-sm text-paper">
              <option value="">All Types</option>
              {["receipt", "issue", "consumption", "transfer", "adjustment", "return"].map((t) => (
                <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>
              ))}
            </select>
            <select value={movStoreFilter} onChange={(e) => setMovStoreFilter(e.target.value)} className="h-9 border border-ink-mid bg-ink-light px-3 text-sm text-paper">
              <option value="">All Stores</option>
              {stores.map((s) => <option key={s.id} value={tx(s.store_code ?? s.id)}>{tx(s.name ?? s.store_name, s.id)}</option>)}
            </select>
            {(movDateFrom || movDateTo || movTypeFilter || movStoreFilter) && (
              <button onClick={() => { setMovDateFrom(""); setMovDateTo(""); setMovTypeFilter(""); setMovStoreFilter(""); }} className="h-9 border border-ink-mid px-3 font-mono text-xs text-slate-light hover:text-paper">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          {loading ? (
            <Loading label="Loading stock movements" />
          ) : filteredMovements.length === 0 ? (
            <Empty label="No movements match this filter." sub="Try changing the date range or type filter." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-ink-mid bg-ink-light/40">
                    {["Date", "Item", "Type", "Quantity", "Store", "Project", "Reference", "Recorded By"].map((h) => (
                      <th key={h} className="px-3 py-3 text-left font-mono text-[10px] uppercase tracking-wider text-slate">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-mid">
                  {filteredMovements.map((m) => {
                    const q = num(m.quantity ?? m.qty);
                    const mtype = tx(m.movement_type, "").toLowerCase();
                    const isDebit = mtype === "issue" || mtype === "consumption";
                    return (
                      <tr key={m.id} className="hover:bg-ink-light/40">
                        <td className="px-3 py-2.5 font-mono text-xs text-slate-light">{dateShort(m.created_at ?? m.movement_date)}</td>
                        <td className="px-3 py-2.5 text-paper">{tx(m.item_name ?? m.item_code)}</td>
                        <td className="px-3 py-2.5"><MovBadge type={mtype} /></td>
                        <td className="px-3 py-2.5">
                          <span className={`flex items-center gap-1 font-mono font-semibold ${isDebit ? "text-red-300" : "text-emerald-300"}`}>
                            {isDebit ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />}
                            {qty(q)}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-slate-light">{tx(m.store_name ?? m.store_code)}</td>
                        <td className="px-3 py-2.5 text-slate-light">{tx(m.project_name ?? m.project_id)}</td>
                        <td className="px-3 py-2.5 font-mono text-xs text-slate-light">{tx(m.reference ?? m.ref)}</td>
                        <td className="px-3 py-2.5 text-slate-light">{tx(m.recorded_by ?? m.created_by)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="border-t border-ink-mid px-4 py-2 text-right font-mono text-xs text-slate-light">{filteredMovements.length} movements</div>
            </div>
          )}
        </section>
      )}

      {/* Modals */}
      {showIssue && (
        <IssueStockModal
          catalogue={catalogue}
          stores={stores}
          projects={projects}
          saving={saving}
          onClose={() => setShowIssue(false)}
          onSubmit={async (payload) => {
            setSaving(true);
            try {
              await issueStock(payload);
              flash("Stock issue recorded successfully.");
              setShowIssue(false);
              await load();
            } catch (e) {
              flash(normalizeActionError(e, "Failed to issue stock."));
            } finally {
              setSaving(false);
            }
          }}
        />
      )}
      {showReceive && (
        <ReceiveStockModal
          catalogue={catalogue}
          stores={stores}
          saving={saving}
          onClose={() => setShowReceive(false)}
          onSubmit={async (payload) => {
            setSaving(true);
            try {
              await receiveStock(payload);
              flash("Stock receipt recorded successfully.");
              setShowReceive(false);
              await load();
            } catch (e) {
              flash(normalizeActionError(e, "Failed to receive stock."));
            } finally {
              setSaving(false);
            }
          }}
        />
      )}
      {showAddItem && (
        <AddItemModal
          saving={saving}
          onClose={() => setShowAddItem(false)}
          onSubmit={async (payload) => {
            setSaving(true);
            try {
              await addInventoryItem(payload);
              flash("Item added to catalogue.");
              setShowAddItem(false);
              await load();
            } catch (e) {
              flash(normalizeActionError(e, "Failed to add item."));
            } finally {
              setSaving(false);
            }
          }}
        />
      )}
      {showAddStore && (
        <AddStoreModal
          saving={saving}
          projects={projects}
          onClose={() => setShowAddStore(false)}
          onSubmit={async (payload) => {
            setSaving(true);
            try {
              await addInventoryStore(payload);
              flash("Store registered successfully.");
              setShowAddStore(false);
              await load();
            } catch (e) {
              flash(normalizeActionError(e, "Failed to add store."));
            } finally {
              setSaving(false);
            }
          }}
        />
      )}
      {catalogueDetail && (
        <CatalogueDetailPanel
          item={catalogueDetail}
          stockLevels={stockLevels.filter((s) => tx(s.item_code) === tx(catalogueDetail.item_code) || tx(s.item_id) === catalogueDetail.id)}
          movements={movements.filter((m) => tx(m.item_code) === tx(catalogueDetail.item_code) || tx(m.item_id) === catalogueDetail.id).slice(0, 20)}
          onClose={() => setCatalogueDetail(null)}
        />
      )}
    </main>
  );
}

function Metric({ icon, label, value, tone = "text-paper", pulse = false }: { icon: ReactNode; label: string; value: string; tone?: string; pulse?: boolean }) {
  return (
    <div className={`border bg-ink p-4 ${pulse ? "border-amber-500/30" : "border-ink-mid"}`}>
      <div className="flex items-center justify-between text-slate">
        <p className="font-mono text-[10px] uppercase tracking-wider">{label}</p>
        <span className={`${pulse ? "text-amber-400" : "text-signal"} [&_svg]:h-4 [&_svg]:w-4`}>{icon}</span>
      </div>
      <p className={`mt-4 font-mono text-2xl ${tone}`}>{value}</p>
    </div>
  );
}

function Banner({ tone, message }: { tone: "error" | "info"; message: string }) {
  const style = tone === "error" ? "border-red-500/30 bg-red-950/20 text-red-200" : "border-signal/30 bg-signal/10 text-slate-light";
  return (
    <div className={`mb-4 flex gap-3 border p-4 text-sm ${style}`}>
      <AlertTriangle className="h-5 w-5 shrink-0" /> {message}
    </div>
  );
}

function Loading({ label }: { label: string }) {
  return (
    <div className="flex h-48 items-center justify-center gap-3 text-sm text-slate-light">
      <Loader2 className="h-5 w-5 animate-spin text-signal" /> {label}
    </div>
  );
}

function Empty({ label, sub }: { label: string; sub?: string }) {
  return (
    <div className="flex h-48 flex-col items-center justify-center p-6 text-center text-slate-light">
      <FileText className="h-8 w-8 text-slate" />
      <p className="mt-3 text-sm text-paper">{label}</p>
      {sub && <p className="mt-1 text-xs">{sub}</p>}
    </div>
  );
}

function MovBadge({ type }: { type: string }) {
  const map: Record<string, string> = {
    receipt: "border-emerald-500/40 bg-emerald-950/20 text-emerald-300",
    issue: "border-blue-500/40 bg-blue-950/20 text-blue-300",
    consumption: "border-amber-500/40 bg-amber-950/20 text-amber-300",
    transfer: "border-purple-500/40 bg-purple-950/20 text-purple-300",
    adjustment: "border-slate-500/40 bg-slate-950/20 text-slate-300",
    return: "border-teal-500/40 bg-teal-950/20 text-teal-300",
  };
  const cls = map[type] ?? "border-ink-mid bg-ink-light text-slate-light";
  return <span className={`inline-block border px-2 py-0.5 font-mono text-[10px] uppercase ${cls}`}>{type || "\u2014"}</span>;
}

function IssueStockModal({ catalogue, stores, projects, saving, onClose, onSubmit }: {
  catalogue: Rec[]; stores: Rec[]; projects: Rec[]; saving: boolean;
  onClose: () => void; onSubmit: (p: Record<string, unknown>) => void;
}) {
  const [form, setForm] = useState({ item_id: "", store_id: "", quantity: "", project_id: "", work_package: "", notes: "" });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <ModalShell title="Issue Stock" onClose={onClose}>
      <div className="grid gap-3">
        <FieldGroup label="Item">
          <select value={form.item_id} onChange={(e) => set("item_id", e.target.value)} className="field">
            <option value="">Select item</option>
            {catalogue.map((i) => <option key={i.id} value={i.id}>{tx(i.item_code)} \u2014 {tx(i.item_name ?? i.name)}</option>)}
          </select>
        </FieldGroup>
        <FieldGroup label="Store">
          <select value={form.store_id} onChange={(e) => set("store_id", e.target.value)} className="field">
            <option value="">Select store</option>
            {stores.map((s) => <option key={s.id} value={s.id}>{tx(s.name ?? s.store_name)} ({tx(s.store_code)})</option>)}
          </select>
        </FieldGroup>
        <FieldGroup label="Quantity">
          <input type="number" min="0" value={form.quantity} onChange={(e) => set("quantity", e.target.value)} placeholder="0.000" className="field" />
        </FieldGroup>
        <FieldGroup label="Project">
          <select value={form.project_id} onChange={(e) => set("project_id", e.target.value)} className="field">
            <option value="">Select project (optional)</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{tx(p.name ?? p.project_name ?? p.project_code, p.id)}</option>)}
          </select>
        </FieldGroup>
        <FieldGroup label="Work Package">
          <input value={form.work_package} onChange={(e) => set("work_package", e.target.value)} placeholder="e.g. WP-05 Structural Concrete" className="field" />
        </FieldGroup>
        <FieldGroup label="Notes">
          <input value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Optional notes" className="field" />
        </FieldGroup>
      </div>
      <div className="mt-6 flex justify-end gap-3">
        <button onClick={onClose} className="h-10 border border-ink-mid px-4 font-mono text-xs uppercase text-slate-light hover:text-paper">Cancel</button>
        <button
          onClick={() => onSubmit({ ...form, quantity: Number(form.quantity) })}
          disabled={saving || !form.item_id || !form.store_id || !form.quantity}
          className="inline-flex h-10 items-center gap-2 bg-signal px-4 font-mono text-xs font-bold uppercase text-ink disabled:opacity-50"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          <PackageMinus className="h-4 w-4" /> Issue Stock
        </button>
      </div>
    </ModalShell>
  );
}

function ReceiveStockModal({ catalogue, stores, saving, onClose, onSubmit }: {
  catalogue: Rec[]; stores: Rec[]; saving: boolean;
  onClose: () => void; onSubmit: (p: Record<string, unknown>) => void;
}) {
  const [form, setForm] = useState({ item_id: "", store_id: "", quantity: "", unit_cost: "", reference: "", notes: "" });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <ModalShell title="Receive Stock" onClose={onClose}>
      <div className="grid gap-3">
        <FieldGroup label="Item">
          <select value={form.item_id} onChange={(e) => set("item_id", e.target.value)} className="field">
            <option value="">Select item</option>
            {catalogue.map((i) => <option key={i.id} value={i.id}>{tx(i.item_code)} \u2014 {tx(i.item_name ?? i.name)}</option>)}
          </select>
        </FieldGroup>
        <FieldGroup label="Store">
          <select value={form.store_id} onChange={(e) => set("store_id", e.target.value)} className="field">
            <option value="">Select store</option>
            {stores.map((s) => <option key={s.id} value={s.id}>{tx(s.name ?? s.store_name)} ({tx(s.store_code)})</option>)}
          </select>
        </FieldGroup>
        <div className="grid grid-cols-2 gap-3">
          <FieldGroup label="Quantity">
            <input type="number" min="0" value={form.quantity} onChange={(e) => set("quantity", e.target.value)} placeholder="0.000" className="field" />
          </FieldGroup>
          <FieldGroup label="Unit Cost (USD)">
            <input type="number" min="0" value={form.unit_cost} onChange={(e) => set("unit_cost", e.target.value)} placeholder="0.00" className="field" />
          </FieldGroup>
        </div>
        <FieldGroup label="Reference / LPO / GRN">
          <input value={form.reference} onChange={(e) => set("reference", e.target.value)} placeholder="e.g. LPO-2026-0041" className="field" />
        </FieldGroup>
        <FieldGroup label="Notes">
          <input value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Optional notes" className="field" />
        </FieldGroup>
      </div>
      <div className="mt-6 flex justify-end gap-3">
        <button onClick={onClose} className="h-10 border border-ink-mid px-4 font-mono text-xs uppercase text-slate-light hover:text-paper">Cancel</button>
        <button
          onClick={() => onSubmit({ ...form, quantity: Number(form.quantity), unit_cost: Number(form.unit_cost) })}
          disabled={saving || !form.item_id || !form.store_id || !form.quantity}
          className="inline-flex h-10 items-center gap-2 border border-emerald-500/50 bg-emerald-950/30 px-4 font-mono text-xs font-bold uppercase text-emerald-300 disabled:opacity-50 hover:bg-emerald-950/50"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          <PackagePlus className="h-4 w-4" /> Receive Stock
        </button>
      </div>
    </ModalShell>
  );
}

function AddItemModal({ saving, onClose, onSubmit }: { saving: boolean; onClose: () => void; onSubmit: (p: Record<string, unknown>) => void }) {
  const [form, setForm] = useState({ item_code: "", item_name: "", category: "", uom: "", standard_cost: "", reorder_level: "", is_hazardous: false, description: "" });
  const set = (k: string, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <ModalShell title="Add Catalogue Item" onClose={onClose}>
      <div className="grid gap-3 md:grid-cols-2">
        <FieldGroup label="Item Code">
          <input value={form.item_code} onChange={(e) => set("item_code", e.target.value)} placeholder="e.g. MAT-001" className="field" />
        </FieldGroup>
        <FieldGroup label="Item Name">
          <input value={form.item_name} onChange={(e) => set("item_name", e.target.value)} placeholder="e.g. Portland Cement 50kg" className="field" />
        </FieldGroup>
        <FieldGroup label="Category">
          <input value={form.category} onChange={(e) => set("category", e.target.value)} placeholder="e.g. Structural Materials" className="field" />
        </FieldGroup>
        <FieldGroup label="Unit of Measure">
          <input value={form.uom} onChange={(e) => set("uom", e.target.value)} placeholder="e.g. Bag / m\u00b3 / kg" className="field" />
        </FieldGroup>
        <FieldGroup label="Standard Cost (USD)">
          <input type="number" min="0" value={form.standard_cost} onChange={(e) => set("standard_cost", e.target.value)} placeholder="0.00" className="field" />
        </FieldGroup>
        <FieldGroup label="Reorder Level">
          <input type="number" min="0" value={form.reorder_level} onChange={(e) => set("reorder_level", e.target.value)} placeholder="Min qty before alert" className="field" />
        </FieldGroup>
        <div className="md:col-span-2">
          <FieldGroup label="Description">
            <input value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="Optional description" className="field" />
          </FieldGroup>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-light md:col-span-2">
          <input type="checkbox" checked={form.is_hazardous} onChange={(e) => set("is_hazardous", e.target.checked)} className="accent-red-400" />
          Mark as hazardous material (will display HAZMAT indicator)
        </label>
      </div>
      <div className="mt-6 flex justify-end gap-3">
        <button onClick={onClose} className="h-10 border border-ink-mid px-4 font-mono text-xs uppercase text-slate-light hover:text-paper">Cancel</button>
        <button
          onClick={() => onSubmit({ ...form, standard_cost: Number(form.standard_cost), reorder_level: Number(form.reorder_level) })}
          disabled={saving || !form.item_code || !form.item_name}
          className="inline-flex h-10 items-center gap-2 bg-signal px-4 font-mono text-xs font-bold uppercase text-ink disabled:opacity-50"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          <Plus className="h-4 w-4" /> Add Item
        </button>
      </div>
    </ModalShell>
  );
}

function AddStoreModal({ saving, projects, onClose, onSubmit }: { saving: boolean; projects: Rec[]; onClose: () => void; onSubmit: (p: Record<string, unknown>) => void }) {
  const [form, setForm] = useState({ name: "", store_code: "", store_type: "warehouse", project_id: "", location: "" });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <ModalShell title="Register Store / Yard" onClose={onClose}>
      <div className="grid gap-3 md:grid-cols-2">
        <FieldGroup label="Store Name">
          <input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Central Warehouse" className="field" />
        </FieldGroup>
        <FieldGroup label="Store Code">
          <input value={form.store_code} onChange={(e) => set("store_code", e.target.value)} placeholder="e.g. WH-001" className="field" />
        </FieldGroup>
        <FieldGroup label="Type">
          <select value={form.store_type} onChange={(e) => set("store_type", e.target.value)} className="field">
            <option value="warehouse">Warehouse</option>
            <option value="site">Site Store</option>
            <option value="yard">Yard</option>
            <option value="transit">Transit</option>
          </select>
        </FieldGroup>
        <FieldGroup label="Project / Site">
          <select value={form.project_id} onChange={(e) => set("project_id", e.target.value)} className="field">
            <option value="">Not project-specific</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{tx(p.name ?? p.project_name ?? p.project_code, p.id)}</option>)}
          </select>
        </FieldGroup>
        <div className="md:col-span-2">
          <FieldGroup label="Location / Address">
            <input value={form.location} onChange={(e) => set("location", e.target.value)} placeholder="Physical location or GPS reference" className="field" />
          </FieldGroup>
        </div>
      </div>
      <div className="mt-6 flex justify-end gap-3">
        <button onClick={onClose} className="h-10 border border-ink-mid px-4 font-mono text-xs uppercase text-slate-light hover:text-paper">Cancel</button>
        <button
          onClick={() => onSubmit(form)}
          disabled={saving || !form.name || !form.store_code}
          className="inline-flex h-10 items-center gap-2 bg-signal px-4 font-mono text-xs font-bold uppercase text-ink disabled:opacity-50"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          <Plus className="h-4 w-4" /> Register Store
        </button>
      </div>
    </ModalShell>
  );
}

function CatalogueDetailPanel({ item, stockLevels, movements, onClose }: { item: Rec; stockLevels: Rec[]; movements: Rec[]; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm">
      <aside className="ml-auto flex h-full w-full max-w-2xl flex-col overflow-y-auto border-l border-ink-mid bg-ink text-paper shadow-2xl">
        <header className="sticky top-0 z-10 flex items-start justify-between border-b border-ink-mid bg-ink p-5">
          <div>
            <p className="font-mono text-xs uppercase tracking-widest text-signal">Item Detail</p>
            <h2 className="mt-1 text-xl font-semibold">{tx(item.item_name ?? item.name)}</h2>
            <p className="mt-0.5 font-mono text-xs text-slate-light">{tx(item.item_code)} \u00b7 {tx(item.category)} \u00b7 {tx(item.uom ?? item.unit_of_measure)}</p>
          </div>
          <button onClick={onClose} className="border border-ink-mid p-2 text-slate-light hover:border-signal hover:text-paper"><X className="h-5 w-5" /></button>
        </header>
        <div className="space-y-5 p-5">
          <section className="grid grid-cols-2 gap-3">
            <InfoCard label="Standard Cost" value={num(item.standard_cost) > 0 ? money(item.standard_cost) : "Not set"} />
            <InfoCard label="Reorder Level" value={num(item.reorder_level) > 0 ? qty(item.reorder_level) : "Not set"} />
            <InfoCard label="Hazardous" value={item.is_hazardous ? "YES \u2014 HAZMAT" : "No"} tone={item.is_hazardous ? "text-red-300" : "text-emerald-300"} />
            <InfoCard label="Description" value={tx(item.description)} />
          </section>
          <section className="border border-ink-mid p-4">
            <h3 className="mb-3 font-mono text-xs uppercase tracking-widest text-paper">Stock by Store</h3>
            {stockLevels.length === 0 ? (
              <p className="text-sm text-slate-light">No stock balances recorded in any store.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-ink-mid">
                    <th className="pb-2 text-left font-mono text-[10px] uppercase text-slate">Store</th>
                    <th className="pb-2 text-left font-mono text-[10px] uppercase text-slate">Available</th>
                    <th className="pb-2 text-left font-mono text-[10px] uppercase text-slate">Reserved</th>
                    <th className="pb-2 text-left font-mono text-[10px] uppercase text-slate">Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-mid">
                  {stockLevels.map((s) => {
                    const avail = num(s.available_qty ?? s.quantity ?? s.stock_quantity);
                    const cost = num(s.standard_cost ?? item.standard_cost ?? 0);
                    return (
                      <tr key={s.id}>
                        <td className="py-2 text-slate-light">{tx(s.store_name ?? s.store_code)}</td>
                        <td className="py-2 font-mono font-semibold text-emerald-300">{qty(avail)}</td>
                        <td className="py-2 font-mono text-slate-light">{qty(s.reserved_qty ?? 0)}</td>
                        <td className="py-2 font-mono text-paper">{cost > 0 ? money(avail * cost) : "\u2014"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
          <section className="border border-ink-mid p-4">
            <h3 className="mb-3 font-mono text-xs uppercase tracking-widest text-paper">Recent Movements</h3>
            {movements.length === 0 ? (
              <p className="text-sm text-slate-light">No movements recorded for this item.</p>
            ) : (
              <div className="space-y-2">
                {movements.map((m) => (
                  <div key={m.id} className="flex items-center justify-between border-b border-ink-mid/60 pb-2 text-sm">
                    <div>
                      <MovBadge type={tx(m.movement_type, "").toLowerCase()} />
                      <span className="ml-2 text-slate-light">{tx(m.store_name ?? m.store_code)} \u00b7 {tx(m.project_name ?? m.project_id, "No project")}</span>
                    </div>
                    <div className="text-right">
                      <p className={`font-mono font-semibold ${["issue", "consumption"].includes(tx(m.movement_type, "")) ? "text-red-300" : "text-emerald-300"}`}>{qty(m.quantity ?? m.qty)}</p>
                      <p className="font-mono text-[10px] text-slate">{dateShort(m.created_at ?? m.movement_date)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </aside>
    </div>
  );
}

function ModalShell({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-xl border border-ink-mid bg-ink shadow-2xl">
        <header className="flex items-center justify-between border-b border-ink-mid p-5">
          <h2 className="font-mono text-sm font-bold uppercase tracking-wider text-paper">{title}</h2>
          <button onClick={onClose} className="border border-ink-mid p-1.5 text-slate-light hover:border-signal hover:text-paper"><X className="h-4 w-4" /></button>
        </header>
        <div className="p-5">
          {children}
          <style>{`.field{display:block;width:100%;height:2.5rem;border:1px solid rgb(47 55 69);background:#0d1b2e;padding:0 .75rem;font-size:.875rem;color:#f0ede8}`}</style>
        </div>
      </div>
    </div>
  );
}

function FieldGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-slate">{label}</label>
      {children}
    </div>
  );
}

function InfoCard({ label, value, tone = "text-paper" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="border border-ink-mid/60 bg-ink-light/30 p-3">
      <p className="font-mono text-[10px] uppercase tracking-wider text-slate">{label}</p>
      <p className={`mt-1 text-sm font-semibold ${tone}`}>{value}</p>
    </div>
  );
}
