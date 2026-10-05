"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { BellRing, Loader2, Search, Send } from "lucide-react";
import {
  getExpiryAlertHistory, getFilesOverview, previewExpiryAlerts, runExpiryAlerts,
  type ExpiryRun, type FilesOverview, type FilesOverviewRow,
} from "@/lib/api";
import { DashboardPageHeader } from "@/components/dashboard/DashboardPageHeader";
import { PersonCardModal } from "@/components/people/PersonCardModal";
import { formatDate, humanise, inputClass, secondaryButton } from "@/components/people/ui";

type Kind = "contracts" | "credentials" | "assets";

const COPY: Record<Kind, { title: string; subtitle: string }> = {
  contracts: {
    title: "Contracts & Docs",
    subtitle: "Every employee's contracts with SNC. Click a name to see all their contracts, the signed copies, and to add or renew one.",
  },
  credentials: {
    title: "Credentials",
    subtitle: "Driver's licences, professional registrations, vehicle registrations, certificates and medicals per employee.",
  },
  assets: {
    title: "Assets",
    subtitle: "Who holds which company property, since when, and what has come back. Click a name to issue or record a return.",
  },
};

function Kpi({ label, value, tone = "text-paper" }: { label: string; value: ReactNode; tone?: string }) {
  return (
    <div className="rounded-lg border border-ink-mid bg-ink-light p-4">
      <p className="font-mono text-[10px] uppercase tracking-widest text-slate">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${tone}`}>{value}</p>
    </div>
  );
}

function contractCell(r: FilesOverviewRow) {
  if (r.contract_state === "none") return <span className="text-amber-300">No contract on file</span>;
  const label = `${humanise(r.contract_type)} · ${r.ends_on ? `ends ${formatDate(r.ends_on)}` : "open-ended"}`;
  const tone = r.contract_state === "expired" ? "text-red-300" : r.contract_state === "ending" ? "text-amber-300" : "text-paper";
  return (
    <span className={tone}>
      {label}
      {r.contract_state === "ending" && r.contract_days_left != null && <span className="ml-2 font-mono text-xs">({r.contract_days_left}d)</span>}
      {r.contract_state === "expired" && <span className="ml-2 text-xs">(expired)</span>}
    </span>
  );
}

function ExpiryWarnings({ canRun }: { canRun: boolean }) {
  const [pending, setPending] = useState<ExpiryRun | null>(null);
  const [history, setHistory] = useState<Awaited<ReturnType<typeof getExpiryAlertHistory>>["data"]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      const [p, h] = await Promise.all([previewExpiryAlerts(), getExpiryAlertHistory()]);
      setPending(p.data);
      setHistory(h.data);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Warnings could not be loaded.");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <section className="rounded-lg border border-ink-mid bg-ink-light p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-slate"><BellRing className="h-4 w-4" />Expiry warnings</h2>
        {canRun && pending && pending.sent.length > 0 && (
          <button className={secondaryButton} disabled={busy} onClick={async () => {
            setBusy(true); setMessage("");
            try { const r = await runExpiryAlerts(); setMessage(`${r.data.sent.length} warning(s) sent.`); await load(); }
            catch (reason) { setMessage(reason instanceof Error ? reason.message : "Could not send."); }
            finally { setBusy(false); }
          }}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Send now</button>
        )}
      </div>
      <p className="mt-1 text-xs text-slate">Checked every hour from 07:00. Each warning goes to nyasha@sixnineconstruction.com and the employee once per stage: 60, 30, 14 and 7 days before, and on the day.</p>
      {message && <p className="mt-2 text-sm text-emerald-300">{message}</p>}
      <div className="mt-3 grid gap-4 md:grid-cols-2">
        <div>
          <p className="mb-1 text-xs text-slate-light">Due to send</p>
          {!pending ? <Loader2 className="h-4 w-4 animate-spin text-signal" /> : pending.sent.length === 0 ? <p className="text-sm text-slate">Nothing due.</p> : (
            <ul className="space-y-1 text-sm">{pending.sent.map((s, i) => <li key={i} className="text-paper">{s.employee} · {s.title} <span className="text-slate">({s.days_left < 0 ? `${-s.days_left}d overdue` : `${s.days_left}d`})</span></li>)}</ul>
          )}
        </div>
        <div>
          <p className="mb-1 text-xs text-slate-light">Recently sent</p>
          {history.length === 0 ? <p className="text-sm text-slate">None yet.</p> : (
            <ul className="max-h-40 space-y-1 overflow-y-auto text-sm">
              {history.map((h, i) => <li key={i} className="text-slate-light">{new Date(h.sent_at).toLocaleDateString("en-ZW")} · {h.employee_name} · {h.item} <span className="text-slate">({h.threshold_days ? `${h.threshold_days}-day` : "expiry"})</span></li>)}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

/** Contracts & Docs, Credentials and Assets: one list of staff; a click opens the person card on that tab. */
export function HRFilesPage({ kind }: { kind: Kind }) {
  const [data, setData] = useState<FilesOverview | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [focus, setFocus] = useState("all");
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setData((await getFilesOverview(kind)).data); setError(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load."); }
  }, [kind]);
  useEffect(() => { void load(); }, [load]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data?.people ?? []).filter((r) => {
      if (needle && ![r.employee_name, r.employee_number, r.position_name, r.department_name].some((v) => (v || "").toLowerCase().includes(needle))) return false;
      if (focus === "attention") {
        if (kind === "contracts") return r.contract_state !== "current" || !r.contract_file;
        if (kind === "credentials") return Number(r.credentials_expired) + Number(r.credentials_expiring) > 0 || Number(r.credentials) === 0;
        return Number(r.assets_overdue) > 0;
      }
      if (focus === "holding") return Number(r.assets_held) > 0;
      if (focus === "drivers") return Number(r.drivers_licences) > 0;
      return true;
    });
  }, [data, q, focus, kind]);

  const t = data?.totals;

  return (
    <div className="space-y-5 p-6">
      <DashboardPageHeader title={COPY[kind].title} subtitle={COPY[kind].subtitle} />
      {error && <p role="alert" className="rounded-sm border border-red-500/40 bg-red-950/30 p-3 text-sm text-red-200">{error}</p>}
      {!data ? <div className="flex h-48 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-signal" /></div> : (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {kind === "contracts" && t && <>
              <Kpi label="No contract on file" value={t.no_contract} tone={t.no_contract ? "text-amber-300" : "text-emerald-300"} />
              <Kpi label="Ending within 60 days" value={t.contracts_ending} tone={t.contracts_ending ? "text-amber-300" : "text-paper"} />
              <Kpi label="Expired, not renewed" value={t.contracts_expired} tone={t.contracts_expired ? "text-red-300" : "text-paper"} />
              <Kpi label="No signed copy" value={t.unsigned} tone={t.unsigned ? "text-amber-300" : "text-paper"} />
            </>}
            {kind === "credentials" && t && <>
              <Kpi label="People with a driver's licence" value={t.drivers} />
              <Kpi label="Expiring within 60 days" value={t.credentials_expiring} tone={t.credentials_expiring ? "text-amber-300" : "text-paper"} />
              <Kpi label="Expired" value={t.credentials_expired} tone={t.credentials_expired ? "text-red-300" : "text-paper"} />
              <Kpi label="Staff" value={t.people} />
            </>}
            {kind === "assets" && t && <>
              <Kpi label="Items out" value={t.assets_held} />
              <Kpi label="Overdue returns" value={t.assets_overdue} tone={t.assets_overdue ? "text-red-300" : "text-paper"} />
              <Kpi label="Value issued" value={`USD ${Math.round(t.assets_value).toLocaleString()}`} />
              <Kpi label="Staff" value={t.people} />
            </>}
          </div>

          {kind !== "assets" && <ExpiryWarnings canRun />}

          <div className="flex flex-wrap gap-3">
            <div className="relative min-w-56 flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate" />
              <input className={`${inputClass} pl-9`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find an employee…" aria-label="Find an employee" />
            </div>
            <select className={`${inputClass} w-auto`} value={focus} onChange={(e) => setFocus(e.target.value)} aria-label="Show">
              <option value="all">Everyone</option>
              <option value="attention">Needs attention</option>
              {kind === "assets" && <option value="holding">Holding items</option>}
              {kind === "credentials" && <option value="drivers">Licensed drivers</option>}
            </select>
          </div>

          <div className="overflow-x-auto rounded-lg border border-ink-mid bg-ink-light">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="border-b border-ink-mid font-mono text-[11px] uppercase tracking-wider text-slate">
                <tr>
                  <th className="p-3">No.</th><th className="p-3">Employee</th><th className="p-3">Role</th>
                  {kind === "contracts" && <><th className="p-3">Current contract</th><th className="p-3">Signed copy</th><th className="p-3">On file</th></>}
                  {kind === "credentials" && <><th className="p-3">Credentials</th><th className="p-3">Next expiry</th><th className="p-3">Status</th></>}
                  {kind === "assets" && <><th className="p-3">Items held</th><th className="p-3">Value</th><th className="p-3">Overdue</th></>}
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-mid">
                {rows.map((r) => (
                  <tr key={r.id} onClick={() => setOpenId(r.id)} className="cursor-pointer hover:bg-ink-mid/20">
                    <td className="p-3 font-mono text-signal">{r.employee_number || "—"}</td>
                    <td className="p-3 font-medium text-paper">{r.employee_name}</td>
                    <td className="p-3 text-slate-light">{r.position_name || r.job_title || "—"}</td>
                    {kind === "contracts" && <>
                      <td className="p-3">{contractCell(r)}</td>
                      <td className="p-3">{r.contract_number ? (r.contract_file ? <span className="text-emerald-300">Yes</span> : <span className="text-amber-300">Missing</span>) : "—"}</td>
                      <td className="p-3 text-slate-light">{r.contracts} contract{Number(r.contracts) === 1 ? "" : "s"}</td>
                    </>}
                    {kind === "credentials" && <>
                      <td className="p-3 text-paper">{r.credentials}{Number(r.drivers_licences) > 0 && <span className="ml-2 text-xs text-slate-light">incl. driver&apos;s licence</span>}</td>
                      <td className="p-3 text-slate-light">{r.next_credential_expiry ? formatDate(r.next_credential_expiry) : "—"}</td>
                      <td className="p-3">
                        {Number(r.credentials_expired) > 0 ? <span className="text-red-300">{r.credentials_expired} expired</span>
                          : Number(r.credentials_expiring) > 0 ? <span className="text-amber-300">{r.credentials_expiring} expiring</span>
                          : Number(r.credentials) === 0 ? <span className="text-slate">None recorded</span> : <span className="text-emerald-300">All valid</span>}
                      </td>
                    </>}
                    {kind === "assets" && <>
                      <td className="p-3 text-paper">{r.assets_held}</td>
                      <td className="p-3 text-slate-light">{Number(r.assets_value) ? `USD ${Number(r.assets_value).toLocaleString()}` : "—"}</td>
                      <td className="p-3">{Number(r.assets_overdue) > 0 ? <span className="text-red-300">{r.assets_overdue}</span> : "—"}</td>
                    </>}
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length === 0 && <p className="p-4 text-sm text-slate-light">Nobody matches.</p>}
          </div>
        </>
      )}
      {openId && <PersonCardModal employeeId={openId} initialTab={kind} onClose={() => { setOpenId(null); void load(); }} />}
    </div>
  );
}
