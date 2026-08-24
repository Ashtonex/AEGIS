"use client";

import Link from "next/link";
import { useLiveTable } from "@/lib/live/LiveDataProvider";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  Box,
  Building2,
  ChevronRight,
  ClipboardEdit,
  FileText,
  Loader2,
  Package,
  PackageMinus,
  PackagePlus,
  Plus,
  ReceiptText,
  RefreshCw,
  Search,
  ShieldAlert,
  Store,
  Truck,
  Warehouse,
  Wrench,
  X,
} from "lucide-react";
import { RBACGuard } from "@/components/auth/RBACGuard";
import {
  addInventoryItem,
  addInventoryStore,
  adjustStock,
  createInternalProject,
  createSiteOperationSite,
  createSupplierRecord,
  getInventoryCatalogue,
  getInventoryStockLevels,
  getInventoryStores,
  getInternalProjects,
  getProcurementSuppliers,
  getSiteOperationSites,
  getStockMovements,
  issueStock,
  receiveInventoryInvoice,
  receiveStock,
  transferStock,
} from "@/lib/api";

type Rec = Record<string, any> & { id: string };
type ActiveTab = "stock" | "catalogue" | "stores" | "movements";
const TAB_ROUTES: Record<ActiveTab, string> = {
  stock: "/dashboard/inventory/stock",
  catalogue: "/dashboard/inventory/catalogue",
  stores: "/dashboard/inventory/stores",
  movements: "/dashboard/inventory/movements",
};

function normalizeTab(value: string | null | undefined): ActiveTab {
  return value && value in TAB_ROUTES ? (value as ActiveTab) : "stock";
}

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
function itemType(value: unknown) {
  const normalized = tx(value, "material").toLowerCase();
  return ["material", "supply", "tool"].includes(normalized) ? normalized : "material";
}
function stockValue(row: Rec) {
  if (row.stock_value !== undefined && row.stock_value !== null) return num(row.stock_value);
  const q = num(row.available_qty ?? row.quantity ?? row.stock_quantity);
  const c = num(row.unit_price_inc_vat ?? row.standard_cost ?? row.unit_cost);
  return q * c;
}

const UNASSIGNED_CLIENT_KEY = "__unassigned_client__";

function keyFromName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || UNASSIGNED_CLIENT_KEY;
}

function projectName(project: Rec) {
  return tx(project.name ?? project.project_name ?? project.project_code, project.id);
}

function clientName(project: Rec | undefined, fallback = "Unassigned / Company Stores") {
  return tx(project?.client_name ?? project?.client ?? project?.organization_name ?? project?.organisation_name, fallback);
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
    <RBACGuard allowedRoles={["Executive (Admin)", "Project Manager", "Site Agent", "Site Clerk", "Quantity Surveyor", "Storekeeper", "Procurement Manager", "Inventory Controller", "Executive Read Only"]}>
      <InventoryWorkspace />
    </RBACGuard>
  );
}

