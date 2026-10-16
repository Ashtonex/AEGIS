"use client";

import { useMemo, useState } from "react";
import { RBACGuard } from "@/components/auth/RBACGuard";
import { DashboardPageHeader } from "@/components/dashboard/DashboardPageHeader";
import {
  ApiError,
  createPlantRequest,
  dispatchPlantAsset,
  getPlantLifecycleSummary,
  getPlantRequests,
  reservePlantAsset,
  updatePlantRequestStatus,
  getFleet,
} from "@/lib/api";
import { useApiQueries } from "@/hooks/useApiQueries";
import { useLiveTable } from "@/lib/live/LiveDataProvider";
import { OperationalTable, TableHeader, TableRow, TableHead, TableCell } from "@/components/ui/OperationalTable";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  FilePlus2,
  Filter,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
  ShieldCheck,
  Truck,
  X,
  ArrowRightLeft,
  DollarSign,
  Clock,
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
  if (amount === null || amount === undefined || isNaN(Number(amount))) return "$0.00";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(Number(amount));
}

export default function PlantRequestsPage() {
  return (
    <RBACGuard permission="fleet.read">
      <PlantRequestsDashboard />
    </RBACGuard>
  );
}

function PlantRequestsDashboard() {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionModal, setActionModal] = useState<{ type: "new" | "dispatch" | "reserve" | "validate"; request?: RecordItem } | null>(null);

  const { data, isLoading, refetch } = useApiQueries(
    {
      summary: () => getPlantLifecycleSummary(),
      requests: () => getPlantRequests(),
      fleet: () => getFleet(),
    },
    [],
    { criticalKeys: ["requests"] }
  );

  useLiveTable("fleet.plant_requests", () => void refetch());

  const requests = useMemo(
    () => (Array.isArray(data.requests?.data) ? data.requests.data.filter((item): item is RecordItem => Boolean(item && typeof item === "object" && item.id)) : []),
    [data.requests]
  );

  const fleetAssets = useMemo(
    () => (Array.isArray(data.fleet?.data) ? data.fleet.data.filter((item): item is RecordItem => Boolean(item && typeof item === "object" && item.id)) : []),
    [data.fleet]
  );

  const summary = (data.summary?.data && typeof data.summary.data === "object" ? data.summary.data : {}) as Record<string, unknown>;

  const filtered = useMemo(() => {
    return requests.filter((r) => {
      const matchSearch = [text(r, "request_number"), text(r, "required_asset_type"), text(r, "work_location"), text(r, "project_name")].join(" ").toLowerCase();
      const matchStatus = statusFilter === "all" || text(r, "status") === statusFilter;
      return matchStatus && matchSearch.includes(query.toLowerCase());
    });
  }, [requests, query, statusFilter]);

  const handleDecision = async (req: RecordItem, newStatus: string) => {
    setError(null);
    setNotice(null);
    try {
      await updatePlantRequestStatus(req.id, { status: newStatus });
      setNotice(`Request ${text(req, "request_number") || req.id.slice(0, 8)} updated to ${newStatus.replace(/_/g, " ")}.`);
      void refetch();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update request status.");
    }
  };

  return (
    <main className="min-h-screen bg-ink p-4 text-paper md:p-7">
      <div className="mx-auto max-w-[1600px]">
        <DashboardPageHeader
          eyebrow={{ label: "Assets / Plant & Equipment", icon: Truck }}
          title="Plant Requests & Dispatch"
          subtitle="Requisition, pre-mobilisation readiness, allocation, lowbed logistics, and dispatch controls."
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
                onClick={() => setActionModal({ type: "new" })}
                className="inline-flex items-center gap-2 bg-signal px-3 py-2 text-xs font-semibold text-ink hover:bg-signal/90"
              >
                <FilePlus2 size={14} /> Raise Plant Request
              </button>
            </>
          }
        />

        {notice && (
          <div className="mb-5 flex items-start gap-3 border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm text-emerald-100">
            <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-400" />
            <p>{notice}</p>
          </div>
        )}

        {error && (
          <div className="mb-5 flex items-start gap-3 border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-100">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-rose-400" />
            <p>{error}</p>
          </div>
        )}

        <section className="mb-6 grid gap-px overflow-hidden border border-ink-mid bg-ink-mid sm:grid-cols-2 lg:grid-cols-5">
          <div className="bg-ink p-4">
            <span className="font-mono text-[10px] uppercase text-slate">Open Requests</span>
            <p className="mt-2 text-2xl font-bold">{Number(summary.open_requests ?? requests.length)}</p>
          </div>
          <div className="bg-ink p-4">
            <span className="font-mono text-[10px] uppercase text-slate">Validation Queue</span>
            <p className="mt-2 text-2xl font-bold text-amber-300">{Number(summary.validation_queue ?? requests.filter((r) => text(r, "status") === "under_validation").length)}</p>
          </div>
          <div className="bg-ink p-4">
            <span className="font-mono text-[10px] uppercase text-slate">Ready for Dispatch</span>
            <p className="mt-2 text-2xl font-bold text-blue-300">{Number(summary.dispatch_queue ?? requests.filter((r) => text(r, "status") === "ready_for_dispatch").length)}</p>
          </div>
          <div className="bg-ink p-4">
            <span className="font-mono text-[10px] uppercase text-slate">Active Plant Jobs</span>
            <p className="mt-2 text-2xl font-bold text-emerald-300">{Number(summary.active_deployments ?? requests.filter((r) => text(r, "status") === "active").length)}</p>
          </div>
          <div className="bg-ink p-4">
            <span className="font-mono text-[10px] uppercase text-slate">Critical Incidents</span>
            <p className="mt-2 text-2xl font-bold text-rose-400">{Number(summary.serious_incidents ?? 0)}</p>
          </div>
        </section>

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 text-slate" size={14} />
              <input
                type="text"
                placeholder="Search requests, assets, locations..."
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
              <option value="draft">Draft</option>
              <option value="submitted">Submitted</option>
              <option value="under_validation">Under Validation</option>
              <option value="awaiting_approval">Awaiting Approval</option>
              <option value="approved">Approved</option>
              <option value="reserved">Reserved</option>
              <option value="ready_for_dispatch">Ready for Dispatch</option>
              <option value="dispatched">Dispatched</option>
              <option value="active">Active</option>
              <option value="returned">Returned</option>
              <option value="closed">Closed</option>
            </select>
          </div>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            icon={Send}
            title="No plant requests matching filters"
            description="Create a plant request to begin the validation, reservation, and dispatch workflow."
          />
        ) : (
          <div className="border border-ink-mid bg-ink overflow-x-auto">
            <OperationalTable className="min-w-[1100px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Request Ref</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Asset Class / Need</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Start Date</TableHead>
                  <TableHead>Transport</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <tbody>
                {filtered.map((req) => {
                  const st = text(req, "status");
                  return (
                    <TableRow key={req.id}>
                      <TableCell>
                        <p className="font-semibold text-paper">{text(req, "request_number") || req.id.slice(0, 8)}</p>
                        <p className="text-[11px] text-slate-light">{text(req, "project_name", "client_name") || "General deployment"}</p>
                      </TableCell>
                      <TableCell className="capitalize">{text(req, "request_type").replace(/_/g, " ")}</TableCell>
                      <TableCell>
                        <p className="font-medium text-paper">{text(req, "required_asset_type")}</p>
                        <p className="text-[11px] text-slate-light">Qty: {String(req.quantity ?? 1)} | Fuel: {text(req, "fuel_responsibility")}</p>
                      </TableCell>
                      <TableCell>{text(req, "work_location") || "—"}</TableCell>
                      <TableCell>{req.start_date ? fmtDate(String(req.start_date)) : "—"}</TableCell>
                      <TableCell className="capitalize">{text(req, "transport_requirement").replace(/_/g, " ")}</TableCell>
                      <TableCell>
                        <span className="inline-flex border border-slate/40 bg-ink-light px-2 py-0.5 font-mono text-[10px] uppercase text-paper">
                          {st.replace(/_/g, " ")}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {st === "submitted" && (
                            <button
                              type="button"
                              onClick={() => setActionModal({ type: "validate", request: req })}
                              className="border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] font-semibold text-amber-200 hover:bg-amber-500/20"
                            >
                              Validate & Scope
                            </button>
                          )}
                          {st === "under_validation" && (
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => setActionModal({ type: "validate", request: req })}
                                className="border border-amber-500/40 px-2 py-1 text-[11px] text-amber-200 hover:bg-amber-500/10"
                              >
                                Edit Scope
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleDecision(req, "awaiting_approval")}
                                className="border border-blue-500/40 px-2 py-1 text-[11px] text-blue-200 hover:bg-blue-500/10"
                              >
                                Send for Approval
                              </button>
                            </div>
                          )}
                          {st === "awaiting_approval" && (
                            <>
                              <button
                                type="button"
                                onClick={() => void handleDecision(req, "approved")}
                                className="border border-emerald-500/40 px-2 py-1 text-[11px] text-emerald-200 hover:bg-emerald-500/10"
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleDecision(req, "rejected")}
                                className="border border-rose-500/40 px-2 py-1 text-[11px] text-rose-200 hover:bg-rose-500/10"
                              >
                                Reject
                              </button>
                            </>
                          )}
                          {st === "approved" && (
                            <button
                              type="button"
                              onClick={() => setActionModal({ type: "reserve", request: req })}
                              className="border border-signal/60 bg-signal/10 px-2 py-1 text-[11px] text-signal hover:bg-signal/20"
                            >
                              Reserve Plant
                            </button>
                          )}
                          {st === "reserved" && (
                            <button
                              type="button"
                              onClick={() => setActionModal({ type: "dispatch", request: req })}
                              className="border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-200 hover:bg-emerald-500/20"
                            >
                              Issue Dispatch Note
                            </button>
                          )}
                          {st === "dispatched" && (
                            <button
                              type="button"
                              onClick={() => void handleDecision(req, "active")}
                              className="border border-emerald-500/40 px-2 py-1 text-[11px] text-emerald-200 hover:bg-emerald-500/10"
                            >
                              Confirm On-Site
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

        {/* Modal: Validate & Scope Plant Request */}
        {actionModal?.type === "validate" && actionModal.request && (
          <ValidatePlantRequestModal
            request={actionModal.request}
            onClose={() => setActionModal(null)}
            onSuccess={(status) => {
              setActionModal(null);
              setNotice(`Plant request scoped and updated to ${status.replace(/_/g, " ")}.`);
              void refetch();
            }}
          />
        )}

        {/* Modal: New Plant Request */}
        {actionModal?.type === "new" && (
          <NewPlantRequestModal
            onClose={() => setActionModal(null)}
            onSuccess={() => {
              setActionModal(null);
              setNotice("Plant request created successfully.");
              void refetch();
            }}
          />
        )}

        {/* Modal: Reserve Plant */}
        {actionModal?.type === "reserve" && actionModal.request && (
          <ReservePlantModal
            request={actionModal.request}
            fleetAssets={fleetAssets}
            onClose={() => setActionModal(null)}
            onSuccess={() => {
              setActionModal(null);
              setNotice("Plant asset reserved successfully.");
              void refetch();
            }}
          />
        )}

        {/* Modal: Dispatch Plant */}
        {actionModal?.type === "dispatch" && actionModal.request && (
          <DispatchPlantModal
            request={actionModal.request}
            fleetAssets={fleetAssets}
            onClose={() => setActionModal(null)}
            onSuccess={() => {
              setActionModal(null);
              setNotice("Dispatch note issued and plant mobilized.");
              void refetch();
            }}
          />
        )}
      </div>
    </main>
  );
}

function NewPlantRequestModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [formData, setFormData] = useState({
    request_type: "internal_project",
    required_asset_type: "Excavator (30T)",
    quantity: 1,
    work_location: "",
    start_date: new Date().toISOString().slice(0, 10),
    end_date: "",
    work_description: "",
    operating_hours_mode: "normal",
    fuel_responsibility: "snc",
    transport_requirement: "low_bed",
    priority: "routine",
  });
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.work_location || !formData.work_description) {
      setErr("Location and description are required.");
      return;
    }
    setSubmitting(true);
    setErr(null);
    try {
      const payload: Record<string, unknown> = {
        ...formData,
        quantity: Math.max(1, Number(formData.quantity) || 1),
      };
      if (!formData.end_date) {
        delete payload.end_date;
      }
      await createPlantRequest(payload);
      onSuccess();
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : "Failed to create plant request.");
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-4 backdrop-blur-sm">
      <div className="relative w-full max-w-xl border border-ink-mid bg-ink shadow-2xl">
        <div className="flex items-center justify-between border-b border-ink-mid px-5 py-4">
          <h2 className="text-sm font-semibold text-paper">Raise Controlled Plant Request</h2>
          <button type="button" onClick={onClose} className="text-slate hover:text-paper">
            <X size={18} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {err && <div className="border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">{err}</div>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-mono uppercase text-slate mb-1">Request Type</label>
              <select
                value={formData.request_type}
                onChange={(e) => setFormData({ ...formData, request_type: e.target.value })}
                className="w-full border border-ink-mid bg-ink-light px-3 py-2 text-xs text-paper"
              >
                <option value="internal_project">Internal Project</option>
                <option value="external_hire">External Hire</option>
                <option value="maintenance">Maintenance</option>
                <option value="emergency">Emergency</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-mono uppercase text-slate mb-1">Required Asset Type</label>
              <input
                type="text"
                value={formData.required_asset_type}
                onChange={(e) => setFormData({ ...formData, required_asset_type: e.target.value })}
                className="w-full border border-ink-mid bg-ink-light px-3 py-2 text-xs text-paper"
                placeholder="e.g. Excavator 30T, Grader 140K"
                required
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] font-mono uppercase text-slate mb-1">Work Location</label>
              <input
                type="text"
                value={formData.work_location}
                onChange={(e) => setFormData({ ...formData, work_location: e.target.value })}
                className="w-full border border-ink-mid bg-ink-light px-3 py-2 text-xs text-paper"
                placeholder="Site, Quarry, Road Section"
                required
              />
            </div>
            <div>
              <label className="block text-[11px] font-mono uppercase text-slate mb-1">Start Date</label>
              <input
                type="date"
                value={formData.start_date}
                onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                className="w-full border border-ink-mid bg-ink-light px-3 py-2 text-xs text-paper"
                required
              />
            </div>
            <div>
              <label className="block text-[11px] font-mono uppercase text-slate mb-1">End Date (Optional)</label>
              <input
                type="date"
                value={formData.end_date}
                onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                className="w-full border border-ink-mid bg-ink-light px-3 py-2 text-xs text-paper"
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] font-mono uppercase text-slate mb-1">Transport</label>
              <select
                value={formData.transport_requirement}
                onChange={(e) => setFormData({ ...formData, transport_requirement: e.target.value })}
                className="w-full border border-ink-mid bg-ink-light px-3 py-2 text-xs text-paper"
              >
                <option value="low_bed">Low-bed Trailer</option>
                <option value="tow">Tow</option>
                <option value="drive">Drive</option>
                <option value="collection">Client Collection</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-mono uppercase text-slate mb-1">Fuel Responsibility</label>
              <select
                value={formData.fuel_responsibility}
                onChange={(e) => setFormData({ ...formData, fuel_responsibility: e.target.value })}
                className="w-full border border-ink-mid bg-ink-light px-3 py-2 text-xs text-paper"
              >
                <option value="snc">SNC (Wet)</option>
                <option value="project">Project Fuel</option>
                <option value="client">Client (Dry)</option>
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
                <option value="emergency">Emergency</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-mono uppercase text-slate mb-1">Work Description & Scope</label>
            <textarea
              rows={3}
              value={formData.work_description}
              onChange={(e) => setFormData({ ...formData, work_description: e.target.value })}
              className="w-full border border-ink-mid bg-ink-light px-3 py-2 text-xs text-paper"
              placeholder="Detail earthworks, volume, duty cycle..."
              required
            />
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
              {submitting ? "Submitting..." : "Submit Plant Request"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ReservePlantModal({
  request,
  fleetAssets,
  onClose,
  onSuccess,
}: {
  request: RecordItem;
  fleetAssets: RecordItem[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [selectedAssetId, setSelectedAssetId] = useState(fleetAssets[0]?.id || "");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleReserve = async () => {
    if (!selectedAssetId) return;
    setSubmitting(true);
    setErr(null);
    try {
      await reservePlantAsset(request.id, {
        fleet_id: selectedAssetId,
        notes: `Reserved for ${text(request, "request_number")}`,
      });
      onSuccess();
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : "Failed to reserve asset.");
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-4 backdrop-blur-sm">
      <div className="relative w-full max-w-md border border-ink-mid bg-ink shadow-2xl">
        <div className="flex items-center justify-between border-b border-ink-mid px-5 py-4">
          <h2 className="text-sm font-semibold text-paper">Reserve Asset for Request</h2>
          <button type="button" onClick={onClose} className="text-slate hover:text-paper">
            <X size={18} />
          </button>
        </div>
        <div className="p-5 space-y-4">
          {err && <div className="border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">{err}</div>}
          <p className="text-xs text-slate-light">
            Assign an available machine from the fleet register to fulfill:{" "}
            <span className="text-paper font-semibold">{text(request, "required_asset_type")}</span>
          </p>
          <div>
            <label className="block text-[11px] font-mono uppercase text-slate mb-1">Select Machine</label>
            <select
              value={selectedAssetId}
              onChange={(e) => setSelectedAssetId(e.target.value)}
              className="w-full border border-ink-mid bg-ink-light px-3 py-2 text-xs text-paper"
            >
              {fleetAssets.map((a) => (
                <option key={a.id} value={a.id}>
                  {text(a, "asset_code", "vehicle_registration")} — {text(a, "name", "asset_type")} ({text(a, "operational_status")})
                </option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-ink-mid">
            <button type="button" onClick={onClose} className="px-4 py-2 text-xs text-slate hover:text-paper">
              Cancel
            </button>
            <button
              type="button"
              onClick={handleReserve}
              disabled={submitting || !selectedAssetId}
              className="bg-signal px-4 py-2 text-xs font-semibold text-ink hover:bg-signal/90 disabled:opacity-50"
            >
              {submitting ? "Reserving..." : "Confirm Reservation"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function DispatchPlantModal({
  request,
  fleetAssets,
  onClose,
  onSuccess,
}: {
  request: RecordItem;
  fleetAssets: RecordItem[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [transporter, setTransporter] = useState("SNC Logistics Lowbed");
  const [driver, setDriver] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleDispatch = async () => {
    setSubmitting(true);
    setErr(null);
    try {
      await dispatchPlantAsset(request.id, {
        transporter_name: transporter,
        driver_name: driver,
        dispatch_notes: notes,
      });
      onSuccess();
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : "Failed to issue dispatch note.");
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-4 backdrop-blur-sm">
      <div className="relative w-full max-w-md border border-ink-mid bg-ink shadow-2xl">
        <div className="flex items-center justify-between border-b border-ink-mid px-5 py-4">
          <h2 className="text-sm font-semibold text-paper">Issue Mobilisation Dispatch Note</h2>
          <button type="button" onClick={onClose} className="text-slate hover:text-paper">
            <X size={18} />
          </button>
        </div>
        <div className="p-5 space-y-4">
          {err && <div className="border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">{err}</div>}
          <div>
            <label className="block text-[11px] font-mono uppercase text-slate mb-1">Transporter / Lowbed Vehicle</label>
            <input
              type="text"
              value={transporter}
              onChange={(e) => setTransporter(e.target.value)}
              className="w-full border border-ink-mid bg-ink-light px-3 py-2 text-xs text-paper"
              required
            />
          </div>
          <div>
            <label className="block text-[11px] font-mono uppercase text-slate mb-1">Transporter Driver / Operator</label>
            <input
              type="text"
              value={driver}
              onChange={(e) => setDriver(e.target.value)}
              className="w-full border border-ink-mid bg-ink-light px-3 py-2 text-xs text-paper"
              placeholder="Driver name and contact"
            />
          </div>
          <div>
            <label className="block text-[11px] font-mono uppercase text-slate mb-1">Dispatch Notes & Permits</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full border border-ink-mid bg-ink-light px-3 py-2 text-xs text-paper"
              placeholder="Abnormal load permit ref, escort details..."
            />
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-ink-mid">
            <button type="button" onClick={onClose} className="px-4 py-2 text-xs text-slate hover:text-paper">
              Cancel
            </button>
            <button
              type="button"
              onClick={handleDispatch}
              disabled={submitting}
              className="bg-signal px-4 py-2 text-xs font-semibold text-ink hover:bg-signal/90 disabled:opacity-50"
            >
              {submitting ? "Dispatching..." : "Authorize & Dispatch"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ValidatePlantRequestModal({
  request,
  onClose,
  onSuccess,
}: {
  request: RecordItem;
  onClose: () => void;
  onSuccess: (status: string) => void;
}) {
  const [estimatedHours, setEstimatedHours] = useState(80);
  const [hourlyRevenueRate, setHourlyRevenueRate] = useState(100);
  const [hourlyCostRate, setHourlyCostRate] = useState(65);
  const [riskLevel, setRiskLevel] = useState<"low" | "normal" | "high" | "critical">("normal");
  const [notes, setNotes] = useState(text(request, "validation_notes") || "");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const expectedRev = estimatedHours * hourlyRevenueRate;
  const estimatedCost = estimatedHours * hourlyCostRate;
  const contributionMargin = expectedRev - estimatedCost;

  const handleSave = async (targetStatus: "under_validation" | "awaiting_approval") => {
    setSubmitting(true);
    setErr(null);
    try {
      await updatePlantRequestStatus(request.id, {
        status: targetStatus,
        expected_revenue: expectedRev,
        estimated_cost: estimatedCost,
        risk_level: riskLevel,
        notes: notes || undefined,
      });
      onSuccess(targetStatus);
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : "Failed to update request validation.");
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-4 backdrop-blur-sm overflow-y-auto">
      <div className="relative w-full max-w-xl border border-ink-mid bg-ink shadow-2xl my-8">
        <div className="flex items-center justify-between border-b border-ink-mid px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-paper">
              Validate & Scope Plant Request
            </h2>
            <p className="text-[11px] text-slate-light">
              Ref: <span className="text-paper font-mono font-bold">{text(request, "request_number")}</span> | Need: <span className="text-paper font-semibold">{text(request, "required_asset_type")}</span>
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-slate hover:text-paper">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[80vh] overflow-y-auto">
          {err && <div className="border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">{err}</div>}

          {/* Site Request Context */}
          <div className="border border-ink-mid bg-ink-light p-3 space-y-1.5 text-xs">
            <div className="flex justify-between">
              <span className="text-slate">Work Site / Location:</span>
              <span className="text-paper font-medium">{text(request, "work_location") || "Site Project"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate">Required Date & Mode:</span>
              <span className="text-paper font-medium">{request.start_date ? fmtDate(String(request.start_date)) : "Immediate"} ({text(request, "operating_hours_mode")} shift)</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate">Transport & Fuel:</span>
              <span className="text-paper font-medium">Logistics: {text(request, "transport_requirement")} | Fuel: {text(request, "fuel_responsibility")}</span>
            </div>
            {text(request, "work_description") && (
              <div className="pt-1.5 border-t border-ink-mid text-slate-light">
                <span className="text-slate font-mono uppercase text-[10px] block">Site Scope:</span>
                <p className="italic mt-0.5">{text(request, "work_description")}</p>
              </div>
            )}
          </div>

          {/* Scope & Costing Inputs */}
          <div className="space-y-3">
            <span className="font-mono text-[10px] uppercase text-slate font-semibold">
              Operational Hours & Cost Scoping
            </span>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-[10px] font-mono uppercase text-slate mb-1">
                  Est. Operating Hours *
                </label>
                <input
                  type="number"
                  min="1"
                  value={estimatedHours}
                  onChange={(e) => setEstimatedHours(Math.max(1, Number(e.target.value)))}
                  className="w-full border border-ink-mid bg-ink-light px-3 py-1.5 text-xs font-mono font-bold text-paper"
                  required
                />
              </div>
              <div>
                <label className="block text-[10px] font-mono uppercase text-slate mb-1">
                  Recovery Rate ($/hr)
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={hourlyRevenueRate}
                  onChange={(e) => setHourlyRevenueRate(Math.max(0, Number(e.target.value)))}
                  className="w-full border border-ink-mid bg-ink-light px-3 py-1.5 text-xs font-mono font-bold text-emerald-400"
                />
              </div>
              <div>
                <label className="block text-[10px] font-mono uppercase text-slate mb-1">
                  Operating Cost ($/hr)
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={hourlyCostRate}
                  onChange={(e) => setHourlyCostRate(Math.max(0, Number(e.target.value)))}
                  className="w-full border border-ink-mid bg-ink-light px-3 py-1.5 text-xs font-mono font-bold text-amber-300"
                />
              </div>
            </div>

            {/* Calculated Margin Box */}
            <div className="grid grid-cols-3 gap-2 border border-ink-mid bg-ink p-3 text-center">
              <div>
                <span className="text-[10px] text-slate-light block">Project Recovery</span>
                <span className="font-mono text-xs font-bold text-emerald-300">{fmtMoney(expectedRev)}</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-light block">Estimated Cost</span>
                <span className="font-mono text-xs font-bold text-amber-300">{fmtMoney(estimatedCost)}</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-light block">Contribution Margin</span>
                <span className="font-mono text-xs font-bold text-signal">+{fmtMoney(contributionMargin)}</span>
              </div>
            </div>
          </div>

          {/* Missing Plant? Cross-Hire Brokerage Callout */}
          <div className="border border-purple-500/30 bg-purple-500/10 p-3 rounded-sm flex items-start gap-2.5">
            <ArrowRightLeft className="text-purple-400 shrink-0 mt-0.5" size={16} />
            <div className="text-xs">
              <p className="font-semibold text-purple-200">Don't have this unit in company fleet?</p>
              <p className="text-slate-light text-[11px] mt-0.5">
                If the machine is missing from company stock, you can source it from an external owner (Party A) at buy rate and lease it to this job or commercial client (Party B) at sell rate via Commercial Hire.
              </p>
              <a
                href="/dashboard/fleet/hire"
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-purple-300 hover:text-purple-100 underline mt-1.5"
              >
                Open Cross-Hire / Sub-Lease Hub &rarr;
              </a>
            </div>
          </div>

          {/* Risk Level & Manager Instructions */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-1">
              <label className="block text-[10px] font-mono uppercase text-slate mb-1">Risk Classification</label>
              <select
                value={riskLevel}
                onChange={(e) => setRiskLevel(e.target.value as any)}
                className="w-full border border-ink-mid bg-ink-light px-3 py-1.5 text-xs text-paper"
              >
                <option value="low">Low Risk</option>
                <option value="normal">Normal</option>
                <option value="high">High Risk</option>
                <option value="critical">Critical / Severe</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-[10px] font-mono uppercase text-slate mb-1">Validation Notes / Allocation Instructions</label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g., Fleet unit 10m3 Tipper #04 allocated, mobilize 16 Oct"
                className="w-full border border-ink-mid bg-ink-light px-3 py-1.5 text-xs text-paper"
              />
            </div>
          </div>

          <div className="flex justify-between items-center pt-3 border-t border-ink-mid">
            <button type="button" onClick={onClose} className="px-3 py-1.5 text-xs text-slate hover:text-paper">
              Cancel
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={submitting}
                onClick={() => handleSave("under_validation")}
                className="border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-200 hover:bg-amber-500/20 disabled:opacity-50"
              >
                {submitting ? "Saving..." : "Keep Under Validation"}
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => handleSave("awaiting_approval")}
                className="bg-signal px-4 py-2 text-xs font-semibold text-ink hover:bg-signal/90 disabled:opacity-50"
              >
                {submitting ? "Submitting..." : "Send for Approval"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
