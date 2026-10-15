"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  CheckCircle2,
  Clock,
  Fuel,
  HardHat,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Truck,
  Wrench,
} from "lucide-react";
import { useAuth } from "@/lib/auth/AuthContext";
import {
  approveSitePlantRequest,
  createSitePlantRequest,
  getSitePlantRequests,
} from "@/lib/api";
import { Btn, Notice, Panel, Pill, errorText, fieldClass, areaClass, usd, qty } from "@/components/site-operations/ui";

const COMMON_PLANT_TYPES = [
  "20-Ton Excavator",
  "30-Ton Excavator",
  "10m³ Tipper Truck",
  "15m³ Tipper Truck",
  "TLB / Backhoe Loader",
  "Motor Grader",
  "Smooth Drum Roller (12T)",
  "Padfoot Compactor",
  "400L Concrete Mixer",
  "25-Ton Mobile Crane",
  "10,000L Water Bowser",
  "250 CFM Air Compressor",
  "50kVA Mobile Generator",
  "Front End Loader (Cat 950)",
  "Scaffolding & Acrow Props Set",
  "Plate Compactor / Rammer",
];

type PlantRequestRecord = {
  id: string;
  request_number: string;
  request_type: string;
  status: string;
  project_id: string;
  project_name?: string;
  required_asset_type: string;
  specification?: string;
  quantity: number;
  work_location: string;
  start_date: string;
  end_date?: string;
  operating_hours_mode: string;
  operator_required: boolean;
  fuel_responsibility: string;
  work_description: string;
  priority: string;
  created_at: string;
  approved_at?: string;
  approved_by?: string;
};

