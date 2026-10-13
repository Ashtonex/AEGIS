"use client";

import { useMemo, useState } from "react";
import { RBACGuard } from "@/components/auth/RBACGuard";
import { DashboardPageHeader } from "@/components/dashboard/DashboardPageHeader";
import {
  ApiError,
  createFleetOperatorProfile,
  getFleetOperatorProfiles,
  getHREmployees,
} from "@/lib/api";
import { useApiQueries } from "@/hooks/useApiQueries";
import { useLiveTable } from "@/lib/live/LiveDataProvider";
import { OperationalTable, TableHeader, TableRow, TableHead, TableCell } from "@/components/ui/OperationalTable";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  AlertTriangle,
  Award,
  CheckCircle2,
  FileCheck,
  Filter,
  HeartPulse,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Truck,
  UserCheck,
  Users,
  X,
} from "lucide-react";

type RecordItem = Record<string, unknown> & { id: string };

function text(record: RecordItem, ...keys: string[]): string {
  for (const k of keys) {
    const v = record[k];
    if (v !== null && v !== undefined && String(v).trim()) return String(v);
  }
  return "";
}

function fmtDate(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(d);
}

export default function OperatorsSafetyPage() {
  return (
    <RBACGuard permission="fleet.operator_profiles.read">
      <OperatorsSafetyDashboard />
    </RBACGuard>
  );
}

