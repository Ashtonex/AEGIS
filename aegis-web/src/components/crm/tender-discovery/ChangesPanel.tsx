"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { decideSourceChange, listSourceChanges, type SourceChange } from "@/lib/api/tender-discovery";
import { Chip, btn, errorMessage, fmtHarare } from "./shared";

function show(value: any): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) return `${fmtHarare(value)} Africa/Harare`;
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function ChangeList({ changes, canDecide, onDecided }: { changes: SourceChange[]; canDecide: boolean; onDecided: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const decide = async (id: string, action: "apply" | "acknowledge") => {
    setBusy(id);
    setMessage(null);
    try {
      const res = await decideSourceChange(id, action);
      setMessage([...(res.data?.applied || []), ...(res.data?.kept || [])].join(" ") || res.message || "Saved.");
      onDecided();
    } catch (err) {
      setMessage(errorMessage(err, "Could not record the decision."));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-2" data-testid="change-list">
      {message && <p className="text-xs text-sky-200">{message}</p>}
      {changes.map((ch) => (
        <div key={ch.id} className="rounded-sm border border-white/5 bg-black/30 p-3 text-xs">
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip className={ch.is_material ? "border-rose-400/30 text-rose-300" : "border-white/10 text-slate-light"}>{ch.change_kind.replace(/_/g, " ")}</Chip>
            <Chip className="border-white/10 text-slate-light">{ch.review_status}</Chip>
            <span className="text-slate">detected {fmtHarare(ch.detected_at)}</span>
          </div>
          {(ch.title || ch.tender_name) && (
            <p className="mt-1 text-paper">{ch.tender_name || ch.title}{ch.official_reference ? ` · ${ch.official_reference}` : ""}</p>
          )}
          <div className="mt-1.5 grid gap-1 sm:grid-cols-2">
            <div><p className="text-slate">Before ({ch.field_key.replace(/_/g, " ")})</p><p className="text-slate-light">{show(ch.old_value)}</p>
              {ch.old_evidence?.excerpt && <p className="mt-0.5 text-[11px] text-slate">“{ch.old_evidence.excerpt}”</p>}</div>
            <div><p className="text-slate">After</p><p className="text-paper">{show(ch.new_value)}</p>
              {ch.new_evidence?.excerpt && <p className="mt-0.5 text-[11px] text-slate">“{ch.new_evidence.excerpt}”</p>}
              {ch.new_evidence?.source_url && <a className="text-[11px] text-[#D4AF37] hover:underline" href={ch.new_evidence.source_url} target="_blank" rel="noopener noreferrer">source</a>}</div>
          </div>
          {ch.review_status !== "pending" && (
            <p className="mt-1 text-slate">{ch.review_status} {ch.reviewed_by_name ? `by ${ch.reviewed_by_name}` : ""} {fmtHarare(ch.reviewed_at)}</p>
          )}
          {canDecide && ch.review_status === "pending" && (
            <div className="mt-2 flex flex-wrap gap-2">
              <button className={btn.primary} disabled={!!busy || !ch.tender_id} title={ch.tender_id ? "" : "Not imported yet"} onClick={() => decide(ch.id, "apply")}>
                {busy === ch.id && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Apply to tender
              </button>
              <button className={btn.ghost} disabled={!!busy} onClick={() => decide(ch.id, "acknowledge")}>Acknowledge only</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function ChangesPanel({ canDecide, onOpen, refreshKey, onChanged }: { canDecide: boolean; onOpen: (candidateId: string) => void; refreshKey: number; onChanged: () => void }) {
  const [status, setStatus] = useState<"pending" | "all">("pending");
  const [rows, setRows] = useState<SourceChange[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows((await listSourceChanges(status)).data || []);
    } catch (err) {
      setError(errorMessage(err, "Could not load changes."));
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {(["pending", "all"] as const).map((s) => (
          <button key={s} className={status === s ? btn.primary : btn.ghost} onClick={() => setStatus(s)}>{s === "pending" ? "Needs review" : "History"}</button>
        ))}
      </div>
      <p className="text-xs text-slate-light">Changes to imported notices are never applied silently. Applying a closing-date change updates the tender deadline and its calendar reminder; fields edited in AEGIS are left alone.</p>
      {error && <p className="text-sm text-rose-300">{error}</p>}
      {loading ? <Loader2 className="h-5 w-5 animate-spin text-[#D4AF37]" /> : rows.length === 0 ? (
        <p className="rounded-sm border border-dashed border-white/10 p-6 text-center text-sm text-slate-light">No {status === "pending" ? "changes waiting for review" : "recorded changes"}.</p>
      ) : (
        <>
          <ChangeList changes={rows} canDecide={canDecide} onDecided={() => { void load(); onChanged(); }} />
          <div className="flex flex-wrap gap-2 text-xs">
            {Array.from(new Set(rows.map((r) => r.candidate_id))).slice(0, 10).map((cid) => (
              <button key={cid} className="text-[#D4AF37] hover:underline" onClick={() => onOpen(cid)}>Open notice {rows.find((r) => r.candidate_id === cid)?.official_reference || ""}</button>
            ))}
          </div>
        </>
      )}
      <Link href="/dashboard/crm/tenders" className="text-xs text-slate-light hover:underline">Go to tender pipeline →</Link>
    </div>
  );
}
