"use client";

import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, ArrowDownLeft, ArrowRight, ArrowUpRight, BadgeCheck, BarChart3,
  Building2, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, CircleDollarSign,
  ClipboardCheck, Clock, Coins, FileCheck, FileText, FolderKanban, Layers, Loader2,
  Lock, Percent, Plus, RefreshCw, Scale, Search, ShieldCheck, TrendingDown,
  TrendingUp, Wallet, X,
} from "lucide-react";
import {
  approveBoqMeasurement,
  certifyFinanceProgressClaim,
  createFinanceCostCode,
  createFinanceProgressClaim,
  createFinanceVariation,
  decideFinanceVariation,
  getBoqLineItems,
  getBoqProgressSummary,
  getCostCodesByProject,
  getFinalAccount,
  getFinanceProjectDetail,
  recordProgressClaimFiscalInvoice,
  setProjectBudget,
} from "@/lib/api";
import { ProjectMoneyModal } from "./ProjectMoneyModal";

type RecordData = Record<string, any>;
export type CommercialSubTab = "overview" | "budgets" | "variations" | "claims" | "earned-value" | "close-out";

function money(value: unknown, compact = false) {
  const num = typeof value === "number" ? value : Number(value);
  const n = Number.isFinite(num) ? num : 0;
  return new Intl.NumberFormat("en-ZW", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: compact && Math.abs(n) >= 1000 ? 0 : 0,
    notation: compact ? "compact" : "standard",
  }).format(n);
}

