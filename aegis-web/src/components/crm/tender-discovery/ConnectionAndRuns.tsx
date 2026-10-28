"use client";

import React, { useState } from "react";
import { AlertTriangle, ExternalLink, Loader2, Play, PlugZap, RotateCcw, Square } from "lucide-react";
import {
  cancelDiscoveryRun,
  resumeDiscoveryRun,
  startDiscoveryRun,
  verifyEgpConnection,
  type DiscoveryRun,
  type SourceView,
} from "@/lib/api/tender-discovery";
import { Chip, CONNECTION_LABEL, OUTCOME_LABEL, Panel, RUN_STATUS_TONE, btn, errorMessage, fmtHarare, input } from "./shared";

export function ConnectionPanel({ source, canRun, onChanged }: { source: SourceView; canRun: boolean; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const state = CONNECTION_LABEL[source.connection_state];
  const probe = source.last_probe || {};

  const verify = async () => {
    setBusy(true);
    setError(null);
    try {
      await verifyEgpConnection();
    } catch (err) {
      setError(errorMessage(err, "Verification request failed."));
    } finally {
      setBusy(false);
      onChanged();
    }
  };

  return (
    <Panel
      title="e-GP connection"
      actions={canRun && (
        <button className={btn.primary} onClick={verify} disabled={busy} data-testid="verify-connection">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlugZap className="h-3.5 w-3.5" />}
          {source.connection_state === "connected_verified" ? "Re-verify" : "Connect e-GP"}
        </button>
      )}
    >
      <div className="space-y-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Chip className={state.tone} title="Set only from an actual read of the portal">{state.label}</Chip>
          {source.verification_stale && <Chip className="border-amber-400/30 text-amber-300">Verification older than 24h</Chip>}
        </div>
        {source.state_reason && <p className="text-xs text-slate-light">{source.state_reason}</p>}
        <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="text-slate">Source</dt>
          <dd className="break-all">
            <a href={source.base_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[#D4AF37] hover:underline">
              {source.base_url} <ExternalLink className="h-3 w-3" />
            </a>
          </dd>
          <dt className="text-slate">Verified via</dt><dd className="text-slate-light">{source.verified_from || "—"}</dd>
          <dt className="text-slate">Last verified</dt><dd>{fmtHarare(source.last_verified_at)}</dd>
          <dt className="text-slate">Last checked</dt><dd>{fmtHarare(source.last_probe_at)}{probe.http_status ? ` · HTTP ${probe.http_status}` : ""}</dd>
          {probe.records_total != null && (<><dt className="text-slate">Live notices</dt><dd>{probe.records_total} on {probe.pages_total} pages</dd></>)}
          {probe.clock_offset_minutes != null && (
            <><dt className="text-slate">Portal clock</dt>
              <dd>UTC{probe.clock_offset_minutes >= 0 ? "+" : ""}{probe.clock_offset_minutes / 60}h {probe.timezone_consistent ? "· matches Africa/Harare" : "· does not match Africa/Harare"}</dd></>
          )}
          <dt className="text-slate">Pacing</dt><dd>{(source.min_request_interval_ms / 1000).toFixed(1)}s between requests · max {source.max_pages_per_run} pages / {source.max_details_per_run} notices per run</dd>
        </dl>
        <div className="rounded-sm border border-white/5 bg-black/30 p-3 text-xs">
          <p className="mb-1 font-mono text-[10px] uppercase tracking-widest text-slate-light">Documents (e-GP login)</p>
          <Chip className={CONNECTION_LABEL[source.authenticated_access.state].tone}>{CONNECTION_LABEL[source.authenticated_access.state].label}</Chip>
          <p className="mt-2 text-slate-light">{source.authenticated_access.reason}</p>
          <a href={source.authenticated_access.login_url} target="_blank" rel="noopener noreferrer"
             className="mt-2 inline-flex items-center gap-1 text-[#D4AF37] hover:underline">
            Open the official e-GP sign-in in a new tab <ExternalLink className="h-3 w-3" />
          </a>
          <p className="mt-1 text-slate">Sign in there yourself. Never paste e-GP passwords, cookies or tokens into AEGIS or chat.</p>
        </div>
        {error && <p className="flex items-start gap-1.5 text-xs text-rose-300"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{error}</p>}
      </div>
    </Panel>
  );
}

const FILTER_FIELDS: { key: string; label: string; type: string; placeholder?: string }[] = [
  { key: "title", label: "Title contains (portal search)", type: "text", placeholder: "e.g. road" },
  { key: "category_name", label: "Required supplier category", type: "text", placeholder: "Construction and Civil Works (buildings, dams, roads etc.) (New)" },
  { key: "category_code", label: "Category code", type: "text", placeholder: "SC006" },
  { key: "procuring_entity_id", label: "Procuring entity id (portal)", type: "text", placeholder: "numeric id" },
  { key: "published_from", label: "Published from", type: "date" },
  { key: "published_to", label: "Published to", type: "date" },
  { key: "closing_from", label: "Closing from", type: "date" },
  { key: "closing_to", label: "Closing to", type: "date" },
];

export function RunPanel({
  source, activeRun, latestRun, canRun, onChanged,
}: { source: SourceView; activeRun: DiscoveryRun | null; latestRun: DiscoveryRun | null; canRun: boolean; onChanged: () => void }) {
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [pageLimit, setPageLimit] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const verified = source.connection_state === "connected_verified";

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorMessage(err, "Request failed."));
    } finally {
      setBusy(false);
      onChanged();
    }
  };

  const run = activeRun || latestRun;
  const resumable = !activeRun && latestRun && (latestRun.status === "partial" || latestRun.status === "failed");

  return (
    <Panel title="Discovery run">
      {canRun && !activeRun && (
        <details className="mb-3 text-xs">
          <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-widest text-slate-light">Portal filters (optional)</summary>
          <p className="mt-2 text-slate">Without filters the whole live Bulletin Board is read and matched against the profile. Portal search covers one title phrase only.</p>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {FILTER_FIELDS.map((f) => (
              <label key={f.key} className="block">
                <span className="mb-1 block text-[11px] text-slate-light">{f.label}</span>
                <input className={input} type={f.type} placeholder={f.placeholder} value={filters[f.key] || ""}
                       onChange={(e) => setFilters({ ...filters, [f.key]: e.target.value })} />
              </label>
            ))}
            <label className="block">
              <span className="mb-1 block text-[11px] text-slate-light">Page limit (max {source.max_pages_per_run})</span>
              <input className={input} type="number" min={1} max={source.max_pages_per_run} value={pageLimit} onChange={(e) => setPageLimit(e.target.value)} />
            </label>
          </div>
        </details>
      )}
      <div className="flex flex-wrap gap-2">
        {canRun && !activeRun && (
          <button className={btn.primary} disabled={!verified || busy} data-testid="start-run"
                  title={verified ? "" : "Verify the connection first"}
                  onClick={() => act(() => startDiscoveryRun({
                    filters: Object.fromEntries(Object.entries(filters).filter(([, v]) => v)),
                    page_limit: pageLimit ? Number(pageLimit) : undefined,
                  }))}>
            <Play className="h-3.5 w-3.5" /> Run discovery
          </button>
        )}
        {canRun && resumable && (
          <button className={btn.ghost} disabled={!verified || busy} onClick={() => act(() => resumeDiscoveryRun(latestRun!.id))}>
            <RotateCcw className="h-3.5 w-3.5" /> Resume from page {latestRun!.last_page_completed + 1}
          </button>
        )}
        {canRun && activeRun && (
          <button className={btn.danger} disabled={busy || activeRun.cancel_requested} onClick={() => act(() => cancelDiscoveryRun(activeRun.id))}>
            <Square className="h-3.5 w-3.5" /> {activeRun.cancel_requested ? "Stopping…" : "Cancel"}
          </button>
        )}
      </div>
      {!verified && <p className="mt-2 text-xs text-amber-300">Discovery only runs against a verified connection.</p>}
      {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}
      {run && <RunProgress run={run} />}
    </Panel>
  );
}

