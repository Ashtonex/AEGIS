"use client";

import React, { useState, useEffect } from "react";
import {
  FileText,
  Printer,
  Download,
  X,
  Loader2,
  Calendar,
  CheckCircle2,
  AlertTriangle,
  Scale,
  Award,
  Truck,
  DollarSign,
  Layers,
  MapPin,
  Clock,
} from "lucide-react";
import { getProjectProgressPack, type ProjectProgressPackData } from "@/lib/api/projects";
import { formatCurrency, formatDate } from "@/lib/utils";

interface ProgressPackModalProps {
  projectId: string;
  onClose: () => void;
}

export function ProgressPackModal({ projectId, onClose }: ProgressPackModalProps) {
  const [loading, setLoading] = useState(true);
  const [pack, setPack] = useState<ProjectProgressPackData | null>(null);

  useEffect(() => {
    async function fetchPack() {
      try {
        const res = await getProjectProgressPack(projectId);
        if (res.data) setPack(res.data);
      } catch (err) {
        console.error("Failed to load progress pack", err);
      } finally {
        setLoading(false);
      }
    }
    void fetchPack();
  }, [projectId]);

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-2 sm:p-6 overflow-y-auto">
      <div className="w-full max-w-5xl border border-signal/50 bg-[#07090E] text-paper shadow-2xl max-h-[95vh] flex flex-col">
        {/* Top Control Bar (Hidden during print) */}
        <div className="flex items-center justify-between border-b border-ink-mid px-5 py-3 bg-ink/90 print:hidden">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-signal" />
            <h3 className="font-display text-base font-bold text-paper">
              Month-End / Client Progress Pack Preview
            </h3>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handlePrint}
              disabled={loading || !pack}
              className="inline-flex items-center gap-1.5 border border-signal bg-signal px-3.5 py-1.5 font-mono text-xs font-bold text-ink hover:bg-signal/90 transition-all disabled:opacity-50"
            >
              <Printer className="h-3.5 w-3.5" />
              <span>Print / Export PDF</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="text-slate hover:text-paper transition-colors p-1"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 sm:p-8 space-y-6 font-mono text-xs print:p-0 print:m-0 print:overflow-visible">
          {loading ? (
            <div className="flex h-72 items-center justify-center gap-3 text-slate-light">
              <Loader2 className="h-5 w-5 animate-spin text-signal" />
              Compiling multi-source operational &amp; commercial progress pack...
            </div>
          ) : !pack ? (
            <div className="p-8 text-center text-rose-400">Failed to generate progress pack.</div>
          ) : (
            <>
              {/* Executive Header Banner */}
              <div className="border-b-2 border-signal pb-5 flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 text-signal font-bold uppercase tracking-wider text-[11px]">
                    <span>SNC-AEGIS Construction Operations</span>
                    <span>·</span>
                    <span>Executive Progress Pack</span>
                  </div>
                  <h1 className="font-display text-2xl font-bold text-paper sm:text-3xl mt-1">
                    {pack.project.name}
                  </h1>
                  <p className="text-slate text-xs mt-0.5">
                    Project Code: <strong className="text-paper">{pack.project.code}</strong> | Client: <strong className="text-paper">{pack.project.client_name || "Client Principal"}</strong>
                  </p>
                </div>

                <div className="text-right">
                  <span className="border border-signal/50 bg-signal/10 px-2.5 py-1 text-[11px] font-bold uppercase text-signal">
                    Status: {pack.project.status.toUpperCase()}
                  </span>
                  <p className="text-slate text-[10px] mt-2">
                    Pack Generated: {formatDate(pack.report_generated_at)}
                  </p>
                  <p className="text-slate text-[10px]">
                    Contract Value: <strong className="text-paper">{formatCurrency(pack.project.contract_value)}</strong>
                  </p>
                </div>
              </div>

              {/* 1. Schedule & Contractual Dates */}
              <section className="space-y-3">
                <div className="flex items-center gap-2 border-b border-ink-mid pb-1.5 text-signal font-bold uppercase tracking-wider text-xs">
                  <Calendar className="h-4 w-4" />
                  <h4>1. Programme Schedule &amp; Contractual Completion Dates</h4>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-ink/50 p-3 border border-ink-mid">
                  <div>
                    <span className="text-slate text-[10px] uppercase">Commencement</span>
                    <p className="font-bold text-paper mt-0.5">{pack.project.start_date ? formatDate(pack.project.start_date) : "TBD"}</p>
                  </div>
                  <div>
                    <span className="text-slate text-[10px] uppercase">Original Target Completion</span>
                    <p className="font-bold text-paper mt-0.5">{pack.project.target_completion_date ? formatDate(pack.project.target_completion_date) : "TBD"}</p>
                  </div>
                  <div>
                    <span className="text-slate text-[10px] uppercase">EOT Approved Days</span>
                    <p className="font-bold text-emerald-400 mt-0.5">+{pack.executive_summary.eot_days_granted} Days</p>
                  </div>
                  <div>
                    <span className="text-slate text-[10px] uppercase">Revised Contractual Date</span>
                    <p className="font-bold text-signal mt-0.5">
                      {pack.project.revised_contractual_completion_date
                        ? formatDate(pack.project.revised_contractual_completion_date)
                        : pack.project.target_completion_date
                        ? formatDate(pack.project.target_completion_date)
                        : "TBD"}
                    </p>
                  </div>
                </div>

                {/* Milestone Progress Bar */}
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate">Overall Milestone Progress:</span>
                    <span className="text-signal font-bold">{pack.executive_summary.schedule_progress_pct}%</span>
                  </div>
                  <div className="h-2 w-full bg-ink-mid/60 overflow-hidden">
                    <div className="h-full bg-signal" style={{ width: `${pack.executive_summary.schedule_progress_pct}%` }} />
                  </div>
                </div>
              </section>

              {/* 2. Operational & Commercial KPI Matrix */}
              <section className="space-y-3">
                <div className="flex items-center gap-2 border-b border-ink-mid pb-1.5 text-signal font-bold uppercase tracking-wider text-xs">
                  <Layers className="h-4 w-4" />
                  <h4>2. Operational &amp; Commercial Executive Matrix</h4>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                  <div className="border border-ink-mid bg-ink p-2.5">
                    <span className="text-[10px] text-slate uppercase">Milestones</span>
                    <p className="text-lg font-bold text-paper mt-1">
                      {pack.executive_summary.completed_milestones} / {pack.executive_summary.total_milestones}
                    </p>
                    <span className="text-[10px] text-slate-light">{pack.executive_summary.critical_path_milestones} Critical</span>
                  </div>

                  <div className="border border-ink-mid bg-ink p-2.5">
                    <span className="text-[10px] text-slate uppercase">QA Pour Cards</span>
                    <p className="text-lg font-bold text-emerald-400 mt-1">
                      {pack.executive_summary.pour_cards_compliant} / {pack.executive_summary.pour_cards_total}
                    </p>
                    <span className="text-[10px] text-slate-light">{pack.executive_summary.total_concrete_volume_m3} m³ poured</span>
                  </div>

                  <div className="border border-ink-mid bg-ink p-2.5">
                    <span className="text-[10px] text-slate uppercase">Snags / Defects</span>
                    <p className="text-lg font-bold text-paper mt-1">
                      <span className="text-rose-400">{pack.executive_summary.snags_open} Open</span>
                    </p>
                    <span className="text-[10px] text-emerald-400">{pack.executive_summary.snags_closed} Resolved</span>
                  </div>

                  <div className="border border-ink-mid bg-ink p-2.5">
                    <span className="text-[10px] text-slate uppercase">Plant Deployed</span>
                    <p className="text-lg font-bold text-paper mt-1">
                      {pack.executive_summary.plant_total_deployed} Units
                    </p>
                    <span className="text-[10px] text-signal">{pack.executive_summary.plant_utilization_rate}% Util. Rate</span>
                  </div>

                  <div className="border border-ink-mid bg-ink p-2.5">
                    <span className="text-[10px] text-slate uppercase">Subcontractors</span>
                    <p className="text-lg font-bold text-paper mt-1">
                      {formatCurrency(pack.executive_summary.subcontract_certified)}
                    </p>
                    <span className="text-[10px] text-slate-light">Ret: {formatCurrency(pack.executive_summary.subcontract_retention_held)}</span>
                  </div>

                  <div className="border border-ink-mid bg-ink p-2.5">
                    <span className="text-[10px] text-slate uppercase">EOT Claims</span>
                    <p className="text-lg font-bold text-emerald-400 mt-1">
                      {pack.executive_summary.eot_days_granted} Days
                    </p>
                    <span className="text-[10px] text-slate-light">Prolong: {formatCurrency(pack.executive_summary.prolongation_approved)}</span>
                  </div>
                </div>
              </section>

              {/* 3. Contractual Delay Events & Notices */}
              {pack.delays.length > 0 && (
                <section className="space-y-2">
                  <div className="flex items-center gap-2 border-b border-ink-mid pb-1 text-signal font-bold uppercase tracking-wider text-xs">
                    <Scale className="h-4 w-4" />
                    <h4>3. Contractual Delay Notices &amp; EOT Claims</h4>
                  </div>
                  <table className="w-full text-left text-[11px] border border-ink-mid">
                    <thead className="bg-ink-light/50 border-b border-ink-mid text-slate uppercase">
                      <tr>
                        <th className="p-2">Event #</th>
                        <th className="p-2">Cause Category</th>
                        <th className="p-2">Clause</th>
                        <th className="p-2">Notice Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ink-mid/40">
                      {pack.delays.map((d) => (
                        <tr key={d.id}>
                          <td className="p-2 font-bold text-paper">{d.event_number} - {d.title}</td>
                          <td className="p-2 uppercase text-slate">{d.cause_category.replace(/_/g, " ")}</td>
                          <td className="p-2 text-signal">{d.contract_clause_reference || "Cl. 8.4"}</td>
                          <td className="p-2">
                            {d.is_time_barred ? (
                              <span className="text-rose-400 font-bold">Time-Barred</span>
                            ) : (
                              <span className="text-emerald-400 font-bold">{d.notice_status.replace(/_/g, " ")}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              )}

              {/* 4. Controlled Drawings Revision Register Summary */}
              {pack.drawings.length > 0 && (
                <section className="space-y-2">
                  <div className="flex items-center gap-2 border-b border-ink-mid pb-1 text-signal font-bold uppercase tracking-wider text-xs">
                    <FileText className="h-4 w-4" />
                    <h4>4. Controlled Drawings Register (IFC Status)</h4>
                  </div>
                  <table className="w-full text-left text-[11px] border border-ink-mid">
                    <thead className="bg-ink-light/50 border-b border-ink-mid text-slate uppercase">
                      <tr>
                        <th className="p-2">Drawing #</th>
                        <th className="p-2">Title</th>
                        <th className="p-2">Discipline</th>
                        <th className="p-2">Revision</th>
                        <th className="p-2">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ink-mid/40">
                      {pack.drawings.slice(0, 8).map((drw) => (
                        <tr key={drw.id}>
                          <td className="p-2 font-bold text-paper">{drw.drawing_number}</td>
                          <td className="p-2 text-slate-light">{drw.title}</td>
                          <td className="p-2 uppercase text-slate">{drw.discipline.replace(/_/g, " ")}</td>
                          <td className="p-2 font-bold text-signal">{drw.current_revision}</td>
                          <td className="p-2 text-emerald-400 font-semibold">{drw.ifc_status.replace(/_/g, " ")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              )}

              {/* 5. Site Progress Photo Diary */}
              {pack.recent_photos.length > 0 && (
                <section className="space-y-3">
                  <div className="flex items-center gap-2 border-b border-ink-mid pb-1 text-signal font-bold uppercase tracking-wider text-xs">
                    <MapPin className="h-4 w-4" />
                    <h4>5. Site Progress Photo Diary</h4>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                    {pack.recent_photos.slice(0, 8).map((photo) => (
                      <div key={photo.id} className="border border-ink-mid bg-ink overflow-hidden space-y-1.5 p-2">
                        <div className="aspect-video bg-ink-light/60 flex items-center justify-center overflow-hidden">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={photo.photo_url}
                            alt={photo.caption}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              // Fallback display if URL not reachable
                              (e.target as HTMLElement).style.display = "none";
                            }}
                          />
                        </div>
                        <div className="text-[10px] font-bold text-paper truncate">{photo.caption}</div>
                        <div className="flex items-center justify-between text-[9px] text-slate">
                          <span className="text-signal">{photo.element_tag}</span>
                          <span>{photo.captured_date ? formatDate(photo.captured_date) : ""}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Sign-Off Matrix */}
              <div className="pt-6 border-t border-ink-mid grid grid-cols-2 gap-8 text-[11px] text-slate">
                <div>
                  <p className="uppercase text-slate-light">Prepared by (Contractor Commercial Lead):</p>
                  <div className="mt-8 border-b border-slate-700 w-48" />
                  <p className="mt-1 text-[10px]">Name / Stamp / Date</p>
                </div>
                <div>
                  <p className="uppercase text-slate-light">Acknowledged by (Resident Engineer / Client):</p>
                  <div className="mt-8 border-b border-slate-700 w-48" />
                  <p className="mt-1 text-[10px]">Name / Stamp / Date</p>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
