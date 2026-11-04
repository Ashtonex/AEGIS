"use client";

import { useState } from "react";
import { ExternalLink, EyeOff, Eye, Globe, Loader2 } from "lucide-react";
import { setProcurementNoticeVisibility } from "@/lib/api";
import type { Rec } from "@/components/procurement/shared";

/** The public tender-board notice an RFQ or PO belongs to, with a control to
 * take it off the public board (reason required) or put it back. */
export function NoticeChip({ row }: { row: Rec }) {
  const reference = typeof row.notice_reference === "string" ? row.notice_reference : "";
  const [published, setPublished] = useState<boolean>(row.notice_published !== false);
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!reference) return null;

  const save = async (next: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await setProcurementNoticeVisibility(reference, next, next ? undefined : reason.trim());
      setPublished(next);
      setAsking(false);
      setReason("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change the notice.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="inline-flex flex-col gap-1">
      <span className="inline-flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase">
        <Globe className="h-3 w-3 text-slate" />
        {published ? (
          <a href={`/tenders/${encodeURIComponent(reference)}`} target="_blank" rel="noreferrer"
            title="Open the public notice on the tender board" className="inline-flex items-center gap-1 text-signal hover:text-paper">
            {reference}<ExternalLink className="h-3 w-3" />
          </a>
        ) : (
          <span className="text-slate" title="Not shown on the public tender board">{reference} · hidden</span>
        )}
        {published ? (
          !asking && (
            <button type="button" onClick={() => setAsking(true)} className="inline-flex items-center gap-1 text-slate hover:text-paper">
              <EyeOff className="h-3 w-3" />Hide
            </button>
          )
        ) : (
          <button type="button" onClick={() => void save(true)} disabled={busy} className="inline-flex items-center gap-1 text-slate hover:text-paper disabled:opacity-50">
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Eye className="h-3 w-3" />}Show publicly
          </button>
        )}
      </span>
      {asking && (
        <span className="flex flex-wrap items-center gap-2">
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why hide it from the public?"
            aria-label="Reason for hiding the notice" maxLength={500}
            className="h-8 min-w-[12rem] flex-1 border border-ink-mid bg-ink-light px-2 text-xs text-paper" />
          <button type="button" onClick={() => void save(false)} disabled={busy || !reason.trim()}
            className="h-8 border border-ink-mid px-2 font-mono text-[10px] uppercase text-slate-light hover:border-signal hover:text-paper disabled:opacity-40">
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : "Hide"}
          </button>
          <button type="button" onClick={() => { setAsking(false); setReason(""); }} className="font-mono text-[10px] uppercase text-slate hover:text-paper">Cancel</button>
        </span>
      )}
      {error && <span className="text-[11px] text-red-300">{error}</span>}
    </span>
  );
}
