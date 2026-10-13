"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle, ArrowRight, CheckCircle2, CircleAlert, Clock, CreditCard,
  FileCheck, FileText, Landmark, RefreshCw, ShieldAlert, Sparkles, Wallet,
} from "lucide-react";

export type ActionSeverity = "critical" | "attention" | "info";
export type ActionCategory = "banking" | "claims" | "payables" | "accounting" | "projects";

export interface FinanceActionItem {
  id: string;
  category: ActionCategory;
  severity: ActionSeverity;
  title: string;
  description: string;
  amount?: number;
  currency?: string;
  projectOrCounterparty?: string;
  ageOrDueDate?: string;
  href: string;
  actionLabel: string;
}

function money(value?: number, currency = "USD") {
  if (value === undefined || value === null) return "";
  return new Intl.NumberFormat("en-ZW", { style: "currency", currency, maximumFractionDigits: 0 }).format(
    Number.isFinite(value) ? value : 0,
  );
}

const SEVERITY_STYLES: Record<
  ActionSeverity,
  { badge: string; text: string; icon: typeof AlertTriangle }
> = {
  critical: {
    badge: "border-red-500/30 bg-red-950/20 text-red-300",
    text: "text-red-300",
    icon: AlertTriangle,
  },
  attention: {
    badge: "border-amber-500/30 bg-amber-950/20 text-amber-300",
    text: "text-amber-300",
    icon: CircleAlert,
  },
  info: {
    badge: "border-sky-500/30 bg-sky-950/20 text-sky-300",
    text: "text-sky-300",
    icon: Clock,
  },
};

const CATEGORY_LABELS: Record<ActionCategory, string> = {
  banking: "Treasury & Bank",
  claims: "Claims & AR",
  payables: "Payables & AP",
  accounting: "GL & Close",
  projects: "Projects",
};

