"use client";

import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { BadgeCheck, CheckCircle2, Clock3, HardHat, Pencil, Power, RefreshCw, Search, Users, XCircle } from "lucide-react";
import { RBACGuard } from "@/components/auth/RBACGuard";
import { DashboardPageHeader } from "@/components/dashboard/DashboardPageHeader";
import { useLiveTable } from "@/lib/live/LiveDataProvider";
import {
  decideProjectHireHours, getProjectHireHours, getProjectHires, setProjectHireStatus, updateProjectHire, verifyProjectHire,
} from "@/lib/api";
import { ApiRecord, Btn, Notice, Panel, Pill, dayLabel, errorText, fieldClass, num, qty, timeOf, usd } from "@/components/site-operations/ui";

type View = "hours" | "register";

export default function ProjectHiresPage() {
  return (
    <RBACGuard>
      <ProjectHiresWorkspace />
    </RBACGuard>
  );
}

function ProjectHiresWorkspace() {
  const [view, setView] = useState<View>("hours");
  const [hours, setHours] = useState<ApiRecord[]>([]);
  const [hoursStatus, setHoursStatus] = useState("pending");
  const [hires, setHires] = useState<ApiRecord[]>([]);
  const [hireStatus, setHireStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "error" | "success" | "info"; text: string } | null>(null);
  const [editing, setEditing] = useState<ApiRecord | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [h, w] = await Promise.allSettled([getProjectHireHours(hoursStatus), getProjectHires({ status: hireStatus })]);
    setHours(h.status === "fulfilled" && Array.isArray(h.value.data) ? h.value.data : []);
    setHires(w.status === "fulfilled" && Array.isArray(w.value.data) ? w.value.data : []);
    if (h.status === "rejected" || w.status === "rejected") {
      setMessage({ tone: "error", text: errorText(h.status === "rejected" ? h.reason : (w as PromiseRejectedResult).reason, "Project hires could not be loaded.") });
    }
    setPicked(new Set());
    setLoading(false);
  }, [hoursStatus, hireStatus]);

  useEffect(() => { void load(); }, [load]);
  useLiveTable("projects.site_day_attendance", () => void load());
  useLiveTable("finance.site_workers", () => void load());

  const act = async (key: string, fn: () => Promise<any>) => {
    setBusy(key);
    setMessage(null);
    try {
      const r = await fn();
      setMessage({ tone: "success", text: r?.message ?? "Saved." });
      await load();
      return true;
    } catch (reason) {
      setMessage({ tone: "error", text: errorText(reason, "That didn't save. Try again.") });
      return false;
    } finally {
      setBusy(null);
    }
  };

  // One block per project-day, the way the site sent them.
  const days = useMemo(() => {
    const groups = new Map<string, { key: string; project: string; date: string; topic: string; safety: boolean; rows: ApiRecord[] }>();
    for (const r of hours) {
      const key = String(r.briefing_id);
      if (!groups.has(key)) groups.set(key, { key, project: r.project_name, date: String(r.briefing_date).slice(0, 10), topic: r.toolbox_topic, safety: !!r.safety_concern_raised, rows: [] });
      groups.get(key)!.rows.push(r);
    }
    return [...groups.values()];
  }, [hours]);

  const pendingTotals = useMemo(() => ({
    people: hours.length,
    hours: hours.reduce((s, r) => s + num(r.regular_hours) + num(r.overtime_hours), 0),
    pay: hours.reduce((s, r) => s + num(r.estimated_pay), 0),
  }), [hours]);

  const filteredHires = useMemo(() => {
    const term = search.trim().toLowerCase();
    return hires.filter((h) => !term || `${h.full_name} ${h.trade ?? ""} ${h.national_id ?? ""} ${h.project_name ?? ""}`.toLowerCase().includes(term));
  }, [hires, search]);

  const unverified = hires.filter((h) => !h.hr_verified && h.status === "active").length;
  const toggle = (id: string) => setPicked((cur) => { const next = new Set(cur); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  const decide = (ids: string[], decision: "accepted" | "rejected") => {
    if (!ids.length) return;
    let reason: string | undefined;
    if (decision === "rejected") {
      reason = window.prompt("Why are these hours rejected? The site will see this.") ?? undefined;
      if (!reason) return;
    }
    void act(`d-${decision}`, () => decideProjectHireHours({ attendance_ids: ids, decision, reason }));
  };

  return (
    <main className="min-h-full bg-ink p-4 text-paper sm:p-6">
      <DashboardPageHeader
        eyebrow={{ label: "Human Resources", icon: HardHat }}
        title="Project Hires"
        subtitle="Hourly, semi-skilled people hired per project. Sites register them and clock their hours; HR verifies them, accepts the hours for billing, and activates or deactivates them."
        actions={<button onClick={() => void load()} className="inline-flex h-10 items-center gap-2 border border-ink-mid bg-ink-light px-3 font-mono text-xs uppercase tracking-wider text-slate-light hover:border-signal hover:text-paper"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh</button>}
      />

      <section className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile icon={<Clock3 />} label="Hours waiting" value={qty(pendingTotals.hours)} hint={`${pendingTotals.people} lines`} />
        <Tile icon={<BadgeCheck />} label="Estimated pay waiting" value={usd(pendingTotals.pay)} />
        <Tile icon={<Users />} label="Active project hires" value={String(hires.filter((h) => h.status === "active").length)} />
        <Tile icon={<HardHat />} label="To verify" value={String(unverified)} tone={unverified ? "text-amber-300" : "text-paper"} />
      </section>

      <nav className="mb-4 flex gap-1 border-b border-ink-mid" role="tablist">
        {([["hours", "Hours to accept"], ["register", "Hire register"]] as [View, string][]).map(([key, label]) => (
          <button key={key} role="tab" aria-selected={view === key} onClick={() => setView(key)}
            className={`border-b-2 px-4 py-2.5 text-sm ${view === key ? "border-signal text-paper" : "border-transparent text-slate-light hover:text-paper"}`}>
            {label}{key === "hours" && hoursStatus === "pending" && hours.length ? <span className="ml-2 bg-signal px-1.5 font-mono text-[10px] text-ink">{hours.length}</span> : null}
          </button>
        ))}
      </nav>

      {message ? <div className="mb-4"><Notice tone={message.tone} onClose={() => setMessage(null)}>{message.text}</Notice></div> : null}

      {view === "hours" ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <select value={hoursStatus} onChange={(e) => setHoursStatus(e.target.value)} className={`${fieldClass} w-auto`}>
              <option value="pending">Waiting for HR</option>
              <option value="accepted">Accepted</option>
              <option value="rejected">Rejected</option>
            </select>
            {hoursStatus === "pending" && picked.size ? (
              <div className="flex gap-2">
                <Btn tone="danger" busy={busy === "d-rejected"} icon={<XCircle className="h-4 w-4" />} onClick={() => decide([...picked], "rejected")}>Reject {picked.size}</Btn>
                <Btn tone="success" busy={busy === "d-accepted"} icon={<CheckCircle2 className="h-4 w-4" />} onClick={() => decide([...picked], "accepted")}>Accept {picked.size}</Btn>
              </div>
            ) : null}
          </div>
          {!days.length ? (
            <div className="border border-dashed border-ink-mid py-14 text-center text-sm text-slate-light">{loading ? "Loading…" : "Nothing here. Sites send hours when they close the site day."}</div>
          ) : days.map((d) => {
            const ids = d.rows.map((r) => r.id);
            const all = ids.every((id) => picked.has(id));
            return (
              <Panel key={d.key} title={`${d.project} · ${dayLabel(d.date, { weekday: "long", day: "2-digit", month: "short" })}`}
                subtitle={`Toolbox talk: ${d.topic || "—"}${d.safety ? " · safety concern raised" : ""}`}
                actions={hoursStatus === "pending" ? (
                  <div className="flex gap-2">
                    <Btn tone="ghost" onClick={() => setPicked((cur) => { const next = new Set(cur); ids.forEach((id) => all ? next.delete(id) : next.add(id)); return next; })}>{all ? "Unselect" : "Select day"}</Btn>
                    <Btn tone="success" busy={busy === "d-accepted"} icon={<CheckCircle2 className="h-4 w-4" />} onClick={() => decide(ids, "accepted")}>Accept day</Btn>
                  </div>
                ) : null}>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-sm">
                    <thead><tr className="border-b border-ink-mid text-left font-mono text-[10px] uppercase tracking-wider text-slate">
                      {hoursStatus === "pending" ? <th className="w-8 py-2" /> : null}
                      <th className="py-2">Person</th><th>In</th><th>Out</th><th>Regular</th><th>OT</th><th>Rate</th><th className="text-right">Est. pay</th></tr></thead>
                    <tbody className="divide-y divide-ink-mid">
                      {d.rows.map((r) => (
                        <tr key={r.id} className={picked.has(r.id) ? "bg-signal/5" : ""}>
                          {hoursStatus === "pending" ? <td className="py-2"><input type="checkbox" checked={picked.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Select ${r.worker_name}`} /></td> : null}
                          <td className="py-2 pr-3">
                            <p className="text-paper">{r.worker_name}</p>
                            <p className="text-xs text-slate-light">{r.trade ?? "—"} · {r.worker_kind === "employee" ? "SNC staff (record only)" : r.hr_verified ? "verified hire" : <span className="text-amber-300">unverified hire</span>}</p>
                            {r.hr_reason ? <p className="text-xs text-red-300">{r.hr_reason}</p> : null}
                          </td>
                          <td className="font-mono text-slate-light">{timeOf(r.clock_in_at)}</td>
                          <td className="font-mono text-slate-light">{timeOf(r.clock_out_at)}</td>
                          <td className="font-mono text-paper">{qty(r.regular_hours)}h</td>
                          <td className="font-mono text-paper">{num(r.overtime_hours) ? `${qty(r.overtime_hours)}h` : "—"}</td>
                          <td className="font-mono text-slate-light">{r.hourly_rate ? `$${num(r.hourly_rate).toFixed(2)}` : "—"}</td>
                          <td className="text-right font-mono text-paper">{r.worker_kind === "employee" ? "payroll" : usd(r.estimated_pay, 2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
            );
          })}
          <p className="text-xs text-slate">Accepted project-hire hours become site time entries; Finance pays them through a site pay run. Staff attendance is accepted as a record only.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex h-10 flex-1 items-center gap-2 border border-ink-mid bg-ink-light px-3 focus-within:border-signal sm:max-w-md">
              <Search className="h-4 w-4 text-slate" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, trade, ID or project" className="h-full w-full bg-transparent text-sm outline-none placeholder:text-slate" />
            </label>
            <select value={hireStatus} onChange={(e) => setHireStatus(e.target.value)} className={`${fieldClass} w-auto`}>
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="inactive">Deactivated</option>
            </select>
          </div>
          <div className="overflow-x-auto border border-ink-mid">
            <table className="w-full min-w-[900px] text-sm">
              <thead><tr className="border-b border-ink-mid bg-ink-light/40 text-left font-mono text-[10px] uppercase tracking-wider text-slate">
                <th className="px-3 py-2">Project hire</th><th>Project</th><th>Rate</th><th>Paid by</th><th>Last on site</th><th>Unpaid h</th><th>Status</th><th className="px-3 text-right">Actions</th></tr></thead>
              <tbody className="divide-y divide-ink-mid">
                {filteredHires.map((h) => (
                  <tr key={h.id} className={h.status === "inactive" ? "opacity-60" : ""}>
                    <td className="px-3 py-2.5">
                      <p className="text-paper">{h.full_name}</p>
                      <p className="text-xs text-slate-light">{h.trade ?? "—"}{h.national_id ? ` · ${h.national_id}` : ""}{h.phone ? ` · ${h.phone}` : ""}</p>
                      <p className="text-[11px] text-slate">{h.registered_via === "site_register" ? `Registered on site${h.registered_by_name ? ` by ${h.registered_by_name}` : ""}` : "Added by finance"}</p>
                    </td>
                    <td className="text-slate-light">{h.project_name ?? "—"}</td>
                    <td className="font-mono text-paper">${num(h.hourly_rate).toFixed(2)}/h{h.overtime_rate ? <span className="block text-xs text-slate">OT ${num(h.overtime_rate).toFixed(2)}</span> : null}</td>
                    <td className="text-xs text-slate-light">{String(h.payment_method).replace("_", " ")}{h.payment_details ? <span className="block">{h.payment_details}</span> : null}</td>
                    <td className="text-xs text-slate-light">{h.last_on_site ? dayLabel(String(h.last_on_site).slice(0, 10)) : "—"}</td>
                    <td className="font-mono text-paper">{qty(h.unpaid_hours)}{num(h.pending_hours) ? <span className="block text-xs text-amber-300">+{qty(h.pending_hours)} pending</span> : null}</td>
                    <td>
                      <div className="flex flex-col items-start gap-1">
                        <Pill tone={h.status === "active" ? "green" : "slate"}>{h.status === "active" ? "active" : "deactivated"}</Pill>
                        {!h.hr_verified ? <Pill tone="amber">unverified</Pill> : null}
                        {h.status === "inactive" && h.status_reason ? <span className="text-[11px] text-slate">{h.status_reason}</span> : null}
                      </div>
                    </td>
                    <td className="px-3">
                      <div className="flex justify-end gap-1">
                        {!h.hr_verified ? <Btn tone="success" className="h-8 px-2" busy={busy === `v-${h.id}`} icon={<BadgeCheck className="h-3.5 w-3.5" />} onClick={() => void act(`v-${h.id}`, () => verifyProjectHire(h.id))}>Verify</Btn> : null}
                        <Btn tone="ghost" className="h-8 px-2" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEditing({ ...h })}>Edit</Btn>
                        <Btn tone={h.status === "active" ? "danger" : "ghost"} className="h-8 px-2" busy={busy === `s-${h.id}`} icon={<Power className="h-3.5 w-3.5" />}
                          onClick={() => {
                            if (h.status === "active") {
                              const reason = window.prompt(`Why is ${h.full_name} being deactivated?`);
                              if (reason) void act(`s-${h.id}`, () => setProjectHireStatus(h.id, { status: "inactive", reason }));
                            } else {
                              void act(`s-${h.id}`, () => setProjectHireStatus(h.id, { status: "active" }));
                            }
                          }}>{h.status === "active" ? "Deactivate" : "Activate"}</Btn>
                      </div>
                    </td>
                  </tr>
                ))}
                {!filteredHires.length ? <tr><td colSpan={8} className="py-12 text-center text-sm text-slate-light">{loading ? "Loading…" : "No project hires yet. Sites register them from the Labour Register."}</td></tr> : null}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editing ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={() => setEditing(null)}>
          <form className="w-full max-w-lg space-y-3 border border-ink-mid bg-ink p-5" onClick={(e) => e.stopPropagation()}
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await act(`e-${editing.id}`, () => updateProjectHire(editing.id, {
                full_name: editing.full_name, national_id: editing.national_id || null, phone: editing.phone || null, trade: editing.trade || null,
                hourly_rate: num(editing.hourly_rate), overtime_rate: editing.overtime_rate === "" || editing.overtime_rate == null ? null : num(editing.overtime_rate),
                payment_method: editing.payment_method, payment_details: editing.payment_details || null,
              }));
              if (ok) setEditing(null);
            }}>
            <h2 className="font-mono text-xs font-bold uppercase tracking-widest text-paper">Edit {editing.full_name}</h2>
            {[["full_name", "Full name"], ["national_id", "National ID"], ["phone", "Phone"], ["trade", "Trade"], ["hourly_rate", "Hourly rate ($)"], ["overtime_rate", "Overtime rate ($, blank = 1.5×)"], ["payment_details", "Payment details"]].map(([k, label]) => (
              <label key={k} className="block text-xs text-slate-light">{label}
                <input value={editing[k] ?? ""} onChange={(e) => setEditing({ ...editing, [k]: e.target.value })} className={`${fieldClass} mt-1`} />
              </label>
            ))}
            <label className="block text-xs text-slate-light">Paid by
              <select value={editing.payment_method} onChange={(e) => setEditing({ ...editing, payment_method: e.target.value })} className={`${fieldClass} mt-1`}>
                <option value="cash">Cash</option><option value="mobile_money">Mobile money</option><option value="bank_transfer">Bank transfer</option>
              </select>
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <Btn type="button" tone="ghost" onClick={() => setEditing(null)}>Cancel</Btn>
              <Btn type="submit" busy={busy === `e-${editing.id}`}>Save</Btn>
            </div>
          </form>
        </div>
      ) : null}
    </main>
  );
}

function Tile({ icon, label, value, hint, tone = "text-paper" }: { icon: ReactNode; label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="border border-ink-mid bg-ink p-4">
      <div className="flex items-center justify-between text-slate"><p className="font-mono text-[10px] uppercase tracking-wider">{label}</p><span className="text-signal [&_svg]:h-4 [&_svg]:w-4">{icon}</span></div>
      <p className={`mt-3 font-mono text-2xl ${tone}`}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-slate">{hint}</p> : null}
    </div>
  );
}
