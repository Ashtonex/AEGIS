"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Loader2, X } from "lucide-react";

import {
  ApiError,
  createFleetAsset,
  createFleetAssignment,
  createFleetWorkOrder,
  getFinanceDepartments,
  getHREmployees,
  getInternalProjects,
  updateFleetAsset,
} from "@/lib/api";

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 backdrop-blur-sm p-4">
      <div className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto border border-ink-mid bg-ink shadow-2xl">
        <div className="sticky top-0 flex items-center justify-between border-b border-ink-mid bg-ink px-5 py-4">
          <h2 className="text-sm font-semibold text-paper">{title}</h2>
          <button type="button" onClick={onClose} className="text-slate hover:text-paper">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, input, hint }: { label: string; input: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="font-mono text-[10px] uppercase tracking-wider text-slate-light">{label}</span>
      <div className="mt-1.5">{input}</div>
      {hint && <p className="mt-1 text-[11px] text-slate">{hint}</p>}
    </label>
  );
}

const inputClass = "w-full border border-ink-mid bg-ink-light px-3 py-2 text-sm text-paper outline-none placeholder:text-slate focus:border-signal focus:ring-1 focus:ring-signal/40";

// ─── Register asset ──────────────────────────────────────────────────────────
// Backs both "Register Vehicle" (Fleet page) and "Register Equipment" (Equipment
// page) - they write to the same fleet.fleet table (see createFleetAsset).

