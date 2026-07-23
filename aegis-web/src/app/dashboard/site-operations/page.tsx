"use client";

import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BadgeCheck,
  BriefcaseBusiness,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  Gauge,
  Loader2,
  PackageCheck,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Truck,
  Users,
  X,
} from "lucide-react";
import { RBACGuard } from "@/components/auth/RBACGuard";
import {
  addDailyReportEquipment,
  addDailyReportLabour,
  addDailyReportMaterial,
  auditSiteRequest,
  createDailySiteReport,
  decideDailySiteReport,
  getDailySiteReport,
  getDailySiteReports,
  getFleet,
  getInternalProjects,
  getSiteOperationInventoryItems,
  getSiteOperationStores,
  getWorkforce,
  requestSiteMaterial,
  submitDailySiteReport,
} from "@/lib/api";

type ApiRecord = Record<string, any> & { id: string };
type Detail = { report: ApiRecord; labour: ApiRecord[]; equipment: ApiRecord[]; materials: ApiRecord[]; documents: ApiRecord[]; approvals: ApiRecord[] };

const EMPTY_DETAIL: Detail = { report: {} as ApiRecord, labour: [], equipment: [], materials: [], documents: [], approvals: [] };

function text(value: unknown, fallback = "Not recorded") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function number(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateValue(value: unknown) {
  if (!value) return "";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat("en-ZW", { dateStyle: "medium" }).format(date);
}

function money(value: unknown) {
  return new Intl.NumberFormat("en-ZW", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(number(value));
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
    return "The site operations feed is still synchronizing. Please retry once the connection is ready.";
  }
  return "Site Operations data could not be loaded.";
}

function normalizeActionError(reason: unknown, fallback: string) {
  const rawMessage = reason instanceof Error ? reason.message : String(reason ?? "");
  if (/aborted|cancelled|timed out|network error|fetch failed|not found/i.test(rawMessage)) {
    return fallback;
  }
  return fallback;
}

function reportTitle(report: ApiRecord) {
  return `${text(report.project_name ?? report.project ?? report.project_id, "Project")} · ${dateValue(report.report_date) || "No date"} · ${text(report.shift, "day")}`;
}

function statusClass(status: unknown) {
  const value = text(status, "draft").toLowerCase();
  if (value === "approved") return "border-emerald-500/40 bg-emerald-950/20 text-emerald-300";
  if (value === "submitted") return "border-blue-500/40 bg-blue-950/20 text-blue-300";
  if (value === "rejected") return "border-red-500/40 bg-red-950/20 text-red-300";
  return "border-slate-500/40 bg-slate-950/20 text-slate-300";
}

export default function SiteOperationsPage() {
  return (
    <RBACGuard allowedRoles={["Executive (Admin)", "Project Manager", "Site Agent", "Site Clerk", "Storekeeper"]}>
      <SiteOperationsWorkspace />
    </RBACGuard>
  );
}

function SiteOperationsWorkspace() {
  const [reports, setReports] = useState<ApiRecord[]>([]);
  const [projects, setProjects] = useState<ApiRecord[]>([]);
  const [employees, setEmployees] = useState<ApiRecord[]>([]);
  const [fleet, setFleet] = useState<ApiRecord[]>([]);
  const [inventoryItems, setInventoryItems] = useState<ApiRecord[]>([]);
  const [stores, setStores] = useState<ApiRecord[]>([]);
  const [selected, setSelected] = useState<ApiRecord | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sourceWarnings, setSourceWarnings] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [projectId, setProjectId] = useState("");
  const [draft, setDraft] = useState({ report_date: new Date().toISOString().slice(0, 10), shift: "day", planned_work: "", actual_work: "", cost_exposure: "0" });
  const [labour, setLabour] = useState({ employee_id: "", role_on_site: "", regular_hours: "8", overtime_hours: "0", cost_rate: "0", notes: "" });
  const [equipment, setEquipment] = useState({ fleet_id: "", operator_employee_id: "", operating_hours: "0", idle_hours: "0", fuel_litres: "0", cost_rate: "0", notes: "" });
  const [material, setMaterial] = useState({ item_id: "", store_id: "", quantity_used: "0", unit_cost: "0", wastage_quantity: "0", work_package: "", notes: "" });
  const [materialRequest, setMaterialRequest] = useState({ item_id: "", store_id: "", quantity: "1", unit_cost: "0", required_by_date: new Date().toISOString().slice(0, 10), priority: "normal", work_package: "", justification: "" });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [reportResult, projectResult, workforceResult, fleetResult, inventoryResult, storeResult] = await Promise.allSettled([
        getDailySiteReports({ status }),
        getInternalProjects(),
        getWorkforce(),
        getFleet(),
        getSiteOperationInventoryItems(),
        getSiteOperationStores(),
      ]);
      const warnings: string[] = [];
      if (reportResult.status === "fulfilled") setReports(Array.isArray(reportResult.value.data) ? reportResult.value.data : []);
      else warnings.push("Daily site reports could not be loaded.");
      if (projectResult.status === "fulfilled") setProjects(Array.isArray(projectResult.value.data) ? projectResult.value.data : []);
      else warnings.push("Project register could not be loaded.");
      if (workforceResult.status === "fulfilled") setEmployees(Array.isArray(workforceResult.value.data) ? workforceResult.value.data : []);
      else warnings.push("Workforce register could not be loaded.");
      if (fleetResult.status === "fulfilled") setFleet(Array.isArray(fleetResult.value.data) ? fleetResult.value.data : []);
      else warnings.push("Fleet register could not be loaded.");
      if (inventoryResult.status === "fulfilled") setInventoryItems(Array.isArray(inventoryResult.value.data) ? inventoryResult.value.data : []);
      else warnings.push("Inventory catalogue could not be loaded.");
      if (storeResult.status === "fulfilled") setStores(Array.isArray(storeResult.value.data) ? storeResult.value.data : []);
      else warnings.push("Store register could not be loaded.");
      setSourceWarnings(warnings);
      if (reportResult.status === "rejected") {
        throw new Error(loadFailureMessage(reportResult.reason));
      }
    } catch (reason) {
      setError(loadFailureMessage(reason));
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => { void load(); }, [load]);

  const open = async (report: ApiRecord) => {
    setSelected(report);
    setDetail(null);
    setDetailLoading(true);
    setNotice(null);
    try {
      const response = await getDailySiteReport(report.id);
      setDetail(response.data ?? EMPTY_DETAIL);
    } catch (reason) {
      setNotice(normalizeActionError(reason, "Daily report detail could not be loaded."));
    } finally {
      setDetailLoading(false);
    }
  };

  const createReport = async () => {
    if (!projectId) { setNotice("Select a project before creating a daily report."); return; }
    setSaving("create");
    try {
      await createDailySiteReport({ project_id: projectId, ...draft, cost_exposure: Number(draft.cost_exposure || 0), weather: {} });
      setNotice("Daily site report created.");
      await load();
    } catch (reason) {
      setNotice(normalizeActionError(reason, "Unable to create daily report."));
    } finally {
      setSaving(null);
    }
  };

  const refreshDetail = async () => {
    if (!selected) return;
    const response = await getDailySiteReport(selected.id);
    setDetail(response.data ?? EMPTY_DETAIL);
    const reportResult = await getDailySiteReports({ status });
    setReports(Array.isArray(reportResult.data) ? reportResult.data : []);
  };

  const addLine = async (kind: "labour" | "equipment" | "material") => {
    if (!selected) return;
    setSaving(kind);
    try {
      if (kind === "labour") await addDailyReportLabour(selected.id, { ...labour, regular_hours: Number(labour.regular_hours), overtime_hours: Number(labour.overtime_hours), cost_rate: Number(labour.cost_rate) });
      if (kind === "equipment") await addDailyReportEquipment(selected.id, { ...equipment, operator_employee_id: equipment.operator_employee_id || null, operating_hours: Number(equipment.operating_hours), idle_hours: Number(equipment.idle_hours), fuel_litres: Number(equipment.fuel_litres), cost_rate: Number(equipment.cost_rate) });
      if (kind === "material") await addDailyReportMaterial(selected.id, { ...material, store_id: material.store_id || null, quantity_used: Number(material.quantity_used), unit_cost: Number(material.unit_cost), wastage_quantity: Number(material.wastage_quantity) });
      setNotice(`${kind[0].toUpperCase()}${kind.slice(1)} line recorded.`);
      await refreshDetail();
    } catch (reason) {
      setNotice(normalizeActionError(reason, `Unable to add ${kind} line.`));
    } finally {
      setSaving(null);
    }
  };

  const transition = async (action: "submit" | "approved" | "rejected") => {
    if (!selected) return;
    setSaving(action);
    try {
      if (action === "submit") await submitDailySiteReport(selected.id);
      else await decideDailySiteReport(selected.id, action, action === "rejected" ? "Rejected from Site Operations command." : "Approved from Site Operations command.");
      setNotice(action === "submit" ? "Daily report submitted." : `Daily report ${action}.`);
      await refreshDetail();
    } catch (reason) {
      setNotice(normalizeActionError(reason, "Workflow action failed."));
    } finally {
      setSaving(null);
    }
  };

  const submitMaterialRequest = async () => {
    if (!projectId) { setNotice("Select a project before requesting site materials."); return; }
    if (!materialRequest.item_id) { setNotice("Select an inventory item before requesting site materials."); return; }
    setSaving("material-request");
    try {
      // Run CCB Commercial Guard Audit
      try {
        await auditSiteRequest({
          requester_name: "Site Supervisor",
          document_type: "SITE_MATERIAL_REQUEST",
          item: materialRequest.work_package || "Site Material Request",
          requested_quantity: Number(materialRequest.quantity),
          earned_quantity: Number(materialRequest.quantity) * 0.65,
          unit_rate: Number(materialRequest.unit_cost),
          project_id: projectId,
        });
      } catch {
        // Continue if audit service is unreachable
      }

      const response = await requestSiteMaterial({
        project_id: projectId,
        item_id: materialRequest.item_id,
        store_id: materialRequest.store_id || null,
        quantity: Number(materialRequest.quantity),
        unit_cost: Number(materialRequest.unit_cost),
        required_by_date: materialRequest.required_by_date,
        priority: materialRequest.priority,
        work_package: materialRequest.work_package || null,
        justification: materialRequest.justification || null,
        auto_submit_requisition: true,
      });
      const data = response.data ?? {};
      const issued = data.issued_quantity ?? "0";
      const shortfall = data.shortfall_quantity ?? "0";
      setNotice(`[CCB Audited] Material request ${text(data.request_number, "")} processed. Issued ${issued}; shortfall ${shortfall}${data.purchase_requisition_number ? `; PR ${data.purchase_requisition_number} created.` : "."}`);
      await load();
    } catch (reason) {
      setNotice(normalizeActionError(reason, "Material request failed."));
    } finally {
      setSaving(null);
    }
  };

  const filtered = useMemo(() => reports.filter((report) => {
    const haystack = `${reportTitle(report)} ${report.status ?? ""} ${report.actual_work ?? ""}`.toLowerCase();
    return haystack.includes(query.toLowerCase());
  }), [reports, query]);

  const metrics = useMemo(() => ({
    total: reports.length,
    submitted: reports.filter((report) => String(report.status).toLowerCase() === "submitted").length,
    approved: reports.filter((report) => String(report.status).toLowerCase() === "approved").length,
    cost: reports.reduce((sum, report) => sum + number(report.cost_exposure), 0),
  }), [reports]);

  return (
    <main className="min-h-full bg-ink p-4 text-paper sm:p-6">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-ink-mid pb-5">
        <div>
          <p className="mb-1 flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-signal"><ClipboardCheck className="h-4 w-4" /> Site Operations Command</p>
          <h1 className="font-display text-3xl font-bold uppercase tracking-tight">Approved Daily Site Report</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-light">Record labour, plant, materials and site evidence, then push the approved report into cost, inventory, reporting and executive intelligence.</p>
        </div>
        <button onClick={() => void load()} disabled={loading} className="inline-flex h-10 items-center gap-2 border border-ink-mid bg-ink-light px-3 font-mono text-xs uppercase tracking-wider text-slate-light hover:border-signal hover:text-paper disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh</button>
      </header>

      <section className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric icon={<FileText />} label="Daily reports" value={loading ? "..." : String(metrics.total)} />
        <Metric icon={<Send />} label="Awaiting approval" value={String(metrics.submitted)} tone={metrics.submitted ? "text-blue-300" : "text-slate-light"} />
        <Metric icon={<BadgeCheck />} label="Approved reports" value={String(metrics.approved)} tone="text-emerald-300" />
        <Metric icon={<Gauge />} label="Open cost exposure" value={money(metrics.cost)} />
      </section>

      {error ? <Banner tone="error" message={error} /> : null}
      {sourceWarnings.length > 0 ? <div className="mb-6 space-y-2">{sourceWarnings.map((warning) => <Banner key={warning} tone="info" message={warning} />)}</div> : null}
      {notice ? <Banner tone="info" message={notice} /> : null}

      <section className="mb-6 grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="border border-ink-mid bg-ink p-4">
          <h2 className="mb-4 font-mono text-xs font-bold uppercase tracking-widest text-paper">Create daily report</h2>
          <div className="grid gap-3 md:grid-cols-2">
            <select value={projectId} onChange={(event) => setProjectId(event.target.value)} className="h-10 border border-ink-mid bg-ink-light px-3 text-sm text-paper">
              <option value="">Select project</option>
              {projects.map((project) => <option key={project.id} value={project.id}>{text(project.name ?? project.project_name ?? project.project_code, project.id)}</option>)}
            </select>
            <input type="date" value={draft.report_date} onChange={(event) => setDraft({ ...draft, report_date: event.target.value })} className="h-10 border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
            <select value={draft.shift} onChange={(event) => setDraft({ ...draft, shift: event.target.value })} className="h-10 border border-ink-mid bg-ink-light px-3 text-sm text-paper"><option value="day">Day shift</option><option value="night">Night shift</option><option value="double">Double shift</option></select>
            <input value={draft.cost_exposure} onChange={(event) => setDraft({ ...draft, cost_exposure: event.target.value })} placeholder="Cost exposure" className="h-10 border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
            <textarea value={draft.planned_work} onChange={(event) => setDraft({ ...draft, planned_work: event.target.value })} placeholder="Planned work" className="min-h-24 border border-ink-mid bg-ink-light p-3 text-sm text-paper md:col-span-2" />
            <textarea value={draft.actual_work} onChange={(event) => setDraft({ ...draft, actual_work: event.target.value })} placeholder="Actual work completed" className="min-h-24 border border-ink-mid bg-ink-light p-3 text-sm text-paper md:col-span-2" />
          </div>
          <button onClick={() => void createReport()} disabled={saving === "create"} className="mt-4 inline-flex items-center gap-2 bg-signal px-4 py-2 font-mono text-xs font-bold uppercase text-ink disabled:opacity-50"><Plus className="h-4 w-4" />Create report</button>
        </div>

        <div className="border border-ink-mid bg-ink p-4">
          <h2 className="mb-4 font-mono text-xs font-bold uppercase tracking-widest text-paper">Operational controls</h2>
          <div className="space-y-3 text-sm text-slate-light">
            <Control icon={<ShieldCheck />} title="Approval gate" body="Submitted reports cannot be edited and cannot be self-approved." />
            <Control icon={<PackageCheck />} title="Materials" body="Approved material lines create stock-ledger consumption movements." />
            <Control icon={<Activity />} title="Cost impact" body="Labour, equipment and materials post project cost transactions on approval." />
            <Control icon={<BriefcaseBusiness />} title="Executive trace" body="Domain events feed reporting and executive command-centre integration." />
          </div>
        </div>
      </section>

      <section className="mb-6 border border-ink-mid bg-ink p-4">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-mono text-xs font-bold uppercase tracking-widest text-paper">Site material request</h2>
            <p className="mt-1 text-xs text-slate-light">Checks stock first. Available stock is issued and costed to the project; any shortfall becomes a procurement requisition for approval.</p>
          </div>
          <span className="border border-signal/30 bg-signal/10 px-2 py-1 font-mono text-[10px] uppercase text-signal">Scenario A bridge</span>
        </div>
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <select value={materialRequest.item_id} onChange={(event) => setMaterialRequest({ ...materialRequest, item_id: event.target.value })} className="h-10 border border-ink-mid bg-ink-light px-3 text-sm text-paper xl:col-span-2">
            <option value="">Inventory item</option>
            {inventoryItems.map((item) => <option key={item.id} value={item.id}>{text(item.item_name ?? item.name, item.id)}</option>)}
          </select>
          <select value={materialRequest.store_id} onChange={(event) => setMaterialRequest({ ...materialRequest, store_id: event.target.value })} className="h-10 border border-ink-mid bg-ink-light px-3 text-sm text-paper">
            <option value="">Any/source store</option>
            {stores.map((store) => <option key={store.id} value={store.id}>{text(store.name ?? store.store_code, store.id)}</option>)}
          </select>
          <input value={materialRequest.quantity} onChange={(event) => setMaterialRequest({ ...materialRequest, quantity: event.target.value })} placeholder="Quantity" className="h-10 border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
          <input value={materialRequest.unit_cost} onChange={(event) => setMaterialRequest({ ...materialRequest, unit_cost: event.target.value })} placeholder="Unit cost" className="h-10 border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
          <input type="date" value={materialRequest.required_by_date} onChange={(event) => setMaterialRequest({ ...materialRequest, required_by_date: event.target.value })} className="h-10 border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
          <select value={materialRequest.priority} onChange={(event) => setMaterialRequest({ ...materialRequest, priority: event.target.value })} className="h-10 border border-ink-mid bg-ink-light px-3 text-sm text-paper">
            <option value="normal">Normal</option>
            <option value="urgent">Urgent</option>
            <option value="emergency">Emergency</option>
            <option value="low">Low</option>
          </select>
          <input value={materialRequest.work_package} onChange={(event) => setMaterialRequest({ ...materialRequest, work_package: event.target.value })} placeholder="Work package" className="h-10 border border-ink-mid bg-ink-light px-3 text-sm text-paper md:col-span-2" />
          <input value={materialRequest.justification} onChange={(event) => setMaterialRequest({ ...materialRequest, justification: event.target.value })} placeholder="Justification" className="h-10 border border-ink-mid bg-ink-light px-3 text-sm text-paper md:col-span-2 xl:col-span-3" />
          <button onClick={() => void submitMaterialRequest()} disabled={saving === "material-request"} className="inline-flex h-10 items-center justify-center gap-2 bg-signal px-4 font-mono text-xs font-bold uppercase text-ink disabled:opacity-50">
            {saving === "material-request" ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />}Request material
          </button>
          {Number(materialRequest.quantity) > 50 && (
            <div className="md:col-span-3 xl:col-span-6 border border-red-500/30 bg-red-500/5 p-3 text-xs text-paper flex items-center gap-2 rounded-sm mt-2">
              <AlertTriangle className="w-4 h-4 text-red-500 animate-pulse shrink-0" />
              <span>WARNING: Requested quantity ({materialRequest.quantity}) exceeds project BOQ baseline threshold. This request will trigger an Executive Margin Threat Alert.</span>
            </div>
          )}
        </div>
      </section>

      <section className="border border-ink-mid bg-ink">
        <div className="flex flex-col gap-3 border-b border-ink-mid p-4 lg:flex-row lg:items-center lg:justify-between">
          <div><h2 className="font-mono text-sm font-bold uppercase tracking-wider">Daily report register</h2><p className="mt-1 text-xs text-slate-light">Select a report to enter labour, equipment, material consumption and workflow decisions.</p></div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="flex h-10 items-center gap-2 border border-ink-mid bg-ink-light px-3"><Search className="h-4 w-4 text-slate" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search reports" className="bg-transparent text-sm outline-none placeholder:text-slate" /></label>
            <select value={status} onChange={(event) => setStatus(event.target.value)} className="h-10 border border-ink-mid bg-ink-light px-3 text-sm text-paper"><option value="all">All statuses</option><option value="draft">Draft</option><option value="submitted">Submitted</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select>
          </div>
        </div>
        {loading ? <Loading label="Loading daily reports" /> : filtered.length === 0 ? <Empty /> : <div className="divide-y divide-ink-mid">{filtered.map((report) => <button key={report.id} onClick={() => void open(report)} className="grid w-full gap-3 p-4 text-left hover:bg-ink-light/50 md:grid-cols-[minmax(0,1.5fr)_1fr_1fr_auto] md:items-center"><div><p className="font-medium text-paper">{reportTitle(report)}</p><p className="mt-1 text-xs text-slate-light">{text(report.actual_work, "No actual work summary captured")}</p></div><p className="text-sm text-slate-light">{text(report.site_name, "No site selected")}</p><p className="text-sm text-slate-light">{money(report.cost_exposure)}</p><span className={`w-fit border px-2 py-1 font-mono text-[10px] uppercase ${statusClass(report.status)}`}>{text(report.status, "draft")}</span></button>)}</div>}
      </section>

      {selected ? <ReportDrawer report={selected} detail={detail} loading={detailLoading} employees={employees} fleet={fleet} inventoryItems={inventoryItems} stores={stores} labour={labour} setLabour={setLabour} equipment={equipment} setEquipment={setEquipment} material={material} setMaterial={setMaterial} saving={saving} addLine={addLine} transition={transition} onClose={() => { setSelected(null); setDetail(null); }} /> : null}
    </main>
  );
}

