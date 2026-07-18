"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { RBACGuard } from "@/components/auth/RBACGuard";
import {
  ApiError,
  getEquipmentAssets,
  getAssetInspections,
  recordAssetInspection,
  recordAssetMeterReading,
  recordAssetDefect,
} from "@/lib/api";
import {
  Activity,
  AlertTriangle,
  BarChart2,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Coins,
  Cpu,
  FileText,
  Filter,
  Fuel,
  Gauge,
  Loader2,
  MoreHorizontal,
  RefreshCw,
  Search,
  ShieldAlert,
  Wrench,
  X,
  Zap,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────

type AssetRecord = Record<string, unknown> & { id: string };
type InspectionRecord = Record<string, unknown> & { id: string };

type ModalKind = "inspection" | "defect" | "meter" | null;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function str(record: AssetRecord, ...keys: string[]): string {
  for (const k of keys) {
    const v = record[k];
    if (v !== null && v !== undefined && String(v).trim()) return String(v);
  }
  return "";
}

function num(record: AssetRecord, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = record[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() && Number.isFinite(Number(v)))
      return Number(v);
  }
  return null;
}

function fmtDate(value: string): string {
  const d = new Date(value);
  return isNaN(d.getTime())
    ? value
    : new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(d);
}

function strDate(record: AssetRecord, ...keys: string[]): string | null {
  const v = str(record, ...keys);
  return v ? fmtDate(v) : null;
}

function msDate(record: AssetRecord, ...keys: string[]): number | null {
  const v = str(record, ...keys);
  const t = v ? Date.parse(v) : NaN;
  return isNaN(t) ? null : t;
}

function assetCode(record: AssetRecord): string {
  return (
    str(record, "asset_code", "code", "fleet_number") ||
    record.id.slice(0, 8).toUpperCase()
  );
}

function assetLabel(record: AssetRecord): string {
  return (
    str(record, "name", "asset_name", "description", "registration_number") ||
    assetCode(record)
  );
}

function assetType(record: AssetRecord): string {
  return str(record, "type", "asset_type", "category") || "Equipment";
}