export function RegisterAssetModal({
  assetNoun,
  editingAsset,
  onClose,
  onSuccess,
}: {
  assetNoun: string;
  editingAsset?: Record<string, unknown> | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const isEdit = Boolean(editingAsset?.id);
  const [form, setForm] = useState({
    vehicle_registration: String(editingAsset?.vehicle_registration ?? editingAsset?.asset_code ?? ""),
    vehicle_type: String(editingAsset?.vehicle_type ?? ""),
    asset_code: String(editingAsset?.asset_code ?? ""),
    ownership_type: String(editingAsset?.ownership_type ?? "owned"),
    operational_status: String(editingAsset?.operational_status ?? "available"),
    make: String(editingAsset?.make ?? ""),
    model: String(editingAsset?.model ?? ""),
    model_year: editingAsset?.model_year != null ? String(editingAsset.model_year) : "",
    home_location: String(editingAsset?.home_location ?? ""),
    acquired_on: String(editingAsset?.acquired_on ?? "").slice(0, 10),
    owning_department_id: String(editingAsset?.owning_department_id ?? ""),
    hourly_charge_rate: editingAsset?.hourly_charge_rate != null ? String(editingAsset.hourly_charge_rate) : "0",
    hourly_operating_cost: editingAsset?.hourly_operating_cost != null ? String(editingAsset.hourly_operating_cost) : "0",
    idle_hour_cost: editingAsset?.idle_hour_cost != null ? String(editingAsset.idle_hour_cost) : "0",
    monthly_ownership_cost: editingAsset?.monthly_ownership_cost != null ? String(editingAsset.monthly_ownership_cost) : "0",
    notes: String(editingAsset?.notes ?? ""),
  });
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void getFinanceDepartments().then((res) => {
      if (res.success && Array.isArray(res.data)) setDepartments(res.data);
    }).catch(() => {});
  }, []);

  function patch<K extends keyof typeof form>(key: K, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit() {
    if (!form.vehicle_registration.trim()) {
      setErr(`${assetNoun} registration / asset number is required.`);
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const payload = {
        vehicle_registration: form.vehicle_registration.trim(),
        vehicle_type: form.vehicle_type.trim() || undefined,
        asset_code: form.asset_code.trim() || undefined,
        ownership_type: form.ownership_type,
        operational_status: form.operational_status,
        make: form.make.trim() || undefined,
        model: form.model.trim() || undefined,
        model_year: form.model_year ? Number(form.model_year) : undefined,
        home_location: form.home_location.trim() || undefined,
        acquired_on: form.acquired_on || undefined,
        owning_department_id: form.owning_department_id || undefined,
        hourly_charge_rate: form.hourly_charge_rate || "0",
        hourly_operating_cost: form.hourly_operating_cost || "0",
        idle_hour_cost: form.idle_hour_cost || "0",
        monthly_ownership_cost: form.monthly_ownership_cost || "0",
        notes: form.notes.trim() || undefined,
      };
      if (isEdit && editingAsset?.id) {
        await updateFleetAsset(String(editingAsset.id), payload);
      } else {
        await createFleetAsset(payload);
      }
      onSuccess();
    } catch (e) {
      setErr(errorMessage(e, `${assetNoun} could not be saved. Please try again.`));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={isEdit ? `Edit ${assetNoun}` : `Register ${assetNoun}`} onClose={onClose}>
      <div className="space-y-4 px-5 py-4">
        {err && <p className="border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">{err}</p>}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={`Registration / Asset Number *`} input={
            <input type="text" value={form.vehicle_registration} onChange={(e) => patch("vehicle_registration", e.target.value)} className={inputClass} placeholder="e.g. ABC-1234 or PLT-0042" />
          } />
          <Field label="Type / Category" input={
            <input type="text" value={form.vehicle_type} onChange={(e) => patch("vehicle_type", e.target.value)} className={inputClass} placeholder="e.g. Excavator, Tipper Truck, Generator" />
          } />
          <Field label="Asset Code" input={
            <input type="text" value={form.asset_code} onChange={(e) => patch("asset_code", e.target.value)} className={inputClass} placeholder="Internal fleet number" />
          } />
          <Field label="Status" input={
            <select value={form.operational_status} onChange={(e) => patch("operational_status", e.target.value)} className={inputClass}>
              <option value="available">Available</option>
              <option value="assigned">Assigned</option>
              <option value="in_service">In service</option>
              <option value="out_of_service">Out of service</option>
              <option value="retired">Retired</option>
            </select>
          } />
          <Field label="Ownership" input={
            <select value={form.ownership_type} onChange={(e) => patch("ownership_type", e.target.value)} className={inputClass}>
              <option value="owned">Owned</option>
              <option value="leased">Leased</option>
              <option value="rented">Rented</option>
              <option value="subcontracted">Subcontracted</option>
            </select>
          } />
          <Field label="Home Location" input={
            <input type="text" value={form.home_location} onChange={(e) => patch("home_location", e.target.value)} className={inputClass} placeholder="Depot / yard" />
          } />
          <Field label="Make" input={
            <input type="text" value={form.make} onChange={(e) => patch("make", e.target.value)} className={inputClass} />
          } />
          <Field label="Model" input={
            <input type="text" value={form.model} onChange={(e) => patch("model", e.target.value)} className={inputClass} />
          } />
          <Field label="Model Year" input={
            <input type="number" value={form.model_year} onChange={(e) => patch("model_year", e.target.value)} className={inputClass} />
          } />
          <Field label="Acquired On" input={
            <input type="date" value={form.acquired_on} onChange={(e) => patch("acquired_on", e.target.value)} className={inputClass} />
          } />
          <Field label="Owning Department" input={
            <select value={form.owning_department_id} onChange={(e) => patch("owning_department_id", e.target.value)} className={inputClass}>
              <option value="">Not set</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          } />
        </div>

        <div className="border-t border-ink-mid pt-4">
          <p className="mb-3 font-mono text-[10px] uppercase tracking-wider text-slate">Rate card - what it costs and charges per hour</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Hourly Charge Rate" hint="What this asset bills out at, per operating hour" input={
              <input type="number" min="0" step="0.01" value={form.hourly_charge_rate} onChange={(e) => patch("hourly_charge_rate", e.target.value)} className={inputClass} />
            } />
            <Field label="Hourly Operating Cost" hint="What it costs to run, per operating hour" input={
              <input type="number" min="0" step="0.01" value={form.hourly_operating_cost} onChange={(e) => patch("hourly_operating_cost", e.target.value)} className={inputClass} />
            } />
            <Field label="Idle Hour Cost" input={
              <input type="number" min="0" step="0.01" value={form.idle_hour_cost} onChange={(e) => patch("idle_hour_cost", e.target.value)} className={inputClass} />
            } />
            <Field label="Monthly Ownership Cost" input={
              <input type="number" min="0" step="0.01" value={form.monthly_ownership_cost} onChange={(e) => patch("monthly_ownership_cost", e.target.value)} className={inputClass} />
            } />
          </div>
        </div>

        <Field label="Notes" input={
          <textarea rows={3} value={form.notes} onChange={(e) => patch("notes", e.target.value)} className={`${inputClass} resize-none`} />
        } />
      </div>
      <div className="flex justify-end gap-3 border-t border-ink-mid px-5 py-4">
        <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-light hover:text-paper">Cancel</button>
        <button type="button" onClick={() => void submit()} disabled={saving} className="inline-flex items-center gap-2 bg-signal px-4 py-2 text-sm font-semibold text-ink disabled:opacity-60">
          {saving && <Loader2 size={14} className="animate-spin" />}
          {isEdit ? `Save ${assetNoun}` : `Register ${assetNoun}`}
        </button>
      </div>
    </Modal>
  );
}

