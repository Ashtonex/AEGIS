"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { RBACGuard } from "@/components/auth/RBACGuard";
import { ApiError, getComplianceDeploymentGateChecks, getFleet } from "@/lib/api";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Filter,
  Gauge,
  Loader2,
  RefreshCw,
  Search,
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

function StatusPill({ record }: { record: FleetRecord }) {
  const status = normalizedStatus(record);
  const style = ACTIVE_STATUSES.has(status)
    ? "border-green-500/40 bg-green-500/10 text-green-300"
    : MAINTENANCE_STATUSES.has(status)
      ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
      : "border-slate/50 bg-ink-light text-slate-light";
  return <span className={`inline-flex border px-2 py-1 font-mono text-[10px] uppercase tracking-wider ${style}`}>{displayStatus(record)}</span>;
}

function EmptyState() {
  return (
    <div className="border border-dashed border-ink-mid bg-ink p-10 text-center">
      <Truck className="mx-auto mb-3 text-slate" size={30} />
      <h2 className="text-sm font-semibold text-paper">No fleet assets have been recorded</h2>
      <p className="mx-auto mt-2 max-w-lg text-sm text-slate-light">The fleet register is empty for your organisation. Add assets through the controlled fleet register before using operational reporting.</p>
    </div>
  );
}

export default function FleetTrackerPage() {
  return <RBACGuard allowedRoles={["Executive (Admin)", "Fleet Supervisor"]}><FleetTrackerDashboard /></RBACGuard>;
}

