"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, RefreshCw, TrendingDown, TrendingUp, Wallet } from "lucide-react";

import {
  getFinanceDepartments, getFinanceStatements, getIncomeStatement, getBalanceSheet,
  getCashMovementStatement, getArAging, getApAging, getTrialBalance,
} from "@/lib/api";

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
  const [view, setView] = useState<"department" | "gl">("department");
  const [departments, setDepartments] = useState<RecordData[]>([]);
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
      const [deptRes, stmtRes] = await Promise.allSettled([
        getFinanceDepartments(),
        getFinanceStatements({ period, anchor_date: anchorDate, department_id: departmentId || undefined }),
      ]);
      if (deptRes.status === "fulfilled") setDepartments(deptRes.value.data ?? []);
      if (stmtRes.status === "fulfilled") setStatement(stmtRes.value.data ?? null);
      else setError("Financial statement could not be loaded.");
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
        {(["department", "gl"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            className={`px-3 py-2 font-mono text-xs uppercase tracking-wider transition-colors ${view === v ? "bg-signal text-ink" : "bg-ink text-slate hover:text-paper"}`}
          >
            {v === "department" ? "Department View" : "GL Statements"}
          </button>
        ))}
      </div>

      {view === "gl" ? (
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
