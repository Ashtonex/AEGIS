"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X, TrendingDown, Loader2, AlertTriangle, Plus, Save, Trash2, RotateCcw, Info } from "lucide-react";
import {
  CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  computeQuotationCashCurve, computeProjectCashCurve, getSavedCashCurveScenarios,
  saveCashCurveScenario, deleteCashCurveScenario, describeActionError,
} from "@/lib/api";
import { useAuth } from "@/lib/auth/AuthContext";

type Overrides = Record<string, string | number>;
type Scenario = { name: string; overrides: Overrides };

interface CashCurveModalProps {
  source: { kind: "quotation" | "project"; id: string };
  label: string;
  onClose: () => void;
}

const SCENARIO_COLORS = ["var(--dxl-signal)", "#60a5fa", "#f472b6"];
const MAX_SCENARIOS = 3;

type Field = {
  key: string;
  label: string;
  unit?: string;
  type?: "number" | "date" | "profile";
  /** Stored value is a fraction; shown as a percentage. */
  share?: boolean;
  sourceKey?: string;
};

const FIELD_GROUPS: { title: string; fields: Field[] }[] = [
  {
    title: "Contract & cost",
    fields: [
      { key: "contract_value", label: "Contract value (ex-VAT)", unit: "$" },
      { key: "project_cost", label: "Project cost", unit: "$" },
      { key: "preliminaries", label: "Preliminaries", unit: "$" },
      { key: "mobilisation_cost", label: "Mobilisation (day 0)", unit: "$" },
    ],
  },
  {
    title: "Programme",
    fields: [
      { key: "start_date", label: "Start date", type: "date" },
      { key: "duration_weeks", label: "Duration", unit: "wks" },
      { key: "cost_profile", label: "Cost profile", type: "profile" },
    ],
  },
  {
    title: "Client terms",
    fields: [
      { key: "deposit_pct", label: "Deposit / advance", unit: "%" },
      { key: "claim_frequency_days", label: "Claim every", unit: "days" },
      { key: "client_payment_days", label: "Client pays after", unit: "days" },
      { key: "retention_pct", label: "Retention", unit: "%" },
      { key: "retention_release_at_pc_pct", label: "Released at completion", unit: "%" },
      { key: "defects_period_days", label: "Defects period", unit: "days" },
    ],
  },
  {
    title: "Supply chain",
    fields: [
      { key: "supplier_payment_days", label: "Suppliers & plant paid after", unit: "days" },
      { key: "subcontractor_payment_days", label: "Subcontractors paid after", unit: "days" },
      { key: "materials_share", label: "Materials share", unit: "%", share: true, sourceKey: "cost_mix" },
      { key: "labour_share", label: "Labour share", unit: "%", share: true, sourceKey: "cost_mix" },
      { key: "plant_share", label: "Plant share", unit: "%", share: true, sourceKey: "cost_mix" },
      { key: "subcontract_share", label: "Subcontract share", unit: "%", share: true, sourceKey: "cost_mix" },
    ],
  },
  {
    title: "Funding",
    fields: [{ key: "finance_rate_pct", label: "Overdraft rate", unit: "% p.a." }],
  },
];

const PROFILE_LABELS: Record<string, string> = {
  front: "Front-loaded",
  even: "Even",
  s_curve: "S-curve",
  back: "Back-loaded",
};

const PRESETS: { name: string; overrides: Overrides }[] = [
  { name: "20% deposit", overrides: { deposit_pct: 20 } },
  { name: "Client pays in 30 days", overrides: { client_payment_days: 30 } },
  { name: "Client pays in 90 days", overrides: { client_payment_days: 90 } },
];

function errorText(err: unknown, fallback: string) {
  return describeActionError(err, "You don't have permission to do that.", (err as Error)?.message || fallback);
}

function money(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function shortDate(iso?: string | null) {
  if (!iso) return "-";
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "2-digit" });
}

/** Overrides as the API wants them: numbers, shares back to fractions,
 * blanks dropped (blank = use the default). */
function toApiAssumptions(overrides: Overrides): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(overrides)) {
    if (raw === "" || raw === null || raw === undefined) continue;
    const field = FIELD_GROUPS.flatMap((g) => g.fields).find((f) => f.key === key);
    if (field?.type === "date" || field?.type === "profile") {
      out[key] = raw;
      continue;
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) continue;
    out[key] = field?.share ? n / 100 : n;
  }
  return out;
}

