"use client";

import React, { use, useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, AlertCircle } from "lucide-react";
import { getCrmTenderById } from "@/lib/api/crm";
import { DashboardPageHeader } from "@/components/dashboard/DashboardPageHeader";
import { CommercialWorkspaceModal, type CommercialEntityData } from "@/components/crm/CommercialWorkspaceModal";
import { EgpSourceChip } from "@/components/crm/tender-discovery/EgpSourceChip";

export default function TenderCanonicalPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [tender, setTender] = useState<CommercialEntityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTender = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getCrmTenderById(id);
      if (res.success && res.data) {
        const d = res.data;
        setTender({
          id: d.id,
          kind: "tender",
          name: d.tender_name,
          stage: d.stage,
          budget: Number(d.bid_amount || 0),
          deal_value: Number(d.bid_amount || 0),
          probability: 50,
          expected_margin: 18.5,
          risk_level: "Medium",
          client_name: d.tender_name,
          organization_name: d.tender_name,
          expected_close_date: d.submission_deadline,
          project_id: d.project_id || undefined,
          region: d.region || undefined,
          bid_number: d.bid_number,
          submission_deadline: d.submission_deadline,
          bid_bond_required: Boolean(d.bid_bond_secured),
          bid_bond_amount: Number(d.bond_amount || 0),
        });
      } else {
        setError(res.message || "Tender not found.");
      }
    } catch (err: any) {
      setError(err?.message || "Failed to load tender.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void fetchTender();
  }, [fetchTender]);

  return (
    <div className="min-h-screen bg-[#050505] text-paper">
      <DashboardPageHeader
        breadcrumbs={[
          { label: "CRM", href: "/dashboard/crm" },
          { label: "Tenders & Bids", href: "/dashboard/crm/tenders" },
          { label: tender?.name || "Tender Details" },
        ]}
        backHref="/dashboard/crm/tenders"
        backLabel="Back to Bids Deck"
        eyebrow={{ label: "Commercial Workspace" }}
        title={tender?.name || "Tender Workspace"}
        subtitle="Full-page canonical bidding console for tender compliance, BOQ structures, and bid submission."
      />

      <main className="p-4 sm:p-6">
        {loading ? (
          <div className="flex h-96 items-center justify-center border border-white/5 bg-[#0C0C0C] rounded-sm">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="h-6 w-6 animate-spin text-signal" />
              <span className="font-mono text-xs uppercase tracking-wider text-slate-light">
                Loading Tender Telemetry...
              </span>
            </div>
          </div>
        ) : error || !tender ? (
          <div className="flex h-96 flex-col items-center justify-center gap-4 border border-red-500/20 bg-red-950/10 p-6 rounded-sm text-center">
            <AlertCircle className="h-8 w-8 text-rose-400" />
            <div>
              <h3 className="font-sans text-sm font-semibold text-rose-300">
                {error || "Tender Unavailable"}
              </h3>
              <p className="mt-1 text-xs text-slate-light">
                The tender could not be accessed or does not exist in your organization.
              </p>
            </div>
            <Link
              href="/dashboard/crm/tenders"
              className="inline-flex items-center gap-2 border border-white/10 bg-white/5 px-4 py-2 font-mono text-xs text-paper hover:bg-white/10"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Return to Tenders
            </Link>
          </div>
        ) : (
          <div className="relative">
            <EgpSourceChip tenderId={tender.id} />
            <CommercialWorkspaceModal
              isOpen={true}
              onClose={() => {
                window.location.href = "/dashboard/crm/tenders";
              }}
              entity={tender}
              kind="tender"
              onEntityUpdated={() => {
                fetchTender();
              }}
            />
          </div>
        )}
      </main>
    </div>
  );
}
