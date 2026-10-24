"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, TrendingUp } from "lucide-react";
import { getCashForecast } from "@/lib/api";

type RecordData = Record<string, any>;

function money(value: unknown) {
  const num = typeof value === "number" ? value : Number(value);
  return new Intl.NumberFormat("en-ZW", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number.isFinite(num) ? num : 0);
}

export function CashForecastPanel() {
  const [loading, setLoading] = useState(true);
  const [forecast, setForecast] = useState<RecordData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getCashForecast();
      setForecast(res.data);
    } catch (err: any) {
      setError(err?.message || "Failed to load cash forecast.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return <div className="flex items-center justify-center p-8 text-slate"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  }

  if (error || !forecast) {
    return <div className="p-4 text-sm text-red-300 border border-red-500/30 rounded-sm bg-red-950/20">{error || "No forecast data."}</div>;
  }

  const labels: string[] = forecast.horizon_labels || [];
  const committed: RecordData[] = forecast.committed || [];
  const probable: RecordData[] = forecast.probable || [];
  const openPos: RecordData = forecast.committed_purchase_orders || {};
  const poByHorizon: RecordData[] = openPos.by_horizon || [];
  const clientCollection: RecordData[] = forecast.assumptions?.client_collection || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-mono text-sm uppercase tracking-widest text-signal">Cash Position Command Centre</h2>
          <p className="text-xs text-slate-light mt-0.5">
            Opening cash {money(forecast.opening_cash)} - projected forward from real due dates, open purchase orders and each client&apos;s measured payment delay. No what-if scenarios or Optimistic tier yet.
          </p>
        </div>
        <button onClick={() => void load()} className="flex items-center gap-1.5 text-xs text-slate hover:text-paper"><RefreshCw className="h-3.5 w-3.5" />Refresh</button>
      </div>

      <div className="bg-ink-light border border-ink-mid rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-ink-mid bg-ink/30">
          <span className="font-mono text-xs uppercase tracking-wider text-slate">Projected Cash by Horizon</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-ink-mid text-slate font-mono text-[11px] uppercase tracking-wider">
                <th className="p-3">Tier</th>
                {labels.map((l) => <th key={l} className="p-3 text-right">{l}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-mid">
              <tr>
                <td className="p-3 text-paper font-medium">Committed</td>
                {committed.map((c, idx) => (
                  <td key={idx} className={`p-3 text-right font-mono ${Number(c.projected_cash) < 0 ? "text-red-300" : "text-emerald-300"}`}>{money(c.projected_cash)}</td>
                ))}
              </tr>
              <tr>
                <td className="p-3 text-paper font-medium">Probable</td>
                {probable.map((p, idx) => (
                  <td key={idx} className={`p-3 text-right font-mono ${Number(p.projected_cash) < 0 ? "text-red-300" : "text-amber-300"}`}>{money(p.projected_cash)}</td>
                ))}
              </tr>
              <tr className="bg-ink/20">
                <td className="p-3 text-slate-light text-xs">
                  Open purchase orders
                  <span className="block text-[11px] text-slate">{openPos.count ?? 0} not yet invoiced, {money(openPos.open_value)} - included in Committed</span>
                </td>
                {poByHorizon.map((po, idx) => (
                  <td key={idx} className="p-3 text-right font-mono text-xs text-slate-light">{Number(po.cumulative_outflow) > 0 ? `-${money(po.cumulative_outflow)}` : "-"}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-ink-light border border-ink-mid rounded-lg p-4 flex items-start gap-3">
        <TrendingUp className="h-5 w-5 text-slate mt-0.5" />
        <div>
          <p className="text-sm text-paper">Weighted pipeline (open opportunities): {money(forecast.pipeline?.weighted_pipeline_value)}</p>
          <p className="text-xs text-slate-light mt-1">{forecast.pipeline?.opportunity_count} open opportunities, {money(forecast.pipeline?.total_pipeline_value)} total unweighted value. {forecast.pipeline?.note}</p>
        </div>
      </div>

      <div className="bg-ink-light border border-ink-mid rounded-lg p-4">
        <p className="text-xs text-slate uppercase font-mono tracking-wider mb-2">Assumptions</p>
        <ul className="text-xs text-slate-light space-y-1 list-disc list-inside">
          <li>Each client&apos;s claims are dated by that client&apos;s median days from certification (or submission) to receipt, measured from paid claims with allocated receipts.</li>
          <li>Clients with fewer than {forecast.assumptions?.min_paid_claims_for_measured_delay} measured paid claims use the default: {forecast.assumptions?.client_collection_days_after_certification} days after certification, {forecast.assumptions?.client_collection_days_after_submission} days after submission.</li>
          <li>Open purchase orders fall due at expected delivery plus payment terms (default {forecast.assumptions?.default_supplier_payment_terms_days} days), net of supplier invoices already in the forecast.</li>
          <li>{forecast.assumptions?.note}</li>
        </ul>
      </div>

      <div className="bg-ink-light border border-ink-mid rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-ink-mid bg-ink/30">
          <span className="font-mono text-xs uppercase tracking-wider text-slate">Client Collection Delay</span>
        </div>
        {clientCollection.length === 0 ? (
          <p className="p-4 text-xs text-slate-light">No client receipts in this forecast.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-ink-mid text-slate font-mono text-[11px] uppercase tracking-wider">
                  <th className="p-3">Client</th>
                  <th className="p-3 text-right">Days after certification</th>
                  <th className="p-3 text-right">Days after submission</th>
                  <th className="p-3 text-right">Paid claims measured</th>
                  <th className="p-3">Basis</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-mid">
                {clientCollection.map((c) => (
                  <tr key={c.client_key}>
                    <td className="p-3 text-paper">
                      {c.client_name || "Unnamed client"}
                      {!c.in_forecast && <span className="ml-2 text-[11px] text-slate">(nothing owed now)</span>}
                    </td>
                    <td className="p-3 text-right font-mono">{c.days_after_certification}</td>
                    <td className="p-3 text-right font-mono">{c.days_after_submission}</td>
                    <td className="p-3 text-right font-mono">{c.paid_claims_measured}</td>
                    <td className={`p-3 text-xs ${c.source === "measured" ? "text-emerald-300" : "text-slate-light"}`}>{c.source === "measured" ? "Measured" : "Default - too little history"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
