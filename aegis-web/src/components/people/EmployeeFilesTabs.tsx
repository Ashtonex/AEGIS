"use client";

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { CalendarClock, FileText, Loader2, Paperclip, RotateCcw, ShieldCheck, Trash2, Upload } from "lucide-react";
import {
  addPersonContract, addPersonCredential, attachAssetAcknowledgement, attachContractFile, changeContract, changeCredential,
  getPersonAssets, getPersonContracts, getPersonCredentials, issuePersonAsset, openHrAttachment, removeCredential, returnPersonAsset,
  type AssetRow, type ContractRow, type CredentialRow,
} from "@/lib/api";
import { Field, dangerButton, formatDate, humanise, inputClass, primaryButton, secondaryButton, today } from "./ui";

const errorText = (reason: unknown) => (reason instanceof Error ? reason.message : "The request could not be completed.");

type Shared = { employeeId: string; canEdit: boolean; disabled: boolean; positionName?: string | null };

function useList<T>(loader: (id: string) => Promise<{ data: T[] }>, employeeId: string) {
  const [rows, setRows] = useState<T[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { setRows((await loader(employeeId)).data); } catch (reason) { setRows([]); setError(errorText(reason)); }
  }, [loader, employeeId]);
  useEffect(() => { void load(); }, [load]);
  const act = useCallback(async (action: () => Promise<{ data: unknown; message?: string }>, pick: (data: unknown) => T[], success: string) => {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await action();
      setRows(pick(result.data));
      setNotice(result.message || success);
      return true;
    } catch (reason) {
      setError(errorText(reason));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);
  return { rows, error, notice, busy, act, setError };
}

function Messages({ error, notice }: { error: string; notice: string }) {
  return (
    <>
      {error && <p role="alert" className="rounded-sm border border-red-500/40 bg-red-950/30 px-3 py-2 text-sm text-red-200">{error}</p>}
      {notice && <p role="status" className="rounded-sm border border-emerald-500/30 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-200">{notice}</p>}
    </>
  );
}

function FileLink({ attachmentId, name }: { attachmentId: string | null; name: string | null }) {
  const [opening, setOpening] = useState(false);
  const [failed, setFailed] = useState("");
  if (!attachmentId) return <span className="text-xs text-amber-300">No copy on file</span>;
  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        className="inline-flex items-center gap-1 text-xs text-signal hover:underline disabled:opacity-50"
        disabled={opening}
        onClick={async () => {
          setOpening(true); setFailed("");
          try {
            const access = (await openHrAttachment(attachmentId)).data;
            const url = access.web_url || access.download_url;
            if (url) window.open(url, "_blank", "noopener,noreferrer");
          } catch (reason) { setFailed(errorText(reason)); } finally { setOpening(false); }
        }}
      >
        <Paperclip className="h-3.5 w-3.5" />{opening ? "Opening…" : name || "Open copy"}
      </button>
      {failed && <span className="text-xs text-red-300">{failed}</span>}
    </span>
  );
}

function Badge({ tone, children }: { tone: "green" | "amber" | "red" | "slate" | "blue"; children: ReactNode }) {
  const tones = {
    green: "border-emerald-500/30 bg-emerald-950/30 text-emerald-300",
    amber: "border-amber-500/30 bg-amber-950/30 text-amber-300",
    red: "border-red-500/30 bg-red-950/30 text-red-300",
    slate: "border-slate-500/30 bg-slate-900/40 text-slate-300",
    blue: "border-blue-500/30 bg-blue-950/30 text-blue-300",
  };
  return <span className={`inline-flex rounded-sm border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${tones[tone]}`}>{children}</span>;
}

const CONTRACT_TYPES = [
  { value: "permanent", label: "Permanent" },
  { value: "fixed_term", label: "Fixed-term" },
  { value: "probation", label: "Probation" },
  { value: "casual", label: "Casual" },
  { value: "internship", label: "Internship / attachment" },
  { value: "consultancy", label: "Consultancy" },
];

function contractTone(state: ContractRow["state"], daysLeft: number | null): "green" | "amber" | "red" | "slate" | "blue" {
  if (state === "current") return daysLeft !== null && daysLeft <= 60 ? "amber" : "green";
  if (state === "upcoming") return "blue";
  if (state === "expired" || state === "terminated") return "red";
  return "slate";
}