function percent(value: unknown) {
  const num = typeof value === "number" ? value : Number(value);
  return `${(Number.isFinite(num) ? num : 0).toFixed(1)}%`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function statusClass(status: string) {
  const normalized = String(status || "").toLowerCase();
  if (["approved", "certified", "invoiced", "paid", "agreed", "closed"].includes(normalized)) {
    return "border-emerald-500/30 bg-emerald-950/20 text-emerald-300";
  }
  if (["submitted", "pending", "under_negotiation"].includes(normalized)) {
    return "border-blue-500/30 bg-blue-950/20 text-blue-300";
  }
  if (["rejected", "cancelled", "disputed"].includes(normalized)) {
    return "border-red-500/30 bg-red-950/20 text-red-300";
  }
  return "border-slate-500/30 bg-slate-950/20 text-slate-300";
}

const inputClass = "w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50";
const buttonClass = "inline-flex items-center gap-2 bg-signal text-ink font-semibold px-3 py-2 rounded-sm text-sm hover:bg-signal/95 disabled:opacity-50";

export function ProjectCommercialWorkspace({
  projects = [],
  projectSummaries = [],
  budgets = [],
  variations = [],
  claims = [],
  initialProjectId = "",
  initialTab = "overview",
  onDataChanged,
}: {
  projects: RecordData[];
  projectSummaries: RecordData[];
  budgets: RecordData[];
  variations: RecordData[];
  claims: RecordData[];
  initialProjectId?: string;
  initialTab?: CommercialSubTab;
  onDataChanged: () => Promise<unknown> | void;
}) {
  const [selectedId, setSelectedId] = useState<string>(initialProjectId);
  const [activeTab, setActiveTab] = useState<CommercialSubTab>(initialTab);
  const [projectSearch, setProjectSearch] = useState("");
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [moneyModalOpen, setMoneyModalOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Forms
  const [showVariationModal, setShowVariationModal] = useState(false);
  const [variationForm, setVariationForm] = useState({
    variation_number: "",
    title: "",
    description: "",
    cost_impact: "0",
    time_impact_days: "0",
    initiated_by: "client",
  });

  const [showClaimModal, setShowClaimModal] = useState(false);
  const [claimForm, setClaimForm] = useState({
    claim_number: "",
    claim_period_start: today(),
    claim_period_end: today(),
    contract_value: "0",
    this_claim_amount: "0",
    retention_pct: "10",
  });

  const [showBudgetModal, setShowBudgetModal] = useState(false);
  const [budgetForm, setBudgetForm] = useState({ total_amount: "", notes: "" });

  // Detailed project data
  const [projectDetail, setProjectDetail] = useState<RecordData | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [evSummary, setEvSummary] = useState<RecordData | null>(null);
  const [finalAccount, setFinalAccount] = useState<RecordData | null>(null);

  const selectedProject = useMemo(() => {
    return projects.find((p) => p.id === selectedId) || null;
  }, [projects, selectedId]);

  const selectedSummary = useMemo(() => {
    return projectSummaries.find((p) => p.project_id === selectedId) || null;
  }, [projectSummaries, selectedId]);

  // Load project-specific details on select
  const loadDetail = useCallback(async (id: string) => {
    if (!id) {
      setProjectDetail(null);
      setEvSummary(null);
      setFinalAccount(null);
      return;
    }
    setDetailLoading(true);
    try {
      const [detailRes, evRes, faRes] = await Promise.allSettled([
        getFinanceProjectDetail(id),
        getBoqProgressSummary(id),
        getFinalAccount(id),
      ]);
      if (detailRes.status === "fulfilled") setProjectDetail(detailRes.value.data || null);
      if (evRes.status === "fulfilled") setEvSummary(evRes.value.data || null);
      if (faRes.status === "fulfilled") setFinalAccount(faRes.value.data || null);
    } catch {
      // Handled gracefully
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedId) void loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  // Project navigation helpers
  const projectIndex = useMemo(() => {
    return projects.findIndex((p) => p.id === selectedId);
  }, [projects, selectedId]);

  const prevProject = () => {
    if (projectIndex > 0) setSelectedId(projects[projectIndex - 1].id);
  };
  const nextProject = () => {
    if (projectIndex < projects.length - 1) setSelectedId(projects[projectIndex + 1].id);
  };

  // Filtered project list for switcher
  const filteredProjects = useMemo(() => {
    const q = projectSearch.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter(
      (p) => `${p.name || ""} ${p.project_code || ""}`.toLowerCase().includes(q),
    );
  }, [projects, projectSearch]);

  // Project-scoped data
  const projectVariations = useMemo(() => {
    if (!selectedId) return variations;
    return variations.filter((v) => v.project_id === selectedId);
  }, [variations, selectedId]);

  const projectClaims = useMemo(() => {
    if (!selectedId) return claims;
    return claims.filter((c) => c.project_id === selectedId);
  }, [claims, selectedId]);

  const projectBudgets = useMemo(() => {
    if (!selectedId) return budgets;
    return budgets.filter((b) => b.project_id === selectedId);
  }, [budgets, selectedId]);

  // Actions
  const handleVariationSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedId || !variationForm.title) return;
    setBusy(true);
    try {
      await createFinanceVariation({
        ...variationForm,
        project_id: selectedId,
        cost_impact: Number(variationForm.cost_impact) || 0,
        time_impact_days: Number(variationForm.time_impact_days) || 0,
      });
      setShowVariationModal(false);
      setVariationForm({ variation_number: "", title: "", description: "", cost_impact: "0", time_impact_days: "0", initiated_by: "client" });
      setNotice("Variation successfully recorded.");
      await onDataChanged();
      if (selectedId) await loadDetail(selectedId);
    } catch (err: any) {
      setNotice(err?.message || "Failed to record variation.");
    } finally {
      setBusy(false);
    }
  };

  const handleClaimSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedId || !claimForm.claim_number) return;
    setBusy(true);
    try {
      await createFinanceProgressClaim({
        ...claimForm,
        project_id: selectedId,
        contract_value: Number(claimForm.contract_value) || 0,
        this_claim_amount: Number(claimForm.this_claim_amount) || 0,
        retention_pct: Number(claimForm.retention_pct) || 0,
      });
      setShowClaimModal(false);
      setClaimForm({ claim_number: "", claim_period_start: today(), claim_period_end: today(), contract_value: "0", this_claim_amount: "0", retention_pct: "10" });
      setNotice("Progress claim successfully submitted.");
      await onDataChanged();
      if (selectedId) await loadDetail(selectedId);
    } catch (err: any) {
      setNotice(err?.message || "Failed to submit progress claim.");
    } finally {
      setBusy(false);
    }
  };

  const handleBudgetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedId) return;
    setBusy(true);
    try {
      await setProjectBudget(selectedId, Number(budgetForm.total_amount) || 0, budgetForm.notes || undefined);
      setShowBudgetModal(false);
      setBudgetForm({ total_amount: "", notes: "" });
      setNotice("Project baseline budget saved.");
      await onDataChanged();
      if (selectedId) await loadDetail(selectedId);
    } catch (err: any) {
      setNotice(err?.message || "Failed to set project budget.");
    } finally {
      setBusy(false);
    }
  };

  const handleVariationDecisionAction = async (variationId: string, decision: "approve" | "reject") => {
    setBusy(true);
    try {
      await decideFinanceVariation(variationId, decision);
      setNotice(`Variation ${decision === "approve" ? "approved" : "rejected"}.`);
      await onDataChanged();
      if (selectedId) await loadDetail(selectedId);
    } catch (err: any) {
      setNotice(err?.message || "Action failed.");
    } finally {
      setBusy(false);
    }
  };

  const handleCertifyClaimAction = async (claimId: string) => {
    setBusy(true);
    try {
      await certifyFinanceProgressClaim(claimId);
      setNotice("Progress claim certified and VAT accrual recognized.");
      await onDataChanged();
      if (selectedId) await loadDetail(selectedId);
    } catch (err: any) {
      setNotice(err?.message || "Failed to certify progress claim.");
    } finally {
      setBusy(false);
    }
  };

  const handleFiscalInvoiceAction = async (claimId: string) => {
    const inv = window.prompt("Enter Fiscal Tax Invoice Number:");
    if (!inv?.trim()) return;
    setBusy(true);
    try {
      await recordProgressClaimFiscalInvoice(claimId, inv.trim());
      setNotice("Fiscal invoice recorded on progress claim.");
      await onDataChanged();
      if (selectedId) await loadDetail(selectedId);
    } catch (err: any) {
      setNotice(err?.message || "Failed to record fiscal invoice.");
    } finally {
      setBusy(false);
    }
  };

  // Calculations for active project
  const contractRev = Number(selectedSummary?.contract_value || selectedProject?.contract_value || 0) + Number(selectedSummary?.approved_variations || 0);
  const actualCost = Number(selectedSummary?.actual_cost_to_date || 0);
  const committedCost = Number(selectedSummary?.committed_cost || 0);
  const eac = actualCost + committedCost;
  const forecastMargin = contractRev - eac;
  const forecastMarginPct = contractRev > 0 ? (forecastMargin / contractRev) * 100 : 0;
  const certifiedRev = Number(selectedSummary?.certified_to_date || 0);
  const collectedCash = Number(selectedSummary?.cash_collected || 0);
  const outstandingAr = certifiedRev - collectedCash;

  return (
    <div className="space-y-4">
      {notice && (
        <div className="flex items-center justify-between gap-2 rounded border border-signal/40 bg-signal/10 px-4 py-2.5 text-xs text-paper">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="text-slate hover:text-paper">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Persistent Project Switcher & Header Bar */}
      <div className="bg-ink-light border border-ink-mid rounded-lg p-3 sm:p-4 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {/* Quick previous/next arrows */}
          <div className="flex items-center border border-ink-mid rounded overflow-hidden shrink-0">
            <button
              type="button"
              onClick={prevProject}
              disabled={projectIndex <= 0}
              className="p-1.5 hover:bg-ink-mid/30 text-slate hover:text-paper disabled:opacity-30 disabled:pointer-events-none transition-colors"
              title="Previous project"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={nextProject}
              disabled={projectIndex >= projects.length - 1 || projectIndex === -1}
              className="p-1.5 hover:bg-ink-mid/30 text-slate hover:text-paper disabled:opacity-30 disabled:pointer-events-none transition-colors border-l border-ink-mid"
              title="Next project"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {/* Project Dropdown Switcher */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setSwitcherOpen((v) => !v)}
              className="flex items-center gap-2 px-3 py-1.5 rounded border border-ink-mid hover:border-signal/50 bg-ink text-left transition-colors min-w-[220px] max-w-sm"
            >
              <FolderKanban className="h-4 w-4 text-signal shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-paper truncate">
                  {selectedProject ? selectedProject.name || selectedProject.project_code : "All Projects (Portfolio)"}
                </p>
                <p className="text-[10px] text-slate font-mono uppercase tracking-wider truncate">
                  {selectedProject ? selectedProject.project_code || "Select project" : `${projects.length} Total Projects`}
                </p>
              </div>
              <ChevronDown className={`h-3.5 w-3.5 text-slate transition-transform ${switcherOpen ? "rotate-180" : ""}`} />
            </button>

            {switcherOpen && (
              <div className="absolute left-0 top-full mt-1.5 z-50 w-80 max-h-80 overflow-y-auto bg-ink border border-ink-mid rounded-lg shadow-2xl p-2 animate-in fade-in slide-in-from-top-1">
                <div className="relative mb-2">
                  <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate" />
                  <input
                    type="text"
                    value={projectSearch}
                    onChange={(e) => setProjectSearch(e.target.value)}
                    placeholder="Search project name or code..."
                    className="w-full bg-ink-light border border-ink-mid rounded pl-8 pr-2 py-1.5 text-xs text-paper focus:outline-none focus:border-signal"
                    autoFocus
                  />
                </div>

                <button
                  type="button"
                  onClick={() => { setSelectedId(""); setSwitcherOpen(false); }}
                  className={`w-full text-left px-2.5 py-2 rounded text-xs transition-colors flex items-center justify-between mb-1 ${
                    !selectedId ? "bg-signal/20 text-signal font-semibold" : "hover:bg-ink-light text-paper"
                  }`}
                >
                  <span className="font-medium">All Projects (Cross-Portfolio)</span>
                  <span className="text-[10px] text-slate font-mono">{projects.length}</span>
                </button>

                <div className="divide-y divide-ink-mid/30">
                  {filteredProjects.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => { setSelectedId(p.id); setSwitcherOpen(false); }}
                      className={`w-full text-left px-2.5 py-2 rounded text-xs transition-colors flex items-center justify-between ${
                        selectedId === p.id ? "bg-signal text-ink font-semibold" : "hover:bg-ink-light text-paper"
                      }`}
                    >
                      <div className="min-w-0 pr-2">
                        <p className="truncate font-medium">{p.name || p.project_code}</p>
                        <p className={`text-[10px] font-mono ${selectedId === p.id ? "text-ink/80" : "text-slate"}`}>
                          {p.project_code}
                        </p>
                      </div>
                      <span className={`text-[9px] uppercase font-mono px-1 py-0.5 rounded border shrink-0 ${statusClass(p.status || "active")}`}>
                        {p.status || "active"}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Selected Project Live KPI Chips */}
        {selectedProject ? (
          <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
            <div className="bg-ink px-2.5 py-1 rounded border border-ink-mid">
              <span className="text-[10px] uppercase text-slate mr-1.5">Rev:</span>
              <span className="text-paper font-semibold">{money(contractRev, true)}</span>
            </div>
            <div className="bg-ink px-2.5 py-1 rounded border border-ink-mid">
              <span className="text-[10px] uppercase text-slate mr-1.5">EAC:</span>
              <span className="text-paper font-semibold">{money(eac, true)}</span>
            </div>
            <div className="bg-ink px-2.5 py-1 rounded border border-ink-mid flex items-center gap-1">
              <span className="text-[10px] uppercase text-slate mr-1">Margin:</span>
              <span className={`font-semibold ${forecastMarginPct >= 15 ? "text-emerald-400" : forecastMarginPct >= 5 ? "text-amber-400" : "text-red-400"}`}>
                {percent(forecastMarginPct)}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setMoneyModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded text-xs font-mono uppercase bg-signal/15 text-signal border border-signal/40 hover:bg-signal/25 transition-colors"
            >
              <Coins className="h-3.5 w-3.5" />
              <span>Project Money</span>
            </button>
          </div>
        ) : (
          <div className="text-xs text-slate-light font-mono">
            Select a project to enter variations, budgets, claims, or view cashflow.
          </div>
        )}
      </div>

      {/* Top Commercial Workspace Sub-Tabs */}
      {selectedProject ? (
        <div className="flex items-center gap-1 border-b border-ink-mid overflow-x-auto pb-px text-xs font-mono uppercase tracking-wider">
          <button
            type="button"
            onClick={() => setActiveTab("overview")}
            className={`px-3 py-2 border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === "overview"
                ? "border-signal text-signal font-semibold"
                : "border-transparent text-slate hover:text-paper"
            }`}
          >
            <CircleDollarSign className="h-3.5 w-3.5" />
            <span>Commercial Health</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("budgets")}
            className={`px-3 py-2 border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === "budgets"
                ? "border-signal text-signal font-semibold"
                : "border-transparent text-slate hover:text-paper"
            }`}
          >
            <Scale className="h-3.5 w-3.5" />
            <span>Budgets &amp; Cost Codes</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("variations")}
            className={`px-3 py-2 border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === "variations"
                ? "border-signal text-signal font-semibold"
                : "border-transparent text-slate hover:text-paper"
            }`}
          >
            <BarChart3 className="h-3.5 w-3.5" />
            <span>Variations ({projectVariations.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("claims")}
            className={`px-3 py-2 border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === "claims"
                ? "border-signal text-signal font-semibold"
                : "border-transparent text-slate hover:text-paper"
            }`}
          >
            <ClipboardCheck className="h-3.5 w-3.5" />
            <span>Progress Claims ({projectClaims.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("earned-value")}
            className={`px-3 py-2 border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === "earned-value"
                ? "border-signal text-signal font-semibold"
                : "border-transparent text-slate hover:text-paper"
            }`}
          >
            <TrendingUp className="h-3.5 w-3.5" />
            <span>Earned Value (EVM)</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("close-out")}
            className={`px-3 py-2 border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === "close-out"
                ? "border-signal text-signal font-semibold"
                : "border-transparent text-slate hover:text-paper"
            }`}
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>Final Account Close-Out</span>
          </button>
        </div>
      ) : null}

      {/* Tab Panels */}
      {!selectedProject ? (
        /* Cross-Portfolio View */
        <div className="bg-ink-light border border-ink-mid rounded-lg shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-ink-mid bg-ink/30 flex items-center justify-between">
            <span className="font-mono text-xs uppercase tracking-wider text-slate font-semibold">
              Project Commercial Portfolio ({projectSummaries.length} Projects)
            </span>
            <span className="text-[11px] text-slate-light">Click any project to enter its commercial workspace</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-ink-mid text-slate font-mono text-[11px] uppercase tracking-wider bg-ink-light">
                  <th className="p-3.5">Project</th>
                  <th className="p-3.5 text-right">Contract</th>
                  <th className="p-3.5 text-right">Certified</th>
                  <th className="p-3.5 text-right">Collected</th>
                  <th className="p-3.5 text-right">Bank In</th>
                  <th className="p-3.5 text-right">Bank Out</th>
                  <th className="p-3.5 text-right">Actual Cost</th>
                  <th className="p-3.5 text-right">Committed</th>
                  <th className="p-3.5 text-right">EAC</th>
                  <th className="p-3.5 text-right">Margin %</th>
                  <th className="p-3.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-mid">
                {projectSummaries.map((p) => {
                  const rev = Number(p.contract_value || 0) + Number(p.approved_variations || 0);
                  const pEac = Number(p.actual_cost_to_date || 0) + Number(p.committed_cost || 0);
                  const m = rev - pEac;
                  const mPct = rev > 0 ? (m / rev) * 100 : 0;

                  return (
                    <tr
                      key={p.project_id}
                      onClick={() => setSelectedId(p.project_id)}
                      className="cursor-pointer hover:bg-ink-mid/30 transition-colors"
                    >
                      <td className="p-3.5 font-medium text-paper">
                        {p.project_name || p.project_code}
                      </td>
                      <td className="p-3.5 text-right text-paper font-mono">{money(rev)}</td>
                      <td className="p-3.5 text-right text-paper font-mono">{money(p.certified_to_date)}</td>
                      <td className="p-3.5 text-right text-paper font-mono">{money(p.cash_collected)}</td>
                      <td className="p-3.5 text-right text-emerald-300 font-mono">{Number(p.bank_in) ? money(p.bank_in) : "—"}</td>
                      <td className="p-3.5 text-right text-red-300 font-mono">{Number(p.bank_out) ? money(p.bank_out) : "—"}</td>
                      <td className="p-3.5 text-right text-paper font-mono">{money(p.actual_cost_to_date)}</td>
                      <td className="p-3.5 text-right text-slate font-mono">{money(p.committed_cost)}</td>
                      <td className="p-3.5 text-right text-paper font-mono font-medium">{money(pEac)}</td>
                      <td className="p-3.5 text-right font-mono font-medium">
                        <span className={mPct >= 15 ? "text-emerald-400" : mPct >= 5 ? "text-amber-400" : "text-red-400"}>
                          {percent(mPct)}
                        </span>
                      </td>
                      <td className="p-3.5">
                        <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-mono border ${statusClass(p.project_status || "active")}`}>
                          {p.project_status || "active"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : activeTab === "overview" ? (
        /* Tab 1: Commercial Health & Position */
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-ink-light border border-ink-mid p-3.5 rounded-lg">
              <p className="text-[10px] uppercase font-mono tracking-wider text-slate">Contract Total</p>
              <p className="text-base font-semibold text-paper mt-1">{money(contractRev)}</p>
              <p className="text-[11px] text-slate-light mt-0.5">Approved baseline + variations</p>
            </div>
            <div className="bg-ink-light border border-ink-mid p-3.5 rounded-lg">
              <p className="text-[10px] uppercase font-mono tracking-wider text-slate">Estimate At Completion</p>
              <p className="text-base font-semibold text-paper mt-1">{money(eac)}</p>
              <p className="text-[11px] text-slate-light mt-0.5">
                {money(actualCost)} actual + {money(committedCost)} committed
              </p>
            </div>
            <div className="bg-ink-light border border-ink-mid p-3.5 rounded-lg">
              <p className="text-[10px] uppercase font-mono tracking-wider text-slate">Certified Revenue</p>
              <p className="text-base font-semibold text-paper mt-1">{money(certifiedRev)}</p>
              <p className="text-[11px] text-slate-light mt-0.5">
                {money(collectedCash)} collected ({certifiedRev > 0 ? ((collectedCash / certifiedRev) * 100).toFixed(0) : 0}%)
              </p>
            </div>
            <div className="bg-ink-light border border-ink-mid p-3.5 rounded-lg">
              <p className="text-[10px] uppercase font-mono tracking-wider text-slate">Outstanding AR</p>
              <p className="text-base font-semibold text-amber-400 mt-1">{money(outstandingAr)}</p>
              <p className="text-[11px] text-slate-light mt-0.5">Certified but uncollected</p>
            </div>
          </div>

          <div className="bg-ink-light border border-ink-mid p-4 rounded-lg flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h4 className="text-sm font-semibold text-paper">Bank &amp; Cash Attribution</h4>
              <p className="text-xs text-slate-light mt-0.5">
                View statement lines, money in/out, and withdrew cash attribution for this project.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setMoneyModalOpen(true)}
              className="inline-flex items-center gap-2 bg-signal text-ink font-semibold px-4 py-2 rounded-sm text-xs font-mono uppercase tracking-wider hover:bg-signal/90"
            >
              <Coins className="h-4 w-4" />
              <span>Open Project Money Ledger</span>
            </button>
          </div>
        </div>
      ) : activeTab === "budgets" ? (
        /* Tab 2: Budgets & Cost Codes */
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs uppercase tracking-wider text-slate font-semibold">
              Project Budget Ceiling &amp; Cost Baseline
            </span>
            <button
              type="button"
              onClick={() => setShowBudgetModal(true)}
              className="inline-flex items-center gap-1.5 bg-signal text-ink px-3 py-1.5 rounded-sm text-xs font-mono uppercase tracking-wider font-semibold"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Set Budget Ceiling</span>
            </button>
          </div>

          <div className="bg-ink-light border border-ink-mid rounded-lg p-4 space-y-3">
            <div className="flex justify-between items-center text-sm">
              <span className="text-slate">Approved Budget Ceiling:</span>
              <span className="text-paper font-semibold font-mono">
                {money(projectBudgets.find((b) => b.status === "approved")?.total_amount || 0)}
              </span>
            </div>
            <div className="flex justify-between items-center text-sm border-t border-ink-mid pt-2">
              <span className="text-slate">Actual Cost Posted:</span>
              <span className="text-paper font-mono">{money(actualCost)}</span>
            </div>
            <div className="flex justify-between items-center text-sm border-t border-ink-mid pt-2">
              <span className="text-slate">Committed Purchase Orders:</span>
              <span className="text-slate font-mono">{money(committedCost)}</span>
            </div>
          </div>
        </div>
      ) : activeTab === "variations" ? (
        /* Tab 3: Variations */
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs uppercase tracking-wider text-slate font-semibold">
              Variation Orders (Change Orders)
            </span>
            <button
              type="button"
              onClick={() => setShowVariationModal(true)}
              className="inline-flex items-center gap-1.5 bg-signal text-ink px-3 py-1.5 rounded-sm text-xs font-mono uppercase tracking-wider font-semibold"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Record Variation</span>
            </button>
          </div>

          <div className="bg-ink-light border border-ink-mid rounded-lg overflow-hidden">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-ink-mid text-slate font-mono text-[11px] uppercase tracking-wider bg-ink/30">
                  <th className="p-3">VO #</th>
                  <th className="p-3">Title</th>
                  <th className="p-3 text-right">Cost Impact</th>
                  <th className="p-3 text-right">Time Impact</th>
                  <th className="p-3">Status</th>
                  <th className="p-3 text-right">Decision</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-mid">
                {projectVariations.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-4 text-center text-slate text-xs">
                      No variations recorded for this project.
                    </td>
                  </tr>
                ) : (
                  projectVariations.map((v) => (
                    <tr key={v.id} className="hover:bg-ink-mid/10">
                      <td className="p-3 font-mono font-medium text-paper">{v.variation_number}</td>
                      <td className="p-3 text-paper">{v.title}</td>
                      <td className={`p-3 text-right font-mono font-medium ${Number(v.cost_impact) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {money(v.cost_impact)}
                      </td>
                      <td className="p-3 text-right text-paper font-mono">{v.time_impact_days}d</td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-mono border ${statusClass(v.status)}`}>
                          {v.status}
                        </span>
                      </td>
                      <td className="p-3 text-right">
                        {["pending", "submitted"].includes(String(v.status)) ? (
                          <div className="inline-flex gap-1.5">
                            <button
                              type="button"
                              onClick={() => void handleVariationDecisionAction(v.id, "approve")}
                              className="border border-emerald-500/40 text-emerald-300 px-2 py-0.5 rounded text-xs hover:bg-emerald-950/30"
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleVariationDecisionAction(v.id, "reject")}
                              className="border border-red-500/40 text-red-300 px-2 py-0.5 rounded text-xs hover:bg-red-950/30"
                            >
                              Reject
                            </button>
                          </div>
                        ) : (
                          <span className="text-slate text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : activeTab === "claims" ? (
        /* Tab 4: Progress Claims */
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs uppercase tracking-wider text-slate font-semibold">
              Progress Claims &amp; Fiscal Invoices
            </span>
            <button
              type="button"
              onClick={() => {
                setClaimForm({ ...claimForm, contract_value: String(contractRev) });
                setShowClaimModal(true);
              }}
              className="inline-flex items-center gap-1.5 bg-signal text-ink px-3 py-1.5 rounded-sm text-xs font-mono uppercase tracking-wider font-semibold"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>New Claim</span>
            </button>
          </div>

          <div className="bg-ink-light border border-ink-mid rounded-lg overflow-hidden">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-ink-mid text-slate font-mono text-[11px] uppercase tracking-wider bg-ink/30">
                  <th className="p-3">Claim #</th>
                  <th className="p-3">Period</th>
                  <th className="p-3 text-right">Claim Amount</th>
                  <th className="p-3 text-right">Retention</th>
                  <th className="p-3 text-right">Net Claim</th>
                  <th className="p-3 text-right">Certified</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Fiscal Invoice</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-mid">
                {projectClaims.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="p-4 text-center text-slate text-xs">
                      No progress claims submitted for this project.
                    </td>
                  </tr>
                ) : (
                  projectClaims.map((c) => (
                    <tr key={c.id} className="hover:bg-ink-mid/10">
                      <td className="p-3 font-mono font-medium text-paper">{c.claim_number}</td>
                      <td className="p-3 text-slate-light text-xs font-mono whitespace-nowrap">
                        {String(c.claim_period_start || "").slice(0, 10)} → {String(c.claim_period_end || "").slice(0, 10)}
                      </td>
                      <td className="p-3 text-right text-paper font-mono">{money(c.this_claim_amount)}</td>
                      <td className="p-3 text-right text-amber-400 font-mono">{money(c.retention_amount)}</td>
                      <td className="p-3 text-right text-paper font-mono font-medium">{money(c.net_claim_amount)}</td>
                      <td className="p-3 text-right text-emerald-400 font-mono">{c.certified_amount ? money(c.certified_amount) : "—"}</td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-mono border ${statusClass(c.status)}`}>
                          {c.status}
                        </span>
                      </td>
                      <td className="p-3 text-slate-light font-mono text-xs">{c.fiscal_invoice_number || "—"}</td>
                      <td className="p-3 text-right whitespace-nowrap">
                        {c.status === "submitted" && (
                          <button
                            type="button"
                            onClick={() => void handleCertifyClaimAction(c.id)}
                            className="text-xs text-signal hover:underline font-mono uppercase"
                          >
                            Certify
                          </button>
                        )}
                        {c.status === "certified" && !c.fiscal_invoice_number && (
                          <button
                            type="button"
                            onClick={() => void handleFiscalInvoiceAction(c.id)}
                            className="text-xs text-signal hover:underline font-mono uppercase"
                          >
                            Add Fiscal #
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : activeTab === "earned-value" ? (
        /* Tab 5: Earned Value */
        <div className="space-y-4">
          <div className="bg-ink-light border border-ink-mid p-4 rounded-lg space-y-3">
            <h4 className="text-xs font-mono uppercase tracking-wider text-slate font-semibold">
              Earned Value &amp; Performance Indices (EVM)
            </h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm font-mono">
              <div className="bg-ink p-3 rounded border border-ink-mid">
                <span className="text-[10px] uppercase text-slate block">Cost Performance (CPI)</span>
                <span className="text-lg font-semibold text-paper">
                  {evSummary?.cpi !== undefined ? Number(evSummary.cpi).toFixed(2) : "1.00"}
                </span>
              </div>
              <div className="bg-ink p-3 rounded border border-ink-mid">
                <span className="text-[10px] uppercase text-slate block">Schedule Performance (SPI)</span>
                <span className="text-lg font-semibold text-paper">
                  {evSummary?.spi !== undefined ? Number(evSummary.spi).toFixed(2) : "1.00"}
                </span>
              </div>
              <div className="bg-ink p-3 rounded border border-ink-mid">
                <span className="text-[10px] uppercase text-slate block">Planned Value (PV)</span>
                <span className="text-lg font-semibold text-paper">{money(evSummary?.planned_value || contractRev)}</span>
              </div>
              <div className="bg-ink p-3 rounded border border-ink-mid">
                <span className="text-[10px] uppercase text-slate block">Earned Value (EV)</span>
                <span className="text-lg font-semibold text-emerald-400">{money(evSummary?.earned_value || certifiedRev)}</span>
              </div>
            </div>
          </div>
        </div>
      ) : activeTab === "close-out" ? (
        /* Tab 6: Close-Out & Final Account */
        <div className="space-y-4">
          <div className="bg-ink-light border border-ink-mid p-4 rounded-lg space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-mono uppercase tracking-wider text-slate font-semibold">
                Final Account Status
              </h4>
              <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-mono border ${statusClass(finalAccount?.status || "under_negotiation")}`}>
                {finalAccount?.status || "under_negotiation"}
              </span>
            </div>
            <p className="text-xs text-slate-light">
              Reconciles final certified contract sum, approved variations, settled payables, released retention, and defects liability certification.
            </p>
          </div>
        </div>
      ) : null}

      {/* Project Money Modal */}
      {moneyModalOpen && selectedId && (
        <ProjectMoneyModal
          projectId={selectedId}
          projects={projects}
          onClose={() => setMoneyModalOpen(false)}
          onChanged={async () => {
            await onDataChanged();
            if (selectedId) await loadDetail(selectedId);
          }}
        />
      )}

      {/* Variation Modal */}
      {showVariationModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 backdrop-blur-sm">
          <div className="bg-ink-light border border-ink-mid w-full max-w-md p-6 rounded-lg space-y-4 shadow-2xl">
            <div className="flex justify-between items-center border-b border-ink-mid pb-3">
              <span className="text-sm font-semibold text-paper uppercase font-mono">Record Variation Order</span>
              <button type="button" onClick={() => setShowVariationModal(false)} className="text-slate hover:text-paper">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleVariationSubmit} className="space-y-3">
              <div>
                <label className="block text-[11px] font-mono uppercase text-slate mb-1">VO Number</label>
                <input
                  className={inputClass}
                  required
                  placeholder="e.g. VO-001"
                  value={variationForm.variation_number}
                  onChange={(e) => setVariationForm({ ...variationForm, variation_number: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-[11px] font-mono uppercase text-slate mb-1">Title</label>
                <input
                  className={inputClass}
                  required
                  placeholder="e.g. Additional retaining wall"
                  value={variationForm.title}
                  onChange={(e) => setVariationForm({ ...variationForm, title: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-mono uppercase text-slate mb-1">Cost Impact ($)</label>
                  <input
                    type="number"
                    className={inputClass}
                    required
                    value={variationForm.cost_impact}
                    onChange={(e) => setVariationForm({ ...variationForm, cost_impact: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-mono uppercase text-slate mb-1">Time Impact (Days)</label>
                  <input
                    type="number"
                    className={inputClass}
                    value={variationForm.time_impact_days}
                    onChange={(e) => setVariationForm({ ...variationForm, time_impact_days: e.target.value })}
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowVariationModal(false)} className="px-3 py-2 text-xs text-slate hover:text-paper">Cancel</button>
                <button type="submit" disabled={busy} className={buttonClass}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save Variation"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Progress Claim Modal */}
      {showClaimModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 backdrop-blur-sm">
          <div className="bg-ink-light border border-ink-mid w-full max-w-md p-6 rounded-lg space-y-4 shadow-2xl">
            <div className="flex justify-between items-center border-b border-ink-mid pb-3">
              <span className="text-sm font-semibold text-paper uppercase font-mono">Submit Progress Claim</span>
              <button type="button" onClick={() => setShowClaimModal(false)} className="text-slate hover:text-paper">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleClaimSubmit} className="space-y-3">
              <div>
                <label className="block text-[11px] font-mono uppercase text-slate mb-1">Claim Number</label>
                <input
                  className={inputClass}
                  required
                  placeholder="e.g. IPC-01"
                  value={claimForm.claim_number}
                  onChange={(e) => setClaimForm({ ...claimForm, claim_number: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-mono uppercase text-slate mb-1">Claim Amount ($)</label>
                  <input
                    type="number"
                    className={inputClass}
                    required
                    value={claimForm.this_claim_amount}
                    onChange={(e) => setClaimForm({ ...claimForm, this_claim_amount: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-mono uppercase text-slate mb-1">Retention %</label>
                  <input
                    type="number"
                    className={inputClass}
                    value={claimForm.retention_pct}
                    onChange={(e) => setClaimForm({ ...claimForm, retention_pct: e.target.value })}
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowClaimModal(false)} className="px-3 py-2 text-xs text-slate hover:text-paper">Cancel</button>
                <button type="submit" disabled={busy} className={buttonClass}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Submit Claim"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Budget Modal */}
      {showBudgetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 backdrop-blur-sm">
          <div className="bg-ink-light border border-ink-mid w-full max-w-md p-6 rounded-lg space-y-4 shadow-2xl">
            <div className="flex justify-between items-center border-b border-ink-mid pb-3">
              <span className="text-sm font-semibold text-paper uppercase font-mono">Set Project Budget Ceiling</span>
              <button type="button" onClick={() => setShowBudgetModal(false)} className="text-slate hover:text-paper">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleBudgetSubmit} className="space-y-3">
              <div>
                <label className="block text-[11px] font-mono uppercase text-slate mb-1">Total Budget Amount ($)</label>
                <input
                  type="number"
                  className={inputClass}
                  required
                  placeholder="e.g. 500000"
                  value={budgetForm.total_amount}
                  onChange={(e) => setBudgetForm({ ...budgetForm, total_amount: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-[11px] font-mono uppercase text-slate mb-1">Notes / Justification</label>
                <textarea
                  className={inputClass}
                  rows={3}
                  placeholder="Baseline budget rationale or revision details..."
                  value={budgetForm.notes}
                  onChange={(e) => setBudgetForm({ ...budgetForm, notes: e.target.value })}
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowBudgetModal(false)} className="px-3 py-2 text-xs text-slate hover:text-paper">Cancel</button>
                <button type="submit" disabled={busy} className={buttonClass}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save Budget"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
