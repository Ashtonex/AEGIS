"use client";

import React, { useState, useEffect } from "react";
import {
  Users,
  Clock,
  ShieldCheck,
  AlertTriangle,
  DollarSign,
  FileText,
  Calendar,
  CheckCircle2,
  XCircle,
  TrendingUp,
  Award,
  Printer,
  RefreshCw,
  X,
  HardHat,
  Compass,
  Scale,
  Briefcase,
} from "lucide-react";
import { getProjectLeadershipDossier } from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/utils";

interface LeadershipDossierData {
  project: {
    id: string;
    name: string;
    project_code: string;
    client_name: string;
    contract_value: number;
    status: string;
    health_status: string;
  };
  period: {
    month: string;
    start_date: string;
    end_date: string;
    working_days: number;
    days_elapsed: number;
  };
  discipline_score: number;
  engineer: {
    name: string;
    role: string;
    reports_filed: number;
    reporting_compliance_pct: number;
    reports_with_issues: number;
    reports_with_delays: number;
    milestones_total: number;
    milestones_completed: number;
    milestones_completion_pct: number;
    recent_delays: Array<{
      report_date: string;
      work_summary?: string;
      issues_notes?: string;
      delays_notes?: string;
    }>;
    verdict: string;
    talking_points: string[];
  };
  foreman: {
    name: string;
    role: string;
    briefings_conducted: number;
    briefing_compliance_pct: number;
    avg_daily_headcount: number;
    active_site_days: number;
    total_man_shifts: number;
    total_regular_hours: number;
    total_overtime_hours: number;
    overtime_ratio_pct: number;
    verdict: string;
    talking_points: string[];
  };
  qs: {
    name: string;
    role: string;
    total_labour_cost: number;
    total_plant_cost: number;
    total_material_cost: number;
    total_direct_site_cost: number;
    weekly_budgets_count: number;
    planned_weekly_budget: number;
    variance_to_weekly_budget: number;
    total_variations_count: number;
    total_variation_amount: number;
    approved_variation_amount: number;
    pending_variation_amount: number;
    pending_qs_reviews: number;
    verdict: string;
    talking_points: string[];
  };
  action_agenda: string[];
}

