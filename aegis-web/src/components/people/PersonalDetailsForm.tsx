"use client";

import { useState, type FormEvent } from "react";
import type { PersonalDetails } from "@/lib/api";
import { Field, inputClass, primaryButton } from "./ui";

/** Personal details form, shared by the person card (HR editing) and My Profile (self-service). */
export function PersonalDetailsForm({
  value,
  editable,
  busy,
  onSave,
}: {
  value: PersonalDetails;
  editable: boolean;
  busy: boolean;
  onSave: (payload: Partial<PersonalDetails>) => Promise<void>;
}) {
  const [draft, setDraft] = useState<PersonalDetails>(value);
  const set = (key: keyof PersonalDetails, next: string) => setDraft((current) => ({ ...current, [key]: next }));
  const setContact = (key: string, next: string) =>
    setDraft((current) => ({ ...current, emergency_contact: { ...(current.emergency_contact || {}), [key]: next } }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    const payload: Record<string, unknown> = {};
    (Object.keys(draft) as (keyof PersonalDetails)[]).forEach((key) => {
      if (key === "emergency_contact") return;
      const next = draft[key];
      payload[key] = typeof next === "string" && next.trim() === "" ? null : next;
    });
    payload.emergency_contact = draft.emergency_contact || {};
    await onSave(payload as Partial<PersonalDetails>);
  }

  const text = (key: keyof PersonalDetails, label: string, extra: Record<string, unknown> = {}) => (
    <Field label={label}>
      <input
        className={inputClass}
        value={(draft[key] as string | null) ?? ""}
        onChange={(event) => set(key, event.target.value)}
        disabled={!editable}
        {...extra}
      />
    </Field>
  );

  return (
    <form onSubmit={submit} className="space-y-5">
      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-2 font-mono text-[11px] uppercase tracking-widest text-slate">Identity</legend>
        {text("national_id", "National ID number", { maxLength: 40, placeholder: "e.g. 63-123456X42" })}
        {text("date_of_birth", "Date of birth", { type: "date" })}
        <Field label="Gender">
          <select className={inputClass} value={draft.gender ?? ""} onChange={(e) => set("gender", e.target.value)} disabled={!editable}>
            <option value="">Not stated</option>
            <option value="female">Female</option>
            <option value="male">Male</option>
            <option value="other">Other</option>
          </select>
        </Field>
        <Field label="Marital status">
          <select className={inputClass} value={draft.marital_status ?? ""} onChange={(e) => set("marital_status", e.target.value)} disabled={!editable}>
            <option value="">Not stated</option>
            <option value="single">Single</option>
            <option value="married">Married</option>
            <option value="divorced">Divorced</option>
            <option value="widowed">Widowed</option>
          </select>
        </Field>
        {text("nationality", "Nationality", { maxLength: 80, placeholder: "Zimbabwean" })}
      </fieldset>

      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-2 font-mono text-[11px] uppercase tracking-widest text-slate">Contact</legend>
        {text("personal_phone", "Mobile number", { maxLength: 40, inputMode: "tel", placeholder: "+263 77 000 0000" })}
        {text("personal_email", "Personal email", { maxLength: 255, type: "email" })}
        <div className="sm:col-span-2">
          <Field label="Home address">
            <textarea className={`${inputClass} min-h-20`} value={draft.home_address ?? ""} onChange={(e) => set("home_address", e.target.value)} disabled={!editable} maxLength={1000} />
          </Field>
        </div>
      </fieldset>

      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-2 font-mono text-[11px] uppercase tracking-widest text-slate">Next of kin</legend>
        <Field label="Name"><input className={inputClass} value={draft.emergency_contact?.name ?? ""} onChange={(e) => setContact("name", e.target.value)} disabled={!editable} maxLength={160} /></Field>
        <Field label="Relationship"><input className={inputClass} value={draft.emergency_contact?.relationship ?? ""} onChange={(e) => setContact("relationship", e.target.value)} disabled={!editable} maxLength={80} placeholder="Spouse, parent…" /></Field>
        <Field label="Phone"><input className={inputClass} value={draft.emergency_contact?.phone ?? ""} onChange={(e) => setContact("phone", e.target.value)} disabled={!editable} maxLength={40} inputMode="tel" /></Field>
        <Field label="Address"><input className={inputClass} value={draft.emergency_contact?.address ?? ""} onChange={(e) => setContact("address", e.target.value)} disabled={!editable} maxLength={500} /></Field>
      </fieldset>

      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-2 font-mono text-[11px] uppercase tracking-widest text-slate">Qualifications</legend>
        {text("highest_qualification", "Highest qualification", { maxLength: 160, placeholder: "BSc Hons Quantity Surveying" })}
        {text("professional_body", "Professional body", { maxLength: 160, placeholder: "ZIQS, ECZ, ZIE…" })}
        {text("professional_registration_number", "Registration number", { maxLength: 80 })}
      </fieldset>

      {editable && (
        <div className="flex justify-end">
          <button className={primaryButton} disabled={busy}>{busy ? "Saving…" : "Save personal details"}</button>
        </div>
      )}
    </form>
  );
}