function normalStatus(record: AssetRecord): string {
  return str(
    record,
    "status",
    "operational_status",
    "availability_status"
  )
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function ownershipType(record: AssetRecord): string {
  return str(record, "ownership_type", "ownership") || "owned";
}

function fmtCurrency(n: number | null): string {
  if (n === null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function fmtNum(n: number | null, suffix = ""): string {
  if (n === null) return "—";
  return n.toLocaleString() + suffix;
}

function normalizeLoadError(reason: unknown, fallback: string) {
  const message = reason instanceof Error ? reason.message : String(reason ?? "");
  if (/aborted|cancelled|timed out|network error|fetch failed|not found/i.test(message)) {
    return fallback;
  }
  return fallback;
}

// ─── Status badge config ─────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  available:
    "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  assigned:
    "border-blue-500/40 bg-blue-500/10 text-blue-300",
  in_service:
    "border-blue-500/40 bg-blue-500/10 text-blue-300",
  out_of_service:
    "border-amber-500/40 bg-amber-500/10 text-amber-200",
  retired:
    "border-red-500/40 bg-red-500/10 text-red-300",
};

function statusStyle(record: AssetRecord): string {
  return (
    STATUS_STYLES[normalStatus(record)] ||
    "border-slate/50 bg-ink-light text-slate-light"
  );
}

function StatusBadge({ record }: { record: AssetRecord }) {
  const raw = str(
    record,
    "status",
    "operational_status",
    "availability_status"
  );
  return (
    <span
      className={`inline-flex items-center border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${statusStyle(record)}`}
    >
      {raw || "unknown"}
    </span>
  );
}

function OwnershipBadge({ record }: { record: AssetRecord }) {
  const ot = ownershipType(record).toLowerCase();
  const cls =
    ot === "owned"
      ? "border-signal/30 bg-signal/5 text-signal"
      : ot === "leased"
        ? "border-purple-500/30 bg-purple-500/5 text-purple-300"
        : "border-slate/40 bg-ink-light text-slate-light";
  return (
    <span
      className={`inline-flex items-center border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${cls}`}
    >
      {ot}
    </span>
  );
}

// ─── Margin color ─────────────────────────────────────────────────────────────

function marginClass(margin: number | null): string {
  if (margin === null) return "text-slate-light";
  if (margin > 0) return "text-emerald-300";
  if (margin < 0) return "text-red-300";
  return "text-slate-light";
}

// ─── Utilization gauge ────────────────────────────────────────────────────────

function UtilGauge({
  pct,
  label,
}: {
  pct: number;
  label: string;
}) {
  const clamped = Math.min(100, Math.max(0, pct));
  const color =
    clamped >= 80
      ? "text-emerald-400"
      : clamped >= 50
        ? "text-signal"
        : "text-amber-400";
  const r = 30;
  const circ = 2 * Math.PI * r;
  const dash = (clamped / 100) * circ;

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width="80" height="80" viewBox="0 0 80 80" className="-rotate-90">
        <circle
          cx="40"
          cy="40"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="6"
          className="text-ink-mid"
        />
        <circle
          cx="40"
          cy="40"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="6"
          strokeDasharray={`${dash} ${circ - dash}`}
          strokeLinecap="round"
          className={color}
        />
      </svg>
      <p className={`-mt-1 text-lg font-bold ${color}`}>{clamped.toFixed(0)}%</p>
      <p className="text-[10px] text-slate">{label}</p>
    </div>
  );
}

// ─── Simple bar chart ─────────────────────────────────────────────────────────

function MiniBarChart({
  revenue,
  cost,
}: {
  revenue: number;
  cost: number;
}) {
  const max = Math.max(revenue, cost, 1);
  const revPct = (revenue / max) * 100;
  const costPct = (cost / max) * 100;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="w-16 text-right text-[10px] text-slate">Revenue</span>
        <div className="flex-1 overflow-hidden rounded-sm bg-ink-mid h-4">
          <div
            className="h-full rounded-sm bg-emerald-500/70"
            style={{ width: `${revPct}%` }}
          />
        </div>
        <span className="w-20 text-[10px] font-mono text-emerald-300">
          {fmtCurrency(revenue)}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span className="w-16 text-right text-[10px] text-slate">Cost</span>
        <div className="flex-1 overflow-hidden rounded-sm bg-ink-mid h-4">
          <div
            className="h-full rounded-sm bg-red-500/60"
            style={{ width: `${costPct}%` }}
          />
        </div>
        <span className="w-20 text-[10px] font-mono text-red-300">
          {fmtCurrency(cost)}
        </span>
      </div>
    </div>
  );
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-sm bg-ink-light ${className}`}
    />
  );
}

function TableSkeleton() {
  return (
    <div className="space-y-px">
      {Array.from({ length: 7 }, (_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 border-b border-ink-mid/50 px-4 py-3"
        >
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-32 flex-1" />
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="border border-dashed border-ink-mid bg-ink p-14 text-center">
      <Cpu className="mx-auto mb-4 text-slate" size={34} />
      <h2 className="text-sm font-semibold text-paper">
        No equipment assets registered
      </h2>
      <p className="mx-auto mt-2 max-w-sm text-sm text-slate-light">
        Add your first asset in Settings to begin tracking utilization,
        profitability, and maintenance intelligence.
      </p>
    </div>
  );
}

// ─── Command strip metric tile ────────────────────────────────────────────────

function MetricTile({
  icon,
  label,
  value,
  sub,
  tone = "text-paper",
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  sub?: string;
  tone?: string;
}) {
  return (
    <div className="bg-ink p-4">
      <div className="flex items-center gap-2 text-slate">
        {icon}
        <span className="font-mono text-[10px] uppercase tracking-wider">
          {label}
        </span>
      </div>
      <p className={`mt-4 text-2xl font-semibold tabular-nums ${tone}`}>
        {value}
      </p>
      {sub && <p className="mt-1 text-[11px] text-slate-light">{sub}</p>}
    </div>
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────────

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-lg border border-ink-mid bg-ink shadow-2xl">
        <div className="flex items-center justify-between border-b border-ink-mid px-5 py-4">
          <h2 className="text-sm font-semibold text-paper">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate hover:text-paper"
          >
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ─── Inspection modal ─────────────────────────────────────────────────────────

function InspectionModal({
  assetId,
  assetLabel: label,
  onClose,
  onSuccess,
}: {
  assetId: string;
  assetLabel: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [form, setForm] = useState({
    inspection_date: new Date().toISOString().slice(0, 10),
    inspector_name: "",
    outcome: "pass",
    odometer_km: "",
    engine_hours: "",
    notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setSaving(true);
    setErr(null);
    try {
      await recordAssetInspection(assetId, {
        ...form,
        odometer_km: form.odometer_km ? Number(form.odometer_km) : undefined,
        engine_hours: form.engine_hours ? Number(form.engine_hours) : undefined,
      });
      onSuccess();
    } catch (e) {
      setErr(
        e instanceof ApiError
          ? normalizeLoadError(e, "Failed to record inspection. Please try again.")
          : normalizeLoadError(e, "Failed to record inspection. Please try again.")
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Record Inspection — ${label}`} onClose={onClose}>
      <div className="space-y-4 px-5 py-4">
        {err && (
          <p className="border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
            {err}
          </p>
        )}
        <Field
          label="Inspection Date"
          input={
            <input
              type="date"
              value={form.inspection_date}
              onChange={(e) =>
                setForm((p) => ({ ...p, inspection_date: e.target.value }))
              }
              className="w-full bg-ink-light px-3 py-2 text-sm text-paper outline-none focus:ring-1 focus:ring-signal/40"
            />
          }
        />
        <Field
          label="Inspector Name"
          input={
            <input
              type="text"
              placeholder="Full name"
              value={form.inspector_name}
              onChange={(e) =>
                setForm((p) => ({ ...p, inspector_name: e.target.value }))
              }
              className="w-full bg-ink-light px-3 py-2 text-sm text-paper outline-none placeholder:text-slate focus:ring-1 focus:ring-signal/40"
            />
          }
        />
        <Field
          label="Outcome"
          input={
            <select
              value={form.outcome}
              onChange={(e) =>
                setForm((p) => ({ ...p, outcome: e.target.value }))
              }
              className="w-full bg-ink-light px-3 py-2 text-sm text-paper outline-none focus:ring-1 focus:ring-signal/40"
            >
              <option value="pass">Pass</option>
              <option value="minor_defects">Minor Defects</option>
              <option value="major_defects">Major Defects</option>
              <option value="fail">Fail</option>
            </select>
          }
        />
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Engine Hours"
            input={
              <input
                type="number"
                placeholder="0"
                value={form.engine_hours}
                onChange={(e) =>
                  setForm((p) => ({ ...p, engine_hours: e.target.value }))
                }
                className="w-full bg-ink-light px-3 py-2 text-sm text-paper outline-none focus:ring-1 focus:ring-signal/40"
              />
            }
          />
          <Field
            label="Odometer (km)"
            input={
              <input
                type="number"
                placeholder="0"
                value={form.odometer_km}
                onChange={(e) =>
                  setForm((p) => ({ ...p, odometer_km: e.target.value }))
                }
                className="w-full bg-ink-light px-3 py-2 text-sm text-paper outline-none focus:ring-1 focus:ring-signal/40"
              />
            }
          />
        </div>
        <Field
          label="Notes"
          input={
            <textarea
              rows={3}
              placeholder="Inspection findings…"
              value={form.notes}
              onChange={(e) =>
                setForm((p) => ({ ...p, notes: e.target.value }))
              }
              className="w-full resize-none bg-ink-light px-3 py-2 text-sm text-paper outline-none placeholder:text-slate focus:ring-1 focus:ring-signal/40"
            />
          }
        />
      </div>
      <div className="flex justify-end gap-3 border-t border-ink-mid px-5 py-4">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 text-sm text-slate-light hover:text-paper"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={saving}
          className="inline-flex items-center gap-2 bg-signal px-4 py-2 text-sm font-semibold text-ink disabled:opacity-60"
        >
          {saving && <Loader2 size={14} className="animate-spin" />}
          Record Inspection
        </button>
      </div>
    </Modal>
  );
}

