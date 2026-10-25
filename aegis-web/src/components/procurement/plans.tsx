"use client";

import { useCallback, useEffect, useState } from "react";
import { ClipboardList, Loader2, Plus, RefreshCw, Trash2, X } from "lucide-react";
import {
  addProcurementPlanItems,
  deleteProcurementPlanItem,
  getProcurementPlan,
  syncProcurementPlan,
  updateProcurementPlanItem,
  type ProcurementPlan,
  type ProcurementPlanItem,
} from "@/lib/api";
import { type Rec, Banner, EmptyState, dt, money, normalizeActionError, num, tx } from "@/components/procurement/shared";
import { parseMaterialsList } from "@/components/procurement/materials";

export const PLAN_STAGES: { key: string; label: string; detail: string }[] = [
  { key: "planning", label: "Planning", detail: "BOQ uploaded - list what the job needs and set budget prices." },
  { key: "sourcing", label: "Quotes", detail: "Deal won - the plan is an active purchase request; get supplier quotes." },
  { key: "ordering", label: "POs", detail: "Pending deposit - raise purchase orders for finance sign-off." },
  { key: "executing", label: "Issue & deliver", detail: "Deposit in - issue the POs before mobilisation, track deliveries." },
  { key: "reconciling", label: "Reconcile", detail: "Job complete - verify PO, delivery and paid invoice; record savings." },
];

function StageStrip({ stage }: { stage: string }) {
  const index = PLAN_STAGES.findIndex((s) => s.key === stage);
  return (
    <ol className="flex flex-wrap gap-1">
      {PLAN_STAGES.map((s, i) => (
        <li key={s.key} title={s.detail}
          className={`border px-2 py-0.5 font-mono text-[9px] uppercase ${i < index ? "border-emerald-500/30 text-emerald-300" : i === index ? "border-signal bg-signal/15 text-signal" : "border-ink-mid text-slate"}`}>
          {s.label}
        </li>
      ))}
    </ol>
  );
}

