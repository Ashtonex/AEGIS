"use client";

import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  HardHat,
  Loader2,
  PackagePlus,
  RefreshCw,
  Send,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";

import {
  ApiError,
  createDailySiteReport,
  getComplianceDeploymentGateChecks,
  getDailySiteReports,
  getInternalProjects,
  getSiteOperationInventoryItems,
  getSiteOperationSites,
  getSiteOperationStores,
  requestSiteMaterial,
  submitDailySiteReport,
} from "@/lib/api";

type RecordData = Record<string, any> & { id: string };

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function text(value: unknown, fallback = "Not recorded") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function numberValue(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateLabel(value: unknown) {
  if (!value) return "No date";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime())
    ? String(value)
    : new Intl.DateTimeFormat("en-ZW", { dateStyle: "medium" }).format(date);
}

function actionMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError && error.message) return error.message;
  if (error instanceof Error && /aborted|timeout|network|fetch/i.test(error.message)) {
    return "The field portal service is still synchronizing. Retry once connectivity is ready.";
  }
  return fallback;
}

function statusTone(status: unknown) {
  const value = text(status, "draft").toLowerCase();
  if (value === "approved") return "border-emerald-500/40 bg-emerald-950/20 text-emerald-300";
  if (value === "submitted") return "border-blue-500/40 bg-blue-950/20 text-blue-300";
  if (value === "rejected" || value === "blocked") return "border-red-500/40 bg-red-950/20 text-red-300";
  return "border-slate-500/40 bg-slate-950/20 text-slate-300";
}

function FieldLabel({ children }: { children: ReactNode }) {
  return <span className="font-mono text-[10px] uppercase tracking-wider text-slate-light">{children}</span>;
}