// ─── Deploy / assign operator ────────────────────────────────────────────────

export function AssignmentModal({
  assetId,
  assetLabel,
  onClose,
  onSuccess,
}: {
  assetId: string;
  assetLabel: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [employees, setEmployees] = useState<{ id: string; employee_name: string; employment_status?: string }[]>([]);
  const [form, setForm] = useState({
    project_id: "",
    operator_employee_id: "",
    dispatch_reference: "",
    starts_at: new Date().toISOString().slice(0, 16),
    ends_at: "",
    status: "dispatched",
    origin_location: "",
    destination_location: "",
    purpose: "",
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void getInternalProjects().then((res) => {
      if (res.success && Array.isArray(res.data)) setProjects(res.data);
    }).catch(() => {});
    void getHREmployees({ status: "active" }).then((res) => {
      if (res.success && Array.isArray(res.data)) setEmployees(res.data);
    }).catch(() => {});
  }, []);

  function patch<K extends keyof typeof form>(key: K, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit() {
    if (!form.operator_employee_id) {
      setErr("Select the operator/driver being deployed.");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      await createFleetAssignment({
        fleet_id: assetId,
        project_id: form.project_id || undefined,
        operator_employee_id: form.operator_employee_id,
        dispatch_reference: form.dispatch_reference.trim() || undefined,
        starts_at: new Date(form.starts_at).toISOString(),
        ends_at: form.ends_at ? new Date(form.ends_at).toISOString() : undefined,
        status: form.status,
        origin_location: form.origin_location.trim() || undefined,
        destination_location: form.destination_location.trim() || undefined,
        purpose: form.purpose.trim() || undefined,
      });
      onSuccess();
    } catch (e) {
      // extractApiErrorMessage (lib/api.ts) unpacks the compliance deployment-gate
      // 409 into a readable "blocked - missing: X, Y" message when the operator
      // isn't licensed/trained/current on paperwork for this deployment.
      setErr(errorMessage(e, "Deployment could not be created. Please try again."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Deploy — ${assetLabel}`} onClose={onClose}>
      <div className="space-y-4 px-5 py-4">
        {err && <p className="border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">{err}</p>}
        <Field label="Operator / Driver *" hint="Checked against employment status and required licences/training/certification before dispatch is allowed" input={
          <select value={form.operator_employee_id} onChange={(e) => patch("operator_employee_id", e.target.value)} className={inputClass}>
            <option value="">Select operator</option>
            {employees.map((emp) => <option key={emp.id} value={emp.id}>{emp.employee_name}</option>)}
          </select>
        } />
        <Field label="Project" input={
          <select value={form.project_id} onChange={(e) => patch("project_id", e.target.value)} className={inputClass}>
            <option value="">No specific project</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        } />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Deployed From *" input={
            <input type="datetime-local" value={form.starts_at} onChange={(e) => patch("starts_at", e.target.value)} className={inputClass} />
          } />
          <Field label="Due Back / Ends" hint="Leave blank for an open-ended deployment" input={
            <input type="datetime-local" value={form.ends_at} onChange={(e) => patch("ends_at", e.target.value)} className={inputClass} />
          } />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Going To" input={
            <input type="text" value={form.destination_location} onChange={(e) => patch("destination_location", e.target.value)} className={inputClass} placeholder="Site / destination" />
          } />
          <Field label="Departing From" input={
            <input type="text" value={form.origin_location} onChange={(e) => patch("origin_location", e.target.value)} className={inputClass} placeholder="Depot / origin" />
          } />
        </div>
        <Field label="Dispatch Status" input={
          <select value={form.status} onChange={(e) => patch("status", e.target.value)} className={inputClass}>
            <option value="planned">Planned</option>
            <option value="dispatched">Dispatched</option>
            <option value="active">Active</option>
          </select>
        } />
        <Field label="Purpose" input={
          <textarea rows={2} value={form.purpose} onChange={(e) => patch("purpose", e.target.value)} className={`${inputClass} resize-none`} />
        } />
      </div>
      <div className="flex justify-end gap-3 border-t border-ink-mid px-5 py-4">
        <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-light hover:text-paper">Cancel</button>
        <button type="button" onClick={() => void submit()} disabled={saving} className="inline-flex items-center gap-2 bg-signal px-4 py-2 text-sm font-semibold text-ink disabled:opacity-60">
          {saving && <Loader2 size={14} className="animate-spin" />}
          Deploy
        </button>
      </div>
    </Modal>
  );
}

// ─── Maintenance work order ──────────────────────────────────────────────────

export function WorkOrderModal({
  assetId,
  assetLabel,
  onClose,
  onSuccess,
}: {
  assetId: string;
  assetLabel: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [form, setForm] = useState({
    work_order_number: `WO-${Date.now().toString(36).toUpperCase()}`,
    maintenance_type: "preventive",
    priority: "medium",
    vendor_name: "",
    scheduled_for: "",
    estimated_cost: "",
    description: "",
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function patch<K extends keyof typeof form>(key: K, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit() {
    if (!form.description.trim()) {
      setErr("Describe the work required.");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      await createFleetWorkOrder({
        fleet_id: assetId,
        work_order_number: form.work_order_number.trim(),
        maintenance_type: form.maintenance_type,
        priority: form.priority,
        vendor_name: form.vendor_name.trim() || undefined,
        scheduled_for: form.scheduled_for ? new Date(form.scheduled_for).toISOString() : undefined,
        estimated_cost: form.estimated_cost || undefined,
        description: form.description.trim(),
      });
      onSuccess();
    } catch (e) {
      setErr(errorMessage(e, "Work order could not be created. Please try again."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Create Work Order — ${assetLabel}`} onClose={onClose}>
      <div className="space-y-4 px-5 py-4">
        {err && <p className="border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">{err}</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Work Order Number" input={
            <input type="text" value={form.work_order_number} onChange={(e) => patch("work_order_number", e.target.value)} className={inputClass} />
          } />
          <Field label="Type" input={
            <select value={form.maintenance_type} onChange={(e) => patch("maintenance_type", e.target.value)} className={inputClass}>
              <option value="preventive">Preventive</option>
              <option value="corrective">Corrective</option>
              <option value="inspection">Inspection</option>
              <option value="compliance">Compliance</option>
            </select>
          } />
          <Field label="Priority" input={
            <select value={form.priority} onChange={(e) => patch("priority", e.target.value)} className={inputClass}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          } />
          <Field label="Vendor" input={
            <input type="text" value={form.vendor_name} onChange={(e) => patch("vendor_name", e.target.value)} className={inputClass} />
          } />
          <Field label="Scheduled For" input={
            <input type="date" value={form.scheduled_for} onChange={(e) => patch("scheduled_for", e.target.value)} className={inputClass} />
          } />
          <Field label="Estimated Cost" input={
            <input type="number" min="0" step="0.01" value={form.estimated_cost} onChange={(e) => patch("estimated_cost", e.target.value)} className={inputClass} />
          } />
        </div>
        <Field label="Description *" input={
          <textarea rows={3} value={form.description} onChange={(e) => patch("description", e.target.value)} className={`${inputClass} resize-none`} />
        } />
      </div>
      <div className="flex justify-end gap-3 border-t border-ink-mid px-5 py-4">
        <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-light hover:text-paper">Cancel</button>
        <button type="button" onClick={() => void submit()} disabled={saving} className="inline-flex items-center gap-2 bg-signal px-4 py-2 text-sm font-semibold text-ink disabled:opacity-60">
          {saving && <Loader2 size={14} className="animate-spin" />}
          Create Work Order
        </button>
      </div>
    </Modal>
  );
}
