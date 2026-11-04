"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, RefreshCw, TrendingDown, TrendingUp, Wallet } from "lucide-react";

import {
  getFinanceStatements, getIncomeStatement, getBalanceSheet,
  getCashMovementStatement, getArAging, getApAging, getTrialBalance, getYearlyHistory,
} from "@/lib/api";
import { useFinanceDepartments } from "@/hooks/useFinanceDepartments";

type RecordData = Record<string, any>;
type PeriodType = "day" | "week" | "month" | "quarter" | "year";

function money(value: unknown) {
  const num = typeof value === "number" ? value : Number(value);
  return new Intl.NumberFormat("en-ZW", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number.isFinite(num) ? num : 0);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function dateLabel(value: unknown) {
  if (!value) return "";
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? String(value) : new Intl.DateTimeFormat("en-ZW", { dateStyle: "medium" }).format(d);
}

const inputClass = "w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50";

const PERIODS: { value: PeriodType; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "quarter", label: "Quarter" },
  { value: "year", label: "Year" },
];

function firstOfMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

type YearRow = { label: string; values: number[]; kind?: "total" | "result" | "heading" };

/** Account lines of one statement section across years. `flip` shows a
 * credit-normal section (revenue, liabilities, equity) as positive. */
function accountRows(years: RecordData[], pick: (y: RecordData) => RecordData[], flip: boolean): YearRow[] {
  const names = new Map<string, string>();
  years.forEach((y) => pick(y).forEach((r) => names.set(r.account_code, r.account_name)));
  return [...names.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, name]) => ({
      label: `${code} ${name}`,
      values: years.map((y) => {
        const row = pick(y).find((r) => r.account_code === code);
        const v = Number(row?.net_balance ?? 0);
        return flip ? -v : v;
      }),
    }))
    .filter((r) => r.values.some((v) => Math.abs(v) >= 0.005));
}