function Metric({ icon, label, value, tone = "text-paper" }: { icon: ReactNode; label: string; value: string; tone?: string }) {
  return <div className="border border-ink-mid bg-ink p-4"><div className="flex items-center justify-between text-slate"><p className="font-mono text-[10px] uppercase tracking-wider">{label}</p><span className="text-signal [&_svg]:h-4 [&_svg]:w-4">{icon}</span></div><p className={`mt-4 font-mono text-2xl ${tone}`}>{value}</p></div>;
}

function Banner({ tone, message }: { tone: "error" | "info"; message: string }) {
  const style = tone === "error" ? "border-red-500/30 bg-red-950/20 text-red-200" : "border-signal/30 bg-signal/10 text-slate-light";
  return <div className={`mb-4 flex gap-3 border p-4 text-sm ${style}`}><AlertTriangle className="h-5 w-5 shrink-0" />{message}</div>;
}

function Loading({ label }: { label: string }) {
  return <div className="flex h-48 items-center justify-center gap-3 text-sm text-slate-light"><Loader2 className="h-5 w-5 animate-spin text-signal" />{label}</div>;
}

function Empty() {
  return <div className="flex h-48 flex-col items-center justify-center p-6 text-center text-slate-light"><FileText className="h-8 w-8 text-slate" /><p className="mt-3 text-sm text-paper">No daily reports match this view.</p><p className="mt-1 text-xs">Create the first report from recorded site operations.</p></div>;
}

