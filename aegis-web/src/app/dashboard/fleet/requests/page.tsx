"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth/AuthContext";
import { RBACGuard } from "@/components/auth/RBACGuard";
import { DashboardPageHeader } from "@/components/dashboard/DashboardPageHeader";
import {
  ApiError,
  createPlantRequest,
  dispatchPlantAsset,
  getPlantLifecycleSummary,
  getPlantRequests,
  reservePlantAsset,
  switchPlantAsset,
  updatePlantRequestStatus,
  updatePlantRequestReadiness,
  getFleetUtilizationLogs,
  recordFleetUtilization,
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
  Receipt,
} from "lucide-react";
import { GenerateInvoiceModal } from "@/components/invoices/GenerateInvoiceModal";

type RecordItem = Record<string, unknown> & { id: string };

// Mirrors PLANT_READINESS_CONTROLS in imperium-api/routers/fleet.py. Every
// item must be ticked before a dispatch note can be issued.
const READINESS_CONTROLS: { key: string; label: string }[] = [
  { key: "technical_specification", label: "Plant Manager technical specification approved" },
  { key: "source_decision", label: "Source decided (internal fleet, hire, purchase or subcontract)" },
  { key: "budget_approval", label: "Plant budget / cost plan approved" },
  { key: "asset_identified", label: "Asset number or hired-in machine identified" },
  { key: "availability_no_overlap", label: "No allocation conflict for the dates" },
  { key: "inspection_fit", label: "Pre-dispatch inspection: machine declared fit" },
  { key: "compliance_documents", label: "Insurance, licences, permits and certificates complete" },
  { key: "operator_verified", label: "Competent operator assigned and verified" },
  { key: "site_readiness", label: "Site access, unloading and working area ready" },
  { key: "transport_approved", label: "Transport method, route, permit and cost approved" },
  { key: "fuel_controls", label: "Fuel allocation and fuel register in place" },
  { key: "maintenance_controls", label: "Maintenance, pre-start and breakdown controls in place" },
  { key: "plant_manager_declaration", label: "Plant Manager declares the machine ready" },
];

type ReadinessPack = Record<string, boolean>;

function readinessFrom(request: RecordItem): ReadinessPack {
  const raw = (request.readiness_pack && typeof request.readiness_pack === "object" ? request.readiness_pack : {}) as Record<string, unknown>;
  return Object.fromEntries(READINESS_CONTROLS.map(({ key }) => [key, Boolean(raw[key])]));
}

