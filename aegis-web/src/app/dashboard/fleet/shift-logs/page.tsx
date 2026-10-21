"use client";

import { useMemo, useState } from "react";
import { RBACGuard } from "@/components/auth/RBACGuard";
import { DashboardPageHeader } from "@/components/dashboard/DashboardPageHeader";
import {
  ApiError,
  getFleet,
  getFleetUtilizationLogs,
  recordFleetUtilization,
  updateFleetUtilizationStatus,
} from "@/lib/api";
import { useApiQueries } from "@/hooks/useApiQueries";
import { useLiveTable } from "@/lib/live/LiveDataProvider";
import { OperationalTable, TableHeader, TableRow, TableHead, TableCell } from "@/components/ui/OperationalTable";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Filter,
  FileCheck,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Truck,
  UserCheck,
  X,
  XCircle,
  Receipt,
  FileText,
} from "lucide-react";
import { GenerateInvoiceModal } from "@/components/invoices/GenerateInvoiceModal";

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

function buildShiftLogInvoiceData(log: RecordItem) {
  const opHours = Number(log.operating_hours ?? 0);
  const idleHours = Number(log.idle_hours ?? 0);
  const hourlyRate = 120.0;
  const standingRate = 60.0;
  const assetCode = text(log, "asset_code", "vehicle_registration") || "Plant Unit";
  const category = text(log, "asset_category") || "Heavy Plant";
  const project = text(log, "project_name") || "Civil Engineering Site";
  const startM = Number(log.start_engine_hours ?? log.engine_hours ?? 0);
  const endM = Number(log.end_engine_hours ?? startM + opHours);
  const shiftDate = log.occurred_on ? fmtDate(String(log.occurred_on)) : "Recent Shift Operations";
  const invNumber = `SNC-SFT-${log.id.slice(0, 6).toUpperCase()}`;

  const items = [
    {
      item_no: "1",
      description: `${category} Operational Run (${assetCode}) — ${text(log, "work_performed") || "Productive site operations"} (${opHours.toFixed(1)} operating hrs @ $${hourlyRate.toFixed(2)}/hr | Meter: ${startM.toFixed(1)}h → ${endM.toFixed(1)}h)`,
      amount_excl_vat: opHours * hourlyRate,
      already_pro_rated: true,
    },
  ];

  if (idleHours > 0) {
    items.push({
      item_no: String(items.length + 1),
      description: `Machine Idle / Standby Delay Charge — ${idleHours.toFixed(1)} hrs @ $${standingRate.toFixed(2)}/hr (Weather downtime / awaiting site instructions)`,
      amount_excl_vat: idleHours * standingRate,
      already_pro_rated: true,
    });
  }

  if (log.output_quantity) {
    items.push({
      item_no: String(items.length + 1),
      description: `Earthworks / Output Accomplished — ${log.output_quantity} ${text(log, "output_unit") || "m³"} certified haulage / excavation output`,
      amount_excl_vat: 0.0,
      already_pro_rated: true,
    });
  }

  const notes = [
    `Shift Utilization Reference: ${invNumber} on ${shiftDate}.`,
    `Equipment: ${assetCode} (${category}), Hour Meter: ${startM.toFixed(1)}h to ${endM.toFixed(1)}h (Net active run: ${opHours.toFixed(1)}h).`,
    `Project Location: ${project}.`,
    `Assigned Operator: ${text(log, "operator_name") || "Certified SNC Equipment Operator"}.`,
    `Client Sign-Off Verification: ${text(log, "client_signoff_name") || "Verified by Resident Site Agent"}.`,
    `Payment Details: Banc ABC Southerton Branch account 54925046633016. Reference ${invNumber}.`,
  ];

  return {
    invoiceType: "TAX INVOICE" as const,
    invoiceNumber: invNumber,
    subject: `Heavy Plant Shift Utilization — ${assetCode} on ${shiftDate}`,
    clientName: project,
    clientAddress: `${project}, Zimbabwe`,
    clientVat: "220207665",
    clientTin: "2000039441",
    quotationRef: text(log, "request_number") || invNumber,
    clientPo: "—",
    depositPercentage: 0,
    applyVat: true,
    items,
    notes,
  };
}

