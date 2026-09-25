"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  BriefcaseBusiness,
  Loader2,
  MapPin,
  Package,
  ShieldCheck,
  X,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Activity,
  CheckCircle2,
  AlertCircle,
  Hammer,
  Sliders,
  Plus,
  Info as InfoIcon,
  ClipboardCheck,
  Trash2,
  Users,
  FileText,
  Receipt,
  Banknote,
  Save,
  Calculator,
  UserPlus,
  Send,
  Pencil,
  Check
} from "lucide-react";
import {
  updateInternalProject,
  submitProjectRegistration, decideProjectRegistration, setProjectBudget, confirmProjectDeposit,
  deleteInternalProject, getProjectDeleteImpact, updateProjectIntake, commitProjectIntake, getProjectLifecycle, addProjectMilestone,
  updateProjectMilestone, getAssignableUsers, getAssignment, getProductionExpenses, addProductionExpense,
  getProductionRevenue, addProductionRevenue,
  updateProjectPreMobilisationCheck, approveProjectPreMobilisation,
  getProjectCommercialReadiness, updateProjectCommercialReadiness, clearProjectCommercialReadiness,
  getHRAttendance, getProcurementRfqs, getSiteGrns, getSiteVariances, getFinanceVariations, getFinanceBudgets, getBoqProgressSummary,
  getHREmployees, getWorkforceAllocations, createWorkforceAllocation, createDailySiteReport, createFinanceVariation,
  getFinanceProgressClaims, createFinanceProgressClaim,
  getFinanceProjectDetail, getProjectPettyCash, openProjectPettyCash, postPettyCashSpend, postPettyCashReplenish, closeProjectPettyCash,
  getProjectTeam, type ProjectTeamMember,
  importBoqFile,
} from "@/lib/api";
import { useAuth } from "@/lib/auth/AuthContext";
import { formatCurrency, formatDate, runWithConcurrencyLimit } from "@/lib/utils";
import { PROVINCES } from "@/lib/constants";
import { EntityDocumentsPanel } from "@/components/documents/EntityDocumentsPanel";
import { AssignmentPanel } from "@/components/documents/AssignmentPanel";
import {
  FINANCE_SIGNOFF_ROLES, COMMERCIAL_READINESS_ROLES, riskStatuses,
  text, number, title, codePrefix, contactLabel, percent, Metric,
  type Project, type Department, type ClientOrganization, type ClientContact, type Detail,
  type PreMobilisationCheck, type PreMobilisationReadiness, type CommercialReadinessControl, type CommercialReadiness,
  type ProjectTab, type ProjectCommand,
} from "./page";

// A single inline field-save (client link, department, name, ...) failing
// outright on one transient blip - a slow request racing DB pool pressure,
// a dropped connection - shouldn't force the user to notice, diagnose and
// retry it themselves. One silent retry after a short pause absorbs that
// class of failure; a second failure is treated as real and surfaced with
// the backend's own error detail instead of a generic string, so a genuine
// failure is still actionable rather than a dead end.
async function withOneRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 800));
    return fn();
  }
}

function Evidence({ label, items }: { label: string; items?: Record<string, unknown>[] }) {
  return (
    <div className="border border-ink-mid p-3 bg-ink-light/20">
      <div className="flex justify-between gap-4">
        <p className="font-mono text-[10px] uppercase tracking-wider text-slate">{label}</p>
        <span className="font-mono text-xs text-paper">{items?.length ?? 0}</span>
      </div>
      <p className="mt-2 text-xs text-slate-light">
        {items?.length ? "Records are available in the ERP detail endpoint." : "No records returned."}
      </p>
    </div>
  ); 
}

function Info({ label, value }: { label: string; value: string }) { 
  return (
    <div className="border border-ink-mid p-3 bg-ink-light/20">
      <p className="font-mono text-[10px] uppercase tracking-wider text-slate">{label}</p>
      <p className="mt-1 text-sm text-paper font-medium">{value}</p>
    </div>
  ); 
}

const PROJECT_CATEGORY_LABELS: Record<string, string> = {
  construction: "Construction",
  plant: "Plant",
  commercial: "Commercial",
};

const COST_CATEGORY_OPTIONS = ["labour", "equipment", "materials", "subcontract", "overhead", "other"] as const;

