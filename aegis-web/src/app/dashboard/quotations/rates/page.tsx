"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  Calculator,
  CheckCircle2,
  Copy,
  FileText,
  Loader2,
  RefreshCw,
  Save,
  Scale,
  Search,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import {
  benchmarkRate,
  createRateBenchmark,
  deleteRateBenchmark,
  describeActionError,
  listRateBenchmarks,
} from "@/lib/api";
import { useAuth } from "@/lib/auth/AuthContext";

type RateBenchmark = {
  id: string;
  item_code: string;
  category?: string;
  description?: string;
  unit?: string;
  target_rate?: number | string;
  supplier_rate?: number | string;
  subcontractor_rate?: number | string;
  last_po_rate?: number | string;
  currency?: string;
  escalation_pct?: number | string;
};

type RateInput = {
  item_code: string;
  description: string;
  category: string;
  unit: string;
  currency: string;
  task_context: string;
  material_rate: number;
  labour_rate: number;
  equipment_rate: number;
  subcontractor_rate: number;
  prelim_rate: number;
  waste_pct: number;
  overhead_pct: number;
  profit_pct: number;
  escalation_pct: number;
  last_po_rate: number;
};

const blankRate: RateInput = {
  item_code: "TASK-CUSTOM-RATE",
  description: "Custom task rate",
  category: "Task Rate",
  unit: "unit",
  currency: "USD",
  task_context: "",
  material_rate: 0,
  labour_rate: 0,
  equipment_rate: 0,
  subcontractor_rate: 0,
  prelim_rate: 0,
  waste_pct: 2.5,
  overhead_pct: 10,
  profit_pct: 15,
  escalation_pct: 0,
  last_po_rate: 0,
};

const examples: RateInput[] = [
  {
    ...blankRate,
    item_code: "TASK-CONC-SLAB-M2",
    description: "Concrete slab placing rate",
    category: "Concrete",
    unit: "m2",
    task_context: "Site task - measured concrete works",
    material_rate: 18,
    labour_rate: 4.5,
    equipment_rate: 2.25,
    prelim_rate: 1.5,
    waste_pct: 3,
    overhead_pct: 8,
    profit_pct: 14,
    last_po_rate: 29.5,
  },
  {
    ...blankRate,
    item_code: "TASK-PLASTER-M2",
    description: "Internal plastering task rate",
    category: "Finishes",
    unit: "m2",
    task_context: "CRM custom task - quotation adjustment",
    material_rate: 5.75,
    labour_rate: 7.25,
    equipment_rate: 0.5,
    waste_pct: 4,
    overhead_pct: 10,
    profit_pct: 16,
    last_po_rate: 16,
  },
];

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function money(value: unknown, currency = "USD"): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(toNumber(value));
  } catch {
    return `${currency || "USD"} ${toNumber(value).toFixed(2)}`;
  }
}

function pct(value: unknown): string {
  return `${toNumber(value).toFixed(1)}%`;
}

function buildRate(input: RateInput) {
  const directRate =
    input.material_rate +
    input.labour_rate +
    input.equipment_rate +
    input.subcontractor_rate +
    input.prelim_rate;
  const wasteAllowance = directRate * (input.waste_pct / 100);
  const costBeforeMarkup = directRate + wasteAllowance;
  const overheadAllowance = costBeforeMarkup * (input.overhead_pct / 100);
  const escalationAllowance = costBeforeMarkup * (input.escalation_pct / 100);
  const profitAllowance = (costBeforeMarkup + overheadAllowance + escalationAllowance) * (input.profit_pct / 100);
  const targetRate = costBeforeMarkup + overheadAllowance + escalationAllowance + profitAllowance;

  return {
    directRate,
    wasteAllowance,
    costBeforeMarkup,
    overheadAllowance,
    escalationAllowance,
    profitAllowance,
    targetRate,
  };
}

function rateHealth(rate: number, lastPoRate: number) {
  if (lastPoRate <= 0) return { label: "No PO baseline", className: "border-slate-500/30 text-slate-light bg-slate-900/20" };
  const variance = ((rate - lastPoRate) / lastPoRate) * 100;
  if (variance > 15) return { label: `High by ${variance.toFixed(1)}%`, className: "border-red-500/35 text-red-300 bg-red-950/20" };
  if (variance < -15) return { label: `Low by ${Math.abs(variance).toFixed(1)}%`, className: "border-amber-500/35 text-amber-300 bg-amber-950/20" };
  return { label: `Within ${Math.abs(variance).toFixed(1)}%`, className: "border-emerald-500/35 text-emerald-300 bg-emerald-950/20" };
}

