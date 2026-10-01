"use client";

import { useEffect, useState } from "react";
import { ArrowRight, ClipboardList, Loader2, X } from "lucide-react";

import { getTenderActivityLog } from "@/lib/api/quotations";

const STAGE_LOG_MIN_LENGTH = 10;

/** Mandatory activity-log note before a tender changes stage. The backend
 * stores it against the tender and completes the open tasks of the stage
 * being left once the next stage's tasks come in. */
export function TenderStageMoveModal({
  tenderName,
  fromStage,
  toStage,
  onCancel,
  onConfirm,
}: {
  tenderName: string;
  fromStage: string;
  toStage: string;
  onCancel: () => void;
  onConfirm: (note: string) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = note.trim().length >= STAGE_LOG_MIN_LENGTH;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setSaving(true);
    setError(null);
    try {
      await onConfirm(note.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "The stage move did not save.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/85 backdrop-blur-sm" onClick={onCancel} />
      <form onSubmit={submit} className="relative w-full max-w-md space-y-4 rounded-sm border border-white/10 bg-[#0A0A0A] p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-sans text-sm font-bold uppercase tracking-wider text-paper">Log this stage move</h2>
          <button type="button" onClick={onCancel} className="text-slate-light hover:text-paper"><X className="h-4 w-4" /></button>
        </div>
        <div className="rounded-sm border border-white/5 bg-black/40 p-3">
          <span className="block truncate font-mono text-[8px] uppercase tracking-wider text-slate-light">{tenderName}</span>
          <div className="mt-1 flex items-center gap-2 text-xs text-paper">
            <span>{fromStage}</span>
            <ArrowRight className="h-3.5 w-3.5 text-[#D4AF37]" />
            <span className="font-bold">{toStage}</span>
          </div>
        </div>
        <div className="space-y-1">
          <label className="block font-mono text-[9px] uppercase tracking-wider text-slate-light">
            Activity log - what happened in {fromStage} and why it is moving (required)
          </label>
          <textarea
            required
            autoFocus
            rows={4}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full resize-none rounded-sm border border-white/10 bg-black px-3 py-2 text-xs text-paper outline-none focus:border-[#D4AF37]"
            placeholder="e.g. Bid submitted by hand at the procuring entity on 30 Sept, receipt stamped; bid bond valid to 30 Dec."
          />
          <p className="font-mono text-[9px] text-slate-light">
            Saved to the tender&apos;s activity log. Open tasks from {fromStage} are marked complete when {toStage}&apos;s tasks come in.
          </p>
        </div>
        {error && <p className="text-xs text-red-300">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-white/5 pt-3">
          <button type="button" onClick={onCancel} className="rounded-sm px-4 py-2 font-mono text-[10px] uppercase text-slate-light hover:bg-white/5 hover:text-paper">
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || !valid}
            className="rounded-sm bg-[#D4AF37] px-5 py-2 font-mono text-[10px] font-bold uppercase text-black hover:bg-[#D4AF37]/90 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Move tender"}
          </button>
        </div>
      </form>
    </div>
  );
}

type LogEntry = { id: string; type: string; subject: string; description: string | null; created_at: string; created_by_name: string | null };

export function TenderActivityLog({ tenderId, refreshKey = 0 }: { tenderId: string; refreshKey?: number }) {
  const [entries, setEntries] = useState<LogEntry[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setEntries(null);
    setError(false);
    getTenderActivityLog(tenderId)
      .then((res) => { if (!cancelled) setEntries(Array.isArray(res.data) ? res.data : []); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [tenderId, refreshKey]);

  if (error) return <p className="text-xs text-slate-light">Activity log could not be loaded.</p>;
  if (!entries) return <div className="flex justify-center py-3 text-slate-light"><Loader2 className="h-4 w-4 animate-spin" /></div>;
  if (entries.length === 0) return <p className="text-xs text-slate-light">No logged activity yet - stage moves will appear here.</p>;

  return (
    <ul className="max-h-64 space-y-2 overflow-y-auto pr-1">
      {entries.map((entry) => (
        <li key={entry.id} className="border-l-2 border-[#D4AF37]/40 pl-2.5">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold text-paper">
            <ClipboardList className="h-3 w-3 text-[#D4AF37]" /> {entry.subject}
          </p>
          {entry.description && <p className="whitespace-pre-line text-[11px] text-slate-light">{entry.description}</p>}
          <p className="font-mono text-[9px] text-slate">
            {entry.created_by_name || "Unknown"} · {new Date(entry.created_at).toLocaleString()}
          </p>
        </li>
      ))}
    </ul>
  );
}
