"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, TrendingUp, DollarSign, Ticket, Building2 } from "lucide-react";
import { RBACGuard } from "@/components/auth/RBACGuard";
import {
  getCrmMarketingReport,
  getCrmSalesReport,
  getCrmSupportDashboard,
  getCrmExecutiveCrmReport,
} from "@/lib/api";

type RecordData = Record<string, any>;
type ReportTab = "marketing" | "sales" | "support" | "executive";

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded border border-white/10 bg-white/[0.03] p-4">
      <p className="text-xs uppercase tracking-wider text-slate-light">{label}</p>
      <p className="mt-1 text-xl font-black text-paper">{value}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded border border-white/10 bg-white/[0.03] p-4">
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-paper">{title}</h2>
      {children}
    </section>
  );
}

function DataTable({ columns, rows }: { columns: { key: string; label: string }[]; rows: RecordData[] }) {
  if (rows.length === 0) {
    return <p className="rounded border border-dashed border-white/10 p-6 text-center text-sm text-slate-light">No data recorded yet.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-white/10 text-[10px] uppercase tracking-wider text-slate-light">
            {columns.map((c) => <th key={c.key} className="pb-2 pr-4">{c.label}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {rows.map((row, idx) => (
            <tr key={row.id ?? idx}>
              {columns.map((c) => (
                <td key={c.key} className="py-2 pr-4 text-paper/90">{row[c.key] ?? "—"}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReportsWorkspace() {
  const [activeTab, setActiveTab] = useState<ReportTab>("marketing");
  const [marketing, setMarketing] = useState<RecordData | null>(null);
  const [sales, setSales] = useState<RecordData | null>(null);
  const [support, setSupport] = useState<RecordData | null>(null);
  const [executive, setExecutive] = useState<RecordData | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const load = async () => {
    setIsLoading(true);
    setWarnings([]);
    const [marketingRes, salesRes, supportRes, executiveRes] = await Promise.allSettled([
      getCrmMarketingReport(),
      getCrmSalesReport(),
      getCrmSupportDashboard(),
      getCrmExecutiveCrmReport(),
    ]);
    const nextWarnings: string[] = [];
    if (marketingRes.status === "fulfilled" && marketingRes.value.success) setMarketing(marketingRes.value.data);
    else nextWarnings.push("Marketing report could not be loaded.");
    if (salesRes.status === "fulfilled" && salesRes.value.success) setSales(salesRes.value.data);
    else nextWarnings.push("Sales report could not be loaded.");
    if (supportRes.status === "fulfilled" && supportRes.value.success) setSupport(supportRes.value.data);
    else nextWarnings.push("Support report could not be loaded.");
    if (executiveRes.status === "fulfilled" && executiveRes.value.success) setExecutive(executiveRes.value.data);
    else nextWarnings.push("Executive report could not be loaded.");
    setWarnings(nextWarnings);
    setIsLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const tabs: { key: ReportTab; label: string; icon: React.ReactNode }[] = [
    { key: "marketing", label: "Marketing", icon: <TrendingUp className="h-3.5 w-3.5" /> },
    { key: "sales", label: "Sales", icon: <DollarSign className="h-3.5 w-3.5" /> },
    { key: "support", label: "Support", icon: <Ticket className="h-3.5 w-3.5" /> },
    { key: "executive", label: "Executive", icon: <Building2 className="h-3.5 w-3.5" /> },
  ];

  const salesSummary = sales?.summary || {};
  const supportSummary = support?.summary || {};
  const execSummary = executive?.summary || {};

  return (
    <div className="min-h-screen bg-[#050505] p-6 text-paper">
      <Link href="/dashboard/crm" className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-slate-light hover:text-signal">
        <ArrowLeft className="h-4 w-4" /> Back to CRM
      </Link>

      <div className="mt-6">
        <h1 className="text-2xl font-black uppercase tracking-tight">CRM Reports</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-light">
          Marketing, sales, support, and executive visibility across the CRM lifecycle.
        </p>
      </div>

      {warnings.length > 0 && (
        <div className="mt-5 rounded border border-amber-400/30 bg-amber-500/10 p-3 text-sm text-amber-100">
          {warnings.map((w) => <p key={w}>{w}</p>)}
        </div>
      )}

      <div className="mt-6 flex gap-2 border-b border-white/10">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold uppercase tracking-wider border-b-2 transition ${
              activeTab === tab.key ? "border-signal text-signal" : "border-transparent text-slate-light hover:text-paper"
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <p className="mt-8 text-center text-sm text-slate-light">Loading reports...</p>
      ) : (
        <div className="mt-6 space-y-5">
          {activeTab === "marketing" && (
            <>
              <Section title="Leads by Source">
                <DataTable
                  columns={[
                    { key: "source", label: "Source" },
                    { key: "leads_created", label: "Created" },
                    { key: "leads_qualified", label: "Qualified" },
                    { key: "opportunities_quoted", label: "Quoted" },
                    { key: "opportunities_won", label: "Won" },
                  ]}
                  rows={marketing?.leads_by_source || []}
                />
              </Section>
              <Section title="Campaign Conversion">
                <DataTable
                  columns={[
                    { key: "name", label: "Campaign" },
                    { key: "status", label: "Status" },
                    { key: "leads_created", label: "Leads" },
                    { key: "leads_qualified", label: "Qualified" },
                    { key: "opportunities_created", label: "Opportunities" },
                    { key: "quotes_sent", label: "Quotes" },
                    { key: "deals_won", label: "Won" },
                  ]}
                  rows={marketing?.campaigns || []}
                />
              </Section>
            </>
          )}

          {activeTab === "sales" && (
            <>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <Stat label="Pipeline Value" value={`$${Number(salesSummary.pipeline_value || 0).toLocaleString()}`} />
                <Stat label="Weighted Forecast" value={`$${Number(salesSummary.weighted_forecast || 0).toLocaleString()}`} />
                <Stat label="Win Rate" value={salesSummary.win_rate_pct != null ? `${salesSummary.win_rate_pct}%` : "N/A"} />
                <Stat label="Quote Conversion" value={salesSummary.quote_conversion_pct != null ? `${salesSummary.quote_conversion_pct}%` : "N/A"} />
                <Stat label="Stale Opportunities" value={salesSummary.stale_opportunities ?? 0} />
                <Stat label="Activities Completed" value={sales?.activity_completion?.completed ?? 0} />
                <Stat label="Activities Pending" value={sales?.activity_completion?.pending ?? 0} />
              </div>
              <Section title="Stage Ageing">
                <DataTable
                  columns={[
                    { key: "stage", label: "Stage" },
                    { key: "count", label: "Open Deals" },
                    { key: "avg_age_days", label: "Avg Age (days)" },
                  ]}
                  rows={(sales?.stage_ageing || []).map((r: RecordData) => ({ ...r, avg_age_days: Number(r.avg_age_days || 0).toFixed(1) }))}
                />
              </Section>
              <Section title="Loss Reasons">
                <DataTable
                  columns={[
                    { key: "reason", label: "Reason" },
                    { key: "count", label: "Count" },
                  ]}
                  rows={sales?.loss_reasons || []}
                />
              </Section>
            </>
          )}

          {activeTab === "support" && (
            <>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <Stat label="Open Tickets" value={supportSummary.open_tickets ?? 0} />
                <Stat label="Overdue" value={supportSummary.overdue_tickets ?? 0} />
                <Stat label="Response SLA" value={supportSummary.response_sla_compliance_pct != null ? `${supportSummary.response_sla_compliance_pct}%` : "N/A"} />
                <Stat label="Resolution SLA" value={supportSummary.resolution_sla_compliance_pct != null ? `${supportSummary.resolution_sla_compliance_pct}%` : "N/A"} />
                <Stat label="Avg First Response (h)" value={Number(supportSummary.avg_first_response_hours || 0).toFixed(1)} />
                <Stat label="Avg Resolution (h)" value={Number(supportSummary.avg_resolution_hours || 0).toFixed(1)} />
                <Stat label="Reopened" value={supportSummary.reopened_tickets ?? 0} />
                <Stat label="Satisfaction" value={Number(supportSummary.avg_satisfaction || 0).toFixed(1)} />
              </div>
              <Section title="Tickets by Category">
                <DataTable columns={[{ key: "category", label: "Category" }, { key: "ticket_count", label: "Tickets" }]} rows={support?.tickets_by_category || []} />
              </Section>
              <Section title="Tickets by Client">
                <DataTable columns={[{ key: "client_name", label: "Client" }, { key: "ticket_count", label: "Tickets" }]} rows={support?.tickets_by_client || []} />
              </Section>
            </>
          )}

          {activeTab === "executive" && (
            <>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <Stat label="Revenue Pipeline" value={`$${Number(execSummary.revenue_pipeline || 0).toLocaleString()}`} />
                <Stat label="Tender Pipeline" value={`$${Number(execSummary.tender_pipeline || 0).toLocaleString()}`} />
                <Stat label="Total Leads" value={execSummary.total_leads ?? 0} />
                <Stat label="Total Quotes" value={execSummary.total_quotes ?? 0} />
                <Stat label="Projects From Pipeline" value={execSummary.total_projects_from_pipeline ?? 0} />
              </div>
              <Section title="Top Clients by Revenue">
                <DataTable
                  columns={[
                    { key: "name", label: "Client" },
                    { key: "revenue", label: "Revenue" },
                    { key: "open_tickets", label: "Open Tickets" },
                    { key: "risk_rating", label: "Risk" },
                  ]}
                  rows={(executive?.top_clients || []).map((r: RecordData) => ({ ...r, revenue: `$${Number(r.revenue || 0).toLocaleString()}` }))}
                />
              </Section>
              <Section title="Client Risk Distribution">
                <DataTable columns={[{ key: "risk_rating", label: "Risk Rating" }, { key: "count", label: "Clients" }]} rows={executive?.risk_distribution || []} />
              </Section>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function CrmReportsPage() {
  return (
    <RBACGuard allowedRoles={["Executive (Admin)", "Project Manager", "Finance Manager", "Compliance Officer", "SUPERADMIN"]}>
      <ReportsWorkspace />
    </RBACGuard>
  );
}