export function LeadershipAccountabilityModal({
  projectId,
  projectName,
  onClose,
}: {
  projectId: string;
  projectName?: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<LeadershipDossierData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });

  const loadDossier = async (monthStr: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await getProjectLeadershipDossier(projectId, monthStr);
      setData(res.data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load leadership dossier";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (projectId) {
      void loadDossier(selectedMonth);
    }
  }, [projectId, selectedMonth]);

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="relative w-full max-w-5xl rounded-2xl border border-ink-mid/80 bg-[#0B0E14] text-paper shadow-2xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header Bar */}
        <div className="flex items-center justify-between border-b border-ink-mid/60 bg-ink-light/20 px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-signal/40 bg-signal/10 text-signal">
              <Award className="h-5 w-5" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-paper">
                  Month-End Leadership Accountability Dossier
                </h2>
                <span className="rounded bg-signal/20 px-2 py-0.5 font-mono text-[11px] font-bold text-signal">
                  AEGIS Prime
                </span>
              </div>
              <p className="text-xs text-slate-light">
                Executive review card for Site Engineer, General Foreman & Quantity Surveyor on{" "}
                <strong className="text-paper">{projectName || data?.project.name || "Project"}</strong>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="rounded-lg border border-ink-mid bg-ink px-2.5 py-1 font-mono text-xs text-paper focus:outline-none focus:border-signal"
            />
            <button
              onClick={() => void loadDossier(selectedMonth)}
              title="Refresh Dossier"
              className="rounded-lg border border-ink-mid bg-ink p-1.5 text-slate-light hover:text-paper"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </button>
            <button
              onClick={handlePrint}
              title="Print Dossier"
              className="rounded-lg border border-ink-mid bg-ink p-1.5 text-slate-light hover:text-paper"
            >
              <Printer className="h-4 w-4" />
            </button>
            <button
              onClick={onClose}
              className="rounded-lg border border-ink-mid bg-ink p-1.5 text-slate-light hover:text-paper"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {loading && (
            <div className="flex flex-col items-center justify-center py-20 text-slate">
              <RefreshCw className="h-8 w-8 animate-spin text-signal" />
              <p className="mt-3 font-mono text-xs">Assembling project leadership performance dossier...</p>
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-rose-500/40 bg-rose-950/20 p-4 text-xs text-rose-300">
              <div className="flex items-center gap-2 font-bold">
                <AlertTriangle className="h-4 w-4" /> Error Loading Dossier
              </div>
              <p className="mt-1">{error}</p>
            </div>
          )}

          {data && !loading && (
            <>
              {/* Executive Summary Bar */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 rounded-xl border border-ink-mid/70 bg-ink/50 p-4">
                <div>
                  <span className="font-mono text-[10px] uppercase text-slate">Project & Client</span>
                  <div className="mt-1 font-semibold text-paper truncate">{data.project.name}</div>
                  <div className="text-xs text-slate-light">{data.project.client_name} · {data.project.project_code}</div>
                </div>

                <div>
                  <span className="font-mono text-[10px] uppercase text-slate">Review Period</span>
                  <div className="mt-1 font-mono text-sm font-semibold text-paper">{data.period.month}</div>
                  <div className="text-xs text-slate-light">
                    {data.period.days_elapsed} / {data.period.working_days} working days elapsed
                  </div>
                </div>

                <div>
                  <span className="font-mono text-[10px] uppercase text-slate">Direct Site Cost Burn</span>
                  <div className="mt-1 font-mono text-sm font-bold text-paper">
                    {formatCurrency(data.qs.total_direct_site_cost)}
                  </div>
                  <div className="text-xs text-slate-light">
                    Labour: {formatCurrency(data.qs.total_labour_cost)} · Materials: {formatCurrency(data.qs.total_material_cost)}
                  </div>
                </div>

                <div className="flex items-center justify-between border-l border-ink-mid/40 pl-4">
                  <div>
                    <span className="font-mono text-[10px] uppercase text-slate">Site Discipline Score</span>
                    <div className="mt-1 flex items-baseline gap-1">
                      <span className={`font-mono text-2xl font-black ${data.discipline_score >= 80 ? "text-emerald-400" : data.discipline_score >= 65 ? "text-amber-400" : "text-rose-400"}`}>
                        {data.discipline_score}
                      </span>
                      <span className="font-mono text-xs text-slate">/100</span>
                    </div>
                  </div>
                  <div className={`rounded-full p-2 border ${data.discipline_score >= 80 ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400" : "border-amber-500/40 bg-amber-500/10 text-amber-400"}`}>
                    <Award className="h-6 w-6" />
                  </div>
                </div>
              </div>

              {/* The Three Pillars: Engineer, Foreman, QS */}
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
                {/* 1. SITE ENGINEER */}
                <div className="rounded-xl border border-sky-500/30 bg-[#0C121E] p-4 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between border-b border-sky-500/20 pb-3">
                      <div className="flex items-center gap-2">
                        <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-sky-500/30 bg-sky-500/10 text-sky-400">
                          <Compass className="h-4 w-4" />
                        </span>
                        <div>
                          <div className="font-bold text-sm text-paper">{data.engineer.name}</div>
                          <div className="font-mono text-[10px] uppercase text-sky-400">{data.engineer.role}</div>
                        </div>
                      </div>
                    </div>

                    <div className="mt-3">
                      <span className={`inline-block rounded px-2 py-0.5 font-mono text-[10px] font-bold uppercase ${
                        data.engineer.verdict.includes("EXEMPLARY")
                          ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                          : data.engineer.verdict.includes("STABLE")
                          ? "bg-sky-500/20 text-sky-300 border border-sky-500/30"
                          : "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                      }`}>
                        {data.engineer.verdict}
                      </span>
                    </div>

                    {/* Stats Grid */}
                    <div className="mt-4 grid grid-cols-2 gap-2 border-y border-sky-500/20 py-3 text-xs">
                      <div>
                        <span className="text-slate">Reports Filed:</span>
                        <div className="font-mono font-bold text-paper">
                          {data.engineer.reports_filed} <span className="text-[10px] text-slate font-normal">({data.engineer.reporting_compliance_pct}%)</span>
                        </div>
                      </div>
                      <div>
                        <span className="text-slate">Delays Logged:</span>
                        <div className="font-mono font-bold text-paper">
                          {data.engineer.reports_with_delays} events
                        </div>
                      </div>
                      <div>
                        <span className="text-slate">Milestones:</span>
                        <div className="font-mono font-bold text-paper">
                          {data.engineer.milestones_completed}/{data.engineer.milestones_total} ({data.engineer.milestones_completion_pct}%)
                        </div>
                      </div>
                      <div>
                        <span className="text-slate">Obstacles Flagged:</span>
                        <div className="font-mono font-bold text-paper">
                          {data.engineer.reports_with_issues} notes
                        </div>
                      </div>
                    </div>

                    {/* Talking Points */}
                    <div className="mt-3">
                      <span className="font-mono text-[10px] uppercase tracking-wider text-slate">Accountability Mandate:</span>
                      <ul className="mt-1.5 space-y-1.5 text-xs text-slate-light">
                        {data.engineer.talking_points.map((pt, i) => (
                          <li key={i} className="flex items-start gap-1.5">
                            <span className="text-sky-400 mt-0.5">•</span>
                            <span>{pt}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  {data.engineer.recent_delays.length > 0 && (
                    <div className="mt-4 rounded border border-ink-mid/40 bg-ink/40 p-2.5 text-[11px]">
                      <span className="font-mono text-[10px] uppercase text-amber-400 font-semibold">Latest Site Delay Note:</span>
                      <p className="mt-1 text-slate-light italic">
                        &quot;{data.engineer.recent_delays[0].delays_notes || data.engineer.recent_delays[0].issues_notes}&quot;
                      </p>
                      <span className="block mt-1 font-mono text-[9px] text-slate">
                        Recorded {data.engineer.recent_delays[0].report_date}
                      </span>
                    </div>
                  )}
                </div>

                {/* 2. SITE FOREMAN */}
                <div className="rounded-xl border border-amber-500/30 bg-[#16120B] p-4 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between border-b border-amber-500/20 pb-3">
                      <div className="flex items-center gap-2">
                        <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-400">
                          <HardHat className="h-4 w-4" />
                        </span>
                        <div>
                          <div className="font-bold text-sm text-paper">{data.foreman.name}</div>
                          <div className="font-mono text-[10px] uppercase text-amber-400">{data.foreman.role}</div>
                        </div>
                      </div>
                    </div>

                    <div className="mt-3">
                      <span className={`inline-block rounded px-2 py-0.5 font-mono text-[10px] font-bold uppercase ${
                        data.foreman.verdict.includes("DISCIPLINED")
                          ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                          : data.foreman.verdict.includes("ELEVATED")
                          ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                          : "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                      }`}>
                        {data.foreman.verdict}
                      </span>
                    </div>

                    {/* Stats Grid */}
                    <div className="mt-4 grid grid-cols-2 gap-2 border-y border-amber-500/20 py-3 text-xs">
                      <div>
                        <span className="text-slate">Morning Briefings:</span>
                        <div className="font-mono font-bold text-paper">
                          {data.foreman.briefings_conducted} <span className="text-[10px] text-slate font-normal">({data.foreman.briefing_compliance_pct}%)</span>
                        </div>
                      </div>
                      <div>
                        <span className="text-slate">Avg Daily Crew:</span>
                        <div className="font-mono font-bold text-paper">
                          {data.foreman.avg_daily_headcount} workers
                        </div>
                      </div>
                      <div>
                        <span className="text-slate">Regular Hours:</span>
                        <div className="font-mono font-bold text-paper">
                          {data.foreman.total_regular_hours.toLocaleString()} hrs
                        </div>
                      </div>
                      <div>
                        <span className="text-slate">Overtime Hours:</span>
                        <div className={`font-mono font-bold ${data.foreman.overtime_ratio_pct > 15 ? "text-amber-400" : "text-paper"}`}>
                          {data.foreman.total_overtime_hours.toLocaleString()} hrs ({data.foreman.overtime_ratio_pct}%)
                        </div>
                      </div>
                    </div>

                    {/* Talking Points */}
                    <div className="mt-3">
                      <span className="font-mono text-[10px] uppercase tracking-wider text-slate">Accountability Mandate:</span>
                      <ul className="mt-1.5 space-y-1.5 text-xs text-slate-light">
                        {data.foreman.talking_points.map((pt, i) => (
                          <li key={i} className="flex items-start gap-1.5">
                            <span className="text-amber-400 mt-0.5">•</span>
                            <span>{pt}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  <div className="mt-4 rounded border border-ink-mid/40 bg-ink/40 p-2.5 text-[11px]">
                    <span className="font-mono text-[10px] uppercase text-slate">Labour Payroll Exposure:</span>
                    <div className="mt-1 flex items-baseline justify-between">
                      <span className="font-mono font-bold text-paper">{formatCurrency(data.foreman.total_regular_hours * 7.5)} standard</span>
                      <span className="font-mono text-amber-300 font-semibold">{data.foreman.total_man_shifts} site shifts</span>
                    </div>
                  </div>
                </div>

                {/* 3. QUANTITY SURVEYOR (QS) */}
                <div className="rounded-xl border border-emerald-500/30 bg-[#0B1510] p-4 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between border-b border-emerald-500/20 pb-3">
                      <div className="flex items-center gap-2">
                        <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
                          <Scale className="h-4 w-4" />
                        </span>
                        <div>
                          <div className="font-bold text-sm text-paper">{data.qs.name}</div>
                          <div className="font-mono text-[10px] uppercase text-emerald-400">{data.qs.role}</div>
                        </div>
                      </div>
                    </div>

                    <div className="mt-3">
                      <span className={`inline-block rounded px-2 py-0.5 font-mono text-[10px] font-bold uppercase ${
                        data.qs.verdict.includes("SOUND")
                          ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                          : data.qs.verdict.includes("EXPOSURE")
                          ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                          : "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                      }`}>
                        {data.qs.verdict}
                      </span>
                    </div>

                    {/* Stats Grid */}
                    <div className="mt-4 grid grid-cols-2 gap-2 border-y border-emerald-500/20 py-3 text-xs">
                      <div>
                        <span className="text-slate">Weekly Budgets:</span>
                        <div className="font-mono font-bold text-paper">
                          {data.qs.weekly_budgets_count} budgets
                        </div>
                      </div>
                      <div>
                        <span className="text-slate">Budget Variance:</span>
                        <div className={`font-mono font-bold ${data.qs.variance_to_weekly_budget > 0 ? "text-amber-400" : "text-emerald-400"}`}>
                          {data.qs.variance_to_weekly_budget > 0 ? `+${formatCurrency(data.qs.variance_to_weekly_budget)}` : formatCurrency(data.qs.variance_to_weekly_budget)}
                        </div>
                      </div>
                      <div>
                        <span className="text-slate">Approved Claims:</span>
                        <div className="font-mono font-bold text-emerald-400">
                          {formatCurrency(data.qs.approved_variation_amount)}
                        </div>
                      </div>
                      <div>
                        <span className="text-slate">Pending Sign-off:</span>
                        <div className={`font-mono font-bold ${data.qs.pending_variation_amount > 0 ? "text-rose-400" : "text-paper"}`}>
                          {formatCurrency(data.qs.pending_variation_amount)}
                        </div>
                      </div>
                    </div>

                    {/* Talking Points */}
                    <div className="mt-3">
                      <span className="font-mono text-[10px] uppercase tracking-wider text-slate">Accountability Mandate:</span>
                      <ul className="mt-1.5 space-y-1.5 text-xs text-slate-light">
                        {data.qs.talking_points.map((pt, i) => (
                          <li key={i} className="flex items-start gap-1.5">
                            <span className="text-emerald-400 mt-0.5">•</span>
                            <span>{pt}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  <div className="mt-4 rounded border border-ink-mid/40 bg-ink/40 p-2.5 text-[11px]">
                    <span className="font-mono text-[10px] uppercase text-slate">Variation Recovery Ratio:</span>
                    <div className="mt-1 flex items-baseline justify-between">
                      <span className="font-mono text-paper">
                        {data.qs.total_variations_count} total variations
                      </span>
                      <span className={`font-mono font-bold ${data.qs.pending_qs_reviews > 0 ? "text-amber-400" : "text-emerald-400"}`}>
                        {data.qs.pending_qs_reviews} pending QS review
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Executive Action Punchlist */}
              <div className="rounded-xl border border-signal/40 bg-signal/10 p-5">
                <div className="flex items-center gap-2 border-b border-signal/20 pb-3">
                  <Briefcase className="h-5 w-5 text-signal" />
                  <h4 className="font-mono text-xs font-bold uppercase tracking-wider text-signal">
                    Executive Month-End Prime Agenda (Lay On The Table)
                  </h4>
                </div>
                <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
                  {data.action_agenda.map((item, idx) => (
                    <div key={idx} className="rounded-lg border border-signal/20 bg-ink/50 p-3 text-xs text-paper">
                      <div className="font-mono text-[10px] font-bold text-signal mb-1">
                        ACTION ITEM 0{idx + 1}
                      </div>
                      <p className="text-slate-light">{item}</p>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-ink-mid/60 bg-ink-light/20 px-6 py-3 flex items-center justify-between">
          <span className="font-mono text-[11px] text-slate">
            AEGIS Operational Cohesion Engine · Real-Time Project ERP Integration
          </span>
          <button
            onClick={onClose}
            className="rounded-lg border border-ink-mid bg-ink px-4 py-1.5 font-mono text-xs text-paper hover:border-signal"
          >
            Close Dossier
          </button>
        </div>
      </div>
    </div>
  );
}