export function PlansView({
  plans,
  projects,
  onOpen,
  onStarted,
}: {
  plans: ProcurementPlan[];
  projects: Rec[];
  onOpen: (planId: string) => void;
  onStarted: (plan: ProcurementPlan) => void;
}) {
  const [projectId, setProjectId] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const withPlan = new Set(plans.map((p) => p.project_id).filter(Boolean));
  const start = async () => {
    if (!projectId) return;
    setStarting(true);
    setError(null);
    try {
      const res = await syncProcurementPlan({ project_id: projectId });
      setProjectId("");
      if (res.data) onStarted(res.data);
    } catch (e) {
      setError(normalizeActionError(e, "Could not start the plan."));
    } finally {
      setStarting(false);
    }
  };
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-ink-mid bg-ink-light/30 p-3">
        <p className="mr-auto text-xs text-slate-light">
          Plans start automatically when a BOQ is uploaded on an opportunity, then follow the job: won, deposit, mobilisation, completion.
          For a job already underway, start one here.
        </p>
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="h-9 border border-ink-mid bg-ink-light px-3 text-sm text-paper">
          <option value="">Start a plan for a project…</option>
          {projects.filter((p) => !withPlan.has(p.id)).map((p) => (
            <option key={p.id} value={p.id}>{tx(p.name ?? p.project_name ?? p.project_code, p.id)}</option>
          ))}
        </select>
        <button onClick={() => void start()} disabled={!projectId || starting}
          className="inline-flex h-9 items-center gap-2 bg-signal px-3 font-mono text-xs font-bold uppercase text-ink disabled:opacity-40">
          {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Start plan
        </button>
      </div>
      {error && <div className="p-3"><Banner tone="error" message={error} /></div>}
      {plans.length === 0 ? (
        <EmptyState label="No procurement plans yet." sub="Upload a BOQ on an opportunity, or start a plan for a project above." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-ink-mid bg-ink-light/50 text-left">
                {["Plan", "Stage", "Items", "Budget", "Purchase request", "Open tasks", "Updated"].map((h) => (
                  <th key={h} className="px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-slate">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-mid">
              {plans.map((plan) => (
                <tr key={plan.id} onClick={() => onOpen(plan.id)} className="cursor-pointer hover:bg-ink-light/40">
                  <td className="px-4 py-3">
                    <p className="text-paper">{plan.title}</p>
                    <p className="text-xs text-slate-light">{plan.project_name ? `Project · ${plan.project_name}` : `Opportunity · ${tx(plan.opportunity_name)}`}</p>
                  </td>
                  <td className="px-4 py-3"><StageStrip stage={plan.stage} /></td>
                  <td className="px-4 py-3 font-mono text-paper">{num(plan.item_count)}</td>
                  <td className="px-4 py-3 font-mono text-paper">{num(plan.budget_total) > 0 ? money(plan.budget_total) : <span className="text-slate">not set</span>}</td>
                  <td className="px-4 py-3 font-mono text-xs text-signal">{plan.requisition_number ?? "—"}</td>
                  <td className={`px-4 py-3 font-mono ${num(plan.open_tasks) > 0 ? "text-amber-300" : "text-slate"}`}>{num(plan.open_tasks)}</td>
                  <td className="px-4 py-3 text-xs text-slate-light">{dt(plan.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

type Draft = { description: string; quantity: string; unit_of_measure: string; budget_unit_cost: string };
const cell = "h-8 w-full border border-transparent bg-transparent px-1.5 text-sm text-paper hover:border-ink-mid focus:border-signal focus:bg-ink-light outline-none";

export function PlanDrawer({ planId, onClose, onChanged }: { planId: string; onClose: () => void; onChanged: () => void }) {
  const [plan, setPlan] = useState<ProcurementPlan | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [newItem, setNewItem] = useState<Draft>({ description: "", quantity: "", unit_of_measure: "each", budget_unit_cost: "" });
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await getProcurementPlan(planId);
      if (!res.data) throw new Error("Procurement plan not found.");
      const loaded = res.data;
      setPlan(loaded);
      const next: Record<string, Draft> = {};
      for (const item of loaded.items ?? []) {
        next[item.id] = { description: item.description, quantity: String(num(item.quantity)), unit_of_measure: item.unit_of_measure, budget_unit_cost: String(num(item.budget_unit_cost)) };
      }
      setDrafts(next);
    } catch (e) {
      setError(normalizeActionError(e, "Could not load the plan."));
    }
  }, [planId]);
  useEffect(() => { void load(); }, [load]);

  const run = async (key: string, action: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await action();
      await load();
      onChanged();
    } catch (e) {
      setError(normalizeActionError(e, "That change could not be saved."));
    } finally {
      setBusy(null);
    }
  };

  const saveItem = (item: ProcurementPlanItem) => {
    const d = drafts[item.id];
    if (!d) return;
    const patch: Record<string, unknown> = {};
    if (d.description.trim() && d.description.trim() !== item.description) patch.description = d.description.trim();
    if (num(d.quantity) !== num(item.quantity)) patch.quantity = num(d.quantity);
    if (d.unit_of_measure.trim() && d.unit_of_measure !== item.unit_of_measure) patch.unit_of_measure = d.unit_of_measure.trim().slice(0, 40);
    if (num(d.budget_unit_cost) !== num(item.budget_unit_cost)) patch.budget_unit_cost = num(d.budget_unit_cost);
    if (Object.keys(patch).length) void run(`save-${item.id}`, () => updateProcurementPlanItem(planId, item.id, patch));
  };

  const addOne = () => {
    if (!newItem.description.trim()) return;
    void run("add", async () => {
      await addProcurementPlanItems(planId, [{
        description: newItem.description.trim(), quantity: num(newItem.quantity), unit_of_measure: newItem.unit_of_measure || "each",
        budget_unit_cost: num(newItem.budget_unit_cost), source: "manual",
      }]);
      setNewItem({ description: "", quantity: "", unit_of_measure: "each", budget_unit_cost: "" });
    });
  };

  const addPasted = () => {
    const { lines } = parseMaterialsList(pasted);
    if (!lines.length) { setError("No items with quantities were found in that list."); return; }
    void run("paste", async () => {
      await addProcurementPlanItems(planId, lines.map((l) => ({ description: l.description, quantity: l.qty, unit_of_measure: l.uom, source: "import" as const })));
      setPasted("");
      setPasting(false);
    });
  };

  const refresh = () => plan && void run("sync", () => syncProcurementPlan(plan.project_id ? { project_id: plan.project_id } : { opportunity_id: plan.opportunity_id ?? undefined }));
  const items = plan?.items ?? [];
  const total = items.reduce((sum, i) => sum + num(drafts[i.id]?.quantity ?? i.quantity) * num(drafts[i.id]?.budget_unit_cost ?? i.budget_unit_cost), 0);
  const stage = PLAN_STAGES.find((s) => s.key === plan?.stage);

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm">
      <aside className="ml-auto flex h-full w-full max-w-5xl flex-col overflow-y-auto border-l border-ink-mid bg-ink text-paper shadow-2xl">
        <header className="sticky top-0 z-10 flex flex-wrap items-start justify-between gap-3 border-b border-ink-mid bg-ink p-5">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-signal"><ClipboardList className="h-3.5 w-3.5" />Procurement plan</p>
            <h2 className="mt-1 text-xl font-semibold">{plan?.title ?? "Loading…"}</h2>
            {plan && <div className="mt-2"><StageStrip stage={plan.stage} /></div>}
            {stage && <p className="mt-1.5 text-xs text-slate-light">{stage.detail}</p>}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={refresh} disabled={!plan || busy === "sync"} title="Re-check the job's stage and issue any task packs it has reached"
              className="inline-flex h-9 items-center gap-1.5 border border-ink-mid px-3 font-mono text-[11px] uppercase text-slate-light hover:border-signal hover:text-paper disabled:opacity-40">
              {busy === "sync" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}Refresh stage &amp; tasks
            </button>
            <button onClick={onClose} className="border border-ink-mid p-2 text-slate-light hover:border-signal hover:text-paper"><X className="h-5 w-5" /></button>
          </div>
        </header>

        <div className="space-y-4 p-5">
          {error && <Banner tone="error" message={error} />}
          {plan?.requisition_number && (
            <Banner tone="info" message={`This plan became purchase request ${plan.requisition_number} when the deal was won. Changes here update the plan (your budget baseline), not that request.`} />
          )}

          <section className="border border-ink-mid">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-mid bg-ink-light/40 px-3 py-2">
              <p className="font-mono text-[10px] uppercase tracking-widest text-slate">{items.length} item{items.length === 1 ? "" : "s"} · budget <span className="text-paper">{money(total)}</span></p>
              <button onClick={() => setPasting((v) => !v)} className="font-mono text-[10px] uppercase text-signal hover:underline">{pasting ? "Cancel" : "Add from a list"}</button>
            </header>
            {pasting && (
              <div className="space-y-2 border-b border-ink-mid p-3">
                <textarea value={pasted} onChange={(e) => setPasted(e.target.value)} rows={8} placeholder={"Paste a materials list - one item per line with its quantity\nGum poles 6mx150 dia. – 216\nWire nails 4 inch – 80kg"}
                  className="w-full resize-y border border-ink-mid bg-ink-light p-2 font-mono text-xs text-paper" />
                <button onClick={addPasted} disabled={!pasted.trim() || busy === "paste"}
                  className="inline-flex h-8 items-center gap-1.5 bg-signal px-3 font-mono text-[11px] font-bold uppercase text-ink disabled:opacity-40">
                  {busy === "paste" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Add these items
                </button>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <thead>
                  <tr className="border-b border-ink-mid text-left">
                    {["Item", "Qty", "Unit", "Budget price", "Budget", "From", ""].map((h) => (
                      <th key={h} className="px-2 py-2 font-mono text-[10px] uppercase tracking-wider text-slate">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-mid">
                  {items.map((item) => {
                    const d = drafts[item.id] ?? { description: item.description, quantity: String(item.quantity), unit_of_measure: item.unit_of_measure, budget_unit_cost: String(item.budget_unit_cost) };
                    const set = (patch: Partial<Draft>) => setDrafts((prev) => ({ ...prev, [item.id]: { ...d, ...patch } }));
                    return (
                      <tr key={item.id}>
                        <td className="px-2 py-1"><input value={d.description} onChange={(e) => set({ description: e.target.value })} onBlur={() => saveItem(item)} className={cell} /></td>
                        <td className="w-24 px-2 py-1"><input value={d.quantity} inputMode="decimal" onChange={(e) => set({ quantity: e.target.value })} onBlur={() => saveItem(item)} className={`${cell} text-right font-mono`} /></td>
                        <td className="w-24 px-2 py-1"><input value={d.unit_of_measure} onChange={(e) => set({ unit_of_measure: e.target.value })} onBlur={() => saveItem(item)} className={cell} /></td>
                        <td className="w-28 px-2 py-1"><input value={d.budget_unit_cost} inputMode="decimal" onChange={(e) => set({ budget_unit_cost: e.target.value })} onBlur={() => saveItem(item)} className={`${cell} text-right font-mono`} /></td>
                        <td className="w-28 px-2 py-1 text-right font-mono text-paper">{money(num(d.quantity) * num(d.budget_unit_cost))}</td>
                        <td className="w-24 px-2 py-1 font-mono text-[10px] uppercase text-slate" title={item.source_ref ?? undefined}>{item.source === "boq" ? "BOQ" : item.source}</td>
                        <td className="w-10 px-2 py-1">
                          <button onClick={() => void run(`del-${item.id}`, () => deleteProcurementPlanItem(planId, item.id))} disabled={busy === `del-${item.id}`} title="Remove from the plan"
                            className="p-1 text-slate hover:text-red-300 disabled:opacity-40"><Trash2 className="h-3.5 w-3.5" /></button>
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="bg-ink-light/20">
                    <td className="px-2 py-1"><input value={newItem.description} onChange={(e) => setNewItem({ ...newItem, description: e.target.value })} placeholder="Add an item…" className={cell} onKeyDown={(e) => e.key === "Enter" && addOne()} /></td>
                    <td className="px-2 py-1"><input value={newItem.quantity} inputMode="decimal" onChange={(e) => setNewItem({ ...newItem, quantity: e.target.value })} placeholder="0" className={`${cell} text-right font-mono`} /></td>
                    <td className="px-2 py-1"><input value={newItem.unit_of_measure} onChange={(e) => setNewItem({ ...newItem, unit_of_measure: e.target.value })} className={cell} /></td>
                    <td className="px-2 py-1"><input value={newItem.budget_unit_cost} inputMode="decimal" onChange={(e) => setNewItem({ ...newItem, budget_unit_cost: e.target.value })} placeholder="0.00" className={`${cell} text-right font-mono`} /></td>
                    <td colSpan={3} className="px-2 py-1">
                      <button onClick={addOne} disabled={!newItem.description.trim() || busy === "add"}
                        className="inline-flex h-8 items-center gap-1 border border-signal/60 px-2 font-mono text-[10px] uppercase text-signal disabled:opacity-40">
                        {busy === "add" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}Add
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
          <p className="text-[11px] text-slate">Edits save when you leave a field. BOQ lines are a starting point - the BOQ lists work, so turn them into the materials you will actually buy.</p>
        </div>
      </aside>
    </div>
  );
}
