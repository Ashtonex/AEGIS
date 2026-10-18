"use client";

import React, { useMemo, useState, useEffect } from "react";
import Link from "next/link";
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
  HardHat,
  Package,
  ArrowDownRight,
  ArrowUpRight,
  RefreshCw,
  ExternalLink,
  Coins,
} from "lucide-react";
import { useProject } from "@/context/ProjectWorkspaceContext";
import {
  getFinanceProjectDetail,
  getFinanceVariations,
  getFinanceProgressClaims,
  getProjectPettyCash,
  createFinanceVariation,
  createFinanceProgressClaim,
  confirmProjectDeposit,
} from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/utils";
import { ProjectMoneyModal } from "@/app/dashboard/finance/ProjectMoneyModal";
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
  const [isMoneyModalOpen, setIsMoneyModalOpen] = useState(false);

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

  // Deposit modal
  const [isDepositModalOpen, setIsDepositModalOpen] = useState(false);
  const [depositAmount, setDepositAmount] = useState("");
  const [depositRef, setDepositRef] = useState("");
  const [depositNotes, setDepositNotes] = useState("");
  const [savingDeposit, setSavingDeposit] = useState(false);

  const reloadData = async () => {
    const [fd, v, c, pc] = await Promise.allSettled([
      getFinanceProjectDetail(projectId),
      getFinanceVariations({ project_id: projectId }),
      getFinanceProgressClaims({ project_id: projectId }),
      getProjectPettyCash(projectId),
    ]);
    if (fd.status === "fulfilled" && fd.value.data) setFinanceDetail(fd.value.data);
    if (v.status === "fulfilled" && v.value.data) setVariations(v.value.data || []);
    if (c.status === "fulfilled" && c.value.data) setClaims(c.value.data || []);
    if (pc.status === "fulfilled" && pc.value.data) setPettyCash(pc.value.data);
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    reloadData().finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [projectId]);

  const source = detail?.project ?? project;
  const contractVal = number(source?.contract_value ?? source?.budget ?? source?.budget_value) ?? 0;
  const budgetedCost = number(source?.budget_amount ?? (detail as any)?.viability?.[0]?.budget_amount ?? (financeDetail as any)?.approved_budget) ?? 0;
  const actualCost = number(source?.actual_cost ?? (financeDetail as any)?.total_cost_incurred ?? (financeDetail as any)?.actual_cost_to_date) ?? 0;
  const committedCost = number(source?.committed_cost ?? (financeDetail as any)?.total_commitments ?? (financeDetail as any)?.committed_cost) ?? 0;
  const siteStoreInventoryValue = number((financeDetail as any)?.site_store_inventory_value ?? (financeDetail as any)?.materials_summary?.store_inventory_value) ?? 0;
  const collectedCash = number((financeDetail as any)?.total_cash_collected ?? (financeDetail as any)?.cash_collected) ?? 0;

  const totalExposure = actualCost + committedCost;
  const baseline = budgetedCost > 0 ? budgetedCost : contractVal;
  const remainingBudget = Math.max(0, baseline - totalExposure);
  const projectedMargin = contractVal > 0 ? contractVal - (totalExposure || budgetedCost) : 0;
  const marginPct = contractVal > 0 ? Math.round((projectedMargin / contractVal) * 100) : 0;

  // Extracted dynamic summaries
  const materialsSummary = (financeDetail as any)?.materials_summary || {};
  const subconSummary = (financeDetail as any)?.subcontractor_payments || {};
  const labourSummary = (financeDetail as any)?.onsite_labour_payments || {};
  const cashflowMatchmaking = (financeDetail as any)?.cashflow_matchmaking || {};

  const handleCreateDeposit = async () => {
    if (!depositAmount || Number(depositAmount) <= 0) return;
    setSavingDeposit(true);
    try {
      await confirmProjectDeposit(projectId, {
        deposit_received_amount: Number(depositAmount),
        deposit_reference: depositRef.trim() || undefined,
        notes: depositNotes.trim() || undefined,
      });
      setIsDepositModalOpen(false);
      setDepositAmount("");
      setDepositRef("");
      setDepositNotes("");
      await reloadData();
    } catch (err) {
      console.error(err);
    } finally {
      setSavingDeposit(false);
    }
  };

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
      await reloadData();
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
      await reloadData();
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
        Loading project financials and matchmaking ledger...
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
            Real-time reconciliation of project contract value, baseline cost, spend, deposits, subcontractor claims, and cash matchmaking.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/dashboard/finance/project-financials?projectId=${projectId}`}
            className="inline-flex items-center gap-1.5 border border-lime-500/50 bg-lime-950/20 px-3 py-1.5 font-mono text-xs text-lime-400 hover:bg-lime-500 hover:text-ink transition-colors"
            title="Open in Corporate Finance Command"
          >
            <Coins className="h-3.5 w-3.5" />
            <span>Finance Command</span>
            <ExternalLink className="h-3 w-3" />
          </Link>
          <button
            type="button"
            onClick={() => setIsMoneyModalOpen(true)}
            className="inline-flex items-center gap-1.5 border border-signal/60 bg-signal/15 px-3 py-1.5 font-mono text-xs font-semibold text-signal hover:bg-signal hover:text-ink transition-colors"
            title="Open Project Money Attribution and Ledger Modal"
          >
            <Banknote className="h-3.5 w-3.5" />
            <span>Money Ledger</span>
          </button>
          {/* Add Deposit Button */}
          <button
            type="button"
            onClick={() => setIsDepositModalOpen(true)}
            className="inline-flex items-center gap-1.5 border border-sky-500/50 bg-sky-950/30 px-3.5 py-1.5 font-mono text-xs text-sky-300 hover:bg-sky-500 hover:text-ink transition-colors"
          >
            <DollarSign className="h-3.5 w-3.5" />
            <span>Add Deposit</span>
          </button>
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
          <span className="text-[11px] text-slate-light">Baseline minus exposure</span>
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

      {/* Materials & Supply Values Radar */}
      <section className="border border-ink-mid bg-ink p-5 space-y-4">
        <div className="flex items-center justify-between border-b border-ink-mid/60 pb-3">
          <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-paper flex items-center gap-2">
            <Package className="h-4 w-4 text-amber-400" />
            Materials &amp; Supply Chain Valuation
          </h3>
          <span className="font-mono text-xs text-slate-light">Consolidated Site Radar</span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="border border-ink-mid/50 bg-ink-light/20 p-3">
            <span className="font-mono text-[10px] uppercase text-slate">Store Inventory Value</span>
            <p className="mt-1 font-mono text-lg font-bold text-emerald-400">
              {formatCurrency(Number(materialsSummary.store_inventory_value || 0))}
            </p>
            <span className="text-[10px] text-slate-light">Stock physically held in site stores</span>
          </div>
          <div className="border border-ink-mid/50 bg-ink-light/20 p-3">
            <span className="font-mono text-[10px] uppercase text-slate">Committed PO Value</span>
            <p className="mt-1 font-mono text-lg font-bold text-signal">
              {formatCurrency(Number(materialsSummary.po_material_committed || 0))}
            </p>
            <span className="text-[10px] text-slate-light">Open PO commitments issued to vendors</span>
          </div>
          <div className="border border-ink-mid/50 bg-ink-light/20 p-3">
            <span className="font-mono text-[10px] uppercase text-slate">Delivered GRN Value</span>
            <p className="mt-1 font-mono text-lg font-bold text-sky-400">
              {formatCurrency(Number(materialsSummary.grn_delivered_value || 0))}
            </p>
            <span className="text-[10px] text-slate-light">Goods delivered and verified at site</span>
          </div>
          <div className="border border-ink-mid/50 bg-ink-light/20 p-3">
            <span className="font-mono text-[10px] uppercase text-slate">Daily Consumed Value</span>
            <p className="mt-1 font-mono text-lg font-bold text-paper">
              {formatCurrency(Number(materialsSummary.daily_report_consumed_value || 0))}
            </p>
            <span className="text-[10px] text-slate-light">Materials used in daily site report logs</span>
          </div>
        </div>
      </section>

      {/* Subcontractor Payments & Onsite Labour Grid */}
      <section className="grid gap-6 lg:grid-cols-2">
        {/* Subcontractor Payments */}
        <div className="border border-ink-mid bg-ink p-5 space-y-3">
          <div className="flex items-center justify-between border-b border-ink-mid/60 pb-3">
            <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-paper flex items-center gap-2">
              <HardHat className="h-4 w-4 text-signal" />
              Subcontractor Payments (Made &amp; Pending)
            </h3>
            <span className="font-mono text-xs text-slate-light">
              Paid: <strong className="text-emerald-400 font-normal">{formatCurrency(Number(subconSummary.paid_amount || 0))}</strong> | Pending: <strong className="text-amber-400 font-normal">{formatCurrency(Number(subconSummary.pending_amount || 0))}</strong>
            </span>
          </div>

          {!subconSummary.items || subconSummary.items.length === 0 ? (
            <div className="py-6 text-center text-xs text-slate-light font-mono">
              No subcontractor claims recorded for this project yet.
            </div>
          ) : (
            <div className="divide-y divide-ink-mid/40">
              {subconSummary.items.map((sub: any, idx: number) => (
                <div key={idx} className="py-2.5 flex items-center justify-between text-xs">
                  <div>
                    <span className="font-mono font-medium text-paper">
                      {String(sub.subcontractor_name || "Subcontractor")}
                    </span>
                    <p className="text-[11px] text-slate-light">
                      {String(sub.reference_description || "Specialist trade package")}
                    </p>
                  </div>
                  <div className="text-right font-mono">
                    <span className="font-bold text-paper">
                      {formatCurrency(Number(sub.amount || 0))}
                    </span>
                    <span className={`block text-[10px] uppercase ${
                      sub.status === "paid" || sub.status === "cleared" ? "text-emerald-400" : "text-amber-400"
                    }`}>
                      {String(sub.status || "pending")}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Onsite Labour Payments */}
        <div className="border border-ink-mid bg-ink p-5 space-y-3">
          <div className="flex items-center justify-between border-b border-ink-mid/60 pb-3">
            <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-paper flex items-center gap-2">
              <Banknote className="h-4 w-4 text-emerald-400" />
              Onsite Labour Payments &amp; Pay Runs
            </h3>
            <span className="font-mono text-xs text-slate-light">
              Paid: <strong className="text-emerald-400 font-normal">{formatCurrency(Number(labourSummary.paid_amount || 0))}</strong> | Pending: <strong className="text-amber-400 font-normal">{formatCurrency(Number(labourSummary.pending_amount || 0))}</strong>
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 border border-ink-mid/40 bg-ink-light/20 p-2.5 font-mono text-xs">
            <div>
              <span className="text-[10px] uppercase text-slate">Site Pay Run Hours:</span>
              <p className="font-bold text-paper">{Number(labourSummary.total_hours_payruns || 0).toLocaleString()} hrs</p>
            </div>
            <div>
              <span className="text-[10px] uppercase text-slate">Daily Report Labour:</span>
              <p className="font-bold text-cyan-400">{formatCurrency(Number(labourSummary.daily_report_labour_cost || 0))}</p>
            </div>
          </div>

          {!labourSummary.items || labourSummary.items.length === 0 ? (
            <div className="py-6 text-center text-xs text-slate-light font-mono">
              No formal site pay runs generated yet. Hours recorded in daily site reports.
            </div>
          ) : (
            <div className="divide-y divide-ink-mid/40">
              {labourSummary.items.map((run: any, idx: number) => (
                <div key={idx} className="py-2.5 flex items-center justify-between text-xs">
                  <div>
                    <span className="font-mono font-medium text-paper">
                      {String(run.run_number || `RUN-${idx + 1}`)} ({run.worker_count || 0} artisans)
                    </span>
                    <p className="text-[11px] text-slate-light">
                      Period: {formatDate(String(run.period_start || ""))} – {formatDate(String(run.period_end || ""))}
                    </p>
                  </div>
                  <div className="text-right font-mono">
                    <span className="font-bold text-emerald-400">
                      {formatCurrency(Number(run.total_net || 0))}
                    </span>
                    <span className="block text-[10px] uppercase text-slate-light">
                      {String(run.status || "draft")}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Money In & Money Out Matchmaking Ledger */}
      <section className="border border-ink-mid bg-ink p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-mid/60 pb-3">
          <div>
            <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-paper flex items-center gap-2">
              <RefreshCw className="h-4 w-4 text-cyan-400" />
              Project Cashflow Matchmaking Ledger (Money In vs Out)
            </h3>
            <p className="mt-0.5 text-xs text-slate-light">
              Automatic matchmaking between project cash movements and Finance General Ledger transactions.
            </p>
          </div>
          <div className="flex items-center gap-4 font-mono text-xs">
            <span className="flex items-center gap-1 text-emerald-400">
              <ArrowDownRight className="h-3.5 w-3.5" />
              In: {formatCurrency(Number(cashflowMatchmaking.total_money_in || 0))}
            </span>
            <span className="flex items-center gap-1 text-signal">
              <ArrowUpRight className="h-3.5 w-3.5" />
              Out: {formatCurrency(Number(cashflowMatchmaking.total_money_out || 0))}
            </span>
            <span className="border-l border-ink-mid pl-3 font-bold text-paper">
              Net Cash: {formatCurrency(Number(cashflowMatchmaking.net_cash || 0))}
            </span>
          </div>
        </div>

        {!cashflowMatchmaking.items || cashflowMatchmaking.items.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-light font-mono">
            No matched cashbook transactions recorded for this project yet. Use &quot;Add Deposit&quot; or pay supplier invoices to record cash movements.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono text-xs">
              <thead className="border-b border-ink-mid text-[10px] uppercase text-slate">
                <tr>
                  <th className="py-2 pr-3">Date</th>
                  <th className="py-2 pr-3">Txn #</th>
                  <th className="py-2 pr-3">Direction</th>
                  <th className="py-2 pr-3">For What (Description)</th>
                  <th className="py-2 pr-3">Counterparty</th>
                  <th className="py-2 pr-3">Method</th>
                  <th className="py-2 pr-3">Reference</th>
                  <th className="py-2 pr-3 text-right">Amount</th>
                  <th className="py-2 text-right">Match Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-mid/30 text-paper">
                {cashflowMatchmaking.items.map((tx: any, idx: number) => {
                  const isInflow = tx.direction === "inflow";
                  return (
                    <tr key={idx} className="hover:bg-ink-light/20 transition-colors">
                      <td className="py-2.5 pr-3 text-slate-light whitespace-nowrap">{formatDate(tx.transaction_date)}</td>
                      <td className="py-2.5 pr-3 font-medium text-slate-light">{tx.transaction_number || "—"}</td>
                      <td className="py-2.5 pr-3">
                        <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] uppercase font-bold ${
                          isInflow ? "border border-emerald-500/30 bg-emerald-950/20 text-emerald-400" : "border border-red-500/30 bg-red-950/20 text-signal"
                        }`}>
                          {isInflow ? <ArrowDownRight className="h-3 w-3" /> : <ArrowUpRight className="h-3 w-3" />}
                          {tx.direction}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3 text-paper font-sans text-xs max-w-xs truncate">{tx.description || "Project cash settlement"}</td>
                      <td className="py-2.5 pr-3 text-slate-light truncate">{tx.counterparty_name || "—"}</td>
                      <td className="py-2.5 pr-3 text-slate-light uppercase text-[10px]">{tx.payment_method || "Transfer"}</td>
                      <td className="py-2.5 pr-3 text-slate-light truncate">{tx.reference || "—"}</td>
                      <td className={`py-2.5 pr-3 text-right font-bold whitespace-nowrap ${isInflow ? "text-emerald-400" : "text-signal"}`}>
                        {isInflow ? "+" : "-"}{formatCurrency(Number(tx.amount || 0))}
                      </td>
                      <td className="py-2.5 text-right whitespace-nowrap">
                        <span className="border border-ink-mid bg-ink-light px-1.5 py-0.5 text-[9px] uppercase text-slate-light">
                          {tx.reconciliation_status || "matched"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Variations & Claims Grid */}
      <section className="grid gap-6 lg:grid-cols-2">
        {/* Progress Claims */}
        <div className="border border-ink-mid bg-ink p-5 space-y-3">
          <div className="flex items-center justify-between border-b border-ink-mid/60 pb-3">
            <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-paper flex items-center gap-2">
              <Send className="h-4 w-4 text-emerald-400" />
              Progress Claims &amp; Billing
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
              Scope Variations &amp; Change Orders
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

      {/* Add Deposit Modal */}
      {isDepositModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md border border-sky-500/50 bg-ink p-6 shadow-2xl space-y-4">
            <h3 className="font-display text-lg font-bold text-paper">Add Client Advance Deposit</h3>
            <p className="text-xs text-slate-light">
              Confirm cash received from client. Automatically posts as certified revenue &amp; cashbook inflow.
            </p>
            <div>
              <label className="block text-xs font-mono uppercase text-slate">Deposit Amount ($) *</label>
              <input
                type="number"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                placeholder="Amount in USD"
                className="mt-1 w-full border border-ink-mid bg-ink-light p-2 text-xs text-paper outline-none focus:border-sky-500 font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-mono uppercase text-slate">Deposit Reference</label>
              <input
                value={depositRef}
                onChange={(e) => setDepositRef(e.target.value)}
                placeholder="e.g. Wire transfer ref / RTGS-8821"
                className="mt-1 w-full border border-ink-mid bg-ink-light p-2 text-xs text-paper outline-none focus:border-sky-500 font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-mono uppercase text-slate">Notes</label>
              <textarea
                rows={2}
                value={depositNotes}
                onChange={(e) => setDepositNotes(e.target.value)}
                placeholder="Initial project advance payment from client..."
                className="mt-1 w-full border border-ink-mid bg-ink-light p-2 text-xs text-paper outline-none focus:border-sky-500"
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsDepositModalOpen(false)}
                className="border border-ink-mid px-4 py-2 font-mono text-xs text-slate-light hover:text-paper"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateDeposit}
                disabled={savingDeposit || !depositAmount || Number(depositAmount) <= 0}
                className="border border-sky-500 bg-sky-500 px-4 py-2 font-mono text-xs font-bold uppercase text-ink hover:bg-sky-400 disabled:opacity-50"
              >
                {savingDeposit ? "Recording..." : "Confirm Deposit"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Variations Modal */}
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

      {/* Progress Claim Modal */}
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
      {isMoneyModalOpen && (
        <ProjectMoneyModal
          projectId={projectId}
          projects={[]}
          onClose={() => {
            setIsMoneyModalOpen(false);
            void reloadData();
          }}
          onChanged={() => void reloadData()}
        />
      )}
    </div>
  );
}
