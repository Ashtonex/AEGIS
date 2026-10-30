"use client";

/**
 * Revisions: freeze the saved draft as an issued (client) revision or an
 * internal checkpoint, compare any two (or a revision against the working
 * draft) by stable line identity, and download documents generated from a
 * frozen revision only.
 */
import React, { useEffect, useState } from "react";
import { Download, FileSpreadsheet, FileText, GitCompare, Lock } from "lucide-react";
import {
  compareQuotationRevisions,
  downloadQuotationRevisionDocument,
  issueQuotationRevision,
  type QuotationRevisionSummary,
  type RevisionComparison,
} from "@/lib/api/quotations";
import { formatMoney, formatQty } from "./domain";

interface Props {
  quotationId: string;
  reference: string;
  currency: string;
  revisions: QuotationRevisionSummary[];
  rowVersion: number | null;
  status: string;
  dirty: boolean;
  workingMatchesLatest: boolean | null;
  blockingFlags: number;
  approved: boolean;
  onIssued: (message: string) => void;
}

export function RevisionsPanel(props: Props) {
  const { quotationId, reference, currency, revisions, rowVersion, status, dirty } = props;
  const closed = status === "won" || status === "lost";
  const [kind, setKind] = useState<"issued" | "internal">("issued");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [base, setBase] = useState<string>("");
  const [target, setTarget] = useState<string>("working");
  const [comparison, setComparison] = useState<RevisionComparison | null>(null);
  const [comparing, setComparing] = useState(false);

  useEffect(() => {
    if (!base && revisions.length) setBase(revisions[0].id);
  }, [base, revisions]);

  const issue = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await issueQuotationRevision(quotationId, { kind, change_reason: reason.trim() || undefined, expected_row_version: rowVersion ?? undefined });
      setReason("");
      setMessage({ tone: "ok", text: res.message || "Revision frozen." });
      props.onIssued(res.message || "Revision frozen.");
    } catch (err) {
      setMessage({ tone: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const compare = async () => {
    if (!base) return;
    setComparing(true);
    setMessage(null);
    try {
      const res = await compareQuotationRevisions(quotationId, base, target);
      setComparison(res.data ?? null);
    } catch (err) {
      setMessage({ tone: "error", text: (err as Error).message });
    } finally {
      setComparing(false);
    }
  };

  const download = async (revision: QuotationRevisionSummary, docKind: "client-pdf" | "internal-xlsx") => {
    try {
      const blob = await downloadQuotationRevisionDocument(quotationId, revision.id, docKind);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${reference || "quotation"}_Rev${revision.revision_number}${docKind === "client-pdf" ? ".pdf" : "_INTERNAL.xlsx"}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setMessage({ tone: "error", text: (err as Error).message });
    }
  };

  const issueBlocked = closed || dirty || (kind === "issued" && (!props.approved || props.blockingFlags > 0));

  return (
    <div className="space-y-4">
      <section className="border border-ink-mid rounded-sm bg-ink p-4 space-y-3">
        <h2 className="text-sm font-semibold text-paper flex items-center gap-2"><Lock className="w-4 h-4" /> Freeze a revision</h2>
        <p className="text-xs text-slate">
          A frozen revision is an immutable copy of the saved estimate and its server-calculated totals. Later edits change the working draft only.
          {props.workingMatchesLatest === true && revisions.length ? " The working draft currently matches the latest revision." : ""}
          {props.workingMatchesLatest === false ? " The working draft has changed since the latest revision." : ""}
        </p>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2"><input type="radio" name="rev-kind" checked={kind === "issued"} onChange={() => setKind("issued")} /> Issue to client</label>
          <label className="flex items-center gap-2"><input type="radio" name="rev-kind" checked={kind === "internal"} onChange={() => setKind("internal")} /> Internal checkpoint</label>
        </div>
        <textarea className="w-full bg-void border border-ink-mid rounded-sm px-2 py-1.5 text-sm text-paper" rows={2} placeholder="Reason for this revision (e.g. client query on bill 2)" value={reason} onChange={(e) => setReason(e.target.value)} />
        <ul className="text-xs text-slate space-y-0.5">
          {closed && <li className="text-warning">Quotation is {status} - changes after award go through a variation, not a new revision.</li>}
          {dirty && <li className="text-warning">Save your changes first - only saved work can be frozen.</li>}
          {kind === "issued" && !props.approved && <li className="text-warning">Issuing needs independent approval of the current BOQ lines.</li>}
          {kind === "issued" && props.blockingFlags > 0 && <li className="text-warning">{props.blockingFlags} blocking review flag(s) must be cleared before issue.</li>}
        </ul>
        <button type="button" disabled={busy || issueBlocked} onClick={issue} className="px-3 py-1.5 text-xs rounded-sm bg-signal text-void font-semibold disabled:opacity-40">
          {busy ? "Freezing…" : kind === "issued" ? "Freeze and mark issued" : "Freeze checkpoint"}
        </button>
        {message && <p role="status" className={`text-xs ${message.tone === "ok" ? "text-success" : "text-danger"}`}>{message.text}</p>}
      </section>

      <section className="border border-ink-mid rounded-sm bg-ink p-4">
        <h2 className="text-sm font-semibold text-paper mb-2">Revision history</h2>
        {revisions.length === 0 ? (
          <p className="text-sm text-slate">No revisions yet. Freeze one to issue the quotation or to keep a comparison point.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-slate text-left">
                  <th className="font-normal pb-1">Rev</th><th className="font-normal pb-1">Kind</th><th className="font-normal pb-1">Reason</th>
                  <th className="font-normal pb-1 text-right">Total</th><th className="font-normal pb-1">By / when</th><th className="font-normal pb-1 text-right">Documents</th>
                </tr>
              </thead>
              <tbody>
                {revisions.map((r) => (
                  <tr key={r.id} className="border-t border-ink-mid align-top">
                    <td className="py-1.5 font-mono">{r.revision_number}</td>
                    <td className="py-1.5">{r.kind === "issued" ? <span className="text-success">Issued</span> : <span className="text-slate">Internal</span>}</td>
                    <td className="py-1.5 text-slate max-w-[240px]">{r.change_reason || "—"}</td>
                    <td className="py-1.5 text-right font-mono">{formatMoney(r.grand_total, r.currency || currency)}</td>
                    <td className="py-1.5 text-xs text-slate">{r.created_by_name || "—"}<br />{new Date(r.created_at).toLocaleString()}</td>
                    <td className="py-1.5 text-right whitespace-nowrap">
                      <button type="button" className="text-xs text-signal hover:underline inline-flex items-center gap-1 mr-3" onClick={() => download(r, "client-pdf")} title="Client quotation: selling rates only">
                        <FileText className="w-3.5 h-3.5" /> Client PDF
                      </button>
                      <button type="button" className="text-xs text-slate hover:text-paper inline-flex items-center gap-1" onClick={() => download(r, "internal-xlsx")} title="Internal: costs, build-ups, markup and margin">
                        <FileSpreadsheet className="w-3.5 h-3.5" /> Internal
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {revisions.length > 0 && (
        <section className="border border-ink-mid rounded-sm bg-ink p-4 space-y-3">
          <h2 className="text-sm font-semibold text-paper flex items-center gap-2"><GitCompare className="w-4 h-4" /> Compare</h2>
          <div className="flex flex-wrap items-end gap-2 text-sm">
            <label className="text-xs text-slate">From
              <select className="block bg-void border border-ink-mid rounded-sm px-2 py-1 text-paper" value={base} onChange={(e) => setBase(e.target.value)}>
                {revisions.map((r) => <option key={r.id} value={r.id}>Rev {r.revision_number}</option>)}
              </select>
            </label>
            <label className="text-xs text-slate">To
              <select className="block bg-void border border-ink-mid rounded-sm px-2 py-1 text-paper" value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="working">Working draft (saved)</option>
                {revisions.map((r) => <option key={r.id} value={r.id}>Rev {r.revision_number}</option>)}
              </select>
            </label>
            <button type="button" onClick={compare} disabled={comparing || !base} className="px-3 py-1.5 text-xs rounded-sm border border-signal/50 text-signal disabled:opacity-40">{comparing ? "Comparing…" : "Compare"}</button>
          </div>
          {comparison && <ComparisonView data={comparison} currency={currency} />}
        </section>
      )}
    </div>
  );
}

function ComparisonView({ data, currency }: { data: RevisionComparison; currency: string }) {
  const v = data.variance;
  const m = (x: string | number) => formatMoney(x, currency);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <div className="border border-ink-mid rounded-sm p-2"><p className="text-slate">Client total</p><p className="font-mono">{m(data.before.grand_total)} → {m(data.after.grand_total)}</p><p className="font-mono text-signal">{m(data.grand_total_delta)}</p></div>
        <div className="border border-ink-mid rounded-sm p-2"><p className="text-slate">Direct cost</p><p className="font-mono">{m(data.before.direct_costs)} → {m(data.after.direct_costs)}</p><p className="font-mono text-signal">{m(data.direct_cost_delta)}</p></div>
        <div className="border border-ink-mid rounded-sm p-2"><p className="text-slate">Margin</p><p className="font-mono">{data.before.margin_pct?.toFixed(2) ?? "n/a"}% → {data.after.margin_pct?.toFixed(2) ?? "n/a"}%</p></div>
        <div className="border border-ink-mid rounded-sm p-2"><p className="text-slate">Lines</p><p>+{data.counts.added} / −{data.counts.removed} / ~{data.counts.changed}</p></div>
      </div>
      <table className="w-full text-xs">
        <caption className="text-left text-slate pb-1">Direct-cost movement {data.base_label} → {data.target_label}, attributed (sums exactly to the movement)</caption>
        <tbody>
          {[["Quantity effect (ΔQ × old rate)", v.qty_effect], ["Rate effect (ΔR × old qty)", v.rate_effect], ["Interaction (ΔQ × ΔR, incl. cent rounding)", v.interaction], ["Added lines", v.added], ["Removed lines", v.removed]].map(([label, value]) => (
            <tr key={label} className="border-t border-ink-mid"><td className="py-1">{label}</td><td className="py-1 text-right font-mono">{m(value)}</td></tr>
          ))}
          <tr className="border-t border-ink-mid font-semibold"><td className="py-1">Total direct-cost movement</td><td className="py-1 text-right font-mono">{m(data.direct_cost_delta)}</td></tr>
          {Number(data.rounding) !== 0 && <tr><td className="py-1 text-warning">Unattributed rounding</td><td className="py-1 text-right font-mono">{m(data.rounding)}</td></tr>}
        </tbody>
      </table>
      <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
        <table className="w-full text-xs min-w-[760px]">
          <thead className="sticky top-0 bg-ink">
            <tr className="text-left text-slate">
              <th className="font-normal py-1">Item</th><th className="font-normal py-1">Change</th><th className="font-normal py-1">Description</th>
              <th className="font-normal py-1 text-right">Qty</th><th className="font-normal py-1 text-right">Rate</th><th className="font-normal py-1 text-right">Δ Amount</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.map((line) => (
              <tr key={line.key} className="border-t border-ink-mid align-top">
                <td className="py-1 font-mono">{line.item_no || "—"}</td>
                <td className={`py-1 ${line.change === "added" ? "text-success" : line.change === "removed" ? "text-danger" : "text-warning"}`}>{line.change}</td>
                <td className="py-1">
                  {line.description_before && line.description_after && line.description_before !== line.description_after ? (
                    <><span className="line-through text-slate">{line.description_before}</span><br />{line.description_after}</>
                  ) : (line.description_after || line.description_before)}
                </td>
                <td className="py-1 text-right font-mono">{line.qty_before !== line.qty_after ? `${formatQty(Number(line.qty_before))} → ${formatQty(Number(line.qty_after))}` : formatQty(Number(line.qty_after))}</td>
                <td className="py-1 text-right font-mono">{line.rate_before !== line.rate_after ? `${m(line.rate_before)} → ${m(line.rate_after)}` : m(line.rate_after)}</td>
                <td className="py-1 text-right font-mono">{m(line.amount_delta)}</td>
              </tr>
            ))}
            {data.lines.length === 0 && <tr><td colSpan={6} className="py-2 text-slate">No line differences.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-slate flex items-center gap-1"><Download className="w-3 h-3" /> Documents are generated from frozen revisions only.</p>
    </div>
  );
}