function OperatorsSafetyDashboard() {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [notice, setNotice] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const { data, isLoading, refetch } = useApiQueries(
    {
      operators: () => getFleetOperatorProfiles(),
      employees: () => getHREmployees(),
    },
    [],
    { criticalKeys: ["operators"] }
  );

  useLiveTable("fleet.operator_profiles", () => void refetch());

  const operators = useMemo(
    () => (Array.isArray(data.operators?.data) ? data.operators.data.filter((item): item is RecordItem => Boolean(item && typeof item === "object" && item.id)) : []),
    [data.operators]
  );

  const employees = useMemo(
    () => (Array.isArray(data.employees?.data) ? data.employees.data.filter((item): item is RecordItem => Boolean(item && typeof item === "object" && item.id)) : []),
    [data.employees]
  );

  const filtered = useMemo(() => {
    return operators.filter((op) => {
      const matchSearch = [
        text(op, "employee_name"),
        text(op, "contractor_name"),
        text(op, "competency_status"),
      ]
        .join(" ")
        .toLowerCase();
      const st = text(op, "competency_status").toLowerCase();
      const matchStatus = statusFilter === "all" || st === statusFilter;
      return matchStatus && matchSearch.includes(query.toLowerCase());
    });
  }, [operators, query, statusFilter]);

  const kpis = useMemo(() => {
    const competent = operators.filter((op) => text(op, "competency_status") === "competent" && !op.suspended).length;
    const expiredMedicals = operators.filter((op) => {
      const exp = op.medical_clearance_expiry ? Date.parse(String(op.medical_clearance_expiry)) : NaN;
      return !Number.isNaN(exp) && exp < Date.now();
    }).length;
    const suspended = operators.filter((op) => Boolean(op.suspended)).length;
    const totalIncidents = operators.reduce((sum, op) => sum + (Number(op.incident_count) || 0), 0);
    return { competent, expiredMedicals, suspended, totalIncidents };
  }, [operators]);

  return (
    <main className="min-h-screen bg-ink p-4 text-paper md:p-7">
      <div className="mx-auto max-w-[1600px]">
        <DashboardPageHeader
          eyebrow={{ label: "Assets / Plant & Equipment", icon: Truck }}
          title="Operators & Safety Compliance"
          subtitle="Machine category certifications, medical fitness gates, performance scoring, and incident records."
          actions={
            <>
              <button
                type="button"
                onClick={() => void refetch()}
                disabled={isLoading}
                className="inline-flex items-center gap-2 border border-ink-mid bg-ink-light px-3 py-2 text-xs font-medium text-paper hover:border-slate disabled:opacity-50"
              >
                <RefreshCw size={14} className={isLoading ? "animate-spin" : ""} /> Refresh
              </button>
              <button
                type="button"
                onClick={() => setModalOpen(true)}
                className="inline-flex items-center gap-2 bg-signal px-3 py-2 text-xs font-semibold text-ink hover:bg-signal/90"
              >
                <Plus size={14} /> Register Operator
              </button>
            </>
          }
        />

        {notice && (
          <div className="mb-5 flex items-start gap-3 border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm text-emerald-100">
            <CheckCircle2 size={18} className="mt-0.5 shrink-0" />
            <p>{notice}</p>
          </div>
        )}

        <section className="mb-6 grid gap-px overflow-hidden border border-ink-mid bg-ink-mid sm:grid-cols-2 lg:grid-cols-4">
          <div className="bg-ink p-4">
            <span className="font-mono text-[10px] uppercase text-slate">Active Competent Operators</span>
            <p className="mt-2 text-2xl font-bold text-emerald-300">{kpis.competent}</p>
          </div>
          <div className="bg-ink p-4">
            <span className="font-mono text-[10px] uppercase text-slate">Expired Medical Fitness Gates</span>
            <p className="mt-2 text-2xl font-bold text-rose-400">{kpis.expiredMedicals}</p>
          </div>
          <div className="bg-ink p-4">
            <span className="font-mono text-[10px] uppercase text-slate">Suspended / Restricted</span>
            <p className="mt-2 text-2xl font-bold text-amber-300">{kpis.suspended}</p>
          </div>
          <div className="bg-ink p-4">
            <span className="font-mono text-[10px] uppercase text-slate">Reported Machine Incidents</span>
            <p className="mt-2 text-2xl font-bold text-purple-300">{kpis.totalIncidents}</p>
          </div>
        </section>

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 text-slate" size={14} />
              <input
                type="text"
                placeholder="Search operator, contractor..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-72 border border-ink-mid bg-ink-light py-2 pl-9 pr-3 text-xs text-paper placeholder-slate focus:border-signal focus:outline-none"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="border border-ink-mid bg-ink-light px-3 py-2 text-xs text-paper focus:border-signal focus:outline-none"
            >
              <option value="all">All Competency States</option>
              <option value="competent">Competent</option>
              <option value="pending">Pending Verification</option>
              <option value="restricted">Restricted</option>
              <option value="expired">Expired Credentials</option>
              <option value="suspended">Suspended</option>
            </select>
          </div>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No operator profiles registered"
            description="Link workforce employees to plant equipment categories, licenses, and verified medical clearances."
          />
        ) : (
          <div className="border border-ink-mid bg-ink overflow-x-auto">
            <OperationalTable className="min-w-[1100px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Operator Identity</TableHead>
                  <TableHead>Authorized Machine Categories</TableHead>
                  <TableHead>License Classes</TableHead>
                  <TableHead>Medical Clearance</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead>Incidents</TableHead>
                  <TableHead>Competency Gate</TableHead>
                </TableRow>
              </TableHeader>
              <tbody>
                {filtered.map((op) => {
                  const assignedTypes = Array.isArray(op.assigned_asset_types) ? op.assigned_asset_types : [];
                  const licenceClasses = Array.isArray(op.licence_classes) ? op.licence_classes : [];
                  const medExp = op.medical_clearance_expiry ? Date.parse(String(op.medical_clearance_expiry)) : NaN;
                  const isMedExpired = !Number.isNaN(medExp) && medExp < Date.now();
                  const st = text(op, "competency_status");
                  return (
                    <TableRow key={op.id}>
                      <TableCell>
                        <p className="font-semibold text-paper">{text(op, "employee_name", "contractor_name") || "Operator " + op.id.slice(0, 6)}</p>
                        <p className="text-[11px] text-slate-light">ID: {op.id.slice(0, 8)}</p>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1 max-w-64">
                          {assignedTypes.length > 0 ? (
                            assignedTypes.map((t, idx) => (
                              <span key={idx} className="border border-ink-mid bg-ink-light px-1.5 py-0.5 text-[10px] text-paper">
                                {String(t)}
                              </span>
                            ))
                          ) : (
                            <span className="text-[11px] text-slate">General Machinery</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {licenceClasses.map((lc, idx) => (
                            <span key={idx} className="border border-slate/40 px-1.5 py-0.5 text-[10px] font-mono text-paper">
                              {String(lc)}
                            </span>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>
                        {op.medical_clearance_expiry ? (
                          <div className={`flex items-center gap-1.5 text-xs ${isMedExpired ? "text-rose-400 font-semibold" : "text-emerald-300"}`}>
                            <HeartPulse size={13} />
                            <span>{fmtDate(String(op.medical_clearance_expiry))}</span>
                            {isMedExpired && <span className="text-[10px] uppercase font-mono">(Expired)</span>}
                          </div>
                        ) : (
                          <span className="text-slate text-xs">No medical logged</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="font-mono text-sm text-paper font-semibold">
                          {op.performance_score ? `${Number(op.performance_score)}%` : "—"}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className={`font-mono text-xs ${Number(op.incident_count ?? 0) > 0 ? "text-rose-400 font-bold" : "text-slate"}`}>
                          {String(op.incident_count ?? 0)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span
                          className={`inline-flex border px-2 py-0.5 font-mono text-[10px] uppercase ${
                            st === "competent" && !op.suspended
                              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                              : "border-rose-500/40 bg-rose-500/10 text-rose-300"
                          }`}
                        >
                          {op.suspended ? "SUSPENDED" : st}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </tbody>
            </OperationalTable>
          </div>
        )}

        {/* Modal: Register Operator */}
        {modalOpen && (
          <RegisterOperatorModal
            employees={employees}
            onClose={() => setModalOpen(false)}
            onSuccess={() => {
              setModalOpen(false);
              setNotice("Operator profile created.");
              void refetch();
            }}
          />
        )}
      </div>
    </main>
  );
}

function RegisterOperatorModal({
  employees,
  onClose,
  onSuccess,
}: {
  employees: RecordItem[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [formData, setFormData] = useState({
    employee_id: employees[0]?.id || "",
    contractor_name: "",
    assigned_asset_types: "Excavator, Bulldozer, Wheel Loader",
    licence_classes: "Class 2, Machine Operator Cert",
    medical_clearance_expiry: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    competency_status: "competent",
  });
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setErr(null);
    try {
      await createFleetOperatorProfile({
        employee_id: formData.employee_id || undefined,
        contractor_name: formData.contractor_name || undefined,
        assigned_asset_types: formData.assigned_asset_types.split(",").map((s) => s.trim()).filter(Boolean),
        licence_classes: formData.licence_classes.split(",").map((s) => s.trim()).filter(Boolean),
        medical_clearance_expiry: formData.medical_clearance_expiry || undefined,
        competency_status: formData.competency_status,
      });
      onSuccess();
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : "Failed to register operator.");
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-4 backdrop-blur-sm">
      <div className="relative w-full max-w-md border border-ink-mid bg-ink shadow-2xl">
        <div className="flex items-center justify-between border-b border-ink-mid px-5 py-4">
          <h2 className="text-sm font-semibold text-paper">Register Plant Operator Profile</h2>
          <button type="button" onClick={onClose} className="text-slate hover:text-paper">
            <X size={18} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {err && <div className="border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">{err}</div>}
          <div>
            <label className="block text-[11px] font-mono uppercase text-slate mb-1">Select HR Employee</label>
            <select
              value={formData.employee_id}
              onChange={(e) => setFormData({ ...formData, employee_id: e.target.value })}
              className="w-full border border-ink-mid bg-ink-light px-3 py-2 text-xs text-paper"
            >
              <option value="">— Or external machine contractor below —</option>
              {employees.map((e) => {
                const name =
                  text(e, "employee_name", "name", "full_name") ||
                  `${text(e, "first_name")} ${text(e, "last_name")}`.trim() ||
                  "Unnamed Employee";
                const role = text(e, "job_title", "position", "role") || "Worker";
                return (
                  <option key={e.id} value={e.id}>
                    {name} ({role})
                  </option>
                );
              })}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-mono uppercase text-slate mb-1">External Contractor Name (if not employee)</label>
            <input
              type="text"
              value={formData.contractor_name}
              onChange={(e) => setFormData({ ...formData, contractor_name: e.target.value })}
              className="w-full border border-ink-mid bg-ink-light px-3 py-2 text-xs text-paper"
              placeholder="e.g. Tendai Chikore (Subcontractor Operator)"
            />
          </div>
          <div>
            <label className="block text-[11px] font-mono uppercase text-slate mb-1">Authorized Machine Types (comma separated)</label>
            <input
              type="text"
              value={formData.assigned_asset_types}
              onChange={(e) => setFormData({ ...formData, assigned_asset_types: e.target.value })}
              className="w-full border border-ink-mid bg-ink-light px-3 py-2 text-xs text-paper"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-mono uppercase text-slate mb-1">License Classes</label>
              <input
                type="text"
                value={formData.licence_classes}
                onChange={(e) => setFormData({ ...formData, licence_classes: e.target.value })}
                className="w-full border border-ink-mid bg-ink-light px-3 py-2 text-xs text-paper"
              />
            </div>
            <div>
              <label className="block text-[11px] font-mono uppercase text-slate mb-1">Medical Expiry</label>
              <input
                type="date"
                value={formData.medical_clearance_expiry}
                onChange={(e) => setFormData({ ...formData, medical_clearance_expiry: e.target.value })}
                className="w-full border border-ink-mid bg-ink-light px-3 py-2 text-xs text-paper"
              />
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-mono uppercase text-slate mb-1">Initial Competency Status</label>
            <select
              value={formData.competency_status}
              onChange={(e) => setFormData({ ...formData, competency_status: e.target.value })}
              className="w-full border border-ink-mid bg-ink-light px-3 py-2 text-xs text-paper"
            >
              <option value="competent">Competent</option>
              <option value="pending">Pending Verification</option>
              <option value="restricted">Restricted (Training)</option>
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-ink-mid">
            <button type="button" onClick={onClose} className="px-4 py-2 text-xs text-slate hover:text-paper">
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="bg-signal px-4 py-2 text-xs font-semibold text-ink hover:bg-signal/90 disabled:opacity-50"
            >
              {submitting ? "Registering..." : "Save Operator Profile"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
