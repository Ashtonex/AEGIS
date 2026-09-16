"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Banknote, Building2, Loader2, Plus, RefreshCw, Wallet } from "lucide-react";

import {
  createFinanceCashAccount,
  createHistoricalCostActivity,
  createHistoricalProject,
  createHistoricalRevenue,
  getCrmOrganizations,
  getFinanceCashAccounts,
  getHistoricalReconciliation,
  getInternalProjects,
  setHistoricalReconciliationBaseline,
} from "@/lib/api";
import { useFinanceDepartments } from "@/hooks/useFinanceDepartments";

type RecordData = Record<string, any>;

function money(value: unknown) {
  const num = typeof value === "number" ? value : Number(value);
  return new Intl.NumberFormat("en-ZW", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number.isFinite(num) ? num : 0);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

const inputClass = "w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50";
const buttonClass = "inline-flex items-center gap-2 bg-signal text-ink font-semibold px-3 py-2 rounded-sm text-sm hover:bg-signal/95 disabled:opacity-50";
const labelClass = "block text-xs font-mono uppercase text-slate mb-1";

const COST_CATEGORIES = ["labour", "equipment", "materials", "subcontract", "overhead", "other"] as const;

const EVIDENCE_GRADES = [
  { value: "A", label: "A - Verified, source document attached" },
  { value: "B", label: "B - Verified against a secondary record" },
  { value: "C", label: "C - Corroborated recollection" },
  { value: "D", label: "D - Single-source best estimate" },
  { value: "E", label: "E - Unverified / unknown provenance" },
] as const;

export function HistoricalEntryPanel() {
  const [projects, setProjects] = useState<RecordData[]>([]);
  const { departments } = useFinanceDepartments();
  const [organizations, setOrganizations] = useState<RecordData[]>([]);
  const [cashAccounts, setCashAccounts] = useState<RecordData[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [view, setView] = useState<"entry" | "reconciliation">("entry");
  const [reconciliation, setReconciliation] = useState<RecordData[]>([]);
  const [reconciliationLoading, setReconciliationLoading] = useState(false);
  const [baselineForm, setBaselineForm] = useState<Record<string, { revenue: string; cost: string }>>({});

  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [showNewProject, setShowNewProject] = useState(false);
  const [showNewClient, setShowNewClient] = useState(false);

  const [projectForm, setProjectForm] = useState({
    name: "", department_id: "", project_code: "", client_org_id: "",
    new_client_name: "", new_contact_name: "", new_contact_email: "",
  });
  const [cashAccountForm, setCashAccountForm] = useState({
    account_code: "", account_name: "Main Account", account_type: "bank", opening_balance: "0",
  });
  const [revenueForm, setRevenueForm] = useState({ amount: "", historical_date: today(), description: "", evidence_quality: "" as string, document_id: "" });
  const [costForm, setCostForm] = useState({
    cost_category: "materials" as (typeof COST_CATEGORIES)[number], description: "", amount: "", historical_date: today(), paid: true,
    evidence_quality: "" as string, document_id: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [projRes, orgRes, cashRes] = await Promise.allSettled([
        getInternalProjects(), getCrmOrganizations(), getFinanceCashAccounts(),
      ]);
      if (projRes.status === "fulfilled") setProjects(projRes.value.data ?? []);
      if (orgRes.status === "fulfilled") setOrganizations(orgRes.value.data ?? []);
      if (cashRes.status === "fulfilled") setCashAccounts(cashRes.value.data ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!projectForm.name.trim() || !projectForm.department_id) {
      setNotice("Project name and segment are required.");
      return;
    }
    setBusy("project");
    setNotice(null);
    try {
      const payload: Record<string, unknown> = {
        name: projectForm.name,
        department_id: projectForm.department_id,
        project_code: projectForm.project_code || undefined,
      };
      if (showNewClient && projectForm.new_client_name.trim()) {
        payload.new_client_name = projectForm.new_client_name;
      } else if (projectForm.client_org_id) {
        payload.client_org_id = projectForm.client_org_id;
      }
      if (projectForm.new_contact_name.trim()) {
        payload.new_contact_name = projectForm.new_contact_name;
        payload.new_contact_email = projectForm.new_contact_email || undefined;
      }
      const res = await createHistoricalProject(payload as any);
      const newId = res.data?.id;
      setNotice(`Historical project "${projectForm.name}" created.`);
      setShowNewProject(false);
      setProjectForm({ name: "", department_id: "", project_code: "", client_org_id: "", new_client_name: "", new_contact_name: "", new_contact_email: "" });
      await load();
      if (newId) setSelectedProjectId(newId);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not create the historical project.");
    } finally {
      setBusy(null);
    }
  }

  async function createOpeningBalance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!cashAccountForm.account_code.trim() || !cashAccountForm.account_name.trim()) {
      setNotice("Account code and name are required.");
      return;
    }
    setBusy("cash");
    setNotice(null);
    try {
      await createFinanceCashAccount({
        account_code: cashAccountForm.account_code,
        account_name: cashAccountForm.account_name,
        account_type: cashAccountForm.account_type,
        currency: "USD",
        opening_balance: Number(cashAccountForm.opening_balance || 0),
      });
      setNotice("Opening cash balance recorded.");
      setCashAccountForm({ account_code: "", account_name: "Main Account", account_type: "bank", opening_balance: "0" });
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not record the opening balance.");
    } finally {
      setBusy(null);
    }
  }

  async function recordRevenue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedProjectId || !revenueForm.amount) {
      setNotice("Select a project and enter an amount.");
      return;
    }
    if (!revenueForm.evidence_quality) {
      setNotice("Choose an evidence-quality grade before recording this revenue.");
      return;
    }
    setBusy("revenue");
    setNotice(null);
    try {
      await createHistoricalRevenue({
        project_id: selectedProjectId,
        amount: Number(revenueForm.amount),
        historical_date: revenueForm.historical_date,
        description: revenueForm.description || undefined,
        evidence_quality: revenueForm.evidence_quality as "A" | "B" | "C" | "D" | "E",
        document_id: revenueForm.document_id || undefined,
      });
      setNotice(`Historical revenue of ${money(Number(revenueForm.amount))} recorded and marked paid.`);
      setRevenueForm({ amount: "", historical_date: today(), description: "", evidence_quality: "", document_id: "" });
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not record historical revenue.");
    } finally {
      setBusy(null);
    }
  }

  async function recordCostActivity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedProjectId || !costForm.description.trim() || !costForm.amount) {
      setNotice("Select a project, description, and amount are required.");
      return;
    }
    if (!costForm.evidence_quality) {
      setNotice("Choose an evidence-quality grade before recording this activity.");
      return;
    }
    setBusy("cost");
    setNotice(null);
    try {
      await createHistoricalCostActivity({
        project_id: selectedProjectId,
        cost_category: costForm.cost_category,
        description: costForm.description,
        amount: Number(costForm.amount),
        historical_date: costForm.historical_date,
        paid: costForm.paid,
        evidence_quality: costForm.evidence_quality as "A" | "B" | "C" | "D" | "E",
        document_id: costForm.document_id || undefined,
      });
      setNotice(`Activity "${costForm.description}" recorded${costForm.paid ? " and posted to cash." : "."}`);
      setCostForm((c) => ({ ...c, description: "", amount: "", evidence_quality: "", document_id: "" }));
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not record the activity.");
    } finally {
      setBusy(null);
    }
  }

  const loadReconciliation = useCallback(async () => {
    setReconciliationLoading(true);
    try {
      const res = await getHistoricalReconciliation();
      setReconciliation(res.data ?? []);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not load the reconciliation dashboard.");
    } finally {
      setReconciliationLoading(false);
    }
  }, []);

  useEffect(() => {
    if (view === "reconciliation") void loadReconciliation();
  }, [view, loadReconciliation]);

  async function saveBaseline(projectId: string, category: "revenue" | "cost") {
    const form = baselineForm[projectId];
    const amountStr = category === "revenue" ? form?.revenue : form?.cost;
    if (!amountStr) return;
    try {
      await setHistoricalReconciliationBaseline({ project_id: projectId, category, expected_amount: Number(amountStr) });
      setNotice("Reconciliation baseline saved.");
      await loadReconciliation();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not save the baseline.");
    }
  }

  const selectedProject = projects.find((p) => p.id === selectedProjectId);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-slate">Not fully automated - by design</p>
          <h2 className="mt-1 text-xl font-semibold text-paper">Historical Backfill</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-light">
            Record real pre-AEGIS history: total revenue per project, then the activities that made up its cost. Everything here
            writes into the same tables the live system reads, so budgets, cash position, and cash runway pick it up automatically.
          </p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex h-9 items-center gap-2 rounded-sm border border-ink-mid px-3 font-mono text-xs uppercase tracking-widest text-paper hover:border-signal disabled:opacity-60">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </button>
      </div>

      {notice && <p className="rounded border border-ink-mid bg-ink-light px-3 py-2 text-sm text-paper">{notice}</p>}

      <div className="flex items-center gap-2 border-b border-ink-mid">
        <button onClick={() => setView("entry")} className={`px-4 py-2 font-mono text-xs uppercase tracking-wider border-b-2 -mb-px ${view === "entry" ? "border-signal text-signal font-semibold" : "border-transparent text-slate hover:text-paper"}`}>Entry</button>
        <button onClick={() => setView("reconciliation")} className={`px-4 py-2 font-mono text-xs uppercase tracking-wider border-b-2 -mb-px ${view === "reconciliation" ? "border-signal text-signal font-semibold" : "border-transparent text-slate hover:text-paper"}`}>Reconciliation</button>
      </div>

      {view === "reconciliation" && (
        <div className="space-y-4">
          {reconciliationLoading ? (
            <div className="flex items-center justify-center p-8 text-slate"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : reconciliation.length === 0 ? (
            <p className="rounded border border-ink-mid bg-ink-light px-4 py-6 text-center text-sm text-slate">No historical projects recorded yet.</p>
          ) : (
            reconciliation.map((r) => (
              <div key={r.project_id} className="rounded-sm border border-ink-mid bg-ink-light p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-paper">{r.project_name} {r.project_code ? <span className="text-slate-light font-mono text-xs">({r.project_code})</span> : null}</p>
                  {r.has_unverified_entries && <span className="rounded-sm border border-amber-500/30 bg-amber-950/20 px-2 py-0.5 text-[10px] uppercase font-mono text-amber-300">Has unverified entries</span>}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <p className="text-[10px] uppercase font-mono text-slate">Recorded Revenue</p>
                    <p className="text-paper font-semibold">{money(r.recorded_revenue)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase font-mono text-slate">Expected Revenue</p>
                    <p className="text-slate-light">{r.expected_revenue === null ? "No baseline set" : money(r.expected_revenue)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase font-mono text-slate">Recorded Cost</p>
                    <p className="text-paper font-semibold">{money(r.recorded_cost)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase font-mono text-slate">Expected Cost</p>
                    <p className="text-slate-light">{r.expected_cost === null ? "No baseline set" : money(r.expected_cost)}</p>
                  </div>
                </div>
                {(r.revenue_variance !== null || r.cost_variance !== null) && (
                  <div className="flex gap-4 text-xs">
                    {r.revenue_variance !== null && (
                      <span className={r.revenue_variance === 0 ? "text-emerald-400" : "text-amber-400"}>Revenue variance: {money(r.revenue_variance)}</span>
                    )}
                    {r.cost_variance !== null && (
                      <span className={r.cost_variance === 0 ? "text-emerald-400" : "text-amber-400"}>Cost variance: {money(r.cost_variance)}</span>
                    )}
                  </div>
                )}
                <div className="flex flex-wrap gap-1.5">
                  {(["A", "B", "C", "D", "E"] as const).map((g) => (
                    <span key={g} className="rounded-sm border border-ink-mid px-2 py-0.5 text-[10px] font-mono text-slate-light">
                      {g}: {r.evidence_quality_counts?.[g] ?? 0}
                    </span>
                  ))}
                </div>
                <div className="flex flex-wrap items-end gap-2 border-t border-ink-mid pt-3">
                  <div>
                    <label className={labelClass}>Set expected revenue</label>
                    <input type="number" step="0.01" className={`${inputClass} w-36`} value={baselineForm[r.project_id]?.revenue ?? ""} onChange={(e) => setBaselineForm((f) => ({ ...f, [r.project_id]: { revenue: e.target.value, cost: f[r.project_id]?.cost ?? "" } }))} />
                  </div>
                  <button type="button" onClick={() => void saveBaseline(r.project_id, "revenue")} className="text-xs text-signal hover:underline">Save</button>
                  <div>
                    <label className={labelClass}>Set expected cost</label>
                    <input type="number" step="0.01" className={`${inputClass} w-36`} value={baselineForm[r.project_id]?.cost ?? ""} onChange={(e) => setBaselineForm((f) => ({ ...f, [r.project_id]: { revenue: f[r.project_id]?.revenue ?? "", cost: e.target.value } }))} />
                  </div>
                  <button type="button" onClick={() => void saveBaseline(r.project_id, "cost")} className="text-xs text-signal hover:underline">Save</button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {view === "entry" && (
      <>
      {/* Opening cash balance */}
      <form onSubmit={createOpeningBalance} className="rounded-sm border border-ink-mid bg-ink-light">
        <div className="flex items-center gap-2 border-b border-ink-mid bg-ink/30 px-4 py-3">
          <Wallet className="h-4 w-4 text-slate" />
          <span className="font-mono text-xs uppercase tracking-wider text-slate">Step 1 - Opening cash position</span>
        </div>
        <div className="grid gap-3 p-4 md:grid-cols-4">
          <div>
            <label className={labelClass}>Account code</label>
            <input value={cashAccountForm.account_code} onChange={(e) => setCashAccountForm((c) => ({ ...c, account_code: e.target.value }))} className={inputClass} placeholder="MAIN-USD" />
          </div>
          <div>
            <label className={labelClass}>Account name</label>
            <input value={cashAccountForm.account_name} onChange={(e) => setCashAccountForm((c) => ({ ...c, account_name: e.target.value }))} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Type</label>
            <select value={cashAccountForm.account_type} onChange={(e) => setCashAccountForm((c) => ({ ...c, account_type: e.target.value }))} className={inputClass}>
              <option value="bank">Bank</option>
              <option value="cash">Cash</option>
              <option value="mobile_money">Mobile Money</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>Opening balance (USD)</label>
            <input type="number" step="0.01" value={cashAccountForm.opening_balance} onChange={(e) => setCashAccountForm((c) => ({ ...c, opening_balance: e.target.value }))} className={inputClass} />
          </div>
          <div className="md:col-span-4">
            <button type="submit" disabled={busy === "cash"} className={buttonClass}>
              {busy === "cash" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />}
              Set opening balance
            </button>
          </div>
        </div>
        {cashAccounts.length > 0 && (
          <div className="border-t border-ink-mid px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-wider text-slate mb-2">Existing cash accounts</p>
            <div className="flex flex-wrap gap-3">
              {cashAccounts.map((a) => (
                <span key={a.id} className="rounded-sm border border-ink-mid px-3 py-1.5 text-xs text-paper">
                  {a.account_name} - {money(a.current_balance)}
                </span>
              ))}
            </div>
          </div>
        )}
      </form>

      {/* Project selector / quick-create */}
      <div className="rounded-sm border border-ink-mid bg-ink-light">
        <div className="flex items-center gap-2 border-b border-ink-mid bg-ink/30 px-4 py-3">
          <Building2 className="h-4 w-4 text-slate" />
          <span className="font-mono text-xs uppercase tracking-wider text-slate">Step 2 - Project</span>
        </div>
        <div className="p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label className={labelClass}>Historical project</label>
              <select value={selectedProjectId} onChange={(e) => setSelectedProjectId(e.target.value)} className={inputClass}>
                <option value="">Select an existing project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <button type="button" onClick={() => setShowNewProject((v) => !v)} className="inline-flex h-10 items-center gap-2 rounded-sm border border-ink-mid px-3 font-mono text-xs uppercase tracking-widest text-paper hover:border-signal">
              <Plus className="h-4 w-4" /> New historical project
            </button>
          </div>

          {showNewProject && (
            <form onSubmit={createProject} className="mt-4 grid gap-3 border-t border-ink-mid pt-4 md:grid-cols-2">
              <div>
                <label className={labelClass}>Project name</label>
                <input value={projectForm.name} onChange={(e) => setProjectForm((c) => ({ ...c, name: e.target.value }))} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Segment</label>
                <select value={projectForm.department_id} onChange={(e) => setProjectForm((c) => ({ ...c, department_id: e.target.value }))} className={inputClass}>
                  <option value="">Select segment</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>Project code (optional)</label>
                <input value={projectForm.project_code} onChange={(e) => setProjectForm((c) => ({ ...c, project_code: e.target.value }))} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Client organization</label>
                {!showNewClient ? (
                  <div className="flex gap-2">
                    <select value={projectForm.client_org_id} onChange={(e) => setProjectForm((c) => ({ ...c, client_org_id: e.target.value }))} className={inputClass}>
                      <option value="">No client / internal</option>
                      {organizations.map((o) => (
                        <option key={o.id} value={o.id}>{o.name}</option>
                      ))}
                    </select>
                    <button type="button" onClick={() => setShowNewClient(true)} className="shrink-0 whitespace-nowrap font-mono text-xs uppercase text-signal hover:underline">
                      + New client
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <input value={projectForm.new_client_name} onChange={(e) => setProjectForm((c) => ({ ...c, new_client_name: e.target.value }))} placeholder="New client organization name" className={inputClass} />
                    <button type="button" onClick={() => setShowNewClient(false)} className="shrink-0 whitespace-nowrap font-mono text-xs uppercase text-slate hover:text-paper">
                      Use existing
                    </button>
                  </div>
                )}
              </div>
              <div>
                <label className={labelClass}>Contact name (optional)</label>
                <input value={projectForm.new_contact_name} onChange={(e) => setProjectForm((c) => ({ ...c, new_contact_name: e.target.value }))} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Contact email (optional)</label>
                <input type="email" value={projectForm.new_contact_email} onChange={(e) => setProjectForm((c) => ({ ...c, new_contact_email: e.target.value }))} className={inputClass} />
              </div>
              <div className="md:col-span-2">
                <button type="submit" disabled={busy === "project"} className={buttonClass}>
                  {busy === "project" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  Create historical project
                </button>
              </div>
            </form>
          )}
        </div>
      </div>

      {selectedProject && (
        <>
          {/* Revenue */}
          <form onSubmit={recordRevenue} className="rounded-sm border border-ink-mid bg-ink-light">
            <div className="flex items-center gap-2 border-b border-ink-mid bg-ink/30 px-4 py-3">
              <Banknote className="h-4 w-4 text-slate" />
              <span className="font-mono text-xs uppercase tracking-wider text-slate">
                Step 3 - Total revenue for {selectedProject.name}
              </span>
            </div>
            <div className="grid gap-3 p-4 md:grid-cols-4">
              <div>
                <label className={labelClass}>Amount (USD)</label>
                <input type="number" step="0.01" min="0.01" value={revenueForm.amount} onChange={(e) => setRevenueForm((c) => ({ ...c, amount: e.target.value }))} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Date received</label>
                <input type="date" value={revenueForm.historical_date} onChange={(e) => setRevenueForm((c) => ({ ...c, historical_date: e.target.value }))} className={inputClass} />
              </div>
              <div className="md:col-span-2">
                <label className={labelClass}>Description (optional)</label>
                <input value={revenueForm.description} onChange={(e) => setRevenueForm((c) => ({ ...c, description: e.target.value }))} className={inputClass} placeholder="e.g. Full contract value, paid on completion" />
              </div>
              <div className="md:col-span-2">
                <label className={labelClass}>Evidence quality (required)</label>
                <select value={revenueForm.evidence_quality} onChange={(e) => setRevenueForm((c) => ({ ...c, evidence_quality: e.target.value }))} className={inputClass}>
                  <option value="">Select a grade</option>
                  {EVIDENCE_GRADES.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
                </select>
              </div>
              <div className="md:col-span-2">
                <label className={labelClass}>Source document ID (optional)</label>
                <input value={revenueForm.document_id} onChange={(e) => setRevenueForm((c) => ({ ...c, document_id: e.target.value }))} className={inputClass} placeholder="Paste an existing document's ID" />
              </div>
              <div className="md:col-span-4">
                <button type="submit" disabled={busy === "revenue"} className={buttonClass}>
                  {busy === "revenue" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Banknote className="h-4 w-4" />}
                  Record revenue (certified &amp; paid)
                </button>
              </div>
            </div>
          </form>

          {/* Cost activities - repeatable, post-and-clear */}
          <form onSubmit={recordCostActivity} className="rounded-sm border border-ink-mid bg-ink-light">
            <div className="flex items-center gap-2 border-b border-ink-mid bg-ink/30 px-4 py-3">
              <Plus className="h-4 w-4 text-slate" />
              <span className="font-mono text-xs uppercase tracking-wider text-slate">
                Step 4 - Activities on {selectedProject.name}
              </span>
            </div>
            <div className="grid gap-3 p-4 md:grid-cols-5">
              <div>
                <label className={labelClass}>Category</label>
                <select value={costForm.cost_category} onChange={(e) => setCostForm((c) => ({ ...c, cost_category: e.target.value as any }))} className={inputClass}>
                  {COST_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>{cat[0].toUpperCase() + cat.slice(1)}</option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-2">
                <label className={labelClass}>Description</label>
                <input value={costForm.description} onChange={(e) => setCostForm((c) => ({ ...c, description: e.target.value }))} className={inputClass} placeholder="e.g. Cement delivery, 3rd batch" />
              </div>
              <div>
                <label className={labelClass}>Amount (USD)</label>
                <input type="number" step="0.01" min="0.01" value={costForm.amount} onChange={(e) => setCostForm((c) => ({ ...c, amount: e.target.value }))} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Date</label>
                <input type="date" value={costForm.historical_date} onChange={(e) => setCostForm((c) => ({ ...c, historical_date: e.target.value }))} className={inputClass} />
              </div>
              <div className="flex items-center gap-2 md:col-span-2">
                <input id="paid-toggle" type="checkbox" checked={costForm.paid} onChange={(e) => setCostForm((c) => ({ ...c, paid: e.target.checked }))} className="h-4 w-4" />
                <label htmlFor="paid-toggle" className="text-sm text-paper">
                  Already paid (affects cash position)
                </label>
              </div>
              <div className="md:col-span-3">
                <label className={labelClass}>Evidence quality (required)</label>
                <select value={costForm.evidence_quality} onChange={(e) => setCostForm((c) => ({ ...c, evidence_quality: e.target.value }))} className={inputClass}>
                  <option value="">Select a grade</option>
                  {EVIDENCE_GRADES.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
                </select>
              </div>
              <div className="md:col-span-2">
                <label className={labelClass}>Source document ID (optional)</label>
                <input value={costForm.document_id} onChange={(e) => setCostForm((c) => ({ ...c, document_id: e.target.value }))} className={inputClass} placeholder="Paste an existing document's ID" />
              </div>
              <div className="md:col-span-5">
                <button type="submit" disabled={busy === "cost"} className={buttonClass}>
                  {busy === "cost" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  Add activity
                </button>
              </div>
            </div>
          </form>
        </>
      )}
      </>
      )}
    </div>
  );
}
