"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  Calculator,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  FileText,
  Layers,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Scale,
  Search,
  ShieldCheck,
  Sparkles,
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
  source_type?: string;
  source_id?: string | null;
  rate_group?: string | null;
  supply_mode?: string;
  material_contribution_pct?: number | string;
  material_reference_rate?: number | string;
  materials_breakdown?: unknown;
};

export type MaterialAggregate = {
  id: string;
  name: string;
  unit: string;
  constant: number;
  unit_cost: number;
};

export type AggregatePreset = {
  label: string;
  category: string;
  unit: string;
  description: string;
  aggregates: Array<{
    name: string;
    unit: string;
    constant: number;
    unit_cost: number;
  }>;
};

export const AGGREGATE_PRESETS: AggregatePreset[] = [
  {
    label: "Concrete Grade 20 (1:2:4)",
    category: "Concrete",
    unit: "m3",
    description: "Standard structural concrete mix (per m3)",
    aggregates: [
      { name: "Portland Cement 42.5N (50kg bags)", unit: "bags", constant: 7.14, unit_cost: 12.50 },
      { name: "Washed River Sand", unit: "m3", constant: 0.714, unit_cost: 22.00 },
      { name: "19mm Crushed Granite Stone", unit: "m3", constant: 0.882, unit_cost: 28.00 },
      { name: "Clean Batching Water", unit: "m3", constant: 0.18, unit_cost: 3.00 },
    ],
  },
  {
    label: "Concrete Grade 25",
    category: "Concrete",
    unit: "m3",
    description: "Reinforced structural concrete mix (per m3)",
    aggregates: [
      { name: "Portland Cement 42.5N (50kg bags)", unit: "bags", constant: 6.00, unit_cost: 12.50 },
      { name: "Concrete Sand", unit: "m3", constant: 0.714, unit_cost: 22.00 },
      { name: "19mm Crushed Granite Stone", unit: "m3", constant: 0.882, unit_cost: 28.00 },
      { name: "Clean Batching Water", unit: "m3", constant: 0.18, unit_cost: 3.00 },
    ],
  },
  {
    label: "Concrete Grade 30",
    category: "Concrete",
    unit: "m3",
    description: "High-strength structural concrete mix (per m3)",
    aggregates: [
      { name: "Portland Cement 42.5N (50kg bags)", unit: "bags", constant: 8.87, unit_cost: 12.50 },
      { name: "Washed River Sand", unit: "m3", constant: 0.704, unit_cost: 22.00 },
      { name: "19mm Crushed Granite Stone", unit: "m3", constant: 0.903, unit_cost: 28.00 },
      { name: "Clean Batching Water", unit: "m3", constant: 0.18, unit_cost: 3.00 },
    ],
  },
  {
    label: "Double Brickwork 230mm",
    category: "Masonry",
    unit: "m2",
    description: "Double skin brickwork in 1:4 mortar (per m2)",
    aggregates: [
      { name: "Common Clay Bricks", unit: "pcs", constant: 110, unit_cost: 0.18 },
      { name: "Portland Cement (50kg bags)", unit: "bags", constant: 0.42, unit_cost: 12.50 },
      { name: "Building / Pit Sand", unit: "m3", constant: 0.08, unit_cost: 20.00 },
      { name: "Brickforce Reinforcement 230mm", unit: "m", constant: 2.10, unit_cost: 0.85 },
    ],
  },
  {
    label: "Internal Plaster 12mm",
    category: "Finishes",
    unit: "m2",
    description: "12mm cement-sand plaster in 1:4 mix (per m2)",
    aggregates: [
      { name: "Portland Cement (50kg bags)", unit: "bags", constant: 0.12, unit_cost: 12.50 },
      { name: "Plaster Pit Sand", unit: "m3", constant: 0.02, unit_cost: 24.00 },
    ],
  },
  {
    label: "Floor Screed 40mm",
    category: "Finishes",
    unit: "m2",
    description: "40mm monolithic screed in 1:3 mix (per m2)",
    aggregates: [
      { name: "Portland Cement (50kg bags)", unit: "bags", constant: 0.42, unit_cost: 12.50 },
      { name: "Washed River Sand", unit: "m3", constant: 0.055, unit_cost: 22.00 },
    ],
  },
];

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
  source_type: "global" | "project" | "tender" | "opportunity" | "task" | "custom";
  source_id: string;
  rate_group: string;
  supply_mode: "full_supply" | "labour_only_client_materials";
  material_contribution_pct: number;
  aggregates?: MaterialAggregate[];
};