export function ForemanPortalHome() {
  const [projects, setProjects] = useState<RecordData[]>([]);
  const [sites, setSites] = useState<RecordData[]>([]);
  const [reports, setReports] = useState<RecordData[]>([]);
  const [items, setItems] = useState<RecordData[]>([]);
  const [stores, setStores] = useState<RecordData[]>([]);
  const [gateChecks, setGateChecks] = useState<RecordData[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [reportForm, setReportForm] = useState({
    site_id: "",
    report_date: todayIso(),
    shift: "day",
    planned_work: "",
    actual_work: "",
    delays: "",
    safety_notes: "",
    cost_exposure: "0",
  });
  const [materialForm, setMaterialForm] = useState({
    site_id: "",
    store_id: "",
    item_id: "",
    quantity: "1",
    unit_cost: "0",
    required_by_date: todayIso(),
    priority: "normal",
    work_package: "",
    justification: "",
  });

  const selectedProjectName = useMemo(() => {
    return text(projects.find((project) => project.id === selectedProjectId)?.name, "Select project");
  }, [projects, selectedProjectId]);

  const openReports = useMemo(() => reports.filter((report) => text(report.status, "draft").toLowerCase() !== "approved"), [reports]);
  const blockedGates = useMemo(() => gateChecks.filter((gate) => text(gate.status).toLowerCase() === "blocked"), [gateChecks]);
  const todaysReports = useMemo(() => reports.filter((report) => String(report.report_date || "").startsWith(todayIso())), [reports]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [projectResult, reportResult, siteResult, itemResult, storeResult, gateResult] = await Promise.allSettled([
        getInternalProjects(),
        getDailySiteReports({ status: "all" }),
        getSiteOperationSites(selectedProjectId || undefined),
        getSiteOperationInventoryItems(),
        getSiteOperationStores(selectedProjectId ? { projectId: selectedProjectId } : undefined),
        getComplianceDeploymentGateChecks({ status: "blocked", project_id: selectedProjectId || undefined, limit: 25 }),
      ]);

      const nextWarnings: string[] = [];
      if (projectResult.status === "fulfilled") setProjects(Array.isArray(projectResult.value.data) ? projectResult.value.data : []);
      else nextWarnings.push("Project register could not be loaded.");
      if (reportResult.status === "fulfilled") setReports(Array.isArray(reportResult.value.data) ? reportResult.value.data : []);
      else nextWarnings.push("Daily site reports could not be loaded.");
      if (siteResult.status === "fulfilled") setSites(Array.isArray(siteResult.value.data) ? siteResult.value.data : []);
      else nextWarnings.push("Site register could not be loaded.");
      if (itemResult.status === "fulfilled") setItems(Array.isArray(itemResult.value.data) ? itemResult.value.data : []);
      else nextWarnings.push("Inventory catalogue could not be loaded.");
      if (storeResult.status === "fulfilled") setStores(Array.isArray(storeResult.value.data) ? storeResult.value.data : []);
      else nextWarnings.push("Store register could not be loaded.");
      if (gateResult.status === "fulfilled") setGateChecks(Array.isArray(gateResult.value.data) ? gateResult.value.data : []);
      else nextWarnings.push("Compliance gate checks could not be loaded.");
      setWarnings(nextWarnings);
      if (reportResult.status === "rejected" || projectResult.status === "rejected") {
        setError("Foreman portal data could not be loaded.");
      }
    } finally {
      setLoading(false);
    }
  }, [selectedProjectId]);

  useEffect(() => {
    void load();
  }, [load]);

  function patchReport(key: keyof typeof reportForm, value: string) {
    setReportForm((current) => ({ ...current, [key]: value }));
  }

  function patchMaterial(key: keyof typeof materialForm, value: string) {
    setMaterialForm((current) => ({ ...current, [key]: value }));
  }

  async function createReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    setError(null);
    if (!selectedProjectId) {
      setError("Select a project before creating a daily report.");
      return;
    }
    if (!reportForm.actual_work.trim() && !reportForm.planned_work.trim()) {
      setError("Record planned or actual work before creating a report.");
      return;
    }

    setSaving("report");
    try {
      await createDailySiteReport({
        project_id: selectedProjectId,
        site_id: reportForm.site_id || null,
        report_date: reportForm.report_date,
        shift: reportForm.shift,
        weather: {},
        planned_work: reportForm.planned_work || null,
        actual_work: reportForm.actual_work || null,
        delays: reportForm.delays || null,
        safety_notes: reportForm.safety_notes || null,
        cost_exposure: numberValue(reportForm.cost_exposure),
      });
      setNotice("Daily site report created from foreman portal.");
      setReportForm((current) => ({ ...current, actual_work: "", delays: "", safety_notes: "", cost_exposure: "0" }));
      await load();
    } catch (createError) {
      setError(actionMessage(createError, "Daily site report could not be created."));
    } finally {
      setSaving(null);
    }
  }

  async function createMaterialRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    setError(null);
    if (!selectedProjectId || !materialForm.item_id) {
      setError("Select a project and material item before requesting stock.");
      return;
    }
    if (numberValue(materialForm.quantity) <= 0) {
      setError("Material quantity must be greater than zero.");
      return;
    }

    setSaving("material");
    try {
      const response = await requestSiteMaterial({
        project_id: selectedProjectId,
        site_id: materialForm.site_id || null,
        store_id: materialForm.store_id || null,
        item_id: materialForm.item_id,
        quantity: numberValue(materialForm.quantity),
        unit_cost: numberValue(materialForm.unit_cost),
        required_by_date: materialForm.required_by_date,
        priority: materialForm.priority,
        work_package: materialForm.work_package || null,
        justification: materialForm.justification || null,
        auto_submit_requisition: true,
      });
      const requestNumber = response.data?.request_number ? ` ${response.data.request_number}` : "";
      setNotice(`Material request${requestNumber} recorded.`);
      setMaterialForm((current) => ({ ...current, item_id: "", quantity: "1", justification: "" }));
      await load();
    } catch (requestError) {
      setError(actionMessage(requestError, "Material request could not be recorded."));
    } finally {
      setSaving(null);
    }
  }

  async function submitReport(reportId: string) {
    setNotice(null);
    setError(null);
    setSaving(reportId);
    try {
      await submitDailySiteReport(reportId);
      setNotice("Daily report submitted for approval.");
      await load();
    } catch (submitError) {
      setError(actionMessage(submitError, "Daily report could not be submitted."));
    } finally {
      setSaving(null);
    }
  }

  return (
    <main className="min-h-screen bg-ink text-paper">
      <section className="border-b border-ink-mid bg-ink-light">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-signal">AEGIS field operations</p>
            <h1 className="mt-2 font-display text-3xl sm:text-4xl">Foreman Portal</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-light">
              Capture daily progress, request materials, and watch compliance blocks from one site-first workspace.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex h-10 items-center justify-center gap-2 border border-ink-mid px-4 font-mono text-xs uppercase tracking-widest text-paper hover:border-signal disabled:opacity-60"
            disabled={loading}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Refresh
          </button>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {error && (
          <div className="mb-4 flex gap-3 border border-red-500/30 bg-red-950/30 p-4 text-sm text-red-200">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {notice && (
          <div className="mb-4 flex gap-3 border border-emerald-500/30 bg-emerald-950/20 p-4 text-sm text-emerald-200">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
            <span>{notice}</span>
          </div>
        )}
        {warnings.length > 0 && (
          <div className="mb-4 grid gap-2 md:grid-cols-2">
            {warnings.map((warning) => (
              <p key={warning} className="border border-amber-500/30 bg-amber-950/20 px-3 py-2 text-xs text-amber-100">
                {warning}
              </p>
            ))}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="border border-ink-mid bg-ink-light p-4">
            <p className="font-mono text-[10px] uppercase tracking-widest text-slate-light">Project</p>
            <p className="mt-2 truncate text-lg font-semibold">{selectedProjectName}</p>
          </div>
          <div className="border border-ink-mid bg-ink-light p-4">
            <p className="font-mono text-[10px] uppercase tracking-widest text-slate-light">Open Reports</p>
            <p className="mt-2 text-2xl font-semibold">{openReports.length}</p>
          </div>
          <div className="border border-ink-mid bg-ink-light p-4">
            <p className="font-mono text-[10px] uppercase tracking-widest text-slate-light">Today</p>
            <p className="mt-2 text-2xl font-semibold">{todaysReports.length}</p>
          </div>
          <div className="border border-ink-mid bg-ink-light p-4">
            <p className="font-mono text-[10px] uppercase tracking-widest text-slate-light">Blocked Gates</p>
            <p className={`mt-2 text-2xl font-semibold ${blockedGates.length ? "text-red-300" : "text-emerald-300"}`}>{blockedGates.length}</p>
          </div>
        </div>

        <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_420px]">
          <div className="space-y-6">
            <div className="border border-ink-mid bg-ink-light p-4">
              <label className="block">
                <FieldLabel>Active project</FieldLabel>
                <select
                  value={selectedProjectId}
                  onChange={(event) => {
                    setSelectedProjectId(event.target.value);
                    setReportForm((current) => ({ ...current, site_id: "" }));
                    setMaterialForm((current) => ({ ...current, site_id: "", store_id: "" }));
                  }}
                  className="mt-2 h-11 w-full border border-ink-mid bg-ink px-3 text-sm text-paper outline-none focus:border-signal"
                >
                  <option value="">All projects</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>{text(project.name)}</option>
                  ))}
                </select>
              </label>
            </div>

            <form onSubmit={createReport} className="border border-ink-mid bg-ink-light">
              <div className="flex items-center justify-between border-b border-ink-mid p-4">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-widest text-signal">Daily report</p>
                  <h2 className="mt-1 text-xl font-semibold">Create field report</h2>
                </div>
                <ClipboardCheck className="h-5 w-5 text-slate-light" />
              </div>
              <div className="grid gap-4 p-4 md:grid-cols-2">
                <label className="block">
                  <FieldLabel>Site</FieldLabel>
                  <select value={reportForm.site_id} onChange={(event) => patchReport("site_id", event.target.value)} className="mt-2 h-10 w-full border border-ink-mid bg-ink px-3 text-sm text-paper outline-none focus:border-signal">
                    <option value="">No specific site</option>
                    {sites.map((site) => <option key={site.id} value={site.id}>{text(site.name)}</option>)}
                  </select>
                </label>
                <label className="block">
                  <FieldLabel>Date</FieldLabel>
                  <input type="date" value={reportForm.report_date} onChange={(event) => patchReport("report_date", event.target.value)} className="mt-2 h-10 w-full border border-ink-mid bg-ink px-3 text-sm text-paper outline-none focus:border-signal" />
                </label>
                <label className="block">
                  <FieldLabel>Shift</FieldLabel>
                  <select value={reportForm.shift} onChange={(event) => patchReport("shift", event.target.value)} className="mt-2 h-10 w-full border border-ink-mid bg-ink px-3 text-sm text-paper outline-none focus:border-signal">
                    <option value="day">Day</option>
                    <option value="night">Night</option>
                    <option value="double">Double</option>
                  </select>
                </label>
                <label className="block">
                  <FieldLabel>Cost Exposure</FieldLabel>
                  <input type="number" min="0" value={reportForm.cost_exposure} onChange={(event) => patchReport("cost_exposure", event.target.value)} className="mt-2 h-10 w-full border border-ink-mid bg-ink px-3 text-sm text-paper outline-none focus:border-signal" />
                </label>
                <label className="block md:col-span-2">
                  <FieldLabel>Planned work</FieldLabel>
                  <textarea rows={3} value={reportForm.planned_work} onChange={(event) => patchReport("planned_work", event.target.value)} className="mt-2 w-full resize-none border border-ink-mid bg-ink p-3 text-sm text-paper outline-none focus:border-signal" />
                </label>
                <label className="block md:col-span-2">
                  <FieldLabel>Actual work</FieldLabel>
                  <textarea rows={4} value={reportForm.actual_work} onChange={(event) => patchReport("actual_work", event.target.value)} className="mt-2 w-full resize-none border border-ink-mid bg-ink p-3 text-sm text-paper outline-none focus:border-signal" />
                </label>
                <label className="block">
                  <FieldLabel>Delays</FieldLabel>
                  <textarea rows={3} value={reportForm.delays} onChange={(event) => patchReport("delays", event.target.value)} className="mt-2 w-full resize-none border border-ink-mid bg-ink p-3 text-sm text-paper outline-none focus:border-signal" />
                </label>
                <label className="block">
                  <FieldLabel>Safety notes</FieldLabel>
                  <textarea rows={3} value={reportForm.safety_notes} onChange={(event) => patchReport("safety_notes", event.target.value)} className="mt-2 w-full resize-none border border-ink-mid bg-ink p-3 text-sm text-paper outline-none focus:border-signal" />
                </label>
              </div>
              <div className="border-t border-ink-mid p-4">
                <button type="submit" disabled={saving === "report" || !selectedProjectId} className="inline-flex h-10 items-center justify-center gap-2 bg-signal px-4 font-mono text-xs uppercase tracking-widest text-ink disabled:opacity-50">
                  {saving === "report" ? <Loader2 className="h-4 w-4 animate-spin" /> : <HardHat className="h-4 w-4" />}
                  Create report
                </button>
              </div>
            </form>

            <div className="border border-ink-mid bg-ink-light">
              <div className="flex items-center justify-between border-b border-ink-mid p-4">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-widest text-signal">Report queue</p>
                  <h2 className="mt-1 text-xl font-semibold">Open daily reports</h2>
                </div>
                <Send className="h-5 w-5 text-slate-light" />
              </div>
              {loading ? (
                <div className="flex h-32 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-signal" /></div>
              ) : openReports.length === 0 ? (
                <p className="p-6 text-sm text-slate-light">No draft or submitted daily reports are waiting on this view.</p>
              ) : (
                <div className="divide-y divide-ink-mid">
                  {openReports.slice(0, 10).map((report) => (
                    <article key={report.id} className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`border px-2 py-1 font-mono text-[10px] uppercase ${statusTone(report.status)}`}>{text(report.status, "draft")}</span>
                          <span className="font-mono text-[10px] uppercase text-slate-light">{dateLabel(report.report_date)}</span>
                        </div>
                        <h3 className="mt-2 font-semibold">{text(report.project_name ?? report.project_id, "Project")}</h3>
                        <p className="mt-1 max-w-2xl text-sm text-slate-light">{text(report.actual_work ?? report.planned_work, "No work narrative recorded.")}</p>
                      </div>
                      <button type="button" disabled={saving === report.id || text(report.status).toLowerCase() !== "draft"} onClick={() => void submitReport(report.id)} className="inline-flex h-10 shrink-0 items-center justify-center gap-2 border border-ink-mid px-4 font-mono text-xs uppercase tracking-widest hover:border-signal disabled:opacity-50">
                        {saving === report.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        Submit
                      </button>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </div>

          <aside className="space-y-6">
            <form onSubmit={createMaterialRequest} className="border border-ink-mid bg-ink-light">
              <div className="flex items-center justify-between border-b border-ink-mid p-4">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-widest text-signal">Materials</p>
                  <h2 className="mt-1 text-xl font-semibold">Request stock</h2>
                </div>
                <PackagePlus className="h-5 w-5 text-slate-light" />
              </div>
              <div className="space-y-4 p-4">
                <label className="block">
                  <FieldLabel>Material item</FieldLabel>
                  <select value={materialForm.item_id} onChange={(event) => patchMaterial("item_id", event.target.value)} className="mt-2 h-10 w-full border border-ink-mid bg-ink px-3 text-sm text-paper outline-none focus:border-signal">
                    <option value="">Select item</option>
                    {items.map((item) => <option key={item.id} value={item.id}>{text(item.item_name ?? item.name ?? item.item_code)}</option>)}
                  </select>
                </label>
                <label className="block">
                  <FieldLabel>Site</FieldLabel>
                  <select value={materialForm.site_id} onChange={(event) => patchMaterial("site_id", event.target.value)} className="mt-2 h-10 w-full border border-ink-mid bg-ink px-3 text-sm text-paper outline-none focus:border-signal">
                    <option value="">No specific site</option>
                    {sites.map((site) => <option key={site.id} value={site.id}>{text(site.name)}</option>)}
                  </select>
                </label>
                <label className="block">
                  <FieldLabel>Store</FieldLabel>
                  <select value={materialForm.store_id} onChange={(event) => patchMaterial("store_id", event.target.value)} className="mt-2 h-10 w-full border border-ink-mid bg-ink px-3 text-sm text-paper outline-none focus:border-signal">
                    <option value="">Auto route</option>
                    {stores.map((store) => <option key={store.id} value={store.id}>{text(store.name ?? store.store_code)}</option>)}
                  </select>
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <FieldLabel>Quantity</FieldLabel>
                    <input type="number" min="0.001" step="0.001" value={materialForm.quantity} onChange={(event) => patchMaterial("quantity", event.target.value)} className="mt-2 h-10 w-full border border-ink-mid bg-ink px-3 text-sm text-paper outline-none focus:border-signal" />
                  </label>
                  <label className="block">
                    <FieldLabel>Unit cost</FieldLabel>
                    <input type="number" min="0" step="0.01" value={materialForm.unit_cost} onChange={(event) => patchMaterial("unit_cost", event.target.value)} className="mt-2 h-10 w-full border border-ink-mid bg-ink px-3 text-sm text-paper outline-none focus:border-signal" />
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <FieldLabel>Required by</FieldLabel>
                    <input type="date" value={materialForm.required_by_date} onChange={(event) => patchMaterial("required_by_date", event.target.value)} className="mt-2 h-10 w-full border border-ink-mid bg-ink px-3 text-sm text-paper outline-none focus:border-signal" />
                  </label>
                  <label className="block">
                    <FieldLabel>Priority</FieldLabel>
                    <select value={materialForm.priority} onChange={(event) => patchMaterial("priority", event.target.value)} className="mt-2 h-10 w-full border border-ink-mid bg-ink px-3 text-sm text-paper outline-none focus:border-signal">
                      <option value="low">Low</option>
                      <option value="normal">Normal</option>
                      <option value="urgent">Urgent</option>
                      <option value="emergency">Emergency</option>
                    </select>
                  </label>
                </div>
                <label className="block">
                  <FieldLabel>Work package</FieldLabel>
                  <input value={materialForm.work_package} onChange={(event) => patchMaterial("work_package", event.target.value)} className="mt-2 h-10 w-full border border-ink-mid bg-ink px-3 text-sm text-paper outline-none focus:border-signal" />
                </label>
                <label className="block">
                  <FieldLabel>Justification</FieldLabel>
                  <textarea rows={4} value={materialForm.justification} onChange={(event) => patchMaterial("justification", event.target.value)} className="mt-2 w-full resize-none border border-ink-mid bg-ink p-3 text-sm text-paper outline-none focus:border-signal" />
                </label>
                <button type="submit" disabled={saving === "material" || !selectedProjectId || !materialForm.item_id} className="inline-flex h-10 w-full items-center justify-center gap-2 bg-signal px-4 font-mono text-xs uppercase tracking-widest text-ink disabled:opacity-50">
                  {saving === "material" ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackagePlus className="h-4 w-4" />}
                  Request material
                </button>
              </div>
            </form>

            <div className="border border-ink-mid bg-ink-light">
              <div className="flex items-center justify-between border-b border-ink-mid p-4">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-widest text-signal">Compliance</p>
                  <h2 className="mt-1 text-xl font-semibold">Blocked deployment gates</h2>
                </div>
                {blockedGates.length ? <ShieldAlert className="h-5 w-5 text-red-300" /> : <ShieldCheck className="h-5 w-5 text-emerald-300" />}
              </div>
              {blockedGates.length === 0 ? (
                <p className="p-4 text-sm text-slate-light">No blocked deployment gates returned for this view.</p>
              ) : (
                <div className="divide-y divide-ink-mid">
                  {blockedGates.slice(0, 8).map((gate) => (
                    <article key={gate.id} className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold">{text(gate.gate_type, "Deployment gate").replaceAll("_", " ")}</p>
                          <p className="mt-1 text-xs text-slate-light">{text(gate.employee_name ?? gate.asset_name ?? gate.project_name, "Linked source not recorded")}</p>
                        </div>
                        <span className="border border-red-500/40 bg-red-950/20 px-2 py-1 font-mono text-[10px] uppercase text-red-300">Blocked</span>
                      </div>
                      <p className="mt-3 text-xs text-slate-light">{text(gate.missing_evidence ?? gate.reason, "Missing credential evidence is not recorded in the response.")}</p>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}
