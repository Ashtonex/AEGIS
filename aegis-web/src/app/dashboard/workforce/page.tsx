"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, BadgeCheck, CalendarClock, CheckCircle2, ChevronRight,
  CircleAlert, FileText, Loader2, MapPin, RefreshCw, Search, ShieldCheck,
  Users, X,
} from "lucide-react";
import { RBACGuard } from "@/components/auth/RBACGuard";
import { getComplianceDeploymentGateChecks, getComplianceItems, getHrRecords, getWorkforce } from "@/lib/api";

type RecordData = Record<string, unknown>;
type Employee = RecordData & { id: string; employee_name?: string; job_title?: string; status?: string };

function stringValue(value: unknown, fallback = "Not recorded") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeWorkforceLoadError(reason: unknown) {
  const rawMessage = reason instanceof Error ? reason.message : String(reason ?? "");
  const normalizedMessage = rawMessage.toLowerCase();

  if (
    normalizedMessage.includes("signal is aborted") ||
    normalizedMessage.includes("operation was aborted") ||
    normalizedMessage.includes("aborterror") ||
    normalizedMessage.includes("timeouterror")
  ) {
    return "The workforce register is still synchronizing. Please retry once the connection is ready.";
  }

  return "The workforce register could not be loaded.";
}

function dateValue(value: unknown) {
  if (!value) return "Not recorded";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat("en-ZW", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

function employeeName(employee: Employee) {
  return stringValue(employee.employee_name ?? employee.name ?? employee.full_name, "Unnamed employee");
}

function employeeRole(employee: Employee) {
  return stringValue(employee.job_title ?? employee.role ?? employee.position, "Role not recorded");
}

function employeeLocation(employee: Employee) {
  return stringValue(employee.location ?? employee.project_name ?? employee.site ?? employee.assigned_location, "Unassigned");
}

function statusClass(status: unknown) {
  const normalized = stringValue(status, "unknown").toLowerCase();
  if (/(active|on shift|available|deployed)/.test(normalized)) return "border-emerald-500/30 bg-emerald-950/20 text-emerald-300";
  if (/(leave|inactive|suspended|unavailable)/.test(normalized)) return "border-amber-500/30 bg-amber-950/20 text-amber-300";
  return "border-slate-500/30 bg-slate-950/20 text-slate-300";
}

function complianceState(item: RecordData) {
  const expiry = item.expiry_date ?? item.expiry ?? item.valid_until;
  if (!expiry) return { label: "No expiry recorded", tone: "text-slate-light", due: null as Date | null };
  const due = new Date(String(expiry));
  if (Number.isNaN(due.getTime())) return { label: "Expiry date invalid", tone: "text-amber-300", due: null as Date | null };
  const days = Math.ceil((due.getTime() - Date.now()) / 86_400_000);
  if (days < 0) return { label: "Expired", tone: "text-red-300", due };
  if (days <= 60) return { label: "Due within 60 days", tone: "text-amber-300", due };
  return { label: "Current", tone: "text-emerald-300", due };
}

export default function WorkforceDashboard() {
  return <RBACGuard allowedRoles={["Executive (Admin)", "HR Manager", "Project Manager"]}><WorkforceWorkspace /></RBACGuard>;
}

function WorkforceWorkspace() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [hrRecords, setHrRecords] = useState<RecordData[]>([]);
  const [compliance, setCompliance] = useState<RecordData[]>([]);
  const [deploymentGateChecks, setDeploymentGateChecks] = useState<RecordData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sourceWarnings, setSourceWarnings] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [selected, setSelected] = useState<Employee | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSourceWarnings([]);
    try {
      const [workforceResult, hrResult, complianceResult, gateResult] = await Promise.allSettled([
        getWorkforce(),
        getHrRecords(),
        getComplianceItems(),
        getComplianceDeploymentGateChecks({ limit: 50 }),
      ]);
      if (workforceResult.status === "rejected") {
        throw new Error(normalizeWorkforceLoadError(workforceResult.reason));
      }
      const warnings: string[] = [];
      if (hrResult.status === "rejected") warnings.push("HR document records could not be loaded; employee register remains available.");
      if (complianceResult.status === "rejected") warnings.push("Compliance records could not be loaded; employee register remains available.");
      if (gateResult.status === "rejected") warnings.push("Deployment gate checks could not be loaded; allocation prevention remains enforced by the API.");
      setEmployees(Array.isArray(workforceResult.value.data) ? workforceResult.value.data as Employee[] : []);
      setHrRecords(hrResult.status === "fulfilled" && Array.isArray(hrResult.value.data) ? hrResult.value.data as RecordData[] : []);
      setCompliance(complianceResult.status === "fulfilled" && Array.isArray(complianceResult.value.data) ? complianceResult.value.data as RecordData[] : []);
      setDeploymentGateChecks(gateResult.status === "fulfilled" && Array.isArray(gateResult.value.data) ? gateResult.value.data as RecordData[] : []);
      setSourceWarnings(warnings);
    } catch (reason) {
      setEmployees([]);
      setHrRecords([]);
      setCompliance([]);
      setDeploymentGateChecks([]);
      setSourceWarnings([]);
      setError(normalizeWorkforceLoadError(reason));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const statuses = useMemo(() => Array.from(new Set(employees.map((employee) => stringValue(employee.status, "unknown").toLowerCase()))).sort(), [employees]);
  const filteredEmployees = useMemo(() => employees.filter((employee) => {
    const matchingText = [employeeName(employee), employeeRole(employee), employeeLocation(employee), stringValue(employee.status, "")]
      .some((value) => value.toLowerCase().includes(query.trim().toLowerCase()));
    return matchingText && (status === "all" || stringValue(employee.status, "unknown").toLowerCase() === status);
  }), [employees, query, status]);
  const metrics = useMemo(() => {
    const knownStatus = employees.filter((employee) => Boolean(employee.status)).length;
    const assigned = employees.filter((employee) => employeeLocation(employee) !== "Unassigned").length;
    const expiring = compliance.filter((item) => {
      const state = complianceState(item);
      return state.label === "Expired" || state.label === "Due within 60 days";
    }).length;
    const blocked = deploymentGateChecks.filter((gate) => String(gate.status ?? "").toLowerCase() === "blocked").length;
    return { knownStatus, assigned, expiring, blocked };
  }, [employees, compliance, deploymentGateChecks]);
  const relatedRecords = useMemo(() => selected ? hrRecords.filter((record) => String(record.workforce_id ?? record.employee_id ?? "") === selected.id) : [], [hrRecords, selected]);
  const selectedGateChecks = useMemo(() => selected ? deploymentGateChecks.filter((gate) => String(gate.subject_employee_id ?? "") === selected.id) : [], [deploymentGateChecks, selected]);

  return (
    <main className="min-h-full bg-ink p-4 text-paper sm:p-6">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-ink-mid pb-5">
        <div>
          <p className="mb-1 flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-signal"><Users className="h-4 w-4" />People operations</p>
          <h1 className="font-display text-3xl font-bold">Workforce Command</h1>
          <p className="mt-1 text-sm text-slate-light">Live employee register, documented assignments, and compliance evidence.</p>
        </div>
        <button onClick={() => void load()} disabled={loading} className="inline-flex h-10 items-center gap-2 border border-ink-mid bg-ink-light px-3 font-mono text-xs uppercase tracking-wider text-slate-light hover:border-signal hover:text-paper disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh
        </button>
      </header>

      <section className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Employee register" value={loading ? "..." : String(employees.length)} detail="Active employee records" icon={Users} />
        <Metric label="Recorded assignments" value={loading ? "..." : String(metrics.assigned)} detail="Location or project field present" icon={MapPin} />
        <Metric label="Status captured" value={loading ? "..." : `${metrics.knownStatus}/${employees.length}`} detail="Records with an operational status" icon={CheckCircle2} />
        <Metric label="Compliance attention" value={loading ? "..." : String(metrics.expiring)} detail="Expired or due within 60 days" icon={ShieldCheck} tone={metrics.expiring ? "text-amber-300" : "text-slate-light"} />
        <Metric label="Blocked deployments" value={loading ? "..." : String(metrics.blocked)} detail="Latest compliance gate failures" icon={AlertTriangle} tone={metrics.blocked ? "text-red-300" : "text-slate-light"} />
      </section>

      {error ? <section className="mb-6 flex gap-3 border border-red-500/30 bg-red-950/20 p-4 text-sm text-red-200"><CircleAlert className="h-5 w-5 shrink-0" />{error}</section> : null}
      {sourceWarnings.length > 0 ? <section className="mb-6 space-y-2">{sourceWarnings.map((warning) => <div key={warning} className="flex gap-3 border border-amber-500/30 bg-amber-950/20 p-3 text-sm text-amber-100"><AlertTriangle className="h-4 w-4 shrink-0 text-amber-300" />{warning}</div>)}</section> : null}

      <section className="border border-ink-mid bg-ink">
        <div className="flex flex-col gap-3 border-b border-ink-mid p-4 lg:flex-row lg:items-center lg:justify-between">
          <div><h2 className="font-mono text-sm font-bold uppercase tracking-wider">Employee register</h2><p className="mt-1 text-xs text-slate-light">Select a person to inspect only their stored workforce and HR-document records.</p></div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="flex h-10 items-center gap-2 border border-ink-mid bg-ink-light px-3"><Search className="h-4 w-4 text-slate" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, role, location" className="w-full bg-transparent text-sm outline-none placeholder:text-slate" /></label>
            <select value={status} onChange={(event) => setStatus(event.target.value)} className="h-10 border border-ink-mid bg-ink-light px-3 text-sm text-paper"><option value="all">All statuses</option>{statuses.map((value) => <option key={value} value={value}>{value}</option>)}</select>
          </div>
        </div>
        {loading ? <LoadingBlock label="Loading workforce register" /> : filteredEmployees.length === 0 ? <EmptyBlock title="No employee records match this view" detail={employees.length ? "Adjust the search or status filter." : "No active employee records have been created for this organisation."} /> : (
          <div className="overflow-x-auto"><table className="min-w-[800px] w-full text-left"><thead className="border-b border-ink-mid font-mono text-[10px] uppercase tracking-widest text-slate"><tr><th className="px-4 py-3 font-normal">Employee</th><th className="px-4 py-3 font-normal">Role</th><th className="px-4 py-3 font-normal">Assignment</th><th className="px-4 py-3 font-normal">Status</th><th className="px-4 py-3" /></tr></thead><tbody>{filteredEmployees.map((employee) => <tr key={employee.id} className="border-b border-ink-mid/60 hover:bg-ink-light/70"><td className="px-4 py-3"><p className="text-sm text-paper">{employeeName(employee)}</p><p className="mt-1 font-mono text-[10px] text-slate">{employee.id}</p></td><td className="px-4 py-3 text-sm text-slate-light">{employeeRole(employee)}</td><td className="px-4 py-3 text-sm text-slate-light">{employeeLocation(employee)}</td><td className="px-4 py-3"><span className={`inline-flex border px-2 py-1 font-mono text-[10px] uppercase ${statusClass(employee.status)}`}>{stringValue(employee.status, "Status not recorded")}</span></td><td className="px-4 py-3 text-right"><button onClick={() => setSelected(employee)} className="inline-flex items-center gap-1 font-mono text-xs uppercase tracking-wider text-signal hover:text-paper">Inspect <ChevronRight className="h-4 w-4" /></button></td></tr>)}</tbody></table></div>
        )}
      </section>

      <section className="mt-6 border border-ink-mid bg-ink">
        <div className="flex items-start justify-between gap-4 border-b border-ink-mid p-4"><div><h2 className="font-mono text-sm font-bold uppercase tracking-wider">Compliance register</h2><p className="mt-1 text-xs text-slate-light">Organisation compliance items currently held in the ERP. This register does not infer employee certification ownership where no link is stored.</p></div><BadgeCheck className="h-5 w-5 text-signal" /></div>
        {loading ? <LoadingBlock label="Loading compliance register" /> : compliance.length === 0 ? <EmptyBlock title="No compliance items recorded" detail="Add compliance evidence in the controlled compliance register to monitor expiry." /> : <div className="divide-y divide-ink-mid/60">{compliance.map((item) => { const state = complianceState(item); return <div key={String(item.id)} className="flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="text-sm text-paper">{stringValue(item.certificate_name ?? item.name ?? item.title, "Untitled compliance item")}</p><p className="mt-1 flex items-center gap-1 text-xs text-slate-light"><CalendarClock className="h-3.5 w-3.5" />Expiry: {dateValue(item.expiry_date ?? item.expiry ?? item.valid_until)}</p></div><span className={`font-mono text-xs uppercase ${state.tone}`}>{state.label}</span></div>; })}</div>}
      </section>

      <section className="mt-6 border border-ink-mid bg-ink">
        <div className="flex items-start justify-between gap-4 border-b border-ink-mid p-4">
          <div>
            <h2 className="font-mono text-sm font-bold uppercase tracking-wider">Workforce deployment gate status</h2>
            <p className="mt-1 text-xs text-slate-light">Scenario C/F control: expired, missing or unverified credentials block workforce and equipment-operator deployment before allocation is committed.</p>
          </div>
          <ShieldCheck className="h-5 w-5 text-signal" />
        </div>
        {loading ? <LoadingBlock label="Loading deployment gate checks" /> : deploymentGateChecks.length === 0 ? <EmptyBlock title="No deployment gate checks recorded" detail="Gate checks appear here after workforce allocations or equipment operator assignments are attempted." /> : (
          <div className="overflow-x-auto">
            <table className="min-w-[900px] w-full text-left">
              <thead className="border-b border-ink-mid font-mono text-[10px] uppercase tracking-widest text-slate">
                <tr><th className="px-4 py-3 font-normal">Time</th><th className="px-4 py-3 font-normal">Employee</th><th className="px-4 py-3 font-normal">Deployment</th><th className="px-4 py-3 font-normal">Result</th><th className="px-4 py-3 font-normal">Missing credential evidence</th></tr>
              </thead>
              <tbody>
                {deploymentGateChecks.slice(0, 8).map((gate) => {
                  const missing = Array.isArray(gate.missing_requirements) ? gate.missing_requirements : [];
                  const gateStatus = stringValue(gate.status, "pending");
                  return <tr key={String(gate.id)} className="border-b border-ink-mid/60"><td className="px-4 py-3 text-xs text-slate-light">{dateValue(gate.checked_at)}</td><td className="px-4 py-3 text-sm text-paper">{stringValue(gate.employee_name ?? gate.employee_number, "Unknown employee")}</td><td className="px-4 py-3 text-xs text-slate-light">{stringValue(gate.project_name ?? gate.asset_code ?? gate.vehicle_registration ?? gate.gate_type, "General deployment")}</td><td className="px-4 py-3"><span className={`inline-flex border px-2 py-1 font-mono text-[10px] uppercase ${gateStatus.toLowerCase() === "blocked" ? "border-red-500/30 bg-red-950/20 text-red-300" : statusClass(gateStatus)}`}>{gateStatus}</span></td><td className="px-4 py-3 text-xs text-slate-light">{missing.length ? missing.map((item: RecordData) => stringValue(item.certification_name ?? item.reason, "Missing requirement")).join(", ") : "Requirements satisfied"}</td></tr>;
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selected ? <EmployeeDrawer employee={selected} records={relatedRecords} gateChecks={selectedGateChecks} onClose={() => setSelected(null)} /> : null}
    </main>
  );
}

function Metric({ label, value, detail, icon: Icon, tone = "text-paper" }: { label: string; value: string; detail: string; icon: typeof Users; tone?: string }) {
  return <article className="border border-ink-mid bg-ink-light p-4"><div className="flex items-center justify-between"><p className="font-mono text-[10px] uppercase tracking-widest text-slate">{label}</p><Icon className="h-4 w-4 text-signal" /></div><p className={`mt-4 font-mono text-2xl ${tone}`}>{value}</p><p className="mt-1 text-xs text-slate-light">{detail}</p></article>;
}

function LoadingBlock({ label }: { label: string }) { return <div className="flex min-h-48 items-center justify-center gap-3 text-sm text-slate-light"><Loader2 className="h-5 w-5 animate-spin text-signal" />{label}</div>; }
function EmptyBlock({ title, detail }: { title: string; detail: string }) { return <div className="flex min-h-48 flex-col items-center justify-center p-6 text-center"><AlertTriangle className="h-7 w-7 text-slate" /><p className="mt-3 text-sm text-paper">{title}</p><p className="mt-1 max-w-lg text-xs text-slate-light">{detail}</p></div>; }

function EmployeeDrawer({ employee, records, gateChecks, onClose }: { employee: Employee; records: RecordData[]; gateChecks: RecordData[]; onClose: () => void }) {
  const attributes = Object.entries(employee).filter(([key, value]) => !["id", "organization_id", "created_by", "is_deleted"].includes(key) && value !== null && value !== "");
  return <div className="fixed inset-0 z-50 flex justify-end bg-black/60" role="dialog" aria-modal="true" aria-label="Employee record"><aside className="h-full w-full max-w-2xl overflow-y-auto border-l border-ink-mid bg-ink shadow-2xl"><header className="sticky top-0 flex items-start justify-between gap-4 border-b border-ink-mid bg-ink p-5"><div><p className="font-mono text-[10px] uppercase tracking-widest text-signal">Employee record</p><h2 className="mt-1 font-display text-2xl text-paper">{employeeName(employee)}</h2><p className="mt-1 text-sm text-slate-light">{employeeRole(employee)}</p></div><button onClick={onClose} aria-label="Close employee record" className="p-2 text-slate hover:text-paper"><X className="h-5 w-5" /></button></header><div className="space-y-6 p-5"><section><h3 className="font-mono text-xs uppercase tracking-widest text-slate">Stored workforce fields</h3><dl className="mt-3 grid gap-px border border-ink-mid bg-ink-mid sm:grid-cols-2">{attributes.map(([key, value]) => <div key={key} className="bg-ink p-3"><dt className="font-mono text-[10px] uppercase tracking-wider text-slate">{key.replace(/_/g, " ")}</dt><dd className="mt-1 break-words text-sm text-paper">{typeof value === "object" ? JSON.stringify(value) : String(value)}</dd></div>)}</dl></section><section><h3 className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-slate"><ShieldCheck className="h-4 w-4" />Deployment gate evidence</h3>{gateChecks.length ? <div className="mt-3 divide-y divide-ink-mid border border-ink-mid">{gateChecks.map((gate) => { const missing = Array.isArray(gate.missing_requirements) ? gate.missing_requirements : []; return <div key={String(gate.id)} className="p-3"><p className="text-sm text-paper">{stringValue(gate.gate_type, "Deployment gate").replaceAll("_", " ")}</p><p className="mt-1 text-xs text-slate-light">Result: {stringValue(gate.status, "pending")} · {missing.length ? missing.map((item: RecordData) => stringValue(item.certification_name ?? item.reason, "Missing requirement")).join(", ") : "requirements satisfied"}</p></div>; })}</div> : <p className="mt-3 text-sm text-slate-light">No deployment gate checks are linked to this employee yet.</p>}</section><section><h3 className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-slate"><FileText className="h-4 w-4" />Related HR records</h3>{records.length ? <div className="mt-3 divide-y divide-ink-mid border border-ink-mid">{records.map((record) => <div key={String(record.id)} className="p-3"><p className="text-sm text-paper">{stringValue(record.document_type ?? record.title ?? record.name, "HR record")}</p><p className="mt-1 text-xs text-slate-light">Created: {dateValue(record.created_at)}</p></div>)}</div> : <p className="mt-3 text-sm text-slate-light">No HR records are linked to this employee in the ERP.</p>}</section></div></aside></div>;
}
