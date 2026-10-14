"use client";

import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  FileText,
  HardHat,
  Loader2,
  Lock,
  PackageCheck,
  Plus,
  RefreshCw,
  Search,
  Send,
  Target,
  Truck,
  Users,
  X,
} from "lucide-react";
import { RBACGuard } from "@/components/auth/RBACGuard";
import { DashboardPageHeader } from "@/components/dashboard/DashboardPageHeader";
import { useLiveTable } from "@/lib/live/LiveDataProvider";
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
  getSiteDay,
  getSiteMaterialRequests,
  getSiteOperationInventoryItems,
  getSiteOperationStores,
  getWeeklySiteBudgetItems,
  getWeeklySiteBudgets,
  getWorkforce,
  requestSiteMaterial,
  suggestMaterials,
  submitDailySiteReport,
} from "@/lib/api";
import { LabourRegisterTab, type SiteDay } from "@/components/site-operations/LabourRegisterTab";
import { TargetsTab } from "@/components/site-operations/TargetsTab";
import { Btn, Locked, Notice, Panel, Pill, areaClass, errorText, fieldClass, qty } from "@/components/site-operations/ui";

type ApiRecord = Record<string, any> & { id: string };
type Detail = {
  report: ApiRecord;
  labour: ApiRecord[];
  equipment: ApiRecord[];
  materials: ApiRecord[];
  documents: ApiRecord[];
  approvals: ApiRecord[];
  material_receipts?: ApiRecord[];
  material_issues?: ApiRecord[];
  open_requests?: ApiRecord[];
  safety_briefing?: ApiRecord | null;
  completeness?: {
    score_percent: number;
    labour_captured: boolean;
    work_progress_logged: boolean;
    safety_checks_recorded: boolean;
    weather_recorded: boolean;
    is_ready_for_submission: boolean;
  };
};
type TabKey = "register" | "report" | "materials" | "targets";

const EMPTY_DETAIL: Detail = {
  report: {} as ApiRecord,
  labour: [],
  equipment: [],
  materials: [],
  documents: [],
  approvals: [],
  material_receipts: [],
  material_issues: [],
  open_requests: [],
  safety_briefing: null,
};

function harareToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Harare" }).format(new Date());
}

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

function reportTitle(report: ApiRecord) {
  return `${text(report.project_name ?? report.project ?? report.project_id, "Project")} · ${dateValue(report.report_date) || "No date"} · ${text(report.shift, "day")}`;
}

function statusTone(status: unknown): "green" | "blue" | "red" | "slate" | "amber" {
  const value = text(status, "draft").toLowerCase();
  if (value === "approved" || value === "issued") return "green";
  if (value === "submitted" || value === "pending") return "blue";
  if (value === "rejected") return "red";
  if (value === "partially_issued" || value === "requisitioned") return "amber";
  return "slate";
}

export default function SiteOperationsPage() {
  return (
    <RBACGuard>
      <SiteOperationsWorkspace />
    </RBACGuard>
  );
}