export function FinanceActionInbox({
  items,
  loading = false,
  onRefresh,
}: {
  items: FinanceActionItem[];
  loading?: boolean;
  onRefresh?: () => void;
}) {
  const [filter, setFilter] = useState<"all" | "critical" | ActionCategory>("all");

  const counts = useMemo(() => {
    return {
      all: items.length,
      critical: items.filter((i) => i.severity === "critical").length,
      banking: items.filter((i) => i.category === "banking").length,
      claims: items.filter((i) => i.category === "claims").length,
      payables: items.filter((i) => i.category === "payables").length,
      accounting: items.filter((i) => i.category === "accounting").length,
      projects: items.filter((i) => i.category === "projects").length,
    };
  }, [items]);

  const filteredItems = useMemo(() => {
    if (filter === "all") return items;
    if (filter === "critical") return items.filter((i) => i.severity === "critical");
    return items.filter((i) => i.category === filter);
  }, [items, filter]);

  return (
    <section className="bg-ink-light border border-ink-mid rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)] p-4 sm:p-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-ink-mid">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-sm bg-signal/10 border border-signal/30 text-signal">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-mono text-xs uppercase tracking-wider text-paper font-semibold">
                Financial Operations Action Inbox
              </h3>
              {counts.all > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono font-semibold bg-signal text-ink">
                  {counts.all}
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-light mt-0.5">
              Prioritized operational exceptions, compliance gates, and approvals requiring review.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-center">
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading}
              className="inline-flex items-center gap-1.5 text-xs text-slate hover:text-paper px-2.5 py-1.5 rounded-sm border border-ink-mid hover:border-signal/40 transition-colors disabled:opacity-50"
              title="Refresh inbox items"
            >
              <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin text-signal" : ""}`} />
              <span className="font-mono text-[10px] uppercase">Sync</span>
            </button>
          )}
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex flex-wrap items-center gap-1.5 mt-3 mb-4 font-mono text-[11px]">
        <button
          type="button"
          onClick={() => setFilter("all")}
          className={`px-2.5 py-1 rounded-sm border transition-colors ${
            filter === "all"
              ? "bg-signal text-ink border-signal font-semibold"
              : "border-ink-mid text-slate hover:text-paper"
          }`}
        >
          All ({counts.all})
        </button>
        {counts.critical > 0 && (
          <button
            type="button"
            onClick={() => setFilter("critical")}
            className={`px-2.5 py-1 rounded-sm border transition-colors ${
              filter === "critical"
                ? "bg-red-950/60 text-red-200 border-red-500 font-semibold"
                : "border-red-500/30 text-red-300 hover:bg-red-950/20"
            }`}
          >
            Critical ({counts.critical})
          </button>
        )}
        {counts.banking > 0 && (
          <button
            type="button"
            onClick={() => setFilter("banking")}
            className={`px-2.5 py-1 rounded-sm border transition-colors ${
              filter === "banking"
                ? "bg-signal text-ink border-signal font-semibold"
                : "border-ink-mid text-slate hover:text-paper"
            }`}
          >
            Treasury ({counts.banking})
          </button>
        )}
        {counts.claims > 0 && (
          <button
            type="button"
            onClick={() => setFilter("claims")}
            className={`px-2.5 py-1 rounded-sm border transition-colors ${
              filter === "claims"
                ? "bg-signal text-ink border-signal font-semibold"
                : "border-ink-mid text-slate hover:text-paper"
            }`}
          >
            Claims & AR ({counts.claims})
          </button>
        )}
        {counts.payables > 0 && (
          <button
            type="button"
            onClick={() => setFilter("payables")}
            className={`px-2.5 py-1 rounded-sm border transition-colors ${
              filter === "payables"
                ? "bg-signal text-ink border-signal font-semibold"
                : "border-ink-mid text-slate hover:text-paper"
            }`}
          >
            Payables ({counts.payables})
          </button>
        )}
        {counts.accounting > 0 && (
          <button
            type="button"
            onClick={() => setFilter("accounting")}
            className={`px-2.5 py-1 rounded-sm border transition-colors ${
              filter === "accounting"
                ? "bg-signal text-ink border-signal font-semibold"
                : "border-ink-mid text-slate hover:text-paper"
            }`}
          >
            GL & Close ({counts.accounting})
          </button>
        )}
        {counts.projects > 0 && (
          <button
            type="button"
            onClick={() => setFilter("projects")}
            className={`px-2.5 py-1 rounded-sm border transition-colors ${
              filter === "projects"
                ? "bg-signal text-ink border-signal font-semibold"
                : "border-ink-mid text-slate hover:text-paper"
            }`}
          >
            Projects ({counts.projects})
          </button>
        )}
      </div>

      {/* Inbox Items List */}
      {filteredItems.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 px-4 text-center border border-dashed border-ink-mid rounded bg-ink/30">
          <CheckCircle2 className="h-8 w-8 text-emerald-400 mb-2" />
          <p className="text-sm font-medium text-paper">Operational Queues Clear</p>
          <p className="text-xs text-slate-light max-w-sm mt-0.5">
            No pending exceptions or critical actions found in this filter. All financial postings and reconciliations are in order.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-ink-mid border border-ink-mid rounded bg-ink/20">
          {filteredItems.map((item) => {
            const style = SEVERITY_STYLES[item.severity];
            const SeverityIcon = style.icon;

            return (
              <div
                key={item.id}
                className="p-3.5 flex flex-col md:flex-row md:items-center justify-between gap-3 hover:bg-ink-mid/10 transition-colors"
              >
                <div className="flex items-start gap-3 min-w-0">
                  <span
                    className={`mt-0.5 px-1.5 py-0.5 rounded-sm border text-[9px] uppercase font-mono tracking-wider flex items-center gap-1 shrink-0 ${style.badge}`}
                  >
                    <SeverityIcon className="h-3 w-3" />
                    {item.severity}
                  </span>

                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="font-mono text-[10px] uppercase tracking-wider text-slate">
                        {CATEGORY_LABELS[item.category]}
                      </span>
                      {item.projectOrCounterparty && (
                        <span className="text-[11px] text-paper font-medium">
                          • {item.projectOrCounterparty}
                        </span>
                      )}
                    </div>

                    <p className="text-sm text-paper font-medium mt-0.5">
                      {item.title}
                    </p>
                    <p className="text-xs text-slate-light mt-0.5">
                      {item.description}
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between md:justify-end gap-4 shrink-0 pl-7 md:pl-0">
                  <div className="text-left md:text-right">
                    {item.amount !== undefined && (
                      <p className="text-sm font-semibold text-paper font-mono tabular-nums">
                        {money(item.amount, item.currency)}
                      </p>
                    )}
                    {item.ageOrDueDate && (
                      <p className="text-[10px] text-slate font-mono uppercase tracking-wider">
                        {item.ageOrDueDate}
                      </p>
                    )}
                  </div>

                  <Link
                    href={item.href}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-xs font-mono uppercase tracking-wider bg-ink-light border border-ink-mid hover:border-signal hover:text-signal text-paper transition-colors shrink-0"
                  >
                    <span>{item.actionLabel}</span>
                    <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
