"use client";

import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Loader2,
  PackageCheck,
  RefreshCw,
  Ruler,
  Send,
  XCircle,
} from "lucide-react";

import {
  createWeeklySiteBudget,
  decideDailySiteReportEngineer,
  decideSiteGrnEngineer,
  decideSiteMaterialRequestEngineer,
  getDailySiteReports,
  getExecutionBudget,
  getSiteEngineerWorkspace,
  getSiteGrns,
  getSiteMaterialRequests,
  getSiteVariances,
  getWeeklySiteBudgets,
} from "@/lib/api";

type Rec = Record<string, any> & { id: string };

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function weekStartIso() {
  const date = new Date();
  const day = date.getDay() || 7;
  date.setDate(date.getDate() - day + 1);
  return date.toISOString().slice(0, 10);
}

function text(value: unknown, fallback = "Not recorded") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function num(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: unknown) {
  return new Intl.NumberFormat("en-ZW", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(num(value));
}

function dateLabel(value: unknown) {
  if (!value) return "No date";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat("en-ZW", { dateStyle: "medium" }).format(date);
}

function errMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function SiteEngineerPortalHome() {
  const [projects, setProjects] = useState<Rec[]>([]);
  const [reports, setReports] = useState<Rec[]>([]);
  const [materials, setMaterials] = useState<Rec[]>([]);
  const [grns, setGrns] = useState<Rec[]>([]);
  const [budgets, setBudgets] = useState<Rec[]>([]);
  const [executionLines, setExecutionLines] = useState<Rec[]>([]);
  const [variances, setVariances] = useState<Rec[]>([]);
  const [projectId, setProjectId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [budget, setBudget] = useState({
    week_start: weekStartIso(),
    labour_budget: "0",
    materials_budget: "0",
    equipment_budget: "0",
    subcontract_budget: "0",
    work_plan: "",
    notes: "",
  });
  const [budgetLine, setBudgetLine] = useState({
    boq_line_item_id: "",
    planned_qty: "0",
    description: "",
    approval_route: "internal",
    variance_origin: "site_initiated",
    variance_classification: "quantity_variance",
    variance_reason: "",
    proceed_at_risk: false,
    proceed_instruction_given_by: "",
    proceed_instruction_at: "",
    proceed_evidence_note: "",
    proceed_estimated_cost_exposure: "0",
    proceed_estimated_time_exposure_days: "0",
    proceed_management_authorizer: "",
    proceed_formal_approval_deadline: todayIso(),
  });

  const selectedProjectName = useMemo(
    () => text(projects.find((project) => project.id === projectId)?.name, "All assigned projects"),
    [projects, projectId]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [projectResult, reportResult, materialResult, grnResult, budgetResult, executionResult, varianceResult] = await Promise.all([
        getSiteEngineerWorkspace(),
        getDailySiteReports({ projectId: projectId || undefined, status: "submitted" }),
        getSiteMaterialRequests({ projectId: projectId || undefined, engineerStatus: "pending" }),
        getSiteGrns({ projectId: projectId || undefined, engineerStatus: "pending" }),
        getWeeklySiteBudgets({ projectId: projectId || undefined, status: "all" }),
        projectId ? getExecutionBudget(projectId) : Promise.resolve({ data: { line_items: [] } } as any),
        getSiteVariances({ projectId: projectId || undefined, status: "submitted" }),
      ]);
      setProjects(Array.isArray(projectResult.data?.projects) ? projectResult.data.projects : []);
      setReports(Array.isArray(reportResult.data) ? reportResult.data : []);
      setMaterials(Array.isArray(materialResult.data) ? materialResult.data : []);
      setGrns(Array.isArray(grnResult.data) ? grnResult.data : []);
      setBudgets(Array.isArray(budgetResult.data) ? budgetResult.data : []);
      setExecutionLines(Array.isArray(executionResult.data?.line_items) ? executionResult.data.line_items : []);
      setVariances(Array.isArray(varianceResult.data) ? varianceResult.data : []);
    } catch (loadError) {
      setError(errMessage(loadError, "Site Engineer portal data could not be loaded."));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(kind: "report" | "material" | "grn", id: string, decision: "approved" | "rejected") {
    setSaving(`${kind}:${id}:${decision}`);
    setNotice(null);
    setError(null);
    try {
      const reason = decision === "approved" ? "Engineer technical verification complete." : "Rejected by Site Engineer for correction.";
      if (kind === "report") await decideDailySiteReportEngineer(id, decision, reason);
      if (kind === "material") await decideSiteMaterialRequestEngineer(id, decision, reason);
      if (kind === "grn") await decideSiteGrnEngineer(id, decision, reason);
      setNotice(`${kind === "grn" ? "GRN" : kind} ${decision}.`);
      await load();
    } catch (decisionError) {
      setError(errMessage(decisionError, "Engineer decision could not be saved."));
    } finally {
      setSaving(null);
    }
  }

  async function submitBudget() {
    if (!projectId) {
      setError("Select a project before submitting a weekly budget.");
      return;
    }
    setSaving("budget");
    setNotice(null);
    setError(null);
    try {
      await createWeeklySiteBudget({
        project_id: projectId,
        week_start: budget.week_start,
        labour_budget: num(budget.labour_budget),
        materials_budget: num(budget.materials_budget),
        equipment_budget: num(budget.equipment_budget),
        subcontract_budget: num(budget.subcontract_budget),
        work_plan: budget.work_plan || null,
        labour_plan: [],
        material_plan: [],
        plant_plan: [],
        risk_plan: [],
        notes: budget.notes || null,
        lines: budgetLine.description || budgetLine.boq_line_item_id ? [{
          boq_line_item_id: budgetLine.boq_line_item_id || null,
          description: budgetLine.description || selectedExecutionLine?.description || "Weekly execution item",
          unit: selectedExecutionLine?.unit || "item",
          planned_qty: num(budgetLine.planned_qty),
          cost_category: selectedExecutionLine?.cost_category || null,
          approval_route: budgetLine.approval_route,
          variance_origin: budgetLine.variance_origin,
          variance_classification: budgetLine.variance_classification,
          variance_reason: budgetLine.variance_reason || null,
          proceed_at_risk: budgetLine.proceed_at_risk,
          proceed_instruction_given_by: budgetLine.proceed_instruction_given_by || null,
          proceed_instruction_at: budgetLine.proceed_instruction_at || null,
          proceed_evidence_note: budgetLine.proceed_evidence_note || null,
          proceed_estimated_cost_exposure: num(budgetLine.proceed_estimated_cost_exposure),
          proceed_estimated_time_exposure_days: Math.trunc(num(budgetLine.proceed_estimated_time_exposure_days)),
          proceed_management_authorizer: budgetLine.proceed_management_authorizer || null,
          proceed_formal_approval_deadline: budgetLine.proceed_formal_approval_deadline || null,
        }] : [],
      });
      setNotice("Weekly site budget submitted for Site Agent / Project Manager review.");
      await load();
    } catch (budgetError) {
      setError(errMessage(budgetError, "Weekly budget could not be submitted."));
    } finally {
      setSaving(null);
    }
  }

  const metrics = {
    reports: reports.filter((report) => text(report.engineer_review_status, "pending") === "pending").length,
    materials: materials.length,
    grns: grns.length,
    budget: budgets.find((row) => String(row.week_start).startsWith(budget.week_start)),
    variances: variances.length,
  };
  const selectedExecutionLine = executionLines.find((line) => line.id === budgetLine.boq_line_item_id);
  const plannedQty = num(budgetLine.planned_qty);
  const availableQty = num(selectedExecutionLine?.available_qty);
  const needsVariance = Boolean(budgetLine.boq_line_item_id && plannedQty > availableQty) || budgetLine.approval_route !== "internal";

  return (
    <main className="min-h-screen bg-ink text-paper">
      <section className="border-b border-ink-mid bg-ink-light">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-signal">AEGIS technical control</p>
            <h1 className="mt-2 font-display text-3xl sm:text-4xl">Site Engineer Portal</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-light">
              Verify site reports, toolbox checks, material requests, GRNs and weekly budgets from the same project records used by Clerk, Foreman and Site Agent.
            </p>
          </div>
          <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex h-10 items-center justify-center gap-2 border border-ink-mid px-4 font-mono text-xs uppercase tracking-widest text-paper hover:border-signal disabled:opacity-60">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Refresh
          </button>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {error ? <Banner tone="error">{error}</Banner> : null}
        {notice ? <Banner tone="success">{notice}</Banner> : null}

        <div className="mb-6 border border-ink-mid bg-ink-light p-4">
          <label className="block">
            <span className="font-mono text-[10px] uppercase tracking-widest text-slate-light">Project</span>
            <select value={projectId} onChange={(event) => setProjectId(event.target.value)} className="mt-2 h-11 w-full border border-ink-mid bg-ink px-3 text-sm text-paper outline-none focus:border-signal">
              <option value="">All assigned projects</option>
              {projects.map((project) => <option key={project.id} value={project.id}>{text(project.name ?? project.project_code, project.id)}</option>)}
            </select>
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Metric icon={<ClipboardCheck />} label="Reports to verify" value={String(metrics.reports)} />
          <Metric icon={<PackageCheck />} label="Material requests" value={String(metrics.materials)} />
          <Metric icon={<BadgeCheck />} label="GRNs pending" value={String(metrics.grns)} />
          <Metric icon={<CalendarDays />} label="This week budget" value={metrics.budget ? text(metrics.budget.status, "submitted") : "Missing"} />
          <Metric icon={<AlertTriangle />} label="Variance gates" value={String(metrics.variances)} />
        </div>

        <div className="mt-6 grid gap-6 xl:grid-cols-[420px_1fr]">
          <section className="border border-ink-mid bg-ink-light">
            <div className="border-b border-ink-mid p-4">
              <p className="font-mono text-[10px] uppercase tracking-widest text-signal">Weekly budget builder</p>
              <h2 className="mt-1 text-xl font-semibold">{selectedProjectName}</h2>
            </div>
            <div className="space-y-4 p-4">
              <Field label="Week start"><input type="date" value={budget.week_start} onChange={(e) => setBudget({ ...budget, week_start: e.target.value })} className="field" /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Labour"><input value={budget.labour_budget} onChange={(e) => setBudget({ ...budget, labour_budget: e.target.value })} className="field" /></Field>
                <Field label="Materials"><input value={budget.materials_budget} onChange={(e) => setBudget({ ...budget, materials_budget: e.target.value })} className="field" /></Field>
                <Field label="Plant"><input value={budget.equipment_budget} onChange={(e) => setBudget({ ...budget, equipment_budget: e.target.value })} className="field" /></Field>
                <Field label="Subcontract"><input value={budget.subcontract_budget} onChange={(e) => setBudget({ ...budget, subcontract_budget: e.target.value })} className="field" /></Field>
              </div>
              <Field label="Work plan"><textarea rows={4} value={budget.work_plan} onChange={(e) => setBudget({ ...budget, work_plan: e.target.value })} className="textarea" /></Field>
              <div className="border border-ink-mid bg-ink p-3">
                <p className="font-mono text-[10px] uppercase tracking-widest text-signal">Execution line</p>
                <Field label="QS allowance">
                  <select value={budgetLine.boq_line_item_id} onChange={(e) => {
                    const line = executionLines.find((item) => item.id === e.target.value);
                    setBudgetLine({ ...budgetLine, boq_line_item_id: e.target.value, description: text(line?.description, budgetLine.description) });
                  }} className="field">
                    <option value="">Unlinked item / variation only</option>
                    {executionLines.map((line) => (
                      <option key={line.id} value={line.id}>
                        {text(line.item_no, "BOQ")} - {text(line.description)} · remaining {text(line.available_qty)} {text(line.unit)}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <Field label="Planned qty"><input value={budgetLine.planned_qty} onChange={(e) => setBudgetLine({ ...budgetLine, planned_qty: e.target.value })} className="field" /></Field>
                  <Field label="Approval route">
                    <select value={budgetLine.approval_route} onChange={(e) => setBudgetLine({ ...budgetLine, approval_route: e.target.value })} className="field">
                      <option value="internal">Internal</option>
                      <option value="client">Client</option>
                      <option value="client_and_internal">Client + internal</option>
                    </select>
                  </Field>
                </div>
                <Field label="Line description"><input value={budgetLine.description} onChange={(e) => setBudgetLine({ ...budgetLine, description: e.target.value })} className="field" /></Field>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <Field label="Variance class">
                    <select value={budgetLine.variance_classification} onChange={(e) => setBudgetLine({ ...budgetLine, variance_classification: e.target.value })} className="field">
                      <option value="client_variation">Client variation</option>
                      <option value="design_variation">Design variation</option>
                      <option value="site_condition_variation">Site-condition variation</option>
                      <option value="quantity_variance">Quantity variance</option>
                      <option value="internal_cost_variance">Internal cost variance</option>
                      <option value="emergency_variance">Emergency variance</option>
                    </select>
                  </Field>
                  <Field label="Variance source">
                    <select value={budgetLine.variance_origin} onChange={(e) => setBudgetLine({ ...budgetLine, variance_origin: e.target.value })} className="field">
                      <option value="site_initiated">Site initiated</option>
                      <option value="client_initiated">Client initiated</option>
                      <option value="designer_initiated">Design / consultant</option>
                      <option value="statutory">Statutory</option>
                      <option value="internal_loss">Internal loss</option>
                    </select>
                  </Field>
                </div>
                <Field label="Variance reason"><textarea rows={3} value={budgetLine.variance_reason} onChange={(e) => setBudgetLine({ ...budgetLine, variance_reason: e.target.value })} className="textarea" /></Field>
                <label className="mt-3 flex items-center gap-2 text-xs text-slate-light">
                  <input type="checkbox" checked={budgetLine.proceed_at_risk} onChange={(e) => setBudgetLine({ ...budgetLine, proceed_at_risk: e.target.checked })} />
                  Emergency / proceed-at-risk request
                </label>
                {budgetLine.proceed_at_risk ? (
                  <div className="mt-3 space-y-3 border border-amber-500/30 bg-amber-950/20 p-3">
                    <p className="font-mono text-[10px] uppercase tracking-widest text-amber-100">Proceed-at-risk override record</p>
                    <Field label="Instruction giver"><input value={budgetLine.proceed_instruction_given_by} onChange={(e) => setBudgetLine({ ...budgetLine, proceed_instruction_given_by: e.target.value })} className="field" /></Field>
                    <Field label="Instruction date/time"><input value={budgetLine.proceed_instruction_at} onChange={(e) => setBudgetLine({ ...budgetLine, proceed_instruction_at: e.target.value })} className="field" placeholder="2026-08-22 22:01" /></Field>
                    <Field label="Evidence / witness"><textarea rows={3} value={budgetLine.proceed_evidence_note} onChange={(e) => setBudgetLine({ ...budgetLine, proceed_evidence_note: e.target.value })} className="textarea" /></Field>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Cost exposure"><input value={budgetLine.proceed_estimated_cost_exposure} onChange={(e) => setBudgetLine({ ...budgetLine, proceed_estimated_cost_exposure: e.target.value })} className="field" /></Field>
                      <Field label="Time exposure days"><input value={budgetLine.proceed_estimated_time_exposure_days} onChange={(e) => setBudgetLine({ ...budgetLine, proceed_estimated_time_exposure_days: e.target.value })} className="field" /></Field>
                    </div>
                    <Field label="Management authoriser"><input value={budgetLine.proceed_management_authorizer} onChange={(e) => setBudgetLine({ ...budgetLine, proceed_management_authorizer: e.target.value })} className="field" /></Field>
                    <Field label="Formal approval deadline"><input type="date" value={budgetLine.proceed_formal_approval_deadline} onChange={(e) => setBudgetLine({ ...budgetLine, proceed_formal_approval_deadline: e.target.value })} className="field" /></Field>
                  </div>
                ) : null}
                {selectedExecutionLine ? (
                  <p className="mt-3 text-xs text-slate-light">
                    Available: {text(selectedExecutionLine.available_qty)} {text(selectedExecutionLine.unit)} · remaining execution allowance {money(selectedExecutionLine.remaining_execution_amount)}
                  </p>
                ) : null}
                {needsVariance ? (
                  <p className="mt-3 border border-amber-500/30 bg-amber-950/20 p-2 text-xs text-amber-100">
                    This line will create a variance gate. QS review and any required client approval must be complete before normal execution.
                  </p>
                ) : null}
              </div>
              <Field label="Engineer notes"><textarea rows={3} value={budget.notes} onChange={(e) => setBudget({ ...budget, notes: e.target.value })} className="textarea" /></Field>
              <button type="button" onClick={() => void submitBudget()} disabled={saving === "budget" || !projectId} className="inline-flex h-10 w-full items-center justify-center gap-2 bg-signal px-4 font-mono text-xs uppercase tracking-widest text-ink disabled:opacity-50">
                {saving === "budget" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Submit weekly budget
              </button>
            </div>
          </section>

          <section className="space-y-6">
            <Queue title="Daily reports requiring engineer sign-off" icon={<Ruler />} empty="No submitted reports are waiting for engineer verification.">
              {reports.filter((report) => text(report.engineer_review_status, "pending") === "pending").map((report) => (
                <QueueRow key={report.id} title={`${text(report.project_name ?? report.project_id, "Project")} · ${dateLabel(report.report_date)}`} meta={text(report.actual_work ?? report.planned_work, "No site narrative recorded.")} saving={saving} id={report.id} kind="report" decide={decide} />
              ))}
            </Queue>

            <Queue title="Material requests before forwarding" icon={<PackageCheck />} empty="No material requests are waiting for engineer sign-off.">
              {materials.map((request) => (
                <QueueRow key={request.id} title={`${text(request.request_number)} · ${text(request.item_name ?? request.item_code, "Material")}`} meta={`${text(request.project_name, "Project")} · qty ${text(request.requested_quantity)} · ${money(request.total_estimated)}`} saving={saving} id={request.id} kind="material" decide={decide} />
              ))}
            </Queue>

            <Queue title="GRNs requiring technical confirmation" icon={<BadgeCheck />} empty="No GRNs are waiting for engineer verification.">
              {grns.map((grn) => (
                <QueueRow key={grn.id} title={`${text(grn.grn_number)} · ${text(grn.supplier_name, "Supplier")}`} meta={`${text(grn.project_name, "Project")} · delivered ${dateLabel(grn.delivery_date)}`} saving={saving} id={grn.id} kind="grn" decide={decide} />
              ))}
            </Queue>
          </section>
        </div>
      </section>
      <style jsx>{`.field{height:2.5rem;width:100%;border:1px solid rgb(47 55 69);background:#09111f;padding:0 .75rem;font-size:.875rem;color:#f8fafc;outline:none}.textarea{width:100%;resize:none;border:1px solid rgb(47 55 69);background:#09111f;padding:.75rem;font-size:.875rem;color:#f8fafc;outline:none}`}</style>
    </main>
  );
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return <div className="border border-ink-mid bg-ink-light p-4"><div className="flex items-center justify-between text-slate"><p className="font-mono text-[10px] uppercase tracking-wider">{label}</p><span className="text-signal [&_svg]:h-4 [&_svg]:w-4">{icon}</span></div><p className="mt-3 text-2xl font-semibold text-paper">{value}</p></div>;
}

function Banner({ tone, children }: { tone: "error" | "success"; children: ReactNode }) {
  const cls = tone === "error" ? "border-red-500/30 bg-red-950/30 text-red-200" : "border-emerald-500/30 bg-emerald-950/20 text-emerald-200";
  return <div className={`mb-4 flex gap-3 border p-4 text-sm ${cls}`}>{tone === "error" ? <AlertTriangle className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5" />}<span>{children}</span></div>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block"><span className="font-mono text-[10px] uppercase tracking-widest text-slate-light">{label}</span><div className="mt-2">{children}</div></label>;
}

function Queue({ title, icon, empty, children }: { title: string; icon: ReactNode; empty: string; children: ReactNode }) {
  const rows = Array.isArray(children) ? children.filter(Boolean) : children;
  const count = Array.isArray(rows) ? rows.length : rows ? 1 : 0;
  return <div className="border border-ink-mid bg-ink-light"><div className="flex items-center justify-between border-b border-ink-mid p-4"><h2 className="text-lg font-semibold">{title}</h2><span className="text-signal [&_svg]:h-5 [&_svg]:w-5">{icon}</span></div>{count ? <div className="divide-y divide-ink-mid">{rows}</div> : <p className="p-5 text-sm text-slate-light">{empty}</p>}</div>;
}

function QueueRow({ title, meta, id, kind, saving, decide }: { title: string; meta: string; id: string; kind: "report" | "material" | "grn"; saving: string | null; decide: (kind: "report" | "material" | "grn", id: string, decision: "approved" | "rejected") => void }) {
  return (
    <article className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
      <div>
        <h3 className="font-semibold">{title}</h3>
        <p className="mt-1 text-sm text-slate-light">{meta}</p>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={() => void decide(kind, id, "approved")} disabled={Boolean(saving)} className="inline-flex h-9 items-center gap-2 bg-signal px-3 font-mono text-[10px] uppercase tracking-widest text-ink disabled:opacity-50">
          {saving === `${kind}:${id}:approved` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
          Sign off
        </button>
        <button type="button" onClick={() => void decide(kind, id, "rejected")} disabled={Boolean(saving)} className="inline-flex h-9 items-center gap-2 border border-red-500/40 px-3 font-mono text-[10px] uppercase tracking-widest text-red-200 disabled:opacity-50">
          <XCircle className="h-3.5 w-3.5" />
          Reject
        </button>
      </div>
    </article>
  );
}
