"use client";

import { useRef, useState } from "react";
import { workforceFoundation } from "@/lib/api";

export default function WorkerPicker({ name, label }: { name: string; label: string }) {
  const [query, setQuery] = useState("");
  const [choices, setChoices] = useState<{ id: string; employee_name: string; employee_number: string | null }[]>([]);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const control = "min-h-11 w-full border border-ink-mid bg-ink-light px-3 py-2 text-sm text-paper";

  async function search() {
    const current = ++generation.current;
    setBusy(true); setError(""); setSelected("");
    try {
      const result = await workforceFoundation<typeof choices>(`people?${new URLSearchParams({ q: query, limit: "20", status: "active" })}`);
      if (current === generation.current) setChoices(result.data);
    } catch (reason) {
      if (current === generation.current) { setChoices([]); setError(reason instanceof Error ? reason.message : "Worker search unavailable."); }
    } finally { if (current === generation.current) setBusy(false); }
  }

  return <div className="space-y-2">
    <label className="grid gap-1 text-sm text-slate-light"><span>Search {label.toLowerCase()}</span><input className={control} value={query} maxLength={160} onChange={event => setQuery(event.target.value)} /></label>
    <button className="min-h-11 border border-ink-mid px-3 text-sm text-signal disabled:opacity-40" type="button" disabled={busy} onClick={() => void search()}>{busy ? "Searching…" : "Find workers"}</button>
    <label className="grid gap-1 text-sm text-slate-light"><span>{label}</span><select className={control} required name={name} value={selected} onChange={event => setSelected(event.target.value)}><option value="">Select from search results</option>{choices.map(worker => <option key={worker.id} value={worker.id}>{worker.employee_name} · {worker.employee_number || "No number"}</option>)}</select></label>
    <p className="text-xs text-slate-light">Up to 20 matching active workers. Refine the search if needed.</p>
    {error && <p role="alert" className="text-sm text-red-200">{error}</p>}
  </div>;
}
