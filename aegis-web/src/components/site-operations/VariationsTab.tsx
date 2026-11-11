"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, FileDiff, Plus, RefreshCw, X } from "lucide-react";
import { decideFinanceVariation, getSiteVariations, logSiteVariation } from "@/lib/api";
import { ApiRecord, Btn, Locked, Notice, Panel, Pill, areaClass, errorText, fieldClass, num, usd } from "./ui";

const ORIGINS: [string, string][] = [
  ["site_initiated", "Site condition / site team"],
  ["client_initiated", "Client instruction"],
  ["designer_initiated", "Architect / engineer instruction"],
  ["statutory", "Council / statutory requirement"],
  ["internal_loss", "Our own rework or loss"],
];
const CLASSES: [string, string][] = [
  ["site_condition_variation", "Site condition (rock, water, access…)"],
  ["client_variation", "Client change to scope"],
  ["design_variation", "Design change / drawing revision"],
  ["quantity_variance", "Quantity over the BOQ"],
  ["emergency_variance", "Emergency work"],
  ["internal_cost_variance", "Internal cost (not claimable)"],
];
const EMPTY = {
  title: "", description: "", change_type: "addition", variance_origin: "site_initiated",
  variance_classification: "site_condition_variation", cost_impact: "", time_impact_days: "0",
  approval_route: "client_and_internal", instruction_given_by: "", instruction_reference: "", location: "", notes: "",
};

function tone(status: string): "green" | "red" | "blue" | "amber" | "slate" {
  if (status === "approved" || status === "incorporated") return "green";
  if (status === "rejected" || status === "cancelled") return "red";
  if (status === "submitted") return "blue";
  return "amber";
}

