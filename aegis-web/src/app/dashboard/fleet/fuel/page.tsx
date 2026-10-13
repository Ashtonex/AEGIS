"use client";

import { useMemo, useState } from "react";
import { RBACGuard } from "@/components/auth/RBACGuard";
import { DashboardPageHeader } from "@/components/dashboard/DashboardPageHeader";
import {
  ApiError,
  getFleet,
  getFleetFuelTransactions,
  recordFleetFuel,
} from "@/lib/api";
import { useApiQueries } from "@/hooks/useApiQueries";
import { useLiveTable } from "@/lib/live/LiveDataProvider";
import { OperationalTable, TableHeader, TableRow, TableHead, TableCell } from "@/components/ui/OperationalTable";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  AlertTriangle,
  CheckCircle2,
  Droplet,
  Fuel,
  Gauge,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Truck,
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
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(amount);
}

export default function FuelConsumablesPage() {
  return (
    <RBACGuard permission="fleet.fuel.record">
      <FuelConsumablesDashboard />
    </RBACGuard>
  );
}

function FuelConsumablesDashboard() {
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const { data, isLoading, refetch } = useApiQueries(
    {
      fuel: () => getFleetFuelTransactions({ limit: 150 }),
      fleet: () => getFleet(),
    },
    [],
    { criticalKeys: ["fuel"] }
  );

  useLiveTable("fleet.fuel_transactions", () => void refetch());

  const fuelRecords = useMemo(
    () => (Array.isArray(data.fuel?.data) ? data.fuel.data.filter((item): item is RecordItem => Boolean(item && typeof item === "object" && item.id)) : []),
    [data.fuel]
  );

  const fleetAssets = useMemo(
    () => (Array.isArray(data.fleet?.data) ? data.fleet.data.filter((item): item is RecordItem => Boolean(item && typeof item === "object" && item.id)) : []),
    [data.fleet]
  );

  const filtered = useMemo(() => {
    return fuelRecords.filter((f) => {
      const matchSearch = [
        text(f, "asset_code"),
        text(f, "vehicle_registration"),
        text(f, "receipt_reference"),
        text(f, "supplier_name"),
        text(f, "storage_tank"),
        text(f, "project_name"),
      ]
        .join(" ")
        .toLowerCase();
      return matchSearch.includes(query.toLowerCase());
    });
  }, [fuelRecords, query]);

  const kpis = useMemo(() => {
    const totalLitres = fuelRecords.reduce((sum, f) => sum + (Number(f.quantity_litres) || 0), 0);
    const totalSpend = fuelRecords.reduce((sum, f) => sum + (Number(f.total_cost) || 0), 0);
    const highVarianceIssues = fuelRecords.filter((f) => Number(f.variance_litres ?? 0) > 20).length;
    const avgBurn = totalLitres && fuelRecords.length ? totalLitres / fuelRecords.length : 0;
    return { totalLitres, totalSpend, highVarianceIssues, avgBurn };
  }, [fuelRecords]);

  return (
    <main className="min-h-screen bg-ink p-4 text-paper md:p-7">
      <div className="mx-auto max-w-[1600px]">
        <DashboardPageHeader
          eyebrow={{ label: "Assets / Plant & Equipment", icon: Truck }}
          title="Fuel & Consumables"
          subtitle="Bulk fuel storage tanks, mobile bowser dispensations, L/hour burn rates, and variance reconciliation."
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
                <Plus size={14} /> Record Fuel Issue
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
            <span className="font-mono text-[10px] uppercase text-slate">Total Fuel Issued</span>
            <p className="mt-2 text-2xl font-bold text-amber-300">{kpis.totalLitres.toLocaleString()} L</p>
          </div>
          <div className="bg-ink p-4">
            <span className="font-mono text-[10px] uppercase text-slate">Fuel Spend (USD)</span>
            <p className="mt-2 text-2xl font-bold text-emerald-300">{fmtMoney(kpis.totalSpend)}</p>
          </div>
          <div className="bg-ink p-4">
            <span className="font-mono text-[10px] uppercase text-slate">Consumption Anomalies</span>
            <p className="mt-2 text-2xl font-bold text-rose-400">{kpis.highVarianceIssues}</p>
          </div>
          <div className="bg-ink p-4">
            <span className="font-mono text-[10px] uppercase text-slate">Avg Dispensation Size</span>
            <p className="mt-2 text-2xl font-bold text-blue-300">{kpis.avgBurn.toFixed(0)} L</p>
          </div>
        </section>

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 text-slate" size={14} />
            <input
              type="text"
              placeholder="Search slip, machine, bowser, supplier..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-72 border border-ink-mid bg-ink-light py-2 pl-9 pr-3 text-xs text-paper placeholder-slate focus:border-signal focus:outline-none"
            />
          </div>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            icon={Fuel}
            title="No fuel transactions recorded"
            description="Capture fuel issues from bulk storage or mobile bowsers linked to hour meters and project cost codes."
          />
        ) : (
          <div className="border border-ink-mid bg-ink overflow-x-auto">
            <OperationalTable className="min-w-[1150px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Date / Slip Ref</TableHead>
                  <TableHead>Asset</TableHead>
                  <TableHead>Volume (Litres)</TableHead>
                  <TableHead>Unit / Total Cost</TableHead>
                  <TableHead>Meter at Intake</TableHead>
                  <TableHead>Source / Bowser</TableHead>
                  <TableHead>Project / Cost Centre</TableHead>
                  <TableHead>L/hr Index</TableHead>
                </TableRow>
              </TableHeader>
              <tbody>
                {filtered.map((f) => {
                  const lph = Number(f.litres_per_hour ?? 0);
                  const variance = Number(f.variance_litres ?? 0);
                  return (
                    <TableRow key={f.id}>
                      <TableCell>
                        <p className="font-semibold text-paper">{text(f, "receipt_reference") || f.id.slice(0, 8)}</p>
                        <p className="text-[11px] text-slate-light">{f.transaction_at ? fmtDate(String(f.transaction_at)) : "—"}</p>
                      </TableCell>
                      <TableCell>
                        <p className="font-medium text-paper">{text(f, "asset_code", "vehicle_registration")}</p>
                        <p className="text-[11px] text-slate-light capitalize">{text(f, "asset_category") || "Fleet"}</p>
                      </TableCell>
                      <TableCell>
                        <p className="font-mono text-sm font-semibold text-amber-300">{Number(f.quantity_litres).toFixed(1)} L</p>
                        <p className="text-[11px] text-slate-light">{text(f, "fuel_type") || "Diesel 50ppm"}</p>
                      </TableCell>
                      <TableCell>
                        <p className="text-xs text-paper">{fmtMoney(Number(f.total_cost))}</p>
                        <p className="text-[11px] text-slate-light">@{fmtMoney(Number(f.unit_cost))}/L</p>
                      </TableCell>
                      <TableCell>
                        <p className="font-mono text-xs text-paper">{f.odometer_km ? `${Number(f.odometer_km).toFixed(0)} km` : "—"}</p>
                      </TableCell>
                      <TableCell>
                        <p className="text-xs text-paper">{text(f, "storage_tank", "supplier_name") || "Mobile Bowser"}</p>
                        {Boolean(f.tank_balance_after) && <p className="text-[11px] text-slate-light">Bal: {Number(f.tank_balance_after)}L</p>}
                      </TableCell>
                      <TableCell>
                        <p className="text-xs text-paper">{text(f, "project_name") || "Operations Yard"}</p>
                        <p className="text-[11px] text-slate-light">{text(f, "cost_centre") || "WIP"}</p>
                      </TableCell>
                      <TableCell>
                        {lph > 0 ? (
                          <span className={`font-mono text-xs ${lph > 35 ? "text-rose-400 font-semibold" : "text-emerald-300"}`}>
                            {lph.toFixed(1)} L/hr
                          </span>
                        ) : (
                          <span className="text-slate text-xs">—</span>
                        )}
                        {variance > 15 && <p className="text-[10px] text-rose-300">+{variance.toFixed(0)}L var</p>}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </tbody>
            </OperationalTable>
          </div>
        )}

        {/* Modal: Record Fuel Issue */}
        {modalOpen && (
          <RecordFuelModal
            fleetAssets={fleetAssets}
            onClose={() => setModalOpen(false)}
            onSuccess={() => {
              setModalOpen(false);
              setNotice("Fuel transaction recorded and cost allocated.");
              void refetch();
            }}
          />
        )}
      </div>
    </main>
  );
}

function RecordFuelModal({
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
    fuel_type: "diesel_50ppm",
    quantity_litres: 150,
    unit_cost: 1.45,
    storage_tank: "Bowser-01 (Harare Yard)",
    receipt_reference: `FS-${Date.now().toString().slice(-6)}`,
    odometer_km: 0,
    supplier_name: "TotalEnergies",
    cost_centre: "Site Equipment WIP",
  });
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.fleet_id) {
      setErr("Please select a machine.");
      return;
    }
    setSubmitting(true);
    setErr(null);
    try {
      await recordFleetFuel({
        fleet_id: formData.fleet_id,
        fuel_type: formData.fuel_type,
        quantity_litres: Number(formData.quantity_litres),
        unit_cost: Number(formData.unit_cost),
        total_cost: Number(formData.quantity_litres) * Number(formData.unit_cost),
        storage_tank: formData.storage_tank,
        receipt_reference: formData.receipt_reference,
        odometer_km: Number(formData.odometer_km || 0),
        supplier_name: formData.supplier_name,
        cost_centre: formData.cost_centre,
      });
      onSuccess();
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : "Failed to record fuel issue.");
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-4 backdrop-blur-sm">
      <div className="relative w-full max-w-md border border-ink-mid bg-ink shadow-2xl">
        <div className="flex items-center justify-between border-b border-ink-mid px-5 py-4">
          <h2 className="text-sm font-semibold text-paper">Record Fuel Dispensation Slip</h2>
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
              <label className="block text-[11px] font-mono uppercase text-slate mb-1">Quantity (Litres)</label>
              <input
                type="number"
                step="0.1"
                value={formData.quantity_litres}
                onChange={(e) => setFormData({ ...formData, quantity_litres: Number(e.target.value) })}
                className="w-full border border-ink-mid bg-ink-light px-3 py-2 text-xs text-paper"
                required
              />
            </div>
            <div>
              <label className="block text-[11px] font-mono uppercase text-slate mb-1">Unit Price (USD/L)</label>
              <input
                type="number"
                step="0.01"
                value={formData.unit_cost}
                onChange={(e) => setFormData({ ...formData, unit_cost: Number(e.target.value) })}
                className="w-full border border-ink-mid bg-ink-light px-3 py-2 text-xs text-paper"
                required
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-mono uppercase text-slate mb-1">Source Tank / Bowser</label>
              <input
                type="text"
                value={formData.storage_tank}
                onChange={(e) => setFormData({ ...formData, storage_tank: e.target.value })}
                className="w-full border border-ink-mid bg-ink-light px-3 py-2 text-xs text-paper"
                required
              />
            </div>
            <div>
              <label className="block text-[11px] font-mono uppercase text-slate mb-1">Slip / Ref Number</label>
              <input
                type="text"
                value={formData.receipt_reference}
                onChange={(e) => setFormData({ ...formData, receipt_reference: e.target.value })}
                className="w-full border border-ink-mid bg-ink-light px-3 py-2 text-xs text-paper"
                required
              />
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-mono uppercase text-slate mb-1">Odometer / Hour Meter at Intake</label>
            <input
              type="number"
              value={formData.odometer_km}
              onChange={(e) => setFormData({ ...formData, odometer_km: Number(e.target.value) })}
              className="w-full border border-ink-mid bg-ink-light px-3 py-2 text-xs text-paper"
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
              {submitting ? "Recording..." : "Save Fuel Slip"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
