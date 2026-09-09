"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { getMyPermissions, workforceFoundation } from "@/lib/api";
import WorkerPicker from "../WorkerPicker";
import WorkforceEngagements from "../WorkforceEngagements";

type Person = { id: string; employee_name: string; employee_number: string | null; job_title: string | null; work_location: string | null; employment_status: string; category_id: string | null; category_name?: string; version: number };
type Choice = { id: string; name: string; code: string };
type Catalogues = { categories: Choice[]; positions: Choice[]; departments: Choice[] };
type History = { id: string; action: string; created_at: string; reason: string | null; version: string | null };
type Readiness = { available: boolean; unallocated: boolean; restrictions: { source: string; reason?: string; status?: string }[]; existing_allocations: { id: string; starts_on: string; ends_on: string; allocation_percent: number }[]; qualification_match: string };
type Evidence = Record<string, { id: string; certification_name?: string; skill_name?: string; title?: string; training_name?: string; status?: string; verification_status?: string; starts_on?: string; ends_on?: string; expires_on?: string; proficiency?: string }[]>;
const control = "min-h-11 w-full border border-ink-mid bg-ink-light px-3 py-2 text-sm text-paper";
const button = "min-h-11 border border-ink-mid px-4 py-2 text-sm text-signal hover:border-signal disabled:opacity-40";
const blankCatalogues: Catalogues = { categories: [], positions: [], departments: [] };
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "The request could not be completed.";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="grid gap-1 text-sm text-slate-light"><span>{label}</span>{children}</label>;
}

