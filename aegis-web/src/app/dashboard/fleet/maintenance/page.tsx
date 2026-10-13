"use client";

import { useMemo, useState } from "react";
import { RBACGuard } from "@/components/auth/RBACGuard";
import { DashboardPageHeader } from "@/components/dashboard/DashboardPageHeader";
import {
  ApiError,
  createFleetWorkOrder,
  decideFleetWorkOrder,
  decideFleetWorkOrderApproval,
  getFleet,
  getFleetWorkOrders,
} from "@/lib/api";
import { useApiQueries } from "@/hooks/useApiQueries";
import { useLiveTable } from "@/lib/live/LiveDataProvider";
import { OperationalTable, TableHeader, TableRow, TableHead, TableCell } from "@/components/ui/OperationalTable";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Filter,
  Hammer,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Truck,
  Wrench,
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

function fmtMoney(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return "$0.00";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(amount);
}

export default function MaintenanceWorkshopPage() {
  return (
    <RBACGuard permission="fleet.read">
      <MaintenanceWorkshopDashboard />
    </RBACGuard>
  );
}

function MaintenanceWorkshopDashboard() {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [notice, setNotice] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const { data, isLoading, refetch } = useApiQueries(
    {
      workOrders: () => getFleetWorkOrders({ includeClosed: true }),
      fleet: () => getFleet(),
    },
    [],
    { criticalKeys: ["workOrders"] }
  );

  useLiveTable("fleet.maintenance_work_orders", () => void refetch());

  const workOrders = useMemo(
    () => (Array.isArray(data.workOrders?.data) ? data.workOrders.data.filter((item): item is RecordItem => Boolean(item && typeof item === "object" && item.id)) : []),
    [data.workOrders]
  );

  const fleetAssets = useMemo(
    () => (Array.isArray(data.fleet?.data) ? data.fleet.data.filter((item): item is RecordItem => Boolean(item && typeof item === "object" && item.id)) : []),
    [data.fleet]
  );

  const filtered = useMemo(() => {
    return workOrders.filter((wo) => {
      const matchSearch = [
        text(wo, "work_order_number"),
        text(wo, "asset_code"),
        text(wo, "vehicle_registration"),
        text(wo, "description"),
        text(wo, "diagnosis"),
      ]
        .join(" ")
        .toLowerCase();
      const st = text(wo, "status").toLowerCase();
      const matchStatus = statusFilter === "all" || st === statusFilter;
      return matchStatus && matchSearch.includes(query.toLowerCase());
    });
  }, [workOrders, query, statusFilter]);

  const stats = useMemo(() => {
    const openOrders = workOrders.filter((wo) => !["completed", "closed", "returned_to_service"].includes(text(wo, "status"))).length;
    const awaitingApproval = workOrders.filter((wo) => text(wo, "status") === "awaiting_approval").length;
    const awaitingParts = workOrders.filter((wo) => text(wo, "status") === "awaiting_parts").length;
    const readyForRTS = workOrders.filter((wo) => ["testing", "completed"].includes(text(wo, "status"))).length;
    return { openOrders, awaitingApproval, awaitingParts, readyForRTS };
  }, [workOrders]);

  const handleRtsDecision = async (wo: RecordItem) => {
    if (!window.confirm(`Certify Return-to-Service (RTS) for work order ${text(wo, "work_order_number")}? Machine will be released as Operational.`)) {
      return;
    }
    try {
      await decideFleetWorkOrder(wo.id, { status: "returned_to_service" });
      setNotice(`Work order ${text(wo, "work_order_number")} certified Return-to-Service.`);
      void refetch();
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : "Failed to sign off Return-to-Service.");
    }
  };

  const handleApprovalDecision = async (wo: RecordItem, decision: "approve" | "reject") => {
    let reason: string | undefined;
    if (decision === "reject") {
      reason = window.prompt("Reason for rejection (required):")?.trim() || undefined;
      if (!reason) return;
    }
    try {
      await decideFleetWorkOrderApproval(wo.id, decision, reason);
      setNotice(`Work order repair ${decision}d.`);
      void refetch();
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : `Failed to ${decision} repair.`);
    }
  };

  return (
    <main className="min-h-screen bg-ink p-4 text-paper md:p-7">
      <div className="mx-auto max-w-[1600px]">
        <DashboardPageHeader
          eyebrow={{ label: "Assets / Plant & Equipment", icon: Truck }}
          title="Maintenance & Workshop"
          subtitle="Scheduled PM service intervals, job cards, parts requisitions, breakdown triage, and Return-to-Service gates."
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
                <Plus size={14} /> Open Workshop Work Order
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
            <span className="font-mono text-[10px] uppercase text-slate">Active Workshop Orders</span>
            <p className="mt-2 text-2xl font-bold text-amber-300">{stats.openOrders}</p>
          </div>
          <div className="bg-ink p-4">
            <span className="font-mono text-[10px] uppercase text-slate">Awaiting Repair Approval</span>
            <p className="mt-2 text-2xl font-bold text-rose-400">{stats.awaitingApproval}</p>
          </div>
          <div className="bg-ink p-4">
            <span className="font-mono text-[10px] uppercase text-slate">Awaiting Spares / Parts</span>
            <p className="mt-2 text-2xl font-bold text-blue-300">{stats.awaitingParts}</p>
          </div>
          <div className="bg-ink p-4">
            <span className="font-mono text-[10px] uppercase text-slate">Return-to-Service Ready</span>
            <p className="mt-2 text-2xl font-bold text-emerald-300">{stats.readyForRTS}</p>
          </div>
        </section>

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 text-slate" size={14} />
              <input
                type="text"
                placeholder="Search WO ref, machine, diagnosis..."
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
              <option value="all">All Statuses</option>
              <option value="reported">Reported</option>
              <option value="assessed">Assessed</option>
              <option value="awaiting_approval">Awaiting Approval</option>
              <option value="awaiting_parts">Awaiting Parts</option>
              <option value="in_progress">In Progress</option>
              <option value="testing">Testing</option>
              <option value="completed">Completed</option>
              <option value="returned_to_service">Returned to Service (RTS)</option>
              <option value="closed">Closed</option>
            </select>
          </div>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            icon={Wrench}
            title="No workshop work orders found"
            description="Manage planned maintenance and emergency repairs with technician assignments, diagnosis, and RTS certification."
          />
        ) : (
          <div className="border border-ink-mid bg-ink overflow-x-auto">
            <OperationalTable className="min-w-[1200px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Work Order Ref</TableHead>
                  <TableHead>Machine Asset</TableHead>
                  <TableHead>Type / Priority</TableHead>
                  <TableHead>Diagnosis / Problem</TableHead>
                  <TableHead>Estimated Downtime</TableHead>
                  <TableHead>Cost</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <tbody>
                {filtered.map((wo) => {
                  const st = text(wo, "status");
                  return (
                    <TableRow key={wo.id}>
                      <TableCell>
                        <p className="font-semibold text-paper">{text(wo, "work_order_number") || wo.id.slice(0, 8)}</p>
                        <p className="text-[11px] text-slate-light">Opened: {wo.opened_at ? fmtDate(String(wo.opened_at)) : "—"}</p>
                      </TableCell>
                      <TableCell>
                        <p className="font-medium text-paper">{text(wo, "asset_code", "vehicle_registration")}</p>
                        <p className="text-[11px] text-slate-light">{text(wo, "asset_category") || "Heavy Plant"}</p>
                      </TableCell>
                      <TableCell>
                        <p className="capitalize text-paper text-xs">{text(wo, "work_order_type", "type").replace(/_/g, " ")}</p>
                        <span className={`font-mono text-[10px] uppercase ${text(wo, "priority") === "emergency" ? "text-rose-400 font-bold" : "text-slate"}`}>
                          {text(wo, "priority") || "Normal"}
                        </span>
                      </TableCell>
                      <TableCell>
                        <p className="text-xs text-paper max-w-56 truncate">{text(wo, "diagnosis", "description") || "Scheduled servicing"}</p>
                        {Boolean(wo.parts_request_reference) && (
                          <p className="text-[10px] text-blue-300">Parts: {String(wo.parts_request_reference)}</p>
                        )}
                      </TableCell>
                      <TableCell>
                        <p className="font-mono text-xs text-paper">
                          {wo.estimated_downtime_hours ? `${Number(wo.estimated_downtime_hours)} hrs` : "—"}
                        </p>
                      </TableCell>
                      <TableCell>
                        <p className="text-xs text-paper">{fmtMoney(Number(wo.actual_cost ?? wo.estimated_cost ?? 0))}</p>
                      </TableCell>
                      <TableCell>
                        <span
                          className={`inline-flex border px-2 py-0.5 font-mono text-[10px] uppercase ${
                            st === "returned_to_service" || st === "completed"
                              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                              : st === "awaiting_approval"
                              ? "border-rose-500/40 bg-rose-500/10 text-rose-300"
                              : "border-slate/40 bg-ink-light text-paper"
                          }`}
                        >
                          {st.replace(/_/g, " ")}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {st === "awaiting_approval" && (
                            <>
                              <button
                                type="button"
                                onClick={() => void handleApprovalDecision(wo, "approve")}
                                className="border border-emerald-500/40 px-2 py-1 text-[11px] text-emerald-200 hover:bg-emerald-500/10"
                              >
                                Approve Repair
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleApprovalDecision(wo, "reject")}
                                className="border border-rose-500/40 px-2 py-1 text-[11px] text-rose-200 hover:bg-rose-500/10"
                              >
                                Reject
                              </button>
                            </>
                          )}
                          {["in_progress", "testing", "completed"].includes(st) && (
                            <button
                              type="button"
                              onClick={() => void handleRtsDecision(wo)}
                              className="border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-200 hover:bg-emerald-500/20"
                            >
                              Sign RTS Gate
                            </button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </tbody>
            </OperationalTable>
          </div>
        )}

        {/* Modal: Create Work Order */}
        {modalOpen && (
          <CreateWorkOrderModal
            fleetAssets={fleetAssets}
            onClose={() => setModalOpen(false)}
            onSuccess={() => {
              setModalOpen(false);
              setNotice("Workshop work order opened.");
              void refetch();
            }}
          />
        )}
      </div>
    </main>
  );
}

function CreateWorkOrderModal({
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
    work_order_type: "preventive",
    priority: "routine",
    description: "",
    diagnosis: "",
    estimated_downtime_hours: 8,
    estimated_cost: 450,
  });
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.fleet_id || !formData.description) {
      setErr("Machine and description are required.");
      return;
    }
    setSubmitting(true);
    setErr(null);
    try {
      await createFleetWorkOrder({
        fleet_id: formData.fleet_id,
        work_order_type: formData.work_order_type,
        priority: formData.priority,
        description: formData.description,
        diagnosis: formData.diagnosis,
        estimated_downtime_hours: Number(formData.estimated_downtime_hours),
        estimated_cost: Number(formData.estimated_cost),
      });
      onSuccess();
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : "Failed to open work order.");
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-4 backdrop-blur-sm">
      <div className="relative w-full max-w-md border border-ink-mid bg-ink shadow-2xl">
        <div className="flex items-center justify-between border-b border-ink-mid px-5 py-4">
          <h2 className="text-sm font-semibold text-paper">Open Workshop Work Order</h2>
          <button type="button" onClick={onClose} className="text-slate hover:text-paper">
            <X size={18} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {err && <div className="border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">{err}</div>}
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
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-mono uppercase text-slate mb-1">Service Type</label>
              <select
                value={formData.work_order_type}
                onChange={(e) => setFormData({ ...formData, work_order_type: e.target.value })}
                className="w-full border border-ink-mid bg-ink-light px-3 py-2 text-xs text-paper"
              >
                <option value="preventive">Scheduled PM Service</option>
                <option value="corrective">Corrective Repair</option>
                <option value="breakdown">Emergency Breakdown</option>
                <option value="inspection">Statutory Inspection</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-mono uppercase text-slate mb-1">Priority</label>
              <select
                value={formData.priority}
                onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
                className="w-full border border-ink-mid bg-ink-light px-3 py-2 text-xs text-paper"
              >
                <option value="routine">Routine</option>
                <option value="urgent">Urgent</option>
                <option value="emergency">Emergency (Locked)</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-mono uppercase text-slate mb-1">Work Description</label>
            <textarea
              rows={2}
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full border border-ink-mid bg-ink-light px-3 py-2 text-xs text-paper"
              placeholder="e.g. 500-hour service kit (oil, fuel, hydraulic filters, coolant check)"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-mono uppercase text-slate mb-1">Est Downtime (hrs)</label>
              <input
                type="number"
                value={formData.estimated_downtime_hours}
                onChange={(e) => setFormData({ ...formData, estimated_downtime_hours: Number(e.target.value) })}
                className="w-full border border-ink-mid bg-ink-light px-3 py-2 text-xs text-paper"
              />
            </div>
            <div>
              <label className="block text-[11px] font-mono uppercase text-slate mb-1">Est Cost (USD)</label>
              <input
                type="number"
                value={formData.estimated_cost}
                onChange={(e) => setFormData({ ...formData, estimated_cost: Number(e.target.value) })}
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
              {submitting ? "Opening..." : "Create Work Order"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
