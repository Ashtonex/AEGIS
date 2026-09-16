"use client";

type RecordData = Record<string, any>;

function money(value: unknown) {
  const num = Number(value);
  return new Intl.NumberFormat("en-ZW", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number.isFinite(num) ? num : 0);
}

function percent(value: unknown) {
  const num = Number(value);
  return `${(Number.isFinite(num) ? num : 0).toFixed(1)}%`;
}

function EmptyPanel({ title, detail }: { title: string; detail: string }) {
  return <div className="border border-dashed border-ink-mid bg-ink p-5 text-center"><p className="text-sm font-semibold text-paper">{title}</p><p className="mt-1 text-xs text-slate-light">{detail}</p></div>;
}

export function ProjectPerformancePanel({ data }: { data: RecordData[] }) {
  return (
    <div className="space-y-6">
      <h3 className="text-xs font-semibold text-paper font-mono uppercase tracking-wider">Project Forecast EAC vs Budget</h3>
      {data.length === 0 ? (
        <EmptyPanel title="No project performance records" detail="Project analytics will populate when project budgets and cost transactions exist." />
      ) : (
        <div className="space-y-4">
          {data.map((p) => {
            const pctVal = Math.min(100, (p.actual_cost / p.budget_value) * 100);
            return (
              <div key={p.id} className="space-y-1">
                <div className="flex justify-between text-xs text-paper">
                  <span>{p.project_name}</span>
                  <span>{percent(pctVal)} spent</span>
                </div>
                <div className="w-full bg-ink h-3 rounded overflow-hidden">
                  <div className="bg-signal h-full" style={{ width: `${pctVal}%` }}></div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function EquipmentIntelPanel({ data }: { data: RecordData[] }) {
  return (
    <div className="space-y-6">
      <h3 className="text-xs font-semibold text-paper font-mono uppercase tracking-wider">Asset Utilisation Ratios</h3>
      {data.length === 0 ? <EmptyPanel title="No fleet utilisation records" detail="Equipment intelligence will populate from fleet utilisation logs." /> : <div className="space-y-4">{data.map((asset) => { const utilisation = Number(asset.utilisation) || 0; return <div key={String(asset.id)} className="space-y-2"><div className="flex justify-between text-xs text-slate-light font-mono"><span>{asset.asset}</span><span>{percent(utilisation)} utilisation · margin {money(asset.margin)}</span></div><div className="w-full bg-ink h-3 rounded-sm overflow-hidden"><div className={utilisation >= 75 ? "bg-emerald-500 h-full" : "bg-amber-500 h-full"} style={{ width: `${Math.min(100, utilisation)}%` }} /></div></div>; })}</div>}
    </div>
  );
}

export function ProcurementIntelPanel({ data }: { data: RecordData[] }) {
  return (
    <div className="space-y-6">
      <h3 className="text-xs font-semibold text-paper font-mono uppercase tracking-wider">Supplier SLA and matching signals</h3>
      {data.length === 0 ? <EmptyPanel title="No procurement analytics records" detail="Supplier intelligence will populate from purchase orders, GRNs and invoice matching." /> : <div className="space-y-3">{data.map((supplier) => <div key={String(supplier.id)} className="flex items-center justify-between gap-4 border border-ink-mid bg-ink p-3 text-xs"><div><p className="font-semibold text-paper">{supplier.supplier}</p><p className="mt-1 text-slate-light">{supplier.pos_issued} POs · {supplier.quality_issues} invoice/quality issues</p></div><span className="font-mono text-slate-light">{percent(supplier.on_time_delivery_pct)} on time · {Number(supplier.avg_lead_time_days || 0).toFixed(1)}d lead</span></div>)}</div>}
    </div>
  );
}

export function WorkforceIntelPanel({ data }: { data: RecordData[] }) {
  return (
    <div className="space-y-6">
      <h3 className="text-xs font-semibold text-paper font-mono uppercase tracking-wider">Labour Cost Allocation</h3>
      {data.length === 0 ? <EmptyPanel title="No workforce analytics records" detail="Labour allocation will populate from attendance and labour cost transactions." /> : <div className="space-y-4">{data.map((row) => { const maxCost = Math.max(...data.map((item) => Number(item.labour_cost) || 0), 1); const width = ((Number(row.labour_cost) || 0) / maxCost) * 100; return <div key={String(row.id)} className="space-y-1"><div className="flex justify-between text-xs text-paper"><span>{row.project}</span><span className="font-mono">{money(row.labour_cost)} · attendance {percent(row.attendance_rate)} · OT {percent(row.ot_ratio)}</span></div><div className="w-full bg-ink h-3 rounded overflow-hidden"><div className="bg-purple-500 h-full" style={{ width: `${Math.min(100, width)}%` }} /></div></div>; })}</div>}
    </div>
  );
}
