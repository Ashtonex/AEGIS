"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FileText, Loader2, Plus, RefreshCw, X, Download, Eye,
  Play, Calendar, Share2, ClipboardList, CheckCircle2,
  TrendingUp, Users, Truck, ShoppingCart, ShieldCheck
} from "lucide-react";
import { RBACGuard } from "@/components/auth/RBACGuard";
import {
  getAvailableReports,
  getScheduledReports,
  getRecentReports,
  generateReport,
  approveReport,
  getInternalProjects
} from "@/lib/api";

type RecordData = Record<string, any>;

function dateValue(value: unknown) {
  if (!value) return "Not recorded";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat("en-ZW", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function statusClass(status: string) {
  const normalized = String(status || "").toLowerCase();
  if (["approved", "completed", "success"].includes(normalized)) {
    return "border-emerald-500/30 bg-emerald-950/20 text-emerald-300";
  }
  if (["draft", "pending", "processing"].includes(normalized)) {
    return "border-blue-500/30 bg-blue-950/20 text-blue-300";
  }
  if (["failed", "error"].includes(normalized)) {
    return "border-red-500/30 bg-red-950/20 text-red-300";
  }
  return "border-slate-500/30 bg-slate-950/20 text-slate-300";
}

function reportEvidenceSummary(snapshot: unknown) {
  if (!snapshot || typeof snapshot !== "object") return "No source evidence snapshot captured";
  const evidence = snapshot as RecordData;
  const sources = evidence.sources && typeof evidence.sources === "object" ? evidence.sources as RecordData : {};
  const entries = Object.entries(sources);
  if (!entries.length) return "No source evidence snapshot captured";
  return entries.map(([key, value]) => `${key.replace(/_/g, " ")}: ${value === null || value === undefined ? "unavailable" : String(value)}`).join(" · ");
}

function loadFailureMessage(reason: unknown) {
  const rawMessage = reason instanceof Error ? reason.message : String(reason ?? "");
  const normalizedMessage = rawMessage.toLowerCase();
  if (
    normalizedMessage.includes("signal is aborted") ||
    normalizedMessage.includes("operation was aborted") ||
    normalizedMessage.includes("aborterror") ||
    normalizedMessage.includes("timeouterror")
  ) {
    return "The reporting feed is still synchronizing. Please retry once the connection is ready.";
  }
  return "Failed to load reports dashboard.";
}

function normalizeActionError(reason: unknown, fallback: string) {
  const rawMessage = reason instanceof Error ? reason.message : String(reason ?? "");
  if (/aborted|cancelled|timed out|network error|fetch failed|not found/i.test(rawMessage)) {
    return fallback;
  }
  return fallback;
}

export default function ReportsDashboard() {
  return (
    <RBACGuard allowedRoles={["Executive (Admin)", "Project Manager", "Finance Manager", "Compliance Officer"]}>
      <ReportsWorkspace />
    </RBACGuard>
  );
}

function ReportsWorkspace() {
  const [availableReports, setAvailableReports] = useState<RecordData[]>([]);
  const [scheduledReports, setScheduledReports] = useState<RecordData[]>([]);
  const [recentReports, setRecentReports] = useState<RecordData[]>([]);
  const [projects, setProjects] = useState<RecordData[]>([]);
  const [sourceWarnings, setSourceWarnings] = useState<string[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Modals
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [selectedReportType, setSelectedReportType] = useState<string>("");

  // Form Fields
  const [generateForm, setGenerateForm] = useState({ project_id: "", start_date: "", end_date: "", format: "pdf" });

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [availRes, schedRes, recentRes, projRes] = await Promise.allSettled([
        getAvailableReports(),
        getScheduledReports(),
        getRecentReports(),
        getInternalProjects()
      ]);
      const warnings: string[] = [];
      if (availRes.status === "fulfilled") setAvailableReports(availRes.value.data || []);
      else warnings.push("Available report templates could not be loaded.");
      if (schedRes.status === "fulfilled") setScheduledReports(schedRes.value.data || []);
      else warnings.push("Scheduled reports could not be loaded.");
      if (recentRes.status === "fulfilled") setRecentReports(recentRes.value.data || []);
      else warnings.push("Recent report runs could not be loaded.");
      if (projRes.status === "fulfilled") setProjects(projRes.value.data || []);
      else warnings.push("Project register could not be loaded.");
      setSourceWarnings(warnings);
      if (availRes.status === "rejected") {
        throw new Error(loadFailureMessage(availRes.reason));
      }
    } catch (err) {
      setError(loadFailureMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleOpenGenerate = (typeId: string) => {
    setSelectedReportType(typeId);
    setShowGenerateModal(true);
  };

  const handleGenerateReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedReportType) return;
    try {
      await generateReport({
        report_type: selectedReportType,
        ...generateForm
      });
      setNotice("Report generation request submitted successfully.");
      setShowGenerateModal(false);
      await loadData();
    } catch (err) {
      setNotice(normalizeActionError(err, "Failed to generate report."));
    }
  };

  const handleApproveReport = async (id: string) => {
    try {
      await approveReport(id);
      setNotice("Report approved and published.");
      await loadData();
    } catch (err) {
      setNotice(normalizeActionError(err, "Failed to approve report."));
    }
  };

  // Icon selector based on category
  const getCategoryIcon = (category: string) => {
    switch (category) {
      case "site": return <FileText className="h-6 w-6 text-signal" />;
      case "finance": return <TrendingUp className="h-6 w-6 text-emerald-400" />;
      case "fleet": return <Truck className="h-6 w-6 text-blue-400" />;
      case "workforce": return <Users className="h-6 w-6 text-purple-400" />;
      case "compliance": return <ShieldCheck className="h-6 w-6 text-amber-500" />;
      default: return <FileText className="h-6 w-6 text-slate" />;
    }
  };

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center bg-ink">
        <Loader2 className="h-8 w-8 animate-spin text-signal" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Notice Banner */}
      {notice && (
        <div className="bg-ink-light border border-signal/20 px-4 py-3 rounded flex items-center justify-between text-paper text-sm">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-slate hover:text-paper">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      {error && (
        <div className="flex items-start gap-2 rounded border border-red-500/40 bg-red-950/20 px-4 py-3 text-sm text-red-100">
          <ClipboardList className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
          <div>
            <p className="font-semibold">Reporting data could not be loaded.</p>
            <p className="mt-1 text-red-100/80">{error}</p>
          </div>
        </div>
      )}
      {sourceWarnings.length > 0 && (
        <div className="space-y-2 rounded border border-amber-500/30 bg-amber-950/20 px-4 py-3 text-sm text-amber-100">
          {sourceWarnings.map((warning) => (
            <div key={warning} className="flex items-start gap-2">
              <ClipboardList className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
              <p>{warning}</p>
            </div>
          ))}
        </div>
      )}

      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-paper tracking-tight font-display">Automated Reporting</h1>
        <p className="text-sm text-slate-light font-sans mt-0.5">SNC report generator, scheduled distribution lists, and PDF publish gates.</p>
      </div>

      {/* Category Card Grid */}
      <div>
        <h2 className="text-xs font-semibold text-slate font-mono uppercase tracking-wider mb-3">Available Reports</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {availableReports.length === 0 ? <div className="col-span-full border border-dashed border-ink-mid bg-ink-light p-6 text-center text-sm text-slate-light">No report templates are available from the reporting service.</div> : null}
          {availableReports.map((r) => (
            <div key={r.id} className="bg-ink-light border border-ink-mid p-5 rounded-sm flex flex-col justify-between space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between items-start">
                  {getCategoryIcon(r.category)}
                  <span className="text-[9px] font-mono uppercase tracking-wider text-slate-light px-1.5 py-0.5 bg-ink rounded">{r.category}</span>
                </div>
                <h3 className="text-sm font-semibold text-paper pt-1">{r.name}</h3>
                <p className="text-xs text-slate">{r.desc}</p>
              </div>
              <button
                onClick={() => handleOpenGenerate(r.id)}
                className="w-full flex items-center justify-center space-x-2 bg-ink hover:bg-ink-mid/30 border border-ink-mid text-paper hover:text-signal text-xs py-2 rounded font-mono uppercase tracking-wider transition-colors"
              >
                <Play className="h-3 w-3" />
                <span>Run Report</span>
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Scheduled / Recipient List Table */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent reports generated */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-ink-light border border-ink-mid rounded-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-ink-mid bg-ink bg-opacity-20 flex justify-between items-center">
              <span className="font-mono text-xs uppercase tracking-wider text-slate">Recently Generated Runs</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-ink-mid text-slate font-mono text-[11px] uppercase tracking-wider bg-ink-light">
                    <th className="p-4">Report Name</th>
                    <th className="p-4">Period / Project</th>
                    <th className="p-4">Generated At</th>
                    <th className="p-4">Status</th>
                    <th className="p-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-mid">
                  {recentReports.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-4 text-center text-slate">No recent report runs logged in this period.</td>
                    </tr>
                  ) : (
                    recentReports.map((r) => (
                      <tr key={r.id} className="hover:bg-ink-mid/10">
                        <td className="p-4">
                          <div>
                            <span className="font-semibold text-paper">{r.report_name}</span>
                            <span className="text-[10px] text-slate font-mono block mt-0.5">{r.format.toUpperCase()} format</span>
                            <span className="mt-2 block max-w-3xl text-[10px] leading-5 text-slate-light">Source evidence: {reportEvidenceSummary(r.evidence_snapshot)}</span>
                          </div>
                        </td>
                        <td className="p-4 text-slate-light font-mono text-xs">{r.project_name || "All Projects"}</td>
                        <td className="p-4 text-slate-light">{dateValue(r.created_at)}</td>
                        <td className="p-4">
                          <span className={`px-2 py-0.5 rounded-sm text-[10px] uppercase font-mono tracking-wider border ${statusClass(r.status)}`}>
                            {r.status}
                          </span>
                        </td>
                        <td className="p-4 text-right space-x-2">
                          {r.status === "completed" && (
                            <>
                              <button
                                onClick={() => handleApproveReport(r.id)}
                                className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 px-2.5 py-1 rounded text-xs font-mono"
                              >
                                Publish
                              </button>
                              <a
                                href={r.file_path || "#"}
                                target="_blank"
                                rel="noreferrer"
                                className="bg-ink border border-ink-mid text-paper hover:text-signal px-2.5 py-1.5 rounded inline-flex items-center text-xs"
                              >
                                <Download className="h-3.5 w-3.5" />
                              </a>
                            </>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Schedule List */}
        <div className="bg-ink-light border border-ink-mid p-5 rounded-sm space-y-4">
          <h2 className="text-sm font-semibold text-paper tracking-wider uppercase font-mono border-b border-ink-mid pb-3">Distribution Schedules</h2>
          {scheduledReports.length === 0 ? (
            <p className="text-xs text-slate text-center py-8">No automated schedules currently active.</p>
          ) : (
            <div className="space-y-4">
              {scheduledReports.map((s) => (
                <div key={s.id} className="bg-ink border border-ink-mid p-3.5 rounded flex justify-between items-start">
                  <div className="space-y-1">
                    <h3 className="text-xs font-semibold text-paper">{s.report_name}</h3>
                    <p className="text-[10px] text-slate-light font-mono">Cron: {s.schedule_cron}</p>
                    <p className="text-[10px] text-slate-light">Next Run: {dateValue(s.next_run)}</p>
                  </div>
                  <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-1.5 py-0.5 rounded text-[9px] uppercase font-mono tracking-wider">
                    Active
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Generate Report Modal */}
      {showGenerateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 backdrop-blur-sm">
          <div className="bg-ink-light border border-ink-mid w-full max-w-md p-6 rounded-sm space-y-4">
            <div className="flex justify-between items-center border-b border-ink-mid pb-3">
              <span className="text-base font-semibold text-paper">Run Report</span>
              <button onClick={() => setShowGenerateModal(false)} className="text-slate hover:text-paper">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleGenerateReport} className="space-y-4">
              <div>
                <label className="block text-xs font-mono uppercase text-slate mb-1">Project Scope</label>
                <select
                  value={generateForm.project_id}
                  onChange={(e) => setGenerateForm({ ...generateForm, project_id: e.target.value })}
                  className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                >
                  <option value="">All Projects</option>
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-mono uppercase text-slate mb-1">Start Date</label>
                  <input
                    type="date"
                    required
                    value={generateForm.start_date}
                    onChange={(e) => setGenerateForm({ ...generateForm, start_date: e.target.value })}
                    className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                  />
                </div>
                <div>
                  <label className="block text-xs font-mono uppercase text-slate mb-1">End Date</label>
                  <input
                    type="date"
                    required
                    value={generateForm.end_date}
                    onChange={(e) => setGenerateForm({ ...generateForm, end_date: e.target.value })}
                    className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-mono uppercase text-slate mb-1">Output Format</label>
                <select
                  value={generateForm.format}
                  onChange={(e) => setGenerateForm({ ...generateForm, format: e.target.value })}
                  className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                >
                  <option value="pdf">Adobe PDF (.pdf)</option>
                  <option value="excel">Microsoft Excel (.xlsx)</option>
                </select>
              </div>
              <div className="flex justify-end space-x-3 pt-3 border-t border-ink-mid">
                <button
                  type="button"
                  onClick={() => setShowGenerateModal(false)}
                  className="px-4 py-2 border border-ink-mid text-paper rounded text-sm hover:bg-ink-mid/30"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-signal text-ink font-semibold rounded text-sm hover:bg-signal/95"
                >
                  Generate
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
