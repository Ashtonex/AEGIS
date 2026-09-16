"use client";

import { ChevronRight, Search, Plus, X, ArrowDown, ArrowUp, Warehouse, Truck, Store, Building2, Wrench } from "lucide-react";
import { tx, num, money, qty, itemType, normalizeInventoryCategory, stockValue, dateShort, Loading, Empty, MovBadge, type Rec } from "./page";

export function StockLevelsTab({
  stockSearch, setStockSearch, storeFilter, setStoreFilter, categoryFilter, setCategoryFilter,
  itemTypeFilter, setItemTypeFilter, belowReorder, setBelowReorder,
  contextualStores, categories, loading, stockLevels, filteredStock,
}: {
  stockSearch: string; setStockSearch: (v: string) => void;
  storeFilter: string; setStoreFilter: (v: string) => void;
  categoryFilter: string; setCategoryFilter: (v: string) => void;
  itemTypeFilter: string; setItemTypeFilter: (v: string) => void;
  belowReorder: boolean; setBelowReorder: (v: boolean) => void;
  contextualStores: Rec[]; categories: string[]; loading: boolean;
  stockLevels: Rec[]; filteredStock: Rec[];
}) {
  return (
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
                    <td className="px-3 py-2.5 text-slate-light">{normalizeInventoryCategory(r.category, "—")}</td>
                    <td className="px-3 py-2.5 text-slate-light">{tx(r.uom ?? r.unit_of_measure)}</td>
                    <td className="px-3 py-2.5 text-slate-light">{tx(r.store_name ?? r.store_code)}</td>
                    <td className={`px-3 py-2.5 font-mono font-semibold ${isOut ? "text-red-300" : isLow ? "text-amber-300" : "text-emerald-300"}`}>{qty(avail)}</td>
                    <td className="px-3 py-2.5 font-mono text-slate-light">{qty(r.reserved_qty ?? 0)}</td>
                    <td className={`px-3 py-2.5 font-mono ${reorder > 0 ? "text-slate-light" : "text-slate"}`}>{reorder > 0 ? qty(reorder) : "—"}</td>
                    <td className="px-3 py-2.5 font-mono text-slate-light">{cost > 0 ? money(cost) : "—"}</td>
                    <td className="px-3 py-2.5 font-mono font-semibold text-paper">{value ? money(value) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="border-t border-ink-mid px-4 py-2 text-right font-mono text-xs text-slate-light">{filteredStock.length} records</div>
        </div>
      )}
    </section>
  );
}

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
  return (
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
                    <td className="px-3 py-2.5 text-slate-light">{normalizeInventoryCategory(r.category, "—")}</td>
                    <td className="px-3 py-2.5 text-slate-light">{tx(r.uom ?? r.unit_of_measure)}</td>
                    <td className="px-3 py-2.5 font-mono text-slate-light">{num(r.unit_price_ex_vat ?? r.standard_cost) > 0 ? money(r.unit_price_ex_vat ?? r.standard_cost) : "—"}</td>
                    <td className="px-3 py-2.5 font-mono text-slate-light">{num(r.vat_rate) > 0 ? `${num(r.vat_rate)}%` : "—"}</td>
                    <td className="px-3 py-2.5 font-mono text-slate-light">{num(r.unit_price_inc_vat ?? r.standard_cost) > 0 ? money(r.unit_price_inc_vat ?? r.standard_cost) : "—"}</td>
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
  );
}

export function StoresTab({
  setShowAddStore, loading, stores, contextualStores, stockLevels, setStoreDetail,
}: {
  setShowAddStore: (v: boolean) => void; loading: boolean; stores: Rec[];
  contextualStores: Rec[]; stockLevels: Rec[]; setStoreDetail: (r: Rec) => void;
}) {
  return (
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
              <button key={s.id} type="button" onClick={() => setStoreDetail(s)} className="border border-ink-mid bg-ink-light/30 p-4 text-left hover:border-signal/30">
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
                <p className="mt-3 flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-signal">Open Store <ChevronRight className="h-3 w-3" /></p>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
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
  return (
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
  );
}
