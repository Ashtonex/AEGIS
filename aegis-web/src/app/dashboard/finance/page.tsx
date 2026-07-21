"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle, BadgeCheck, DollarSign, Loader2, Plus, RefreshCw, Search,
  ShieldCheck, TrendingUp, TrendingDown, Users, X, BarChart3, Receipt,
  FileText, ClipboardList, CheckCircle2, AlertCircle
} from "lucide-react";
import { RBACGuard } from "@/components/auth/RBACGuard";
import { FinanceOperationsPanel } from "./FinanceOperationsPanel";
import {
  getFinanceProjectSummaries,
  getFinanceProjectDetail,
  getFinanceCostCodes,
  createFinanceCostCode,
  getFinanceVariations,
  createFinanceVariation,
  getFinanceProgressClaims,
  getFinanceBudgets,
  getInternalProjects
} from "@/lib/api";

type RecordData = Record<string, any>;
type FinanceTab = "project-financials" | "cost-codes" | "variations" | "progress-claims" | "budgets" | "banking" | "cash-accounts" | "cashbook" | "supplier-payments" | "payroll";

const TAB_ROUTES: Record<FinanceTab, string> = {
  "project-financials": "/dashboard/finance/project-financials",
  "cost-codes": "/dashboard/finance/cost-codes",
  variations: "/dashboard/finance/variations",
  "progress-claims": "/dashboard/finance/progress-claims",
  budgets: "/dashboard/finance/budgets",
  banking: "/dashboard/finance/banking",
  "cash-accounts": "/dashboard/finance/cash-accounts",
  cashbook: "/dashboard/finance/cashbook",
  "supplier-payments": "/dashboard/finance/supplier-payments",
  payroll: "/dashboard/finance/payroll",
};

function normalizeTab(value: string | null | undefined): FinanceTab {
  return value && value in TAB_ROUTES ? (value as FinanceTab) : "project-financials";
}

function money(value: unknown) {
  const num = typeof value === "number" ? value : Number(value);
  return new Intl.NumberFormat("en-ZW", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number.isFinite(num) ? num : 0);
}

function percent(value: unknown) {
  const num = typeof value === "number" ? value : Number(value);
  return `${(Number.isFinite(num) ? num : 0).toFixed(1)}%`;
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
    return "The finance feed is still synchronizing. Please retry once the connection is ready.";
  }
  return "Failed to load financial workspace data.";
}

function normalizeActionError(reason: unknown, fallback: string) {
  const rawMessage = reason instanceof Error ? reason.message : String(reason ?? "");
  if (/aborted|cancelled|timed out|network error|fetch failed|not found/i.test(rawMessage)) {
    return fallback;
  }
  return fallback;
}

function statusClass(status: string) {
  const normalized = String(status || "").toLowerCase();
  if (["approved", "certified", "paid", "incorporated", "matched"].includes(normalized)) {
    return "border-emerald-500/30 bg-emerald-950/20 text-emerald-300";
  }
  if (["submitted", "pending", "matching", "partial_match"].includes(normalized)) {
    return "border-blue-500/30 bg-blue-950/20 text-blue-300";
  }
  if (["rejected", "cancelled", "disputed", "over_invoice"].includes(normalized)) {
    return "border-red-500/30 bg-red-950/20 text-red-300";
  }
  return "border-slate-500/30 bg-slate-950/20 text-slate-300";
}

export default function FinanceDashboard() {
  return (
    <RBACGuard allowedRoles={["Executive (Admin)", "Project Manager", "Finance Manager"]}>
      <FinanceWorkspace />
    </RBACGuard>
  );
}