function YearlyHistoryView() {
  const [years, setYears] = useState<RecordData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getYearlyHistory();
      setYears(res.data?.years ?? []);
    } catch {
      setError("The yearly history could not be loaded.");
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center rounded-sm border border-ink-mid bg-ink-light">
        <Loader2 className="h-5 w-5 animate-spin text-signal" />
      </div>
    );
  }
  if (error || years.length === 0) {
    return (
      <div className="rounded-sm border border-ink-mid bg-ink-light p-4 text-sm text-slate-light">
        {error ?? "No posted journals yet - the yearly history starts with the first posted journal."}
      </div>
    );
  }

  const num = (y: RecordData, path: string[]) => Number(path.reduce<any>((o, k) => o?.[k], y) ?? 0);
  const rows: YearRow[] = [
    { label: "Income statement", values: [], kind: "heading" },
    ...accountRows(years, (y) => y.income.revenue, true),
    { label: "Total revenue", values: years.map((y) => num(y, ["income", "total_revenue"])), kind: "total" },
    ...accountRows(years, (y) => y.income.direct_project_cost, true),
    { label: "Total direct project cost", values: years.map((y) => -num(y, ["income", "total_direct_cost"])), kind: "total" },
    { label: "Gross profit", values: years.map((y) => num(y, ["income", "gross_profit"])), kind: "result" },
    ...accountRows(years, (y) => y.income.operating_expense, true),
    { label: "Total operating expense", values: years.map((y) => -num(y, ["income", "total_operating_expense"])), kind: "total" },
    ...accountRows(years, (y) => y.income.other_income, true),
    ...accountRows(years, (y) => y.income.other_expense, true),
    { label: "Net profit / (loss)", values: years.map((y) => num(y, ["income", "net_income"])), kind: "result" },
    { label: "Balance sheet at year end", values: [], kind: "heading" },
    ...accountRows(years, (y) => y.balance_sheet.assets, false),
    { label: "Total assets", values: years.map((y) => num(y, ["balance_sheet", "total_assets"])), kind: "total" },
    ...accountRows(years, (y) => y.balance_sheet.liabilities, true),
    { label: "Total liabilities", values: years.map((y) => num(y, ["balance_sheet", "total_liabilities"])), kind: "total" },
    ...accountRows(years, (y) => y.balance_sheet.equity, true),
    { label: "Profits kept in the business (all years)", values: years.map((y) => num(y, ["balance_sheet", "retained_earnings_current_and_prior"])) },
    { label: "Total equity", values: years.map((y) => num(y, ["balance_sheet", "total_equity"])), kind: "total" },
    { label: "Cash and bank (GL 1000)", values: [], kind: "heading" },
    { label: "Opening balance", values: years.map((y) => num(y, ["cash", "opening_balance"])) },
    { label: "Money in", values: years.map((y) => num(y, ["cash", "inflows"])) },
    { label: "Money out", values: years.map((y) => -num(y, ["cash", "outflows"])) },
    { label: "Closing balance", values: years.map((y) => num(y, ["cash", "closing_balance"])), kind: "result" },
  ];
  const cents = new Intl.NumberFormat("en-ZW", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const cell = (v: number) => (Math.abs(v) < 0.005 ? "-" : v < 0 ? `(${cents.format(-v)})` : cents.format(v));

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-light">
        Every year from the first posted journal, built from the general ledger. Brackets are costs or money out.
        The last column is the year to date.
      </p>
      <div className="overflow-x-auto rounded-sm border border-ink-mid bg-ink-light">
        <table className="w-full min-w-[720px] text-sm tabular-nums">
          <thead>
            <tr className="border-b border-ink-mid">
              <th className="px-3 py-2 text-left font-mono text-xs uppercase tracking-wider text-slate">Line</th>
              {years.map((y) => (
                <th key={y.year} className="px-3 py-2 text-right font-mono text-xs uppercase tracking-wider text-slate">
                  {y.year}{y.year_to_date ? " YTD" : ""}
                  <span className={`ml-1.5 rounded-sm border px-1 text-[9px] ${y.balance_sheet?.is_balanced ? "border-emerald-500/40 text-emerald-300" : "border-red-500/40 text-red-300"}`}>
                    {y.balance_sheet?.is_balanced ? "ties" : "check"}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) =>
              r.kind === "heading" ? (
                <tr key={i}>
                  <td colSpan={years.length + 1} className="px-3 pb-1 pt-4 font-mono text-xs uppercase tracking-wider text-signal">{r.label}</td>
                </tr>
              ) : (
                <tr key={i} className={r.kind ? "border-t border-ink-mid" : ""}>
                  <td className={`px-3 py-1 ${r.kind ? "font-medium text-paper" : "text-slate-light"}`}>{r.label}</td>
                  {r.values.map((v, j) => (
                    <td key={j} className={`px-3 py-1 text-right ${r.kind === "result" ? (v >= 0 ? "font-semibold text-emerald-400" : "font-semibold text-red-400") : r.kind ? "font-medium text-paper" : "text-paper"}`}>
                      {cell(v)}
                    </td>
                  ))}
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GlStatementsView() {
  const [periodStart, setPeriodStart] = useState(firstOfMonth());
  const [periodEnd, setPeriodEnd] = useState(today());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [income, setIncome] = useState<RecordData | null>(null);
  const [balanceSheet, setBalanceSheet] = useState<RecordData | null>(null);
  const [cashMovement, setCashMovement] = useState<RecordData | null>(null);
  const [arAging, setArAging] = useState<RecordData[]>([]);
  const [apAging, setApAging] = useState<RecordData[]>([]);
  const [trialBalance, setTrialBalance] = useState<RecordData[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [incomeRes, bsRes, cmRes, arRes, apRes, tbRes] = await Promise.allSettled([
      getIncomeStatement(periodStart, periodEnd),
      getBalanceSheet(periodEnd),
      getCashMovementStatement(periodStart, periodEnd),
      getArAging(periodEnd),
      getApAging(periodEnd),
      getTrialBalance({ as_of_date: periodEnd }),
    ]);
    if (incomeRes.status === "fulfilled") setIncome(incomeRes.value.data ?? null);
    if (bsRes.status === "fulfilled") setBalanceSheet(bsRes.value.data ?? null);
    if (cmRes.status === "fulfilled") setCashMovement(cmRes.value.data ?? null);
    if (arRes.status === "fulfilled") setArAging(arRes.value.data ?? []);
    if (apRes.status === "fulfilled") setApAging(apRes.value.data ?? []);
    if (tbRes.status === "fulfilled") setTrialBalance(tbRes.value.data ?? []);
    if ([incomeRes, bsRes, cmRes, arRes, apRes, tbRes].some((r) => r.status === "rejected")) {
      setError("Some GL statements could not be loaded.");
    }
    setLoading(false);
  }, [periodStart, periodEnd]);

  useEffect(() => {
    void load();
  }, [load]);

  const agingTotal = (rows: RecordData[]) => rows.reduce((sum, r) => sum + Number(r.outstanding_amount || 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3 rounded-sm border border-ink-mid bg-ink-light p-4">
        <div>
          <label className="mb-1 block text-xs font-mono uppercase text-slate">Period start</label>
          <input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-mono uppercase text-slate">Period end / as of</label>
          <input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} className={inputClass} />
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex h-9 items-center gap-2 rounded-sm border border-ink-mid px-3 font-mono text-xs uppercase tracking-widest text-paper hover:border-signal disabled:opacity-60">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded border border-red-500/30 bg-red-950/20 px-3 py-2 text-sm text-red-200">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {loading ? (
        <div className="flex h-40 items-center justify-center rounded-sm border border-ink-mid bg-ink-light">
          <Loader2 className="h-5 w-5 animate-spin text-signal" />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-sm border border-ink-mid bg-ink-light p-4">
            <p className="mb-3 font-mono text-xs uppercase tracking-wider text-slate">Income Statement</p>
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between"><span className="text-slate-light">Revenue</span><span className="text-paper">{money(income?.total_revenue)}</span></div>
              <div className="flex justify-between"><span className="text-slate-light">Direct project cost</span><span className="text-paper">({money(income?.total_direct_cost)})</span></div>
              <div className="flex justify-between border-t border-ink-mid pt-1.5 font-medium"><span className="text-paper">Gross profit</span><span className="text-paper">{money(income?.gross_profit)}</span></div>
              <div className="flex justify-between"><span className="text-slate-light">Operating expense</span><span className="text-paper">({money(income?.total_operating_expense)})</span></div>
              <div className="flex justify-between"><span className="text-slate-light">Other income / (expense)</span><span className="text-paper">{money((income?.total_other_income ?? 0) - (income?.total_other_expense ?? 0))}</span></div>
              <div className={`flex justify-between border-t border-ink-mid pt-1.5 font-semibold ${(income?.net_income ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}><span>Net income</span><span>{money(income?.net_income)}</span></div>
            </div>
          </div>

          <div className="rounded-sm border border-ink-mid bg-ink-light p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="font-mono text-xs uppercase tracking-wider text-slate">Balance Sheet</p>
              <span className={`font-mono text-[10px] uppercase px-1.5 py-0.5 border rounded-sm ${balanceSheet?.is_balanced ? "border-emerald-500/40 text-emerald-300" : "border-red-500/40 text-red-300"}`}>
                {balanceSheet?.is_balanced ? "Balanced" : "Unbalanced"}
              </span>
            </div>
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between font-medium"><span className="text-paper">Total assets</span><span className="text-paper">{money(balanceSheet?.total_assets)}</span></div>
              <div className="flex justify-between"><span className="text-slate-light">Total liabilities</span><span className="text-paper">{money(balanceSheet?.total_liabilities)}</span></div>
              <div className="flex justify-between"><span className="text-slate-light">Posted equity</span><span className="text-paper">{money((balanceSheet?.total_equity ?? 0) - (balanceSheet?.retained_earnings_current_and_prior ?? 0))}</span></div>
              <div className="flex justify-between"><span className="text-slate-light">Retained earnings (current + prior)</span><span className="text-paper">{money(balanceSheet?.retained_earnings_current_and_prior)}</span></div>
              <div className="flex justify-between border-t border-ink-mid pt-1.5 font-semibold"><span className="text-paper">Total liabilities + equity</span><span className="text-paper">{money(balanceSheet?.total_liabilities_and_equity)}</span></div>
            </div>
          </div>

          <div className="rounded-sm border border-ink-mid bg-ink-light p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="font-mono text-xs uppercase tracking-wider text-slate">Cash Movement</p>
              {cashMovement && (
                <span className={`font-mono text-[10px] uppercase px-1.5 py-0.5 border rounded-sm ${cashMovement.reconciles ? "border-emerald-500/40 text-emerald-300" : "border-red-500/40 text-red-300"}`}>
                  {cashMovement.reconciles ? "Reconciles" : "Discrepancy"}
                </span>
              )}
            </div>
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between"><span className="text-slate-light">Opening balance</span><span className="text-paper">{money(cashMovement?.opening_balance)}</span></div>
              <div className="flex justify-between"><span className="text-slate-light">Inflows</span><span className="text-emerald-300">{money(cashMovement?.inflows)}</span></div>
              <div className="flex justify-between"><span className="text-slate-light">Outflows</span><span className="text-red-300">({money(cashMovement?.outflows)})</span></div>
              <div className="flex justify-between border-t border-ink-mid pt-1.5 font-semibold"><span className="text-paper">Closing balance</span><span className="text-paper">{money(cashMovement?.closing_balance)}</span></div>
            </div>
          </div>

          <div className="rounded-sm border border-ink-mid bg-ink-light p-4">
            <p className="mb-3 font-mono text-xs uppercase tracking-wider text-slate">Trial Balance ({trialBalance.length} accounts with activity)</p>
            <div className="max-h-48 overflow-y-auto custom-scrollbar">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-slate-light"><th className="pb-1">Account</th><th className="pb-1 text-right">Debit</th><th className="pb-1 text-right">Credit</th></tr>
                </thead>
                <tbody className="divide-y divide-ink-mid/50">
                  {trialBalance.map((a) => (
                    <tr key={a.account_id}>
                      <td className="py-1 text-paper">{a.account_code} {a.account_name}</td>
                      <td className="py-1 text-right text-paper">{money(a.total_debit)}</td>
                      <td className="py-1 text-right text-paper">{money(a.total_credit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-sm border border-ink-mid bg-ink-light p-4">
            <p className="mb-3 font-mono text-xs uppercase tracking-wider text-slate">AR Aging - total outstanding {money(agingTotal(arAging))}</p>
            <div className="max-h-48 overflow-y-auto custom-scrollbar">
              {arAging.length === 0 ? <p className="text-xs text-slate-light">No outstanding certified claims.</p> : (
                <table className="w-full text-left text-xs">
                  <thead><tr className="text-slate-light"><th className="pb-1">Project</th><th className="pb-1 text-right">Outstanding</th><th className="pb-1 text-right">Bucket</th></tr></thead>
                  <tbody className="divide-y divide-ink-mid/50">
                    {arAging.map((r) => (
                      <tr key={r.claim_id}>
                        <td className="py-1 text-paper">{r.project_name}</td>
                        <td className="py-1 text-right text-paper">{money(r.outstanding_amount)}</td>
                        <td className="py-1 text-right text-slate-light">{r.bucket}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="rounded-sm border border-ink-mid bg-ink-light p-4">
            <p className="mb-3 font-mono text-xs uppercase tracking-wider text-slate">AP Aging - total outstanding {money(agingTotal(apAging))}</p>
            <div className="max-h-48 overflow-y-auto custom-scrollbar">
              {apAging.length === 0 ? <p className="text-xs text-slate-light">No outstanding supplier invoices.</p> : (
                <table className="w-full text-left text-xs">
                  <thead><tr className="text-slate-light"><th className="pb-1">Supplier</th><th className="pb-1 text-right">Outstanding</th><th className="pb-1 text-right">Bucket</th></tr></thead>
                  <tbody className="divide-y divide-ink-mid/50">
                    {apAging.map((r) => (
                      <tr key={r.invoice_id}>
                        <td className="py-1 text-paper">{r.supplier_name}</td>
                        <td className="py-1 text-right text-paper">{money(r.outstanding_amount)}</td>
                        <td className="py-1 text-right text-slate-light">{r.bucket}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function FinancialStatementsPanel() {
  const [view, setView] = useState<"department" | "gl" | "years">("department");
  const { departments } = useFinanceDepartments();
  const [statement, setStatement] = useState<RecordData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<PeriodType>("month");
  const [anchorDate, setAnchorDate] = useState(today());
  const [departmentId, setDepartmentId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const stmtRes = await getFinanceStatements({ period, anchor_date: anchorDate, department_id: departmentId || undefined });
      setStatement(stmtRes.data ?? null);
    } catch {
      setError("Financial statement could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [period, anchorDate, departmentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const segment = statement?.segment;
  const revenue = segment?.total_revenue ?? 0;
  const cost = segment?.total_cost ?? 0;
  const net = segment?.net ?? 0;
  const marginPct = revenue > 0 ? (net / revenue) * 100 : 0;
  const marginTone = marginPct >= 15 ? "text-emerald-400" : marginPct >= 5 ? "text-amber-400" : "text-red-400";

  const cash = statement?.cash_position;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-slate">Business reporting</p>
          <h2 className="mt-1 text-xl font-semibold text-paper">Financial Statements</h2>
          <p className="mt-1 text-sm text-slate-light">Revenue, cost, and cash position by period and business segment.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex h-9 items-center gap-2 rounded-sm border border-ink-mid px-3 font-mono text-xs uppercase tracking-widest text-paper hover:border-signal disabled:opacity-60">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </button>
      </div>

      <div className="flex overflow-hidden rounded-sm border border-ink-mid w-fit">
        {(["department", "gl", "years"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            className={`px-3 py-2 font-mono text-xs uppercase tracking-wider transition-colors ${view === v ? "bg-signal text-ink" : "bg-ink text-slate hover:text-paper"}`}
          >
            {v === "department" ? "Department View" : v === "gl" ? "GL Statements" : "Year by Year"}
          </button>
        ))}
      </div>

      {view === "years" ? (
        <YearlyHistoryView />
      ) : view === "gl" ? (
        <GlStatementsView />
      ) : (
      <>
      {error && (
        <div className="flex items-center gap-2 rounded border border-red-500/30 bg-red-950/20 px-3 py-2 text-sm text-red-200">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3 rounded-sm border border-ink-mid bg-ink-light p-4">
        <div className="flex overflow-hidden rounded-sm border border-ink-mid">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => setPeriod(p.value)}
              className={`px-3 py-2 font-mono text-xs uppercase tracking-wider transition-colors ${period === p.value ? "bg-signal text-ink" : "bg-ink text-slate hover:text-paper"}`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div>
          <label className="mb-1 block text-xs font-mono uppercase text-slate">Anchor date</label>
          <input type="date" value={anchorDate} onChange={(e) => setAnchorDate(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-mono uppercase text-slate">Segment</label>
          <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className={inputClass}>
            <option value="">All (consolidated)</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>
        {statement?.period && (
          <p className="ml-auto font-mono text-xs text-slate-light">
            {dateLabel(statement.period.date_from)} - {dateLabel(statement.period.date_to)}
          </p>
        )}
      </div>

      {loading ? (
        <div className="flex h-40 items-center justify-center rounded-sm border border-ink-mid bg-ink-light">
          <Loader2 className="h-5 w-5 animate-spin text-signal" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div className="rounded-sm border border-ink-mid bg-ink-light p-4">
              <p className="font-mono text-[10px] uppercase tracking-widest text-slate">Revenue</p>
              <p className="mt-1 flex items-center gap-2 text-lg font-semibold tracking-tight text-paper">
                <TrendingUp className="h-4 w-4 text-emerald-400" /> {money(revenue)}
              </p>
            </div>
            <div className="rounded-sm border border-ink-mid bg-ink-light p-4">
              <p className="font-mono text-[10px] uppercase tracking-widest text-slate">Cost</p>
              <p className="mt-1 flex items-center gap-2 text-lg font-semibold tracking-tight text-paper">
                <TrendingDown className="h-4 w-4 text-red-400" /> {money(cost)}
              </p>
            </div>
            <div className="rounded-sm border border-ink-mid bg-ink-light p-4">
              <p className="font-mono text-[10px] uppercase tracking-widest text-slate">Net</p>
              <p className={`mt-1 text-lg font-semibold tracking-tight ${net >= 0 ? "text-emerald-400" : "text-red-400"}`}>{money(net)}</p>
            </div>
            <div className="rounded-sm border border-ink-mid bg-ink-light p-4">
              <p className="font-mono text-[10px] uppercase tracking-widest text-slate">Margin</p>
              <p className={`mt-1 text-lg font-semibold tracking-tight ${marginTone}`}>{marginPct.toFixed(1)}%</p>
            </div>
          </div>

          <div className="rounded-sm border border-ink-mid bg-ink-light p-4">
            <div className="mb-3 flex items-center gap-2">
              <Wallet className="h-4 w-4 text-slate" />
              <span className="font-mono text-xs uppercase tracking-wider text-slate">Cash position</span>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <p className="text-xs text-slate-light">Total cash</p>
                <p className="mt-1 text-xl font-semibold text-paper">{money(cash?.total_cash)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-light">Trailing monthly burn</p>
                <p className="mt-1 text-xl font-semibold text-paper">{money(cash?.trailing_monthly_burn)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-light">Runway</p>
                <p className="mt-1 text-xl font-semibold text-paper">
                  {cash?.runway_months != null ? `${cash.runway_months} months` : "No burn recorded"}
                </p>
              </div>
            </div>
          </div>

          {!departmentId && statement?.departments && statement.departments.length > 0 && (
            <div className="overflow-x-auto rounded-sm border border-ink-mid bg-ink-light">
              <table className="w-full min-w-[480px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-ink-mid bg-ink-light font-mono text-[11px] uppercase tracking-wider text-slate">
                    <th className="p-4">Segment</th>
                    <th className="p-4">Revenue</th>
                    <th className="p-4">Cost</th>
                    <th className="p-4">Net</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-mid">
                  {statement.departments.map((d: RecordData) => (
                    <tr key={d.department_id ?? "unassigned"} className="hover:bg-ink-mid/10">
                      <td className="p-4 text-paper">{d.department_name}</td>
                      <td className="p-4 text-paper">{money(d.total_revenue)}</td>
                      <td className="p-4 text-paper">{money(d.total_cost)}</td>
                      <td className={`p-4 ${d.net >= 0 ? "text-emerald-400" : "text-red-400"}`}>{money(d.net)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      </>
      )}
    </div>
  );
}
