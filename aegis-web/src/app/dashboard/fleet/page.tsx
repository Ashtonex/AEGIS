"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { RBACGuard } from "@/components/auth/RBACGuard";
import { ApiError, createPlantRequest, getComplianceDeploymentGateChecks, getFleet, getPlantLifecycleSummary, getPlantRequests } from "@/lib/api";
import { EntityDocumentsPanel } from "@/components/documents/EntityDocumentsPanel";
import { AssignmentPanel } from "@/components/documents/AssignmentPanel";
import { useApiQueries } from "@/hooks/useApiQueries";
import { useLiveTable } from "@/lib/live/LiveDataProvider";
import { OperationalTable, TableHeader, TableRow, TableHead, TableCell } from "@/components/ui/OperationalTable";
import { EmptyState as SharedEmptyState } from "@/components/ui/EmptyState";
import { RegisterAssetModal, AssignmentModal, WorkOrderModal } from "@/components/fleet/AssetOperationsModals";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Filter,
  Gauge,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Send,
  FilePlus2,
  ShieldCheck,
  ShieldAlert,
  Truck,
  Wrench,
  XCircle,
} from "lucide-react";

type FleetRecord = Record<string, unknown> & { id: string };

const ACTIVE_STATUSES = new Set(["active", "available", "deployed", "in service", "operational"]);
const MAINTENANCE_STATUSES = new Set(["maintenance", "in maintenance", "repair", "service", "out of service"]);

function text(record: FleetRecord, ...keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (value !== null && value !== undefined && String(value).trim()) return String(value);
  }
  return "";
}