export function ContractsTab({ employeeId, canEdit, disabled }: Shared) {
  const { rows, error, notice, busy, act, setError } = useList<ContractRow>(getPersonContracts, employeeId);
  const [adding, setAdding] = useState<null | { renewalOf?: ContractRow }>(null);
  const [type, setType] = useState("fixed_term");
  const [ending, setEnding] = useState<string | null>(null);
  const editable = canEdit && !disabled;
  const current = rows?.find((r) => r.state === "current");

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const v = new FormData(event.currentTarget);
    const file = v.get("file");
    const ok = await act(() => addPersonContract(employeeId, {
      contract_type: type,
      title: String(v.get("title") || ""),
      starts_on: String(v.get("starts_on")),
      ends_on: String(v.get("ends_on") || ""),
      signed_on: String(v.get("signed_on") || ""),
      probation_ends_on: String(v.get("probation_ends_on") || ""),
      notice_period_days: String(v.get("notice_period_days") || ""),
      basic_salary: String(v.get("basic_salary") || ""),
      currency: String(v.get("currency") || "USD"),
      notes: String(v.get("notes") || ""),
      renewal_of: adding?.renewalOf?.id,
      file: file instanceof File && file.size ? file : null,
    }), (d) => (d as { contracts: ContractRow[] }).contracts, "Contract recorded.");
    if (ok) setAdding(null);
  }

  const renewalStart = adding?.renewalOf?.ends_on
    ? new Date(new Date(`${adding.renewalOf.ends_on}T00:00:00`).getTime() + 86400000).toISOString().slice(0, 10)
    : today();

  return (
    <div className="space-y-4">
      <Messages error={error} notice={notice} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-[11px] uppercase tracking-widest text-slate">Contracts with Six Nine Construction ({rows?.length ?? 0})</p>
        {editable && !adding && (
          <div className="flex gap-2">
            {current && <button className={secondaryButton} onClick={() => { setType(current.contract_type); setAdding({ renewalOf: current }); }}><RotateCcw className="h-4 w-4" />Renew current</button>}
            <button className={primaryButton} onClick={() => setAdding({})}><FileText className="h-4 w-4" />Add contract</button>
          </div>
        )}
      </div>

      {adding && (
        <form onSubmit={add} className="grid gap-3 rounded-sm border border-signal/30 bg-ink p-4 sm:grid-cols-2">
          {adding.renewalOf && <p className="text-sm text-signal sm:col-span-2">Renewing {adding.renewalOf.contract_number}. It will be marked renewed.</p>}
          <Field label="Contract type">
            <select className={inputClass} value={type} onChange={(e) => setType(e.target.value)}>
              {CONTRACT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </Field>
          <Field label="Title (optional)"><input name="title" className={inputClass} maxLength={200} placeholder="e.g. Contract of Employment: Quantity Surveyor" /></Field>
          <Field label="Starts"><input name="starts_on" type="date" className={inputClass} required defaultValue={renewalStart} /></Field>
          <Field label={type === "permanent" ? "Ends (leave blank for permanent)" : "Ends"}><input name="ends_on" type="date" className={inputClass} required={type !== "permanent"} /></Field>
          <Field label="Signed on"><input name="signed_on" type="date" className={inputClass} max={today()} /></Field>
          {(type === "permanent" || type === "probation") && <Field label="Probation ends"><input name="probation_ends_on" type="date" className={inputClass} /></Field>}
          <Field label="Notice period (days)"><input name="notice_period_days" type="number" min={0} max={365} className={inputClass} placeholder="30" /></Field>
          <div className="grid grid-cols-[1fr_6rem] gap-3">
            <Field label="Basic salary on contract"><input name="basic_salary" type="number" min={0} step="0.01" className={inputClass} /></Field>
            <Field label="Currency"><select name="currency" className={inputClass} defaultValue="USD"><option>USD</option><option>ZWG</option></select></Field>
          </div>
          <div className="sm:col-span-2"><Field label="Signed copy (PDF or scan)" hint="Saved to SharePoint › HR & Workforce › Employees."><input name="file" type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" className={`${inputClass} file:mr-3 file:border-0 file:bg-ink-mid file:px-3 file:py-1 file:text-paper`} /></Field></div>
          <div className="sm:col-span-2"><Field label="Notes"><textarea name="notes" className={`${inputClass} min-h-16`} maxLength={4000} /></Field></div>
          <div className="flex gap-2 sm:col-span-2 sm:justify-end">
            <button type="button" className={secondaryButton} onClick={() => setAdding(null)}>Cancel</button>
            <button className={primaryButton} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Save contract</button>
          </div>
        </form>
      )}

      {rows === null ? <Loader2 className="h-5 w-5 animate-spin text-signal" /> : rows.length === 0 && !adding ? (
        <p className="text-sm text-slate-light">No contracts on file. Add the signed contract so AEGIS can warn you and the employee before it ends.</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((c) => (
            <li key={c.id} className="rounded-sm border border-ink-mid bg-ink p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-paper"><span className="font-mono text-signal">{c.contract_number}</span> · {humanise(c.contract_type)}{c.title ? ` · ${c.title}` : ""}</p>
                  <p className="mt-0.5 text-xs text-slate-light">
                    {formatDate(c.starts_on)} – {c.ends_on ? formatDate(c.ends_on) : "open-ended"}
                    {c.basic_salary ? ` · ${c.currency || "USD"} ${Number(c.basic_salary).toLocaleString()}` : ""}
                    {c.notice_period_days != null ? ` · ${c.notice_period_days} days' notice` : ""}
                  </p>
                </div>
                <Badge tone={contractTone(c.state, c.days_left)}>
                  {c.state === "current" && c.days_left !== null ? (c.days_left <= 60 ? `Ends in ${c.days_left}d` : "Current") : humanise(c.state)}
                </Badge>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
                <FileLink attachmentId={c.file_attachment_id} name={c.file_name} />
                <span className={c.signed_on ? "text-slate-light" : "text-amber-300"}>{c.signed_on ? `Signed ${formatDate(c.signed_on)}` : "Not marked signed"}</span>
                {c.review_meeting_at && <span className="inline-flex items-center gap-1 text-blue-300"><CalendarClock className="h-3.5 w-3.5" />Review {new Date(c.review_meeting_at).toLocaleString("en-ZW", { dateStyle: "medium", timeStyle: "short" })}</span>}
                {c.ended_reason && <span className="text-slate">Ended: {c.ended_reason}</span>}
              </div>
              {editable && ["current", "upcoming"].includes(c.state) && (
                <div className="mt-3 flex flex-wrap gap-2 border-t border-ink-mid pt-3">
                  <label className={`${secondaryButton} cursor-pointer`}>
                    <Upload className="h-4 w-4" />{c.file_attachment_id ? "Replace signed copy" : "Upload signed copy"}
                    <input type="file" className="hidden" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void act(() => attachContractFile(c.id, file, c.signed_on ? undefined : today()), (d) => d as ContractRow[], "Signed copy attached.");
                      e.target.value = "";
                    }} />
                  </label>
                  {!c.signed_on && <button className={secondaryButton} disabled={busy} onClick={() => void act(() => changeContract(c.id, { action: "mark_signed", signed_on: today() }), (d) => d as ContractRow[], "Marked signed.")}>Mark signed today</button>}
                  {ending === c.id ? (
                    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => {
                      e.preventDefault();
                      const v = new FormData(e.currentTarget);
                      void act(() => changeContract(c.id, { action: "terminate", ends_on: String(v.get("ends_on")), reason: String(v.get("reason")) }), (d) => d as ContractRow[], "Contract ended.").then((done) => { if (done) setEnding(null); });
                    }}>
                      <input name="ends_on" type="date" className={`${inputClass} w-40`} defaultValue={today()} required />
                      <input name="reason" className={`${inputClass} w-56`} placeholder="Why it ended early" required minLength={3} onFocus={() => setError("")} />
                      <button className={dangerButton} disabled={busy}>End contract</button>
                      <button type="button" className={secondaryButton} onClick={() => setEnding(null)}>Cancel</button>
                    </form>
                  ) : (
                    <button className={secondaryButton} onClick={() => setEnding(c.id)}>End early</button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-slate">Before a contract ends, AEGIS warns nyasha@sixnineconstruction.com and the employee at 60, 30, 14 and 7 days, and books a review meeting on the SNC calendar.</p>
    </div>
  );
}

const CREDENTIAL_TYPES = [
  { value: "drivers_licence", label: "Driver's licence" },
  { value: "professional_registration", label: "Professional registration (ECZ, ZIQS, ZIE…)" },
  { value: "certification", label: "Certificate / qualification" },
  { value: "vehicle_registration", label: "Vehicle registration" },
  { value: "medical", label: "Medical / fitness certificate" },
  { value: "induction", label: "Site / safety induction" },
  { value: "work_permit", label: "Work permit" },
  { value: "passport", label: "Passport" },
  { value: "other", label: "Other document" },
];

export function CredentialsTab({ employeeId, canEdit, disabled }: Shared) {
  const { rows, error, notice, busy, act } = useList<CredentialRow>(getPersonCredentials, employeeId);
  const [adding, setAdding] = useState(false);
  const [type, setType] = useState("drivers_licence");
  const editable = canEdit && !disabled;

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const v = new FormData(event.currentTarget);
    const file = v.get("file");
    const values: Record<string, string | File | null> = { credential_type: type, file: file instanceof File && file.size ? file : null };
    for (const key of ["certification_name", "issuing_authority", "certificate_number", "licence_class", "vehicle_registration", "issued_on", "expires_on", "notes"]) {
      values[key] = String(v.get(key) || "");
    }
    if (await act(() => addPersonCredential(employeeId, values), (d) => d as CredentialRow[], "Credential recorded.")) setAdding(false);
  }

  const defaultName = CREDENTIAL_TYPES.find((t) => t.value === type)?.label.replace(/ \(.*\)$/, "") ?? "";

  return (
    <div className="space-y-4">
      <Messages error={error} notice={notice} />
      <div className="flex items-center justify-between">
        <p className="font-mono text-[11px] uppercase tracking-widest text-slate">Licences, registrations and certificates ({rows?.length ?? 0})</p>
        {editable && !adding && <button className={primaryButton} onClick={() => setAdding(true)}><ShieldCheck className="h-4 w-4" />Add credential</button>}
      </div>
      {adding && (
        <form onSubmit={add} className="grid gap-3 rounded-sm border border-signal/30 bg-ink p-4 sm:grid-cols-2">
          <Field label="Type">
            <select className={inputClass} value={type} onChange={(e) => setType(e.target.value)}>
              {CREDENTIAL_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </Field>
          <Field label="Name"><input key={type} name="certification_name" className={inputClass} required minLength={2} maxLength={200} defaultValue={defaultName} /></Field>
          <Field label="Issued by"><input name="issuing_authority" className={inputClass} maxLength={200} placeholder={type === "drivers_licence" ? "VID / CVR" : type === "professional_registration" ? "ECZ, ZIQS…" : ""} /></Field>
          <Field label={type === "vehicle_registration" ? "Registration book number" : "Number"}><input name="certificate_number" className={inputClass} maxLength={120} /></Field>
          {type === "drivers_licence" && <Field label="Licence class"><input name="licence_class" className={inputClass} required maxLength={40} placeholder="e.g. 2, 4, 5 or EC" /></Field>}
          {type === "vehicle_registration" && <Field label="Vehicle registration"><input name="vehicle_registration" className={`${inputClass} uppercase`} required maxLength={40} placeholder="AEX 1234" /></Field>}
          <Field label="Issued"><input name="issued_on" type="date" className={inputClass} max={today()} /></Field>
          <Field label="Expires" hint="Leave blank if it never expires."><input name="expires_on" type="date" className={inputClass} /></Field>
          <div className="sm:col-span-2"><Field label="Scan or photo"><input name="file" type="file" accept=".pdf,.jpg,.jpeg,.png" className={`${inputClass} file:mr-3 file:border-0 file:bg-ink-mid file:px-3 file:py-1 file:text-paper`} /></Field></div>
          <div className="sm:col-span-2"><Field label="Notes"><input name="notes" className={inputClass} maxLength={4000} /></Field></div>
          <div className="flex gap-2 sm:col-span-2 sm:justify-end">
            <button type="button" className={secondaryButton} onClick={() => setAdding(false)}>Cancel</button>
            <button className={primaryButton} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Save</button>
          </div>
        </form>
      )}
      {rows === null ? <Loader2 className="h-5 w-5 animate-spin text-signal" /> : rows.length === 0 && !adding ? (
        <p className="text-sm text-slate-light">Nothing recorded yet. Add driver&apos;s licences first; AEGIS uses them before letting anyone drive a fleet vehicle.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {rows.map((c) => (
            <li key={c.id} className="rounded-sm border border-ink-mid bg-ink p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-paper">{c.certification_name}</p>
                  <p className="text-xs text-slate-light">
                    {humanise(c.credential_type)}
                    {c.licence_class ? ` · Class ${c.licence_class}` : ""}
                    {c.vehicle_registration ? ` · ${c.vehicle_registration}` : ""}
                    {c.certificate_number ? ` · ${c.certificate_number}` : ""}
                  </p>
                  {c.issuing_authority && <p className="text-xs text-slate">{c.issuing_authority}</p>}
                </div>
                <Badge tone={c.state === "expired" ? "red" : c.state === "expiring" ? "amber" : "green"}>
                  {c.expires_on ? (c.state === "expired" ? "Expired" : c.state === "expiring" ? `${c.days_left}d left` : "Valid") : "No expiry"}
                </Badge>
              </div>
              <p className="mt-2 text-xs text-slate-light">{c.expires_on ? `Expires ${formatDate(c.expires_on)}` : "Does not expire"} · {humanise(c.verification_status)}</p>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <FileLink attachmentId={c.file_attachment_id} name={c.file_name} />
                {editable && c.verification_status === "pending" && (
                  <button className="text-xs text-emerald-300 hover:underline" disabled={busy} onClick={() => void act(() => changeCredential(c.id, { verification_status: "verified" }), (d) => d as CredentialRow[], "Verified.")}>Mark verified</button>
                )}
                {editable && (
                  <button className="ml-auto text-slate hover:text-red-300" aria-label={`Remove ${c.certification_name}`} disabled={busy} onClick={() => { if (window.confirm(`Remove ${c.certification_name}?`)) void act(() => removeCredential(c.id), (d) => d as CredentialRow[], "Removed."); }}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const ASSET_TYPES = [
  { value: "ppe", label: "PPE (boots, helmet, reflector…)" },
  { value: "tool", label: "Tool" },
  { value: "equipment", label: "Equipment" },
  { value: "vehicle", label: "Vehicle" },
  { value: "laptop", label: "Laptop / computer" },
  { value: "phone", label: "Phone / tablet" },
  { value: "other", label: "Other" },
];

export function AssetsTab({ employeeId, canEdit, disabled }: Shared) {
  const { rows, error, notice, busy, act } = useList<AssetRow>(getPersonAssets, employeeId);
  const [adding, setAdding] = useState(false);
  const [returning, setReturning] = useState<string | null>(null);
  // Leavers can still hand items back; they just cannot be issued anything new.
  const editable = canEdit;
  const canIssue = canEdit && !disabled;
  const held = rows?.filter((a) => a.status === "issued") ?? [];
  const past = rows?.filter((a) => a.status !== "issued") ?? [];

  async function issue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const v = new FormData(event.currentTarget);
    const ok = await act(() => issuePersonAsset(employeeId, {
      asset_type: v.get("asset_type"),
      asset_label: v.get("asset_label"),
      asset_reference: v.get("asset_reference") || null,
      serial_number: v.get("serial_number") || null,
      quantity: Number(v.get("quantity") || 1),
      asset_value: v.get("asset_value") ? Number(v.get("asset_value")) : null,
      issued_on: v.get("issued_on"),
      due_back_on: v.get("due_back_on") || null,
      condition_out: v.get("condition_out") || null,
      notes: v.get("notes") || null,
      acknowledged: v.get("acknowledged") === "on",
    }), (d) => d as AssetRow[], "Issued.");
    if (ok) setAdding(false);
  }

  const assetRow = (a: AssetRow) => (
    <li key={a.id} className="rounded-sm border border-ink-mid bg-ink p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-paper">{a.quantity > 1 ? `${a.quantity} × ` : ""}{a.asset_label}</p>
          <p className="text-xs text-slate-light">
            {humanise(a.asset_type)}{a.asset_reference ? ` · ${a.asset_reference}` : ""}{a.serial_number ? ` · S/N ${a.serial_number}` : ""}
            {a.asset_value ? ` · USD ${Number(a.asset_value).toLocaleString()}` : ""}
          </p>
          <p className="text-xs text-slate">
            Issued {formatDate(a.issued_on)}{a.issued_by_name ? ` by ${a.issued_by_name}` : ""}{a.condition_out ? `, ${a.condition_out}` : ""}
            {a.returned_on ? ` · ${humanise(a.status)} ${formatDate(a.returned_on)}${a.returned_to_name ? ` to ${a.returned_to_name}` : ""}${a.condition_in ? `, ${a.condition_in}` : ""}` : a.due_back_on ? ` · due back ${formatDate(a.due_back_on)}` : ""}
          </p>
        </div>
        {a.status === "issued"
          ? <Badge tone={a.overdue ? "red" : "green"}>{a.overdue ? "Overdue" : "Held"}</Badge>
          : <Badge tone={a.status === "returned" ? "slate" : "red"}>{humanise(a.status)}</Badge>}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
        {a.file_attachment_id ? <FileLink attachmentId={a.file_attachment_id} name={a.file_name} /> : (
          <span className={a.acknowledged_at ? "text-slate-light" : "text-amber-300"}>{a.acknowledged_at ? `Acknowledged ${formatDate(a.acknowledged_at)}` : "No signed acknowledgement"}</span>
        )}
        {editable && a.status === "issued" && (
          <>
            <label className="cursor-pointer text-signal hover:underline">
              Upload signed acknowledgement
              <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void act(() => attachAssetAcknowledgement(a.id, file), (d) => d as AssetRow[], "Acknowledgement attached.");
                e.target.value = "";
              }} />
            </label>
            {returning === a.id ? (
              <form className="flex w-full flex-wrap items-end gap-2" onSubmit={(e) => {
                e.preventDefault();
                const v = new FormData(e.currentTarget);
                void act(() => returnPersonAsset(a.id, { outcome: String(v.get("outcome")), returned_on: String(v.get("returned_on")), condition_in: String(v.get("condition_in") || "") || undefined }),
                  (d) => d as AssetRow[], "Closed out.").then((done) => { if (done) setReturning(null); });
              }}>
                <select name="outcome" className={`${inputClass} w-36`}><option value="returned">Returned</option><option value="damaged">Returned damaged</option><option value="lost">Lost</option><option value="written_off">Written off</option></select>
                <input name="returned_on" type="date" className={`${inputClass} w-40`} defaultValue={today()} required />
                <input name="condition_in" className={`${inputClass} w-40`} placeholder="Condition" />
                <button className={primaryButton} disabled={busy}>Save</button>
                <button type="button" className={secondaryButton} onClick={() => setReturning(null)}>Cancel</button>
              </form>
            ) : (
              <button className="text-signal hover:underline" onClick={() => setReturning(a.id)}>Record return</button>
            )}
          </>
        )}
      </div>
    </li>
  );

  return (
    <div className="space-y-4">
      <Messages error={error} notice={notice} />
      <div className="flex items-center justify-between">
        <p className="font-mono text-[11px] uppercase tracking-widest text-slate">Holding now ({held.length})</p>
        {canIssue && !adding && <button className={primaryButton} onClick={() => setAdding(true)}>Issue an item</button>}
      </div>
      {adding && (
        <form onSubmit={issue} className="grid gap-3 rounded-sm border border-signal/30 bg-ink p-4 sm:grid-cols-2">
          <Field label="Type"><select name="asset_type" className={inputClass}>{ASSET_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select></Field>
          <Field label="Item"><input name="asset_label" className={inputClass} required minLength={2} maxLength={200} placeholder="Safety boots size 9, Dell Latitude 5440…" /></Field>
          <Field label="Asset tag / fleet no."><input name="asset_reference" className={inputClass} maxLength={120} /></Field>
          <Field label="Serial number"><input name="serial_number" className={inputClass} maxLength={120} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Quantity"><input name="quantity" type="number" min={1} defaultValue={1} className={inputClass} /></Field>
            <Field label="Value each (USD)"><input name="asset_value" type="number" min={0} step="0.01" className={inputClass} /></Field>
          </div>
          <Field label="Condition when issued"><input name="condition_out" className={inputClass} maxLength={120} defaultValue="New" /></Field>
          <Field label="Issued on"><input name="issued_on" type="date" className={inputClass} required defaultValue={today()} /></Field>
          <Field label="Due back (optional)"><input name="due_back_on" type="date" className={inputClass} /></Field>
          <div className="sm:col-span-2"><Field label="Notes"><input name="notes" className={inputClass} maxLength={2000} /></Field></div>
          <label className="flex items-center gap-2 text-sm text-slate-light sm:col-span-2"><input type="checkbox" name="acknowledged" />The employee has signed for it (upload the signed form afterwards)</label>
          <div className="flex gap-2 sm:col-span-2 sm:justify-end">
            <button type="button" className={secondaryButton} onClick={() => setAdding(false)}>Cancel</button>
            <button className={primaryButton} disabled={busy}>Issue</button>
          </div>
        </form>
      )}
      {rows === null ? <Loader2 className="h-5 w-5 animate-spin text-signal" /> : (
        <>
          {held.length ? <ul className="space-y-2">{held.map(assetRow)}</ul> : !adding && <p className="text-sm text-slate-light">Not holding any company property.</p>}
          {past.length > 0 && (
            <details className="rounded-sm border border-ink-mid p-3">
              <summary className="cursor-pointer text-sm text-slate-light">Returned / closed ({past.length})</summary>
              <ul className="mt-3 space-y-2">{past.map(assetRow)}</ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}
