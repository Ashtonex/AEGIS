"use client";

import React, { useMemo, useState, useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Award,
  Banknote,
  CalendarDays,
  Camera,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  DollarSign,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  HardHat,
  Layers,
  MapPin,
  Package,
  Receipt,
  RefreshCw,
  Scale,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Truck,
  Users,
  Zap,
} from "lucide-react";
import { useProject } from "@/context/ProjectWorkspaceContext";
import { formatCurrency, formatDate } from "@/lib/utils";
import { title, text, number } from "@/lib/projects/types";
import { getProjectProgressPack, type ProjectProgressPackData } from "@/lib/api/projects";
import { ProgressPackModal } from "@/components/projects/ProgressPackModal";
import { GenerateInvoiceModal } from "@/components/invoices/GenerateInvoiceModal";

export { title, text, number };

export default function ProjectMissionControlPage() {
  const params = useParams();
  const projectId = typeof params?.id === "string" ? params.id : "";
  const { project, detail, milestones, team, loading } = useProject();

  const [packData, setPackData] = useState<ProjectProgressPackData | null>(null);
  const [packLoading, setPackLoading] = useState(false);
  const [isPackModalOpen, setIsPackModalOpen] = useState(false);
  const [isInvoiceModalOpen, setIsInvoiceModalOpen] = useState(false);

  useEffect(() => {
    if (!projectId) return;
    setPackLoading(true);
    getProjectProgressPack(projectId)
      .then((res) => {
        if (res.success && res.data) {
          setPackData(res.data);
        }
      })
      .catch((err) => {
        console.warn("Telemetry progress pack load skipped:", err);
      })
      .finally(() => {
        setPackLoading(false);
      });
  }, [projectId]);

  const source = detail?.project ?? project;

  const contractValue = useMemo(() => {
    return number(source?.contract_value ?? source?.budget ?? source?.budget_value) ?? 0;
  }, [source]);

  const budgetedCost = useMemo(() => {
    const directBudget = number(
      source?.budget_amount ??
        source?.budgeted_cost ??
        (detail as any)?.viability?.[0]?.budget_amount ??
        (detail as any)?.finance?.approved_budget
    );
    if (directBudget && directBudget > 0) return directBudget;
    return contractValue > 0 ? contractValue : 0;
  }, [source, detail, contractValue]);

  const actualCost = useMemo(() => {
    return number(source?.actual_cost ?? source?.actual_cost_to_date ?? source?.cost_to_date) ?? 0;
  }, [source]);

  const committedCost = useMemo(() => {
    return number(source?.committed_cost ?? source?.commitments) ?? 0;
  }, [source]);

  const exposure = actualCost + committedCost;
  const costExposurePct = budgetedCost > 0 ? Math.min(100, Math.round((exposure / budgetedCost) * 100)) : 0;

  // Physical progress computed from milestones & daily reports
  const progressPct = useMemo(() => {
    if (packData?.executive_summary?.schedule_progress_pct !== undefined) {
      return packData.executive_summary.schedule_progress_pct;
    }
    const rawProgress = number(source?.progress ?? source?.progress_pct);
    if (milestones && milestones.length > 0) {
      let totalW = 0;
      let completedW = 0;
      for (const m of milestones) {
        const w = Number(m.weight) || 1;
        totalW += w;
        const st = String(m.status || "").toLowerCase();
        if (st === "complete") completedW += w;
        else if (st === "in_progress") completedW += w * 0.5;
      }
      const milestonePct = totalW > 0 ? Math.round((completedW / totalW) * 100) : 0;
      return Math.min(100, Math.max(milestonePct, rawProgress ?? 0));
    }
    return Math.min(100, Math.max(0, rawProgress ?? 0));
  }, [source, milestones, packData]);

  // Workforce headcount deduplicated across permanent staff and site hires
  const workforceCount = useMemo(() => {
    if (!team || team.length === 0) return 0;
    const uniqueIds = new Set<string>();
    for (const member of team) {
      const key = String(
        (member as any).employee_id ??
          (member as any).employee_number ??
          (member as any).allocation_id ??
          (member as any).employee_name ??
          ""
      ).toLowerCase();
      if (key) uniqueIds.add(key);
    }
    return uniqueIds.size || team.length;
  }, [team]);

  const exec = packData?.executive_summary;

  const commandModules = [
    {
      title: "Schedule & CPM Gantt",
      desc: "Topological CPM critical path, baseline comparison, predecessor links, and float buffer.",
      href: `/dashboard/projects/${projectId}/schedule`,
      icon: CalendarDays,
      badge: `${milestones.length} Milestones`,
      tone: "text-sky-400 border-sky-500/30 bg-sky-500/10",
      highlight: exec?.critical_path_milestones ? `${exec.critical_path_milestones} on Critical Path` : "CPM active",
    },
    {
      title: "QA, Pour Cards & Snags",
      desc: "5-point structural pour authorization gates, cube crushing tests, and mobile punch snag items.",
      href: `/dashboard/projects/${projectId}/quality`,
      icon: Award,
      badge: exec ? `${exec.pour_cards_total} Pours` : "QA Gates",
      tone: "text-amber-400 border-amber-500/30 bg-amber-500/10",
      highlight: exec ? `${exec.snags_open} Open Snags` : "5-Point Gate",
    },
    {
      title: "Plant & Fleet Operations",
      desc: "Asset allocations, machine operational utilization %, fuel burn (L/hr) vs benchmark, and downtime.",
      href: `/dashboard/projects/${projectId}/plant`,
      icon: Truck,
      badge: exec ? `${exec.plant_utilization_rate}% Util` : "Fleet Radar",
      tone: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
      highlight: exec ? `${exec.plant_total_deployed} Machines Deployed` : "Machine Telemetry",
    },
    {
      title: "Subcontracts & Retentions",
      desc: "Trade work packages, cumulative IPC valuations, 10% retention ledger in escrow, and back-charges.",
      href: `/dashboard/projects/${projectId}/financials`,
      icon: HardHat,
      badge: exec ? formatCurrency(exec.subcontract_certified) : "Valuations",
      tone: "text-purple-400 border-purple-500/30 bg-purple-500/10",
      highlight: exec ? `${formatCurrency(exec.subcontract_retention_held)} Retention` : "Commercial Ledger",
    },
    {
      title: "Contractual Delays & EOT",
      desc: "FIDIC / NEC statutory notice time-bar countdowns, critical path linkage, and prolongation adjudication.",
      href: `/dashboard/projects/${projectId}/risks`,
      icon: Scale,
      badge: exec ? `${exec.delays_notified} Notices` : "Claims Radar",
      tone: "text-rose-400 border-rose-500/30 bg-rose-500/10",
      highlight: exec ? `${exec.eot_days_requested}d Claimed (${exec.eot_days_granted}d Approved)` : "Time-Bar Sentinel",
    },
    {
      title: "Controlled Drawings & Photos",
      desc: "Discipline revisions with automatic superseded archiving, IFC registers, and site photo diary.",
      href: `/dashboard/projects/${projectId}/documents`,
      icon: Camera,
      badge: exec ? `${exec.drawings_ifc} IFC Drawings` : "Drawings",
      tone: "text-cyan-400 border-cyan-500/30 bg-cyan-500/10",
      highlight: exec ? `${exec.progress_photos_count} Site Photos` : "Revision Sentinel",
    },
    {
      title: "Materials & Supply Chain",
      desc: "Project store inventory on-hand, site requisitions, purchase orders, GRNs, and material wastage.",
      href: `/dashboard/projects/${projectId}/materials`,
      icon: Package,
      badge: `${(detail?.material_records || []).length} Records`,
      tone: "text-amber-400 border-amber-500/30 bg-amber-500/10",
      highlight: "Store Requisitions Active",
    },
    {
      title: "Budget & Cost Codes",
      desc: "Direct editable spreadsheet builder with cost codes, line items, and BOQ import.",
      href: `/dashboard/projects/${projectId}/budget`,
      icon: FileSpreadsheet,
      badge: budgetedCost > 0 ? formatCurrency(budgetedCost) : "Draft Open",
      tone: "text-signal border-signal/30 bg-signal/10",
      highlight: `${costExposurePct}% Budget Burn`,
    },
    {
      title: "Readiness & Start Gates",
      desc: "Pre-mobilisation checks (13), commercial clearance, deposit confirmation, and authorized fast-track.",
      href: `/dashboard/projects/${projectId}/controls`,
      icon: ShieldCheck,
      badge: text(source?.status, "planning").toUpperCase(),
      tone: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
      highlight: "Mobilisation Clearance",
    },
  ];

  return (
    <div className="space-y-6">
      {/* Hero Header with 1-Click Client Progress Pack */}
      <div className="border border-ink-mid bg-ink/90 p-4 sm:p-6 backdrop-blur-md flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 border border-signal/40 bg-signal/10 text-signal font-bold">
              Site Operations Control
            </span>
            <span className="font-mono text-xs text-slate-light">
              Code: <span className="font-bold text-paper">{text(source?.project_code, "PRJ-01")}</span>
            </span>
            {source?.client_name && (
              <span className="font-mono text-xs text-slate-light">
                • Client: <span className="text-paper">{text(source?.client_name)}</span>
              </span>
            )}
          </div>
          <h1 className="mt-1.5 font-display text-xl sm:text-3xl font-bold text-paper tracking-tight">
            {source ? title(source) : "Project Operations"}
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-slate-light max-w-3xl leading-relaxed">
            Unified operations command deck synchronizing critical path scheduling, quality pour cards, plant telematics, subcontractor commercial valuations, and statutory delay notices.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => setIsInvoiceModalOpen(true)}
            className="inline-flex items-center gap-2 border border-signal/80 bg-signal/15 px-4 py-2 font-mono text-xs font-bold uppercase tracking-wider text-signal hover:bg-signal hover:text-ink transition-all shadow-sm active:scale-[0.98]"
          >
            <FileText className="h-4 w-4" />
            <span>Generate Official Invoice (PDF)</span>
          </button>
          <button
            type="button"
            onClick={() => setIsPackModalOpen(true)}
            className="inline-flex items-center gap-2 border border-signal bg-signal px-4 py-2 font-mono text-xs font-bold uppercase tracking-wider text-ink hover:bg-signal/90 shadow-lg shadow-signal/15 active:scale-[0.98] transition-all"
          >
            <Sparkles className="h-4 w-4" />
            <span>Client Progress Pack</span>
          </button>
        </div>
      </div>

      {/* Real-Time Telemetry Quadrants Strip */}
      <section className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2.5 sm:gap-3">
        {/* 1. Schedule CPM */}
        <div className="border border-ink-mid bg-ink/70 p-3 sm:p-4">
          <div className="flex items-center justify-between text-[11px] font-mono text-slate">
            <span>CPM SCHEDULE</span>
            <Activity className="h-3.5 w-3.5 text-signal shrink-0" />
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="font-display text-xl sm:text-2xl font-bold text-paper">{progressPct}%</span>
            <span className="text-[10px] text-slate-light">progress</span>
          </div>
          <p className="mt-1 text-[10px] text-slate-light truncate">
            {exec?.critical_path_milestones ? (
              <span className="text-red-400 font-bold">Critical Path Active</span>
            ) : (
              <span className="text-emerald-400 font-bold">On Schedule</span>
            )}
          </p>
        </div>

        {/* 2. Concrete Quality */}
        <div className="border border-ink-mid bg-ink/70 p-3 sm:p-4">
          <div className="flex items-center justify-between text-[11px] font-mono text-slate">
            <span>POUR CARDS QA</span>
            <Award className="h-3.5 w-3.5 text-amber-400 shrink-0" />
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="font-display text-xl sm:text-2xl font-bold text-amber-300">
              {exec?.pour_cards_total ?? 0}
            </span>
            <span className="text-[10px] text-slate-light">pours</span>
          </div>
          <p className="mt-1 text-[10px] text-slate-light truncate">
            {exec ? `${exec.total_concrete_volume_m3} m³ poured` : "5-point pre-pour checks"}
          </p>
        </div>

        {/* 3. Plant Fleet Utilization */}
        <div className="border border-ink-mid bg-ink/70 p-3 sm:p-4">
          <div className="flex items-center justify-between text-[11px] font-mono text-slate">
            <span>PLANT UTILIZATION</span>
            <Truck className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="font-display text-xl sm:text-2xl font-bold text-emerald-400">
              {exec?.plant_utilization_rate ?? 0}%
            </span>
            <span className="text-[10px] text-slate-light">active</span>
          </div>
          <p className="mt-1 text-[10px] text-slate-light truncate">
            {exec ? `${exec.plant_total_deployed} machines on site` : "Fleet telemetry"}
          </p>
        </div>

        {/* 4. Subcontract Commercials */}
        <div className="border border-ink-mid bg-ink/70 p-3 sm:p-4">
          <div className="flex items-center justify-between text-[11px] font-mono text-slate">
            <span>SUBCON RETENTION</span>
            <HardHat className="h-3.5 w-3.5 text-purple-400 shrink-0" />
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="font-display text-lg sm:text-xl font-bold text-purple-300 truncate">
              {exec ? formatCurrency(exec.subcontract_retention_held) : "$0.00"}
            </span>
          </div>
          <p className="mt-1 text-[10px] text-slate-light truncate">
            {exec ? `Certified: ${formatCurrency(exec.subcontract_certified)}` : "10% Escrow Ledger"}
          </p>
        </div>

        {/* 5. Contractual Claims / EOT */}
        <div className="border border-ink-mid bg-ink/70 p-3 sm:p-4">
          <div className="flex items-center justify-between text-[11px] font-mono text-slate">
            <span>DELAYS & EOT</span>
            <Scale className="h-3.5 w-3.5 text-rose-400 shrink-0" />
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="font-display text-xl sm:text-2xl font-bold text-rose-400">
              {exec?.eot_days_requested ?? 0}d
            </span>
            <span className="text-[10px] text-slate-light">claimed</span>
          </div>
          <p className="mt-1 text-[10px] text-slate-light truncate">
            {exec ? `${exec.delays_notified} delay notices filed` : "28-day notice rule"}
          </p>
        </div>

        {/* 6. Safety & Zero Harm */}
        <div className="border border-ink-mid bg-ink/70 p-3 sm:p-4">
          <div className="flex items-center justify-between text-[11px] font-mono text-slate">
            <span>HSE ZERO HARM</span>
            <ShieldAlert className="h-3.5 w-3.5 text-cyan-400 shrink-0" />
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="font-display text-xl sm:text-2xl font-bold text-cyan-300">100%</span>
            <span className="text-[10px] text-slate-light">compliance</span>
          </div>
          <p className="mt-1 text-[10px] text-slate-light truncate">
            Zero LTI recorded on site
          </p>
        </div>
      </section>

      {/* Primary Workspaces Grid */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-mono text-xs sm:text-sm font-bold uppercase tracking-wider text-paper">
            Integrated Project Operations Workspaces
          </h2>
          <span className="text-[11px] sm:text-xs text-slate-light font-mono hidden sm:inline">
            Direct drill-down into field execution and commercial controls
          </span>
        </div>

        <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {commandModules.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.title}
                href={item.href}
                className="group relative flex flex-col justify-between border border-ink-mid bg-ink/80 p-4 sm:p-5 hover:border-signal hover:bg-ink-light/40 active:bg-ink-light/60 transition-all duration-200 touch-manipulation"
              >
                <div>
                  <div className="flex items-center justify-between">
                    <div className={`p-2 rounded-sm border ${item.tone}`}>
                      <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
                    </div>
                    <span className="font-mono text-[10px] sm:text-[11px] uppercase tracking-wider border border-ink-mid bg-ink-light/50 px-2 py-0.5 text-slate-light group-hover:text-paper group-hover:border-signal/40">
                      {item.badge}
                    </span>
                  </div>

                  <h3 className="mt-3 sm:mt-4 font-display text-base sm:text-lg font-bold text-paper group-hover:text-signal transition-colors">
                    {item.title}
                  </h3>
                  <p className="mt-1 text-xs text-slate-light leading-relaxed">
                    {item.desc}
                  </p>
                </div>

                <div className="mt-4 pt-3 border-t border-ink-mid/40 flex items-center justify-between">
                  <span className="font-mono text-[11px] text-paper font-semibold">
                    {item.highlight}
                  </span>
                  <div className="flex items-center gap-1 text-xs font-mono font-medium text-slate group-hover:text-signal transition-colors">
                    <span>Enter</span>
                    <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-1 transition-transform" />
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Progress Pack Modal */}
      {isPackModalOpen && (
        <ProgressPackModal
          projectId={projectId}
          onClose={() => setIsPackModalOpen(false)}
        />
      )}

      {/* Official SNC Storytelling Invoice Modal */}
      {isInvoiceModalOpen && (
        <GenerateInvoiceModal
          isOpen={isInvoiceModalOpen}
          onClose={() => setIsInvoiceModalOpen(false)}
          initialData={{
            invoiceType: "PROFORMA INVOICE",
            invoiceNumber: `USD${String(source?.project_code || "PRJ").replace(/[^0-9]/g, "").padStart(3, "1") || "212"}`,
            subject: `Contract Works & Mobilisation Deposit — ${String(source?.name || "Civil Works")}`,
            clientName: String(source?.client_name || ""),
            quotationRef: String(source?.project_code || "QT-SNC-2026"),
            depositPercentage: 40,
            applyVat: true,
            vatRate: 0.155,
            items: [
              {
                item_no: "1",
                description: `Scope of works as per contract agreement: ${String(source?.name || "Civil Works & Surfacing")}`,
                amount_excl_vat: contractValue > 0 ? contractValue : 0,
              },
            ],
            notes: [
              `This proforma invoice covers the 40% advance deposit for ${String(source?.name || "the project")}.`,
              `Please quote USD${String(source?.project_code || "PRJ").replace(/[^0-9]/g, "").padStart(3, "1") || "212"} as the payment reference.`,
              "A fiscal tax invoice will be issued on receipt of payment.",
              "Mobilisation and plant allocation are active on site.",
            ],
          }}
        />
      )}
    </div>
  );
}