export function PlantTab({
  projectId,
  projectName,
  workDate,
  fleet,
  onPlantChanged,
}: {
  projectId: string;
  projectName: string;
  workDate: string;
  fleet: any[];
  onPlantChanged?: () => void;
}) {
  const { user, role, roles, isSuperAdmin } = useAuth();
  const [requests, setRequests] = useState<PlantRequestRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "error" | "success" | "info"; text: string } | null>(null);
  const [filter, setFilter] = useState("all");

  const [form, setForm] = useState({
    required_asset_type: COMMON_PLANT_TYPES[0],
    custom_asset_type: "",
    fleet_id: "",
    specification: "",
    quantity: "1",
    work_location: projectName || "Project Site",
    start_date: workDate,
    end_date: "",
    operating_hours_mode: "normal" as "normal" | "extended" | "continuous",
    operator_required: true,
    fuel_responsibility: "project" as "snc" | "project" | "client",
    priority: "routine" as "routine" | "urgent" | "emergency",
    work_description: "",
  });

  const canApprove = useMemo(() => {
    if (isSuperAdmin) return true;
    const r = (role || "").toLowerCase();
    const userRoles = (roles || []).map((x) => String(x).toLowerCase());
    return (
      r.includes("manager") ||
      r.includes("executive") ||
      r.includes("admin") ||
      r.includes("engineer") ||
      r.includes("agent") ||
      userRoles.some((x) => x.includes("manager") || x.includes("executive") || x.includes("director") || x.includes("engineer"))
    );
  }, [role, roles, isSuperAdmin]);

  const loadRequests = useCallback(async () => {
    if (!projectId) {
      setRequests([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await getSitePlantRequests(projectId);
      setRequests(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      setNotice({ tone: "error", text: errorText(err, "Unable to load plant requests.") });
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  // Active plant deployed to this project
  const activeFleetOnSite = useMemo(() => {
    return fleet.filter(
      (f) =>
        f.project_id === projectId ||
        (f.current_project_id && f.current_project_id === projectId) ||
        (f.project_name && projectName && f.project_name.toLowerCase() === projectName.toLowerCase())
    );
  }, [fleet, projectId, projectName]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectId) {
      setNotice({ tone: "error", text: "Select a project before submitting a plant request." });
      return;
    }
    const assetType = form.required_asset_type === "Other / Custom"
      ? form.custom_asset_type.trim()
      : form.required_asset_type;

    if (!assetType) {
      setNotice({ tone: "error", text: "Specify the required machinery or asset type." });
      return;
    }
    if (!form.work_description.trim()) {
      setNotice({ tone: "error", text: "Provide a brief description of the work to be performed." });
      return;
    }

    setSubmitting(true);
    try {
      await createSitePlantRequest({
        project_id: projectId,
        required_asset_type: assetType,
        fleet_id: form.fleet_id || null,
        specification: form.specification || null,
        quantity: Math.max(1, parseInt(form.quantity, 10) || 1),
        work_location: form.work_location || projectName || "Site",
        start_date: form.start_date || workDate,
        end_date: form.end_date || null,
        operating_hours_mode: form.operating_hours_mode,
        operator_required: form.operator_required,
        fuel_responsibility: form.fuel_responsibility,
        priority: form.priority,
        work_description: form.work_description.trim(),
      });
      setNotice({
        tone: "success",
        text: `Plant request for ${assetType} submitted. It will be reviewed by the Equipment Manager / Executive.`,
      });
      setForm((prev) => ({
        ...prev,
        custom_asset_type: "",
        specification: "",
        quantity: "1",
        work_description: "",
      }));
      await loadRequests();
      if (onPlantChanged) onPlantChanged();
    } catch (err) {
      setNotice({ tone: "error", text: errorText(err, "Failed to submit plant request.") });
    } finally {
      setSubmitting(false);
    }
  };

  const handleApprove = async (requestId: string) => {
    setApprovingId(requestId);
    try {
      await approveSitePlantRequest(requestId);
      setNotice({ tone: "success", text: "Plant request approved. Machinery allocation scheduled for site." });
      await loadRequests();
      if (onPlantChanged) onPlantChanged();
    } catch (err) {
      setNotice({ tone: "error", text: errorText(err, "Failed to approve plant request.") });
    } finally {
      setApprovingId(null);
    }
  };

  const filteredRequests = useMemo(() => {
    if (filter === "all") return requests;
    if (filter === "pending") return requests.filter((r) => ["submitted", "under_validation", "awaiting_approval"].includes(r.status));
    if (filter === "approved") return requests.filter((r) => ["approved", "reserved", "dispatched", "active"].includes(r.status));
    return requests.filter((r) => r.status === filter);
  }, [requests, filter]);

  const metrics = useMemo(() => {
    const total = requests.length;
    const pending = requests.filter((r) => ["submitted", "under_validation", "awaiting_approval"].includes(r.status)).length;
    const approved = requests.filter((r) => ["approved", "reserved", "dispatched", "active"].includes(r.status)).length;
    const active = activeFleetOnSite.length;
    return { total, pending, approved, active };
  }, [requests, activeFleetOnSite]);

  return (
    <div className="space-y-5">
      {notice ? (
        <Notice tone={notice.tone} onClose={() => setNotice(null)}>
          {notice.text}
        </Notice>
      ) : null}

      {/* Top metrics bar */}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="border border-ink-mid bg-ink p-4">
          <div className="flex items-center justify-between text-xs text-slate-light">
            <span className="font-mono uppercase tracking-wider">Active Plant on Site</span>
            <Truck className="h-4 w-4 text-emerald-400" />
          </div>
          <p className="mt-2 font-mono text-2xl font-bold text-paper">{metrics.active}</p>
          <p className="mt-1 text-[11px] text-slate">Assigned to {projectName || "this site"}</p>
        </div>

        <div className="border border-ink-mid bg-ink p-4">
          <div className="flex items-center justify-between text-xs text-slate-light">
            <span className="font-mono uppercase tracking-wider">Plant Requests</span>
            <HardHat className="h-4 w-4 text-signal" />
          </div>
          <p className="mt-2 font-mono text-2xl font-bold text-paper">{metrics.total}</p>
          <p className="mt-1 text-[11px] text-slate">Total project requests</p>
        </div>

        <div className="border border-ink-mid bg-ink p-4">
          <div className="flex items-center justify-between text-xs text-slate-light">
            <span className="font-mono uppercase tracking-wider">Awaiting Approval</span>
            <Clock className="h-4 w-4 text-amber-400" />
          </div>
          <p className="mt-2 font-mono text-2xl font-bold text-amber-300">{metrics.pending}</p>
          <p className="mt-1 text-[11px] text-slate">Pending manager/executive sign-off</p>
        </div>

        <div className="border border-ink-mid bg-ink p-4">
          <div className="flex items-center justify-between text-xs text-slate-light">
            <span className="font-mono uppercase tracking-wider">Approved & Deployed</span>
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          </div>
          <p className="mt-2 font-mono text-2xl font-bold text-emerald-300">{metrics.approved}</p>
          <p className="mt-1 text-[11px] text-slate">Ready for or on site</p>
        </div>
      </section>

      {/* Main split: Plant Request Form & Active Plant */}
      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        {/* Plant Request Form */}
        <Panel
          title="Plant & Equipment Request"
          subtitle="Request heavy machinery, earthmoving equipment, or transport for this project. Approved requests automatically feed into daily site reports."
          actions={
            <span className="border border-signal/30 bg-signal/10 px-2 py-1 font-mono text-[10px] uppercase text-signal">
              Fleet & Site Operations Bridge
            </span>
          }
        >
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-slate-light sm:col-span-2">
                Required Asset / Machine Type
                <select
                  value={form.required_asset_type}
                  onChange={(e) => setForm({ ...form, required_asset_type: e.target.value })}
                  className={`${fieldClass} mt-1`}
                >
                  {COMMON_PLANT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                  <option value="Other / Custom">Other / Custom Equipment...</option>
                </select>
              </label>

              {form.required_asset_type === "Other / Custom" ? (
                <label className="text-xs text-slate-light sm:col-span-2">
                  Specify Equipment Name / Model
                  <input
                    value={form.custom_asset_type}
                    onChange={(e) => setForm({ ...form, custom_asset_type: e.target.value })}
                    placeholder="e.g. 50-Ton Mobile Crane, Bitumen Sprayer"
                    className={`${fieldClass} mt-1`}
                    required
                  />
                </label>
              ) : null}

              <label className="text-xs text-slate-light">
                Specific Fleet Asset (Optional)
                <select
                  value={form.fleet_id}
                  onChange={(e) => setForm({ ...form, fleet_id: e.target.value })}
                  className={`${fieldClass} mt-1`}
                >
                  <option value="">Any available unit in pool</option>
                  {fleet.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.asset_name || f.registration_number} ({f.category || "Fleet"})
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-xs text-slate-light">
                Quantity
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={form.quantity}
                  onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                  className={`${fieldClass} mt-1`}
                />
              </label>

              <label className="text-xs text-slate-light">
                Start Date
                <input
                  type="date"
                  value={form.start_date}
                  onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                  className={`${fieldClass} mt-1`}
                  required
                />
              </label>

              <label className="text-xs text-slate-light">
                End Date (Optional)
                <input
                  type="date"
                  value={form.end_date}
                  min={form.start_date}
                  onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                  className={`${fieldClass} mt-1`}
                />
              </label>

              <label className="text-xs text-slate-light">
                Operating Hours Mode
                <select
                  value={form.operating_hours_mode}
                  onChange={(e) => setForm({ ...form, operating_hours_mode: e.target.value as any })}
                  className={`${fieldClass} mt-1`}
                >
                  <option value="normal">Normal (8 hrs/day single shift)</option>
                  <option value="extended">Extended (12 hrs/day)</option>
                  <option value="continuous">Continuous (24 hrs double shift)</option>
                </select>
              </label>

              <label className="text-xs text-slate-light">
                Priority
                <select
                  value={form.priority}
                  onChange={(e) => setForm({ ...form, priority: e.target.value as any })}
                  className={`${fieldClass} mt-1`}
                >
                  <option value="routine">Routine</option>
                  <option value="urgent">Urgent</option>
                  <option value="emergency">Emergency / Critical</option>
                </select>
              </label>

              <label className="text-xs text-slate-light">
                Fuel Responsibility
                <select
                  value={form.fuel_responsibility}
                  onChange={(e) => setForm({ ...form, fuel_responsibility: e.target.value as any })}
                  className={`${fieldClass} mt-1`}
                >
                  <option value="project">Project Fuel (Charged to project cost)</option>
                  <option value="snc">SNC Central Depot</option>
                  <option value="client">Client Provided</option>
                </select>
              </label>

              <label className="text-xs text-slate-light">
                Work Location / Section
                <input
                  value={form.work_location}
                  onChange={(e) => setForm({ ...form, work_location: e.target.value })}
                  placeholder="e.g. Timeshares Units 9-12"
                  className={`${fieldClass} mt-1`}
                />
              </label>

              <div className="flex items-center gap-2 pt-2 sm:col-span-2">
                <input
                  type="checkbox"
                  id="op_req"
                  checked={form.operator_required}
                  onChange={(e) => setForm({ ...form, operator_required: e.target.checked })}
                  className="h-4 w-4 border-ink-mid bg-ink text-signal focus:ring-signal"
                />
                <label htmlFor="op_req" className="text-xs font-medium text-paper">
                  Include Qualified SNC Plant Operator with Machine
                </label>
              </div>

              <label className="text-xs text-slate-light sm:col-span-2">
                Attachments / Special Requirements
                <input
                  value={form.specification}
                  onChange={(e) => setForm({ ...form, specification: e.target.value })}
                  placeholder="e.g. Rock breaker hammer, 600mm trenching bucket, spark arrestor"
                  className={`${fieldClass} mt-1`}
                />
              </label>

              <label className="text-xs text-slate-light sm:col-span-2">
                Work Description & Activity Justification
                <textarea
                  value={form.work_description}
                  onChange={(e) => setForm({ ...form, work_description: e.target.value })}
                  placeholder="Describe the activity (e.g. Demolitions and foundation trenches excavation as per schedule)..."
                  className={`${areaClass} mt-1 min-h-20`}
                  required
                />
              </label>
            </div>

            <div className="flex items-center justify-between border-t border-ink-mid pt-3">
              <span className="text-xs text-slate-light">
                Target Project: <strong className="text-paper">{projectName || "Current Project"}</strong>
              </span>
              <Btn busy={submitting} icon={<Plus className="h-4 w-4" />}>
                Submit Plant Request
              </Btn>
            </div>
          </form>
        </Panel>

        {/* Right Column: Active Plant on Site */}
        <div className="space-y-4">
          <Panel
            title="Active Plant on Site"
            subtitle="Machinery currently deployed to this site. Hours and rates are auto-synced into today's daily report draft."
          >
            {activeFleetOnSite.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-8 text-center text-slate">
                <Truck className="h-10 w-10 opacity-30" />
                <p className="mt-3 text-sm text-paper">No fleet assets currently assigned to this site.</p>
                <p className="mt-1 text-xs text-slate-light">
                  Submit a plant request to mobilize excavators, tippers, or compactors.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-ink-mid">
                {activeFleetOnSite.map((item) => (
                  <div key={item.id} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium text-paper">{item.asset_name || item.registration_number}</p>
                        <p className="text-xs text-slate-light">
                          {item.registration_number ? `${item.registration_number} · ` : ""}
                          {item.category || "Heavy Plant"}
                        </p>
                      </div>
                      <Pill tone="green">on site</Pill>
                    </div>
                    <div className="mt-2 flex items-center justify-between font-mono text-xs text-slate">
                      <span>Rate: {usd(item.internal_rate_hourly || item.hourly_internal_rate || 45)}/hr</span>
                      <span>Default: 8 hrs/day</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="How Plant Reporting Works" subtitle="Full cost & timeline automation">
            <div className="space-y-3 text-xs text-slate-light leading-relaxed">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                <span>
                  <strong>1. Request & Approval:</strong> Request machinery here. Managers, Admins or Executives approve it directly.
                </span>
              </div>
              <div className="flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                <span>
                  <strong>2. Auto-Populated Draft:</strong> Approved machines automatically appear in the Daily Site Report equipment lines with standard operating hours.
                </span>
              </div>
              <div className="flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                <span>
                  <strong>3. Real Performance on Projects:</strong> Upon report approval, operating hours & internal rates post to <code className="text-paper">finance.cost_transactions</code>, instantly reflecting actual plant performance in the Projects module.
                </span>
              </div>
            </div>
          </Panel>
        </div>
      </div>

      {/* Plant Requests Register */}
      <section className="border border-ink-mid bg-ink">
        <div className="flex flex-col gap-3 border-b border-ink-mid p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-mono text-xs font-bold uppercase tracking-widest text-paper">
              Plant Requests & Approvals Register
            </h3>
            <p className="mt-1 text-xs text-slate-light">
              Track mobilization approvals, manager sign-offs, and plant timelines for {projectName || "all projects"}.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="h-9 border border-ink-mid bg-ink-light px-3 text-xs text-paper"
            >
              <option value="all">All requests</option>
              <option value="pending">Awaiting Approval</option>
              <option value="approved">Approved & Active</option>
            </select>
            <button
              onClick={() => void loadRequests()}
              disabled={loading}
              className="inline-flex h-9 items-center gap-1.5 border border-ink-mid bg-ink-light px-3 font-mono text-xs uppercase tracking-wider text-slate-light hover:text-paper"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
            </button>
          </div>
        </div>

        {loading && requests.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate">Loading plant requests...</div>
        ) : filteredRequests.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate">No plant requests found in this view.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono text-xs">
              <thead className="border-b border-ink-mid bg-ink-light text-[11px] uppercase tracking-wider text-slate">
                <tr>
                  <th className="p-3">Request #</th>
                  <th className="p-3">Required Machinery</th>
                  <th className="p-3">Qty</th>
                  <th className="p-3">Dates</th>
                  <th className="p-3">Priority</th>
                  <th className="p-3">Operator</th>
                  <th className="p-3">Status</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-mid font-sans text-sm">
                {filteredRequests.map((req) => {
                  const isPending = ["submitted", "under_validation", "awaiting_approval"].includes(req.status);
                  const isApproved = ["approved", "reserved", "dispatched", "active"].includes(req.status);

                  return (
                    <tr key={req.id} className="hover:bg-ink-light/50">
                      <td className="p-3 font-mono text-xs font-bold text-signal">{req.request_number}</td>
                      <td className="p-3">
                        <p className="font-medium text-paper">{req.required_asset_type}</p>
                        {req.specification ? (
                          <p className="text-xs text-slate-light">{req.specification}</p>
                        ) : null}
                      </td>
                      <td className="p-3 font-mono text-xs text-paper">{req.quantity}</td>
                      <td className="p-3 font-mono text-xs text-slate-light">
                        {req.start_date} {req.end_date ? `→ ${req.end_date}` : ""}
                      </td>
                      <td className="p-3">
                        <Pill tone={req.priority === "emergency" ? "red" : req.priority === "urgent" ? "amber" : "slate"}>
                          {req.priority}
                        </Pill>
                      </td>
                      <td className="p-3 text-xs text-slate-light">
                        {req.operator_required ? "Operator included" : "Machine only"}
                      </td>
                      <td className="p-3">
                        <Pill tone={isApproved ? "green" : isPending ? "amber" : "slate"}>
                          {req.status}
                        </Pill>
                      </td>
                      <td className="p-3 text-right">
                        {isPending && canApprove ? (
                          <button
                            type="button"
                            onClick={() => void handleApprove(req.id)}
                            disabled={approvingId === req.id}
                            className="inline-flex h-8 items-center gap-1.5 border border-emerald-500/50 bg-emerald-950/30 px-3 font-mono text-xs uppercase tracking-wider text-emerald-300 hover:bg-emerald-900/50 disabled:opacity-50"
                          >
                            {approvingId === req.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <ShieldCheck className="h-3.5 w-3.5" />
                            )}
                            Approve
                          </button>
                        ) : isApproved ? (
                          <span className="font-mono text-xs text-emerald-400">Allocated</span>
                        ) : (
                          <span className="font-mono text-xs text-slate">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
