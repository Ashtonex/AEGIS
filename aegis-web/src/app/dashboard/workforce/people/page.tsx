"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Loader2, Plus, Search, Settings2, UserPlus } from "lucide-react";
import {
  getMyPermissions, getPeopleCatalogue, getPeopleRegister, workforceFoundation,
  type PeopleCatalogue, type RegisterRow,
} from "@/lib/api";
import { DashboardPageHeader } from "@/components/dashboard/DashboardPageHeader";
import { PersonCardModal } from "@/components/people/PersonCardModal";
import {
  EMPLOYMENT_TYPES, Field, StatusPill, inputClass, primaryButton, secondaryButton, today,
} from "@/components/people/ui";

const errorText = (reason: unknown) => (reason instanceof Error ? reason.message : "The request could not be completed.");

/** Mirrors the server's code_stem so the preview matches what will be saved. */
function codeStem(name: string) {
  const words = name.split(/[^A-Za-z0-9]+/).filter((w) => w && !["and", "of", "the", "for"].includes(w.toLowerCase()));
  if (!words.length) return "";
  return words.length === 1 ? words[0].slice(0, 3).toUpperCase() : words.slice(0, 5).map((w) => w[0]).join("").toUpperCase();
}

function previewCode(name: string, taken: string[]) {
  const stem = codeStem(name);
  if (!stem) return "";
  const used = new Set(taken.map((c) => c.toUpperCase()));
  if (!used.has(stem)) return stem;
  let n = 2;
  while (used.has(`${stem}${n}`)) n += 1;
  return `${stem}${n}`;
}