function InventoryWorkspace() {
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<ActiveTab>(() => normalizeTab(searchParams?.get("tab")));
  const [stockLevels, setStockLevels] = useState<Rec[]>([]);
  const [catalogue, setCatalogue] = useState<Rec[]>([]);
  const [stores, setStores] = useState<Rec[]>([]);
  const [movements, setMovements] = useState<Rec[]>([]);
  const [projects, setProjects] = useState<Rec[]>([]);
  const [suppliers, setSuppliers] = useState<Rec[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [sourceWarnings, setSourceWarnings] = useState<string[]>([]);

  const [stockSearch, setStockSearch] = useState("");
  const [storeFilter, setStoreFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [itemTypeFilter, setItemTypeFilter] = useState("");
  const [belowReorder, setBelowReorder] = useState(false);
  const [catSearch, setCatSearch] = useState("");
  const [movDateFrom, setMovDateFrom] = useState("");
  const [movDateTo, setMovDateTo] = useState("");
  const [movTypeFilter, setMovTypeFilter] = useState("");
  const [movStoreFilter, setMovStoreFilter] = useState("");
  const [selectedClientKey, setSelectedClientKey] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState("");

  const [showIssue, setShowIssue] = useState(false);
  const [showReceive, setShowReceive] = useState(false);
  const [showInvoice, setShowInvoice] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [showAdjust, setShowAdjust] = useState(false);
  const [showAddItem, setShowAddItem] = useState(false);
  const [showAddStore, setShowAddStore] = useState(false);
  const [catalogueDetail, setCatalogueDetail] = useState<Rec | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [stockRes, catRes, storeRes, movRes, projRes, supRes] = await Promise.allSettled([
        getInventoryStockLevels(),
        getInventoryCatalogue(),
        getInventoryStores(),
        getStockMovements({ limit: 200 }),
        getInternalProjects(),
        getProcurementSuppliers(),
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
      // Suppliers are optional context for Receive Stock (linking a receipt to
      // who it came from) - a role without procurement.supplier.read just sees
      // an empty supplier picker rather than the whole page failing.
      if (supRes.status === "fulfilled") setSuppliers(Array.isArray(supRes.value.data) ? supRes.value.data : []);
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
  useLiveTable("procurement.inventory_items", () => void load());
  useEffect(() => { setTab(normalizeTab(searchParams?.get("tab"))); }, [searchParams]);

  const metrics = useMemo(() => {
    const outOfStock = stockLevels.filter((r) => num(r.available_qty ?? r.quantity ?? r.stock_quantity) <= 0);
    const belowReorderItems = stockLevels.filter((r) => {
      const q = num(r.available_qty ?? r.quantity ?? r.stock_quantity);
      const reorder = num(r.reorder_level ?? r.reorder_point);
      return q > 0 && reorder > 0 && q <= reorder;
    });
    const totalValue = stockLevels.reduce((sum, r) => {
      return sum + stockValue(r);
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

  const projectById = useMemo(() => {
    const byId = new Map<string, Rec>();
    projects.forEach((project) => byId.set(String(project.id), project));
    return byId;
  }, [projects]);

  useEffect(() => {
    if (!selectedProjectId) return;
    const project = projectById.get(selectedProjectId);
    if (selectedClientKey && project && keyFromName(clientName(project)) !== selectedClientKey) {
      setSelectedProjectId("");
    }
  }, [projectById, selectedClientKey, selectedProjectId]);

  const storeById = useMemo(() => {
    const byId = new Map<string, Rec>();
    stores.forEach((store) => byId.set(String(store.id), store));
    return byId;
  }, [stores]);

  const storeClientKey = useCallback((store: Rec) => {
    const project = store.project_id ? projectById.get(String(store.project_id)) : undefined;
    return keyFromName(tx(store.client_name ?? clientName(project)));
  }, [projectById]);

  const rowClientKey = useCallback((row: Rec) => {
    const store = row.store_id ? storeById.get(String(row.store_id)) : undefined;
    const project = row.project_id ? projectById.get(String(row.project_id)) : store?.project_id ? projectById.get(String(store.project_id)) : undefined;
    return keyFromName(tx(row.client_name ?? store?.client_name ?? clientName(project)));
  }, [projectById, storeById]);

  const rowProjectId = useCallback((row: Rec) => {
    const store = row.store_id ? storeById.get(String(row.store_id)) : undefined;
    return tx(row.project_id ?? store?.project_id, "");
  }, [storeById]);

  const clientGroups = useMemo(() => {
    const groups = new Map<string, { key: string; name: string; projects: Rec[]; stores: Rec[]; stockValue: number; itemCount: number }>();
    const ensure = (key: string, name: string) => {
      const existing = groups.get(key);
      if (existing) return existing;
      const group = { key, name, projects: [] as Rec[], stores: [] as Rec[], stockValue: 0, itemCount: 0 };
      groups.set(key, group);
      return group;
    };
    projects.forEach((project) => {
      const name = clientName(project);
      ensure(keyFromName(name), name).projects.push(project);
    });
    stores.forEach((store) => {
      const project = store.project_id ? projectById.get(String(store.project_id)) : undefined;
      const name = tx(store.client_name ?? clientName(project));
      ensure(keyFromName(name), name).stores.push(store);
    });
    stockLevels.forEach((row) => {
      const group = ensure(rowClientKey(row), tx(row.client_name ?? "Unassigned / Company Stores"));
      const q = num(row.available_qty ?? row.quantity ?? row.stock_quantity);
      group.stockValue += stockValue(row);
      if (q !== 0) group.itemCount += 1;
    });
    return Array.from(groups.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [projects, stores, stockLevels, projectById, rowClientKey]);

  const selectedClient = useMemo(
    () => clientGroups.find((group) => group.key === selectedClientKey) ?? null,
    [clientGroups, selectedClientKey]
  );

  const contextualProjects = useMemo(() => {
    if (!selectedClientKey) return projects;
    return projects.filter((project) => keyFromName(clientName(project)) === selectedClientKey);
  }, [projects, selectedClientKey]);

  const contextualStores = useMemo(() => {
    return stores.filter((store) => {
      if (selectedClientKey && storeClientKey(store) !== selectedClientKey) return false;
      if (selectedProjectId && tx(store.project_id, "") !== selectedProjectId) return false;
      return true;
    });
  }, [stores, selectedClientKey, selectedProjectId, storeClientKey]);

  const filteredStock = useMemo(() => {
    return stockLevels.filter((r) => {
      const q = num(r.available_qty ?? r.quantity ?? r.stock_quantity);
      const reorder = num(r.reorder_level ?? r.reorder_point);
      if (belowReorder && q > reorder) return false;
      if (selectedClientKey && rowClientKey(r) !== selectedClientKey) return false;
      if (selectedProjectId && rowProjectId(r) !== selectedProjectId) return false;
      if (storeFilter && tx(r.store_id) !== storeFilter && tx(r.store_name) !== storeFilter) return false;
      if (categoryFilter && tx(r.category).toLowerCase() !== categoryFilter.toLowerCase()) return false;
      if (itemTypeFilter && itemType(r.item_type) !== itemTypeFilter) return false;
      const hay = `${tx(r.item_code)} ${tx(r.item_name)} ${tx(r.category)} ${tx(r.item_type)} ${tx(r.store_name)} ${tx(r.project_name)} ${tx(r.client_name)}`.toLowerCase();
      return hay.includes(stockSearch.toLowerCase());
    });
  }, [stockLevels, belowReorder, selectedClientKey, selectedProjectId, rowClientKey, rowProjectId, storeFilter, categoryFilter, itemTypeFilter, stockSearch]);

  const filteredCatalogue = useMemo(() => {
    const q = catSearch.toLowerCase();
    return catalogue.filter((r) => {
      if (itemTypeFilter && itemType(r.item_type) !== itemTypeFilter) return false;
      return `${tx(r.item_code)} ${tx(r.item_name ?? r.name)} ${tx(r.category)} ${tx(r.item_type)}`.toLowerCase().includes(q);
    });
  }, [catalogue, catSearch, itemTypeFilter]);

  const filteredMovements = useMemo(() => {
    return movements.filter((m) => {
      if (movTypeFilter && tx(m.movement_type).toLowerCase() !== movTypeFilter.toLowerCase()) return false;
      if (selectedClientKey && rowClientKey(m) !== selectedClientKey) return false;
      if (selectedProjectId && rowProjectId(m) !== selectedProjectId) return false;
      if (movStoreFilter && tx(m.store_id) !== movStoreFilter && tx(m.store_name) !== movStoreFilter) return false;
      const date = new Date(m.created_at ?? m.movement_date ?? 0);
      if (movDateFrom && date < new Date(movDateFrom)) return false;
      if (movDateTo && date > new Date(movDateTo + "T23:59:59")) return false;
      return true;
    });
  }, [movements, movTypeFilter, selectedClientKey, selectedProjectId, rowClientKey, rowProjectId, movStoreFilter, movDateFrom, movDateTo]);

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
            onClick={() => setShowInvoice(true)}
            className="inline-flex h-10 items-center gap-2 border border-blue-500/40 bg-blue-950/20 px-3 font-mono text-xs uppercase tracking-wider text-blue-300 hover:border-blue-400 hover:bg-blue-950/40"
          >
            <ReceiptText className="h-4 w-4" /> Capture Invoice
          </button>
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
          <button
            onClick={() => setShowTransfer(true)}
            className="inline-flex h-10 items-center gap-2 border border-purple-500/40 bg-purple-950/20 px-3 font-mono text-xs uppercase tracking-wider text-purple-300 hover:border-purple-400 hover:bg-purple-950/40"
          >
            <ArrowLeftRight className="h-4 w-4" /> Transfer Stock
          </button>
          <button
            onClick={() => setShowAdjust(true)}
            className="inline-flex h-10 items-center gap-2 border border-ink-mid bg-ink-light px-3 font-mono text-xs uppercase tracking-wider text-slate-light hover:border-signal hover:text-paper"
          >
            <ClipboardEdit className="h-4 w-4" /> Adjust Stock
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

      <section className="mb-6 border border-ink-mid bg-ink">
        <div className="border-b border-ink-mid px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-widest text-signal">Workspace Scope</p>
          <h2 className="mt-1 text-base font-semibold text-paper">Clients, projects and stores</h2>
        </div>
        <div className="grid gap-4 p-4 lg:grid-cols-[minmax(15rem,22rem)_1fr]">
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => { setSelectedClientKey(""); setSelectedProjectId(""); }}
              className={`w-full border px-3 py-2 text-left ${!selectedClientKey ? "border-signal bg-signal/10" : "border-ink-mid bg-ink-light/30 hover:border-signal/40"}`}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-xs uppercase text-paper">All Clients</span>
                <span className="font-mono text-[10px] text-slate-light">{stores.length} stores</span>
              </div>
            </button>
            {clientGroups.map((group) => (
              <button
                key={group.key}
                type="button"
                onClick={() => { setSelectedClientKey(group.key); setSelectedProjectId(""); }}
                className={`w-full border px-3 py-2 text-left ${selectedClientKey === group.key ? "border-signal bg-signal/10" : "border-ink-mid bg-ink-light/30 hover:border-signal/40"}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate text-sm font-semibold text-paper">{group.name}</span>
                  <ChevronRight className={`h-4 w-4 shrink-0 text-slate ${selectedClientKey === group.key ? "text-signal" : ""}`} />
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] uppercase text-slate-light">
                  <span>{group.projects.length} projects</span>
                  <span>{group.stores.length} stores</span>
                  <span>{money(group.stockValue)}</span>
                </div>
              </button>
            ))}
          </div>
          <div className="min-w-0">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-wider text-slate">Selected workspace</p>
                <p className="mt-0.5 text-sm font-semibold text-paper">{selectedClient ? selectedClient.name : "All clients and organisation stores"}</p>
              </div>
              {(selectedClientKey || selectedProjectId) && (
                <button
                  type="button"
                  onClick={() => { setSelectedClientKey(""); setSelectedProjectId(""); }}
                  className="inline-flex h-8 items-center gap-1 border border-ink-mid px-2 font-mono text-[10px] uppercase text-slate-light hover:border-signal hover:text-paper"
                >
                  <X className="h-3.5 w-3.5" /> Clear
                </button>
              )}
            </div>
            <div className="mb-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setSelectedProjectId("")}
                className={`h-8 border px-3 font-mono text-[10px] uppercase ${!selectedProjectId ? "border-signal bg-signal/10 text-signal" : "border-ink-mid text-slate-light hover:border-signal hover:text-paper"}`}
              >
                All Projects
              </button>
              {contextualProjects.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => setSelectedProjectId(String(project.id))}
                  className={`h-8 max-w-full truncate border px-3 font-mono text-[10px] uppercase ${selectedProjectId === String(project.id) ? "border-signal bg-signal/10 text-signal" : "border-ink-mid text-slate-light hover:border-signal hover:text-paper"}`}
                >
                  {projectName(project)}
                </button>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <InfoCard label="Visible Stores" value={String(contextualStores.length)} />
              <InfoCard label="Visible Stock Rows" value={String(filteredStock.length)} />
              <InfoCard label="Visible Movements" value={String(filteredMovements.length)} />
            </div>
          </div>
        </div>
      </section>

      <div className="mb-0 flex border-b border-ink-mid">
        {(["stock", "catalogue", "stores", "movements"] as ActiveTab[]).map((t) => {
          const labels: Record<ActiveTab, string> = { stock: "Stock Levels", catalogue: "Item Catalogue", stores: "Stores", movements: "Stock Movements" };
          return (
            <Link
              key={t}
              href={TAB_ROUTES[t]}
              className={`px-5 py-3 font-mono text-xs uppercase tracking-wider transition-colors ${
                tab === t ? "border-b-2 border-signal text-signal" : "text-slate-light hover:text-paper"
              }`}
            >
              {labels[t]}
            </Link>
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
              {contextualStores.map((s) => <option key={s.id} value={tx(s.id)}>{tx(s.name ?? s.store_name, s.id)} ({tx(s.store_code, "")})</option>)}
            </select>
            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="h-9 border border-ink-mid bg-ink-light px-3 text-sm text-paper">
              <option value="">All Categories</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={itemTypeFilter} onChange={(e) => setItemTypeFilter(e.target.value)} className="h-9 border border-ink-mid bg-ink-light px-3 text-sm text-paper">
              <option value="">Materials, Supplies &amp; Tools</option>
              <option value="material">Materials</option>
              <option value="supply">Supplies</option>
              <option value="tool">Reusable Tools</option>
            </select>
            <label className="flex h-9 cursor-pointer items-center gap-2 border border-amber-500/30 bg-amber-950/10 px-3 text-xs text-amber-300">
              <input type="checkbox" checked={belowReorder} onChange={(e) => setBelowReorder(e.target.checked)} className="accent-amber-400" />
              Below Reorder Only
            </label>
          </div>
          {loading && stockLevels.length === 0 ? (
            <Loading label="Loading stock levels" />
          ) : filteredStock.length === 0 ? (
            <Empty label="No stock records match this view." sub="Receive stock or adjust filters to see balances." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-ink-mid bg-ink-light/40">
                    {["Item Code", "Item Name", "Type", "Category", "UOM", "Store / Site", "Available Qty", "Reserved Qty", "Reorder Level", "Inc VAT Cost", "Total Value"].map((h) => (
                      <th key={h} className="px-3 py-3 text-left font-mono text-[10px] uppercase tracking-wider text-slate">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-mid">
                  {filteredStock.map((r) => {
                    const avail = num(r.available_qty ?? r.quantity ?? r.stock_quantity);
                    const reorder = num(r.reorder_level ?? r.reorder_point);
                    const cost = num(r.unit_price_inc_vat ?? r.standard_cost ?? r.unit_cost);
                    const value = stockValue(r);
                    const type = itemType(r.item_type);
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
                            {type === "tool" && <span className="inline-flex items-center gap-1 rounded-sm border border-blue-500/30 bg-blue-950/20 px-1.5 py-0.5 font-mono text-[9px] uppercase text-blue-300"><Wrench className="h-3 w-3" /> Tool</span>}
                            {tx(r.item_name ?? r.name)}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 font-mono text-[10px] uppercase text-slate-light">{type}</td>
                        <td className="px-3 py-2.5 text-slate-light">{tx(r.category)}</td>
                        <td className="px-3 py-2.5 text-slate-light">{tx(r.uom ?? r.unit_of_measure)}</td>
                        <td className="px-3 py-2.5 text-slate-light">{tx(r.store_name ?? r.store_code)}</td>
                        <td className={`px-3 py-2.5 font-mono font-semibold ${isOut ? "text-red-300" : isLow ? "text-amber-300" : "text-emerald-300"}`}>{qty(avail)}</td>
                        <td className="px-3 py-2.5 font-mono text-slate-light">{qty(r.reserved_qty ?? 0)}</td>
                        <td className={`px-3 py-2.5 font-mono ${reorder > 0 ? "text-slate-light" : "text-slate"}`}>{reorder > 0 ? qty(reorder) : "\u2014"}</td>
                        <td className="px-3 py-2.5 font-mono text-slate-light">{cost > 0 ? money(cost) : "\u2014"}</td>
                        <td className="px-3 py-2.5 font-mono font-semibold text-paper">{value ? money(value) : "\u2014"}</td>
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
            <select value={itemTypeFilter} onChange={(e) => setItemTypeFilter(e.target.value)} className="h-9 border border-ink-mid bg-ink-light px-3 text-sm text-paper">
              <option value="">All Item Types</option>
              <option value="material">Materials</option>
              <option value="supply">Supplies</option>
              <option value="tool">Reusable Tools</option>
            </select>
            <div className="ml-auto">
              <button onClick={() => setShowAddItem(true)} className="inline-flex h-9 items-center gap-2 bg-signal px-4 font-mono text-xs font-bold uppercase text-ink">
                <Plus className="h-4 w-4" /> Add Item
              </button>
            </div>
          </div>
          {loading && catalogue.length === 0 ? (
            <Loading label="Loading item catalogue" />
          ) : filteredCatalogue.length === 0 ? (
            <Empty label="No items in catalogue." sub="Add items to start tracking stock across stores." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-ink-mid bg-ink-light/40">
                    {["Item Code", "Description", "Type", "Category", "UOM", "Ex VAT", "VAT", "Inc VAT", "Hazardous", "Total Stock"].map((h) => (
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
                        <td className="px-3 py-2.5 font-mono text-[10px] uppercase text-slate-light">{itemType(r.item_type)}</td>
                        <td className="px-3 py-2.5 text-slate-light">{tx(r.category)}</td>
                        <td className="px-3 py-2.5 text-slate-light">{tx(r.uom ?? r.unit_of_measure)}</td>
                        <td className="px-3 py-2.5 font-mono text-slate-light">{num(r.unit_price_ex_vat ?? r.standard_cost) > 0 ? money(r.unit_price_ex_vat ?? r.standard_cost) : "\u2014"}</td>
                        <td className="px-3 py-2.5 font-mono text-slate-light">{num(r.vat_rate) > 0 ? `${num(r.vat_rate)}%` : "\u2014"}</td>
                        <td className="px-3 py-2.5 font-mono text-slate-light">{num(r.unit_price_inc_vat ?? r.standard_cost) > 0 ? money(r.unit_price_inc_vat ?? r.standard_cost) : "\u2014"}</td>
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
          {loading && stores.length === 0 ? (
            <Loading label="Loading stores" />
          ) : contextualStores.length === 0 ? (
            <Empty label="No stores registered." sub="Add a warehouse, site store, or yard to begin tracking stock." />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {contextualStores.map((s) => {
                const storeItems = stockLevels.filter((r) => tx(r.store_id) === s.id || tx(r.store_name) === tx(s.name));
                const storeValue = storeItems.reduce((sum, r) => {
                  return sum + stockValue(r);
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
                    {(s.project_name || s.site_name || s.client_name) ? (
                      <p className="mb-3 text-xs text-slate-light"><Building2 className="mr-1 inline h-3 w-3" />{tx(s.client_name, "No client")} / {tx(s.project_name ?? s.site_name)}</p>
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
              {["receipt", "issue", "consumption", "transfer_in", "transfer_out", "adjustment", "return"].map((t) => (
                <option key={t} value={t}>{t.split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ")}</option>
              ))}
            </select>
            <select value={movStoreFilter} onChange={(e) => setMovStoreFilter(e.target.value)} className="h-9 border border-ink-mid bg-ink-light px-3 text-sm text-paper">
              <option value="">All Stores</option>
              {contextualStores.map((s) => <option key={s.id} value={tx(s.id)}>{tx(s.name ?? s.store_name, s.id)}</option>)}
            </select>
            {(movDateFrom || movDateTo || movTypeFilter || movStoreFilter) && (
              <button onClick={() => { setMovDateFrom(""); setMovDateTo(""); setMovTypeFilter(""); setMovStoreFilter(""); }} className="h-9 border border-ink-mid px-3 font-mono text-xs text-slate-light hover:text-paper">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          {loading && movements.length === 0 ? (
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
                    const isDebit = q < 0;
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
          stores={contextualStores}
          projects={contextualProjects}
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
          stores={contextualStores}
          suppliers={suppliers}
          saving={saving}
          onClose={() => setShowReceive(false)}
          onItemCreated={(item) => setCatalogue((prev) => [item, ...prev])}
          onSupplierCreated={(supplier) => setSuppliers((prev) => [supplier, ...prev])}
          onFlash={flash}
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
      {showInvoice && (
        <ReceiveInvoiceModal
          catalogue={catalogue}
          stores={contextualStores}
          suppliers={suppliers}
          projects={contextualProjects}
          saving={saving}
          onClose={() => setShowInvoice(false)}
          onSubmit={async (payload) => {
            setSaving(true);
            try {
              await receiveInventoryInvoice(payload);
              flash("Supplier invoice and stock receipts captured.");
              setShowInvoice(false);
              await load();
            } catch (e) {
              flash(normalizeActionError(e, "Failed to capture supplier invoice."));
            } finally {
              setSaving(false);
            }
          }}
        />
      )}
      {showTransfer && (
        <TransferStockModal
          catalogue={catalogue}
          stores={contextualStores}
          saving={saving}
          onClose={() => setShowTransfer(false)}
          onSubmit={async (payload) => {
            setSaving(true);
            try {
              await transferStock(payload);
              flash("Stock transfer completed successfully.");
              setShowTransfer(false);
              await load();
            } catch (e) {
              flash(normalizeActionError(e, "Failed to transfer stock."));
            } finally {
              setSaving(false);
            }
          }}
        />
      )}
      {showAdjust && (
        <AdjustStockModal
          catalogue={catalogue}
          stores={contextualStores}
          saving={saving}
          onClose={() => setShowAdjust(false)}
          onSubmit={async (payload) => {
            setSaving(true);
            try {
              await adjustStock(payload);
              flash("Stock adjustment recorded successfully.");
              setShowAdjust(false);
              await load();
            } catch (e) {
              flash(normalizeActionError(e, "Failed to record adjustment."));
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
          projects={contextualProjects}
          onClose={() => setShowAddStore(false)}
          onProjectCreated={(project) => setProjects((prev) => [project, ...prev])}
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
    transfer_in: "border-purple-500/40 bg-purple-950/20 text-purple-300",
    transfer_out: "border-purple-500/40 bg-purple-950/20 text-purple-300",
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
          onClick={() => onSubmit({ ...form, quantity: Number(form.quantity), project_id: form.project_id || null })}
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

function ReceiveStockModal({ catalogue, stores, suppliers, saving, onClose, onItemCreated, onSupplierCreated, onFlash, onSubmit }: {
  catalogue: Rec[]; stores: Rec[]; suppliers: Rec[]; saving: boolean;
  onClose: () => void; onItemCreated: (item: Rec) => void; onSupplierCreated: (supplier: Rec) => void;
  onFlash: (msg: string) => void;
  onSubmit: (p: Record<string, unknown>) => void;
}) {
  const [form, setForm] = useState({ item_id: "", store_id: "", supplier_id: "", quantity: "", unit_cost: "", reference: "", notes: "" });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const [showAddItem, setShowAddItem] = useState(false);
  const [showAddSupplier, setShowAddSupplier] = useState(false);
  const [creatingItem, setCreatingItem] = useState(false);
  const [creatingSupplier, setCreatingSupplier] = useState(false);
  return (
    <ModalShell title="Receive Stock" onClose={onClose}>
      <div className="grid gap-3">
        <FieldGroup label="Item">
          <div className="flex gap-2">
            <select value={form.item_id} onChange={(e) => set("item_id", e.target.value)} className="field flex-1">
              <option value="">Select item</option>
              {catalogue.map((i) => <option key={i.id} value={i.id}>{tx(i.item_code)} \u2014 {tx(i.item_name ?? i.name)}</option>)}
            </select>
            <button
              type="button"
              onClick={() => setShowAddItem(true)}
              className="inline-flex h-10 shrink-0 items-center gap-1 border border-ink-mid px-3 font-mono text-xs uppercase tracking-wider text-slate-light hover:border-signal hover:text-paper"
            >
              <Plus className="h-3.5 w-3.5" /> New Item
            </button>
          </div>
        </FieldGroup>
        <FieldGroup label="Store">
          <select value={form.store_id} onChange={(e) => set("store_id", e.target.value)} className="field">
            <option value="">Select store</option>
            {stores.map((s) => <option key={s.id} value={s.id}>{tx(s.name ?? s.store_name)} ({tx(s.store_code)})</option>)}
          </select>
        </FieldGroup>
        <FieldGroup label="Supplier (optional)">
          <div className="flex gap-2">
            <select value={form.supplier_id} onChange={(e) => set("supplier_id", e.target.value)} className="field flex-1">
              <option value="">Not linked to a supplier</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{tx(s.supplier_name ?? s.name, s.id)}</option>)}
            </select>
            <button
              type="button"
              onClick={() => setShowAddSupplier(true)}
              className="inline-flex h-10 shrink-0 items-center gap-1 border border-ink-mid px-3 font-mono text-xs uppercase tracking-wider text-slate-light hover:border-signal hover:text-paper"
            >
              <Plus className="h-3.5 w-3.5" /> New Supplier
            </button>
          </div>
          <p className="mt-1 text-[11px] text-slate-light">Tagging who this came from builds up that supplier&apos;s product catalog over time.</p>
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
      {showAddItem && (
        <AddItemModal
          saving={creatingItem}
          onClose={() => setShowAddItem(false)}
          onSubmit={async (payload) => {
            setCreatingItem(true);
            try {
              const res = await addInventoryItem(payload);
              const saved = ((res.data as Rec | undefined) ?? {}) as Partial<Rec>;
              const id = saved.id;
              if (!id) throw new Error("Item was not created.");
              const created = { ...payload, ...saved, id } as Rec;
              onItemCreated(created);
              set("item_id", String(id));
              setShowAddItem(false);
            } catch (e) {
              onFlash(normalizeActionError(e, "Failed to add item."));
            } finally {
              setCreatingItem(false);
            }
          }}
        />
      )}
      {showAddSupplier && (
        <QuickAddSupplierModal
          saving={creatingSupplier}
          onClose={() => setShowAddSupplier(false)}
          onSubmit={async (supplierName) => {
            setCreatingSupplier(true);
            try {
              const res = await createSupplierRecord({
                supplier_name: supplierName,
                currency: "USD",
                status: "pending_approval",
                compliance_status: "pending",
                issue_portal_login: false,
              });
              const id = (res.data as Rec | undefined)?.id;
              if (!id) throw new Error("Supplier was not created.");
              const created = { id, supplier_name: supplierName } as Rec;
              onSupplierCreated(created);
              set("supplier_id", String(id));
              setShowAddSupplier(false);
            } catch (e) {
              onFlash(normalizeActionError(e, "Failed to add supplier."));
            } finally {
              setCreatingSupplier(false);
            }
          }}
        />
      )}
      <div className="mt-6 flex justify-end gap-3">
        <button onClick={onClose} className="h-10 border border-ink-mid px-4 font-mono text-xs uppercase text-slate-light hover:text-paper">Cancel</button>
        <button
          onClick={() => onSubmit({ ...form, supplier_id: form.supplier_id || undefined, quantity: Number(form.quantity), unit_cost: Number(form.unit_cost) })}
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

function ReceiveInvoiceModal({ catalogue, stores, suppliers, projects, saving, onClose, onSubmit }: {
  catalogue: Rec[]; stores: Rec[]; suppliers: Rec[]; projects: Rec[]; saving: boolean;
  onClose: () => void; onSubmit: (p: Record<string, unknown>) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({ supplier_id: "", store_id: "", project_id: "", invoice_number: "", supplier_invoice_ref: "", invoice_date: today, due_date: "", notes: "" });
  const [lines, setLines] = useState([{ item_id: "", quantity: "", unit_cost: "", vat_rate: "15.5", vat_inclusive: false, description: "" }]);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const setLine = (index: number, key: string, value: string | boolean) => {
    setLines((current) => current.map((line, i) => i === index ? { ...line, [key]: value } : line));
  };
  const totals = useMemo(() => lines.reduce((acc, line) => {
    const quantity = num(line.quantity);
    const unit = num(line.unit_cost);
    const rate = num(line.vat_rate);
    const grossUnit = line.vat_inclusive && rate > 0 ? unit : unit * (1 + rate / 100);
    const exUnit = line.vat_inclusive && rate > 0 ? unit / (1 + rate / 100) : unit;
    acc.subtotal += quantity * exUnit;
    acc.total += quantity * grossUnit;
    return acc;
  }, { subtotal: 0, total: 0 }), [lines]);
  const validLines = lines.filter((line) => line.item_id && num(line.quantity) > 0);
  return (
    <ModalShell title="Capture Supplier Invoice" onClose={onClose} wide>
      <div className="grid gap-3 md:grid-cols-3">
        <FieldGroup label="Supplier">
          <select value={form.supplier_id} onChange={(e) => set("supplier_id", e.target.value)} className="field">
            <option value="">Select supplier</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{tx(s.supplier_name ?? s.name, s.id)}</option>)}
          </select>
        </FieldGroup>
        <FieldGroup label="Receiving Store / Site">
          <select value={form.store_id} onChange={(e) => set("store_id", e.target.value)} className="field">
            <option value="">Select store</option>
            {stores.map((s) => <option key={s.id} value={s.id}>{tx(s.name ?? s.store_name)} ({tx(s.store_code)})</option>)}
          </select>
        </FieldGroup>
        <FieldGroup label="Project (optional)">
          <select value={form.project_id} onChange={(e) => set("project_id", e.target.value)} className="field">
            <option value="">Organisation stock</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{projectName(p)}</option>)}
          </select>
        </FieldGroup>
        <FieldGroup label="AEGIS Invoice No.">
          <input value={form.invoice_number} onChange={(e) => set("invoice_number", e.target.value)} placeholder="e.g. INV-2026-0042" className="field" />
        </FieldGroup>
        <FieldGroup label="Supplier Invoice Ref">
          <input value={form.supplier_invoice_ref} onChange={(e) => set("supplier_invoice_ref", e.target.value)} placeholder="Supplier reference" className="field" />
        </FieldGroup>
        <FieldGroup label="Invoice Date">
          <input type="date" value={form.invoice_date} onChange={(e) => set("invoice_date", e.target.value)} className="field" />
        </FieldGroup>
      </div>
      <div className="mt-5 overflow-x-auto border border-ink-mid">
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="border-b border-ink-mid bg-ink-light/40">
              {["Item", "Qty", "Unit Cost", "VAT %", "Inclusive", "Description", ""].map((h) => <th key={h} className="px-3 py-2 text-left font-mono text-[10px] uppercase text-slate">{h}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-mid">
            {lines.map((line, index) => (
              <tr key={index}>
                <td className="px-3 py-2">
                  <select value={line.item_id} onChange={(e) => setLine(index, "item_id", e.target.value)} className="field">
                    <option value="">Select item</option>
                    {catalogue.map((i) => <option key={i.id} value={i.id}>{tx(i.item_code)} - {tx(i.item_name ?? i.name)}</option>)}
                  </select>
                </td>
                <td className="px-3 py-2"><input type="number" min="0" value={line.quantity} onChange={(e) => setLine(index, "quantity", e.target.value)} className="field w-24" /></td>
                <td className="px-3 py-2"><input type="number" min="0" value={line.unit_cost} onChange={(e) => setLine(index, "unit_cost", e.target.value)} className="field w-28" /></td>
                <td className="px-3 py-2"><input type="number" min="0" value={line.vat_rate} onChange={(e) => setLine(index, "vat_rate", e.target.value)} className="field w-24" /></td>
                <td className="px-3 py-2 text-center"><input type="checkbox" checked={line.vat_inclusive} onChange={(e) => setLine(index, "vat_inclusive", e.target.checked)} className="accent-signal" /></td>
                <td className="px-3 py-2"><input value={line.description} onChange={(e) => setLine(index, "description", e.target.value)} placeholder="Optional" className="field" /></td>
                <td className="px-3 py-2">
                  <button type="button" onClick={() => setLines((current) => current.filter((_, i) => i !== index))} disabled={lines.length === 1} className="text-slate hover:text-red-300 disabled:opacity-40"><X className="h-4 w-4" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={() => setLines((current) => [...current, { item_id: "", quantity: "", unit_cost: "", vat_rate: "15.5", vat_inclusive: false, description: "" }])} className="inline-flex h-9 items-center gap-2 border border-ink-mid px-3 font-mono text-xs uppercase text-slate-light hover:border-signal hover:text-paper">
          <Plus className="h-4 w-4" /> Add Line
        </button>
        <div className="flex gap-4 font-mono text-xs text-slate-light">
          <span>Ex VAT {money(totals.subtotal)}</span>
          <span>VAT {money(totals.total - totals.subtotal)}</span>
          <span className="text-paper">Total {money(totals.total)}</span>
        </div>
      </div>
      <FieldGroup label="Notes">
        <input value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Optional invoice notes" className="field mt-3" />
      </FieldGroup>
      <div className="mt-6 flex justify-end gap-3">
        <button onClick={onClose} className="h-10 border border-ink-mid px-4 font-mono text-xs uppercase text-slate-light hover:text-paper">Cancel</button>
        <button
          onClick={() => onSubmit({
            ...form,
            supplier_invoice_ref: form.supplier_invoice_ref || undefined,
            due_date: form.due_date || undefined,
            project_id: form.project_id || undefined,
            lines: validLines.map((line) => ({ ...line, quantity: Number(line.quantity), unit_cost: Number(line.unit_cost), vat_rate: Number(line.vat_rate), store_id: form.store_id, project_id: form.project_id || undefined })),
          })}
          disabled={saving || !form.supplier_id || !form.store_id || !form.invoice_number || !form.invoice_date || !validLines.length}
          className="inline-flex h-10 items-center gap-2 border border-blue-500/50 bg-blue-950/30 px-4 font-mono text-xs font-bold uppercase text-blue-300 disabled:opacity-50 hover:bg-blue-950/50"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          <ReceiptText className="h-4 w-4" /> Capture Invoice
        </button>
      </div>
    </ModalShell>
  );
}

// Minimal supplier creation for use inline from Receive Stock, when the
// supplier doesn't exist yet - full registration (tax numbers, portal
// login, etc.) still happens on the Procurement > Suppliers page.
function QuickAddSupplierModal({ saving, onClose, onSubmit }: { saving: boolean; onClose: () => void; onSubmit: (supplierName: string) => void }) {
  const [name, setName] = useState("");
  return (
    <ModalShell title="New Supplier" onClose={onClose}>
      <FieldGroup label="Supplier Name">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Corrugated Roofing Co." className="field" />
      </FieldGroup>
      <p className="mt-2 text-[11px] text-slate-light">Registers a bare supplier record so you can tag this receipt. Add tax/PRAZ numbers and a portal login later from Procurement &gt; Suppliers.</p>
      <div className="mt-6 flex justify-end gap-3">
        <button onClick={onClose} className="h-10 border border-ink-mid px-4 font-mono text-xs uppercase text-slate-light hover:text-paper">Cancel</button>
        <button
          onClick={() => onSubmit(name.trim())}
          disabled={saving || !name.trim()}
          className="inline-flex h-10 items-center gap-2 bg-signal px-4 font-mono text-xs font-bold uppercase text-ink disabled:opacity-50"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          <Plus className="h-4 w-4" /> Add Supplier
        </button>
      </div>
    </ModalShell>
  );
}

function TransferStockModal({ catalogue, stores, saving, onClose, onSubmit }: {
  catalogue: Rec[]; stores: Rec[]; saving: boolean;
  onClose: () => void; onSubmit: (p: Record<string, unknown>) => void;
}) {
  const [form, setForm] = useState({ item_id: "", from_store_id: "", to_store_id: "", quantity: "", notes: "" });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const destinationOptions = stores.filter((s) => s.id !== form.from_store_id);
  return (
    <ModalShell title="Transfer Stock Between Sites" onClose={onClose}>
      <div className="grid gap-3">
        <FieldGroup label="Item">
          <select value={form.item_id} onChange={(e) => set("item_id", e.target.value)} className="field">
            <option value="">Select item</option>
            {catalogue.map((i) => <option key={i.id} value={i.id}>{tx(i.item_code)} — {tx(i.item_name ?? i.name)}</option>)}
          </select>
        </FieldGroup>
        <div className="grid grid-cols-2 gap-3">
          <FieldGroup label="From Store / Site">
            <select value={form.from_store_id} onChange={(e) => set("from_store_id", e.target.value)} className="field">
              <option value="">Select source</option>
              {stores.map((s) => <option key={s.id} value={s.id}>{tx(s.name ?? s.store_name)} ({tx(s.store_code)})</option>)}
            </select>
          </FieldGroup>
          <FieldGroup label="To Store / Site">
            <select value={form.to_store_id} onChange={(e) => set("to_store_id", e.target.value)} className="field" disabled={!form.from_store_id}>
              <option value="">Select destination</option>
              {destinationOptions.map((s) => <option key={s.id} value={s.id}>{tx(s.name ?? s.store_name)} ({tx(s.store_code)})</option>)}
            </select>
          </FieldGroup>
        </div>
        <FieldGroup label="Quantity">
          <input type="number" min="0" value={form.quantity} onChange={(e) => set("quantity", e.target.value)} placeholder="0.000" className="field" />
        </FieldGroup>
        <FieldGroup label="Notes">
          <input value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Optional notes (e.g. reason for transfer)" className="field" />
        </FieldGroup>
      </div>
      <div className="mt-6 flex justify-end gap-3">
        <button onClick={onClose} className="h-10 border border-ink-mid px-4 font-mono text-xs uppercase text-slate-light hover:text-paper">Cancel</button>
        <button
          onClick={() => onSubmit({ ...form, quantity: Number(form.quantity) })}
          disabled={saving || !form.item_id || !form.from_store_id || !form.to_store_id || !form.quantity}
          className="inline-flex h-10 items-center gap-2 border border-purple-500/50 bg-purple-950/30 px-4 font-mono text-xs font-bold uppercase text-purple-300 disabled:opacity-50 hover:bg-purple-950/50"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          <ArrowLeftRight className="h-4 w-4" /> Transfer Stock
        </button>
      </div>
    </ModalShell>
  );
}

function AdjustStockModal({ catalogue, stores, saving, onClose, onSubmit }: {
  catalogue: Rec[]; stores: Rec[]; saving: boolean;
  onClose: () => void; onSubmit: (p: Record<string, unknown>) => void;
}) {
  const [form, setForm] = useState({ item_id: "", store_id: "", direction: "increase" as "increase" | "decrease", quantity: "", reason: "" });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const magnitude = Number(form.quantity) || 0;
  const signedDelta = form.direction === "decrease" ? -magnitude : magnitude;
  return (
    <ModalShell title="Adjust Stock (Count / Correction)" onClose={onClose}>
      <div className="grid gap-3">
        <FieldGroup label="Item">
          <select value={form.item_id} onChange={(e) => set("item_id", e.target.value)} className="field">
            <option value="">Select item</option>
            {catalogue.map((i) => <option key={i.id} value={i.id}>{tx(i.item_code)} — {tx(i.item_name ?? i.name)}</option>)}
          </select>
        </FieldGroup>
        <FieldGroup label="Store / Site">
          <select value={form.store_id} onChange={(e) => set("store_id", e.target.value)} className="field">
            <option value="">Select store</option>
            {stores.map((s) => <option key={s.id} value={s.id}>{tx(s.name ?? s.store_name)} ({tx(s.store_code)})</option>)}
          </select>
        </FieldGroup>
        <div className="grid grid-cols-2 gap-3">
          <FieldGroup label="Direction">
            <select value={form.direction} onChange={(e) => set("direction", e.target.value)} className="field">
              <option value="increase">Increase (count found more)</option>
              <option value="decrease">Decrease (damage / loss / shrinkage)</option>
            </select>
          </FieldGroup>
          <FieldGroup label="Quantity">
            <input type="number" min="0" value={form.quantity} onChange={(e) => set("quantity", e.target.value)} placeholder="0.000" className="field" />
          </FieldGroup>
        </div>
        <FieldGroup label="Reason">
          <input value={form.reason} onChange={(e) => set("reason", e.target.value)} placeholder="Required — e.g. physical count variance, damaged on site" className="field" />
        </FieldGroup>
      </div>
      <div className="mt-6 flex justify-end gap-3">
        <button onClick={onClose} className="h-10 border border-ink-mid px-4 font-mono text-xs uppercase text-slate-light hover:text-paper">Cancel</button>
        <button
          onClick={() => onSubmit({ item_id: form.item_id, store_id: form.store_id, quantity_delta: signedDelta, reason: form.reason })}
          disabled={saving || !form.item_id || !form.store_id || !magnitude || form.reason.trim().length < 3}
          className="inline-flex h-10 items-center gap-2 bg-signal px-4 font-mono text-xs font-bold uppercase text-ink disabled:opacity-50"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          <ClipboardEdit className="h-4 w-4" /> Record Adjustment
        </button>
      </div>
    </ModalShell>
  );
}

function AddItemModal({ saving, onClose, onSubmit }: { saving: boolean; onClose: () => void; onSubmit: (p: Record<string, unknown>) => void }) {
  const [form, setForm] = useState({
    item_code: "",
    item_name: "",
    item_type: "material",
    category: "",
    uom: "",
    standard_cost: "",
    reorder_level: "",
    vat_rate: "15.5",
    vat_inclusive: false,
    apply_zimra_vat: true,
    is_hazardous: false,
    description: "",
  });
  const set = (k: string, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));
  const submit = () => {
    const { uom, ...itemPayload } = form;
    onSubmit({
      ...itemPayload,
      unit_of_measure: uom,
      standard_cost: Number(form.standard_cost),
      reorder_level: Number(form.reorder_level),
      vat_rate: form.apply_zimra_vat ? Number(form.vat_rate || 15.5) : 0,
    });
  };
  return (
    <ModalShell title="Add Catalogue Item" onClose={onClose}>
      <div className="grid gap-3 md:grid-cols-2">
        <FieldGroup label="Item Code">
          <input value={form.item_code} onChange={(e) => set("item_code", e.target.value)} placeholder="e.g. MAT-001" className="field" />
        </FieldGroup>
        <FieldGroup label="Item Name">
          <input value={form.item_name} onChange={(e) => set("item_name", e.target.value)} placeholder="e.g. Portland Cement 50kg" className="field" />
        </FieldGroup>
        <FieldGroup label="Item Type">
          <select value={form.item_type} onChange={(e) => set("item_type", e.target.value)} className="field">
            <option value="material">Material</option>
            <option value="supply">Supply</option>
            <option value="tool">Reusable Tool</option>
          </select>
        </FieldGroup>
        <FieldGroup label="Category">
          <input value={form.category} onChange={(e) => set("category", e.target.value)} placeholder="e.g. Structural Materials" className="field" />
        </FieldGroup>
        <FieldGroup label="Unit of Measure">
          <input value={form.uom} onChange={(e) => set("uom", e.target.value)} placeholder="e.g. Bag / m\u00b3 / kg" className="field" />
        </FieldGroup>
        <FieldGroup label="Unit Price Before VAT (USD)">
          <input type="number" min="0" value={form.standard_cost} onChange={(e) => set("standard_cost", e.target.value)} placeholder="0.00" className="field" />
        </FieldGroup>
        <FieldGroup label="Reorder Level">
          <input type="number" min="0" value={form.reorder_level} onChange={(e) => set("reorder_level", e.target.value)} placeholder="Min qty before alert" className="field" />
        </FieldGroup>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-light">
          <input type="checkbox" checked={form.apply_zimra_vat} onChange={(e) => set("apply_zimra_vat", e.target.checked)} className="accent-signal" />
          Apply ZIMRA VAT
        </label>
        <div className="grid grid-cols-2 gap-3">
          <FieldGroup label="VAT Rate %">
            <input type="number" min="0" value={form.vat_rate} onChange={(e) => set("vat_rate", e.target.value)} disabled={!form.apply_zimra_vat} className="field disabled:opacity-40" />
          </FieldGroup>
          <label className="flex cursor-pointer items-center gap-2 pt-5 text-sm text-slate-light">
            <input type="checkbox" checked={form.vat_inclusive} onChange={(e) => set("vat_inclusive", e.target.checked)} className="accent-signal" />
            Entered price already includes VAT
          </label>
        </div>
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
          onClick={submit}
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

function AddStoreModal({ saving, projects, onClose, onSubmit, onProjectCreated }: { saving: boolean; projects: Rec[]; onClose: () => void; onSubmit: (p: Record<string, unknown>) => void; onProjectCreated: (project: Rec) => void }) {
  const [form, setForm] = useState({ name: "", store_code: "", store_type: "warehouse", project_id: "", site_id: "", location_label: "" });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const [sites, setSites] = useState<Rec[]>([]);
  const [sitesLoading, setSitesLoading] = useState(false);
  const [showCreateSite, setShowCreateSite] = useState(false);
  const [showCreateFieldProject, setShowCreateFieldProject] = useState(false);

  const loadSites = useCallback(async (projectId: string) => {
    if (!projectId) { setSites([]); return; }
    setSitesLoading(true);
    try {
      const res = await getSiteOperationSites(projectId);
      setSites(Array.isArray(res.data) ? res.data : []);
    } catch {
      setSites([]);
    } finally {
      setSitesLoading(false);
    }
  }, []);

  useEffect(() => { void loadSites(form.project_id); }, [form.project_id, loadSites]);

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
            <option value="vehicle">Vehicle</option>
          </select>
        </FieldGroup>
        <FieldGroup label="Project">
          <div className="flex gap-2">
            <select value={form.project_id} onChange={(e) => { set("project_id", e.target.value); set("site_id", ""); }} className="field flex-1">
              <option value="">Not project-specific</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {tx(p.name ?? p.project_name ?? p.project_code, p.id)}{p.status === "field_intake" ? " (Field Intake)" : ""}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setShowCreateFieldProject(true)}
              className="inline-flex h-10 shrink-0 items-center gap-1 border border-ink-mid px-3 font-mono text-xs uppercase tracking-wider text-slate-light hover:border-signal hover:text-paper"
            >
              <Plus className="h-3.5 w-3.5" /> New Field Intake Project
            </button>
          </div>
        </FieldGroup>
        <div className="md:col-span-2">
          <FieldGroup label="Site">
            <div className="flex gap-2">
              <select
                value={form.site_id}
                onChange={(e) => set("site_id", e.target.value)}
                disabled={!form.project_id || sitesLoading}
                className="field flex-1 disabled:opacity-50"
              >
                <option value="">{form.project_id ? (sitesLoading ? "Loading sites…" : "Not site-specific") : "Select a project first"}</option>
                {sites.map((s) => <option key={s.id} value={s.id}>{tx(s.name)} ({tx(s.site_code, "")})</option>)}
              </select>
              <button
                type="button"
                onClick={() => setShowCreateSite(true)}
                disabled={!form.project_id}
                className="inline-flex h-10 shrink-0 items-center gap-1 border border-ink-mid px-3 font-mono text-xs uppercase tracking-wider text-slate-light hover:border-signal hover:text-paper disabled:opacity-50"
              >
                <Plus className="h-3.5 w-3.5" /> New Site
              </button>
            </div>
          </FieldGroup>
        </div>
        <div className="md:col-span-2">
          <FieldGroup label="Location / Address">
            <input value={form.location_label} onChange={(e) => set("location_label", e.target.value)} placeholder="Physical location or GPS reference" className="field" />
          </FieldGroup>
        </div>
      </div>
      <div className="mt-6 flex justify-end gap-3">
        <button onClick={onClose} className="h-10 border border-ink-mid px-4 font-mono text-xs uppercase text-slate-light hover:text-paper">Cancel</button>
        <button
          onClick={() => onSubmit({ ...form, project_id: form.project_id || null, site_id: form.site_id || null })}
          disabled={saving || !form.name || !form.store_code}
          className="inline-flex h-10 items-center gap-2 bg-signal px-4 font-mono text-xs font-bold uppercase text-ink disabled:opacity-50"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          <Plus className="h-4 w-4" /> Register Store
        </button>
      </div>
      {showCreateSite && form.project_id && (
        <CreateSiteModal
          projectId={form.project_id}
          onClose={() => setShowCreateSite(false)}
          onCreated={async (siteId) => {
            setShowCreateSite(false);
            await loadSites(form.project_id);
            set("site_id", siteId);
          }}
        />
      )}
      {showCreateFieldProject && (
        <CreateFieldIntakeProjectModal
          onClose={() => setShowCreateFieldProject(false)}
          onCreated={(project) => {
            setShowCreateFieldProject(false);
            onProjectCreated(project);
            set("project_id", String(project.id));
          }}
        />
      )}
    </ModalShell>
  );
}

// A Field Intake project is a real projects.projects row (status="field_intake")
// for tracking an ongoing site project that predates AEGIS or never went
// through the CRM tender/opportunity/quotation pipeline - it can be started
// here from Stores and later promoted to a fully registered project once
// Finance signs off (see the Field Intake panel on the project detail page).
function CreateFieldIntakeProjectModal({ onClose, onCreated }: { onClose: () => void; onCreated: (project: Rec) => void }) {
  const [form, setForm] = useState({ name: "", start_date: "" });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    setSaving(true);
    setErr(null);
    try {
      const res = await createInternalProject({
        name: form.name,
        status: "field_intake",
        start_date: form.start_date || undefined,
      });
      const id = (res.data as Rec | undefined)?.id;
      if (id) {
        onCreated({ id, name: form.name, status: "field_intake" });
      } else {
        setErr("Project was not created.");
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to create project.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title="New Field Intake Project" onClose={onClose}>
      <p className="mb-4 text-xs text-slate-light">
        For a real ongoing site project not yet formally registered in AEGIS. You can add Requisitions/RFQs against it
        right away, and Finance can promote it to a fully registered project once the formal details are known.
      </p>
      <div className="grid gap-3">
        <FieldGroup label="Project Name">
          <input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Marist Brothers Site Works" className="field" />
        </FieldGroup>
        <FieldGroup label="Real Start Date (optional)">
          <input type="date" value={form.start_date} onChange={(e) => set("start_date", e.target.value)} className="field" />
        </FieldGroup>
      </div>
      {err && <p className="mt-3 text-xs text-red-300">{err}</p>}
      <div className="mt-6 flex justify-end gap-3">
        <button onClick={onClose} className="h-10 border border-ink-mid px-4 font-mono text-xs uppercase text-slate-light hover:text-paper">Cancel</button>
        <button
          onClick={submit}
          disabled={saving || !form.name}
          className="inline-flex h-10 items-center gap-2 bg-signal px-4 font-mono text-xs font-bold uppercase text-ink disabled:opacity-50"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          <Plus className="h-4 w-4" /> Create Project
        </button>
      </div>
    </ModalShell>
  );
}

function CreateSiteModal({ projectId, onClose, onCreated }: { projectId: string; onClose: () => void; onCreated: (siteId: string) => void }) {
  const [form, setForm] = useState({ site_code: "", name: "", location_label: "" });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    setSaving(true);
    setErr(null);
    try {
      const res = await createSiteOperationSite({ project_id: projectId, ...form });
      const siteId = (res.data as Rec | undefined)?.id;
      if (siteId) onCreated(String(siteId));
      else onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to create site.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title="New Site" onClose={onClose}>
      <div className="grid gap-3">
        <FieldGroup label="Site Name">
          <input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. North Wing Compound" className="field" />
        </FieldGroup>
        <FieldGroup label="Site Code">
          <input value={form.site_code} onChange={(e) => set("site_code", e.target.value)} placeholder="e.g. SITE-A" className="field" />
        </FieldGroup>
        <FieldGroup label="Location / Address">
          <input value={form.location_label} onChange={(e) => set("location_label", e.target.value)} placeholder="Physical location or GPS reference" className="field" />
        </FieldGroup>
      </div>
      {err && <p className="mt-3 text-xs text-red-300">{err}</p>}
      <div className="mt-6 flex justify-end gap-3">
        <button onClick={onClose} className="h-10 border border-ink-mid px-4 font-mono text-xs uppercase text-slate-light hover:text-paper">Cancel</button>
        <button
          onClick={submit}
          disabled={saving || !form.name}
          className="inline-flex h-10 items-center gap-2 bg-signal px-4 font-mono text-xs font-bold uppercase text-ink disabled:opacity-50"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          <Plus className="h-4 w-4" /> Create Site
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
                      <p className={`font-mono font-semibold ${num(m.quantity ?? m.qty) < 0 ? "text-red-300" : "text-emerald-300"}`}>{qty(m.quantity ?? m.qty)}</p>
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

function ModalShell({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className={`w-full ${wide ? "max-w-5xl" : "max-w-xl"} border border-ink-mid bg-ink shadow-2xl`}>
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