function FinanceWorkspace() {
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<FinanceTab>(() => normalizeTab(searchParams?.get("tab")));
  const [projects, setProjects] = useState<RecordData[]>([]);
  const [costCodes, setCostCodes] = useState<RecordData[]>([]);
  const [variations, setVariations] = useState<RecordData[]>([]);
  const [claims, setClaims] = useState<RecordData[]>([]);
  const [budgets, setBudgets] = useState<RecordData[]>([]);
  const [projectSummaries, setProjectSummaries] = useState<RecordData[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [projectDetail, setProjectDetail] = useState<RecordData | null>(null);

  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sourceWarnings, setSourceWarnings] = useState<string[]>([]);

  // Modal States
  const [showCostCodeModal, setShowCostCodeModal] = useState(false);
  const [showVariationModal, setShowVariationModal] = useState(false);
  const [showClaimModal, setShowClaimModal] = useState(false);

  // Form Fields
  const [newCostCode, setNewCostCode] = useState({ code: "", name: "", category: "materials" });
  const [newVariation, setNewVariation] = useState({ variation_number: "", project_id: "", title: "", description: "", cost_impact: "0", time_impact_days: "0", initiated_by: "client" });
  const [newClaim, setNewClaim] = useState({ claim_number: "", project_id: "", claim_period_start: "", claim_period_end: "", this_claim_amount: "0", retention_pct: "10" });

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [projList, summariesRes, costCodesRes, variationsRes, claimsRes, budgetsRes] = await Promise.allSettled([
        getInternalProjects(),
        getFinanceProjectSummaries(),
        getFinanceCostCodes(),
        getFinanceVariations(),
        getFinanceProgressClaims(),
        getFinanceBudgets()
      ]);

      const warnings: string[] = [];
      if (projList.status === "fulfilled") setProjects(projList.value.data || []);
      else warnings.push("Project register could not be loaded.");
      if (summariesRes.status === "fulfilled") setProjectSummaries(summariesRes.value.data || []);
      else warnings.push("Project financial summaries could not be loaded.");
      if (costCodesRes.status === "fulfilled") setCostCodes(costCodesRes.value.data || []);
      else warnings.push("Cost codes could not be loaded.");
      if (variationsRes.status === "fulfilled") setVariations(variationsRes.value.data || []);
      else warnings.push("Variation register could not be loaded.");
      if (claimsRes.status === "fulfilled") setClaims(claimsRes.value.data || []);
      else warnings.push("Progress claims could not be loaded.");
      if (budgetsRes.status === "fulfilled") setBudgets(budgetsRes.value.data || []);
      else warnings.push("Budgets could not be loaded.");
      setSourceWarnings(warnings);
      if (summariesRes.status === "rejected") {
        throw new Error(loadFailureMessage(summariesRes.reason));
      }
    } catch (err) {
      setError(loadFailureMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    setActiveTab(normalizeTab(searchParams?.get("tab")));
  }, [searchParams]);

  const loadProjectDetail = async (id: string) => {
    setSelectedProjectId(id);
    if (!id) {
      setProjectDetail(null);
      return;
    }
    setDetailLoading(true);
    try {
      const res = await getFinanceProjectDetail(id);
      setProjectDetail(res.data || null);
    } catch (err) {
      setNotice(normalizeActionError(err, "Failed to load project details."));
    } finally {
      setDetailLoading(false);
    }
  };

  const handleCreateCostCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCostCode.code || !newCostCode.name) return;
    try {
      await createFinanceCostCode(newCostCode);
      setNotice("Cost code created successfully.");
      setShowCostCodeModal(false);
      setNewCostCode({ code: "", name: "", category: "materials" });
      await loadData();
    } catch (err) {
      setNotice(normalizeActionError(err, "Failed to create cost code."));
    }
  };

  const handleCreateVariation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newVariation.project_id || !newVariation.title) return;
    try {
      await createFinanceVariation({
        ...newVariation,
        cost_impact: Number(newVariation.cost_impact),
        time_impact_days: Number(newVariation.time_impact_days)
      });
      setNotice("Variation submitted successfully.");
      setShowVariationModal(false);
      setNewVariation({ variation_number: "", project_id: "", title: "", description: "", cost_impact: "0", time_impact_days: "0", initiated_by: "client" });
      await loadData();
    } catch (err) {
      setNotice(normalizeActionError(err, "Failed to submit variation."));
    }
  };

  // Aggregated KPIs
  const operationalTabs: FinanceTab[] = ["banking", "cash-accounts", "cashbook", "supplier-payments", "payroll"];

  const kpis = useMemo(() => {
    let contractTotal = 0;
    let certifiedTotal = 0;
    let collectedTotal = 0;
    let committedTotal = 0;
    let actualTotal = 0;

    projectSummaries.forEach(p => {
      contractTotal += Number(p.contract_value || 0) + Number(p.approved_variations || 0);
      certifiedTotal += Number(p.certified_to_date || 0);
      collectedTotal += Number(p.cash_collected || 0);
      committedTotal += Number(p.committed_cost || 0);
      actualTotal += Number(p.actual_cost_to_date || 0);
    });

    const outstandingAR = certifiedTotal - collectedTotal;
    const forecastEAC = actualTotal + committedTotal;
    const marginAmount = contractTotal - forecastEAC;
    const marginPct = contractTotal > 0 ? (marginAmount / contractTotal) * 100 : 0;

    return {
      contractTotal,
      certifiedTotal,
      collectedTotal,
      committedTotal,
      actualTotal,
      outstandingAR,
      marginPct
    };
  }, [projectSummaries]);

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center bg-ink">
        <Loader2 className="h-8 w-8 animate-spin text-signal" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Top Banner Notice */}
      {notice && (
        <div className="bg-ink-light border border-signal/20 px-4 py-3 rounded flex items-center justify-between text-paper text-sm">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-slate hover:text-paper">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      {error && (
        <div className="flex items-start gap-2 rounded border border-red-500/40 bg-red-950/20 px-4 py-3 text-sm text-red-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
          <div>
            <p className="font-semibold">Finance data could not be loaded.</p>
            <p className="mt-1 text-red-100/80">{error}</p>
          </div>
        </div>
      )}
      {sourceWarnings.length > 0 && (
        <div className="space-y-2 rounded border border-amber-500/30 bg-amber-950/20 px-4 py-3 text-sm text-amber-100">
          {sourceWarnings.map((warning) => (
            <div key={warning} className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
              <p>{warning}</p>
            </div>
          ))}
        </div>
      )}

      {/* Title & Subtitle */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-semibold text-paper tracking-tight font-display">Finance & Cost Control</h1>
          <p className="text-sm text-slate-light font-sans mt-0.5">SNC authoritative financial ledger and budget controls.</p>
        </div>
        <div className="flex space-x-2">
          {activeTab === "cost-codes" && (
            <button
              onClick={() => setShowCostCodeModal(true)}
              className="flex items-center space-x-2 bg-signal text-ink font-medium px-4 py-2 rounded-sm text-sm hover:bg-signal/95 transition-colors"
            >
              <Plus className="h-4 w-4" />
              <span>New Cost Code</span>
            </button>
          )}
          {activeTab === "variations" && (
            <button
              onClick={() => setShowVariationModal(true)}
              className="flex items-center space-x-2 bg-signal text-ink font-medium px-4 py-2 rounded-sm text-sm hover:bg-signal/95 transition-colors"
            >
              <Plus className="h-4 w-4" />
              <span>Record Variation</span>
            </button>
          )}
        </div>
      </div>

      {/* KPI Cards Strip */}
      <div className="grid grid-cols-1 md:grid-cols-4 lg:grid-cols-7 gap-4">
        <div className="bg-ink-light border border-ink-mid p-4 rounded-sm">
          <p className="text-[10px] uppercase font-mono tracking-widest text-slate">Total Contract Value</p>
          <p className="text-lg font-semibold text-paper tracking-tight mt-1">{money(kpis.contractTotal)}</p>
        </div>
        <div className="bg-ink-light border border-ink-mid p-4 rounded-sm">
          <p className="text-[10px] uppercase font-mono tracking-widest text-slate">Certified Revenue</p>
          <p className="text-lg font-semibold text-paper tracking-tight mt-1">{money(kpis.certifiedTotal)}</p>
        </div>
        <div className="bg-ink-light border border-ink-mid p-4 rounded-sm">
          <p className="text-[10px] uppercase font-mono tracking-widest text-slate">Cash Collected</p>
          <p className="text-lg font-semibold text-paper tracking-tight mt-1">{money(kpis.collectedTotal)}</p>
        </div>
        <div className="bg-ink-light border border-ink-mid p-4 rounded-sm">
          <p className="text-[10px] uppercase font-mono tracking-widest text-slate">Outstanding AR</p>
          <p className="text-lg font-semibold text-paper tracking-tight mt-1 text-amber-400">{money(kpis.outstandingAR)}</p>
        </div>
        <div className="bg-ink-light border border-ink-mid p-4 rounded-sm">
          <p className="text-[10px] uppercase font-mono tracking-widest text-slate">Committed Costs</p>
          <p className="text-lg font-semibold text-paper tracking-tight mt-1">{money(kpis.committedTotal)}</p>
        </div>
        <div className="bg-ink-light border border-ink-mid p-4 rounded-sm">
          <p className="text-[10px] uppercase font-mono tracking-widest text-slate">Actual Costs</p>
          <p className="text-lg font-semibold text-paper tracking-tight mt-1">{money(kpis.actualTotal)}</p>
        </div>
        <div className="bg-ink-light border border-ink-mid p-4 rounded-sm">
          <p className="text-[10px] uppercase font-mono tracking-widest text-slate">Forecast Margin %</p>
          <div className="flex items-center space-x-2 mt-1">
            <span className={`text-lg font-semibold tracking-tight ${kpis.marginPct >= 15 ? 'text-emerald-400' : kpis.marginPct >= 5 ? 'text-amber-400' : 'text-red-400'}`}>
              {percent(kpis.marginPct)}
            </span>
            {kpis.marginPct >= 15 ? (
              <TrendingUp className="h-4 w-4 text-emerald-400" />
            ) : (
              <TrendingDown className="h-4 w-4 text-red-400" />
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap border-b border-ink-mid">
        <Link
          href={TAB_ROUTES["project-financials"]}
          className={`px-4 py-2 font-mono text-xs tracking-wider uppercase border-b-2 -mb-px transition-colors ${activeTab === "project-financials" ? "border-signal text-signal font-semibold" : "border-transparent text-slate hover:text-paper"}`}
        >
          Project Financials
        </Link>
        <Link
          href={TAB_ROUTES["cost-codes"]}
          className={`px-4 py-2 font-mono text-xs tracking-wider uppercase border-b-2 -mb-px transition-colors ${activeTab === "cost-codes" ? "border-signal text-signal font-semibold" : "border-transparent text-slate hover:text-paper"}`}
        >
          Cost Codes
        </Link>
        <Link
          href={TAB_ROUTES.variations}
          className={`px-4 py-2 font-mono text-xs tracking-wider uppercase border-b-2 -mb-px transition-colors ${activeTab === "variations" ? "border-signal text-signal font-semibold" : "border-transparent text-slate hover:text-paper"}`}
        >
          Variations
        </Link>
        <Link
          href={TAB_ROUTES["progress-claims"]}
          className={`px-4 py-2 font-mono text-xs tracking-wider uppercase border-b-2 -mb-px transition-colors ${activeTab === "progress-claims" ? "border-signal text-signal font-semibold" : "border-transparent text-slate hover:text-paper"}`}
        >
          Progress Claims
        </Link>
        <Link
          href={TAB_ROUTES.budgets}
          className={`px-4 py-2 font-mono text-xs tracking-wider uppercase border-b-2 -mb-px transition-colors ${activeTab === "budgets" ? "border-signal text-signal font-semibold" : "border-transparent text-slate hover:text-paper"}`}
        >
          Budgets
        </Link>
        <Link
          href={TAB_ROUTES.banking}
          className={`px-4 py-2 font-mono text-xs tracking-wider uppercase border-b-2 -mb-px transition-colors ${activeTab === "banking" ? "border-signal text-signal font-semibold" : "border-transparent text-slate hover:text-paper"}`}
        >
          Banking & Cash
        </Link>
        <Link
          href={TAB_ROUTES["cash-accounts"]}
          className={`px-4 py-2 font-mono text-xs tracking-wider uppercase border-b-2 -mb-px transition-colors ${activeTab === "cash-accounts" ? "border-signal text-signal font-semibold" : "border-transparent text-slate hover:text-paper"}`}
        >
          Accounts
        </Link>
        <Link
          href={TAB_ROUTES.cashbook}
          className={`px-4 py-2 font-mono text-xs tracking-wider uppercase border-b-2 -mb-px transition-colors ${activeTab === "cashbook" ? "border-signal text-signal font-semibold" : "border-transparent text-slate hover:text-paper"}`}
        >
          Cashbook
        </Link>
        <Link
          href={TAB_ROUTES["supplier-payments"]}
          className={`px-4 py-2 font-mono text-xs tracking-wider uppercase border-b-2 -mb-px transition-colors ${activeTab === "supplier-payments" ? "border-signal text-signal font-semibold" : "border-transparent text-slate hover:text-paper"}`}
        >
          Supplier Pay
        </Link>
        <Link
          href={TAB_ROUTES.payroll}
          className={`px-4 py-2 font-mono text-xs tracking-wider uppercase border-b-2 -mb-px transition-colors ${activeTab === "payroll" ? "border-signal text-signal font-semibold" : "border-transparent text-slate hover:text-paper"}`}
        >
          Payroll
        </Link>
      </div>

      {/* Tab Panels */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {operationalTabs.includes(activeTab) && (
            <FinanceOperationsPanel tab={activeTab as "banking" | "cash-accounts" | "cashbook" | "supplier-payments" | "payroll"} projects={projects} />
          )}

          {activeTab === "project-financials" && (
            <div className="bg-ink-light border border-ink-mid rounded-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-ink-mid bg-ink/30 flex justify-between items-center">
                <span className="font-mono text-xs tracking-wider uppercase text-slate">Active Project Ledgers</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-ink-mid text-slate font-mono text-[11px] uppercase tracking-wider bg-ink-light">
                      <th className="p-4">Project</th>
                      <th className="p-4 text-right">Contract Value</th>
                      <th className="p-4 text-right">Actual Cost</th>
                      <th className="p-4 text-right">Committed</th>
                      <th className="p-4 text-right">EAC</th>
                      <th className="p-4 text-right">Forecast Margin</th>
                      <th className="p-4">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-mid">
                    {projectSummaries.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="p-4 text-center text-slate">No project financials registered.</td>
                      </tr>
                    ) : (
                      projectSummaries.map((p) => {
                        const totalRev = Number(p.contract_value || 0) + Number(p.approved_variations || 0);
                        const eac = Number(p.actual_cost_to_date || 0) + Number(p.committed_cost || 0);
                        const margin = totalRev - eac;
                        const marginPct = totalRev > 0 ? (margin / totalRev) * 100 : 0;
                        const isSelected = selectedProjectId === p.project_id;

                        return (
                          <tr
                            key={p.project_id}
                            onClick={() => void loadProjectDetail(p.project_id)}
                            className={`cursor-pointer hover:bg-ink-mid/30 transition-colors ${isSelected ? 'bg-ink-mid/20 border-l-2 border-l-signal' : ''}`}
                          >
                            <td className="p-4 font-medium text-paper">{p.project_name || p.project_code}</td>
                            <td className="p-4 text-right text-paper">{money(totalRev)}</td>
                            <td className="p-4 text-right text-paper">{money(p.actual_cost_to_date)}</td>
                            <td className="p-4 text-right text-slate-light">{money(p.committed_cost)}</td>
                            <td className="p-4 text-right text-paper">{money(eac)}</td>
                            <td className="p-4 text-right">
                              <span className={marginPct >= 15 ? 'text-emerald-400' : marginPct >= 5 ? 'text-amber-400' : 'text-red-400'}>
                                {percent(marginPct)}
                              </span>
                            </td>
                            <td className="p-4">
                              <span className={`px-2 py-0.5 rounded-sm text-[10px] uppercase tracking-wider font-mono border ${statusClass(p.project_status || 'active')}`}>
                                {p.project_status || 'active'}
                              </span>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === "cost-codes" && (
            <div className="bg-ink-light border border-ink-mid rounded-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-ink-mid bg-ink/30">
                <span className="font-mono text-xs tracking-wider uppercase text-slate">Cost Code Ledger Structure</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-ink-mid text-slate font-mono text-[11px] uppercase tracking-wider bg-ink-light">
                      <th className="p-4">Code</th>
                      <th className="p-4">Name</th>
                      <th className="p-4">Category</th>
                      <th className="p-4">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-mid">
                    {costCodes.map((c) => (
                      <tr key={c.id} className="hover:bg-ink-mid/10">
                        <td className="p-4 font-mono text-signal">{c.code}</td>
                        <td className="p-4 text-paper font-medium">{c.name}</td>
                        <td className="p-4 text-slate-light capitalize">{c.category}</td>
                        <td className="p-4">
                          <span className="border border-emerald-500/30 bg-emerald-950/20 text-emerald-300 px-2 py-0.5 rounded-sm text-[10px] uppercase font-mono tracking-wider">
                            Active
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === "variations" && (
            <div className="bg-ink-light border border-ink-mid rounded-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-ink-mid bg-ink/30">
                <span className="font-mono text-xs tracking-wider uppercase text-slate">Variation Register (Change Orders)</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-ink-mid text-slate font-mono text-[11px] uppercase tracking-wider bg-ink-light">
                      <th className="p-4">VO #</th>
                      <th className="p-4">Project</th>
                      <th className="p-4">Title</th>
                      <th className="p-4 text-right">Cost Impact</th>
                      <th className="p-4 text-right">Time (Days)</th>
                      <th className="p-4">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-mid">
                    {variations.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="p-4 text-center text-slate">No variations recorded.</td>
                      </tr>
                    ) : (
                      variations.map((v) => (
                        <tr key={v.id} className="hover:bg-ink-mid/10">
                          <td className="p-4 font-mono text-paper font-medium">{v.variation_number}</td>
                          <td className="p-4 text-slate-light">{v.project_name || v.project_id}</td>
                          <td className="p-4 text-paper">{v.title}</td>
                          <td className={`p-4 text-right font-medium ${Number(v.cost_impact) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {money(v.cost_impact)}
                          </td>
                          <td className="p-4 text-right text-paper">{v.time_impact_days}</td>
                          <td className="p-4">
                            <span className={`border px-2 py-0.5 rounded-sm text-[10px] uppercase font-mono tracking-wider ${statusClass(v.status)}`}>
                              {v.status}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === "progress-claims" && (
            <div className="bg-ink-light border border-ink-mid rounded-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-ink-mid bg-ink/30">
                <span className="font-mono text-xs tracking-wider uppercase text-slate">Contract Claim Register</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-ink-mid text-slate font-mono text-[11px] uppercase tracking-wider bg-ink-light">
                      <th className="p-4">Claim #</th>
                      <th className="p-4">Project</th>
                      <th className="p-4 text-right">Claim Amount</th>
                      <th className="p-4 text-right">Retention Held</th>
                      <th className="p-4 text-right">Net Claim</th>
                      <th className="p-4 text-right">Certified</th>
                      <th className="p-4">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-mid">
                    {claims.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="p-4 text-center text-slate">No progress claims recorded.</td>
                      </tr>
                    ) : (
                      claims.map((c) => (
                        <tr key={c.id} className="hover:bg-ink-mid/10">
                          <td className="p-4 font-mono text-paper font-medium">{c.claim_number}</td>
                          <td className="p-4 text-slate-light">{c.project_name || c.project_id}</td>
                          <td className="p-4 text-right text-paper">{money(c.this_claim_amount)}</td>
                          <td className="p-4 text-right text-amber-400">{money(c.retention_amount)}</td>
                          <td className="p-4 text-right text-paper font-medium">{money(c.net_claim_amount)}</td>
                          <td className="p-4 text-right text-emerald-400">{c.certified_amount ? money(c.certified_amount) : "—"}</td>
                          <td className="p-4">
                            <span className={`border px-2 py-0.5 rounded-sm text-[10px] uppercase font-mono tracking-wider ${statusClass(c.status)}`}>
                              {c.status}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === "budgets" && (
            <div className="bg-ink-light border border-ink-mid rounded-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-ink-mid bg-ink/30">
                <span className="font-mono text-xs tracking-wider uppercase text-slate">Project Approved Budgets</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-ink-mid text-slate font-mono text-[11px] uppercase tracking-wider bg-ink-light">
                      <th className="p-4">Project</th>
                      <th className="p-4">Budget Version</th>
                      <th className="p-4">Effective Date</th>
                      <th className="p-4 text-right">Total Amount</th>
                      <th className="p-4">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-mid">
                    {budgets.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="p-4 text-center text-slate">No budgets registered.</td>
                      </tr>
                    ) : (
                      budgets.map((b) => (
                        <tr key={b.id} className="hover:bg-ink-mid/10">
                          <td className="p-4 text-paper font-medium">{b.project_name || b.project_id}</td>
                          <td className="p-4 font-mono text-slate-light">v{b.budget_version}</td>
                          <td className="p-4 text-slate-light">{new Date(b.effective_date).toLocaleDateString()}</td>
                          <td className="p-4 text-right text-paper font-semibold">{money(b.allocated_amount || b.total_amount)}</td>
                          <td className="p-4">
                            <span className={`border px-2 py-0.5 rounded-sm text-[10px] uppercase font-mono tracking-wider ${statusClass(b.status)}`}>
                              {b.status}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === "banking" && (
            <div className="bg-ink-light border border-ink-mid rounded-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-ink-mid bg-ink/30">
                <span className="font-mono text-xs tracking-wider uppercase text-slate">Company Bank Accounts</span>
              </div>
              <div className="p-6 text-center text-slate">
                <AlertCircle className="h-8 w-8 text-signal/50 mx-auto mb-2" />
                <p className="text-sm font-medium text-paper">Manual Banking is Active</p>
                <p className="text-xs mt-1">Bank accounts and transactions are currently managed manually via the ledger.</p>
                <button className="mt-4 px-4 py-2 bg-signal text-ink text-sm font-semibold rounded hover:bg-signal/90">
                  Manage Bank Accounts
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Project Detail Right Sidebar / Panel */}
        <div className="space-y-6">
          <div className="bg-ink-light border border-ink-mid p-5 rounded-sm">
            <h2 className="text-sm font-semibold text-paper tracking-wider uppercase font-mono border-b border-ink-mid pb-3">Project Detail Control</h2>
            {detailLoading ? (
              <div className="flex h-48 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-signal" />
              </div>
            ) : projectDetail ? (
              <div className="space-y-4 mt-4">
                <div>
                  <h3 className="text-base font-semibold text-paper">{projectDetail.project_name}</h3>
                  <p className="text-xs text-slate-light font-mono mt-0.5">{projectDetail.project_code || "Code unassigned"}</p>
                </div>

                <div className="grid grid-cols-2 gap-4 border-t border-b border-ink-mid py-4 my-4">
                  <div>
                    <span className="text-[10px] uppercase font-mono text-slate tracking-wider block">Revised Contract Value</span>
                    <span className="text-sm font-semibold text-paper block mt-1">{money(Number(projectDetail.contract_value || 0) + Number(projectDetail.approved_variations || 0))}</span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-mono text-slate tracking-wider block">Certified Revenue</span>
                    <span className="text-sm font-semibold text-emerald-400 block mt-1">{money(projectDetail.certified_to_date)}</span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-mono text-slate tracking-wider block">Actual Costs To Date</span>
                    <span className="text-sm font-semibold text-paper block mt-1">{money(projectDetail.actual_cost_to_date)}</span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-mono text-slate tracking-wider block">Committed Costs</span>
                    <span className="text-sm font-semibold text-slate-light block mt-1">{money(projectDetail.committed_cost)}</span>
                  </div>
                </div>

                {/* Progress Indicators */}
                <div className="space-y-3">
                  <div>
                    <div className="flex justify-between text-xs font-mono text-slate mb-1">
                      <span>Budget Spent</span>
                      <span>{percent((Number(projectDetail.actual_cost_to_date || 0) / Number(projectDetail.approved_budget || 1)) * 100)}</span>
                    </div>
                    <div className="w-full bg-ink h-1.5 rounded-full overflow-hidden">
                      <div
                        className="bg-signal h-full"
                        style={{ width: `${Math.min(100, (Number(projectDetail.actual_cost_to_date || 0) / Number(projectDetail.approved_budget || 1)) * 100)}%` }}
                      ></div>
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-xs font-mono text-slate mb-1">
                      <span>Cash collection efficiency</span>
                      <span>{percent((Number(projectDetail.cash_collected || 0) / Number(projectDetail.certified_to_date || 1)) * 100)}</span>
                    </div>
                    <div className="w-full bg-ink h-1.5 rounded-full overflow-hidden">
                      <div
                        className="bg-emerald-500 h-full"
                        style={{ width: `${Math.min(100, (Number(projectDetail.cash_collected || 0) / Number(projectDetail.certified_to_date || 1)) * 100)}%` }}
                      ></div>
                    </div>
                  </div>
                </div>

                {/* Warnings / Risk alerts */}
                {(projectDetail.cost_overrun_risk || projectDetail.cashflow_deficit_risk) && (
                  <div className="bg-red-950/20 border border-red-500/30 p-3 rounded flex items-start space-x-3 mt-4">
                    <AlertTriangle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-semibold text-red-300">Financial Risk Warnings</p>
                      <ul className="text-[11px] text-red-400/90 list-disc list-inside mt-1 space-y-1">
                        {projectDetail.cost_overrun_risk && <li>EAC exceeds approved budget</li>}
                        {projectDetail.cashflow_deficit_risk && <li>Certified/Commitment cash deficit detected</li>}
                      </ul>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-slate mt-4 text-center">Select a project ledger to view detailed metrics and budget progression.</p>
            )}
          </div>
        </div>
      </div>

      {/* Cost Code Modal */}
      {showCostCodeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 backdrop-blur-sm">
          <div className="bg-ink-light border border-ink-mid w-full max-w-md p-6 rounded-sm space-y-4">
            <div className="flex justify-between items-center border-b border-ink-mid pb-3">
              <span className="text-base font-semibold text-paper">Create Cost Code</span>
              <button onClick={() => setShowCostCodeModal(false)} className="text-slate hover:text-paper">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleCreateCostCode} className="space-y-4">
              <div>
                <label className="block text-xs font-mono uppercase text-slate mb-1">Code</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. 03-100"
                  value={newCostCode.code}
                  onChange={(e) => setNewCostCode({ ...newCostCode, code: e.target.value })}
                  className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                />
              </div>
              <div>
                <label className="block text-xs font-mono uppercase text-slate mb-1">Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Concrete Materials"
                  value={newCostCode.name}
                  onChange={(e) => setNewCostCode({ ...newCostCode, name: e.target.value })}
                  className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                />
              </div>
              <div>
                <label className="block text-xs font-mono uppercase text-slate mb-1">Category</label>
                <select
                  value={newCostCode.category}
                  onChange={(e) => setNewCostCode({ ...newCostCode, category: e.target.value })}
                  className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                >
                  <option value="labour">Labour</option>
                  <option value="equipment">Equipment</option>
                  <option value="materials">Materials</option>
                  <option value="subcontract">Subcontract</option>
                  <option value="overhead">Overhead</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div className="flex justify-end space-x-3 pt-3 border-t border-ink-mid">
                <button
                  type="button"
                  onClick={() => setShowCostCodeModal(false)}
                  className="px-4 py-2 border border-ink-mid text-paper rounded text-sm hover:bg-ink-mid/30"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-signal text-ink font-semibold rounded text-sm hover:bg-signal/95"
                >
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Variation Modal */}
      {showVariationModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 backdrop-blur-sm">
          <div className="bg-ink-light border border-ink-mid w-full max-w-lg p-6 rounded-sm space-y-4">
            <div className="flex justify-between items-center border-b border-ink-mid pb-3">
              <span className="text-base font-semibold text-paper">Record Variation Order</span>
              <button onClick={() => setShowVariationModal(false)} className="text-slate hover:text-paper">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleCreateVariation} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-mono uppercase text-slate mb-1">VO Number</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. VO-001"
                    value={newVariation.variation_number}
                    onChange={(e) => setNewVariation({ ...newVariation, variation_number: e.target.value })}
                    className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                  />
                </div>
                <div>
                  <label className="block text-xs font-mono uppercase text-slate mb-1">Project</label>
                  <select
                    required
                    value={newVariation.project_id}
                    onChange={(e) => setNewVariation({ ...newVariation, project_id: e.target.value })}
                    className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                  >
                    <option value="">Select Project</option>
                    {projects.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-mono uppercase text-slate mb-1">Title</label>
                <input
                  type="text"
                  required
                  placeholder="Additional earthworks scope"
                  value={newVariation.title}
                  onChange={(e) => setNewVariation({ ...newVariation, title: e.target.value })}
                  className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                />
              </div>
              <div>
                <label className="block text-xs font-mono uppercase text-slate mb-1">Description</label>
                <textarea
                  placeholder="Full scope and design modifications..."
                  value={newVariation.description}
                  onChange={(e) => setNewVariation({ ...newVariation, description: e.target.value })}
                  className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50 h-20"
                />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-mono uppercase text-slate mb-1">Cost Impact ($)</label>
                  <input
                    type="number"
                    value={newVariation.cost_impact}
                    onChange={(e) => setNewVariation({ ...newVariation, cost_impact: e.target.value })}
                    className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                  />
                </div>
                <div>
                  <label className="block text-xs font-mono uppercase text-slate mb-1">Time Impact (Days)</label>
                  <input
                    type="number"
                    value={newVariation.time_impact_days}
                    onChange={(e) => setNewVariation({ ...newVariation, time_impact_days: e.target.value })}
                    className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                  />
                </div>
                <div>
                  <label className="block text-xs font-mono uppercase text-slate mb-1">Initiated By</label>
                  <select
                    value={newVariation.initiated_by}
                    onChange={(e) => setNewVariation({ ...newVariation, initiated_by: e.target.value })}
                    className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                  >
                    <option value="client">Client</option>
                    <option value="contractor">Contractor</option>
                    <option value="designer">Designer</option>
                    <option value="statutory">Statutory</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end space-x-3 pt-3 border-t border-ink-mid">
                <button
                  type="button"
                  onClick={() => setShowVariationModal(false)}
                  className="px-4 py-2 border border-ink-mid text-paper rounded text-sm hover:bg-ink-mid/30"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-signal text-ink font-semibold rounded text-sm hover:bg-signal/95"
                >
                  Submit VO
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}