function SiteOperationsWorkspace() {
  const [tab, setTab] = useState<TabKey>("register");
  const [projectId, setProjectId] = useState("");
  const [workDate, setWorkDate] = useState(harareToday());
  const [day, setDay] = useState<SiteDay | null>(null);
  const [dayLoading, setDayLoading] = useState(false);

  const [reports, setReports] = useState<ApiRecord[]>([]);
  const [projects, setProjects] = useState<ApiRecord[]>([]);
  const [employees, setEmployees] = useState<ApiRecord[]>([]);
  const [fleet, setFleet] = useState<ApiRecord[]>([]);
  const [inventoryItems, setInventoryItems] = useState<ApiRecord[]>([]);
  const [stores, setStores] = useState<ApiRecord[]>([]);
  const [weeklyItems, setWeeklyItems] = useState<ApiRecord[]>([]);
  const [materialRequests, setMaterialRequests] = useState<ApiRecord[]>([]);
  const [selected, setSelected] = useState<ApiRecord | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "error" | "success" | "info"; text: string } | null>(null);
  const [sourceWarnings, setSourceWarnings] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [draft, setDraft] = useState({
    shift: "day",
    planned_work: "",
    actual_work: "",
    delays: "",
    cost_exposure: "0",
    labour_count_completed: false,
    toolbox_talk_completed: false,
    ppe_check_completed: false,
  });
  const [labour, setLabour] = useState({ employee_id: "", role_on_site: "", regular_hours: "8", overtime_hours: "0", cost_rate: "0", notes: "" });
  const [equipment, setEquipment] = useState({ fleet_id: "", operator_employee_id: "", operating_hours: "0", idle_hours: "0", fuel_litres: "0", cost_rate: "0", notes: "" });
  const [material, setMaterial] = useState({ item_id: "", store_id: "", quantity_used: "0", unit_cost: "0", wastage_quantity: "0", work_package: "", notes: "" });
  const [materialRequest, setMaterialRequest] = useState({
    item_id: "",
    material_description: "",
    specifications: "",
    unit_of_measure: "each",
    store_id: "",
    quantity: "1",
    unit_cost: "0",
    required_by_date: harareToday(),
    priority: "normal",
    work_package: "",
    justification: "",
    weekly_budget_item_id: "",
  });
  const [materialSearch, setMaterialSearch] = useState("");
  const [suggestions, setSuggestions] = useState<{ catalogue: any[]; candidates: any[] }>({ catalogue: [], candidates: [] });
  const [searchingMaterials, setSearchingMaterials] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const handleMaterialSearch = async (val: string) => {
    setMaterialSearch(val);
    setMaterialRequest((m) => ({ ...m, material_description: val, item_id: "" }));
    if (val.trim().length >= 2) {
      setSearchingMaterials(true);
      try {
        const res = await suggestMaterials(val.trim(), materialRequest.store_id || undefined);
        if (res.data) {
          setSuggestions(res.data);
          setShowSuggestions(true);
        }
      } catch {
        // ignore
      } finally {
        setSearchingMaterials(false);
      }
    } else {
      setSuggestions({ catalogue: [], candidates: [] });
      setShowSuggestions(false);
    }
  };

  const selectCatalogueItem = (item: any) => {
    setMaterialRequest((m) => ({
      ...m,
      item_id: item.id,
      material_description: item.name,
      unit_of_measure: item.unit_of_measure || "each",
      unit_cost: item.standard_cost ? String(item.standard_cost) : m.unit_cost,
    }));
    setMaterialSearch(item.name);
    setShowSuggestions(false);
  };

  const selectCandidateItem = (cand: any) => {
    setMaterialRequest((m) => ({
      ...m,
      item_id: cand.canonical_item_id || "",
      material_description: cand.name,
      specifications: cand.specifications || "",
      unit_of_measure: cand.unit_of_measure || "each",
    }));
    setMaterialSearch(cand.name);
    setShowSuggestions(false);
  };

  // Deep links from Teams cards: ?tab=targets&project=…&date=…
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get("tab");
    if (t === "register" || t === "report" || t === "materials" || t === "targets") setTab(t);
    if (params.get("project")) setProjectId(params.get("project") ?? "");
    if (params.get("date")) setWorkDate(params.get("date") ?? harareToday());
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [reportResult, projectResult, workforceResult, fleetResult, inventoryResult, storeResult] = await Promise.allSettled([
        getDailySiteReports({ status, projectId: projectId || undefined }),
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
      if (projectId) {
        const [budgetResult, requestResult] = await Promise.allSettled([
          getWeeklySiteBudgets({ projectId, status: "all" }),
          getSiteMaterialRequests({ projectId }),
        ]);
        setMaterialRequests(requestResult.status === "fulfilled" && Array.isArray(requestResult.value.data) ? requestResult.value.data.slice(0, 15) : []);
        const activeBudget = budgetResult.status === "fulfilled"
          ? (Array.isArray(budgetResult.value.data) ? budgetResult.value.data : []).find((budget) => ["approved", "submitted"].includes(text(budget.status).toLowerCase()))
          : null;
        if (activeBudget?.id) {
          try {
            const itemResult = await getWeeklySiteBudgetItems(activeBudget.id);
            setWeeklyItems(Array.isArray(itemResult.data) ? itemResult.data : []);
          } catch {
            setWeeklyItems([]);
            warnings.push("Weekly execution lines could not be loaded.");
          }
        } else {
          setWeeklyItems([]);
        }
      } else {
        setWeeklyItems([]);
        setMaterialRequests([]);
      }
      setSourceWarnings(warnings);
      if (reportResult.status === "rejected") {
        throw new Error(loadFailureMessage(reportResult.reason));
      }
    } catch (reason) {
      setError(loadFailureMessage(reason));
    } finally {
      setLoading(false);
    }
  }, [projectId, status]);

  const loadDay = useCallback(async () => {
    if (!projectId) { setDay(null); return; }
    setDayLoading(true);
    try {
      const response = await getSiteDay({ projectId, date: workDate });
      setDay(response.data ?? null);
    } catch (reason) {
      setDay(null);
      setNotice({ tone: "error", text: errorText(reason, "Today's site day could not be loaded.") });
    } finally {
      setDayLoading(false);
    }
  }, [projectId, workDate]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadDay(); }, [loadDay]);
  useLiveTable("projects.daily_site_reports", () => void load());
  useLiveTable("projects.site_day_briefings", () => void loadDay());
  useLiveTable("projects.site_day_attendance", () => void loadDay());

  // The daily report's site-day ticks come from the morning briefing.
  useEffect(() => {
    const b = day?.briefing;
    setDraft((current) => ({
      ...current,
      labour_count_completed: !!b?.labour_count_completed,
      toolbox_talk_completed: !!b?.toolbox_talk_completed,
      ppe_check_completed: !!b?.ppe_check_completed,
    }));
  }, [day?.briefing]);

  const unlocked = !!day?.gate.unlocked;
  const projectName = text(projects.find((p) => p.id === projectId)?.name ?? day?.project_name, "");

  const open = async (report: ApiRecord) => {
    setSelected(report);
    setDetail(null);
    setDetailLoading(true);
    try {
      const response = await getDailySiteReport(report.id);
      setDetail(response.data ?? EMPTY_DETAIL);
    } catch (reason) {
      setNotice({ tone: "error", text: errorText(reason, "Daily report detail could not be loaded.") });
    } finally {
      setDetailLoading(false);
    }
  };

  const createReport = async () => {
    if (!projectId) { setNotice({ tone: "error", text: "Select a project before creating a daily report." }); return; }
    setSaving("create");
    try {
      const b = day?.briefing;
      const safetyNotes = b?.safety_concern_raised ? `${text(b.safety_concerns, "Concern raised")}. Action: ${text(b.safety_actions, "not recorded")}` : null;
      await createDailySiteReport({ project_id: projectId, report_date: workDate, ...draft, safety_notes: safetyNotes, cost_exposure: Number(draft.cost_exposure || 0), weather: {} });
      setNotice({ tone: "success", text: "Daily site report created. Open it below to add labour, plant and materials." });
      setDraft((d) => ({ ...d, planned_work: "", actual_work: "", delays: "", cost_exposure: "0" }));
      await load();
    } catch (reason) {
      setNotice({ tone: "error", text: errorText(reason, "Unable to create daily report.") });
    } finally {
      setSaving(null);
    }
  };

  const refreshDetail = async () => {
    if (!selected) return;
    const response = await getDailySiteReport(selected.id);
    setDetail(response.data ?? EMPTY_DETAIL);
    const reportResult = await getDailySiteReports({ status, projectId: projectId || undefined });
    setReports(Array.isArray(reportResult.data) ? reportResult.data : []);
  };

  const addLine = async (kind: "labour" | "equipment" | "material") => {
    if (!selected) return;
    setSaving(kind);
    try {
      if (kind === "labour") await addDailyReportLabour(selected.id, { ...labour, regular_hours: Number(labour.regular_hours), overtime_hours: Number(labour.overtime_hours), cost_rate: Number(labour.cost_rate) });
      if (kind === "equipment") await addDailyReportEquipment(selected.id, { ...equipment, operator_employee_id: equipment.operator_employee_id || null, operating_hours: Number(equipment.operating_hours), idle_hours: Number(equipment.idle_hours), fuel_litres: Number(equipment.fuel_litres), cost_rate: Number(equipment.cost_rate) });
      if (kind === "material") await addDailyReportMaterial(selected.id, { ...material, store_id: material.store_id || null, quantity_used: Number(material.quantity_used), unit_cost: Number(material.unit_cost), wastage_quantity: Number(material.wastage_quantity) });
      setNotice({ tone: "success", text: `${kind[0].toUpperCase()}${kind.slice(1)} line recorded.` });
      await refreshDetail();
    } catch (reason) {
      setNotice({ tone: "error", text: errorText(reason, `Unable to add ${kind} line.`) });
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
      setNotice({ tone: "success", text: action === "submit" ? "Daily report submitted." : `Daily report ${action}.` });
      await refreshDetail();
    } catch (reason) {
      setNotice({ tone: "error", text: errorText(reason, "Workflow action failed.") });
    } finally {
      setSaving(null);
    }
  };

  const submitMaterialRequest = async () => {
    if (!projectId) { setNotice({ tone: "error", text: "Select a project before requesting site materials." }); return; }
    const desc = (materialRequest.material_description || materialSearch || "").trim();
    if (!materialRequest.item_id && !desc) { setNotice({ tone: "error", text: "Enter or select a material description before requesting site materials." }); return; }
    setSaving("material-request");
    try {
      // CCB Commercial Guard audit; continue if the audit service is unreachable.
      try {
        await auditSiteRequest({
          requester_name: "Site Supervisor",
          document_type: "SITE_MATERIAL_REQUEST",
          item: materialRequest.work_package || desc || "Site Material Request",
          requested_quantity: Number(materialRequest.quantity),
          earned_quantity: Number(materialRequest.quantity) * 0.65,
          unit_rate: Number(materialRequest.unit_cost),
          project_id: projectId,
        });
      } catch {
        // audit is advisory
      }
      const response = await requestSiteMaterial({
        project_id: projectId,
        item_id: materialRequest.item_id || null,
        material_description: desc || null,
        specifications: materialRequest.specifications || null,
        unit_of_measure: materialRequest.unit_of_measure || "each",
        store_id: materialRequest.store_id || null,
        quantity: Number(materialRequest.quantity),
        unit_cost: Number(materialRequest.unit_cost),
        required_by_date: materialRequest.required_by_date,
        priority: materialRequest.priority,
        work_package: materialRequest.work_package || null,
        justification: materialRequest.justification || null,
        weekly_budget_item_id: materialRequest.weekly_budget_item_id || null,
        auto_submit_requisition: true,
      });
      const data = response.data ?? {};
      const issued = data.issued_quantity ?? "0";
      const shortfall = data.shortfall_quantity ?? "0";
      setNotice({ tone: "success", text: `Material request ${text(data.request_number, "")} processed. Issued ${issued}; shortfall ${shortfall}${data.purchase_requisition_number ? `; PR ${data.purchase_requisition_number} raised for approval.` : "."}` });
      setMaterialRequest((m) => ({ ...m, item_id: "", material_description: "", specifications: "", quantity: "1", justification: "", work_package: "" }));
      setMaterialSearch("");
      await load();
    } catch (reason) {
      setNotice({ tone: "error", text: errorText(reason, "Material request failed.") });
    } finally {
      setSaving(null);
    }
  };

  const filtered = useMemo(() => reports.filter((report) => {
    const haystack = `${reportTitle(report)} ${report.status ?? ""} ${report.actual_work ?? ""}`.toLowerCase();
    return haystack.includes(query.toLowerCase());
  }), [reports, query]);

  const metrics = useMemo(() => ({
    onSite: day?.attendance.length ?? 0,
    clockedIn: (day?.attendance ?? []).filter((a) => a.clock_in_at && !a.clock_out_at).length,
    targets: day?.targets.length ?? 0,
    targetsDone: (day?.targets ?? []).filter((t) => t.status === "done").length,
    submitted: reports.filter((report) => String(report.status).toLowerCase() === "submitted").length,
    cost: reports.reduce((sum, report) => sum + number(report.cost_exposure), 0),
  }), [reports, day]);

  const selectedItem = inventoryItems.find((item) => item.id === materialRequest.item_id);
  const dayStatus = day?.briefing ? String(day.briefing.status) : "none";

  const tabs: { key: TabKey; label: string; icon: ReactNode; locked: boolean; badge?: string }[] = [
    { key: "register", label: "Labour Register", icon: <HardHat className="h-4 w-4" />, locked: false,
      badge: dayStatus === "started" ? "live" : dayStatus === "closed" ? "closed" : dayStatus === "open" ? "pre-start" : "to do" },
    { key: "report", label: "Daily Report", icon: <ClipboardList className="h-4 w-4" />, locked: !unlocked },
    { key: "materials", label: "Material Requests", icon: <PackageCheck className="h-4 w-4" />, locked: !unlocked },
    { key: "targets", label: "Budgets & Targets", icon: <Target className="h-4 w-4" />, locked: false, badge: metrics.targets ? `${metrics.targetsDone}/${metrics.targets}` : undefined },
  ];

  const lockedPanel = (what: string) => (
    <Locked title={`${what} is locked`} body="Start the site day first. Complete the labour register, PPE check and toolbox talk, and deal with any safety concern, in the Labour Register tab."
      action={<Btn icon={<HardHat className="h-4 w-4" />} onClick={() => setTab("register")}>Go to Labour Register</Btn>} />
  );

  return (
    <main className="min-h-full bg-ink p-4 text-paper sm:p-6">
      <DashboardPageHeader
        eyebrow={{ label: "Site Operations Command", icon: ClipboardCheck }}
        title="Site Operations"
        subtitle="Start each day with the labour register, PPE and toolbox talk. Then record the day's work, request materials and track today's targets."
        actions={
          <button onClick={() => { void load(); void loadDay(); }} disabled={loading} className="inline-flex h-10 items-center gap-2 border border-ink-mid bg-ink-light px-3 font-mono text-xs uppercase tracking-wider text-slate-light hover:border-signal hover:text-paper disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading || dayLoading ? "animate-spin" : ""}`} />Refresh</button>
        }
      />

      {/* context bar: the whole page works on one project-day */}
      <section className="sticky top-0 z-20 -mx-4 mb-5 border-y border-ink-mid bg-ink/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="grid flex-1 gap-2 sm:grid-cols-[minmax(0,1fr)_180px] lg:max-w-2xl">
            <select value={projectId} onChange={(event) => { setProjectId(event.target.value); setSelected(null); }} className={fieldClass} aria-label="Project">
              <option value="">Select the project you are on site for</option>
              {projects.map((project) => <option key={project.id} value={project.id}>{text(project.name ?? project.project_name ?? project.project_code, project.id)}</option>)}
            </select>
            <label className="relative">
              <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate" />
              <input type="date" value={workDate} max={harareToday()} onChange={(event) => setWorkDate(event.target.value || harareToday())} className={`${fieldClass} pl-9`} aria-label="Site day" />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {projectId ? (
              <>
                <Pill tone={dayStatus === "started" ? "green" : dayStatus === "closed" ? "slate" : "amber"}>
                  {dayStatus === "started" ? "Day running" : dayStatus === "closed" ? "Day closed" : dayStatus === "open" ? "Pre-start checks" : "Day not started"}
                </Pill>
                <Pill tone={unlocked ? "green" : "red"}>{unlocked ? "Reports & materials unlocked" : "Reports & materials locked"}</Pill>
                {workDate !== harareToday() ? <Pill tone="blue">Viewing {dateValue(workDate)}</Pill> : null}
              </>
            ) : <span className="text-xs text-slate-light">Choose a project to begin.</span>}
          </div>
        </div>
        <nav className="mt-3 flex gap-1 overflow-x-auto" role="tablist" aria-label="Site operations">
          {tabs.map((t, i) => (
            <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
              className={`group flex shrink-0 items-center gap-2 border-b-2 px-4 py-2.5 text-sm transition ${tab === t.key ? "border-signal text-paper" : "border-transparent text-slate-light hover:text-paper"}`}>
              <span className={`flex h-5 w-5 items-center justify-center font-mono text-[10px] ${tab === t.key ? "bg-signal text-ink" : "border border-ink-mid"}`}>{i + 1}</span>
              {t.icon}
              <span className="font-medium">{t.label}</span>
              {t.locked ? <Lock className="h-3.5 w-3.5 text-amber-400" /> : null}
              {t.badge ? <span className="font-mono text-[10px] uppercase text-slate">{t.badge}</span> : null}
            </button>
          ))}
        </nav>
      </section>

      <section className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric icon={<Users />} label="On site today" value={projectId ? String(metrics.onSite) : "—"} hint={projectId ? `${metrics.clockedIn} clocked in` : undefined} />
        <Metric icon={<Target />} label="Today's targets" value={projectId ? `${metrics.targetsDone}/${metrics.targets}` : "—"} hint="done / set" tone={metrics.targets && metrics.targetsDone === metrics.targets ? "text-emerald-300" : "text-paper"} />
        <Metric icon={<Send />} label="Reports awaiting approval" value={loading ? "…" : String(metrics.submitted)} tone={metrics.submitted ? "text-blue-300" : "text-slate-light"} />
        <Metric icon={<BadgeCheck />} label="Open cost exposure" value={money(metrics.cost)} />
      </section>

      <div className="mb-4 space-y-2">
        {error ? <Notice tone="error">{error}</Notice> : null}
        {sourceWarnings.map((warning) => <Notice key={warning} tone="info">{warning}</Notice>)}
        {!loading && !error && projects.length === 0 && !sourceWarnings.includes("Project register could not be loaded.") ? (
          <Notice tone="info">You are not assigned to any project yet. Ask your project manager to add you to a project team - you will then see that project here.</Notice>
        ) : null}
        {notice ? <Notice tone={notice.tone} onClose={() => setNotice(null)}>{notice.text}</Notice> : null}
      </div>

      {tab === "register" ? (
        dayLoading && !day ? <LoadingBlock label="Loading the site day" /> :
        <LabourRegisterTab projectId={projectId} date={workDate} day={day} onDay={(partial) => setDay((d) => (d ? { ...d, ...partial } : d))} reload={loadDay} />
      ) : null}

      {tab === "targets" ? <TargetsTab projectId={projectId} date={workDate} onChanged={() => void loadDay()} /> : null}

      {tab === "report" ? (!projectId ? <Locked title="Choose a project" body="Daily reports are written per project." /> : !unlocked ? lockedPanel("The daily report") : (
        <div className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
            <Panel title={`Daily report · ${dateValue(workDate)}`} subtitle="The site-day ticks come from this morning's briefing.">
              <div className="grid gap-3 md:grid-cols-2">
                <select value={draft.shift} onChange={(event) => setDraft({ ...draft, shift: event.target.value })} className={fieldClass}><option value="day">Day shift</option><option value="night">Night shift</option><option value="double">Double shift</option></select>
                <label className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate">Cost exposure $</span>
                  <input value={draft.cost_exposure} onChange={(event) => setDraft({ ...draft, cost_exposure: event.target.value })} className={`${fieldClass} pl-28`} />
                </label>
                <div className="md:col-span-2">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-xs text-slate-light">Planned work</span>
                    {day?.targets.length ? (
                      <button onClick={() => setDraft({ ...draft, planned_work: day.targets.map((t) => `• ${t.work_package ? `${t.work_package}: ` : ""}${t.description} (${qty(t.target_qty)} ${t.unit ?? ""})`).join("\n") })}
                        className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-signal hover:underline"><Target className="h-3 w-3" /> Fill from today&apos;s targets</button>
                    ) : null}
                  </div>
                  <textarea value={draft.planned_work} onChange={(event) => setDraft({ ...draft, planned_work: event.target.value })} placeholder="What was planned for today" className={areaClass} />
                </div>
                <textarea value={draft.actual_work} onChange={(event) => setDraft({ ...draft, actual_work: event.target.value })} placeholder="Actual work completed" className={`${areaClass} md:col-span-2`} />
                <textarea value={draft.delays} onChange={(event) => setDraft({ ...draft, delays: event.target.value })} placeholder="Delays, weather, idle time, instructions received" className={`${areaClass} min-h-16 md:col-span-2`} />
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <SiteTick label="Labour count done" checked={draft.labour_count_completed} />
                <SiteTick label="Toolbox talk done" checked={draft.toolbox_talk_completed} />
                <SiteTick label="PPE check done" checked={draft.ppe_check_completed} />
              </div>
              <div className="mt-4 flex justify-end">
                <Btn onClick={() => void createReport()} busy={saving === "create"} icon={<Plus className="h-4 w-4" />}>Create report</Btn>
              </div>
            </Panel>
            <Panel title="Today on site" subtitle="From the labour register and targets.">
              <ul className="space-y-2 text-sm">
                <li className="flex justify-between"><span className="text-slate-light">People on register</span><span className="font-mono text-paper">{metrics.onSite}</span></li>
                <li className="flex justify-between"><span className="text-slate-light">Toolbox talk</span><span className="text-right text-paper">{text(day?.briefing?.toolbox_topic, "—")}</span></li>
                <li className="flex justify-between"><span className="text-slate-light">Safety</span>{day?.briefing?.safety_concern_raised ? <Pill tone="red">concern raised</Pill> : <Pill tone="green">no concerns</Pill>}</li>
                <li className="flex justify-between"><span className="text-slate-light">Targets done</span><span className="font-mono text-paper">{metrics.targetsDone}/{metrics.targets}</span></li>
              </ul>
              {day?.targets.length ? (
                <ul className="mt-4 space-y-1.5 border-t border-ink-mid pt-3 text-xs">
                  {day.targets.map((t) => (
                    <li key={t.id} className="flex items-center justify-between gap-2">
                      <span className="truncate text-slate-light">{t.description}</span>
                      <span className="shrink-0 font-mono text-paper">{qty(t.achieved_qty)}/{qty(t.target_qty)} {t.unit}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </Panel>
          </div>

          <section className="border border-ink-mid bg-ink">
            <div className="flex flex-col gap-3 border-b border-ink-mid p-4 lg:flex-row lg:items-center lg:justify-between">
              <div><h2 className="font-mono text-xs font-bold uppercase tracking-widest">Daily report register · {projectName || "all projects"}</h2><p className="mt-1 text-xs text-slate-light">Open a report to add labour, equipment and material consumption, then submit it for approval.</p></div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <label className="flex h-10 items-center gap-2 border border-ink-mid bg-ink-light px-3"><Search className="h-4 w-4 text-slate" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search reports" className="bg-transparent text-sm outline-none placeholder:text-slate" /></label>
                <select value={status} onChange={(event) => setStatus(event.target.value)} className="h-10 border border-ink-mid bg-ink-light px-3 text-sm text-paper"><option value="all">All statuses</option><option value="draft">Draft</option><option value="submitted">Submitted</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select>
              </div>
            </div>
            {loading && reports.length === 0 ? <LoadingBlock label="Loading daily reports" /> : filtered.length === 0 ? (
              <div className="flex h-40 flex-col items-center justify-center p-6 text-center text-slate-light"><FileText className="h-8 w-8 text-slate" /><p className="mt-3 text-sm text-paper">No daily reports match this view.</p></div>
            ) : (
              <div className="divide-y divide-ink-mid">
                {filtered.map((report) => (
                  <button key={report.id} onClick={() => void open(report)} className="grid w-full gap-3 p-4 text-left hover:bg-ink-light/50 md:grid-cols-[minmax(0,1.5fr)_1fr_auto] md:items-center">
                    <div><p className="font-medium text-paper">{reportTitle(report)}</p><p className="mt-1 line-clamp-1 text-xs text-slate-light">{text(report.actual_work, "No actual work summary captured")}</p></div>
                    <p className="text-sm text-slate-light">{money(report.cost_exposure)}</p>
                    <Pill tone={statusTone(report.status)}>{text(report.status, "draft")}</Pill>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
      )) : null}

      {tab === "materials" ? (!projectId ? <Locked title="Choose a project" body="Material requests are raised against a project's weekly budget." /> : !unlocked ? lockedPanel("Material requests") : (
        <div className="grid gap-4 xl:grid-cols-[1.25fr_0.75fr]">
          <Panel title="Site material request" subtitle="Checks stock first. Available stock is issued and costed to the project; any shortfall becomes a procurement requisition for approval."
            actions={<span className="border border-signal/30 bg-signal/10 px-2 py-1 font-mono text-[10px] uppercase text-signal">Scenario A bridge</span>}>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="relative md:col-span-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-slate-light">Material Description / Catalogue Item</label>
                  {materialRequest.item_id ? (
                    <span className="flex items-center gap-1.5 text-[11px] text-emerald-300">
                      <CheckCircle2 className="h-3 w-3" /> Catalogue match
                      <button
                        type="button"
                        onClick={() => {
                          setMaterialRequest((m) => ({ ...m, item_id: "" }));
                        }}
                        className="ml-1 text-slate hover:text-paper underline"
                      >
                        (use custom text)
                      </button>
                    </span>
                  ) : materialSearch.trim() ? (
                    <span className="text-[11px] text-amber-300">Provisional unlisted candidate</span>
                  ) : null}
                </div>
                <div className="relative mt-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate" />
                  <input
                    value={materialSearch}
                    onChange={(e) => void handleMaterialSearch(e.target.value)}
                    onFocus={() => {
                      if (suggestions.catalogue.length || suggestions.candidates.length) setShowSuggestions(true);
                    }}
                    placeholder="Type what you need (e.g. 50kg PPC Cement, 20mm aggregate)..."
                    className={`${fieldClass} pl-9`}
                  />
                  {searchingMaterials ? (
                    <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-signal" />
                  ) : null}
                </div>

                {showSuggestions && (suggestions.catalogue.length > 0 || suggestions.candidates.length > 0) ? (
                  <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-60 overflow-y-auto border border-ink-mid bg-ink-light p-2 shadow-2xl">
                    {suggestions.catalogue.length > 0 ? (
                      <div className="mb-2">
                        <p className="px-2 py-1 font-mono text-[10px] uppercase text-signal">Catalogue Items</p>
                        {suggestions.catalogue.map((cat: any) => (
                          <button
                            key={cat.id}
                            type="button"
                            onClick={() => selectCatalogueItem(cat)}
                            className="flex w-full items-center justify-between px-2 py-1.5 text-left text-xs hover:bg-ink"
                          >
                            <div>
                              <p className="font-medium text-paper">{cat.name}</p>
                              <p className="text-[10px] text-slate-light">{cat.code} · ${cat.standard_cost} · {cat.unit_of_measure}</p>
                            </div>
                            <span className="font-mono text-[11px] text-emerald-400">
                              {cat.stock_balance > 0 ? `${cat.stock_balance} in store` : "0 stock"}
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                    {suggestions.candidates.length > 0 ? (
                      <div>
                        <p className="px-2 py-1 font-mono text-[10px] uppercase text-amber-400">Recent Candidate Descriptions</p>
                        {suggestions.candidates.map((cand: any) => (
                          <button
                            key={cand.id}
                            type="button"
                            onClick={() => selectCandidateItem(cand)}
                            className="flex w-full items-center justify-between px-2 py-1.5 text-left text-xs hover:bg-ink"
                          >
                            <div>
                              <p className="font-medium text-paper">{cand.name}</p>
                              <p className="text-[10px] text-slate-light">{cand.specifications || "Uncatalogued candidate"}</p>
                            </div>
                            <Pill tone="amber">candidate</Pill>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <label className="text-xs text-slate-light md:col-span-2">Specifications / Brand / Standard (Optional)
                <input value={materialRequest.specifications} onChange={(event) => setMaterialRequest({ ...materialRequest, specifications: event.target.value })} placeholder="e.g. Grade 42.5R, Class A, Galvanized" className={`${fieldClass} mt-1`} />
              </label>
              <label className="text-xs text-slate-light">Quantity
                <input type="number" min="0" step="any" value={materialRequest.quantity} onChange={(event) => setMaterialRequest({ ...materialRequest, quantity: event.target.value })} className={`${fieldClass} mt-1`} />
              </label>
              <label className="text-xs text-slate-light">Unit of Measure
                <input value={materialRequest.unit_of_measure} onChange={(event) => setMaterialRequest({ ...materialRequest, unit_of_measure: event.target.value })} placeholder="each, bags, m, tonnes" className={`${fieldClass} mt-1`} />
              </label>
              <label className="text-xs text-slate-light">Unit cost ($)
                <input type="number" min="0" step="any" value={materialRequest.unit_cost} onChange={(event) => setMaterialRequest({ ...materialRequest, unit_cost: event.target.value })} className={`${fieldClass} mt-1`} />
              </label>
              <label className="text-xs text-slate-light">Source store
                <select value={materialRequest.store_id} onChange={(event) => setMaterialRequest({ ...materialRequest, store_id: event.target.value })} className={`${fieldClass} mt-1`}>
                  <option value="">Any store</option>
                  {stores.map((store) => <option key={store.id} value={store.id}>{text(store.name ?? store.store_code, store.id)}</option>)}
                </select>
              </label>
              <label className="text-xs text-slate-light">Needed by
                <input type="date" value={materialRequest.required_by_date} onChange={(event) => setMaterialRequest({ ...materialRequest, required_by_date: event.target.value })} className={`${fieldClass} mt-1`} />
              </label>
              <label className="text-xs text-slate-light">Priority
                <select value={materialRequest.priority} onChange={(event) => setMaterialRequest({ ...materialRequest, priority: event.target.value })} className={`${fieldClass} mt-1`}>
                  <option value="normal">Normal</option>
                  <option value="urgent">Urgent</option>
                  <option value="emergency">Emergency</option>
                  <option value="low">Low</option>
                </select>
              </label>
              <label className="text-xs text-slate-light">Work package
                <input value={materialRequest.work_package} onChange={(event) => setMaterialRequest({ ...materialRequest, work_package: event.target.value })} placeholder="e.g. Unit 10 blockwork" className={`${fieldClass} mt-1`} />
              </label>
              <label className="text-xs text-slate-light md:col-span-2">Weekly budget line
                <select value={materialRequest.weekly_budget_item_id} onChange={(event) => setMaterialRequest({ ...materialRequest, weekly_budget_item_id: event.target.value })} className={`${fieldClass} mt-1`}>
                  <option value="">{weeklyItems.length ? "Link to a line of this week's budget" : "No weekly budget lines this week"}</option>
                  {weeklyItems.map((line) => <option key={line.id} value={line.id}>{text(line.description)} · planned {qty(line.planned_qty)} {text(line.unit, "")}</option>)}
                </select>
              </label>
              <textarea value={materialRequest.justification} onChange={(event) => setMaterialRequest({ ...materialRequest, justification: event.target.value })} placeholder="Why is it needed today?" className={`${areaClass} min-h-16 md:col-span-2`} />
            </div>
            {Number(materialRequest.quantity) > 50 ? (
              <div className="mt-3 flex items-center gap-2 border border-red-500/30 bg-red-500/5 p-3 text-xs text-paper">
                <AlertTriangle className="h-4 w-4 shrink-0 text-red-500" />
                Requested quantity ({materialRequest.quantity}) exceeds the project BOQ baseline threshold. This request triggers an Executive Margin Threat Alert.
              </div>
            ) : null}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-slate-light">{selectedItem ? `Estimated value ${money(number(materialRequest.quantity) * number(materialRequest.unit_cost))}` : ""}</p>
              <Btn onClick={() => void submitMaterialRequest()} busy={saving === "material-request"} icon={<PackageCheck className="h-4 w-4" />}>Request material</Btn>
            </div>
          </Panel>
          <Panel title="Recent requests" subtitle={projectName}>
            {materialRequests.length === 0 ? <p className="text-sm text-slate-light">No material requests yet for this project.</p> : (
              <ul className="divide-y divide-ink-mid">
                {materialRequests.map((r) => (
                  <li key={r.id} className="py-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm text-paper">{text(r.item_name, "Item")}</p>
                      <Pill tone={statusTone(r.status)}>{text(r.status, "open").replace(/_/g, " ")}</Pill>
                    </div>
                    <p className="mt-0.5 text-xs text-slate-light">{text(r.request_number, "")} · {qty(r.quantity ?? r.requested_quantity)} requested · {dateValue(r.created_at)}</p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      )) : null}

      {selected ? <ReportDrawer report={selected} detail={detail} loading={detailLoading} employees={employees} fleet={fleet} inventoryItems={inventoryItems} stores={stores} labour={labour} setLabour={setLabour} equipment={equipment} setEquipment={setEquipment} material={material} setMaterial={setMaterial} saving={saving} addLine={addLine} transition={transition} onClose={() => { setSelected(null); setDetail(null); }} /> : null}
    </main>
  );
}

function Metric({ icon, label, value, hint, tone = "text-paper" }: { icon: ReactNode; label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="border border-ink-mid bg-ink p-4">
      <div className="flex items-center justify-between text-slate"><p className="font-mono text-[10px] uppercase tracking-wider">{label}</p><span className="text-signal [&_svg]:h-4 [&_svg]:w-4">{icon}</span></div>
      <p className={`mt-3 font-mono text-2xl ${tone}`}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-slate">{hint}</p> : null}
    </div>
  );
}

function SiteTick({ label, checked }: { label: string; checked: boolean }) {
  return (
    <div className={`flex items-center gap-2 border px-3 py-2 text-xs ${checked ? "border-emerald-500/50 text-emerald-200" : "border-ink-mid text-slate-light"}`} title="Set by the morning briefing in the Labour Register tab">
      {checked ? <CheckCircle2 className="h-4 w-4" /> : <Lock className="h-4 w-4" />} {label}
    </div>
  );
}

function LoadingBlock({ label }: { label: string }) {
  return <div className="flex h-48 items-center justify-center gap-3 text-sm text-slate-light"><Loader2 className="h-5 w-5 animate-spin text-signal" />{label}</div>;
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
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <aside className="ml-auto flex h-full w-full max-w-5xl flex-col overflow-y-auto border-l border-ink-mid bg-ink text-paper shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <header className="sticky top-0 z-10 flex items-start justify-between border-b border-ink-mid bg-ink p-5">
          <div><p className="font-mono text-xs uppercase tracking-widest text-signal">Daily Site Report</p><h2 className="mt-1 text-2xl font-semibold">{reportTitle(active)}</h2><div className="mt-2"><Pill tone={statusTone(active.status)}>{text(active.status)}</Pill></div></div>
          <button onClick={onClose} aria-label="Close" className="border border-ink-mid p-2 text-slate-light hover:border-signal hover:text-paper"><X className="h-5 w-5" /></button>
        </header>
        {loading ? <LoadingBlock label="Loading report detail" /> : (
          <div className="space-y-5 p-5">
            {detail?.completeness ? (
              <div className="border border-ink-mid bg-ink-light/20 p-4">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs uppercase tracking-wider text-slate-light">Report Readiness</span>
                  <span className="font-mono text-sm font-semibold text-paper">{detail.completeness.score_percent}%</span>
                </div>
                <div className="mt-2 h-1.5 w-full bg-ink-mid overflow-hidden">
                  <div
                    className={`h-full transition-all duration-300 ${detail.completeness.score_percent >= 100 ? "bg-emerald-500" : detail.completeness.score_percent >= 50 ? "bg-signal" : "bg-amber-500"}`}
                    style={{ width: `${detail.completeness.score_percent}%` }}
                  />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                  <span className={`flex items-center gap-1.5 ${detail.completeness.labour_captured ? "text-emerald-300" : "text-slate"}`}>
                    <CheckCircle2 className="h-3.5 w-3.5" /> Labour register synced
                  </span>
                  <span className={`flex items-center gap-1.5 ${detail.completeness.work_progress_logged ? "text-emerald-300" : "text-slate"}`}>
                    <CheckCircle2 className="h-3.5 w-3.5" /> Work progress logged
                  </span>
                  <span className={`flex items-center gap-1.5 ${detail.completeness.safety_checks_recorded ? "text-emerald-300" : "text-slate"}`}>
                    <CheckCircle2 className="h-3.5 w-3.5" /> Safety & toolbox
                  </span>
                  <span className={`flex items-center gap-1.5 ${detail.completeness.weather_recorded ? "text-emerald-300" : "text-slate"}`}>
                    <CheckCircle2 className="h-3.5 w-3.5" /> Weather recorded
                  </span>
                </div>
              </div>
            ) : null}

            <section className="grid gap-4 lg:grid-cols-3">
              <EvidenceCard icon={<Users />} label="Labour lines" count={detail?.labour.length ?? 0} />
              <EvidenceCard icon={<Truck />} label="Equipment lines" count={detail?.equipment.length ?? 0} />
              <EvidenceCard icon={<PackageCheck />} label="Material lines" count={detail?.materials.length ?? 0} />
            </section>

            {detail?.labour.length ? (
              <section className="border border-ink-mid p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-mono text-xs uppercase tracking-widest text-paper">Labour Register ({detail.labour.length} attendees)</h3>
                  <span className="text-[10px] font-mono text-emerald-300 uppercase">Live synced from morning register</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-ink-mid text-slate">
                      <tr>
                        <th className="pb-2 font-mono uppercase">Worker</th>
                        <th className="pb-2 font-mono uppercase">Role</th>
                        <th className="pb-2 font-mono uppercase">Type</th>
                        <th className="pb-2 font-mono uppercase text-right">Regular</th>
                        <th className="pb-2 font-mono uppercase text-right">Overtime</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ink-mid/50 text-paper">
                      {detail.labour.map((l: any) => (
                        <tr key={l.id} className="hover:bg-ink-light/20">
                          <td className="py-2 font-medium">{l.worker_name || l.employee_name || "Worker"}</td>
                          <td className="py-2 text-slate-light">{l.role_on_site || "-"}</td>
                          <td className="py-2"><Pill tone={l.worker_kind === "project_hire" ? "gold" : "slate"}>{l.worker_kind || "employee"}</Pill></td>
                          <td className="py-2 text-right font-mono">{l.regular_hours}h</td>
                          <td className="py-2 text-right font-mono text-signal">{Number(l.overtime_hours) > 0 ? `+${l.overtime_hours}h` : "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}

            <section className="grid gap-4 lg:grid-cols-2">
              <div className="border border-ink-mid p-4">
                <h3 className="mb-2 font-mono text-xs uppercase tracking-widest text-paper">Site Goods Receipts ({detail?.material_receipts?.length ?? 0})</h3>
                {!detail?.material_receipts?.length ? (
                  <p className="text-sm text-slate-light">No deliveries confirmed on site today.</p>
                ) : (
                  <ul className="divide-y divide-ink-mid/50 text-xs">
                    {detail.material_receipts.map((grn: any) => (
                      <li key={grn.line_id || grn.id} className="py-2 flex items-start justify-between">
                        <div>
                          <p className="font-medium text-paper">{grn.description}</p>
                          <p className="text-[11px] text-slate-light">{grn.grn_number} · {grn.supplier_name || "Supplier"}</p>
                        </div>
                        <span className="font-mono text-emerald-300">+{grn.quantity_received} {grn.unit_of_measure || "each"}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="border border-ink-mid p-4">
                <h3 className="mb-2 font-mono text-xs uppercase tracking-widest text-paper">Store Issues / Consumed ({detail?.material_issues?.length ?? 0})</h3>
                {!detail?.material_issues?.length ? (
                  <p className="text-sm text-slate-light">No store issues recorded for this site today.</p>
                ) : (
                  <ul className="divide-y divide-ink-mid/50 text-xs">
                    {detail.material_issues.map((iss: any) => (
                      <li key={iss.id} className="py-2 flex items-start justify-between">
                        <div>
                          <p className="font-medium text-paper">{iss.item_name || iss.item_code}</p>
                          <p className="text-[11px] text-slate-light">{iss.store_name || "Store"} · ref {iss.reference || "-"}</p>
                        </div>
                        <span className="font-mono text-signal">-{Math.abs(iss.quantity)} {iss.unit_of_measure || "each"}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>

            {detail?.safety_briefing ? (
              <section className="border border-ink-mid p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-mono text-xs uppercase tracking-widest text-paper">Morning Safety & Toolbox Briefing</h3>
                  <Pill tone={detail.safety_briefing.ppe_compliant ? "green" : "amber"}>
                    {detail.safety_briefing.ppe_compliant ? "PPE 100% Compliant" : "PPE Check Pending"}
                  </Pill>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 text-xs text-slate-light">
                  <p><b className="text-paper">Toolbox Topic:</b> {detail.safety_briefing.toolbox_topic || "Standard Safety Protocol"}</p>
                  <p><b className="text-paper">Conductor:</b> {detail.safety_briefing.toolbox_conductor || "Foreman / Engineer"}</p>
                  {detail.safety_briefing.hazards_identified ? (
                    <p className="sm:col-span-2 text-amber-300"><b className="text-paper">Hazards Noted:</b> {detail.safety_briefing.hazards_identified}</p>
                  ) : null}
                </div>
              </section>
            ) : null}

            <section className="border border-ink-mid p-4"><h3 className="mb-2 font-mono text-xs uppercase tracking-widest text-paper">Site narrative</h3><p className="whitespace-pre-line text-sm text-slate-light">{text(active.actual_work, "No actual work summary recorded.")}</p></section>
            {isDraft ? (
              <section className="grid gap-4 xl:grid-cols-3">
                <LineForm title="Labour" action={() => addLine("labour")} saving={saving === "labour"}>
                  <select value={labour.employee_id} onChange={(e) => setLabour({ ...labour, employee_id: e.target.value })} className={fieldClass}><option value="">Employee</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{text(employee.employee_name ?? employee.name ?? employee.full_name, employee.id)}</option>)}</select>
                  <input value={labour.role_on_site} onChange={(e) => setLabour({ ...labour, role_on_site: e.target.value })} placeholder="Role on site" className={fieldClass} />
                  <input value={labour.regular_hours} onChange={(e) => setLabour({ ...labour, regular_hours: e.target.value })} placeholder="Regular hours" className={fieldClass} />
                  <input value={labour.cost_rate} onChange={(e) => setLabour({ ...labour, cost_rate: e.target.value })} placeholder="Cost rate" className={fieldClass} />
                </LineForm>
                <LineForm title="Equipment" action={() => addLine("equipment")} saving={saving === "equipment"}>
                  <select value={equipment.fleet_id} onChange={(e) => setEquipment({ ...equipment, fleet_id: e.target.value })} className={fieldClass}><option value="">Fleet asset</option>{fleet.map((asset) => <option key={asset.id} value={asset.id}>{text(asset.asset_code ?? asset.vehicle_registration ?? asset.name, asset.id)}</option>)}</select>
                  <select value={equipment.operator_employee_id} onChange={(e) => setEquipment({ ...equipment, operator_employee_id: e.target.value })} className={fieldClass}><option value="">Operator (optional)</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{text(employee.employee_name ?? employee.name ?? employee.full_name, employee.id)}</option>)}</select>
                  <input value={equipment.operating_hours} onChange={(e) => setEquipment({ ...equipment, operating_hours: e.target.value })} placeholder="Operating hours" className={fieldClass} />
                  <input value={equipment.cost_rate} onChange={(e) => setEquipment({ ...equipment, cost_rate: e.target.value })} placeholder="Cost rate" className={fieldClass} />
                </LineForm>
                <LineForm title="Materials" action={() => addLine("material")} saving={saving === "material"}>
                  <select value={material.item_id} onChange={(e) => setMaterial({ ...material, item_id: e.target.value })} className={fieldClass}><option value="">Inventory item</option>{inventoryItems.map((item) => <option key={item.id} value={item.id}>{text(item.item_name ?? item.name, item.id)}{item.stock_quantity !== undefined ? ` · stock ${item.stock_quantity}` : ""}</option>)}</select>
                  <select value={material.store_id} onChange={(e) => setMaterial({ ...material, store_id: e.target.value })} className={fieldClass}><option value="">Store (optional)</option>{stores.map((store) => <option key={store.id} value={store.id}>{text(store.name ?? store.store_code, store.id)} · {text(store.store_type, "store")}</option>)}</select>
                  <input value={material.quantity_used} onChange={(e) => setMaterial({ ...material, quantity_used: e.target.value })} placeholder="Quantity used" className={fieldClass} />
                  <input value={material.unit_cost} onChange={(e) => setMaterial({ ...material, unit_cost: e.target.value })} placeholder="Unit cost" className={fieldClass} />
                  <input value={material.work_package} onChange={(e) => setMaterial({ ...material, work_package: e.target.value })} placeholder="Work package" className={fieldClass} />
                </LineForm>
              </section>
            ) : null}
            <section className="border border-ink-mid p-4"><h3 className="mb-3 font-mono text-xs uppercase tracking-widest text-paper">Approval timeline</h3>{detail?.approvals.length ? detail.approvals.map((approval) => <p key={approval.id} className="text-sm text-slate-light">{text(approval.workflow_key)} · {text(approval.status)} · submitted {dateValue(approval.submitted_at)}</p>) : <p className="text-sm text-slate-light">No approval instance yet.</p>}</section>
            <section className="flex flex-wrap gap-3 border-t border-ink-mid pt-5">
              {isDraft ? <Btn onClick={() => transition("submit")} busy={saving === "submit"} icon={<Send className="h-4 w-4" />}>Submit for approval</Btn> : null}
              {isSubmitted ? <Btn tone="success" onClick={() => transition("approved")} busy={saving === "approved"} icon={<CheckCircle2 className="h-4 w-4" />}>Approve and post costs</Btn> : null}
              {isSubmitted ? <Btn tone="danger" onClick={() => transition("rejected")} busy={saving === "rejected"} icon={<X className="h-4 w-4" />}>Reject</Btn> : null}
            </section>
          </div>
        )}
      </aside>
    </div>
  );
}

function EvidenceCard({ icon, label, count }: { icon: ReactNode; label: string; count: number }) {
  return <div className="border border-ink-mid bg-ink-light/40 p-4"><div className="flex items-center justify-between text-slate"><span className="[&_svg]:h-4 [&_svg]:w-4">{icon}</span><span className="font-mono text-xl text-paper">{count}</span></div><p className="mt-3 font-mono text-xs uppercase tracking-wider text-slate-light">{label}</p></div>;
}

function LineForm({ title, children, action, saving }: { title: string; children: ReactNode; action: () => void; saving: boolean }) {
  return <div className="space-y-3 border border-ink-mid p-4"><h3 className="font-mono text-xs uppercase tracking-widest text-paper">{title}</h3>{children}<Btn tone="ghost" onClick={action} busy={saving} icon={<Plus className="h-4 w-4" />}>Add {title}</Btn></div>;
}