export function VariationsTab({ projectId, projectName, canApprove }: { projectId: string; projectName: string; canApprove: boolean }) {
  const [rows, setRows] = useState<ApiRecord[]>([]);
  const [totals, setTotals] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "error" | "success" | "info"; text: string } | null>(null);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const res = await getSiteVariations(projectId);
      setRows(Array.isArray(res.data) ? res.data : []);
      setTotals((res as any).totals ?? null);
    } catch (reason) {
      setNotice({ tone: "error", text: errorText(reason, "Variations could not be loaded.") });
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  if (!projectId) return <Locked title="Choose a project" body="Variations are logged against a project." />;

  const submit = async () => {
    if (form.title.trim().length < 3) { setNotice({ tone: "error", text: "Give the variation a short title." }); return; }
    setBusy("log");
    try {
      const res = await logSiteVariation({
        project_id: projectId,
        title: form.title.trim(),
        description: form.description.trim() || null,
        change_type: form.change_type,
        variance_origin: form.variance_origin,
        variance_classification: form.variance_classification,
        cost_impact: num(form.cost_impact),
        time_impact_days: Math.max(0, Math.round(num(form.time_impact_days))),
        approval_route: form.approval_route,
        instruction_given_by: form.instruction_given_by.trim() || null,
        instruction_reference: form.instruction_reference.trim() || null,
        location: form.location.trim() || null,
        notes: form.notes.trim() || null,
      });
      setNotice({ tone: "success", text: res?.message || "Variation logged." });
      setForm(EMPTY);
      setShowForm(false);
      await load();
    } catch (reason) {
      setNotice({ tone: "error", text: errorText(reason, "The variation could not be saved.") });
    } finally {
      setBusy(null);
    }
  };

  const decide = async (v: ApiRecord, decision: "approve" | "reject") => {
    let reason: string | undefined;
    if (decision === "reject") {
      reason = window.prompt(`Why is ${v.variation_number} rejected?`) || undefined;
      if (!reason) return;
    } else if (!window.confirm(`Approve ${v.variation_number} (${usd(v.cost_impact, 2)}, ${v.time_impact_days ?? 0} day(s))? It adds to the contract value and programme.`)) {
      return;
    }
    setBusy(`${decision}-${v.id}`);
    try {
      await decideFinanceVariation(String(v.id), decision, reason);
      setNotice({ tone: "success", text: `${v.variation_number} ${decision === "approve" ? "approved" : "rejected"}.` });
      await load();
    } catch (reason2) {
      setNotice({ tone: "error", text: errorText(reason2, "The decision could not be saved.") });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      {notice ? <Notice tone={notice.tone} onClose={() => setNotice(null)}>{notice.text}</Notice> : null}

      <section className="grid gap-3 sm:grid-cols-4">
        {[
          ["Variations", String(totals?.count ?? rows.length)],
          ["Approved value", usd(totals?.approved_value ?? 0)],
          ["Awaiting decision", usd(totals?.pending_value ?? 0)],
          ["Approved time", `${totals?.approved_days ?? 0} day(s)`],
        ].map(([label, value]) => (
          <div key={label} className="border border-ink-mid bg-ink p-3">
            <p className="font-mono text-[10px] uppercase tracking-wider text-slate">{label}</p>
            <p className="mt-1 font-mono text-xl text-paper">{value}</p>
          </div>
        ))}
      </section>

      <Panel
        title={`Variation register · ${projectName || "project"}`}
        subtitle="Log every change on site the day it happens: client or engineer instructions, site conditions, extra work. Each one goes to the QS and project manager, and shows in project financials, the client portal and the final account."
        actions={
          <div className="flex gap-2">
            <Btn tone="ghost" icon={<RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />} onClick={() => void load()}>Refresh</Btn>
            <Btn icon={showForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />} onClick={() => setShowForm((v) => !v)}>{showForm ? "Cancel" : "Log a variation"}</Btn>
          </div>
        }
      >
        {showForm ? (
          <div className="mb-5 grid gap-3 border border-signal/30 bg-signal/5 p-4 md:grid-cols-2">
            <label className="grid gap-1 text-xs text-slate-light md:col-span-2">What changed? *
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Extra excavation in rock at Unit 4 footings" className={fieldClass} />
            </label>
            <label className="grid gap-1 text-xs text-slate-light md:col-span-2">Details
              <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What was found or instructed, what work it adds or removes, measurements" className={`${areaClass} min-h-20`} />
            </label>
            <label className="grid gap-1 text-xs text-slate-light">Type of change
              <select value={form.change_type} onChange={(e) => setForm({ ...form, change_type: e.target.value })} className={fieldClass}>
                <option value="addition">Addition (extra work)</option>
                <option value="omission">Omission (work removed)</option>
                <option value="substitution">Substitution (different spec)</option>
              </select>
            </label>
            <label className="grid gap-1 text-xs text-slate-light">Where it came from
              <select value={form.variance_origin} onChange={(e) => setForm({ ...form, variance_origin: e.target.value })} className={fieldClass}>
                {ORIGINS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-xs text-slate-light">Category
              <select value={form.variance_classification} onChange={(e) => setForm({ ...form, variance_classification: e.target.value })} className={fieldClass}>
                {CLASSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-xs text-slate-light">Who must approve
              <select value={form.approval_route} onChange={(e) => setForm({ ...form, approval_route: e.target.value })} className={fieldClass}>
                <option value="client_and_internal">Client and us</option>
                <option value="client">Client</option>
                <option value="internal">Internal only</option>
              </select>
            </label>
            <label className="grid gap-1 text-xs text-slate-light">Estimated value ($)
              <input type="number" min="0" step="0.01" value={form.cost_impact} onChange={(e) => setForm({ ...form, cost_impact: e.target.value })} placeholder="QS will confirm" className={fieldClass} />
            </label>
            <label className="grid gap-1 text-xs text-slate-light">Extra time (days)
              <input type="number" min="0" step="1" value={form.time_impact_days} onChange={(e) => setForm({ ...form, time_impact_days: e.target.value })} className={fieldClass} />
            </label>
            <label className="grid gap-1 text-xs text-slate-light">Instructed by
              <input value={form.instruction_given_by} onChange={(e) => setForm({ ...form, instruction_given_by: e.target.value })} placeholder="Name / role (verbal or written)" className={fieldClass} />
            </label>
            <label className="grid gap-1 text-xs text-slate-light">Instruction reference
              <input value={form.instruction_reference} onChange={(e) => setForm({ ...form, instruction_reference: e.target.value })} placeholder="SI number, email, drawing revision" className={fieldClass} />
            </label>
            <label className="grid gap-1 text-xs text-slate-light md:col-span-2">Location on site
              <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Block / unit / grid line" className={fieldClass} />
            </label>
            <div className="flex justify-end md:col-span-2">
              <Btn busy={busy === "log"} icon={<FileDiff className="h-4 w-4" />} onClick={() => void submit()}>Log variation</Btn>
            </div>
          </div>
        ) : null}

        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-light">{loading ? "Loading variations…" : "No variations on this project yet."}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-ink-mid font-mono uppercase text-slate">
                <tr>
                  <th className="px-3 py-2">Number</th>
                  <th className="px-3 py-2">Variation</th>
                  <th className="px-3 py-2">From</th>
                  <th className="px-3 py-2 text-right">Value</th>
                  <th className="px-3 py-2 text-right">Days</th>
                  <th className="px-3 py-2">Status</th>
                  {canApprove ? <th className="px-3 py-2 text-right">Decision</th> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-mid/60">
                {rows.map((v) => {
                  const open = v.status === "pending" || v.status === "submitted";
                  const clientWait = v.client_approval_required && v.client_approval_status !== "approved";
                  return (
                    <tr key={v.id} className="align-top">
                      <td className="px-3 py-2 font-mono text-paper">{v.variation_number}</td>
                      <td className="px-3 py-2">
                        <p className="font-medium text-paper">{v.title}</p>
                        {v.scope_impact ? <p className="text-[11px] text-slate-light">{v.scope_impact}</p> : null}
                        {v.rejection_reason ? <p className="text-[11px] text-red-300">Rejected: {v.rejection_reason}</p> : null}
                      </td>
                      <td className="px-3 py-2 text-slate-light">{String(v.source_type || "finance").replace(/_/g, " ")}{v.logged_by_name ? ` · ${v.logged_by_name}` : ""}</td>
                      <td className={`px-3 py-2 text-right font-mono ${num(v.cost_impact) < 0 ? "text-amber-300" : "text-paper"}`}>{usd(v.cost_impact, 2)}</td>
                      <td className="px-3 py-2 text-right font-mono">{v.time_impact_days ?? 0}</td>
                      <td className="px-3 py-2">
                        <Pill tone={tone(String(v.status))}>{String(v.status)}</Pill>
                        {open && clientWait ? <p className="mt-1 text-[10px] text-amber-300">client approval {v.client_approval_status ?? "pending"}</p> : null}
                      </td>
                      {canApprove ? (
                        <td className="px-3 py-2 text-right">
                          {open ? (
                            <div className="flex justify-end gap-1">
                              <Btn tone="success" className="h-7 px-2 text-[11px]" busy={busy === `approve-${v.id}`} disabled={clientWait} title={clientWait ? "Waiting for the client to approve it in the client portal" : undefined} icon={<CheckCircle2 className="h-3.5 w-3.5" />} onClick={() => void decide(v, "approve")}>Approve</Btn>
                              <Btn tone="danger" className="h-7 px-2 text-[11px]" busy={busy === `reject-${v.id}`} onClick={() => void decide(v, "reject")}>Reject</Btn>
                            </div>
                          ) : <span className="text-slate">—</span>}
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-4 text-[11px] text-slate-light">
          Approved variations add to the contract value in <Link href={`/dashboard/projects/${projectId}/financials`} className="text-signal hover:underline">project financials</Link> and appear in the client portal and final account.
        </p>
      </Panel>
    </div>
  );
}
