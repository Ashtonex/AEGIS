"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { AlertTriangle, Briefcase, ClipboardList, FileText, History, Loader2, Package, ShieldCheck, UserRound, Wallet, X, Brain, LayoutDashboard, LogOut, Undo2 } from "lucide-react";
import {
  addPersonPsychometric,
  createWorkforceAllocation,
  endPersonAllocation,
  getPeopleCatalogue,
  getPersonCard,
  recordPersonLeft,
  reinstatePerson,
  removePersonPsychometric,
  updatePersonEmployment,
  updatePersonPay,
  updatePersonPersonal,
  workforceFoundation,
  type PeopleCatalogue,
  type PersonCard,
} from "@/lib/api";
import { PersonalDetailsForm } from "./PersonalDetailsForm";
import { AssetsTab, ContractsTab, CredentialsTab } from "./EmployeeFilesTabs";
import {
  EMPLOYMENT_TYPES, Field, StatusPill, dangerButton, formatDate, humanise, inputClass, primaryButton, secondaryButton, today,
} from "./ui";

export type PersonCardTab = "overview" | "employment" | "projects" | "contracts" | "credentials" | "assets" | "pay" | "personal" | "assessments" | "history";
type Tab = PersonCardTab;

const errorText = (reason: unknown) => (reason instanceof Error ? reason.message : "The request could not be completed.");

/**
 * The person card. Opened from any register; scrolls inside itself so the
 * page underneath never grows. Each tab saves on its own.
 */
