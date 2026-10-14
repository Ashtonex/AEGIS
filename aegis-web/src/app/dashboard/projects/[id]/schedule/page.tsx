"use client";

import React, { useState, useMemo, useCallback } from "react";
import { useParams } from "next/navigation";
import {
  CalendarDays,
  Plus,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Play,
  RotateCcw,
  Loader2,
  Users,
} from "lucide-react";
import { useProject } from "@/context/ProjectWorkspaceContext";
import { addProjectMilestone, updateProjectMilestone } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { text } from "@/lib/projects/types";

export default function ProjectSchedulePage() {
  const params = useParams();
  const projectId = typeof params?.id === "string" ? params.id : "";
  const { milestones, refetch, project, detail } = useProject();

  const [filter, setFilter] = useState<string>("all");
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [name, setName] = useState("");
  const [baselineDate, setBaselineDate] = useState("");
  const [forecastDate, setForecastDate] = useState("");
  const [weight, setWeight] = useState("10");
  const [saving, setSaving] = useState(false);

  const filtered = useMemo(() => {
    return milestones.filter((m) => {
      if (filter === "all") return true;
      return String(m.status).toLowerCase() === filter;
    });
  }, [milestones, filter]);

  const handleAddMilestone = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await addProjectMilestone(projectId, {
        name: name.trim(),
        baseline_date: baselineDate || undefined,
        forecast_date: forecastDate || undefined,
        weight: Number(weight) || 0,
      });
      setIsAddOpen(false);
      setName("");
      setBaselineDate("");
      setForecastDate("");
      void refetch();
    } catch {
      // non-fatal
    } finally {
      setSaving(false);
    }
  };

  const handleAdvanceStatus = async (milestone: Record<string, unknown>) => {
    const current = String(milestone.status || "not_started");
    let next = "in_progress";
    if (current === "in_progress") next = "complete";
    else if (current === "complete") next = "not_started";
    else if (current === "blocked") next = "in_progress";

    try {
      await updateProjectMilestone(projectId, String(milestone.id), {
        status: next,
        actual_date: next === "complete" ? new Date().toISOString().split("T")[0] : undefined,
      });
      void refetch();
    } catch {
      // non-fatal
    }
  };

  const statusPills: Record<string, string> = {
    complete: "text-emerald-400 border-emerald-500/40 bg-emerald-950/20",
    in_progress: "text-sky-400 border-sky-500/40 bg-sky-950/20",
    blocked: "text-red-400 border-red-500/40 bg-red-950/20",
    not_started: "text-slate-400 border-slate-500/40 bg-slate-950/20",
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-bold text-paper sm:text-2xl">
            Programme Milestones & Schedule Timeline
          </h2>
          <p className="mt-1 text-xs text-slate-light">
            Real milestone programme tracked against live dates, baseline schedules, and completion weights.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex border border-ink-mid bg-ink-light">
            {["all", "not_started", "in_progress", "complete", "blocked"].map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setFilter(st)}
                className={`px-3 py-1 font-mono text-xs uppercase tracking-wider transition-colors ${
                  filter === st ? "bg-signal text-ink font-bold" : "text-slate-light hover:text-paper"
                }`}
              >
                {st.replace(/_/g, " ")}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setIsAddOpen(true)}
            className="inline-flex items-center gap-1.5 border border-signal bg-signal px-3.5 py-1.5 font-mono text-xs font-bold uppercase tracking-wider text-ink hover:bg-signal/90 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Add Milestone</span>
          </button>
        </div>
      </div>

      {/* Full-Width Milestone List & Timeline */}
      <section className="border border-ink-mid bg-ink">
        <div className="border-b border-ink-mid p-4 flex items-center justify-between">
          <span className="font-mono text-xs font-bold uppercase tracking-wider text-paper">
            Programme Deliverables
          </span>
          <span className="font-mono text-xs text-slate-light">
            {milestones.length} Milestones Tracked
          </span>
        </div>

        {filtered.length === 0 ? (
          <div className="py-12 text-center text-xs text-slate-light font-mono">
            No milestones found for the selected filter. Click &quot;Add Milestone&quot; to initialize programme schedule.
          </div>
        ) : (
          <div className="divide-y divide-ink-mid/40">
            {filtered.map((m) => {
              const st = String(m.status || "not_started");
              return (
                <div
                  key={String(m.id)}
                  className="p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between hover:bg-ink-light/20 transition-colors"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-paper text-sm">
                        {String(m.name || "Untitled Milestone")}
                      </span>
                      <span className={`font-mono text-[10px] uppercase px-2 py-0.5 rounded-sm border ${statusPills[st] || statusPills.not_started}`}>
                        {st.replace(/_/g, " ")}
                      </span>
                      {Boolean(m.weight) && (
                        <span className="font-mono text-[10px] text-slate-light border border-ink-mid px-1.5 py-0.2">
                          Weight: {String(m.weight)}%
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-4 text-xs font-mono text-slate-light">
                      <span>Baseline: {formatDate(String(m.baseline_date || "Not set"))}</span>
                      <span>Forecast: {formatDate(String(m.forecast_date || "Not set"))}</span>
                      {Boolean(m.actual_date) && (
                        <span className="text-emerald-400">Actual: {formatDate(String(m.actual_date))}</span>
                      )}
                      {Boolean(m.owner_name) && (
                        <span className="text-paper">Owner: {String(m.owner_name)}</span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 font-mono text-xs">
                    <button
                      type="button"
                      onClick={() => handleAdvanceStatus(m)}
                      className="border border-ink-mid bg-ink-light px-3 py-1 text-slate-light hover:border-signal hover:text-paper transition-colors"
                    >
                      Cycle Status
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Add Milestone Modal */}
      {isAddOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md border border-ink-mid bg-ink p-6 shadow-2xl space-y-4">
            <h3 className="font-display text-lg font-bold text-paper">Add Schedule Milestone</h3>
            <div>
              <label className="block text-xs font-mono uppercase text-slate">Milestone Name *</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Substructure Concrete Pour Complete"
                className="mt-1 w-full border border-ink-mid bg-ink-light p-2 text-xs text-paper outline-none focus:border-signal"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-mono uppercase text-slate">Baseline Date</label>
                <input
                  type="date"
                  value={baselineDate}
                  onChange={(e) => setBaselineDate(e.target.value)}
                  className="mt-1 w-full border border-ink-mid bg-ink-light p-2 text-xs text-paper outline-none focus:border-signal font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-mono uppercase text-slate">Forecast Date</label>
                <input
                  type="date"
                  value={forecastDate}
                  onChange={(e) => setForecastDate(e.target.value)}
                  className="mt-1 w-full border border-ink-mid bg-ink-light p-2 text-xs text-paper outline-none focus:border-signal font-mono"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-mono uppercase text-slate">Programme Weight (%)</label>
              <input
                type="number"
                min="0"
                max="100"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                className="mt-1 w-full border border-ink-mid bg-ink-light p-2 text-xs text-paper outline-none focus:border-signal font-mono"
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsAddOpen(false)}
                className="border border-ink-mid px-4 py-2 font-mono text-xs text-slate-light hover:text-paper"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAddMilestone}
                disabled={saving || !name.trim()}
                className="border border-signal bg-signal px-4 py-2 font-mono text-xs font-bold uppercase text-ink hover:bg-signal/90 disabled:opacity-50"
              >
                {saving ? "Adding..." : "Add Milestone"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
