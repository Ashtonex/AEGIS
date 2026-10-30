"use client";

/**
 * Award and operational handoff. The award names the issued revision the
 * client accepted; the project budget seeds from that frozen snapshot. The
 * handoff view reads what actually exists downstream (project, approved
 * budget, BOQ lines, procurement plan, planning packages), so a partial
 * handoff shows as partial. The materials schedule is planning only.
 */
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, CircleDashed, PackageSearch, Trophy, XCircle } from "lucide-react";
import {
  createQuotationMaterialsSchedule,
  decideQuotation,
  getQuotationHandoff,
  getQuotationMaterialsSchedule,
  type QuotationRevisionSummary,
} from "@/lib/api/quotations";
import { formatMoney, formatQty } from "./domain";

interface Props {
  quotationId: string;
  currency: string;
  status: string;
  revisions: QuotationRevisionSummary[];
  isAuthor: boolean;
  canDecide: boolean;
  dirty: boolean;
  onDecided: (message: string) => void;
}

export function HandoffPanel({ quotationId, currency, status, revisions, isAuthor, canDecide, dirty, onDecided }: Props) {
  const issued = revisions.filter((r) => r.kind === "issued");
  const [revisionId, setRevisionId] = useState<string>(issued[0]?.id ?? "");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [handoff, setHandoff] = useState<any | null>(null);
  const [schedule, setSchedule] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!revisionId && issued[0]) setRevisionId(issued[0].id);
  }, [issued, revisionId]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [h, s] = await Promise.all([getQuotationHandoff(quotationId), getQuotationMaterialsSchedule(quotationId)]);
      setHandoff(h.data);
      setSchedule(s.data);
    } catch (err) {
      setMessage({ tone: "error", text: (err as Error).message });
    } finally {
      setLoading(false);
    }
  }, [quotationId]);

  useEffect(() => {
    void load();
  }, [load, status]);

  const decide = async (decision: "won" | "lost") => {
    if (decision === "won" && !window.confirm("Mark this quotation WON? This seeds the project's approved execution budget from the selected issued revision.")) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await decideQuotation(quotationId, decision, notes || undefined, decision === "won" ? revisionId || undefined : undefined);
      setMessage({ tone: "ok", text: res.message || `Marked ${decision}.` });
      onDecided(res.message || `Marked ${decision}.`);
      await load();
    } catch (err) {
      setMessage({ tone: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const createSchedule = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await createQuotationMaterialsSchedule(quotationId);
      setMessage({ tone: "ok", text: res.message || "Materials schedule ready." });
      await load();
    } catch (err) {
      setMessage({ tone: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const closed = status === "won" || status === "lost";
  const step = (done: boolean, label: React.ReactNode, detail?: React.ReactNode) => (
    <li className="flex items-start gap-2 text-sm">
      {done ? <CheckCircle2 className="w-4 h-4 text-success mt-0.5 shrink-0" /> : <CircleDashed className="w-4 h-4 text-slate mt-0.5 shrink-0" />}
      <div><p className={done ? "text-paper" : "text-slate"}>{label}</p>{detail && <p className="text-xs text-slate">{detail}</p>}</div>
    </li>
  );

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="border border-ink-mid rounded-sm bg-ink p-4 space-y-3">
        <h2 className="text-sm font-semibold text-paper flex items-center gap-2"><Trophy className="w-4 h-4" /> Award</h2>
        {closed ? (
          <p className="text-sm">This quotation is <span className={status === "won" ? "text-success" : "text-danger"}>{status}</span>
            {handoff?.awarded_revision_number ? ` on issued revision ${handoff.awarded_revision_number}` : status === "won" ? " (no revision named - the budget used the saved draft)" : ""}.
          </p>
        ) : !canDecide ? (
          <p className="text-sm text-slate">Recording the client&apos;s decision needs the quotations decision permission.</p>
        ) : isAuthor ? (
          <p className="text-sm text-slate">You built this estimate, so an independent person must record the award.</p>
        ) : (
          <>
            <label className="text-xs text-slate block">Revision the client accepted
              <select className="block w-full bg-void border border-ink-mid rounded-sm px-2 py-1.5 text-sm text-paper mt-0.5" value={revisionId} onChange={(e) => setRevisionId(e.target.value)}>
                {issued.length === 0 && <option value="">No issued revision - issue one first</option>}
                {issued.map((r) => <option key={r.id} value={r.id}>Rev {r.revision_number} · {formatMoney(r.grand_total, r.currency || currency)} · {new Date(r.created_at).toLocaleDateString()}</option>)}
              </select>
            </label>
            <textarea className="w-full bg-void border border-ink-mid rounded-sm px-2 py-1.5 text-sm text-paper" rows={2} placeholder="Decision notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
            {dirty && <p className="text-xs text-warning">You have unsaved changes - they are not part of any issued revision.</p>}
            <p className="text-[11px] text-slate">Required SOP checklists and the independent sign-off are checked on the server.</p>
            <div className="flex gap-2">
              <button type="button" disabled={busy || !revisionId} onClick={() => decide("won")} className="px-3 py-1.5 text-xs rounded-sm bg-success/20 border border-success/40 text-success disabled:opacity-40">Mark won</button>
              <button type="button" disabled={busy} onClick={() => decide("lost")} className="px-3 py-1.5 text-xs rounded-sm border border-danger/40 text-danger disabled:opacity-40 inline-flex items-center gap-1"><XCircle className="w-3.5 h-3.5" /> Mark lost</button>
            </div>
          </>
        )}
        {message && <p role="status" className={`text-xs ${message.tone === "ok" ? "text-success" : "text-danger"}`}>{message.text}</p>}
      </section>

      <section className="border border-ink-mid rounded-sm bg-ink p-4 space-y-3">
        <h2 className="text-sm font-semibold text-paper">Operational handoff</h2>
        {loading ? <p className="text-sm text-slate">Loading…</p> : (
          <ul className="space-y-2">
            {step(!!handoff?.project, handoff?.project ? <>Project <Link className="text-signal hover:underline" href={`/dashboard/projects/${handoff.project.id}`}>{handoff.project.project_code} · {handoff.project.name}</Link></> : "Linked project", handoff?.project ? null : "Link or convert the quotation to a project.")}
            {step(!!handoff?.budget, "Approved execution budget", handoff?.budget ? `${formatMoney(handoff.budget.total_amount, currency)} · version ${handoff.budget.budget_version} · ${handoff.budget.status}` : "Seeded on award when a project is linked.")}
            {step((handoff?.boq_lines ?? 0) > 0, "Project BOQ lines", handoff?.boq_lines ? `${handoff.boq_lines} active lines for progress measurement` : undefined)}
            {step(!!handoff?.procurement_plan, "Procurement plan", handoff?.procurement_plan ? `Stage: ${handoff.procurement_plan.stage}${handoff.procurement_plan.requisition_id ? " · draft purchase request raised" : ""}` : undefined)}
            {step(!!schedule, "Materials schedule (planning)", schedule ? `${schedule.summary?.material_lines ?? 0} materials · ${formatMoney(schedule.summary?.budget_cost ?? 0, currency)} budget cost` : "From the awarded revision's material build-ups.")}
          </ul>
        )}
        {status === "won" && !schedule && canDecide && (
          <button type="button" disabled={busy} onClick={createSchedule} className="px-3 py-1.5 text-xs rounded-sm border border-signal/50 text-signal disabled:opacity-40 inline-flex items-center gap-1">
            <PackageSearch className="w-3.5 h-3.5" /> Build materials schedule
          </button>
        )}
        <p className="text-[11px] text-slate">The schedule is a planning list - it raises no purchase order and commits no spend. Cash-flow forecasting needs a programme and payment terms and is not derived from the quotation total.</p>
      </section>

      {schedule && (
        <section className="border border-ink-mid rounded-sm bg-ink p-4 lg:col-span-2">
          <h2 className="text-sm font-semibold text-paper mb-2">Materials schedule · planning only</h2>
          <p className="text-xs text-slate mb-2">{schedule.summary?.boq_lines_without_material_buildup ?? 0} priced line(s) have no material build-up and are not represented. Lines aggregate only when name, unit and specification match.</p>
          <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
            <table className="w-full text-xs min-w-[640px]">
              <thead className="sticky top-0 bg-ink"><tr className="text-left text-slate"><th className="font-normal py-1">Material</th><th className="font-normal py-1 text-right">Quantity</th><th className="font-normal py-1">Unit</th><th className="font-normal py-1 text-right">Budget cost</th><th className="font-normal py-1">From BOQ lines</th></tr></thead>
              <tbody>
                {(schedule.lines || []).map((l: any, i: number) => (
                  <tr key={i} className="border-t border-ink-mid align-top">
                    <td className="py-1">{l.material}{l.specification ? <span className="text-slate"> · {l.specification}</span> : null}{l.mixed_unit_costs ? <span className="text-warning"> · mixed unit costs</span> : null}</td>
                    <td className="py-1 text-right font-mono">{formatQty(Number(l.quantity))}</td>
                    <td className="py-1">{l.unit}</td>
                    <td className="py-1 text-right font-mono">{formatMoney(l.budget_cost, currency)}</td>
                    <td className="py-1 text-slate">{(l.sources || []).map((s: any) => s.item_no || s.description).join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
