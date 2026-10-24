"use client";

import { useEffect, useMemo, useState } from "react";
import { FileUp, ListPlus, Loader2, Upload, X } from "lucide-react";
import { createProcurementRequisition, extractMaterialsListText, getProjectMaterialsStatus, type ProjectMaterialStatus } from "@/lib/api";
import { type Rec, Banner, money, normalizeActionError, num, tx } from "@/components/procurement/shared";
import { parseMaterialsList, type ParseResult } from "@/components/procurement/materials";

type DraftLine = { include: boolean; description: string; qty: string; uom: string; unit_cost: string };

const inputClass = "h-9 w-full border border-ink-mid bg-ink-light px-2 text-sm text-paper";

function projectLabel(p: Rec) {
  return tx(p.name ?? p.project_name ?? p.project_code, p.id);
}

/** Paste or upload a materials list, review the parsed lines, create a purchase request. */
export function ImportListModal({
  projects,
  onClose,
  onCreated,
}: {
  projects: Rec[];
  onClose: () => void;
  onCreated: (requisitionId: string, number: string) => void;
}) {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [form, setForm] = useState({ project_id: "", priority: "normal", required_by_date: "", justification: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const readFile = async (file: File) => {
    setReading(true);
    setError(null);
    try {
      const extracted = file.name.toLowerCase().endsWith(".pdf") ? await extractMaterialsListText(file) : await file.text();
      setText(extracted);
      setFileName(file.name);
    } catch (e) {
      setError(normalizeActionError(e, "Could not read that file - paste the list instead."));
    } finally {
      setReading(false);
    }
  };

  const review = () => {
    const result = parseMaterialsList(text);
    setParsed(result);
    setLines(result.lines.map((l) => ({ include: true, description: l.description, qty: String(l.qty), uom: l.uom, unit_cost: "" })));
    setForm((f) => ({ ...f, justification: f.justification || `Materials list${fileName ? ` (${fileName})` : ""} - ${result.lines.length} items` }));
    if (!result.lines.length) setError("No materials with quantities were found. Check the list has one item per line with a quantity.");
    else setError(null);
  };

  const chosen = lines.filter((l) => l.include);
  const total = chosen.reduce((sum, l) => sum + num(l.qty) * num(l.unit_cost), 0);
  const setLine = (i: number, patch: Partial<DraftLine>) => setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const create = async () => {
    if (!form.required_by_date) return setError("Pick the date the materials are needed by.");
    if (!chosen.length) return setError("Tick at least one line to request.");
    const bad = chosen.find((l) => !l.description.trim() || num(l.qty) <= 0);
    if (bad) return setError(`"${bad.description || "A line"}" needs a description and a quantity above zero.`);
    setSaving(true);
    setError(null);
    try {
      const response = await createProcurementRequisition({
        project_id: form.project_id || null,
        priority: form.priority,
        required_by_date: form.required_by_date,
        justification: form.justification || null,
        line_items: chosen.map((l) => ({ description: l.description.trim(), qty: num(l.qty), uom: (l.uom || "each").slice(0, 40), unit_cost: num(l.unit_cost) })),
      });
      onCreated(String(response.data?.id ?? ""), String(response.data?.requisition_number ?? ""));
    } catch (e) {
      setError(normalizeActionError(e, "Could not create the purchase request."));
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm">
      <aside className="ml-auto flex h-full w-full max-w-4xl flex-col overflow-y-auto border-l border-ink-mid bg-ink text-paper shadow-2xl">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-ink-mid bg-ink p-5">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-signal">Import materials list</p>
            <h2 className="mt-1 text-lg font-semibold">{parsed ? "Check the lines, then create the request" : "Paste the list or upload it"}</h2>
          </div>
          <button onClick={onClose} className="border border-ink-mid p-2 text-slate-light hover:border-signal hover:text-paper"><X className="h-5 w-5" /></button>
        </header>

        <div className="flex-1 space-y-5 p-5">
          {error && <Banner tone="error" message={error} />}

          {!parsed && (
            <>
              <label className="flex cursor-pointer items-center gap-3 border border-dashed border-ink-mid bg-ink-light/30 p-4 hover:border-signal">
                {reading ? <Loader2 className="h-5 w-5 animate-spin text-signal" /> : <Upload className="h-5 w-5 text-signal" />}
                <span className="text-sm text-slate-light">
                  {fileName ? <>Loaded <b className="text-paper">{fileName}</b> - you can edit the text below.</> : "Upload a PDF, TXT or CSV materials list"}
                </span>
                <input type="file" accept=".pdf,.txt,.csv,application/pdf,text/plain,text/csv" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void readFile(f); e.target.value = ""; }} />
              </label>
              <div>
                <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate">Or paste it - one item per line, with its quantity</label>
                <textarea value={text} onChange={(e) => setText(e.target.value)} rows={14}
                  placeholder={"Gum poles 6mx150 dia. – 216\nWire nails 4 inch – 80kg\nCement 42.5 – 120 bags"}
                  className="w-full resize-y border border-ink-mid bg-ink-light p-3 font-mono text-xs text-paper" />
              </div>
              <div className="flex justify-end">
                <button onClick={review} disabled={!text.trim() || reading}
                  className="inline-flex h-10 items-center gap-2 bg-signal px-4 font-mono text-xs font-bold uppercase tracking-wider text-ink disabled:opacity-40">
                  <ListPlus className="h-4 w-4" />Read the list
                </button>
              </div>
            </>
          )}

          {parsed && (
            <>
              <section className="border border-ink-mid">
                <header className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-mid bg-ink-light/40 px-3 py-2">
                  <p className="font-mono text-[10px] uppercase tracking-widest text-signal">{chosen.length} of {lines.length} lines will be requested</p>
                  <button onClick={() => setParsed(null)} className="font-mono text-[10px] uppercase text-slate-light hover:text-paper">Edit the text again</button>
                </header>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-sm">
                    <thead>
                      <tr className="border-b border-ink-mid text-left">
                        {["", "Description", "Qty", "Unit", "Unit cost (optional)"].map((h) => (
                          <th key={h} className="px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-slate">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ink-mid">
                      {lines.map((line, i) => (
                        <tr key={i} className={line.include ? "" : "opacity-40"}>
                          <td className="w-8 px-3 py-1.5"><input type="checkbox" checked={line.include} onChange={(e) => setLine(i, { include: e.target.checked })} /></td>
                          <td className="px-3 py-1.5"><input value={line.description} onChange={(e) => setLine(i, { description: e.target.value })} className={inputClass} /></td>
                          <td className="w-24 px-3 py-1.5"><input value={line.qty} inputMode="decimal" onChange={(e) => setLine(i, { qty: e.target.value })} className={`${inputClass} text-right font-mono`} /></td>
                          <td className="w-24 px-3 py-1.5"><input value={line.uom} onChange={(e) => setLine(i, { uom: e.target.value })} className={inputClass} /></td>
                          <td className="w-32 px-3 py-1.5"><input value={line.unit_cost} inputMode="decimal" placeholder="price later" onChange={(e) => setLine(i, { unit_cost: e.target.value })} className={`${inputClass} text-right font-mono`} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {parsed.skipped.length > 0 && (
                  <details className="border-t border-ink-mid px-3 py-2">
                    <summary className="cursor-pointer font-mono text-[10px] uppercase text-slate-light">Not imported ({parsed.skipped.length}) - headings, notes and price/labour lines</summary>
                    <ul className="mt-2 space-y-1 text-xs text-slate-light">
                      {parsed.skipped.map((s, i) => <li key={i}><span className="text-slate">[{s.reason}]</span> {s.text}</li>)}
                    </ul>
                  </details>
                )}
              </section>

              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate">Project</label>
                  <select value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })} className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper">
                    <option value="">Not project-specific</option>
                    {projects.map((p) => <option key={p.id} value={p.id}>{projectLabel(p)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate">Needed by *</label>
                  <input type="date" value={form.required_by_date} onChange={(e) => setForm({ ...form, required_by_date: e.target.value })} className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
                </div>
                <div>
                  <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate">Priority</label>
                  <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper">
                    <option value="low">Low</option><option value="normal">Normal</option><option value="urgent">Urgent</option><option value="emergency">Emergency</option>
                  </select>
                </div>
                <div className="sm:col-span-3">
                  <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate">Why it is needed</label>
                  <input value={form.justification} onChange={(e) => setForm({ ...form, justification: e.target.value })} className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
                </div>
              </div>
            </>
          )}
        </div>

        {parsed && (
          <footer className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-ink-mid bg-ink p-4">
            <p className="text-xs text-slate-light">
              {total > 0 ? <>Estimated total <b className="font-mono text-paper">{money(total)}</b></> : "No prices yet - they can be confirmed before the PO."} The request is saved as a draft for you to submit.
            </p>
            <button onClick={() => void create()} disabled={saving || !chosen.length}
              className="inline-flex h-10 items-center gap-2 bg-signal px-4 font-mono text-xs font-bold uppercase tracking-wider text-ink disabled:opacity-40">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}Create purchase request
            </button>
          </footer>
        )}
      </aside>
    </div>
  );
}

/** Per material on one project: requested, ordered, delivered, still needed. */
export function ProjectMaterialsModal({ projects, initialProjectId, onClose }: { projects: Rec[]; initialProjectId?: string; onClose: () => void }) {
  const [projectId, setProjectId] = useState(initialProjectId ?? "");
  const [rows, setRows] = useState<ProjectMaterialStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [onlyGaps, setOnlyGaps] = useState(false);

  useEffect(() => {
    if (!projectId) { setRows([]); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    getProjectMaterialsStatus(projectId)
      .then((res) => { if (!cancelled) setRows(Array.isArray(res.data) ? res.data : []); })
      .catch((e) => { if (!cancelled) setError(normalizeActionError(e, "Could not load the project's materials.")); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId]);

  const shown = useMemo(() => (onlyGaps ? rows.filter((r) => num(r.to_order_qty) > 0 || num(r.to_deliver_qty) > 0) : rows), [rows, onlyGaps]);
  const fmt = (v: unknown) => new Intl.NumberFormat("en-ZW", { maximumFractionDigits: 3 }).format(num(v));

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm">
      <aside className="ml-auto flex h-full w-full max-w-5xl flex-col overflow-y-auto border-l border-ink-mid bg-ink text-paper shadow-2xl">
        <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-ink-mid bg-ink p-5">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-signal">Materials by project</p>
            <h2 className="mt-1 text-lg font-semibold">Requested vs ordered vs delivered</h2>
          </div>
          <div className="flex items-center gap-2">
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="h-9 border border-ink-mid bg-ink-light px-3 text-sm text-paper">
              <option value="">Choose a project…</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{projectLabel(p)}</option>)}
            </select>
            <button onClick={onClose} className="border border-ink-mid p-2 text-slate-light hover:border-signal hover:text-paper"><X className="h-5 w-5" /></button>
          </div>
        </header>
        <div className="space-y-3 p-5">
          {error && <Banner tone="error" message={error} />}
          <p className="text-xs text-slate-light">
            Items are matched on their description, so a purchase order raised from a request lines up with it.
            Different wording for the same material shows as separate rows.
          </p>
          {projectId && (
            <label className="inline-flex items-center gap-2 text-xs text-slate-light">
              <input type="checkbox" checked={onlyGaps} onChange={(e) => setOnlyGaps(e.target.checked)} />Only items still to order or deliver
            </label>
          )}
          {loading ? (
            <p className="flex items-center gap-2 text-sm text-slate-light"><Loader2 className="h-4 w-4 animate-spin" />Loading…</p>
          ) : projectId && !shown.length ? (
            <p className="text-sm text-slate-light">No materials requested or ordered for this project yet.</p>
          ) : shown.length > 0 && (
            <div className="overflow-x-auto border border-ink-mid">
              <table className="w-full min-w-[880px] text-sm">
                <thead>
                  <tr className="border-b border-ink-mid bg-ink-light/50 text-left">
                    {["Material", "Unit", "Requested", "Ordered", "Delivered", "Still to order", "Still to deliver", "On"].map((h) => (
                      <th key={h} className="px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-slate">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-mid">
                  {shown.map((r, i) => (
                    <tr key={`${r.description}-${i}`}>
                      <td className="px-3 py-2 text-paper">{r.description}</td>
                      <td className="px-3 py-2 text-slate-light">{r.uom}</td>
                      <td className="px-3 py-2 text-right font-mono">{fmt(r.requested_qty)}</td>
                      <td className="px-3 py-2 text-right font-mono">{fmt(r.ordered_qty)}</td>
                      <td className="px-3 py-2 text-right font-mono">{fmt(r.received_qty)}</td>
                      <td className={`px-3 py-2 text-right font-mono ${num(r.to_order_qty) > 0 ? "text-amber-300" : "text-slate"}`}>{fmt(r.to_order_qty)}</td>
                      <td className={`px-3 py-2 text-right font-mono ${num(r.to_deliver_qty) > 0 ? "text-amber-300" : "text-slate"}`}>{fmt(r.to_deliver_qty)}</td>
                      <td className="px-3 py-2 font-mono text-[10px] text-slate-light">{[...(r.requests ?? []), ...(r.orders ?? [])].join(", ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