export default function WorkforcePeople() {
  const [permissions, setPermissions] = useState<string[]>([]);
  const [rows, setRows] = useState<RegisterRow[]>([]);
  const [catalogue, setCatalogue] = useState<PeopleCatalogue | null>(null);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("current");
  const [categoryId, setCategoryId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [revision, setRevision] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const can = (key: string) => permissions.includes(key) || permissions.includes("*");

  useEffect(() => {
    void getMyPermissions().then((r) => setPermissions(Array.isArray(r.data) ? r.data : [])).catch(() => setPermissions([]));
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    getPeopleRegister({ q: search, status, category_id: categoryId, department_id: departmentId })
      .then((r) => { if (active) { setRows(r.data); setError(""); } })
      .catch((reason) => { if (active) { setRows([]); setError(errorText(reason)); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [search, status, categoryId, departmentId, revision]);

  useEffect(() => {
    let active = true;
    getPeopleCatalogue().then((r) => { if (active) setCatalogue(r.data); }).catch((reason) => { if (active) setError(errorText(reason)); });
    return () => { active = false; };
  }, [revision]);

  const refresh = useCallback(() => setRevision((v) => v + 1), []);

  return (
    <main className="min-h-full space-y-6 bg-ink p-4 text-paper sm:p-6">
      <DashboardPageHeader
        backHref="/dashboard/workforce"
        backLabel="Back to Workforce Command"
        title="People Register"
        subtitle="Everyone who works for Six Nine Construction. Open a person to build their card: role, projects, pay, personal details and assessments."
      />
      {error && <p role="alert" className="rounded-sm border border-red-500/40 bg-red-950/30 p-3 text-sm text-red-200">{error}</p>}
      {message && <p role="status" className="rounded-sm border border-emerald-500/30 bg-emerald-950/30 p-3 text-sm text-emerald-200">{message}</p>}

      <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); setSearch(query); }}>
        <div className="min-w-56 flex-1">
          <Field label="Search">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate" />
              <input className={`${inputClass} pl-9`} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name, SNC number, role…" maxLength={160} />
            </div>
          </Field>
        </div>
        <Field label="Status">
          <select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="current">Current staff</option>
            <option value="active">Active</option>
            <option value="on_leave">On leave</option>
            <option value="suspended">Suspended</option>
            <option value="terminated">Left the organisation</option>
            <option value="all">Everyone, including leavers</option>
          </select>
        </Field>
        <Field label="Discipline">
          <select className={inputClass} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">All disciplines</option>
            {catalogue?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Department">
          <select className={inputClass} value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
            <option value="">All departments</option>
            {catalogue?.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
        <button className={secondaryButton}>Search</button>
      </form>

      <div className="overflow-x-auto rounded-sm border border-ink-mid" aria-busy={loading}>
        <table className="w-full min-w-[960px] text-left text-sm">
          <caption className="p-3 text-left text-slate-light">{loading ? "Loading…" : `${rows.length} ${rows.length === 1 ? "person" : "people"}`}</caption>
          <thead className="bg-ink-light font-mono text-[11px] uppercase tracking-wider text-slate">
            <tr>{["Number", "Name", "Discipline", "Role", "Department", "Line manager", "Status", ""].map((h) => <th key={h} className="p-3" scope="col">{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="cursor-pointer border-t border-ink-mid hover:bg-ink-mid/20" onClick={() => setOpenId(row.id)}>
                <td className="p-3 font-mono text-signal">{row.employee_number || "—"}</td>
                <td className="p-3 font-medium text-paper">
                  {row.employee_name}
                  {row.login_active === false && row.employment_status !== "terminated" && <span className="ml-2 rounded-sm border border-amber-500/30 px-1.5 py-0.5 text-[10px] text-amber-300">login disabled</span>}
                </td>
                <td className="p-3 text-slate-light">{row.category_name || <span className="text-amber-300">Not set</span>}</td>
                <td className="p-3 text-paper">{row.position_name || row.job_title || <span className="text-amber-300">Not set</span>}</td>
                <td className="p-3 text-slate-light">{row.department_name || "—"}</td>
                <td className="p-3 text-slate-light">{row.line_manager_name || "—"}</td>
                <td className="p-3"><StatusPill status={row.employment_status} /></td>
                <td className="p-3 text-right"><button className={secondaryButton} onClick={(e) => { e.stopPropagation(); setOpenId(row.id); }} aria-label={`Open ${row.employee_name}`}>Open</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && rows.length === 0 && <p className="p-4 text-sm text-slate-light">Nobody matches these filters.</p>}
      </div>

      {can("workforce.people.create") && catalogue && (
        <RegisterPerson catalogue={catalogue} onCreated={(number, id) => { setMessage(`Registered as ${number}. Their card is open so you can finish it.`); refresh(); setOpenId(id); }} />
      )}
      {can("workforce.organisation.manage") && catalogue && <CatalogueSettings catalogue={catalogue} onChanged={refresh} />}

      {openId && <PersonCardModal employeeId={openId} onClose={() => setOpenId(null)} onChanged={refresh} />}
    </main>
  );
}

function RegisterPerson({ catalogue, onCreated }: { catalogue: PeopleCatalogue; onCreated: (number: string, id: string) => void }) {
  const [categoryId, setCategoryId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const retry = useRef<{ fingerprint: string; key: string } | null>(null);
  const roles = catalogue.positions.filter((p) => !categoryId || p.category_id === categoryId);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const payload = {
      employee_name: values.get("employee_name"),
      category_id: values.get("category_id") || null,
      position_id: values.get("position_id") || null,
      department_id: values.get("department_id") || null,
      employment_type: values.get("employment_type") || null,
      start_date: values.get("start_date") || null,
      work_location: values.get("work_location") || null,
    };
    const fingerprint = JSON.stringify(payload);
    if (retry.current?.fingerprint !== fingerprint) retry.current = { fingerprint, key: crypto.randomUUID() };
    setBusy(true);
    setError("");
    try {
      const result = await workforceFoundation<{ id: string; employee_number: string }>("people", { method: "POST", key: retry.current.key, payload });
      retry.current = null;
      form.reset();
      setCategoryId("");
      onCreated(result.data.employee_number, result.data.id);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="rounded-sm border border-ink-mid bg-ink-light p-4">
      <summary className="flex cursor-pointer items-center gap-2 text-lg"><UserPlus className="h-5 w-5 text-signal" />Register a new person</summary>
      <form className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" onSubmit={submit}>
        <Field label="Full name"><input className={inputClass} name="employee_name" required maxLength={255} /></Field>
        <Field label="Discipline">
          <select className={inputClass} name="category_id" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Choose discipline</option>
            {catalogue.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Role">
          <select className={inputClass} name="position_id" required defaultValue="">
            <option value="" disabled>Choose role</option>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </Field>
        <Field label="Department" hint="Leave blank to use the role's department.">
          <select className={inputClass} name="department_id" defaultValue="">
            <option value="">From role</option>
            {catalogue.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
        <Field label="Employment type">
          <select className={inputClass} name="employment_type" defaultValue="permanent">
            {EMPLOYMENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </Field>
        <Field label="Day work started"><input className={inputClass} type="date" name="start_date" max={today()} /></Field>
        <Field label="Base / site"><input className={inputClass} name="work_location" maxLength={255} placeholder="Head office, Harare" /></Field>
        <div className="flex items-end"><button className={primaryButton} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Register</button></div>
        <p className="text-xs text-slate sm:col-span-2 lg:col-span-3">The SNC worker number is issued automatically. The new card opens straight away so you can add pay, personal details and projects.</p>
        {error && <p role="alert" className="text-sm text-red-300 sm:col-span-2 lg:col-span-3">{error}</p>}
      </form>
    </details>
  );
}

function CatalogueSettings({ catalogue, onChanged }: { catalogue: PeopleCatalogue; onChanged: () => void }) {
  const [kind, setKind] = useState<"positions" | "categories">("positions");
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const taken = useMemo(() => (kind === "positions" ? catalogue.positions : catalogue.categories).map((x) => x.code), [kind, catalogue]);
  const code = previewCode(name, taken);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    setSaved("");
    try {
      const result = await workforceFoundation<{ code: string }>(`catalogues/${kind}`, {
        method: "POST",
        key: crypto.randomUUID(),
        payload: kind === "positions"
          ? { name, category_id: categoryId || null, department_id: values.get("department_id") || null, grade: values.get("grade") || null }
          : { name, payroll_eligible: values.get("payroll_eligible") === "on", description: values.get("description") || null },
      });
      setSaved(`Added "${name}" as ${result.data.code}.`);
      setName("");
      onChanged();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="rounded-sm border border-ink-mid bg-ink-light p-4">
      <summary className="flex cursor-pointer items-center gap-2 text-lg"><Settings2 className="h-5 w-5 text-signal" />Disciplines and roles</summary>
      <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="grid max-h-[28rem] gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
          {catalogue.categories.map((c) => {
            const roles = catalogue.positions.filter((p) => p.category_id === c.id);
            return (
              <div key={c.id} className="rounded-sm border border-ink-mid bg-ink p-3">
                <p className="text-sm font-semibold text-paper"><span className="font-mono text-signal">{c.code}</span> · {c.name}</p>
                <ul className="mt-2 space-y-1">
                  {roles.map((r) => (
                    <li key={r.id} className="flex justify-between text-xs text-slate-light">
                      <span><span className="font-mono text-slate">{r.code}</span> {r.name}</span>
                      {r.people > 0 && <span className="text-paper">{r.people}</span>}
                    </li>
                  ))}
                  {!roles.length && <li className="text-xs text-slate">No roles yet</li>}
                </ul>
              </div>
            );
          })}
        </div>
        <form onSubmit={submit} className="space-y-3 rounded-sm border border-ink-mid bg-ink p-4">
          <Field label="Add a">
            <select className={inputClass} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              <option value="positions">Role (e.g. Land Surveyor)</option>
              <option value="categories">Discipline (e.g. Surveying)</option>
            </select>
          </Field>
          <Field label="Name"><input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required maxLength={160} /></Field>
          <Field label="Code" hint="Generated automatically from the name."><input className={`${inputClass} font-mono`} value={code} disabled placeholder="—" /></Field>
          {kind === "positions" ? (
            <>
              <Field label="Discipline">
                <select className={inputClass} value={categoryId} onChange={(e) => setCategoryId(e.target.value)} required>
                  <option value="">Choose discipline</option>
                  {catalogue.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              <Field label="Department">
                <select className={inputClass} name="department_id" defaultValue="">
                  <option value="">Not set</option>
                  {catalogue.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </Field>
              <Field label="Grade"><input className={inputClass} name="grade" maxLength={80} placeholder="Senior, Professional, Artisan…" /></Field>
            </>
          ) : (
            <>
              <Field label="Description"><input className={inputClass} name="description" maxLength={1000} /></Field>
              <label className="flex items-center gap-2 text-sm text-slate-light"><input type="checkbox" name="payroll_eligible" defaultChecked />Paid through payroll (not by invoice)</label>
            </>
          )}
          <button className={primaryButton} disabled={busy || !name.trim()}>{busy ? "Adding…" : "Add"}</button>
          {saved && <p className="text-sm text-emerald-300">{saved}</p>}
          {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
        </form>
      </div>
    </details>
  );
}
