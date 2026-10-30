"use client";

/**
 * Live cost sources and build-up templates for the rate inspector.
 *
 * SourcePicker: current costs from inventory, purchase orders, supplier rate
 * cards, own fleet and site labour (GET /quotations/rate-sources). Picking one
 * fills the resource's unit cost, unit, currency, source and date, and keeps
 * source_type/source_ref so Rates > "Refresh linked prices" can look it up
 * again. Nothing is converted: a different unit or currency is shown, not
 * silently adjusted.
 *
 * TemplateTools: apply a saved or built-in build-up (copied into the line,
 * with the template code and version recorded) or save this line's build-up
 * as a new template version (needs quotations.manage_assemblies).
 */
import React, { useEffect, useMemo, useState } from "react";
import { BookOpen, Check, Database, Save, X } from "lucide-react";
import { ApiError } from "@/lib/api";
import {
  listRateTemplates,
  saveRateTemplate,
  searchRateSources,
  type RateSourceCandidate,
  type RateTemplate,
} from "@/lib/api/quotations";
import { BoqLine, BuildupLine, ResourceType, buildupTotal, canonicalUnit, formatMoney } from "./domain";

const inputCls = "w-full bg-void border border-ink-mid rounded-sm px-1.5 py-1 text-xs text-paper focus:border-signal focus:outline-none";

const SOURCE_LABELS: Record<string, string> = {
  inventory: "Inventory",
  purchase_order: "Purchase order",
  vendor_rate: "Rate card",
  fleet_operating: "Fleet (operating cost)",
  fleet_charge: "Fleet (charge rate)",
  site_labour: "Site labour",
};

export function sourceLabel(type?: string): string {
  return (type && SOURCE_LABELS[type]) || type || "";
}

/** The patch a picked source makes to a build-up resource. */
export function resourceFromSource(current: BuildupLine, c: RateSourceCandidate): Partial<BuildupLine> {
  const unitChanged = !!current.unit && canonicalUnit(current.unit) !== canonicalUnit(c.unit);
  return {
    name: current.name.trim() ? current.name : c.name,
    unit: c.unit || current.unit,
    rate: c.rate,
    currency: c.currency ?? undefined,
    source: `${sourceLabel(c.source_type)}: ${c.detail}${c.code ? ` (${c.code})` : ""}`,
    source_date: c.date ?? undefined,
    source_type: c.source_type,
    source_ref: c.source_ref,
    ...(unitChanged ? { conversion_note: `Unit changed from ${current.unit} to ${c.unit} - check the quantity per unit.` } : {}),
  };
}