function FleetTrackerDashboard() {
  const [assets, setAssets] = useState<FleetRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [gateWarning, setGateWarning] = useState<string | null>(null);
  const [deploymentGateChecks, setDeploymentGateChecks] = useState<FleetRecord[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const loadFleet = useCallback(async () => {
    setLoading(true);
    setError(null);
    setGateWarning(null);
    try {
      const [fleetResult, gateResult] = await Promise.allSettled([
        getFleet(),
        getComplianceDeploymentGateChecks({ limit: 50 }),
      ]);
      if (fleetResult.status === "rejected") {
        throw fleetResult.reason;
      }
      const nextAssets = Array.isArray(fleetResult.value.data) ? fleetResult.value.data.filter((item): item is FleetRecord => Boolean(item && typeof item === "object" && item.id)) : [];
      setAssets(nextAssets);
      setDeploymentGateChecks(gateResult.status === "fulfilled" && Array.isArray(gateResult.value.data) ? gateResult.value.data.filter((item): item is FleetRecord => Boolean(item && typeof item === "object" && item.id)) : []);
      if (gateResult.status === "rejected") setGateWarning("Deployment gate checks could not be loaded; equipment assignment prevention remains enforced by the API.");
      setSelectedId(current => nextAssets.some(asset => asset.id === current) ? current : (nextAssets[0]?.id ?? null));
      setLastUpdated(new Date());
    } catch (cause) {
      setAssets([]);
      setDeploymentGateChecks([]);
      setSelectedId(null);
      setError(cause instanceof ApiError && cause.status === 403 ? "You do not have permission to read the fleet register." : normalizeLoadError(cause, "Fleet records could not be loaded. Verify the API connection and try again."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadFleet(); }, [loadFleet]);

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
          </div>
        </header>

        {error && <div className="mb-5 flex items-start gap-3 border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-100"><ShieldAlert size={18} className="mt-0.5 shrink-0" /><div><p className="font-semibold">Fleet register unavailable</p><p className="mt-1 text-red-100/80">{error}</p></div></div>}
        {gateWarning && <div className="mb-5 flex items-start gap-3 border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100"><AlertTriangle size={18} className="mt-0.5 shrink-0" /><div><p className="font-semibold">Deployment gate history unavailable</p><p className="mt-1 text-amber-100/80">{gateWarning}</p></div></div>}

        {loading ? <div className="flex min-h-80 items-center justify-center border border-ink-mid bg-ink"><Loader2 className="animate-spin text-slate-light" size={26} /></div> : !error && assets.length === 0 ? <EmptyState /> : !error && <>
          <section className="mb-6 grid gap-px overflow-hidden border border-ink-mid bg-ink-mid sm:grid-cols-2 lg:grid-cols-6">
            <Metric icon={<Truck size={17} />} label="Registered assets" value={assets.length} />
            <Metric icon={<CheckCircle2 size={17} />} label="Operational" value={metrics.active} tone="text-green-300" />
            <Metric icon={<Wrench size={17} />} label="In maintenance" value={metrics.maintenance} tone="text-amber-200" />
            <Metric icon={<ClipboardCheck size={17} />} label="Inspection evidence" value={metrics.inspections} detail="assets with recorded inspection" />
            <Metric icon={<AlertTriangle size={17} />} label="Overdue controls" value={metrics.overdue} tone={metrics.overdue ? "text-red-300" : "text-slate-light"} />
            <Metric icon={<ShieldCheck size={17} />} label="Blocked deployments" value={metrics.blockedGates} tone={metrics.blockedGates ? "text-red-300" : "text-slate-light"} />
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
              {filteredAssets.length === 0 ? <div className="p-10 text-center text-sm text-slate-light">No registered assets match this filter.</div> : <div className="overflow-x-auto"><table className="min-w-full text-left"><thead className="border-b border-ink-mid bg-ink-light font-mono text-[10px] uppercase tracking-wider text-slate"><tr><th className="px-4 py-3 font-normal">Asset</th><th className="px-4 py-3 font-normal">Class</th><th className="px-4 py-3 font-normal">Status</th><th className="px-4 py-3 font-normal">Location / allocation</th><th className="px-4 py-3 font-normal">Hours</th><th className="px-4 py-3" /></tr></thead><tbody>{filteredAssets.map(asset => <tr key={asset.id} onClick={() => setSelectedId(asset.id)} className={`cursor-pointer border-b border-ink-mid/70 text-sm hover:bg-ink-light ${asset.id === selectedId ? "bg-ink-light" : ""}`}><td className="px-4 py-3"><p className="font-medium text-paper">{assetName(asset)}</p><p className="mt-1 font-mono text-[10px] text-slate">{assetReference(asset)}</p></td><td className="px-4 py-3 text-xs text-slate-light">{text(asset, "type", "asset_type", "category") || "Not recorded"}</td><td className="px-4 py-3"><StatusPill record={asset} /></td><td className="px-4 py-3 text-xs text-slate-light">{text(asset, "location", "site", "assigned_project", "project_name") || "Not allocated"}</td><td className="px-4 py-3 font-mono text-xs text-paper">{number(asset, "operating_hours", "hours", "hour_meter")?.toLocaleString() ?? "-"}</td><td className="px-4 py-3 text-slate"><ChevronRight size={16} /></td></tr>)}</tbody></table></div>}
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
              <div className="overflow-x-auto">
                <table className="min-w-[900px] w-full text-left">
                  <thead className="border-b border-ink-mid bg-ink-light font-mono text-[10px] uppercase tracking-wider text-slate"><tr><th className="px-4 py-3 font-normal">Time</th><th className="px-4 py-3 font-normal">Asset</th><th className="px-4 py-3 font-normal">Operator</th><th className="px-4 py-3 font-normal">Project</th><th className="px-4 py-3 font-normal">Result</th><th className="px-4 py-3 font-normal">Missing credential evidence</th></tr></thead>
                  <tbody>{deploymentGateChecks.slice(0, 8).map((gate) => { const missing = Array.isArray(gate.missing_requirements) ? gate.missing_requirements : []; const gateStatus = text(gate, "status") || "pending"; return <tr key={gate.id} className="border-b border-ink-mid/70 text-sm"><td className="px-4 py-3 text-xs text-slate-light">{dateFrom(gate, "checked_at") || "Not recorded"}</td><td className="px-4 py-3 text-paper">{text(gate, "asset_code", "vehicle_registration", "fleet_id") || "General asset"}</td><td className="px-4 py-3 text-slate-light">{text(gate, "employee_name", "employee_number") || "Unknown operator"}</td><td className="px-4 py-3 text-slate-light">{text(gate, "project_name") || "No project"}</td><td className="px-4 py-3"><span className={`inline-flex border px-2 py-1 font-mono text-[10px] uppercase ${gateStatus.toLowerCase() === "blocked" ? "border-red-500/30 bg-red-950/20 text-red-300" : "border-green-500/30 bg-green-950/20 text-green-300"}`}>{gateStatus}</span></td><td className="px-4 py-3 text-xs text-slate-light">{missing.length ? missing.map((item: FleetRecord) => text(item, "certification_name", "reason") || "Missing requirement").join(", ") : "Requirements satisfied"}</td></tr>; })}</tbody>
                </table>
              </div>
            )}
          </section>

          {selected && <AssetDetail selected={selected} gateChecks={selectedGateChecks} />}
        </>}
      </div>
    </main>
  );
}

function Metric({ icon, label, value, detail, tone = "text-paper" }: { icon: ReactNode; label: string; value: number; detail?: string; tone?: string }) {
  return <div className="bg-ink p-4"><div className="flex items-center gap-2 text-slate">{icon}<span className="font-mono text-[10px] uppercase tracking-wider">{label}</span></div><p className={`mt-4 text-2xl font-semibold ${tone}`}>{value}</p>{detail && <p className="mt-1 text-[11px] text-slate-light">{detail}</p>}</div>;
}

function RecordField({ label, value }: { label: string; value: string }) {
  return <div className="p-4"><p className="font-mono text-[10px] uppercase tracking-wider text-slate">{label}</p><p className="mt-2 text-sm text-paper">{value}</p></div>;
}

function AssetDetail({ selected, gateChecks }: { selected: FleetRecord; gateChecks: FleetRecord[] }) {
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
        <StatusPill record={selected} />
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
    </section>
  );
}