function num(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function fmtHours(value: number): string {
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 1 })} h`;
}

const CLOSED_STATUSES = ["closed", "cancelled", "rejected"];

function ReadinessChecklist({ pack, onChange }: { pack: ReadinessPack; onChange: (next: ReadinessPack) => void }) {
  const done = READINESS_CONTROLS.filter(({ key }) => pack[key]).length;
  const allDone = done === READINESS_CONTROLS.length;
  return (
    <div className="border border-ink-mid">
      <div className="flex items-center justify-between border-b border-ink-mid bg-ink-light px-3 py-2">
        <span className="font-mono text-[10px] uppercase text-slate">
          Mobilisation readiness · {done}/{READINESS_CONTROLS.length}
        </span>
        <button
          type="button"
          onClick={() => onChange(Object.fromEntries(READINESS_CONTROLS.map(({ key }) => [key, !allDone])))}
          className="text-[11px] text-signal hover:underline"
        >
          {allDone ? "Clear all" : "Tick all"}
        </button>
      </div>
      <ul className="max-h-64 divide-y divide-ink-mid overflow-y-auto">
        {READINESS_CONTROLS.map(({ key, label }) => (
          <li key={key}>
            <label className="flex cursor-pointer items-start gap-2 px-3 py-1.5 text-xs hover:bg-ink-light">
              <input
                type="checkbox"
                checked={Boolean(pack[key])}
                onChange={(e) => onChange({ ...pack, [key]: e.target.checked })}
                className="mt-0.5 accent-emerald-500"
              />
              <span className={pack[key] ? "text-slate-light" : "text-paper"}>{label}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

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

function buildPlantRequestInvoiceData(req: RecordItem) {
  const reqNum = text(req, "request_number") || `REQ-${req.id.slice(0, 8).toUpperCase()}`;
  const assetType = text(req, "required_asset_type") || "Heavy Plant Asset";
  const location = text(req, "work_location") || "Project Site";
  const startDate = req.start_date ? fmtDate(String(req.start_date)) : "Mobilisation Date";
  const endDate = req.end_date ? fmtDate(String(req.end_date)) : "Ongoing Operations";
  const workDesc = text(req, "work_description") || "Commercial plant works execution";
  const fuelResp = text(req, "fuel_responsibility") || "snc";
  const transportReq = text(req, "transport_requirement") || "low_bed";
  const opMode = text(req, "operating_hours_mode") || "normal";
  const assignedAsset = text(req, "assigned_asset_name") || text(req, "fleet_id") || "Allocated Plant Unit";

  const items = [
    {
      item_no: "1",
      description: `Plant Equipment Deployment: ${assetType} — ${workDesc} at ${location} (${opMode} shift operations)`,
      amount_excl_vat: 4800.0,
      already_pro_rated: true,
    },
    {
      item_no: "2",
      description: `Transport & Heavy Carrier Logistics — Heavy ${transportReq.replace(/_/g, " ")} mobilization to ${location}`,
      amount_excl_vat: 650.0,
      already_pro_rated: true,
    },
    {
      item_no: "3",
      description: `Operator & Fuel Surcharge Provision (${fuelResp.toUpperCase()} fuel responsibility & certified plant operator)`,
      amount_excl_vat: 350.0,
      already_pro_rated: true,
    },
  ];

  const notes = [
    `Plant Request Reference: ${reqNum}.`,
    `Operational Deployment Period: ${startDate} to ${endDate}.`,
    `Designated Asset: ${assignedAsset} (${assetType}).`,
    `Work Location & Site Scope: ${location} — ${workDesc}.`,
    `Fuel & Operator Responsibility: Fuel provided by ${fuelResp.toUpperCase()}, machine operated by certified SNC plant operator.`,
    `Settlement Terms: Banc ABC Southerton Branch account 54925046633016. Reference ${reqNum}.`,
  ];

  return {
    invoiceType: "TAX INVOICE" as const,
    invoiceNumber: reqNum,
    subject: `Heavy Plant Job Invoice — ${assetType} Deployment at ${location}`,
    clientName: location.includes("Site") || location.includes("Project") ? location : `Client Works — ${location}`,
    clientAddress: `${location}, Zimbabwe`,
    clientVat: "",
    clientTin: "",
    quotationRef: reqNum,
    clientPo: "—",
    depositPercentage: 0,
    applyVat: true,
    items,
    notes,
  };
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
  const [actionModal, setActionModal] = useState<{
    type: "new" | "dispatch" | "reserve" | "validate" | "switch_machine" | "generate_invoice" | "manage";
    request?: RecordItem;
  } | null>(null);
  const { role, roles, isSuperAdmin } = useAuth();
  const isMachineSwitchAuthorized = useMemo(() => {
    if (isSuperAdmin) return true;
    const allRoles = [role, ...(roles || [])].filter(Boolean).map((r) => String(r).toLowerCase().replace(/_/g, " ").trim());
    const allowed = ["superadmin", "admin", "executive", "executive (admin)", "plant manager", "equipment manager", "fleet manager", "managing director", "director"];
    return allRoles.some((r) => allowed.some((a) => r.includes(a)));
  }, [role, roles, isSuperAdmin]);


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
            <OperationalTable className="min-w-[1250px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Request Ref</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Asset Class / Need</TableHead>
                  <TableHead>Machine</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Start Date</TableHead>
                  <TableHead>Hours</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <tbody>
                {filtered.map((req) => {
                  const st = text(req, "status");
                  const isCrossHire = text(req, "current_asset_ownership") === "hired_in";
                  const planned = req.planned_hours === null || req.planned_hours === undefined ? null : num(req.planned_hours);
                  const worked = num(req.hours_worked);
                  const readinessDone = READINESS_CONTROLS.filter(({ key }) => readinessFrom(req)[key]).length;
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
                      <TableCell>
                        {text(req, "current_fleet_id") ? (
                          <>
                            <p className="font-medium text-paper">{text(req, "current_asset_code", "current_asset_registration")}</p>
                            <p className="text-[11px] text-slate-light">
                              {isCrossHire ? (
                                <span className="text-purple-300">Cross-hire · {text(req, "current_asset_supplier") || "supplier"}</span>
                              ) : (
                                "Internal fleet"
                              )}
                            </p>
                          </>
                        ) : (
                          <span className="text-[11px] text-slate">Not allocated</span>
                        )}
                      </TableCell>
                      <TableCell>{text(req, "work_location") || "—"}</TableCell>
                      <TableCell>{req.start_date ? fmtDate(String(req.start_date)) : "—"}</TableCell>
                      <TableCell>
                        <p className="text-paper">{fmtHours(worked)}{planned !== null ? ` / ${fmtHours(planned)}` : ""}</p>
                        <p className={`text-[11px] ${planned !== null && worked > planned ? "text-rose-300" : "text-slate-light"}`}>
                          {planned === null ? "No plan set" : worked > planned ? `${fmtHours(worked - planned)} over` : `${fmtHours(planned - worked)} left`}
                        </p>
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex border border-slate/40 bg-ink-light px-2 py-0.5 font-mono text-[10px] uppercase text-paper">
                          {st.replace(/_/g, " ")}
                        </span>
                        {!CLOSED_STATUSES.includes(st) && !["dispatched", "active", "returned"].includes(st) && (
                          <p className={`mt-1 text-[10px] ${readinessDone === READINESS_CONTROLS.length ? "text-emerald-300" : "text-amber-300"}`}>
                            Readiness {readinessDone}/{READINESS_CONTROLS.length}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {!CLOSED_STATUSES.includes(st) && (
                            <button
                              type="button"
                              onClick={() => setActionModal({ type: "manage", request: req })}
                              className="border border-signal/50 px-2 py-1 text-[11px] text-signal hover:bg-signal/10 inline-flex items-center gap-1"
                              title="Tick off readiness items, set planned hours and log hours worked"
                            >
                              <ClipboardCheck size={11} /> Readiness & Hours
                            </button>
                          )}
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
                          {isMachineSwitchAuthorized && ["approved", "reserved", "ready_for_dispatch", "dispatched", "active"].includes(st) && (
                            <button
                              type="button"
                              onClick={() => setActionModal({ type: "switch_machine", request: req })}
                              className="border border-purple-500/40 bg-purple-500/10 px-2 py-1 text-[11px] text-purple-200 hover:bg-purple-500/20"
                              title="Switch machine (Executives, Plant Manager, Admin)"
                            >
                              <ArrowRightLeft size={11} className="inline mr-1" /> Swap Machine
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
                          <button
                            type="button"
                            onClick={() => setActionModal({ type: "generate_invoice", request: req })}
                            className="border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-300 hover:bg-emerald-500/20 inline-flex items-center gap-1"
                            title="Generate and download official SNC Tax/Proforma Invoice for this plant deployment job"
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

        {/* Modal: Switch Machine */}
        {actionModal?.type === "switch_machine" && actionModal.request && (
          <SwitchPlantMachineModal
            request={actionModal.request}
            fleetAssets={fleetAssets}
            onClose={() => setActionModal(null)}
            onSuccess={() => {
              setActionModal(null);
              setNotice("Machine successfully switched.");
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

        {/* Modal: Readiness checklist, planned hours and hour logs */}
        {actionModal?.type === "manage" && actionModal.request && (
          <PlantReadinessHoursModal
            request={actionModal.request}
            onClose={() => setActionModal(null)}
            onChanged={() => void refetch()}
          />
        )}

        {/* Modal: Official SNC Invoice for Plant Request */}
        {actionModal?.type === "generate_invoice" && actionModal.request && (
          <GenerateInvoiceModal
            isOpen={true}
            onClose={() => setActionModal(null)}
            initialData={buildPlantRequestInvoiceData(actionModal.request)}
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
  const [reservedFrom, setReservedFrom] = useState(
    request.start_date ? String(request.start_date).slice(0, 10) : new Date().toISOString().slice(0, 10)
  );
  const [reservedUntil, setReservedUntil] = useState(
    request.end_date ? String(request.end_date).slice(0, 10) : ""
  );
  const [conditions, setConditions] = useState(`Reserved for ${text(request, "request_number") || "plant request"}`);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleReserve = async () => {
    if (!selectedAssetId) return;
    setSubmitting(true);
    setErr(null);
    try {
      await reservePlantAsset(request.id, {
        fleet_id: selectedAssetId,
        reserved_from: reservedFrom ? new Date(reservedFrom).toISOString() : new Date().toISOString(),
        reserved_until: reservedUntil ? new Date(reservedUntil).toISOString() : undefined,
        conditions: conditions,
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
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-mono uppercase text-slate mb-1">Reserved From</label>
              <input
                type="date"
                value={reservedFrom}
                onChange={(e) => setReservedFrom(e.target.value)}
                className="w-full border border-ink-mid bg-ink-light px-3 py-2 text-xs text-paper"
                required
              />
            </div>
            <div>
              <label className="block text-[11px] font-mono uppercase text-slate mb-1">Reserved Until</label>
              <input
                type="date"
                value={reservedUntil}
                onChange={(e) => setReservedUntil(e.target.value)}
                className="w-full border border-ink-mid bg-ink-light px-3 py-2 text-xs text-paper"
              />
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-mono uppercase text-slate mb-1">Conditions & Notes</label>
            <textarea
              rows={2}
              value={conditions}
              onChange={(e) => setConditions(e.target.value)}
              className="w-full border border-ink-mid bg-ink-light px-3 py-2 text-xs text-paper resize-none"
              placeholder="Pre-delivery inspection, attachments required..."
            />
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
  // Default to the machine reserved for this request, not the first fleet row.
  const [selectedAssetId, setSelectedAssetId] = useState(
    text(request, "current_fleet_id") || fleetAssets[0]?.id || ""
  );
  const [transporter, setTransporter] = useState("SNC Logistics Lowbed");
  const [driver, setDriver] = useState("");
  const [destination, setDestination] = useState(text(request, "work_location") || "Project Site");
  const [notes, setNotes] = useState("");
  const [readiness, setReadiness] = useState<ReadinessPack>(() => readinessFrom(request));
  const [submitting, setSubmitting] = useState(false);
  const [savingChecklist, setSavingChecklist] = useState(false);
  const [checklistSaved, setChecklistSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const outstanding = READINESS_CONTROLS.filter(({ key }) => !readiness[key]).length;
  const reservedMissing = text(request, "current_fleet_id") && !fleetAssets.some((a) => a.id === text(request, "current_fleet_id"));
  const today = new Date().toISOString().slice(0, 10);
  const originalEnd = request.end_date ? String(request.end_date).slice(0, 10) : "";
  const [endDate, setEndDate] = useState(originalEnd);
  const endPassed = Boolean(endDate) && endDate < today;

  const saveChecklist = async () => {
    setSavingChecklist(true);
    setErr(null);
    try {
      await updatePlantRequestReadiness(request.id, {
        readiness_pack: readiness,
        ...(endDate !== originalEnd ? { end_date: endDate || null } : {}),
      });
      setChecklistSaved(true);
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : "Failed to save the readiness checklist.");
    } finally {
      setSavingChecklist(false);
    }
  };

  const handleDispatch = async () => {
    setSubmitting(true);
    setErr(null);
    try {
      if (endDate !== originalEnd) {
        await updatePlantRequestReadiness(request.id, { end_date: endDate || null });
      }
      // The ticks travel with the dispatch, so ticking and dispatching is one step.
      await dispatchPlantAsset(request.id, {
        fleet_id: selectedAssetId || undefined,
        destination_location: destination,
        transporter_name: transporter,
        driver_name: driver,
        dispatch_notes: notes,
        dispatch_pack: { readiness_pack: readiness },
      });
      onSuccess();
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : "Failed to issue dispatch note.");
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="relative flex max-h-[92vh] w-full max-w-lg flex-col border border-ink-mid bg-ink shadow-2xl">
        <div className="flex items-center justify-between border-b border-ink-mid px-5 py-4">
          <h2 className="text-sm font-semibold text-paper">Issue Mobilisation Dispatch Note</h2>
          <button type="button" onClick={onClose} className="text-slate hover:text-paper">
            <X size={18} />
          </button>
        </div>
        <div className="p-5 space-y-4 overflow-y-auto">
          {err && <div className="border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">{err}</div>}

          <ReadinessChecklist
            pack={readiness}
            onChange={(next) => {
              setReadiness(next);
              setChecklistSaved(false);
            }}
          />
          <div className="flex items-center justify-between gap-2 text-[11px]">
            <span className={outstanding ? "text-amber-300" : "text-emerald-300"}>
              {outstanding ? `${outstanding} item${outstanding === 1 ? "" : "s"} still blocking dispatch` : "All readiness items confirmed"}
            </span>
            <button
              type="button"
              onClick={() => void saveChecklist()}
              disabled={savingChecklist}
              className="border border-ink-mid px-2 py-1 text-paper hover:border-slate disabled:opacity-50"
            >
              {savingChecklist ? "Saving..." : checklistSaved ? "Saved" : "Save checklist only"}
            </button>
          </div>

          <div>
            <label className="block text-[11px] font-mono uppercase text-slate mb-1">Hire End Date</label>
            <input
              type="date"
              value={endDate}
              min={today}
              onChange={(e) => {
                setEndDate(e.target.value);
                setChecklistSaved(false);
              }}
              className={`w-full border bg-ink-light px-3 py-2 text-xs text-paper ${endPassed ? "border-amber-500/60" : "border-ink-mid"}`}
            />
            <p className={`mt-1 text-[11px] ${endPassed ? "text-amber-300" : "text-slate"}`}>
              {endPassed ? "This date has passed — move it forward to dispatch." : endDate ? "The machine is booked through this date." : "Open-ended hire."}
            </p>
          </div>

          <div>
            <label className="block text-[11px] font-mono uppercase text-slate mb-1">Confirm Machine Dispatched</label>
            <select
              value={selectedAssetId}
              onChange={(e) => setSelectedAssetId(e.target.value)}
              className="w-full border border-ink-mid bg-ink-light px-3 py-2 text-xs text-paper"
            >
              {reservedMissing && (
                <option value={text(request, "current_fleet_id")}>
                  {text(request, "current_asset_code", "current_asset_registration")} (reserved)
                </option>
              )}
              {fleetAssets.map((a) => (
                <option key={a.id} value={a.id}>
                  {text(a, "asset_code", "vehicle_registration")} — {text(a, "name", "asset_type")} ({text(a, "operational_status")})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-mono uppercase text-slate mb-1">Delivery Destination / Site</label>
            <input
              type="text"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              className="w-full border border-ink-mid bg-ink-light px-3 py-2 text-xs text-paper"
              required
            />
          </div>

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
              className="w-full border border-ink-mid bg-ink-light px-3 py-2 text-xs text-paper resize-none"
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
              disabled={submitting || outstanding > 0 || endPassed}
              title={outstanding > 0 ? "Tick every readiness item first" : endPassed ? "Move the hire end date forward first" : undefined}
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

function SwitchPlantMachineModal({
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
  const currentFleetId = text(request, "current_fleet_id");
  // Internal fleet = owned/leased machines already in the register; hired-in
  // machines from earlier cross-hires are left out (cross-hire a new one instead).
  const internalAssets = useMemo(
    () => fleetAssets.filter((a) => a.id !== currentFleetId && text(a, "ownership_type") !== "hired_in"),
    [fleetAssets, currentFleetId]
  );
  const [source, setSource] = useState<"internal" | "cross_hire">("internal");
  const [selectedAssetId, setSelectedAssetId] = useState(internalAssets[0]?.id || "");
  const [hire, setHire] = useState({
    supplier_name: "",
    supplier_contact: "",
    agreement_reference: "",
    asset_type: text(request, "required_asset_type"),
    make_model: "",
    registration_or_serial: "",
    hire_rate: "",
    hire_rate_unit: "hourly",
    meter_reading: "",
  });
  const [reason, setReason] = useState("Machine breakdown / mechanical replacement");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const canSubmit = source === "internal" ? Boolean(selectedAssetId) : Boolean(hire.supplier_name.trim() && hire.registration_or_serial.trim());

  const handleSwitch = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setErr(null);
    try {
      await switchPlantAsset(request.id, {
        ...(source === "internal"
          ? { new_fleet_id: selectedAssetId }
          : {
              cross_hire: {
                supplier_name: hire.supplier_name.trim(),
                supplier_contact: hire.supplier_contact.trim() || undefined,
                agreement_reference: hire.agreement_reference.trim() || undefined,
                asset_type: hire.asset_type.trim() || undefined,
                make_model: hire.make_model.trim() || undefined,
                registration_or_serial: hire.registration_or_serial.trim(),
                hire_rate: Number(hire.hire_rate) || 0,
                hire_rate_unit: hire.hire_rate_unit,
                meter_reading: hire.meter_reading ? Number(hire.meter_reading) : undefined,
              },
            }),
        reason,
        notes: notes || undefined,
      });
      onSuccess();
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : "Failed to switch machine.");
      setSubmitting(false);
    }
  };

  const field = "w-full border border-ink-mid bg-ink-light px-3 py-2 text-xs text-paper";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="relative flex max-h-[92vh] w-full max-w-lg flex-col border border-purple-500/40 bg-ink shadow-2xl">
        <div className="flex items-center justify-between border-b border-ink-mid px-5 py-4">
          <div className="flex items-center gap-2">
            <ArrowRightLeft className="text-purple-400" size={16} />
            <h2 className="text-sm font-semibold text-paper">Swap Machine — Internal Fleet or Cross-Hire</h2>
          </div>
          <button type="button" onClick={onClose} className="text-slate hover:text-paper">
            <X size={18} />
          </button>
        </div>
        <div className="p-5 space-y-4 overflow-y-auto">
          {err && <div className="border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">{err}</div>}
          <div className="border border-ink-mid bg-ink-light p-3 space-y-1">
            <p className="text-xs text-slate-light">Request Ref: <span className="font-semibold text-paper">{text(request, "request_number") || request.id.slice(0, 8)}</span></p>
            <p className="text-xs text-slate-light">Required Asset: <span className="text-paper">{text(request, "required_asset_type")}</span></p>
            <p className="text-xs text-slate-light">
              Current Machine:{" "}
              <span className="text-paper">
                {currentFleetId
                  ? `${text(request, "current_asset_code", "current_asset_registration")} (${text(request, "current_asset_ownership") === "hired_in" ? `cross-hire from ${text(request, "current_asset_supplier") || "supplier"}` : "internal fleet"})`
                  : "none allocated"}
              </span>
            </p>
          </div>

          <div className="grid grid-cols-2 gap-px border border-ink-mid bg-ink-mid">
            {([
              ["internal", "Internal fleet", "Use one of our own machines"],
              ["cross_hire", "Cross-hire", "Hire a machine in from a supplier"],
            ] as const).map(([value, label, hint]) => (
              <button
                key={value}
                type="button"
                onClick={() => setSource(value)}
                className={`p-3 text-left ${source === value ? "bg-purple-500/15 text-paper" : "bg-ink text-slate-light hover:text-paper"}`}
              >
                <span className="block text-xs font-semibold">{label}</span>
                <span className="block text-[11px] text-slate">{hint}</span>
              </button>
            ))}
          </div>

          {source === "internal" ? (
            <div>
              <label className="block text-[11px] font-mono uppercase text-slate mb-1">Replacement Machine</label>
              {internalAssets.length === 0 ? (
                <p className="text-xs text-amber-300">No other internal machines in the fleet register — use Cross-hire.</p>
              ) : (
                <select value={selectedAssetId} onChange={(e) => setSelectedAssetId(e.target.value)} className={field}>
                  {internalAssets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {text(a, "asset_code", "vehicle_registration")} — {text(a, "name", "asset_type")} ({text(a, "operational_status")})
                    </option>
                  ))}
                </select>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-mono uppercase text-slate mb-1">Supplier *</label>
                  <input value={hire.supplier_name} onChange={(e) => setHire({ ...hire, supplier_name: e.target.value })} className={field} placeholder="Hire company" />
                </div>
                <div>
                  <label className="block text-[11px] font-mono uppercase text-slate mb-1">Supplier Contact</label>
                  <input value={hire.supplier_contact} onChange={(e) => setHire({ ...hire, supplier_contact: e.target.value })} className={field} placeholder="Name / phone" />
                </div>
                <div>
                  <label className="block text-[11px] font-mono uppercase text-slate mb-1">Machine Type</label>
                  <input value={hire.asset_type} onChange={(e) => setHire({ ...hire, asset_type: e.target.value })} className={field} placeholder="Excavator 30T" />
                </div>
                <div>
                  <label className="block text-[11px] font-mono uppercase text-slate mb-1">Make & Model</label>
                  <input value={hire.make_model} onChange={(e) => setHire({ ...hire, make_model: e.target.value })} className={field} placeholder="CAT 330" />
                </div>
                <div>
                  <label className="block text-[11px] font-mono uppercase text-slate mb-1">Reg / Serial No. *</label>
                  <input value={hire.registration_or_serial} onChange={(e) => setHire({ ...hire, registration_or_serial: e.target.value })} className={field} />
                </div>
                <div>
                  <label className="block text-[11px] font-mono uppercase text-slate mb-1">Hire Agreement Ref</label>
                  <input value={hire.agreement_reference} onChange={(e) => setHire({ ...hire, agreement_reference: e.target.value })} className={field} />
                </div>
                <div>
                  <label className="block text-[11px] font-mono uppercase text-slate mb-1">Hire Rate (USD)</label>
                  <div className="flex">
                    <input type="number" min={0} step="0.01" value={hire.hire_rate} onChange={(e) => setHire({ ...hire, hire_rate: e.target.value })} className={field} />
                    <select value={hire.hire_rate_unit} onChange={(e) => setHire({ ...hire, hire_rate_unit: e.target.value })} className="border border-l-0 border-ink-mid bg-ink-light px-2 text-xs text-paper">
                      <option value="hourly">/hour</option>
                      <option value="daily">/day</option>
                      <option value="weekly">/week</option>
                      <option value="monthly">/month</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] font-mono uppercase text-slate mb-1">Hour Meter at Delivery</label>
                  <input type="number" min={0} step="0.1" value={hire.meter_reading} onChange={(e) => setHire({ ...hire, meter_reading: e.target.value })} className={field} />
                </div>
              </div>
              <p className="text-[11px] text-slate">
                The hired machine is added to the fleet register as hired-in, so dispatch, hour logs, fuel and off-hire work as normal. An hourly rate is used to cost the hours logged.
              </p>
            </div>
          )}
          <div>
            <label className="block text-[11px] font-mono uppercase text-slate mb-1">Reason for Switch</label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full border border-ink-mid bg-ink-light px-3 py-2 text-xs text-paper"
            >
              <option value="Machine breakdown / mechanical replacement">Machine breakdown / mechanical replacement</option>
              <option value="Routine PM / Service due on current asset">Routine PM / Service due on current asset</option>
              <option value="Capacity / Output upgrade required for site">Capacity / Output upgrade required for site</option>
              <option value="Operational reallocation by Plant Manager">Operational reallocation by Plant Manager</option>
              <option value="Executive override">Executive override</option>
              <option value="No internal machine available - cross-hired">No internal machine available - cross-hired</option>
              <option value="Cross-hire returned - back to internal fleet">Cross-hire returned - back to internal fleet</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-mono uppercase text-slate mb-1">Authorization Notes & Remarks</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full border border-ink-mid bg-ink-light px-3 py-2 text-xs text-paper resize-none"
              placeholder="Provide hand-over details or logbook odometer reference..."
            />
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-ink-mid">
            <button type="button" onClick={onClose} className="px-4 py-2 text-xs text-slate hover:text-paper">
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSwitch}
              disabled={submitting || !canSubmit}
              className="bg-purple-600 px-4 py-2 text-xs font-semibold text-white hover:bg-purple-500 disabled:opacity-50"
            >
              {submitting ? "Switching..." : "Confirm Machine Switch"}
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
              <p className="font-semibold text-purple-200">Don&apos;t have this unit in company fleet?</p>
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

function PlantReadinessHoursModal({
  request,
  onClose,
  onChanged,
}: {
  request: RecordItem;
  onClose: () => void;
  onChanged: () => void;
}) {
  const requestId = request.id;
  // POST /fleet/utilization requires fleet.create; Plant and Project Managers
  // can manage readiness (fleet.plant_requests.update) without holding it.
  const { permissions, isSuperAdmin } = useAuth();
  const canLogHours = isSuperAdmin || Boolean(permissions?.has("fleet.create"));
  const fleetId = text(request, "current_fleet_id");
  const assignmentId = text(request, "current_assignment_id");
  const [tab, setTab] = useState<"readiness" | "hours">(
    ["dispatched", "active", "returned"].includes(text(request, "status")) ? "hours" : "readiness"
  );
  const [readiness, setReadiness] = useState<ReadinessPack>(() => readinessFrom(request));
  const [plannedHours, setPlannedHours] = useState(
    request.planned_hours === null || request.planned_hours === undefined ? "" : String(num(request.planned_hours))
  );
  const originalStart = request.start_date ? String(request.start_date).slice(0, 10) : "";
  const originalEnd = request.end_date ? String(request.end_date).slice(0, 10) : "";
  const [startDate, setStartDate] = useState(originalStart);
  const [endDate, setEndDate] = useState(originalEnd);
  const [loggedThisSession, setLoggedThisSession] = useState(0);
  const [logs, setLogs] = useState<RecordItem[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const [entry, setEntry] = useState({ occurred_on: today, start_meter: "", end_meter: "", operating_hours: "", idle_hours: "0", downtime_hours: "0", work_performed: "" });

  const worked = num(request.hours_worked) + loggedThisSession;
  const planned = plannedHours.trim() === "" ? null : num(plannedHours);
  const left = planned === null ? null : planned - worked;
  const pct = planned && planned > 0 ? Math.min(100, (worked / planned) * 100) : 0;

  const loadLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      const res = await getFleetUtilizationLogs({ plant_request_id: requestId, limit: 50 });
      setLogs(Array.isArray(res.data) ? (res.data as RecordItem[]) : []);
    } catch {
      setLogs([]);
    } finally {
      setLogsLoading(false);
    }
  }, [requestId]);

  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  // Start/end hour-meter readings fill in the hours worked automatically.
  const setMeter = (field: "start_meter" | "end_meter", value: string) => {
    const next = { ...entry, [field]: value };
    const start = Number(next.start_meter);
    const end = Number(next.end_meter);
    if (next.start_meter !== "" && next.end_meter !== "" && Number.isFinite(start) && Number.isFinite(end) && end >= start) {
      next.operating_hours = String(Math.round((end - start) * 100) / 100);
    }
    setEntry(next);
  };

  const saveReadinessAndPlan = async () => {
    setSaving(true);
    setMsg(null);
    try {
      if (startDate && endDate && endDate < startDate) {
        setMsg({ kind: "err", text: "The hire end date cannot be before the start date." });
        return;
      }
      const res = await updatePlantRequestReadiness(requestId, {
        readiness_pack: readiness,
        planned_hours: planned,
        ...(startDate && startDate !== originalStart ? { start_date: startDate } : {}),
        ...(endDate !== originalEnd ? { end_date: endDate || null } : {}),
      });
      const blockers = res.data?.readiness_blockers ?? [];
      setMsg({ kind: "ok", text: blockers.length ? `Saved. ${blockers.length} item${blockers.length === 1 ? "" : "s"} still outstanding before dispatch.` : "Saved. All readiness items confirmed - ready to dispatch." });
      onChanged();
    } catch (e: any) {
      setMsg({ kind: "err", text: e instanceof ApiError ? e.message : "Failed to save." });
    } finally {
      setSaving(false);
    }
  };

  const logHours = async () => {
    const hours = Number(entry.operating_hours);
    if (!fleetId) {
      setMsg({ kind: "err", text: "Allocate a machine to this request before logging hours." });
      return;
    }
    if (!Number.isFinite(hours) || hours <= 0 || hours > 24) {
      setMsg({ kind: "err", text: "Enter the hours worked for the day (more than 0, up to 24)." });
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      await recordFleetUtilization({
        fleet_id: fleetId,
        assignment_id: assignmentId || undefined,
        plant_request_id: requestId,
        occurred_on: entry.occurred_on,
        operating_hours: hours,
        idle_hours: Number(entry.idle_hours) || 0,
        downtime_hours: Number(entry.downtime_hours) || 0,
        engine_hours: entry.end_meter !== "" ? Number(entry.end_meter) : undefined,
        start_engine_hours: entry.start_meter !== "" ? Number(entry.start_meter) : undefined,
        end_engine_hours: entry.end_meter !== "" ? Number(entry.end_meter) : undefined,
        work_performed: entry.work_performed.trim() || undefined,
      });
      setLoggedThisSession((h) => h + hours);
      setEntry({ ...entry, start_meter: entry.end_meter, end_meter: "", operating_hours: "", idle_hours: "0", downtime_hours: "0", work_performed: "" });
      setMsg({ kind: "ok", text: `${fmtHours(hours)} logged for ${entry.occurred_on}.` });
      void loadLogs();
      onChanged();
    } catch (e: any) {
      setMsg({ kind: "err", text: e instanceof ApiError ? e.message : "Failed to log hours." });
    } finally {
      setSaving(false);
    }
  };

  const field = "w-full border border-ink-mid bg-ink-light px-3 py-2 text-xs text-paper";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="relative flex max-h-[92vh] w-full max-w-2xl flex-col border border-ink-mid bg-ink shadow-2xl">
        <div className="flex items-center justify-between border-b border-ink-mid px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-paper">Readiness & Hours — {text(request, "request_number") || request.id.slice(0, 8)}</h2>
            <p className="text-[11px] text-slate-light">
              {text(request, "required_asset_type")} ·{" "}
              {fleetId
                ? `${text(request, "current_asset_code", "current_asset_registration")} (${text(request, "current_asset_ownership") === "hired_in" ? "cross-hire" : "internal fleet"})`
                : "no machine allocated"}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-slate hover:text-paper" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="flex border-b border-ink-mid">
          {([["readiness", "Readiness checklist"], ["hours", "Hours worked"]] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => { setTab(value); setMsg(null); }}
              className={`px-4 py-2 text-xs ${tab === value ? "border-b-2 border-signal text-paper" : "text-slate hover:text-paper"}`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="space-y-4 overflow-y-auto p-5">
          {msg && (
            <div className={`border p-3 text-xs ${msg.kind === "ok" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-100" : "border-rose-500/40 bg-rose-500/10 text-rose-200"}`}>
              {msg.text}
            </div>
          )}

          <section className="grid grid-cols-3 gap-px border border-ink-mid bg-ink-mid">
            <div className="bg-ink p-3">
              <label className="block font-mono text-[10px] uppercase text-slate">Planned hours</label>
              <input
                type="number"
                min={0}
                step="0.5"
                value={plannedHours}
                onChange={(e) => setPlannedHours(e.target.value)}
                placeholder="Set plan"
                className="mt-1 w-full border border-ink-mid bg-ink-light px-2 py-1 text-sm text-paper"
              />
            </div>
            <div className="bg-ink p-3">
              <span className="block font-mono text-[10px] uppercase text-slate">Hours worked</span>
              <p className="mt-1 text-xl font-bold text-paper">{fmtHours(worked)}</p>
            </div>
            <div className="bg-ink p-3">
              <span className="block font-mono text-[10px] uppercase text-slate">Hours left</span>
              <p className={`mt-1 text-xl font-bold ${left !== null && left < 0 ? "text-rose-300" : "text-emerald-300"}`}>
                {left === null ? "—" : left < 0 ? `${fmtHours(-left)} over` : fmtHours(left)}
              </p>
            </div>
          </section>
          {planned !== null && planned > 0 && (
            <div className="h-1.5 w-full bg-ink-mid">
              <div className={`h-full ${worked > planned ? "bg-rose-400" : "bg-emerald-400"}`} style={{ width: `${pct}%` }} />
            </div>
          )}

          {tab === "readiness" ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block font-mono text-[10px] uppercase text-slate">Hire start</label>
                  <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={field} />
                </div>
                <div>
                  <label className="mb-1 block font-mono text-[10px] uppercase text-slate">Hire end (blank = open-ended)</label>
                  <input
                    type="date"
                    value={endDate}
                    min={startDate || undefined}
                    onChange={(e) => setEndDate(e.target.value)}
                    className={`${field} ${endDate && endDate < today ? "border-amber-500/60" : ""}`}
                  />
                  {endDate && endDate < today && !["dispatched", "active", "returned"].includes(text(request, "status")) && (
                    <p className="mt-1 text-[11px] text-amber-300">This date has passed — move it forward before dispatching.</p>
                  )}
                </div>
              </div>
              <ReadinessChecklist pack={readiness} onChange={setReadiness} />
              <p className="text-[11px] text-slate">
                Every item must be ticked before a dispatch note can be issued. Critical machine defects still block dispatch until they are closed.
              </p>
            </>
          ) : (
            <>
              {!fleetId ? (
                <p className="border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
                  Reserve a machine (or cross-hire one with Swap Machine) before logging hours.
                </p>
              ) : !canLogHours ? (
                <p className="border border-ink-mid bg-ink-light p-3 text-xs text-slate-light">
                  Logging hours needs the fleet &quot;create&quot; permission, which your role does not have. Ask an administrator to log them or grant it.
                </p>
              ) : (
                <div className="space-y-3 border border-ink-mid p-3">
                  <span className="font-mono text-[10px] uppercase text-slate">Log a day&apos;s hours</span>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div>
                      <label className="mb-1 block text-[10px] uppercase text-slate">Date</label>
                      <input type="date" max={today} value={entry.occurred_on} onChange={(e) => setEntry({ ...entry, occurred_on: e.target.value })} className={field} />
                    </div>
                    <div>
                      <label className="mb-1 block text-[10px] uppercase text-slate">Meter start</label>
                      <input type="number" min={0} step="0.1" value={entry.start_meter} onChange={(e) => setMeter("start_meter", e.target.value)} className={field} />
                    </div>
                    <div>
                      <label className="mb-1 block text-[10px] uppercase text-slate">Meter end</label>
                      <input type="number" min={0} step="0.1" value={entry.end_meter} onChange={(e) => setMeter("end_meter", e.target.value)} className={field} />
                    </div>
                    <div>
                      <label className="mb-1 block text-[10px] uppercase text-slate">Hours worked *</label>
                      <input type="number" min={0} max={24} step="0.5" value={entry.operating_hours} onChange={(e) => setEntry({ ...entry, operating_hours: e.target.value })} className={field} />
                    </div>
                    <div>
                      <label className="mb-1 block text-[10px] uppercase text-slate">of which idle</label>
                      <input type="number" min={0} max={24} step="0.5" value={entry.idle_hours} onChange={(e) => setEntry({ ...entry, idle_hours: e.target.value })} className={field} />
                    </div>
                    <div>
                      <label className="mb-1 block text-[10px] uppercase text-slate">Downtime</label>
                      <input type="number" min={0} max={24} step="0.5" value={entry.downtime_hours} onChange={(e) => setEntry({ ...entry, downtime_hours: e.target.value })} className={field} />
                    </div>
                    <div className="col-span-2">
                      <label className="mb-1 block text-[10px] uppercase text-slate">Work done</label>
                      <input value={entry.work_performed} onChange={(e) => setEntry({ ...entry, work_performed: e.target.value })} className={field} placeholder="e.g. Bulk excavation, block B" />
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => void logHours()}
                      disabled={saving}
                      className="inline-flex items-center gap-1 bg-signal px-3 py-1.5 text-xs font-semibold text-ink hover:bg-signal/90 disabled:opacity-50"
                    >
                      <Clock size={12} /> {saving ? "Saving..." : "Log hours"}
                    </button>
                  </div>
                </div>
              )}

              <div className="border border-ink-mid">
                <div className="border-b border-ink-mid bg-ink-light px-3 py-2 font-mono text-[10px] uppercase text-slate">Hour log</div>
                {logsLoading ? (
                  <p className="p-3 text-xs text-slate">Loading…</p>
                ) : logs.length === 0 ? (
                  <p className="p-3 text-xs text-slate">No hours logged yet.</p>
                ) : (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-[10px] uppercase text-slate">
                        <th className="px-3 py-1.5">Date</th>
                        <th className="px-3 py-1.5">Machine</th>
                        <th className="px-3 py-1.5 text-right">Hours</th>
                        <th className="px-3 py-1.5 text-right">Idle</th>
                        <th className="px-3 py-1.5">Work</th>
                        <th className="px-3 py-1.5">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ink-mid">
                      {logs.map((log) => (
                        <tr key={log.id}>
                          <td className="px-3 py-1.5 text-paper">{log.occurred_on ? fmtDate(String(log.occurred_on)) : "—"}</td>
                          <td className="px-3 py-1.5 text-slate-light">{text(log, "asset_code", "vehicle_registration")}</td>
                          <td className="px-3 py-1.5 text-right text-paper">{num(log.operating_hours).toFixed(1)}</td>
                          <td className="px-3 py-1.5 text-right text-slate-light">{num(log.idle_hours).toFixed(1)}</td>
                          <td className="px-3 py-1.5 text-slate-light">{text(log, "work_performed", "notes") || "—"}</td>
                          <td className={`px-3 py-1.5 capitalize ${text(log, "approval_status") === "rejected" ? "text-rose-300" : "text-slate-light"}`}>
                            {text(log, "approval_status") || "submitted"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-ink-mid px-5 py-3">
          <button type="button" onClick={onClose} className="px-4 py-2 text-xs text-slate hover:text-paper">
            Close
          </button>
          <button
            type="button"
            onClick={() => void saveReadinessAndPlan()}
            disabled={saving}
            className="bg-signal px-4 py-2 text-xs font-semibold text-ink hover:bg-signal/90 disabled:opacity-50"
          >
            {saving ? "Saving..." : tab === "readiness" ? "Save checklist, dates & plan" : "Save planned hours"}
          </button>
        </div>
      </div>
    </div>
  );
}
