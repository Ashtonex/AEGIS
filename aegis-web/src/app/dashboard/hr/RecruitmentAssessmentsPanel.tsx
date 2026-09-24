"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Upload } from "lucide-react";
import { getRecruitmentAssessments, importRecruitmentAssessments } from "@/lib/api";
import { dateValue } from "./page";

type RecordData = Record<string, any>;
type Catalog = { code: string; title: string; role: string; minutes: number };

const DEFAULT_DIMENSIONS = ["Cognitive", "Accuracy", "Pressure", "Controls", "Work Style"];

function scoreClass(value: number) {
  if (value >= 75) return "text-emerald-300";
  if (value >= 50) return "text-amber-300";
  return "text-red-300";
}

function Score({ value }: { value: unknown }) {
  const n = Number(value);
  if (value === null || value === undefined || Number.isNaN(n)) return <span className="text-slate">—</span>;
  return <span className={`font-mono ${scoreClass(n)}`}>{n.toFixed(1)}</span>;
}

/** Scored Microsoft Forms candidate assessments, fed by uploading the Forms
 * "Open in Excel" export (Forms has no API for reading responses). */
export function RecruitmentAssessmentsPanel({ onImported }: { onImported?: () => void }) {
  const [rows, setRows] = useState<RecordData[]>([]);
  const [catalog, setCatalog] = useState<Catalog[]>([]);
  const [dimensions, setDimensions] = useState<string[]>(DEFAULT_DIMENSIONS);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [assessmentCode, setAssessmentCode] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string; warnings: string[] } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const res = await getRecruitmentAssessments();
      const data = res?.data || {};
      setRows(data.assessments || []);
      setCatalog(data.catalog || []);
      if (data.dimensions?.length) setDimensions(data.dimensions);
      setAssessmentCode((current) => current || data.catalog?.[0]?.code || "");
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load candidate assessments.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleImport(event: React.FormEvent) {
    event.preventDefault();
    if (!file || !assessmentCode) return;
    setImporting(true);
    setResult(null);
    try {
      const res = await importRecruitmentAssessments({ file, assessment_code: assessmentCode });
      const d = res?.data || {};
      const warnings = (d.results || [])
        .filter((r: RecordData) => r.warnings?.length)
        .map((r: RecordData) => `${r.candidate_name}: ${r.warnings.join("; ")}`);
      setResult({
        ok: true,
        message: `${res?.message || "Imported."} ${d.new_assessments ?? 0} new, ${d.rescored ?? 0} re-scored; ` +
          `${d.candidates_created ?? 0} candidate profile(s) created, ${d.candidates_matched ?? 0} matched.`,
        warnings,
      });
      setFile(null);
      (event.target as HTMLFormElement).reset();
      await load();
      onImported?.();
    } catch (err) {
      setResult({ ok: false, message: err instanceof Error ? err.message : "Import failed.", warnings: [] });
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="bg-ink-light border border-ink-mid rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)] overflow-hidden">
      <div className="flex items-center justify-between gap-4 border-b border-ink-mid bg-ink/30 px-4 py-3">
        <span className="font-mono text-xs tracking-wider uppercase text-slate">Candidate assessments (Microsoft Forms)</span>
        <span className="font-mono text-xs text-paper">{rows.length}</span>
      </div>

      <form onSubmit={handleImport} className="flex flex-col gap-3 border-b border-ink-mid px-4 py-4 lg:flex-row lg:items-end">
        <label className="flex flex-col gap-1 text-xs text-slate lg:w-80">
          Assessment
          <select
            value={assessmentCode}
            onChange={(e) => setAssessmentCode(e.target.value)}
            className="rounded border border-ink-mid bg-ink px-3 py-2 text-sm text-paper"
          >
            {catalog.map((a) => <option key={a.code} value={a.code}>{a.title}</option>)}
          </select>
        </label>
        <label className="flex flex-1 flex-col gap-1 text-xs text-slate">
          Forms export (.xlsx)
          <input
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="rounded border border-ink-mid bg-ink px-3 py-1.5 text-sm text-slate-light file:mr-3 file:rounded file:border-0 file:bg-ink-mid file:px-3 file:py-1 file:text-paper"
          />
        </label>
        <button
          type="submit"
          disabled={!file || !assessmentCode || importing}
          className="inline-flex items-center justify-center gap-2 rounded bg-signal px-4 py-2 text-sm font-medium text-ink disabled:cursor-not-allowed disabled:opacity-50"
        >
          {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          Import &amp; score
        </button>
      </form>
      <p className="border-b border-ink-mid px-4 py-2 text-xs text-slate">
        In Microsoft Forms open the quiz, go to Responses → Open in Excel, save the file and upload it here.
        Re-uploading the same export is safe: existing responses are re-scored, not duplicated.
      </p>

      {result && (
        <div className={`flex gap-2 border-b border-ink-mid px-4 py-3 text-sm ${result.ok ? "text-emerald-300" : "text-red-300"}`}>
          {result.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
          <div>
            <div>{result.message}</div>
            {result.warnings.map((w) => <div key={w} className="text-amber-300">{w}</div>)}
          </div>
        </div>
      )}

      {loading ? (
        <div className="p-8 text-center text-sm text-slate-light"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div>
      ) : loadError ? (
        <div className="p-8 text-center text-sm text-red-300">{loadError}</div>
      ) : rows.length === 0 ? (
        <div className="p-8 text-center text-sm text-slate-light">No assessments scored yet. Upload a Forms export above.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead>
              <tr className="border-b border-ink-mid text-slate font-mono text-[11px] uppercase tracking-wider bg-ink bg-opacity-20">
                <th className="p-4">Candidate</th>
                <th className="p-4">Role</th>
                <th className="p-4">Submitted</th>
                <th className="p-4">Objective</th>
                {dimensions.map((d) => <th key={d} className="p-4">{d}</th>)}
                <th className="p-4">Overall</th>
                <th className="p-4">Stage</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-mid">
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-ink-mid/10">
                  <td className="p-4">
                    <div className="text-paper">{row.candidate_name}</div>
                    <div className="text-xs text-slate">{[row.email, row.phone].filter(Boolean).join(" · ")}</div>
                  </td>
                  <td className="p-4 text-slate-light">{row.role_applied_for}</td>
                  <td className="p-4 text-slate-light">{dateValue(row.submitted_at || row.created_at)}</td>
                  <td className="p-4 font-mono text-slate-light">
                    {Number(row.objective_score)}/{Number(row.objective_max)}
                    {row.unanswered_count > 0 && <span className="ml-1 text-amber-300">({row.unanswered_count} blank)</span>}
                  </td>
                  {dimensions.map((d) => <td key={d} className="p-4"><Score value={row.dimension_scores?.[d]} /></td>)}
                  <td className="p-4 font-semibold"><Score value={row.overall_score} /></td>
                  <td className="p-4 capitalize text-slate-light">{row.stage}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="px-4 py-3 text-xs text-slate">
        Dimension scores are % of available points; overall is their equal-weighted mean. Work-style items are directional
        indicators — combine with interview, work sample and reference checks before deciding.
      </p>
    </div>
  );
}
