"use client";

import type React from "react";
import { useMemo, useState } from "react";
import { AlertTriangle, Building2, ChevronDown, ChevronUp, FolderSearch, GitBranch, Plus, Search, Send, Wallet, X } from "lucide-react";
import { createFinanceProgressClaim, createFinanceVariation, setProjectBudget } from "@/lib/api";
import { Skeleton } from "@/components/ui/Skeleton";

type RecordData = Record<string, any>;

function money(value: unknown) {
  const num = typeof value === "number" ? value : Number(value);
  return new Intl.NumberFormat("en-ZW", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number.isFinite(num) ? num : 0);
}

function percent(value: unknown) {
  const num = typeof value === "number" ? value : Number(value);
  return `${Number.isFinite(num) ? num.toFixed(1) : "0.0"}%`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function actionError(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback;
}

const inputClass = "w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50";
const labelClass = "block text-[11px] font-mono uppercase tracking-wider text-slate mb-1";
const buttonClass = "inline-flex items-center gap-2 bg-signal text-ink font-semibold px-3 py-2 rounded-sm text-sm hover:bg-signal/95 disabled:opacity-50 disabled:cursor-not-allowed";
const ghostButtonClass = "inline-flex items-center gap-2 border border-ink-mid text-paper font-medium px-3 py-2 rounded-sm text-sm hover:border-signal/50 disabled:opacity-50";

function emptyBudgetForm() {
  return { total_amount: "", notes: "" };
}
function emptyVariationForm() {
  return { variation_number: "", title: "", description: "", cost_impact: "0", time_impact_days: "0", initiated_by: "client" as const };
}
function emptyClaimForm(contractValue?: unknown) {
  return { claim_number: "", claim_period_start: today(), claim_period_end: today(), contract_value: contractValue ? String(contractValue) : "0", this_claim_amount: "0", retention_pct: "10" };
}

/**
 * The single place to pick a project and accurately enter everything that
 * affects its financials - budget ceiling, variations, progress claims -
 * instead of hunting across separate tabs and modals, each of which makes
 * you re-pick the project from scratch.
 */
export function ProjectFinancialsWorkspace({
  projects,
  budgets,
  selectedProjectId,
  onSelectProject,
  projectDetail,
  detailLoading,
  onDataChanged,
}: {
  projects: RecordData[];
  budgets: RecordData[];
  selectedProjectId: string;
  onSelectProject: (id: string) => void;
  projectDetail: RecordData | null;
  detailLoading: boolean;
  onDataChanged: () => Promise<unknown>;
}) {
  const [projectSearch, setProjectSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; tone: "ok" | "error" } | null>(null);

  const [openSection, setOpenSection] = useState<"budget" | "variation" | "claim" | null>(null);
  const [budgetForm, setBudgetForm] = useState(emptyBudgetForm());
  const [variationForm, setVariationForm] = useState(emptyVariationForm());
  const [claimForm, setClaimForm] = useState(emptyClaimForm());

  const filteredProjects = useMemo(() => {
    const q = projectSearch.trim().toLowerCase();
    if (!q) return projects.slice(0, 30);
    return projects.filter((p) => `${p.name || ""} ${p.project_code || ""}`.toLowerCase().includes(q)).slice(0, 30);
  }, [projects, projectSearch]);

  const currentBudget = useMemo(
    () => budgets.filter((b) => b.project_id === selectedProjectId && b.status === "approved").sort((a, b) => (b.budget_version || 0) - (a.budget_version || 0))[0],
    [budgets, selectedProjectId]
  );

  const notify = (text: string, tone: "ok" | "error" = "ok") => setNotice({ text, tone });

  const toggleSection = (section: "budget" | "variation" | "claim") => {
    setOpenSection((prev) => (prev === section ? null : section));
    if (section === "budget") setBudgetForm({ total_amount: currentBudget ? String(currentBudget.total_amount ?? currentBudget.allocated_amount ?? "") : "", notes: "" });
    if (section === "claim") setClaimForm(emptyClaimForm(projectDetail?.contract_value));
  };

  const submitBudget = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedProjectId) return;
    setBusy(true);
    try {
      await setProjectBudget(selectedProjectId, Number(budgetForm.total_amount) || 0, budgetForm.notes || undefined);
      notify("Project budget set.");
      setOpenSection(null);
      await onDataChanged();
    } catch (err) {
      notify(actionError(err, "Failed to set project budget."), "error");
    } finally {
      setBusy(false);
    }
  };

  const submitVariation = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedProjectId || !variationForm.title) return;
    setBusy(true);
    try {
      await createFinanceVariation({
        ...variationForm,
        project_id: selectedProjectId,
        cost_impact: Number(variationForm.cost_impact) || 0,
        time_impact_days: Number(variationForm.time_impact_days) || 0,
      });
      notify("Variation recorded.");
      setVariationForm(emptyVariationForm());
      setOpenSection(null);
      await onDataChanged();
    } catch (err) {
      notify(actionError(err, "Failed to record variation."), "error");
    } finally {
      setBusy(false);
    }
  };

  const submitClaim = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedProjectId || !claimForm.claim_number) return;
    setBusy(true);
    try {
      await createFinanceProgressClaim({
        ...claimForm,
        project_id: selectedProjectId,
        contract_value: Number(claimForm.contract_value) || 0,
        this_claim_amount: Number(claimForm.this_claim_amount) || 0,
        retention_pct: Number(claimForm.retention_pct) || 0,
      });
      notify("Progress claim submitted.");
      setClaimForm(emptyClaimForm(projectDetail?.contract_value));
      setOpenSection(null);
      await onDataChanged();
    } catch (err) {
      notify(actionError(err, "Failed to submit progress claim."), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-ink-light border border-ink-mid p-5 rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)] space-y-4">
      <h2 className="text-sm font-semibold text-paper tracking-wider uppercase font-mono border-b border-ink-mid pb-3">Project Financials</h2>

      <div className="relative">
        <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate" />
        <input
          className={`${inputClass} pl-8 pr-8`}
          placeholder="Search a project to enter its financials..."
          value={projectSearch}
          onChange={(e) => setProjectSearch(e.target.value)}
        />
        {projectSearch && (
          <button onClick={() => setProjectSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate hover:text-paper transition-colors duration-micro" title="Clear search">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
        {projectSearch && (
          <div className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto bg-ink-light border border-ink-mid rounded shadow-lg animate-in fade-in slide-in-from-top-1 duration-fast">
            {filteredProjects.length === 0 ? (
              <p className="text-xs text-slate p-3">No matching projects.</p>
            ) : (
              filteredProjects.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => { onSelectProject(p.id); setProjectSearch(""); }}
                  className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm text-paper hover:bg-ink-mid/30 transition-colors duration-micro"
                >
                  <Building2 className="h-3.5 w-3.5 text-slate flex-shrink-0" />
                  <span className="truncate">{p.name}</span>
                  {p.project_code && <span className="text-slate-light font-mono text-xs ml-auto flex-shrink-0">{p.project_code}</span>}
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {!selectedProjectId && !projectSearch && (
        <select className={inputClass} value={selectedProjectId} onChange={(e) => onSelectProject(e.target.value)}>
          <option value="">Or pick from the list</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      )}

      {detailLoading ? (
        <div className="space-y-4 animate-in fade-in duration-fast">
          <div className="flex items-center justify-between">
            <div className="space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-20" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 border-t border-b border-ink-mid py-4 my-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-2.5 w-24" />
                <Skeleton className="h-4 w-16" />
              </div>
            ))}
          </div>
          <Skeleton className="h-1.5 w-full rounded-full" />
          <Skeleton className="h-1.5 w-full rounded-full" />
        </div>
      ) : !selectedProjectId ? (
        <div className="flex flex-col items-center justify-center text-center py-10">
          <div className="h-10 w-10 rounded-full bg-ink-mid/40 flex items-center justify-center mb-3">
            <FolderSearch className="h-4.5 w-4.5 text-slate" />
          </div>
          <p className="text-sm text-paper font-medium">No project selected</p>
          <p className="text-xs text-slate mt-1 max-w-xs">Search or pick a project above to view and enter its budget, variations, and progress claims.</p>
        </div>
      ) : (
        <div className="space-y-4 animate-in fade-in duration-fast">
          {projectDetail && (
            <div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-signal/15 text-signal">
                    <Building2 className="h-4 w-4" />
                  </span>
                  <div>
                    <h3 className="text-base font-semibold text-paper">{projectDetail.project_name}</h3>
                    <p className="text-xs text-slate-light font-mono mt-0.5">{projectDetail.project_code || "Code unassigned"}</p>
                  </div>
                </div>
                <button type="button" onClick={() => onSelectProject("")} className="text-slate hover:text-paper transition-colors duration-micro" title="Clear selection">
                  <X className="h-4 w-4" />
                </button>
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

              <div className="space-y-3">
                <div>
                  <div className="flex justify-between text-xs font-mono text-slate mb-1">
                    <span>Budget Spent</span>
                    <span>{percent((Number(projectDetail.actual_cost_to_date || 0) / Number(projectDetail.approved_budget || 1)) * 100)}</span>
                  </div>
                  <div className="w-full bg-ink h-1.5 rounded-full overflow-hidden">
                    <div className="bg-signal h-full transition-all duration-slow ease-snc" style={{ width: `${Math.min(100, (Number(projectDetail.actual_cost_to_date || 0) / Number(projectDetail.approved_budget || 1)) * 100)}%` }} />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-xs font-mono text-slate mb-1">
                    <span>Cash collection efficiency</span>
                    <span>{percent((Number(projectDetail.cash_collected || 0) / Number(projectDetail.certified_to_date || 1)) * 100)}</span>
                  </div>
                  <div className="w-full bg-ink h-1.5 rounded-full overflow-hidden">
                    <div className="bg-emerald-500 h-full transition-all duration-slow ease-snc" style={{ width: `${Math.min(100, (Number(projectDetail.cash_collected || 0) / Number(projectDetail.certified_to_date || 1)) * 100)}%` }} />
                  </div>
                </div>
              </div>

              {(projectDetail.cost_overrun_risk || projectDetail.cashflow_deficit_risk) && (
                <div className="bg-red-950/20 border border-red-500/30 p-3 rounded flex items-start space-x-3 mt-4 animate-in fade-in slide-in-from-top-1 duration-fast">
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
          )}

          {notice && (
            <div className={`border px-3 py-2 text-xs flex justify-between items-center rounded animate-in fade-in slide-in-from-top-1 duration-fast ${notice.tone === "error" ? "border-red-500/30 bg-red-950/20 text-red-300" : "border-signal/30 bg-signal/10 text-paper"}`}>
              <span>{notice.text}</span>
              <button onClick={() => setNotice(null)} className="hover:opacity-70"><X className="h-3 w-3" /></button>
            </div>
          )}

          <div className="space-y-2">
            <ActionSection
              icon={Wallet}
              label="Project budget"
              hint={currentBudget ? `Current: ${money(currentBudget.total_amount ?? currentBudget.allocated_amount)} (v${currentBudget.budget_version})` : "No budget set yet"}
              badge={currentBudget ? { text: "set", tone: "ok" as const } : { text: "unset", tone: "warn" as const }}
              open={openSection === "budget"}
              onToggle={() => toggleSection("budget")}
            >
              <form onSubmit={submitBudget} className="space-y-3">
                <div>
                  <label className={labelClass}>Total budget ceiling</label>
                  <input className={inputClass} type="number" min="0" step="0.01" required value={budgetForm.total_amount} onChange={(e) => setBudgetForm({ ...budgetForm, total_amount: e.target.value })} />
                </div>
                <div>
                  <label className={labelClass}>Notes</label>
                  <textarea className={`${inputClass} h-16`} placeholder="Basis for this budget..." value={budgetForm.notes} onChange={(e) => setBudgetForm({ ...budgetForm, notes: e.target.value })} />
                </div>
                <button disabled={busy} className={buttonClass}><Wallet className="h-4 w-4" />Set Budget</button>
              </form>
            </ActionSection>

            <ActionSection icon={GitBranch} label="Record a variation" hint="Change order affecting cost or time" open={openSection === "variation"} onToggle={() => toggleSection("variation")}>
              <form onSubmit={submitVariation} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelClass}>VO number</label>
                    <input className={inputClass} placeholder="e.g. VO-001" required value={variationForm.variation_number} onChange={(e) => setVariationForm({ ...variationForm, variation_number: e.target.value })} />
                  </div>
                  <div>
                    <label className={labelClass}>Initiated by</label>
                    <select className={inputClass} value={variationForm.initiated_by} onChange={(e) => setVariationForm({ ...variationForm, initiated_by: e.target.value as any })}>
                      <option value="client">Client</option>
                      <option value="contractor">Contractor</option>
                      <option value="designer">Designer</option>
                      <option value="statutory">Statutory</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className={labelClass}>Title</label>
                  <input className={inputClass} placeholder="Additional earthworks scope" required value={variationForm.title} onChange={(e) => setVariationForm({ ...variationForm, title: e.target.value })} />
                </div>
                <div>
                  <label className={labelClass}>Description</label>
                  <textarea className={`${inputClass} h-16`} placeholder="Full scope and design modifications..." value={variationForm.description} onChange={(e) => setVariationForm({ ...variationForm, description: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelClass}>Cost impact ($)</label>
                    <input className={inputClass} type="number" value={variationForm.cost_impact} onChange={(e) => setVariationForm({ ...variationForm, cost_impact: e.target.value })} />
                  </div>
                  <div>
                    <label className={labelClass}>Time impact (days)</label>
                    <input className={inputClass} type="number" value={variationForm.time_impact_days} onChange={(e) => setVariationForm({ ...variationForm, time_impact_days: e.target.value })} />
                  </div>
                </div>
                <button disabled={busy} className={buttonClass}><Plus className="h-4 w-4" />Submit Variation</button>
              </form>
            </ActionSection>

            <ActionSection icon={Send} label="Submit a progress claim" hint="Certify and bill completed work" open={openSection === "claim"} onToggle={() => toggleSection("claim")}>
              <form onSubmit={submitClaim} className="space-y-3">
                <div>
                  <label className={labelClass}>Claim number</label>
                  <input className={inputClass} placeholder="e.g. PC-001" required value={claimForm.claim_number} onChange={(e) => setClaimForm({ ...claimForm, claim_number: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelClass}>Period start</label>
                    <input className={inputClass} type="date" required value={claimForm.claim_period_start} onChange={(e) => setClaimForm({ ...claimForm, claim_period_start: e.target.value })} />
                  </div>
                  <div>
                    <label className={labelClass}>Period end</label>
                    <input className={inputClass} type="date" required value={claimForm.claim_period_end} onChange={(e) => setClaimForm({ ...claimForm, claim_period_end: e.target.value })} />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className={labelClass}>Contract value</label>
                    <input className={inputClass} type="number" min="0" step="0.01" value={claimForm.contract_value} onChange={(e) => setClaimForm({ ...claimForm, contract_value: e.target.value })} />
                  </div>
                  <div>
                    <label className={labelClass}>Claim amount</label>
                    <input className={inputClass} type="number" min="0.01" step="0.01" required value={claimForm.this_claim_amount} onChange={(e) => setClaimForm({ ...claimForm, this_claim_amount: e.target.value })} />
                  </div>
                  <div>
                    <label className={labelClass}>Retention %</label>
                    <input className={inputClass} type="number" min="0" max="100" step="0.1" value={claimForm.retention_pct} onChange={(e) => setClaimForm({ ...claimForm, retention_pct: e.target.value })} />
                  </div>
                </div>
                <button disabled={busy} className={buttonClass}><Send className="h-4 w-4" />Submit Claim</button>
              </form>
            </ActionSection>
          </div>
        </div>
      )}
    </div>
  );
}

function ActionSection({
  icon: Icon,
  label,
  hint,
  badge,
  open,
  onToggle,
  children,
}: {
  icon: any;
  label: string;
  hint: string;
  badge?: { text: string; tone: "ok" | "warn" };
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className={`border rounded overflow-hidden transition-colors duration-micro ${open ? "border-signal/40" : "border-ink-mid"}`}>
      <button type="button" onClick={onToggle} className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-ink-mid/20 transition-colors duration-micro">
        <span className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-ink-mid/40 text-slate">
          <Icon className="h-4 w-4" />
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm text-paper font-medium">{label}</p>
            {badge && (
              <span className={`px-1.5 py-0.5 rounded-sm text-[9px] uppercase tracking-wider font-mono border ${badge.tone === "ok" ? "border-emerald-500/30 bg-emerald-950/20 text-emerald-300" : "border-amber-500/30 bg-amber-950/20 text-amber-300"}`}>
                {badge.text}
              </span>
            )}
          </div>
          <p className="text-[11px] text-slate-light mt-0.5 truncate">{hint}</p>
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-slate flex-shrink-0" /> : <ChevronDown className="h-4 w-4 text-slate flex-shrink-0" />}
      </button>
      {open && <div className="border-t border-ink-mid p-3 bg-ink/30 animate-in fade-in slide-in-from-top-1 duration-fast">{children}</div>}
    </div>
  );
}