export function SourcePicker({ resource, currency, onPick, onClose }: {
  resource: BuildupLine;
  currency: string;
  onPick: (c: RateSourceCandidate) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState(resource.name);
  const [state, setState] = useState<{ loading: boolean; items: RateSourceCandidate[]; error?: string }>({ loading: true, items: [] });
  const resourceType: ResourceType = resource.type;
  const searchable = resourceType !== "waste_allowance";

  useEffect(() => {
    if (!searchable) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setState((s) => ({ ...s, loading: true, error: undefined }));
      try {
        const res = await searchRateSources(q.trim(), resourceType);
        if (!cancelled) setState({ loading: false, items: res.data || [] });
      } catch (err) {
        if (!cancelled) setState({ loading: false, items: [], error: (err as Error).message });
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q, resourceType, searchable]);

  return (
    <div className="border border-signal/40 rounded-sm p-2 space-y-1.5 bg-void" role="dialog" aria-label="Pick a cost source">
      <div className="flex items-center gap-1.5">
        <input className={inputCls} autoFocus aria-label="Search cost sources" placeholder="Search item, PO, plant, trade…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="button" className="p-1 text-slate hover:text-paper" aria-label="Close source picker" onClick={onClose}><X className="w-3.5 h-3.5" /></button>
      </div>
      {!searchable && <p className="text-[11px] text-slate">Wastage allowances have no live source - enter them as a quantity.</p>}
      {state.loading && searchable && <p className="text-[11px] text-slate">Searching inventory, purchase orders, rate cards, fleet and labour…</p>}
      {state.error && <p className="text-[11px] text-danger" role="alert">{state.error}</p>}
      {!state.loading && !state.error && searchable && state.items.length === 0 && (
        <p className="text-[11px] text-slate">No current cost found for this {resourceType}. Site labour shows trades with at least 3 active workers only.</p>
      )}
      <ul className="max-h-56 overflow-y-auto space-y-1">
        {state.items.map((c) => {
          const otherUnit = !!resource.unit && canonicalUnit(resource.unit) !== canonicalUnit(c.unit);
          const otherCurrency = !!c.currency && c.currency !== currency;
          return (
            <li key={`${c.source_type}:${c.source_ref}`}>
              <button type="button" onClick={() => onPick(c)} className="w-full text-left border border-ink-mid hover:border-signal rounded-sm p-1.5 text-[11px]">
                <div className="flex justify-between gap-2">
                  <span className="text-paper line-clamp-1">{c.name}</span>
                  <span className="font-mono whitespace-nowrap">{formatMoney(c.rate, c.currency || currency)}/{c.unit || "?"}</span>
                </div>
                <div className="flex justify-between gap-2 text-slate">
                  <span className="truncate">{sourceLabel(c.source_type)} · {c.detail}</span>
                  <span className="whitespace-nowrap">{c.date || "undated"}</span>
                </div>
                {(otherUnit || otherCurrency || !c.currency) && (
                  <div className="text-warning">
                    {otherUnit ? `Unit ${c.unit} ≠ ${resource.unit}. ` : ""}
                    {otherCurrency ? `Priced in ${c.currency}. ` : ""}
                    {!c.currency ? "Currency not recorded at source." : ""}
                  </div>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function TemplateTools({ line, quotationId, currency, readOnly, onApply }: {
  line: BoqLine;
  quotationId: string;
  currency: string;
  readOnly: boolean;
  onApply: (patch: Partial<BoqLine>) => void;
}) {
  const [mode, setMode] = useState<"none" | "apply" | "save">("none");
  const [templates, setTemplates] = useState<{ loading: boolean; items: RateTemplate[]; error?: string } | null>(null);
  const [filter, setFilter] = useState("");
  const [chosen, setChosen] = useState<RateTemplate | null>(null);
  const [form, setForm] = useState({ code: "", name: "", category: "" });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    setMode("none");
    setChosen(null);
    setMessage(null);
  }, [line.line_id]);

  const openApply = async () => {
    setMode("apply");
    setMessage(null);
    if (templates && !templates.error) return;
    setTemplates({ loading: true, items: [] });
    try {
      const res = await listRateTemplates();
      setTemplates({ loading: false, items: res.data || [] });
    } catch (err) {
      setTemplates({ loading: false, items: [], error: (err as Error).message });
    }
  };

  const visible = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const items = templates?.items || [];
    const unit = canonicalUnit(line.unit || "");
    return items
      .filter((t) => !f || `${t.code} ${t.name} ${t.category ?? ""}`.toLowerCase().includes(f))
      .sort((a, b) => Number(canonicalUnit(b.unit) === unit) - Number(canonicalUnit(a.unit) === unit) || (a.origin === "default" ? 1 : 0) - (b.origin === "default" ? 1 : 0));
  }, [templates, filter, line.unit]);

  const apply = (t: RateTemplate, replace: boolean) => {
    const copied: BuildupLine[] = t.buildup.map((b) => ({
      ...(b as BuildupLine),
      qty: Number(b.qty) || 0,
      rate: Number(b.rate) || 0,
      source: b.source || `Template ${t.code}${t.version ? ` v${t.version}` : ""}${t.origin === "default" ? " (built-in, unsourced)" : ""}`,
    }));
    onApply({
      buildup: replace ? copied : [...line.buildup, ...copied],
      buildup_template: { id: t.id, code: t.code, version: t.version, applied_at: new Date().toISOString().slice(0, 10) },
    });
    setChosen(null);
    setMode("none");
    setMessage({ tone: "ok", text: `Build-up copied from ${t.code}${t.version ? ` v${t.version}` : ""}. Use "Use build-up" to set the line rate.` });
  };

  const openSave = () => {
    setMode("save");
    setMessage(null);
    setForm({
      code: line.buildup_template?.code && line.buildup_template.version ? line.buildup_template.code : "",
      name: line.description.slice(0, 120),
      category: line.section,
    });
  };

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await saveRateTemplate({
        code: form.code.trim().toUpperCase(),
        name: form.name.trim(),
        category: form.category.trim() || undefined,
        unit: line.unit,
        currency,
        buildup: line.buildup as unknown as Array<Record<string, unknown>>,
        quotation_id: quotationId,
        line_id: line.line_id,
      });
      setMessage({ tone: "ok", text: res.message || `Saved ${res.data?.code} v${res.data?.version}.` });
      setTemplates(null);
      setMode("none");
    } catch (err) {
      const denied = err instanceof ApiError && err.status === 403;
      setMessage({ tone: "error", text: denied ? "Saving to the rate library needs the 'manage assemblies' permission (QS / executive)." : (err as Error).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-1.5">
      <div className="flex flex-wrap gap-3">
        {!readOnly && (
          <button type="button" onClick={openApply} className="text-xs text-signal hover:underline flex items-center gap-1"><BookOpen className="w-3.5 h-3.5" /> Apply template</button>
        )}
        {!readOnly && line.buildup.length > 0 && (
          <button type="button" onClick={openSave} className="text-xs text-signal hover:underline flex items-center gap-1"><Save className="w-3.5 h-3.5" /> Save as template</button>
        )}
      </div>
      {line.buildup_template && (
        <p className="text-[11px] text-slate">Build-up copied from template {line.buildup_template.code}{line.buildup_template.version ? ` v${line.buildup_template.version}` : ""} on {line.buildup_template.applied_at}. Later template changes do not alter this line.</p>
      )}
      {message && <p className={`text-[11px] ${message.tone === "error" ? "text-danger" : "text-success"}`} role={message.tone === "error" ? "alert" : "status"}>{message.text}</p>}

      {mode === "apply" && (
        <div className="border border-signal/40 rounded-sm p-2 space-y-1.5 bg-void">
          <div className="flex items-center gap-1.5">
            <input className={inputCls} autoFocus aria-label="Filter templates" placeholder="Filter templates" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <button type="button" className="p-1 text-slate hover:text-paper" aria-label="Close templates" onClick={() => { setMode("none"); setChosen(null); }}><X className="w-3.5 h-3.5" /></button>
          </div>
          {templates?.loading && <p className="text-[11px] text-slate">Loading templates…</p>}
          {templates?.error && <p className="text-[11px] text-danger" role="alert">{templates.error}</p>}
          <ul className="max-h-56 overflow-y-auto space-y-1">
            {visible.map((t) => {
              const total = buildupTotal({ buildup: t.buildup.map((b) => ({ ...(b as BuildupLine), qty: Number(b.qty) || 0, rate: Number(b.rate) || 0 })) });
              const unitDiffers = !!line.unit && canonicalUnit(t.unit) !== canonicalUnit(line.unit);
              return (
                <li key={`${t.code}:${t.id ?? "default"}`} className="border border-ink-mid rounded-sm p-1.5 text-[11px]">
                  <button type="button" className="w-full text-left" onClick={() => setChosen(chosen?.code === t.code ? null : t)}>
                    <div className="flex justify-between gap-2">
                      <span className="text-paper line-clamp-1">{t.code} · {t.name}</span>
                      <span className="font-mono whitespace-nowrap">{formatMoney(total, t.currency || currency)}/{t.unit || "?"}</span>
                    </div>
                    <div className="text-slate">
                      {t.origin === "default" ? "Built-in recipe (unsourced costs)" : `v${t.version} · ${t.updated_at || ""}`} · {t.buildup.length} resource(s)
                      {unitDiffers ? <span className="text-warning"> · unit {t.unit} ≠ line {line.unit}</span> : null}
                      {t.currency && t.currency !== currency ? <span className="text-warning"> · {t.currency}</span> : null}
                    </div>
                  </button>
                  {chosen?.code === t.code && (
                    <div className="mt-1 border-t border-ink-mid pt-1 space-y-0.5">
                      {t.buildup.map((b, i) => (
                        <div key={i} className="flex justify-between gap-2 text-slate"><span className="truncate">{b.type} · {b.name}</span><span className="font-mono whitespace-nowrap">{Number(b.qty)} {b.unit} × {formatMoney(Number(b.rate), t.currency || currency)}</span></div>
                      ))}
                      {t.notes && <p className="text-warning">{t.notes}</p>}
                      <div className="flex justify-end gap-3 pt-1">
                        {line.buildup.length > 0 && <button type="button" className="text-signal hover:underline" onClick={() => apply(t, false)}>Add to build-up</button>}
                        <button type="button" className="text-signal hover:underline flex items-center gap-1" onClick={() => apply(t, true)}><Check className="w-3 h-3" /> {line.buildup.length > 0 ? "Replace build-up" : "Use template"}</button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {mode === "save" && (
        <div className="border border-signal/40 rounded-sm p-2 space-y-1.5 bg-void">
          <p className="text-[11px] text-slate">Saves this build-up (per 1 {line.unit || "unit"}, {line.buildup.length} resources with their sources) to the rate library. Reusing a code saves a new version; quotations that used an older version keep their copy.</p>
          <label className="text-[10px] text-slate block">Code
            <input className={inputCls} value={form.code} placeholder="e.g. CONC-25-FDN" maxLength={40} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} />
          </label>
          <label className="text-[10px] text-slate block">Name
            <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label className="text-[10px] text-slate block">Category
            <input className={inputCls} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" className="text-xs text-slate hover:text-paper" onClick={() => setMode("none")}>Cancel</button>
            <button type="button" disabled={saving || !form.code.trim() || !form.name.trim()} onClick={save} className="px-2 py-1 text-xs rounded-sm bg-signal text-void font-semibold disabled:opacity-40">{saving ? "Saving…" : "Save template"}</button>
          </div>
        </div>
      )}
    </section>
  );
}

export function SourceBadge({ resource }: { resource: BuildupLine }) {
  if (!resource.source_type) return null;
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-signal" title={resource.source}>
      <Database className="w-3 h-3" /> {sourceLabel(resource.source_type)}
    </span>
  );
}
