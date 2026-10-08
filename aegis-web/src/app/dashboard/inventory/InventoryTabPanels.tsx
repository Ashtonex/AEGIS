"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowRight, ArrowUp, Building2, ChevronRight, MapPin, Plus, Search, Settings2, Store, Truck, Warehouse, Wrench, X } from "lucide-react";
import { tx, num, money, qty, itemType, normalizeInventoryCategory, stockValue, dateShort, Loading, Empty, MovBadge, type Rec } from "./page";

// ─── Shared bits ─────────────────────────────────────────────────────────────

const availableQty = (r: Rec) => num(r.available_qty ?? r.quantity ?? r.stock_quantity);
const reorderLevel = (r: Rec) => num(r.reorder_level ?? r.reorder_point);
const movementTime = (m: Rec) => new Date(m.created_at ?? m.movement_date ?? m.movement_at ?? 0).getTime();
const storeMatches = (row: Rec, store: Rec) => tx(row.store_id, "") === String(store.id) || (!!row.store_name && tx(row.store_name) === tx(store.name ?? store.store_name));

/** One compact row of figures, the page-specific replacement for the old
 * six big metric cards that were identical on every inventory page. */
export function StatStrip({ stats }: { stats: { label: string; value: string; tone?: string; hint?: string }[] }) {
  return (
    <div className="grid grid-cols-2 divide-ink-mid border border-ink-mid bg-ink sm:flex sm:divide-x">
      {stats.map((s) => (
        <div key={s.label} className="min-w-0 flex-1 px-4 py-2.5">
          <p className="font-mono text-[10px] uppercase tracking-wider text-slate">{s.label}</p>
          <p className={`mt-0.5 truncate font-mono text-lg font-semibold ${s.tone ?? "text-paper"}`}>{s.value}</p>
          {s.hint && <p className="truncate text-[11px] text-slate">{s.hint}</p>}
        </div>
      ))}
    </div>
  );
}

