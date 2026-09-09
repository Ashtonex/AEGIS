"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ApiError, complianceFoundation } from "@/lib/api";

type Row = { id: string; version: number; title?: string; name?: string; code?: string; status?: string; revision?: number; created_by?: string; owner_id?: string; approval_id?: string; [key: string]: unknown };
type Context = { organization_id: string; user_id: string; permissions: string[]; conflicts: string[] };
type Field = { name: string; label: string; type?: string; choices?: { value: string; label: string }[]; optional?: boolean };
const tabs = ["obligation-versions", "domains", "authorities", "sources", "applicability-assessments", "assignments", "scope-grants"] as const;
const labels: Record<string, string> = { "obligation-versions": "Obligations", domains: "Domains", authorities: "Authorities", sources: "Sources", "applicability-assessments": "Applicability", assignments: "Assignments", "scope-grants": "Project access" };
const base = "rounded-lg border border-slate-600 bg-slate-950 p-2 text-sm text-white";

export default function ComplianceFoundation() {
  const [context, setContext] = useState<Context | null>(null);
  const [tab, setTab] = useState<string>("obligation-versions");
  const [rows, setRows] = useState<Row[]>([]);
  const [catalogues, setCatalogues] = useState<Record<string, Row[]>>({});
  const [selected, setSelected] = useState<Row | null>(null);
  const [history, setHistory] = useState<Row[] | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [denied, setDenied] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [action, setAction] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const replay = useRef<{ signature: string; key: string } | null>(null);
  const loadSequence = useRef(0);
  const can = (capability: string) => context?.permissions.includes(`compliance.foundation.${capability}`) ?? false;
  const fail = (e: unknown) => { setError(e instanceof Error ? e.message : "Unable to load compliance records."); setDenied(e instanceof ApiError && e.status === 403); };

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true); setError(""); setDenied(false); setSelected(null); setHistory(null);
    try {
      const [ctx, register] = await Promise.all([
        complianceFoundation<Context>("context"),
        complianceFoundation<Row[]>(`${tab}?q=${encodeURIComponent(q)}${filter ? `&status=${filter}` : ""}`),
      ]);
      if (sequence !== loadSequence.current) return;
      setContext(ctx.data); setRows(register.data); setCursor(register.meta.next_cursor ?? null);
    } catch (e) { if (sequence === loadSequence.current) fail(e); }
    finally { if (sequence === loadSequence.current) setLoading(false); }
  }, [tab, q, filter]);
  useEffect(() => { const timer = setTimeout(() => { void load(); }, 250); return () => clearTimeout(timer); }, [load]);

  async function prepare(kind: string) {
    setError(""); setBusy(true);
    try {
      const kinds = ["domains", "authorities", "sources", "obligation-versions", "applicability-assessments"];
      const entries = await Promise.all(kinds.map(async k => [k, (await complianceFoundation<Row[]>(`${k}?limit=200`)).data] as const));
      setCatalogues(Object.fromEntries(entries));
      const initial: Record<string, string> = { subject_kind: "organisation", subject_id: context?.organization_id ?? "", outcome: "applicable", owner_id: context?.user_id ?? "", subject_kinds: "organisation,project,worker,supplier,subcontractor,asset", requires_legal_review: "true", critical: "false" };
      if (kind === "revision" && selected) {
        for (const [k,v] of Object.entries(selected)) if (typeof v === "string") initial[k] = v;
        const root = await complianceFoundation<Row>(`obligations/${selected.obligation_id}`);
        initial.code = String(root.data.code); initial.domain_id = String(root.data.domain_id);
        const rule = selected.rule as { subject_kinds: string[]; jurisdiction: string; requires_legal_review: boolean; critical: boolean };
        initial.subject_kinds = rule.subject_kinds.join(","); initial.jurisdiction = rule.jurisdiction;
        initial.requires_legal_review = String(rule.requires_legal_review); initial.critical = String(rule.critical);
      }
      setDraft(initial); setForm(kind);
    } catch(e) { fail(e); } finally { setBusy(false); }
  }

  const choices = (kind: string) => (catalogues[kind] ?? []).map(r => ({ value: r.id, label: `${r.title ?? r.name ?? r.code ?? r.id} (${r.status ?? "registered"})` }));
  const obligationFields: Field[] = [
    {name:"code",label:"Register code"},{name:"domain_id",label:"Domain",choices:choices("domains")},
    {name:"source_id",label:"Verified source",choices:choices("sources")},{name:"title",label:"Obligation title"},
    {name:"requirement",label:"Required outcome",type:"textarea"},{name:"owner_id",label:"Accountable user ID"},
    {name:"jurisdiction",label:"Jurisdiction (must match source)"},{name:"effective_from",label:"Effective from",type:"date"},
    {name:"effective_to",label:"Effective until (exclusive)",type:"date",optional:true},{name:"review_on",label:"Review date",type:"date"},
    {name:"subject_kinds",label:"Subject kinds, separated by commas"},
    {name:"requires_legal_review",label:"Legal review required",choices:[{value:"true",label:"Yes"},{value:"false",label:"No interpretation required"}]},
    {name:"critical",label:"Critical requirement",choices:[{value:"false",label:"No"},{value:"true",label:"Yes"}]},
  ];
  const fields: Field[] = form === "domains" || form === "authorities" ? [{name:"code",label:"Code"},{name:"name",label:"Name"},{name:"jurisdiction",label:"Jurisdiction"}]
    : form === "sources" ? [{name:"authority_id",label:"Authority",choices:choices("authorities")},{name:"title",label:"Source title"},{name:"citation",label:"Authoritative citation / reference",type:"textarea"},{name:"jurisdiction",label:"Jurisdiction"},{name:"effective_from",label:"Effective from",type:"date"},{name:"review_on",label:"Review date",type:"date"}]
    : form === "obligation-versions" || form === "revision" ? [...obligationFields, ...(form === "revision" ? [{name:"reason",label:"Revision reason",type:"textarea"}] : [])]
    : form === "applicability-assessments" ? [{name:"obligation_version_id",label:"Active obligation version",choices:choices("obligation-versions")},{name:"subject_kind",label:"Subject kind",choices:["organisation","project","worker","supplier","subcontractor","asset"].map(v=>({value:v,label:v}))},{name:"subject_id",label:"Subject ID from the owning module"},{name:"project_id",label:"Project ID (required for project requirements)",optional:true},{name:"outcome",label:"Proposed applicability",choices:[{value:"applicable",label:"Applicable"},{value:"not_applicable",label:"Not applicable — requires independent approval"}]},{name:"reason",label:"Assessment reason",type:"textarea"},{name:"basis",label:"Source-backed assessment basis",type:"textarea"},{name:"review_on",label:"Review date",type:"date"}]
    : form === "assignments" ? [{name:"assessment_id",label:"Approved applicable assessment",choices:choices("applicability-assessments")},{name:"owner_id",label:"Responsible user ID"},{name:"reason",label:"Assignment reason",type:"textarea"}]
    : [{name:"user_id",label:"User ID"},{name:"project_id",label:"Project ID"}];

  async function command(path: string, payload: object) {
    const signature = JSON.stringify({path,payload});
    if (replay.current?.signature !== signature) replay.current = { signature, key: crypto.randomUUID() };
    await complianceFoundation<Row>(path, {key:replay.current.key,payload});
    replay.current = null;
    setNotice("Saved by the server. History and current status updated.");
    setForm(null); setAction(null); setSelected(null); await load();
  }

  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      const payload: Record<string, unknown> = {};
      for (const field of fields) payload[field.name] = draft[field.name] || (field.optional ? null : "");
      let path = form === "domains" || form === "authorities" ? `catalogues/${form}` : form ?? "";
      if (form === "obligation-versions" || form === "revision") {
        payload.rule = { jurisdiction:payload.jurisdiction, subject_kinds:String(payload.subject_kinds).split(",").map(s=>s.trim()), requires_legal_review:payload.requires_legal_review === "true", critical:payload.critical === "true" };
        for (const key of ["jurisdiction","subject_kinds","requires_legal_review","critical"]) delete payload[key];
        path = "obligations";
        if (form === "revision" && selected) { path=`obligation-versions/${selected.id}/revise`; payload.expected_version=selected.version; }
      }
      if (form === "applicability-assessments") path="assessments";
      await command(path,payload);
    } catch(e) { fail(e); } finally { setBusy(false); }
  }

  async function decide(e: FormEvent) {
    e.preventDefault(); if (!selected || !action) return;
    setBusy(true); setError("");
    try {
      const payload: Record<string,unknown> = {expected_version:selected.version,reason};
      let path = `${tab}/${selected.id}/${action}`;
      if (action === "approved" || action === "rejected") { path=`decisions/${tab}/${selected.id}`; payload.decision=action; }
      await command(path,payload);
    } catch(e) { fail(e); } finally { setBusy(false); }
  }

  async function exportRows() {
    setBusy(true); setError("");
    try {
      const result = await complianceFoundation<Row[]>(`exports/${tab}?q=${encodeURIComponent(q)}${filter ? `&status=${filter}` : ""}`);
      const blob = new Blob([JSON.stringify({as_of:new Date().toISOString(), register:tab,records:result.data},null,2)],{type:"application/json"});
      const url=URL.createObjectURL(blob); const link=document.createElement("a"); link.href=url; link.download=`compliance-${tab}.json`; link.click(); URL.revokeObjectURL(url);
    } catch(e) { fail(e); } finally { setBusy(false); }
  }

  const mayCreate = tab === "assignments" ? can("assign") : tab === "scope-grants" ? can("scope.manage") : can("manage");
  return <main className="mx-auto max-w-7xl space-y-5 p-3 text-slate-100 sm:p-6">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-widest text-cyan-300">AEGIS / Compliance control</p><h1 className="text-2xl font-semibold">Obligation register</h1><p className="mt-2 max-w-3xl text-sm text-slate-400">Define what applies, record its source and assign accountability. Active obligations still require evidence of fulfilment. This system does not provide legal advice.</p></div><Link className="text-sm text-cyan-300 underline" href="/dashboard/compliance?tab=employees">Existing credential workspace</Link></header>
    {context?.conflicts.map(message=><p key={message} className="rounded-lg border border-amber-600/40 bg-amber-950/30 p-3 text-sm text-amber-200">{message}</p>)}
    <nav aria-label="Compliance foundation" className="flex flex-wrap gap-2">{tabs.filter(t=>t!=="scope-grants" || can("scope.manage")).map(t=><button key={t} onClick={()=>{setTab(t);setFilter("");setForm(null);setAction(null);}} className={`${base} ${tab===t ? "border-cyan-400 text-cyan-200" : ""}`} aria-current={tab===t?"page":undefined}>{labels[t]}</button>)}</nav>
    <div className="flex flex-wrap gap-2"><label className="flex-1 text-sm">Search<input className={`${base} mt-1 w-full`} value={q} onChange={e=>setQ(e.target.value)} placeholder="Search title, name or ID"/></label><label className="text-sm">Status<select className={`${base} mt-1 block`} value={filter} onChange={e=>setFilter(e.target.value)}><option value="">All statuses</option>{["draft","verified","under_review","applicable","active","superseded","archived","approved","rejected","action_required"].map(s=><option key={s}>{s}</option>)}</select></label><button className={base} onClick={()=>void load()} disabled={busy}>Refresh</button>{mayCreate && <button className={base} disabled={busy} onClick={()=>void prepare(tab)}>Create {labels[tab]}</button>}{can("export") && <button className={base} disabled={busy} onClick={()=>void exportRows()}>Export register</button>}</div>
    {notice && <p role="status" className="text-emerald-300">{notice}</p>}
    {error && <div role="alert" className="rounded-lg border border-red-700 p-4"><strong>{denied?"Permission denied":"Unable to complete request"}</strong><p>{error}</p><button className={`${base} mt-2`} onClick={()=>void load()}>Retry loading</button></div>}
    {loading ? <p role="status" className="animate-pulse p-6">Loading scoped compliance records…</p> : !denied && <section aria-label={labels[tab]} className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{rows.length===0?<p className="p-6 text-slate-400">No records match this scope and filter. Register an authoritative source before creating obligations.</p>:rows.map(r=><button key={r.id} className="rounded-xl border border-slate-700 bg-slate-900/70 p-4 text-left hover:border-cyan-500" onClick={()=>{setSelected(r);setHistory(null);setAction(null);setForm(null);}}><span className="block font-semibold">{r.title ?? r.name ?? r.code ?? String(r.subject_kind ?? "Record")}</span><span className="mt-2 inline-block rounded bg-slate-800 px-2 py-1 text-xs">{r.status?.replaceAll("_"," ") ?? "Registered"}</span><span className="mt-2 block break-all text-xs text-slate-400">{r.id}</span><span className="text-xs text-slate-400">Version {r.version}{r.revision?` · Revision ${r.revision}`:""}</span></button>)}</section>}
    {cursor && !loading && <button className={base} onClick={async()=>{setBusy(true);try {const next=await complianceFoundation<Row[]>(`${tab}?after=${cursor}&q=${encodeURIComponent(q)}${filter?`&status=${filter}`:""}`);setRows(old=>[...old,...next.data]);setCursor(next.meta.next_cursor??null);}catch(e){fail(e);}finally{setBusy(false);}}} disabled={busy}>Load more</button>}
    {selected && <section className="space-y-3 rounded-xl border border-cyan-800 p-4"><div className="flex justify-between"><h2 className="text-lg font-semibold">Record detail</h2><button className={base} onClick={()=>{setSelected(null);setAction(null);}}>Close detail</button></div><dl className="grid gap-2 sm:grid-cols-2">{Object.entries(selected).filter(([k])=>!["organization_id","is_deleted"].includes(k)).map(([k,v])=><div key={k} className="min-w-0"><dt className="text-xs text-slate-400">{k.replaceAll("_"," ")}</dt><dd className="break-words text-sm">{typeof v==="object"?JSON.stringify(v):String(v??"Not recorded")}</dd></div>)}</dl>
      <div className="flex flex-wrap gap-2">
        {tab==="sources" && selected.status==="draft" && can("approve") && selected.created_by!==context?.user_id && <button className={base} onClick={()=>{setAction("verify");setReason("");}}>Verify source</button>}
        {tab==="obligation-versions" && can("manage") && <>{selected.status==="draft" && <button className={base} onClick={()=>{setAction("submit");setReason("");}}>Submit for review</button>}{selected.status==="applicable" && <button className={base} onClick={()=>{setAction("activate");setReason("");}}>Activate approved obligation</button>}{["active","applicable"].includes(selected.status??"") && <button className={base} onClick={()=>{setAction("archive");setReason("");}}>Archive</button>}{!["draft","under_review"].includes(selected.status??"") && <button className={base} onClick={()=>void prepare("revision")}>Create controlled revision</button>}</>}
        {["obligation-versions","applicability-assessments"].includes(tab) && selected.status==="under_review" && (can("approve")||can("legal_review")) && selected.created_by!==context?.user_id && selected.owner_id!==context?.user_id && <>{["approved","rejected"].map(a=><button key={a} className={base} onClick={()=>{setAction(a);setReason("");}}>{a==="approved"?"Approve current stage":"Reject with reason"}</button>)}</>}
        {can("audit.read") && <button className={base} onClick={async()=>{try{setHistory((await complianceFoundation<Row[]>(`${tab}/${selected.id}/history`)).data);}catch(e){fail(e);}}}>Load history</button>}
      </div>
      {history && <div><h3>Audit history</h3>{history.length===0?<p>No history entries are available.</p>:history.map(h=><p key={h.id} className="break-words border-t border-slate-700 py-2 text-sm">{String(h.created_at)} · {String(h.action)} · {JSON.stringify(h.new_data)}</p>)}</div>}
    </section>}
    {action && <form onSubmit={decide} className="space-y-3 rounded-xl border border-amber-700 p-4"><h2 className="font-semibold">{action.replaceAll("_"," ")} — recorded decision</h2><label className="block">Reason<textarea className={`${base} mt-1 w-full`} minLength={10} maxLength={2000} required value={reason} onChange={e=>setReason(e.target.value)}/></label><button className={base} disabled={busy}>{busy?"Saving…":"Confirm decision"}</button><button type="button" className={`${base} ml-2`} onClick={()=>setAction(null)}>Cancel</button></form>}
    {form && <form onSubmit={submit} className="space-y-4 rounded-xl border border-slate-600 bg-slate-900 p-4"><h2 className="text-lg font-semibold">{form==="revision"?"Controlled revision":`Create ${labels[form]}`}</h2><div className="grid gap-3 sm:grid-cols-2">{fields.map(f=><label key={f.name} className="text-sm">{f.label}{f.optional?" (optional)":""}{f.choices?<select className={`${base} mt-1 w-full`} required={!f.optional} value={draft[f.name]??""} onChange={e=>setDraft(d=>({...d,[f.name]:e.target.value}))}><option value="">Choose…</option>{f.choices.map(c=><option key={c.value} value={c.value}>{c.label}</option>)}</select>:f.type==="textarea"?<textarea className={`${base} mt-1 w-full`} required={!f.optional} minLength={10} value={draft[f.name]??""} onChange={e=>setDraft(d=>({...d,[f.name]:e.target.value}))}/>:<input className={`${base} mt-1 w-full`} type={f.type??"text"} required={!f.optional} value={draft[f.name]??""} onChange={e=>setDraft(d=>({...d,[f.name]:e.target.value}))}/>}</label>)}</div><button className={base} disabled={busy}>{busy?"Saving…":"Save to register"}</button><button type="button" className={`${base} ml-2`} onClick={()=>setForm(null)}>Cancel</button></form>}
  </main>;
}
