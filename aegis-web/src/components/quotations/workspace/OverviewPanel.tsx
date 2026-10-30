"use client";

/** Quotation particulars that appear on the client document. */
import React from "react";
import Link from "next/link";

export interface Particulars {
  client_name: string;
  client_email: string;
  project_title: string;
  reference_number: string;
  quote_date: string;
  valid_until_days: number;
  currency: string;
  terms: string;
  programme_weeks: string;
  inclusions: string;
  exclusions: string;
  assumptions: string;
}

interface Props {
  value: Particulars;
  onChange: (patch: Partial<Particulars>) => void;
  readOnly: boolean;
  source: { label: string; href: string | null } | null;
  currencyLocked: boolean;
}

const inputCls = "w-full bg-void border border-ink-mid rounded-sm px-2 py-1.5 text-sm text-paper focus:border-signal focus:outline-none disabled:opacity-70";

export function OverviewPanel({ value, onChange, readOnly, source, currencyLocked }: Props) {
  const text = (label: string, key: keyof Particulars, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="text-xs text-slate block">
      {label}
      <input className={inputCls} disabled={readOnly} value={String(value[key] ?? "")} onChange={(e) => onChange({ [key]: e.target.value } as Partial<Particulars>)} {...props} />
    </label>
  );
  const area = (label: string, key: keyof Particulars, hint: string) => (
    <label className="text-xs text-slate block">
      {label}
      <textarea className={inputCls} rows={4} disabled={readOnly} value={String(value[key] ?? "")} onChange={(e) => onChange({ [key]: e.target.value } as Partial<Particulars>)} />
      <span className="text-[11px] text-slate/80">{hint}</span>
    </label>
  );
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="border border-ink-mid rounded-sm bg-ink p-4 space-y-3">
        <h2 className="text-sm font-semibold text-paper">Quotation</h2>
        {source && (
          <p className="text-xs text-slate">Source: {source.href ? <Link className="text-signal hover:underline" href={source.href}>{source.label}</Link> : source.label}</p>
        )}
        <div className="grid sm:grid-cols-2 gap-3">
          {text("Client", "client_name", { required: true })}
          {text("Client email", "client_email", { type: "email" })}
          <div className="sm:col-span-2">{text("Project / works title", "project_title")}</div>
          {text("Reference", "reference_number")}
          {text("Quote date", "quote_date", { type: "date" })}
          <label className="text-xs text-slate block">Valid for (days)
            <input className={inputCls} type="number" min={1} disabled={readOnly} value={value.valid_until_days} onChange={(e) => onChange({ valid_until_days: Math.max(1, Number(e.target.value) || 30) })} />
          </label>
          <label className="text-xs text-slate block">Currency
            <select className={inputCls} disabled={readOnly || currencyLocked} value={value.currency} onChange={(e) => onChange({ currency: e.target.value })}>
              {["USD", "ZWG", "ZAR"].map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            {currencyLocked && <span className="text-[11px] text-slate/80">Fixed once a revision is issued.</span>}
          </label>
          {text("Programme / duration (weeks)", "programme_weeks", { inputMode: "numeric" })}
        </div>
        {area("Payment terms", "terms", "Printed on the client quotation.")}
      </section>
      <section className="border border-ink-mid rounded-sm bg-ink p-4 space-y-3">
        <h2 className="text-sm font-semibold text-paper">Scope qualifications</h2>
        {area("Inclusions", "inclusions", "One per line.")}
        {area("Exclusions", "exclusions", "One per line. Excluded work is never priced.")}
        {area("Assumptions", "assumptions", "One per line.")}
      </section>
    </div>
  );
}
