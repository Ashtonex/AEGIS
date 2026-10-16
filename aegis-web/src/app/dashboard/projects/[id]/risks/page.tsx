"use client";

import React, { useState } from "react";
import { useParams } from "next/navigation";
import { AlertTriangle, Plus, ShieldAlert, CheckCircle2, Clock, Loader2 } from "lucide-react";
import { useProject } from "@/context/ProjectWorkspaceContext";
import { addProjectRisk } from "@/lib/api";
import { formatDate } from "@/lib/utils";

const RISK_CATEGORIES = [
  "Commercial / Financial",
  "Site Safety & HSE",
  "Technical / Engineering",
  "Environmental & Weather",
  "Subcontractor & Labour",
  "Procurement & Supply",
  "Statutory & Permitting",
];

export default function ProjectRisksPage() {
  const params = useParams();
  const projectId = typeof params?.id === "string" ? params.id : "";
  const { detail, refetch } = useProject();

  const risks = detail?.risks || [];
  const changes = detail?.changes || [];

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("Commercial / Financial");
  const [status, setStatus] = useState<"open" | "mitigating" | "accepted" | "closed">("open");
  const [likelihood, setLikelihood] = useState(3);
  const [impact, setImpact] = useState(3);
  const [responsePlan, setResponsePlan] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreateRisk = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    setSubmitting(true);
    setError(null);
    try {
      await addProjectRisk(projectId, {
        title: title.trim(),
        description: description.trim() || undefined,
        category,
        status,
        likelihood: Number(likelihood),
        impact: Number(impact),
        response_plan: responsePlan.trim() || undefined,
        due_date: dueDate || undefined,
      });

      setIsModalOpen(false);
      setTitle("");
      setDescription("");
      setResponsePlan("");
      setDueDate("");
      await refetch();
    } catch (err: any) {
      setError(err?.message || "Failed to log project risk.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-bold text-paper sm:text-2xl">
            Risks, Issues &amp; Scope Change Register
          </h2>
          <p className="mt-1 text-xs text-slate-light">
            Identified commercial, technical, and site safety risks with active mitigation treatments.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setIsModalOpen(true)}
          className="inline-flex items-center gap-1.5 border border-amber-500/50 bg-amber-950/30 px-3.5 py-1.5 font-mono text-xs font-bold uppercase tracking-wider text-amber-300 hover:bg-amber-500 hover:text-ink transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>Log Project Risk</span>
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Risks */}
        <section className="border border-ink-mid bg-ink p-5">
          <div className="border-b border-ink-mid/60 pb-3 flex items-center justify-between">
            <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-paper flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              Risk Register
            </h3>
            <span className="font-mono text-xs text-slate-light">{risks.length} Risks</span>
          </div>

          {risks.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-light font-mono">
              No open project risks currently logged. Click &quot;Log Project Risk&quot; to add one.
            </div>
          ) : (
            <div className="mt-3 divide-y divide-ink-mid/40">
              {risks.map((r, idx) => (
                <div key={idx} className="py-3 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-paper text-xs">
                      {String(r.title || "Identified Risk")}
                    </span>
                    <div className="flex items-center gap-2">
                      {Boolean(r.category) && (
                        <span className="border border-ink-mid bg-ink-light px-1.5 py-0.5 font-mono text-[9px] text-slate-light">
                          {String(r.category)}
                        </span>
                      )}
                      <span className={`border px-1.5 py-0.5 font-mono text-[9px] uppercase ${
                        r.status === "closed" ? "border-emerald-500/30 text-emerald-400" : "border-amber-500/30 bg-amber-950/20 text-amber-300"
                      }`}>
                        {String(r.status || "open")}
                      </span>
                    </div>
                  </div>
                  {Boolean(r.description) && (
                    <p className="text-xs text-slate-light leading-relaxed">
                      {String(r.description)}
                    </p>
                  )}
                  {Boolean(r.response_plan) && (
                    <p className="text-[11px] text-cyan-300 font-mono">
                      Mitigation: {String(r.response_plan)}
                    </p>
                  )}
                  <div className="flex items-center gap-3 pt-1 text-[10px] font-mono text-slate">
                    {Boolean(r.likelihood) && <span>Likelihood: {String(r.likelihood)}/5</span>}
                    {Boolean(r.impact) && <span>Impact: {String(r.impact)}/5</span>}
                    {Boolean(r.due_date) && <span>Review Due: {formatDate(String(r.due_date))}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Change Requests */}
        <section className="border border-ink-mid bg-ink p-5">
          <div className="border-b border-ink-mid/60 pb-3 flex items-center justify-between">
            <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-paper flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-signal" />
              Change Requests
            </h3>
            <span className="font-mono text-xs text-slate-light">{changes.length} Changes</span>
          </div>

          {changes.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-light font-mono">
              No change requests on file.
            </div>
          ) : (
            <div className="mt-3 divide-y divide-ink-mid/40">
              {changes.map((c, idx) => (
                <div key={idx} className="py-3 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-paper text-xs">
                      {String(c.title || `Change #${idx + 1}`)}
                    </span>
                    <span className="border border-ink-mid bg-ink-light px-1.5 py-0.2 font-mono text-[10px] text-slate-light uppercase">
                      {String(c.status || "pending")}
                    </span>
                  </div>
                  <p className="text-xs text-slate-light">
                    {String(c.rationale || "Scope adjustment pending signoff.")}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Log Project Risk Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg border border-amber-500/50 bg-ink p-6 shadow-2xl space-y-4">
            <h3 className="font-display text-lg font-bold text-paper">Log New Project Risk</h3>
            {error && (
              <p className="border border-red-500/50 bg-red-950/30 p-2 text-xs font-mono text-red-300">
                {error}
              </p>
            )}
            <form onSubmit={handleCreateRisk} className="space-y-3">
              <div>
                <label className="block text-xs font-mono uppercase text-slate">Risk Title *</label>
                <input
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Unforeseen rock excavation delays groundworks"
                  className="mt-1 w-full border border-ink-mid bg-ink-light p-2 text-xs text-paper outline-none focus:border-amber-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-mono uppercase text-slate">Category</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="mt-1 w-full border border-ink-mid bg-ink-light p-2 text-xs text-paper outline-none focus:border-amber-500 font-mono"
                  >
                    {RISK_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-mono uppercase text-slate">Status</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as any)}
                    className="mt-1 w-full border border-ink-mid bg-ink-light p-2 text-xs text-paper outline-none focus:border-amber-500 uppercase font-mono"
                  >
                    <option value="open">Open</option>
                    <option value="mitigating">Mitigating</option>
                    <option value="accepted">Accepted</option>
                    <option value="closed">Closed</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-mono uppercase text-slate">Likelihood (1 to 5)</label>
                  <input
                    type="number"
                    min={1}
                    max={5}
                    value={likelihood}
                    onChange={(e) => setLikelihood(Number(e.target.value))}
                    className="mt-1 w-full border border-ink-mid bg-ink-light p-2 text-xs text-paper outline-none focus:border-amber-500 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-mono uppercase text-slate">Impact (1 to 5)</label>
                  <input
                    type="number"
                    min={1}
                    max={5}
                    value={impact}
                    onChange={(e) => setImpact(Number(e.target.value))}
                    className="mt-1 w-full border border-ink-mid bg-ink-light p-2 text-xs text-paper outline-none focus:border-amber-500 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-mono uppercase text-slate">Description</label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Root cause, conditions and potential exposure..."
                  className="mt-1 w-full border border-ink-mid bg-ink-light p-2 text-xs text-paper outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block text-xs font-mono uppercase text-slate">Mitigation / Response Plan</label>
                <textarea
                  rows={2}
                  value={responsePlan}
                  onChange={(e) => setResponsePlan(e.target.value)}
                  placeholder="Specific actions to eliminate or reduce impact..."
                  className="mt-1 w-full border border-ink-mid bg-ink-light p-2 text-xs text-paper outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block text-xs font-mono uppercase text-slate">Review Due Date</label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="mt-1 w-full border border-ink-mid bg-ink-light p-2 text-xs text-paper outline-none focus:border-amber-500 font-mono"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="border border-ink-mid px-4 py-2 font-mono text-xs text-slate-light hover:text-paper"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || !title.trim()}
                  className="border border-amber-500 bg-amber-500 px-4 py-2 font-mono text-xs font-bold uppercase text-ink hover:bg-amber-400 disabled:opacity-50 flex items-center gap-1.5"
                >
                  {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                  <span>{submitting ? "Saving..." : "Save Risk"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