function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; count?: number; tone?: string }[] }) {
  return (
    <div className="inline-flex h-9 border border-ink-mid">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`flex items-center gap-1.5 border-r border-ink-mid px-3 font-mono text-[10px] uppercase last:border-r-0 ${value === o.value ? "bg-signal/15 text-signal" : "text-slate-light hover:bg-ink-light hover:text-paper"}`}
        >
          {o.label}
          {o.count !== undefined && <span className={`font-semibold ${value === o.value ? "" : o.tone ?? "text-slate"}`}>{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="flex h-9 min-w-[12rem] flex-1 items-center gap-2 border border-ink-mid bg-ink-light px-3 sm:max-w-xs">
      <Search className="h-4 w-4 shrink-0 text-slate" />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="w-full bg-transparent text-sm outline-none placeholder:text-slate" />
      {value && <button type="button" onClick={() => onChange("")} className="text-slate hover:text-paper"><X className="h-3.5 w-3.5" /></button>}
    </label>
  );
}

const selectClass = "h-9 border border-ink-mid bg-ink-light px-2 text-sm text-paper";
const thClass = "sticky top-0 z-10 bg-ink-light px-3 py-2.5 text-left font-mono text-[10px] uppercase tracking-wider text-slate";

// ─── Stock levels: balances table + reorder watchlist ────────────────────────

export function StockLevelsTab({
  stockSearch, setStockSearch, storeFilter, setStoreFilter, categoryFilter, setCategoryFilter,
  itemTypeFilter, setItemTypeFilter, belowReorder, setBelowReorder,
  contextualStores, categories, loading, stockLevels, scopedStock, filteredStock,
}: {
  stockSearch: string; setStockSearch: (v: string) => void;
  storeFilter: string; setStoreFilter: (v: string) => void;
  categoryFilter: string; setCategoryFilter: (v: string) => void;
  itemTypeFilter: string; setItemTypeFilter: (v: string) => void;
  belowReorder: boolean; setBelowReorder: (v: boolean) => void;
  contextualStores: Rec[]; categories: string[]; loading: boolean;
  stockLevels: Rec[]; scopedStock: Rec[]; filteredStock: Rec[];
}) {
  const [health, setHealth] = useState<"all" | "low" | "out">("all");
  useEffect(() => { if (belowReorder) setHealth("low"); }, [belowReorder]);

  const { out, low, value } = useMemo(() => {
    const out = scopedStock.filter((r) => availableQty(r) <= 0);
    const low = scopedStock.filter((r) => { const q = availableQty(r); const re = reorderLevel(r); return q > 0 && re > 0 && q <= re; });
    return { out, low, value: scopedStock.reduce((s, r) => s + stockValue(r), 0) };
  }, [scopedStock]);

  const rows = useMemo(() => filteredStock.filter((r) => {
    const q = availableQty(r);
    const re = reorderLevel(r);
    if (health === "out") return q <= 0;
    if (health === "low") return q > 0 && re > 0 && q <= re;
    return true;
  }), [filteredStock, health]);

  const changeHealth = (v: "all" | "low" | "out") => { setHealth(v); setBelowReorder(false); };
  const watchlist = [...out, ...low];

  return (
    <div className="space-y-4">
      <StatStrip stats={[
        { label: "Stock value in scope", value: money(value) },
        { label: "Stock lines", value: String(scopedStock.length), hint: `${contextualStores.length} stores` },
        { label: "Below reorder", value: String(low.length), tone: low.length ? "text-amber-300" : "text-slate-light" },
        { label: "Out of stock", value: String(out.length), tone: out.length ? "text-red-300" : "text-slate-light" },
      ]} />

      <div className="grid gap-4 xl:grid-cols-[1fr_20rem]">
        <section className="min-w-0 border border-ink-mid bg-ink">
          <div className="flex flex-wrap items-center gap-2 border-b border-ink-mid p-3">
            <SearchBox value={stockSearch} onChange={setStockSearch} placeholder="Search item, code, store…" />
            <Segmented value={health} onChange={changeHealth} options={[
              { value: "all", label: "All", count: scopedStock.length },
              { value: "low", label: "Low", count: low.length, tone: "text-amber-300" },
              { value: "out", label: "Out", count: out.length, tone: "text-red-300" },
            ]} />
            <select value={storeFilter} onChange={(e) => setStoreFilter(e.target.value)} className={selectClass}>
              <option value="">All stores</option>
              {contextualStores.map((s) => <option key={s.id} value={tx(s.id)}>{tx(s.name ?? s.store_name, s.id)}</option>)}
            </select>
            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className={selectClass}>
              <option value="">All categories</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={itemTypeFilter} onChange={(e) => setItemTypeFilter(e.target.value)} className={selectClass}>
              <option value="">All types</option>
              <option value="material">Materials</option>
              <option value="supply">Supplies</option>
              <option value="tool">Reusable Tools</option>
            </select>
          </div>
          {loading && stockLevels.length === 0 ? (
            <Loading label="Loading stock levels" />
          ) : rows.length === 0 ? (
            <Empty label="No stock records match this view." sub="Receive stock or loosen the filters to see balances." />
          ) : (
            <div className="max-h-[calc(100vh-22rem)] min-h-[20rem] overflow-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr>
                    {["Item", "Store", "Available", "Reserved", "Unit cost", "Value"].map((h) => <th key={h} className={thClass}>{h}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-mid">
                  {rows.map((r) => {
                    const avail = availableQty(r);
                    const reorder = reorderLevel(r);
                    const cost = num(r.unit_price_inc_vat ?? r.standard_cost ?? r.unit_cost);
                    const isOut = avail <= 0;
                    const isLow = !isOut && reorder > 0 && avail <= reorder;
                    const fill = reorder > 0 ? Math.min(100, (avail / (reorder * 2)) * 100) : 100;
                    return (
                      <tr key={r.id} className={isOut ? "bg-red-950/10" : isLow ? "bg-amber-950/10" : "hover:bg-ink-light/40"}>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-paper">{tx(r.item_name ?? r.name)}</span>
                            {itemType(r.item_type) === "tool" && <Wrench className="h-3 w-3 text-blue-300" />}
                          </div>
                          <p className="font-mono text-[10px] text-slate">{tx(r.item_code)} · {normalizeInventoryCategory(r.category, "Uncategorised")}</p>
                        </td>
                        <td className="px-3 py-2 text-slate-light">{tx(r.store_name ?? r.store_code)}</td>
                        <td className="px-3 py-2">
                          <p className={`font-mono font-semibold ${isOut ? "text-red-300" : isLow ? "text-amber-300" : "text-emerald-300"}`}>{qty(avail)} <span className="font-normal text-slate">{tx(r.uom ?? r.unit_of_measure, "")}</span></p>
                          {reorder > 0 && (
                            <div className="mt-1 flex items-center gap-2" title={`Reorder at ${qty(reorder)}`}>
                              <div className="h-1 w-20 bg-ink-mid"><div className={`h-full ${isOut ? "bg-red-400" : isLow ? "bg-amber-400" : "bg-emerald-500"}`} style={{ width: `${fill}%` }} /></div>
                              <span className="font-mono text-[10px] text-slate">re {qty(reorder)}</span>
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 font-mono text-slate-light">{num(r.reserved_qty) ? qty(r.reserved_qty) : "—"}</td>
                        <td className="px-3 py-2 font-mono text-slate-light">{cost > 0 ? money(cost) : "—"}</td>
                        <td className="px-3 py-2 font-mono font-semibold text-paper">{stockValue(r) ? money(stockValue(r)) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="border-t border-ink-mid px-4 py-2 text-right font-mono text-[10px] uppercase text-slate">{rows.length} of {scopedStock.length} lines</div>
        </section>

        <aside className="border border-ink-mid bg-ink xl:max-h-[calc(100vh-16rem)] xl:overflow-hidden">
          <div className="flex items-center justify-between border-b border-ink-mid px-4 py-3">
            <h2 className="flex items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-wider text-paper"><AlertTriangle className="h-4 w-4 text-amber-300" /> Reorder watchlist</h2>
            <span className="font-mono text-[10px] text-slate">{watchlist.length}</span>
          </div>
          {watchlist.length === 0 ? (
            <p className="p-6 text-center text-sm text-slate-light">Every stocked line is above its reorder level.</p>
          ) : (
            <ul className="max-h-80 divide-y divide-ink-mid overflow-auto xl:max-h-[calc(100vh-20rem)]">
              {watchlist.map((r) => {
                const isOut = availableQty(r) <= 0;
                return (
                  <li key={r.id} className="px-4 py-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm text-paper">{tx(r.item_name ?? r.name)}</p>
                      <span className={`shrink-0 font-mono text-[10px] uppercase ${isOut ? "text-red-300" : "text-amber-300"}`}>{isOut ? "Out" : "Low"}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-slate-light">{tx(r.store_name, "No store")} · {qty(availableQty(r))} left{reorderLevel(r) > 0 ? ` / re ${qty(reorderLevel(r))}` : ""}</p>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}

// ─── Item catalogue: category rail + item register ──────────────────────────

export function ItemCatalogueTab({
  catSearch, setCatSearch, itemTypeFilter, setItemTypeFilter, setShowAddItem,
  loading, catalogue, filteredCatalogue, setCatalogueDetail, stockLevels,
}: {
  catSearch: string; setCatSearch: (v: string) => void;
  itemTypeFilter: string; setItemTypeFilter: (v: string) => void;
  setShowAddItem: (v: boolean) => void;
  loading: boolean; catalogue: Rec[]; filteredCatalogue: Rec[];
  setCatalogueDetail: (r: Rec) => void; stockLevels: Rec[];
}) {
  const [category, setCategory] = useState("");

  const onHand = useMemo(() => {
    const byItem = new Map<string, { qty: number; stores: number }>();
    for (const s of stockLevels) {
      const key = tx(s.item_id, "") || `code:${tx(s.item_code)}`;
      const entry = byItem.get(key) ?? { qty: 0, stores: 0 };
      const q = availableQty(s);
      entry.qty += q;
      if (q !== 0) entry.stores += 1;
      byItem.set(key, entry);
    }
    return (r: Rec) => byItem.get(String(r.id)) ?? byItem.get(`code:${tx(r.item_code)}`) ?? { qty: 0, stores: 0 };
  }, [stockLevels]);

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    catalogue.forEach((r) => {
      const c = normalizeInventoryCategory(r.category, "Uncategorised");
      counts.set(c, (counts.get(c) ?? 0) + 1);
    });
    return Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [catalogue]);

  const rows = useMemo(
    () => (category ? filteredCatalogue.filter((r) => normalizeInventoryCategory(r.category, "Uncategorised") === category) : filteredCatalogue),
    [filteredCatalogue, category]
  );

  const unpriced = catalogue.filter((r) => num(r.unit_price_inc_vat ?? r.unit_price_ex_vat ?? r.standard_cost) <= 0).length;
  const neverStocked = catalogue.filter((r) => onHand(r).stores === 0).length;
  const tools = catalogue.filter((r) => itemType(r.item_type) === "tool").length;

  return (
    <div className="space-y-4">
      <StatStrip stats={[
        { label: "Catalogue items", value: String(catalogue.length), hint: `${categoryCounts.length} categories` },
        { label: "Reusable tools", value: String(tools) },
        { label: "No price set", value: String(unpriced), tone: unpriced ? "text-amber-300" : "text-slate-light", hint: "Can't value stock" },
        { label: "Not in any store", value: String(neverStocked), tone: neverStocked ? "text-slate-light" : "text-slate", hint: "Zero on hand" },
      ]} />

      <div className="grid gap-4 lg:grid-cols-[14rem_1fr]">
        <nav className="border border-ink-mid bg-ink lg:max-h-[calc(100vh-16rem)] lg:overflow-auto">
          <p className="border-b border-ink-mid px-3 py-2.5 font-mono text-[10px] uppercase tracking-wider text-slate">Categories</p>
          <div className="flex gap-1 overflow-x-auto p-2 lg:flex-col lg:overflow-visible">
            {[["", catalogue.length] as [string, number], ...categoryCounts].map(([name, count]) => (
              <button
                key={name || "all"}
                type="button"
                onClick={() => setCategory(name)}
                className={`flex shrink-0 items-center justify-between gap-3 px-2.5 py-1.5 text-left text-sm ${category === name ? "bg-signal/15 text-signal" : "text-slate-light hover:bg-ink-light hover:text-paper"}`}
              >
                <span className="truncate">{name || "All items"}</span>
                <span className="font-mono text-[10px]">{count}</span>
              </button>
            ))}
          </div>
        </nav>

        <section className="min-w-0 border border-ink-mid bg-ink">
          <div className="flex flex-wrap items-center gap-2 border-b border-ink-mid p-3">
            <SearchBox value={catSearch} onChange={setCatSearch} placeholder="Search catalogue…" />
            <Segmented value={(itemTypeFilter || "all") as string} onChange={(v) => setItemTypeFilter(v === "all" ? "" : v)} options={[
              { value: "all", label: "All" },
              { value: "material", label: "Materials" },
              { value: "supply", label: "Supplies" },
              { value: "tool", label: "Tools" },
            ]} />
            <button onClick={() => setShowAddItem(true)} className="ml-auto inline-flex h-9 items-center gap-2 bg-signal px-4 font-mono text-xs font-bold uppercase text-ink">
              <Plus className="h-4 w-4" /> Add Item
            </button>
          </div>
          {loading && catalogue.length === 0 ? (
            <Loading label="Loading item catalogue" />
          ) : rows.length === 0 ? (
            <Empty label="No catalogue items match." sub="Add an item, or pick another category." />
          ) : (
            <div className="max-h-[calc(100vh-22rem)] min-h-[20rem] overflow-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr>
                    {["Item", "Type", "UOM", "Ex VAT", "Inc VAT", "On hand", ""].map((h, i) => <th key={h || i} className={thClass}>{h}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-mid">
                  {rows.map((r) => {
                    const stock = onHand(r);
                    const exVat = num(r.unit_price_ex_vat ?? r.standard_cost);
                    const incVat = num(r.unit_price_inc_vat ?? r.standard_cost);
                    return (
                      <tr key={r.id} className="cursor-pointer hover:bg-ink-light/40" onClick={() => setCatalogueDetail(r)}>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-paper">{tx(r.item_name ?? r.name ?? r.description)}</span>
                            {r.is_hazardous && <span className="border border-red-500/40 px-1 font-mono text-[9px] uppercase text-red-300">Hazard</span>}
                          </div>
                          <p className="font-mono text-[10px] text-slate">{tx(r.item_code)}{!category ? ` · ${normalizeInventoryCategory(r.category, "Uncategorised")}` : ""}</p>
                        </td>
                        <td className="px-3 py-2 font-mono text-[10px] uppercase text-slate-light">{itemType(r.item_type)}</td>
                        <td className="px-3 py-2 text-slate-light">{tx(r.uom ?? r.unit_of_measure)}</td>
                        <td className="px-3 py-2 font-mono text-slate-light">{exVat > 0 ? money(exVat) : <span className="text-amber-300/80">not set</span>}</td>
                        <td className="px-3 py-2 font-mono text-slate-light">{incVat > 0 ? money(incVat) : "—"}{num(r.vat_rate) > 0 && <span className="ml-1 text-[10px] text-slate">({num(r.vat_rate)}%)</span>}</td>
                        <td className="px-3 py-2">
                          <p className={`font-mono font-semibold ${stock.qty > 0 ? "text-emerald-300" : "text-slate"}`}>{qty(stock.qty)}</p>
                          <p className="font-mono text-[10px] text-slate">{stock.stores ? `${stock.stores} store${stock.stores === 1 ? "" : "s"}` : "not stocked"}</p>
                        </td>
                        <td className="px-3 py-2 text-slate"><ChevronRight className="h-4 w-4" /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="border-t border-ink-mid px-4 py-2 text-right font-mono text-[10px] uppercase text-slate">{rows.length} items</div>
        </section>
      </div>
    </div>
  );
}

// ─── Stores: store list + selected store's contents ─────────────────────────

function storeTypeIcon(type: string) {
  const t = type.toLowerCase();
  if (t.includes("warehouse")) return <Warehouse className="h-3.5 w-3.5" />;
  if (t.includes("yard")) return <Truck className="h-3.5 w-3.5" />;
  return <Store className="h-3.5 w-3.5" />;
}

export function StoresTab({
  setShowAddStore, loading, stores, contextualStores, stockLevels, movements, setStoreDetail,
}: {
  setShowAddStore: (v: boolean) => void; loading: boolean; stores: Rec[];
  contextualStores: Rec[]; stockLevels: Rec[]; movements: Rec[]; setStoreDetail: (r: Rec) => void;
}) {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState("");

  const summaries = useMemo(() => contextualStores.map((s) => {
    const items = stockLevels.filter((r) => storeMatches(r, s));
    const stocked = items.filter((r) => availableQty(r) !== 0);
    const flagged = items.filter((r) => { const q = availableQty(r); const re = reorderLevel(r); return q <= 0 || (re > 0 && q <= re); });
    return { store: s, items, stocked: stocked.length, flagged: flagged.length, value: items.reduce((sum, r) => sum + stockValue(r), 0) };
  }).sort((a, b) => b.value - a.value), [contextualStores, stockLevels]);

  const visible = summaries.filter(({ store }) => `${tx(store.name ?? store.store_name)} ${tx(store.store_code)} ${tx(store.client_name, "")} ${tx(store.project_name, "")} ${tx(store.location, "")}`.toLowerCase().includes(search.toLowerCase()));
  const selected = summaries.find((s) => String(s.store.id) === selectedId) ?? visible[0] ?? null;
  const selectedMovements = selected
    ? movements.filter((m) => storeMatches(m, selected.store)).sort((a, b) => movementTime(b) - movementTime(a)).slice(0, 12)
    : [];
  const totalValue = summaries.reduce((s, x) => s + x.value, 0);
  const emptyStores = summaries.filter((s) => s.stocked === 0).length;

  if (loading && stores.length === 0) return <Loading label="Loading stores" />;

  return (
    <div className="space-y-4">
      <StatStrip stats={[
        { label: "Stores in scope", value: String(summaries.length) },
        { label: "Value held", value: money(totalValue) },
        { label: "Largest store", value: summaries[0] ? tx(summaries[0].store.name ?? summaries[0].store.store_name) : "—", hint: summaries[0] ? money(summaries[0].value) : undefined },
        { label: "Empty stores", value: String(emptyStores), tone: emptyStores ? "text-slate-light" : "text-slate" },
      ]} />

      {summaries.length === 0 ? (
        <section className="border border-ink-mid bg-ink">
          <Empty label="No stores in this scope." sub="Add a warehouse, site store or yard to start tracking stock." />
          <div className="pb-6 text-center">
            <button onClick={() => setShowAddStore(true)} className="inline-flex h-9 items-center gap-2 bg-signal px-4 font-mono text-xs font-bold uppercase text-ink"><Plus className="h-4 w-4" /> Add Store</button>
          </div>
        </section>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
          <section className="border border-ink-mid bg-ink lg:max-h-[calc(100vh-16rem)] lg:overflow-hidden">
            <div className="flex gap-2 border-b border-ink-mid p-3">
              <SearchBox value={search} onChange={setSearch} placeholder="Find a store…" />
              <button onClick={() => setShowAddStore(true)} title="Add store" className="inline-flex h-9 w-9 shrink-0 items-center justify-center bg-signal text-ink"><Plus className="h-4 w-4" /></button>
            </div>
            <ul className="max-h-96 divide-y divide-ink-mid overflow-auto lg:max-h-[calc(100vh-21rem)]">
              {visible.map(({ store, stocked, flagged, value }) => {
                const active = selected && String(selected.store.id) === String(store.id);
                return (
                  <li key={store.id}>
                    <button type="button" onClick={() => setSelectedId(String(store.id))} className={`w-full border-l-2 px-3 py-2.5 text-left ${active ? "border-signal bg-signal/10" : "border-transparent hover:bg-ink-light/40"}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-semibold text-paper">{tx(store.name ?? store.store_name)}</span>
                        <span className="shrink-0 font-mono text-xs text-paper">{money(value)}</span>
                      </div>
                      <div className="mt-0.5 flex items-center justify-between gap-2 font-mono text-[10px] uppercase text-slate">
                        <span className="truncate">{tx(store.store_code, "")} · {tx(store.project_name ?? store.client_name, "Company store")}</span>
                        <span className="shrink-0">{stocked} items{flagged ? <span className="text-amber-300"> · {flagged}!</span> : null}</span>
                      </div>
                    </button>
                  </li>
                );
              })}
              {visible.length === 0 && <li className="p-6 text-center text-sm text-slate-light">No store matches “{search}”.</li>}
            </ul>
          </section>

          {selected && (
            <section className="min-w-0 border border-ink-mid bg-ink">
              <header className="flex flex-wrap items-start justify-between gap-3 border-b border-ink-mid p-4">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-signal">
                    {storeTypeIcon(tx(selected.store.store_type ?? selected.store.type, "store"))}
                    {tx(selected.store.store_code)} · {tx(selected.store.store_type ?? selected.store.type, "store")}
                  </p>
                  <h2 className="mt-1 text-xl font-semibold text-paper">{tx(selected.store.name ?? selected.store.store_name)}</h2>
                  <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-light">
                    <span><Building2 className="mr-1 inline h-3 w-3" />{tx(selected.store.client_name, "Company")} / {tx(selected.store.project_name ?? selected.store.site_name, "No project")}</span>
                    {selected.store.location && <span><MapPin className="mr-1 inline h-3 w-3" />{tx(selected.store.location)}</span>}
                  </p>
                </div>
                <button onClick={() => setStoreDetail(selected.store)} className="inline-flex h-9 items-center gap-2 border border-ink-mid px-3 font-mono text-[10px] uppercase text-slate-light hover:border-signal hover:text-paper">
                  <Settings2 className="h-4 w-4" /> Manage store
                </button>
              </header>
              <div className="grid grid-cols-3 divide-x divide-ink-mid border-b border-ink-mid">
                <MiniFigure label="Items held" value={String(selected.stocked)} />
                <MiniFigure label="Value" value={money(selected.value)} />
                <MiniFigure label="Needs reorder" value={String(selected.flagged)} tone={selected.flagged ? "text-amber-300" : "text-slate"} />
              </div>
              <div className="grid xl:grid-cols-[1fr_18rem]">
                <div className="max-h-[calc(100vh-28rem)] min-h-[14rem] overflow-auto xl:border-r xl:border-ink-mid">
                  {selected.items.length === 0 ? (
                    <Empty label="Nothing in this store yet." sub="Use Manage store or Receive Stock to put items here." />
                  ) : (
                    <table className="w-full text-sm">
                      <thead><tr>{["Item", "Available", "Value"].map((h) => <th key={h} className={thClass}>{h}</th>)}</tr></thead>
                      <tbody className="divide-y divide-ink-mid">
                        {[...selected.items].sort((a, b) => stockValue(b) - stockValue(a)).map((r) => {
                          const q = availableQty(r);
                          const re = reorderLevel(r);
                          const tone = q <= 0 ? "text-red-300" : re > 0 && q <= re ? "text-amber-300" : "text-emerald-300";
                          return (
                            <tr key={r.id} className="hover:bg-ink-light/40">
                              <td className="px-3 py-2"><p className="text-paper">{tx(r.item_name ?? r.name)}</p><p className="font-mono text-[10px] text-slate">{tx(r.item_code)}</p></td>
                              <td className={`px-3 py-2 font-mono font-semibold ${tone}`}>{qty(q)} <span className="font-normal text-slate">{tx(r.uom ?? r.unit_of_measure, "")}</span></td>
                              <td className="px-3 py-2 font-mono text-paper">{stockValue(r) ? money(stockValue(r)) : "—"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
                <div className="border-t border-ink-mid xl:border-t-0">
                  <p className="border-b border-ink-mid px-4 py-2.5 font-mono text-[10px] uppercase tracking-wider text-slate">Recent activity</p>
                  {selectedMovements.length === 0 ? (
                    <p className="p-4 text-sm text-slate-light">No movements recorded here.</p>
                  ) : (
                    <ul className="max-h-[calc(100vh-31rem)] min-h-[10rem] divide-y divide-ink-mid overflow-auto">
                      {selectedMovements.map((m) => {
                        const q = num(m.quantity ?? m.qty);
                        return (
                          <li key={m.id} className="flex items-start justify-between gap-2 px-4 py-2">
                            <div className="min-w-0">
                              <p className="truncate text-sm text-paper">{tx(m.item_name ?? m.item_code)}</p>
                              <p className="font-mono text-[10px] uppercase text-slate">{tx(m.movement_type, "").replace("_", " ")} · {dateShort(m.created_at ?? m.movement_date)}</p>
                            </div>
                            <span className={`shrink-0 font-mono text-sm font-semibold ${q < 0 ? "text-red-300" : "text-emerald-300"}`}>{q > 0 ? "+" : ""}{qty(q)}</span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function MiniFigure({ label, value, tone = "text-paper" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="px-4 py-2.5">
      <p className="font-mono text-[10px] uppercase tracking-wider text-slate">{label}</p>
      <p className={`mt-0.5 font-mono text-base font-semibold ${tone}`}>{value}</p>
    </div>
  );
}

// ─── Movements: day-grouped ledger with flow filters ────────────────────────

const MOVEMENT_GROUPS: { key: string; label: string; types: string[]; tone: string }[] = [
  { key: "receipt", label: "Received", types: ["receipt", "return"], tone: "text-emerald-300" },
  { key: "issue", label: "Issued", types: ["issue", "consumption"], tone: "text-blue-300" },
  { key: "transfer", label: "Transfers", types: ["transfer_in", "transfer_out"], tone: "text-purple-300" },
  { key: "adjustment", label: "Adjustments", types: ["adjustment"], tone: "text-slate-light" },
];

function isoDay(offsetDays: number) {
  const d = new Date(Date.now() - offsetDays * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function MovementsTab({
  movDateFrom, setMovDateFrom, movDateTo, setMovDateTo, movTypeFilter, setMovTypeFilter,
  movStoreFilter, setMovStoreFilter, contextualStores, loading, movements, filteredMovements,
}: {
  movDateFrom: string; setMovDateFrom: (v: string) => void;
  movDateTo: string; setMovDateTo: (v: string) => void;
  movTypeFilter: string; setMovTypeFilter: (v: string) => void;
  movStoreFilter: string; setMovStoreFilter: (v: string) => void;
  contextualStores: Rec[]; loading: boolean; movements: Rec[]; filteredMovements: Rec[];
}) {
  const [group, setGroup] = useState("");
  const [search, setSearch] = useState("");

  // Type groups are applied here rather than through movTypeFilter so one
  // chip covers both legs of a transfer (and issue + consumption).
  const groupCounts = useMemo(() => MOVEMENT_GROUPS.map((g) => ({
    ...g,
    count: filteredMovements.filter((m) => g.types.includes(tx(m.movement_type, "").toLowerCase())).length,
  })), [filteredMovements]);

  const rows = useMemo(() => {
    const types = MOVEMENT_GROUPS.find((g) => g.key === group)?.types;
    const q = search.toLowerCase();
    return filteredMovements
      .filter((m) => !types || types.includes(tx(m.movement_type, "").toLowerCase()))
      .filter((m) => !q || `${tx(m.item_name)} ${tx(m.item_code)} ${tx(m.reference ?? m.ref, "")} ${tx(m.store_name, "")} ${tx(m.project_name, "")}`.toLowerCase().includes(q))
      .sort((a, b) => movementTime(b) - movementTime(a));
  }, [filteredMovements, group, search]);

  const days = useMemo(() => {
    const byDay = new Map<string, Rec[]>();
    rows.forEach((m) => {
      const d = new Date(movementTime(m));
      const key = Number.isNaN(d.getTime()) ? "Undated" : new Intl.DateTimeFormat("en-ZW", { weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(d);
      byDay.set(key, [...(byDay.get(key) ?? []), m]);
    });
    return Array.from(byDay.entries());
  }, [rows]);

  const unitsIn = rows.reduce((s, m) => s + Math.max(0, num(m.quantity ?? m.qty)), 0);
  const unitsOut = rows.reduce((s, m) => s + Math.min(0, num(m.quantity ?? m.qty)), 0);
  const preset = !movDateFrom && !movDateTo ? "all" : movDateTo ? "custom" : movDateFrom === isoDay(0) ? "today" : movDateFrom === isoDay(6) ? "7d" : movDateFrom === isoDay(29) ? "30d" : "custom";
  const setPreset = (p: string) => {
    setMovDateTo("");
    setMovDateFrom(p === "today" ? isoDay(0) : p === "7d" ? isoDay(6) : p === "30d" ? isoDay(29) : "");
  };
  const hasFilters = movDateFrom || movDateTo || movTypeFilter || movStoreFilter || group || search;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {groupCounts.map((g) => (
          <button
            key={g.key}
            type="button"
            onClick={() => setGroup(group === g.key ? "" : g.key)}
            className={`border px-4 py-2.5 text-left ${group === g.key ? "border-signal bg-signal/10" : "border-ink-mid bg-ink hover:border-signal/40"}`}
          >
            <p className="font-mono text-[10px] uppercase tracking-wider text-slate">{g.label}</p>
            <p className={`mt-0.5 font-mono text-lg font-semibold ${g.tone}`}>{g.count}</p>
          </button>
        ))}
      </div>

      <section className="border border-ink-mid bg-ink">
        <div className="flex flex-wrap items-center gap-2 border-b border-ink-mid p-3">
          <SearchBox value={search} onChange={setSearch} placeholder="Item, reference, store…" />
          <Segmented value={preset} onChange={setPreset} options={[
            { value: "today", label: "Today" },
            { value: "7d", label: "7 days" },
            { value: "30d", label: "30 days" },
            { value: "all", label: "All" },
          ]} />
          <input type="date" value={movDateFrom} onChange={(e) => setMovDateFrom(e.target.value)} className={selectClass} title="From" />
          <input type="date" value={movDateTo} onChange={(e) => setMovDateTo(e.target.value)} className={selectClass} title="To" />
          <select value={movStoreFilter} onChange={(e) => setMovStoreFilter(e.target.value)} className={selectClass}>
            <option value="">All stores</option>
            {contextualStores.map((s) => <option key={s.id} value={tx(s.id)}>{tx(s.name ?? s.store_name, s.id)}</option>)}
          </select>
          {hasFilters && (
            <button onClick={() => { setMovDateFrom(""); setMovDateTo(""); setMovTypeFilter(""); setMovStoreFilter(""); setGroup(""); setSearch(""); }} className="inline-flex h-9 items-center gap-1 border border-ink-mid px-3 font-mono text-[10px] uppercase text-slate-light hover:text-paper">
              <X className="h-3.5 w-3.5" /> Clear
            </button>
          )}
          <div className="ml-auto flex gap-4 font-mono text-xs">
            <span className="flex items-center gap-1 text-emerald-300"><ArrowUp className="h-3 w-3" />{qty(unitsIn)} in</span>
            <span className="flex items-center gap-1 text-red-300"><ArrowDown className="h-3 w-3" />{qty(Math.abs(unitsOut))} out</span>
          </div>
        </div>

        {loading && movements.length === 0 ? (
          <Loading label="Loading stock movements" />
        ) : rows.length === 0 ? (
          <Empty label="No movements match this filter." sub="Widen the date range or clear the type filter." />
        ) : (
          <div className="max-h-[calc(100vh-22rem)] min-h-[20rem] overflow-auto">
            {days.map(([day, items]) => (
              <div key={day}>
                <div className="sticky top-0 z-10 flex items-center justify-between border-b border-ink-mid bg-ink-light px-4 py-1.5 font-mono text-[10px] uppercase tracking-wider text-slate-light">
                  <span>{day}</span>
                  <span>{items.length} movement{items.length === 1 ? "" : "s"}</span>
                </div>
                <ul className="divide-y divide-ink-mid/70">
                  {items.map((m) => {
                    const q = num(m.quantity ?? m.qty);
                    const d = new Date(movementTime(m));
                    return (
                      <li key={m.id} className="grid grid-cols-[3.5rem_7rem_1fr_auto] items-center gap-3 px-4 py-2 hover:bg-ink-light/30 max-md:grid-cols-[1fr_auto]">
                        <span className="font-mono text-xs text-slate max-md:hidden">{Number.isNaN(d.getTime()) ? "—" : d.toLocaleTimeString("en-ZW", { hour: "2-digit", minute: "2-digit" })}</span>
                        <span className="max-md:hidden"><MovBadge type={tx(m.movement_type, "").toLowerCase()} /></span>
                        <div className="min-w-0">
                          <p className="truncate text-sm text-paper">{tx(m.item_name ?? m.item_code)}</p>
                          <p className="flex flex-wrap items-center gap-x-1.5 truncate text-xs text-slate-light">
                            <span>{tx(m.store_name ?? m.store_code)}</span>
                            {(m.project_name || m.project_id) && <><ArrowRight className="h-3 w-3 text-slate" /><span>{tx(m.project_name ?? m.project_id)}</span></>}
                            {(m.reference ?? m.ref) && <span className="font-mono text-slate">· {tx(m.reference ?? m.ref)}</span>}
                            {(m.recorded_by ?? m.created_by_name) && <span className="text-slate">· {tx(m.recorded_by ?? m.created_by_name)}</span>}
                          </p>
                        </div>
                        <span className={`font-mono text-sm font-semibold ${q < 0 ? "text-red-300" : "text-emerald-300"}`}>{q > 0 ? "+" : ""}{qty(q)}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
        <div className="border-t border-ink-mid px-4 py-2 text-right font-mono text-[10px] uppercase text-slate">{rows.length} movements · latest 200 loaded</div>
      </section>
    </div>
  );
}

