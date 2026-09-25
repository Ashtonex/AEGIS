"use client";

import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Gauge, Loader2, RefreshCw } from "lucide-react";
import { RBACGuard } from "@/components/auth/RBACGuard";
import { DashboardPageHeader } from "@/components/dashboard/DashboardPageHeader";
import { OperationalTable, TableHeader, TableRow, TableHead, TableCell } from "@/components/ui/OperationalTable";
import { useApiQueries } from "@/hooks/useApiQueries";
import { getFleetPerformance } from "@/lib/api";
import { ASSET_CATEGORY_OPTIONS } from "@/components/fleet/AssetOperationsModals";

// Fleet and Equipment are the same underlying data (fleet.fleet, see
// AssetOperationsModals.tsx) - this dashboard is reachable from both nav
// entries and shares their combined allowedRoles.
const ALLOWED_ROLES = [
  "Executive (Admin)", "Fleet Supervisor", "Fleet Clerk", "Equipment Manager",
  "Site Manager", "Maintenance Planner", "Executive Read Only",
];

const inputClass = "min-h-11 border border-ink-mid bg-ink px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50";
const buttonClass = "inline-flex items-center gap-2 border border-ink-mid px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-signal hover:border-signal/50 disabled:opacity-50";

function fmtCurrency(value: unknown): string {
  const n = Number(value);
  return Number.isFinite(n) ? `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "$0";
}

function fmtCompactCurrency(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "$0";
  if (Math.abs(n) >= 1000) return `$${Math.round(n / 1000)}k`;
  return `$${Math.round(n)}`;
}

function fmtPct(value: unknown): string {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toLocaleString(undefined, { maximumFractionDigits: 1 })}%` : "0%";
}

