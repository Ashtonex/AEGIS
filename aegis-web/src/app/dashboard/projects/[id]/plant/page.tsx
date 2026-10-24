"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useParams } from "next/navigation";
import {
  Truck,
  Gauge,
  Fuel,
  Clock,
  AlertTriangle,
  Plus,
  Loader2,
  RefreshCw,
  TrendingUp,
  Activity,
  Layers,
  CheckCircle2,
  Calendar,
  X,
  FileSpreadsheet,
} from "lucide-react";
import {
  getProjectPlantAnalytics,
  recordProjectPlantShiftLog,
  type ProjectPlantAnalytics,
  type ProjectPlantAsset,
} from "@/lib/api/projects";
import { formatCurrency, formatDate } from "@/lib/utils";

export default function ProjectPlantPage() {
  const params = useParams();
  const projectId = typeof params?.id === "string" ? params.id : "";

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<ProjectPlantAnalytics | null>(null);
  const [filterOwnership, setFilterOwnership] = useState<"all" | "owned" | "hired">("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Modal State
  const [isLogModalOpen, setIsLogModalOpen] = useState(false);
  const [selectedFleetId, setSelectedFleetId] = useState("");
  const [logDate, setLogDate] = useState(new Date().toISOString().split("T")[0]);
  const [opHours, setOpHours] = useState("");
  const [idleHours, setIdleHours] = useState("");
  const [breakdownHours, setBreakdownHours] = useState("");
  const [fuelLitres, setFuelLitres] = useState("");
  const [outputQty, setOutputQty] = useState("");
  const [outputUnit, setOutputUnit] = useState("m3");
  const [workPerformed, setWorkPerformed] = useState("");
  const [submittingLog, setSubmittingLog] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const loadData = async () => {
    try {
      const res = await getProjectPlantAnalytics(projectId);
      if (res.data) {
        setData(res.data);
      }
    } catch (err) {
      console.error("Failed to load project plant analytics", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (projectId) {
      void loadData();
    }
  }, [projectId]);

  const filteredAssets = useMemo(() => {
    if (!data?.plant_inventory) return [];
    return data.plant_inventory.filter((asset) => {
      const matchesOwnership =
        filterOwnership === "all" ||
        (filterOwnership === "owned" && asset.ownership_type.toLowerCase() === "owned") ||
        (filterOwnership === "hired" && asset.ownership_type.toLowerCase() !== "owned");

      const query = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !query ||
        asset.asset_code.toLowerCase().includes(query) ||
        (asset.make && asset.make.toLowerCase().includes(query)) ||
        (asset.model && asset.model.toLowerCase().includes(query)) ||
        asset.asset_category.toLowerCase().includes(query);

      return matchesOwnership && matchesSearch;
    });
  }, [data, filterOwnership, searchQuery]);

  const handleOpenLogModal = (fleetId?: string) => {
    if (fleetId) {
      setSelectedFleetId(fleetId);
    } else if (data?.plant_inventory.length) {
      setSelectedFleetId(data.plant_inventory[0].fleet_id);
    }
    setOpHours("");
    setIdleHours("");
    setBreakdownHours("");
    setFuelLitres("");
    setOutputQty("");
    setWorkPerformed("");
    setIsLogModalOpen(true);
  };

  const handleSubmitShiftLog = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFleetId || (!opHours && !fuelLitres && !breakdownHours)) return;
    setSubmittingLog(true);
    setActionMessage(null);
    try {
      await recordProjectPlantShiftLog(projectId, {
        fleet_id: selectedFleetId,
        occurred_on: logDate,
        operating_hours: Number(opHours) || 0,
        idle_hours: Number(idleHours) || 0,
        breakdown_downtime_hours: Number(breakdownHours) || 0,
        fuel_litres: Number(fuelLitres) || 0,
        output_quantity: outputQty ? Number(outputQty) : undefined,
        output_unit: outputUnit || undefined,
        work_performed: workPerformed.trim() || undefined,
      });
      setIsLogModalOpen(false);
      setActionMessage("Plant shift log & fuel recorded successfully.");
      await loadData();
    } catch (err: any) {
      setActionMessage(err?.message || "Failed to submit plant shift log.");
    } finally {
      setSubmittingLog(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-72 items-center justify-center gap-3 text-slate-light font-mono text-sm">
        <Loader2 className="h-5 w-5 animate-spin text-signal" />
        Aggregating project plant allocations, utilization &amp; fuel burn rates...
      </div>
    );
  }

  const kpis = data?.kpis || {
    total_assigned_assets: 0,
    owned_assets_count: 0,
    hired_assets_count: 0,
    total_operating_hours: 0,
    total_idle_hours: 0,
    total_breakdown_hours: 0,
    total_weather_downtime_hours: 0,
    overall_utilization_rate: 0,
    total_fuel_consumed_litres: 0,
    total_fuel_cost: 0,
    average_burn_rate: 0,
    total_plant_operating_cost: 0,
  };

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Truck className="h-6 w-6 text-signal" />
            <h2 className="font-display text-xl font-bold text-paper sm:text-2xl">
              Project Plant Allocation &amp; Fuel Telemetry
            </h2>
          </div>
          <p className="mt-1 text-xs text-slate-light">
            Real-time equipment utilization rates, downtime root causes, fuel burn rate reconciliation against benchmark, and output productivity.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void loadData()}
            className="inline-flex items-center gap-1.5 border border-ink-mid bg-ink px-3 py-1.5 font-mono text-xs text-slate-light hover:text-paper hover:border-slate"
            title="Refresh plant data"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Refresh</span>
          </button>
          <button
            type="button"
            onClick={() => handleOpenLogModal()}
            disabled={!data?.plant_inventory?.length}
            className="inline-flex items-center gap-1.5 border border-signal bg-signal px-3.5 py-1.5 font-mono text-xs font-bold text-ink hover:bg-signal/90 active:scale-[0.98] transition-all disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Log Plant Shift &amp; Fuel</span>
          </button>
        </div>
      </div>

      {actionMessage && (
        <div className="flex items-center justify-between border border-signal/40 bg-signal/10 px-4 py-2.5 font-mono text-xs text-paper">
          <span>{actionMessage}</span>
          <button type="button" onClick={() => setActionMessage(null)} className="text-slate hover:text-paper">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Operational Radar KPIs */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {/* Total Assets */}
        <div className="border border-ink-mid bg-ink/70 p-4">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase text-slate">Assigned Fleet</span>
            <Truck className="h-4 w-4 text-slate" />
          </div>
          <p className="mt-1 font-mono text-2xl font-bold text-paper">
            {kpis.total_assigned_assets}
          </p>
          <div className="mt-1 flex items-center gap-2 font-mono text-[11px]">
            <span className="text-emerald-400">{kpis.owned_assets_count} Owned</span>
            <span className="text-slate">/</span>
            <span className="text-sky-400">{kpis.hired_assets_count} Hired</span>
          </div>
        </div>

        {/* Utilization Rate */}
        <div className="border border-ink-mid bg-ink/70 p-4">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase text-slate">Utilization Rate</span>
            <Gauge className="h-4 w-4 text-signal" />
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className={`font-mono text-2xl font-bold ${
              kpis.overall_utilization_rate >= 70
                ? "text-emerald-400"
                : kpis.overall_utilization_rate >= 50
                ? "text-amber-400"
                : "text-rose-400"
            }`}>
              {kpis.overall_utilization_rate}%
            </span>
          </div>
          <span className="text-[11px] text-slate-light">Target &ge; 75% productive</span>
        </div>

        {/* Operating vs Idle Hours */}
        <div className="border border-ink-mid bg-ink/70 p-4">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase text-slate">Operating Hours</span>
            <Clock className="h-4 w-4 text-emerald-400" />
          </div>
          <p className="mt-1 font-mono text-2xl font-bold text-emerald-400">
            {kpis.total_operating_hours.toLocaleString()} hrs
          </p>
          <span className="text-[11px] text-slate-light">
            Idle: {kpis.total_idle_hours.toLocaleString()} hrs
          </span>
        </div>

        {/* Breakdown Downtime */}
        <div className="border border-ink-mid bg-ink/70 p-4">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase text-slate">Breakdown Downtime</span>
            <AlertTriangle className="h-4 w-4 text-rose-400" />
          </div>
          <p className="mt-1 font-mono text-2xl font-bold text-rose-400">
            {kpis.total_breakdown_hours.toLocaleString()} hrs
          </p>
          <span className="text-[11px] text-slate-light">
            Weather: {kpis.total_weather_downtime_hours.toLocaleString()} hrs
          </span>
        </div>

        {/* Fuel Consumption */}
        <div className="border border-ink-mid bg-ink/70 p-4">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase text-slate">Fuel Issued</span>
            <Fuel className="h-4 w-4 text-amber-400" />
          </div>
          <p className="mt-1 font-mono text-2xl font-bold text-amber-400">
            {kpis.total_fuel_consumed_litres.toLocaleString()} L
          </p>
          <span className="text-[11px] text-slate-light">
            Avg: {kpis.average_burn_rate} L/hr
          </span>
        </div>

        {/* Operating Cost */}
        <div className="border border-ink-mid bg-ink/70 p-4">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase text-slate">Plant Cost Exposure</span>
            <span className="text-xs font-mono text-signal">$</span>
          </div>
          <p className="mt-1 font-mono text-2xl font-bold text-paper">
            {formatCurrency(kpis.total_plant_operating_cost)}
          </p>
          <span className="text-[11px] text-slate-light truncate">
            Fuel: {formatCurrency(kpis.total_fuel_cost)}
          </span>
        </div>
      </section>

      {/* Filters & Search */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-y border-ink-mid/60 py-3">
        <div className="flex items-center gap-1 font-mono text-xs">
          <button
            type="button"
            onClick={() => setFilterOwnership("all")}
            className={`px-3 py-1.5 transition-colors ${
              filterOwnership === "all"
                ? "bg-signal text-ink font-bold"
                : "border border-ink-mid bg-ink text-slate hover:text-paper"
            }`}
          >
            All Plant ({data?.plant_inventory?.length || 0})
          </button>
          <button
            type="button"
            onClick={() => setFilterOwnership("owned")}
            className={`px-3 py-1.5 transition-colors ${
              filterOwnership === "owned"
                ? "bg-signal text-ink font-bold"
                : "border border-ink-mid bg-ink text-slate hover:text-paper"
            }`}
          >
            Company-Owned ({kpis.owned_assets_count})
          </button>
          <button
            type="button"
            onClick={() => setFilterOwnership("hired")}
            className={`px-3 py-1.5 transition-colors ${
              filterOwnership === "hired"
                ? "bg-signal text-ink font-bold"
                : "border border-ink-mid bg-ink text-slate hover:text-paper"
            }`}
          >
            Hired / Leased ({kpis.hired_assets_count})
          </button>
        </div>

        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search by code, make, model or category..."
          className="w-full sm:w-72 border border-ink-mid bg-ink-light px-3 py-1.5 font-mono text-xs text-paper placeholder-slate outline-none focus:border-signal"
        />
      </div>

      {/* Plant Inventory & Utilization Register */}
      <section className="border border-ink-mid bg-ink/70">
        <div className="flex items-center justify-between border-b border-ink-mid px-4 py-3">
          <div className="flex items-center gap-2">
            <Gauge className="h-4 w-4 text-signal" />
            <h3 className="font-display text-sm font-bold uppercase tracking-wider text-paper">
              Allocated Equipment Register &amp; Performance Ledger
            </h3>
          </div>
          <span className="font-mono text-xs text-slate">
            {filteredAssets.length} plant units deployed
          </span>
        </div>

        {filteredAssets.length === 0 ? (
          <div className="p-12 text-center">
            <Truck className="mx-auto h-10 w-10 text-slate" />
            <p className="mt-3 font-mono text-sm text-slate-light">
              No plant or equipment currently allocated to this project matching criteria.
            </p>
            <p className="mt-1 text-xs text-slate">
              Plant assignments can be dispatched from Fleet Operations or requested via Plant Mobilisation Gates.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono text-xs">
              <thead className="border-b border-ink-mid bg-ink-light/50 text-[11px] uppercase tracking-wider text-slate">
                <tr>
                  <th className="p-3">Asset Code &amp; Model</th>
                  <th className="p-3">Ownership</th>
                  <th className="p-3">Operating / Idle</th>
                  <th className="p-3">Downtime</th>
                  <th className="p-3">Utilization %</th>
                  <th className="p-3">Fuel / Burn Rate</th>
                  <th className="p-3">Productivity</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-mid/40">
                {filteredAssets.map((asset) => {
                  const isOwned = asset.ownership_type.toLowerCase() === "owned";
                  const burnOverBenchmark =
                    asset.benchmark_litres_per_hour > 0 &&
                    asset.burn_rate > asset.benchmark_litres_per_hour;

                  return (
                    <tr key={asset.assignment_id} className="hover:bg-ink-light/30 transition-colors">
                      {/* Code & Model */}
                      <td className="p-3">
                        <div className="font-bold text-paper">{asset.asset_code}</div>
                        <div className="text-[11px] text-slate-light">
                          {asset.make} {asset.model} {asset.vehicle_registration ? `(${asset.vehicle_registration})` : ""}
                        </div>
                        <div className="text-[10px] text-slate capitalize">{asset.asset_category.replace(/_/g, " ")}</div>
                      </td>

                      {/* Ownership */}
                      <td className="p-3">
                        <span className={`inline-block border px-2 py-0.5 text-[10px] font-semibold uppercase ${
                          isOwned
                            ? "border-emerald-500/40 bg-emerald-950/20 text-emerald-400"
                            : "border-sky-500/40 bg-sky-950/20 text-sky-300"
                        }`}>
                          {asset.ownership_type}
                        </span>
                        <div className="mt-1 text-[10px] text-slate">
                          Rate: {formatCurrency(asset.hourly_charge_rate)}/hr
                        </div>
                      </td>

                      {/* Operating / Idle */}
                      <td className="p-3">
                        <div className="font-semibold text-emerald-400">
                          {asset.operating_hours.toFixed(1)} hrs op
                        </div>
                        <div className="text-[11px] text-slate-light">
                          {asset.idle_hours.toFixed(1)} hrs idle
                        </div>
                      </td>

                      {/* Downtime */}
                      <td className="p-3">
                        <div className={`${asset.breakdown_hours > 0 ? "text-rose-400 font-semibold" : "text-slate"}`}>
                          {asset.breakdown_hours.toFixed(1)} hrs breakdown
                        </div>
                        {asset.weather_hours > 0 && (
                          <div className="text-[10px] text-amber-300">
                            {asset.weather_hours.toFixed(1)} hrs weather
                          </div>
                        )}
                      </td>

                      {/* Utilization Bar */}
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-20 bg-ink-mid/60 overflow-hidden">
                            <div
                              className={`h-full ${
                                asset.utilization_rate >= 70
                                  ? "bg-emerald-500"
                                  : asset.utilization_rate >= 50
                                  ? "bg-amber-400"
                                  : "bg-rose-500"
                              }`}
                              style={{ width: `${Math.min(100, asset.utilization_rate)}%` }}
                            />
                          </div>
                          <span className={`font-bold ${
                            asset.utilization_rate >= 70
                              ? "text-emerald-400"
                              : asset.utilization_rate >= 50
                              ? "text-amber-400"
                              : "text-rose-400"
                          }`}>
                            {asset.utilization_rate}%
                          </span>
                        </div>
                      </td>

                      {/* Fuel / Burn Rate */}
                      <td className="p-3">
                        <div className="font-semibold text-paper">
                          {asset.fuel_litres.toFixed(0)} L ({formatCurrency(asset.fuel_cost)})
                        </div>
                        <div className="flex items-center gap-1.5 text-[11px]">
                          <span className={burnOverBenchmark ? "text-rose-400 font-bold" : "text-slate-light"}>
                            {asset.burn_rate} L/hr
                          </span>
                          {asset.benchmark_litres_per_hour > 0 && (
                            <span className="text-[10px] text-slate">
                              (bmk: {asset.benchmark_litres_per_hour})
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Productivity */}
                      <td className="p-3">
                        {asset.output_quantity > 0 ? (
                          <>
                            <div className="font-semibold text-paper">
                              {asset.output_quantity.toLocaleString()} {asset.output_unit}
                            </div>
                            <div className="text-[11px] text-slate-light">
                              {asset.productivity} {asset.output_unit}/hr
                            </div>
                          </>
                        ) : (
                          <span className="text-slate">-</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="p-3 text-right">
                        <button
                          type="button"
                          onClick={() => handleOpenLogModal(asset.fleet_id)}
                          className="inline-flex items-center gap-1 border border-ink-mid bg-ink px-2.5 py-1 text-[11px] text-paper hover:border-signal hover:text-signal transition-colors"
                        >
                          <Plus className="h-3 w-3" />
                          <span>Log Shift</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Recent Shift Activity Log Feed */}
      {data?.recent_shift_logs && data.recent_shift_logs.length > 0 && (
        <section className="border border-ink-mid bg-ink/70">
          <div className="flex items-center justify-between border-b border-ink-mid px-4 py-3">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-emerald-400" />
              <h3 className="font-display text-sm font-bold uppercase tracking-wider text-paper">
                Recent Daily Plant Shift Activity Log
              </h3>
            </div>
            <span className="font-mono text-xs text-slate">
              Showing last {data.recent_shift_logs.length} entries
            </span>
          </div>

          <div className="divide-y divide-ink-mid/40">
            {data.recent_shift_logs.map((log) => (
              <div key={log.id} className="p-3 sm:px-4 flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-paper">{log.asset_code}</span>
                    <span className="text-slate">{log.make} {log.model}</span>
                    <span className="text-slate-light">·</span>
                    <span className="text-signal">{log.occurred_on ? formatDate(log.occurred_on) : ""}</span>
                  </div>
                  {log.work_performed && (
                    <p className="mt-0.5 text-slate-light text-[11px]">
                      {log.work_performed}
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-4 text-right">
                  <div>
                    <span className="text-emerald-400 font-semibold">{log.operating_hours} hrs op</span>
                    {log.idle_hours > 0 && <span className="text-slate ml-2">{log.idle_hours} hrs idle</span>}
                    {log.breakdown_downtime_hours > 0 && (
                      <span className="text-rose-400 ml-2">{log.breakdown_downtime_hours} hrs breakdown</span>
                    )}
                  </div>
                  {log.output_quantity > 0 && (
                    <div className="text-slate-light">
                      Output: <strong className="text-paper">{log.output_quantity} {log.output_unit}</strong>
                    </div>
                  )}
                  <span className="border border-ink-mid px-2 py-0.5 text-[10px] uppercase text-slate">
                    {log.approval_status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Quick Shift Log Modal */}
      {isLogModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-4">
          <div className="w-full max-w-lg border border-signal/50 bg-ink p-5 sm:p-6 shadow-2xl space-y-4 max-h-[90dvh] overflow-y-auto pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:pb-6 rounded-t-xl sm:rounded-none">
            <div className="flex items-center justify-between border-b border-ink-mid pb-3">
              <div className="flex items-center gap-2">
                <Truck className="h-5 w-5 text-signal" />
                <h3 className="font-display text-lg font-bold text-paper">Log Plant Shift &amp; Fuel</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsLogModalOpen(false)}
                className="text-slate hover:text-paper"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSubmitShiftLog} className="space-y-4 font-mono text-xs">
              <div>
                <label className="block text-slate uppercase text-[10px]">Select Equipment Asset *</label>
                <select
                  value={selectedFleetId}
                  onChange={(e) => setSelectedFleetId(e.target.value)}
                  className="mt-1 w-full border border-ink-mid bg-ink-light p-2.5 text-paper outline-none focus:border-signal"
                  required
                >
                  {data?.plant_inventory?.map((a) => (
                    <option key={a.fleet_id} value={a.fleet_id}>
                      {a.asset_code} — {a.make} {a.model} ({a.ownership_type.toUpperCase()})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate uppercase text-[10px]">Shift Date *</label>
                <input
                  type="date"
                  value={logDate}
                  onChange={(e) => setLogDate(e.target.value)}
                  className="mt-1 w-full border border-ink-mid bg-ink-light p-2.5 text-paper outline-none focus:border-signal"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate uppercase text-[10px]">Operating Hours</label>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    max="24"
                    value={opHours}
                    onChange={(e) => setOpHours(e.target.value)}
                    placeholder="e.g. 8.0"
                    className="mt-1 w-full border border-ink-mid bg-ink-light p-2.5 text-paper outline-none focus:border-signal"
                  />
                </div>
                <div>
                  <label className="block text-slate uppercase text-[10px]">Idle Hours</label>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    max="24"
                    value={idleHours}
                    onChange={(e) => setIdleHours(e.target.value)}
                    placeholder="e.g. 1.5"
                    className="mt-1 w-full border border-ink-mid bg-ink-light p-2.5 text-paper outline-none focus:border-signal"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate uppercase text-[10px]">Breakdown Downtime (Hrs)</label>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    max="24"
                    value={breakdownHours}
                    onChange={(e) => setBreakdownHours(e.target.value)}
                    placeholder="e.g. 0.0"
                    className="mt-1 w-full border border-ink-mid bg-ink-light p-2.5 text-paper outline-none focus:border-signal"
                  />
                </div>
                <div>
                  <label className="block text-slate uppercase text-[10px]">Fuel Issued (Litres)</label>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    value={fuelLitres}
                    onChange={(e) => setFuelLitres(e.target.value)}
                    placeholder="e.g. 120"
                    className="mt-1 w-full border border-ink-mid bg-ink-light p-2.5 text-paper outline-none focus:border-signal"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate uppercase text-[10px]">Output Quantity</label>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    value={outputQty}
                    onChange={(e) => setOutputQty(e.target.value)}
                    placeholder="e.g. 450"
                    className="mt-1 w-full border border-ink-mid bg-ink-light p-2.5 text-paper outline-none focus:border-signal"
                  />
                </div>
                <div>
                  <label className="block text-slate uppercase text-[10px]">Output Unit</label>
                  <select
                    value={outputUnit}
                    onChange={(e) => setOutputUnit(e.target.value)}
                    className="mt-1 w-full border border-ink-mid bg-ink-light p-2.5 text-paper outline-none focus:border-signal"
                  >
                    <option value="m3">Cubic Metres (m³)</option>
                    <option value="tonnes">Tonnes (t)</option>
                    <option value="loads">Trips / Loads</option>
                    <option value="lm">Linear Metres (m)</option>
                    <option value="m2">Square Metres (m²)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate uppercase text-[10px]">Work Performed &amp; Site Section</label>
                <textarea
                  rows={2}
                  value={workPerformed}
                  onChange={(e) => setWorkPerformed(e.target.value)}
                  placeholder="e.g. Bulk excavation for Basement Block B footing..."
                  className="mt-1 w-full border border-ink-mid bg-ink-light p-2.5 text-paper outline-none focus:border-signal"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-ink-mid">
                <button
                  type="button"
                  onClick={() => setIsLogModalOpen(false)}
                  className="border border-ink-mid px-4 py-2 text-slate-light hover:text-paper"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingLog}
                  className="border border-signal bg-signal px-4 py-2 font-bold text-ink hover:bg-signal/90 disabled:opacity-50"
                >
                  {submittingLog ? "Recording..." : "Record Shift Log"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
