"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckSquare, ExternalLink, Filter, Loader2, Square } from "lucide-react";
import {
  importDiscoveryCandidates,
  listDiscoveryCandidates,
  type CandidateSummary,
  type ImportResult,
} from "@/lib/api/tender-discovery";
import { BAND_TONE, Chip, READINESS_LABEL, btn, errorMessage, fmtHarare, input, relativeDays } from "./shared";

export type QueueMode = "open" | "imported" | "rejected";

const EMPTY_FILTERS = {
  band: "", q: "", entity: "", location: "", category: "", notice_status: "",
  closing_from: "", closing_to: "", published_from: "", published_to: "", site_visit: "", eligibility: "",
};

export function CandidateQueue({
  mode, canImport, users, onOpen, refreshKey, onImported,
}: {
  mode: QueueMode;
  canImport: boolean;
  users: { id: string; full_name: string }[];
  onOpen: (id: string) => void;
  refreshKey: number;
  onImported: () => void;
}) {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [includeClosed, setIncludeClosed] = useState(false);
  const [rows, setRows] = useState<CandidateSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [responsible, setResponsible] = useState("");
  const [reviewDate, setReviewDate] = useState("");
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState<ImportResult[] | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listDiscoveryCandidates({
        ...filters,
        review_status: mode === "open" ? "open" : mode,
        include_closed: includeClosed || mode !== "open",
        sort: mode === "imported" ? "recent" : "relevance",
        limit: 100,
      });
      setRows(res.data || []);
      setTotal(Number((res.meta as any)?.total ?? res.data?.length ?? 0));
    } catch (err) {
      setError(errorMessage(err, "Could not load staged notices."));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filters, includeClosed, mode]);

  useEffect(() => { void load(); }, [load, refreshKey]);
  useEffect(() => { setSelected(new Set()); setResults(null); }, [mode]);

  const selectable = useMemo(() => rows.filter((r) => r.review_status !== "imported"), [rows]);
  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const runImport = async () => {
    setImporting(true);
    setResults(null);
    setError(null);
    try {
      const res = await importDiscoveryCandidates({
        items: Array.from(selected).map((candidate_id) => ({ candidate_id })),
        responsible_user_id: responsible || null,
        internal_review_date: reviewDate || null,
      });
      setResults(res.data || []);
      setSelected(new Set());
      onImported();
      await load();
    } catch (err) {
      setError(errorMessage(err, "Import failed - nothing was reported as imported."));
    } finally {
      setImporting(false);
    }
  };

  const set = (key: keyof typeof EMPTY_FILTERS) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setFilters({ ...filters, [key]: e.target.value });

  return (
    <div className="space-y-3">
      <details className="rounded-sm border border-white/5 bg-[#0A0A0A] p-3 text-xs" open={false}>
        <summary className="flex cursor-pointer items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-slate-light">
          <Filter className="h-3.5 w-3.5" /> Filters
        </summary>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <input className={input} placeholder="Keywords" value={filters.q} onChange={set("q")} />
          <input className={input} placeholder="Procuring entity" value={filters.entity} onChange={set("entity")} />
          <input className={input} placeholder="Location" value={filters.location} onChange={set("location")} />
          <input className={input} placeholder="Procurement category / code" value={filters.category} onChange={set("category")} />
          <input className={input} placeholder="Notice status (e.g. Open)" value={filters.notice_status} onChange={set("notice_status")} />
          <select className={input} value={filters.band} onChange={set("band")}>
            <option value="">Any relevance</option><option value="strong">Strong</option><option value="possible">Possible</option><option value="weak">Weak</option>
          </select>
          <select className={input} value={filters.site_visit} onChange={set("site_visit")}>
            <option value="">Site visit: any</option><option value="yes">Mandatory (confirmed)</option><option value="no">Not required (confirmed)</option><option value="unknown">Unknown</option>
          </select>
          <select className={input} value={filters.eligibility} onChange={set("eligibility")}>
            <option value="">Eligibility: any</option><option value="stated">Registration category stated</option><option value="not_stated">Not stated</option>
          </select>
          <label className="block"><span className="mb-1 block text-[11px] text-slate-light">Closing from</span><input className={input} type="date" value={filters.closing_from} onChange={set("closing_from")} /></label>
          <label className="block"><span className="mb-1 block text-[11px] text-slate-light">Closing to</span><input className={input} type="date" value={filters.closing_to} onChange={set("closing_to")} /></label>
          <label className="block"><span className="mb-1 block text-[11px] text-slate-light">Published from</span><input className={input} type="date" value={filters.published_from} onChange={set("published_from")} /></label>
          <label className="block"><span className="mb-1 block text-[11px] text-slate-light">Published to</span><input className={input} type="date" value={filters.published_to} onChange={set("published_to")} /></label>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          {mode === "open" && (
            <label className="flex items-center gap-1.5 text-slate-light">
              <input type="checkbox" checked={includeClosed} onChange={(e) => setIncludeClosed(e.target.checked)} /> Include closed notices
            </label>
          )}
          <button className={btn.ghost} onClick={() => setFilters(EMPTY_FILTERS)}>Clear</button>
        </div>
      </details>

      {canImport && mode === "open" && selected.size > 0 && (
        <div className="sticky top-0 z-20 flex flex-col gap-2 rounded-sm border border-[#D4AF37]/30 bg-[#141006] p-3 text-xs sm:flex-row sm:items-end" data-testid="bulk-import-bar">
          <p className="font-mono text-[10px] uppercase tracking-widest text-[#D4AF37] sm:mb-2">{selected.size} selected</p>
          <label className="block flex-1"><span className="mb-1 block text-[11px] text-slate-light">Responsible person</span>
            <select className={input} value={responsible} onChange={(e) => setResponsible(e.target.value)}>
              <option value="">Keep each notice&apos;s owner / unassigned</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
            </select>
          </label>
          <label className="block"><span className="mb-1 block text-[11px] text-slate-light">Internal review date</span>
            <input className={input} type="date" value={reviewDate} onChange={(e) => setReviewDate(e.target.value)} />
          </label>
          <button className={btn.primary} onClick={runImport} disabled={importing} data-testid="import-selected">
            {importing && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Import into pipeline
          </button>
        </div>
      )}

      {results && <ImportResults results={results} onOpen={onOpen} />}
      {error && <p className="flex items-center gap-1.5 text-sm text-rose-300"><AlertTriangle className="h-4 w-4" />{error}</p>}

      <div className="flex items-center justify-between text-xs text-slate-light">
        <span>{loading ? "Loading…" : `${total} notice(s)`}</span>
        {canImport && mode === "open" && selectable.length > 0 && (
          <button className="text-[#D4AF37] hover:underline" onClick={() => setSelected(selected.size === selectable.length ? new Set() : new Set(selectable.map((r) => r.id)))}>
            {selected.size === selectable.length ? "Clear selection" : "Select all shown"}
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex h-40 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-[#D4AF37]" /></div>
      ) : rows.length === 0 ? (
        <div className="rounded-sm border border-dashed border-white/10 p-6 text-center text-sm text-slate-light">
          {mode === "open" ? "No staged notices match. Run discovery or relax the filters - an empty queue is not evidence that no tenders exist; check the latest run's coverage." :
            mode === "imported" ? "Nothing has been imported yet." : "No rejected notices."}
        </div>
      ) : (
        <ul className="space-y-2" data-testid="candidate-list">
          {rows.map((row) => (
            <CandidateCard key={row.id} row={row} selectable={canImport && mode === "open" && row.review_status !== "imported"}
                           selected={selected.has(row.id)} onToggle={() => toggle(row.id)} onOpen={() => onOpen(row.id)} />
          ))}
        </ul>
      )}
    </div>
  );
}

function CandidateCard({ row, selectable, selected, onToggle, onOpen }: {
  row: CandidateSummary; selectable: boolean; selected: boolean; onToggle: () => void; onOpen: () => void;
}) {
  const remaining = relativeDays(row.closing_at);
  const readiness = READINESS_LABEL[row.readiness];
  return (
    <li className={`rounded-sm border bg-[#0A0A0A] p-3 transition ${selected ? "border-[#D4AF37]/50" : "border-white/5 hover:border-white/15"}`}>
      <div className="flex gap-3">
        {selectable && (
          <button onClick={onToggle} aria-label={selected ? "Deselect" : "Select"} className="mt-0.5 shrink-0 text-[#D4AF37]">
            {selected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4 text-slate" />}
          </button>
        )}
        <div className="min-w-0 flex-1">
          <button onClick={onOpen} className="block w-full text-left">
            <div className="flex flex-wrap items-center gap-1.5">
              {row.relevance_band && <Chip className={BAND_TONE[row.relevance_band]}>{row.relevance_band} · {row.relevance_score}</Chip>}
              <Chip className={readiness.tone}>{readiness.label}</Chip>
              {row.review_status !== "new" && <Chip className="border-white/10 text-slate-light">{row.review_status.replace(/_/g, " ")}</Chip>}
              {row.detail_status !== "fetched" && <Chip className="border-amber-400/30 text-amber-300">notice page {row.detail_status.replace("_", " ")}</Chip>}
              {row.conflict_count > 0 && <Chip className="border-rose-400/30 text-rose-300">{row.conflict_count} conflict(s)</Chip>}
              {row.pending_changes > 0 && <Chip className="border-sky-400/30 text-sky-300">{row.pending_changes} change(s)</Chip>}
            </div>
            <p className="mt-1.5 text-sm font-medium text-paper">{row.title || "(no title captured)"}</p>
            <p className="mt-0.5 text-xs text-slate-light">
              {row.official_reference || "no reference"} · {row.procuring_entity || "entity not captured"}{row.location_text ? ` · ${row.location_text}` : ""}
            </p>
            <p className="mt-1 text-xs">
              <span className="text-slate">Closes </span>
              <span className={remaining === "closed" ? "text-rose-300" : "text-paper"}>
                {row.closing_at ? `${fmtHarare(row.closing_at)} Africa/Harare` : "date/time not confirmed"}
              </span>
              {remaining && <span className="ml-1 text-slate">({remaining})</span>}
              {row.responsible_name && <span className="ml-2 text-slate">· {row.responsible_name}</span>}
            </p>
            {row.match_reasons?.length > 0 && (
              <p className="mt-1 line-clamp-2 text-[11px] text-slate">
                {row.match_reasons.filter((r) => r.points !== 0).map((r) => `${r.points > 0 ? "+" : ""}${r.points} ${r.detail}`).join(" · ")}
              </p>
            )}
          </button>
          <div className="mt-2 flex flex-wrap gap-3 text-[11px]">
            <a href={row.notice_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[#D4AF37] hover:underline">
              Official notice <ExternalLink className="h-3 w-3" />
            </a>
            {row.tender_id && <Link href={`/dashboard/crm/tenders/${row.tender_id}`} className="text-emerald-300 hover:underline">Open saved tender →</Link>}
          </div>
        </div>
      </div>
    </li>
  );
}

function ImportResults({ results, onOpen }: { results: ImportResult[]; onOpen: (id: string) => void }) {
  return (
    <div className="space-y-1.5 rounded-sm border border-white/10 bg-black/40 p-3 text-xs" data-testid="import-results">
      {results.map((r) => (
        <div key={r.candidate_id} className="flex flex-wrap items-center gap-2">
          <Chip className={r.status === "failed" ? "border-rose-400/30 text-rose-300" : r.status === "needs_dedupe_review" ? "border-amber-400/30 text-amber-300" : "border-emerald-400/30 text-emerald-300"}>
            {r.status.replace(/_/g, " ")}
          </Chip>
          <span className="text-slate-light">{r.message}</span>
          {r.tender_url && <Link href={r.tender_url} className="text-emerald-300 hover:underline">Open saved tender →</Link>}
          {r.status === "needs_dedupe_review" && <button className="text-[#D4AF37] hover:underline" onClick={() => onOpen(r.candidate_id)}>Review match</button>}
        </div>
      ))}
    </div>
  );
}