export default function WorkforcePeople() {
  const [permissions, setPermissions] = useState<string[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [catalogues, setCatalogues] = useState<Catalogues>(blankCatalogues);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<Person | null>(null);
  const [history, setHistory] = useState<History[]>([]);
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const locked = useRef(false);
  const retry = useRef<{ fingerprint: string; key: string } | null>(null);
  const detailGeneration = useRef(0);
  const can = (permission: string) => permissions.includes(permission) || permissions.includes("*");

  useEffect(() => {
    let active = true;
    void getMyPermissions().then(result => {
      if (active) setPermissions(Array.isArray(result.data) ? result.data : []);
    }).catch(reason => { if (active) setError(errorMessage(reason)); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams({ q: search, limit: "50" });
    if (status) params.set("status", status);
    if (cursor) params.set("after", cursor);
    setLoading(true);
    void workforceFoundation<Person[]>(`people?${params}`).then(result => {
      if (!active) return;
      setPeople(result.data); setNext(result.meta.next_cursor ?? null);
    }).catch(reason => {
      if (active) { setPeople([]); setNext(null); setError(errorMessage(reason)); }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [search, status, cursor, revision]);

  useEffect(() => {
    if (!permissions.includes("workforce.organisation.read") && !permissions.includes("*")) return;
    let active = true;
    void workforceFoundation<Catalogues>("catalogues").then(result => {
      if (active) setCatalogues(result.data);
    }).catch(reason => { if (active) setError(errorMessage(reason)); });
    return () => { active = false; };
  }, [permissions, revision]);

  const command = useCallback(async (path: string, payload: object, method: "POST" | "PATCH" = "POST") => {
    if (locked.current) return false;
    locked.current = true; setBusy(true); setError(""); setMessage("");
    const fingerprint = JSON.stringify({ path, method, payload });
    if (retry.current?.fingerprint !== fingerprint) retry.current = { fingerprint, key: crypto.randomUUID() };
    try {
      await workforceFoundation(path, { method, key: retry.current.key, payload });
      retry.current = null;
      setMessage("Saved and confirmed by the server.");
      setRevision(value => value + 1);
      return true;
    } catch (reason) { setError(errorMessage(reason)); return false; }
    finally { locked.current = false; setBusy(false); }
  }, []);

  async function submitPerson(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const saved = await command("people", {
      employee_name: values.get("employee_name"), employee_number: values.get("employee_number"),
      category_id: values.get("category_id"), job_title: values.get("job_title") || null,
      position_id: values.get("position_id") || null, department_id: values.get("department_id") || null,
      work_location: values.get("work_location") || null,
    });
    if (saved) form.reset();
  }

  function choose(worker: Person) {
    detailGeneration.current += 1;
    setSelected(worker); setHistory([]); setEvidence(null); setReadiness(null); setError("");
  }

  async function loadHistory() {
    if (!selected) return;
    const generation = detailGeneration.current;
    try {
      const result = await workforceFoundation<History[]>(`people/${selected.id}/history`);
      if (generation === detailGeneration.current) setHistory(result.data);
    } catch (reason) { if (generation === detailGeneration.current) setError(errorMessage(reason)); }
  }

  async function checkReadiness(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const generation = detailGeneration.current;
    const values = new FormData(event.currentTarget);
    const params = new URLSearchParams({ starts_on: String(values.get("start")), ends_on: String(values.get("end")) });
    try {
      const result = await workforceFoundation<Readiness>(`people/${selected.id}/availability?${params}`);
      if (generation === detailGeneration.current) setReadiness(result.data);
    } catch (reason) { if (generation === detailGeneration.current) setError(errorMessage(reason)); }
  }

  return <main className="min-h-full space-y-6 bg-ink p-4 text-paper sm:p-6">
    <header className="space-y-2 border-b border-ink-mid pb-5">
      <Link className="text-sm text-signal underline" href="/dashboard/workforce">Back to Workforce Command</Link>
      <h1 className="font-display text-3xl">People and organisation</h1>
      <p className="max-w-3xl text-sm text-slate-light">Maintain the worker register, reporting authority and dated availability. Changes require an online server receipt.</p>
    </header>
    {error && <p role="alert" className="border border-red-500/40 p-3 text-red-200">{error}</p>}
    <p role="status" aria-live="polite" className="text-sm text-emerald-300">{message}</p>
    <section className="space-y-4" aria-label="Worker register">
      <form className="flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); setCursor(null); setSearch(query); setError(""); }}>
        <Field label="Name or worker number"><input className={control} value={query} onChange={event => setQuery(event.target.value)} maxLength={160} /></Field>
        <Field label="Employment status"><select className={control} value={status} onChange={event => { setStatus(event.target.value); setCursor(null); }}><option value="">All statuses</option>{["active", "on_leave", "suspended", "terminated"].map(value => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></Field>
        <button className={button} disabled={loading}>Search</button>
        <button className={button} type="button" disabled={loading} onClick={() => { setError(""); setRevision(value => value + 1); }}>Refresh</button>
      </form>
      <div className="overflow-x-auto border border-ink-mid" aria-busy={loading}>
        <table className="w-full text-left text-sm"><caption className="p-3 text-left text-slate-light">{loading ? "Loading workers…" : `${people.length} workers on this page`}</caption>
          <thead className="bg-ink-light"><tr>{["Worker", "Number", "Category", "Role", "Status", "Profile"].map(label => <th key={label} className="p-3" scope="col">{label}</th>)}</tr></thead>
          <tbody>{people.map(worker => <tr key={worker.id} className="border-t border-ink-mid"><td className="p-3">{worker.employee_name}</td><td className="p-3">{worker.employee_number || "Not assigned"}</td><td className="p-3">{worker.category_name || "Not assigned"}</td><td className="p-3">{worker.job_title || "Not recorded"}</td><td className="p-3">{worker.employment_status.replaceAll("_", " ")}</td><td className="p-3"><button className={button} onClick={() => choose(worker)} aria-label={`Open ${worker.employee_name}`}>Open</button></td></tr>)}</tbody>
        </table>
        {!loading && !people.length && <p className="p-4 text-slate-light">No accessible workers match this search.</p>}
      </div>
      <div className="flex gap-3"><button className={button} disabled={!cursor || loading} onClick={() => setCursor(null)}>First page</button><button className={button} disabled={!next || loading} onClick={() => setCursor(next)}>Next page</button></div>
    </section>

    {selected && <section className="space-y-4 border border-ink-mid p-4" aria-label={`Profile for ${selected.employee_name}`}>
      <h2 className="text-xl">{selected.employee_name} <span className="text-sm text-slate-light">Revision {selected.version}</span></h2>
      {can("hr.engagement.read") && <WorkforceEngagements key={selected.id} employeeId={selected.id} permissions={permissions} categories={catalogues.categories} revision={revision} busy={busy} command={command} />}
      <button className={button} onClick={async () => { const generation = detailGeneration.current; try { const result = await workforceFoundation<Evidence>(`people/${selected.id}/evidence`); if (generation === detailGeneration.current) setEvidence(result.data); } catch (reason) { if (generation === detailGeneration.current) setError(errorMessage(reason)); } }}>Load contract and qualification status</button>
      {evidence && <div className="grid gap-3 sm:grid-cols-2">{Object.entries(evidence).map(([kind, records]) => <section key={kind} className="border border-ink-mid p-3"><h3 className="mb-2 capitalize">{kind}</h3><p className="text-xs text-slate-light">Up to 200 records; source status is shown without implying deployment approval.</p><ul className="mt-2 space-y-2 text-sm">{records.map(record => <li key={record.id}>{record.certification_name || record.skill_name || record.title || record.training_name || `Engagement ${record.starts_on ?? ""}`} · {record.verification_status || record.status || record.proficiency || "Recorded"}{(record.expires_on || record.ends_on) ? ` · Until ${record.expires_on || record.ends_on}` : ""}</li>)}</ul>{!records.length && <p className="mt-2 text-sm text-slate-light">No records found.</p>}</section>)}</div>}
      {can("workforce.people.update") && <form key={`${selected.id}:${selected.version}`} className="grid gap-3 sm:grid-cols-2" onSubmit={async event => {
        event.preventDefault(); const values = new FormData(event.currentTarget);
        const saved = await command(`people/${selected.id}`, { expected_version: selected.version, reason: values.get("reason"), employee_name: values.get("employee_name"), job_title: values.get("job_title") || null, work_location: values.get("work_location") || null }, "PATCH");
        if (saved) { detailGeneration.current += 1; setSelected(null); }
      }}>
        <Field label="Worker name"><input name="employee_name" className={control} defaultValue={selected.employee_name} required maxLength={255} /></Field>
        <Field label="Job title"><input name="job_title" className={control} defaultValue={selected.job_title ?? ""} maxLength={100} /></Field>
        <Field label="Base location"><input name="work_location" className={control} defaultValue={selected.work_location ?? ""} maxLength={255} /></Field>
        <Field label="Reason for revision"><input name="reason" className={control} required minLength={3} maxLength={2000} /></Field>
        <button className={button} disabled={busy}>Save revision</button>
      </form>}
      {can("workforce.availability.read") && <form className="flex flex-wrap items-end gap-3" onSubmit={checkReadiness}><Field label="Period starts"><input className={control} type="date" name="start" required /></Field><Field label="Period ends"><input className={control} type="date" name="end" required /></Field><button className={button}>Check availability</button></form>}
      {can("workforce.availability.manage") && <details className="border border-ink-mid p-3"><summary className="cursor-pointer">Record availability</summary><form className="mt-3 grid gap-3 sm:grid-cols-2" onSubmit={async event => { event.preventDefault(); const form = event.currentTarget; const values = new FormData(form); const state = String(values.get("status")); if (await command("availability", { employee_id: selected.id, available_from: values.get("from"), available_to: values.get("to"), status: state, capacity_percent: state === "available" ? Number(values.get("capacity")) : 0, notes: values.get("notes") })) { form.reset(); setReadiness(null); } }}>
        <Field label="From"><input type="date" name="from" className={control} required /></Field><Field label="Through"><input type="date" name="to" className={control} required /></Field><Field label="Availability"><select name="status" className={control}><option value="unavailable">Unavailable</option><option value="training">Training</option><option value="available">Available</option></select></Field><Field label="Capacity when available (%)"><input name="capacity" type="number" defaultValue={100} min={0} max={100} step={1} className={control} required /></Field><Field label="Reason"><input name="notes" className={control} required minLength={3} maxLength={2000} /></Field><button className={button} disabled={busy}>Record availability</button><p className="text-sm text-slate-light">Approved HR leave and clearance restrictions take precedence. Unavailable and training periods have zero capacity.</p>
      </form></details>}
      {can("workforce.organisation.manage") && <details className="border border-ink-mid p-3"><summary className="cursor-pointer">Assign reporting authority</summary><form className="mt-3 grid gap-3 sm:grid-cols-2" onSubmit={async event => { event.preventDefault(); const values = new FormData(event.currentTarget); await command("reporting-lines", { employee_id: selected.id, manager_employee_id: values.get("manager"), effective_from: values.get("from"), effective_to: values.get("to") || null, relationship_type: values.get("relationship") }); }}><WorkerPicker name="manager" label="Manager" /><div className="grid gap-3"><Field label="Effective from"><input className={control} name="from" type="date" required /></Field><Field label="Effective through (optional)"><input className={control} name="to" type="date" /></Field><Field label="Relationship"><select className={control} name="relationship">{["line_manager", "project_manager", "mentor", "dotted_line"].map(value => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></Field></div><button className={button} disabled={busy}>Assign authority</button></form></details>}
      {readiness && <div className="space-y-2 text-sm"><p>{readiness.available ? "No availability restriction found for this period." : "Availability restrictions require attention."} {readiness.unallocated ? "No existing allocation overlaps." : "Existing allocations overlap this period."}</p><ul className="list-inside list-disc">{readiness.restrictions.map((item, index) => <li key={`${item.source}:${index}`}>{item.source.replaceAll("_", " ")}: {item.reason || item.status || "Review required"}</li>)}</ul><p className="text-slate-light">{readiness.qualification_match}</p></div>}
      {can("workforce.audit.read") && <div><button className={button} onClick={() => void loadHistory()}>Load change history</button><ul className="mt-3 space-y-2 text-sm">{history.map(item => <li key={item.id}>{new Date(item.created_at).toLocaleString()} · {item.action} · {item.reason || "Record created"} · Revision {item.version ?? "—"}</li>)}</ul></div>}
      {can("workforce.people.archive") && <form className="flex flex-wrap items-end gap-3 border-t border-ink-mid pt-4" onSubmit={async event => { event.preventDefault(); const values = new FormData(event.currentTarget); if (await command(`people/${selected.id}/archive`, { expected_version: selected.version, reason: values.get("reason") })) { detailGeneration.current += 1; setSelected(null); } }}><Field label="Archive reason"><input className={control} name="reason" required minLength={3} maxLength={2000} /></Field><button className={button} disabled={busy}>Archive worker</button></form>}
    </section>}

    {can("workforce.people.create") && <details className="border border-ink-mid p-4"><summary className="cursor-pointer text-lg">Register a worker</summary><form className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" onSubmit={submitPerson}>
      <Field label="Full name"><input className={control} name="employee_name" required maxLength={255} /></Field>
      <Field label="Worker number"><input className={control} name="employee_number" required maxLength={80} /></Field>
      <Field label="Worker category"><select className={control} name="category_id" required defaultValue=""><option value="" disabled>Select category</option>{catalogues.categories.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
      <Field label="Job title"><input className={control} name="job_title" maxLength={100} /></Field>
      <Field label="Position"><select className={control} name="position_id"><option value="">Not assigned</option>{catalogues.positions.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
      <Field label="Department"><select className={control} name="department_id"><option value="">Not assigned</option>{catalogues.departments.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
      <Field label="Base location"><input className={control} name="work_location" maxLength={255} /></Field>
      <button className={button} disabled={busy || !catalogues.categories.length}>Register worker</button>
      {!catalogues.categories.length && <p className="text-sm text-amber-200">An accessible worker category is required. Organisation access and at least one category must be configured.</p>}
    </form></details>}

    {can("workforce.organisation.manage") && <details className="border border-ink-mid p-4"><summary className="cursor-pointer text-lg">Organisation settings</summary><form className="mt-4 grid gap-3 sm:grid-cols-3" onSubmit={async event => { event.preventDefault(); const form = event.currentTarget; const values = new FormData(form); if (await command(`catalogues/${values.get("kind")}`, { code: values.get("code"), name: values.get("name"), payroll_eligible: values.get("payroll_eligible") === "on" })) form.reset(); }}>
      <Field label="Catalogue"><select name="kind" className={control}><option value="categories">Worker categories</option><option value="positions">Positions</option></select></Field><Field label="Code"><input name="code" className={control} required pattern="[A-Za-z0-9_-]+" maxLength={40} /></Field><Field label="Name"><input name="name" className={control} required maxLength={160} /></Field><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="payroll_eligible" />Category permits payroll eligibility checks</label><button className={button} disabled={busy}>Add catalogue entry</button>
    </form><p className="mt-3 text-sm text-slate-light">Category eligibility alone does not authorise payroll.</p></details>}
  </main>;
}