export function RunProgress({ run }: { run: DiscoveryRun }) {
  const total = run.pages_total ?? run.page_limit ?? null;
  const pct = total ? Math.min(100, Math.round((run.last_page_completed / total) * 100)) : null;
  const live = run.status === "running" || run.status === "queued";
  return (
    <div className="mt-3 space-y-2 rounded-sm border border-white/5 bg-black/30 p-3 text-xs" data-testid="run-progress">
      <div className="flex flex-wrap items-center gap-2">
        <Chip className={RUN_STATUS_TONE[run.status]}>{live && <Loader2 className="h-3 w-3 animate-spin" />}{run.status}</Chip>
        {run.outcome && <Chip className="border-white/10 text-slate-light">{OUTCOME_LABEL[run.outcome] || run.outcome}</Chip>}
        <span className="text-slate">Started {fmtHarare(run.started_at || run.created_at)}{run.started_by_name ? ` by ${run.started_by_name}` : ""}</span>
      </div>
      {pct !== null && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/5" aria-label="Pages read">
          <div className="h-full bg-[#D4AF37]" style={{ width: `${pct}%` }} />
        </div>
      )}
      <p className="text-slate-light">
        Pages {run.last_page_completed}/{total ?? "?"}{run.pages_failed ? ` (${run.pages_failed} failed)` : ""} · notices {run.notices_seen} · matched {run.notices_matched} · notice pages read {run.details_fetched}
        {run.details_failed ? `, failed ${run.details_failed}` : ""}{run.details_skipped ? `, not opened ${run.details_skipped}` : ""} · new {run.candidates_new} · updated {run.candidates_updated} · changes {run.changes_detected}
      </p>
      {run.summary && <p className="text-paper">{run.summary}</p>}
      {run.failures?.length > 0 && (
        <details>
          <summary className="cursor-pointer text-amber-300">{run.failures.length} failure(s) recorded</summary>
          <ul className="mt-1 space-y-1">
            {run.failures.slice(0, 20).map((f, i) => (
              <li key={i} className="break-all text-slate-light"><span className="text-amber-300">{f.stage}</span> {f.error} <span className="text-slate">{f.url}</span></li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export function RunHistory({ runs }: { runs: DiscoveryRun[] }) {
  if (!runs.length) return <p className="text-sm text-slate-light">No discovery runs yet.</p>;
  return (
    <ul className="space-y-2">
      {runs.map((run) => <li key={run.id}><RunProgress run={run} /></li>)}
    </ul>
  );
}
