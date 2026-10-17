"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  Camera,
  CheckCircle2,
  Clock,
  DollarSign,
  Fuel,
  HardHat,
  Loader2,
  PackageCheck,
  Plus,
  RefreshCw,
  Save,
  Send,
  ShieldCheck,
  Target,
  Trash2,
  Truck,
  Users,
  Wrench,
  X,
} from "lucide-react";
import {
  addDailyReportEquipment,
  addDailyReportLabour,
  addDailyReportMaterial,
  decideDailySiteReport,
  deleteDailyReportEquipment,
  deleteDailyReportLabour,
  deleteDailyReportMaterial,
  submitDailySiteReport,
  syncDailyReport,
  updateDailyReportEquipment,
  updateDailyReportLabour,
  updateDailyReportMaterial,
  updateDailySiteReport,
} from "@/lib/api";
import {
  Btn,
  Notice,
  Panel,
  Pill,
  areaClass,
  errorText,
  fieldClass,
  qty,
  usd,
  type ApiRecord,
} from "./ui";
import { SiteEvidenceCapture } from "./SiteEvidenceCapture";

export type DailyReportDetail = {
  report: ApiRecord;
  labour: ApiRecord[];
  equipment: ApiRecord[];
  materials: ApiRecord[];
  documents: ApiRecord[];
  approvals: ApiRecord[];
  material_receipts?: ApiRecord[];
  material_issues?: ApiRecord[];
  open_requests?: ApiRecord[];
  safety_briefing?: ApiRecord | null;
  completeness?: {
    score_percent: number;
    labour_captured: boolean;
    work_progress_logged: boolean;
    safety_checks_recorded: boolean;
    weather_recorded: boolean;
    is_ready_for_submission: boolean;
  };
};

type Props = {
  reportId: string;
  initialReport?: ApiRecord;
  detail: DailyReportDetail | null;
  loading: boolean;
  employees: ApiRecord[];
  fleet: ApiRecord[];
  inventoryItems: ApiRecord[];
  stores: ApiRecord[];
  dayTargets?: ApiRecord[];
  canApprove?: boolean;
  onRefresh: () => Promise<void>;
  onClose?: () => void;
};

