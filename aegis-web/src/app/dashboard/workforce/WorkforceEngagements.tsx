"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { getDocumentSignedUrl, workforceFoundation } from "@/lib/api";

type Engagement = { id: string; document_id: string; starts_on: string; ends_on: string | null; normal_minutes: number; jurisdiction: string; employer_name: string | null; status: string; version: number; decision_reason: string | null };
type Props = { employeeId: string; permissions: string[]; categories: { id: string; name: string }[]; revision: number; busy: boolean; command: (path: string, payload: object, method?: "POST" | "PATCH") => Promise<boolean> };
const control = "min-h-11 w-full border border-ink-mid bg-ink-light px-3 py-2 text-sm text-paper";
const button = "min-h-11 border border-ink-mid px-3 py-2 text-sm text-signal disabled:opacity-40";

export default function WorkforceEngagements({ employeeId, permissions, categories, revision, busy, command }: Props) {
  const [records, setRecords] = useState<Engagement[]>([]);
  const [documents, setDocuments] = useState<{ id: string; title: string }[]>([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState<string | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [download, setDownload] = useState<string | null>(null);
  const requestGeneration = useRef(0);
  const can = (key: string) => permissions.includes(key) || permissions.includes("*");

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams({ employee_id: employeeId, limit: "25" });
    if (cursor) params.set("after", cursor);
    setLoading(true);
    void workforceFoundation<Engagement[]>(`engagements?${params}`).then(result => {
      if (active) { setRecords(result.data); setNext(result.meta.next_cursor ?? null); }
    }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : "Engagements unavailable."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [employeeId, cursor, revision]);

  async function findDocuments() {
    const generation = ++requestGeneration.current;
    setError("");
    try {
      const result = await workforceFoundation<typeof documents>(`engagement-documents?${new URLSearchParams({ q: search })}`);
      if (generation === requestGeneration.current) setDocuments(result.data);
    } catch (reason) { if (generation === requestGeneration.current) setError(reason instanceof Error ? reason.message : "Document search unavailable."); }
  }

  return <section className="space-y-3 border border-ink-mid p-4" aria-label="HR engagements">
    <h3 className="text-lg">HR engagements</h3>
    <p className="text-sm text-slate-light">HR records the contract and an independent reviewer verifies the evidence. Verified engagements cannot be edited.</p>
    {error && <p role="alert" className="text-sm text-red-200">{error}</p>}
    {download && <a href={download} target="_blank" rel="noopener noreferrer" className="inline-block text-sm text-signal underline">Open contract evidence (temporary link)</a>}
    {loading && <p role="status">Loading engagements…</p>}
    {!loading && !records.length && <p className="text-sm text-slate-light">No engagements on this page.</p>}
    {records.map(record => <article key={record.id} className="space-y-3 border border-ink-mid p-3">
      <h4 className="font-semibold">{record.starts_on} – {record.ends_on || "Open ended"} · {record.status}</h4>
      <p className="text-sm text-slate-light">Revision {record.version} · {record.normal_minutes} normal minutes per day · {record.jurisdiction}{record.employer_name ? ` · ${record.employer_name}` : ""}</p>
      {record.decision_reason && <p className="text-sm">{record.decision_reason}</p>}
      {can("documents.read") && <button className={button} type="button" onClick={async () => { setDownload(null); try { const result = await getDocumentSignedUrl(record.document_id); if (result.data?.url) setDownload(result.data.url); } catch (reason) { setError(reason instanceof Error ? reason.message : "Evidence could not be opened."); } }}>Prepare evidence link</button>}
      {((record.status === "draft" && can("hr.engagement.manage")) || (record.status === "submitted" && can("hr.engagement.verify"))) && <form className="flex flex-wrap items-end gap-3" onSubmit={async event => {
        event.preventDefault(); const values = new FormData(event.currentTarget);
        const action = record.status === "draft" ? "submit" : "decision";
        await command(`engagements/${record.id}/${action}`, { expected_version: record.version, reason: values.get("reason"), ...(action === "decision" ? { decision: values.get("decision") } : {}) });
      }}>
        <label className="grid gap-1 text-sm text-slate-light">Reason<input className={control} name="reason" required minLength={3} maxLength={2000} /></label>
        {record.status === "submitted" && <label className="grid gap-1 text-sm text-slate-light">Decision<select className={control} name="decision"><option value="rejected">Reject</option><option value="approved">Verify evidence</option></select></label>}
        <button className={button} disabled={busy}>{record.status === "draft" ? "Submit for verification" : "Record decision"}</button>
      </form>}
    </article>)}
    <div className="flex gap-3"><button className={button} disabled={!cursor || loading} onClick={() => setCursor(null)}>First page</button><button className={button} disabled={!next || loading} onClick={() => setCursor(next)}>Next page</button></div>
    {can("hr.engagement.manage") && <details className="border-t border-ink-mid pt-3"><summary className="cursor-pointer">Prepare an engagement</summary>
      <p className="my-3 text-sm text-slate-light">Upload the signed contract in <Link className="text-signal underline" href="/dashboard/documents">Documents</Link>, then select its evidence file here.</p>
      {can("documents.read") && <div className="mb-3 flex flex-wrap items-end gap-3"><label className="grid gap-1 text-sm text-slate-light">Find document by title<input className={control} value={search} onChange={event => setSearch(event.target.value)} maxLength={160} /></label><button type="button" className={button} onClick={() => void findDocuments()}>Find documents</button><p className="text-xs text-slate-light">Up to 30 matching documents with uploaded files.</p></div>}
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={async event => {
        event.preventDefault(); const form = event.currentTarget; const values = new FormData(form);
        if (await command("engagements", { employee_id: employeeId, category_id: values.get("category"), document_id: values.get("document"), starts_on: values.get("start"), ends_on: values.get("end") || null, normal_minutes: Number(values.get("minutes")), jurisdiction: values.get("jurisdiction"), employer_name: values.get("employer") || null })) form.reset();
      }}>
        <label className="grid gap-1 text-sm text-slate-light">Category<select className={control} name="category" defaultValue="" required><option value="" disabled>Select category</option>{categories.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="grid gap-1 text-sm text-slate-light">Contract evidence<select className={control} name="document" defaultValue="" required><option value="" disabled>Select an uploaded document</option>{documents.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
        <label className="grid gap-1 text-sm text-slate-light">Starts<input type="date" className={control} name="start" required /></label>
        <label className="grid gap-1 text-sm text-slate-light">Ends (optional)<input type="date" className={control} name="end" /></label>
        <label className="grid gap-1 text-sm text-slate-light">Normal minutes per day<input type="number" className={control} name="minutes" min={1} max={1440} step={1} required /></label>
        <label className="grid gap-1 text-sm text-slate-light">Jurisdiction<input className={control} name="jurisdiction" minLength={2} maxLength={80} required /></label>
        <label className="grid gap-1 text-sm text-slate-light">Employer (optional)<input className={control} name="employer" maxLength={200} /></label>
        <button className={button} disabled={busy || !documents.length || !categories.length}>Save engagement draft</button>
      </form>
    </details>}
  </section>;
}