function ProductionIntakePanel({ project, onRefresh }: { project: Record<string, unknown>; onRefresh: () => void }) {
  const projectId = String(project.id ?? "");
  const committed = Boolean(project.intake_completed_at);
  const isActive = text(project.status as string | undefined, "").toLowerCase() === "active";

  const [category, setCategory] = useState(text(project.project_category as string | undefined, ""));
  const [investment, setInvestment] = useState(project.investment_required != null ? String(project.investment_required) : "");
  const [fundingInternal, setFundingInternal] = useState(project.funding_internal != null ? String(project.funding_internal) : "");
  const [fundingExternal, setFundingExternal] = useState(project.funding_external != null ? String(project.funding_external) : "");
  const [durationValue, setDurationValue] = useState(project.setup_duration_weeks != null ? String(project.setup_duration_weeks) : "");
  const [saving, setSaving] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const investmentNum = number(investment);
  const totalFunding = (number(fundingInternal) ?? 0) + (number(fundingExternal) ?? 0);
  const gap = investmentNum != null ? investmentNum - totalFunding : null;
  const coveragePct = investmentNum ? (totalFunding / investmentNum) * 100 : null;
  const durationWeeks = number(durationValue);

  const targetProductionStart = useMemo(() => {
    const startRaw = project.start_date as string | undefined;
    if (!startRaw || !durationWeeks) return null;
    const start = new Date(startRaw);
    if (Number.isNaN(start.getTime())) return null;
    const target = new Date(start);
    target.setDate(target.getDate() + durationWeeks * 7);
    return target;
  }, [project.start_date, durationWeeks]);

  const save = async () => {
    setSaving(true); setMsg(null);
    try {
      await updateProjectIntake(projectId, {
        project_category: category || undefined,
        investment_required: investment ? Number(investment) : undefined,
        funding_internal: fundingInternal ? Number(fundingInternal) : undefined,
        funding_external: fundingExternal ? Number(fundingExternal) : undefined,
        setup_duration_weeks: durationValue ? Number(durationValue) : undefined,
      });
      setMsg("Saved.");
      onRefresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed to save intake.");
    } finally {
      setSaving(false);
    }
  };

  const commit = async () => {
    if (!category || investmentNum == null) { setMsg("Set the project category and required investment before committing."); return; }
    if (!window.confirm("Commit this intake? Tasks will be generated and the questionnaire will lock.")) return;
    setCommitting(true); setMsg(null);
    try {
      const res = await commitProjectIntake(projectId);
      setMsg(`Committed - ${res.data?.tasks_created ?? 0} tasks generated.`);
      onRefresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed to commit intake.");
    } finally {
      setCommitting(false);
    }
  };

  return (
    <div className="border border-signal/30 bg-signal/5 p-4 rounded-sm space-y-4">
      <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-signal">Production Project Setup</h3>
      <p className="text-xs text-slate-light">
        This is a Company-initiated project - not commissioned by a client. Classify it, size the investment, and say how long setup will take. Nothing gets assigned to anyone until you commit - after that, this is also where you log setup spend and, once active, the revenue it brings in.
      </p>

      <fieldset disabled={committed} className="space-y-4 disabled:opacity-70">
        <div className="grid gap-3 sm:grid-cols-3">
          {(["construction", "plant", "commercial"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setCategory(value)}
              className={`h-10 border font-mono text-xs uppercase tracking-wider ${category === value ? "border-signal bg-signal/20 text-signal" : "border-ink-mid bg-ink-light text-slate-light hover:text-paper"}`}
            >
              {PROJECT_CATEGORY_LABELS[value]}
            </button>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-slate">Investment required ($)</label>
            <input value={investment} onChange={(e) => setInvestment(e.target.value)} type="number" min="0" className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
          </div>
          <div>
            <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-slate">Internal funding ($)</label>
            <input value={fundingInternal} onChange={(e) => setFundingInternal(e.target.value)} type="number" min="0" className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
          </div>
          <div>
            <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-slate">External funding ($)</label>
            <input value={fundingExternal} onChange={(e) => setFundingExternal(e.target.value)} type="number" min="0" className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
          </div>
        </div>

        <div>
          <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-slate">Setup duration (weeks) - how long to stand this up and begin production</label>
          <input value={durationValue} onChange={(e) => setDurationValue(e.target.value)} type="number" min="1" className="h-10 w-full max-w-[200px] border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
        </div>
      </fieldset>

      <div className="grid gap-3 border-t border-ink-mid/50 pt-3 sm:grid-cols-4">
        <Info label="Total funding" value={formatCurrency(totalFunding)} />
        <Info label="Funding gap" value={gap != null ? formatCurrency(gap) : "—"} />
        <Info label="Coverage" value={coveragePct != null ? `${coveragePct.toFixed(0)}%` : "—"} />
        <Info label="Target production start" value={targetProductionStart ? formatDate(targetProductionStart.toISOString()) : "—"} />
      </div>

      {!committed && (
        <div className="flex justify-end gap-2 border-t border-ink-mid/50 pt-3">
          <button onClick={() => void save()} disabled={saving} className="h-10 border border-ink-mid bg-ink-light px-4 font-mono text-xs uppercase tracking-wider text-slate-light hover:text-paper disabled:opacity-50">
            {saving ? "Saving..." : "Save Progress"}
          </button>
          <button onClick={() => void commit()} disabled={committing || !category || investmentNum == null} className="h-10 bg-signal px-4 font-mono text-xs font-bold uppercase text-ink disabled:opacity-50">
            {committing ? "Committing..." : "Commit - Generate Tasks"}
          </button>
        </div>
      )}

      {msg && <p className="text-xs text-slate-light">{msg}</p>}

      <div className="border-t border-ink-mid/50 pt-4">
        <ProductionExpensesSection projectId={projectId} />
      </div>

      <div className="border-t border-ink-mid/50 pt-4">
        <ProductionRevenueSection projectId={projectId} isActive={isActive} />
      </div>
    </div>
  );
}

function ProductionExpensesSection({ projectId }: { projectId: string }) {
  const [items, setItems] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ cost_category: "materials", description: "", amount: "", transaction_date: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getProductionExpenses(projectId);
      setItems(res.data?.items ?? []);
      setTotal(number(res.data?.total) ?? 0);
    } catch {
      // Non-fatal - panel still usable for recording new spend.
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  const submit = async () => {
    if (!form.description.trim() || !form.amount) { setError("Description and amount are required."); return; }
    setBusy(true); setError(null);
    try {
      await addProductionExpense(projectId, {
        cost_category: form.cost_category,
        description: form.description.trim(),
        amount: Number(form.amount),
        transaction_date: form.transaction_date || undefined,
      });
      setForm({ cost_category: "materials", description: "", amount: "", transaction_date: "" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to record expense.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="font-mono text-xs font-bold uppercase tracking-wider text-paper">Setup Expenses</h4>
        <span className="font-mono text-xs text-amber-300">{formatCurrency(total)} spent</span>
      </div>
      <p className="text-xs text-slate-light">Spend incurred standing this project up - posts straight into Finance.</p>

      {loading ? (
        <p className="text-xs text-slate-light">Loading...</p>
      ) : items.length ? (
        <div className="max-h-40 overflow-y-auto border border-ink-mid/50">
          <table className="w-full text-xs">
            <tbody className="divide-y divide-ink-mid/40">
              {items.map((item, i) => (
                <tr key={String(item.id ?? i)}>
                  <td className="p-2 text-slate-light">{formatDate(text(item.transaction_date as string, ""))}</td>
                  <td className="p-2 text-paper">{text(item.description as string)}</td>
                  <td className="p-2 text-slate-light">{text(item.cost_category as string)}</td>
                  <td className="p-2 text-right text-amber-300">{formatCurrency(number(item.amount) ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-xs text-slate">No setup expenses recorded yet.</p>
      )}

      <div className="grid gap-2 sm:grid-cols-4">
        <select value={form.cost_category} onChange={(e) => setForm((f) => ({ ...f, cost_category: e.target.value }))} className="h-9 border border-ink-mid bg-ink-light px-2 text-xs text-paper">
          {COST_CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Description" className="h-9 border border-ink-mid bg-ink-light px-2 text-xs text-paper sm:col-span-2" />
        <input value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} type="number" min="0" placeholder="Amount ($)" className="h-9 border border-ink-mid bg-ink-light px-2 text-xs text-paper" />
      </div>
      <div className="flex items-center gap-2">
        <input value={form.transaction_date} onChange={(e) => setForm((f) => ({ ...f, transaction_date: e.target.value }))} type="date" className="h-9 border border-ink-mid bg-ink-light px-2 text-xs text-paper" />
        <button onClick={() => void submit()} disabled={busy} className="h-9 border border-ink-mid bg-ink-light px-3 font-mono text-[10px] uppercase tracking-wider text-slate-light hover:text-paper disabled:opacity-50">
          {busy ? "Recording..." : "Record Expense"}
        </button>
      </div>
      {error && <p className="text-xs text-red-300">{error}</p>}
    </div>
  );
}

function ProductionRevenueSection({ projectId, isActive }: { projectId: string; isActive: boolean }) {
  const [items, setItems] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ description: "", amount: "", transaction_date: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isActive) { setLoading(false); return; }
    setLoading(true);
    try {
      const res = await getProductionRevenue(projectId);
      setItems(res.data?.items ?? []);
      setTotal(number(res.data?.total) ?? 0);
    } catch {
      // Non-fatal.
    } finally {
      setLoading(false);
    }
  }, [projectId, isActive]);

  useEffect(() => { void load(); }, [load]);

  const submit = async () => {
    if (!form.amount) { setError("Amount is required."); return; }
    setBusy(true); setError(null);
    try {
      await addProductionRevenue(projectId, {
        amount: Number(form.amount),
        description: form.description.trim() || undefined,
        transaction_date: form.transaction_date || undefined,
      });
      setForm({ description: "", amount: "", transaction_date: "" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to record revenue.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="font-mono text-xs font-bold uppercase tracking-wider text-paper">Production Revenue</h4>
        {isActive && <span className="font-mono text-xs text-emerald-300">{formatCurrency(total)} earned</span>}
      </div>

      {!isActive ? (
        <p className="border border-ink-mid/50 bg-ink-light/20 p-3 text-xs text-slate-light">
          Revenue recording unlocks once this project is active - move it to &quot;Active&quot; on the project pipeline.
        </p>
      ) : (
        <>
          <p className="text-xs text-slate-light">What this project sells, as it sells it - no client or contract behind it, straight into the cashbook.</p>
          {loading ? (
            <p className="text-xs text-slate-light">Loading...</p>
          ) : items.length ? (
            <div className="max-h-40 overflow-y-auto border border-ink-mid/50">
              <table className="w-full text-xs">
                <tbody className="divide-y divide-ink-mid/40">
                  {items.map((item, i) => (
                    <tr key={String(item.id ?? i)}>
                      <td className="p-2 text-slate-light">{formatDate(text(item.transaction_date as string, ""))}</td>
                      <td className="p-2 text-paper">{text(item.description as string)}</td>
                      <td className="p-2 text-right text-emerald-300">{formatCurrency(number(item.amount) ?? 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-xs text-slate">No revenue recorded yet.</p>
          )}

          <div className="grid gap-2 sm:grid-cols-3">
            <input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Description (optional)" className="h-9 border border-ink-mid bg-ink-light px-2 text-xs text-paper" />
            <input value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} type="number" min="0" placeholder="Amount ($)" className="h-9 border border-ink-mid bg-ink-light px-2 text-xs text-paper" />
            <input value={form.transaction_date} onChange={(e) => setForm((f) => ({ ...f, transaction_date: e.target.value }))} type="date" className="h-9 border border-ink-mid bg-ink-light px-2 text-xs text-paper" />
          </div>
          <button onClick={() => void submit()} disabled={busy} className="h-9 border border-emerald-500/40 bg-emerald-500/10 px-3 font-mono text-[10px] uppercase tracking-wider text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50">
            {busy ? "Recording..." : "Record Revenue"}
          </button>
          {error && <p className="text-xs text-red-300">{error}</p>}
        </>
      )}
    </div>
  );
}

function FieldIntakePanel({ project, isFinance, onRefresh }: { project: Record<string, unknown>; isFinance: boolean; onRefresh: () => void }) {
  const isFieldIntake = project.status === "field_intake";
  const isPendingDeposit = project.status === "pending_deposit";
  const [form, setForm] = useState({ client_name: "", contract_value: "", start_date: "", project_code: "", initial_percent_complete: "", initial_costs_incurred: "" });
  const [budgetAmount, setBudgetAmount] = useState("");
  const [depositReference, setDepositReference] = useState("");
  const [depositReceivedAmount, setDepositReceivedAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const projectId = String(project.id ?? "");

  const confirmDeposit = async () => {
    const amount = Number(depositReceivedAmount);
    if (!depositReceivedAmount || !Number.isFinite(amount) || amount <= 0) {
      setMsg("Enter the deposit amount actually received before confirming.");
      return;
    }
    setBusy(true); setMsg(null);
    try {
      await confirmProjectDeposit(projectId, {
        deposit_received_amount: amount,
        deposit_reference: depositReference || undefined,
      });
      setMsg("Deposit confirmed. Pre-mobilisation gate opened.");
      setDepositReference("");
      setDepositReceivedAmount("");
      onRefresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed to confirm deposit.");
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    setBusy(true); setMsg(null);
    try {
      await submitProjectRegistration(projectId, {
        client_name: form.client_name || undefined,
        contract_value: form.contract_value ? Number(form.contract_value) : undefined,
        start_date: form.start_date || undefined,
        project_code: form.project_code || undefined,
        initial_percent_complete: form.initial_percent_complete ? Number(form.initial_percent_complete) : undefined,
        initial_costs_incurred: form.initial_costs_incurred ? Number(form.initial_costs_incurred) : undefined,
      });
      setSubmitted(true);
      setMsg("Submitted for Finance sign-off.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed to submit for registration.");
    } finally {
      setBusy(false);
    }
  };

  const decide = async (decision: "approved" | "rejected") => {
    setBusy(true); setMsg(null);
    try {
      await decideProjectRegistration(projectId, decision, decision === "rejected" ? "Not approved" : undefined);
      setMsg(decision === "approved" ? "Project registered." : "Registration rejected.");
      onRefresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed to record decision.");
    } finally {
      setBusy(false);
    }
  };

  const submitBudget = async () => {
    if (!budgetAmount) return;
    setBusy(true); setMsg(null);
    try {
      await setProjectBudget(projectId, Number(budgetAmount));
      setMsg("Budget set.");
      setBudgetAmount("");
      onRefresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed to set budget.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border border-signal/30 bg-signal/5 p-4 rounded-sm space-y-4">
      <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-signal">
        {isPendingDeposit ? "Deposit Confirmation" : "Field Intake Registration"}
      </h3>

      {isFieldIntake && !submitted && (
        <div className="grid gap-3 sm:grid-cols-2">
          <input value={form.client_name} onChange={(e) => set("client_name", e.target.value)} placeholder="Client name" className="h-10 border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
          <input value={form.contract_value} onChange={(e) => set("contract_value", e.target.value)} type="number" placeholder="Contract value ($)" className="h-10 border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
          <input value={form.start_date} onChange={(e) => set("start_date", e.target.value)} type="date" placeholder="Real start date" className="h-10 border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
          <input value={form.project_code} onChange={(e) => set("project_code", e.target.value)} placeholder="Project code (optional)" className="h-10 border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
          <div className="sm:col-span-2 border-t border-ink-mid/50 pt-3">
            <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-slate">Already underway? Capture where it stands (optional)</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <input value={form.initial_percent_complete} onChange={(e) => set("initial_percent_complete", e.target.value)} type="number" min="0" max="100" placeholder="Percent complete so far (%)" className="h-10 border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
              <input value={form.initial_costs_incurred} onChange={(e) => set("initial_costs_incurred", e.target.value)} type="number" min="0" placeholder="Costs already incurred ($)" className="h-10 border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
            </div>
          </div>
          <button onClick={submit} disabled={busy} className="sm:col-span-2 h-10 bg-signal font-mono text-xs font-bold uppercase text-ink disabled:opacity-50">
            Submit for Finance Sign-off
          </button>
        </div>
      )}

      {isFieldIntake && submitted && (
        <p className="text-xs text-slate-light">Awaiting Finance sign-off.</p>
      )}

      {isFieldIntake && isFinance && (
        <div className="flex gap-3 border-t border-ink-mid/50 pt-3">
          <button onClick={() => decide("approved")} disabled={busy} className="h-9 border border-emerald-500/40 bg-emerald-950/20 px-3 font-mono text-xs uppercase text-emerald-300 disabled:opacity-50">
            Approve & Register
          </button>
          <button onClick={() => decide("rejected")} disabled={busy} className="h-9 border border-red-500/40 bg-red-950/20 px-3 font-mono text-xs uppercase text-red-300 disabled:opacity-50">
            Reject
          </button>
        </div>
      )}

      {isPendingDeposit && (
        <div className="border-t border-ink-mid/50 pt-3">
          <p className="mb-2 text-xs text-slate-light">
            This project was created from a won deal and is pending deposit confirmation. Once Finance confirms receipt, it moves into the pre-mobilisation readiness gate before active delivery.
          </p>
          {isFinance ? (
            <div className="flex items-end gap-3">
              <div>
                <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate">Amount received ($)</label>
                <input value={depositReceivedAmount} onChange={(e) => setDepositReceivedAmount(e.target.value)} type="number" min="0.01" step="0.01" required placeholder="0.00" className="h-10 w-40 border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
              </div>
              <div className="flex-1">
                <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate">Deposit Reference (EFT/receipt number)</label>
                <input value={depositReference} onChange={(e) => setDepositReference(e.target.value)} placeholder="Optional reference" className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
              </div>
              <button onClick={confirmDeposit} disabled={busy || !depositReceivedAmount} className="h-10 bg-emerald-500 px-4 font-mono text-xs font-bold uppercase text-ink disabled:opacity-50">
                Confirm Deposit Received
              </button>
            </div>
          ) : (
            <p className="text-xs text-amber-300">Awaiting Finance deposit confirmation.</p>
          )}
        </div>
      )}

      {!isFieldIntake && !isPendingDeposit && isFinance && (
        <div className="flex items-end gap-3 border-t border-ink-mid/50 pt-3">
          <div className="flex-1">
            <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate">Set Execution Budget ($)</label>
            <input value={budgetAmount} onChange={(e) => setBudgetAmount(e.target.value)} type="number" placeholder="Total budget ceiling" className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
          </div>
          <button onClick={submitBudget} disabled={busy || !budgetAmount} className="h-10 bg-signal px-4 font-mono text-xs font-bold uppercase text-ink disabled:opacity-50">
            Set Budget
          </button>
        </div>
      )}

      {msg && <p className="text-xs text-slate-light">{msg}</p>}
    </div>
  );
}

function CommercialReadinessPanel({
  project,
  readiness,
  canManage,
  onRefresh,
}: {
  project: Project;
  readiness?: CommercialReadiness;
  canManage: boolean;
  onRefresh: () => void;
}) {
  const projectId = String(project.id ?? "");
  const [current, setCurrent] = useState<CommercialReadiness | undefined>(readiness);
  const [controls, setControls] = useState<Record<string, boolean>>({});
  const [authorityStatus, setAuthorityStatus] = useState("");
  const [statement, setStatement] = useState({
    authority_relied_upon: "",
    approved_contract_value: "",
    approved_commercial_baseline: "",
    expected_margin: "",
    mobilisation_budget: "",
    peak_working_capital_requirement: "",
    payment_and_retention_conditions: "",
    major_commercial_risks: "",
    outstanding_conditions: "",
    temporary_controls: "",
    named_risk_owners: "",
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    setCurrent(readiness);
  }, [readiness]);

  useEffect(() => {
    const next: Record<string, boolean> = {};
    for (const control of current?.controls ?? []) {
      next[control.key] = Boolean(control.complete);
    }
    setControls(next);
    setAuthorityStatus(String(current?.authority_status ?? current?.pack?.authority_status ?? ""));
  }, [current]);

  const refreshCommercial = async () => {
    if (!projectId) return;
    try {
      const res = await getProjectCommercialReadiness(projectId);
      setCurrent(res.data as CommercialReadiness);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Commercial readiness is unavailable.");
    }
  };

  const save = async () => {
    setBusy("save"); setMsg(null);
    try {
      const res = await updateProjectCommercialReadiness(projectId, {
        readiness_pack: controls,
        authority_status: authorityStatus || undefined,
      });
      setCurrent(res.data as CommercialReadiness);
      setMsg("Commercial readiness saved.");
      onRefresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed to save Commercial readiness.");
    } finally {
      setBusy(null);
    }
  };

  const lines = (value: string) => value.split("\n").map((line) => line.trim()).filter(Boolean);
  const numberOrUndefined = (value: string) => value ? Number(value) : undefined;

  const clear = async () => {
    if (!statement.authority_relied_upon.trim()) {
      setMsg("Authority relied upon is required.");
      return;
    }
    setBusy("clear"); setMsg(null);
    try {
      const res = await clearProjectCommercialReadiness(projectId, {
        authority_relied_upon: statement.authority_relied_upon,
        approved_contract_value: numberOrUndefined(statement.approved_contract_value),
        approved_commercial_baseline: statement.approved_commercial_baseline || undefined,
        expected_margin: numberOrUndefined(statement.expected_margin),
        mobilisation_budget: numberOrUndefined(statement.mobilisation_budget),
        peak_working_capital_requirement: numberOrUndefined(statement.peak_working_capital_requirement),
        payment_and_retention_conditions: statement.payment_and_retention_conditions || undefined,
        major_commercial_risks: lines(statement.major_commercial_risks),
        outstanding_conditions: lines(statement.outstanding_conditions),
        temporary_controls: lines(statement.temporary_controls),
        named_risk_owners: lines(statement.named_risk_owners),
      });
      setCurrent(res.data as CommercialReadiness);
      setMsg("Commercial readiness cleared.");
      onRefresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed to clear Commercial readiness.");
    } finally {
      setBusy(null);
    }
  };

  const controlsList = current?.controls ?? [];
  const blockers = current?.blockers ?? [];
  const clearedAt = text(current?.cleared_at, "");

  return (
    <section className="border border-cyan-500/30 bg-cyan-950/10 p-4">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-wider text-cyan-300">
            <BriefcaseBusiness className="h-4 w-4" />Commercial Readiness Pack
          </h3>
          <p className="mt-1 text-xs text-slate-light">
            Contract, baseline, cash-flow, valuation, variation and claims controls must be cleared before mobilisation.
          </p>
        </div>
        <button onClick={() => void refreshCommercial()} disabled={busy === "load"} className="h-8 border border-cyan-500/40 px-2 font-mono text-[10px] uppercase tracking-wider text-cyan-300 disabled:opacity-50">
          Refresh
        </button>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <span className={`border px-2 py-1 font-mono text-[10px] uppercase tracking-wider ${current?.status === "cleared" ? "border-emerald-500/40 text-emerald-300" : blockers.length ? "border-red-500/40 text-red-300" : "border-cyan-500/40 text-cyan-300"}`}>
          {current?.status ?? "not_started"}
        </span>
        <span className="border border-ink-mid px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-slate-light">
          {current?.ready_count ?? 0}/{current?.total ?? controlsList.length} controls ready
        </span>
        {clearedAt ? <span className="border border-emerald-500/40 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-emerald-300">Cleared {formatDate(clearedAt)}</span> : null}
      </div>

      {blockers.length ? (
        <div className="mb-4 border border-red-500/30 bg-red-950/20 p-3">
          <p className="mb-2 flex items-center gap-2 text-xs font-semibold text-red-200"><AlertCircle className="h-4 w-4" />Mobilisation blockers</p>
          <ul className="space-y-1 text-xs text-red-100">
            {blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
          </ul>
        </div>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-2">
        {controlsList.map((control) => (
          <label key={control.key} className="flex items-start gap-3 border border-ink-mid bg-ink/60 p-3 text-sm text-paper">
            <input
              type="checkbox"
              checked={Boolean(controls[control.key])}
              disabled={!canManage || current?.status === "cleared"}
              onChange={(e) => setControls((prev) => ({ ...prev, [control.key]: e.target.checked }))}
              className="mt-1 h-4 w-4 accent-cyan-400"
            />
            <span>
              <span className="block font-medium">{control.label}</span>
              <span className="mt-1 block text-xs text-slate-light">{controls[control.key] ? "Complete" : "Open"}</span>
            </span>
          </label>
        ))}
      </div>

      {canManage && current?.status !== "cleared" ? (
        <div className="mt-4 grid gap-3 border-t border-ink-mid/60 pt-4 md:grid-cols-2">
          <select value={authorityStatus} onChange={(e) => setAuthorityStatus(e.target.value)} className="h-10 border border-ink-mid bg-ink-light px-3 text-sm text-paper">
            <option value="">Authority status</option>
            <option value="fully_executed">Fully executed contract</option>
            <option value="awarded_subject_to_conditions">Awarded subject to conditions</option>
            <option value="letter_of_intent_only">Letter of intent only</option>
            <option value="purchase_order_only">Purchase order only</option>
            <option value="verbal_instruction">Verbal instruction</option>
            <option value="commercially_unacceptable">Commercially unacceptable</option>
          </select>
          <button onClick={() => void save()} disabled={busy === "save"} className="h-10 border border-cyan-500/40 px-3 font-mono text-xs font-bold uppercase text-cyan-300 disabled:opacity-50">
            {busy === "save" ? "Saving..." : "Save Commercial Pack"}
          </button>
          <input value={statement.authority_relied_upon} onChange={(e) => setStatement((prev) => ({ ...prev, authority_relied_upon: e.target.value }))} placeholder="Authority relied upon" className="h-10 border border-ink-mid bg-ink-light px-3 text-sm text-paper md:col-span-2" />
          <input value={statement.approved_contract_value} onChange={(e) => setStatement((prev) => ({ ...prev, approved_contract_value: e.target.value }))} type="number" min="0" placeholder="Approved contract value" className="h-10 border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
          <input value={statement.approved_commercial_baseline} onChange={(e) => setStatement((prev) => ({ ...prev, approved_commercial_baseline: e.target.value }))} placeholder="Approved baseline reference" className="h-10 border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
          <input value={statement.expected_margin} onChange={(e) => setStatement((prev) => ({ ...prev, expected_margin: e.target.value }))} type="number" placeholder="Expected margin %" className="h-10 border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
          <input value={statement.mobilisation_budget} onChange={(e) => setStatement((prev) => ({ ...prev, mobilisation_budget: e.target.value }))} type="number" min="0" placeholder="Mobilisation budget" className="h-10 border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
          <input value={statement.peak_working_capital_requirement} onChange={(e) => setStatement((prev) => ({ ...prev, peak_working_capital_requirement: e.target.value }))} type="number" placeholder="Peak working capital requirement" className="h-10 border border-ink-mid bg-ink-light px-3 text-sm text-paper md:col-span-2" />
          <textarea value={statement.payment_and_retention_conditions} onChange={(e) => setStatement((prev) => ({ ...prev, payment_and_retention_conditions: e.target.value }))} placeholder="Payment and retention conditions" className="min-h-20 border border-ink-mid bg-ink-light p-3 text-sm text-paper md:col-span-2" />
          <textarea value={statement.major_commercial_risks} onChange={(e) => setStatement((prev) => ({ ...prev, major_commercial_risks: e.target.value }))} placeholder="Major commercial risks, one per line" className="min-h-20 border border-ink-mid bg-ink-light p-3 text-sm text-paper" />
          <textarea value={statement.outstanding_conditions} onChange={(e) => setStatement((prev) => ({ ...prev, outstanding_conditions: e.target.value }))} placeholder="Outstanding conditions, one per line" className="min-h-20 border border-ink-mid bg-ink-light p-3 text-sm text-paper" />
          <textarea value={statement.temporary_controls} onChange={(e) => setStatement((prev) => ({ ...prev, temporary_controls: e.target.value }))} placeholder="Temporary controls, one per line" className="min-h-20 border border-ink-mid bg-ink-light p-3 text-sm text-paper" />
          <textarea value={statement.named_risk_owners} onChange={(e) => setStatement((prev) => ({ ...prev, named_risk_owners: e.target.value }))} placeholder="Named risk owners, one per line" className="min-h-20 border border-ink-mid bg-ink-light p-3 text-sm text-paper" />
          <button onClick={() => void clear()} disabled={busy === "clear" || !current?.ready} className="h-10 bg-emerald-500 px-4 font-mono text-xs font-bold uppercase text-ink disabled:opacity-50 md:col-span-2">
            {busy === "clear" ? "Clearing..." : "Clear Commercial Readiness"}
          </button>
        </div>
      ) : null}

      {!canManage && current?.status !== "cleared" ? (
        <p className="mt-3 text-xs text-slate-light">Commercial clearance is waiting on Commercial, Contracts or Quantity Surveying.</p>
      ) : null}
      {msg ? <p className="mt-3 text-xs text-slate-light">{msg}</p> : null}
    </section>
  );
}

function PreMobilisationPanel({
  project,
  readiness,
  isApprover,
  onRefresh,
}: {
  project: Project;
  readiness?: PreMobilisationReadiness;
  isApprover: boolean;
  onRefresh: () => void;
}) {
  const checks = useMemo(() => readiness?.checks ?? [], [readiness?.checks]);
  const [formById, setFormById] = useState<Record<string, { status: string; evidence_reference: string }>>({});
  const [approval, setApproval] = useState({ mobilisation_date: "", mobilisation_budget: "", conditions: "", residual_risk_notes: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const approvedAt = text(project.mobilisation_approved_at as string | undefined, "");
  const projectId = String(project.id ?? "");

  useEffect(() => {
    const next: Record<string, { status: string; evidence_reference: string }> = {};
    for (const check of checks) {
      next[String(check.id)] = {
        status: text(check.status, "incomplete"),
        evidence_reference: text(check.evidence_reference, ""),
      };
    }
    setFormById(next);
  }, [checks]);

  const updateCheck = async (checkId: string) => {
    const form = formById[checkId];
    if (!form) return;
    setBusy(checkId); setMsg(null);
    try {
      await updateProjectPreMobilisationCheck(projectId, checkId, {
        status: form.status,
        evidence_reference: form.evidence_reference || undefined,
      });
      setMsg("Readiness check updated.");
      onRefresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed to update readiness check.");
    } finally {
      setBusy(null);
    }
  };

  const approve = async () => {
    if (!approval.mobilisation_date) {
      setMsg("Approved mobilisation date is required.");
      return;
    }
    setBusy("approve"); setMsg(null);
    try {
      await approveProjectPreMobilisation(projectId, {
        mobilisation_date: approval.mobilisation_date,
        mobilisation_budget: approval.mobilisation_budget ? Number(approval.mobilisation_budget) : undefined,
        conditions: approval.conditions || undefined,
        residual_risk_notes: approval.residual_risk_notes || undefined,
      });
      setMsg("Mobilisation authorised. Project is now active.");
      onRefresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed to authorise mobilisation.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="border border-amber-500/30 bg-amber-950/10 p-4">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-wider text-amber-300">
            <ClipboardCheck className="h-4 w-4" />Pre-Mobilisation Readiness Gate
          </h3>
          <p className="mt-1 text-xs text-slate-light">
            Mobilisation is blocked until all required gates have evidence and the final authorisation is issued.
          </p>
        </div>
        <span className={`w-fit border px-2 py-1 font-mono text-[10px] uppercase tracking-wider ${readiness?.ready ? "border-emerald-500/40 text-emerald-300" : "border-amber-500/40 text-amber-300"}`}>
          {readiness?.ready ? "Ready for approval" : `${readiness?.ready_count ?? 0}/${readiness?.total ?? 0} ready`}
        </span>
      </div>

      {approvedAt ? (
        <div className="mb-4 border border-emerald-500/30 bg-emerald-950/20 p-3 text-xs text-emerald-200">
          Authorised {formatDate(approvedAt)} under {text(project.mobilisation_authorisation_number as string | undefined, "mobilisation order")}.
        </div>
      ) : null}

      <div className="space-y-3">
        {checks.length === 0 ? (
          <p className="text-xs text-slate-light">No readiness checks have been opened yet. Confirm the project deposit or refresh the lifecycle record.</p>
        ) : checks.map((check) => {
          const checkId = String(check.id);
          const form = formById[checkId] ?? { status: text(check.status, "incomplete"), evidence_reference: text(check.evidence_reference, "") };
          return (
            <div key={checkId} className="grid gap-3 border border-ink-mid bg-ink/60 p-3 lg:grid-cols-[minmax(0,1.4fr)_180px_minmax(0,1.4fr)_auto] lg:items-center">
              <div>
                <p className="text-sm font-medium text-paper">{text(check.check_name, "Readiness check")}</p>
                <p className="mt-1 text-xs text-slate-light">{text(check.mandatory_evidence, "Evidence required")}</p>
              </div>
              <select
                value={form.status}
                onChange={(e) => setFormById((prev) => ({ ...prev, [checkId]: { ...form, status: e.target.value } }))}
                className="h-9 border border-ink-mid bg-ink-light px-2 text-xs text-paper"
              >
                <option value="incomplete">Incomplete</option>
                <option value="complete">Complete</option>
                <option value="complete_with_conditions">Complete with conditions</option>
                <option value="not_applicable">Not applicable</option>
              </select>
              <input
                value={form.evidence_reference}
                onChange={(e) => setFormById((prev) => ({ ...prev, [checkId]: { ...form, evidence_reference: e.target.value } }))}
                placeholder="Document, register or approval reference"
                className="h-9 border border-ink-mid bg-ink-light px-2 text-xs text-paper"
              />
              <button onClick={() => void updateCheck(checkId)} disabled={busy === checkId} className="h-9 border border-signal/40 px-3 font-mono text-[10px] uppercase tracking-wider text-signal disabled:opacity-50">
                {busy === checkId ? "Saving" : "Save"}
              </button>
            </div>
          );
        })}
      </div>

      {isApprover && !approvedAt ? (
        <div className="mt-4 grid gap-3 border-t border-ink-mid/60 pt-4 md:grid-cols-2">
          <input type="date" value={approval.mobilisation_date} onChange={(e) => setApproval((prev) => ({ ...prev, mobilisation_date: e.target.value }))} className="h-10 border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
          <input type="number" min="0" value={approval.mobilisation_budget} onChange={(e) => setApproval((prev) => ({ ...prev, mobilisation_budget: e.target.value }))} placeholder="Mobilisation budget (optional)" className="h-10 border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
          <textarea value={approval.conditions} onChange={(e) => setApproval((prev) => ({ ...prev, conditions: e.target.value }))} placeholder="Conditions to close after mobilisation" className="min-h-20 border border-ink-mid bg-ink-light p-3 text-sm text-paper md:col-span-2" />
          <textarea value={approval.residual_risk_notes} onChange={(e) => setApproval((prev) => ({ ...prev, residual_risk_notes: e.target.value }))} placeholder="Residual risk accepted by executive" className="min-h-20 border border-ink-mid bg-ink-light p-3 text-sm text-paper md:col-span-2" />
          <button onClick={() => void approve()} disabled={busy === "approve" || !readiness?.ready} className="h-10 bg-emerald-500 px-4 font-mono text-xs font-bold uppercase text-ink disabled:opacity-50 md:col-span-2">
            {busy === "approve" ? "Authorising..." : "Authorise Mobilisation"}
          </button>
        </div>
      ) : null}

      {msg ? <p className="mt-3 text-xs text-slate-light">{msg}</p> : null}
    </section>
  );
}

function ProjectControlsPanel({
  project,
  detail,
  signals,
  onOpenTab,
  onOpenCommand,
}: {
  project: Project;
  detail: Detail | null;
  signals?: ProjectSignalState;
  onOpenTab?: (tab: ProjectTab) => void;
  onOpenCommand?: (command: ProjectCommand) => void;
}) {
  const source = detail?.project ?? project;
  const viability = detail?.viability?.[0];
  const commercial = detail?.commercial_readiness;
  const preMob = detail?.pre_mobilisation;
  const financeVariations = signals?.financeVariations ?? [];
  const checks = [
    {
      label: "Project identity and contract information",
      ready: Boolean(text(source.name ?? source.project_name ?? source.project_code, "")),
      evidence: text(source.project_code ?? source.name ?? source.project_name, "Missing project identity"),
      onOpen: () => onOpenTab?.("overview"),
    },
    {
      label: "Client and consultant details",
      ready: Boolean(text(source.client_org_id ?? source.client_id ?? source.client_name ?? source.client, "")),
      evidence: text(source.client_name ?? source.client ?? source.client_org_id ?? source.client_id, "No linked CRM client"),
      onOpen: () => onOpenTab?.("overview"),
    },
    {
      label: "Contract value and payment terms",
      ready: (number(source.contract_value ?? source.budget ?? source.budget_value) ?? 0) > 0 || Boolean(commercial?.clearance_statement),
      evidence: (number(source.contract_value ?? source.budget ?? source.budget_value) ?? 0) > 0
        ? formatCurrency(number(source.contract_value ?? source.budget ?? source.budget_value) ?? 0)
        : text(commercial?.status, "No commercial baseline returned"),
      onOpen: () => onOpenTab?.("financials"),
    },
    {
      label: "Master BOQ and approved budget",
      ready: Boolean(detail?.quotations?.length || viability?.budget_amount || source.budget_amount || source.budget),
      evidence: detail?.quotations?.length ? `${detail.quotations.length} quotation/BOQ record(s)` : text(viability?.budget_amount ?? source.budget_amount ?? source.budget, "No BOQ/budget evidence"),
      onOpen: () => onOpenCommand?.("budget"),
    },
    {
      label: "Cost codes and work breakdown structure",
      ready: Boolean(source.department_id || detail?.milestones?.length),
      evidence: source.department_id ? "Department/cost owner assigned" : detail?.milestones?.length ? `${detail.milestones.length} WBS milestone(s)` : "No WBS evidence returned",
      onOpen: () => onOpenTab?.("schedule"),
    },
    {
      label: "Baseline programme and milestones",
      ready: Boolean(detail?.milestones?.length || source.end_date || source.planned_completion_date),
      evidence: detail?.milestones?.length ? `${detail.milestones.length} milestone(s)` : text(source.end_date ?? source.planned_completion_date, "No programme dates returned"),
      onOpen: () => onOpenTab?.("schedule"),
    },
    {
      label: "Drawings, specifications and revisions",
      ready: Boolean(detail?.tests_and_checks?.length),
      evidence: detail?.tests_and_checks?.length ? `${detail.tests_and_checks.length} technical check(s)` : "No drawing/spec revision evidence returned",
      onOpen: () => onOpenCommand?.("documents"),
    },
    {
      label: "Labour plan",
      ready: Boolean(viability?.delivery_manager),
      evidence: text(viability?.delivery_manager, "No responsible delivery owner"),
      onOpen: () => onOpenCommand?.("workforce"),
    },
    {
      label: "Material procurement schedule",
      ready: Boolean(detail?.material_records?.length || detail?.procurement_orders?.length),
      evidence: detail?.procurement_orders?.length ? `${detail.procurement_orders.length} procurement order(s)` : detail?.material_records?.length ? `${detail.material_records.length} material line(s)` : "No procurement/material evidence returned",
      onOpen: () => onOpenCommand?.("materials"),
    },
    {
      label: "Plant and equipment plan",
      ready: Boolean((source as Record<string, unknown>).plant_plan_reference || (source as Record<string, unknown>).equipment_plan_reference),
      evidence: text((source as Record<string, unknown>).plant_plan_reference ?? (source as Record<string, unknown>).equipment_plan_reference, "No plant plan field returned"),
      onOpen: undefined,
    },
    {
      label: "Subcontractor packages",
      ready: Boolean(detail?.subcontractors?.length),
      evidence: detail?.subcontractors?.length ? `${detail.subcontractors.length} subcontractor record(s)` : "No subcontract package returned",
      onOpen: () => onOpenTab?.("overview"),
    },
    {
      label: "Risk and issue register",
      ready: Boolean(detail?.risks?.length || riskStatuses.has(text(source.health ?? source.status, "").toLowerCase())),
      evidence: detail?.risks?.length ? `${detail.risks.length} risk record(s)` : text(source.health, "No risk register evidence returned"),
      onOpen: () => onOpenTab?.("overview"),
    },
    {
      label: "Inspection, quality and HSE documentation",
      ready: Boolean(detail?.tests_and_checks?.length || preMob?.checks?.length),
      evidence: detail?.tests_and_checks?.length ? `${detail.tests_and_checks.length} QA/HSE check(s)` : preMob?.checks?.length ? `${preMob.checks.length} pre-start check(s)` : "No inspection/HSE evidence returned",
      onOpen: () => onOpenCommand?.("documents"),
    },
    {
      label: "Daily and weekly site records",
      ready: Boolean(detail?.site_reports?.length),
      evidence: detail?.site_reports?.length ? `${detail.site_reports.length} site report(s)` : "No daily site report returned",
      onOpen: () => onOpenCommand?.("siteReports"),
    },
    {
      label: "Variations and instructions",
      ready: Boolean(financeVariations.length),
      evidence: financeVariations.length ? `${financeVariations.length} finance variation record(s)` : "No finance.variations record returned",
      onOpen: () => onOpenCommand?.("variations"),
    },
    {
      label: "Payment certificates and valuations",
      ready: Boolean((source as Record<string, unknown>).payment_certificate_count || (source as Record<string, unknown>).valuation_count),
      evidence: text((source as Record<string, unknown>).payment_certificate_count ?? (source as Record<string, unknown>).valuation_count, "No payment certificate evidence returned"),
      onOpen: undefined,
    },
    {
      label: "Practical-completion and handover records",
      ready: Boolean(text(source.status, "").toLowerCase() === "completed" || (source as Record<string, unknown>).handover_reference),
      evidence: text((source as Record<string, unknown>).handover_reference ?? source.status, "No handover evidence returned"),
      onOpen: undefined,
    },
  ];

  const readyCount = checks.filter((item) => item.ready).length;
  const readiness = percent(readyCount, checks.length);
  const mobilisationReady = Boolean(preMob?.ready || source.mobilisation_approved_at);

  return (
    <div className="space-y-5 animate-fade-in">
      <section className="border border-ink-mid bg-ink-light/20 p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-signal">Controlled project record</p>
            <h3 className="mt-1 font-display text-xl font-semibold text-paper">Construction readiness map</h3>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-light">
              This checklist maps the requested SNC construction project structure to fields and linked records returned by AEGIS. Missing items are left visible so mobilisation, finance, procurement and site teams do not operate from hidden assumptions.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 font-mono text-[10px] uppercase tracking-wider text-slate-light">
            <div className="border border-ink-mid bg-ink p-3 text-center">
              <p>Ready</p>
              <p className="mt-1 text-lg font-bold text-signal">{readyCount}/{checks.length}</p>
            </div>
            <div className="border border-ink-mid bg-ink p-3 text-center">
              <p>Score</p>
              <p className="mt-1 text-lg font-bold text-paper">{readiness}%</p>
            </div>
            <div className="border border-ink-mid bg-ink p-3 text-center">
              <p>Mobilise</p>
              <p className={`mt-1 text-lg font-bold ${mobilisationReady ? "text-emerald-300" : "text-amber-300"}`}>{mobilisationReady ? "Open" : "Gate"}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2">
        {checks.map((item) => (
          <div
            key={item.label}
            role={item.onOpen ? "button" : undefined}
            tabIndex={item.onOpen ? 0 : undefined}
            onClick={item.onOpen}
            onKeyDown={item.onOpen ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); item.onOpen?.(); } } : undefined}
            className={`border border-ink-mid bg-ink p-3 ${item.onOpen ? "cursor-pointer transition-colors hover:border-signal/60 hover:bg-ink-light/30" : ""}`}
          >
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-semibold text-paper">{item.label}</p>
              <span className={`shrink-0 border px-2 py-1 font-mono text-[9px] uppercase tracking-wider ${item.ready ? "border-emerald-500/30 text-emerald-300" : "border-amber-500/30 text-amber-300"}`}>
                {item.ready ? "Recorded" : "Gap"}
              </span>
            </div>
            <p className="mt-2 text-xs leading-5 text-slate-light">{item.evidence}</p>
          </div>
        ))}
      </section>
      <p className="text-[11px] text-slate-light">
        3 items (plant/equipment plan, payment certificates, handover records) have no field or screen behind them yet and are tracked separately — they can&apos;t be opened until that&apos;s built.
      </p>

      <section className="grid gap-3 lg:grid-cols-3">
        <div className="border border-amber-500/30 bg-amber-950/10 p-4">
          <h4 className="font-mono text-xs font-bold uppercase tracking-wider text-amber-300">Pre-start gate</h4>
          <p className="mt-2 text-xs leading-5 text-slate-light">
            Mobilisation remains blocked until commercial readiness, required evidence and final authorisation are complete.
          </p>
        </div>
        <div className="border border-ink-mid bg-ink p-4">
          <h4 className="font-mono text-xs font-bold uppercase tracking-wider text-paper">Separation of duties</h4>
          <p className="mt-2 text-xs leading-5 text-slate-light">
            Finance, Commercial/QS, project delivery and executive authorisations remain separated through the existing AEGIS role checks and approval endpoints.
          </p>
        </div>
        <div className="border border-ink-mid bg-ink p-4">
          <h4 className="font-mono text-xs font-bold uppercase tracking-wider text-paper">Audit trail</h4>
          <p className="mt-2 text-xs leading-5 text-slate-light">
            The panel reads project lifecycle, document, site, procurement and finance-linked records; it does not create local-only browser state for project control decisions.
          </p>
        </div>
      </section>
    </div>
  );
}

type ProjectSignalState = {
  attendance: Record<string, unknown>[];
  rfqs: Record<string, unknown>[];
  siteVariances: Record<string, unknown>[];
  grns: Record<string, unknown>[];
  financeVariations: Record<string, unknown>[];
  budgets: Record<string, unknown>[];
  progressClaims: Record<string, unknown>[];
  boqSummary: Record<string, unknown> | null;
  financeDetail: Record<string, unknown> | null;
};

const EMPTY_PROJECT_SIGNALS: ProjectSignalState = {
  attendance: [],
  rfqs: [],
  siteVariances: [],
  grns: [],
  financeVariations: [],
  budgets: [],
  progressClaims: [],
  boqSummary: null,
  financeDetail: null,
};

function sumField(rows: Record<string, unknown>[], fields: string[]): number {
  return rows.reduce((sum, row) => {
    const value = fields.map((field) => number(row[field])).find((item): item is number => item !== null);
    return sum + (value ?? 0);
  }, 0);
}

function countUnique(rows: Record<string, unknown>[], fields: string[]): number {
  const values = new Set<string>();
  for (const row of rows) {
    const value = fields.map((field) => row[field]).find((item) => item !== undefined && item !== null && String(item).trim());
    if (value !== undefined && value !== null) values.add(String(value));
  }
  return values.size;
}

function statusCount(rows: { status?: unknown }[], status: string): number {
  return rows.filter((row) => text(row.status, "").toLowerCase() === status).length;
}

function latestDate(rows: Record<string, unknown>[], fields: string[]): string {
  const dates = rows
    .flatMap((row) => fields.map((field) => row[field]))
    .map((value) => (value ? new Date(String(value)) : null))
    .filter((date): date is Date => !!date && !Number.isNaN(date.getTime()))
    .sort((a, b) => b.getTime() - a.getTime());
  return dates[0] ? formatDate(dates[0].toISOString()) : "Not recorded";
}

function localDateInput(offsetDays = 0): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
}

const BUDGET_FIELD_ALIASES: Record<"cost_code" | "description" | "quantity" | "unit" | "rate" | "amount", string[]> = {
  cost_code: ["cost_code", "cost code", "code", "item_code", "boq_code", "boq code", "work_package", "wbs", "section"],
  description: ["description", "desc", "item", "item_description", "work_item", "activity", "particulars", "name"],
  quantity: ["quantity", "qty", "qnty", "measure", "measured_qty"],
  unit: ["unit", "uom", "unit_of_measure"],
  rate: ["rate", "unit_rate", "unit cost", "unit_cost", "price"],
  amount: ["amount", "total", "total_amount", "budget", "cost", "value", "line_total"],
};

type BudgetColumnMap = Record<keyof typeof BUDGET_FIELD_ALIASES, string>;

const EMPTY_BUDGET_COLUMN_MAP: BudgetColumnMap = {
  cost_code: "",
  description: "",
  quantity: "",
  unit: "",
  rate: "",
  amount: "",
};

function normaliseHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

function splitBudgetLine(line: string, delimiter: string): string[] {
  if (delimiter === "whitespace") return line.trim().split(/\s{2,}|\t+/).map((value) => value.trim());
  return line.split(delimiter).map((value) => value.trim().replace(/^"|"$/g, ""));
}

function inferBudgetDelimiter(lines: string[]): string {
  const candidates = [",", "\t", ";", "|"];
  const best = candidates
    .map((delimiter) => ({
      delimiter,
      score: lines.slice(0, 10).reduce((sum, line) => sum + splitBudgetLine(line, delimiter).length, 0),
    }))
    .sort((a, b) => b.score - a.score)[0];
  return best && best.score > lines.slice(0, 10).length ? best.delimiter : "whitespace";
}

function inferBudgetColumnMap(columns: string[]): BudgetColumnMap {
  const normalised = columns.map((column) => ({ raw: column, normalised: normaliseHeader(column) }));
  return (Object.keys(BUDGET_FIELD_ALIASES) as (keyof typeof BUDGET_FIELD_ALIASES)[]).reduce((acc, field) => {
    const match = normalised.find((column) => BUDGET_FIELD_ALIASES[field].some((alias) => column.normalised === normaliseHeader(alias) || column.normalised.includes(normaliseHeader(alias))));
    acc[field] = match?.raw ?? "";
    return acc;
  }, { ...EMPTY_BUDGET_COLUMN_MAP });
}

function budgetHeaderFields(cells: string[]): Set<keyof BudgetColumnMap> {
  return cells.reduce<Set<keyof BudgetColumnMap>>((fields, cell) => {
    const normalised = normaliseHeader(cell);
    if (!normalised) return fields;
    (Object.keys(BUDGET_FIELD_ALIASES) as (keyof BudgetColumnMap)[]).forEach((field) => {
      if (BUDGET_FIELD_ALIASES[field].some((alias) => {
        const normalisedAlias = normaliseHeader(alias);
        return normalised === normalisedAlias || normalised.includes(normalisedAlias);
      })) {
        fields.add(field);
      }
    });
    return fields;
  }, new Set<keyof BudgetColumnMap>());
}

function parseBudgetMatrix(matrix: unknown[][]) {
  const sourceRows = matrix
    .map((row) => row.map((cell) => String(cell ?? "").trim()))
    .filter((row) => row.some(Boolean));

  if (!sourceRows.length) return { rows: [] as Record<string, string>[], columns: [] as string[], map: EMPTY_BUDGET_COLUMN_MAP };

  const headerIndex = sourceRows.findIndex((row) => budgetHeaderFields(row).size >= 2);
  const firstDataRow = headerIndex >= 0 ? headerIndex + 1 : 0;
  const rawColumns = headerIndex >= 0 ? sourceRows[headerIndex] : sourceRows[0].map((_, index) => `Column ${index + 1}`);
  const columnCount = Math.max(rawColumns.length, ...sourceRows.slice(firstDataRow).map((row) => row.length));
  const columns = Array.from({ length: columnCount }, (_, index) => rawColumns[index] || `Column ${index + 1}`);
  const dataRows = sourceRows
    .slice(firstDataRow)
    .filter((row) => row.some((cell) => number(cell) !== null) || row.filter(Boolean).length > 1);

  const rows = dataRows.map((cells) => columns.reduce<Record<string, string>>((acc, column, index) => {
    acc[column] = cells[index] ?? "";
    return acc;
  }, {}));
  const inferred = inferBudgetColumnMap(columns);

  if (headerIndex < 0 && columns.length) {
    inferred.description = columns[0];
    inferred.amount = columns[columns.length - 1];
    if (columns.length >= 4) {
      inferred.quantity = columns[columns.length - 3];
      inferred.rate = columns[columns.length - 2];
    }
  }

  return { rows, columns, map: inferred };
}

function parseBudgetText(raw: string) {
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return { rows: [] as Record<string, string>[], columns: [] as string[], map: EMPTY_BUDGET_COLUMN_MAP };
  const delimiter = inferBudgetDelimiter(lines);
  const first = splitBudgetLine(lines[0], delimiter);
  const firstLooksLikeHeader = budgetHeaderFields(first).size >= 2 || (first.length > 1 && first.every((cell) => number(cell) === null));
  const columns = firstLooksLikeHeader ? first.map((cell, index) => cell || `Column ${index + 1}`) : first.map((_, index) => `Column ${index + 1}`);
  const dataLines = firstLooksLikeHeader ? lines.slice(1) : lines;
  const rows = dataLines.map((line) => {
    const cells = splitBudgetLine(line, delimiter);
    return columns.reduce<Record<string, string>>((acc, column, index) => {
      acc[column] = cells[index] ?? "";
      return acc;
    }, {});
  });
  const inferred = inferBudgetColumnMap(columns);
  if (!firstLooksLikeHeader && columns.length) {
    inferred.description = columns[0];
    inferred.amount = columns[columns.length - 1];
    if (columns.length >= 4) {
      inferred.quantity = columns[columns.length - 3];
      inferred.rate = columns[columns.length - 2];
    }
  }
  return { rows, columns, map: inferred };
}

function normaliseBudgetRows(rows: Record<string, string>[], map: BudgetColumnMap, project: Project) {
  const prefix = codePrefix(project.project_code ?? project.name ?? project.project_name, "PRJ");
  return rows.map((row, index) => {
    const qty = number(row[map.quantity]) ?? 0;
    const rate = number(row[map.rate]) ?? 0;
    const mappedAmount = number(row[map.amount]);
    const amount = mappedAmount ?? (qty > 0 && rate > 0 ? qty * rate : 0);
    const description = text(row[map.description], `Budget line ${index + 1}`);
    return {
      source_line: String(index + 1),
      cost_code: text(row[map.cost_code], `${prefix}-${String(index + 1).padStart(3, "0")}`),
      description,
      quantity: map.quantity ? text(row[map.quantity], "") : "",
      unit: map.unit ? text(row[map.unit], "") : "",
      rate: map.rate ? text(row[map.rate], "") : "",
      amount: amount > 0 ? String(amount) : "",
      review_note: amount > 0 ? "Accepted" : "Excluded: no positive amount",
    };
  });
}

function ProjectDashboardPanel({
  project,
  detail,
  signals,
  loading,
  onOpenTab,
  onOpenCommand,
}: {
  project: Project;
  detail: Detail | null;
  signals: ProjectSignalState;
  loading: boolean;
  onOpenTab: (tab: ProjectTab) => void;
  onOpenCommand: (command: ProjectCommand) => void;
}) {
  const source = detail?.project ?? project;
  const siteReports = detail?.site_reports ?? [];
  const materialRecords = detail?.material_records ?? [];
  const procurementOrders = detail?.procurement_orders ?? [];
  const contractValue = number(source.contract_value ?? source.budget ?? source.budget_value) ?? 0;
  const actualCost = number(source.actual_cost ?? source.actual_cost_to_date ?? source.cost_to_date) ?? 0;
  const committedCost = number(source.committed_cost ?? source.commitments ?? source.purchase_commitments) ?? 0;
  const budgetAmount = number(signals.boqSummary?.contract_value ?? signals.boqSummary?.budget_amount ?? source.budget_amount ?? source.budget) ?? contractValue;
  const earnedValue = number(signals.boqSummary?.earned_value ?? signals.boqSummary?.claimable_value) ?? 0;
  const progressPct = number(signals.boqSummary?.percent_complete ?? signals.boqSummary?.progress_pct ?? source.progress ?? source.progress_pct) ?? 0;
  const validatedHours = sumField(signals.attendance, ["validated_hours", "hours_validated", "approved_hours", "hours_worked", "total_hours"]);
  const payrollDue = sumField(signals.attendance, ["salary_due", "gross_pay", "pay_due", "validated_pay", "amount_due"]);
  const workerCount = countUnique(signals.attendance, ["employee_id", "worker_id", "user_id", "employee_name", "full_name"]);
  const materialCost = materialRecords.reduce((sum, row) => sum + ((number(row.quantity_used) ?? 0) * (number(row.unit_cost) ?? 0)), 0);
  const openRfqs = signals.rfqs.filter((row) => !["awarded", "closed", "cancelled"].includes(text(row.status, "").toLowerCase())).length;
  const openVariations = signals.financeVariations.filter((row) => !["approved", "rejected", "closed"].includes(text(row.status, "").toLowerCase())).length;
  const exposure = actualCost + committedCost;
  const costPressurePct = budgetAmount > 0 ? Math.round((exposure / budgetAmount) * 100) : 0;
  const costSignals = [
    workerCount === 0 ? "No validated labour allocation has been returned for this project." : `${workerCount} worker(s) have attendance linked to this project.`,
    openRfqs === 0 ? "No open RFQs are competing current project buying." : `${openRfqs} open RFQ(s) can be used to pressure-test supplier pricing.`,
    signals.siteVariances.length === 0 ? "No site variance records returned." : `${signals.siteVariances.length} site variance record(s) need cost control review.`,
    budgetAmount <= 0 ? "No approved budget baseline returned." : `Cost exposure is ${costPressurePct}% of the current budget baseline.`,
  ];

  const quickLinks = [
    { label: "Assign team", icon: Users, action: () => onOpenCommand("workforce") },
    { label: "Documents", icon: FileText, action: () => onOpenCommand("documents") },
    { label: "Progress", icon: TrendingUp, action: () => onOpenCommand("progress") },
    { label: "Budget", icon: Banknote, action: () => onOpenCommand("budget") },
    { label: "Claims", icon: Send, action: () => onOpenCommand("claim") },
    { label: "Controls", icon: ShieldCheck, action: () => onOpenCommand("controls") },
    { label: "Materials", icon: Package, action: () => onOpenCommand("materials") },
  ];

  const commandCards = [
    { label: "Workforce roster", command: "workforce" as const, icon: Users, detail: "Assign and review people connected to this project." },
    { label: "Site reports", command: "siteReports" as const, icon: ClipboardCheck, detail: "Log days, hours, material usage and engineer validations." },
    { label: "Procurement RFQs", command: "rfqs" as const, icon: Receipt, detail: "Compare suppliers before cost is committed." },
    { label: "Finance variations", command: "variations" as const, icon: DollarSign, detail: "Track variations, claims and commercial exposure." },
    { label: "Progress claims", command: "claim" as const, icon: Send, detail: "Submit billing claims; certified claims post as claimed revenue and cash in Finance." },
  ];

  return (
    <div className="space-y-5 animate-fade-in">
      <section className="border border-ink-mid bg-ink-light/20 p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-signal">Project command dashboard</p>
            <h3 className="mt-1 font-display text-2xl font-semibold text-paper">{title(source)}</h3>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-light">
              This popup is the project control room. It reads linked AEGIS records for labour, site reports, budget, procurement, receipts, variations and documents so project decisions stay tied to retained system data.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 font-mono text-[10px] uppercase tracking-wider sm:grid-cols-4 xl:min-w-[520px]">
            <Metric label="Progress" value={`${Math.round(progressPct)}%`} detail="BOQ/project progress" tone="text-signal" />
            <Metric label="Cost exposure" value={budgetAmount > 0 ? `${costPressurePct}%` : "No budget"} detail="Actual plus committed" tone={costPressurePct > 90 ? "text-amber-300" : "text-paper"} />
            <Metric label="Labour hours" value={loading ? "..." : validatedHours.toLocaleString()} detail="Validated attendance" tone="text-cyan-300" />
            <Metric label="Payroll due" value={payrollDue > 0 ? formatCurrency(payrollDue) : "Pending"} detail="From attendance/pay fields" tone="text-emerald-300" />
          </div>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        {quickLinks.map((item) => (
          <button key={item.label} type="button" onClick={item.action} className="border border-ink-mid bg-ink p-3 text-left hover:border-signal hover:bg-ink-light/40">
            <item.icon className="h-5 w-5 text-signal" />
            <span className="mt-2 block text-xs font-semibold text-paper">{item.label}</span>
          </button>
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="border border-ink-mid bg-ink p-4">
          <div className="mb-3 flex items-center justify-between">
            <h4 className="font-mono text-xs font-bold uppercase tracking-wider text-paper">Live project ledger</h4>
            {loading ? <Loader2 className="h-4 w-4 animate-spin text-signal" /> : null}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Info label="Site reports" value={String(siteReports.length)} />
            <Info label="Budget records" value={String(signals.budgets.length)} />
            <Info label="RFQs" value={String(signals.rfqs.length)} />
            <Info label="Receipts / GRNs" value={String(signals.grns.length)} />
            <Info label="Variations" value={String(signals.financeVariations.length)} />
            <Info label="Procurement orders" value={String(procurementOrders.length)} />
            <Info label="Material consumption" value={formatCurrency(materialCost)} />
            <Info label="Earned value" value={earnedValue > 0 ? formatCurrency(earnedValue) : "Not recorded"} />
          </div>
        </div>

        <div className="border border-ink-mid bg-ink p-4">
          <h4 className="font-mono text-xs font-bold uppercase tracking-wider text-paper">Cost-saving checks</h4>
          <div className="mt-3 space-y-2">
            {costSignals.map((signal) => (
              <div key={signal} className="border border-ink-mid bg-ink-light/25 p-3 text-xs leading-5 text-slate-light">
                {signal}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {commandCards.map((item) => (
          <button key={item.label} type="button" onClick={() => onOpenCommand(item.command)} className="border border-ink-mid bg-ink p-4 text-left hover:border-signal hover:bg-ink-light/40">
            <item.icon className="h-5 w-5 text-signal" />
            <h4 className="mt-3 text-sm font-semibold text-paper">{item.label}</h4>
            <p className="mt-1 text-xs leading-5 text-slate-light">{item.detail}</p>
          </button>
        ))}
      </section>
    </div>
  );
}

function ProjectCommandModal({
  command,
  project,
  detail,
  signals,
  onClose,
  onRefresh,
  onNavigateTab,
  onNavigateCommand,
}: {
  command: ProjectCommand;
  project: Project;
  detail: Detail | null;
  signals: ProjectSignalState;
  onClose: () => void;
  onRefresh: () => void;
  onNavigateTab?: (tab: ProjectTab) => void;
  onNavigateCommand?: (command: ProjectCommand) => void;
}) {
  const [employees, setEmployees] = useState<Record<string, unknown>[]>([]);
  const [allocations, setAllocations] = useState<Record<string, unknown>[]>([]);
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<string[]>([]);
  const [roleByEmployee, setRoleByEmployee] = useState<Record<string, string>>({});
  const [accountRoleByEmployee, setAccountRoleByEmployee] = useState<Record<string, string>>({});
  const [allocationWindow, setAllocationWindow] = useState({
    starts_on: localDateInput(),
    ends_on: localDateInput(30),
    allocation_percent: "100",
  });
  const [siteReport, setSiteReport] = useState({
    report_date: localDateInput(),
    shift: "day",
    planned_work: "",
    actual_work: "",
    delays: "",
    safety_notes: "",
    cost_exposure: "0",
    labour_count_completed: true,
    toolbox_talk_completed: true,
    ppe_check_completed: true,
  });
  const [variation, setVariation] = useState({
    variation_number: `VAR-${Date.now().toString().slice(-6)}`,
    title: "",
    description: "",
    initiated_by: "site",
    cost_impact: "0",
    time_impact_days: "0",
  });
  const [claim, setClaim] = useState({
    claim_number: `PC-${Date.now().toString().slice(-6)}`,
    claim_period_start: localDateInput(),
    claim_period_end: localDateInput(),
    contract_value: String(number(project.contract_value ?? project.budget ?? project.budget_value) ?? 0),
    this_claim_amount: "0",
    retention_pct: "10",
  });
  const [budgetForm, setBudgetForm] = useState({ total: "", notes: "", fileName: "", pastedText: "" });
  const [budgetSourceRows, setBudgetSourceRows] = useState<Record<string, string>[]>([]);
  const [budgetColumns, setBudgetColumns] = useState<string[]>([]);
  const [budgetColumnMap, setBudgetColumnMap] = useState<BudgetColumnMap>(EMPTY_BUDGET_COLUMN_MAP);
  const [budgetStage, setBudgetStage] = useState<"master" | "execution">("master");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (command !== "workforce") return;
    let active = true;
    Promise.allSettled([
      getHREmployees({ status: "all" }),
      getWorkforceAllocations({ project_id: project.id }),
    ]).then(([employeeResult, allocationResult]) => {
      if (!active) return;
      setEmployees(employeeResult.status === "fulfilled" ? employeeResult.value.data ?? [] : []);
      setAllocations(allocationResult.status === "fulfilled" ? allocationResult.value.data ?? [] : []);
    });
    return () => { active = false; };
  }, [command, project.id]);

  const titleByCommand: Record<ProjectCommand, string> = {
    workforce: "Assign workforce",
    siteReports: "Site reports",
    rfqs: "Procurement RFQs",
    variations: "Finance variations",
    budget: "Budget baseline",
    claim: "Progress claims & deposits",
    documents: "Project documents",
    progress: "Progress control",
    controls: "Project controls",
    materials: "Material control",
  };

  const commandDescription: Record<ProjectCommand, string> = {
    workforce: "Read the live workforce register, tick available people, assign role/account fit, and save allocations against this project.",
    siteReports: "Inspect retained site reports and add a new day record without leaving the project dashboard.",
    rfqs: "Compare project RFQs and supplier responses so buying decisions stay tied to the project.",
    variations: "Review and create commercial variations that feed finance controls and project cost exposure.",
    budget: "Create or upload a budget baseline, identify errors and risk flags, then save the protected project budget.",
    claim: "Submit and review progress claims - each certified claim is recognised in Finance as claimed revenue and cash collected against this project.",
    documents: "Open the project document surface inside this same command context.",
    progress: "Review schedule and earned-value progress signals for this project.",
    controls: "Inspect mobilisation readiness, separation of duties, and control gaps before cost is committed.",
    materials: "Review material consumption, wastage and cheap-buying opportunities for this project.",
  };

  const allocatedIds = new Set(allocations.map((row) => String(row.employee_id ?? "")));
  const activeEmployees = employees.filter((employee) => !["terminated", "suspended"].includes(text(employee.employment_status ?? employee.status, "").toLowerCase()));
  const selectedRows = activeEmployees.filter((employee) => selectedEmployeeIds.includes(String(employee.id)));
  const budgetRows = normaliseBudgetRows(budgetSourceRows, budgetColumnMap, project);
  const acceptedBudgetRows = budgetRows.filter((row) => (number(row.amount) ?? 0) > 0);
  const excludedBudgetRows = budgetRows.filter((row) => (number(row.amount) ?? 0) <= 0);
  const budgetUploadTotal = acceptedBudgetRows.reduce((sum, row) => sum + (number(row.amount) ?? 0), 0);
  const budgetTotal = number(budgetForm.total) ?? budgetUploadTotal;
  const budgetErrors = budgetRows.length && !acceptedBudgetRows.length ? ["No valid budget lines with a positive amount were found. Match the Amount column or enter a manual total."] : [];
  const budgetRisks = [
    !budgetColumnMap.cost_code && budgetRows.length ? "Upload had no cost-code column; AEGIS generated uniform project cost codes for review." : "",
    budgetRows.some((row) => row.description.startsWith("Budget line ")) ? "Some descriptions were generated because no description column was matched." : "",
    excludedBudgetRows.length ? `${excludedBudgetRows.length} uploaded row(s) were excluded from the baseline total because no positive amount was found. Review them before final approval.` : "",
    budgetUploadTotal > 0 && (number(project.contract_value ?? project.budget ?? project.budget_value) ?? 0) > 0 && budgetUploadTotal > (number(project.contract_value ?? project.budget ?? project.budget_value) ?? 0) ? "Uploaded budget is above recorded contract value." : "",
    signals.financeVariations.some((row) => text(row.status, "").toLowerCase() === "pending") ? "Pending variations exist; protect baseline before accepting new cost exposure." : "",
  ].filter(Boolean);

  const parseBudgetFile = async (file: File) => {
    setError("");
    setMessage("");
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    const excelOrCsv = new Set(["xlsx", "xlsm", "xltx", "xls", "csv", "tsv"]);
    const unsupportedBinary = new Set(["pdf", "doc", "docx"]);

    try {
      if (excelOrCsv.has(extension)) {
        const res = await importBoqFile(file, {
          source_type: "project",
          source_id: project.id,
        });

        const items = res.data?.items || [];
        if (items.length > 0) {
          const cols = ["Item No", "Section", "Description", "Quantity", "Unit", "Rate", "Amount"];
          const colMap: BudgetColumnMap = {
            description: "Description",
            quantity: "Quantity",
            unit: "Unit",
            rate: "Rate",
            amount: "Amount",
            cost_code: "Item No",
          };
          const rows = items.map((it: any) => {
            const q = Number(it.quantity) || 0;
            const r = Number(it.rate) || 0;
            const lineTotal = q > 0 && r > 0 ? (q * r).toFixed(2) : "";
            return {
              "Item No": it.item_no || "",
              "Section": it.section || "",
              "Description": it.description || "",
              "Quantity": String(it.quantity ?? ""),
              "Unit": it.unit || "item",
              "Rate": String(it.rate ?? ""),
              "Amount": lineTotal,
            };
          });

          setBudgetSourceRows(rows);
          setBudgetColumns(cols);
          setBudgetColumnMap(colMap);
          const totalDirect = res.data?.summary?.total_direct_costs;
          setBudgetForm((current) => ({
            ...current,
            fileName: file.name,
            total: totalDirect ? String(totalDirect) : current.total,
          }));
          setMessage(`Successfully imported ${items.length} item(s) across ${res.data?.summary?.section_count || 1} section(s) from ${file.name}.`);
          return;
        } else if (res.data?.warnings?.length) {
          setError(res.data.warnings.join(" "));
          return;
        }
      }

      if (unsupportedBinary.has(extension)) {
        setError("For Word or PDF budgets, please save/export as Excel (.xlsx/.xls) or CSV, or paste the table text into this popup.");
        setBudgetSourceRows([]);
        setBudgetColumns([]);
        setBudgetColumnMap(EMPTY_BUDGET_COLUMN_MAP);
        setBudgetForm((current) => ({ ...current, fileName: file.name, total: "" }));
        return;
      }

      const parsed = parseBudgetText(await file.text());
      if (!parsed.rows.length || parsed.columns.length <= 1) {
        setError("AEGIS could not find a structured budget table in that file. Check that the sheet contains columns such as Description, Qty, Rate and Amount, or paste the table text below.");
      }
      setBudgetSourceRows(parsed.rows);
      setBudgetColumns(parsed.columns);
      setBudgetColumnMap(parsed.map);
      setBudgetForm((current) => ({ ...current, fileName: file.name, total: "" }));
    } catch (importError) {
      setError(importError instanceof Error ? `Budget upload could not be read: ${importError.message}` : "Budget upload could not be read.");
    }
  };

  const parsePastedBudget = () => {
    setError("");
    setMessage("");
    const parsed = parseBudgetText(budgetForm.pastedText);
    if (!parsed.rows.length) {
      setError("Paste budget lines with at least a description and amount.");
      return;
    }
    setBudgetSourceRows(parsed.rows);
    setBudgetColumns(parsed.columns);
    setBudgetColumnMap(parsed.map);
    setBudgetForm((current) => ({ ...current, fileName: "pasted budget", total: "" }));
  };

  const toggleEmployee = (employeeId: string) => {
    setSelectedEmployeeIds((current) => current.includes(employeeId) ? current.filter((id) => id !== employeeId) : [...current, employeeId]);
  };

  const saveAllocations = async () => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      for (const employee of selectedRows) {
        const employeeId = String(employee.id);
        await createWorkforceAllocation({
          employee_id: employeeId,
          project_id: project.id,
          role_on_project: roleByEmployee[employeeId] || text(employee.job_title ?? employee.role ?? employee.position, "Project worker"),
          allocation_percent: Number(allocationWindow.allocation_percent || 100),
          starts_on: allocationWindow.starts_on,
          ends_on: allocationWindow.ends_on,
          status: "active",
          notes: accountRoleByEmployee[employeeId] ? `Account role: ${accountRoleByEmployee[employeeId]}` : null,
        });
      }
      const refreshed = await getWorkforceAllocations({ project_id: project.id });
      setAllocations(refreshed.data ?? []);
      setSelectedEmployeeIds([]);
      setMessage("Workforce allocation saved to the project.");
      onRefresh();
    } catch (allocationError) {
      setError(allocationError instanceof Error ? allocationError.message : "Workforce allocation could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  const saveSiteReport = async () => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await createDailySiteReport({
        project_id: project.id,
        report_date: siteReport.report_date,
        shift: siteReport.shift,
        planned_work: siteReport.planned_work || null,
        actual_work: siteReport.actual_work || null,
        delays: siteReport.delays || null,
        safety_notes: siteReport.safety_notes || null,
        cost_exposure: Number(siteReport.cost_exposure || 0),
        labour_count_completed: siteReport.labour_count_completed,
        toolbox_talk_completed: siteReport.toolbox_talk_completed,
        ppe_check_completed: siteReport.ppe_check_completed,
      });
      setMessage("Site report saved to this project.");
      onRefresh();
    } catch (reportError) {
      setError(reportError instanceof Error ? reportError.message : "Site report could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  const saveVariation = async () => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await createFinanceVariation({
        project_id: project.id,
        variation_number: variation.variation_number,
        title: variation.title,
        description: variation.description || null,
        initiated_by: variation.initiated_by,
        cost_impact: Number(variation.cost_impact || 0),
        time_impact_days: Math.trunc(Number(variation.time_impact_days || 0)),
      });
      setMessage("Variation created and linked to project finance.");
      onRefresh();
    } catch (variationError) {
      setError(variationError instanceof Error ? variationError.message : "Variation could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  const saveClaim = async () => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await createFinanceProgressClaim({
        claim_number: claim.claim_number,
        project_id: project.id,
        claim_period_start: claim.claim_period_start,
        claim_period_end: claim.claim_period_end,
        contract_value: Number(claim.contract_value) || 0,
        this_claim_amount: Number(claim.this_claim_amount) || 0,
        retention_pct: Number(claim.retention_pct) || 0,
      });
      setMessage("Progress claim submitted. Certify it in Finance to recognise it as claimed revenue and cash collected.");
      setClaim({
        claim_number: `PC-${Date.now().toString().slice(-6)}`,
        claim_period_start: localDateInput(),
        claim_period_end: localDateInput(),
        contract_value: claim.contract_value,
        this_claim_amount: "0",
        retention_pct: claim.retention_pct,
      });
      onRefresh();
    } catch (claimError) {
      setError(claimError instanceof Error ? claimError.message : "Progress claim could not be submitted.");
    } finally {
      setBusy(false);
    }
  };

  const saveBudget = async () => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (!budgetTotal || budgetTotal <= 0) throw new Error("Enter or upload a budget total greater than zero.");
      if (budgetErrors.length) throw new Error("Correct budget upload errors before protecting the baseline.");
      const budgetNotes = [
        budgetForm.notes,
        `${budgetStage === "master" ? "Master budget baseline" : "Execution budget"} total: ${formatCurrency(budgetTotal)}.`,
        budgetRows.length ? `Uploaded ${budgetStage} budget: ${budgetForm.fileName || "budget file"} with ${acceptedBudgetRows.length} accepted line(s) and ${excludedBudgetRows.length} excluded line(s).` : "",
        budgetRisks.length ? `Risk flags: ${budgetRisks.join(" ")}` : "",
      ].filter(Boolean).join("\n");
      await setProjectBudget(project.id, budgetTotal, budgetNotes, {
        budgetStage,
        lines: acceptedBudgetRows.map((row) => ({
          cost_code: row.cost_code,
          description: row.description,
          cost_category: "other",
          quantity: number(row.quantity) ?? undefined,
          unit: row.unit || undefined,
          unit_rate: number(row.rate) ?? undefined,
          amount: number(row.amount) ?? 0,
          source_line: Math.trunc(number(row.source_line) ?? 0) || undefined,
        })),
      });
      if (budgetStage === "execution") {
        setBudgetSourceRows([]);
        setBudgetColumns([]);
        setBudgetColumnMap(EMPTY_BUDGET_COLUMN_MAP);
        setBudgetForm((current) => ({ ...current, total: "", fileName: "", pastedText: "" }));
        setMessage("Execution budget saved as a review draft against the protected master baseline. Its accepted lines and generated cost codes are retained in Finance; the master baseline was not changed.");
        onRefresh();
        return;
      }
      setBudgetStage("execution");
      setBudgetSourceRows([]);
      setBudgetColumns([]);
      setBudgetColumnMap(EMPTY_BUDGET_COLUMN_MAP);
      setBudgetForm((current) => ({ ...current, total: "", fileName: "", pastedText: "" }));
      setMessage("Master budget baseline saved. Upload the execution budget next so site allowances can be reviewed against the protected baseline.");
      onRefresh();
    } catch (budgetError) {
      setError(budgetError instanceof Error ? budgetError.message : "Budget baseline could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-3" role="dialog" aria-modal="true" aria-label={titleByCommand[command]}>
      <section className="max-h-[88vh] w-full max-w-5xl overflow-y-auto border border-ink-mid bg-ink shadow-2xl">
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-ink-mid bg-ink p-5">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-signal">Project command popup</p>
            <h3 className="mt-1 font-display text-2xl font-semibold text-paper">{titleByCommand[command]}</h3>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-light">{commandDescription[command]}</p>
          </div>
          <button onClick={onClose} className="border border-ink-mid bg-ink-light p-2 text-slate-light hover:border-signal hover:text-paper" aria-label="Close project command">
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="space-y-5 p-5">
          {message ? <div className="border border-emerald-500/30 bg-emerald-950/20 p-3 text-sm text-emerald-200">{message}</div> : null}
          {error ? <div className="border border-red-500/30 bg-red-950/20 p-3 text-sm text-red-200">{error}</div> : null}

          {command === "workforce" ? (
            <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
              <section className="border border-ink-mid">
                <div className="flex items-center justify-between border-b border-ink-mid p-3">
                  <h4 className="font-mono text-xs font-bold uppercase tracking-wider text-paper">Available employees</h4>
                  <span className="font-mono text-[10px] text-slate-light">{selectedEmployeeIds.length} selected</span>
                </div>
                <div className="max-h-[420px] overflow-y-auto">
                  {activeEmployees.map((employee) => {
                    const employeeId = String(employee.id);
                    const selected = selectedEmployeeIds.includes(employeeId);
                    return (
                      <label key={employeeId} className="grid cursor-pointer gap-3 border-b border-ink-mid/60 p-3 hover:bg-ink-light/40 sm:grid-cols-[24px_1fr_180px]">
                        <input type="checkbox" checked={selected} onChange={() => toggleEmployee(employeeId)} className="mt-1 h-4 w-4" />
                        <span>
                          <span className="block text-sm font-semibold text-paper">{text(employee.employee_name ?? employee.name ?? employee.full_name, "Unnamed employee")}</span>
                          <span className="mt-1 block text-xs text-slate-light">{text(employee.job_title ?? employee.role ?? employee.position, "Role not recorded")} · {allocatedIds.has(employeeId) ? "Already allocated to this project" : "Available for allocation"}</span>
                        </span>
                        <span className="text-xs text-slate-light">{text(employee.department ?? employee.work_location ?? employee.location, "No department")}</span>
                      </label>
                    );
                  })}
                </div>
              </section>
              <section className="space-y-3 border border-ink-mid p-4">
                <h4 className="font-mono text-xs font-bold uppercase tracking-wider text-paper">Allocation details</h4>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Start"><input type="date" value={allocationWindow.starts_on} onChange={(e) => setAllocationWindow({ ...allocationWindow, starts_on: e.target.value })} className="field" /></Field>
                  <Field label="End"><input type="date" value={allocationWindow.ends_on} onChange={(e) => setAllocationWindow({ ...allocationWindow, ends_on: e.target.value })} className="field" /></Field>
                  <Field label="Capacity %"><input value={allocationWindow.allocation_percent} onChange={(e) => setAllocationWindow({ ...allocationWindow, allocation_percent: e.target.value })} className="field" /></Field>
                </div>
                {selectedRows.map((employee) => {
                  const employeeId = String(employee.id);
                  return (
                    <div key={employeeId} className="grid gap-2 border border-ink-mid bg-ink-light/20 p-3">
                      <p className="text-sm font-semibold text-paper">{text(employee.employee_name ?? employee.name ?? employee.full_name, "Unnamed employee")}</p>
                      <input value={roleByEmployee[employeeId] ?? ""} onChange={(e) => setRoleByEmployee({ ...roleByEmployee, [employeeId]: e.target.value })} placeholder="Project role: Engineer, Foreman, Clerk..." className="field" />
                      <input value={accountRoleByEmployee[employeeId] ?? ""} onChange={(e) => setAccountRoleByEmployee({ ...accountRoleByEmployee, [employeeId]: e.target.value })} placeholder="Account match or manual note" className="field" />
                    </div>
                  );
                })}
                <button onClick={() => void saveAllocations()} disabled={busy || selectedRows.length === 0} className="inline-flex h-10 w-full items-center justify-center gap-2 bg-signal px-4 font-mono text-xs font-bold uppercase text-ink disabled:opacity-50">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} Save workforce allocation
                </button>
                <RecordList title="Current allocations" records={allocations} columns={["employee_name", "role_on_project", "allocation_percent", "starts_on", "ends_on", "status"]} />
              </section>
            </div>
          ) : null}

          {command === "siteReports" ? (
            <div className="grid gap-5 xl:grid-cols-[1fr_0.9fr]">
              <RecordList title="Retained site reports" records={detail?.site_reports ?? []} columns={["report_date", "shift", "status", "actual_work", "delays", "cost_exposure"]} />
              <section className="space-y-3 border border-ink-mid p-4">
                <h4 className="font-mono text-xs font-bold uppercase tracking-wider text-paper">Add site report</h4>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Date"><input type="date" value={siteReport.report_date} onChange={(e) => setSiteReport({ ...siteReport, report_date: e.target.value })} className="field" /></Field>
                  <Field label="Shift"><select value={siteReport.shift} onChange={(e) => setSiteReport({ ...siteReport, shift: e.target.value })} className="field"><option value="day">Day</option><option value="night">Night</option><option value="double">Double</option></select></Field>
                </div>
                <Field label="Planned work"><textarea rows={3} value={siteReport.planned_work} onChange={(e) => setSiteReport({ ...siteReport, planned_work: e.target.value })} className="textarea" /></Field>
                <Field label="Actual work"><textarea rows={3} value={siteReport.actual_work} onChange={(e) => setSiteReport({ ...siteReport, actual_work: e.target.value })} className="textarea" /></Field>
                <Field label="Delays"><textarea rows={2} value={siteReport.delays} onChange={(e) => setSiteReport({ ...siteReport, delays: e.target.value })} className="textarea" /></Field>
                <Field label="Safety notes"><textarea rows={2} value={siteReport.safety_notes} onChange={(e) => setSiteReport({ ...siteReport, safety_notes: e.target.value })} className="textarea" /></Field>
                <Field label="Cost exposure"><input value={siteReport.cost_exposure} onChange={(e) => setSiteReport({ ...siteReport, cost_exposure: e.target.value })} className="field" /></Field>
                <button onClick={() => void saveSiteReport()} disabled={busy} className="inline-flex h-10 w-full items-center justify-center gap-2 bg-signal px-4 font-mono text-xs font-bold uppercase text-ink disabled:opacity-50">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save site report
                </button>
              </section>
            </div>
          ) : null}

          {command === "rfqs" ? (
            <div className="space-y-4">
              <RecordList title="Project RFQs" records={signals.rfqs} columns={["rfq_number", "title", "status", "closing_date", "requisition_number"]} />
              <section className="border border-ink-mid p-4">
                <h4 className="font-mono text-xs font-bold uppercase tracking-wider text-paper">Supplier price pressure</h4>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  {signals.rfqs.flatMap((rfq) => Array.isArray(rfq.responses) ? rfq.responses.map((response: Record<string, unknown>) => ({ rfq, response })) : []).slice(0, 8).map(({ rfq, response }) => (
                    <div key={`${String(rfq.id)}-${String(response.id)}`} className="border border-ink-mid bg-ink-light/20 p-3">
                      <p className="text-sm font-semibold text-paper">{text(response.supplier_name, "Supplier")}</p>
                      <p className="mt-1 text-xs text-slate-light">{text(rfq.title ?? rfq.rfq_number, "RFQ")} · {formatCurrency(number(response.total_amount) ?? 0)} · {text(response.delivery_days, "No")} days</p>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-xs leading-5 text-slate-light">New RFQs must still start from an approved requisition and current weekly budget gate. This popup exposes the project RFQ evidence without bypassing that control.</p>
              </section>
            </div>
          ) : null}

          {command === "variations" ? (
            <div className="grid gap-5 xl:grid-cols-[1fr_0.9fr]">
              <RecordList title="Project variations" records={signals.financeVariations} columns={["variation_number", "title", "status", "cost_impact", "time_impact_days", "initiated_by"]} />
              <section className="space-y-3 border border-ink-mid p-4">
                <h4 className="font-mono text-xs font-bold uppercase tracking-wider text-paper">Create variation</h4>
                <Field label="Variation number"><input value={variation.variation_number} onChange={(e) => setVariation({ ...variation, variation_number: e.target.value })} className="field" /></Field>
                <Field label="Title"><input value={variation.title} onChange={(e) => setVariation({ ...variation, title: e.target.value })} className="field" /></Field>
                <Field label="Description"><textarea rows={3} value={variation.description} onChange={(e) => setVariation({ ...variation, description: e.target.value })} className="textarea" /></Field>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Initiated by"><input value={variation.initiated_by} onChange={(e) => setVariation({ ...variation, initiated_by: e.target.value })} className="field" /></Field>
                  <Field label="Cost impact"><input value={variation.cost_impact} onChange={(e) => setVariation({ ...variation, cost_impact: e.target.value })} className="field" /></Field>
                  <Field label="Time days"><input value={variation.time_impact_days} onChange={(e) => setVariation({ ...variation, time_impact_days: e.target.value })} className="field" /></Field>
                </div>
                <button onClick={() => void saveVariation()} disabled={busy || !variation.title} className="inline-flex h-10 w-full items-center justify-center gap-2 bg-signal px-4 font-mono text-xs font-bold uppercase text-ink disabled:opacity-50">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save variation
                </button>
              </section>
            </div>
          ) : null}

          {command === "claim" ? (
            <div className="grid gap-5 xl:grid-cols-[1fr_0.9fr]">
              <RecordList title="Project progress claims" records={signals.progressClaims} columns={["claim_number", "status", "this_claim_amount", "certified_amount", "claim_period_end"]} />
              <section className="space-y-3 border border-ink-mid p-4">
                <h4 className="font-mono text-xs font-bold uppercase tracking-wider text-paper">Submit progress claim</h4>
                <p className="text-xs leading-5 text-slate-light">
                  A deposit already confirmed on this project (Deposit Confirmation step) is recognised in Finance automatically. Use this to submit any further billing claim - Finance certifies it, which recognises it as claimed revenue and cash collected here.
                </p>
                <Field label="Claim number"><input value={claim.claim_number} onChange={(e) => setClaim({ ...claim, claim_number: e.target.value })} className="field" /></Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Period start"><input type="date" value={claim.claim_period_start} onChange={(e) => setClaim({ ...claim, claim_period_start: e.target.value })} className="field" /></Field>
                  <Field label="Period end"><input type="date" value={claim.claim_period_end} onChange={(e) => setClaim({ ...claim, claim_period_end: e.target.value })} className="field" /></Field>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Contract value"><input value={claim.contract_value} onChange={(e) => setClaim({ ...claim, contract_value: e.target.value })} type="number" min="0" className="field" /></Field>
                  <Field label="Claim amount"><input value={claim.this_claim_amount} onChange={(e) => setClaim({ ...claim, this_claim_amount: e.target.value })} type="number" min="0.01" className="field" /></Field>
                  <Field label="Retention %"><input value={claim.retention_pct} onChange={(e) => setClaim({ ...claim, retention_pct: e.target.value })} type="number" min="0" max="100" className="field" /></Field>
                </div>
                <button onClick={() => void saveClaim()} disabled={busy || !claim.claim_number || Number(claim.this_claim_amount) <= 0} className="inline-flex h-10 w-full items-center justify-center gap-2 bg-signal px-4 font-mono text-xs font-bold uppercase text-ink disabled:opacity-50">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Submit claim
                </button>
              </section>
            </div>
          ) : null}

          {command === "budget" ? (
            <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
              <section className="space-y-3 border border-ink-mid p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="font-mono text-xs font-bold uppercase tracking-wider text-paper">{budgetStage === "master" ? "Protect master budget baseline" : "Upload execution budget"}</h4>
                  <span className="border border-ink-mid px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-signal">{budgetStage === "master" ? "Step 1 / Master" : "Step 2 / Execution"}</span>
                </div>
                <p className="text-xs leading-5 text-slate-light">
                  {budgetStage === "master"
                    ? "Upload the master budget first. Rows without a positive amount are excluded for review, but valid budget rows can still protect the baseline."
                    : "Upload the execution budget after the master baseline. This is the site-facing allowance review that should be checked against the protected master budget."}
                </p>
                <Field label="Manual total"><input value={budgetForm.total} onChange={(e) => setBudgetForm({ ...budgetForm, total: e.target.value })} placeholder={budgetStage === "master" ? "Total approved master budget" : "Total execution budget"} className="field" /></Field>
                <Field label="Upload budget"><input type="file" accept=".csv,.txt,.tsv,.xls,.xlsx,.pdf,.doc,.docx" onChange={(e) => { const file = e.target.files?.[0]; if (file) void parseBudgetFile(file); }} className="block w-full text-sm text-slate-light file:mr-3 file:border-0 file:bg-signal file:px-3 file:py-2 file:font-mono file:text-xs file:uppercase file:text-ink" /></Field>
                <Field label="Paste table text"><textarea rows={4} value={budgetForm.pastedText} onChange={(e) => setBudgetForm({ ...budgetForm, pastedText: e.target.value })} placeholder="Paste from Excel, Word, or a PDF table: cost code, description, qty, rate, amount" className="textarea" /></Field>
                <button type="button" onClick={parsePastedBudget} disabled={!budgetForm.pastedText.trim()} className="inline-flex h-9 w-full items-center justify-center gap-2 border border-ink-mid bg-ink-light px-3 font-mono text-[10px] uppercase tracking-wider text-slate-light hover:border-signal hover:text-paper disabled:opacity-50">
                  Match pasted budget
                </button>
                {budgetColumns.length ? (
                  <section className="border border-ink-mid bg-ink-light/20 p-3">
                    <h5 className="font-mono text-[10px] font-bold uppercase tracking-wider text-paper">Match uploaded columns</h5>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {(Object.keys(EMPTY_BUDGET_COLUMN_MAP) as (keyof BudgetColumnMap)[]).map((field) => (
                        <Field key={field} label={field.replace(/_/g, " ")}>
                          <select value={budgetColumnMap[field]} onChange={(e) => setBudgetColumnMap({ ...budgetColumnMap, [field]: e.target.value })} className="field">
                            <option value="">Auto / not supplied</option>
                            {budgetColumns.map((column) => <option key={column} value={column}>{column}</option>)}
                          </select>
                        </Field>
                      ))}
                    </div>
                  </section>
                ) : null}
                <Field label="Baseline notes"><textarea rows={4} value={budgetForm.notes} onChange={(e) => setBudgetForm({ ...budgetForm, notes: e.target.value })} className="textarea" /></Field>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Info label="Parsed lines" value={String(budgetRows.length)} />
                  <Info label="Accepted lines" value={String(acceptedBudgetRows.length)} />
                  <Info label="Baseline total" value={budgetTotal > 0 ? formatCurrency(budgetTotal) : "Not calculated"} />
                </div>
                <button onClick={() => void saveBudget()} disabled={busy || !budgetTotal || budgetErrors.length > 0} className="inline-flex h-10 w-full items-center justify-center gap-2 bg-signal px-4 font-mono text-xs font-bold uppercase text-ink disabled:opacity-50">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calculator className="h-4 w-4" />} {budgetStage === "master" ? "Save master baseline" : "Save execution budget draft"}
                </button>
                {budgetStage === "execution" ? (
                  <button type="button" onClick={() => setBudgetStage("master")} className="inline-flex h-9 w-full items-center justify-center border border-ink-mid px-3 font-mono text-[10px] uppercase tracking-wider text-slate-light hover:border-signal hover:text-paper">
                    Back to master budget
                  </button>
                ) : null}
              </section>
              <section className="space-y-4">
                <RecordList title="Existing budget records" records={signals.budgets} columns={["label", "status", "budget_version", "total_amount", "effective_date"]} />
                <section className="border border-ink-mid p-4">
                  <h4 className="mb-3 font-mono text-xs font-bold uppercase tracking-wider text-paper">Budget source document</h4>
                  <EntityDocumentsPanel entityType="project" entityId={project.id} />
                </section>
                <div className="grid gap-3 md:grid-cols-2">
                  <RiskList title="Upload errors" tone="red" items={budgetErrors} empty="No blocking upload errors detected." />
                  <RiskList title="Risk flags" tone="amber" items={budgetRisks} empty="No immediate baseline risks detected." />
                </div>
                <RecordList title="Accepted budget lines" records={acceptedBudgetRows} columns={["source_line", "cost_code", "description", "quantity", "unit", "amount"]} />
                {excludedBudgetRows.length ? <RecordList title="Excluded rows for review" records={excludedBudgetRows} columns={["source_line", "cost_code", "description", "quantity", "unit", "amount", "review_note"]} /> : null}
              </section>
            </div>
          ) : null}

          {command === "documents" ? <EntityDocumentsPanel entityType="project" entityId={project.id} /> : null}
          {command === "progress" ? <RecordList title="Progress and milestones" records={[...(detail?.milestones ?? []), ...(signals.boqSummary ? [signals.boqSummary] : [])]} columns={["name", "status", "percent_complete", "earned_value", "forecast_date", "actual_date"]} /> : null}
          {command === "controls" ? <ProjectControlsPanel project={project} detail={detail} signals={signals} onOpenTab={onNavigateTab} onOpenCommand={onNavigateCommand} /> : null}
          {command === "materials" ? <RecordList title="Material consumption and receipts" records={[...(detail?.material_records ?? []), ...signals.grns]} columns={["item_name", "description", "quantity_used", "received_quantity", "unit_cost", "wastage_quantity", "status"]} /> : null}
        </div>
        <style jsx>{`.field{height:2.5rem;width:100%;border:1px solid rgb(47 55 69);background:#09111f;padding:0 .75rem;font-size:.875rem;color:#f8fafc;outline:none}.textarea{width:100%;resize:vertical;border:1px solid rgb(47 55 69);background:#09111f;padding:.75rem;font-size:.875rem;color:#f8fafc;outline:none}`}</style>
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate">{label}</span>
      {children}
    </label>
  );
}

function RecordList({ title: listTitle, records, columns }: { title: string; records: Record<string, unknown>[]; columns: string[] }) {
  const moneyFields = new Set(["amount", "budget", "cost", "cost_exposure", "cost_impact", "earned_value", "planned_cost", "total_amount", "unit_cost", "value"]);
  return (
    <section className="border border-ink-mid">
      <div className="flex items-center justify-between border-b border-ink-mid p-3">
        <h4 className="font-mono text-xs font-bold uppercase tracking-wider text-paper">{listTitle}</h4>
        <span className="font-mono text-[10px] text-slate-light">{records.length} record(s)</span>
      </div>
      {records.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-xs">
            <thead className="border-b border-ink-mid font-mono uppercase tracking-wider text-slate">
              <tr>{columns.map((column) => <th key={column} className="px-3 py-2 font-normal">{column.replace(/_/g, " ")}</th>)}</tr>
            </thead>
            <tbody>
              {records.slice(0, 25).map((record, index) => (
                <tr key={String(record.id ?? index)} className="border-b border-ink-mid/60">
                  {columns.map((column) => {
                    const value = record[column];
                    const display = moneyFields.has(column) ? formatCurrency(number(value) ?? 0) : text(value, "-");
                    return <td key={column} className="px-3 py-2 text-slate-light">{display}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="p-4 text-sm text-slate-light">No records are currently linked to this project.</p>
      )}
    </section>
  );
}

function RiskList({ title: riskTitle, items, empty, tone }: { title: string; items: string[]; empty: string; tone: "red" | "amber" }) {
  const toneClass = tone === "red" ? "border-red-500/30 bg-red-950/20 text-red-200" : "border-amber-500/30 bg-amber-950/20 text-amber-100";
  return (
    <section className="border border-ink-mid p-4">
      <h4 className="font-mono text-xs font-bold uppercase tracking-wider text-paper">{riskTitle}</h4>
      <div className="mt-3 space-y-2">
        {(items.length ? items : [empty]).map((item) => (
          <div key={item} className={`border p-3 text-xs leading-5 ${items.length ? toneClass : "border-ink-mid bg-ink-light/20 text-slate-light"}`}>{item}</div>
        ))}
      </div>
    </section>
  );
}

interface GanttMilestone {
  id: string;
  name: string;
  status: 'not_started' | 'in_progress' | 'complete' | 'blocked' | 'cancelled';
  weight: number | null;
  ownerName: string | null;
  baselineWeek: number | null; // weeks since project start_date, 1-indexed
  forecastWeek: number | null;
  actualWeek: number | null;
}

const NEXT_MILESTONE_STATUS: Record<GanttMilestone["status"], GanttMilestone["status"]> = {
  not_started: "in_progress",
  in_progress: "complete",
  complete: "not_started",
  blocked: "in_progress",
  cancelled: "not_started",
};

/** A point marker for a single milestone date on the 16-week Gantt axis - a
 * milestone is a date, not a duration, so it's plotted as a dot, not a bar.
 * `row` stacks multiple dots vertically within a row (comparison mode). */
function MilestoneMarker({ week, colorClass, label, row }: { week: number | null; colorClass: string; label: string; row?: number }) {
  if (!week) return null;
  const clamped = Math.min(Math.max(week, 1), 16);
  const leftPct = ((clamped - 0.5) / 16) * 100;
  const topStyle = row == null ? { top: "50%" } : { top: `${8 + row * 12}px` };
  return (
    <div
      className={`absolute z-10 h-2.5 w-2.5 cursor-help rounded-full border-2 group ${colorClass}`}
      style={{ left: `${leftPct}%`, ...topStyle, transform: "translate(-50%, -50%)" }}
      title={label}
    >
      <span className="pointer-events-none absolute -top-6 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-sm bg-ink/90 px-1.5 py-0.5 font-mono text-[8px] text-paper opacity-0 transition-opacity group-hover:opacity-100">
        {label}
      </span>
    </div>
  );
}

function AddMilestoneForm({ projectId, onClose, onAdded }: { projectId: string; onClose: () => void; onAdded: () => void }) {
  const [users, setUsers] = useState<{ id: string; full_name: string; email: string }[]>([]);
  const [form, setForm] = useState({ name: "", status: "not_started", baseline_date: "", forecast_date: "", weight: "", owner_id: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getAssignableUsers().then((res) => setUsers(res.data ?? [])).catch(() => setUsers([]));
  }, []);

  const submit = async () => {
    if (!form.name.trim()) { setError("Milestone name is required."); return; }
    setBusy(true); setError(null);
    try {
      await addProjectMilestone(projectId, {
        name: form.name.trim(),
        status: form.status,
        baseline_date: form.baseline_date || undefined,
        forecast_date: form.forecast_date || undefined,
        weight: form.weight ? Number(form.weight) : undefined,
        owner_id: form.owner_id || undefined,
      });
      onAdded();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add milestone.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border border-signal/30 bg-signal/5 p-4 space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Milestone name *" className="h-9 border border-ink-mid bg-ink-light px-3 text-xs text-paper sm:col-span-2" />
        <div>
          <label className="mb-1 block font-mono text-[9px] uppercase text-slate">Baseline date</label>
          <input value={form.baseline_date} onChange={(e) => setForm((f) => ({ ...f, baseline_date: e.target.value }))} type="date" className="h-9 w-full border border-ink-mid bg-ink-light px-3 text-xs text-paper" />
        </div>
        <div>
          <label className="mb-1 block font-mono text-[9px] uppercase text-slate">Forecast date</label>
          <input value={form.forecast_date} onChange={(e) => setForm((f) => ({ ...f, forecast_date: e.target.value }))} type="date" className="h-9 w-full border border-ink-mid bg-ink-light px-3 text-xs text-paper" />
        </div>
        <div>
          <label className="mb-1 block font-mono text-[9px] uppercase text-slate">Weight (% of programme)</label>
          <input value={form.weight} onChange={(e) => setForm((f) => ({ ...f, weight: e.target.value }))} type="number" min="0" max="100" className="h-9 w-full border border-ink-mid bg-ink-light px-3 text-xs text-paper" />
        </div>
        <div>
          <label className="mb-1 block font-mono text-[9px] uppercase text-slate">Owner</label>
          <select value={form.owner_id} onChange={(e) => setForm((f) => ({ ...f, owner_id: e.target.value }))} className="h-9 w-full border border-ink-mid bg-ink-light px-3 text-xs text-paper">
            <option value="">Unassigned</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select>
        </div>
      </div>
      {error && <p className="text-xs text-red-300">{error}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="h-9 border border-ink-mid px-3 font-mono text-[10px] uppercase text-slate-light hover:text-paper">Cancel</button>
        <button onClick={() => void submit()} disabled={busy} className="h-9 bg-signal px-3 font-mono text-[10px] font-bold uppercase text-ink disabled:opacity-50">
          {busy ? "Adding..." : "Add Milestone"}
        </button>
      </div>
    </div>
  );
}

export function ProjectDetail({
  project,
  initialTab,
  detail,
  loading,
  error,
  onClose,
  departments,
  clientOrganizations,
  clientContacts,
  onDepartmentChange,
  onProjectUpdated,
  onRefresh,
  onDeleted,
}: {
  project: Project;
  initialTab: ProjectTab;
  detail: Detail | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  departments: Department[];
  clientOrganizations: ClientOrganization[];
  clientContacts: ClientContact[];
  onDepartmentChange: (departmentId: string) => void;
  onProjectUpdated: (patch: Partial<Project>) => void;
  onRefresh: () => void;
  onDeleted: () => void;
}) {
  const { role } = useAuth();
  const source = detail?.project ?? project;

  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleDelete = useCallback(async () => {
    setDeleteError(null);
    let acknowledgeMoney = false;
    try {
      const impact = await getProjectDeleteImpact(project.id);
      const money = impact.data?.money;
      if (money?.has_money) {
        const usd = (n: number) => new Intl.NumberFormat("en-ZW", { style: "currency", currency: "USD" }).format(n || 0);
        const lines = [
          money.bank_lines ? `- ${money.bank_lines} bank statement line(s): ${usd(money.bank_in)} in, ${usd(money.bank_out)} out` : "",
          money.split_parts ? `- ${money.split_parts} split / cash-use part(s): ${usd(money.split_amount)}` : "",
          money.claims ? `- ${money.claims} claim(s), ${usd(money.collected)} collected` : "",
          money.cost_entries ? `- ${money.cost_entries} cost entr${money.cost_entries === 1 ? "y" : "ies"}: ${usd(money.actual_cost)}` : "",
          money.ledger_lines ? `- ${money.ledger_lines} general ledger line(s)` : "",
          money.petty_cash ? `- ${usd(money.petty_cash)} in its petty cash float` : "",
        ].filter(Boolean).join("\n");
        const ok = window.confirm(
          `WARNING: "${title(project)}" has money attached:\n\n${lines}\n\n` +
          "Deleting archives the project: all of this disappears from the Finance dashboard, project lists and pickers " +
          "(it stays in the bank records and the ledger, attached to a hidden project).\n\n" +
          "If you meant to move this money, cancel and re-tag its bank lines to another project first " +
          "(Finance > Bank Statement Review).\n\nArchive it anyway?",
        );
        if (!ok) return;
        acknowledgeMoney = true;
      } else if (!window.confirm(`Delete "${title(project)}"? If it has no linked activity anywhere it will be permanently wiped; otherwise it will be archived instead.`)) {
        return;
      }
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Could not check what this project is linked to.");
      return;
    }
    setDeleting(true);
    try {
      const res = await deleteInternalProject(project.id, acknowledgeMoney);
      if (!res.success) throw new Error("Project could not be deleted.");
      if (res.data?.wiped) {
        window.alert(`"${title(project)}" was permanently deleted.`);
      } else {
        const blockers = (res.data?.blocked_by ?? []).map((b) => `${b.table} (${b.count})`).join(", ");
        window.alert(`"${title(project)}" has linked records - archived instead of deleted.${blockers ? `\n\nLinked: ${blockers}` : ""}`);
      }
      onDeleted();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Project could not be deleted.");
    } finally {
      setDeleting(false);
    }
  }, [project, onDeleted]);

  const [departmentSaving, setDepartmentSaving] = useState(false);
  const [departmentError, setDepartmentError] = useState<string | null>(null);
  const [clientSaving, setClientSaving] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);
  const [clientLinkType, setClientLinkType] = useState<"organization" | "individual">(
    source.client_id ? "individual" : "organization",
  );

  useEffect(() => {
    setClientLinkType(source.client_id ? "individual" : "organization");
  }, [source.client_id, source.client_org_id]);

  const handleDepartmentSelect = useCallback(async (event: React.ChangeEvent<HTMLSelectElement>) => {
    const deptId = event.target.value;
    setDepartmentSaving(true);
    setDepartmentError(null);
    try {
      await withOneRetry(() => updateInternalProject(project.id, { department_id: deptId || null }));
      onDepartmentChange(deptId);
    } catch (err) {
      setDepartmentError(err instanceof Error ? err.message : "Failed to update department.");
    } finally {
      setDepartmentSaving(false);
    }
  }, [project.id, onDepartmentChange]);

  const handleClientSelect = useCallback(async (event: React.ChangeEvent<HTMLSelectElement>) => {
    const clientId = event.target.value;
    const selectedOrg = clientOrganizations.find((org) => org.id === clientId);
    const selectedContact = clientContacts.find((contact) => contact.id === clientId);
    const clientName = clientLinkType === "organization" ? selectedOrg?.name : selectedContact ? contactLabel(selectedContact) : undefined;
    setClientSaving(true);
    setClientError(null);
    try {
      const response = await withOneRetry(() => updateInternalProject(project.id, {
        client_org_id: clientLinkType === "organization" ? clientId || null : null,
        client_id: clientLinkType === "individual" ? clientId || null : null,
        client_name: clientName ?? null,
      }));
      const saved = response.data && typeof response.data === "object" ? response.data as Partial<Project> : {};
      onProjectUpdated({
        client_org_id: ((saved.client_org_id as string | undefined) ?? (clientLinkType === "organization" ? clientId : "")) || undefined,
        client_id: ((saved.client_id as string | undefined) ?? (clientLinkType === "individual" ? clientId : "")) || undefined,
        client_name: (saved.client_name as string | undefined) ?? clientName ?? undefined,
      });
    } catch (err) {
      setClientError(err instanceof Error ? err.message : "Failed to link client account.");
    } finally {
      setClientSaving(false);
    }
  }, [clientContacts, clientLinkType, clientOrganizations, project.id, onProjectUpdated]);

  const [nameEditing, setNameEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState(() => text(source.name, ""));
  const [nameSaving, setNameSaving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  const startNameEdit = useCallback(() => {
    setNameDraft(text(source.name, ""));
    setNameError(null);
    setNameEditing(true);
  }, [source.name]);

  const cancelNameEdit = useCallback(() => {
    setNameEditing(false);
    setNameError(null);
  }, []);

  const saveNameEdit = useCallback(async () => {
    const trimmed = nameDraft.trim();
    if (!trimmed) {
      setNameError("Project name can't be empty.");
      return;
    }
    if (trimmed === text(source.name, "")) {
      setNameEditing(false);
      return;
    }
    setNameSaving(true);
    setNameError(null);
    try {
      const response = await withOneRetry(() => updateInternalProject(project.id, { name: trimmed }));
      const saved = response.data && typeof response.data === "object" ? response.data as Partial<Project> : {};
      onProjectUpdated({ name: (saved.name as string | undefined) ?? trimmed });
      setNameEditing(false);
    } catch (err) {
      setNameError(err instanceof Error ? err.message : "Failed to update project name.");
    } finally {
      setNameSaving(false);
    }
  }, [nameDraft, project.id, source.name, onProjectUpdated]);
  const viability = detail?.viability?.[0];

  // Region/coordinates live on projects.project_profiles, not projects.projects, so they
  // arrive either on `viability` (executive detail endpoint) or directly on `source`
  // (plain project-record fallback) depending on which lookup succeeded in openProject().
  const currentRegion = text((viability?.region ?? (source as Project).region) as string | undefined, "");
  const currentLat = (viability?.latitude ?? (source as Project).latitude) as number | string | undefined;
  const currentLong = (viability?.longitude ?? (source as Project).longitude) as number | string | undefined;

  const [regionSaving, setRegionSaving] = useState(false);
  const [regionError, setRegionError] = useState<string | null>(null);
  const [regionOverride, setRegionOverride] = useState<string | null>(null);

  const handleRegionSelect = useCallback(async (event: React.ChangeEvent<HTMLSelectElement>) => {
    const region = event.target.value;
    setRegionSaving(true);
    setRegionError(null);
    try {
      const response = await updateInternalProject(project.id, { region: region || null });
      const saved = response.data && typeof response.data === "object" ? response.data as Partial<Project> : {};
      setRegionOverride(region);
      onProjectUpdated({ region: (saved.region as string | undefined) ?? region });
      onRefresh();
    } catch (err) {
      setRegionError("Failed to update region.");
    } finally {
      setRegionSaving(false);
    }
  }, [project.id, onProjectUpdated, onRefresh]);

  const [coords, setCoords] = useState({ latitude: "", longitude: "" });
  const [coordsSaving, setCoordsSaving] = useState(false);
  const [coordsError, setCoordsError] = useState<string | null>(null);
  const [coordsDirty, setCoordsDirty] = useState(false);

  useEffect(() => {
    if (coordsDirty) return;
    setCoords({
      latitude: currentLat !== undefined && currentLat !== null ? String(currentLat) : "",
      longitude: currentLong !== undefined && currentLong !== null ? String(currentLong) : "",
    });
  }, [currentLat, currentLong, coordsDirty]);

  const saveCoords = useCallback(async () => {
    const lat = coords.latitude.trim();
    const long = coords.longitude.trim();
    const latNum = lat ? Number(lat) : null;
    const longNum = long ? Number(long) : null;
    if ((lat && !Number.isFinite(latNum)) || (long && !Number.isFinite(longNum))) {
      setCoordsError("Latitude/longitude must be numbers.");
      return;
    }
    setCoordsSaving(true);
    setCoordsError(null);
    try {
      const response = await updateInternalProject(project.id, { latitude: latNum, longitude: longNum });
      const saved = response.data && typeof response.data === "object" ? response.data as Partial<Project> : {};
      onProjectUpdated({
        latitude: saved.latitude ?? latNum ?? undefined,
        longitude: saved.longitude ?? longNum ?? undefined,
      });
      setCoordsDirty(false);
      onRefresh();
    } catch (err) {
      setCoordsError("Failed to update coordinates.");
    } finally {
      setCoordsSaving(false);
    }
  }, [coords, project.id, onProjectUpdated, onRefresh]);

  // Start/programme-end dates live directly on projects.projects (not the
  // profile side table), and were previously only settable via Field
  // Intake/registration - this closes the same "Setup gaps to close" items
  // from inside the popup that reports them missing.
  const currentStartDate = text(source.start_date as string | undefined, "");
  const currentPlannedEnd = text((source as Record<string, unknown>).planned_completion_date as string | undefined, "");
  const [programmeDates, setProgrammeDates] = useState({ start_date: "", planned_completion_date: "" });
  const [programmeDatesDirty, setProgrammeDatesDirty] = useState(false);
  const [programmeDatesSaving, setProgrammeDatesSaving] = useState(false);
  const [programmeDatesError, setProgrammeDatesError] = useState<string | null>(null);

  useEffect(() => {
    if (programmeDatesDirty) return;
    setProgrammeDates({
      start_date: currentStartDate ? currentStartDate.slice(0, 10) : "",
      planned_completion_date: currentPlannedEnd ? currentPlannedEnd.slice(0, 10) : "",
    });
  }, [currentStartDate, currentPlannedEnd, programmeDatesDirty]);

  const saveProgrammeDates = useCallback(async () => {
    setProgrammeDatesSaving(true);
    setProgrammeDatesError(null);
    try {
      const response = await updateInternalProject(project.id, {
        start_date: programmeDates.start_date || null,
        planned_completion_date: programmeDates.planned_completion_date || null,
      });
      const saved = response.data && typeof response.data === "object" ? response.data as Partial<Project> : {};
      onProjectUpdated({
        start_date: (saved.start_date as string | undefined) ?? programmeDates.start_date ?? undefined,
        planned_completion_date: (saved.planned_completion_date as string | undefined) ?? programmeDates.planned_completion_date ?? undefined,
      } as Partial<Project>);
      // No onRefresh() here (unlike region/coords below): start_date and
      // planned_completion_date live directly on projects.projects, so
      // onProjectUpdated's patch into detail.project above already is the
      // fresh value - a full detail refetch would be redundant. Region and
      // coordinates live on project_profiles/viability instead, which
      // onProjectUpdated never touches, so those two genuinely need it.
      setProgrammeDatesDirty(false);
    } catch (err) {
      setProgrammeDatesError("Failed to update programme dates.");
    } finally {
      setProgrammeDatesSaving(false);
    }
  }, [programmeDates, project.id, onProjectUpdated]);

  const [activeTab, setActiveTab] = useState<ProjectTab>(initialTab);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab, project.id]);

  const [teamRows, setTeamRows] = useState<ProjectTeamMember[]>([]);
  const [teamLoading, setTeamLoading] = useState(false);
  const [teamError, setTeamError] = useState<string | null>(null);

  useEffect(() => {
    if (activeTab !== "team") return;
    let active = true;
    setTeamLoading(true);
    setTeamError(null);
    getProjectTeam(project.id)
      .then((res) => {
        if (!active) return;
        setTeamRows(res.data ?? []);
      })
      .catch((err) => {
        if (!active) return;
        setTeamError(err instanceof Error ? err.message : "Project team could not be loaded.");
      })
      .finally(() => {
        if (active) setTeamLoading(false);
      });
    return () => { active = false; };
  }, [activeTab, project.id]);

  // Source-backed financial parameters. Missing finance fields must not be replaced with generated values.
  const contractVal = useMemo(() => {
    const apiVal = number(source.contract_value ?? source.budget ?? source.budget_value);
    if (apiVal && apiVal > 0) return apiVal;
    return 0;
  }, [source]);

  const budgetedCost = useMemo(() => {
    return number(viability?.budget_amount ?? source.budget_amount ?? source.budgeted_cost ?? source.budget_cost) ?? 0;
  }, [source, viability]);

  const initialOverrunPercent = 0;

  // Financial Sliders State
  const [overrunSlider, setOverrunSlider] = useState(0);
  const [overheadSlider, setOverheadSlider] = useState(0);

  useEffect(() => {
    setOverrunSlider(initialOverrunPercent);
    setOverheadSlider(number(source.overhead_pct ?? viability?.overhead_pct) ?? 0);
  }, [source, viability, initialOverrunPercent]);

  const forecastCost = useMemo(() => {
    return number(viability?.forecast_cost ?? source.forecast_cost ?? source.forecast_final_cost ?? source.estimate_at_completion) ?? 0;
  }, [source, viability]);

  // Margin calculation formulas
  const budgetedGrossProfit = contractVal - budgetedCost;
  const budgetedGrossMarginPct = contractVal > 0 ? (budgetedGrossProfit / contractVal) * 100 : 0;

  const forecastGrossProfit = contractVal - forecastCost;
  const forecastGrossMarginPct = contractVal > 0 ? (forecastGrossProfit / contractVal) * 100 : 0;

  const marginSlippage = forecastGrossMarginPct - budgetedGrossMarginPct;

  const forecastNetProfit = forecastGrossProfit - (contractVal * (overheadSlider / 100));
  const forecastNetMarginPct = contractVal > 0 ? (forecastNetProfit / contractVal) * 100 : 0;

  const markupPct = budgetedCost > 0 ? ((contractVal - budgetedCost) / budgetedCost) * 100 : 0;
  const costOverrunPct = budgetedCost > 0 ? ((forecastCost - budgetedCost) / budgetedCost) * 100 : 0;

  // ----------------------------------------------------
  // GANTT SCHEDULE & FILTER STATE
  // ----------------------------------------------------
  const [scheduleTimelineFilter, setScheduleTimelineFilter] = useState<"comparison" | "baseline" | "forecast" | "actual">("comparison");
  const [scheduleStatusFilter, setScheduleStatusFilter] = useState<"all" | "complete" | "in_progress" | "blocked" | "not_started">("all");
  const [activeCommand, setActiveCommand] = useState<ProjectCommand | null>(null);

  // Real milestones, fetched from the lifecycle endpoint - no fabricated
  // schedule data or placeholder owners. Empty until someone actually logs one.
  const [rawMilestones, setRawMilestones] = useState<Record<string, unknown>[]>([]);
  const [milestonesLoading, setMilestonesLoading] = useState(true);

  const loadMilestones = useCallback(async () => {
    if (!project.id) return;
    setMilestonesLoading(true);
    try {
      const res = await getProjectLifecycle(project.id);
      setRawMilestones(res.data?.milestones ?? []);
    } catch {
      setRawMilestones([]);
    } finally {
      setMilestonesLoading(false);
    }
  }, [project.id]);

  useEffect(() => { void loadMilestones(); }, [loadMilestones]);

  const startDateMs = useMemo(() => {
    const raw = (source as Record<string, unknown>).start_date as string | undefined;
    if (!raw) return null;
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d.getTime();
  }, [source]);

  const dateToWeek = useCallback((value: unknown): number | null => {
    if (!value || !startDateMs) return null;
    const d = new Date(String(value));
    if (Number.isNaN(d.getTime())) return null;
    return Math.max(1, Math.floor((d.getTime() - startDateMs) / (7 * 24 * 3600 * 1000)) + 1);
  }, [startDateMs]);

  const milestones: GanttMilestone[] = useMemo(() => {
    return rawMilestones.map((m) => ({
      id: String(m.id),
      name: text(m.name as string | undefined, "Untitled milestone"),
      status: (["not_started", "in_progress", "complete", "blocked", "cancelled"].includes(String(m.status))
        ? m.status
        : "not_started") as GanttMilestone["status"],
      weight: number(m.weight),
      ownerName: text(m.owner_name as string | undefined, "") || null,
      baselineWeek: dateToWeek(m.baseline_date),
      forecastWeek: dateToWeek(m.forecast_date),
      actualWeek: dateToWeek(m.actual_date),
    }));
  }, [rawMilestones, dateToWeek]);

  const filteredMilestones = useMemo(() => {
    return milestones.filter(m => {
      if (scheduleStatusFilter === "all") return true;
      return m.status === scheduleStatusFilter;
    });
  }, [milestones, scheduleStatusFilter]);

  const [showAddMilestone, setShowAddMilestone] = useState(false);

  const progressMilestone = useCallback(async (m: GanttMilestone) => {
    const nextStatus = NEXT_MILESTONE_STATUS[m.status];
    try {
      await updateProjectMilestone(project.id, m.id, {
        status: nextStatus,
        actual_date: nextStatus === "complete" ? new Date().toISOString().slice(0, 10) : undefined,
      });
      await loadMilestones();
    } catch {
      // Non-fatal - the row simply keeps its current status on failure.
    }
  }, [project.id, loadMilestones]);

  // Read-only "who's responsible" summary on Overview - full editing lives on
  // the Assigned To tab (AssignmentPanel), this just makes it visible without
  // switching tabs.
  const [projectAssignment, setProjectAssignment] = useState<{ assigned_to_user_id: string | null; assigned_to_team_id: string | null; assigned_user_name: string | null; assigned_team_name: string | null } | null>(null);
  useEffect(() => {
    if (!project.id) return;
    getAssignment("project", project.id).then((res) => setProjectAssignment(res.data ?? null)).catch(() => setProjectAssignment(null));
  }, [project.id]);

  // ----------------------------------------------------
  // SOURCE-BACKED MATERIAL CONSUMPTION
  // ----------------------------------------------------
  const materialRecords = useMemo(() => detail?.material_records ?? [], [detail]);
  const materialSummary = useMemo(() => {
    return materialRecords.reduce((acc, row) => {
      const name = text(row.item_name ?? row.item_code ?? row.item_id, "Unclassified material");
      const quantity = number(row.quantity_used) ?? 0;
      const wastage = number(row.wastage_quantity) ?? 0;
      const unitCost = number(row.unit_cost) ?? 0;
      const key = `${name}::${text(row.unit_of_measure, "")}`;
      const existing = acc.get(key) ?? {
        key,
        name,
        unit: text(row.unit_of_measure, "units"),
        quantity: 0,
        wastage: 0,
        cost: 0,
        records: 0,
      };
      existing.quantity += quantity;
      existing.wastage += wastage;
      existing.cost += quantity * unitCost;
      existing.records += 1;
      acc.set(key, existing);
      return acc;
    }, new Map<string, { key: string; name: string; unit: string; quantity: number; wastage: number; cost: number; records: number }>());
  }, [materialRecords]);
  const materialSummaryRows = Array.from(materialSummary.values()).sort((a, b) => b.cost - a.cost);
  const materialTotalCost = materialSummaryRows.reduce((sum, row) => sum + row.cost, 0);
  const materialTotalWastage = materialSummaryRows.reduce((sum, row) => sum + row.wastage, 0);

  const [projectSignals, setProjectSignals] = useState<ProjectSignalState>(EMPTY_PROJECT_SIGNALS);
  const [projectSignalsLoading, setProjectSignalsLoading] = useState(false);

  const loadProjectSignals = useCallback(async () => {
    if (!project.id) return;
    setProjectSignalsLoading(true);
    const [
      attendance,
      rfqs,
      siteVariances,
      grns,
      financeVariations,
      budgets,
      progressClaims,
      boqSummary,
      financeDetail,
    ] = await runWithConcurrencyLimit([
      () => getHRAttendance({ project_id: project.id }),
      () => getProcurementRfqs({ project_id: project.id }),
      () => getSiteVariances({ projectId: project.id }),
      () => getSiteGrns({ projectId: project.id }),
      () => getFinanceVariations({ project_id: project.id }),
      () => getFinanceBudgets({ project_id: project.id }),
      () => getFinanceProgressClaims({ project_id: project.id }),
      () => getBoqProgressSummary(project.id),
      () => getFinanceProjectDetail(project.id),
    ], 3);

    setProjectSignals({
      attendance: attendance.status === "fulfilled" ? attendance.value.data ?? [] : [],
      rfqs: rfqs.status === "fulfilled" ? rfqs.value.data ?? [] : [],
      siteVariances: siteVariances.status === "fulfilled" ? siteVariances.value.data ?? [] : [],
      grns: grns.status === "fulfilled" ? grns.value.data ?? [] : [],
      financeVariations: financeVariations.status === "fulfilled" ? financeVariations.value.data ?? [] : [],
      budgets: budgets.status === "fulfilled" ? budgets.value.data ?? [] : [],
      progressClaims: progressClaims.status === "fulfilled" ? progressClaims.value.data ?? [] : [],
      boqSummary: boqSummary.status === "fulfilled" ? boqSummary.value.data ?? null : null,
      financeDetail: financeDetail.status === "fulfilled" ? financeDetail.value.data ?? null : null,
    });
    setProjectSignalsLoading(false);
  }, [project.id]);

  useEffect(() => {
    void loadProjectSignals();
  }, [loadProjectSignals]);

  const financeDetail = projectSignals.financeDetail;

  // actual_cost_to_date/committed_cost come from the real cost/commitment
  // ledger (finance.cost_transactions, finance.commitments, department
  // transfer legs) via the finance module's per-project endpoint - source.*
  // never carried these columns, so any legacy value there is a harmless,
  // low-priority fallback rather than the source of truth.
  const actualCost = useMemo(() => {
    return number(financeDetail?.actual_cost_to_date ?? source.actual_cost ?? source.actual_cost_to_date ?? source.cost_to_date) ?? 0;
  }, [financeDetail, source]);

  const committedCost = useMemo(() => {
    return number(financeDetail?.committed_cost ?? source.committed_cost ?? source.commitments ?? source.purchase_commitments) ?? 0;
  }, [financeDetail, source]);

  const hasFinanceEvidence = contractVal > 0 || budgetedCost > 0 || forecastCost > 0 || actualCost > 0 || committedCost > 0;

  const cashCollected = number(financeDetail?.cash_collected) ?? 0;
  const cashPaidOut = number(financeDetail?.cash_paid_out) ?? 0;
  const cashPosition = number(financeDetail?.cash_position) ?? (cashCollected - cashPaidOut);
  const pettyCashAccounts = (financeDetail?.petty_cash as Record<string, unknown>[] | undefined) ?? [];
  const recentFinanceTransactions = (financeDetail?.recent_transactions as Record<string, unknown>[] | undefined) ?? [];
  const activePettyCash = pettyCashAccounts.find((a) => a.is_active) as Record<string, unknown> | undefined;

  const [pettyCashBusy, setPettyCashBusy] = useState<string | null>(null);
  const [pettyCashMsg, setPettyCashMsg] = useState<string | null>(null);
  const [pettyCashOpenForm, setPettyCashOpenForm] = useState({ account_name: "Site petty cash", custodian_user_id: "", float_amount: "" });
  const [pettyCashSpendForm, setPettyCashSpendForm] = useState({ amount: "", description: "", cost_category: "other" as string, reference: "" });
  const [pettyCashReplenishForm, setPettyCashReplenishForm] = useState({ amount: "", source_cash_account_id: "" });

  const openPettyCash = async () => {
    if (!pettyCashOpenForm.custodian_user_id || !pettyCashOpenForm.float_amount) {
      setPettyCashMsg("Custodian and float amount are required.");
      return;
    }
    setPettyCashBusy("open"); setPettyCashMsg(null);
    try {
      await openProjectPettyCash(project.id, {
        account_name: pettyCashOpenForm.account_name,
        custodian_user_id: pettyCashOpenForm.custodian_user_id,
        float_amount: Number(pettyCashOpenForm.float_amount),
      });
      setPettyCashMsg("Petty cash float opened.");
      setPettyCashOpenForm({ account_name: "Site petty cash", custodian_user_id: "", float_amount: "" });
      void loadProjectSignals();
    } catch (e) {
      setPettyCashMsg(e instanceof Error ? e.message : "Failed to open petty cash float.");
    } finally {
      setPettyCashBusy(null);
    }
  };

  const spendPettyCash = async () => {
    if (!activePettyCash || !pettyCashSpendForm.amount || !pettyCashSpendForm.description) {
      setPettyCashMsg("Amount and description are required.");
      return;
    }
    setPettyCashBusy("spend"); setPettyCashMsg(null);
    try {
      await postPettyCashSpend(String(activePettyCash.id), {
        amount: Number(pettyCashSpendForm.amount),
        description: pettyCashSpendForm.description,
        cost_category: pettyCashSpendForm.cost_category,
        reference: pettyCashSpendForm.reference || undefined,
      });
      setPettyCashMsg("Petty cash spend recorded.");
      setPettyCashSpendForm({ amount: "", description: "", cost_category: "other", reference: "" });
      void loadProjectSignals();
    } catch (e) {
      setPettyCashMsg(e instanceof Error ? e.message : "Failed to record petty cash spend.");
    } finally {
      setPettyCashBusy(null);
    }
  };

  const closePettyCashFloat = async () => {
    if (!activePettyCash) return;
    setPettyCashBusy("close"); setPettyCashMsg(null);
    try {
      await closeProjectPettyCash(String(activePettyCash.id));
      setPettyCashMsg("Petty cash float closed.");
      void loadProjectSignals();
    } catch (e) {
      setPettyCashMsg(e instanceof Error ? e.message : "Failed to close petty cash float.");
    } finally {
      setPettyCashBusy(null);
    }
  };

  const replenishPettyCash = async () => {
    if (!activePettyCash || !pettyCashReplenishForm.amount || !pettyCashReplenishForm.source_cash_account_id) {
      setPettyCashMsg("Amount and source cash account are required.");
      return;
    }
    setPettyCashBusy("replenish"); setPettyCashMsg(null);
    try {
      await postPettyCashReplenish(String(activePettyCash.id), {
        amount: Number(pettyCashReplenishForm.amount),
        source_cash_account_id: pettyCashReplenishForm.source_cash_account_id,
      });
      setPettyCashMsg("Petty cash float replenished.");
      setPettyCashReplenishForm({ amount: "", source_cash_account_id: "" });
      void loadProjectSignals();
    } catch (e) {
      setPettyCashMsg(e instanceof Error ? e.message : "Failed to replenish petty cash float.");
    } finally {
      setPettyCashBusy(null);
    }
  };

  const overviewEvidenceRows = useMemo(() => {
    const rows = [
      { area: "Viability", records: detail?.viability?.length ?? 0, latest: latestDate(detail?.viability ?? [], ["updated_at", "created_at"]) },
      { area: "Tests and checks", records: detail?.tests_and_checks?.length ?? 0, latest: latestDate(detail?.tests_and_checks ?? [], ["updated_at", "created_at"]) },
      { area: "Site reports", records: detail?.site_reports?.length ?? 0, latest: latestDate(detail?.site_reports ?? [], ["report_date", "date", "created_at"]) },
      { area: "Quotations", records: detail?.quotations?.length ?? 0, latest: latestDate(detail?.quotations ?? [], ["quote_date", "created_at"]) },
      { area: "Procurement orders", records: detail?.procurement_orders?.length ?? 0, latest: latestDate(detail?.procurement_orders ?? [], ["order_date", "created_at"]) },
      { area: "Tender records", records: detail?.tenders?.length ?? 0, latest: latestDate(detail?.tenders ?? [], ["submission_date", "created_at"]) },
      { area: "Subcontractors", records: detail?.subcontractors?.length ?? 0, latest: latestDate(detail?.subcontractors ?? [], ["updated_at", "created_at"]) },
    ];
    return rows.map((row) => ({ ...row, status: row.records > 0 ? "recorded" : "missing" }));
  }, [detail]);

  const overviewSetupGaps = useMemo(() => {
    const gaps: string[] = [];
    if (!title(source) || title(source) === "Untitled Project") gaps.push("Project name is missing.");
    if (!text(viability?.region ?? viability?.site_location ?? (source as Project).region, "")) gaps.push("Project location is not recorded.");
    if (!contractVal && text(viability?.initiated_by as string | undefined ?? (source as Record<string, unknown>).initiated_by, "client") !== "company") gaps.push("Contract value is not recorded.");
    if (!budgetedCost && !projectSignals.boqSummary) gaps.push("Approved budget or BOQ baseline is not linked.");
    if (!text(viability?.delivery_manager, "") && !projectAssignment?.assigned_user_name && !projectAssignment?.assigned_team_name) gaps.push("Project manager is not recorded.");
    if (!projectAssignment?.assigned_team_name && !projectAssignment?.assigned_user_name) gaps.push("No responsible team or user is assigned.");
    if (!text(source.start_date, "")) gaps.push("Project start date is not set.");
    if (!text((source as Record<string, unknown>).planned_completion_date as string | undefined, "")) gaps.push("Programme end date is not set.");
    return gaps;
  }, [source, viability, contractVal, budgetedCost, projectSignals.boqSummary, projectAssignment]);

  const scheduleSummaryRows = useMemo(() => {
    const rows = [
      { status: "complete", count: statusCount(milestones, "complete") },
      { status: "in_progress", count: statusCount(milestones, "in_progress") },
      { status: "blocked", count: statusCount(milestones, "blocked") },
      { status: "not_started", count: statusCount(milestones, "not_started") },
      { status: "cancelled", count: statusCount(milestones, "cancelled") },
    ];
    return rows.filter((row) => row.count > 0);
  }, [milestones]);

  const nextForecastMilestone = useMemo(() => {
    const dated = rawMilestones
      .map((row) => ({ name: text(row.name, "Untitled milestone"), date: row.forecast_date ? new Date(String(row.forecast_date)) : null }))
      .filter((row): row is { name: string; date: Date } => !!row.date && !Number.isNaN(row.date.getTime()))
      .sort((a, b) => a.date.getTime() - b.date.getTime());
    const next = dated.find((row) => row.date.getTime() >= Date.now()) ?? dated[0];
    return next ? `${next.name} - ${formatDate(next.date.toISOString())}` : "No forecast date recorded";
  }, [rawMilestones]);

  const financeExposure = actualCost + committedCost;
  const approvedVariationValue = sumField(projectSignals.financeVariations.filter((row) => text(row.status, "").toLowerCase() === "approved"), ["amount", "approved_amount", "cost_impact", "value"]);
  const openVariationCount = projectSignals.financeVariations.filter((row) => !["approved", "rejected", "closed", "cancelled"].includes(text(row.status, "").toLowerCase())).length;
  const financeWarnings = [
    budgetedCost > 0 && forecastCost > budgetedCost ? `Forecast cost is ${formatCurrency(forecastCost - budgetedCost)} above the approved baseline.` : "",
    budgetedCost > 0 && financeExposure > budgetedCost ? `Actual plus committed cost is ${formatCurrency(financeExposure - budgetedCost)} above budget.` : "",
    contractVal > 0 && forecastNetProfit < 0 ? `Forecast net profit is negative at ${formatCurrency(forecastNetProfit)}.` : "",
    openVariationCount > 0 ? `${openVariationCount} variation record(s) remain open and need commercial action.` : "",
  ].filter(Boolean);

  const grnValue = sumField(projectSignals.grns, ["total_amount", "amount", "value", "received_value", "cost"]);
  const grnQuantity = sumField(projectSignals.grns, ["quantity", "qty", "received_quantity", "quantity_received"]);
  const materialWastageRate = materialSummaryRows.reduce((sum, row) => sum + row.quantity, 0) > 0
    ? (materialTotalWastage / materialSummaryRows.reduce((sum, row) => sum + row.quantity, 0)) * 100
    : 0;
  const materialExceptions = [
    materialTotalWastage > 0 ? `Recorded wastage is ${materialTotalWastage.toLocaleString()} units across daily site report material lines.` : "",
    projectSignals.grns.length === 0 ? "No GRN receipt records are linked to this project." : "",
    projectSignals.rfqs.length > 0 ? `${projectSignals.rfqs.length} RFQ record(s) can be checked against consumed material rates.` : "",
  ].filter(Boolean);

  // ----------------------------------------------------
  // FINANCIAL WATERFALL CHART PARAMS (SVG)
  // ----------------------------------------------------
  const chartMaxVal = Math.max(contractVal, budgetedCost, forecastCost, actualCost, committedCost, 1);
  const chartHeight = 160;
  const chartScale = chartHeight / (chartMaxVal || 1);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/75 backdrop-blur-sm transition-all duration-300">
      <aside className="h-full w-full max-w-4xl overflow-y-auto border-l border-ink-mid bg-ink p-5 shadow-2xl transition-all duration-500 ease-dxl sm:p-6 lg:max-w-5xl">
        
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-ink-mid pb-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-signal flex items-center gap-1.5 animate-pulse-signal">
              <Activity className="h-3 w-3" />Live Project Command Portal
            </p>
            {nameEditing ? (
              <div className="mt-1 flex items-center gap-2">
                <input
                  autoFocus
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void saveNameEdit();
                    if (e.key === "Escape") cancelNameEdit();
                  }}
                  disabled={nameSaving}
                  className="w-full max-w-xl border border-signal/50 bg-ink-light px-2 py-1 text-2xl font-bold text-paper font-display focus:outline-none disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={() => void saveNameEdit()}
                  disabled={nameSaving}
                  title="Save name"
                  className="rounded-sm border border-emerald-500/40 p-1.5 text-emerald-300 hover:bg-emerald-950/20 disabled:opacity-50"
                >
                  {nameSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                </button>
                <button
                  type="button"
                  onClick={cancelNameEdit}
                  disabled={nameSaving}
                  title="Cancel"
                  className="rounded-sm border border-ink-mid p-1.5 text-slate-light hover:border-red-500/40 hover:text-red-300 disabled:opacity-50"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <h2 className="mt-1 flex items-center gap-2 text-2xl font-bold text-paper font-display">
                {title(source)}
                <button
                  type="button"
                  onClick={startNameEdit}
                  title="Edit project name"
                  className="text-slate hover:text-signal"
                >
                  <Pencil className="h-4 w-4" />
                </button>
              </h2>
            )}
            {nameError && <p className="mt-1 text-[10px] text-red-300">{nameError}</p>}
            <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-light">
              <MapPin className="h-3.5 w-3.5 text-signal" />{text(viability?.region ?? viability?.site_location ?? (source as Project).region, "No location recorded")}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] uppercase tracking-wider text-slate">Client account</span>
                <div className="flex h-7 border border-ink-mid bg-ink-light p-0.5">
                  <button
                    type="button"
                    onClick={() => setClientLinkType("organization")}
                    className={`px-2 font-mono text-[9px] uppercase tracking-wider ${clientLinkType === "organization" ? "bg-signal text-ink" : "text-slate-light hover:text-paper"}`}
                  >
                    Org
                  </button>
                  <button
                    type="button"
                    onClick={() => setClientLinkType("individual")}
                    className={`px-2 font-mono text-[9px] uppercase tracking-wider ${clientLinkType === "individual" ? "bg-signal text-ink" : "text-slate-light hover:text-paper"}`}
                  >
                    Person
                  </button>
                </div>
                <select
                  value={clientLinkType === "organization" ? ((source.client_org_id as string | undefined) ?? "") : ((source.client_id as string | undefined) ?? "")}
                  onChange={handleClientSelect}
                  disabled={clientSaving}
                  className="h-7 max-w-[260px] border border-ink-mid bg-ink-light px-2 text-xs text-paper disabled:opacity-50"
                >
                  <option value="">{clientLinkType === "organization" ? "Unlinked organisation" : "Unlinked individual"}</option>
                  {clientLinkType === "organization"
                    ? clientOrganizations.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)
                    : clientContacts.map((contact) => <option key={contact.id} value={contact.id}>{contactLabel(contact)}</option>)}
                </select>
                {clientSaving && <Loader2 className="h-3.5 w-3.5 animate-spin text-signal" />}
                {clientError && <span className="text-[10px] text-red-300">{clientError}</span>}
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] uppercase tracking-wider text-slate">Department</span>
                <select
                  value={(source.department_id as string | undefined) ?? ""}
                  onChange={handleDepartmentSelect}
                  disabled={departmentSaving}
                  className="h-7 border border-ink-mid bg-ink-light px-2 text-xs text-paper disabled:opacity-50"
                >
                  <option value="">Unassigned</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
                {departmentSaving && <Loader2 className="h-3.5 w-3.5 animate-spin text-signal" />}
                {departmentError && <span className="text-[10px] text-red-300">{departmentError}</span>}
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] uppercase tracking-wider text-slate">Region</span>
                <select
                  value={regionOverride ?? currentRegion}
                  onChange={handleRegionSelect}
                  disabled={regionSaving}
                  className="h-7 border border-ink-mid bg-ink-light px-2 text-xs text-paper disabled:opacity-50"
                >
                  <option value="">Unassigned</option>
                  {PROVINCES.map((province) => (
                    <option key={province} value={province}>{province}</option>
                  ))}
                </select>
                {regionSaving && <Loader2 className="h-3.5 w-3.5 animate-spin text-signal" />}
                {regionError && <span className="text-[10px] text-red-300">{regionError}</span>}
              </div>
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-[10px] uppercase tracking-wider text-slate">Coordinates</span>
                <input
                  value={coords.latitude}
                  onChange={(event) => { setCoords((prev) => ({ ...prev, latitude: event.target.value })); setCoordsDirty(true); }}
                  placeholder="Latitude"
                  inputMode="decimal"
                  className="h-7 w-24 border border-ink-mid bg-ink-light px-2 text-xs text-paper placeholder:text-slate"
                />
                <input
                  value={coords.longitude}
                  onChange={(event) => { setCoords((prev) => ({ ...prev, longitude: event.target.value })); setCoordsDirty(true); }}
                  placeholder="Longitude"
                  inputMode="decimal"
                  className="h-7 w-24 border border-ink-mid bg-ink-light px-2 text-xs text-paper placeholder:text-slate"
                />
                <button
                  onClick={() => void saveCoords()}
                  disabled={coordsSaving || !coordsDirty}
                  className="h-7 border border-ink-mid bg-ink-light px-2 font-mono text-[10px] uppercase tracking-wider text-slate-light hover:border-signal hover:text-paper disabled:opacity-40"
                >
                  Save
                </button>
                {coordsSaving && <Loader2 className="h-3.5 w-3.5 animate-spin text-signal" />}
                {coordsError && <span className="text-[10px] text-red-300">{coordsError}</span>}
              </div>
            </div>
          </div>
          <button
            onClick={() => void handleDelete()}
            disabled={deleting}
            className="border border-red-500/30 bg-red-950/20 p-2 text-red-300 hover:border-red-400 hover:bg-red-950/40 disabled:opacity-40"
            aria-label="Delete project"
            title="Delete project"
          >
            {deleting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Trash2 className="h-5 w-5" />}
          </button>
          <button
            onClick={onClose}
            className="border border-ink-mid bg-ink-light p-2 text-slate-light hover:border-signal hover:text-paper"
            aria-label="Close project detail"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {deleteError && <p className="mt-2 text-xs text-red-300">{deleteError}</p>}

        {/* Tab Navigation */}
        <nav className="my-4 flex overflow-x-auto border-b border-ink-mid">
          <button
            onClick={() => setActiveTab("dashboard")}
            className={`px-4 py-2.5 font-mono text-xs uppercase tracking-wider border-b-2 transition-all ${
              activeTab === "dashboard"
                ? "border-signal text-signal bg-ink-light/40 font-bold"
                : "border-transparent text-slate hover:text-paper"
            }`}
          >
            Project Dashboard
          </button>
          <button
            onClick={() => setActiveTab("overview")}
            className={`px-4 py-2.5 font-mono text-xs uppercase tracking-wider border-b-2 transition-all ${
              activeTab === "overview" 
                ? "border-signal text-signal bg-ink-light/40 font-bold" 
                : "border-transparent text-slate hover:text-paper"
            }`}
          >
            Overview & Evidence
          </button>
          <button
            onClick={() => setActiveTab("team")}
            className={`px-4 py-2.5 font-mono text-xs uppercase tracking-wider border-b-2 transition-all ${
              activeTab === "team"
                ? "border-signal text-signal bg-ink-light/40 font-bold"
                : "border-transparent text-slate hover:text-paper"
            }`}
          >
            Team
          </button>
          <button
            onClick={() => setActiveTab("schedule")}
            className={`px-4 py-2.5 font-mono text-xs uppercase tracking-wider border-b-2 transition-all ${
              activeTab === "schedule" 
                ? "border-signal text-signal bg-ink-light/40 font-bold" 
                : "border-transparent text-slate hover:text-paper"
            }`}
          >
            Schedule Gantt
          </button>
          <button
            onClick={() => setActiveTab("financials")}
            className={`px-4 py-2.5 font-mono text-xs uppercase tracking-wider border-b-2 transition-all ${
              activeTab === "financials" 
                ? "border-signal text-signal bg-ink-light/40 font-bold" 
                : "border-transparent text-slate hover:text-paper"
            }`}
          >
            Project Finance
          </button>
          <button
            onClick={() => setActiveTab("materials")}
            className={`px-4 py-2.5 font-mono text-xs uppercase tracking-wider border-b-2 transition-all ${
              activeTab === "materials" 
                ? "border-signal text-signal bg-ink-light/40 font-bold" 
                : "border-transparent text-slate hover:text-paper"
            }`}
          >
            Material Consumption
          </button>
          <button
            onClick={() => setActiveTab("controls")}
            className={`px-4 py-2.5 font-mono text-xs uppercase tracking-wider border-b-2 transition-all ${
              activeTab === "controls"
                ? "border-signal text-signal bg-ink-light/40 font-bold"
                : "border-transparent text-slate hover:text-paper"
            }`}
          >
            Controls
          </button>
          <button
            onClick={() => setActiveTab("documents")}
            className={`px-4 py-2.5 font-mono text-xs uppercase tracking-wider border-b-2 transition-all ${
              activeTab === "documents"
                ? "border-signal text-signal bg-ink-light/40 font-bold"
                : "border-transparent text-slate hover:text-paper"
            }`}
          >
            Documents
          </button>
          <button
            onClick={() => setActiveTab("assign")}
            className={`px-4 py-2.5 font-mono text-xs uppercase tracking-wider border-b-2 transition-all ${
              activeTab === "assign"
                ? "border-signal text-signal bg-ink-light/40 font-bold"
                : "border-transparent text-slate hover:text-paper"
            }`}
          >
            Assigned To
          </button>
        </nav>

        {loading ? (
          <div className="flex h-60 items-center justify-center gap-3 text-slate-light">
            <Loader2 className="h-5 w-5 animate-spin text-signal" />Loading project evidence
          </div>
        ) : error ? (
          <div className="mt-5 border border-amber-500/30 bg-amber-950/20 p-4 text-sm text-amber-100 flex gap-2">
            <AlertTriangle className="h-5 w-5 shrink-0 text-amber-400" />{error}
          </div>
        ) : (
          <div className="py-2 space-y-6">
            {/* ---------------------------------------------------- */}
            {/* PROJECT DASHBOARD TAB */}
            {/* ---------------------------------------------------- */}
            {activeTab === "dashboard" && (
              <ProjectDashboardPanel
                project={source}
                detail={detail}
                signals={projectSignals}
                loading={projectSignalsLoading}
                onOpenTab={setActiveTab}
                onOpenCommand={setActiveCommand}
              />
            )}
            
            {/* ---------------------------------------------------- */}
            {/* OVERVIEW & EVIDENCE TAB */}
            {/* ---------------------------------------------------- */}
            {activeTab === "overview" && (
              <div className="space-y-6 animate-fade-in">
                <section className="border border-ink-mid bg-ink-light/20 p-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <p className="font-mono text-[10px] uppercase tracking-widest text-signal">Project overview dashboard</p>
                      <h3 className="mt-1 font-display text-xl font-semibold text-paper">Identity, readiness and evidence position</h3>
                      <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-light">
                        This tab checks whether the project record has enough source data for QS, site and management teams to operate against a controlled baseline.
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-2 font-mono text-[10px] uppercase tracking-wider sm:grid-cols-3 lg:min-w-[460px]">
                      <Metric label="Evidence areas" value={`${overviewEvidenceRows.filter((row) => row.records > 0).length}/7`} detail="ERP-linked sources" tone="text-signal" />
                      <Metric label="Setup gaps" value={String(overviewSetupGaps.length)} detail="Missing control fields" tone={overviewSetupGaps.length ? "text-amber-300" : "text-emerald-300"} />
                      <Metric label="Assignment" value={projectAssignment?.assigned_team_name || projectAssignment?.assigned_user_name ? "Set" : "Open"} detail="Responsible owner" tone={projectAssignment?.assigned_team_name || projectAssignment?.assigned_user_name ? "text-emerald-300" : "text-amber-300"} />
                    </div>
                  </div>
                </section>

                <section className="grid gap-4 lg:grid-cols-[1fr_0.8fr]">
                  <RecordList title="Project evidence matrix" records={overviewEvidenceRows} columns={["area", "records", "latest", "status"]} />
                  <div className="flex flex-col gap-3">
                    <RiskList
                      title="Setup gaps to close"
                      items={overviewSetupGaps}
                      empty="No setup gaps detected from the project fields currently returned."
                      tone="amber"
                    />
                    <div className="border border-ink-mid bg-ink-light/20 p-3">
                      <p className="font-mono text-[10px] uppercase tracking-wider text-slate-light">Close programme date gaps</p>
                      <p className="mt-1 text-[11px] text-slate-light">Location is set from the Region field above. Project Manager is set from Assign Workforce on the Team tab.</p>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <label className="space-y-1">
                          <span className="block font-mono text-[9px] uppercase tracking-wider text-slate">Start date</span>
                          <input
                            type="date"
                            value={programmeDates.start_date}
                            onChange={(e) => { setProgrammeDates((cur) => ({ ...cur, start_date: e.target.value })); setProgrammeDatesDirty(true); }}
                            disabled={programmeDatesSaving}
                            className="h-8 w-full border border-ink-mid bg-ink-light px-2 text-xs text-paper disabled:opacity-50"
                          />
                        </label>
                        <label className="space-y-1">
                          <span className="block font-mono text-[9px] uppercase tracking-wider text-slate">Programme end</span>
                          <input
                            type="date"
                            value={programmeDates.planned_completion_date}
                            onChange={(e) => { setProgrammeDates((cur) => ({ ...cur, planned_completion_date: e.target.value })); setProgrammeDatesDirty(true); }}
                            disabled={programmeDatesSaving}
                            className="h-8 w-full border border-ink-mid bg-ink-light px-2 text-xs text-paper disabled:opacity-50"
                          />
                        </label>
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void saveProgrammeDates()}
                          disabled={programmeDatesSaving || !programmeDatesDirty}
                          className="inline-flex h-8 items-center gap-1.5 border border-signal bg-signal/10 px-3 font-mono text-[10px] font-bold uppercase tracking-wider text-signal hover:bg-signal/20 disabled:opacity-50"
                        >
                          {programmeDatesSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Save dates
                        </button>
                        {programmeDatesError && <span className="text-[10px] text-red-300">{programmeDatesError}</span>}
                      </div>
                    </div>
                  </div>
                </section>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Info label="Status" value={text(source.status)} />
                  {text(viability?.initiated_by as string | undefined ?? (source as Record<string, unknown>).initiated_by, "client") === "company" ? (
                    <Info
                      label="Project Category"
                      value={
                        PROJECT_CATEGORY_LABELS[String(viability?.project_category ?? (source as Record<string, unknown>).project_category ?? "")]
                        ?? "Production (uncategorized)"
                      }
                    />
                  ) : (
                    <Info label="Contract Value" value={formatCurrency(contractVal)} />
                  )}
                  <Info label="Project Manager" value={text(viability?.delivery_manager ?? projectAssignment?.assigned_user_name ?? projectAssignment?.assigned_team_name, "Not recorded")} />
                  <Info label="Programme End" value={formatDate(text((source as Record<string, unknown>).planned_completion_date as string | undefined, ""))} />
                </div>

                <p className="font-mono text-[10px] uppercase tracking-wider text-slate-light">
                  Responsible: {projectAssignment && (projectAssignment.assigned_team_name || projectAssignment.assigned_user_name) ? (
                    <>
                      <span className="text-paper">{projectAssignment.assigned_team_name || projectAssignment.assigned_user_name}</span>
                      {projectAssignment.assigned_to_team_id ? " (team)" : ""}
                    </>
                  ) : (
                    <span className="text-slate">Unassigned - see the Assigned To tab</span>
                  )}
                </p>

                {text(viability?.initiated_by as string | undefined ?? (source as Project & { initiated_by?: string }).initiated_by, "client") === "company" && (
                  <ProductionIntakePanel
                    project={{
                      id: project.id,
                      status: source.status,
                      start_date: (source as Record<string, unknown>).start_date,
                      project_category: viability?.project_category ?? (source as Record<string, unknown>).project_category,
                      investment_required: viability?.investment_required ?? (source as Record<string, unknown>).investment_required,
                      funding_internal: viability?.funding_internal ?? (source as Record<string, unknown>).funding_internal,
                      funding_external: viability?.funding_external ?? (source as Record<string, unknown>).funding_external,
                      setup_duration_weeks: viability?.setup_duration_weeks ?? (source as Record<string, unknown>).setup_duration_weeks,
                      intake_completed_at: viability?.intake_completed_at ?? (source as Record<string, unknown>).intake_completed_at,
                    }}
                    onRefresh={onRefresh}
                  />
                )}

                {(source.status === "field_intake" || source.status === "pending_deposit" || FINANCE_SIGNOFF_ROLES.has(role ?? "")) && (
                  <FieldIntakePanel
                    project={source}
                    isFinance={FINANCE_SIGNOFF_ROLES.has(role ?? "")}
                    onRefresh={onRefresh}
                  />
                )}

                {(source.status === "pending_deposit" || source.status === "pre_mobilisation" || detail?.commercial_readiness || source.commercial_cleared_at) ? (
                  <CommercialReadinessPanel
                    project={source}
                    readiness={detail?.commercial_readiness}
                    canManage={COMMERCIAL_READINESS_ROLES.has(role ?? "")}
                    onRefresh={onRefresh}
                  />
                ) : null}

                {(source.status === "pre_mobilisation" || detail?.pre_mobilisation?.checks?.length || source.mobilisation_approved_at) ? (
                  <PreMobilisationPanel
                    project={source}
                    readiness={detail?.pre_mobilisation}
                    isApprover={FINANCE_SIGNOFF_ROLES.has(role ?? "")}
                    onRefresh={onRefresh}
                  />
                ) : null}

                <section>
                  <h3 className="mb-3 flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-wider text-signal">
                    <ShieldCheck className="h-4 w-4" />ERP System Evidence Logs
                  </h3>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <Evidence label="Viability records" items={detail?.viability} />
                    <Evidence label="Tests and checks" items={detail?.tests_and_checks} />
                    <Evidence label="Site reports" items={detail?.site_reports} />
                    <Evidence label="Quotations" items={detail?.quotations} />
                    <Evidence label="Procurement orders" items={detail?.procurement_orders} />
                    <Evidence label="Tender records" items={detail?.tenders} />
                    <Evidence label="Subcontractor records" items={detail?.subcontractors} />
                  </div>
                </section>

                <div className="border-l-2 border-signal/50 bg-ink-light/20 p-4 rounded-r-md">
                  <h4 className="font-mono text-xs uppercase text-paper font-semibold flex items-center gap-1.5">
                    <InfoIcon className="h-3.5 w-3.5 text-signal" />Data Assurance Statement
                  </h4>
                  <p className="mt-1 text-xs leading-relaxed text-slate-light">
                    These modules represent system-of-record entries automatically audited from active database transactions. 
                    Any modifications to contract values, site reports, or purchase records are tracked via core audit triggers.
                  </p>
                </div>
              </div>
            )}

            {/* ---------------------------------------------------- */}
            {/* TEAM TAB */}
            {/* ---------------------------------------------------- */}
            {activeTab === "team" && (
              <div className="space-y-5 animate-fade-in">
                <section className="border border-ink-mid bg-ink-light/20 p-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <p className="font-mono text-[10px] uppercase tracking-widest text-signal">Project team</p>
                      <h3 className="mt-1 font-display text-xl font-semibold text-paper">Who is on this project, and what they do</h3>
                      <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-light">
                        Read directly from the workforce allocation record created via &quot;Assign workforce&quot; - not a separate list, so this is always the same source of truth as Workforce.
                      </p>
                    </div>
                    <div className="flex flex-col items-start gap-2 lg:items-end">
                      <Info label="Project Manager" value={text(viability?.delivery_manager ?? projectAssignment?.assigned_user_name ?? projectAssignment?.assigned_team_name, "Not recorded")} />
                      <button
                        onClick={() => setActiveCommand("workforce")}
                        className="inline-flex h-9 items-center gap-2 border border-signal bg-signal/10 px-3 font-mono text-[11px] font-bold uppercase tracking-wider text-signal hover:bg-signal/20"
                      >
                        <UserPlus className="h-3.5 w-3.5" /> Assign workforce
                      </button>
                    </div>
                  </div>
                </section>

                {teamLoading ? (
                  <div className="flex h-32 items-center justify-center gap-3 text-slate-light">
                    <Loader2 className="h-5 w-5 animate-spin text-signal" />Loading project team
                  </div>
                ) : teamError ? (
                  <div className="border border-amber-500/30 bg-amber-950/20 p-4 text-sm text-amber-100 flex gap-2">
                    <AlertTriangle className="h-5 w-5 shrink-0 text-amber-400" />{teamError}
                  </div>
                ) : (
                  <>
                    <RecordList
                      title="Current team"
                      records={teamRows.filter((row) => row.is_current).map((row) => ({ ...row, allocation_percent: row.allocation_percent != null ? `${row.allocation_percent}%` : undefined }))}
                      columns={["employee_name", "role_on_project", "position_name", "category_name", "allocation_percent", "starts_on", "ends_on", "status"]}
                    />
                    <RecordList
                      title="Past assignments"
                      records={teamRows.filter((row) => !row.is_current).map((row) => ({ ...row, allocation_percent: row.allocation_percent != null ? `${row.allocation_percent}%` : undefined }))}
                      columns={["employee_name", "role_on_project", "position_name", "category_name", "allocation_percent", "starts_on", "ends_on", "status"]}
                    />
                  </>
                )}
              </div>
            )}

            {/* ---------------------------------------------------- */}
            {/* SCHEDULE GANTT TAB */}
            {/* ---------------------------------------------------- */}
            {activeTab === "schedule" && (
              <div className="space-y-5 animate-fade-in">
                <section className="border border-ink-mid bg-ink-light/20 p-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <p className="font-mono text-[10px] uppercase tracking-widest text-signal">Schedule control dashboard</p>
                      <h3 className="mt-1 font-display text-xl font-semibold text-paper">Milestone status, next forecast and programme evidence</h3>
                      <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-light">
                        This view separates planned dates, forecast dates and actual progress so weekly delays can be tied to real milestone records.
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-2 font-mono text-[10px] uppercase tracking-wider sm:grid-cols-4 lg:min-w-[540px]">
                      <Metric label="Milestones" value={String(milestones.length)} detail="Lifecycle records" tone="text-paper" />
                      <Metric label="Complete" value={String(statusCount(milestones, "complete"))} detail="Closed milestones" tone="text-emerald-300" />
                      <Metric label="Blocked" value={String(statusCount(milestones, "blocked"))} detail="Delayed items" tone={statusCount(milestones, "blocked") ? "text-red-300" : "text-slate-light"} />
                      <Metric label="No forecast" value={String(milestones.filter((row) => !row.forecastWeek).length)} detail="Missing forecast week" tone="text-amber-300" />
                    </div>
                  </div>
                </section>

                <section className="grid gap-4 lg:grid-cols-[0.85fr_1fr]">
                  <RecordList title="Milestone status breakdown" records={scheduleSummaryRows} columns={["status", "count"]} />
                  <div className="border border-ink-mid bg-ink p-4">
                    <h4 className="font-mono text-xs font-bold uppercase tracking-wider text-paper">Next schedule checkpoint</h4>
                    <p className="mt-3 text-sm text-slate-light">{nextForecastMilestone}</p>
                    <div className="mt-4 grid gap-2 sm:grid-cols-3">
                      <Info label="Project start" value={formatDate(text(source.start_date, ""))} />
                      <Info label="Site reports" value={String(detail?.site_reports?.length ?? 0)} />
                      <Info label="BOQ progress" value={projectSignals.boqSummary ? "Linked" : "Not linked"} />
                    </div>
                  </div>
                </section>
                
                {/* Gantt Timeline Filters */}
                <div className="flex flex-wrap items-center justify-between gap-4 bg-ink-light/35 border border-ink-mid p-3.5">
                  <div className="flex flex-wrap gap-2 items-center">
                    <span className="font-mono text-[10px] text-slate uppercase mr-2 flex items-center gap-1">
                      <Sliders className="h-3 w-3" />Timeline View:
                    </span>
                    <button
                      onClick={() => setScheduleTimelineFilter("comparison")}
                      className={`px-3 py-1 font-mono text-[10px] uppercase border transition-all ${
                        scheduleTimelineFilter === "comparison" 
                          ? "border-signal text-signal bg-signal/10" 
                          : "border-ink-mid text-slate hover:text-paper"
                      }`}
                    >
                      Compare Timelines
                    </button>
                    <button
                      onClick={() => setScheduleTimelineFilter("baseline")}
                      className={`px-3 py-1 font-mono text-[10px] uppercase border transition-all ${
                        scheduleTimelineFilter === "baseline" 
                          ? "border-slate text-slate-light bg-slate/10" 
                          : "border-ink-mid text-slate hover:text-paper"
                      }`}
                    >
                      Baseline
                    </button>
                    <button
                      onClick={() => setScheduleTimelineFilter("forecast")}
                      className={`px-3 py-1 font-mono text-[10px] uppercase border transition-all ${
                        scheduleTimelineFilter === "forecast" 
                          ? "border-signal/70 text-amber-300 bg-signal/5" 
                          : "border-ink-mid text-slate hover:text-paper"
                      }`}
                    >
                      Forecast
                    </button>
                    <button
                      onClick={() => setScheduleTimelineFilter("actual")}
                      className={`px-3 py-1 font-mono text-[10px] uppercase border transition-all ${
                        scheduleTimelineFilter === "actual" 
                          ? "border-emerald-600/70 text-emerald-300 bg-emerald-500/5" 
                          : "border-ink-mid text-slate hover:text-paper"
                      }`}
                    >
                      Actual
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] text-slate uppercase">Status Filter:</span>
                    <select
                      value={scheduleStatusFilter}
                      onChange={(e) => setScheduleStatusFilter(e.target.value as any)}
                      className="border border-ink-mid bg-ink-light px-2 py-1 font-mono text-[11px] text-paper focus:outline-none focus:border-signal"
                    >
                      <option value="all">All milestones</option>
                      <option value="complete">Complete</option>
                      <option value="in_progress">In Progress</option>
                      <option value="blocked">Blocked / Delayed</option>
                      <option value="not_started">Not Started</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => setShowAddMilestone((v) => !v)}
                      className="flex items-center gap-1 border border-signal/40 bg-signal/10 px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-signal hover:bg-signal/20"
                    >
                      <Plus className="h-3 w-3" />Add Milestone
                    </button>
                  </div>
                </div>

                {showAddMilestone && (
                  <AddMilestoneForm
                    projectId={project.id}
                    onClose={() => setShowAddMilestone(false)}
                    onAdded={() => { setShowAddMilestone(false); void loadMilestones(); }}
                  />
                )}

                {milestonesLoading ? (
                  <div className="flex h-32 items-center justify-center gap-3 border border-ink-mid bg-ink-light/20 text-sm text-slate-light">
                    <Loader2 className="h-4 w-4 animate-spin text-signal" />Loading milestones
                  </div>
                ) : filteredMilestones.length === 0 ? (
                  <div className="flex h-32 flex-col items-center justify-center gap-1 border border-dashed border-ink-mid bg-ink-light/10 text-center">
                    <p className="text-sm text-slate-light">No milestones logged yet.</p>
                    <p className="text-xs text-slate">Use &quot;Add Milestone&quot; above to record real schedule dates and a real owner.</p>
                  </div>
                ) : (
                  <>
                    {!startDateMs && (
                      <p className="border border-amber-500/30 bg-amber-950/10 p-2 text-xs text-amber-200">
                        This project has no start date set, so milestones are listed below without a week position on the timeline.
                      </p>
                    )}
                    {/* Timeline Axis Labels */}
                    <div className="border border-ink-mid bg-ink-light/20 overflow-x-auto">
                      <div className="min-w-[800px]">
                        <div
                          className="grid border-b border-ink-mid py-2 font-mono text-[10px] font-semibold text-slate uppercase bg-ink-light/40"
                          style={{ display: "grid", gridTemplateColumns: "260px repeat(16, minmax(0, 1fr))" }}
                        >
                          <div className="pl-4">Project Milestones</div>
                          {Array.from({ length: 16 }, (_, i) => (
                            <div key={i} className="text-center border-l border-ink-mid/30">W{i + 1}</div>
                          ))}
                        </div>

                        {/* Gantt Rows - real milestones plotted as point markers (a milestone is a date, not a duration) */}
                        <div className="divide-y divide-ink-mid/60">
                          {filteredMilestones.map((m) => (
                            <div
                              key={m.id}
                              className="grid py-3 hover:bg-ink-light/10 transition-colors items-center"
                              style={{ display: "grid", gridTemplateColumns: "260px repeat(16, minmax(0, 1fr))" }}
                            >
                              {/* Milestone Information */}
                              <div className="pl-4 pr-3">
                                <p className="text-xs font-semibold text-paper leading-tight">{m.name}</p>
                                <div className="mt-1 flex items-center gap-2 font-mono text-[9px]">
                                  <button
                                    type="button"
                                    onClick={() => void progressMilestone(m)}
                                    title="Click to progress status"
                                    className={`border px-1 py-0.5 hover:brightness-110 ${
                                    m.status === 'complete' ? 'border-emerald-500/30 bg-emerald-950/20 text-emerald-300' :
                                    m.status === 'in_progress' ? 'border-sky-500/30 bg-sky-950/20 text-sky-300' :
                                    m.status === 'blocked' ? 'border-red-500/40 bg-red-950/30 text-red-300' :
                                    'border-slate/40 bg-slate-950/10 text-slate-400'
                                  }`}>
                                    {m.status.replace('_', ' ')}
                                  </button>
                                  {m.weight != null && <span className="text-slate">{m.weight}% weight</span>}
                                  <span className="text-slate-light">• {m.ownerName ?? "Unassigned"}</span>
                                </div>
                              </div>

                              {/* Timeline Grid Row */}
                              <div className="col-span-16 grid grid-cols-16 h-10 relative items-center">
                                {Array.from({ length: 16 }, (_, i) => (
                                  <div key={i} className="h-full border-l border-ink-mid/10 absolute top-0" style={{ left: `${(i / 16) * 100}%` }} />
                                ))}

                                {scheduleTimelineFilter === "baseline" && (
                                  <MilestoneMarker week={m.baselineWeek} colorClass="bg-slate-400 border-slate-300" label={m.baselineWeek ? `Baseline: W${m.baselineWeek}` : "No baseline date"} />
                                )}
                                {scheduleTimelineFilter === "forecast" && (
                                  <MilestoneMarker week={m.forecastWeek} colorClass="bg-signal border-signal" label={m.forecastWeek ? `Forecast: W${m.forecastWeek}` : "No forecast date"} />
                                )}
                                {scheduleTimelineFilter === "actual" && (
                                  <MilestoneMarker
                                    week={m.actualWeek}
                                    colorClass={m.status === 'blocked' ? "bg-red-500 border-red-400 animate-pulse" : "bg-emerald-500 border-emerald-400"}
                                    label={m.actualWeek ? `Actual: W${m.actualWeek}` : "Not yet actualized"}
                                  />
                                )}
                                {scheduleTimelineFilter === "comparison" && (
                                  <>
                                    <MilestoneMarker week={m.baselineWeek} colorClass="bg-slate-400 border-slate-300" label={m.baselineWeek ? `Baseline: W${m.baselineWeek}` : "No baseline date"} row={0} />
                                    <MilestoneMarker week={m.forecastWeek} colorClass="bg-signal border-signal" label={m.forecastWeek ? `Forecast: W${m.forecastWeek}` : "No forecast date"} row={1} />
                                    <MilestoneMarker
                                      week={m.actualWeek}
                                      colorClass={m.status === 'blocked' ? "bg-red-500 border-red-400" : "bg-emerald-500 border-emerald-400"}
                                      label={m.actualWeek ? `Actual: W${m.actualWeek}` : "Not yet actualized"}
                                      row={2}
                                    />
                                  </>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </>
                )}

                {/* Gantt Legend */}
                <div className="flex gap-6 font-mono text-[9px] text-slate-light border-t border-ink-mid pt-3 justify-end">
                  <div className="flex items-center gap-1.5">
                    <span className="inline-block w-4 h-2 bg-slate/40 border border-slate/30 rounded-sm"></span>
                    <span>Baseline Schedule</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="inline-block w-4 h-2 bg-signal/30 border border-signal/50 rounded-sm"></span>
                    <span>Forecast Plan</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="inline-block w-4 h-2 bg-emerald-600/30 border border-emerald-500/50 rounded-sm"></span>
                    <span>Actual / Progress</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="inline-block w-4 h-2 bg-red-500/20 border border-red-500/40 rounded-sm"></span>
                    <span>Slippage / Blocked</span>
                  </div>
                </div>

              </div>
            )}

            {/* ---------------------------------------------------- */}
            {/* BUDGET VARIANCE & MARGINS TAB */}
            {/* ---------------------------------------------------- */}
            {activeTab === "financials" && (
              <div className="space-y-6 animate-fade-in">
                <section className="border border-ink-mid bg-ink-light/20 p-5">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div>
                      <p className="font-mono text-[10px] uppercase tracking-widest text-signal">Financial control dashboard</p>
                      <h3 className="mt-1 font-display text-xl font-semibold text-paper">Budget baseline, exposure and variation position</h3>
                      <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-light">
                        This tab shows the commercial position from returned project finance fields, budget records, site variances and formal variation records.
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button type="button" onClick={() => setActiveCommand("budget")} className="inline-flex items-center gap-2 border border-signal/40 bg-signal/10 px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-wider text-signal hover:bg-signal/20">
                          <Banknote className="h-3.5 w-3.5" /> Set / update budget
                        </button>
                        <button type="button" onClick={() => setActiveCommand("claim")} className="inline-flex items-center gap-2 border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-wider text-emerald-300 hover:bg-emerald-500/20">
                          <Send className="h-3.5 w-3.5" /> Submit progress claim
                        </button>
                        <button type="button" onClick={() => setActiveCommand("variations")} className="inline-flex items-center gap-2 border border-ink-mid bg-ink px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-wider text-slate-light hover:border-signal hover:text-paper">
                          <DollarSign className="h-3.5 w-3.5" /> Record variation
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 font-mono text-[10px] uppercase tracking-wider sm:grid-cols-4 xl:min-w-[780px]">
                      <Metric label="Cash position" value={formatCurrency(cashPosition)} detail="Collected minus paid out" tone={cashPosition < 0 ? "text-red-300" : "text-emerald-300"} />
                      <Metric label="Budget records" value={String(projectSignals.budgets.length)} detail="Finance budget rows" tone="text-paper" />
                      <Metric label="Exposure" value={formatCurrency(financeExposure)} detail="Actual plus committed" tone={budgetedCost > 0 && financeExposure > budgetedCost ? "text-red-300" : "text-signal"} />
                      <Metric label="Open variations" value={String(openVariationCount)} detail="Commercial action required" tone={openVariationCount ? "text-amber-300" : "text-emerald-300"} />
                    </div>
                  </div>
                </section>

                <section className="grid gap-4 lg:grid-cols-[1fr_0.8fr]">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Info label="Contract value" value={formatCurrency(contractVal)} />
                    <Info label="Budget baseline" value={formatCurrency(budgetedCost)} />
                    <Info label="Approved variations" value={formatCurrency(approvedVariationValue)} />
                    <Info label="Site variance records" value={String(projectSignals.siteVariances.length)} />
                  </div>
                  <RiskList
                    title="Finance warnings"
                    items={financeWarnings}
                    empty="No financial warning triggered by the values currently returned."
                    tone="amber"
                  />
                </section>

                <section className="grid gap-4 xl:grid-cols-2">
                  <RecordList title="Budget ledger" records={projectSignals.budgets} columns={["cost_code", "description", "amount", "status"]} />
                  <RecordList title="Variation ledger" records={projectSignals.financeVariations} columns={["variation_number", "description", "cost_impact", "status"]} />
                </section>

                <section className="grid gap-4 xl:grid-cols-2">
                  <RecordList
                    title="Progress claims (deposits & billing)"
                    records={projectSignals.progressClaims}
                    columns={["claim_number", "status", "this_claim_amount", "certified_amount", "claim_period_end"]}
                  />
                  <div className="border border-ink-mid bg-ink-light/10 p-4">
                    <h4 className="font-mono text-xs font-bold uppercase tracking-wider text-paper">How claimed revenue gets here</h4>
                    <p className="mt-2 text-xs leading-5 text-slate-light">
                      A confirmed deposit and every certified progress claim on this project post automatically as claimed revenue (Certified Revenue) and, once paid, as Cash Collected in Finance - visible on the consolidated Finance dashboard and this project&apos;s Finance workspace. Use &quot;Submit progress claim&quot; above to bill further work; Finance certifies it.
                    </p>
                  </div>
                </section>

                <section className="grid gap-4 xl:grid-cols-2">
                  <RecordList
                    title="Income ledger"
                    records={recentFinanceTransactions.filter((row) => row.kind === "cash" && row.detail === "inflow")}
                    columns={["occurred_at", "description", "source_type", "amount"]}
                  />
                  <RecordList
                    title="Cost / spend ledger"
                    records={recentFinanceTransactions.filter((row) => row.kind === "cost" || (row.kind === "cash" && row.detail === "outflow"))}
                    columns={["occurred_at", "description", "detail", "amount"]}
                  />
                </section>

                <section className="border border-ink-mid bg-ink-light/10 p-5">
                  <div className="flex items-center justify-between border-b border-ink-mid pb-3">
                    <h4 className="flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-wider text-signal">
                      <Banknote className="h-4 w-4" />Petty cash
                    </h4>
                    {activePettyCash ? (
                      <span className="font-mono text-[10px] uppercase tracking-wider text-slate-light">
                        Balance {formatCurrency(number(activePettyCash.current_balance) ?? 0)} / float {formatCurrency(number(activePettyCash.float_amount) ?? 0)}
                      </span>
                    ) : null}
                  </div>

                  {pettyCashMsg && <p className="mt-3 text-xs text-slate-light">{pettyCashMsg}</p>}

                  {!activePettyCash ? (
                    <div className="mt-4 grid gap-3 md:grid-cols-4">
                      <input value={pettyCashOpenForm.account_name} onChange={(e) => setPettyCashOpenForm((f) => ({ ...f, account_name: e.target.value }))} placeholder="Float name" className="h-10 border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
                      <input value={pettyCashOpenForm.custodian_user_id} onChange={(e) => setPettyCashOpenForm((f) => ({ ...f, custodian_user_id: e.target.value }))} placeholder="Custodian user ID" className="h-10 border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
                      <input value={pettyCashOpenForm.float_amount} onChange={(e) => setPettyCashOpenForm((f) => ({ ...f, float_amount: e.target.value }))} type="number" min="0" placeholder="Float amount ($)" className="h-10 border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
                      <button onClick={() => void openPettyCash()} disabled={pettyCashBusy === "open"} className="h-10 bg-signal px-4 font-mono text-xs font-bold uppercase text-ink disabled:opacity-50">
                        {pettyCashBusy === "open" ? "Opening..." : "Open float"}
                      </button>
                    </div>
                  ) : (
                    <div className="mt-4 grid gap-4 lg:grid-cols-2">
                      <div className="space-y-2">
                        <p className="font-mono text-[10px] uppercase tracking-wider text-slate">Record a spend</p>
                        <div className="grid grid-cols-2 gap-2">
                          <input value={pettyCashSpendForm.amount} onChange={(e) => setPettyCashSpendForm((f) => ({ ...f, amount: e.target.value }))} type="number" min="0" placeholder="Amount ($)" className="h-9 border border-ink-mid bg-ink-light px-2 text-xs text-paper" />
                          <select value={pettyCashSpendForm.cost_category} onChange={(e) => setPettyCashSpendForm((f) => ({ ...f, cost_category: e.target.value }))} className="h-9 border border-ink-mid bg-ink-light px-2 text-xs text-paper">
                            {COST_CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </div>
                        <input value={pettyCashSpendForm.description} onChange={(e) => setPettyCashSpendForm((f) => ({ ...f, description: e.target.value }))} placeholder="Description" className="h-9 w-full border border-ink-mid bg-ink-light px-2 text-xs text-paper" />
                        <input value={pettyCashSpendForm.reference} onChange={(e) => setPettyCashSpendForm((f) => ({ ...f, reference: e.target.value }))} placeholder="Receipt/reference (optional)" className="h-9 w-full border border-ink-mid bg-ink-light px-2 text-xs text-paper" />
                        <button onClick={() => void spendPettyCash()} disabled={pettyCashBusy === "spend"} className="h-9 w-full border border-signal/40 font-mono text-[10px] uppercase tracking-wider text-signal disabled:opacity-50">
                          {pettyCashBusy === "spend" ? "Recording..." : "Record spend"}
                        </button>
                      </div>
                      <div className="space-y-2">
                        <p className="font-mono text-[10px] uppercase tracking-wider text-slate">Replenish float</p>
                        <input value={pettyCashReplenishForm.amount} onChange={(e) => setPettyCashReplenishForm((f) => ({ ...f, amount: e.target.value }))} type="number" min="0" placeholder="Amount ($)" className="h-9 w-full border border-ink-mid bg-ink-light px-2 text-xs text-paper" />
                        <input value={pettyCashReplenishForm.source_cash_account_id} onChange={(e) => setPettyCashReplenishForm((f) => ({ ...f, source_cash_account_id: e.target.value }))} placeholder="Source cash account ID" className="h-9 w-full border border-ink-mid bg-ink-light px-2 text-xs text-paper" />
                        <button onClick={() => void replenishPettyCash()} disabled={pettyCashBusy === "replenish"} className="h-9 w-full border border-emerald-500/40 font-mono text-[10px] uppercase tracking-wider text-emerald-300 disabled:opacity-50">
                          {pettyCashBusy === "replenish" ? "Replenishing..." : "Replenish"}
                        </button>
                        <button onClick={() => void closePettyCashFloat()} disabled={pettyCashBusy === "close"} className="h-9 w-full border border-red-500/30 font-mono text-[10px] uppercase tracking-wider text-red-300 disabled:opacity-50">
                          {pettyCashBusy === "close" ? "Closing..." : "Close float"}
                        </button>
                      </div>
                    </div>
                  )}
                </section>

                {!hasFinanceEvidence && (
                  <div className="border border-amber-500/25 bg-amber-500/10 p-4 rounded-sm text-amber-100">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="h-5 w-5 text-amber-400 mt-0.5" />
                      <div>
                        <p className="font-mono text-xs uppercase tracking-widest text-amber-300">Finance evidence not recorded</p>
                        <p className="mt-1 text-sm text-slate-light">
                          Contract value, budgeted cost, commitments, actual cost and forecast cost are shown only when returned by the project or finance services. No fallback financial figures are generated.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
                 
                {/* Variance Cards */}
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="border border-ink-mid bg-ink-light/20 p-3.5">
                    <p className="font-mono text-[9px] uppercase tracking-wider text-slate">Planned Budgeted Cost</p>
                    <p className="mt-1 font-mono text-lg font-bold text-slate-light">{formatCurrency(budgetedCost)}</p>
                  </div>
                  <div className="border border-ink-mid bg-ink-light/20 p-3.5">
                    <p className="font-mono text-[9px] uppercase tracking-wider text-slate">Actual Cost to Date</p>
                    <p className="mt-1 font-mono text-lg font-bold text-paper">{formatCurrency(actualCost)}</p>
                    <span className="text-[10px] text-slate-light font-mono">Source-backed finance value</span>
                  </div>
                  <div className="border border-ink-mid bg-ink-light/20 p-3.5">
                    <p className="font-mono text-[9px] uppercase tracking-wider text-slate">Forecast cost (EAC)</p>
                    <p className="mt-1 font-mono text-lg font-bold text-signal">{formatCurrency(forecastCost)}</p>
                    <span className={`text-[10px] font-mono flex items-center gap-0.5 ${costOverrunPct > 0 ? "text-red-400" : "text-emerald-400"}`}>
                      {costOverrunPct > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                      {costOverrunPct.toFixed(2)}% overrun
                    </span>
                  </div>
                  <div className="border border-ink-mid bg-ink-light/20 p-3.5">
                    <p className="font-mono text-[9px] uppercase tracking-wider text-slate">Budget Variance</p>
                    <p className={`mt-1 font-mono text-lg font-bold ${forecastCost - budgetedCost > 0 ? "text-red-400" : "text-emerald-400"}`}>
                      {formatCurrency(budgetedCost - forecastCost)}
                    </p>
                    <span className="text-[10px] text-slate-light font-mono">Forecast vs Baseline</span>
                  </div>
                </div>

                {/* Margins Calculations Panel */}
                <div className="border border-ink-mid bg-ink-light/10 p-5 rounded-sm">
                  <h3 className="mb-4 flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-wider text-signal border-b border-ink-mid pb-2">
                    <DollarSign className="h-4 w-4" />Margin Calculations & Profitability Matrix
                  </h3>
                  
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    
                    {/* Budget Gross profit */}
                    <div className="border border-slate-700/30 bg-ink-light/35 p-4 relative group">
                      <span className="absolute top-2 right-2 text-slate-light cursor-help" title="Planned revenue minus planned baseline costs.">
                        <InfoIcon className="h-3.5 w-3.5" />
                      </span>
                      <p className="font-mono text-[9px] uppercase text-slate tracking-wider">Budgeted Gross Margin</p>
                      <p className="mt-2 text-2xl font-bold font-mono text-paper">{budgetedGrossMarginPct.toFixed(2)}%</p>
                      <p className="mt-1 font-mono text-[10px] text-slate-light">
                        Profit: {formatCurrency(budgetedGrossProfit)}
                      </p>
                    </div>

                    {/* Forecast Gross profit */}
                    <div className="border border-slate-700/30 bg-ink-light/35 p-4 relative">
                      <span className="absolute top-2 right-2 text-slate-light cursor-help" title="Recorded contract value minus active forecast cost-at-completion (EAC).">
                        <InfoIcon className="h-3.5 w-3.5" />
                      </span>
                      <p className="font-mono text-[9px] uppercase text-slate tracking-wider">Forecast Gross Margin</p>
                      <p className="mt-2 text-2xl font-bold font-mono text-signal">{forecastGrossMarginPct.toFixed(2)}%</p>
                      <p className="mt-1 font-mono text-[10px] text-slate-light">
                        Profit: {formatCurrency(forecastGrossProfit)}
                      </p>
                    </div>

                    {/* Margin Slippage */}
                    <div className={`border border-slate-700/30 bg-ink-light/35 p-4 relative ${
                      marginSlippage < 0 ? "border-red-500/20 bg-red-950/5" : "border-emerald-500/20 bg-emerald-950/5"
                    }`}>
                      <p className="font-mono text-[9px] uppercase text-slate tracking-wider">Margin Slippage</p>
                      <p className={`mt-2 text-2xl font-bold font-mono ${marginSlippage < 0 ? "text-red-400" : "text-emerald-400"}`}>
                        {marginSlippage.toFixed(2)}%
                      </p>
                      <p className="mt-1 font-mono text-[10px] text-slate-light">
                        Forecast vs Baseline %
                      </p>
                    </div>

                    {/* Net profit margin */}
                    <div className="border border-slate-700/30 bg-ink-light/35 p-4 relative">
                      <span className="absolute top-2 right-2 text-slate-light cursor-help" title="Forecast gross margin minus recorded operational overheads.">
                        <InfoIcon className="h-3.5 w-3.5" />
                      </span>
                      <p className="font-mono text-[9px] uppercase text-slate tracking-wider">Forecast Net Margin</p>
                      <p className="mt-2 text-2xl font-bold font-mono text-sky-400">{forecastNetMarginPct.toFixed(2)}%</p>
                      <p className="mt-1 font-mono text-[10px] text-slate-light">
                        Net Profit: {formatCurrency(forecastNetProfit)}
                      </p>
                    </div>

                    {/* Markup percentage */}
                    <div className="border border-slate-700/30 bg-ink-light/35 p-4 relative">
                      <span className="absolute top-2 right-2 text-slate-light cursor-help" title="The price markup percentage applied to budgeted cost.">
                        <InfoIcon className="h-3.5 w-3.5" />
                      </span>
                      <p className="font-mono text-[9px] uppercase text-slate tracking-wider">Budgeted Markup</p>
                      <p className="mt-2 text-2xl font-bold font-mono text-paper">{markupPct.toFixed(2)}%</p>
                      <p className="mt-1 font-mono text-[10px] text-slate-light">
                        Markup on baseline cost
                      </p>
                    </div>

                    {/* Cost overrun percentage */}
                    <div className={`border border-slate-700/30 bg-ink-light/35 p-4 relative ${
                      costOverrunPct > 0 ? "border-amber-500/20" : ""
                    }`}>
                      <span className="absolute top-2 right-2 text-slate-light cursor-help" title="Percentage growth in cost between baseline and current forecast.">
                        <InfoIcon className="h-3.5 w-3.5" />
                      </span>
                      <p className="font-mono text-[9px] uppercase text-slate tracking-wider">Cost Overrun Factor</p>
                      <p className={`mt-2 text-2xl font-bold font-mono ${costOverrunPct > 0 ? "text-amber-400" : "text-emerald-400"}`}>
                        {costOverrunPct.toFixed(2)}%
                      </p>
                      <p className="mt-1 font-mono text-[10px] text-slate-light">
                        Budget Growth rate
                      </p>
                    </div>

                  </div>
                </div>

                {/* Dynamic Parameter Adjustment Sliders */}
                <div className="grid gap-4 md:grid-cols-2 border border-ink-mid bg-ink-light/20 p-5">
                  <div>
                    <h4 className="font-mono text-xs font-semibold uppercase text-paper flex items-center gap-1.5">
                      <Sliders className="h-4 w-4 text-signal" />Forecast cost variance
                    </h4>
                    <p className="text-[11px] text-slate-light mt-1">
                      Read-only until finance exposes a controlled forecast scenario workflow.
                    </p>
                    <div className="mt-4 flex items-center gap-4">
                      <input 
                        type="range" 
                        min="-10" 
                        max="30" 
                        value={overrunSlider} 
                        disabled
                        readOnly
                        className="w-full h-1 bg-ink-mid rounded-lg appearance-none cursor-not-allowed accent-signal opacity-50"
                      />
                      <span className="font-mono text-sm font-semibold text-signal w-12 text-right">
                        {overrunSlider > 0 ? `+${overrunSlider}` : overrunSlider}%
                      </span>
                    </div>
                  </div>

                  <div>
                    <h4 className="font-mono text-xs font-semibold uppercase text-paper flex items-center gap-1.5">
                      <Sliders className="h-4 w-4 text-sky-400" />Recorded overhead %
                    </h4>
                    <p className="text-[11px] text-slate-light mt-1">
                      Read-only value from project/finance services. Scenario editing requires a finance API workflow.
                    </p>
                    <div className="mt-4 flex items-center gap-4">
                      <input 
                        type="range" 
                        min="0" 
                        max="15" 
                        step="0.5"
                        value={overheadSlider} 
                        disabled
                        readOnly
                        className="w-full h-1 bg-ink-mid rounded-lg appearance-none cursor-not-allowed accent-sky-400 opacity-50"
                      />
                      <span className="font-mono text-sm font-semibold text-sky-400 w-12 text-right">
                        {overheadSlider}%
                      </span>
                    </div>
                  </div>
                </div>

                {/* SVG Variance Bar Chart */}
                <div className="border border-ink-mid bg-ink-light/10 p-5">
                  <h4 className="font-mono text-xs font-semibold uppercase text-slate tracking-wider mb-4">
                    Visual Budget Cost Variance Breakdown
                  </h4>
                  <div className="flex justify-center items-center">
                    <svg className="w-full max-w-lg" viewBox="0 0 500 240" fill="none" xmlns="http://www.w3.org/2000/svg">
                      
                      {/* Gridlines */}
                      <line x1="40" y1="20" x2="480" y2="20" stroke="#1E3A5F" strokeWidth="1" strokeDasharray="3 3" />
                      <line x1="40" y1="60" x2="480" y2="60" stroke="#1E3A5F" strokeWidth="1" strokeDasharray="3 3" />
                      <line x1="40" y1="100" x2="480" y2="100" stroke="#1E3A5F" strokeWidth="1" strokeDasharray="3 3" />
                      <line x1="40" y1="140" x2="480" y2="140" stroke="#1E3A5F" strokeWidth="1" strokeDasharray="3 3" />
                      <line x1="40" y1="180" x2="480" y2="180" stroke="#1E3A5F" strokeWidth="1" />

                      {/* Bar 1: Baseline Budget */}
                      <rect 
                        x="50" 
                        y={180 - (budgetedCost * chartScale)} 
                        width="60" 
                        height={budgetedCost * chartScale} 
                        fill="#1E3A5F" 
                        stroke="#4A5568" 
                        strokeWidth="1" 
                        className="transition-all duration-500 ease-dxl hover:fill-[#1e3a5f]/80"
                      />
                      <text x="80" y="195" fill="#718096" fontSize="9" fontFamily="monospace" textAnchor="middle">Baseline</text>
                      <text x="80" y={170 - (budgetedCost * chartScale)} fill="#CBD5E1" fontSize="9" fontFamily="monospace" textAnchor="middle">
                        ${(budgetedCost / 1000000).toFixed(2)}M
                      </text>

                      {/* Bar 2: Committed POs */}
                      <rect 
                        x="160" 
                        y={180 - (committedCost * chartScale)} 
                        width="60" 
                        height={committedCost * chartScale} 
                        fill="#0C6E96" 
                        stroke="#0a7ea6" 
                        strokeWidth="1" 
                        className="transition-all duration-500 ease-dxl"
                      />
                      <text x="190" y="195" fill="#718096" fontSize="9" fontFamily="monospace" textAnchor="middle">Committed</text>
                      <text x="190" y={170 - (committedCost * chartScale)} fill="#CBD5E1" fontSize="9" fontFamily="monospace" textAnchor="middle">
                        ${(committedCost / 1000000).toFixed(2)}M
                      </text>

                      {/* Bar 3: Actual spent */}
                      <rect 
                        x="270" 
                        y={180 - (actualCost * chartScale)} 
                        width="60" 
                        height={actualCost * chartScale} 
                        fill="#EEEDE8" 
                        stroke="#cbd5e1" 
                        strokeWidth="1" 
                        className="transition-all duration-500 ease-dxl"
                      />
                      <text x="300" y="195" fill="#718096" fontSize="9" fontFamily="monospace" textAnchor="middle">Actual spent</text>
                      <text x="300" y={170 - (actualCost * chartScale)} fill="#EEEDE8" fontSize="9" fontFamily="monospace" textAnchor="middle">
                        ${(actualCost / 1000000).toFixed(2)}M
                      </text>

                      {/* Bar 4: Forecast Cost */}
                      <rect 
                        x="380" 
                        y={180 - (forecastCost * chartScale)} 
                        width="60" 
                        height={forecastCost * chartScale} 
                        fill={forecastCost > budgetedCost ? "#9B2C2C" : "#C8960C"} 
                        stroke={forecastCost > budgetedCost ? "#E53E3E" : "#FF6A2B"} 
                        strokeWidth="1" 
                        className="transition-all duration-500 ease-dxl"
                      />
                      <text x="410" y="195" fill="#718096" fontSize="9" fontFamily="monospace" textAnchor="middle">Forecast</text>
                      <text x="410" y={170 - (forecastCost * chartScale)} fill={forecastCost > budgetedCost ? "#FC8181" : "#D4AF37"} fontSize="9" fontFamily="monospace" textAnchor="middle">
                        ${(forecastCost / 1000000).toFixed(2)}M
                      </text>

                      {/* Y-axis ticks */}
                      <text x="35" y="23" fill="#4A5568" fontSize="8" fontFamily="monospace" textAnchor="end">${((chartMaxVal * 1.0) / 1000000).toFixed(1)}M</text>
                      <text x="35" y="103" fill="#4A5568" fontSize="8" fontFamily="monospace" textAnchor="end">${((chartMaxVal * 0.5) / 1000000).toFixed(1)}M</text>
                      <text x="35" y="183" fill="#4A5568" fontSize="8" fontFamily="monospace" textAnchor="end">$0.0M</text>
                    </svg>
                  </div>
                </div>

              </div>
            )}

            {/* ---------------------------------------------------- */}
            {/* MATERIAL CONSUMPTION TAB */}
            {/* ---------------------------------------------------- */}
            {activeTab === "materials" && (
              <div className="space-y-6 animate-fade-in">
                <section className="border border-ink-mid bg-ink-light/20 p-5">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div>
                      <p className="font-mono text-[10px] uppercase tracking-widest text-signal">Material control dashboard</p>
                      <h3 className="mt-1 font-display text-xl font-semibold text-paper">Consumption, GRN receipts and wastage evidence</h3>
                      <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-light">
                        This view connects daily material usage to receipt and buying records so wastage, missing GRNs and supplier exposure are visible.
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-2 font-mono text-[10px] uppercase tracking-wider sm:grid-cols-4 xl:min-w-[640px]">
                      <Metric label="Usage lines" value={String(materialRecords.length)} detail="Site report material rows" tone="text-paper" />
                      <Metric label="GRNs" value={String(projectSignals.grns.length)} detail="Receipt records" tone={projectSignals.grns.length ? "text-emerald-300" : "text-amber-300"} />
                      <Metric label="GRN value" value={formatCurrency(grnValue)} detail={`${grnQuantity.toLocaleString()} received units`} tone="text-signal" />
                      <Metric label="Wastage rate" value={`${materialWastageRate.toFixed(1)}%`} detail="Wastage vs used quantity" tone={materialWastageRate > 5 ? "text-red-300" : "text-amber-300"} />
                    </div>
                  </div>
                </section>

                <section className="grid gap-4 lg:grid-cols-[1fr_0.8fr]">
                  <RecordList title="GRN receipt ledger" records={projectSignals.grns} columns={["grn_number", "supplier_name", "item_name", "quantity", "total_amount", "status"]} />
                  <RiskList
                    title="Material control checks"
                    items={materialExceptions}
                    empty="No material control exception triggered by the records currently returned."
                    tone="amber"
                  />
                </section>

                <div className="border border-ink-mid bg-ink-light/20 p-5 rounded-sm">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <p className="font-mono text-[10px] uppercase tracking-widest text-signal">Material evidence</p>
                      <h3 className="mt-1 font-display text-xl font-semibold text-paper">Daily site report material consumption</h3>
                      <p className="mt-2 max-w-2xl text-sm text-slate-light">
                        This panel reads material lines attached to daily site reports. It does not generate target quantities or accept browser-only material logs.
                      </p>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-right font-mono text-[10px] uppercase tracking-wider text-slate-light">
                      <div className="border border-ink-mid bg-ink p-3">
                        <p>Records</p>
                        <p className="mt-1 text-lg font-bold text-paper">{materialRecords.length}</p>
                      </div>
                      <div className="border border-ink-mid bg-ink p-3">
                        <p>Wastage</p>
                        <p className="mt-1 text-lg font-bold text-amber-300">{materialTotalWastage.toLocaleString()}</p>
                      </div>
                      <div className="border border-ink-mid bg-ink p-3">
                        <p>Cost</p>
                        <p className="mt-1 text-lg font-bold text-signal">{formatCurrency(materialTotalCost)}</p>
                      </div>
                    </div>
                  </div>
                </div>

                {materialRecords.length === 0 ? (
                  <div className="flex min-h-56 flex-col items-center justify-center border border-dashed border-ink-mid/60 bg-ink-light/10 p-8 text-center">
                    <Package className="h-8 w-8 text-slate" />
                    <p className="mt-3 font-mono text-xs uppercase tracking-widest text-slate-light">No material evidence recorded</p>
                    <p className="mt-2 max-w-xl text-sm text-slate">
                      Material consumption appears here after daily site report material lines are saved through Site Operations and returned by the project detail API.
                    </p>
                  </div>
                ) : (
                  <div className="grid gap-5 lg:grid-cols-[1fr_1.4fr]">
                    <div className="border border-ink-mid bg-ink-light/20 p-4 rounded-sm">
                      <h4 className="font-mono text-xs font-semibold uppercase tracking-wider text-paper">Material summary by item</h4>
                      <div className="mt-4 space-y-3">
                        {materialSummaryRows.map((row) => (
                          <div key={row.key} className="border border-ink-mid bg-ink p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="font-mono text-xs font-semibold uppercase text-paper">{row.name}</p>
                                <p className="mt-1 font-mono text-[10px] text-slate-light">{row.records} report line{row.records === 1 ? "" : "s"}</p>
                              </div>
                              <p className="font-mono text-xs font-bold text-signal">{formatCurrency(row.cost)}</p>
                            </div>
                            <div className="mt-3 grid grid-cols-2 gap-2 font-mono text-[10px] text-slate-light">
                              <span>Used: <strong className="text-paper">{row.quantity.toLocaleString()} {row.unit}</strong></span>
                              <span>Wastage: <strong className="text-amber-300">{row.wastage.toLocaleString()} {row.unit}</strong></span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="border border-ink-mid bg-ink-light/10 p-4 rounded-sm">
                      <h4 className="mb-3 font-mono text-xs font-semibold uppercase tracking-wider text-slate">Source material line history</h4>
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[760px] text-left font-mono text-[10px]">
                          <thead>
                            <tr className="border-b border-ink-mid/70 text-slate">
                              <th className="pb-2">Report date</th>
                              <th className="pb-2">Material</th>
                              <th className="pb-2 text-right">Quantity</th>
                              <th className="pb-2 text-right">Wastage</th>
                              <th className="pb-2 text-right">Unit cost</th>
                              <th className="pb-2">Work package</th>
                              <th className="pb-2">Store</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-ink-mid/30">
                            {materialRecords.map((row) => {
                              const unit = text(row.unit_of_measure, "units");
                              const quantity = number(row.quantity_used) ?? 0;
                              const wastage = number(row.wastage_quantity) ?? 0;
                              const unitCost = number(row.unit_cost) ?? 0;
                              return (
                                <tr key={String(row.id)} className="hover:bg-ink-light/20">
                                  <td className="py-2 text-slate-light">{formatDate(text(row.report_date, ""))}</td>
                                  <td className="py-2 font-semibold text-paper">{text(row.item_name ?? row.item_code ?? row.item_id)}</td>
                                  <td className="py-2 text-right text-paper">{quantity.toLocaleString()} {unit}</td>
                                  <td className="py-2 text-right text-amber-300">{wastage.toLocaleString()} {unit}</td>
                                  <td className="py-2 text-right text-slate-light">{formatCurrency(unitCost)}</td>
                                  <td className="py-2 text-slate-light">{text(row.work_package)}</td>
                                  <td className="py-2 text-slate-light">{text(row.store_name)}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ---------------------------------------------------- */}
            {/* CONTROLS TAB */}
            {/* ---------------------------------------------------- */}
            {activeTab === "controls" && (
              <ProjectControlsPanel project={source} detail={detail} signals={projectSignals} onOpenTab={setActiveTab} onOpenCommand={setActiveCommand} />
            )}

            {/* ---------------------------------------------------- */}
            {/* DOCUMENTS TAB */}
            {/* ---------------------------------------------------- */}
            {activeTab === "documents" && (
              <div className="animate-fade-in">
                <EntityDocumentsPanel entityType="project" entityId={project.id} />
              </div>
            )}

            {/* ---------------------------------------------------- */}
            {/* ASSIGNED TO TAB */}
            {/* ---------------------------------------------------- */}
            {activeTab === "assign" && (
              <div className="max-w-md animate-fade-in">
                <AssignmentPanel entityType="project" entityId={project.id} />
              </div>
            )}

          </div>
        )}
        {activeCommand ? (
          <ProjectCommandModal
            command={activeCommand}
            project={source}
            detail={detail}
            signals={projectSignals}
            onClose={() => setActiveCommand(null)}
            onRefresh={() => {
              void loadProjectSignals();
              onRefresh();
            }}
            onNavigateTab={(tab) => { setActiveCommand(null); setActiveTab(tab); }}
            onNavigateCommand={(nextCommand) => setActiveCommand(nextCommand)}
          />
        ) : null}
      </aside>
    </div>
  );
}
