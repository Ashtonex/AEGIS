"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  FolderKanban,
  Link2,
  X,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Layers,
  Sparkles,
} from "lucide-react";
import { convertQuotationToProject, linkQuotationToProject } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";

interface ConvertProjectModalProps {
  quotation: any;
  projectsList: any[];
  onClose: () => void;
  onSuccess: (projectId: string) => void;
}

export default function ConvertProjectModal({
  quotation,
  projectsList,
  onClose,
  onSuccess,
}: ConvertProjectModalProps) {
  const [mode, setMode] = useState<"create" | "link">("create");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdProjectId, setCreatedProjectId] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Form states for Create
  const refNum = quotation?.metadata?.reference_number || quotation?.id?.slice(0, 8)?.toUpperCase();
  const defaultTitle = quotation?.metadata?.project_title || `${quotation?.client_name || "Commercial"} Project`;
  const defaultCode = `PRJ-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

  const [projectName, setProjectName] = useState(defaultTitle);
  const [projectCode, setProjectCode] = useState(defaultCode);
  const [projectType, setProjectType] = useState("commercial");
  const [startDate, setStartDate] = useState(new Date().toISOString().split("T")[0]);
  const [completionDate, setCompletionDate] = useState("");

  // Form states for Link
  const [selectedExistingProjectId, setSelectedExistingProjectId] = useState(
    projectsList.length > 0 ? projectsList[0].id : ""
  );
  const [seedBudgetOnLink, setSeedBudgetOnLink] = useState(true);

  const handleConvert = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectName.trim()) {
      setError("Project name is required.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await convertQuotationToProject(quotation.id, {
        name: projectName.trim(),
        project_code: projectCode.trim() || undefined,
        project_type: projectType,
        start_date: startDate || undefined,
        planned_completion_date: completionDate || undefined,
      });

      if (res.success && res.data?.project_id) {
        setCreatedProjectId(res.data.project_id);
        setSuccessMessage(res.message || "Project created and linked successfully.");
        onSuccess(res.data.project_id);
      } else {
        setError(res.error?.message || "Failed to convert quotation to project.");
      }
    } catch (err: any) {
      setError(err?.message || "An error occurred during project conversion.");
    } finally {
      setLoading(false);
    }
  };

  const handleLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedExistingProjectId) {
      setError("Please select a project to link.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await linkQuotationToProject(
        quotation.id,
        selectedExistingProjectId,
        seedBudgetOnLink
      );

      if (res.success && res.data?.project_id) {
        setCreatedProjectId(res.data.project_id);
        setSuccessMessage(res.message || "Quotation linked to project successfully.");
        onSuccess(res.data.project_id);
      } else {
        setError(res.error?.message || "Failed to link quotation to project.");
      }
    } catch (err: any) {
      setError(err?.message || "An error occurred linking quotation to project.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-lg border border-ink-mid bg-ink shadow-2xl flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-ink-mid px-5 py-4 bg-ink-light/40">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 border border-signal/50 bg-signal/10 flex items-center justify-center text-signal">
              <FolderKanban className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-display text-sm font-bold uppercase tracking-wider text-paper">
                Connect Quotation to Project
              </h3>
              <p className="font-mono text-[11px] text-slate-light">
                {refNum} • {quotation?.client_name} • {formatCurrency(quotation?.quote_amount || 0)}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-light hover:text-paper transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto space-y-4">
          {successMessage ? (
            <div className="py-6 space-y-4 text-center">
              <div className="w-12 h-12 rounded-full border border-emerald-500/50 bg-emerald-950/40 text-emerald-400 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h4 className="font-display text-base font-bold text-paper">
                  Connection Verified &amp; Budget Seeded
                </h4>
                <p className="text-xs text-slate-light max-w-sm mx-auto">
                  {successMessage}
                </p>
              </div>

              {createdProjectId && (
                <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-2">
                  <Link
                    href={`/dashboard/projects/${createdProjectId}`}
                    className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 border border-signal bg-signal px-4 py-2 font-mono text-xs font-bold uppercase text-ink hover:bg-signal/90 transition-colors"
                  >
                    <span>Open Project Workspace</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </Link>
                  <Link
                    href={`/dashboard/projects/${createdProjectId}/budget`}
                    className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 border border-ink-mid bg-ink-light px-4 py-2 font-mono text-xs text-slate-light hover:text-paper hover:border-signal/50 transition-colors"
                  >
                    <Layers className="w-3.5 h-3.5 text-signal" />
                    <span>View Budget Spreadsheet</span>
                  </Link>
                </div>
              )}

              <button
                type="button"
                onClick={onClose}
                className="mt-3 text-xs font-mono uppercase text-slate hover:text-paper"
              >
                Done
              </button>
            </div>
          ) : (
            <>
              {error && (
                <div className="flex items-start gap-2 border border-rose-500/40 bg-rose-950/30 p-3 text-xs text-rose-300 font-mono">
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              {/* Mode Selector Tabs */}
              <div className="grid grid-cols-2 gap-1 border border-ink-mid bg-ink-light/20 p-1 font-mono text-xs">
                <button
                  type="button"
                  onClick={() => setMode("create")}
                  className={`py-2 px-3 text-center transition-all ${
                    mode === "create"
                      ? "bg-signal text-ink font-bold shadow-sm"
                      : "text-slate-light hover:text-paper"
                  }`}
                >
                  Create New Project
                </button>
                <button
                  type="button"
                  onClick={() => setMode("link")}
                  className={`py-2 px-3 text-center transition-all ${
                    mode === "link"
                      ? "bg-signal text-ink font-bold shadow-sm"
                      : "text-slate-light hover:text-paper"
                  }`}
                >
                  Link to Existing Project
                </button>
              </div>

              {mode === "create" ? (
                <form onSubmit={handleConvert} className="space-y-3 font-sans text-xs">
                  <div>
                    <label className="block font-mono uppercase text-[10px] text-slate mb-1">
                      Project Name *
                    </label>
                    <input
                      type="text"
                      value={projectName}
                      onChange={(e) => setProjectName(e.target.value)}
                      required
                      placeholder="e.g. Harare High-Rise Phase 2"
                      className="w-full border border-ink-mid bg-ink-light p-2.5 text-xs text-paper outline-none focus:border-signal transition-colors font-sans"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block font-mono uppercase text-[10px] text-slate mb-1">
                        Project Code
                      </label>
                      <input
                        type="text"
                        value={projectCode}
                        onChange={(e) => setProjectCode(e.target.value)}
                        placeholder="e.g. PRJ-2026-001"
                        className="w-full border border-ink-mid bg-ink-light p-2 text-xs text-paper outline-none focus:border-signal font-mono uppercase"
                      />
                    </div>
                    <div>
                      <label className="block font-mono uppercase text-[10px] text-slate mb-1">
                        Project Type
                      </label>
                      <select
                        value={projectType}
                        onChange={(e) => setProjectType(e.target.value)}
                        className="w-full border border-ink-mid bg-ink-light p-2 text-xs text-paper outline-none focus:border-signal font-mono"
                      >
                        <option value="commercial">Commercial</option>
                        <option value="residential">Residential</option>
                        <option value="civil">Civil Works</option>
                        <option value="infrastructure">Infrastructure</option>
                        <option value="mining">Mining &amp; Earthmoving</option>
                        <option value="fitout">Interior Fitout</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block font-mono uppercase text-[10px] text-slate mb-1">
                        Start Date
                      </label>
                      <input
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className="w-full border border-ink-mid bg-ink-light p-2 text-xs text-paper outline-none focus:border-signal font-mono"
                      />
                    </div>
                    <div>
                      <label className="block font-mono uppercase text-[10px] text-slate mb-1">
                        Target Completion
                      </label>
                      <input
                        type="date"
                        value={completionDate}
                        onChange={(e) => setCompletionDate(e.target.value)}
                        className="w-full border border-ink-mid bg-ink-light p-2 text-xs text-paper outline-none focus:border-signal font-mono"
                      />
                    </div>
                  </div>

                  <div className="border border-signal/20 bg-signal/5 p-3 rounded-sm space-y-1 text-slate-light text-[11px] leading-relaxed">
                    <p className="font-semibold text-signal flex items-center gap-1.5 font-mono text-xs">
                      <Sparkles className="w-3.5 h-3.5" />
                      Automatic Budget &amp; Lineage Seeding
                    </p>
                    <p>
                      This quotation will be marked <strong className="text-emerald-400 font-normal">Won</strong> and linked to the new project. Its execution direct cost breakdown (materials, labour, plant, subcontract) will automatically seed the baseline execution budget into <code className="text-signal font-mono">finance.project_budgets</code> with markup excluded.
                    </p>
                  </div>

                  <div className="pt-2 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={onClose}
                      disabled={loading}
                      className="border border-ink-mid bg-ink px-3 py-1.5 font-mono text-xs text-slate-light hover:text-paper"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={loading}
                      className="inline-flex items-center gap-1.5 border border-signal bg-signal px-4 py-1.5 font-mono text-xs font-bold uppercase tracking-wider text-ink hover:bg-signal/90 disabled:opacity-50 transition-colors"
                    >
                      {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FolderKanban className="w-3.5 h-3.5" />}
                      <span>{loading ? "Creating..." : "Create Project & Seed Budget"}</span>
                    </button>
                  </div>
                </form>
              ) : (
                <form onSubmit={handleLink} className="space-y-4 font-sans text-xs">
                  <div>
                    <label className="block font-mono uppercase text-[10px] text-slate mb-1">
                      Select Existing Project *
                    </label>
                    {projectsList.length === 0 ? (
                      <p className="text-amber-400 font-mono text-xs py-2">
                        No projects available to link. Use &quot;Create New Project&quot; above.
                      </p>
                    ) : (
                      <select
                        value={selectedExistingProjectId}
                        onChange={(e) => setSelectedExistingProjectId(e.target.value)}
                        required
                        className="w-full border border-ink-mid bg-ink-light p-2.5 text-xs text-paper outline-none focus:border-signal font-mono"
                      >
                        {projectsList.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.project_code || "PRJ"} — {p.name} ({p.client_name || "Client"})
                          </option>
                        ))}
                      </select>
                    )}
                  </div>

                  <div className="flex items-start gap-2 pt-1">
                    <input
                      type="checkbox"
                      id="seedBudgetCheckbox"
                      checked={seedBudgetOnLink}
                      onChange={(e) => setSeedBudgetOnLink(e.target.checked)}
                      className="mt-0.5 rounded border-ink-mid bg-ink-light text-signal focus:ring-0"
                    />
                    <label htmlFor="seedBudgetCheckbox" className="text-slate-light text-xs leading-normal select-none">
                      <strong className="text-paper font-medium">Seed execution budget &amp; BOQ items</strong>
                      <span className="block text-[11px] text-slate">
                        Import and seed this quotation&apos;s cost breakdown directly into the selected project&apos;s budget ledger.
                      </span>
                    </label>
                  </div>

                  <div className="pt-2 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={onClose}
                      disabled={loading}
                      className="border border-ink-mid bg-ink px-3 py-1.5 font-mono text-xs text-slate-light hover:text-paper"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={loading || projectsList.length === 0}
                      className="inline-flex items-center gap-1.5 border border-signal bg-signal px-4 py-1.5 font-mono text-xs font-bold uppercase tracking-wider text-ink hover:bg-signal/90 disabled:opacity-50 transition-colors"
                    >
                      {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}
                      <span>{loading ? "Linking..." : "Link to Selected Project"}</span>
                    </button>
                  </div>
                </form>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
