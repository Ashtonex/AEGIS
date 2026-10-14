"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ClipboardCheck, CloudSun, Users, Truck, Plus, Calendar, Loader2, HardHat, ExternalLink } from "lucide-react";
import { useProject } from "@/context/ProjectWorkspaceContext";
import { createDailySiteReport } from "@/lib/api";
import { formatDate } from "@/lib/utils";

export default function ProjectSiteLogsPage() {
  const params = useParams();
  const projectId = typeof params?.id === "string" ? params.id : "";
  const { detail, refetch } = useProject();

  const siteReports = detail?.site_reports || [];

  const [isLogModalOpen, setIsLogModalOpen] = useState(false);
  const [reportDate, setReportDate] = useState(new Date().toISOString().split("T")[0]);
  const [weatherNotes, setWeatherNotes] = useState("Clear / Fine");
  const [workNotes, setWorkNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const handleCreateReport = async () => {
    if (!workNotes.trim()) return;
    setSaving(true);
    try {
      await createDailySiteReport({
        project_id: projectId,
        report_date: reportDate,
        weather: weatherNotes,
        summary: workNotes.trim(),
      });
      setIsLogModalOpen(false);
      setWorkNotes("");
      void refetch();
    } catch {
      // non-fatal
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-bold text-paper sm:text-2xl">
            Site Day &amp; Field Diary Logs
          </h2>
          <p className="mt-1 text-xs text-slate-light">
            Daily logs, engineer validations, weather delay records, and site operational entries.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/dashboard/site-operations?projectId=${projectId}`}
            className="inline-flex items-center gap-1.5 border border-ink-mid bg-ink px-3.5 py-1.5 font-mono text-xs text-slate-light hover:text-paper hover:border-signal/50 transition-colors"
          >
            <HardHat className="h-3.5 w-3.5 text-signal" />
            <span>Open in Site Operations Command</span>
            <ExternalLink className="h-3 w-3 text-slate" />
          </Link>
          <button
            type="button"
            onClick={() => setIsLogModalOpen(true)}
            className="inline-flex items-center gap-1.5 border border-signal bg-signal px-3.5 py-1.5 font-mono text-xs font-bold uppercase tracking-wider text-ink hover:bg-signal/90 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Log Daily Report</span>
          </button>
        </div>
      </div>

      {/* Reports Feed */}
      <section className="border border-ink-mid bg-ink">
        <div className="border-b border-ink-mid p-4 flex items-center justify-between">
          <span className="font-mono text-xs font-bold uppercase tracking-wider text-paper">
            Field Reports History
          </span>
          <span className="font-mono text-xs text-slate-light">
            {siteReports.length} Reports Logged
          </span>
        </div>

        {siteReports.length === 0 ? (
          <div className="py-12 text-center text-xs text-slate-light font-mono">
            No daily site reports logged for this project yet. Click &quot;Log Daily Report&quot; to record site progress.
          </div>
        ) : (
          <div className="divide-y divide-ink-mid/40">
            {siteReports.map((rep, idx) => (
              <div key={idx} className="p-4 hover:bg-ink-light/20 transition-colors space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-paper">
                      {formatDate(String(rep.report_date || rep.created_at || ""))}
                    </span>
                    {Boolean(rep.weather) && (
                      <span className="inline-flex items-center gap-1 border border-ink-mid bg-ink-light/40 px-2 py-0.5 font-mono text-[10px] text-slate-light">
                        <CloudSun className="h-3 w-3 text-signal" />
                        {String(rep.weather)}
                      </span>
                    )}
                  </div>
                  <span className="font-mono text-[10px] uppercase text-emerald-400 border border-emerald-500/30 px-2 py-0.5">
                    {String(rep.status || "verified")}
                  </span>
                </div>

                <p className="text-xs text-paper leading-relaxed font-sans">
                  {String(rep.summary || rep.notes || rep.work_completed || "Daily site operations completed.")}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Log Modal */}
      {isLogModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md border border-ink-mid bg-ink p-6 shadow-2xl space-y-4">
            <h3 className="font-display text-lg font-bold text-paper">Log Daily Site Report</h3>
            <div>
              <label className="block text-xs font-mono uppercase text-slate">Report Date</label>
              <input
                type="date"
                value={reportDate}
                onChange={(e) => setReportDate(e.target.value)}
                className="mt-1 w-full border border-ink-mid bg-ink-light p-2 text-xs text-paper outline-none focus:border-signal font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-mono uppercase text-slate">Weather & Site Conditions</label>
              <input
                value={weatherNotes}
                onChange={(e) => setWeatherNotes(e.target.value)}
                placeholder="e.g. Sunny / 24°C / Ground dry"
                className="mt-1 w-full border border-ink-mid bg-ink-light p-2 text-xs text-paper outline-none focus:border-signal"
              />
            </div>
            <div>
              <label className="block text-xs font-mono uppercase text-slate">Work Completed / Notes *</label>
              <textarea
                rows={4}
                value={workNotes}
                onChange={(e) => setWorkNotes(e.target.value)}
                placeholder="Describe works executed, trades active, inspections passed..."
                className="mt-1 w-full border border-ink-mid bg-ink-light p-2 text-xs text-paper outline-none focus:border-signal"
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsLogModalOpen(false)}
                className="border border-ink-mid px-4 py-2 font-mono text-xs text-slate-light hover:text-paper"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateReport}
                disabled={saving || !workNotes.trim()}
                className="border border-signal bg-signal px-4 py-2 font-mono text-xs font-bold uppercase text-ink hover:bg-signal/90 disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save Daily Report"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