export default function RateBuildUpPage() {
  const { session } = useAuth();
  const [rate, setRate] = useState<RateInput>(blankRate);
  const [benchmarks, setBenchmarks] = useState<RateBenchmark[]>([]);
  const [benchmarkResult, setBenchmarkResult] = useState<any>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const calculated = useMemo(() => buildRate(rate), [rate]);
  const health = useMemo(() => rateHealth(calculated.targetRate, rate.last_po_rate), [calculated.targetRate, rate.last_po_rate]);

  const filteredBenchmarks = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return benchmarks;
    return benchmarks.filter((item) =>
      [item.item_code, item.description, item.category, item.unit]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query)),
    );
  }, [benchmarks, search]);

  const loadBenchmarks = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    setErrorMsg("");
    try {
      const response = await listRateBenchmarks();
      if (response.success && Array.isArray(response.data)) {
        setBenchmarks(response.data as RateBenchmark[]);
      } else {
        setErrorMsg(response.message || "Company standard rates could not be loaded.");
      }
    } catch (error: any) {
      setErrorMsg(error?.message || "Company standard rates could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    void loadBenchmarks();
  }, [loadBenchmarks]);

  const updateRate = (field: keyof RateInput, value: string | number) => {
    setRate((current) => ({
      ...current,
      [field]: typeof current[field] === "number" ? toNumber(value) : value,
    }));
  };

  const applyBenchmark = (item: RateBenchmark) => {
    setBenchmarkResult(null);
    setSuccessMsg("");
    setRate((current) => ({
      ...current,
      item_code: item.item_code || current.item_code,
      description: item.description || current.description,
      category: item.category || current.category,
      unit: item.unit || current.unit,
      currency: item.currency || current.currency,
      material_rate: toNumber(item.supplier_rate),
      subcontractor_rate: toNumber(item.subcontractor_rate),
      escalation_pct: toNumber(item.escalation_pct),
      last_po_rate: toNumber(item.last_po_rate),
      profit_pct: current.profit_pct,
      overhead_pct: current.overhead_pct,
    }));
  };

  const applyExample = (example: RateInput) => {
    setBenchmarkResult(null);
    setSuccessMsg("");
    setRate(example);
  };

  const copyRate = async () => {
    const payload = {
      item_code: rate.item_code,
      description: rate.description,
      unit: rate.unit,
      target_rate: Number(calculated.targetRate.toFixed(2)),
      material_rate: rate.material_rate,
      labour_rate: rate.labour_rate,
      equipment_rate: rate.equipment_rate,
      subcontractor_rate: rate.subcontractor_rate,
      prelim_rate: rate.prelim_rate,
      waste_pct: rate.waste_pct,
      overhead_pct: rate.overhead_pct,
      profit_pct: rate.profit_pct,
      escalation_pct: rate.escalation_pct,
      task_context: rate.task_context,
    };
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    setSuccessMsg("Rate build-up copied.");
  };

  const runBenchmark = async () => {
    if (!rate.item_code.trim()) {
      setErrorMsg("Item code is required before checking a rate.");
      return;
    }
    setChecking(true);
    setErrorMsg("");
    setBenchmarkResult(null);
    try {
      const response = await benchmarkRate(rate.item_code, Number(calculated.targetRate.toFixed(2)));
      if (response.success) {
        setBenchmarkResult(response.data);
      } else {
        setErrorMsg(response.message || "Rate check could not be completed.");
      }
    } catch (error: any) {
      setErrorMsg(error?.message || "Rate check could not be completed.");
    } finally {
      setChecking(false);
    }
  };

  const saveCompanyStandard = async () => {
    if (!rate.item_code.trim() || !rate.description.trim()) {
      setErrorMsg("Item code and description are required before saving a company standard.");
      return;
    }
    setSaving(true);
    setErrorMsg("");
    setSuccessMsg("");
    try {
      const response = await createRateBenchmark({
        item_code: rate.item_code.trim().toUpperCase(),
        category: rate.category || "Task Rate",
        description: rate.description,
        unit: rate.unit || "unit",
        target_rate: Number(calculated.targetRate.toFixed(2)),
        supplier_rate: Number((rate.material_rate + rate.equipment_rate + rate.prelim_rate).toFixed(2)),
        subcontractor_rate: Number(rate.subcontractor_rate.toFixed(2)),
        last_po_rate: Number(rate.last_po_rate.toFixed(2)),
        currency: rate.currency || "USD",
        escalation_pct: Number(rate.escalation_pct.toFixed(2)),
      });
      if (response.success) {
        setSuccessMsg("Company standard rate saved. New quotation checks will use this benchmark.");
        await loadBenchmarks();
      } else {
        setErrorMsg(response.message || "Company standard rate could not be saved.");
      }
    } catch (error: any) {
      setErrorMsg(describeActionError(error, "You do not have permission to set company standard rates.", "Company standard rate could not be saved."));
    } finally {
      setSaving(false);
    }
  };

  const removeBenchmark = async (id: string) => {
    setDeletingId(id);
    setErrorMsg("");
    try {
      const response = await deleteRateBenchmark(id);
      if (response.success) {
        setSuccessMsg("Company standard rate removed.");
        await loadBenchmarks();
      } else {
        setErrorMsg(response.message || "Company standard rate could not be removed.");
      }
    } catch (error: any) {
      setErrorMsg(describeActionError(error, "You do not have permission to remove company standard rates.", "Company standard rate could not be removed."));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-8 p-8 text-paper">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-3">
          <Link href="/dashboard/quotations" className="inline-flex items-center gap-2 font-mono text-xs uppercase text-slate transition-colors hover:text-white">
            <ArrowLeft className="h-3.5 w-3.5" />
            Quotations
          </Link>
          <div>
            <h1 className="flex items-center gap-3 font-display text-2xl font-bold tracking-tight text-white">
              <Scale className="h-7 w-7 text-signal" />
              Rate Build-Up
            </h1>
            <p className="mt-1 max-w-3xl text-sm text-slate">
              Build task rates from their cost parts, test them against company intelligence, and publish owner-approved standards across quotations.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void loadBenchmarks()}
            className="inline-flex items-center gap-2 border border-ink-mid bg-ink px-3.5 py-2 text-xs font-semibold text-slate transition-all hover:border-signal/50 hover:text-white"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin text-signal" : ""}`} />
            Refresh
          </button>
          <Link
            href="/dashboard/crm/tasks"
            className="inline-flex items-center gap-2 border border-ink-mid bg-ink px-3.5 py-2 text-xs font-semibold text-paper transition-all hover:border-signal/50"
          >
            <FileText className="h-3.5 w-3.5 text-signal" />
            CRM Tasks
          </Link>
        </div>
      </div>

      {errorMsg && (
        <div className="flex items-center gap-3 border border-red-500/25 bg-red-950/20 p-4 text-sm text-red-300">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}
      {successMsg && (
        <div className="flex items-center gap-3 border border-emerald-500/25 bg-emerald-950/20 p-4 text-sm text-emerald-300">
          <CheckCircle2 className="h-5 w-5 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-4">
        <MetricCard label="Built Rate" value={money(calculated.targetRate, rate.currency)} note={`per ${rate.unit || "unit"}`} />
        <MetricCard label="Direct Cost" value={money(calculated.directRate, rate.currency)} note="before waste and markup" />
        <MetricCard label="Markup Cover" value={money(calculated.overheadAllowance + calculated.profitAllowance, rate.currency)} note={`${pct(rate.overhead_pct)} overhead, ${pct(rate.profit_pct)} profit`} />
        <div className={`border p-5 ${health.className}`}>
          <p className="font-mono text-xs uppercase tracking-widest">PO Check</p>
          <p className="mt-2 font-display text-xl font-bold text-white">{health.label}</p>
          <p className="mt-1 text-[10px] font-mono uppercase">Last PO {money(rate.last_po_rate, rate.currency)}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-3">
        <section className="space-y-6 xl:col-span-2">
          <div className="border border-ink-mid bg-ink-light p-6 shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)]">
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-display text-lg font-semibold text-white">Task Rate Builder</h2>
                <p className="text-xs text-slate">Use measured cost inputs. The final rate is the figure saved as the company benchmark.</p>
              </div>
              <div className="flex gap-2">
                {examples.map((example) => (
                  <button
                    key={example.item_code}
                    type="button"
                    onClick={() => applyExample(example)}
                    className="border border-ink-mid bg-ink px-3 py-1.5 font-mono text-[10px] uppercase text-slate transition-colors hover:border-signal/50 hover:text-white"
                  >
                    {example.category}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
              <Field label="Item Code" value={rate.item_code} onChange={(value) => updateRate("item_code", value.toUpperCase())} />
              <Field label="Description" value={rate.description} onChange={(value) => updateRate("description", value)} className="md:col-span-2" />
              <Field label="Unit" value={rate.unit} onChange={(value) => updateRate("unit", value)} />
              <Field label="Category" value={rate.category} onChange={(value) => updateRate("category", value)} />
              <Field label="Task Context" value={rate.task_context} onChange={(value) => updateRate("task_context", value)} className="md:col-span-2" />
              <Field label="Currency" value={rate.currency} onChange={(value) => updateRate("currency", value.toUpperCase())} />
            </div>

            <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-5">
              <NumberField label="Material" value={rate.material_rate} onChange={(value) => updateRate("material_rate", value)} />
              <NumberField label="Labour" value={rate.labour_rate} onChange={(value) => updateRate("labour_rate", value)} />
              <NumberField label="Plant / Equipment" value={rate.equipment_rate} onChange={(value) => updateRate("equipment_rate", value)} />
              <NumberField label="Subcontractor" value={rate.subcontractor_rate} onChange={(value) => updateRate("subcontractor_rate", value)} />
              <NumberField label="Prelim" value={rate.prelim_rate} onChange={(value) => updateRate("prelim_rate", value)} />
              <NumberField label="Waste %" value={rate.waste_pct} onChange={(value) => updateRate("waste_pct", value)} />
              <NumberField label="Overhead %" value={rate.overhead_pct} onChange={(value) => updateRate("overhead_pct", value)} />
              <NumberField label="Profit %" value={rate.profit_pct} onChange={(value) => updateRate("profit_pct", value)} />
              <NumberField label="Escalation %" value={rate.escalation_pct} onChange={(value) => updateRate("escalation_pct", value)} />
              <NumberField label="Last PO Rate" value={rate.last_po_rate} onChange={(value) => updateRate("last_po_rate", value)} />
            </div>

            <div className="mt-6 grid grid-cols-1 gap-3 border border-ink-mid bg-ink p-4 md:grid-cols-4">
              <BreakdownLine label="Direct rate" value={calculated.directRate} currency={rate.currency} />
              <BreakdownLine label="Waste allowance" value={calculated.wasteAllowance} currency={rate.currency} />
              <BreakdownLine label="Overhead" value={calculated.overheadAllowance} currency={rate.currency} />
              <BreakdownLine label="Profit" value={calculated.profitAllowance} currency={rate.currency} />
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void runBenchmark()}
                disabled={checking}
                className="inline-flex items-center gap-2 bg-signal px-4 py-2 text-xs font-semibold text-ink transition-colors hover:bg-signal-hover disabled:opacity-40"
              >
                {checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Calculator className="h-3.5 w-3.5" />}
                Check Rate
              </button>
              <button
                type="button"
                onClick={() => void saveCompanyStandard()}
                disabled={saving}
                className="inline-flex items-center gap-2 border border-emerald-500/40 bg-emerald-950/20 px-4 py-2 text-xs font-semibold text-emerald-300 transition-colors hover:bg-emerald-950/35 disabled:opacity-40"
              >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                Save Company Standard
              </button>
              <button
                type="button"
                onClick={() => void copyRate()}
                className="inline-flex items-center gap-2 border border-ink-mid bg-ink px-4 py-2 text-xs font-semibold text-paper transition-colors hover:border-signal/50"
              >
                <Copy className="h-3.5 w-3.5 text-signal" />
                Copy Build-Up
              </button>
            </div>

            {benchmarkResult && (
              <div className={`mt-6 border p-4 ${benchmarkResult.is_outlier ? "border-red-500/40 bg-red-950/20" : "border-emerald-500/40 bg-emerald-950/20"}`}>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="font-mono text-xs font-bold uppercase text-white">{benchmarkResult.status || "Benchmark complete"}</p>
                  <p className="font-mono text-xs text-slate-light">Variance vs PO: {pct(benchmarkResult.variance_vs_last_po_pct)}</p>
                </div>
                <p className="mt-2 text-xs text-paper">{benchmarkResult.recommendation || "Rate intelligence check completed."}</p>
              </div>
            )}
          </div>
        </section>

        <aside className="space-y-6">
          <div className="border border-ink-mid bg-ink-light p-6 shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)]">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center border border-signal/20 bg-signal/10 text-signal">
                <Save className="h-5 w-5" />
              </div>
              <div>
                <h2 className="font-display text-lg font-semibold text-white">Owner Standard Control</h2>
                <p className="mt-1 text-xs text-slate">
                  Saved rates become organisation benchmarks for the same item code. Quotation checks and outlier warnings read from this library before falling back to seeded defaults.
                </p>
              </div>
            </div>
          </div>

          <div className="border border-ink-mid bg-ink-light p-6 shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)]">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-lg font-semibold text-white">Company Standards</h2>
                <p className="text-xs text-slate">{benchmarks.length} custom benchmark rates</p>
              </div>
              <Scale className="h-5 w-5 text-signal" />
            </div>
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search rates..."
                className="h-10 w-full border border-ink-mid bg-ink pl-9 pr-3 text-xs text-paper outline-none transition-colors placeholder:text-slate focus:border-signal/50"
              />
            </div>
            {loading ? (
              <div className="flex items-center justify-center py-10 text-slate">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : filteredBenchmarks.length === 0 ? (
              <p className="border border-dashed border-ink-mid p-4 text-sm text-slate">No company standard rates match this view.</p>
            ) : (
              <div className="max-h-[560px] space-y-2 overflow-y-auto pr-1">
                {filteredBenchmarks.map((item) => (
                  <div key={item.id} className="border border-ink-mid bg-ink p-3 text-xs">
                    <div className="flex items-start justify-between gap-3">
                      <button type="button" onClick={() => applyBenchmark(item)} className="min-w-0 text-left">
                        <p className="truncate font-mono font-semibold text-white">{item.item_code}</p>
                        <p className="mt-1 line-clamp-2 text-slate-light">{item.description || "No description"}</p>
                      </button>
                      <button
                        type="button"
                        onClick={() => void removeBenchmark(item.id)}
                        disabled={deletingId === item.id}
                        className="shrink-0 text-red-400 transition-colors hover:text-red-300 disabled:opacity-40"
                        title="Remove company standard"
                      >
                        {deletingId === item.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 border-t border-ink-mid pt-3 font-mono text-[10px] uppercase text-slate-light">
                      <span>Target {money(item.target_rate, item.currency || "USD")}</span>
                      <span>Unit {item.unit || "unit"}</span>
                      <span>Supplier {money(item.supplier_rate, item.currency || "USD")}</span>
                      <span>Sub {money(item.subcontractor_rate, item.currency || "USD")}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function MetricCard({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="border border-ink-mid bg-ink-light p-5 shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)]">
      <p className="font-mono text-xs uppercase tracking-widest text-slate">{label}</p>
      <p className="mt-2 font-display text-xl font-bold text-white">{value}</p>
      <p className="mt-1 text-[10px] font-mono uppercase text-slate-light">{note}</p>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  className = "",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <label className={className}>
      <span className="font-mono text-[10px] uppercase tracking-widest text-slate">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 h-10 w-full border border-ink-mid bg-ink px-3 text-xs text-paper outline-none transition-colors focus:border-signal/50"
      />
    </label>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label>
      <span className="font-mono text-[10px] uppercase tracking-widest text-slate">{label}</span>
      <input
        type="number"
        step="0.01"
        value={value}
        onChange={(event) => onChange(toNumber(event.target.value))}
        className="mt-2 h-10 w-full border border-ink-mid bg-ink px-3 text-xs text-paper outline-none transition-colors focus:border-signal/50"
      />
    </label>
  );
}

function BreakdownLine({ label, value, currency }: { label: string; value: number; currency: string }) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-widest text-slate">{label}</p>
      <p className="mt-1 font-mono text-sm font-semibold text-white">{money(value, currency)}</p>
    </div>
  );
}