function number(record: FleetRecord, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

function formatMoney(value: number | null): string {
  if (value === null) return "Not recorded";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function formatNumber(value: number | null, suffix = ""): string {
  if (value === null) return "Not recorded";
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}${suffix}`;
}

function normalizedStatus(record: FleetRecord): string {
  return text(record, "status", "operational_status", "availability_status").trim().toLowerCase();
}

function displayStatus(record: FleetRecord): string {
  const value = text(record, "status", "operational_status", "availability_status");
  return value || "Not recorded";
}

function assetName(record: FleetRecord): string {
  return text(record, "name", "asset_name", "description", "registration_number", "asset_code") || "Unnamed asset";
}

function assetReference(record: FleetRecord): string {
  return text(record, "asset_code", "registration_number", "fleet_number", "code") || record.id.slice(0, 8).toUpperCase();
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(date);
}

function normalizeLoadError(reason: unknown, fallback: string) {
  const message = reason instanceof Error ? reason.message : String(reason ?? "");
  if (/aborted|cancelled|timed out|network error|fetch failed|not found/i.test(message)) {
    return fallback;
  }
  return fallback;
}

function dateFrom(record: FleetRecord, ...keys: string[]): string | null {
  const value = text(record, ...keys);
  return value ? formatDate(value) : null;
}

function dateValue(record: FleetRecord, ...keys: string[]): number | null {
  const value = text(record, ...keys);
  const time = value ? Date.parse(value) : Number.NaN;
  return Number.isNaN(time) ? null : time;
}

function assetFinancials(record: FleetRecord) {
  const operatingHours = number(record, "operating_hours_month", "operating_hours", "hours", "hour_meter") ?? 0;
  const idleHours = number(record, "idle_hours_month", "idle_hours") ?? 0;
  const hourlyChargeRate = number(record, "hourly_charge_rate", "charge_rate", "hire_rate");
  const hourlyOperatingCost = number(record, "hourly_operating_cost", "operating_cost_rate");
  const idleHourCost = number(record, "idle_hour_cost");
  const monthlyOwnershipCost = number(record, "monthly_ownership_cost", "ownership_cost_month");
  const revenue = number(record, "monthly_revenue", "revenue_amount", "total_revenue") ?? (hourlyChargeRate !== null ? operatingHours * hourlyChargeRate : null);
  const operatingCost = number(record, "monthly_operating_cost", "cost_amount", "total_cost")
    ?? ((hourlyOperatingCost !== null || idleHourCost !== null || monthlyOwnershipCost !== null)
      ? (operatingHours * (hourlyOperatingCost ?? 0)) + (idleHours * (idleHourCost ?? 0)) + (monthlyOwnershipCost ?? 0)
      : null);
  const margin = revenue !== null && operatingCost !== null ? revenue - operatingCost : null;
  return { operatingHours, idleHours, hourlyChargeRate, hourlyOperatingCost, idleHourCost, monthlyOwnershipCost, revenue, operatingCost, margin };
}

function readinessItems(record: FleetRecord) {
  const financials = assetFinancials(record);
  return [
    { label: "Project allocation", ready: Boolean(text(record, "current_project_id", "assigned_project", "project_name", "location", "site")), detail: text(record, "project_name", "assigned_project", "location", "site", "current_project_id") || "No active project allocation" },
    { label: "Operator assignment", ready: Boolean(text(record, "operator", "operator_name", "assigned_to", "assigned_to_user_id")), detail: text(record, "operator", "operator_name", "assigned_to", "assigned_to_user_id") || "No operator assigned" },
    { label: "Hours captured", ready: financials.operatingHours > 0, detail: financials.operatingHours > 0 ? formatNumber(financials.operatingHours, " hrs") : "No utilisation hours this period" },
    { label: "Rate card configured", ready: financials.hourlyChargeRate !== null && financials.hourlyOperatingCost !== null, detail: financials.hourlyChargeRate !== null && financials.hourlyOperatingCost !== null ? `${formatMoney(financials.hourlyChargeRate)} charge / ${formatMoney(financials.hourlyOperatingCost)} cost` : "Charge and operating cost rates incomplete" },
    { label: "Finance cost allocation", ready: financials.operatingCost !== null && financials.operatingCost > 0, detail: financials.operatingCost !== null && financials.operatingCost > 0 ? formatMoney(financials.operatingCost) : "No posted operating, fuel, ownership, or maintenance cost" },
  ];
}

const PLANT_READINESS_CONTROLS = [
  { key: "technical_specification", label: "Technical specification", detail: "Class, capacity, terrain, attachments and operating requirements approved." },
  { key: "source_decision", label: "Source decision", detail: "Internal allocation, external hire, purchase or subcontract route selected." },
  { key: "budget_approval", label: "Budget approval", detail: "Rates, transport, fuel, operator, maintenance and recovery costs approved." },
  { key: "asset_identified", label: "Asset identified", detail: "Asset number, hire unit or subcontracted plant resource named." },
  { key: "availability_no_overlap", label: "No allocation clash", detail: "Reservation and active allocation conflicts checked." },
  { key: "inspection_fit", label: "Inspection fit", detail: "Condition inspection complete and critical defects cleared." },
  { key: "compliance_documents", label: "Compliance documents", detail: "Insurance, licences, permits, certificates and service records current." },
  { key: "operator_verified", label: "Operator verified", detail: "Competent operator or technician assigned and verified." },
  { key: "site_readiness", label: "Site readiness", detail: "Access, unloading, ground, parking, security and work zones confirmed." },
  { key: "transport_approved", label: "Transport approved", detail: "Transporter, route, permits, loading and dispatch documents approved." },
  { key: "fuel_controls", label: "Fuel controls", detail: "Fuel allocation, custodian, register, limits and delivery plan set." },
  { key: "maintenance_controls", label: "Maintenance controls", detail: "Pre-start, weekly inspection, service and breakdown controls set." },
  { key: "plant_manager_declaration", label: "Plant Manager declaration", detail: "Plant Manager has declared the asset ready to mobilise." },
] as const;

function plantReadinessPack(record: FleetRecord): Record<string, unknown> {
  return record.readiness_pack && typeof record.readiness_pack === "object" && !Array.isArray(record.readiness_pack)
    ? record.readiness_pack as Record<string, unknown>
    : {};
}

function plantReadinessCount(record: FleetRecord) {
  const pack = plantReadinessPack(record);
  return PLANT_READINESS_CONTROLS.filter(item => Boolean(pack[item.key])).length;
}

function plantBlockers(record: FleetRecord): string[] {
  return Array.isArray(record.readiness_blockers) ? record.readiness_blockers.map(String) : [];
}

function StatusPill({ record }: { record: FleetRecord }) {
  const status = normalizedStatus(record);
  const style = ACTIVE_STATUSES.has(status)
    ? "border-green-500/40 bg-green-500/10 text-green-300"
    : MAINTENANCE_STATUSES.has(status)
      ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
      : "border-slate/50 bg-ink-light text-slate-light";
  return <span className={`inline-flex border px-2 py-1 font-mono text-[10px] uppercase tracking-wider ${style}`}>{displayStatus(record)}</span>;
}

export default function FleetTrackerPage() {
  return <RBACGuard allowedRoles={["Executive (Admin)", "Fleet Supervisor", "Fleet Clerk", "Maintenance Planner", "Executive Read Only"]}><FleetTrackerDashboard /></RBACGuard>;
}

type FleetModalKind = "register" | "edit" | "deploy" | "work-order" | "plant-request" | null;

function FleetTrackerDashboard() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [modal, setModal] = useState<FleetModalKind>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const { data, warnings, error, isLoading: loading, refetch: loadFleet } = useApiQueries(
    {
      fleet: () => getFleet(),
      gates: () => getComplianceDeploymentGateChecks({ limit: 50 }),
      plantSummary: () => getPlantLifecycleSummary(),
      plantRequests: () => getPlantRequests(),
    },
    [],
    { criticalKeys: ["fleet"], labels: { gates: "Deployment gate checks", plantSummary: "Plant lifecycle summary", plantRequests: "Plant requests" } }
  );

  const assets = useMemo(
    () => (Array.isArray(data.fleet?.data) ? data.fleet.data.filter((item): item is FleetRecord => Boolean(item && typeof item === "object" && item.id)) : []),
    [data.fleet]
  );
  const deploymentGateChecks = useMemo(
    () => (Array.isArray(data.gates?.data) ? data.gates.data.filter((item): item is FleetRecord => Boolean(item && typeof item === "object" && item.id)) : []),
    [data.gates]
  );
  const plantRequests = useMemo(
    () => (Array.isArray(data.plantRequests?.data) ? data.plantRequests.data.filter((item): item is FleetRecord => Boolean(item && typeof item === "object" && item.id)) : []),
    [data.plantRequests]
  );
  const plantSummary = (data.plantSummary?.data && typeof data.plantSummary.data === "object" ? data.plantSummary.data : {}) as Record<string, unknown>;
  const errorMessage = error
    ? error instanceof ApiError && error.status === 403
      ? "You do not have permission to read the fleet register."
      : normalizeLoadError(error, "Fleet records could not be loaded. Verify the API connection and try again.")
    : null;
  const gateWarning = warnings[0] ?? null;
  const plantWarning = warnings.find(warning => /plant/i.test(warning)) ?? null;

  useLiveTable("fleet.fleet", () => void loadFleet());
  useLiveTable("fleet.plant_requests", () => void loadFleet());

  useEffect(() => {
    setSelectedId(current => assets.some(asset => asset.id === current) ? current : (assets[0]?.id ?? null));
  }, [assets]);

  useEffect(() => {
    if (!loading && !error) setLastUpdated(new Date());
  }, [loading, error]);

  const statuses = useMemo(() => Array.from(new Set(assets.map(normalizedStatus).filter(Boolean))).sort(), [assets]);
  const filteredAssets = useMemo(() => assets.filter(asset => {
    const searchable = [assetName(asset), assetReference(asset), text(asset, "type", "asset_type", "make", "model", "location", "site")].join(" ").toLowerCase();
    return (statusFilter === "all" || normalizedStatus(asset) === statusFilter) && searchable.includes(query.trim().toLowerCase());
  }), [assets, query, statusFilter]);
  const selected = assets.find(asset => asset.id === selectedId) ?? null;
  const selectedGateChecks = useMemo(() => selected ? deploymentGateChecks.filter(gate => String(gate.fleet_id ?? "") === selected.id) : [], [deploymentGateChecks, selected]);

  const metrics = useMemo(() => {
    const active = assets.filter(asset => ACTIVE_STATUSES.has(normalizedStatus(asset))).length;
    const maintenance = assets.filter(asset => MAINTENANCE_STATUSES.has(normalizedStatus(asset))).length;
    const inspections = assets.filter(asset => dateValue(asset, "last_inspection_at", "inspection_date", "last_inspection_date") !== null).length;
    const overdue = assets.filter(asset => {
      const due = dateValue(asset, "next_maintenance_at", "next_maintenance_date", "maintenance_due_date", "next_inspection_at");
      return due !== null && due < Date.now();
    }).length;
    const totalHours = assets.reduce((sum, asset) => sum + (number(asset, "operating_hours", "hours", "hour_meter") ?? 0), 0);
    const blockedGates = deploymentGateChecks.filter(gate => text(gate, "status").toLowerCase() === "blocked").length;
    return { active, maintenance, inspections, overdue, totalHours, blockedGates };
  }, [assets, deploymentGateChecks]);

  const evidence = useMemo(() => assets.flatMap(asset => {
    const items: { asset: FleetRecord; title: string; value: string; issue: boolean }[] = [];
    const maintenanceDue = dateFrom(asset, "next_maintenance_at", "next_maintenance_date", "maintenance_due_date");
    const inspection = dateFrom(asset, "last_inspection_at", "inspection_date", "last_inspection_date");
    const dueTime = dateValue(asset, "next_maintenance_at", "next_maintenance_date", "maintenance_due_date");
    if (maintenanceDue) items.push({ asset, title: "Maintenance due", value: maintenanceDue, issue: dueTime !== null && dueTime < Date.now() });
    if (inspection) items.push({ asset, title: "Last inspection", value: inspection, issue: false });
    return items;
  }).sort((a, b) => Number(b.issue) - Number(a.issue)).slice(0, 8), [assets]);

  return (
    <main className="min-h-screen bg-ink p-4 text-paper md:p-7">
      <div className="mx-auto max-w-[1600px]">
        <header className="mb-6 flex flex-col justify-between gap-4 border-b border-ink-mid pb-5 md:flex-row md:items-end">
          <div>
            <div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-slate"><Truck size={14} /> Operations / Fleet register</div>
            <h1 className="text-2xl font-semibold tracking-wide text-paper">Fleet Operations</h1>
            <p className="mt-1 text-sm text-slate-light">Asset availability, service evidence, and operating exposure from the controlled fleet register.</p>
          </div>
          <div className="flex items-center gap-3">
            {lastUpdated && <span className="font-mono text-[10px] uppercase tracking-wider text-slate">Read {lastUpdated.toLocaleTimeString()}</span>}
            <button type="button" onClick={() => void loadFleet()} disabled={loading} className="inline-flex items-center gap-2 border border-ink-mid bg-ink-light px-3 py-2 text-xs font-medium text-paper hover:border-slate disabled:opacity-50"><RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh</button>
            <button type="button" onClick={() => setModal("plant-request")} className="inline-flex items-center gap-2 border border-signal/60 bg-signal/10 px-3 py-2 text-xs font-semibold text-signal hover:bg-signal/15"><FilePlus2 size={14} /> New Plant Request</button>
            <button type="button" onClick={() => setModal("register")} className="inline-flex items-center gap-2 bg-signal px-3 py-2 text-xs font-semibold text-ink hover:bg-signal/90"><Plus size={14} /> Register Vehicle</button>
          </div>
        </header>

        {notice && <div className="mb-5 flex items-start gap-3 border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm text-emerald-100"><CheckCircle2 size={18} className="mt-0.5 shrink-0" /><p>{notice}</p></div>}
        {errorMessage && <div className="mb-5 flex items-start gap-3 border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-100"><ShieldAlert size={18} className="mt-0.5 shrink-0" /><div><p className="font-semibold">Fleet register unavailable</p><p className="mt-1 text-red-100/80">{errorMessage}</p></div></div>}
        {gateWarning && <div className="mb-5 flex items-start gap-3 border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100"><AlertTriangle size={18} className="mt-0.5 shrink-0" /><div><p className="font-semibold">Deployment gate history unavailable</p><p className="mt-1 text-amber-100/80">{gateWarning}</p></div></div>}
        {plantWarning && <div className="mb-5 flex items-start gap-3 border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100"><AlertTriangle size={18} className="mt-0.5 shrink-0" /><div><p className="font-semibold">Plant lifecycle records unavailable</p><p className="mt-1 text-amber-100/80">{plantWarning}</p></div></div>}

        {loading && !data.fleet ? <div className="flex min-h-80 items-center justify-center border border-ink-mid bg-ink"><Loader2 className="animate-spin text-slate-light" size={26} /></div> : !errorMessage && assets.length === 0 ? (
          <SharedEmptyState
            icon={Truck}
            title="No fleet assets have been recorded"
            description="The fleet register is empty for your organisation. Add assets through the controlled fleet register before using operational reporting."
          />
        ) : !errorMessage && <>
          <section className="mb-6 grid gap-px overflow-hidden border border-ink-mid bg-ink-mid sm:grid-cols-2 lg:grid-cols-6">
            <Metric icon={<Truck size={17} />} label="Registered assets" value={assets.length} />
            <Metric icon={<CheckCircle2 size={17} />} label="Operational" value={metrics.active} tone="text-green-300" />
            <Metric icon={<Wrench size={17} />} label="In maintenance" value={metrics.maintenance} tone="text-amber-200" />
            <Metric icon={<ClipboardCheck size={17} />} label="Inspection evidence" value={metrics.inspections} detail="assets with recorded inspection" />
            <Metric icon={<AlertTriangle size={17} />} label="Overdue controls" value={metrics.overdue} tone={metrics.overdue ? "text-red-300" : "text-slate-light"} />
            <Metric icon={<ShieldCheck size={17} />} label="Blocked deployments" value={metrics.blockedGates} tone={metrics.blockedGates ? "text-red-300" : "text-slate-light"} />
          </section>

          <section className="mb-6 border border-ink-mid bg-ink">
            <div className="flex flex-col gap-3 border-b border-ink-mid p-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-sm font-semibold">Plant & Equipment lifecycle control</h2>
                <p className="mt-1 text-xs text-slate-light">Request, validation, reservation, dispatch, daily evidence, return and financial closure pipeline.</p>
              </div>
              <span className="font-mono text-[10px] uppercase tracking-wider text-slate">No request without a record</span>
            </div>
            <div className="grid gap-px bg-ink-mid sm:grid-cols-2 lg:grid-cols-6">
              <Metric icon={<FilePlus2 size={17} />} label="Open requests" value={Number(plantSummary.open_requests ?? 0)} />
              <Metric icon={<ClipboardCheck size={17} />} label="Validation queue" value={Number(plantSummary.validation_queue ?? 0)} />
              <Metric icon={<ShieldCheck size={17} />} label="Approval queue" value={Number(plantSummary.approval_queue ?? 0)} />
              <Metric icon={<Send size={17} />} label="Dispatch queue" value={Number(plantSummary.dispatch_queue ?? 0)} />
              <Metric icon={<Truck size={17} />} label="Active plant jobs" value={Number(plantSummary.active_deployments ?? 0)} />
              <Metric icon={<AlertTriangle size={17} />} label="Serious incidents" value={Number(plantSummary.serious_incidents ?? 0)} tone={Number(plantSummary.serious_incidents ?? 0) ? "text-red-300" : "text-slate-light"} />
            </div>
            {plantRequests.length === 0 ? (
              <div className="p-5 text-sm text-slate-light">No controlled Plant Requests have been raised yet.</div>
            ) : (
              <OperationalTable className="min-w-[980px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Request</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Asset Need</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Pre-mobilisation</TableHead>
                    <TableHead>Risk</TableHead>
                    <TableHead>Closure</TableHead>
                  </TableRow>
                </TableHeader>
                <tbody>
                  {plantRequests.slice(0, 8).map((request) => {
                    const risk = text(request, "risk_level") || "normal";
                    const blockers = plantBlockers(request);
                    const readinessStatus = text(request, "readiness_status") || "not_started";
                    const readinessCount = plantReadinessCount(request);
                    return (
                      <TableRow key={request.id}>
                        <TableCell><p className="font-medium text-paper">{text(request, "request_number") || request.id.slice(0, 8)}</p><p className="mt-1 text-[11px] text-slate-light">{text(request, "project_name", "client_display_name") || "No project/client linked"}</p></TableCell>
                        <TableCell>{text(request, "request_type").replaceAll("_", " ") || "Not recorded"}</TableCell>
                        <TableCell>{text(request, "required_asset_type")} x {String(request.quantity ?? 1)}</TableCell>
                        <TableCell>{text(request, "work_location") || "Not recorded"}</TableCell>
                        <TableCell><span className="inline-flex border border-slate/40 bg-ink-light px-2 py-1 font-mono text-[10px] uppercase text-slate-light">{text(request, "status").replaceAll("_", " ")}</span></TableCell>
                        <TableCell>
                          <span className={`inline-flex border px-2 py-1 font-mono text-[10px] uppercase ${readinessStatus === "ready" ? "border-green-500/30 bg-green-500/10 text-green-200" : blockers.length ? "border-red-500/40 bg-red-500/10 text-red-200" : "border-amber-500/40 bg-amber-500/10 text-amber-200"}`}>
                            {readinessStatus.replaceAll("_", " ")} {readinessCount}/{PLANT_READINESS_CONTROLS.length}
                          </span>
                          {blockers.length > 0 && <p className="mt-1 max-w-56 truncate text-[11px] text-slate-light">{blockers[0]}</p>}
                        </TableCell>
                        <TableCell><span className={`inline-flex border px-2 py-1 font-mono text-[10px] uppercase ${risk === "critical" || risk === "high" ? "border-red-500/40 bg-red-500/10 text-red-200" : "border-green-500/30 bg-green-500/10 text-green-200"}`}>{risk}</span></TableCell>
                        <TableCell>{text(request, "closure_status").replaceAll("_", " ") || "not started"}</TableCell>
                      </TableRow>
                    );
                  })}
                </tbody>
              </OperationalTable>
            )}
          </section>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(340px,0.9fr)]">
            <section className="border border-ink-mid bg-ink">
              <div className="flex flex-col gap-3 border-b border-ink-mid p-4 lg:flex-row lg:items-center lg:justify-between">
                <div><h2 className="text-sm font-semibold">Asset register</h2><p className="mt-1 text-xs text-slate-light">Select an asset to inspect persisted operational records.</p></div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <label className="flex items-center gap-2 border border-ink-mid bg-ink-light px-3 py-2"><Search size={14} className="text-slate" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search assets" className="w-full bg-transparent text-xs text-paper outline-none placeholder:text-slate sm:w-36" /></label>
                  <label className="flex items-center gap-2 border border-ink-mid bg-ink-light px-3 py-2"><Filter size={14} className="text-slate" /><select value={statusFilter} onChange={event => setStatusFilter(event.target.value)} className="bg-transparent text-xs text-paper outline-none"><option value="all">All states</option>{statuses.map(status => <option key={status} value={status}>{status}</option>)}</select></label>
                </div>
              </div>
              {filteredAssets.length === 0 ? <div className="p-10 text-center text-sm text-slate-light">No registered assets match this filter.</div> : (
                <OperationalTable>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Asset</TableHead>
                      <TableHead>Class</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Location / allocation</TableHead>
                      <TableHead>Hours</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <tbody>
                    {filteredAssets.map(asset => (
                      <TableRow key={asset.id} onClick={() => setSelectedId(asset.id)} className={`cursor-pointer ${asset.id === selectedId ? "bg-ink" : ""}`}>
                        <TableCell><p className="font-medium text-paper">{assetName(asset)}</p><p className="mt-1 font-mono text-[10px] text-slate">{assetReference(asset)}</p></TableCell>
                        <TableCell>{text(asset, "type", "asset_type", "category") || "Not recorded"}</TableCell>
                        <TableCell><StatusPill record={asset} /></TableCell>
                        <TableCell>{text(asset, "location", "site", "assigned_project", "project_name") || "Not allocated"}</TableCell>
                        <TableCell>{number(asset, "operating_hours", "hours", "hour_meter")?.toLocaleString() ?? "-"}</TableCell>
                        <TableCell><ChevronRight size={16} /></TableCell>
                      </TableRow>
                    ))}
                  </tbody>
                </OperationalTable>
              )}
            </section>

            <aside className="space-y-6">
              <section className="border border-ink-mid bg-ink"><div className="border-b border-ink-mid p-4"><h2 className="text-sm font-semibold">Control evidence</h2><p className="mt-1 text-xs text-slate-light">Only fields captured on fleet records are displayed.</p></div>{evidence.length ? <div>{evidence.map(({ asset, title, value, issue }) => <button type="button" key={`${asset.id}-${title}`} onClick={() => setSelectedId(asset.id)} className="flex w-full items-center gap-3 border-b border-ink-mid/70 p-4 text-left hover:bg-ink-light"><div className={issue ? "text-red-300" : "text-slate-light"}>{issue ? <AlertTriangle size={17} /> : <ClipboardCheck size={17} />}</div><div className="min-w-0 flex-1"><p className="text-xs font-medium text-paper">{assetName(asset)}</p><p className="mt-1 text-xs text-slate-light">{title}: {value}</p></div><ChevronRight size={15} className="text-slate" /></button>)}</div> : <div className="p-5 text-sm text-slate-light">No maintenance or inspection evidence has been captured yet.</div>}</section>
              <section className="border border-ink-mid bg-ink p-4"><div className="flex items-center gap-2 text-slate-light"><Gauge size={16} /><h2 className="text-sm font-semibold text-paper">Utilisation basis</h2></div><p className="mt-3 text-sm text-slate-light">{metrics.totalHours > 0 ? `${metrics.totalHours.toLocaleString()} recorded operating hours across the register.` : "Operating-hour readings have not been captured for this register."}</p><p className="mt-2 text-xs text-slate">Utilisation rates are not estimated without recorded hour or allocation data.</p></section>
            </aside>
          </div>

          <section className="mt-6 border border-ink-mid bg-ink">
            <div className="flex items-start justify-between gap-4 border-b border-ink-mid p-4">
              <div>
                <h2 className="text-sm font-semibold">Equipment assignment gate status</h2>
                <p className="mt-1 text-xs text-slate-light">Scenario C/F control: operator deployments are blocked when employment, competence, training, medical or operating-certificate requirements fail.</p>
              </div>
              <ShieldCheck size={18} className="text-slate-light" />
            </div>
            {deploymentGateChecks.length === 0 ? <div className="p-5 text-sm text-slate-light">No equipment assignment gate checks have been recorded yet.</div> : (
              <OperationalTable className="min-w-[900px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Asset</TableHead>
                    <TableHead>Operator</TableHead>
                    <TableHead>Project</TableHead>
                    <TableHead>Result</TableHead>
                    <TableHead>Missing credential evidence</TableHead>
                  </TableRow>
                </TableHeader>
                <tbody>
                  {deploymentGateChecks.slice(0, 8).map((gate) => {
                    const missing = Array.isArray(gate.missing_requirements) ? gate.missing_requirements : [];
                    const gateStatus = text(gate, "status") || "pending";
                    return (
                      <TableRow key={gate.id}>
                        <TableCell>{dateFrom(gate, "checked_at") || "Not recorded"}</TableCell>
                        <TableCell className="text-paper">{text(gate, "asset_code", "vehicle_registration", "fleet_id") || "General asset"}</TableCell>
                        <TableCell>{text(gate, "employee_name", "employee_number") || "Unknown operator"}</TableCell>
                        <TableCell>{text(gate, "project_name") || "No project"}</TableCell>
                        <TableCell><span className={`inline-flex border px-2 py-1 font-mono text-[10px] uppercase ${gateStatus.toLowerCase() === "blocked" ? "border-red-500/30 bg-red-950/20 text-red-300" : "border-green-500/30 bg-green-950/20 text-green-300"}`}>{gateStatus}</span></TableCell>
                        <TableCell>{missing.length ? missing.map((item: FleetRecord) => text(item, "certification_name", "reason") || "Missing requirement").join(", ") : "Requirements satisfied"}</TableCell>
                      </TableRow>
                    );
                  })}
                </tbody>
              </OperationalTable>
            )}
          </section>

          {selected && (
            <AssetDetail
              selected={selected}
              gateChecks={selectedGateChecks}
              onDeploy={() => setModal("deploy")}
              onWorkOrder={() => setModal("work-order")}
              onEdit={() => setModal("edit")}
            />
          )}
        </>}
      </div>

      {modal === "plant-request" && (
        <PlantRequestModal
          onClose={() => setModal(null)}
          onSuccess={(reference) => { setModal(null); setNotice(`Plant request ${reference} created.`); void loadFleet(); }}
        />
      )}
      {modal === "register" && (
        <RegisterAssetModal
          assetNoun="Vehicle"
          onClose={() => setModal(null)}
          onSuccess={() => { setModal(null); setNotice("Vehicle registered."); void loadFleet(); }}
        />
      )}
      {modal === "edit" && selected && (
        <RegisterAssetModal
          assetNoun="Vehicle"
          editingAsset={selected}
          onClose={() => setModal(null)}
          onSuccess={() => { setModal(null); setNotice("Vehicle updated."); void loadFleet(); }}
        />
      )}
      {modal === "deploy" && selected && (
        <AssignmentModal
          assetId={selected.id}
          assetLabel={assetName(selected)}
          onClose={() => setModal(null)}
          onSuccess={() => { setModal(null); setNotice("Deployment created."); void loadFleet(); }}
        />
      )}
      {modal === "work-order" && selected && (
        <WorkOrderModal
          assetId={selected.id}
          assetLabel={assetName(selected)}
          onClose={() => setModal(null)}
          onSuccess={() => { setModal(null); setNotice("Work order created."); void loadFleet(); }}
        />
      )}
    </main>
  );
}

function Metric({ icon, label, value, detail, tone = "text-paper" }: { icon: ReactNode; label: string; value: number; detail?: string; tone?: string }) {
  return <div className="bg-ink p-4"><div className="flex items-center gap-2 text-slate">{icon}<span className="font-mono text-[10px] uppercase tracking-wider">{label}</span></div><p className={`mt-4 text-2xl font-semibold ${tone}`}>{value}</p>{detail && <p className="mt-1 text-[11px] text-slate-light">{detail}</p>}</div>;
}

function RecordField({ label, value }: { label: string; value: string }) {
  return <div className="p-4"><p className="font-mono text-[10px] uppercase tracking-wider text-slate">{label}</p><p className="mt-2 text-sm text-paper">{value}</p></div>;
}

function PlantRequestModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: (reference: string) => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    request_type: "internal_project",
    required_asset_type: "",
    quantity: "1",
    work_location: "",
    start_date: today,
    end_date: "",
    operating_hours_mode: "normal",
    operator_required: false,
    fuel_responsibility: "snc",
    transport_requirement: "drive",
    work_description: "",
    cost_centre: "",
    priority: "routine",
    expected_revenue: "0",
    estimated_cost: "0",
    risk_level: "normal",
  });
  const [readiness, setReadiness] = useState<Record<string, boolean>>(
    Object.fromEntries(PLANT_READINESS_CONTROLS.map(item => [item.key, false]))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fieldClass = "w-full border border-ink-mid bg-ink-light px-3 py-2 text-sm text-paper outline-none placeholder:text-slate focus:border-signal";

  const patch = (key: keyof typeof form, value: string | boolean) => setForm(current => ({ ...current, [key]: value }));
  const patchReadiness = (key: string, value: boolean) => setReadiness(current => ({ ...current, [key]: value }));

  async function submit() {
    setError(null);
    if (!form.required_asset_type.trim() || !form.work_location.trim() || !form.work_description.trim()) {
      setError("Asset need, work location and work description are required.");
      return;
    }
    setSaving(true);
    try {
      const response = await createPlantRequest({
        request_type: form.request_type,
        required_asset_type: form.required_asset_type.trim(),
        quantity: Number(form.quantity) || 1,
        work_location: form.work_location.trim(),
        start_date: form.start_date,
        end_date: form.end_date || undefined,
        operating_hours_mode: form.operating_hours_mode,
        operator_required: form.operator_required,
        fuel_responsibility: form.fuel_responsibility,
        transport_requirement: form.transport_requirement,
        work_description: form.work_description.trim(),
        cost_centre: form.cost_centre.trim() || undefined,
        priority: form.priority,
        expected_revenue: Number(form.expected_revenue) || 0,
        estimated_cost: Number(form.estimated_cost) || 0,
        risk_level: form.risk_level,
        commercial_terms: {},
        risk_assessment: {},
        readiness_pack: readiness,
      });
      onSuccess(response.data?.request_number || response.data?.id || "created");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Plant request could not be created.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto border border-ink-mid bg-ink shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-ink-mid p-5">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate">Plant & Equipment control</p>
            <h2 className="mt-1 text-lg font-semibold text-paper">New Plant Request</h2>
          </div>
          <button type="button" onClick={onClose} className="border border-ink-mid px-3 py-1.5 text-xs text-slate-light hover:border-slate hover:text-paper">Close</button>
        </div>
        {error && <div className="m-5 border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-100">{error}</div>}
        <div className="grid gap-4 p-5 md:grid-cols-2">
          <label className="space-y-1"><span className="font-mono text-[10px] uppercase text-slate">Request type</span><select value={form.request_type} onChange={event => patch("request_type", event.target.value)} className={fieldClass}><option value="internal_project">Internal project</option><option value="external_hire">External hire</option><option value="maintenance">Maintenance</option><option value="emergency">Emergency</option><option value="mobilisation">Mobilisation</option><option value="department_transfer">Department transfer</option><option value="tender_capacity">Tender capacity</option></select></label>
          <label className="space-y-1"><span className="font-mono text-[10px] uppercase text-slate">Priority</span><select value={form.priority} onChange={event => patch("priority", event.target.value)} className={fieldClass}><option value="routine">Routine</option><option value="urgent">Urgent</option><option value="emergency">Emergency</option></select></label>
          <label className="space-y-1"><span className="font-mono text-[10px] uppercase text-slate">Required asset</span><input value={form.required_asset_type} onChange={event => patch("required_asset_type", event.target.value)} placeholder="Excavator, tipper, generator" className={fieldClass} /></label>
          <label className="space-y-1"><span className="font-mono text-[10px] uppercase text-slate">Quantity</span><input type="number" min="1" value={form.quantity} onChange={event => patch("quantity", event.target.value)} className={fieldClass} /></label>
          <label className="space-y-1"><span className="font-mono text-[10px] uppercase text-slate">Work location</span><input value={form.work_location} onChange={event => patch("work_location", event.target.value)} placeholder="Exact site or yard" className={fieldClass} /></label>
          <label className="space-y-1"><span className="font-mono text-[10px] uppercase text-slate">Cost centre</span><input value={form.cost_centre} onChange={event => patch("cost_centre", event.target.value)} placeholder="Project or department code" className={fieldClass} /></label>
          <label className="space-y-1"><span className="font-mono text-[10px] uppercase text-slate">Start date</span><input type="date" value={form.start_date} onChange={event => patch("start_date", event.target.value)} className={fieldClass} /></label>
          <label className="space-y-1"><span className="font-mono text-[10px] uppercase text-slate">Expected off-hire</span><input type="date" value={form.end_date} onChange={event => patch("end_date", event.target.value)} className={fieldClass} /></label>
          <label className="space-y-1"><span className="font-mono text-[10px] uppercase text-slate">Operating hours</span><select value={form.operating_hours_mode} onChange={event => patch("operating_hours_mode", event.target.value)} className={fieldClass}><option value="normal">Normal</option><option value="extended">Extended</option><option value="continuous">Continuous</option></select></label>
          <label className="space-y-1"><span className="font-mono text-[10px] uppercase text-slate">Fuel responsibility</span><select value={form.fuel_responsibility} onChange={event => patch("fuel_responsibility", event.target.value)} className={fieldClass}><option value="snc">SNC</option><option value="project">Project</option><option value="client">Client</option></select></label>
          <label className="space-y-1"><span className="font-mono text-[10px] uppercase text-slate">Transport</span><select value={form.transport_requirement} onChange={event => patch("transport_requirement", event.target.value)} className={fieldClass}><option value="drive">Drive</option><option value="low_bed">Low-bed</option><option value="tow">Tow</option><option value="collection">Collection</option><option value="none">None</option></select></label>
          <label className="space-y-1"><span className="font-mono text-[10px] uppercase text-slate">Risk level</span><select value={form.risk_level} onChange={event => patch("risk_level", event.target.value)} className={fieldClass}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="critical">Critical</option></select></label>
          <label className="flex items-center gap-3 border border-ink-mid bg-ink-light px-3 py-2 text-sm text-paper"><input type="checkbox" checked={form.operator_required} onChange={event => patch("operator_required", event.target.checked)} /> Operator required</label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1"><span className="font-mono text-[10px] uppercase text-slate">Expected revenue</span><input type="number" min="0" value={form.expected_revenue} onChange={event => patch("expected_revenue", event.target.value)} className={fieldClass} /></label>
            <label className="space-y-1"><span className="font-mono text-[10px] uppercase text-slate">Estimated cost</span><input type="number" min="0" value={form.estimated_cost} onChange={event => patch("estimated_cost", event.target.value)} className={fieldClass} /></label>
          </div>
          <label className="space-y-1 md:col-span-2"><span className="font-mono text-[10px] uppercase text-slate">Work description</span><textarea value={form.work_description} onChange={event => patch("work_description", event.target.value)} rows={4} placeholder="Intended activity and site instructions" className={fieldClass} /></label>
          <section className="border border-ink-mid bg-ink-light p-4 md:col-span-2">
            <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate">Pre-mobilisation readiness pack</p>
                <h3 className="mt-1 text-sm font-semibold text-paper">Plant Manager mobilisation controls</h3>
              </div>
              <span className="font-mono text-[10px] uppercase tracking-wider text-slate-light">{Object.values(readiness).filter(Boolean).length}/{PLANT_READINESS_CONTROLS.length} complete</span>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {PLANT_READINESS_CONTROLS.map(item => (
                <label key={item.key} className="flex items-start gap-3 border border-ink-mid bg-ink p-3 text-sm text-paper">
                  <input type="checkbox" checked={Boolean(readiness[item.key])} onChange={event => patchReadiness(item.key, event.target.checked)} className="mt-1" />
                  <span>
                    <span className="block text-xs font-semibold">{item.label}</span>
                    <span className="mt-1 block text-xs leading-5 text-slate-light">{item.detail}</span>
                  </span>
                </label>
              ))}
            </div>
          </section>
        </div>
        <div className="flex justify-end gap-3 border-t border-ink-mid p-5">
          <button type="button" onClick={onClose} className="border border-ink-mid px-4 py-2 text-sm text-slate-light hover:border-slate hover:text-paper">Cancel</button>
          <button type="button" onClick={() => void submit()} disabled={saving} className="inline-flex items-center gap-2 bg-signal px-4 py-2 text-sm font-semibold text-ink disabled:opacity-60">{saving && <Loader2 size={14} className="animate-spin" />} Create Request</button>
        </div>
      </div>
    </div>
  );
}

function AssetDetail({
  selected,
  gateChecks,
  onDeploy,
  onWorkOrder,
  onEdit,
}: {
  selected: FleetRecord;
  gateChecks: FleetRecord[];
  onDeploy: () => void;
  onWorkOrder: () => void;
  onEdit: () => void;
}) {
  const financials = assetFinancials(selected);
  const readiness = readinessItems(selected);
  const readyCount = readiness.filter(item => item.ready).length;

  return (
    <section className="mt-6 border border-ink-mid bg-ink">
      <div className="flex flex-col gap-3 border-b border-ink-mid p-4 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wider text-slate">Asset record</p>
          <h2 className="mt-1 text-lg font-semibold text-paper">{assetName(selected)}</h2>
          <p className="mt-1 font-mono text-[11px] text-slate-light">{assetReference(selected)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill record={selected} />
          <button type="button" onClick={onEdit} className="border border-ink-mid px-3 py-1.5 text-xs text-slate-light hover:border-slate hover:text-paper">Edit</button>
          <button type="button" onClick={onWorkOrder} className="inline-flex items-center gap-1.5 border border-ink-mid px-3 py-1.5 text-xs text-slate-light hover:border-slate hover:text-paper"><Wrench size={13} /> Work Order</button>
          <button type="button" onClick={onDeploy} className="inline-flex items-center gap-1.5 bg-signal px-3 py-1.5 text-xs font-semibold text-ink hover:bg-signal/90"><Send size={13} /> Deploy</button>
        </div>
      </div>
      <div className="grid divide-y divide-ink-mid md:grid-cols-3 md:divide-x md:divide-y-0">
        <RecordField label="Classification" value={text(selected, "type", "asset_type", "category", "make") || "Not recorded"} />
        <RecordField label="Assigned location" value={text(selected, "location", "site", "assigned_project", "project_name") || "Not allocated"} />
        <RecordField label="Assigned operator" value={text(selected, "operator", "operator_name", "assigned_to") || "Not assigned"} />
        <RecordField label="Operating hours" value={formatNumber(number(selected, "operating_hours", "hours", "hour_meter"))} />
        <RecordField label="Next maintenance" value={dateFrom(selected, "next_maintenance_at", "next_maintenance_date", "maintenance_due_date") || "Not recorded"} />
        <RecordField label="Last inspection" value={dateFrom(selected, "last_inspection_at", "inspection_date", "last_inspection_date") || "Not recorded"} />
      </div>
      <div className="border-t border-ink-mid p-4">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-light">Record notes</h3>
        <p className="text-sm leading-6 text-paper">{text(selected, "notes", "maintenance_notes", "description") || "No operational notes have been recorded for this asset."}</p>
      </div>
      <div className="border-t border-ink-mid p-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate">Scenario B cost/profitability control</p>
            <h3 className="mt-1 text-base font-semibold text-paper">Equipment to Finance</h3>
            <p className="mt-1 max-w-3xl text-sm text-slate-light">This asset must carry project allocation, operator, hours, fuel, downtime, maintenance, and cost postings before management can trust project and plant-hire profitability.</p>
          </div>
          <span className="border border-ink-mid bg-ink-light px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-slate-light">Cost allocation readiness {readyCount}/{readiness.length}</span>
        </div>
        <div className="mt-4 grid gap-px overflow-hidden border border-ink-mid bg-ink-mid sm:grid-cols-2 lg:grid-cols-4">
          <RecordField label="Hourly charge rate" value={formatMoney(financials.hourlyChargeRate)} />
          <RecordField label="Hourly operating cost" value={formatMoney(financials.hourlyOperatingCost)} />
          <RecordField label="Monthly ownership cost" value={formatMoney(financials.monthlyOwnershipCost)} />
          <RecordField label="Utilisation" value={`${formatNumber(financials.operatingHours, " operating hrs")} / ${formatNumber(financials.idleHours, " idle hrs")}`} />
          <RecordField label="Estimated revenue" value={formatMoney(financials.revenue)} />
          <RecordField label="Estimated operating cost" value={formatMoney(financials.operatingCost)} />
          <RecordField label="Estimated margin" value={formatMoney(financials.margin)} />
          <RecordField label="Finance source" value={text(selected, "cost_transaction_id", "current_assignment_id") || "Awaiting utilisation/fuel/maintenance posting"} />
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {readiness.map(item => (
            <div key={item.label} className="border border-ink-mid bg-ink-light p-3">
              <div className={`mb-2 ${item.ready ? "text-green-300" : "text-amber-200"}`}>{item.ready ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}</div>
              <p className="text-xs font-semibold text-paper">{item.label}</p>
              <p className="mt-1 text-xs leading-5 text-slate-light">{item.detail}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 border border-ink-mid bg-ink-light p-4">
          <h4 className="font-mono text-[10px] uppercase tracking-wider text-slate">Linked equipment assignment gate evidence</h4>
          {gateChecks.length ? <div className="mt-3 space-y-2">{gateChecks.map((gate) => { const missing = Array.isArray(gate.missing_requirements) ? gate.missing_requirements : []; return <div key={gate.id} className="border border-ink-mid bg-ink p-3"><p className="text-sm text-paper">{text(gate, "status") || "pending"} · {dateFrom(gate, "checked_at") || "time not recorded"}</p><p className="mt-1 text-xs text-slate-light">{missing.length ? missing.map((item: FleetRecord) => text(item, "certification_name", "reason") || "Missing requirement").join(", ") : "Requirements satisfied"}</p></div>; })}</div> : <p className="mt-3 text-sm text-slate-light">No deployment gate checks are linked to this asset yet.</p>}
        </div>
      </div>
      <div className="border-t border-ink-mid p-4">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-light">Documents</h3>
        <EntityDocumentsPanel entityType="fleet" entityId={selected.id} />
      </div>
      <div className="border-t border-ink-mid p-4">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-light">Assigned To</h3>
        <AssignmentPanel entityType="fleet" entityId={selected.id} />
      </div>
    </section>
  );
}
