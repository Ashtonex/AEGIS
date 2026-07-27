"use client";

import React, { use, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Briefcase, FileText, MessageSquare, Ticket, Users } from "lucide-react";
import { getCrmCustomer360 } from "@/lib/api";

type RecordData = Record<string, any>;

const customer360Tabs = [
  "Overview",
  "Contacts",
  "Opportunities",
  "Quotes",
  "Projects",
  "Tickets",
  "Communications",
  "Documents",
  "Activity Timeline",
];

export default function CRMCustomer360Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<RecordData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await getCrmCustomer360(id);
        if (!response.success) throw new Error("Customer 360 response was not successful.");
        setData(response.data || null);
      } catch {
        setError("Customer 360 could not be loaded from the CRM lifecycle service.");
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [id]);

  const organization = data?.organization || {};

  return (
    <div className="min-h-screen bg-[#050505] text-paper p-6">
      <Link href="/dashboard/crm/organizations" className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-slate-light hover:text-signal">
        <ArrowLeft className="h-4 w-4" /> Back to Organizations
      </Link>

      {loading && <p className="mt-8 text-sm text-slate-light">Loading Customer 360...</p>}
      {error && <div className="mt-8 rounded border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-100">{error}</div>}

      {!loading && !error && data && (
        <>
          <header className="mt-6 rounded border border-white/10 bg-white/[0.03] p-5">
            <p className="text-xs uppercase tracking-wider text-slate-light">Customer 360</p>
            <h1 className="mt-1 text-3xl font-black tracking-tight">{organization.name}</h1>
            <p className="mt-2 max-w-4xl text-sm text-slate-light">
              {organization.industry || "Unclassified industry"} · {organization.lifecycle_stage || "prospect"} · {organization.account_status || "active"}
            </p>
            <p className="mt-2 text-xs text-slate-light">
              Financial summary: {String(data.financial_summary?.awarded_value ?? 0)} · Risk flags: {String(data.risk_compliance_flags?.risk_rating ?? "not set")}
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
              <Metric icon={<Users />} label="Contacts" value={data.primary_contacts?.length || 0} />
              <Metric icon={<Briefcase />} label="Opportunities" value={data.active_opportunities?.length || 0} />
              <Metric icon={<FileText />} label="Quotes" value={data.quotation_history?.length || 0} />
              <Metric icon={<Ticket />} label="Tickets" value={data.open_support_tickets?.length || 0} />
              <Metric icon={<MessageSquare />} label="Comms" value={data.recent_communications?.length || 0} />
            </div>
          </header>

          <nav className="mt-5 flex flex-wrap gap-2">
            {customer360Tabs.map((tab) => (
              <span key={tab} className="rounded border border-white/10 px-3 py-1.5 text-[10px] uppercase tracking-wider text-slate-light">
                {tab}
              </span>
            ))}
          </nav>

          <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-2">
            <Panel title="Contacts" rows={data.primary_contacts || []} columns={["contact_name", "email", "phone", "job_title"]} />
            <Panel title="Open Leads" rows={data.open_leads || []} columns={["company_name", "contact_name", "status", "ai_score"]} />
            <Panel title="Opportunities" rows={data.active_opportunities || []} columns={["name", "stage", "budget", "probability"]} />
            <Panel title="Quotations" rows={data.quotation_history || []} columns={["client_name", "quote_amount", "status", "created_at"]} />
            <Panel title="Projects" rows={data.awarded_projects || []} columns={["name", "status", "contract_value", "project_code"]} />
            <Panel title="Support Tickets" rows={data.open_support_tickets || []} columns={["subject", "status", "priority", "category"]} />
            <Panel title="Communications" rows={data.recent_communications || []} columns={["channel", "direction", "subject", "status", "started_at"]} />
            <Panel title="Documents" rows={data.documents || []} columns={["title", "category", "file_name", "created_at"]} />
            <Panel title="Activities" rows={data.upcoming_activities || []} columns={["type", "subject", "status", "activity_date"]} />
          </div>
        </>
      )}
    </div>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return <div className="rounded border border-white/10 bg-black/30 p-3"><div className="mb-2 h-4 w-4 text-signal">{icon}</div><p className="text-[10px] uppercase tracking-wider text-slate-light">{label}</p><p className="text-lg font-black">{value}</p></div>;
}

function Panel({ title, rows, columns }: { title: string; rows: RecordData[]; columns: string[] }) {
  return (
    <section className="rounded border border-white/10 bg-white/[0.03] p-4">
      <h2 className="text-sm font-bold uppercase tracking-wider">{title}</h2>
      <div className="mt-4 overflow-hidden rounded border border-white/10">
        <table className="w-full text-left text-xs">
          <thead className="bg-white/5 text-slate-light">
            <tr>{columns.map((column) => <th key={column} className="p-2 uppercase">{column.replaceAll("_", " ")}</th>)}</tr>
          </thead>
          <tbody>
            {rows.slice(0, 8).map((row) => (
              <tr key={row.id} className="border-t border-white/5">
                {columns.map((column) => <td key={column} className="max-w-[220px] truncate p-2">{String(row[column] ?? "-")}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="p-5 text-center text-sm text-slate-light">No records linked.</p>}
      </div>
    </section>
  );
}
