"use client";

import type React from "react";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  AlertTriangle, ArrowRight, Banknote, CreditCard, FileClock, HardHat, Landmark,
  Loader2, Receipt, TrendingDown, TrendingUp, Wallet,
} from "lucide-react";
import { getFinanceOpsDashboard } from "@/lib/api";

type RecordData = Record<string, any>;

function money(value: unknown, compact = false) {
  const num = typeof value === "number" ? value : Number(value);
  const n = Number.isFinite(num) ? num : 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", maximumFractionDigits: compact && Math.abs(n) >= 1000 ? 1 : 0,
    notation: compact ? "compact" : "standard",
  }).format(n);
}

const CATEGORY_COLORS: Record<string, string> = {
  labour: "#38bdf8",
  materials: "#C8960C",
  equipment: "#a78bfa",
  subcontract: "#34d399",
  overhead: "#fb7185",
  other: "#94a3b8",
};

// Short so all five fit under the bars at narrow widths; the hint above
// the chart says these are days past due.
const AGE_LABELS: Record<string, string> = {
  current: "Not due",
  "1_30": "1-30",
  "31_60": "31-60",
  "61_90": "61-90",
  "90_plus": "90+",
};
const AGE_COLORS = ["#34d399", "#C8960C", "#fb923c", "#f87171", "#dc2626"];

const card = "bg-ink-light border border-ink-mid rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)]";
const axisTick = { fill: "var(--dxl-slate-light)", fontSize: 10 };

function monthLabel(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
}

function ChartTip({ active, payload, label }: { active?: boolean; payload?: any[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded border border-ink-mid bg-ink px-3 py-2 text-xs shadow-lg">
      {label && <p className="mb-1 font-mono text-[10px] uppercase text-slate">{label}</p>}
      {payload.map((p) => (
        <p key={p.dataKey || p.name} className="flex items-center gap-2 text-paper">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color || p.payload?.fill }} />
          <span className="text-slate-light">{p.name}</span>
          <span className="ml-auto tabular-nums">{money(p.value)}</span>
        </p>
      ))}
    </div>
  );
}

function Section({ title, hint, href, children, className = "" }: { title: string; hint?: string; href?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`${card} p-4 flex flex-col ${className}`}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="font-mono text-[11px] uppercase tracking-wider text-slate">{title}</h3>
          {hint && <p className="text-[11px] text-slate-light mt-0.5">{hint}</p>}
        </div>
        {href && (
          <Link href={href} className="inline-flex items-center gap-1 text-[11px] text-signal hover:underline whitespace-nowrap">
            Open <ArrowRight className="h-3 w-3" />
          </Link>
        )}
      </div>
      <div className="flex-1 min-h-0">{children}</div>
    </section>
  );
}

function Kpi({ icon: Icon, label, value, sub, tone = "default", href }: { icon: any; label: string; value: string; sub?: string; tone?: "default" | "good" | "warn" | "bad"; href?: string }) {
  const toneClass = tone === "good" ? "text-emerald-400" : tone === "warn" ? "text-amber-400" : tone === "bad" ? "text-red-400" : "text-paper";
  const body = (
    <div className={`${card} p-3.5 h-full transition-colors hover:border-signal/30`}>
      <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-slate"><Icon className="h-3.5 w-3.5" />{label}</div>
      <p className={`mt-1.5 text-lg font-semibold tracking-tight tabular-nums ${toneClass}`}>{value}</p>
      {sub && <p className="text-[11px] text-slate-light mt-0.5 truncate">{sub}</p>}
    </div>
  );
  return href ? <Link href={href} className="block">{body}</Link> : body;
}

/**
 * The Finance module's landing page: one screen of compact, charted
 * position - contract and cash, what's owed both ways, cost mix, budget and
 * claim pipelines - with each tile linking to the page where the work is
 * done. Deliberately read-only; entry happens on the module pages.
 */
