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
  GitBranch,
  Flame,
  Layers,
  ArrowRight,
  TrendingDown,
  TrendingUp,
  Sliders,
  Trash2,
  Edit2,
  ExternalLink,
} from "lucide-react";
import { useProject } from "@/context/ProjectWorkspaceContext";
import {
  addProjectMilestone,
  updateProjectMilestone,
  deleteProjectMilestone,
  calculateProjectScheduleCPM,
  generateProjectMilestonesFromBOQ,
} from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { ProjectMilestone } from "@/lib/projects/types";

export default function ProjectSchedulePage() {
  const params = useParams();
  const projectId = typeof params?.id === "string" ? params.id : "";
  const { milestones, refetch, project } = useProject();

  const [viewMode, setViewMode] = useState<"gantt" | "register">("gantt");
  const [filter, setFilter] = useState<string>("all");
  const [criticalOnly, setCriticalOnly] = useState<boolean>(false);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingMilestone, setEditingMilestone] = useState<ProjectMilestone | null>(null);

  // Form states
  const [name, setName] = useState("");
  const [durationDays, setDurationDays] = useState("5");
  const [baselineDate, setBaselineDate] = useState("");
  const [forecastDate, setForecastDate] = useState("");
  const [weight, setWeight] = useState("10");
  const [predecessorId, setPredecessorId] = useState("");
  const [lagDays, setLagDays] = useState("0");
  const [dependencyType, setDependencyType] = useState<"FS" | "SS" | "FF" | "SF">("FS");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [calculatingCPM, setCalculatingCPM] = useState(false);
  const [generatingBOQ, setGeneratingBOQ] = useState(false);
  const [cpmFeedback, setCpmFeedback] = useState<string | null>(null);

  // Filtered milestones
  const filtered = useMemo(() => {
    return (milestones as ProjectMilestone[]).filter((m) => {
      if (criticalOnly && !m.is_critical) return false;
      if (filter === "all") return true;
      return String(m.status).toLowerCase() === filter;
    });
  }, [milestones, filter, criticalOnly]);

  // Schedule statistics
  const stats = useMemo(() => {
    const list = milestones as ProjectMilestone[];
    const total = list.length;
    const completed = list.filter((m) => m.status === "complete").length;
    const critical = list.filter((m) => Boolean(m.is_critical)).length;
    const blocked = list.filter((m) => m.status === "blocked").length;

    // Max variance calculation
    let maxSlippageDays = 0;
    list.forEach((m) => {
      if (m.baseline_date && m.forecast_date) {
        const b = new Date(String(m.baseline_date)).getTime();
        const f = new Date(String(m.forecast_date)).getTime();
        const diffDays = Math.round((f - b) / (1000 * 3600 * 24));
        if (diffDays > maxSlippageDays) maxSlippageDays = diffDays;
      }
    });

    return { total, completed, critical, blocked, maxSlippageDays };
  }, [milestones]);

  // Gantt chart time window bounds
  const ganttBounds = useMemo(() => {
    const list = milestones as ProjectMilestone[];
    if (list.length === 0) {
      const now = new Date();
      const end = new Date();
      end.setDate(now.getDate() + 30);
      return { start: now, end, totalDays: 30 };
    }

    let minDate = new Date();
    let maxDate = new Date();
    let hasDates = false;

    list.forEach((m) => {
      const datesToInspect = [m.early_start, m.early_finish, m.forecast_date, m.baseline_date, m.actual_date].filter(Boolean);
      datesToInspect.forEach((d) => {
        const dt = new Date(String(d));
        if (!isNaN(dt.getTime())) {
          if (!hasDates) {
            minDate = dt;
            maxDate = dt;
            hasDates = true;
          } else {
            if (dt < minDate) minDate = dt;
            if (dt > maxDate) maxDate = dt;
          }
        }
      });
    });

    // Add padding days
    const start = new Date(minDate);
    start.setDate(start.getDate() - 3);
    const end = new Date(maxDate);
    end.setDate(end.getDate() + 7);
    const totalDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / (1000 * 3600 * 24)));

    return { start, end, totalDays };
  }, [milestones]);

  const handleOpenAdd = () => {
    setEditingMilestone(null);
    setName("");
    setDurationDays("5");
    setBaselineDate("");
    setForecastDate("");
    setWeight("10");
    setPredecessorId("");
    setLagDays("0");
    setDependencyType("FS");
    setNotes("");
    setIsAddOpen(true);
  };

  const handleOpenEdit = (m: ProjectMilestone) => {
    setEditingMilestone(m);
    setName(m.name || "");
    setDurationDays(String(m.duration_days || 1));
    setBaselineDate(m.baseline_date ? String(m.baseline_date).split("T")[0] : "");
    setForecastDate(m.forecast_date ? String(m.forecast_date).split("T")[0] : "");
    setWeight(String(m.weight || 0));
    setPredecessorId(m.predecessor_id ? String(m.predecessor_id) : "");
    setLagDays(String(m.lag_days || 0));
    setDependencyType((m.dependency_type as "FS" | "SS" | "FF" | "SF") || "FS");
    setNotes(m.notes || "");
    setIsAddOpen(true);
  };

  const handleSaveMilestone = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setCpmFeedback(null);
    try {
      const payload = {
        name: name.trim(),
        duration_days: Math.max(1, parseInt(durationDays, 10) || 1),
        baseline_date: baselineDate || undefined,
        forecast_date: forecastDate || undefined,
        weight: Number(weight) || 0,
        predecessor_id: predecessorId || undefined,
        lag_days: parseInt(lagDays, 10) || 0,
        dependency_type: dependencyType,
        notes: notes.trim() || undefined,
      };

      if (editingMilestone) {
        await updateProjectMilestone(projectId, String(editingMilestone.id), payload);
      } else {
        await addProjectMilestone(projectId, payload);
      }
      setIsAddOpen(false);
      await refetch();
    } catch (err: unknown) {
      console.error(err);
      setCpmFeedback("Failed to save activity. Verify dependency links.");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteMilestone = async (id: string) => {
    if (!confirm("Are you sure you want to delete this schedule activity? Downstream dependencies will be unlinked.")) return;
    setDeletingId(id);
    try {
      await deleteProjectMilestone(projectId, id);
      await refetch();
    } catch (err) {
      console.error(err);
    } finally {
      setDeletingId(null);
    }
  };

  const handleRecalculateCPM = async () => {
    setCalculatingCPM(true);
    setCpmFeedback(null);
    try {
      const res = await calculateProjectScheduleCPM(projectId);
      if (res?.data?.message) {
        setCpmFeedback(res.data.message);
      } else {
        setCpmFeedback("Critical Path calculation complete.");
      }
      await refetch();
    } catch (err: unknown) {
      console.error(err);
      setCpmFeedback("Error calculating CPM. Check for circular dependencies.");
    } finally {
      setCalculatingCPM(false);
    }
  };

  const handleAdvanceStatus = async (milestone: ProjectMilestone) => {
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

  const handleGenerateBOQMilestones = async () => {
    setGeneratingBOQ(true);
    try {
      await generateProjectMilestonesFromBOQ(projectId);
      await refetch();
    } catch (err) {
      console.error(err);
    } finally {
      setGeneratingBOQ(false);
    }
  };

  const statusPills: Record<string, string> = {
    complete: "text-emerald-400 border-emerald-500/40 bg-emerald-950/20",
    in_progress: "text-sky-400 border-sky-500/40 bg-sky-950/20",
    blocked: "text-red-400 border-red-500/40 bg-red-950/20",
    not_started: "text-slate-400 border-slate-500/40 bg-slate-950/20",
    cancelled: "text-zinc-500 border-zinc-600/40 bg-zinc-950/20",
  };

  return (
    <div className="space-y-6">
      {/* Schedule Header & Key Metrics */}
      <div className="border border-ink-mid bg-ink p-4 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-display text-xl font-bold text-paper sm:text-2xl">
                Interactive Schedule & Critical Path
              </h2>
              <span className="font-mono text-xs uppercase px-2 py-0.5 border border-signal/40 bg-signal/10 text-signal font-bold">
                CPM Engine Active
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-light max-w-3xl">
              Deterministic Critical Path Method (CPM) calculation with early/late start & finish, total float, and
              predecessor lag tracking against locked baseline programmes.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            <button
              type="button"
              onClick={handleRecalculateCPM}
              disabled={calculatingCPM}
              className="inline-flex flex-1 sm:flex-none items-center justify-center gap-1.5 border border-signal/60 bg-signal/15 px-3 py-2 font-mono text-xs font-bold uppercase tracking-wider text-signal hover:bg-signal hover:text-ink transition-all disabled:opacity-50 min-h-[40px]"
            >
              {calculatingCPM ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Flame className="h-3.5 w-3.5" />}
              <span>{calculatingCPM ? "Computing..." : "Run CPM Float"}</span>
            </button>

            <button
              type="button"
              onClick={handleGenerateBOQMilestones}
              disabled={generatingBOQ}
              className="inline-flex flex-1 sm:flex-none items-center justify-center gap-1.5 border border-sky-500/50 bg-sky-950/30 px-3 py-2 font-mono text-xs font-bold uppercase tracking-wider text-sky-300 hover:bg-sky-500 hover:text-ink transition-all disabled:opacity-50 min-h-[40px]"
            >
              {generatingBOQ ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Clock className="h-3.5 w-3.5" />}
              <span>BOQ Milestones</span>
            </button>

            <button
              type="button"
              onClick={handleOpenAdd}
              className="inline-flex flex-1 sm:flex-none items-center justify-center gap-1.5 border border-signal bg-signal px-4 py-2 font-mono text-xs font-bold uppercase tracking-wider text-ink hover:bg-signal/90 transition-all min-h-[40px]"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Add Activity</span>
            </button>
          </div>
        </div>

        {cpmFeedback && (
          <div className="p-3 border border-ink-mid bg-ink-light/40 text-xs font-mono text-paper flex items-center justify-between">
            <span>{cpmFeedback}</span>
            <button type="button" onClick={() => setCpmFeedback(null)} className="text-slate-light hover:text-paper">
              ×
            </button>
          </div>
        )}

        {/* 4 Health KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-ink-mid/60">
          <div className="p-3 border border-ink-mid/40 bg-ink-light/20">
            <span className="block font-mono text-[10px] uppercase text-slate-light">Total Activities</span>
            <span className="font-mono text-lg font-bold text-paper">{stats.total}</span>
          </div>
          <div className="p-3 border border-red-500/30 bg-red-950/15">
            <span className="block font-mono text-[10px] uppercase text-red-400 flex items-center gap-1">
              <Flame className="h-3 w-3" /> Critical Path
            </span>
            <span className="font-mono text-lg font-bold text-red-300">
              {stats.critical} <span className="text-xs font-normal text-slate-light">({stats.total > 0 ? Math.round((stats.critical / stats.total) * 100) : 0}%)</span>
            </span>
          </div>
          <div className="p-3 border border-emerald-500/30 bg-emerald-950/15">
            <span className="block font-mono text-[10px] uppercase text-emerald-400">Completed Work</span>
            <span className="font-mono text-lg font-bold text-emerald-300">
              {stats.completed} <span className="text-xs font-normal text-slate-light">/ {stats.total}</span>
            </span>
          </div>
          <div className="p-3 border border-ink-mid/40 bg-ink-light/20">
            <span className="block font-mono text-[10px] uppercase text-slate-light">Max Baseline Slippage</span>
            <span className={`font-mono text-lg font-bold ${stats.maxSlippageDays > 0 ? "text-amber-400" : "text-emerald-400"}`}>
              {stats.maxSlippageDays > 0 ? `+${stats.maxSlippageDays} Days` : "On Track"}
            </span>
          </div>
        </div>
      </div>

      {/* Filter and View Mode Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border border-ink-mid bg-ink p-3">
        <div className="flex items-center gap-2">
          <div className="flex border border-ink-mid bg-ink-light">
            <button
              type="button"
              onClick={() => setViewMode("gantt")}
              className={`px-3 py-1.5 font-mono text-xs uppercase tracking-wider transition-colors ${
                viewMode === "gantt" ? "bg-signal text-ink font-bold" : "text-slate-light hover:text-paper"
              }`}
            >
              Gantt View
            </button>
            <button
              type="button"
              onClick={() => setViewMode("register")}
              className={`px-3 py-1.5 font-mono text-xs uppercase tracking-wider transition-colors ${
                viewMode === "register" ? "bg-signal text-ink font-bold" : "text-slate-light hover:text-paper"
              }`}
            >
              Register Table
            </button>
          </div>

          <button
            type="button"
            onClick={() => setCriticalOnly(!criticalOnly)}
            className={`px-3 py-1.5 font-mono text-xs uppercase tracking-wider border transition-colors flex items-center gap-1.5 ${
              criticalOnly
                ? "border-red-500 bg-red-950/40 text-red-300 font-bold"
                : "border-ink-mid text-slate-light hover:text-paper"
            }`}
          >
            <Flame className="h-3 w-3" />
            <span>Critical Path Only</span>
          </button>
        </div>

        <div className="flex overflow-x-auto border border-ink-mid bg-ink-light w-full sm:w-auto no-scrollbar">
          {["all", "not_started", "in_progress", "complete", "blocked"].map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setFilter(st)}
              className={`px-3 py-1.5 font-mono text-xs uppercase tracking-wider transition-colors shrink-0 ${
                filter === st ? "bg-signal text-ink font-bold" : "text-slate-light hover:text-paper"
              }`}
            >
              {st.replace(/_/g, " ")}
            </button>
          ))}
        </div>
      </div>

      {/* View 1: Visual Gantt Schedule Timeline */}
      {viewMode === "gantt" && (
        <section className="border border-ink-mid bg-ink overflow-hidden">
          <div className="border-b border-ink-mid p-4 flex items-center justify-between bg-ink-light/20">
            <div className="flex items-center gap-4">
              <span className="font-mono text-xs font-bold uppercase tracking-wider text-paper">
                Time-Scaled Gantt Programme
              </span>
              <span className="font-mono text-xs text-slate-light">
                {formatDate(ganttBounds.start.toISOString().split("T")[0])} &rarr;{" "}
                {formatDate(ganttBounds.end.toISOString().split("T")[0])} ({ganttBounds.totalDays} Days Window)
              </span>
            </div>
            <div className="hidden sm:flex items-center gap-4 text-[11px] font-mono text-slate-light">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-3 bg-red-500 inline-block" /> Critical Path
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-3 bg-sky-500 inline-block" /> In Progress
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-3 bg-emerald-500 inline-block" /> Complete
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-3 bg-slate-600 inline-block" /> Baseline
              </span>
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-light font-mono">
              No activities found for the selected filter. Click &quot;Add Activity&quot; to initialize schedule.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <div className="min-w-[800px] divide-y divide-ink-mid/40">
                {filtered.map((m) => {
                  const st = String(m.status || "not_started");
                  const isCrit = Boolean(m.is_critical);
                  const dur = m.duration_days || 1;

                  // Compute horizontal bar position
                  const startDateStr = m.early_start || m.forecast_date || m.baseline_date;
                  const itemStart = startDateStr ? new Date(String(startDateStr)) : ganttBounds.start;
                  const daysFromWindowStart = Math.max(
                    0,
                    Math.round((itemStart.getTime() - ganttBounds.start.getTime()) / (1000 * 3600 * 24))
                  );
                  const leftPct = Math.min(95, Math.max(0, (daysFromWindowStart / ganttBounds.totalDays) * 100));
                  const widthPct = Math.min(100 - leftPct, Math.max(3, (dur / ganttBounds.totalDays) * 100));

                  // Baseline bar position
                  let baseLeftPct = leftPct;
                  let baseWidthPct = widthPct;
                  if (m.baseline_date) {
                    const bStart = new Date(String(m.baseline_date));
                    const bDays = Math.max(0, Math.round((bStart.getTime() - ganttBounds.start.getTime()) / (1000 * 3600 * 24)));
                    baseLeftPct = Math.min(95, Math.max(0, (bDays / ganttBounds.totalDays) * 100));
                    baseWidthPct = Math.min(100 - baseLeftPct, Math.max(3, (dur / ganttBounds.totalDays) * 100));
                  }

                  const barColor = isCrit
                    ? "bg-red-500 border-red-400 text-white"
                    : st === "complete"
                    ? "bg-emerald-600 border-emerald-400 text-white"
                    : st === "in_progress"
                    ? "bg-sky-600 border-sky-400 text-white"
                    : st === "blocked"
                    ? "bg-red-700 border-red-500 text-white"
                    : "bg-slate-700 border-slate-500 text-slate-200";

                  return (
                    <div key={m.id} className="p-3 hover:bg-ink-light/20 transition-colors space-y-2">
                      <div className="flex items-center justify-between text-xs font-mono">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleAdvanceStatus(m)}
                            className="text-slate-light hover:text-signal transition-colors"
                            title="Cycle Status"
                          >
                            <Play className="h-3 w-3" />
                          </button>
                          <span className="font-semibold text-paper text-sm">{m.name}</span>
                          <span className={`text-[10px] uppercase px-1.5 py-0.2 border ${statusPills[st]}`}>
                            {st.replace(/_/g, " ")}
                          </span>
                          {isCrit && (
                            <span className="text-[10px] font-bold uppercase px-1.5 py-0.2 border border-red-500 bg-red-950/60 text-red-300 flex items-center gap-1">
                              <Flame className="h-2.5 w-2.5" /> Critical
                            </span>
                          )}
                          <span className="text-[10px] text-slate-light border border-ink-mid px-1">
                            {dur}d duration
                          </span>
                          {m.total_float !== undefined && m.total_float !== null && (
                            <span className={`text-[10px] px-1 border ${m.total_float <= 0 ? "border-red-500/40 text-red-400" : "border-ink-mid text-slate-light"}`}>
                              Float: {m.total_float}d
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-3 text-slate-light">
                          {m.predecessor_name && (
                            <span className="text-[11px] text-slate-light flex items-center gap-1">
                              <GitBranch className="h-3 w-3 text-signal" /> Pred: {m.predecessor_name} (+{m.lag_days || 0}d {m.dependency_type || "FS"})
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => handleOpenEdit(m)}
                            className="hover:text-paper transition-colors"
                            title="Edit"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteMilestone(m.id)}
                            disabled={deletingId === m.id}
                            className="hover:text-red-400 transition-colors disabled:opacity-50"
                            title="Delete"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Gantt Bar Visualization Container */}
                      <div className="relative h-7 w-full bg-ink-light/40 border border-ink-mid/30 rounded-xs overflow-hidden">
                        {/* Baseline Track (dim underneath) */}
                        {m.baseline_date && (
                          <div
                            style={{ left: `${baseLeftPct}%`, width: `${baseWidthPct}%` }}
                            className="absolute top-0.5 h-1.5 bg-slate-600/60 border border-slate-500/40 rounded-xs"
                            title={`Baseline: ${formatDate(String(m.baseline_date))}`}
                          />
                        )}

                        {/* Forecast / Current Progress Bar */}
                        <div
                          style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                          className={`absolute top-2.5 h-3.5 border rounded-xs shadow-xs transition-all flex items-center px-1.5 text-[9px] font-mono font-bold truncate ${barColor}`}
                          title={`Forecast / Active: ${formatDate(String(startDateStr))} (${dur}d)`}
                        >
                          <span className="truncate">{m.name}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      )}

      {/* View 2: Detailed Activity Register Table */}
      {viewMode === "register" && (
        <section className="border border-ink-mid bg-ink overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="border-b border-ink-mid bg-ink-light/40 text-slate-light uppercase text-[10px]">
              <tr>
                <th className="p-3">Activity / Deliverable</th>
                <th className="p-3">Status</th>
                <th className="p-3">Dur (Days)</th>
                <th className="p-3">Predecessor</th>
                <th className="p-3">Baseline</th>
                <th className="p-3">Early Dates (ES &rarr; EF)</th>
                <th className="p-3">Total Float</th>
                <th className="p-3">Critical?</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-mid/40">
              {filtered.map((m) => {
                const st = String(m.status || "not_started");
                const isCrit = Boolean(m.is_critical);
                return (
                  <tr key={m.id} className="hover:bg-ink-light/20 transition-colors">
                    <td className="p-3 font-semibold text-paper">
                      <div>{m.name}</div>
                      {m.notes && <div className="text-[10px] text-slate-light truncate max-w-xs">{m.notes}</div>}
                    </td>
                    <td className="p-3">
                      <span className={`text-[10px] uppercase px-2 py-0.5 border ${statusPills[st]}`}>
                        {st.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="p-3">{m.duration_days || 1}d</td>
                    <td className="p-3">
                      {m.predecessor_name ? (
                        <span className="text-signal text-[11px]">
                          {m.predecessor_name} (+{m.lag_days || 0}d)
                        </span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td className="p-3 text-slate-light">
                      {m.baseline_date ? formatDate(String(m.baseline_date)) : "Unset"}
                    </td>
                    <td className="p-3 text-slate-light">
                      {m.early_start ? formatDate(String(m.early_start)) : "—"} &rarr;{" "}
                      {m.early_finish ? formatDate(String(m.early_finish)) : "—"}
                    </td>
                    <td className="p-3">
                      {m.total_float !== undefined && m.total_float !== null ? (
                        <span className={m.total_float <= 0 ? "text-red-400 font-bold" : "text-slate-light"}>
                          {m.total_float} Days
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="p-3">
                      {isCrit ? (
                        <span className="text-[10px] font-bold text-red-400 flex items-center gap-1">
                          <Flame className="h-3 w-3" /> YES
                        </span>
                      ) : (
                        <span className="text-slate-600">No</span>
                      )}
                    </td>
                    <td className="p-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => handleAdvanceStatus(m)}
                          className="border border-ink-mid bg-ink-light px-2 py-1 text-[11px] text-slate-light hover:border-signal hover:text-paper"
                        >
                          Cycle
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenEdit(m)}
                          className="border border-ink-mid bg-ink-light p-1 text-slate-light hover:border-signal hover:text-paper"
                        >
                          <Edit2 className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteMilestone(m.id)}
                          className="border border-ink-mid bg-ink-light p-1 text-slate-light hover:border-red-500 hover:text-red-400"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {/* Add / Edit Activity Modal */}
      {isAddOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-4">
          <div className="w-full max-w-lg border border-ink-mid bg-ink p-5 sm:p-6 shadow-2xl space-y-4 max-h-[90dvh] overflow-y-auto pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:pb-6 rounded-t-xl sm:rounded-none">
            <div className="flex items-center justify-between border-b border-ink-mid pb-3">
              <h3 className="font-display text-lg font-bold text-paper">
                {editingMilestone ? "Edit Schedule Activity" : "Add Schedule Activity"}
              </h3>
              <button
                type="button"
                onClick={() => setIsAddOpen(false)}
                className="text-slate-light hover:text-paper font-mono text-base"
              >
                ×
              </button>
            </div>

            <div>
              <label className="block text-xs font-mono uppercase text-slate">Activity / Milestone Name *</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Substructure Reinforced Concrete Pour"
                className="mt-1 w-full border border-ink-mid bg-ink-light p-2.5 text-base sm:text-xs text-paper outline-none focus:border-signal min-h-[44px] sm:min-h-0"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-mono uppercase text-slate">Duration (Calendar Days) *</label>
                <input
                  type="number"
                  min="1"
                  value={durationDays}
                  onChange={(e) => setDurationDays(e.target.value)}
                  className="mt-1 w-full border border-ink-mid bg-ink-light p-2.5 text-base sm:text-xs text-paper outline-none focus:border-signal font-mono min-h-[44px] sm:min-h-0"
                />
              </div>

              <div>
                <label className="block text-xs font-mono uppercase text-slate">Programme Weight (%)</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={weight}
                  onChange={(e) => setWeight(e.target.value)}
                  className="mt-1 w-full border border-ink-mid bg-ink-light p-2.5 text-base sm:text-xs text-paper outline-none focus:border-signal font-mono min-h-[44px] sm:min-h-0"
                />
              </div>
            </div>

            {/* Dependency & Sequencing */}
            <div className="p-3 border border-ink-mid/60 bg-ink-light/20 space-y-3">
              <span className="block font-mono text-[10px] uppercase text-signal font-bold">
                Dependency Link & Sequencing
              </span>
              <div>
                <label className="block text-xs font-mono uppercase text-slate">Predecessor Activity</label>
                <select
                  value={predecessorId}
                  onChange={(e) => setPredecessorId(e.target.value)}
                  className="mt-1 w-full border border-ink-mid bg-ink-light p-2.5 text-base sm:text-xs text-paper outline-none focus:border-signal font-mono min-h-[44px] sm:min-h-0"
                >
                  <option value="">(None - Independent Start Activity)</option>
                  {(milestones as ProjectMilestone[])
                    .filter((m) => !editingMilestone || m.id !== editingMilestone.id)
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} ({m.duration_days || 1}d)
                      </option>
                    ))}
                </select>
              </div>

              {predecessorId && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-mono uppercase text-slate">Dependency Type</label>
                    <select
                      value={dependencyType}
                      onChange={(e) => setDependencyType(e.target.value as "FS" | "SS" | "FF" | "SF")}
                      className="mt-1 w-full border border-ink-mid bg-ink-light p-2.5 text-base sm:text-xs text-paper outline-none focus:border-signal font-mono min-h-[44px] sm:min-h-0"
                    >
                      <option value="FS">FS (Finish-to-Start)</option>
                      <option value="SS">SS (Start-to-Start)</option>
                      <option value="FF">FF (Finish-to-Finish)</option>
                      <option value="SF">SF (Start-to-Finish)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-mono uppercase text-slate">Lag (Days)</label>
                    <input
                      type="number"
                      value={lagDays}
                      onChange={(e) => setLagDays(e.target.value)}
                      className="mt-1 w-full border border-ink-mid bg-ink-light p-2.5 text-base sm:text-xs text-paper outline-none focus:border-signal font-mono min-h-[44px] sm:min-h-0"
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-mono uppercase text-slate">Baseline Date</label>
                <input
                  type="date"
                  value={baselineDate}
                  onChange={(e) => setBaselineDate(e.target.value)}
                  className="mt-1 w-full border border-ink-mid bg-ink-light p-2.5 text-base sm:text-xs text-paper outline-none focus:border-signal font-mono min-h-[44px] sm:min-h-0"
                />
              </div>
              <div>
                <label className="block text-xs font-mono uppercase text-slate">Forecast Target Date</label>
                <input
                  type="date"
                  value={forecastDate}
                  onChange={(e) => setForecastDate(e.target.value)}
                  className="mt-1 w-full border border-ink-mid bg-ink-light p-2.5 text-base sm:text-xs text-paper outline-none focus:border-signal font-mono min-h-[44px] sm:min-h-0"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-mono uppercase text-slate">Scope / Execution Notes</label>
              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Specifications, concrete grade, site constraints..."
                className="mt-1 w-full border border-ink-mid bg-ink-light p-2.5 text-base sm:text-xs text-paper outline-none focus:border-signal font-mono min-h-[44px] sm:min-h-0"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-ink-mid">
              <button
                type="button"
                onClick={() => setIsAddOpen(false)}
                className="border border-ink-mid px-4 py-2.5 min-h-[44px] sm:min-h-[36px] font-mono text-xs text-slate-light hover:text-paper"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveMilestone}
                disabled={saving || !name.trim()}
                className="border border-signal bg-signal px-4 py-2.5 min-h-[44px] sm:min-h-[36px] font-mono text-xs font-bold uppercase text-ink hover:bg-signal/90 disabled:opacity-50"
              >
                {saving ? "Saving..." : editingMilestone ? "Update Activity" : "Create Activity"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
