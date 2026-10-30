"use client";

/**
 * Drawing takeoffs linked to this quotation (takeoff.drawing_revisions).
 * Measurements become BOQ lines carrying their drawing/revision reference.
 * A revision that has not been checked and committed is provisional: its
 * lines are marked unverified and flagged in review. Measuring itself
 * (upload, AI/CAD extraction, checklist) stays on the Drawing Takeoff page.
 */
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Ruler } from "lucide-react";
import { getDrawingRevisionAsBoq, listDrawingRevisions } from "@/lib/api/quotations";
import { BoqLine, newLineId } from "./domain";

interface Props {
  quotationId: string;
  readOnly: boolean;
  lines: BoqLine[];
  onImport: (lines: BoqLine[]) => void;
}

export function DrawingsPanel({ quotationId, readOnly, lines, onImport }: Props) {
  const [revisions, setRevisions] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await listDrawingRevisions({ quotation_id: quotationId });
      setRevisions(res.data || []);
    } catch (err) {
      setError((err as Error).message);
      setRevisions([]);
    }
  }, [quotationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const importRevision = async (rev: any) => {
    setBusyId(rev.id);
    setError(null);
    try {
      const res = await getDrawingRevisionAsBoq(rev.id);
      const verified = rev.status === "committed";
      onImport((res.data?.items || []).map((it: any) => ({
        line_id: newLineId(),
        section: `Takeoff: ${rev.drawing_name}`,
        item_no: "",
        description: String(it.description || ""),
        item_type: "measured" as const,
        qty: Number(it.quantity ?? it.qty) || 0,
        unit: String(it.unit || ""),
        rate: 0,
        buildup: [],
        takeoff: { drawing_revision_id: rev.id, drawing_name: rev.drawing_name, revision_label: rev.revision_label, verified },
        review_status: "unreviewed" as const,
      })));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const linkedCount = (id: string) => lines.filter((l) => l.takeoff?.drawing_revision_id === id).length;

  return (
    <section className="border border-ink-mid rounded-sm bg-ink p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-paper flex items-center gap-2"><Ruler className="w-4 h-4" /> Drawings & takeoff</h2>
        <Link href={`/dashboard/quotations/drawings`} className="text-xs text-signal hover:underline">Open Drawing Takeoff</Link>
      </div>
      <p className="text-xs text-slate">Imported quantities arrive unpriced. Quantities from an uncommitted takeoff are provisional until its checklist is completed and committed.</p>
      {error && <p className="text-xs text-danger" role="alert">{error}</p>}
      {revisions === null ? <p className="text-sm text-slate">Loading…</p> : revisions.length === 0 ? (
        <p className="text-sm text-slate">No drawing takeoffs are linked to this quotation. Create one on the Drawing Takeoff page and link it to this quotation.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[600px]">
            <thead><tr className="text-[11px] uppercase tracking-wider text-slate text-left"><th className="font-normal pb-1">Drawing</th><th className="font-normal pb-1">Source</th><th className="font-normal pb-1">Status</th><th className="font-normal pb-1">In BOQ</th><th /></tr></thead>
            <tbody>
              {revisions.map((rev) => (
                <tr key={rev.id} className="border-t border-ink-mid">
                  <td className="py-1.5">{rev.drawing_name} <span className="text-slate font-mono">{rev.revision_label}</span></td>
                  <td className="py-1.5 text-xs text-slate">{rev.source_mode}{rev.extraction_confidence_pct != null ? ` · ${rev.extraction_confidence_pct}% confidence` : ""}</td>
                  <td className={`py-1.5 text-xs ${rev.status === "committed" ? "text-success" : rev.status === "superseded" ? "text-slate" : "text-warning"}`}>{rev.status === "draft" ? "draft - unverified" : rev.status}</td>
                  <td className="py-1.5 text-xs">{linkedCount(rev.id) || "—"}{rev.status === "superseded" && linkedCount(rev.id) ? <span className="text-warning"> · re-check against the newer revision</span> : null}</td>
                  <td className="py-1.5 text-right">
                    {!readOnly && rev.status !== "superseded" && (
                      <button type="button" disabled={busyId === rev.id} className="text-xs text-signal hover:underline disabled:opacity-40" onClick={() => importRevision(rev)}>
                        {busyId === rev.id ? "Importing…" : "Add quantities to BOQ"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