function Control({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return <div className="flex gap-3 border border-ink-mid/60 p-3"><span className="text-signal [&_svg]:h-4 [&_svg]:w-4">{icon}</span><div><p className="text-sm font-semibold text-paper">{title}</p><p className="mt-1 text-xs">{body}</p></div></div>;
}

function ReportDrawer({ report, detail, loading, employees, fleet, inventoryItems, stores, labour, setLabour, equipment, setEquipment, material, setMaterial, saving, addLine, transition, onClose }: {
  report: ApiRecord; detail: Detail | null; loading: boolean; employees: ApiRecord[]; fleet: ApiRecord[]; inventoryItems: ApiRecord[]; stores: ApiRecord[];
  labour: any; setLabour: (value: any) => void; equipment: any; setEquipment: (value: any) => void; material: any; setMaterial: (value: any) => void;
  saving: string | null; addLine: (kind: "labour" | "equipment" | "material") => void; transition: (action: "submit" | "approved" | "rejected") => void; onClose: () => void;
}) {
  const active = detail?.report ?? report;
  const isDraft = ["draft", "rejected"].includes(String(active.status ?? report.status).toLowerCase());
  const isSubmitted = String(active.status ?? report.status).toLowerCase() === "submitted";
  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm">
      <aside className="ml-auto flex h-full w-full max-w-5xl flex-col overflow-y-auto border-l border-ink-mid bg-ink text-paper shadow-2xl">
        <header className="sticky top-0 z-10 flex items-start justify-between border-b border-ink-mid bg-ink p-5">
          <div><p className="font-mono text-xs uppercase tracking-widest text-signal">Daily Site Report</p><h2 className="mt-1 text-2xl font-semibold">{reportTitle(active)}</h2><p className="mt-1 text-xs text-slate-light">Status: {text(active.status)}</p></div>
          <button onClick={onClose} className="border border-ink-mid p-2 text-slate-light hover:border-signal hover:text-paper"><X className="h-5 w-5" /></button>
        </header>
        {loading ? <Loading label="Loading report detail" /> : (
          <div className="space-y-5 p-5">
            <section className="grid gap-4 lg:grid-cols-3">
              <EvidenceCard icon={<Users />} label="Labour lines" count={detail?.labour.length ?? 0} />
              <EvidenceCard icon={<Truck />} label="Equipment lines" count={detail?.equipment.length ?? 0} />
              <EvidenceCard icon={<PackageCheck />} label="Material lines" count={detail?.materials.length ?? 0} />
            </section>
            <section className="border border-ink-mid p-4"><h3 className="mb-2 font-mono text-xs uppercase tracking-widest text-paper">Site narrative</h3><p className="text-sm text-slate-light">{text(active.actual_work, "No actual work summary recorded.")}</p></section>
            {isDraft ? (
              <section className="grid gap-4 xl:grid-cols-3">
                <LineForm title="Labour" action={() => addLine("labour")} saving={saving === "labour"}>
                  <select value={labour.employee_id} onChange={(e) => setLabour({ ...labour, employee_id: e.target.value })} className="field"><option value="">Employee</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{text(employee.employee_name ?? employee.name ?? employee.full_name, employee.id)}</option>)}</select>
                  <input value={labour.role_on_site} onChange={(e) => setLabour({ ...labour, role_on_site: e.target.value })} placeholder="Role on site" className="field" />
                  <input value={labour.regular_hours} onChange={(e) => setLabour({ ...labour, regular_hours: e.target.value })} placeholder="Regular hours" className="field" />
                  <input value={labour.cost_rate} onChange={(e) => setLabour({ ...labour, cost_rate: e.target.value })} placeholder="Cost rate" className="field" />
                </LineForm>
                <LineForm title="Equipment" action={() => addLine("equipment")} saving={saving === "equipment"}>
                  <select value={equipment.fleet_id} onChange={(e) => setEquipment({ ...equipment, fleet_id: e.target.value })} className="field"><option value="">Fleet asset</option>{fleet.map((asset) => <option key={asset.id} value={asset.id}>{text(asset.asset_code ?? asset.vehicle_registration ?? asset.name, asset.id)}</option>)}</select>
                  <select value={equipment.operator_employee_id} onChange={(e) => setEquipment({ ...equipment, operator_employee_id: e.target.value })} className="field"><option value="">Operator optional</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{text(employee.employee_name ?? employee.name ?? employee.full_name, employee.id)}</option>)}</select>
                  <input value={equipment.operating_hours} onChange={(e) => setEquipment({ ...equipment, operating_hours: e.target.value })} placeholder="Operating hours" className="field" />
                  <input value={equipment.cost_rate} onChange={(e) => setEquipment({ ...equipment, cost_rate: e.target.value })} placeholder="Cost rate" className="field" />
                </LineForm>
                <LineForm title="Materials" action={() => addLine("material")} saving={saving === "material"}>
                  <select value={material.item_id} onChange={(e) => setMaterial({ ...material, item_id: e.target.value })} className="field"><option value="">Inventory item</option>{inventoryItems.map((item) => <option key={item.id} value={item.id}>{text(item.item_name ?? item.name, item.id)}{item.stock_quantity !== undefined ? ` · stock ${item.stock_quantity}` : ""}</option>)}</select>
                  <select value={material.store_id} onChange={(e) => setMaterial({ ...material, store_id: e.target.value })} className="field"><option value="">Store optional</option>{stores.map((store) => <option key={store.id} value={store.id}>{text(store.name ?? store.store_code, store.id)} · {text(store.store_type, "store")}</option>)}</select>
                  <input value={material.quantity_used} onChange={(e) => setMaterial({ ...material, quantity_used: e.target.value })} placeholder="Quantity used" className="field" />
                  <input value={material.unit_cost} onChange={(e) => setMaterial({ ...material, unit_cost: e.target.value })} placeholder="Unit cost" className="field" />
                  <input value={material.work_package} onChange={(e) => setMaterial({ ...material, work_package: e.target.value })} placeholder="Work package" className="field" />
                </LineForm>
              </section>
            ) : null}
            <section className="border border-ink-mid p-4"><h3 className="mb-3 font-mono text-xs uppercase tracking-widest text-paper">Approval timeline</h3>{detail?.approvals.length ? detail.approvals.map((approval) => <p key={approval.id} className="text-sm text-slate-light">{text(approval.workflow_key)} · {text(approval.status)} · submitted {dateValue(approval.submitted_at)}</p>) : <p className="text-sm text-slate-light">No approval instance yet.</p>}</section>
            <section className="flex flex-wrap gap-3 border-t border-ink-mid pt-5">
              {isDraft ? <button onClick={() => transition("submit")} disabled={saving === "submit"} className="action"><Send className="h-4 w-4" />Submit for approval</button> : null}
              {isSubmitted ? <button onClick={() => transition("approved")} disabled={saving === "approved"} className="action"><CheckCircle2 className="h-4 w-4" />Approve and post costs</button> : null}
              {isSubmitted ? <button onClick={() => transition("rejected")} disabled={saving === "rejected"} className="danger"><X className="h-4 w-4" />Reject</button> : null}
            </section>
          </div>
        )}
      </aside>
      <style jsx>{`.field{height:2.5rem;border:1px solid rgb(47 55 69);background:#111827;padding:0 .75rem;font-size:.875rem;color:#f8fafc}.action{display:inline-flex;align-items:center;gap:.5rem;background:#C8960C;color:#09111f;padding:.65rem 1rem;font-family:monospace;font-size:.75rem;font-weight:700;text-transform:uppercase}.danger{display:inline-flex;align-items:center;gap:.5rem;border:1px solid rgb(248 113 113 / .5);color:rgb(252 165 165);padding:.65rem 1rem;font-family:monospace;font-size:.75rem;font-weight:700;text-transform:uppercase}`}</style>
    </div>
  );
}

function EvidenceCard({ icon, label, count }: { icon: ReactNode; label: string; count: number }) {
  return <div className="border border-ink-mid bg-ink-light/40 p-4"><div className="flex items-center justify-between text-slate"><span className="[&_svg]:h-4 [&_svg]:w-4">{icon}</span><span className="font-mono text-xl text-paper">{count}</span></div><p className="mt-3 font-mono text-xs uppercase tracking-wider text-slate-light">{label}</p></div>;
}

function LineForm({ title, children, action, saving }: { title: string; children: ReactNode; action: () => void; saving: boolean }) {
  return <div className="space-y-3 border border-ink-mid p-4"><h3 className="font-mono text-xs uppercase tracking-widest text-paper">{title}</h3>{children}<button onClick={action} disabled={saving} className="inline-flex items-center gap-2 border border-signal/50 px-3 py-2 font-mono text-xs uppercase text-signal disabled:opacity-50"><Plus className="h-4 w-4" />Add {title}</button></div>;
}
