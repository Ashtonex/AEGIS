"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Check, Download, Search, Minus } from "lucide-react";
import { getPeopleCatalogue, getPeopleRegister, type PeopleCatalogue, type RegisterRow } from "@/lib/api";
import { DashboardPageHeader } from "@/components/dashboard/DashboardPageHeader";
import { PersonCardModal } from "@/components/people/PersonCardModal";
import { StatusPill, formatDate, humanise, inputClass, secondaryButton } from "@/components/people/ui";

function Tick({ on, label }: { on: boolean; label: string }) {
  return on
    ? <Check className="h-4 w-4 text-emerald-400" aria-label={`${label} complete`} />
    : <Minus className="h-4 w-4 text-amber-400" aria-label={`${label} missing`} />;
}

function toCsv(rows: RegisterRow[]) {
  const header = ["Number", "Name", "Discipline", "Role", "Department", "Line manager", "Employment type", "Started", "Left", "Status", "Login"];
  const lines = rows.map((r) => [r.employee_number, r.employee_name, r.category_name, r.position_name || r.job_title, r.department_name, r.line_manager_name,
    r.employment_type, r.start_date, r.end_date, r.employment_status, r.login_email].map((v) => `"${String(v ?? "").replaceAll('"', '""')}"`).join(","));
  return [header.join(","), ...lines].join("\n");
}

/** HR's employee register: the people list with HR completeness, leavers included on demand. */
export function HREmployeeRegister() {
  const [rows, setRows] = useState<RegisterRow[]>([]);
  const [catalogue, setCatalogue] = useState<PeopleCatalogue | null>(null);
  const [status, setStatus] = useState("current");
  const [categoryId, setCategoryId] = useState("");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => { void getPeopleCatalogue().then((r) => setCatalogue(r.data)).catch(() => undefined); }, []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    getPeopleRegister({ status, category_id: categoryId })
      .then((r) => { if (active) { setRows(r.data); setError(""); } })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Register could not be loaded."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [status, categoryId, revision]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) => [r.employee_name, r.employee_number, r.position_name, r.job_title, r.department_name].some((v) => (v || "").toLowerCase().includes(needle)));
  }, [rows, q]);

  function exportCsv() {
    const blob = new Blob([toCsv(visible)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `snc-employee-register-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5 p-6">
      <DashboardPageHeader
        title="Employee Register"
        subtitle="Click anyone to open their card. Ticks show whether HR has their role, start date, pay and personal details."
        actions={<>
          <Link href="/dashboard/workforce/people" className={secondaryButton}>Register a new person</Link>
          <button className={secondaryButton} onClick={exportCsv} disabled={!visible.length}><Download className="h-4 w-4" />Export CSV</button>
        </>}
      />
      {error && <p role="alert" className="rounded-sm border border-red-500/40 bg-red-950/30 p-3 text-sm text-red-200">{error}</p>}
      <div className="flex flex-wrap gap-3">
        <div className="relative min-w-56 flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate" />
          <input className={`${inputClass} pl-9`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, number, role, department…" aria-label="Search register" />
        </div>
        <select className={`${inputClass} w-auto`} value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label="Discipline">
          <option value="">All disciplines</option>
          {catalogue?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className={`${inputClass} w-auto`} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="current">Current staff</option>
          <option value="active">Active</option>
          <option value="on_leave">On leave</option>
          <option value="suspended">Suspended</option>
          <option value="terminated">Left the organisation</option>
          <option value="all">Everyone</option>
        </select>
      </div>
      <div className="overflow-x-auto rounded-lg border border-ink-mid bg-ink-light">
        <table className="w-full min-w-[1000px] text-left text-sm">
          <thead className="border-b border-ink-mid font-mono text-[11px] uppercase tracking-wider text-slate">
            <tr>
              {["No.", "Name", "Role", "Department", "Type", "Started", "Role ✓", "Pay ✓", "Personal ✓", "Status"].map((h) => <th key={h} className="p-3">{h}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-mid">
            {visible.map((r) => (
              <tr key={r.id} onClick={() => setOpenId(r.id)} className="cursor-pointer hover:bg-ink-mid/20">
                <td className="p-3 font-mono text-signal">{r.employee_number || "—"}</td>
                <td className="p-3 font-medium text-paper">{r.employee_name}{r.login_active === false && r.employment_status !== "terminated" && <span className="ml-2 text-[10px] text-amber-300">login disabled</span>}</td>
                <td className="p-3 text-paper">{r.position_name || r.job_title || "—"}</td>
                <td className="p-3 text-slate-light">{r.department_name || "—"}</td>
                <td className="p-3 text-slate-light">{r.employment_type ? humanise(r.employment_type) : "—"}</td>
                <td className="p-3 text-slate-light">{r.employment_status === "terminated" ? `Left ${formatDate(r.end_date)}` : r.start_date ? formatDate(r.start_date) : "—"}</td>
                <td className="p-3"><Tick on={!!r.position_name} label="Role" /></td>
                <td className="p-3"><Tick on={r.has_pay_profile} label="Pay" /></td>
                <td className="p-3"><Tick on={r.personal_complete} label="Personal details" /></td>
                <td className="p-3"><StatusPill status={r.employment_status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && !visible.length && <p className="p-4 text-sm text-slate-light">Nobody matches.</p>}
        {loading && <p className="p-4 text-sm text-slate-light">Loading…</p>}
      </div>
      {openId && <PersonCardModal employeeId={openId} onClose={() => setOpenId(null)} onChanged={() => setRevision((v) => v + 1)} />}
    </div>
  );
}