export default function DailyShiftLogsPage() {
  return (
    <RBACGuard permission="fleet.utilization.record">
      <DailyShiftLogsDashboard />
    </RBACGuard>
  );
}

function DailyShiftLogsDashboard() {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [notice, setNotice] = useState<string | null>(null);
  const [logModalOpen, setLogModalOpen] = useState(false);
  const [invoiceModalLog, setInvoiceModalLog] = useState<RecordItem | null>(null);

  const { data, isLoading, refetch } = useApiQueries(
    {
      logs: () => getFleetUtilizationLogs({ limit: 150 }),
      fleet: () => getFleet(),
    },
    [],
    { criticalKeys: ["logs"] }
  );

  useLiveTable("fleet.utilization_logs", () => void refetch());

  const logs = useMemo(
    () => (Array.isArray(data.logs?.data) ? data.logs.data.filter((item): item is RecordItem => Boolean(item && typeof item === "object" && item.id)) : []),
    [data.logs]
  );

  const fleetAssets = useMemo(
    () => (Array.isArray(data.fleet?.data) ? data.fleet.data.filter((item): item is RecordItem => Boolean(item && typeof item === "object" && item.id)) : []),
    [data.fleet]
  );

  const filtered = useMemo(() => {
    return logs.filter((l) => {
      const matchSearch = [
        text(l, "asset_code"),
        text(l, "vehicle_registration"),
        text(l, "project_name"),
        text(l, "work_performed"),
        text(l, "client_signoff_name"),
      ]
        .join(" ")
        .toLowerCase();
      const st = text(l, "approval_status") || "submitted";
      const matchStatus = statusFilter === "all" || st === statusFilter;
      return matchStatus && matchSearch.includes(query.toLowerCase());
    });
  }, [logs, query, statusFilter]);

  const stats = useMemo(() => {
    const totalOperatingHours = logs.reduce((sum, l) => sum + (Number(l.operating_hours) || 0), 0);
    const totalIdleHours = logs.reduce((sum, l) => sum + (Number(l.idle_hours) || 0), 0);
    const pendingApproval = logs.filter((l) => ["submitted", "draft"].includes(text(l, "approval_status") || "submitted")).length;
    const verifiedByEngineer = logs.filter((l) => Boolean(text(l, "client_signoff_name"))).length;
    return { totalOperatingHours, totalIdleHours, pendingApproval, verifiedByEngineer };
  }, [logs]);

  const handleStatusUpdate = async (logId: string, newStatus: string) => {
    let rejectionReason: string | undefined;
    if (newStatus === "rejected") {
      rejectionReason = window.prompt("Reason for rejecting this Daily Plant Sheet (required):")?.trim() || undefined;
      if (!rejectionReason) return;
    }
    try {
      await updateFleetUtilizationStatus(logId, { status: newStatus, rejection_reason: rejectionReason });
      setNotice(`Shift log marked as ${newStatus}.`);
      void refetch();
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : "Failed to update shift log status.");
    }
  };

  return (
    <main className="min-h-screen bg-ink p-4 text-paper md:p-7">
      <div className="mx-auto max-w-[1600px]">
        <DashboardPageHeader
          eyebrow={{ label: "Assets / Plant & Equipment", icon: Truck }}
          title="Daily Shift Logs (Daily Plant Sheets)"
          subtitle="Electronic site logbooks: hour meters, active vs downtime categories, output volume, and resident engineer sign-off."
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
                onClick={() => setLogModalOpen(true)}
                className="inline-flex items-center gap-2 bg-signal px-3 py-2 text-xs font-semibold text-ink hover:bg-signal/90"
              >
                <Plus size={14} /> Record Shift Log (DPS)
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
            <span className="font-mono text-[10px] uppercase text-slate">Productive Operating Hours</span>
            <p className="mt-2 text-2xl font-bold text-emerald-300">{stats.totalOperatingHours.toFixed(1)} hrs</p>
          </div>
          <div className="bg-ink p-4">
            <span className="font-mono text-[10px] uppercase text-slate">Idle / Standby Hours</span>
            <p className="mt-2 text-2xl font-bold text-amber-300">{stats.totalIdleHours.toFixed(1)} hrs</p>
          </div>
          <div className="bg-ink p-4">
            <span className="font-mono text-[10px] uppercase text-slate">Awaiting Supervisor Approval</span>
            <p className="mt-2 text-2xl font-bold text-blue-300">{stats.pendingApproval}</p>
          </div>
          <div className="bg-ink p-4">
            <span className="font-mono text-[10px] uppercase text-slate">Engineer Verified Sheets</span>
            <p className="mt-2 text-2xl font-bold text-purple-300">{stats.verifiedByEngineer}</p>
          </div>
        </section>

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 text-slate" size={14} />
              <input
                type="text"
                placeholder="Search machine, project, work..."
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
              <option value="all">All Approval States</option>
              <option value="submitted">Submitted (Pending)</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="invoiced">Invoiced</option>
            </select>
          </div>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            icon={ClipboardCheck}
            title="No shift logs found"
            description="Record daily operator shift logs with start/end engine meters, downtime categories, and sign-off."
          />
        ) : (
          <div className="border border-ink-mid bg-ink overflow-x-auto">
            <OperationalTable className="min-w-[1250px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Date / Asset</TableHead>
                  <TableHead>Project / Location</TableHead>
                  <TableHead>Engine Meters</TableHead>
                  <TableHead>Operating / Idle</TableHead>
                  <TableHead>Downtimes</TableHead>
                  <TableHead>Output / Work</TableHead>
                  <TableHead>Sign-Off</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <tbody>
                {filtered.map((log) => {
                  const st = text(log, "approval_status") || "submitted";
                  const startM = Number(log.start_engine_hours ?? log.engine_hours ?? 0);
                  const endM = Number(log.end_engine_hours ?? startM + (Number(log.operating_hours) || 0));
                  return (
                    <TableRow key={log.id}>
                      <TableCell>
                        <p className="font-semibold text-paper">{log.occurred_on ? fmtDate(String(log.occurred_on)) : "—"}</p>
                        <p className="text-[11px] text-slate-light">
                          {text(log, "asset_code", "vehicle_registration")} ({text(log, "asset_category") || "Plant"})
                        </p>
                      </TableCell>
                      <TableCell>
                        <p className="font-medium text-paper">{text(log, "project_name") || "General deployment"}</p>
                        <p className="text-[11px] text-slate-light">Req: {text(log, "request_number") || "—"}</p>
                      </TableCell>
                      <TableCell>
                        <p className="font-mono text-xs text-paper">{startM.toFixed(1)}h → {endM.toFixed(1)}h</p>
                        <p className="text-[11px] text-slate-light font-mono">Δ {(endM - startM).toFixed(1)}h run time</p>
                      </TableCell>
                      <TableCell>
                        <p className="font-semibold text-emerald-300">{Number(log.operating_hours ?? 0).toFixed(1)} hrs active</p>
                        <p className="text-[11px] text-amber-300">{Number(log.idle_hours ?? 0).toFixed(1)} hrs idle</p>
                      </TableCell>
                      <TableCell>
                        <p className="text-[11px] text-slate-light">Weather: {Number(log.weather_downtime_hours ?? 0)}h</p>
                        <p className="text-[11px] text-slate-light">Breakdown: {Number(log.breakdown_downtime_hours ?? 0)}h</p>
                      </TableCell>
                      <TableCell>
                        <p className="text-xs text-paper max-w-48 truncate">{text(log, "work_performed") || "Routine operations"}</p>
                        {log.output_quantity ? (
                          <p className="text-[11px] text-signal font-mono">
                            {String(log.output_quantity)} {text(log, "output_unit")}
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        {text(log, "client_signoff_name") ? (
                          <div className="flex items-center gap-1 text-[11px] text-emerald-300">
                            <FileCheck size={13} />
                            <span>{text(log, "client_signoff_name")}</span>
                          </div>
                        ) : (
                          <span className="text-[11px] text-slate">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <span
                          className={`inline-flex border px-2 py-0.5 font-mono text-[10px] uppercase ${
                            st === "approved"
                              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                              : st === "rejected"
                              ? "border-rose-500/40 bg-rose-500/10 text-rose-300"
                              : "border-slate/40 bg-ink-light text-paper"
                          }`}
                        >
                          {st}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {st === "submitted" && (
                            <>
                              <button
                                type="button"
                                onClick={() => void handleStatusUpdate(log.id, "approved")}
                                className="border border-emerald-500/40 px-2 py-1 text-[11px] text-emerald-200 hover:bg-emerald-500/10"
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleStatusUpdate(log.id, "rejected")}
                                className="border border-rose-500/40 px-2 py-1 text-[11px] text-rose-200 hover:bg-rose-500/10"
                              >
                                Reject
                              </button>
                            </>
                          )}
                          <button
                            type="button"
                            onClick={() => setInvoiceModalLog(log)}
                            className="border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-300 hover:bg-emerald-500/20 inline-flex items-center gap-1"
                            title="Generate official client SNC Invoice for this shift run"
                          >
                            <Receipt size={11} /> Invoice
                          </button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </tbody>
            </OperationalTable>
          </div>
        )}

        {/* Modal: Record Daily Plant Sheet */}
        {logModalOpen && (
          <RecordShiftLogModal
            fleetAssets={fleetAssets}
            onClose={() => setLogModalOpen(false)}
            onSuccess={() => {
              setLogModalOpen(false);
              setNotice("Daily Plant Sheet recorded.");
              void refetch();
            }}
          />
        )}

        {/* Modal: Official SNC Invoice for Shift Utilization */}
        {invoiceModalLog && (
          <GenerateInvoiceModal
            isOpen={true}
            onClose={() => setInvoiceModalLog(null)}
            initialData={buildShiftLogInvoiceData(invoiceModalLog)}
          />
        )}
      </div>
    </main>
  );
}

function RecordShiftLogModal({
  fleetAssets,
  onClose,
  onSuccess,
}: {
  fleetAssets: RecordItem[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [formData, setFormData] = useState({
    fleet_id: fleetAssets[0]?.id || "",
    occurred_on: new Date().toISOString().slice(0, 10),
    start_engine_hours: 100,
    end_engine_hours: 108,
    operating_hours: 7.5,
    idle_hours: 0.5,
    distance_km: 0,
    weather_downtime_hours: 0,
    breakdown_downtime_hours: 0,
    standing_downtime_hours: 0,
    output_quantity: "",
    output_unit: "m³",
    work_performed: "",
    client_signoff_name: "",
    client_signoff_title: "Resident Engineer",
  });
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.fleet_id) {
      setErr("Please select an asset.");
      return;
    }
    if (formData.end_engine_hours < formData.start_engine_hours) {
      setErr("End meter reading cannot be lower than start meter reading.");
      return;
    }
    setSubmitting(true);
    setErr(null);
    try {
      await recordFleetUtilization({
        fleet_id: formData.fleet_id,
        occurred_on: formData.occurred_on,
        engine_hours: Number(formData.end_engine_hours),
        start_engine_hours: Number(formData.start_engine_hours),
        end_engine_hours: Number(formData.end_engine_hours),
        operating_hours: Number(formData.operating_hours),
        idle_hours: Number(formData.idle_hours),
        distance_km: Number(formData.distance_km || 0),
        weather_downtime_hours: Number(formData.weather_downtime_hours || 0),
        breakdown_downtime_hours: Number(formData.breakdown_downtime_hours || 0),
        standing_downtime_hours: Number(formData.standing_downtime_hours || 0),
        output_quantity: formData.output_quantity ? Number(formData.output_quantity) : undefined,
        output_unit: formData.output_unit || undefined,
        work_performed: formData.work_performed,
        client_signoff_name: formData.client_signoff_name || undefined,
        client_signoff_title: formData.client_signoff_title || undefined,
      });
      onSuccess();
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : "Failed to record Daily Plant Sheet.");
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-4 backdrop-blur-sm">
      <div className="relative w-full max-w-xl border border-ink-mid bg-ink shadow-2xl">
        <div className="flex items-center justify-between border-b border-ink-mid px-5 py-4">
          <h2 className="text-sm font-semibold text-paper">Record Daily Plant Sheet (DPS)</h2>
          <button type="button" onClick={onClose} className="text-slate hover:text-paper">
            <X size={18} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {err && <div className="border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">{err}</div>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-mono uppercase text-slate mb-1">Select Machine</label>
              <select
                value={formData.fleet_id}
                onChange={(e) => setFormData({ ...formData, fleet_id: e.target.value })}
                className="w-full border border-ink-mid bg-ink-light px-3 py-2 text-xs text-paper"
                required
              >
                {fleetAssets.map((a) => (
                  <option key={a.id} value={a.id}>
                    {text(a, "asset_code", "vehicle_registration")} — {text(a, "name", "asset_type")}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-mono uppercase text-slate mb-1">Shift Date</label>
              <input
                type="date"
                value={formData.occurred_on}
                onChange={(e) => setFormData({ ...formData, occurred_on: e.target.value })}
                className="w-full border border-ink-mid bg-ink-light px-3 py-2 text-xs text-paper"
                required
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-mono uppercase text-slate mb-1">Start Engine Meter (hrs)</label>
              <input
                type="number"
                step="0.1"
                value={formData.start_engine_hours}
                onChange={(e) => setFormData({ ...formData, start_engine_hours: Number(e.target.value) })}
                className="w-full border border-ink-mid bg-ink-light px-3 py-2 text-xs text-paper"
                required
              />
            </div>
            <div>
              <label className="block text-[11px] font-mono uppercase text-slate mb-1">End Engine Meter (hrs)</label>
              <input
                type="number"
                step="0.1"
                value={formData.end_engine_hours}
                onChange={(e) => setFormData({ ...formData, end_engine_hours: Number(e.target.value) })}
                className="w-full border border-ink-mid bg-ink-light px-3 py-2 text-xs text-paper"
                required
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] font-mono uppercase text-slate mb-1">Productive Active (hrs)</label>
              <input
                type="number"
                step="0.1"
                value={formData.operating_hours}
                onChange={(e) => setFormData({ ...formData, operating_hours: Number(e.target.value) })}
                className="w-full border border-ink-mid bg-ink-light px-3 py-2 text-xs text-paper"
                required
              />
            </div>
            <div>
              <label className="block text-[11px] font-mono uppercase text-slate mb-1">Idle / Standby (hrs)</label>
              <input
                type="number"
                step="0.1"
                value={formData.idle_hours}
                onChange={(e) => setFormData({ ...formData, idle_hours: Number(e.target.value) })}
                className="w-full border border-ink-mid bg-ink-light px-3 py-2 text-xs text-paper"
              />
            </div>
            <div>
              <label className="block text-[11px] font-mono uppercase text-slate mb-1">Breakdown (hrs)</label>
              <input
                type="number"
                step="0.1"
                value={formData.breakdown_downtime_hours}
                onChange={(e) => setFormData({ ...formData, breakdown_downtime_hours: Number(e.target.value) })}
                className="w-full border border-ink-mid bg-ink-light px-3 py-2 text-xs text-paper"
              />
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-mono uppercase text-slate mb-1">Work Performed Summary</label>
            <input
              type="text"
              value={formData.work_performed}
              onChange={(e) => setFormData({ ...formData, work_performed: e.target.value })}
              className="w-full border border-ink-mid bg-ink-light px-3 py-2 text-xs text-paper"
              placeholder="e.g. Cut and fill, subbase compaction CH 12+400 to 13+200"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3 border-t border-ink-mid pt-3">
            <div>
              <label className="block text-[11px] font-mono uppercase text-slate mb-1">Engineer / Client Sign-off Name</label>
              <input
                type="text"
                value={formData.client_signoff_name}
                onChange={(e) => setFormData({ ...formData, client_signoff_name: e.target.value })}
                className="w-full border border-ink-mid bg-ink-light px-3 py-2 text-xs text-paper"
                placeholder="Engineer or Clerk signature/name"
              />
            </div>
            <div>
              <label className="block text-[11px] font-mono uppercase text-slate mb-1">Sign-off Title</label>
              <input
                type="text"
                value={formData.client_signoff_title}
                onChange={(e) => setFormData({ ...formData, client_signoff_title: e.target.value })}
                className="w-full border border-ink-mid bg-ink-light px-3 py-2 text-xs text-paper"
              />
            </div>
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
              {submitting ? "Saving..." : "Commit Shift Log"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