// ─── Defect modal ─────────────────────────────────────────────────────────────

function DefectModal({
  assetId,
  assetLabel: label,
  onClose,
  onSuccess,
}: {
  assetId: string;
  assetLabel: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [form, setForm] = useState({
    reported_date: new Date().toISOString().slice(0, 10),
    severity: "minor",
    description: "",
    reported_by: "",
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!form.description.trim()) {
      setErr("Description is required.");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      await recordAssetDefect(assetId, form);
      onSuccess();
    } catch (e) {
      setErr(
        e instanceof ApiError
          ? normalizeLoadError(e, "Failed to log defect. Please try again.")
          : normalizeLoadError(e, "Failed to log defect. Please try again.")
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Log Defect — ${label}`} onClose={onClose}>
      <div className="space-y-4 px-5 py-4">
        {err && (
          <p className="border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
            {err}
          </p>
        )}
        <Field
          label="Date Reported"
          input={
            <input
              type="date"
              value={form.reported_date}
              onChange={(e) =>
                setForm((p) => ({ ...p, reported_date: e.target.value }))
              }
              className="w-full bg-ink-light px-3 py-2 text-sm text-paper outline-none focus:ring-1 focus:ring-signal/40"
            />
          }
        />
        <Field
          label="Severity"
          input={
            <select
              value={form.severity}
              onChange={(e) =>
                setForm((p) => ({ ...p, severity: e.target.value }))
              }
              className="w-full bg-ink-light px-3 py-2 text-sm text-paper outline-none focus:ring-1 focus:ring-signal/40"
            >
              <option value="minor">Minor</option>
              <option value="moderate">Moderate</option>
              <option value="major">Major</option>
              <option value="critical">Critical</option>
            </select>
          }
        />
        <Field
          label="Reported By"
          input={
            <input
              type="text"
              placeholder="Name"
              value={form.reported_by}
              onChange={(e) =>
                setForm((p) => ({ ...p, reported_by: e.target.value }))
              }
              className="w-full bg-ink-light px-3 py-2 text-sm text-paper outline-none placeholder:text-slate focus:ring-1 focus:ring-signal/40"
            />
          }
        />
        <Field
          label="Description"
          input={
            <textarea
              rows={4}
              placeholder="Describe the defect…"
              value={form.description}
              onChange={(e) =>
                setForm((p) => ({ ...p, description: e.target.value }))
              }
              className="w-full resize-none bg-ink-light px-3 py-2 text-sm text-paper outline-none placeholder:text-slate focus:ring-1 focus:ring-signal/40"
            />
          }
        />
      </div>
      <div className="flex justify-end gap-3 border-t border-ink-mid px-5 py-4">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 text-sm text-slate-light hover:text-paper"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={saving}
          className="inline-flex items-center gap-2 bg-red-500 px-4 py-2 text-sm font-semibold text-paper disabled:opacity-60"
        >
          {saving && <Loader2 size={14} className="animate-spin" />}
          Log Defect
        </button>
      </div>
    </Modal>
  );
}

// ─── Meter reading modal ──────────────────────────────────────────────────────

function MeterModal({
  assetId,
  assetLabel: label,
  onClose,
  onSuccess,
}: {
  assetId: string;
  assetLabel: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [form, setForm] = useState({
    reading_date: new Date().toISOString().slice(0, 10),
    engine_hours: "",
    odometer_km: "",
    fuel_litres: "",
    recorded_by: "",
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!form.engine_hours && !form.odometer_km) {
      setErr("Enter at least one meter reading.");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      await recordAssetMeterReading(assetId, {
        ...form,
        engine_hours: form.engine_hours ? Number(form.engine_hours) : undefined,
        odometer_km: form.odometer_km ? Number(form.odometer_km) : undefined,
        fuel_litres: form.fuel_litres ? Number(form.fuel_litres) : undefined,
      });
      onSuccess();
    } catch (e) {
      setErr(
        e instanceof ApiError
          ? normalizeLoadError(e, "Failed to record meter reading. Please try again.")
          : normalizeLoadError(e, "Failed to record meter reading. Please try again.")
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Record Meter Reading — ${label}`} onClose={onClose}>
      <div className="space-y-4 px-5 py-4">
        {err && (
          <p className="border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
            {err}
          </p>
        )}
        <Field
          label="Reading Date"
          input={
            <input
              type="date"
              value={form.reading_date}
              onChange={(e) =>
                setForm((p) => ({ ...p, reading_date: e.target.value }))
              }
              className="w-full bg-ink-light px-3 py-2 text-sm text-paper outline-none focus:ring-1 focus:ring-signal/40"
            />
          }
        />
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Engine Hours"
            input={
              <input
                type="number"
                placeholder="0"
                value={form.engine_hours}
                onChange={(e) =>
                  setForm((p) => ({ ...p, engine_hours: e.target.value }))
                }
                className="w-full bg-ink-light px-3 py-2 text-sm text-paper outline-none focus:ring-1 focus:ring-signal/40"
              />
            }
          />
          <Field
            label="Odometer (km)"
            input={
              <input
                type="number"
                placeholder="0"
                value={form.odometer_km}
                onChange={(e) =>
                  setForm((p) => ({ ...p, odometer_km: e.target.value }))
                }
                className="w-full bg-ink-light px-3 py-2 text-sm text-paper outline-none focus:ring-1 focus:ring-signal/40"
              />
            }
          />
        </div>
        <Field
          label="Fuel Added (litres)"
          input={
            <input
              type="number"
              placeholder="0"
              value={form.fuel_litres}
              onChange={(e) =>
                setForm((p) => ({ ...p, fuel_litres: e.target.value }))
              }
              className="w-full bg-ink-light px-3 py-2 text-sm text-paper outline-none focus:ring-1 focus:ring-signal/40"
            />
          }
        />
        <Field
          label="Recorded By"
          input={
            <input
              type="text"
              placeholder="Name"
              value={form.recorded_by}
              onChange={(e) =>
                setForm((p) => ({ ...p, recorded_by: e.target.value }))
              }
              className="w-full bg-ink-light px-3 py-2 text-sm text-paper outline-none placeholder:text-slate focus:ring-1 focus:ring-signal/40"
            />
          }
        />
      </div>
      <div className="flex justify-end gap-3 border-t border-ink-mid px-5 py-4">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 text-sm text-slate-light hover:text-paper"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={saving}
          className="inline-flex items-center gap-2 bg-signal px-4 py-2 text-sm font-semibold text-ink disabled:opacity-60"
        >
          {saving && <Loader2 size={14} className="animate-spin" />}
          Save Reading
        </button>
      </div>
    </Modal>
  );
}

function Field({
  label,
  input,
}: {
  label: string;
  input: ReactNode;
}) {
  return (
    <div>
      <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-slate">
        {label}
      </p>
      {input}
    </div>
  );
}

// ─── Detail panel ─────────────────────────────────────────────────────────────

function DetailPanel({
  asset,
  onClose,
  onAction,
}: {
  asset: AssetRecord;
  onClose: () => void;
  onAction: (kind: ModalKind) => void;
}) {
  const [inspections, setInspections] = useState<InspectionRecord[]>([]);
  const [loadingInsp, setLoadingInsp] = useState(true);
  const [inspectionError, setInspectionError] = useState<string | null>(null);

  useEffect(() => {
    setLoadingInsp(true);
    setInspectionError(null);
    void getAssetInspections(asset.id)
      .then((res) =>
        setInspections(
          Array.isArray(res.data)
            ? (res.data as InspectionRecord[]).slice(0, 5)
            : []
        )
      )
      .catch((error) => {
        setInspections([]);
        setInspectionError(
          error instanceof ApiError && error.status === 403
            ? "You do not have permission to view inspection history."
            : normalizeLoadError(error, "Inspection history could not be loaded.")
        );
      })
      .finally(() => setLoadingInsp(false));
  }, [asset.id]);

  const engineHours = num(asset, "operating_hours", "engine_hours", "hours", "hour_meter");
  const odometer = num(asset, "odometer_km", "odometer", "km_reading");
  const monthlyCost = num(asset, "monthly_cost", "cost_per_month");
  const monthlyRevenue = num(asset, "monthly_revenue", "revenue_per_month");
  const netMargin =
    monthlyCost !== null && monthlyRevenue !== null
      ? monthlyRevenue - monthlyCost
      : null;
  const utilPct = num(asset, "utilization_pct", "utilization_percent") ?? 0;
  const fuelEfficiency = num(asset, "fuel_litres_per_hour", "fuel_efficiency");
  const activeDefects = num(asset, "active_defects_count", "defect_count") ?? 0;

  const lastInspOutcome = str(
    asset,
    "last_inspection_outcome",
    "inspection_outcome"
  );
  const nextService = strDate(
    asset,
    "next_service_due",
    "next_maintenance_at",
    "maintenance_due_date"
  );

  const labourCost = num(asset, "monthly_labour_cost", "operator_cost");
  const fuelCost = num(asset, "monthly_fuel_cost", "fuel_cost");
  const maintCost = num(asset, "monthly_maintenance_cost", "maintenance_cost");
  const ownCost = num(asset, "monthly_ownership_cost", "ownership_cost");

  return (
    <aside className="flex h-full flex-col border-l border-ink-mid bg-ink-light">
      {/* Panel header */}
      <div className="flex items-start justify-between border-b border-ink-mid p-5">
        <div className="min-w-0 flex-1 pr-3">
          <p className="font-mono text-[10px] uppercase tracking-widest text-slate">
            Asset Intelligence
          </p>
          <h2 className="mt-1 text-base font-semibold text-paper leading-tight">
            {assetLabel(asset)}
          </h2>
          <p className="mt-0.5 font-mono text-[11px] text-slate-light">
            {assetCode(asset)} ·{" "}
            {str(asset, "registration_number", "rego") || "No reg"}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 text-slate hover:text-paper"
        >
          <X size={18} />
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {/* Identity block */}
        <div className="border-b border-ink-mid px-5 py-4">
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
            <PanelKV
              label="Make / Model"
              value={
                [str(asset, "make"), str(asset, "model")]
                  .filter(Boolean)
                  .join(" ") || "Not recorded"
              }
            />
            <PanelKV
              label="Year"
              value={str(asset, "year", "manufacture_year") || "—"}
            />
            <PanelKV
              label="VIN / Serial"
              value={str(asset, "vin", "serial_number") || "Not recorded"}
            />
            <PanelKV
              label="Asset Type"
              value={assetType(asset)}
            />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <StatusBadge record={asset} />
            <OwnershipBadge record={asset} />
          </div>
        </div>

        {/* Assignment block */}
        <div className="border-b border-ink-mid px-5 py-4">
          <SectionHead icon={<Activity size={13} />} title="Current Assignment" />
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
            <PanelKV
              label="Project"
              value={
                str(asset, "project_name", "assigned_project") || "Unassigned"
              }
            />
            <PanelKV
              label="Site"
              value={str(asset, "site", "site_name", "location") || "Unallocated"}
            />
            <PanelKV
              label="Operator"
              value={
                str(asset, "operator_name", "operator", "assigned_to") ||
                "No operator"
              }
            />
          </div>
        </div>

        {/* Utilization + meters */}
        <div className="border-b border-ink-mid px-5 py-4">
          <SectionHead icon={<Gauge size={13} />} title="Utilization & Meters" />
          <div className="mt-4 flex items-center justify-between">
            <UtilGauge
              pct={utilPct}
              label="Utilization this month"
            />
            <div className="space-y-3 text-right">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-wider text-slate">
                  Engine Hours
                </p>
                <p className="mt-1 font-mono text-lg font-semibold text-paper">
                  {fmtNum(engineHours, " hr")}
                </p>
              </div>
              <div>
                <p className="font-mono text-[10px] uppercase tracking-wider text-slate">
                  Odometer
                </p>
                <p className="mt-1 font-mono text-lg font-semibold text-paper">
                  {fmtNum(odometer, " km")}
                </p>
              </div>
            </div>
          </div>
          {fuelEfficiency !== null && (
            <div className="mt-4 flex items-center gap-2 border border-ink-mid bg-ink px-3 py-2">
              <Fuel size={14} className="text-amber-400" />
              <span className="text-xs text-slate-light">Fuel efficiency:</span>
              <span className="font-mono text-xs font-semibold text-paper">
                {fuelEfficiency.toFixed(1)} L/hr
              </span>
            </div>
          )}
        </div>

        {/* Maintenance */}
        <div className="border-b border-ink-mid px-5 py-4">
          <SectionHead icon={<Wrench size={13} />} title="Maintenance Status" />
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
            <PanelKV
              label="Last Inspection"
              value={
                strDate(
                  asset,
                  "last_inspection_at",
                  "inspection_date",
                  "last_inspection_date"
                ) || "Not recorded"
              }
            />
            <PanelKV
              label="Outcome"
              value={lastInspOutcome || "—"}
            />
            <PanelKV
              label="Next Service Due"
              value={nextService || "Not scheduled"}
              tone={
                nextService &&
                Date.parse(str(asset, "next_service_due", "next_maintenance_at")) <
                  Date.now()
                  ? "text-red-300"
                  : undefined
              }
            />
            <PanelKV
              label="Active Defects"
              value={String(activeDefects)}
              tone={activeDefects > 0 ? "text-red-300" : "text-emerald-300"}
            />
          </div>
        </div>

        {/* Profitability */}
        <div className="border-b border-ink-mid px-5 py-4">
          <SectionHead icon={<Coins size={13} />} title="Monthly Profitability" />
          {monthlyCost !== null || monthlyRevenue !== null ? (
            <>
              <div className="mt-4">
                <MiniBarChart
                  revenue={monthlyRevenue ?? 0}
                  cost={monthlyCost ?? 0}
                />
              </div>
              <div className="mt-4 border-t border-ink-mid pt-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-slate">
                    Net Margin
                  </span>
                  <span
                    className={`font-mono text-sm font-bold ${marginClass(netMargin)}`}
                  >
                    {fmtCurrency(netMargin)}
                  </span>
                </div>
              </div>
              {/* Cost breakdown */}
              <div className="mt-3 space-y-1.5">
                {[
                  { label: "Labour / Operator", val: labourCost },
                  { label: "Fuel", val: fuelCost },
                  { label: "Maintenance", val: maintCost },
                  { label: "Ownership / Lease", val: ownCost },
                ]
                  .filter((r) => r.val !== null)
                  .map((r) => (
                    <div
                      key={r.label}
                      className="flex items-center justify-between"
                    >
                      <span className="text-[11px] text-slate-light">
                        {r.label}
                      </span>
                      <span className="font-mono text-[11px] text-slate">
                        {fmtCurrency(r.val)}
                      </span>
                    </div>
                  ))}
              </div>
            </>
          ) : (
            <p className="mt-3 text-xs text-slate-light">
              No cost or revenue data captured for this asset.
            </p>
          )}
        </div>

        {/* Recent inspections */}
        <div className="border-b border-ink-mid px-5 py-4">
          <SectionHead
            icon={<ClipboardCheck size={13} />}
            title="Recent Inspections"
          />
          {inspectionError && (
            <div className="mt-3 border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
              {inspectionError}
            </div>
          )}
          {loadingInsp ? (
            <div className="mt-3 space-y-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : inspections.length === 0 ? (
            <p className="mt-3 text-xs text-slate-light">
              No inspection records found.
            </p>
          ) : (
            <div className="mt-3 space-y-2">
              {inspections.map((insp) => {
                const outcome = str(
                  insp as unknown as AssetRecord,
                  "outcome",
                  "result",
                  "inspection_result"
                );
                const date = strDate(
                  insp as unknown as AssetRecord,
                  "inspection_date",
                  "created_at",
                  "date"
                );
                const pass =
                  outcome.toLowerCase().includes("pass") ||
                  outcome.toLowerCase() === "ok";
                return (
                  <div
                    key={insp.id}
                    className="flex items-center gap-3 border border-ink-mid bg-ink px-3 py-2"
                  >
                    <CheckCircle2
                      size={14}
                      className={
                        pass ? "text-emerald-400" : "text-amber-400"
                      }
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-medium text-paper capitalize">
                        {outcome || "Inspection"}
                      </p>
                      <p className="text-[10px] text-slate">{date}</p>
                    </div>
                    {str(
                      insp as unknown as AssetRecord,
                      "inspector_name",
                      "recorded_by"
                    ) && (
                      <p className="text-[10px] text-slate">
                        {str(
                          insp as unknown as AssetRecord,
                          "inspector_name",
                          "recorded_by"
                        )}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Documents */}
        <div className="px-5 py-4">
          <SectionHead icon={<FileText size={13} />} title="Linked Documents" />
          <p className="mt-3 text-xs text-slate-light">
            Document linking for assets is managed via the Documents module.
          </p>
        </div>
      </div>

      {/* Action buttons */}
      <div className="border-t border-ink-mid p-4">
        <div className="grid grid-cols-3 gap-2">
          <ActionBtn
            icon={<ClipboardCheck size={13} />}
            label="Inspection"
            onClick={() => onAction("inspection")}
          />
          <ActionBtn
            icon={<AlertTriangle size={13} />}
            label="Log Defect"
            onClick={() => onAction("defect")}
            danger
          />
          <ActionBtn
            icon={<Gauge size={13} />}
            label="Meter"
            onClick={() => onAction("meter")}
          />
        </div>
      </div>
    </aside>
  );
}

function SectionHead({
  icon,
  title,
}: {
  icon: ReactNode;
  title: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-signal">{icon}</span>
      <h3 className="font-mono text-[10px] uppercase tracking-wider text-slate">
        {title}
      </h3>
    </div>
  );
}

function PanelKV({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-wider text-slate">
        {label}
      </p>
      <p className={`mt-1 text-xs font-medium ${tone ?? "text-paper"}`}>
        {value}
      </p>
    </div>
  );
}

function ActionBtn({
  icon,
  label,
  onClick,
  danger = false,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-center gap-1 border px-2 py-2.5 text-center text-[10px] font-medium uppercase tracking-wider transition-colors ${
        danger
          ? "border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20"
          : "border-ink-mid bg-ink text-slate-light hover:border-signal/40 hover:text-paper"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function Toast({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 4000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  return (
    <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 shadow-2xl">
      <CheckCircle2 size={16} className="text-emerald-400" />
      <span className="text-sm text-paper">{message}</span>
      <button type="button" onClick={onDismiss} className="text-slate hover:text-paper">
        <X size={14} />
      </button>
    </div>
  );
}

// ─── Main dashboard ───────────────────────────────────────────────────────────

export default function EquipmentPage() {
  return (
    <RBACGuard allowedRoles={["Executive (Admin)", "Fleet Supervisor", "Equipment Manager", "Site Manager"]}>
      <EquipmentDashboard />
    </RBACGuard>
  );
}

function EquipmentDashboard() {
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // Filters
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [ownershipFilter, setOwnershipFilter] = useState("all");
  const [projectFilter, setProjectFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("");

  // Selection
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Modal
  const [modal, setModal] = useState<ModalKind>(null);
  const [toast, setToast] = useState<string | null>(null);

  const panelRef = useRef<HTMLDivElement>(null);

  const loadAssets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getEquipmentAssets();
      const list = Array.isArray(res.data)
        ? (res.data as AssetRecord[]).filter((r) => Boolean(r?.id))
        : [];
      setAssets(list);
      setSelectedId((cur) =>
        list.some((a) => a.id === cur) ? cur : list[0]?.id ?? null
      );
      setLastUpdated(new Date());
    } catch (e) {
      setAssets([]);
      setSelectedId(null);
      setError(
        e instanceof ApiError && e.status === 403
          ? "You do not have permission to access the equipment register."
          : normalizeLoadError(e, "Equipment assets could not be loaded. Verify the API connection and try again.")
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAssets();
  }, [loadAssets]);

  // Derived filter options
  const statuses = useMemo(
    () =>
      Array.from(new Set(assets.map(normalStatus).filter(Boolean))).sort(),
    [assets]
  );
  const ownerships = useMemo(
    () =>
      Array.from(
        new Set(assets.map((a) => ownershipType(a).toLowerCase()).filter(Boolean))
      ).sort(),
    [assets]
  );
  const projects = useMemo(
    () =>
      Array.from(
        new Set(
          assets
            .map((a) => str(a, "project_name", "assigned_project"))
            .filter(Boolean)
        )
      ).sort(),
    [assets]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return assets.filter((a) => {
      const searchable = [
        assetLabel(a),
        assetCode(a),
        assetType(a),
        str(a, "registration_number", "rego"),
        str(a, "make"),
        str(a, "model"),
        str(a, "project_name", "assigned_project"),
        str(a, "site", "location"),
        str(a, "operator_name", "operator"),
      ]
        .join(" ")
        .toLowerCase();
      if (q && !searchable.includes(q)) return false;
      if (statusFilter !== "all" && normalStatus(a) !== statusFilter)
        return false;
      if (
        ownershipFilter !== "all" &&
        ownershipType(a).toLowerCase() !== ownershipFilter
      )
        return false;
      if (
        projectFilter !== "all" &&
        str(a, "project_name", "assigned_project") !== projectFilter
      )
        return false;
      if (
        typeFilter &&
        !assetType(a).toLowerCase().includes(typeFilter.toLowerCase())
      )
        return false;
      return true;
    });
  }, [assets, query, statusFilter, ownershipFilter, projectFilter, typeFilter]);

  const selected = assets.find((a) => a.id === selectedId) ?? null;

  // ── Metrics ──
  const metrics = useMemo(() => {
    const total = assets.length;
    const operating = assets.filter((a) =>
      ["in_service", "assigned"].includes(normalStatus(a))
    ).length;
    const idle = assets.filter((a) => normalStatus(a) === "available").length;
    const maintenance = assets.filter((a) =>
      normalStatus(a) === "out_of_service"
    ).length;
    const withRevenue = assets.filter(
      (a) => (num(a, "monthly_revenue", "revenue_per_month") ?? 0) > 0
    ).length;
    const totalUtil =
      assets.reduce(
        (s, a) => s + (num(a, "utilization_pct", "utilization_percent") ?? 0),
        0
      ) / Math.max(assets.length, 1);
    return { total, operating, idle, maintenance, withRevenue, totalUtil };
  }, [assets]);

  function handleAction(kind: ModalKind) {
    setModal(kind);
  }

  function handleModalSuccess() {
    setModal(null);
    const label = modal === "inspection"
      ? "Inspection recorded"
      : modal === "defect"
        ? "Defect logged"
        : "Meter reading saved";
    setToast(`${label} successfully.`);
    void loadAssets();
  }

  return (
    <main className="flex min-h-screen flex-col bg-ink text-paper">
      {/* Header */}
      <header className="border-b border-ink-mid px-6 py-5">
        <div className="mx-auto max-w-[1800px]">
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
            <div>
              <div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-slate">
                <Cpu size={13} />
                Operations / Equipment Intelligence
              </div>
              <h1 className="text-2xl font-semibold tracking-wide text-paper">
                Equipment Intelligence
              </h1>
              <p className="mt-1 text-sm text-slate-light">
                Asset profitability, utilization, and maintenance command center
                for the full equipment register.
              </p>
            </div>
            <div className="flex items-center gap-3">
              {lastUpdated && (
                <span className="font-mono text-[10px] uppercase tracking-wider text-slate">
                  Updated {lastUpdated.toLocaleTimeString()}
                </span>
              )}
              <button
                type="button"
                onClick={() => void loadAssets()}
                disabled={loading}
                className="inline-flex items-center gap-2 border border-ink-mid bg-ink-light px-3 py-2 text-xs font-medium text-paper hover:border-slate disabled:opacity-50"
              >
                <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
                Refresh
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-[1800px] flex-1 px-6 py-6">
        {/* Error */}
        {error && (
          <div className="mb-5 flex items-start gap-3 border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-100">
            <ShieldAlert size={18} className="mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold">Equipment register unavailable</p>
              <p className="mt-1 text-red-100/80">{error}</p>
            </div>
          </div>
        )}

        {/* Command strip */}
        {!loading && !error && assets.length > 0 && (
          <section className="mb-6 grid gap-px overflow-hidden border border-ink-mid bg-ink-mid sm:grid-cols-2 lg:grid-cols-6">
            <MetricTile
              icon={<Cpu size={16} />}
              label="Total Assets"
              value={metrics.total}
            />
            <MetricTile
              icon={<Zap size={16} />}
              label="Operating Today"
              value={metrics.operating}
              tone="text-blue-300"
            />
            <MetricTile
              icon={<MoreHorizontal size={16} />}
              label="Idle Assets"
              value={metrics.idle}
              tone="text-amber-200"
            />
            <MetricTile
              icon={<Wrench size={16} />}
              label="In Maintenance"
              value={metrics.maintenance}
              tone={metrics.maintenance > 0 ? "text-red-300" : "text-slate-light"}
            />
            <MetricTile
              icon={<BarChart2 size={16} />}
              label="Fleet Utilization"
              value={`${metrics.totalUtil.toFixed(0)}%`}
              tone={
                metrics.totalUtil >= 70
                  ? "text-emerald-300"
                  : metrics.totalUtil >= 40
                    ? "text-signal"
                    : "text-amber-300"
              }
            />
            <MetricTile
              icon={<Coins size={16} />}
              label="Revenue Generating"
              value={metrics.withRevenue}
              tone="text-emerald-300"
              sub={`of ${metrics.total} assets`}
            />
          </section>
        )}

        {/* Loading */}
        {loading ? (
          <div className="border border-ink-mid bg-ink">
            <div className="border-b border-ink-mid px-4 py-3">
              <Skeleton className="h-4 w-40" />
            </div>
            <TableSkeleton />
          </div>
        ) : !error && assets.length === 0 ? (
          <EmptyState />
        ) : !error ? (
          // Main layout: table + detail panel
          <div
            className={`grid gap-6 transition-all duration-300 ${
              selected
                ? "xl:grid-cols-[minmax(0,1fr)_420px]"
                : "xl:grid-cols-1"
            }`}
          >
            {/* Asset register table */}
            <section className="border border-ink-mid bg-ink">
              {/* Filter bar */}
              <div className="flex flex-col gap-3 border-b border-ink-mid p-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-paper">
                    Asset Register
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-light">
                    {filtered.length} of {assets.length} assets shown
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {/* Search */}
                  <label className="flex items-center gap-2 border border-ink-mid bg-ink-light px-3 py-2">
                    <Search size={13} className="text-slate" />
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search assets…"
                      className="w-36 bg-transparent text-xs text-paper outline-none placeholder:text-slate"
                    />
                  </label>
                  {/* Status filter */}
                  <label className="flex items-center gap-2 border border-ink-mid bg-ink-light px-3 py-2">
                    <Filter size={13} className="text-slate" />
                    <select
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value)}
                      className="bg-transparent text-xs text-paper outline-none"
                    >
                      <option value="all">All statuses</option>
                      {statuses.map((s) => (
                        <option key={s} value={s}>
                          {s.replace(/_/g, " ")}
                        </option>
                      ))}
                    </select>
                  </label>
                  {/* Ownership filter */}
                  <label className="flex items-center gap-2 border border-ink-mid bg-ink-light px-3 py-2">
                    <select
                      value={ownershipFilter}
                      onChange={(e) => setOwnershipFilter(e.target.value)}
                      className="bg-transparent text-xs text-paper outline-none"
                    >
                      <option value="all">All ownership</option>
                      {ownerships.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  </label>
                  {/* Project filter */}
                  {projects.length > 0 && (
                    <label className="flex items-center gap-2 border border-ink-mid bg-ink-light px-3 py-2">
                      <select
                        value={projectFilter}
                        onChange={(e) => setProjectFilter(e.target.value)}
                        className="bg-transparent text-xs text-paper outline-none"
                      >
                        <option value="all">All projects</option>
                        {projects.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {/* Type text filter */}
                  <label className="flex items-center gap-2 border border-ink-mid bg-ink-light px-3 py-2">
                    <input
                      value={typeFilter}
                      onChange={(e) => setTypeFilter(e.target.value)}
                      placeholder="Filter type…"
                      className="w-28 bg-transparent text-xs text-paper outline-none placeholder:text-slate"
                    />
                  </label>
                </div>
              </div>

              {filtered.length === 0 ? (
                <div className="p-10 text-center text-sm text-slate-light">
                  No assets match the current filters.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left">
                    <thead className="border-b border-ink-mid bg-ink-light font-mono text-[10px] uppercase tracking-wider text-slate">
                      <tr>
                        <th className="px-4 py-3 font-normal">
                          Asset / Registration / Type
                        </th>
                        <th className="px-4 py-3 font-normal">
                          Site / Project
                        </th>
                        <th className="px-4 py-3 font-normal">Operator</th>
                        <th className="px-4 py-3 font-normal">Status</th>
                        <th className="px-4 py-3 font-normal">Ownership</th>
                        <th className="px-4 py-3 font-normal text-right">
                          Eng. Hrs
                        </th>
                        <th className="px-4 py-3 font-normal text-right">
                          Odo (km)
                        </th>
                        <th className="px-4 py-3 font-normal">Next Service</th>
                        <th className="px-4 py-3 font-normal text-center">
                          Defects
                        </th>
                        <th className="px-4 py-3 font-normal text-right">
                          Cost / Rev / Margin
                        </th>
                        <th className="px-4 py-3" />
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((asset) => {
                        const cost = num(asset, "monthly_cost", "cost_per_month");
                        const rev = num(asset, "monthly_revenue", "revenue_per_month");
                        const margin =
                          cost !== null && rev !== null ? rev - cost : null;
                        const defects =
                          num(asset, "active_defects_count", "defect_count") ?? 0;
                        const nextSvc = strDate(
                          asset,
                          "next_service_due",
                          "next_maintenance_at",
                          "maintenance_due_date"
                        );
                        const svcOverdue =
                          nextSvc &&
                          msDate(
                            asset,
                            "next_service_due",
                            "next_maintenance_at"
                          )! < Date.now();
                        const isSelected = asset.id === selectedId;

                        return (
                          <tr
                            key={asset.id}
                            onClick={() => setSelectedId(asset.id)}
                            className={`cursor-pointer border-b border-ink-mid/60 text-sm transition-colors hover:bg-ink-light ${
                              isSelected
                                ? "bg-ink-light border-l-2 border-l-signal"
                                : ""
                            }`}
                          >
                            {/* Asset identity */}
                            <td className="px-4 py-3">
                              <p className="font-medium text-paper">
                                {assetCode(asset)}
                              </p>
                              <p className="mt-0.5 text-[11px] text-slate-light">
                                {str(asset, "registration_number", "rego") ||
                                  "No reg"}
                              </p>
                              <p className="mt-0.5 font-mono text-[10px] text-slate">
                                {assetType(asset)}
                              </p>
                            </td>
                            {/* Site / Project */}
                            <td className="px-4 py-3 text-xs text-slate-light">
                              <p>
                                {str(
                                  asset,
                                  "project_name",
                                  "assigned_project"
                                ) || "Unassigned"}
                              </p>
                              <p className="mt-0.5 text-slate">
                                {str(asset, "site", "site_name", "location") ||
                                  "—"}
                              </p>
                            </td>
                            {/* Operator */}
                            <td className="px-4 py-3 text-xs text-slate-light">
                              {str(
                                asset,
                                "operator_name",
                                "operator",
                                "assigned_to"
                              ) || "—"}
                            </td>
                            {/* Status */}
                            <td className="px-4 py-3">
                              <StatusBadge record={asset} />
                            </td>
                            {/* Ownership */}
                            <td className="px-4 py-3">
                              <OwnershipBadge record={asset} />
                            </td>
                            {/* Engine hours */}
                            <td className="px-4 py-3 text-right font-mono text-xs text-paper">
                              {fmtNum(
                                num(
                                  asset,
                                  "operating_hours",
                                  "engine_hours",
                                  "hours",
                                  "hour_meter"
                                )
                              )}
                            </td>
                            {/* Odometer */}
                            <td className="px-4 py-3 text-right font-mono text-xs text-paper">
                              {fmtNum(
                                num(asset, "odometer_km", "odometer", "km_reading")
                              )}
                            </td>
                            {/* Next service */}
                            <td className="px-4 py-3 text-xs">
                              <span
                                className={
                                  svcOverdue
                                    ? "text-red-300"
                                    : nextSvc
                                      ? "text-slate-light"
                                      : "text-slate"
                                }
                              >
                                {nextSvc || "—"}
                              </span>
                            </td>
                            {/* Defects */}
                            <td className="px-4 py-3 text-center">
                              {defects > 0 ? (
                                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-red-500/20 font-mono text-[10px] text-red-300">
                                  {defects}
                                </span>
                              ) : (
                                <span className="text-slate">—</span>
                              )}
                            </td>
                            {/* Cost / Rev / Margin */}
                            <td className="px-4 py-3 text-right">
                              <div className="space-y-0.5">
                                <p className="font-mono text-[10px] text-slate">
                                  Cost:{" "}
                                  <span className="text-red-300">
                                    {fmtCurrency(cost)}
                                  </span>
                                </p>
                                <p className="font-mono text-[10px] text-slate">
                                  Rev:{" "}
                                  <span className="text-emerald-300">
                                    {fmtCurrency(rev)}
                                  </span>
                                </p>
                                <p
                                  className={`font-mono text-[11px] font-semibold ${marginClass(margin)}`}
                                >
                                  {fmtCurrency(margin)}
                                </p>
                              </div>
                            </td>
                            {/* Chevron */}
                            <td className="px-3 py-3 text-slate">
                              <ChevronRight size={15} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Detail panel */}
            {selected && (
              <div ref={panelRef} className="sticky top-0 h-fit max-h-[calc(100vh-140px)] overflow-hidden rounded-none border border-ink-mid">
                <DetailPanel
                  asset={selected}
                  onClose={() => setSelectedId(null)}
                  onAction={handleAction}
                />
              </div>
            )}
          </div>
        ) : null}
      </div>

      {/* Modals */}
      {modal === "inspection" && selected && (
        <InspectionModal
          assetId={selected.id}
          assetLabel={assetLabel(selected)}
          onClose={() => setModal(null)}
          onSuccess={handleModalSuccess}
        />
      )}
      {modal === "defect" && selected && (
        <DefectModal
          assetId={selected.id}
          assetLabel={assetLabel(selected)}
          onClose={() => setModal(null)}
          onSuccess={handleModalSuccess}
        />
      )}
      {modal === "meter" && selected && (
        <MeterModal
          assetId={selected.id}
          assetLabel={assetLabel(selected)}
          onClose={() => setModal(null)}
          onSuccess={handleModalSuccess}
        />
      )}

      {/* Toast */}
      {toast && (
        <Toast message={toast} onDismiss={() => setToast(null)} />
      )}
    </main>
  );
}
