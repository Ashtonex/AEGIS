"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Activity, Briefcase, Landmark, Loader2, Package, RefreshCw } from "lucide-react";
import { getExecutiveToday, type ExecutiveToday } from "@/lib/api";

// The Executive dashboard's "Today" panel (replaced the Module Gateway, which
// only listed API route groups). One request - GET /executive/today - feeds
// four tabs of things worth checking each morning.

type TabKey = "materials" | "commercial" | "activity" | "bank";
type Row = Record<string, unknown>;

const TABS: Array<{ key: TabKey; label: string; icon: typeof Package }> = [
  { key: "materials", label: "Materials", icon: Package },
  { key: "commercial", label: "Commercial", icon: Briefcase },
  { key: "activity", label: "Activity", icon: Activity },
  { key: "bank", label: "Bank", icon: Landmark },
];

function text(value: unknown, fallback = "—"): string {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function money(value: unknown, currency = "USD"): string {
  const amount = num(value);
  if (amount === null) return "—";
  const symbol = currency === "USD" ? "$" : `${currency} `;
  return `${amount < 0 ? "-" : ""}${symbol}${Math.abs(amount).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function quantity(value: unknown): string {
  const amount = num(value);
  return amount === null ? "—" : amount.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function shortDate(value: unknown): string {
  if (!value) return "—";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function timeAgo(value: unknown): string {
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "";
  const minutes = Math.round((Date.now() - date.getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return shortDate(value);
}

function dueBadge(daysLeft: unknown, blocked = false) {
  if (blocked) return <Badge tone="red">Blocked</Badge>;
  const days = num(daysLeft);
  if (days === null) return null;
  if (days < 0) return <Badge tone="red">{Math.abs(days)}d overdue</Badge>;
  if (days === 0) return <Badge tone="red">Due today</Badge>;
  return <Badge tone={days <= 3 ? "red" : "amber"}>{days}d left</Badge>;
}

function Badge({ tone, children }: { tone: "red" | "amber" | "green" | "slate"; children: React.ReactNode }) {
  const tones = {
    red: "border-red-500/40 bg-red-950/20 text-red-300",
    amber: "border-amber-500/40 bg-amber-950/20 text-amber-300",
    green: "border-emerald-500/40 bg-emerald-950/20 text-emerald-300",
    slate: "border-ink-mid text-slate-light",
  };
  return <span className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase ${tones[tone]}`}>{children}</span>;
}

