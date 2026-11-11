"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, PackageCheck, Plus, Search, Square, Trash2, Truck, X } from "lucide-react";
import { closeSiteDay, getDayUsageReconciliation, reconcileDayUsage } from "@/lib/api";
import { ApiRecord, Btn, Notice, Pill, errorText, fieldClass, num, qty } from "./ui";

type MatRow = { key: string; item_id: string; store_id: string | null; consumes_stock: boolean; label: string; code?: string; uom?: string; source: string; available?: number; issued?: number; unit_cost: number; used: string; wasted: string };
type PlantRow = { fleet_id: string; label: string; code: string; group: "project" | "small" | "other"; used: boolean; hours: string; idle: string; fuel: string };

type Props = {
  briefingId: string;
  clockedIn: number;
  leftSiteIso?: string;
  inventoryItems: ApiRecord[];
  onClose: () => void;
  onDone: (dayPayload: any) => Promise<void> | void;
  onOpenRecon?: () => void;
};

const matKey = (itemId: string, storeId: string | null, consumes: boolean) => `${itemId}|${storeId ?? "-"}|${consumes ? 1 : 0}`;

function assetName(f: ApiRecord) {
  return [f.make, f.model].filter(Boolean).join(" ") || f.asset_type || f.vehicle_type || "Machine";
}