export function FinanceOverviewDashboard({
  projectSummaries,
  departmentId,
  unassignedBankOut,
}: {
  projectSummaries: RecordData[];
  departmentId: string;
  unassignedBankOut: number;
}) {
  const [data, setData] = useState<RecordData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getFinanceOpsDashboard({ department_id: departmentId || undefined, months: 12 })
      .then((res) => { if (!cancelled) { setData(res.data || null); setError(null); } })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Could not load the finance dashboard."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [departmentId]);

  const position = useMemo(() => {
    const sum = (pick: (p: RecordData) => unknown) => projectSummaries.reduce((s, p) => s + Number(pick(p) || 0), 0);
    const contract = sum((p) => Number(p.contract_value || 0) + Number(p.approved_variations || 0));
    const certified = sum((p) => p.certified_to_date);
    const collected = sum((p) => p.cash_collected);
    const committed = sum((p) => p.committed_cost);
    const actual = sum((p) => p.actual_cost_to_date);
    const budget = sum((p) => p.approved_budget);
    const rows = projectSummaries.map((p) => {
      const revenue = Number(p.contract_value || 0) + Number(p.approved_variations || 0);
      const eac = Number(p.actual_cost_to_date || 0) + Number(p.committed_cost || 0);
      return {
        name: String(p.project_name || p.project_code || "Project"),
        revenue,
        cost: Number(p.actual_cost_to_date || 0),
        committed: Number(p.committed_cost || 0),
        budget: Number(p.approved_budget || 0),
        margin: revenue - eac,
        marginPct: revenue > 0 ? ((revenue - eac) / revenue) * 100 : 0,
        overBudget: Number(p.approved_budget || 0) > 0 && eac > Number(p.approved_budget || 0),
      };
    });
    const eac = actual + committed;
    return {
      contract, certified, collected, committed, actual, budget,
      ar: certified - collected,
      marginPct: contract > 0 ? ((contract - eac) / contract) * 100 : 0,
      projects: rows.sort((a, b) => b.revenue - a.revenue),
      overBudget: rows.filter((r) => r.overBudget),
      negativeMargin: rows.filter((r) => r.revenue > 0 && r.margin < 0),
    };
  }, [projectSummaries]);

  const cashSeries = useMemo(
    () => (data?.monthly_cash || []).map((m: RecordData) => ({ ...m, label: monthLabel(m.month) })),
    [data]
  );
  const costMix = useMemo(() => (data?.cost_by_category || []).filter((c: RecordData) => c.amount > 0), [data]);
  const costMixTotal = costMix.reduce((s: number, c: RecordData) => s + c.amount, 0);
  const agingSeries = useMemo(
    () => Object.entries(AGE_LABELS).map(([key, label], i) => ({ key, label, amount: Number(data?.payables_aging?.[key] || 0), fill: AGE_COLORS[i] })),
    [data]
  );
  const cashOnHand = (data?.cash_accounts || []).reduce((s: number, a: RecordData) => s + Number(a.balance || 0), 0);
  const overduePayables = agingSeries.filter((a) => a.key !== "current").reduce((s, a) => s + a.amount, 0);
  const budgets = data?.budget_pipeline || {};
  const claims = data?.claim_pipeline || {};
  const draftBudgets = Number(budgets.draft?.count || 0);

  const alerts: { tone: "bad" | "warn"; text: string; href: string }[] = [];
  if (draftBudgets) alerts.push({ tone: "warn", text: `${draftBudgets} project budget${draftBudgets === 1 ? " is" : "s are"} still in draft. QS, PM and the MD get a reminder each weekday`, href: "/dashboard/finance/budgets" });
  if (overduePayables > 0) alerts.push({ tone: "bad", text: `${money(overduePayables)} of supplier invoices are past due`, href: "/dashboard/finance/supplier-payments" });
  position.overBudget.forEach((p) => alerts.push({ tone: "bad", text: `${p.name}: forecast cost is over its approved budget`, href: "/dashboard/finance/project-financials" }));
  position.negativeMargin.slice(0, 3).forEach((p) => alerts.push({ tone: "bad", text: `${p.name}: forecast margin is negative (${p.marginPct.toFixed(1)}%)`, href: "/dashboard/finance/project-financials" }));
  if (unassignedBankOut > 0) alerts.push({ tone: "warn", text: `${money(unassignedBankOut)} of bank money out isn't tagged to a project yet`, href: "/dashboard/finance/bank-review" });
  if (position.ar > 0) alerts.push({ tone: "warn", text: `${money(position.ar)} certified but not yet collected from clients`, href: "/dashboard/finance/client-payments" });

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3" data-tour="finance-kpis">
        <Kpi icon={Landmark} label="Contract value" value={money(position.contract, true)} sub={`${projectSummaries.length} projects`} href="/dashboard/finance/project-financials" />
        <Kpi icon={Receipt} label="Certified" value={money(position.certified, true)} sub="Revenue claimed & certified" href="/dashboard/finance/progress-claims" />
        <Kpi icon={Banknote} label="Collected" value={money(position.collected, true)} sub={position.certified > 0 ? `${((position.collected / position.certified) * 100).toFixed(0)}% of certified` : undefined} href="/dashboard/finance/client-payments" />
        <Kpi icon={FileClock} label="Owed to us" value={money(position.ar, true)} tone={position.ar > 0 ? "warn" : "default"} sub="Certified, not collected" href="/dashboard/finance/client-payments" />
        <Kpi icon={Wallet} label="Cash on hand" value={loading ? "…" : money(cashOnHand, true)} sub={`${(data?.cash_accounts || []).length} accounts`} href="/dashboard/finance/banking" />
        <Kpi icon={CreditCard} label="We owe suppliers" value={loading ? "…" : money(data?.payables_total, true)} tone={overduePayables > 0 ? "bad" : "default"} sub={overduePayables > 0 ? `${money(overduePayables, true)} overdue` : `${data?.payables_count ?? 0} invoices`} href="/dashboard/finance/supplier-payments" />
        <Kpi icon={HardHat} label="Actual cost" value={money(position.actual, true)} sub={`${money(position.committed, true)} committed`} href="/dashboard/finance/cost-codes" />
        <Kpi
          icon={position.marginPct >= 15 ? TrendingUp : TrendingDown}
          label="Forecast margin"
          value={`${position.marginPct.toFixed(1)}%`}
          tone={position.marginPct >= 15 ? "good" : position.marginPct >= 5 ? "warn" : "bad"}
          sub={money(position.contract - position.actual - position.committed, true)}
          href="/dashboard/finance/project-portfolio"
        />
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded border border-red-500/40 bg-red-950/20 px-4 py-3 text-sm text-red-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />{error}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <Section title="Cash in vs cash out" hint="Cashbook, last 12 months (transfers between accounts excluded)" href="/dashboard/finance/cashbook" className="xl:col-span-2">
          <div className="h-64">
            {loading ? <ChartLoading /> : (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={cashSeries} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--dxl-ink-mid)" vertical={false} />
                  <XAxis dataKey="label" tick={axisTick} axisLine={false} tickLine={false} />
                  <YAxis tick={axisTick} axisLine={false} tickLine={false} tickFormatter={(v) => money(v, true)} width={56} />
                  <Tooltip content={<ChartTip />} cursor={{ fill: "var(--dxl-ink-mid)", opacity: 0.4 }} />
                  <Legend wrapperStyle={{ fontSize: 11, color: "var(--dxl-slate-light)" }} />
                  <Bar dataKey="inflow" name="In" fill="#34d399" radius={[2, 2, 0, 0]} maxBarSize={22} />
                  <Bar dataKey="outflow" name="Out" fill="#f87171" radius={[2, 2, 0, 0]} maxBarSize={22} />
                  <Line dataKey="net" name="Net" stroke="var(--dxl-signal)" strokeWidth={2} dot={false} type="monotone" />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
        </Section>

        <Section title="Needs attention" hint="What to act on today">
          {alerts.length === 0 ? (
            <p className="text-sm text-slate-light py-6 text-center">Nothing outstanding.</p>
          ) : (
            <ul className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
              {alerts.map((a, i) => (
                <li key={i}>
                  <Link href={a.href} className={`flex items-start gap-2 rounded border px-2.5 py-2 text-xs hover:brightness-125 ${a.tone === "bad" ? "border-red-500/30 bg-red-950/20 text-red-200" : "border-amber-500/30 bg-amber-950/15 text-amber-100"}`}>
                    <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span className="flex-1">{a.text}</span>
                    <ArrowRight className="h-3 w-3 mt-0.5 shrink-0 opacity-60" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-5">
        <Section title="Where the money went" hint="Posted project cost by category" href="/dashboard/finance/cost-codes">
          <div className="h-56 flex items-center">
            {loading ? <ChartLoading /> : costMix.length === 0 ? <Empty text="No posted costs yet." /> : (
              <>
                <div className="h-full w-1/2">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={costMix} dataKey="amount" nameKey="category" innerRadius="55%" outerRadius="90%" paddingAngle={2} stroke="none">
                        {costMix.map((c: RecordData) => <Cell key={c.category} fill={CATEGORY_COLORS[c.category] || "#94a3b8"} />)}
                      </Pie>
                      <Tooltip content={<ChartTip />} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <ul className="w-1/2 space-y-1.5 text-xs">
                  {costMix.map((c: RecordData) => (
                    <li key={c.category} className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: CATEGORY_COLORS[c.category] || "#94a3b8" }} />
                      <span className="capitalize text-slate-light flex-1">{c.category}</span>
                      <span className="text-paper tabular-nums">{money(c.amount, true)}</span>
                      <span className="text-slate w-9 text-right tabular-nums">{costMixTotal ? Math.round((c.amount / costMixTotal) * 100) : 0}%</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </Section>

        <Section title="Supplier debt by age" hint="Unpaid supplier invoices by days past due" href="/dashboard/finance/supplier-payments">
          <div className="h-56">
            {loading ? <ChartLoading /> : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={agingSeries} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--dxl-ink-mid)" vertical={false} />
                  <XAxis dataKey="label" tick={axisTick} axisLine={false} tickLine={false} interval={0} />
                  <YAxis tick={axisTick} axisLine={false} tickLine={false} tickFormatter={(v) => money(v, true)} width={52} />
                  <Tooltip content={<ChartTip />} cursor={{ fill: "var(--dxl-ink-mid)", opacity: 0.4 }} />
                  <Bar dataKey="amount" name="Owed" radius={[3, 3, 0, 0]} maxBarSize={44}>
                    {agingSeries.map((a) => <Cell key={a.key} fill={a.fill} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Section>

        <Section title="Cash by account" hint="Current balances" href="/dashboard/finance/banking">
          {loading ? <ChartLoading /> : (data?.cash_accounts || []).length === 0 ? <Empty text="No cash accounts." /> : (
            <ul className="space-y-2 max-h-56 overflow-y-auto pr-1">
              {(data?.cash_accounts || []).map((a: RecordData) => {
                const max = Math.max(...(data?.cash_accounts || []).map((x: RecordData) => Math.abs(Number(x.balance || 0))), 1);
                const pct = Math.min(100, (Math.abs(Number(a.balance || 0)) / max) * 100);
                return (
                  <li key={a.account_name} className="text-xs">
                    <div className="flex justify-between gap-2">
                      <span className="text-paper truncate">{a.account_name}{a.is_petty_cash && <span className="ml-1.5 text-[9px] uppercase font-mono text-slate">petty</span>}</span>
                      <span className={`tabular-nums ${Number(a.balance) < 0 ? "text-red-400" : "text-paper"}`}>{money(a.balance)}</span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-ink overflow-hidden">
                      <div className={`h-full ${Number(a.balance) < 0 ? "bg-red-400" : "bg-signal"}`} style={{ width: `${pct}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <Section title="Project position" hint="Contract value vs cost to date and committed" href="/dashboard/finance/project-financials" className="xl:col-span-2">
          <div style={{ height: Math.max(200, Math.min(position.projects.length, 10) * 34 + 40) }}>
            {position.projects.length === 0 ? <Empty text="No project financials yet." /> : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={position.projects.slice(0, 10)} layout="vertical" margin={{ top: 0, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--dxl-ink-mid)" horizontal={false} />
                  <XAxis type="number" tick={axisTick} axisLine={false} tickLine={false} tickFormatter={(v) => money(v, true)} />
                  <YAxis type="category" dataKey="name" tick={axisTick} axisLine={false} tickLine={false} width={170} />
                  <Tooltip content={<ChartTip />} cursor={{ fill: "var(--dxl-ink-mid)", opacity: 0.4 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="revenue" name="Contract" fill="#38bdf8" radius={[0, 2, 2, 0]} maxBarSize={12} />
                  <Bar dataKey="cost" name="Actual cost" stackId="c" fill="#f87171" maxBarSize={12} />
                  <Bar dataKey="committed" name="Committed" stackId="c" fill="#fb923c" radius={[0, 2, 2, 0]} maxBarSize={12} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Section>

        <div className="space-y-5">
          <Section title="Budgets" href="/dashboard/finance/budgets">
            <Pipeline
              rows={[
                { label: "Approved", tone: "bg-emerald-400", ...pick(budgets.approved) },
                { label: "Draft, awaiting approval", tone: "bg-amber-400", ...pick(budgets.draft) },
                { label: "Superseded", tone: "bg-slate-500", ...pick(budgets.superseded) },
              ]}
            />
          </Section>
          <Section title="Progress claims" href="/dashboard/finance/progress-claims">
            <Pipeline
              rows={[
                { label: "Submitted", tone: "bg-sky-400", ...pick(claims.submitted) },
                { label: "Certified", tone: "bg-emerald-400", ...pick(claims.certified) },
                { label: "Invoiced / paid", tone: "bg-signal", count: Number(claims.invoiced?.count || 0) + Number(claims.paid?.count || 0), amount: Number(claims.invoiced?.amount || 0) + Number(claims.paid?.amount || 0) },
              ]}
            />
          </Section>
          <Section title="Site payroll" href="/dashboard/finance/payroll">
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div><p className="text-slate">Paid this month</p><p className="text-paper text-base font-semibold tabular-nums">{money(data?.site_payroll?.paid_this_month)}</p></div>
              <div><p className="text-slate">In open runs</p><p className="text-amber-300 text-base font-semibold tabular-nums">{money(data?.site_payroll?.open_runs)}</p></div>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}

function pick(entry: RecordData | undefined) {
  return { count: Number(entry?.count || 0), amount: Number(entry?.amount || 0) };
}

function Pipeline({ rows }: { rows: { label: string; tone: string; count: number; amount: number }[] }) {
  const total = rows.reduce((s, r) => s + r.amount, 0) || 1;
  return (
    <div className="space-y-2">
      <div className="flex h-2 rounded-full overflow-hidden bg-ink">
        {rows.map((r) => <div key={r.label} className={r.tone} style={{ width: `${(r.amount / total) * 100}%` }} />)}
      </div>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2 text-xs">
          <span className={`h-2 w-2 rounded-full ${r.tone}`} />
          <span className="text-slate-light flex-1">{r.label}</span>
          <span className="text-slate tabular-nums">{r.count}</span>
          <span className="text-paper tabular-nums w-20 text-right">{money(r.amount, true)}</span>
        </div>
      ))}
    </div>
  );
}

function ChartLoading() {
  return <div className="h-full w-full flex items-center justify-center text-slate"><Loader2 className="h-5 w-5 animate-spin" /></div>;
}

function Empty({ text }: { text: string }) {
  return <div className="h-full w-full flex items-center justify-center text-sm text-slate-light">{text}</div>;
}
