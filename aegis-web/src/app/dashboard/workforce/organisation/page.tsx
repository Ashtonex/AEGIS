"use client";

import { useEffect, useState, type FormEvent } from "react";
import { workforceFoundation } from "@/lib/api";
import { DashboardPageHeader } from "@/components/dashboard/DashboardPageHeader";

type ReportingLine = {
  id: string;
  employee_name: string;
  manager_name: string;
  relationship_type: string;
  effective_from: string;
  effective_to: string | null;
};

export default function WorkforceOrganisation() {
  const [on, setOn] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [rows, setRows] = useState<ReportingLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams({ limit: "50" });
    if (on) params.set("on", on);
    if (cursor) params.set("after", cursor);
    setLoading(true);
    setError("");
    void workforceFoundation<ReportingLine[]>(`reporting-lines?${params}`)
      .then(result => {
        if (!active) return;
        setRows(result.data);
        setNext(result.meta.next_cursor ?? null);
      })
      .catch(reason => {
        if (!active) return;
        setRows([]);
        setNext(null);
        setError(reason instanceof Error ? reason.message : "Reporting authority could not be loaded.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [on, cursor, revision]);

  function chooseDate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setOn(String(new FormData(event.currentTarget).get("on") || ""));
    setCursor(null);
    setRevision(value => value + 1);
  }

  const button = "min-h-11 border border-ink-mid px-4 py-2 text-sm text-signal disabled:opacity-40";
  return (
    <main className="space-y-6 p-4 md:p-8">
      <DashboardPageHeader title="Reporting authority" subtitle="Dated worker-to-manager relationships. The initial view uses today's date on the server." />
      <form className="flex flex-wrap items-end gap-3" onSubmit={chooseDate}>
        <label className="grid gap-1 text-sm text-slate-light">Effective on
          <input type="date" name="on" required className="min-h-11 border border-ink-mid bg-ink-light px-3 py-2 text-paper" />
        </label>
        <button type="submit" className={button} disabled={loading}>Show authority</button>
      </form>
      {loading && <p role="status">Loading reporting authority…</p>}
      {error && <div className="space-y-3"><p role="alert" className="text-red-400">{error}</p><button className={button} onClick={() => setRevision(value => value + 1)}>Retry</button></div>}
      {!loading && !error && rows.length === 0 && <p>No reporting relationships are recorded for this date.</p>}
      {!loading && !error && rows.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map(row => (
            <article key={row.id} className="space-y-2 rounded border border-ink-mid bg-ink-light p-4">
              <h2 className="break-words font-medium text-paper">{row.employee_name}</h2>
              <dl className="space-y-2 text-sm">
                <div><dt className="text-slate-light">Reports to</dt><dd className="break-words text-paper">{row.manager_name}</dd></div>
                <div><dt className="text-slate-light">Relationship</dt><dd>{row.relationship_type.replaceAll("_", " ")}</dd></div>
                <div><dt className="text-slate-light">Effective period</dt><dd>{row.effective_from} – {row.effective_to || "Open ended"}</dd></div>
              </dl>
            </article>
          ))}
        </div>
      )}
      <nav aria-label="Reporting authority pages" className="flex gap-3">
        <button className={button} disabled={!cursor || loading} onClick={() => setCursor(null)}>First page</button>
        <button className={button} disabled={!next || loading || !!error} onClick={() => setCursor(next)}>Next page</button>
      </nav>
    </main>
  );
}
