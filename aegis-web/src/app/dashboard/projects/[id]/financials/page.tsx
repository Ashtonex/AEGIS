"use client";

import React, { useMemo, useState, useEffect } from "react";
import { useParams } from "next/navigation";
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Receipt,
  Banknote,
  Send,
  Plus,
  Loader2,
  CheckCircle2,
  Layers,
} from "lucide-react";
import { useProject } from "@/context/ProjectWorkspaceContext";
import {
  getFinanceProjectDetail,
  getFinanceVariations,
  getFinanceProgressClaims,
  getProjectPettyCash,
  createFinanceVariation,
  createFinanceProgressClaim,
} from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/utils";
import { number } from "@/lib/projects/types";

export default function ProjectFinancialsPage() {
  const params = useParams();
  const projectId = typeof params?.id === "string" ? params.id : "";
  const { project, detail } = useProject();

  const [loading, setLoading] = useState(true);
  const [variations, setVariations] = useState<Record<string, unknown>[]>([]);
  const [claims, setClaims] = useState<Record<string, unknown>[]>([]);
  const [financeDetail, setFinanceDetail] = useState<Record<string, unknown> | null>(null);
  const [pettyCash, setPettyCash] = useState<Record<string, unknown> | null>(null);

  // Quick modals
  const [isVariationModalOpen, setIsVariationModalOpen] = useState(false);
  const [variationTitle, setVariationTitle] = useState("");
  const [variationAmount, setVariationAmount] = useState("");
  const [variationType, setVariationType] = useState("addition");
  const [savingVariation, setSavingVariation] = useState(false);

  const [isClaimModalOpen, setIsClaimModalOpen] = useState(false);
  const [claimAmount, setClaimAmount] = useState("");
  const [claimNotes, setClaimNotes] = useState("");
  const [savingClaim, setSavingClaim] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.allSettled([
      getFinanceProjectDetail(projectId),
      getFinanceVariations({ project_id: projectId }),
      getFinanceProgressClaims({ project_id: projectId }),
      getProjectPettyCash(projectId),
    ]).then(([fd, v, c, pc]) => {
      if (!active) return;
      if (fd.status === "fulfilled" && fd.value.data) setFinanceDetail(fd.value.data);
      if (v.status === "fulfilled" && v.value.data) setVariations(v.value.data || []);
      if (c.status === "fulfilled" && c.value.data) setClaims(c.value.data || []);
      if (pc.status === "fulfilled" && pc.value.data) setPettyCash(pc.value.data);
      setLoading(false);
    });
    return () => { active = false; };
  }, [projectId]);

  const source = detail?.project ?? project;
  const contractVal = number(source?.contract_value ?? source?.budget ?? source?.budget_value) ?? 0;
  const budgetedCost = number(source?.budget_amount ?? (detail as any)?.viability?.[0]?.budget_amount) ?? 0;
  const actualCost = number(source?.actual_cost ?? (financeDetail as any)?.total_cost_incurred) ?? 0;
  const committedCost = number(source?.committed_cost ?? (financeDetail as any)?.total_commitments) ?? 0;
  const siteStoreInventoryValue = number((financeDetail as any)?.site_store_inventory_value) ?? 0;
  const collectedCash = number((financeDetail as any)?.total_cash_collected) ?? 0;

  const totalExposure = actualCost + committedCost;
  const remainingBudget = Math.max(0, budgetedCost - totalExposure);
  const projectedMargin = contractVal > 0 ? contractVal - (totalExposure || budgetedCost) : 0;
  const marginPct = contractVal > 0 ? Math.round((projectedMargin / contractVal) * 100) : 0;

  const handleCreateVariation = async () => {
    if (!variationTitle.trim() || !variationAmount) return;
    setSavingVariation(true);
    try {
      await createFinanceVariation({
        project_id: projectId,
        description: variationTitle.trim(),
        cost_impact: Number(variationAmount) || 0,
        type: variationType,
      });
      setIsVariationModalOpen(false);
      setVariationTitle("");
      setVariationAmount("");
      const res = await getFinanceVariations({ project_id: projectId });
      setVariations(res.data || []);
    } catch {
      // non-fatal
    } finally {
      setSavingVariation(false);
    }
  };

  const handleCreateClaim = async () => {
    if (!claimAmount) return;
    setSavingClaim(true);
    try {
      await createFinanceProgressClaim({
        project_id: projectId,
        this_claim_amount: Number(claimAmount) || 0,
        notes: claimNotes.trim() || undefined,
      });
      setIsClaimModalOpen(false);
      setClaimAmount("");
      setClaimNotes("");
      const res = await getFinanceProgressClaims({ project_id: projectId });
      setClaims(res.data || []);
    } catch {
      // non-fatal
    } finally {
      setSavingClaim(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center gap-3 text-slate-light font-mono text-sm">
        <Loader2 className="h-5 w-5 animate-spin text-signal" />
        Loading project financials and ledger...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-bold text-paper sm:text-2xl">
            Financial Ledger & Commercial Exposure
          </h2>
          <p className="mt-1 text-xs text-slate-light">
            Real-time reconciliation of project contract value, baseline cost, actual spend, billing claims, and petty cash.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsVariationModalOpen(true)}
            className="inline-flex items-center gap-1.5 border border-ink-mid bg-ink-light px-3 py-1.5 font-mono text-xs text-paper hover:border-signal transition-colors"
          >
            <Plus className="h-3.5 w-3.5 text-signal" />
            <span>Record Variation</span>
          </button>
          <button
            type="button"
            onClick={() => setIsClaimModalOpen(true)}
            className="inline-flex items-center gap-1.5 border border-emerald-500/50 bg-emerald-950/20 px-3 py-1.5 font-mono text-xs text-emerald-300 hover:bg-emerald-500 hover:text-ink transition-colors"
          >
            <Send className="h-3.5 w-3.5" />
            <span>Progress Claim</span>
          </button>
        </div>
      </div>

      {/* Financial Radar KPI Cards */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <div className="border border-ink-mid bg-ink/70 p-4">
          <span className="font-mono text-[10px] uppercase text-slate">Contract Value</span>
          <p className="mt-1 font-mono text-2xl font-bold text-paper">
            {formatCurrency(contractVal)}
          </p>
          <span className="text-[11px] text-slate-light">Recognized commercial scope</span>
        </div>

        <div className="border border-ink-mid bg-ink/70 p-4">
          <span className="font-mono text-[10px] uppercase text-slate">Total Exposure</span>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-bold text-signal">
              {formatCurrency(totalExposure)}
            </span>
          </div>
          <span className="text-[11px] text-slate-light truncate">
            Actual: {formatCurrency(actualCost)} + POs: {formatCurrency(committedCost)}
          </span>
        </div>

        <div className="border border-ink-mid bg-ink/70 p-4">
          <span className="font-mono text-[10px] uppercase text-slate">Site Store Inventory</span>
          <p className="mt-1 font-mono text-2xl font-bold text-emerald-400">
            {formatCurrency(siteStoreInventoryValue)}
          </p>
          <span className="text-[11px] text-slate-light">Asset held in site stores</span>
        </div>

        <div className="border border-ink-mid bg-ink/70 p-4">
          <span className="font-mono text-[10px] uppercase text-slate">Remaining Headroom</span>
          <p className="mt-1 font-mono text-2xl font-bold text-cyan-400">
            {formatCurrency(remainingBudget)}
          </p>
          <span className="text-[11px] text-slate-light">Budget baseline minus exposure</span>
        </div>

        <div className="border border-ink-mid bg-ink/70 p-4">
          <span className="font-mono text-[10px] uppercase text-slate">Projected Margin</span>
          <div className="mt-1 flex items-baseline gap-2">
            <span className={`font-mono text-2xl font-bold ${marginPct >= 15 ? "text-emerald-400" : "text-amber-400"}`}>
              {marginPct}%
            </span>
            <span className="text-xs text-slate-light">({formatCurrency(projectedMargin)})</span>
          </div>
          <span className="text-[11px] text-slate-light">Forecast delivery profitability</span>
        </div>
      </section>

      {/* Variations & Claims Grid */}
      <section className="grid gap-6 lg:grid-cols-2">
        {/* Progress Claims */}
        <div className="border border-ink-mid bg-ink p-5 space-y-3">
          <div className="flex items-center justify-between border-b border-ink-mid/60 pb-3">
            <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-paper flex items-center gap-2">
              <Send className="h-4 w-4 text-emerald-400" />
              Progress Claims & Billing
            </h3>
            <span className="font-mono text-xs text-slate-light">{claims.length} Claims</span>
          </div>

          {claims.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-light font-mono">
              No progress claims recorded. Click &quot;Progress Claim&quot; to bill certified works.
            </div>
          ) : (
            <div className="divide-y divide-ink-mid/40">
              {claims.map((claim, idx) => (
                <div key={idx} className="py-2.5 flex items-center justify-between text-xs">
                  <div>
                    <span className="font-mono font-medium text-paper">
                      {String(claim.claim_number || `CLAIM-${idx + 1}`)}
                    </span>
                    <p className="text-[11px] text-slate-light">
                      Period ending: {formatDate(String(claim.claim_period_end || claim.created_at || ""))}
                    </p>
                  </div>
                  <div className="text-right font-mono">
                    <span className="font-bold text-signal">
                      {formatCurrency(Number(claim.this_claim_amount || claim.certified_amount || 0))}
                    </span>
                    <span className="block text-[10px] uppercase text-slate-light">
                      {String(claim.status || "submitted")}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Variations */}
        <div className="border border-ink-mid bg-ink p-5 space-y-3">
          <div className="flex items-center justify-between border-b border-ink-mid/60 pb-3">
            <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-paper flex items-center gap-2">
              <Receipt className="h-4 w-4 text-signal" />
              Scope Variations & Change Orders
            </h3>
            <span className="font-mono text-xs text-slate-light">{variations.length} Variations</span>
          </div>

          {variations.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-light font-mono">
              No formal variations recorded for this project.
            </div>
          ) : (
            <div className="divide-y divide-ink-mid/40">
              {variations.map((v, idx) => (
                <div key={idx} className="py-2.5 flex items-center justify-between text-xs">
                  <div>
                    <span className="font-mono font-medium text-paper">
                      {String(v.variation_number || `VO-${idx + 1}`)}: {String(v.description || "Variation")}
                    </span>
                    <p className="text-[11px] text-slate-light">
                      Type: {String(v.type || "addition")}
                    </p>
                  </div>
                  <div className="text-right font-mono">
                    <span className="font-bold text-paper">
                      {formatCurrency(Number(v.cost_impact || 0))}
                    </span>
                    <span className="block text-[10px] uppercase text-slate-light">
                      {String(v.status || "draft")}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Petty Cash Float */}
      {pettyCash && (
        <section className="border border-ink-mid bg-ink/70 p-5">
          <div className="flex items-center justify-between border-b border-ink-mid/60 pb-3">
            <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-paper flex items-center gap-2">
              <Banknote className="h-4 w-4 text-amber-400" />
              Site Petty Cash Float
            </h3>
            <span className="font-mono text-xs text-slate-light">
              Current Balance: <strong className="text-emerald-400 font-normal">{formatCurrency(Number(pettyCash.current_balance || 0))}</strong>
            </span>
          </div>
          <p className="mt-3 text-xs text-slate-light">
            Authorized float amount: {formatCurrency(Number(pettyCash.float_amount || 0))}. Site disbursements are posted directly to Finance ledgers.
          </p>
        </section>
      )}

      {/* Modals */}
      {isVariationModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md border border-ink-mid bg-ink p-6 shadow-2xl space-y-4">
            <h3 className="font-display text-lg font-bold text-paper">Record Project Variation</h3>
            <div>
              <label className="block text-xs font-mono uppercase text-slate">Description *</label>
              <input
                value={variationTitle}
                onChange={(e) => setVariationTitle(e.target.value)}
                placeholder="e.g. Additional retaining wall drainage"
                className="mt-1 w-full border border-ink-mid bg-ink-light p-2 text-xs text-paper outline-none focus:border-signal"
              />
            </div>
            <div>
              <label className="block text-xs font-mono uppercase text-slate">Cost Impact ($) *</label>
              <input
                type="number"
                value={variationAmount}
                onChange={(e) => setVariationAmount(e.target.value)}
                placeholder="Cost in USD"
                className="mt-1 w-full border border-ink-mid bg-ink-light p-2 text-xs text-paper outline-none focus:border-signal font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-mono uppercase text-slate">Variation Type</label>
              <select
                value={variationType}
                onChange={(e) => setVariationType(e.target.value)}
                className="mt-1 w-full border border-ink-mid bg-ink-light p-2 text-xs text-paper outline-none focus:border-signal uppercase font-mono"
              >
                <option value="addition">Addition (Scope expansion)</option>
                <option value="omission">Omission (Scope deduction)</option>
                <option value="substitution">Substitution</option>
              </select>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsVariationModalOpen(false)}
                className="border border-ink-mid px-4 py-2 font-mono text-xs text-slate-light hover:text-paper"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateVariation}
                disabled={savingVariation || !variationTitle.trim()}
                className="border border-signal bg-signal px-4 py-2 font-mono text-xs font-bold uppercase text-ink hover:bg-signal/90 disabled:opacity-50"
              >
                {savingVariation ? "Saving..." : "Save Variation"}
              </button>
            </div>
          </div>
        </div>
      )}

      {isClaimModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md border border-emerald-500/50 bg-ink p-6 shadow-2xl space-y-4">
            <h3 className="font-display text-lg font-bold text-paper">Submit Progress Claim</h3>
            <div>
              <label className="block text-xs font-mono uppercase text-slate">Claim Amount ($) *</label>
              <input
                type="number"
                value={claimAmount}
                onChange={(e) => setClaimAmount(e.target.value)}
                placeholder="Amount in USD"
                className="mt-1 w-full border border-ink-mid bg-ink-light p-2 text-xs text-paper outline-none focus:border-signal font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-mono uppercase text-slate">Billing Notes</label>
              <textarea
                rows={3}
                value={claimNotes}
                onChange={(e) => setClaimNotes(e.target.value)}
                placeholder="Scope milestone completed for certification..."
                className="mt-1 w-full border border-ink-mid bg-ink-light p-2 text-xs text-paper outline-none focus:border-signal"
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsClaimModalOpen(false)}
                className="border border-ink-mid px-4 py-2 font-mono text-xs text-slate-light hover:text-paper"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateClaim}
                disabled={savingClaim || !claimAmount}
                className="border border-emerald-500 bg-emerald-500 px-4 py-2 font-mono text-xs font-bold uppercase text-ink hover:bg-emerald-400 disabled:opacity-50"
              >
                {savingClaim ? "Submitting..." : "Submit Claim"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
