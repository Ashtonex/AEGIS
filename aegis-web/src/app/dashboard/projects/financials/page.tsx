"use client";

import React, { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  Search,
  Filter,
  ArrowRight,
  RefreshCw,
  Loader2,
  FileSpreadsheet,
  AlertTriangle,
  Receipt,
  Layers,
} from "lucide-react";
import { RBACGuard } from "@/components/auth/RBACGuard";
import { DashboardPageHeader } from "@/components/dashboard/DashboardPageHeader";
import { getInternalProjects } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";
import { title, text, number, type Project } from "../page";

export default function PortfolioFinancialsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const load = async () => {
    setLoading(true);
    try {
      const res = await getInternalProjects();
      setProjects(res.data || []);
    } catch {
      setProjects([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const financialMetrics = useMemo(() => {
    let totalContract = 0;
    let totalBudget = 0;
    let withBudgetCount = 0;

    projects.forEach((p) => {
      const cv = number(p.contract_value ?? p.budget ?? p.budget_value) ?? 0;
      const b = number(p.budget_amount ?? p.budgeted_cost) ?? 0;
      totalContract += cv;
      totalBudget += b || cv;
      if (cv > 0 || b > 0) withBudgetCount++;
    });

    const projectedMargin = totalContract > 0 ? totalContract - totalBudget : 0;
    const marginPct = totalContract > 0 ? Math.round((projectedMargin / totalContract) * 100) : 0;

    return { totalContract, totalBudget, withBudgetCount, projectedMargin, marginPct };
  }, [projects]);

  const filtered = useMemo(() => {
    return projects.filter((p) => {
      const q = query.toLowerCase();
      const matchesSearch =
        title(p).toLowerCase().includes(q) ||
        text(p.client_name ?? p.client, "").toLowerCase().includes(q);
      const matchesStatus =
        statusFilter === "all" || text(p.status, "").toLowerCase() === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [projects, query, statusFilter]);

  return (
    <RBACGuard>
      <div className="min-h-full bg-ink p-4 text-paper sm:p-6 space-y-6">
        <DashboardPageHeader
          eyebrow={{ label: "Delivery Portfolio", icon: DollarSign }}
          title="Portfolio Commercial & Financial Radar"
          subtitle="Enterprise capital exposure, contract values, budget baselines, and delivery margins."
          actions={
            <button
              onClick={() => void load()}
              disabled={loading}
              className="inline-flex h-10 items-center gap-2 border border-ink-mid bg-ink-light px-3 font-mono text-xs uppercase tracking-wider text-slate-light hover:border-signal hover:text-paper disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              <span>Refresh Ledger</span>
            </button>
          }
        />

        {/* Portfolio Financial Radar KPIs */}
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="border border-ink-mid bg-ink/70 p-4">
            <span className="font-mono text-[10px] uppercase text-slate">Recorded Portfolio Value</span>
            <p className="mt-1 font-mono text-2xl font-bold text-paper">
              {formatCurrency(financialMetrics.totalContract)}
            </p>
            <span className="text-[11px] text-slate-light">Sum of recognized project contracts</span>
          </div>

          <div className="border border-ink-mid bg-ink/70 p-4">
            <span className="font-mono text-[10px] uppercase text-slate">Target Budget Baseline</span>
            <p className="mt-1 font-mono text-2xl font-bold text-signal">
              {formatCurrency(financialMetrics.totalBudget)}
            </p>
            <span className="text-[11px] text-slate-light">Planned cost ceiling allocation</span>
          </div>

          <div className="border border-ink-mid bg-ink/70 p-4">
            <span className="font-mono text-[10px] uppercase text-slate">Projected Portfolio Margin</span>
            <div className="mt-1 flex items-baseline gap-2">
              <span className={`font-mono text-2xl font-bold ${financialMetrics.marginPct >= 15 ? "text-emerald-400" : "text-amber-400"}`}>
                {financialMetrics.marginPct}%
              </span>
              <span className="text-xs text-slate-light">
                ({formatCurrency(financialMetrics.projectedMargin)})
              </span>
            </div>
            <span className="text-[11px] text-slate-light">Commercial margin over baseline</span>
          </div>

          <div className="border border-ink-mid bg-ink/70 p-4">
            <span className="font-mono text-[10px] uppercase text-slate">Budgeted Projects</span>
            <p className="mt-1 font-mono text-2xl font-bold text-cyan-400">
              {financialMetrics.withBudgetCount} / {projects.length}
            </p>
            <span className="text-[11px] text-slate-light">Projects with commercial baseline set</span>
          </div>
        </section>

        {/* Filters */}
        <section className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-mid/60 pb-4">
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex h-10 items-center gap-2 border border-ink-mid bg-ink-light px-3">
              <Search className="h-4 w-4 text-slate" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search project or client..."
                className="w-48 sm:w-64 bg-transparent text-sm outline-none placeholder:text-slate text-paper font-sans"
              />
            </label>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-10 border border-ink-mid bg-ink-light px-3 text-sm text-paper font-mono"
            >
              <option value="all">All Statuses</option>
              <option value="active">Active</option>
              <option value="pending_deposit">Pending Deposit</option>
              <option value="pre_mobilisation">Pre-Mobilisation</option>
              <option value="planning">Planning</option>
            </select>
          </div>

          <span className="font-mono text-xs text-slate-light">
            Showing {filtered.length} of {projects.length} Projects
          </span>
        </section>

        {/* Financial Matrix Table */}
        <section className="border border-ink-mid bg-ink">
          <div className="border-b border-ink-mid p-4 flex items-center justify-between">
            <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-paper">
              Commercial Portfolio Register
            </h3>
            <span className="text-xs text-slate-light font-mono">
              Click any project to enter its Financial Workspace or Budget Planner
            </span>
          </div>

          {loading ? (
            <div className="flex h-48 items-center justify-center gap-3 text-sm text-slate-light font-mono">
              <Loader2 className="h-5 w-5 animate-spin text-signal" />
              Loading portfolio financial ledger...
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-light font-mono">
              No projects found for current criteria.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-ink-mid bg-ink-light/50 font-mono text-[11px] text-slate uppercase tracking-wider">
                    <th className="py-3 px-4">Project / Code</th>
                    <th className="py-3 px-4">Client</th>
                    <th className="py-3 px-4">Lifecycle</th>
                    <th className="py-3 px-4 text-right">Contract Value</th>
                    <th className="py-3 px-4 text-right">Target Budget</th>
                    <th className="py-3 px-4 text-right">Estimated Margin</th>
                    <th className="py-3 px-4 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-mid/40 font-mono">
                  {filtered.map((p) => {
                    const cv = number(p.contract_value ?? p.budget ?? p.budget_value) ?? 0;
                    const b = number(p.budget_amount ?? p.budgeted_cost) ?? (cv > 0 ? Math.round(cv * 0.82) : 0);
                    const margin = cv > 0 ? cv - b : 0;
                    const marginPct = cv > 0 ? Math.round((margin / cv) * 100) : 0;
                    const st = text(p.status, "planning").toLowerCase();
                    const isActive = ["active", "in progress", "live"].includes(st);

                    return (
                      <tr key={p.id} className="hover:bg-ink-light/30 transition-colors">
                        <td className="py-3 px-4">
                          <Link
                            href={`/dashboard/projects/${p.id}/financials`}
                            className="font-display font-bold text-paper hover:text-signal transition-colors block text-sm"
                          >
                            {title(p)}
                          </Link>
                          {p.project_code && (
                            <span className="text-[10px] text-slate-light font-mono">
                              {String(p.project_code)}
                            </span>
                          )}
                        </td>

                        <td className="py-3 px-4 text-slate-light font-sans text-xs">
                          {text(p.client_name ?? p.client, "Internal")}
                        </td>

                        <td className="py-3 px-4">
                          <span
                            className={`font-mono text-[10px] uppercase px-2 py-0.5 border ${
                              isActive
                                ? "border-emerald-500/40 bg-emerald-950/20 text-emerald-300"
                                : "border-slate-500/40 bg-slate-950/20 text-slate-300"
                            }`}
                          >
                            {st}
                          </span>
                        </td>

                        <td className="py-3 px-4 text-right font-bold text-paper">
                          {cv > 0 ? formatCurrency(cv) : "—"}
                        </td>

                        <td className="py-3 px-4 text-right text-signal">
                          {b > 0 ? formatCurrency(b) : "—"}
                        </td>

                        <td className="py-3 px-4 text-right">
                          {cv > 0 ? (
                            <span className={marginPct >= 15 ? "text-emerald-400 font-bold" : "text-amber-400 font-bold"}>
                              {marginPct}% ({formatCurrency(margin)})
                            </span>
                          ) : (
                            <span className="text-slate">—</span>
                          )}
                        </td>

                        <td className="py-3 px-4 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <Link
                              href={`/dashboard/projects/${p.id}/budget`}
                              className="border border-ink-mid bg-ink-light px-2.5 py-1 text-[11px] text-slate-light hover:border-signal hover:text-paper transition-colors"
                            >
                              Edit Budget
                            </Link>
                            <Link
                              href={`/dashboard/projects/${p.id}/financials`}
                              className="border border-signal/50 bg-signal/10 px-2.5 py-1 text-[11px] text-signal hover:bg-signal hover:text-ink transition-colors"
                            >
                              Financials
                            </Link>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </RBACGuard>
  );
}