function ChartTip({ active, payload, label }: { active?: boolean; payload?: any[]; label?: number }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded border border-ink-mid bg-ink px-3 py-2 text-xs shadow-lg">
      {label !== undefined && <p className="mb-1 font-mono text-[10px] uppercase text-slate">{new Date(label).toLocaleDateString()}</p>}
      {payload.map((p) => (
        <p key={p.name} className="flex items-center gap-2 text-paper">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
          <span className="text-slate-light">{p.name}</span>
          <span className="ml-auto pl-3 tabular-nums">{money(p.value)}</span>
          {p.payload?.period && <span className="font-mono text-[10px] text-slate">{p.payload.period}</span>}
        </p>
      ))}
    </div>
  );
}

export default function CashCurveModal({ source, label, onClose }: CashCurveModalProps) {
  const { permissions, role } = useAuth();
  const canSave = source.kind === "quotation" && (role === "SUPERADMIN" || !!permissions?.has("quotations.update"));

  const [scenarios, setScenarios] = useState<Scenario[]>([
    { name: "As priced", overrides: {} },
    { name: "Client pays in 90 days", overrides: { client_payment_days: 90 } },
  ]);
  const [active, setActive] = useState(0);
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [saved, setSaved] = useState<any[]>([]);
  const [savedAvailable, setSavedAvailable] = useState(true);
  const [saveName, setSaveName] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const requestSeq = useRef(0);

  const compute = useCallback(async (list: Scenario[]) => {
    const seq = ++requestSeq.current;
    setLoading(true);
    try {
      const payload = list.map((s) => ({ name: s.name, assumptions: toApiAssumptions(s.overrides) }));
      const res = source.kind === "quotation"
        ? await computeQuotationCashCurve(source.id, payload)
        : await computeProjectCashCurve(source.id, payload);
      if (seq !== requestSeq.current) return;
      if (res.success) {
        setResult(res.data);
        setErrorMsg("");
      } else {
        setErrorMsg(res.message || "Failed to compute the cash curve.");
      }
    } catch (err) {
      if (seq === requestSeq.current) setErrorMsg(errorText(err, "Failed to compute the cash curve."));
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [source.id, source.kind]);

  // Recompute shortly after the last edit so typing stays smooth.
  useEffect(() => {
    const timer = setTimeout(() => void compute(scenarios), 350);
    return () => clearTimeout(timer);
  }, [scenarios, compute]);

  const loadSaved = useCallback(async () => {
    if (source.kind !== "quotation") return;
    try {
      const res = await getSavedCashCurveScenarios(source.id);
      if (res.success) {
        setSaved(res.data || []);
        setSavedAvailable((res.meta as any)?.scenarios_available !== false);
      }
    } catch {
      setSavedAvailable(false);
    }
  }, [source.id, source.kind]);

  useEffect(() => { void loadSaved(); }, [loadSaved]);

  const defaults = result?.defaults || {};
  const sources: Record<string, string> = result?.default_sources || {};
  const activeScenario = scenarios[Math.min(active, scenarios.length - 1)];
  const activeResult = result?.scenarios?.[Math.min(active, scenarios.length - 1)];

  const setOverride = (key: string, value: string) => {
    setScenarios((prev) => prev.map((s, i) => (i === active ? { ...s, overrides: { ...s.overrides, [key]: value } } : s)));
  };
  const resetActive = () => setScenarios((prev) => prev.map((s, i) => (i === active ? { ...s, overrides: {} } : s)));
  const renameActive = (name: string) => setScenarios((prev) => prev.map((s, i) => (i === active ? { ...s, name } : s)));

  const addScenario = (scenario: Scenario) => {
    if (scenarios.length >= MAX_SCENARIOS) return;
    setScenarios((prev) => [...prev, scenario]);
    setActive(scenarios.length);
  };
  const removeScenario = (index: number) => {
    if (scenarios.length <= 1) return;
    setScenarios((prev) => prev.filter((_, i) => i !== index));
    setActive((a) => (a >= index ? Math.max(0, a - 1) : a));
  };

  const displayValue = (field: Field) => {
    const override = activeScenario.overrides[field.key];
    if (override !== undefined) return String(override);
    const base = defaults[field.key];
    if (base === null || base === undefined) return "";
    return field.share ? String(Math.round(Number(base) * 1000) / 10) : String(base);
  };

  const handleSave = async () => {
    const name = saveName.trim() || activeScenario.name;
    setSaving(true);
    setNotice("");
    try {
      const res = await saveCashCurveScenario(source.id, name, toApiAssumptions(activeScenario.overrides));
      if (res.success) {
        setSaveName("");
        setNotice(`Saved "${name}".`);
        await loadSaved();
      } else {
        setErrorMsg(res.message || "Failed to save scenario.");
      }
    } catch (err) {
      setErrorMsg(errorText(err, "Failed to save scenario."));
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteSaved = async (id: string) => {
    try {
      await deleteCashCurveScenario(id);
      await loadSaved();
    } catch (err) {
      setErrorMsg(errorText(err, "Failed to delete scenario."));
    }
  };

  const loadSavedIntoSlot = (s: any) => {
    const overrides: Overrides = {};
    const shareKeys = new Set(FIELD_GROUPS.flatMap((g) => g.fields).filter((f) => f.share).map((f) => f.key));
    for (const [k, v] of Object.entries(s.assumptions || {})) {
      overrides[k] = shareKeys.has(k) ? Math.round(Number(v) * 1000) / 10 : (v as string | number);
    }
    if (scenarios.length < MAX_SCENARIOS) addScenario({ name: s.name, overrides });
    else setScenarios((prev) => prev.map((sc, i) => (i === active ? { name: s.name, overrides } : sc)));
  };

  const chartSeries = useMemo(() => {
    return (result?.scenarios || []).map((sc: any) => ({
      name: sc.name,
      data: [
        { t: new Date(`${sc.start_date}T00:00:00`).getTime(), cumulative: 0, period: "Start" },
        ...sc.periods.map((p: any) => ({ t: new Date(`${p.end_date}T00:00:00`).getTime(), cumulative: p.cumulative, period: p.label })),
      ],
    }));
  }, [result]);

  const s = activeResult?.summary;
  const comparisonRows: { label: string; render: (sc: any) => React.ReactNode }[] = [
    { label: "Peak funding", render: (sc) => <span className="text-rose-400 font-semibold">{money(sc.summary.peak_funding)}</span> },
    { label: "Peak funding % of contract", render: (sc) => (sc.summary.peak_funding_pct_of_contract ?? "-") + (sc.summary.peak_funding_pct_of_contract != null ? "%" : "") },
    { label: "Peak date", render: (sc) => `${sc.summary.peak_period ?? "-"} · ${shortDate(sc.summary.peak_date)}` },
    { label: "Cash positive", render: (sc) => (sc.summary.never_cash_positive ? <span className="text-rose-400">Never</span> : `${sc.summary.cash_positive_period} · ${shortDate(sc.summary.cash_positive_date)}`) },
    { label: "Retention locked", render: (sc) => money(sc.summary.retention_locked) },
    { label: "Margin", render: (sc) => `${money(sc.summary.margin)} (${sc.summary.margin_pct ?? "-"}%)` },
    { label: "Funding cost", render: (sc) => money(sc.summary.funding_cost) },
    { label: "Margin after funding", render: (sc) => <span className={sc.summary.margin_after_funding < 0 ? "text-rose-400" : "text-emerald-400"}>{money(sc.summary.margin_after_funding)}</span> },
  ];

  return (
    <div className="fixed inset-0 z-[70] flex items-start sm:items-center justify-center bg-black/60 p-2 sm:p-4">
      <div className="w-full max-w-6xl max-h-[95vh] overflow-y-auto bg-ink-light border border-ink-mid rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)]">
        <div className="flex items-center justify-between gap-3 border-b border-ink-mid px-4 sm:px-5 py-4 sticky top-0 z-10 bg-ink-light">
          <div className="min-w-0">
            <h3 className="font-display font-semibold text-white flex items-center gap-2">
              <TrendingDown className="w-4 h-4 text-signal" /> Cash Curve &amp; Funding Requirement
            </h3>
            <p className="text-[11px] text-slate mt-0.5 truncate">{label}</p>
          </div>
          <div className="flex items-center gap-2">
            {loading && <Loader2 className="w-4 h-4 animate-spin text-signal" />}
            <button type="button" onClick={onClose} className="p-1.5 border border-ink-mid rounded-sm text-slate hover:text-white" aria-label="Close">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-4 sm:p-5 space-y-4">
          {errorMsg && (
            <div className="p-3 border border-red-500/20 bg-red-950/20 rounded-sm flex items-start gap-2 text-red-400 text-xs">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}
          {activeResult?.warnings?.length > 0 && (
            <div className="p-3 border border-amber-500/20 bg-amber-500/5 rounded-sm text-amber-400 text-xs space-y-1">
              {activeResult.warnings.map((w: string) => (
                <p key={w} className="flex items-start gap-2"><AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />{w}</p>
              ))}
            </div>
          )}

          {/* Scenario tabs */}
          <div className="flex flex-wrap items-center gap-2">
            {scenarios.map((sc, i) => (
              <div
                key={i}
                className={`flex items-center gap-1 rounded-sm border px-2 py-1 text-xs ${i === active ? "border-signal/60 bg-signal/10 text-white" : "border-ink-mid bg-ink text-slate hover:text-white"}`}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: SCENARIO_COLORS[i] }} />
                <button type="button" onClick={() => setActive(i)} className="font-medium">{sc.name || `Scenario ${i + 1}`}</button>
                {scenarios.length > 1 && (
                  <button type="button" onClick={() => removeScenario(i)} className="ml-1 text-slate hover:text-rose-400" aria-label={`Remove ${sc.name}`}>
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            ))}
            {scenarios.length < MAX_SCENARIOS && (
              <>
                {PRESETS.filter((p) => !scenarios.some((sc) => sc.name === p.name)).map((p) => (
                  <button
                    key={p.name}
                    type="button"
                    onClick={() => addScenario({ name: p.name, overrides: { ...activeScenario.overrides, ...p.overrides } })}
                    className="flex items-center gap-1 rounded-sm border border-dashed border-ink-mid px-2 py-1 text-[11px] text-slate hover:text-white hover:border-signal/50"
                  >
                    <Plus className="w-3 h-3" /> {p.name}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => addScenario({ name: `${activeScenario.name} (copy)`, overrides: { ...activeScenario.overrides } })}
                  className="flex items-center gap-1 rounded-sm border border-dashed border-ink-mid px-2 py-1 text-[11px] text-slate hover:text-white hover:border-signal/50"
                >
                  <Plus className="w-3 h-3" /> Copy current
                </button>
              </>
            )}
          </div>

          {/* KPI tiles for the active scenario */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="border border-ink-mid bg-ink p-3 rounded-sm">
              <p className="text-[10px] font-mono uppercase tracking-wider text-slate">Peak funding needed</p>
              <p className="mt-1 text-lg font-semibold text-rose-400 tabular-nums">{s ? money(s.peak_funding) : "-"}</p>
              <p className="text-[11px] text-slate">{s ? `${s.peak_funding_pct_of_contract ?? 0}% of contract · ${s.peak_period ?? "-"} (${shortDate(s.peak_date)})` : ""}</p>
            </div>
            <div className="border border-ink-mid bg-ink p-3 rounded-sm">
              <p className="text-[10px] font-mono uppercase tracking-wider text-slate">Cash positive</p>
              <p className={`mt-1 text-lg font-semibold tabular-nums ${s?.never_cash_positive ? "text-rose-400" : "text-white"}`}>
                {s ? (s.never_cash_positive ? "Never" : s.cash_positive_period) : "-"}
              </p>
              <p className="text-[11px] text-slate">{s && !s.never_cash_positive ? shortDate(s.cash_positive_date) : s ? "Job never repays its funding" : ""}</p>
            </div>
            <div className="border border-ink-mid bg-ink p-3 rounded-sm">
              <p className="text-[10px] font-mono uppercase tracking-wider text-slate">Retention locked</p>
              <p className="mt-1 text-lg font-semibold text-white tabular-nums">{s ? money(s.retention_locked) : "-"}</p>
              <p className="text-[11px] text-slate">{s ? `${money(s.retention_held_through_defects)} held to ${shortDate(activeResult.final_retention_release_date)}` : ""}</p>
            </div>
            <div className="border border-ink-mid bg-ink p-3 rounded-sm">
              <p className="text-[10px] font-mono uppercase tracking-wider text-slate">Margin after funding</p>
              <p className={`mt-1 text-lg font-semibold tabular-nums ${s && s.margin_after_funding < 0 ? "text-rose-400" : "text-emerald-400"}`}>{s ? money(s.margin_after_funding) : "-"}</p>
              <p className="text-[11px] text-slate">{s ? `${money(s.margin)} margin less ${money(s.funding_cost)} funding cost` : ""}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)] gap-4">
            {/* Assumptions for the active scenario */}
            <div className="border border-ink-mid bg-ink rounded-sm p-3 space-y-3 order-2 lg:order-1">
              <div className="flex items-center justify-between gap-2">
                <input
                  value={activeScenario.name}
                  onChange={(e) => renameActive(e.target.value.slice(0, 80))}
                  className="min-w-0 flex-1 bg-transparent border-b border-ink-mid text-sm font-semibold text-white focus:outline-none focus:border-signal"
                  aria-label="Scenario name"
                />
                <button type="button" onClick={resetActive} className="flex items-center gap-1 text-[11px] text-slate hover:text-white" title="Back to the defaults">
                  <RotateCcw className="w-3 h-3" /> Defaults
                </button>
              </div>
              {FIELD_GROUPS.map((group) => (
                <div key={group.title}>
                  <p className="text-[10px] font-mono uppercase tracking-wider text-slate mb-1.5">{group.title}</p>
                  <div className="space-y-1.5">
                    {group.fields.map((field) => {
                      const overridden = activeScenario.overrides[field.key] !== undefined && activeScenario.overrides[field.key] !== "";
                      const hint = sources[field.sourceKey || field.key];
                      return (
                        <label key={field.key} className="flex items-center gap-2 text-xs">
                          <span className="flex-1 text-slate-light flex items-center gap-1 min-w-0">
                            <span className="truncate">{field.label}</span>
                            {hint && <span title={hint} className="shrink-0 text-slate"><Info className="w-3 h-3" /></span>}
                          </span>
                          {field.type === "profile" ? (
                            <select
                              value={displayValue(field) || "s_curve"}
                              onChange={(e) => setOverride(field.key, e.target.value)}
                              className={`w-32 bg-ink-light border rounded-sm px-1.5 py-1 text-xs text-white ${overridden ? "border-signal/60" : "border-ink-mid"}`}
                            >
                              {Object.entries(PROFILE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                            </select>
                          ) : (
                            <span className="flex items-center gap-1">
                              <input
                                type={field.type === "date" ? "date" : "number"}
                                inputMode={field.type === "date" ? undefined : "decimal"}
                                value={displayValue(field)}
                                onChange={(e) => setOverride(field.key, e.target.value)}
                                className={`${field.type === "date" ? "w-32" : "w-24"} bg-ink-light border rounded-sm px-1.5 py-1 text-right text-xs text-white tabular-nums ${overridden ? "border-signal/60" : "border-ink-mid"}`}
                              />
                              <span className="w-8 text-[10px] text-slate">{field.unit !== "$" ? field.unit : ""}</span>
                            </span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
              <p className="text-[10px] text-slate leading-relaxed">
                Gold borders are your changes; hover <Info className="inline w-3 h-3" /> for where each default comes from. VAT is excluded - it passes through.
              </p>
            </div>

            <div className="space-y-4 order-1 lg:order-2 min-w-0">
              {/* Cumulative curve */}
              <div className="border border-ink-mid bg-ink rounded-sm p-3">
                <p className="text-[10px] font-mono uppercase tracking-wider text-slate mb-2">Cumulative net cash</p>
                <div className="h-64 sm:h-72">
                  {chartSeries.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--dxl-ink-mid)" vertical={false} />
                        <XAxis
                          dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]}
                          tickFormatter={(t) => new Date(t).toLocaleDateString(undefined, { month: "short", year: "2-digit" })}
                          tick={{ fill: "var(--dxl-slate-light)", fontSize: 10 }} axisLine={false} tickLine={false} minTickGap={24}
                        />
                        <YAxis
                          tickFormatter={(v) => `${v < 0 ? "-" : ""}$${Math.abs(v) >= 1000 ? `${Math.round(Math.abs(v) / 1000)}k` : Math.abs(v)}`}
                          tick={{ fill: "var(--dxl-slate-light)", fontSize: 10 }} axisLine={false} tickLine={false} width={52}
                        />
                        <Tooltip content={<ChartTip />} />
                        <Legend wrapperStyle={{ fontSize: 11, color: "var(--dxl-slate-light)" }} />
                        <ReferenceLine y={0} stroke="var(--dxl-slate)" />
                        {chartSeries.map((series: any, i: number) => (
                          <Line
                            key={`${i}-${series.name}`}
                            data={series.data}
                            dataKey="cumulative"
                            name={series.name}
                            stroke={SCENARIO_COLORS[i]}
                            strokeWidth={i === active ? 2.5 : 1.5}
                            strokeOpacity={i === active ? 1 : 0.7}
                            dot={false}
                            type="stepAfter"
                            isAnimationActive={false}
                          />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-full flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-signal" /></div>
                  )}
                </div>
                <p className="mt-2 text-[11px] text-slate">
                  Below zero is cash the company must fund from reserves or an overdraft. The lowest point is the peak funding requirement.
                </p>
              </div>

              {/* Side-by-side comparison */}
              {result?.scenarios?.length > 0 && (
                <div className="border border-ink-mid bg-ink rounded-sm p-3 overflow-x-auto">
                  <table className="w-full min-w-[420px] text-xs">
                    <thead>
                      <tr className="text-slate font-mono text-[10px] uppercase">
                        <th className="pb-2 text-left font-normal" />
                        {result.scenarios.map((sc: any, i: number) => (
                          <th key={i} className="pb-2 text-right font-normal">
                            <span className="inline-flex items-center gap-1.5">
                              <span className="h-2 w-2 rounded-full" style={{ background: SCENARIO_COLORS[i] }} />{sc.name}
                            </span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {comparisonRows.map((row) => (
                        <tr key={row.label} className="border-t border-ink-mid/40">
                          <td className="py-1.5 text-slate-light">{row.label}</td>
                          {result.scenarios.map((sc: any, i: number) => (
                            <td key={i} className="py-1.5 text-right text-white tabular-nums">{row.render(sc)}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Saved scenarios */}
              {source.kind === "quotation" && (
                <div className="border border-ink-mid bg-ink rounded-sm p-3 space-y-2">
                  <p className="text-[10px] font-mono uppercase tracking-wider text-slate">Saved scenarios</p>
                  {!savedAvailable ? (
                    <p className="text-[11px] text-slate">Saving scenarios is not switched on yet (database migration pending). Curves still compute.</p>
                  ) : (
                    <>
                      {canSave && (
                        <div className="flex flex-col sm:flex-row gap-2">
                          <input
                            value={saveName}
                            onChange={(e) => setSaveName(e.target.value.slice(0, 80))}
                            placeholder={`Save "${activeScenario.name}" as...`}
                            className="flex-1 bg-ink-light border border-ink-mid rounded-sm px-2 py-1.5 text-xs text-white placeholder:text-slate"
                          />
                          <button
                            type="button"
                            onClick={() => void handleSave()}
                            disabled={saving}
                            className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-signal text-ink rounded-sm hover:bg-signal-hover disabled:opacity-50"
                          >
                            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save scenario
                          </button>
                        </div>
                      )}
                      {notice && <p className="text-[11px] text-emerald-400">{notice}</p>}
                      {saved.length === 0 ? (
                        <p className="text-[11px] text-slate">None saved for this quotation yet.</p>
                      ) : (
                        <ul className="space-y-1">
                          {saved.map((sv) => (
                            <li key={sv.id} className="flex flex-wrap items-center gap-2 text-xs border-t border-ink-mid/40 pt-1.5">
                              <button type="button" onClick={() => loadSavedIntoSlot(sv)} className="font-medium text-white hover:text-signal" title="Load into the comparison">
                                {sv.name}
                              </button>
                              <span className="text-slate">peak {money(sv.summary?.peak_funding)}</span>
                              <span className="text-slate">· {sv.created_by_name || "-"} · {sv.created_at ? new Date(sv.created_at).toLocaleDateString() : ""}</span>
                              {canSave && (
                                <button type="button" onClick={() => void handleDeleteSaved(sv.id)} className="ml-auto text-slate hover:text-rose-400" aria-label={`Delete ${sv.name}`}>
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
