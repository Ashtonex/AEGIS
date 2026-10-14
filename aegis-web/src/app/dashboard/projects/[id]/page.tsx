"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Banknote,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  DollarSign,
  FileSpreadsheet,
  FileText,
  Layers,
  MapPin,
  Package,
  Receipt,
  Send,
  ShieldCheck,
  TrendingUp,
  Users,
} from "lucide-react";
import { useProject } from "@/context/ProjectWorkspaceContext";
import { formatCurrency, formatDate } from "@/lib/utils";
import { title, text, number } from "@/lib/projects/types";
export { title, text, number };

export default function ProjectMissionControlPage() {
  const params = useParams();
  const projectId = typeof params?.id === "string" ? params.id : "";
  const { project, detail, milestones, team, loading } = useProject();

  const source = detail?.project ?? project;

  const contractValue = useMemo(() => {
    return number(source?.contract_value ?? source?.budget ?? source?.budget_value) ?? 0;
  }, [source]);

  const budgetedCost = useMemo(() => {
    return number(source?.budget_amount ?? source?.budgeted_cost ?? (detail as any)?.viability?.[0]?.budget_amount) ?? 0;
  }, [source, detail]);

  const actualCost = useMemo(() => {
    return number(source?.actual_cost ?? source?.actual_cost_to_date ?? source?.cost_to_date) ?? 0;
  }, [source]);

  const committedCost = useMemo(() => {
    return number(source?.committed_cost ?? source?.commitments) ?? 0;
  }, [source]);

  const exposure = actualCost + committedCost;
  const costExposurePct = budgetedCost > 0 ? Math.min(100, Math.round((exposure / budgetedCost) * 100)) : 0;
  const progressPct = Math.min(100, Math.max(0, number(source?.progress ?? source?.progress_pct) ?? 0));

  const quickLaunch = [
    {
      title: "Interactive Budget Planner",
      desc: "Direct editable spreadsheet builder with cost codes, line items, and BOQ import.",
      href: `/dashboard/projects/${projectId}/budget`,
      icon: FileSpreadsheet,
      badge: budgetedCost > 0 ? formatCurrency(budgetedCost) : "Draft Open",
      tone: "text-signal border-signal/30 bg-signal/10",
    },
    {
      title: "Financials & Cash Curve",
      desc: "Commercial exposure, margin slippage, claims certificates, and cashflow tracking.",
      href: `/dashboard/projects/${projectId}/financials`,
      icon: DollarSign,
      badge: `${costExposurePct}% Burn`,
      tone: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
    },
    {
      title: "Schedule & Gantt Studio",
      desc: "Milestones, baseline vs forecast comparison, critical path timeline.",
      href: `/dashboard/projects/${projectId}/schedule`,
      icon: CalendarDays,
      badge: `${milestones.length} Milestones`,
      tone: "text-sky-400 border-sky-500/30 bg-sky-500/10",
    },
    {
      title: "Materials & Supply Chain",
      desc: "BOQ material allowances, purchase orders, site GRNs, and consumption.",
      href: `/dashboard/projects/${projectId}/materials`,
      icon: Package,
      badge: `${(detail?.material_records || []).length} Records`,
      tone: "text-amber-400 border-amber-500/30 bg-amber-500/10",
    },
    {
      title: "Site Day & Field Logs",
      desc: "Labour attendance, daily diary, weather observations, and QA/QC notes.",
      href: `/dashboard/projects/${projectId}/site-logs`,
      icon: ClipboardCheck,
      badge: `${(detail?.site_reports || []).length} Reports`,
      tone: "text-violet-400 border-violet-500/30 bg-violet-500/10",
    },
    {
      title: "Governance & Fast-Track Gates",
      desc: "Pre-mobilisation checks, commercial clearance, and authorized fast-track.",
      href: `/dashboard/projects/${projectId}/controls`,
      icon: ShieldCheck,
      badge: text(source?.status, "planning").toUpperCase(),
      tone: "text-rose-400 border-rose-500/30 bg-rose-500/10",
    },
  ];

  return (
    <div className="space-y-6">
      {/* Top Telemetry Grid */}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="border border-ink-mid bg-ink/70 p-4">
          <div className="flex items-center justify-between text-xs font-mono text-slate">
            <span>PHYSICAL PROGRESS</span>
            <Activity className="h-4 w-4 text-signal" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-display text-2xl font-bold text-paper sm:text-3xl">{progressPct}%</span>
            <span className="text-xs text-slate-light">reported completion</span>
          </div>
          <div className="mt-3 h-1.5 w-full bg-ink-light rounded-full overflow-hidden">
            <div className="h-full bg-signal transition-all duration-500" style={{ width: `${progressPct}%` }} />
          </div>
        </div>

        <div className="border border-ink-mid bg-ink/70 p-4">
          <div className="flex items-center justify-between text-xs font-mono text-slate">
            <span>BUDGET EXPOSURE</span>
            <DollarSign className="h-4 w-4 text-emerald-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-display text-2xl font-bold text-paper sm:text-3xl">
              {budgetedCost > 0 ? `${costExposurePct}%` : "No Budget"}
            </span>
            <span className="text-xs text-slate-light">of budget allocated</span>
          </div>
          <p className="mt-2 text-xs text-slate-light truncate">
            Actual: <strong className="text-paper font-normal">{formatCurrency(actualCost)}</strong> + Comm: <strong className="text-paper font-normal">{formatCurrency(committedCost)}</strong>
          </p>
        </div>

        <div className="border border-ink-mid bg-ink/70 p-4">
          <div className="flex items-center justify-between text-xs font-mono text-slate">
            <span>WORKFORCE ON SITE</span>
            <Users className="h-4 w-4 text-cyan-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-display text-2xl font-bold text-paper sm:text-3xl">{team.length}</span>
            <span className="text-xs text-slate-light">allocated artisans & staff</span>
          </div>
          <p className="mt-2 text-xs text-slate-light">
            Linked to live HR project allocations
          </p>
        </div>

        <div className="border border-ink-mid bg-ink/70 p-4">
          <div className="flex items-center justify-between text-xs font-mono text-slate">
            <span>LIFECYCLE STATUS</span>
            <ShieldCheck className="h-4 w-4 text-amber-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-display text-2xl font-bold text-paper sm:text-3xl uppercase tracking-wide">
              {text(source?.status, "planning")}
            </span>
          </div>
          <p className="mt-2 text-xs text-slate-light">
            {source?.status === "active" ? "In active site execution" : "Requires mobilization readiness"}
          </p>
        </div>
      </section>

      {/* Primary Workspaces Grid */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-mono text-sm font-bold uppercase tracking-wider text-paper">
            Project Command Modules
          </h2>
          <span className="text-xs text-slate-light font-mono">Select a module to view its full dedicated page</span>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {quickLaunch.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.title}
                href={item.href}
                className="group relative flex flex-col justify-between border border-ink-mid bg-ink/80 p-5 hover:border-signal hover:bg-ink-light/40 transition-all duration-200"
              >
                <div>
                  <div className="flex items-center justify-between">
                    <div className={`p-2 rounded-sm border ${item.tone}`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <span className="font-mono text-[11px] uppercase tracking-wider border border-ink-mid bg-ink-light/50 px-2 py-0.5 text-slate-light group-hover:text-paper group-hover:border-signal/40">
                      {item.badge}
                    </span>
                  </div>

                  <h3 className="mt-4 font-display text-lg font-bold text-paper group-hover:text-signal transition-colors">
                    {item.title}
                  </h3>
                  <p className="mt-1 text-xs text-slate-light leading-relaxed">
                    {item.desc}
                  </p>
                </div>

                <div className="mt-5 flex items-center gap-1.5 text-xs font-mono font-medium text-slate group-hover:text-signal transition-colors">
                  <span>Enter Module</span>
                  <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-1 transition-transform" />
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Live Operational Ledger & Telemetry Signals */}
      <section className="grid gap-5 lg:grid-cols-3">
        <div className="border border-ink-mid bg-ink/70 p-5 lg:col-span-2">
          <div className="flex items-center justify-between border-b border-ink-mid/60 pb-3">
            <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-paper">
              Live System-of-Record Evidence
            </h3>
            <span className="font-mono text-[10px] text-slate-light uppercase">Real ERP Records</span>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="border border-ink-mid/60 bg-ink-light/20 p-3">
              <span className="font-mono text-[10px] uppercase text-slate">Site Reports</span>
              <p className="mt-1 font-mono text-xl font-bold text-paper">
                {(detail?.site_reports || []).length}
              </p>
              <p className="mt-0.5 text-[11px] text-slate-light">Logged on site</p>
            </div>

            <div className="border border-ink-mid/60 bg-ink-light/20 p-3">
              <span className="font-mono text-[10px] uppercase text-slate">Material Records</span>
              <p className="mt-1 font-mono text-xl font-bold text-paper">
                {(detail?.material_records || []).length}
              </p>
              <p className="mt-0.5 text-[11px] text-slate-light">Receipts & issues</p>
            </div>

            <div className="border border-ink-mid/60 bg-ink-light/20 p-3">
              <span className="font-mono text-[10px] uppercase text-slate">Procurement Orders</span>
              <p className="mt-1 font-mono text-xl font-bold text-paper">
                {(detail?.procurement_orders || []).length}
              </p>
              <p className="mt-0.5 text-[11px] text-slate-light">POs issued</p>
            </div>

            <div className="border border-ink-mid/60 bg-ink-light/20 p-3">
              <span className="font-mono text-[10px] uppercase text-slate">Milestones Tracked</span>
              <p className="mt-1 font-mono text-xl font-bold text-paper">
                {milestones.length}
              </p>
              <p className="mt-0.5 text-[11px] text-slate-light">Programme targets</p>
            </div>

            <div className="border border-ink-mid/60 bg-ink-light/20 p-3">
              <span className="font-mono text-[10px] uppercase text-slate">Change Requests</span>
              <p className="mt-1 font-mono text-xl font-bold text-paper">
                {(detail?.changes || []).length}
              </p>
              <p className="mt-0.5 text-[11px] text-slate-light">Scope variations</p>
            </div>

            <div className="border border-ink-mid/60 bg-ink-light/20 p-3">
              <span className="font-mono text-[10px] uppercase text-slate">Risks Identified</span>
              <p className="mt-1 font-mono text-xl font-bold text-paper">
                {(detail?.risks || []).length}
              </p>
              <p className="mt-0.5 text-[11px] text-slate-light">Open & mitigating</p>
            </div>
          </div>
        </div>

        {/* Site Profile & Coordinates */}
        <div className="border border-ink-mid bg-ink/70 p-5">
          <div className="border-b border-ink-mid/60 pb-3">
            <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-paper">
              Site & Regional Coordinates
            </h3>
          </div>

          <div className="mt-4 space-y-3 text-xs">
            <div>
              <span className="font-mono text-[10px] uppercase text-slate">Region / Province</span>
              <p className="mt-0.5 font-medium text-paper">
                {text(source?.region || (detail as any)?.viability?.[0]?.region, "Not specified")}
              </p>
            </div>

            <div>
              <span className="font-mono text-[10px] uppercase text-slate">Site Location</span>
              <p className="mt-0.5 font-medium text-paper">
                {text(source?.location || (detail as any)?.viability?.[0]?.site_location, "No site address recorded")}
              </p>
            </div>

            <div>
              <span className="font-mono text-[10px] uppercase text-slate">GPS Coordinates</span>
              <p className="mt-0.5 font-mono text-paper">
                {source?.latitude && source?.longitude
                  ? `${source.latitude}, ${source.longitude}`
                  : "No coordinates pinned"}
              </p>
            </div>

            <div>
              <span className="font-mono text-[10px] uppercase text-slate">Client Organization</span>
              <p className="mt-0.5 font-medium text-paper">
                {text(source?.client_name, "Internal / Direct")}
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