function marginClass(value: number): string {
  if (value > 0) return "text-emerald-400";
  if (value < 0) return "text-red-400";
  return "text-slate-light";
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function firstOfMonthIso(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

function ChartTooltip({ active, payload, label, formatter }: { active?: boolean; payload?: Array<{ name?: string; value?: number | string; color?: string }>; label?: string; formatter?: (value: number | string) => string }) {
  if (!active || !payload || !payload.length) return null;
  const format = formatter || fmtCurrency;
  return (
    <div className="bg-ink border border-ink-mid rounded-md px-3 py-2 shadow-[0_10px_30px_-10px_rgba(0,0,0,0.6)]">
      {label && <p className="font-mono text-[10px] uppercase text-slate mb-1">{label}</p>}
      {payload.map((entry, index) => (
        <p key={index} className="font-mono text-xs text-paper flex items-center gap-1.5">
          <span className="inline-block w-2 h-2 rounded-sm" style={{ backgroundColor: entry.color }} />
          {entry.name}: {format(entry.value ?? 0)}
        </p>
      ))}
    </div>
  );
}

function KpiCard({ label, value, sub, accentClass }: { label: string; value: string; sub?: string; accentClass?: string }) {
  return (
    <div className="bg-ink border border-ink-mid rounded-lg p-4 shadow-[0_1px_2px_rgba(0,0,0,0.35)]">
      <p className="font-mono text-[10px] uppercase tracking-widest text-slate">{label}</p>
      <p className={`mt-2 font-display text-2xl font-bold ${accentClass || "text-paper"}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-light">{sub}</p>}
    </div>
  );
}

type PerformerRow = { id: string; asset_code: string | null; vehicle_registration: string | null; asset_category: string | null; internal_revenue: number; operating_cost: number; margin: number };

function PerformerTable({ title, rows }: { title: string; rows: PerformerRow[] }) {
  return (
    <div className="bg-ink border border-ink-mid rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35)]">
      <div className="p-4 border-b border-ink-mid">
        <h2 className="font-mono text-xs tracking-widest text-paper uppercase">{title}</h2>
      </div>
      {rows.length === 0 ? (
        <p className="p-4 text-sm text-slate-light">No data for this period.</p>
      ) : (
        <OperationalTable>
          <TableHeader>
            <TableRow>
              <TableHead>Asset</TableHead>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">Revenue</TableHead>
              <TableHead className="text-right">Cost</TableHead>
              <TableHead className="text-right">Margin</TableHead>
            </TableRow>
          </TableHeader>
          <tbody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="text-paper">{row.asset_code || row.vehicle_registration || row.id.slice(0, 8)}</TableCell>
                <TableCell>{row.asset_category || "Uncategorised"}</TableCell>
                <TableCell className="text-right">{fmtCurrency(row.internal_revenue)}</TableCell>
                <TableCell className="text-right">{fmtCurrency(row.operating_cost)}</TableCell>
                <TableCell className={`text-right font-semibold ${marginClass(row.margin)}`}>{fmtCurrency(row.margin)}</TableCell>
              </TableRow>
            ))}
          </tbody>
        </OperationalTable>
      )}
    </div>
  );
}

export default function FleetPerformancePage() {
  return (
    <RBACGuard allowedRoles={ALLOWED_ROLES}>
      <FleetPerformanceDashboard />
    </RBACGuard>
  );
}

function FleetPerformanceDashboard() {
  const [dateFrom, setDateFrom] = useState(firstOfMonthIso());
  const [dateTo, setDateTo] = useState(todayIso());
  const [category, setCategory] = useState("");

  const { data, isLoading, error, warnings, refetch } = useApiQueries(
    {
      performance: () => getFleetPerformance({ date_from: dateFrom, date_to: dateTo, category: category || undefined, trend_months: 6 }),
    },
    [dateFrom, dateTo, category],
    { criticalKeys: ["performance"], labels: { performance: "Fleet performance" } }
  );

  const perf = (data.performance?.data ?? null) as null | {
    totals: Record<string, number>;
    by_category: Array<Record<string, unknown>>;
    trend: Array<Record<string, unknown>>;
    top_performers: PerformerRow[];
    bottom_performers: PerformerRow[];
  };

  const totals = perf?.totals;
  const byCategory = Array.isArray(perf?.by_category) ? perf!.by_category : [];
  const trend = Array.isArray(perf?.trend) ? perf!.trend : [];
  const topPerformers = Array.isArray(perf?.top_performers) ? perf!.top_performers : [];
  const bottomPerformers = Array.isArray(perf?.bottom_performers) ? perf!.bottom_performers : [];

  const categoryChartData = useMemo(
    () => byCategory.map((c) => ({ name: String(c.asset_category || "Uncategorised"), Revenue: Number(c.internal_revenue) || 0, Cost: Number(c.operating_cost) || 0 })),
    [byCategory]
  );

  const trendChartData = useMemo(
    () => trend.map((t) => ({
      month: new Date(String(t.month)).toLocaleDateString(undefined, { month: "short", year: "2-digit" }),
      Margin: Number(t.margin) || 0,
      "Utilization %": Number(t.utilization_pct) || 0,
    })),
    [trend]
  );

  return (
    <main className="min-h-full space-y-6 bg-ink p-4 text-paper sm:p-6">
      <DashboardPageHeader
        eyebrow={{ label: "Assets / Fleet & Equipment", icon: Gauge }}
        title="Fleet & Equipment Performance"
        subtitle="Utilization, revenue, cost and margin across every fleet and equipment asset - Fleet and Equipment are the same register, so this covers both."
        actions={<button className={buttonClass} onClick={() => void refetch()} disabled={isLoading}><RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} /> Refresh</button>}
      />

      {error && <div className="border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">{error.message}</div>}
      {warnings.length > 0 && <div className="border border-signal/30 bg-signal/10 p-3 text-xs text-slate-light">{warnings.join(" ")}</div>}

      <div className="flex flex-wrap items-end gap-3 bg-ink-light border border-ink-mid rounded-lg p-4">
        <label className="grid gap-1 text-sm text-slate-light">From
          <input type="date" className={inputClass} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </label>
        <label className="grid gap-1 text-sm text-slate-light">To
          <input type="date" className={inputClass} value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </label>
        <label className="grid gap-1 text-sm text-slate-light">Category
          <select className={inputClass} value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {ASSET_CATEGORY_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
          </select>
        </label>
      </div>

      {isLoading && !perf ? (
        <div className="bg-ink-light border border-ink-mid rounded-lg p-8 flex items-center gap-3 text-slate">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading fleet performance...
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
            <KpiCard label="Assets" value={String(totals?.asset_count ?? 0)} />
            <KpiCard label="Utilization" value={fmtPct(totals?.utilization_pct ?? 0)} />
            <KpiCard label="Internal revenue" value={fmtCurrency(totals?.internal_revenue ?? 0)} sub="Internal plant-hire rate, not customer billing" />
            <KpiCard label="Operating cost" value={fmtCurrency(totals?.operating_cost ?? 0)} sub="Fuel + maintenance + ownership" />
            <KpiCard label="Margin" value={fmtCurrency(totals?.margin ?? 0)} sub={fmtPct(totals?.margin_pct ?? 0)} accentClass={marginClass(totals?.margin ?? 0)} />
            <KpiCard label="Customer-billed (org-wide)" value={fmtCurrency(totals?.external_invoice_revenue ?? 0)} sub="Not yet split by asset" />
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <div className="bg-ink border border-ink-mid rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35)]">
              <div className="p-4 border-b border-ink-mid">
                <h2 className="font-mono text-xs tracking-widest text-paper uppercase">Revenue vs. cost by category</h2>
              </div>
              <div className="p-4 h-72">
                {categoryChartData.length === 0 ? (
                  <p className="text-sm text-slate-light">No category data for this period.</p>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={categoryChartData} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--dxl-ink-mid)" horizontal={false} />
                      <XAxis type="number" tick={{ fill: "var(--dxl-slate-light)", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => fmtCompactCurrency(v)} />
                      <YAxis type="category" dataKey="name" tick={{ fill: "var(--dxl-slate-light)", fontSize: 10 }} axisLine={false} tickLine={false} width={140} />
                      <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--dxl-ink-light)" }} />
                      <Legend wrapperStyle={{ fontSize: 10, color: "var(--dxl-slate-light)" }} />
                      <Bar dataKey="Revenue" fill="var(--dxl-signal)" radius={[0, 2, 2, 0]} barSize={18} />
                      <Bar dataKey="Cost" fill="var(--dxl-info)" radius={[0, 2, 2, 0]} barSize={18} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            <div className="bg-ink border border-ink-mid rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35)]">
              <div className="p-4 border-b border-ink-mid">
                <h2 className="font-mono text-xs tracking-widest text-paper uppercase">Margin &amp; utilization trend</h2>
                <p className="text-xs text-slate-light mt-1">Ownership cost is a fixed monthly figure per asset, so months with no activity still show it - a flat baseline cost, not a data gap.</p>
              </div>
              <div className="p-4 h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendChartData} margin={{ top: 4, right: 16, left: 4, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--dxl-ink-mid)" />
                    <XAxis dataKey="month" tick={{ fill: "var(--dxl-slate-light)", fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis yAxisId="margin" tick={{ fill: "var(--dxl-slate-light)", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => fmtCompactCurrency(v)} />
                    <YAxis yAxisId="pct" orientation="right" tick={{ fill: "var(--dxl-slate-light)", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />
                    <Tooltip content={<ChartTooltip formatter={(v) => String(v)} />} cursor={{ stroke: "var(--dxl-ink-mid)" }} />
                    <Legend wrapperStyle={{ fontSize: 10, color: "var(--dxl-slate-light)" }} />
                    <Line yAxisId="margin" type="monotone" dataKey="Margin" stroke="var(--dxl-signal)" strokeWidth={2} dot={false} />
                    <Line yAxisId="pct" type="monotone" dataKey="Utilization %" stroke="var(--dxl-info)" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <PerformerTable title="Top performing assets" rows={topPerformers} />
            <PerformerTable title="Bottom performing assets" rows={bottomPerformers} />
          </div>
        </>
      )}
    </main>
  );
}
