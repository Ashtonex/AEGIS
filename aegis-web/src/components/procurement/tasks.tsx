"use client";

import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2, Warehouse } from "lucide-react";
import { type Rec, money } from "@/components/procurement/shared";
import { PendingPricingTable } from "@/components/procurement/requests";
import { TASK_GROUPS, type Task, type TaskAction } from "@/components/procurement/journey";

export function MyTasks({
  tasks,
  pricing,
  canPrice,
  saving,
  onAct,
  onConfirmPrice,
}: {
  tasks: Task[];
  pricing: Rec[];
  canPrice: boolean;
  saving: string | null;
  onAct: (action: TaskAction) => void;
  onConfirmPrice: (id: string, unitCost: number) => void;
}) {
  const total = tasks.length + (canPrice ? pricing.length : 0);
  return (
    <div className="space-y-5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-light">
          {total === 0 ? (
            <><CheckCircle2 className="mr-1.5 inline h-4 w-4 text-emerald-300" />You&apos;re all caught up - nothing in procurement is waiting on you.</>
          ) : (
            <><span className="font-semibold text-paper">{total}</span> thing{total === 1 ? "" : "s"} waiting on you. Urgent items are listed first.</>
          )}
        </p>
        <Link href="/dashboard/inventory" className="inline-flex items-center gap-1.5 border border-ink-mid px-3 py-1.5 font-mono text-[10px] uppercase text-slate-light hover:border-signal hover:text-paper">
          <Warehouse className="h-3.5 w-3.5" />Stock &amp; stores are in Inventory
        </Link>
      </div>

      {canPrice && pricing.length > 0 && (
        <section className="border border-ink-mid">
          <header className="border-b border-ink-mid bg-ink-light/40 px-4 py-2.5">
            <p className="font-mono text-[10px] uppercase tracking-widest text-amber-300">To price ({pricing.length})</p>
            <p className="text-xs text-slate-light">Site requested these without a known price - enter the real unit cost.</p>
          </header>
          <PendingPricingTable rows={pricing} saving={saving} onConfirm={onConfirmPrice} />
        </section>
      )}

      {TASK_GROUPS.map((group) => {
        const rows = tasks.filter((t) => t.group === group.key);
        if (!rows.length) return null;
        return (
          <section key={group.key} className="border border-ink-mid">
            <header className="border-b border-ink-mid bg-ink-light/40 px-4 py-2.5">
              <p className="font-mono text-[10px] uppercase tracking-widest text-signal">{group.label} ({rows.length})</p>
            </header>
            <ul className="divide-y divide-ink-mid">
              {rows.map((task) => (
                <li key={task.id} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-ink-light/30">
                  <div className="min-w-0 flex-1">
                    <p className={`flex items-center gap-1.5 text-sm font-semibold ${task.urgent ? "text-red-300" : "text-paper"}`}>
                      {task.urgent && <AlertTriangle className="h-3.5 w-3.5 shrink-0" />}
                      {task.verb}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-slate-light">
                      <span className="font-mono text-signal">{task.title}</span>
                      {task.meta && <> · {task.meta}</>}
                    </p>
                  </div>
                  {task.amount > 0 && <span className="font-mono text-sm text-paper">{money(task.amount)}</span>}
                  <button
                    onClick={() => onAct(task.action)}
                    className="inline-flex h-9 items-center gap-1.5 border border-signal bg-signal/15 px-3 font-mono text-[11px] uppercase text-signal hover:bg-signal/25"
                  >
                    Do it<ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