export function ActiveDailyReport({
  reportId,
  initialReport,
  detail,
  loading,
  employees,
  fleet,
  inventoryItems,
  stores,
  dayTargets = [],
  canApprove = false,
  onRefresh,
  onClose,
}: Props) {
  const activeReport = detail?.report ?? initialReport ?? ({} as ApiRecord);
  const status = String(activeReport.status || "draft").toLowerCase();
  const isDraft = status === "draft" || status === "rejected";
  const isSubmitted = status === "submitted";
  const isApproved = status === "approved";

  const [savingAction, setSavingAction] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState<{ tone: "error" | "success" | "info"; text: string } | null>(null);

  // Editable narrative state
  const [narrative, setNarrative] = useState({
    planned_work: "",
    actual_work: "",
    delays: "",
    safety_notes: "",
    cost_exposure: "0",
  });
  const [narrativeDirty, setNarrativeDirty] = useState(false);

  useEffect(() => {
    if (activeReport && activeReport.id) {
      setNarrative({
        planned_work: activeReport.planned_work || "",
        actual_work: activeReport.actual_work || "",
        delays: activeReport.delays || "",
        safety_notes: activeReport.safety_notes || "",
        cost_exposure: String(activeReport.cost_exposure || "0"),
      });
      setNarrativeDirty(false);
    }
  }, [activeReport]);

  // Labour hours editing state: [lineId] -> { regular_hours, overtime_hours, dirty }
  const [labourEdits, setLabourEdits] = useState<Record<string, { regular: string; ot: string; dirty: boolean }>>({});
  useEffect(() => {
    if (detail?.labour) {
      const state: Record<string, { regular: string; ot: string; dirty: boolean }> = {};
      detail.labour.forEach((l) => {
        state[l.id] = {
          regular: String(l.regular_hours ?? 8),
          ot: String(l.overtime_hours ?? 0),
          dirty: false,
        };
      });
      setLabourEdits(state);
    }
  }, [detail?.labour]);

  // Equipment hours editing state: [lineId] -> { operating, idle, fuel, dirty }
  const [equipEdits, setEquipEdits] = useState<Record<string, { op: string; idle: string; fuel: string; dirty: boolean }>>({});
  useEffect(() => {
    if (detail?.equipment) {
      const state: Record<string, { op: string; idle: string; fuel: string; dirty: boolean }> = {};
      detail.equipment.forEach((e) => {
        state[e.id] = {
          op: String(e.operating_hours ?? 0),
          idle: String(e.idle_hours ?? 0),
          fuel: String(e.fuel_litres ?? 0),
          dirty: false,
        };
      });
      setEquipEdits(state);
    }
  }, [detail?.equipment]);

  // Add line states
  const [showAddLabour, setShowAddLabour] = useState(false);
  const [newLabour, setNewLabour] = useState({
    employee_id: "",
    role_on_site: "",
    regular_hours: "8",
    overtime_hours: "0",
    cost_rate: "0",
    notes: "",
  });

  const [showAddEquip, setShowAddEquip] = useState(false);
  const [newEquip, setNewEquip] = useState({
    fleet_id: "",
    operator_employee_id: "",
    operating_hours: "8",
    idle_hours: "0",
    fuel_litres: "0",
    cost_rate: "0",
    notes: "",
  });

  const [showAddMaterial, setShowAddMaterial] = useState(false);
  const [newMaterial, setNewMaterial] = useState({
    item_id: "",
    store_id: "",
    quantity_used: "1",
    unit_cost: "0",
    wastage_quantity: "0",
    work_package: "",
    notes: "",
  });

  // Calculate totals
  const totals = useMemo(() => {
    const labourLines = detail?.labour ?? [];
    const equipLines = detail?.equipment ?? [];
    const matLines = detail?.materials ?? [];

    const labourCost = labourLines.reduce((sum, l) => {
      const edit = labourEdits[l.id];
      const reg = edit ? Number(edit.regular || 0) : Number(l.regular_hours || 0);
      const ot = edit ? Number(edit.ot || 0) : Number(l.overtime_hours || 0);
      const rate = Number(l.cost_rate || 0);
      return sum + (reg * rate) + (ot * rate * 1.5);
    }, 0);

    const equipCost = equipLines.reduce((sum, e) => {
      const edit = equipEdits[e.id];
      const op = edit ? Number(edit.op || 0) : Number(e.operating_hours || 0);
      const idle = edit ? Number(edit.idle || 0) : Number(e.idle_hours || 0);
      const rate = Number(e.cost_rate || 0);
      return sum + (op * rate) + (idle * rate * 0.4);
    }, 0);

    const materialCost = matLines.reduce((sum, m) => {
      const q = Number(m.quantity_used || 0);
      const u = Number(m.unit_cost || 0);
      return sum + (q * u);
    }, 0);

    return {
      labourCost,
      equipCost,
      materialCost,
      totalSpend: labourCost + equipCost + materialCost,
      headcount: labourLines.length,
      fleetCount: equipLines.length,
      materialCount: matLines.length,
    };
  }, [detail, labourEdits, equipEdits]);

  // Sync all live site activity (Labour attendance, Fleet allocation, Store ledger issues)
  const handleSyncAll = async () => {
    setSyncing(true);
    setNotice(null);
    try {
      await syncDailyReport(reportId);
      await onRefresh();
      setNotice({ tone: "success", text: "Daily report synchronized with live attendance, plant and stock issues." });
    } catch (err) {
      setNotice({ tone: "error", text: errorText(err, "Failed to synchronize site activity.") });
    } finally {
      setSyncing(false);
    }
  };

  // Save narrative
  const handleSaveNarrative = async () => {
    setSavingAction("narrative");
    setNotice(null);
    try {
      await updateDailySiteReport(reportId, {
        planned_work: narrative.planned_work,
        actual_work: narrative.actual_work,
        delays: narrative.delays,
        safety_notes: narrative.safety_notes,
        cost_exposure: Number(narrative.cost_exposure || 0),
      });
      setNarrativeDirty(false);
      setNotice({ tone: "success", text: "Site narrative saved." });
      await onRefresh();
    } catch (err) {
      setNotice({ tone: "error", text: errorText(err, "Failed to save narrative.") });
    } finally {
      setSavingAction(null);
    }
  };

  // Update labour row hours
  const handleSaveLabourRow = async (lineId: string) => {
    const edit = labourEdits[lineId];
    if (!edit) return;
    setSavingAction(`labour-${lineId}`);
    try {
      await updateDailyReportLabour(reportId, lineId, {
        regular_hours: Number(edit.regular),
        overtime_hours: Number(edit.ot),
      });
      setLabourEdits((prev) => ({
        ...prev,
        [lineId]: { ...prev[lineId], dirty: false },
      }));
      setNotice({ tone: "success", text: "Labour hours updated." });
      await onRefresh();
    } catch (err) {
      setNotice({ tone: "error", text: errorText(err, "Failed to update labour hours.") });
    } finally {
      setSavingAction(null);
    }
  };

  // Delete labour row
  const handleDeleteLabourRow = async (lineId: string) => {
    if (!confirm("Remove this labour line from today's report?")) return;
    setSavingAction(`del-labour-${lineId}`);
    try {
      await deleteDailyReportLabour(reportId, lineId);
      setNotice({ tone: "success", text: "Labour line removed." });
      await onRefresh();
    } catch (err) {
      setNotice({ tone: "error", text: errorText(err, "Failed to remove labour line.") });
    } finally {
      setSavingAction(null);
    }
  };

  // Add labour manually
  const handleAddLabour = async () => {
    if (!newLabour.employee_id && !newLabour.role_on_site) {
      setNotice({ tone: "error", text: "Select an employee or enter a role." });
      return;
    }
    setSavingAction("add-labour");
    try {
      await addDailyReportLabour(reportId, {
        employee_id: newLabour.employee_id || null,
        role_on_site: newLabour.role_on_site || "Site Worker",
        regular_hours: Number(newLabour.regular_hours || 8),
        overtime_hours: Number(newLabour.overtime_hours || 0),
        cost_rate: Number(newLabour.cost_rate || 0),
        notes: newLabour.notes,
      });
      setShowAddLabour(false);
      setNewLabour({ employee_id: "", role_on_site: "", regular_hours: "8", overtime_hours: "0", cost_rate: "0", notes: "" });
      setNotice({ tone: "success", text: "Labour line added." });
      await onRefresh();
    } catch (err) {
      setNotice({ tone: "error", text: errorText(err, "Failed to add labour.") });
    } finally {
      setSavingAction(null);
    }
  };

  // Update equipment row hours
  const handleSaveEquipRow = async (lineId: string) => {
    const edit = equipEdits[lineId];
    if (!edit) return;
    setSavingAction(`equip-${lineId}`);
    try {
      await updateDailyReportEquipment(reportId, lineId, {
        operating_hours: Number(edit.op),
        idle_hours: Number(edit.idle),
        fuel_litres: Number(edit.fuel),
      });
      setEquipEdits((prev) => ({
        ...prev,
        [lineId]: { ...prev[lineId], dirty: false },
      }));
      setNotice({ tone: "success", text: "Equipment hours updated." });
      await onRefresh();
    } catch (err) {
      setNotice({ tone: "error", text: errorText(err, "Failed to update equipment hours.") });
    } finally {
      setSavingAction(null);
    }
  };

  // Delete equipment row
  const handleDeleteEquipRow = async (lineId: string) => {
    if (!confirm("Remove this equipment line from today's report?")) return;
    setSavingAction(`del-equip-${lineId}`);
    try {
      await deleteDailyReportEquipment(reportId, lineId);
      setNotice({ tone: "success", text: "Equipment line removed." });
      await onRefresh();
    } catch (err) {
      setNotice({ tone: "error", text: errorText(err, "Failed to remove equipment line.") });
    } finally {
      setSavingAction(null);
    }
  };

  // Add equipment manually
  const handleAddEquip = async () => {
    if (!newEquip.fleet_id) {
      setNotice({ tone: "error", text: "Select a fleet asset." });
      return;
    }
    setSavingAction("add-equip");
    try {
      await addDailyReportEquipment(reportId, {
        fleet_id: newEquip.fleet_id,
        operator_employee_id: newEquip.operator_employee_id || null,
        operating_hours: Number(newEquip.operating_hours || 0),
        idle_hours: Number(newEquip.idle_hours || 0),
        fuel_litres: Number(newEquip.fuel_litres || 0),
        cost_rate: Number(newEquip.cost_rate || 0),
        notes: newEquip.notes,
      });
      setShowAddEquip(false);
      setNewEquip({ fleet_id: "", operator_employee_id: "", operating_hours: "8", idle_hours: "0", fuel_litres: "0", cost_rate: "0", notes: "" });
      setNotice({ tone: "success", text: "Equipment line added." });
      await onRefresh();
    } catch (err) {
      setNotice({ tone: "error", text: errorText(err, "Failed to add equipment line.") });
    } finally {
      setSavingAction(null);
    }
  };

  // Delete material row
  const handleDeleteMaterialRow = async (lineId: string) => {
    if (!confirm("Remove this consumed material line?")) return;
    setSavingAction(`del-mat-${lineId}`);
    try {
      await deleteDailyReportMaterial(reportId, lineId);
      setNotice({ tone: "success", text: "Material line removed." });
      await onRefresh();
    } catch (err) {
      setNotice({ tone: "error", text: errorText(err, "Failed to remove material line.") });
    } finally {
      setSavingAction(null);
    }
  };

  // Add consumed material
  const handleAddMaterial = async () => {
    if (!newMaterial.item_id) {
      setNotice({ tone: "error", text: "Select an inventory item." });
      return;
    }
    if (Number(newMaterial.quantity_used) <= 0) {
      setNotice({ tone: "error", text: "Enter a positive quantity used." });
      return;
    }
    setSavingAction("add-material");
    try {
      await addDailyReportMaterial(reportId, {
        item_id: newMaterial.item_id,
        store_id: newMaterial.store_id || null,
        quantity_used: Number(newMaterial.quantity_used),
        unit_cost: Number(newMaterial.unit_cost || 0),
        wastage_quantity: Number(newMaterial.wastage_quantity || 0),
        work_package: newMaterial.work_package || null,
        notes: newMaterial.notes,
      });
      setShowAddMaterial(false);
      setNewMaterial({ item_id: "", store_id: "", quantity_used: "1", unit_cost: "0", wastage_quantity: "0", work_package: "", notes: "" });
      setNotice({ tone: "success", text: "Consumed material recorded." });
      await onRefresh();
    } catch (err) {
      setNotice({ tone: "error", text: errorText(err, "Failed to add material.") });
    } finally {
      setSavingAction(null);
    }
  };

  // Workflow transitions
  const handleWorkflow = async (action: "submit" | "approved" | "rejected") => {
    setSavingAction(`workflow-${action}`);
    setNotice(null);
    try {
      if (action === "submit") {
        await submitDailySiteReport(reportId);
        setNotice({ tone: "success", text: "Daily report submitted for management approval." });
      } else {
        await decideDailySiteReport(reportId, action, action === "approved" ? "Approved from Site Operations Command." : "Rejected from Site Operations Command.");
        setNotice({ tone: "success", text: action === "approved" ? "Daily report approved. Costs posted to project actuals." : "Daily report rejected." });
      }
      await onRefresh();
    } catch (err) {
      setNotice({ tone: "error", text: errorText(err, `Failed to ${action} daily report.`) });
    } finally {
      setSavingAction(null);
    }
  };

  const statusTone = (s: string): "slate" | "green" | "amber" | "red" | "blue" => {
    switch (s) {
      case "approved": return "green";
      case "submitted": return "blue";
      case "rejected": return "red";
      default: return "amber";
    }
  };

  return (
    <div className="space-y-5">
      {notice && (
        <Notice tone={notice.tone} onClose={() => setNotice(null)}>
          {notice.text}
        </Notice>
      )}

      {/* Main Top Banner */}
      <div className="flex flex-col gap-4 border border-ink-mid bg-ink-light/40 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-bold uppercase tracking-widest text-signal">
              Active Site Day Report
            </span>
            <Pill tone={statusTone(status)}>{status.toUpperCase()}</Pill>
            <span className="font-mono text-xs text-slate-light">
              Shift: <b className="text-paper capitalize">{activeReport.shift || "day"}</b>
            </span>
            {activeReport.report_date && (
              <span className="font-mono text-xs text-slate-light">
                · {activeReport.report_date}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-light">
            Automated from morning attendance, plant allocations, and stock store issues. Only fine-tune hours before submission.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isDraft && (
            <Btn
              tone="ghost"
              onClick={handleSyncAll}
              busy={syncing}
              icon={<RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />}
              title="Re-synchronize with live morning register, fleet and stock issues"
            >
              Sync Site Activity
            </Btn>
          )}

          {isDraft && (
            <Btn
              tone="primary"
              onClick={() => handleWorkflow("submit")}
              busy={savingAction === "workflow-submit"}
              icon={<Send className="h-4 w-4" />}
            >
              Submit for Approval
            </Btn>
          )}

          {isSubmitted && canApprove && (
            <>
              <Btn
                tone="success"
                onClick={() => handleWorkflow("approved")}
                busy={savingAction === "workflow-approved"}
                icon={<CheckCircle2 className="h-4 w-4" />}
              >
                Approve & Post Costs
              </Btn>
              <Btn
                tone="danger"
                onClick={() => handleWorkflow("rejected")}
                busy={savingAction === "workflow-rejected"}
                icon={<X className="h-4 w-4" />}
              >
                Reject
              </Btn>
            </>
          )}

          {onClose && (
            <button
              onClick={onClose}
              className="border border-ink-mid p-2 text-slate-light hover:border-signal hover:text-paper"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>

      {/* EVM & Performance Impact Overview */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="border border-ink-mid bg-ink p-3">
          <div className="flex items-center justify-between text-slate">
            <span className="font-mono text-[10px] uppercase">Labour on Site</span>
            <Users className="h-4 w-4 text-signal" />
          </div>
          <p className="mt-1 font-mono text-xl text-paper">{totals.headcount} workers</p>
          <p className="mt-0.5 text-xs text-emerald-300 font-mono">{usd(totals.labourCost)} spend</p>
        </div>

        <div className="border border-ink-mid bg-ink p-3">
          <div className="flex items-center justify-between text-slate">
            <span className="font-mono text-[10px] uppercase">Plant & Fleet</span>
            <Truck className="h-4 w-4 text-signal" />
          </div>
          <p className="mt-1 font-mono text-xl text-paper">{totals.fleetCount} units</p>
          <p className="mt-0.5 text-xs text-emerald-300 font-mono">{usd(totals.equipCost)} spend</p>
        </div>

        <div className="border border-ink-mid bg-ink p-3">
          <div className="flex items-center justify-between text-slate">
            <span className="font-mono text-[10px] uppercase">Materials Consumed</span>
            <PackageCheck className="h-4 w-4 text-signal" />
          </div>
          <p className="mt-1 font-mono text-xl text-paper">{totals.materialCount} items</p>
          <p className="mt-0.5 text-xs text-emerald-300 font-mono">{usd(totals.materialCost)} spend</p>
        </div>

        <div className="border border-signal/40 bg-signal/5 p-3">
          <div className="flex items-center justify-between text-slate">
            <span className="font-mono text-[10px] uppercase font-bold text-signal">Total Day Spend</span>
            <DollarSign className="h-4 w-4 text-signal" />
          </div>
          <p className="mt-1 font-mono text-xl font-bold text-paper">{usd(totals.totalSpend)}</p>
          <p className="mt-0.5 text-[10px] text-slate-light">
            {isApproved ? "✓ Posted to Projects EVM (ACWP)" : "Pending approval to post to Projects"}
          </p>
        </div>
      </section>

      {/* Completeness Badge */}
      {detail?.completeness && (
        <div className="flex flex-wrap items-center justify-between gap-3 border border-ink-mid bg-ink px-4 py-2 text-xs">
          <div className="flex items-center gap-3">
            <span className="font-mono uppercase text-slate-light">Report Readiness:</span>
            <span className="font-mono font-bold text-paper">{detail.completeness.score_percent}%</span>
            <div className="h-2 w-32 bg-ink-mid overflow-hidden rounded">
              <div
                className={`h-full ${detail.completeness.score_percent >= 100 ? "bg-emerald-500" : "bg-signal"}`}
                style={{ width: `${detail.completeness.score_percent}%` }}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-[11px]">
            <span className={detail.completeness.labour_captured ? "text-emerald-300" : "text-slate"}>
              ✓ Labour Synced
            </span>
            <span className={detail.completeness.work_progress_logged ? "text-emerald-300" : "text-slate"}>
              ✓ Progress Logged
            </span>
            <span className={detail.completeness.safety_checks_recorded ? "text-emerald-300" : "text-slate"}>
              ✓ Safety Briefing
            </span>
            <span className={detail.completeness.weather_recorded ? "text-emerald-300" : "text-slate"}>
              ✓ Weather & Delays
            </span>
          </div>
        </div>
      )}

      {/* SECTION 1: LABOUR ON SITE */}
      <section className="border border-ink-mid bg-ink">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-mid px-4 py-3">
          <div>
            <div className="flex items-center gap-2">
              <HardHat className="h-4 w-4 text-signal" />
              <h3 className="font-mono text-xs font-bold uppercase tracking-widest text-paper">
                1. Labour on Site ({detail?.labour.length ?? 0} Workers)
              </h3>
            </div>
            <p className="mt-0.5 text-[11px] text-slate-light">
              Automatically synced from morning attendance. Adjust regular or overtime hours if needed.
            </p>
          </div>
          {isDraft && (
            <Btn
              tone="ghost"
              onClick={() => setShowAddLabour((v) => !v)}
              icon={<Plus className="h-3.5 w-3.5" />}
              className="h-8 text-[11px]"
            >
              {showAddLabour ? "Cancel" : "+ Add Worker"}
            </Btn>
          )}
        </header>

        {/* Add Labour Form */}
        {showAddLabour && isDraft && (
          <div className="border-b border-ink-mid bg-ink-light/20 p-4">
            <h4 className="font-mono text-[11px] uppercase tracking-wider text-signal mb-2">Record Additional Labour Line</h4>
            <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-5">
              <select
                value={newLabour.employee_id}
                onChange={(e) => {
                  const emp = employees.find((emp) => emp.id === e.target.value);
                  setNewLabour({
                    ...newLabour,
                    employee_id: e.target.value,
                    role_on_site: emp?.job_title || emp?.trade || newLabour.role_on_site,
                    cost_rate: emp?.hourly_rate ? String(emp.hourly_rate) : newLabour.cost_rate,
                  });
                }}
                className={fieldClass}
              >
                <option value="">Select Employee...</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.full_name || e.name || e.employee_name} ({e.trade || e.job_title || "General"})
                  </option>
                ))}
              </select>
              <input
                value={newLabour.role_on_site}
                onChange={(e) => setNewLabour({ ...newLabour, role_on_site: e.target.value })}
                placeholder="Role / Trade on Site"
                className={fieldClass}
              />
              <input
                type="number"
                step="0.5"
                min="0"
                value={newLabour.regular_hours}
                onChange={(e) => setNewLabour({ ...newLabour, regular_hours: e.target.value })}
                placeholder="Reg Hours (e.g. 8)"
                className={fieldClass}
              />
              <input
                type="number"
                step="0.5"
                min="0"
                value={newLabour.overtime_hours}
                onChange={(e) => setNewLabour({ ...newLabour, overtime_hours: e.target.value })}
                placeholder="OT Hours"
                className={fieldClass}
              />
              <input
                type="number"
                step="0.01"
                min="0"
                value={newLabour.cost_rate}
                onChange={(e) => setNewLabour({ ...newLabour, cost_rate: e.target.value })}
                placeholder="Rate ($/h)"
                className={fieldClass}
              />
            </div>
            <div className="mt-3 flex justify-end">
              <Btn
                tone="primary"
                onClick={handleAddLabour}
                busy={savingAction === "add-labour"}
                className="h-8 text-xs"
              >
                Save Labour Line
              </Btn>
            </div>
          </div>
        )}

        {/* Labour Table */}
        {!detail?.labour?.length ? (
          <div className="p-6 text-center text-xs text-slate-light">
            No labour lines recorded. Start the site day in the Labour Register tab or click &ldquo;Sync Site Activity&rdquo;.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-ink-mid bg-ink-light/20 text-slate">
                <tr>
                  <th className="px-4 py-2.5 font-mono uppercase">Worker Name</th>
                  <th className="px-3 py-2.5 font-mono uppercase">Role / Trade</th>
                  <th className="px-3 py-2.5 font-mono uppercase">Type</th>
                  <th className="px-3 py-2.5 font-mono uppercase text-center w-24">Regular (h)</th>
                  <th className="px-3 py-2.5 font-mono uppercase text-center w-24">Overtime (h)</th>
                  <th className="px-3 py-2.5 font-mono uppercase text-right">Cost Rate</th>
                  <th className="px-3 py-2.5 font-mono uppercase text-right">Line Total</th>
                  {isDraft && <th className="px-4 py-2.5 font-mono uppercase text-right w-24">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-mid/50 text-paper">
                {detail.labour.map((l) => {
                  const edit = labourEdits[l.id] || { regular: String(l.regular_hours || 8), ot: String(l.overtime_hours || 0), dirty: false };
                  const reg = Number(edit.regular || 0);
                  const ot = Number(edit.ot || 0);
                  const rate = Number(l.cost_rate || 0);
                  const lineTotal = (reg * rate) + (ot * rate * 1.5);

                  return (
                    <tr key={l.id} className="hover:bg-ink-light/20 transition">
                      <td className="px-4 py-2 font-medium">
                        {l.worker_name || l.employee_name || "Site Worker"}
                      </td>
                      <td className="px-3 py-2 text-slate-light">
                        {l.role_on_site || "-"}
                      </td>
                      <td className="px-3 py-2">
                        <Pill tone={l.worker_kind === "project_hire" ? "gold" : "slate"}>
                          {l.worker_kind === "project_hire" ? "Project Hire" : "Employee"}
                        </Pill>
                      </td>
                      <td className="px-3 py-2 text-center">
                        {isDraft ? (
                          <input
                            type="number"
                            step="0.5"
                            min="0"
                            max="24"
                            value={edit.regular}
                            onChange={(e) => {
                              setLabourEdits({
                                ...labourEdits,
                                [l.id]: { ...edit, regular: e.target.value, dirty: true },
                              });
                            }}
                            className="h-8 w-16 border border-ink-mid bg-ink px-1 text-center font-mono text-xs text-paper focus:border-signal"
                          />
                        ) : (
                          <span className="font-mono">{l.regular_hours}h</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {isDraft ? (
                          <input
                            type="number"
                            step="0.5"
                            min="0"
                            max="24"
                            value={edit.ot}
                            onChange={(e) => {
                              setLabourEdits({
                                ...labourEdits,
                                [l.id]: { ...edit, ot: e.target.value, dirty: true },
                              });
                            }}
                            className="h-8 w-16 border border-ink-mid bg-ink px-1 text-center font-mono text-xs text-paper focus:border-signal"
                          />
                        ) : (
                          <span className="font-mono text-signal">{Number(l.overtime_hours) > 0 ? `+${l.overtime_hours}h` : "-"}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-slate-light">
                        {usd(l.cost_rate)}/h
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-medium text-emerald-300">
                        {usd(lineTotal)}
                      </td>
                      {isDraft && (
                        <td className="px-4 py-2 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {edit.dirty && (
                              <button
                                onClick={() => handleSaveLabourRow(l.id)}
                                disabled={savingAction === `labour-${l.id}`}
                                className="border border-signal/60 bg-signal/10 p-1.5 text-signal hover:bg-signal/20"
                                title="Save updated hours"
                              >
                                {savingAction === `labour-${l.id}` ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Save className="h-3.5 w-3.5" />
                                )}
                              </button>
                            )}
                            <button
                              onClick={() => handleDeleteLabourRow(l.id)}
                              disabled={savingAction === `del-labour-${l.id}`}
                              className="border border-ink-mid p-1.5 text-slate-light hover:border-red-500 hover:text-red-400"
                              title="Delete line"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* SECTION 2: PLANT & EQUIPMENT */}
      <section className="border border-ink-mid bg-ink">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-mid px-4 py-3">
          <div>
            <div className="flex items-center gap-2">
              <Truck className="h-4 w-4 text-signal" />
              <h3 className="font-mono text-xs font-bold uppercase tracking-widest text-paper">
                2. Plant & Equipment in Use ({detail?.equipment.length ?? 0} Assets)
              </h3>
            </div>
            <p className="mt-0.5 text-[11px] text-slate-light">
              Automatically synced from active project plant assignments. Adjust operating/idle hours and fuel consumed.
            </p>
          </div>
          {isDraft && (
            <Btn
              tone="ghost"
              onClick={() => setShowAddEquip((v) => !v)}
              icon={<Plus className="h-3.5 w-3.5" />}
              className="h-8 text-[11px]"
            >
              {showAddEquip ? "Cancel" : "+ Add Plant Line"}
            </Btn>
          )}
        </header>

        {/* Add Equipment Form */}
        {showAddEquip && isDraft && (
          <div className="border-b border-ink-mid bg-ink-light/20 p-4">
            <h4 className="font-mono text-[11px] uppercase tracking-wider text-signal mb-2">Record Additional Equipment Line</h4>
            <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-6">
              <select
                value={newEquip.fleet_id}
                onChange={(e) => {
                  const asset = fleet.find((f) => f.id === e.target.value);
                  setNewEquip({
                    ...newEquip,
                    fleet_id: e.target.value,
                    cost_rate: asset?.hourly_rate ? String(asset.hourly_rate) : newEquip.cost_rate,
                  });
                }}
                className={fieldClass}
              >
                <option value="">Select Fleet Asset...</option>
                {fleet.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.asset_code || f.vehicle_registration || f.name} · {f.asset_type || "Machinery"}
                  </option>
                ))}
              </select>
              <select
                value={newEquip.operator_employee_id}
                onChange={(e) => setNewEquip({ ...newEquip, operator_employee_id: e.target.value })}
                className={fieldClass}
              >
                <option value="">Operator (optional)...</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.full_name || e.name}
                  </option>
                ))}
              </select>
              <input
                type="number"
                step="0.5"
                min="0"
                value={newEquip.operating_hours}
                onChange={(e) => setNewEquip({ ...newEquip, operating_hours: e.target.value })}
                placeholder="Operating (h)"
                className={fieldClass}
              />
              <input
                type="number"
                step="0.5"
                min="0"
                value={newEquip.idle_hours}
                onChange={(e) => setNewEquip({ ...newEquip, idle_hours: e.target.value })}
                placeholder="Idle (h)"
                className={fieldClass}
              />
              <input
                type="number"
                step="1"
                min="0"
                value={newEquip.fuel_litres}
                onChange={(e) => setNewEquip({ ...newEquip, fuel_litres: e.target.value })}
                placeholder="Fuel (L)"
                className={fieldClass}
              />
              <input
                type="number"
                step="0.01"
                min="0"
                value={newEquip.cost_rate}
                onChange={(e) => setNewEquip({ ...newEquip, cost_rate: e.target.value })}
                placeholder="Rate ($/h)"
                className={fieldClass}
              />
            </div>
            <div className="mt-3 flex justify-end">
              <Btn
                tone="primary"
                onClick={handleAddEquip}
                busy={savingAction === "add-equip"}
                className="h-8 text-xs"
              >
                Save Equipment Line
              </Btn>
            </div>
          </div>
        )}

        {/* Equipment Table */}
        {!detail?.equipment?.length ? (
          <div className="p-6 text-center text-xs text-slate-light">
            No equipment lines recorded for this report. Request plant in the Plant &amp; Equipment tab or click &ldquo;+ Add Plant Line&rdquo;.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-ink-mid bg-ink-light/20 text-slate">
                <tr>
                  <th className="px-4 py-2.5 font-mono uppercase">Asset Code &amp; Model</th>
                  <th className="px-3 py-2.5 font-mono uppercase">Operator</th>
                  <th className="px-3 py-2.5 font-mono uppercase text-center w-24">Operating (h)</th>
                  <th className="px-3 py-2.5 font-mono uppercase text-center w-24">Idle (h)</th>
                  <th className="px-3 py-2.5 font-mono uppercase text-center w-24">Fuel (L)</th>
                  <th className="px-3 py-2.5 font-mono uppercase text-right">Rate ($/h)</th>
                  <th className="px-3 py-2.5 font-mono uppercase text-right">Line Total</th>
                  {isDraft && <th className="px-4 py-2.5 font-mono uppercase text-right w-24">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-mid/50 text-paper">
                {detail.equipment.map((e) => {
                  const edit = equipEdits[e.id] || { op: String(e.operating_hours || 0), idle: String(e.idle_hours || 0), fuel: String(e.fuel_litres || 0), dirty: false };
                  const op = Number(edit.op || 0);
                  const idle = Number(edit.idle || 0);
                  const rate = Number(e.cost_rate || 0);
                  const lineTotal = (op * rate) + (idle * rate * 0.4);

                  return (
                    <tr key={e.id} className="hover:bg-ink-light/20 transition">
                      <td className="px-4 py-2 font-medium">
                        {e.fleet_code || e.fleet_name || "Machinery Asset"}
                      </td>
                      <td className="px-3 py-2 text-slate-light">
                        {e.operator_name || "Unassigned"}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {isDraft ? (
                          <input
                            type="number"
                            step="0.5"
                            min="0"
                            max="24"
                            value={edit.op}
                            onChange={(ev) => {
                              setEquipEdits({
                                ...equipEdits,
                                [e.id]: { ...edit, op: ev.target.value, dirty: true },
                              });
                            }}
                            className="h-8 w-16 border border-ink-mid bg-ink px-1 text-center font-mono text-xs text-paper focus:border-signal"
                          />
                        ) : (
                          <span className="font-mono">{e.operating_hours}h</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {isDraft ? (
                          <input
                            type="number"
                            step="0.5"
                            min="0"
                            max="24"
                            value={edit.idle}
                            onChange={(ev) => {
                              setEquipEdits({
                                ...equipEdits,
                                [e.id]: { ...edit, idle: ev.target.value, dirty: true },
                              });
                            }}
                            className="h-8 w-16 border border-ink-mid bg-ink px-1 text-center font-mono text-xs text-paper focus:border-signal"
                          />
                        ) : (
                          <span className="font-mono">{e.idle_hours}h</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {isDraft ? (
                          <input
                            type="number"
                            step="1"
                            min="0"
                            value={edit.fuel}
                            onChange={(ev) => {
                              setEquipEdits({
                                ...equipEdits,
                                [e.id]: { ...edit, fuel: ev.target.value, dirty: true },
                              });
                            }}
                            className="h-8 w-16 border border-ink-mid bg-ink px-1 text-center font-mono text-xs text-paper focus:border-signal"
                          />
                        ) : (
                          <span className="font-mono">{e.fuel_litres ? `${e.fuel_litres}L` : "-"}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-slate-light">
                        {usd(e.cost_rate)}/h
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-medium text-emerald-300">
                        {usd(lineTotal)}
                      </td>
                      {isDraft && (
                        <td className="px-4 py-2 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {edit.dirty && (
                              <button
                                onClick={() => handleSaveEquipRow(e.id)}
                                disabled={savingAction === `equip-${e.id}`}
                                className="border border-signal/60 bg-signal/10 p-1.5 text-signal hover:bg-signal/20"
                                title="Save updated equipment hours"
                              >
                                {savingAction === `equip-${e.id}` ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Save className="h-3.5 w-3.5" />
                                )}
                              </button>
                            )}
                            <button
                              onClick={() => handleDeleteEquipRow(e.id)}
                              disabled={savingAction === `del-equip-${e.id}`}
                              className="border border-ink-mid p-1.5 text-slate-light hover:border-red-500 hover:text-red-400"
                              title="Delete line"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* SECTION 3: MATERIALS CONSUMED */}
      <section className="border border-ink-mid bg-ink">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-mid px-4 py-3">
          <div>
            <div className="flex items-center gap-2">
              <PackageCheck className="h-4 w-4 text-signal" />
              <h3 className="font-mono text-xs font-bold uppercase tracking-widest text-paper">
                3. Materials Consumed on Site ({detail?.materials.length ?? 0} Items)
              </h3>
            </div>
            <p className="mt-0.5 text-[11px] text-slate-light">
              Materials consumed directly impact project cost performance (ACWP). Synced from stock ledger store issues or logged on site.
            </p>
          </div>
          {isDraft && (
            <Btn
              tone="ghost"
              onClick={() => setShowAddMaterial((v) => !v)}
              icon={<Plus className="h-3.5 w-3.5" />}
              className="h-8 text-[11px]"
            >
              {showAddMaterial ? "Cancel" : "+ Log Consumed Material"}
            </Btn>
          )}
        </header>

        {/* Add Material Form */}
        {showAddMaterial && isDraft && (
          <div className="border-b border-ink-mid bg-ink-light/20 p-4">
            <h4 className="font-mono text-[11px] uppercase tracking-wider text-signal mb-2">Log Material Consumed Today</h4>
            <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-6">
              <select
                value={newMaterial.item_id}
                onChange={(e) => {
                  const item = inventoryItems.find((i) => i.id === e.target.value);
                  setNewMaterial({
                    ...newMaterial,
                    item_id: e.target.value,
                    unit_cost: item?.standard_cost ? String(item.standard_cost) : newMaterial.unit_cost,
                  });
                }}
                className={fieldClass}
              >
                <option value="">Select Inventory Item...</option>
                {inventoryItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.item_name || item.name} {item.stock_quantity !== undefined ? `(Stock: ${item.stock_quantity})` : ""}
                  </option>
                ))}
              </select>
              <select
                value={newMaterial.store_id}
                onChange={(e) => setNewMaterial({ ...newMaterial, store_id: e.target.value })}
                className={fieldClass}
              >
                <option value="">Store (optional)...</option>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name || s.store_code}
                  </option>
                ))}
              </select>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={newMaterial.quantity_used}
                onChange={(e) => setNewMaterial({ ...newMaterial, quantity_used: e.target.value })}
                placeholder="Quantity Used"
                className={fieldClass}
              />
              <input
                type="number"
                step="0.01"
                min="0"
                value={newMaterial.unit_cost}
                onChange={(e) => setNewMaterial({ ...newMaterial, unit_cost: e.target.value })}
                placeholder="Unit Cost ($)"
                className={fieldClass}
              />
              <input
                type="number"
                step="0.01"
                min="0"
                value={newMaterial.wastage_quantity}
                onChange={(e) => setNewMaterial({ ...newMaterial, wastage_quantity: e.target.value })}
                placeholder="Wastage Qty"
                className={fieldClass}
              />
              <input
                value={newMaterial.work_package}
                onChange={(e) => setNewMaterial({ ...newMaterial, work_package: e.target.value })}
                placeholder="Work Package (e.g. Slab)"
                className={fieldClass}
              />
            </div>
            <div className="mt-3 flex justify-end">
              <Btn
                tone="primary"
                onClick={handleAddMaterial}
                busy={savingAction === "add-material"}
                className="h-8 text-xs"
              >
                Record Material
              </Btn>
            </div>
          </div>
        )}

        {/* Materials Table */}
        {!detail?.materials?.length ? (
          <div className="p-6 text-center text-xs text-slate-light">
            No materials recorded as consumed today. Click &ldquo;+ Log Consumed Material&rdquo; or ensure store issues have been posted.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-ink-mid bg-ink-light/20 text-slate">
                <tr>
                  <th className="px-4 py-2.5 font-mono uppercase">Material Description</th>
                  <th className="px-3 py-2.5 font-mono uppercase">Store</th>
                  <th className="px-3 py-2.5 font-mono uppercase">Work Package</th>
                  <th className="px-3 py-2.5 font-mono uppercase text-right">Quantity Used</th>
                  <th className="px-3 py-2.5 font-mono uppercase text-right">Wastage</th>
                  <th className="px-3 py-2.5 font-mono uppercase text-right">Unit Cost</th>
                  <th className="px-3 py-2.5 font-mono uppercase text-right">Total Cost</th>
                  {isDraft && <th className="px-4 py-2.5 font-mono uppercase text-right w-16">Action</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-mid/50 text-paper">
                {detail.materials.map((m) => {
                  const q = Number(m.quantity_used || 0);
                  const u = Number(m.unit_cost || 0);
                  const lineTotal = q * u;

                  return (
                    <tr key={m.id} className="hover:bg-ink-light/20 transition">
                      <td className="px-4 py-2 font-medium">
                        {m.item_name || m.item_code || "Material Item"}
                      </td>
                      <td className="px-3 py-2 text-slate-light">
                        {m.store_name || "-"}
                      </td>
                      <td className="px-3 py-2 text-slate-light">
                        {m.work_package || "-"}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {qty(m.quantity_used)} {m.unit_of_measure || "units"}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-amber-300">
                        {Number(m.wastage_quantity) > 0 ? `${qty(m.wastage_quantity)}` : "-"}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-slate-light">
                        {usd(m.unit_cost)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-medium text-emerald-300">
                        {usd(lineTotal)}
                      </td>
                      {isDraft && (
                        <td className="px-4 py-2 text-right">
                          <button
                            onClick={() => handleDeleteMaterialRow(m.id)}
                            disabled={savingAction === `del-mat-${m.id}`}
                            className="border border-ink-mid p-1.5 text-slate-light hover:border-red-500 hover:text-red-400"
                            title="Delete material line"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* SECTION 4: NARRATIVE & SITE PROGRESS */}
      <section className="border border-ink-mid bg-ink p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-mid pb-3">
          <div>
            <h3 className="font-mono text-xs font-bold uppercase tracking-widest text-paper">
              4. Daily Site Narrative &amp; Work Completed
            </h3>
            <p className="mt-0.5 text-[11px] text-slate-light">
              Record physical progress, weather conditions, delays, and site instructions.
            </p>
          </div>
          {isDraft && (
            <Btn
              tone="primary"
              onClick={handleSaveNarrative}
              busy={savingAction === "narrative"}
              icon={<Save className="h-3.5 w-3.5" />}
              className="h-8 text-xs"
            >
              Save Narrative
            </Btn>
          )}
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs text-slate-light">Planned Work for Today</span>
              {dayTargets.length > 0 && isDraft && (
                <button
                  type="button"
                  onClick={() => {
                    const text = dayTargets
                      .map((t) => `• ${t.work_package ? `${t.work_package}: ` : ""}${t.description} (${qty(t.target_qty)} ${t.unit ?? ""})`)
                      .join("\n");
                    setNarrative({ ...narrative, planned_work: text });
                    setNarrativeDirty(true);
                  }}
                  className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-signal hover:underline"
                >
                  <Target className="h-3 w-3" /> Fill from Today&apos;s Targets
                </button>
              )}
            </div>
            <textarea
              disabled={!isDraft}
              value={narrative.planned_work}
              onChange={(e) => {
                setNarrative({ ...narrative, planned_work: e.target.value });
                setNarrativeDirty(true);
              }}
              placeholder="What was planned for today's shift..."
              className={areaClass}
            />
          </div>

          <div>
            <span className="mb-1 block text-xs text-slate-light">Actual Work Completed</span>
            <textarea
              disabled={!isDraft}
              value={narrative.actual_work}
              onChange={(e) => {
                setNarrative({ ...narrative, actual_work: e.target.value });
                setNarrativeDirty(true);
              }}
              placeholder="Detailed description of works executed on site..."
              className={areaClass}
            />
          </div>

          <div>
            <span className="mb-1 block text-xs text-slate-light">Delays, Weather &amp; Idle Time</span>
            <textarea
              disabled={!isDraft}
              value={narrative.delays}
              onChange={(e) => {
                setNarrative({ ...narrative, delays: e.target.value });
                setNarrativeDirty(true);
              }}
              placeholder="Rain, equipment breakdown, material shortage, waiting instructions..."
              className={`${areaClass} min-h-20`}
            />
          </div>

          <div>
            <span className="mb-1 block text-xs text-slate-light">Safety, Incidents &amp; Quality Notes</span>
            <textarea
              disabled={!isDraft}
              value={narrative.safety_notes}
              onChange={(e) => {
                setNarrative({ ...narrative, safety_notes: e.target.value });
                setNarrativeDirty(true);
              }}
              placeholder="Toolbox talk topics, safety concerns raised, corrective measures..."
              className={`${areaClass} min-h-20`}
            />
          </div>
        </div>

        {/* Safety Briefing Info Box if linked */}
        {detail?.safety_briefing && (
          <div className="border border-ink-mid bg-ink-light/20 p-3 text-xs">
            <div className="flex items-center justify-between mb-1">
              <span className="font-mono text-[10px] uppercase text-signal">Linked Morning Briefing</span>
              <Pill tone={detail.safety_briefing.ppe_compliant ? "green" : "amber"}>
                {detail.safety_briefing.ppe_compliant ? "PPE Checked" : "PPE Attention"}
              </Pill>
            </div>
            <p className="text-slate-light">
              <b className="text-paper">Toolbox Topic:</b> {detail.safety_briefing.toolbox_topic || "Standard Protocol"} ·{" "}
              <b className="text-paper">Conductor:</b> {detail.safety_briefing.toolbox_conductor || "Site Supervisor"}
            </p>
          </div>
        )}
      </section>

      {/* SECTION 5: SITE EVIDENCE & DOCKET CAPTURE */}
      <section className="border border-ink-mid bg-ink p-4 space-y-3">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-mid/40 pb-2">
          <div className="flex items-center gap-2">
            <Camera className="h-4 w-4 text-signal" />
            <h3 className="font-mono text-xs font-bold uppercase tracking-widest text-paper">
              5. Site Evidence &amp; Delivery Dockets
            </h3>
          </div>
          <span className="font-mono text-[10px] text-slate-light">
            Camera Photos &middot; In-Browser Compression &middot; Offline Queued
          </span>
        </header>

        <SiteEvidenceCapture
          reportId={reportId}
          projectId={String(activeReport.project_id || "")}
          documents={detail?.documents?.map((d) => ({
            id: String(d.id),
            title: String(d.title || d.name || "Site Attachment"),
            file_name: d.file_name ? String(d.file_name) : undefined,
            created_at: d.created_at ? String(d.created_at) : undefined,
          }))}
          onDocumentAdded={onRefresh}
        />
      </section>

      {/* SECTION 6: APPROVAL AUDIT TIMELINE */}
      {detail?.approvals && detail.approvals.length > 0 && (
        <section className="border border-ink-mid bg-ink p-4">
          <h3 className="mb-2 font-mono text-xs uppercase tracking-widest text-paper">
            Approval Timeline &amp; Cost Posting Audit
          </h3>
          <div className="space-y-1.5 text-xs text-slate-light">
            {detail.approvals.map((app) => (
              <div key={app.id} className="flex items-center justify-between border-b border-ink-mid/40 py-1.5">
                <span>{app.workflow_key || "Daily Report Sign-off"}</span>
                <span className="font-mono">{app.status}</span>
                <span>{app.decided_at ? new Date(app.decided_at).toLocaleString() : "Pending"}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