const blankRate: RateInput = {
  item_code: "TASK-CONC-CUSTOM-M3",
  description: "Custom task rate",
  category: "Concrete",
  unit: "m3",
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
  source_type: "global",
  source_id: "",
  rate_group: "Company Standard",
  supply_mode: "full_supply",
  material_contribution_pct: 5,
  aggregates: [],
};

const examples: RateInput[] = [
  {
    ...blankRate,
    item_code: "TASK-CONC-SLAB-M3",
    description: "Concrete Grade 20 in slab casting",
    category: "Concrete",
    unit: "m3",
    task_context: "Site task - measured structural concrete works",
    material_rate: 130.20,
    labour_rate: 22.50,
    equipment_rate: 15.00,
    prelim_rate: 4.50,
    waste_pct: 3,
    overhead_pct: 8,
    profit_pct: 14,
    last_po_rate: 195.0,
    rate_group: "Concrete Works",
    aggregates: [
      { id: "agg-ex-1", name: "Portland Cement 42.5N (50kg bags)", unit: "bags", constant: 7.14, unit_cost: 12.50 },
      { id: "agg-ex-2", name: "Washed River Sand", unit: "m3", constant: 0.714, unit_cost: 22.00 },
      { id: "agg-ex-3", name: "19mm Crushed Granite Stone", unit: "m3", constant: 0.882, unit_cost: 28.00 },
      { id: "agg-ex-4", name: "Clean Batching Water", unit: "m3", constant: 0.18, unit_cost: 3.00 },
    ],
  },
  {
    ...blankRate,
    item_code: "TASK-PLASTER-M2",
    description: "Internal plastering 12mm task rate",
    category: "Finishes",
    unit: "m2",
    task_context: "CRM custom task - quotation adjustment",
    material_rate: 1.98,
    labour_rate: 7.25,
    equipment_rate: 0.5,
    waste_pct: 4,
    overhead_pct: 10,
    profit_pct: 16,
    last_po_rate: 12.50,
    supply_mode: "labour_only_client_materials",
    material_contribution_pct: 5,
    rate_group: "Finishes Labour",
    aggregates: [
      { id: "agg-ex-5", name: "Portland Cement (50kg bags)", unit: "bags", constant: 0.12, unit_cost: 12.50 },
      { id: "agg-ex-6", name: "Plaster Pit Sand", unit: "m3", constant: 0.02, unit_cost: 24.00 },
    ],
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
  const materialReferenceRate = input.material_rate;
  const materialContributionRate =
    input.supply_mode === "labour_only_client_materials"
      ? materialReferenceRate * (input.material_contribution_pct / 100)
      : 0;
  const billableMaterialRate =
    input.supply_mode === "labour_only_client_materials"
      ? materialContributionRate
      : materialReferenceRate;
  const directRate =
    billableMaterialRate +
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
    materialReferenceRate,
    materialContributionRate,
    billableMaterialRate,
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
  const [rate, setRate] = useState<RateInput>(examples[0]);
  const [aggregates, setAggregates] = useState<MaterialAggregate[]>(
    examples[0].aggregates ? examples[0].aggregates.map((a) => ({ ...a })) : []
  );
  const [breakdownMode, setBreakdownMode] = useState<boolean>(true);
  const [showAggregatesPanel, setShowAggregatesPanel] = useState<boolean>(true);
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

  const aggregateMaterialTotal = useMemo(() => {
    return aggregates.reduce(
      (sum, item) => sum + toNumber(item.constant) * toNumber(item.unit_cost),
      0
    );
  }, [aggregates]);

  // Synchronize overall rate.material_rate whenever breakdownMode is active and aggregates exist
  useEffect(() => {
    if (breakdownMode && aggregates.length > 0) {
      const calculatedTotal = Number(aggregateMaterialTotal.toFixed(2));
      setRate((curr) => {
        if (Math.abs(curr.material_rate - calculatedTotal) > 0.001) {
          return { ...curr, material_rate: calculatedTotal };
        }
        return curr;
      });
    }
  }, [breakdownMode, aggregateMaterialTotal, aggregates.length]);

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

  const addAggregate = (initial?: Partial<MaterialAggregate>) => {
    const newId = `agg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const newItem: MaterialAggregate = {
      id: newId,
      name: initial?.name || "",
      unit: initial?.unit || "m3",
      constant: initial?.constant ?? 1,
      unit_cost: initial?.unit_cost ?? 0,
    };
    setAggregates((curr) => [...curr, newItem]);
    setBreakdownMode(true);
  };

  const updateAggregate = (id: string, field: keyof MaterialAggregate, value: any) => {
    setAggregates((curr) =>
      curr.map((item) => {
        if (item.id !== id) return item;
        return {
          ...item,
          [field]: field === "constant" || field === "unit_cost" ? toNumber(value) : value,
        };
      })
    );
  };

  const removeAggregate = (id: string) => {
    setAggregates((curr) => curr.filter((item) => item.id !== id));
  };

  const applyAggregatePreset = (preset: AggregatePreset) => {
    const items: MaterialAggregate[] = preset.aggregates.map((a, idx) => ({
      id: `agg-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
      name: a.name,
      unit: a.unit,
      constant: a.constant,
      unit_cost: a.unit_cost,
    }));
    setAggregates(items);
    setBreakdownMode(true);
    setRate((curr) => ({
      ...curr,
      unit: preset.unit,
      category: preset.category || curr.category,
      description: curr.description === blankRate.description ? preset.description : curr.description,
    }));
  };

  const clearAggregates = () => {
    setAggregates([]);
  };

  const applyBenchmark = (item: RateBenchmark) => {
    setBenchmarkResult(null);
    setSuccessMsg("");
    const savedBreakdown = Array.isArray(item.materials_breakdown) ? item.materials_breakdown : [];
    setRate((current) => ({
      ...current,
      item_code: item.item_code || current.item_code,
      description: item.description || current.description,
      category: item.category || current.category,
      unit: item.unit || current.unit,
      currency: item.currency || current.currency,
      material_rate: toNumber(item.material_reference_rate, toNumber(item.supplier_rate)),
      subcontractor_rate: toNumber(item.subcontractor_rate),
      escalation_pct: toNumber(item.escalation_pct),
      last_po_rate: toNumber(item.last_po_rate),
      source_type: (item.source_type as RateInput["source_type"]) || current.source_type,
      source_id: item.source_id || "",
      rate_group: item.rate_group || current.rate_group,
      supply_mode: (item.supply_mode as RateInput["supply_mode"]) || "full_supply",
      material_contribution_pct: toNumber(item.material_contribution_pct, 5),
      profit_pct: current.profit_pct,
      overhead_pct: current.overhead_pct,
    }));
    if (savedBreakdown.length > 0) {
      setAggregates(savedBreakdown.map((entry: any, index) => ({
        id: `agg-saved-${item.id}-${index}`,
        name: String(entry.material || entry.name || ""),
        unit: String(entry.unit || "unit"),
        constant: toNumber(entry.constant_per_rate_unit ?? entry.constant, 0),
        unit_cost: toNumber(entry.unit_cost, 0),
      })));
      setBreakdownMode(true);
    } else {
      setAggregates([]);
      setBreakdownMode(false);
    }
  };

  const applyExample = (example: RateInput) => {
    setBenchmarkResult(null);
    setSuccessMsg("");
    setRate(example);
    if (example.aggregates && example.aggregates.length > 0) {
      setAggregates(example.aggregates.map((a) => ({ ...a })));
      setBreakdownMode(true);
    } else {
      setAggregates([]);
      setBreakdownMode(false);
    }
  };

  const copyRate = async () => {
    const payload = {
      item_code: rate.item_code,
      description: rate.description,
      unit: rate.unit,
      source_type: rate.source_type,
      source_id: rate.source_id || null,
      rate_group: rate.rate_group,
      supply_mode: rate.supply_mode,
      target_rate: Number(calculated.targetRate.toFixed(2)),
      material_reference_rate: Number(calculated.materialReferenceRate.toFixed(2)),
      billable_material_rate: Number(calculated.billableMaterialRate.toFixed(2)),
      material_contribution_pct: rate.material_contribution_pct,
      material_contribution_rate: Number(calculated.materialContributionRate.toFixed(2)),
      material_rate: Number(calculated.billableMaterialRate.toFixed(2)),
      labour_rate: rate.labour_rate,
      equipment_rate: rate.equipment_rate,
      subcontractor_rate: rate.subcontractor_rate,
      prelim_rate: rate.prelim_rate,
      waste_pct: rate.waste_pct,
      overhead_pct: rate.overhead_pct,
      profit_pct: rate.profit_pct,
      escalation_pct: rate.escalation_pct,
      task_context: rate.task_context,
      materials_breakdown: aggregates.map((item) => ({
        material: item.name,
        unit: item.unit,
        constant_per_rate_unit: item.constant,
        unit_cost: item.unit_cost,
        subtotal_per_rate_unit: Number((item.constant * item.unit_cost).toFixed(2)),
      })),
    };
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    setSuccessMsg("Rate build-up with materials constants breakdown copied.");
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
      const response = await benchmarkRate(rate.item_code, Number(calculated.targetRate.toFixed(2)), {
        source_type: rate.source_type,
        source_id: rate.source_id || undefined,
        rate_group: rate.rate_group || undefined,
      });
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
        supplier_rate: Number((calculated.billableMaterialRate + rate.equipment_rate + rate.prelim_rate).toFixed(2)),
        subcontractor_rate: Number(rate.subcontractor_rate.toFixed(2)),
        last_po_rate: Number(rate.last_po_rate.toFixed(2)),
        currency: rate.currency || "USD",
        escalation_pct: Number(rate.escalation_pct.toFixed(2)),
        source_type: rate.source_type,
        source_id: rate.source_id.trim() || null,
        rate_group: rate.rate_group.trim() || null,
        supply_mode: rate.supply_mode,
        material_contribution_pct: Number(rate.material_contribution_pct.toFixed(2)),
        material_reference_rate: Number(calculated.materialReferenceRate.toFixed(2)),
        materials_breakdown: aggregates.map((item) => ({
          material: item.name,
          unit: item.unit,
          constant_per_rate_unit: item.constant,
          unit_cost: item.unit_cost,
          subtotal_per_rate_unit: Number((item.constant * item.unit_cost).toFixed(2)),
        })),
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
              <SelectField
                label="Rate Scope"
                value={rate.source_type}
                onChange={(value) => updateRate("source_type", value as RateInput["source_type"])}
                options={[
                  ["global", "Reusable Global"],
                  ["project", "Project / Job"],
                  ["tender", "Tender"],
                  ["opportunity", "Opportunity"],
                  ["task", "CRM Task"],
                  ["custom", "Custom Scope"],
                ]}
              />
              <Field label="Scope ID" value={rate.source_id} onChange={(value) => updateRate("source_id", value)} />
              <Field label="Rate Group" value={rate.rate_group} onChange={(value) => updateRate("rate_group", value)} className="md:col-span-2" />
            </div>

            <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-5">
              <NumberField
                label="Material"
                value={rate.material_rate}
                readOnly={breakdownMode && aggregates.length > 0}
                badge={breakdownMode && aggregates.length > 0 ? `${aggregates.length} Aggregates` : undefined}
                onChange={(value) => {
                  if (breakdownMode && aggregates.length > 0) {
                    setBreakdownMode(false);
                  }
                  updateRate("material_rate", value);
                }}
              />
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

            <div className="mt-6 border border-ink-mid bg-ink p-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h3 className="font-display text-sm font-semibold text-white">Supply Mode</h3>
                  <p className="mt-1 text-xs text-slate">
                    Labour-only keeps the full material build-up visible, but charges only a contribution on client-supplied materials.
                  </p>
                </div>
                <div className="inline-flex border border-ink-mid bg-ink-light p-0.5 text-[11px] font-mono">
                  <button
                    type="button"
                    onClick={() => updateRate("supply_mode", "full_supply")}
                    className={`px-3 py-1.5 transition-all ${rate.supply_mode === "full_supply" ? "bg-signal font-semibold text-ink" : "text-slate hover:text-white"}`}
                  >
                    Labour + Materials
                  </button>
                  <button
                    type="button"
                    onClick={() => updateRate("supply_mode", "labour_only_client_materials")}
                    className={`px-3 py-1.5 transition-all ${rate.supply_mode === "labour_only_client_materials" ? "bg-signal font-semibold text-ink" : "text-slate hover:text-white"}`}
                  >
                    Labour Only
                  </button>
                </div>
              </div>
              {rate.supply_mode === "labour_only_client_materials" && (
                <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-4">
                  <NumberField
                    label="Material Contribution %"
                    value={rate.material_contribution_pct}
                    onChange={(value) => updateRate("material_contribution_pct", value)}
                  />
                  <BreakdownLine label="Material reference" value={calculated.materialReferenceRate} currency={rate.currency} />
                  <BreakdownLine label={`${pct(rate.material_contribution_pct)} material contribution`} value={calculated.materialContributionRate} currency={rate.currency} />
                  <BreakdownLine label="Material charged in rate" value={calculated.billableMaterialRate} currency={rate.currency} />
                </div>
              )}
            </div>

            {/* --- MATERIAL CONSTANTS & AGGREGATES BREAKDOWN --- */}
            <div className="mt-6 border border-ink-mid bg-ink p-5 shadow-sm">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <Layers className="h-4 w-4 text-signal" />
                    <h3 className="font-display text-sm font-bold uppercase tracking-wider text-white">
                      Material Constants & Aggregates Mix
                    </h3>
                    <span className="rounded border border-signal/30 bg-signal/10 px-2 py-0.5 font-mono text-[10px] uppercase text-signal">
                      {aggregates.length} {aggregates.length === 1 ? "constituent" : "constituents"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate">
                    Control the overall materials figure by specifying exact aggregate constants (cement, sand, stone, water, additives) per {rate.unit || "unit"}.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="inline-flex rounded border border-ink-mid bg-ink-light p-0.5 text-[11px] font-mono">
                    <button
                      type="button"
                      onClick={() => setBreakdownMode(true)}
                      className={`px-2.5 py-1 transition-all ${
                        breakdownMode
                          ? "bg-signal text-ink font-semibold"
                          : "text-slate hover:text-white"
                      }`}
                    >
                      Aggregates Mix
                    </button>
                    <button
                      type="button"
                      onClick={() => setBreakdownMode(false)}
                      className={`px-2.5 py-1 transition-all ${
                        !breakdownMode
                          ? "bg-signal text-ink font-semibold"
                          : "text-slate hover:text-white"
                      }`}
                    >
                      Manual Lump Sum
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowAggregatesPanel((prev) => !prev)}
                    className="inline-flex items-center gap-1 border border-ink-mid bg-ink-light px-2.5 py-1 text-xs text-slate transition-colors hover:border-signal/50 hover:text-white"
                  >
                    {showAggregatesPanel ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    <span>{showAggregatesPanel ? "Collapse" : "Expand"}</span>
                  </button>
                </div>
              </div>

              {showAggregatesPanel && (
                <div className="mt-4 space-y-4">
                  {/* Quick Presets */}
                  <div className="border border-ink-mid/60 bg-ink-light/50 p-3">
                    <div className="flex items-center justify-between gap-2 pb-2">
                      <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-slate-light">
                        <Sparkles className="h-3 w-3 text-signal" />
                        Load Mix Preset from Estimation Constants:
                      </span>
                      {aggregates.length > 0 && (
                        <button
                          type="button"
                          onClick={clearAggregates}
                          className="inline-flex items-center gap-1 font-mono text-[10px] uppercase text-red-400 hover:text-red-300 transition-colors"
                        >
                          <RotateCcw className="h-3 w-3" />
                          Clear Mix
                        </button>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {AGGREGATE_PRESETS.map((preset) => (
                        <button
                          key={preset.label}
                          type="button"
                          onClick={() => applyAggregatePreset(preset)}
                          className="border border-ink-mid bg-ink px-2.5 py-1 font-mono text-[10px] uppercase text-slate transition-colors hover:border-signal/60 hover:text-white hover:bg-signal/5"
                          title={preset.description}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Aggregates Table */}
                  {aggregates.length === 0 ? (
                    <div className="border border-dashed border-ink-mid p-6 text-center">
                      <p className="text-xs text-slate">
                        No constituent aggregates or material constants added yet.
                      </p>
                      <p className="mt-1 font-mono text-[11px] text-slate-light">
                        Load a standard mix preset above (e.g. Concrete Grade 20) or add custom ingredients per {rate.unit || "unit"}.
                      </p>
                      <div className="mt-4 flex flex-wrap justify-center gap-3">
                        <button
                          type="button"
                          onClick={() => applyAggregatePreset(AGGREGATE_PRESETS[0])}
                          className="inline-flex items-center gap-1.5 border border-signal/40 bg-signal/10 px-3 py-1.5 font-mono text-xs text-signal transition-colors hover:bg-signal/20"
                        >
                          <Sparkles className="h-3.5 w-3.5" />
                          Load Concrete Mix (1:2:4)
                        </button>
                        <button
                          type="button"
                          onClick={() => addAggregate()}
                          className="inline-flex items-center gap-1.5 border border-ink-mid bg-ink-light px-3 py-1.5 font-mono text-xs text-white transition-colors hover:border-signal/50"
                        >
                          <Plus className="h-3.5 w-3.5 text-signal" />
                          + Add First Aggregate
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="border-b border-ink-mid bg-ink-light font-mono text-[10px] uppercase tracking-wider text-slate">
                            <th className="p-2.5">Constituent Material / Aggregate</th>
                            <th className="p-2.5 w-28">Agg. Unit</th>
                            <th className="p-2.5 w-36">
                              Constant (Qty / {rate.unit || "unit"})
                            </th>
                            <th className="p-2.5 w-32">Unit Price ({rate.currency})</th>
                            <th className="p-2.5 w-32 text-right">
                              Subtotal ({rate.currency}/{rate.unit || "unit"})
                            </th>
                            <th className="p-2.5 w-12 text-center"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-ink-mid/40 font-mono">
                          {aggregates.map((item) => {
                            const subtotal = toNumber(item.constant) * toNumber(item.unit_cost);
                            return (
                              <tr key={item.id} className="transition-colors hover:bg-ink-light/40">
                                <td className="p-2">
                                  <input
                                    type="text"
                                    value={item.name}
                                    placeholder="e.g. River Sand / Cement / Water / Stone"
                                    onChange={(e) => updateAggregate(item.id, "name", e.target.value)}
                                    className="h-8 w-full border border-ink-mid bg-ink px-2 text-xs font-sans text-white outline-none focus:border-signal/50"
                                  />
                                </td>
                                <td className="p-2">
                                  <input
                                    type="text"
                                    value={item.unit}
                                    placeholder="e.g. bags, m3, L"
                                    onChange={(e) => updateAggregate(item.id, "unit", e.target.value)}
                                    className="h-8 w-full border border-ink-mid bg-ink px-2 text-xs text-paper outline-none focus:border-signal/50"
                                  />
                                </td>
                                <td className="p-2">
                                  <input
                                    type="number"
                                    step="0.001"
                                    value={item.constant}
                                    onChange={(e) => updateAggregate(item.id, "constant", e.target.value)}
                                    className="h-8 w-full border border-ink-mid bg-ink px-2 text-xs text-right text-paper outline-none focus:border-signal/50"
                                  />
                                </td>
                                <td className="p-2">
                                  <input
                                    type="number"
                                    step="0.01"
                                    value={item.unit_cost}
                                    onChange={(e) => updateAggregate(item.id, "unit_cost", e.target.value)}
                                    className="h-8 w-full border border-ink-mid bg-ink px-2 text-xs text-right text-paper outline-none focus:border-signal/50"
                                  />
                                </td>
                                <td className="p-2 text-right font-semibold text-white">
                                  {money(subtotal, rate.currency)}
                                </td>
                                <td className="p-2 text-center">
                                  <button
                                    type="button"
                                    onClick={() => removeAggregate(item.id)}
                                    className="p-1 text-slate hover:text-red-400 transition-colors"
                                    title="Remove aggregate line"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr className="border-t border-ink-mid bg-ink-light/80 font-mono">
                            <td colSpan={4} className="p-2.5 font-semibold text-right uppercase text-[11px] text-slate-light">
                              Total Calculated Material Rate per {rate.unit || "unit"}:
                            </td>
                            <td className="p-2.5 text-right font-bold text-sm text-signal">
                              {money(aggregateMaterialTotal, rate.currency)}
                            </td>
                            <td></td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}

                  {/* Actions & Live Status */}
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pt-1">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => addAggregate()}
                        className="inline-flex items-center gap-1.5 border border-ink-mid bg-ink-light px-3 py-1.5 font-mono text-xs font-semibold text-paper transition-all hover:border-signal/50 hover:text-white"
                      >
                        <Plus className="h-3.5 w-3.5 text-signal" />
                        + Add Aggregate / Constant
                      </button>
                    </div>

                    <div className="font-mono text-xs">
                      {breakdownMode ? (
                        <div className="flex items-center gap-2 text-slate-light">
                          <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
                          <span>
                            Material reference: <strong className="text-white">{money(aggregates.length > 0 ? aggregateMaterialTotal : rate.material_rate, rate.currency)}</strong> per {rate.unit || "unit"}
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 text-amber-300">
                          <span className="inline-block h-2 w-2 rounded-full bg-amber-400" />
                          <span>Manual override active: using flat {money(rate.material_rate, rate.currency)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-6 grid grid-cols-1 gap-3 border border-ink-mid bg-ink p-4 md:grid-cols-4">
              <BreakdownLine label="Direct billed rate" value={calculated.directRate} currency={rate.currency} />
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
                Save Rate
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
                  Saved rates can be global, grouped, or tied to a specific job. Labour-only rates keep the material reference separate from what is actually billed.
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
                      <span>{item.source_type || "global"}</span>
                      <span>{item.rate_group || "Ungrouped"}</span>
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

function SelectField({
  label,
  value,
  onChange,
  options,
  className = "",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<[string, string]>;
  className?: string;
}) {
  return (
    <label className={className}>
      <span className="font-mono text-[10px] uppercase tracking-widest text-slate">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 h-10 w-full border border-ink-mid bg-ink px-3 text-xs text-paper outline-none transition-colors focus:border-signal/50"
      >
        {options.map(([optionValue, labelText]) => (
          <option key={optionValue} value={optionValue}>
            {labelText}
          </option>
        ))}
      </select>
    </label>
  );
}

function NumberField({
  label,
  value,
  onChange,
  readOnly = false,
  badge,
  className = "",
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  readOnly?: boolean;
  badge?: string;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <div className="flex items-center justify-between gap-1">
        <span className="font-mono text-[10px] uppercase tracking-widest text-slate">{label}</span>
        {badge && (
          <span className="truncate rounded border border-signal/30 bg-signal/10 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-signal">
            {badge}
          </span>
        )}
      </div>
      <input
        type="number"
        step="0.01"
        value={value}
        readOnly={readOnly}
        onChange={(event) => onChange(toNumber(event.target.value))}
        className={`mt-2 h-10 w-full border px-3 text-xs outline-none transition-colors ${
          readOnly
            ? "border-signal/40 bg-ink font-mono font-semibold text-signal cursor-default"
            : "border-ink-mid bg-ink text-paper focus:border-signal/50"
        }`}
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
