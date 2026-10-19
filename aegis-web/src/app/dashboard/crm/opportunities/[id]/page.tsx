"use client";

import React, { use, useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, AlertCircle } from "lucide-react";
import {
  getCrmOpportunityById,
  getCrmContacts,
  getCrmOrganizations,
} from "@/lib/api/crm";
import { DashboardPageHeader } from "@/components/dashboard/DashboardPageHeader";
import {
  OpportunityDetailDrawer,
  type OpportunityDetailData,
} from "@/components/crm/OpportunityDetailDrawer";

export default function OpportunityCanonicalPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [opportunity, setOpportunity] = useState<OpportunityDetailData | null>(null);
  const [contacts, setContacts] = useState<Array<{ id: string; contact_name: string; email?: string }>>([]);
  const [organizations, setOrganizations] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOpportunity = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [oppRes, contactsRes, orgsRes] = await Promise.allSettled([
        getCrmOpportunityById(id),
        getCrmContacts(),
        getCrmOrganizations(),
      ]);

      if (oppRes.status === "fulfilled" && oppRes.value.success && oppRes.value.data) {
        const d = oppRes.value.data;
        setOpportunity({
          id: d.id,
          name: d.name,
          stage: d.stage,
          budget: Number(d.deal_value || d.budget || 0),
          deal_value: Number(d.deal_value || d.budget || 0),
          probability: Number(d.win_probability || d.probability || 50),
          expected_margin: d.expected_margin,
          risk_level: d.risk_level,
          client_id: d.client_id || d.contact_id,
          client_name: d.organization_name || d.client_name,
          client_org_id: d.client_org_id,
          organization_name: d.organization_name,
          next_activity_due_at: d.next_activity_due_at,
          quote_id: d.quote_id,
          quote_status: d.quote_status,
          project_id: d.project_id,
          project_name: d.project_name,
          is_stale: d.is_stale,
          originating_department_id: d.originating_department_id,
          region: d.region,
          created_at: d.created_at,
        });
      } else {
        const msg =
          oppRes.status === "fulfilled"
            ? oppRes.value.message || "Opportunity not found."
            : "Failed to load opportunity.";
        setError(msg);
      }

      if (contactsRes.status === "fulfilled" && contactsRes.value.success && Array.isArray(contactsRes.value.data)) {
        setContacts(contactsRes.value.data);
      }
      if (orgsRes.status === "fulfilled" && orgsRes.value.success && Array.isArray(orgsRes.value.data)) {
        setOrganizations(orgsRes.value.data);
      }
    } catch (err: any) {
      setError(err?.message || "Failed to load opportunity.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void fetchOpportunity();
  }, [fetchOpportunity]);

  return (
    <div className="min-h-screen bg-[#050505] text-paper">
      <DashboardPageHeader
        breadcrumbs={[
          { label: "CRM", href: "/dashboard/crm" },
          { label: "Opportunities", href: "/dashboard/crm/opportunities" },
          { label: opportunity?.name || "Opportunity Details" },
        ]}
        backHref="/dashboard/crm/opportunities"
        backLabel="Back to Pipeline"
        eyebrow={{ label: "Commercial Pipeline" }}
        title={opportunity?.name || "Opportunity Detail"}
        subtitle="Focused deal workspace for client touchpoints, estimation handoff, strictly scoped attachments, and execution release."
      />

      <main className="p-4 sm:p-6">
        {loading ? (
          <div className="flex h-96 items-center justify-center border border-white/5 bg-[#0C0C0C] rounded-sm">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="h-6 w-6 animate-spin text-signal" />
              <span className="font-mono text-xs uppercase tracking-wider text-slate-light">
                Loading Commercial Telemetry...
              </span>
            </div>
          </div>
        ) : error || !opportunity ? (
          <div className="flex h-96 flex-col items-center justify-center gap-4 border border-red-500/20 bg-red-950/10 p-6 rounded-sm text-center">
            <AlertCircle className="h-8 w-8 text-rose-400" />
            <div>
              <h3 className="font-sans text-sm font-semibold text-rose-300">
                {error || "Record Unavailable"}
              </h3>
              <p className="mt-1 text-xs text-slate-light">
                The opportunity could not be accessed or does not exist in your organization.
              </p>
            </div>
            <Link
              href="/dashboard/crm/opportunities"
              className="inline-flex items-center gap-2 border border-white/10 bg-white/5 px-4 py-2 font-mono text-xs text-paper hover:bg-white/10"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Return to Opportunities
            </Link>
          </div>
        ) : (
          <OpportunityDetailDrawer
            isOpen={true}
            onClose={() => {
              router.push("/dashboard/crm/opportunities");
            }}
            opportunity={opportunity}
            onOpportunityUpdated={() => {
              void fetchOpportunity();
            }}
            contacts={contacts}
            organizations={organizations}
          />
        )}
      </main>
    </div>
  );
}
