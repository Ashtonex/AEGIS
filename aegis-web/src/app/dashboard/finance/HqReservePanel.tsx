"use client";

import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import { getHqReserve, saveHqReserveSettings, syncHqReserve } from "@/lib/api";

type RecordData = Record<string, any>;
type Override = { key: string; project_id: string; rate_pct: string; note: string };

const inputClass = "w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50";
const buttonClass = "inline-flex items-center justify-center gap-2 bg-signal text-ink font-semibold px-3 py-2 rounded-sm text-sm hover:bg-signal/95 disabled:opacity-50";
const ghostClass = "inline-flex items-center justify-center gap-2 border border-ink-mid text-paper px-3 py-2 rounded-sm text-sm hover:border-signal/50 disabled:opacity-50";
const cardClass = "bg-ink-light border border-ink-mid rounded-lg";

function money(value: unknown) {
  const n = Number(value);
  return new Intl.NumberFormat("en-ZW", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(Number.isFinite(n) ? n : 0);
}

function monthLabel(value: string) {
  const d = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
}

function pct(value: unknown) {
  const n = Number(value);
  return `${Number.isFinite(n) ? Number(n.toFixed(2)) : 0}%`;
}

function errorText(e: unknown, fallback: string) {
  return e instanceof Error ? e.message : fallback;
}

function Tile({ label, value, hint, warn }: { label: string; value: string; hint?: string; warn?: boolean }) {
  return (
    <div className={`${cardClass} p-3`}>
      <p className="text-[10px] font-mono uppercase tracking-wider text-slate">{label}</p>
      <p className={`text-lg font-semibold font-mono mt-1 ${warn ? "text-amber-300" : "text-paper"}`}>{value}</p>
      {hint && <p className="text-[11px] text-slate mt-0.5">{hint}</p>}
    </div>
  );
}

/**
 * HQ office reserve: every project pays a percentage of its client receipts
 * into a reserve for head-office purchases. Each month's share is an internal
 * charge (Dr 5970 on the project, Cr 6990 HQ recovery), so company profit is
 * unchanged and each project's margin carries its share of head office.
 * Office expense vouchers draw the reserve down.
 */
export function HqReservePanel({ projects }: { projects: RecordData[] }) {
  const [data, setData] = useState<RecordData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"save" | "sync" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [active, setActive] = useState(false);
  const [rate, setRate] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [dirty, setDirty] = useState(false);

  const adopt = useCallback((next: RecordData) => {
    setData(next);
    const s = next.settings || {};
    setActive(Boolean(s.is_active));
    setRate(String(Number(s.default_rate_pct ?? 0)));
    setStartsOn(String(s.starts_on || "").slice(0, 10));
    setOverrides((s.project_rates || []).map((r: RecordData) => ({
      key: String(r.project_id), project_id: String(r.project_id), rate_pct: String(Number(r.rate_pct)), note: r.note || "",
    })));
    setDirty(false);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getHqReserve();
      adopt(res.data);
    } catch (e) {
      setError(errorText(e, "The HQ reserve did not load."));
    } finally {
      setLoading(false);
    }
  }, [adopt]);

  useEffect(() => { void load(); }, [load]);

  const edit = <T,>(setter: (v: T) => void) => (v: T) => { setter(v); setDirty(true); };

  const save = async () => {
    setError(null);
    setNotice(null);
    const rateNum = Number(rate);
    if (!Number.isFinite(rateNum) || rateNum < 0 || rateNum > 100) { setError("The rate must be between 0 and 100%."); return; }
    if (!startsOn) { setError("Pick the date the reserve starts from."); return; }
    const rows = overrides.filter((o) => o.project_id);
    for (const o of rows) {
      const n = Number(o.rate_pct);
      if (o.rate_pct === "" || !Number.isFinite(n) || n < 0 || n > 100) { setError("Each project rate must be between 0 and 100%."); return; }
    }
    if (new Set(rows.map((o) => o.project_id)).size !== rows.length) { setError("A project is listed twice."); return; }
    setBusy("save");
    try {
      const res = await saveHqReserveSettings({
        is_active: active, default_rate_pct: rateNum, starts_on: startsOn,
        project_rates: rows.map((o) => ({ project_id: o.project_id, rate_pct: Number(o.rate_pct), note: o.note || null })),
      });
      adopt(res.data);
      const c = res.data?.counts || {};
      setNotice(active
        ? `Saved. ${c.posted ?? 0} month${c.posted === 1 ? "" : "s"} posted${c.blocked ? `, ${c.blocked} in a closed period left as they were` : ""}.`
        : "Saved. The reserve is off - receipts no longer add to it.");
    } catch (e) {
      setError(errorText(e, "Settings were not saved."));
    } finally {
      setBusy(null);
    }
  };

  const bringUpToDate = async () => {
    setError(null);
    setNotice(null);
    setBusy("sync");
    try {
      const res = await syncHqReserve();
      adopt(res.data);
      const c = res.data?.counts || {};
      setNotice(`Up to date. ${c.posted ?? 0} month${c.posted === 1 ? "" : "s"} posted, ${c.unchanged ?? 0} unchanged${c.blocked ? `, ${c.blocked} blocked by a closed period` : ""}.`);
    } catch (e) {
      setError(errorText(e, "The reserve could not be brought up to date."));
    } finally {
      setBusy(null);
    }
  };

  const totals = data?.totals || {};
  const byProject: RecordData[] = data?.by_project || [];
  const byMonth: RecordData[] = data?.by_month || [];
  const blocked: RecordData[] = useMemo(() => (data?.contributions || []).filter((c: RecordData) => c.blocked_reason), [data]);
  const projectOptions = useMemo(
    () => [...projects].sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""))),
    [projects],
  );
  const saved = data?.settings || {};

  if (loading && !data) {
    return <div className="flex items-center gap-2 text-slate text-sm p-6"><Loader2 className="h-4 w-4 animate-spin" />Loading the HQ reserve...</div>;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <h2 className="text-lg font-semibold text-paper">HQ office reserve</h2>
          <p className="text-sm text-slate mt-1">
            Every project pays a share of what its client pays into a reserve for head-office purchases. Each month the
            share is charged to the project (account 5970, shown as overhead in its budget vs actual) and credited to HQ
            (6990), so company profit does not change - no money moves between bank accounts. Office expense vouchers
            draw the reserve down.
          </p>
        </div>
        <button className={ghostClass} onClick={() => void bringUpToDate()} disabled={busy !== null || !saved.is_active}
          title={saved.is_active ? "Re-work every month from the receipts in the books" : "Switch the reserve on first"}>
          {busy === "sync" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Bring up to date
        </button>
      </div>

      {error && <div className="border border-red-500/40 bg-red-500/10 text-red-200 text-sm rounded px-3 py-2">{error}</div>}
      {notice && <div className="border border-signal/40 bg-signal/10 text-paper text-sm rounded px-3 py-2">{notice}</div>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label="Contributed by projects" value={money(totals.contributed)}
          hint={saved.is_active ? `${pct(saved.default_rate_pct)} of client receipts` : "reserve is off"} />
        <Tile label="Spent on the office" value={money(totals.spent)} hint="office expense vouchers since the start date" />
        <Tile label="Available" value={money(totals.available)} hint="contributed less spent" warn={Number(totals.available) < 0} />
        <Tile label="Months held up" value={String(totals.blocked ?? 0)} hint="accounting period closed" warn={Number(totals.blocked) > 0} />
      </div>

      <section className={`${cardClass} p-4 space-y-4`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-paper">How projects pay in</h3>
          <label className="inline-flex items-center gap-2 text-sm text-paper cursor-pointer">
            <input type="checkbox" checked={active} onChange={(e) => edit(setActive)(e.target.checked)} className="h-4 w-4 accent-signal" />
            Reserve is on
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="text-xs text-slate space-y-1">
            <span>Share of each client receipt (%)</span>
            <input className={inputClass} type="number" min="0" max="100" step="0.01" value={rate}
              onChange={(e) => edit(setRate)(e.target.value)} />
          </label>
          <label className="text-xs text-slate space-y-1">
            <span>Count receipts from</span>
            <input className={inputClass} type="date" value={startsOn} onChange={(e) => edit(setStartsOn)(e.target.value)} />
          </label>
        </div>
        <p className="text-[11px] text-slate">
          A rate change applies from the current month on; earlier months keep the rate they were worked out with.
          Receipts are counted when they are recorded on a project or tagged to one on the bank statement - invoicing a
          claim is not a receipt.
        </p>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-paper">Projects on a different rate</p>
            <button className={ghostClass} onClick={() => edit(setOverrides)([...overrides, { key: Math.random().toString(36), project_id: "", rate_pct: "0", note: "" }])}>
              <Plus className="h-4 w-4" />Add project
            </button>
          </div>
          {overrides.length === 0 ? (
            <p className="text-xs text-slate">Every project pays the rate above. Add a project here to give it its own rate (0% leaves it out).</p>
          ) : (
            <div className="space-y-2">
              {overrides.map((o, i) => (
                <div key={o.key} className="grid gap-2 sm:grid-cols-[1fr_120px_1fr_auto] items-center">
                  <select className={inputClass} value={o.project_id} aria-label="Project"
                    onChange={(e) => edit(setOverrides)(overrides.map((x, j) => (j === i ? { ...x, project_id: e.target.value } : x)))}>
                    <option value="">Choose a project</option>
                    {projectOptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <input className={inputClass} type="number" min="0" max="100" step="0.01" value={o.rate_pct} aria-label="Rate %"
                    onChange={(e) => edit(setOverrides)(overrides.map((x, j) => (j === i ? { ...x, rate_pct: e.target.value } : x)))} />
                  <input className={inputClass} placeholder="Why (optional)" value={o.note} aria-label="Note"
                    onChange={(e) => edit(setOverrides)(overrides.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))} />
                  <button className="text-slate hover:text-red-300 p-2" aria-label="Remove"
                    onClick={() => edit(setOverrides)(overrides.filter((_, j) => j !== i))}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          <button className={buttonClass} onClick={() => void save()} disabled={busy !== null || !dirty}>
            {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Save
          </button>
          {dirty && <span className="text-xs text-amber-300">Unsaved changes</span>}
        </div>
      </section>

      {blocked.length > 0 && (
        <section className="border border-amber-500/40 bg-amber-500/10 rounded-lg p-4 space-y-2">
          <p className="text-sm text-amber-200 flex items-center gap-2"><AlertTriangle className="h-4 w-4" />
            These months changed but sit in a closed accounting period, so they were left as they were. Reopen the period
            and press Bring up to date.</p>
          <ul className="text-xs text-paper space-y-1">
            {blocked.map((c) => <li key={c.id}>{c.project_name} - {monthLabel(c.month)}: {c.blocked_reason}</li>)}
          </ul>
        </section>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <TableCard title="By project" empty="No contributions yet." rows={byProject.length}>
          <thead><tr className="text-left text-[10px] font-mono uppercase tracking-wider text-slate">
            <th className="p-2">Project</th><th className="p-2 text-right">Client receipts</th><th className="p-2 text-right">Contributed</th>
          </tr></thead>
          <tbody>
            {byProject.map((p) => (
              <tr key={p.project_id} className="border-t border-ink-mid">
                <td className="p-2 text-paper">{p.project_name}</td>
                <td className="p-2 text-right font-mono text-slate-light">{money(p.receipts)}</td>
                <td className="p-2 text-right font-mono text-paper">{money(p.contributed)}</td>
              </tr>
            ))}
          </tbody>
        </TableCard>

        <TableCard title="By month" empty="Nothing in the reserve yet." rows={byMonth.length}>
          <thead><tr className="text-left text-[10px] font-mono uppercase tracking-wider text-slate">
            <th className="p-2">Month</th><th className="p-2 text-right">Receipts</th><th className="p-2 text-right">In</th><th className="p-2 text-right">Spent</th>
          </tr></thead>
          <tbody>
            {byMonth.map((m) => (
              <tr key={m.month} className="border-t border-ink-mid">
                <td className="p-2 text-paper">{monthLabel(m.month)}</td>
                <td className="p-2 text-right font-mono text-slate-light">{money(m.receipts)}</td>
                <td className="p-2 text-right font-mono text-paper">{money(m.contributed)}</td>
                <td className="p-2 text-right font-mono text-paper">{money(m.spent)}</td>
              </tr>
            ))}
          </tbody>
        </TableCard>
      </div>
    </div>
  );
}

function TableCard({ title, empty, rows, children }: { title: string; empty: string; rows: number; children: React.ReactNode }) {
  return (
    <section className={`${cardClass} p-4`}>
      <h3 className="text-sm font-semibold text-paper mb-2">{title}</h3>
      {rows === 0 ? <p className="text-xs text-slate">{empty}</p> : (
        <div className="overflow-x-auto"><table className="w-full text-sm">{children}</table></div>
      )}
    </section>
  );
}