function SectionTitle({ children, href, linkLabel }: { children: React.ReactNode; href?: string; linkLabel?: string }) {
  return (
    <div className="flex items-center justify-between gap-2 mb-2">
      <h3 className="font-mono text-[10px] tracking-widest text-slate uppercase">{children}</h3>
      {href && <Link href={href} className="font-mono text-[10px] text-signal hover:underline">{linkLabel || "Open"} →</Link>}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-slate py-2">{children}</p>;
}

function MaterialsTab({ data }: { data: ExecutiveToday["materials"] }) {
  const requests = data.at_risk_requests;
  const lowStock = data.low_stock;
  return (
    <div className="space-y-5">
      <div>
        <SectionTitle href="/dashboard/procurement" linkLabel="Procurement">Material requests at risk</SectionTitle>
        {requests.length === 0 ? (
          <Empty>No blocked requests, and nothing still on order that site needs within 7 days.</Empty>
        ) : (
          <ul className="space-y-2">
            {requests.map((request: Row) => (
              <li key={text(request.id)} className="border border-ink-mid bg-ink-light rounded-md p-2.5">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm text-paper min-w-0 truncate">{text(request.item, "Unnamed item")}</p>
                  {dueBadge(request.days_left, request.execution_gate_status === "blocked")}
                </div>
                <p className="text-[11px] text-slate-light mt-1 truncate">
                  {text(request.project_name, "No project")} · {text(request.request_number)}
                  {num(request.shortfall_quantity) ? ` · short ${quantity(request.shortfall_quantity)} ${text(request.unit_of_measure, "")}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <SectionTitle href="/dashboard/inventory" linkLabel="Inventory">At or below reorder level</SectionTitle>
        {lowStock.length === 0 ? (
          <Empty>Every item with a reorder level is above it.</Empty>
        ) : (
          <ul className="divide-y divide-ink-mid">
            {lowStock.map((item: Row) => (
              <li key={text(item.id)} className="flex items-center justify-between gap-3 py-2">
                <span className="text-xs text-paper min-w-0 truncate">{text(item.item_name, text(item.item_code))}</span>
                <span className="font-mono text-[11px] text-amber-300 shrink-0">
                  {quantity(item.available_qty)} / {quantity(item.reorder_level)} {text(item.unit_of_measure, "")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function CommercialTab({ data }: { data: ExecutiveToday["commercial"] }) {
  if (!data) return <Empty>The commercial briefing could not be loaded.</Empty>;
  const summary = data.summary;
  const chips: Array<{ label: string; value: number; tone: "red" | "amber" | "slate" }> = [
    { label: "Urgent tenders", value: summary.urgent_tenders, tone: summary.urgent_tenders ? "red" : "slate" },
    { label: "Paperwork gaps", value: summary.paperwork_gaps, tone: summary.paperwork_gaps ? "amber" : "slate" },
    { label: "Lost (no bid)", value: summary.lost_tenders, tone: summary.lost_tenders ? "amber" : "slate" },
    { label: "Tasks to review", value: summary.tasks_needing_review, tone: summary.tasks_needing_review ? "amber" : "slate" },
  ];
  const toneText = { red: "text-red-300", amber: "text-amber-300", slate: "text-paper" };
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2">
        {chips.map((chip) => (
          <div key={chip.label} className="border border-ink-mid bg-ink-light rounded-md p-2">
            <p className="font-mono text-[9px] uppercase tracking-widest text-slate">{chip.label}</p>
            <p className={`font-mono text-lg mt-1 ${toneText[chip.tone]}`}>{chip.value}</p>
          </div>
        ))}
      </div>
      <div>
        <SectionTitle href="/dashboard/crm/tenders" linkLabel="Tenders">Tenders due in 14 days</SectionTitle>
        {data.tenders_due.length === 0 ? (
          <Empty>No tender deadlines in the next 14 days.</Empty>
        ) : (
          <ul className="space-y-2">
            {data.tenders_due.slice(0, 6).map((tender: Row) => (
              <li key={text(tender.id)} className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs text-paper truncate">{text(tender.title)}</p>
                  <p className="text-[11px] text-slate-light">
                    {text(tender.stage)}
                    {num(tender.open_requirement_count) ? ` · ${tender.open_requirement_count} open requirements` : ""}
                  </p>
                </div>
                {dueBadge(tender.days_left)}
              </li>
            ))}
          </ul>
        )}
      </div>
      {data.paperwork_gaps.length > 0 && (
        <div>
          <SectionTitle href="/dashboard/crm" linkLabel="CRM">Paperwork gaps</SectionTitle>
          <ul className="space-y-1.5">
            {data.paperwork_gaps.slice(0, 5).map((gap: Row) => (
              <li key={text(gap.id)} className="flex items-start justify-between gap-2">
                <p className="text-[11px] text-slate-light min-w-0 truncate">
                  <span className="text-paper">{text(gap.title)}</span> · {text(gap.entity_title)}
                </p>
                {gap.severity === "critical" ? <Badge tone="red">Critical</Badge> : null}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ActivityTab({ data }: { data: ExecutiveToday["activity"] }) {
  if (data.length === 0) return <Empty>No actions by people recorded in the last 7 days.</Empty>;
  return (
    <ul className="space-y-2.5">
      {data.map((line, index) => {
        const what = line.count > 1 ? `${line.count} ${line.noun}` : line.noun;
        const body = (
          <>
            <p className="text-xs text-slate-light">
              <span className="text-paper">{line.actor}</span> {line.verb} {line.count > 1 ? what : `a ${what}`}
              {line.label ? <span className="text-paper">: {line.label}</span> : null}
            </p>
            <p className="font-mono text-[10px] text-slate mt-0.5">{timeAgo(line.happened_at)}</p>
          </>
        );
        return (
          <li key={`${line.happened_at}-${index}`} className="border-l-2 border-ink-mid pl-2.5">
            {line.href ? <Link href={line.href} className="block hover:border-signal hover:opacity-90">{body}</Link> : body}
          </li>
        );
      })}
    </ul>
  );
}

function BankTab({ data }: { data: ExecutiveToday["bank"] }) {
  return (
    <div className="space-y-5">
      <div>
        <SectionTitle>Books vs latest bank statement</SectionTitle>
        {data.accounts.length === 0 ? (
          <Empty>No active bank accounts on file.</Empty>
        ) : (
          <ul className="space-y-2">
            {data.accounts.map((account) => {
              const books = num(account.book_balance);
              const statement = num(account.statement_balance);
              const gap = books !== null && statement !== null ? books - statement : null;
              const currency = account.currency || "USD";
              return (
                <li key={account.id} className="border border-ink-mid bg-ink-light rounded-md p-2.5">
                  <p className="text-sm text-paper">{account.account_name}<span className="text-slate-light text-[11px]"> · {text(account.bank_name, "")}</span></p>
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <div>
                      <p className="font-mono text-[9px] uppercase text-slate">In the books</p>
                      <p className="font-mono text-sm text-paper">{money(books, currency)}</p>
                    </div>
                    <div>
                      <p className="font-mono text-[9px] uppercase text-slate">Bank statement</p>
                      <p className="font-mono text-sm text-paper">{money(statement, currency)}</p>
                      <p className="font-mono text-[9px] text-slate">{account.statement_date ? `as at ${shortDate(account.statement_date)}` : "no statement yet"}</p>
                    </div>
                  </div>
                  {gap !== null && Math.abs(gap) >= 1 && (
                    <p className="mt-2 text-[11px] text-amber-300">
                      Books are {money(Math.abs(gap), currency)} {gap > 0 ? "above" : "below"} the last statement.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div>
        <SectionTitle href="/dashboard/finance/bank-review" linkLabel="Tag lines">Untagged statement lines</SectionTitle>
        {data.untagged_count === 0 ? (
          <Empty>Every bank statement line is tagged.</Empty>
        ) : (
          <div className="border border-amber-500/40 bg-amber-950/20 rounded-md p-2.5">
            <p className="font-mono text-lg text-amber-300">{data.untagged_count.toLocaleString()} lines</p>
            <p className="text-[11px] text-slate-light mt-1">
              {money(data.untagged_value)} not yet allocated to a project, counterparty or category
              {data.oldest_untagged_date ? ` · oldest from ${shortDate(data.oldest_untagged_date)}` : ""}.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function attentionCount(tab: TabKey, today: ExecutiveToday): number {
  if (tab === "materials") return today.materials.at_risk_requests.length + today.materials.low_stock.length;
  if (tab === "commercial") return today.commercial ? today.commercial.summary.urgent_tenders + today.commercial.summary.paperwork_gaps : 0;
  if (tab === "bank") return today.bank.untagged_count > 0 ? 1 : 0;
  return 0;
}

export function TodayPanel() {
  const [today, setToday] = useState<ExecutiveToday | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(null);
    try {
      const res = await getExecutiveToday();
      setToday(res.data ?? null);
    } catch (error) {
      setFailed(error instanceof Error ? error.message : "Could not load today's panel.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return <TodayPanelView today={today} loading={loading} failed={failed} onRefresh={() => void load()} />;
}

export function TodayPanelView({
  today,
  loading,
  failed,
  onRefresh,
}: {
  today: ExecutiveToday | null;
  loading: boolean;
  failed: string | null;
  onRefresh: () => void;
}) {
  const [tab, setTab] = useState<TabKey | null>(null);

  // Open on the first tab that has something needing attention.
  const activeTab: TabKey = useMemo(() => {
    if (tab) return tab;
    if (!today) return "materials";
    return TABS.find(({ key }) => attentionCount(key, today) > 0)?.key ?? "activity";
  }, [tab, today]);

  return (
    <section className="bg-ink border border-ink-mid rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)] p-4 xl:col-span-1 min-h-[340px] max-h-[760px] flex flex-col">
      <div className="flex justify-between items-center border-b border-ink-mid pb-3">
        <div>
          <h2 className="font-mono text-xs tracking-widest text-paper uppercase">Today</h2>
          <p className="text-[11px] text-slate-light mt-1">What needs a look this morning.</p>
        </div>
        <button onClick={onRefresh} title="Refresh" className="text-slate hover:text-paper" disabled={loading}>
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div role="tablist" className="grid grid-cols-4 gap-1 mt-3">
        {TABS.map(({ key, label, icon: Icon }) => {
          const count = today ? attentionCount(key, today) : 0;
          const selected = activeTab === key;
          return (
            <button
              key={key}
              role="tab"
              aria-selected={selected}
              onClick={() => setTab(key)}
              className={`relative flex flex-col items-center gap-1 rounded-md border px-1 py-2 text-[10px] font-mono uppercase transition-colors ${
                selected ? "border-signal text-paper bg-ink-light" : "border-ink-mid text-slate hover:text-paper"
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
              {count > 0 && key !== "bank" && (
                <span className="absolute -top-1.5 -right-1.5 min-w-4 rounded-full bg-amber-500 px-1 text-[9px] leading-4 text-ink">{count}</span>
              )}
              {count > 0 && key === "bank" && <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-amber-500" />}
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex-1 min-h-0 overflow-y-auto pr-1">
        {loading && !today ? (
          <div className="flex items-center gap-2 text-xs text-slate py-4"><Loader2 className="h-4 w-4 animate-spin" /> Loading today&apos;s picture...</div>
        ) : failed && !today ? (
          <p className="text-xs text-red-300 py-4">{failed}</p>
        ) : today ? (
          <>
            {activeTab === "materials" && <MaterialsTab data={today.materials} />}
            {activeTab === "commercial" && <CommercialTab data={today.commercial} />}
            {activeTab === "activity" && <ActivityTab data={today.activity} />}
            {activeTab === "bank" && <BankTab data={today.bank} />}
          </>
        ) : null}
      </div>
    </section>
  );
}