/** Closing the site day asks for the day's material and plant usage first. */
export function CloseDayReconciliation({ briefingId, clockedIn, leftSiteIso, inventoryItems, onClose, onDone, onOpenRecon }: Props) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [materials, setMaterials] = useState<MatRow[]>([]);
  const [noMaterials, setNoMaterials] = useState(false);
  const [plant, setPlant] = useState<PlantRow[]>([]);
  const [noPlant, setNoPlant] = useState(false);
  const [plantSearch, setPlantSearch] = useState("");
  const [showOtherPlant, setShowOtherPlant] = useState(false);
  const [extra, setExtra] = useState({ item_id: "", store_id: "", used: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [reconBlocked, setReconBlocked] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await getDayUsageReconciliation(briefingId);
        if (!alive) return;
        const d = res.data ?? {};
        setData(d);
        const recorded: ApiRecord[] = d.recorded_materials ?? [];
        const byKey = new Map(recorded.map((m) => [matKey(String(m.item_id), m.store_id ? String(m.store_id) : null, m.consumes_stock !== false && !!m.store_id), m]));
        const rows: MatRow[] = [];
        for (const s of (d.site_stock ?? []) as ApiRecord[]) {
          const k = matKey(String(s.item_id), String(s.store_id), true);
          const rec = byKey.get(k);
          rows.push({
            key: k, item_id: String(s.item_id), store_id: String(s.store_id), consumes_stock: true,
            label: s.item_name, code: s.item_code, uom: s.unit_of_measure, source: s.store_name || "Site store",
            available: num(s.balance), unit_cost: num(s.unit_cost),
            used: rec ? String(num(rec.quantity_used)) : "", wasted: rec ? String(num(rec.wastage_quantity)) : "",
          });
          byKey.delete(k);
        }
        for (const i of (d.issued_today ?? []) as ApiRecord[]) {
          const k = matKey(String(i.item_id), null, false);
          if (rows.some((r) => r.key === k)) continue;
          const rec = byKey.get(k);
          rows.push({
            key: k, item_id: String(i.item_id), store_id: null, consumes_stock: false,
            label: i.item_name, code: i.item_code, uom: i.unit_of_measure, source: `Issued today${i.store_name ? ` from ${i.store_name}` : ""}`,
            issued: num(i.issued_qty), unit_cost: num(i.unit_cost),
            used: rec ? String(num(rec.quantity_used)) : "", wasted: rec ? String(num(rec.wastage_quantity)) : "",
          });
          byKey.delete(k);
        }
        // anything already on the report that isn't in stock or issued today
        for (const [k, rec] of byKey) {
          const consumes = rec.consumes_stock !== false && !!rec.store_id;
          rows.push({
            key: k, item_id: String(rec.item_id), store_id: rec.store_id ? String(rec.store_id) : null, consumes_stock: consumes,
            label: rec.item_name || "Material", code: rec.item_code, uom: rec.unit_of_measure,
            source: consumes ? rec.store_name || "Store" : "Issued to site", unit_cost: num(rec.unit_cost),
            used: String(num(rec.quantity_used)), wasted: String(num(rec.wastage_quantity)),
          });
        }
        setMaterials(rows);
        setNoMaterials(!!d.materials_reconciled_at && !!d.materials_nil_usage);

        const recordedPlant = new Map(((d.recorded_plant ?? []) as ApiRecord[]).map((p) => [String(p.fleet_id), p]));
        setPlant(((d.fleet ?? []) as ApiRecord[]).map((f) => {
          const rec = recordedPlant.get(String(f.id));
          return {
            fleet_id: String(f.id), label: assetName(f), code: [f.asset_code, f.vehicle_registration].filter(Boolean).join(" · "),
            group: f.on_this_project ? "project" : f.is_small_plant ? "small" : "other",
            used: !!rec, hours: rec ? String(num(rec.operating_hours)) : "", idle: rec ? String(num(rec.idle_hours)) : "0",
            fuel: rec ? String(num(rec.fuel_litres)) : "0",
          } as PlantRow;
        }));
        setNoPlant(!!d.plant_reconciled_at && !!d.plant_nil_usage);
      } catch (reason) {
        if (alive) setError(errorText(reason, "Today's usage could not be loaded."));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [briefingId]);

  const storeOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const s of (data?.site_stock ?? []) as ApiRecord[]) seen.set(String(s.store_id), s.store_name || "Site store");
    return Array.from(seen.entries());
  }, [data]);

  const usedMaterials = materials.filter((m) => num(m.used) > 0);
  const usedPlant = plant.filter((p) => p.used);
  const overdraw = usedMaterials.filter((m) => m.consumes_stock && m.available !== undefined && num(m.used) > (m.available ?? 0));
  const materialsAnswered = noMaterials || usedMaterials.length > 0;
  const plantAnswered = noPlant || usedPlant.length > 0;
  const plantInvalid = usedPlant.filter((p) => num(p.hours) <= 0 && num(p.fuel) <= 0 || num(p.idle) > num(p.hours));

  const setMat = (key: string, patch: Partial<MatRow>) => setMaterials((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const setPl = (id: string, patch: Partial<PlantRow>) => setPlant((rows) => rows.map((r) => (r.fleet_id === id ? { ...r, ...patch } : r)));

  const addExtra = () => {
    const item = inventoryItems.find((i) => String(i.id) === extra.item_id);
    if (!item || num(extra.used) <= 0) return;
    const storeId = extra.store_id || null;
    const consumes = !!storeId;
    const key = matKey(String(item.id), storeId, consumes);
    if (materials.some((m) => m.key === key)) {
      setMat(key, { used: String(num(materials.find((m) => m.key === key)?.used) + num(extra.used)) });
    } else {
      setMaterials((rows) => [...rows, {
        key, item_id: String(item.id), store_id: storeId, consumes_stock: consumes,
        label: item.item_name || item.name, code: item.item_code, uom: item.unit_of_measure,
        source: consumes ? storeOptions.find(([id]) => id === storeId)?.[1] || "Store" : "Issued to site",
        unit_cost: num(item.standard_cost), used: extra.used, wasted: "0",
      }]);
    }
    setNoMaterials(false);
    setExtra({ item_id: "", store_id: "", used: "" });
  };

  const save = async (closeAfter: boolean) => {
    setError(null);
    setReconBlocked(false);
    if (!materialsAnswered) { setStep(1); setError("Enter the materials used today, or tick “No materials were used today”."); return; }
    if (!plantAnswered) { setStep(2); setError("Tick each machine used today with its hours, or tick “No plant or machines were used today”."); return; }
    if (plantInvalid.length) { setStep(2); setError(`Check the hours for ${plantInvalid.map((p) => p.label).join(", ")}: hours worked (or fuel) must be given and idle can't exceed hours worked.`); return; }
    setBusy(closeAfter ? "close" : "save");
    try {
      if (data?.editable !== false) {
        const res = await reconcileDayUsage(briefingId, {
          materials: noMaterials ? [] : usedMaterials.map((m) => ({
            item_id: m.item_id, store_id: m.store_id, quantity_used: num(m.used), wastage_quantity: num(m.wasted),
            unit_cost: m.unit_cost, consumes_stock: m.consumes_stock,
          })),
          no_materials_used: noMaterials,
          plant: noPlant ? [] : usedPlant.map((p) => ({
            fleet_id: p.fleet_id, operating_hours: num(p.hours), idle_hours: num(p.idle), fuel_litres: num(p.fuel),
          })),
          no_plant_used: noPlant,
        });
        setWarnings(res?.data?.warnings ?? []);
      }
      if (closeAfter) {
        const closed = await closeSiteDay(briefingId, leftSiteIso);
        await onDone(closed?.data);
        onClose();
      } else {
        await onDone(null);
        onClose();
      }
    } catch (reason) {
      const msg = errorText(reason, "That didn't save. Check the connection and try again.");
      if (/weekly/i.test(msg)) setReconBlocked(true);
      setError(msg);
    } finally {
      setBusy(null);
    }
  };

  const plantGroups: { key: PlantRow["group"]; title: string; hint: string }[] = [
    { key: "project", title: "Plant on this project", hint: "Assigned to this project in Fleet." },
    { key: "small", title: "Small plant & tools", hint: "Compactors, rammers, poker vibrators, floats, mixers…" },
    { key: "other", title: "Other fleet", hint: "Anything else that worked here today." },
  ];
  const term = plantSearch.trim().toLowerCase();

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <div className="flex max-h-[95dvh] w-full max-w-4xl flex-col border border-signal/40 bg-ink text-paper shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-start justify-between gap-3 border-b border-ink-mid px-5 py-4">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-widest text-signal">Close the site day · usage check</p>
            <h2 className="mt-1 text-lg font-semibold">Before closing: what was used today?</h2>
            <p className="mt-1 text-xs text-slate-light">Material taken from a site store comes off its stock now. Plant hours and small machines go on today&apos;s report.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="border border-ink-mid p-2 text-slate-light hover:border-signal hover:text-paper"><X className="h-4 w-4" /></button>
        </header>

        <nav className="flex border-b border-ink-mid text-sm">
          {[{ n: 1 as const, label: "Materials used", icon: <PackageCheck className="h-4 w-4" />, done: materialsAnswered },
            { n: 2 as const, label: "Plant & small machines", icon: <Truck className="h-4 w-4" />, done: plantAnswered }].map((t) => (
            <button key={t.n} onClick={() => setStep(t.n)}
              className={`flex flex-1 items-center justify-center gap-2 border-b-2 px-4 py-3 ${step === t.n ? "border-signal text-paper" : "border-transparent text-slate-light hover:text-paper"}`}>
              {t.done ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : t.icon}
              {t.n}. {t.label}
            </button>
          ))}
        </nav>

        <div className="flex-1 overflow-y-auto p-5">
          {error ? (
            <div className="mb-3 space-y-2">
              <Notice tone="error" onClose={() => setError(null)}>{error}</Notice>
              {reconBlocked && onOpenRecon ? <Btn tone="ghost" onClick={() => { onClose(); onOpenRecon(); }}>Open the Weekly Recon tab</Btn> : null}
            </div>
          ) : null}
          {warnings.map((w) => <Notice key={w} tone="info">{w}</Notice>)}
          {loading ? (
            <div className="flex h-40 items-center justify-center gap-2 text-sm text-slate-light"><Loader2 className="h-5 w-5 animate-spin text-signal" /> Loading today&apos;s stock and plant</div>
          ) : data?.editable === false ? (
            <Notice tone="info">Today&apos;s daily report is already {String(data?.report_status)}; its usage stands as submitted. You can close the day.</Notice>
          ) : step === 1 ? (
            <div className="space-y-4">
              <label className={`flex items-center gap-3 border px-3 py-2.5 text-sm ${noMaterials ? "border-emerald-500/60 text-emerald-200" : "border-ink-mid"}`}>
                <input type="checkbox" checked={noMaterials} onChange={(e) => { setNoMaterials(e.target.checked); if (e.target.checked) setMaterials((rows) => rows.map((r) => ({ ...r, used: "", wasted: "" }))); }} />
                No materials were used today
              </label>
              {!noMaterials ? (
                <>
                  {materials.length === 0 ? (
                    <p className="border border-dashed border-ink-mid p-4 text-center text-xs text-slate-light">No stock in this project&apos;s site stores and nothing issued today. Add what was used below.</p>
                  ) : (
                    <div className="overflow-x-auto border border-ink-mid">
                      <table className="w-full text-left text-xs">
                        <thead className="border-b border-ink-mid bg-ink-light/30 font-mono uppercase text-slate">
                          <tr>
                            <th className="px-3 py-2">Material</th>
                            <th className="px-3 py-2">From</th>
                            <th className="px-3 py-2 text-right">In store / issued</th>
                            <th className="px-3 py-2 text-center">Used today</th>
                            <th className="px-3 py-2 text-center">of which wasted</th>
                            <th className="w-8" />
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-ink-mid/60">
                          {materials.map((m) => {
                            const over = m.consumes_stock && m.available !== undefined && num(m.used) > (m.available ?? 0);
                            return (
                              <tr key={m.key} className={num(m.used) > 0 ? "bg-signal/5" : ""}>
                                <td className="px-3 py-2"><p className="font-medium">{m.label}</p>{m.code ? <p className="font-mono text-[10px] text-slate">{m.code}</p> : null}</td>
                                <td className="px-3 py-2 text-slate-light">{m.source}</td>
                                <td className="px-3 py-2 text-right font-mono">{m.consumes_stock ? `${qty(m.available)} ${m.uom ?? ""}` : m.issued !== undefined ? `${qty(m.issued)} issued` : "—"}</td>
                                <td className="px-3 py-2 text-center">
                                  <input type="number" min="0" step="any" value={m.used} placeholder="0" aria-label={`Used: ${m.label}`}
                                    onChange={(e) => setMat(m.key, { used: e.target.value })}
                                    className={`h-8 w-24 border bg-ink px-2 text-center font-mono text-xs ${over ? "border-amber-500" : "border-ink-mid"} focus:border-signal`} />
                                  {over ? <p className="mt-0.5 text-[10px] text-amber-300">more than the books show</p> : null}
                                </td>
                                <td className="px-3 py-2 text-center">
                                  <input type="number" min="0" step="any" value={m.wasted} placeholder="0" aria-label={`Wasted: ${m.label}`}
                                    onChange={(e) => setMat(m.key, { wasted: e.target.value })}
                                    className="h-8 w-20 border border-ink-mid bg-ink px-2 text-center font-mono text-xs focus:border-signal" />
                                </td>
                                <td className="pr-2">
                                  {num(m.used) > 0 ? <button aria-label="Clear" onClick={() => setMat(m.key, { used: "", wasted: "" })} className="p-1 text-slate hover:text-red-300"><Trash2 className="h-3.5 w-3.5" /></button> : null}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <div className="grid gap-2 border border-ink-mid bg-ink-light/20 p-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_110px_auto] sm:items-end">
                    <label className="grid gap-1 text-[10px] font-mono uppercase text-slate">Something else used
                      <select value={extra.item_id} onChange={(e) => setExtra({ ...extra, item_id: e.target.value })} className={fieldClass}>
                        <option value="">Choose a material…</option>
                        {inventoryItems.map((i) => <option key={i.id} value={i.id}>{i.item_name || i.name}{i.unit_of_measure ? ` · ${i.unit_of_measure}` : ""}</option>)}
                      </select>
                    </label>
                    <label className="grid gap-1 text-[10px] font-mono uppercase text-slate">Taken from
                      <select value={extra.store_id} onChange={(e) => setExtra({ ...extra, store_id: e.target.value })} className={fieldClass}>
                        <option value="">Already issued to site</option>
                        {storeOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                      </select>
                    </label>
                    <label className="grid gap-1 text-[10px] font-mono uppercase text-slate">Qty used
                      <input type="number" min="0" step="any" value={extra.used} onChange={(e) => setExtra({ ...extra, used: e.target.value })} className={fieldClass} />
                    </label>
                    <Btn tone="ghost" icon={<Plus className="h-4 w-4" />} onClick={addExtra} disabled={!extra.item_id || num(extra.used) <= 0}>Add</Btn>
                  </div>
                  {overdraw.length ? (
                    <p className="flex items-center gap-2 text-xs text-amber-200"><AlertTriangle className="h-4 w-4" /> {overdraw.length} item(s) show more used than the books hold. It will still save; Saturday&apos;s stores count settles it.</p>
                  ) : null}
                </>
              ) : null}
            </div>
          ) : (
            <div className="space-y-4">
              <label className={`flex items-center gap-3 border px-3 py-2.5 text-sm ${noPlant ? "border-emerald-500/60 text-emerald-200" : "border-ink-mid"}`}>
                <input type="checkbox" checked={noPlant} onChange={(e) => { setNoPlant(e.target.checked); if (e.target.checked) setPlant((rows) => rows.map((r) => ({ ...r, used: false }))); }} />
                No plant or machines were used today
              </label>
              {!noPlant ? (
                <>
                  <label className="flex h-10 items-center gap-2 border border-ink-mid bg-ink-light px-3 focus-within:border-signal">
                    <Search className="h-4 w-4 text-slate" />
                    <input value={plantSearch} onChange={(e) => setPlantSearch(e.target.value)} placeholder="Find a machine (name, code, registration)…" className="h-full w-full bg-transparent text-sm outline-none placeholder:text-slate" />
                  </label>
                  {plantGroups.map((g) => {
                    const rows = plant.filter((p) => p.group === g.key && (!term || `${p.label} ${p.code}`.toLowerCase().includes(term)));
                    if (!rows.length) return null;
                    if (g.key === "other" && !showOtherPlant && !term && !rows.some((r) => r.used)) {
                      return <button key={g.key} onClick={() => setShowOtherPlant(true)} className="text-xs text-signal hover:underline">Show other fleet ({rows.length})</button>;
                    }
                    return (
                      <div key={g.key} className="border border-ink-mid">
                        <div className="flex items-center justify-between border-b border-ink-mid bg-ink-light/30 px-3 py-2">
                          <p className="font-mono text-[11px] font-bold uppercase tracking-wider">{g.title}</p>
                          <p className="text-[11px] text-slate-light">{g.hint}</p>
                        </div>
                        <div className="divide-y divide-ink-mid/60">
                          {rows.map((p) => (
                            <div key={p.fleet_id} className={`grid items-center gap-2 px-3 py-2 text-xs sm:grid-cols-[minmax(0,1fr)_repeat(3,88px)] ${p.used ? "bg-signal/5" : ""}`}>
                              <label className="flex items-center gap-2">
                                <input type="checkbox" checked={p.used} onChange={(e) => setPl(p.fleet_id, { used: e.target.checked, hours: e.target.checked && !p.hours ? "8" : p.hours })} />
                                <span><span className="font-medium text-paper">{p.label}</span>{p.code ? <span className="ml-1 font-mono text-[10px] text-slate">{p.code}</span> : null}</span>
                              </label>
                              {p.used ? (
                                <>
                                  <label className="grid gap-0.5 text-[10px] font-mono uppercase text-slate">Hours worked
                                    <input type="number" min="0" max="24" step="0.5" value={p.hours} onChange={(e) => setPl(p.fleet_id, { hours: e.target.value })} className="h-8 w-full min-w-0 border border-ink-mid bg-ink px-2 text-center font-mono text-xs text-paper focus:border-signal" />
                                  </label>
                                  <label className="grid gap-0.5 text-[10px] font-mono uppercase text-slate">of which idle
                                    <input type="number" min="0" max="24" step="0.5" value={p.idle} onChange={(e) => setPl(p.fleet_id, { idle: e.target.value })} className="h-8 w-full min-w-0 border border-ink-mid bg-ink px-2 text-center font-mono text-xs text-paper focus:border-signal" />
                                  </label>
                                  <label className="grid gap-0.5 text-[10px] font-mono uppercase text-slate">Fuel added (L)
                                    <input type="number" min="0" step="1" value={p.fuel} onChange={(e) => setPl(p.fleet_id, { fuel: e.target.value })} className="h-8 w-full min-w-0 border border-ink-mid bg-ink px-2 text-center font-mono text-xs text-paper focus:border-signal" />
                                  </label>
                                </>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                  {plant.length === 0 ? <p className="text-xs text-slate-light">The fleet register is empty.</p> : null}
                </>
              ) : null}
            </div>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-mid px-5 py-3">
          <div className="flex flex-wrap gap-2 text-xs">
            <Pill tone={materialsAnswered ? "green" : "amber"}>{noMaterials ? "No materials" : `${usedMaterials.length} material(s)`}</Pill>
            <Pill tone={plantAnswered ? "green" : "amber"}>{noPlant ? "No plant" : `${usedPlant.length} machine(s)`}</Pill>
            {data?.is_saturday ? <Pill tone="gold">Saturday: weekly recon also due</Pill> : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {step === 1 && data?.editable !== false ? <Btn tone="ghost" onClick={() => setStep(2)}>Next: plant</Btn> : null}
            {data?.editable !== false ? <Btn tone="ghost" busy={busy === "save"} disabled={!!busy || loading} onClick={() => void save(false)}>Save usage only</Btn> : null}
            <Btn tone="danger" busy={busy === "close"} disabled={!!busy || loading} icon={<Square className="h-4 w-4" />}
              onClick={() => { if (window.confirm(`Record this usage, clock out ${clockedIn} people and close the site day?`)) void save(true); }}>
              Save &amp; close site day
            </Btn>
          </div>
        </footer>
      </div>
    </div>
  );
}