export function PersonCardModal({
  employeeId,
  onClose,
  onChanged,
  initialTab = "overview",
}: {
  employeeId: string;
  onClose: () => void;
  onChanged?: () => void;
  initialTab?: Tab;
}) {
  const [card, setCard] = useState<PersonCard | null>(null);
  const [catalogue, setCatalogue] = useState<PeopleCatalogue | null>(null);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [cardRes, catalogueRes] = await Promise.all([getPersonCard(employeeId), getPeopleCatalogue()]);
      setCard(cardRes.data);
      setCatalogue(catalogueRes.data);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => { void load(); }, [load]);

  // Lock the page behind the card and close on Escape.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    dialogRef.current?.focus();
    return () => { document.body.style.overflow = previous; window.removeEventListener("keydown", onKey); };
  }, [onClose]);

  const run = useCallback(async (action: () => Promise<{ data: PersonCard; message?: string }>, success: string) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await action();
      setCard(result.data);
      setNotice(result.message || success);
      onChanged?.();
      return true;
    } catch (reason) {
      setError(errorText(reason));
      return false;
    } finally {
      setBusy(false);
    }
  }, [onChanged]);

  const tabs = useMemo(() => {
    const list: { id: Tab; label: string; icon: ReactNode }[] = [
      { id: "overview", label: "Overview", icon: <LayoutDashboard className="h-4 w-4" /> },
      { id: "employment", label: "Employment", icon: <Briefcase className="h-4 w-4" /> },
      { id: "projects", label: "Projects", icon: <ClipboardList className="h-4 w-4" /> },
    ];
    if (card?.access.files) {
      list.push({ id: "contracts", label: "Contracts", icon: <FileText className="h-4 w-4" /> });
      list.push({ id: "credentials", label: "Credentials", icon: <ShieldCheck className="h-4 w-4" /> });
      list.push({ id: "assets", label: "Assets", icon: <Package className="h-4 w-4" /> });
    }
    if (card?.access.pay) list.push({ id: "pay", label: "Pay", icon: <Wallet className="h-4 w-4" /> });
    if (card?.access.personal) {
      list.push({ id: "personal", label: "Personal", icon: <UserRound className="h-4 w-4" /> });
      list.push({ id: "assessments", label: "Assessments", icon: <Brain className="h-4 w-4" /> });
    }
    list.push({ id: "history", label: "History", icon: <History className="h-4 w-4" /> });
    return list;
  }, [card]);

  const person = card?.person;
  const left = person?.employment_status === "terminated";

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-6" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={person ? `Person card for ${person.employee_name}` : "Person card"}
        tabIndex={-1}
        className="flex h-full w-full max-w-5xl flex-col overflow-hidden border border-ink-mid bg-ink-light shadow-2xl outline-none sm:h-[88vh] sm:rounded-lg"
      >
        {/* Header */}
        <div className="shrink-0 border-b border-ink-mid px-5 pb-3 pt-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              {person ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-xl font-semibold text-paper">{person.employee_name}</h2>
                    <StatusPill status={person.employment_status} />
                  </div>
                  <p className="mt-1 text-sm text-slate-light">
                    <span className="font-mono text-signal">{person.employee_number || "No number"}</span>
                    {" · "}{person.position_name || person.job_title || "Role not set"}
                    {person.department_name ? ` · ${person.department_name}` : ""}
                  </p>
                </>
              ) : (
                <h2 className="text-xl font-semibold text-paper">Person card</h2>
              )}
            </div>
            <button onClick={onClose} className="rounded-sm p-2 text-slate hover:bg-ink-mid/40 hover:text-paper" aria-label="Close person card">
              <X className="h-5 w-5" />
            </button>
          </div>
          {card && (
            <div className="mt-3 flex items-center gap-3">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-mid">
                <div className={`h-full ${card.completeness.percent >= 80 ? "bg-emerald-500" : card.completeness.percent >= 50 ? "bg-signal" : "bg-red-500"}`} style={{ width: `${card.completeness.percent}%` }} />
              </div>
              <span className="shrink-0 font-mono text-xs text-slate-light">{card.completeness.percent}% complete</span>
            </div>
          )}
          <nav className="-mb-3 mt-3 flex gap-1 overflow-x-auto" aria-label="Person card sections">
            {tabs.map((item) => (
              <button
                key={item.id}
                onClick={() => { setTab(item.id); setNotice(""); setError(""); }}
                className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm ${tab === item.id ? "border-signal text-paper" : "border-transparent text-slate-light hover:text-paper"}`}
                aria-current={tab === item.id ? "page" : undefined}
              >
                {item.icon}{item.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Body: the only scrolling region */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5">
          {error && <p role="alert" className="mb-4 flex items-start gap-2 rounded-sm border border-red-500/40 bg-red-950/30 px-3 py-2 text-sm text-red-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</p>}
          {notice && <p role="status" className="mb-4 rounded-sm border border-emerald-500/30 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-200">{notice}</p>}
          {loading || !card || !catalogue ? (
            <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-signal" /></div>
          ) : (
            <>
              {tab === "overview" && <Overview card={card} onJump={setTab} />}
              {tab === "employment" && <EmploymentTab key={`${card.person.id}:${card.person.version}`} card={card} catalogue={catalogue} busy={busy} disabled={left} run={run} />}
              {tab === "projects" && <ProjectsTab card={card} catalogue={catalogue} busy={busy} disabled={left} run={run} reload={load} setError={setError} setNotice={setNotice} />}
              {tab === "contracts" && <ContractsTab employeeId={card.person.id} canEdit={card.access.files_manage} disabled={left} />}
              {tab === "credentials" && <CredentialsTab employeeId={card.person.id} canEdit={card.access.files_manage} disabled={left} />}
              {tab === "assets" && <AssetsTab employeeId={card.person.id} canEdit={card.access.files_manage} disabled={left} />}
              {tab === "pay" && <PayTab key={`pay:${card.person.version}`} card={card} busy={busy} disabled={left} run={run} />}
              {tab === "personal" && card.personal && (
                <PersonalDetailsForm
                  key={`personal:${card.person.version}`}
                  value={card.personal}
                  editable={card.access.personal_manage}
                  busy={busy}
                  onSave={async (payload) => { await run(() => updatePersonPersonal(card.person.id, payload), "Personal details saved."); }}
                />
              )}
              {tab === "assessments" && <AssessmentsTab card={card} busy={busy} run={run} />}
              {tab === "history" && <HistoryTab card={card} busy={busy} run={run} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

type Runner = (action: () => Promise<{ data: PersonCard; message?: string }>, success: string) => Promise<boolean>;

function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: string }) {
  return (
    <div className="rounded-sm border border-ink-mid bg-ink p-3">
      <p className="font-mono text-[10px] uppercase tracking-widest text-slate">{label}</p>
      <p className={`mt-1 text-sm ${tone ?? "text-paper"}`}>{value}</p>
    </div>
  );
}

function Overview({ card, onJump }: { card: PersonCard; onJump: (tab: Tab) => void }) {
  const p = card.person;
  const live = card.allocations.filter((a) => ["planned", "active"].includes(a.status) && a.ends_on >= today());
  const load = live.reduce((sum, a) => sum + Number(a.allocation_percent || 0), 0);
  return (
    <div className="space-y-5">
      {p.employment_status === "terminated" && (
        <div className="rounded-sm border border-slate-500/40 bg-slate-900/40 p-3 text-sm text-slate-200">
          Left on {formatDate(p.end_date)}. {p.left_reason}
          {p.left_recorded_by_name ? <span className="text-slate"> Recorded by {p.left_recorded_by_name}.</span> : null}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Discipline" value={p.category_name || "Not set"} />
        <Stat label="Role" value={p.position_name || p.job_title || "Not set"} />
        <Stat label="Started" value={formatDate(p.start_date)} />
        <Stat label="Employment" value={humanise(p.employment_type)} />
        <Stat label="Line manager" value={card.line_manager?.manager_name || "None"} />
        <Stat label="Direct reports" value={card.direct_reports.length} />
        <Stat label="Live projects" value={`${live.length} · ${load}% loaded`} tone={load > 100 ? "text-red-300" : undefined} />
        <Stat label="AEGIS login" value={p.login_email ? `${p.login_email}${p.login_active === false ? " (disabled)" : ""}` : "No login"} tone={p.login_active === false ? "text-amber-300" : undefined} />
      </div>
      {card.completeness.missing.length > 0 && (
        <div className="rounded-sm border border-signal/30 bg-signal/5 p-4">
          <p className="text-sm font-semibold text-paper">Still missing</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {card.completeness.missing.map((item) => {
              const target: Tab = ["National ID", "Date of birth", "Phone", "Next of kin"].includes(item) ? "personal" : item === "Pay profile" ? "pay" : "employment";
              return (
                <button key={item} onClick={() => onJump(target)} className="rounded-sm border border-ink-mid bg-ink px-2.5 py-1 text-xs text-slate-light hover:border-signal/50 hover:text-paper">
                  {item}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {card.direct_reports.length > 0 && (
        <div>
          <p className="mb-2 font-mono text-[11px] uppercase tracking-widest text-slate">Reports to {p.employee_name.split(" ")[0]}</p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {card.direct_reports.map((r) => (
              <li key={r.id} className="rounded-sm border border-ink-mid bg-ink px-3 py-2 text-sm text-paper">{r.employee_name}<span className="text-slate"> · {r.job_title || "Role not set"}</span></li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function EmploymentTab({ card, catalogue, busy, disabled, run }: { card: PersonCard; catalogue: PeopleCatalogue; busy: boolean; disabled: boolean; run: Runner }) {
  const p = card.person;
  const [form, setForm] = useState({
    employee_name: p.employee_name,
    category_id: p.category_id ?? "",
    position_id: p.position_id ?? "",
    department_id: p.department_id ?? "",
    job_title: p.job_title ?? "",
    employment_type: p.employment_type ?? "",
    employment_status: p.employment_status === "terminated" ? "active" : p.employment_status,
    start_date: p.start_date ?? "",
    work_location: p.work_location ?? "",
    annual_leave_days: String(p.annual_leave_days ?? 21),
    line_manager_id: card.line_manager?.manager_employee_id ?? "",
  });
  const editable = card.access.employment_manage && !disabled;
  const roles = catalogue.positions.filter((pos) => !form.category_id || pos.category_id === form.category_id);
  const set = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));

  function chooseRole(positionId: string) {
    const role = catalogue.positions.find((pos) => pos.id === positionId);
    setForm((current) => ({
      ...current,
      position_id: positionId,
      category_id: role?.category_id ?? current.category_id,
      department_id: role?.department_id ?? current.department_id,
      job_title: role ? role.name : current.job_title,
    }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const payload: Record<string, unknown> = {
      employee_name: form.employee_name.trim(),
      category_id: form.category_id || null,
      position_id: form.position_id || null,
      department_id: form.department_id || null,
      job_title: form.job_title.trim() || null,
      employment_type: form.employment_type || null,
      employment_status: form.employment_status,
      start_date: form.start_date || null,
      work_location: form.work_location.trim() || null,
      annual_leave_days: Number(form.annual_leave_days),
    };
    if ((card.line_manager?.manager_employee_id ?? "") !== form.line_manager_id) payload.line_manager_id = form.line_manager_id || null;
    await run(() => updatePersonEmployment(p.id, payload), "Employment details saved.");
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Full name"><input className={inputClass} value={form.employee_name} onChange={(e) => set("employee_name", e.target.value)} disabled={!editable} required maxLength={255} /></Field>
        <Field label="Worker number" hint="Issued by AEGIS and never reused."><input className={`${inputClass} font-mono`} value={p.employee_number ?? "Issued on save"} disabled /></Field>
        <Field label="Discipline">
          <select className={inputClass} value={form.category_id} onChange={(e) => setForm((c) => ({ ...c, category_id: e.target.value, position_id: catalogue.positions.find((pos) => pos.id === c.position_id)?.category_id === e.target.value ? c.position_id : "" }))} disabled={!editable}>
            <option value="">Choose discipline</option>
            {catalogue.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Role" hint="Picking a role fills discipline, department and title.">
          <select className={inputClass} value={form.position_id} onChange={(e) => chooseRole(e.target.value)} disabled={!editable}>
            <option value="">Choose role</option>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.name}{r.grade ? ` · ${r.grade}` : ""}</option>)}
          </select>
        </Field>
        <Field label="Job title on contract"><input className={inputClass} value={form.job_title} onChange={(e) => set("job_title", e.target.value)} disabled={!editable} maxLength={100} /></Field>
        <Field label="Department">
          <select className={inputClass} value={form.department_id} onChange={(e) => set("department_id", e.target.value)} disabled={!editable}>
            <option value="">Not assigned</option>
            {catalogue.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
        <Field label="Employment type">
          <select className={inputClass} value={form.employment_type} onChange={(e) => set("employment_type", e.target.value)} disabled={!editable}>
            <option value="">Not recorded</option>
            {EMPLOYMENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </Field>
        <Field label="Day work started"><input type="date" className={inputClass} value={form.start_date} onChange={(e) => set("start_date", e.target.value)} disabled={!editable} max={today()} /></Field>
        <Field label="Base / site"><input className={inputClass} value={form.work_location} onChange={(e) => set("work_location", e.target.value)} disabled={!editable} maxLength={255} placeholder="Head office, Harare" /></Field>
        <Field label="Annual leave days"><input type="number" min={0} max={60} className={inputClass} value={form.annual_leave_days} onChange={(e) => set("annual_leave_days", e.target.value)} disabled={!editable} /></Field>
        <Field label="Status">
          <select className={inputClass} value={form.employment_status} onChange={(e) => set("employment_status", e.target.value)} disabled={!editable}>
            <option value="active">Active</option>
            <option value="on_leave">On leave</option>
            <option value="suspended">Suspended</option>
          </select>
        </Field>
        <Field label="Line manager" hint="Who this person reports to. Used for leave approvals and the org chart.">
          <select className={inputClass} value={form.line_manager_id} onChange={(e) => set("line_manager_id", e.target.value)} disabled={!editable}>
            <option value="">Nobody (top of the organisation)</option>
            {catalogue.managers.filter((m) => m.id !== p.id).map((m) => <option key={m.id} value={m.id}>{m.employee_name}{m.job_title ? ` · ${m.job_title}` : ""}</option>)}
          </select>
        </Field>
      </div>
      {editable ? (
        <div className="flex justify-end"><button className={primaryButton} disabled={busy}>{busy ? "Saving…" : "Save employment"}</button></div>
      ) : (
        <p className="text-sm text-slate">{disabled ? "This person has left. Reinstate them on the History tab to make changes." : "You can view but not change employment details."}</p>
      )}
    </form>
  );
}

function ProjectsTab({
  card, catalogue, busy, disabled, run, reload, setError, setNotice,
}: {
  card: PersonCard; catalogue: PeopleCatalogue; busy: boolean; disabled: boolean; run: Runner;
  reload: () => Promise<void>; setError: (v: string) => void; setNotice: (v: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const live = card.allocations.filter((a) => ["planned", "active"].includes(a.status) && a.ends_on >= today());
  const past = card.allocations.filter((a) => !live.includes(a));

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setSaving(true);
    setError("");
    try {
      await createWorkforceAllocation({
        employee_id: card.person.id,
        project_id: values.get("project_id"),
        role_on_project: values.get("role_on_project") || null,
        allocation_percent: Number(values.get("allocation_percent")),
        starts_on: values.get("starts_on"),
        ends_on: values.get("ends_on"),
        status: "active",
      });
      setAdding(false);
      setNotice("Added to project.");
      await reload();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setSaving(false);
    }
  }

  const row = (a: PersonCard["allocations"][number], canEnd: boolean) => (
    <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-ink-mid bg-ink px-3 py-2.5">
      <div className="min-w-0">
        <p className="text-sm font-medium text-paper">{a.project_name}</p>
        <p className="text-xs text-slate-light">{a.role_on_project || "Role not stated"} · {Number(a.allocation_percent)}% · {formatDate(a.starts_on)} – {formatDate(a.ends_on)} · {humanise(a.status)}</p>
      </div>
      {canEnd && (
        <button className={secondaryButton} disabled={busy} onClick={() => void run(() => endPersonAllocation(card.person.id, a.id, today()), "Allocation ended today.")}>End today</button>
      )}
    </li>
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="font-mono text-[11px] uppercase tracking-widest text-slate">On projects now ({live.length})</p>
        {card.access.allocate && !disabled && !adding && <button className={secondaryButton} onClick={() => setAdding(true)}>Add to project</button>}
      </div>
      {adding && (
        <form onSubmit={add} className="grid gap-3 rounded-sm border border-signal/30 bg-ink p-4 sm:grid-cols-2">
          <Field label="Project">
            <select name="project_id" className={inputClass} required defaultValue="">
              <option value="" disabled>Choose project</option>
              {catalogue.projects.map((pr) => <option key={pr.id} value={pr.id}>{pr.project_code ? `${pr.project_code} · ` : ""}{pr.name}</option>)}
            </select>
          </Field>
          <Field label="Role on this project"><input name="role_on_project" className={inputClass} defaultValue={card.person.position_name ?? ""} maxLength={100} /></Field>
          <Field label="Share of their time (%)"><input name="allocation_percent" type="number" min={5} max={100} step={5} defaultValue={50} className={inputClass} required /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="From"><input name="starts_on" type="date" className={inputClass} defaultValue={today()} required /></Field>
            <Field label="Until"><input name="ends_on" type="date" className={inputClass} required /></Field>
          </div>
          <div className="flex gap-2 sm:col-span-2 sm:justify-end">
            <button type="button" className={secondaryButton} onClick={() => setAdding(false)}>Cancel</button>
            <button className={primaryButton} disabled={saving}>{saving ? "Checking compliance…" : "Add to project"}</button>
          </div>
          <p className="text-xs text-slate sm:col-span-2">The deployment compliance gate runs before the person is added; total time across projects cannot exceed 100%.</p>
        </form>
      )}
      {live.length ? <ul className="space-y-2">{live.map((a) => row(a, card.access.allocate && !disabled))}</ul> : <p className="text-sm text-slate-light">Not on any project right now.</p>}
      {past.length > 0 && (
        <details className="rounded-sm border border-ink-mid p-3">
          <summary className="cursor-pointer text-sm text-slate-light">Earlier projects ({past.length})</summary>
          <ul className="mt-3 space-y-2">{past.map((a) => row(a, false))}</ul>
        </details>
      )}
    </div>
  );
}

function PayTab({ card, busy, disabled, run }: { card: PersonCard; busy: boolean; disabled: boolean; run: Runner }) {
  const pay = card.pay;
  const editable = card.access.pay_manage && !disabled;
  const [form, setForm] = useState({
    pay_type: pay?.pay_type ?? "monthly_salary",
    base_rate: pay ? String(pay.base_rate) : "",
    overtime_rate: pay ? String(pay.overtime_rate ?? 0) : "0",
    currency: pay?.currency ?? "USD",
    bank_name: pay?.bank_name ?? "",
    bank_account_number: pay?.bank_account_number ?? "",
    tax_number: pay?.tax_number ?? "",
    nssa_number: pay?.nssa_number ?? "",
  });
  const set = (key: keyof typeof form, value: string) => setForm((c) => ({ ...c, [key]: value }));
  const rateLabel = form.pay_type === "monthly_salary" ? "Monthly salary" : form.pay_type === "hourly" ? "Rate per hour" : "Rate per day";

  async function submit(event: FormEvent) {
    event.preventDefault();
    await run(() => updatePersonPay(card.person.id, {
      ...form,
      base_rate: Number(form.base_rate),
      overtime_rate: Number(form.overtime_rate || 0),
      bank_name: form.bank_name || null,
      bank_account_number: form.bank_account_number || null,
      tax_number: form.tax_number || null,
      nssa_number: form.nssa_number || null,
    }), "Pay details saved.");
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      {!pay && <p className="rounded-sm border border-amber-500/30 bg-amber-950/20 px-3 py-2 text-sm text-amber-200">No pay profile yet, so this person cannot be included in a payroll run.</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Paid">
          <select className={inputClass} value={form.pay_type} onChange={(e) => set("pay_type", e.target.value)} disabled={!editable}>
            <option value="monthly_salary">Monthly salary</option>
            <option value="daily">Daily rate</option>
            <option value="hourly">Hourly rate</option>
          </select>
        </Field>
        <div className="grid grid-cols-[1fr_6rem] gap-3">
          <Field label={rateLabel}><input type="number" min={0} step="0.01" className={inputClass} value={form.base_rate} onChange={(e) => set("base_rate", e.target.value)} disabled={!editable} required /></Field>
          <Field label="Currency">
            <select className={inputClass} value={form.currency} onChange={(e) => set("currency", e.target.value)} disabled={!editable}>
              <option value="USD">USD</option>
              <option value="ZWG">ZWG</option>
            </select>
          </Field>
        </div>
        <Field label="Overtime rate per hour" hint="Leave 0 to use 1.5× the hourly equivalent."><input type="number" min={0} step="0.01" className={inputClass} value={form.overtime_rate} onChange={(e) => set("overtime_rate", e.target.value)} disabled={!editable} /></Field>
        <Field label="ZIMRA tax number (BP)"><input className={inputClass} value={form.tax_number} onChange={(e) => set("tax_number", e.target.value)} disabled={!editable} maxLength={80} /></Field>
        <Field label="NSSA number"><input className={inputClass} value={form.nssa_number} onChange={(e) => set("nssa_number", e.target.value)} disabled={!editable} maxLength={80} /></Field>
        <Field label="Bank"><input className={inputClass} value={form.bank_name} onChange={(e) => set("bank_name", e.target.value)} disabled={!editable} maxLength={160} placeholder="BancABC, CBZ, Stanbic…" /></Field>
        <Field label="Account number"><input className={`${inputClass} font-mono`} value={form.bank_account_number} onChange={(e) => set("bank_account_number", e.target.value)} disabled={!editable} maxLength={120} /></Field>
      </div>
      <p className="text-xs text-slate">PAYE, AIDS levy and NSSA are worked out at payroll time from the current ZIMRA and NSSA rate tables.</p>
      {editable ? (
        <div className="flex justify-end"><button className={primaryButton} disabled={busy}>{busy ? "Saving…" : "Save pay details"}</button></div>
      ) : (
        <p className="text-sm text-slate">Only payroll managers can change pay. Bank numbers are masked for everyone else.</p>
      )}
    </form>
  );
}

function AssessmentsTab({ card, busy, run }: { card: PersonCard; busy: boolean; run: Runner }) {
  const [adding, setAdding] = useState(false);
  const [dimensions, setDimensions] = useState<{ name: string; score: string }[]>([{ name: "", score: "" }]);
  const results = card.psychometrics ?? [];

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const dimension_scores = Object.fromEntries(
      dimensions.filter((d) => d.name.trim() && d.score !== "").map((d) => [d.name.trim(), Number(d.score)]),
    );
    const ok = await run(() => addPersonPsychometric(card.person.id, {
      test_name: values.get("test_name"),
      provider: values.get("provider") || null,
      assessed_on: values.get("assessed_on") || null,
      overall_score: values.get("overall_score") ? Number(values.get("overall_score")) : null,
      max_score: values.get("max_score") ? Number(values.get("max_score")) : null,
      dimension_scores,
      interpretation: values.get("interpretation") || null,
    }), "Assessment recorded.");
    if (ok) { setAdding(false); setDimensions([{ name: "", score: "" }]); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="font-mono text-[11px] uppercase tracking-widest text-slate">Psychometric and aptitude results ({results.length})</p>
        {card.access.personal_manage && !adding && <button className={secondaryButton} onClick={() => setAdding(true)}>Record a result</button>}
      </div>
      {adding && (
        <form onSubmit={add} className="grid gap-3 rounded-sm border border-signal/30 bg-ink p-4 sm:grid-cols-2">
          <Field label="Test"><input name="test_name" className={inputClass} required minLength={2} maxLength={160} placeholder="e.g. SNC Accountant Online Assessment, 16PF, Thomas PPA" /></Field>
          <Field label="Provider"><input name="provider" className={inputClass} maxLength={160} placeholder="Microsoft Forms, external assessor…" /></Field>
          <Field label="Date taken"><input name="assessed_on" type="date" className={inputClass} max={today()} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Score"><input name="overall_score" type="number" min={0} step="0.01" className={inputClass} /></Field>
            <Field label="Out of"><input name="max_score" type="number" min={0.01} step="0.01" className={inputClass} defaultValue={100} /></Field>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <p className="text-sm text-slate-light">Dimension scores (optional)</p>
            {dimensions.map((d, i) => (
              <div key={i} className="grid grid-cols-[1fr_7rem] gap-2">
                <input className={inputClass} placeholder="e.g. Numerical reasoning" value={d.name} onChange={(e) => setDimensions((list) => list.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
                <input className={inputClass} type="number" step="0.01" placeholder="Score" value={d.score} onChange={(e) => setDimensions((list) => list.map((x, j) => j === i ? { ...x, score: e.target.value } : x))} />
              </div>
            ))}
            <button type="button" className="text-xs text-signal hover:underline" onClick={() => setDimensions((list) => [...list, { name: "", score: "" }])}>+ Add a dimension</button>
          </div>
          <div className="sm:col-span-2"><Field label="Assessor's interpretation"><textarea name="interpretation" className={`${inputClass} min-h-20`} maxLength={4000} /></Field></div>
          <div className="flex gap-2 sm:col-span-2 sm:justify-end">
            <button type="button" className={secondaryButton} onClick={() => setAdding(false)}>Cancel</button>
            <button className={primaryButton} disabled={busy}>Save result</button>
          </div>
        </form>
      )}
      {results.length === 0 && !adding && <p className="text-sm text-slate-light">No results recorded. Add results from tests taken at hiring or during employment.</p>}
      <ul className="space-y-3">
        {results.map((r) => {
          const pct = r.overall_score != null && r.max_score ? Math.round((Number(r.overall_score) / Number(r.max_score)) * 100) : null;
          return (
            <li key={r.id} className="rounded-sm border border-ink-mid bg-ink p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-paper">{r.test_name}</p>
                  <p className="text-xs text-slate-light">{r.provider || "Provider not recorded"} · {formatDate(r.assessed_on)}</p>
                </div>
                <div className="flex items-center gap-3">
                  {pct != null && <span className={`font-mono text-lg ${pct >= 70 ? "text-emerald-300" : pct >= 50 ? "text-signal" : "text-red-300"}`}>{pct}%</span>}
                  {card.access.personal_manage && <button className="text-xs text-slate hover:text-red-300" disabled={busy} onClick={() => void run(() => removePersonPsychometric(card.person.id, r.id), "Result removed.")}>Remove</button>}
                </div>
              </div>
              {Object.keys(r.dimension_scores || {}).length > 0 && (
                <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                  {Object.entries(r.dimension_scores).map(([name, score]) => (
                    <div key={name} className="flex justify-between border-b border-ink-mid pb-1 text-sm"><dt className="text-slate-light">{name}</dt><dd className="font-mono text-paper">{score}</dd></div>
                  ))}
                </dl>
              )}
              {r.interpretation && <p className="mt-3 whitespace-pre-line text-sm text-slate-light">{r.interpretation}</p>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

type HistoryItem = { id: string; action: string; created_at: string; reason: string | null; version: string | null };

function HistoryTab({ card, busy, run }: { card: PersonCard; busy: boolean; run: Runner }) {
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [historyError, setHistoryError] = useState("");
  const [confirmLeave, setConfirmLeave] = useState(false);
  const p = card.person;
  const left = p.employment_status === "terminated";

  useEffect(() => {
    let active = true;
    workforceFoundation<HistoryItem[]>(`people/${p.id}/history`)
      .then((result) => { if (active) setItems(result.data); })
      .catch((reason) => { if (active) { setItems([]); setHistoryError(errorText(reason)); } });
    return () => { active = false; };
  }, [p.id, p.version]);

  async function leave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const ok = await run(() => recordPersonLeft(p.id, {
      left_on: String(values.get("left_on")),
      reason: String(values.get("reason")),
      disable_login: values.get("disable_login") === "on",
    }), "Recorded as left.");
    if (ok) setConfirmLeave(false);
  }

  async function reinstate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(() => reinstatePerson(p.id, String(new FormData(event.currentTarget).get("reason"))), "Reinstated.");
  }

  return (
    <div className="space-y-6">
      <section>
        <p className="mb-2 font-mono text-[11px] uppercase tracking-widest text-slate">Change history</p>
        {items === null ? <Loader2 className="h-5 w-5 animate-spin text-signal" /> : items.length === 0 ? (
          <p className="text-sm text-slate-light">{historyError || "No recorded changes yet."}</p>
        ) : (
          <ol className="space-y-2 border-l border-ink-mid pl-4">
            {items.map((item) => (
              <li key={item.id} className="text-sm">
                <span className="text-slate">{new Date(item.created_at).toLocaleString("en-ZW")}</span>
                <span className="text-paper"> · {humanise(item.action.toLowerCase())}</span>
                {item.reason ? <span className="text-slate-light"> · {item.reason}</span> : null}
              </li>
            ))}
          </ol>
        )}
      </section>

      {card.access.offboard && (
        <section className="rounded-sm border border-ink-mid p-4">
          {left ? (
            <form onSubmit={reinstate} className="space-y-3">
              <p className="text-sm text-paper">Rehired, or recorded as left by mistake?</p>
              <Field label="Reason"><input name="reason" className={inputClass} required minLength={3} maxLength={2000} /></Field>
              <p className="text-xs text-slate">Their AEGIS login stays disabled until it is re-enabled in Settings → Users.</p>
              <button className={secondaryButton} disabled={busy}><Undo2 className="h-4 w-4" />Reinstate</button>
            </form>
          ) : !confirmLeave ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm text-paper">Has {p.employee_name.split(" ")[0]} left Six Nine Construction?</p>
                <p className="text-xs text-slate">They leave every active list, project and reporting line; their record and number are kept.</p>
              </div>
              <button className={dangerButton} onClick={() => setConfirmLeave(true)}><LogOut className="h-4 w-4" />Mark as left</button>
            </div>
          ) : (
            <form onSubmit={leave} className="grid gap-3 sm:grid-cols-2">
              <Field label="Last working day"><input name="left_on" type="date" className={inputClass} defaultValue={today()} required /></Field>
              <Field label="Reason"><input name="reason" className={inputClass} required minLength={3} maxLength={2000} placeholder="Resigned, contract ended, dismissed…" /></Field>
              {p.login_email && (
                <label className="flex items-center gap-2 text-sm text-slate-light sm:col-span-2">
                  <input type="checkbox" name="disable_login" defaultChecked={p.login_active !== false} />
                  Disable their AEGIS login ({p.login_email}){p.login_active === false ? ", already disabled" : ""}
                </label>
              )}
              <div className="flex gap-2 sm:col-span-2 sm:justify-end">
                <button type="button" className={secondaryButton} onClick={() => setConfirmLeave(false)}>Cancel</button>
                <button className={dangerButton} disabled={busy}>{busy ? "Recording…" : "Confirm: mark as left"}</button>
              </div>
            </form>
          )}
        </section>
      )}
    </div>
  );
}
