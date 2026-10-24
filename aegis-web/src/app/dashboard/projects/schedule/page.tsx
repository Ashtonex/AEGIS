"use client";

import React, { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import {
  CalendarDays,
  Search,
  Filter,
  ArrowRight,
  Activity,
  Layers,
  Clock,
  BriefcaseBusiness,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { RBACGuard } from "@/components/auth/RBACGuard";
import { DashboardPageHeader } from "@/components/dashboard/DashboardPageHeader";
import { getInternalProjects } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { title, text, number, type Project } from "../page";

export default function PortfolioSchedulePage() {
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

  const filtered = useMemo(() => {
    return projects.filter((p) => {
      const q = query.toLowerCase();
      const matchesSearch =
        title(p).toLowerCase().includes(q) ||
        text(p.client_name ?? p.client, "").toLowerCase().includes(q) ||
        text(p.location, "").toLowerCase().includes(q);
      const matchesStatus =
        statusFilter === "all" || text(p.status, "").toLowerCase() === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [projects, query, statusFilter]);

  const activeProjectsCount = projects.filter((p) =>
    ["active", "in progress", "live"].includes(text(p.status, "").toLowerCase())
  ).length;

  return (
    <RBACGuard>
      <div className="min-h-full bg-ink p-4 text-paper sm:p-6 space-y-6">
        <DashboardPageHeader
          eyebrow={{ label: "Delivery Portfolio", icon: CalendarDays }}
          title="Portfolio Master Schedule"
          subtitle="Multi-project milestone timeline and programme execution tracking across all active sites."
          actions={
            <button
              onClick={() => void load()}
              disabled={loading}
              className="inline-flex h-10 items-center gap-2 border border-ink-mid bg-ink-light px-3 font-mono text-xs uppercase tracking-wider text-slate-light hover:border-signal hover:text-paper disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              <span>Refresh Schedule</span>
            </button>
          }
        />

        {/* Portfolio Schedule KPIs */}
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="border border-ink-mid bg-ink/70 p-4">
            <span className="font-mono text-[10px] uppercase text-slate">Total Projects</span>
            <p className="mt-1 font-mono text-2xl font-bold text-paper">{projects.length}</p>
            <span className="text-[11px] text-slate-light">Scheduled across enterprise</span>
          </div>

          <div className="border border-ink-mid bg-ink/70 p-4">
            <span className="font-mono text-[10px] uppercase text-slate">Active On Site</span>
            <p className="mt-1 font-mono text-2xl font-bold text-emerald-400">{activeProjectsCount}</p>
            <span className="text-[11px] text-slate-light">Live site programme execution</span>
          </div>

          <div className="border border-ink-mid bg-ink/70 p-4">
            <span className="font-mono text-[10px] uppercase text-slate">Mobilisation Queue</span>
            <p className="mt-1 font-mono text-2xl font-bold text-amber-300">
              {projects.filter((p) => ["pre_mobilisation", "pending_deposit"].includes(text(p.status, "").toLowerCase())).length}
            </p>
            <span className="text-[11px] text-slate-light">Awaiting readiness or deposit</span>
          </div>

          <div className="border border-ink-mid bg-ink/70 p-4">
            <span className="font-mono text-[10px] uppercase text-slate">Planning & Design</span>
            <p className="mt-1 font-mono text-2xl font-bold text-sky-400">
              {projects.filter((p) => text(p.status, "").toLowerCase() === "planning").length}
            </p>
            <span className="text-[11px] text-slate-light">Pre-construction scheduling</span>
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
              <option value="pre_mobilisation">Pre-Mobilisation</option>
              <option value="pending_deposit">Pending Deposit</option>
              <option value="planning">Planning</option>
              <option value="completed">Completed</option>
            </select>
          </div>

          <span className="font-mono text-xs text-slate-light">
            Showing {filtered.length} of {projects.length} Projects
          </span>
        </section>

        {/* Master Timeline Grid */}
        <section className="border border-ink-mid bg-ink">
          <div className="border-b border-ink-mid p-4 flex items-center justify-between">
            <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-paper">
              Master Project Programme Timeline
            </h3>
            <span className="text-xs text-slate-light font-mono">
              Click any project to enter its dedicated Schedule Studio
            </span>
          </div>

          {loading ? (
            <div className="flex h-48 items-center justify-center gap-3 text-sm text-slate-light font-mono">
              <Loader2 className="h-5 w-5 animate-spin text-signal" />
              Loading portfolio schedule data...
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-light font-mono">
              No projects matched your schedule query.
            </div>
          ) : (
            <div className="divide-y divide-ink-mid/40">
              {filtered.map((p) => {
                const progress = Math.min(100, Math.max(0, number(p.progress ?? p.progress_pct) ?? 0));
                const st = text(p.status, "planning").toLowerCase();
                const isActive = ["active", "in progress", "live"].includes(st);

                return (
                  <Link
                    key={p.id}
                    href={`/dashboard/projects/${p.id}/schedule`}
                    className="block p-4 hover:bg-ink-light/30 transition-colors group"
                  >
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div className="space-y-1 max-w-xl">
                        <div className="flex items-center gap-2">
                          <span className="font-display font-bold text-paper text-base group-hover:text-signal transition-colors">
                            {title(p)}
                          </span>
                          <span
                            className={`font-mono text-[10px] uppercase px-2 py-0.5 border ${
                              isActive
                                ? "border-emerald-500/40 bg-emerald-950/20 text-emerald-300"
                                : "border-slate-500/40 bg-slate-950/20 text-slate-300"
                            }`}
                          >
                            {st}
                          </span>
                        </div>
                        <p className="text-xs text-slate-light">
                          Client: <strong className="text-paper font-normal">{text(p.client_name ?? p.client, "Internal")}</strong>
                          {p.location && ` • Location: ${text(p.location)}`}
                        </p>
                      </div>

                      {/* Dates & Visual Progress Bar */}
                      <div className="flex flex-col sm:flex-row sm:items-center gap-4 lg:min-w-[420px] justify-end">
                        <div className="font-mono text-xs text-slate-light text-right">
                          <span className="block text-paper">
                            {p.start_date ? formatDate(String(p.start_date)) : "No Start"} →{" "}
                            {p.planned_completion_date ? formatDate(String(p.planned_completion_date)) : "Open End"}
                          </span>
                          <span className="text-[11px] text-slate">
                            {progress}% Progress
                          </span>
                        </div>

                        <div className="w-36 sm:w-44 h-2 bg-ink-light rounded-full overflow-hidden border border-ink-mid">
                          <div
                            className={`h-full transition-all duration-300 ${
                              isActive ? "bg-signal" : "bg-slate"
                            }`}
                            style={{ width: `${progress}%` }}
                          />
                        </div>

                        <div className="hidden sm:flex items-center text-slate group-hover:text-signal transition-colors">
                          <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
                        </div>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </RBACGuard>
  );
}
