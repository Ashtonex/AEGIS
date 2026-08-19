"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckSquare, Loader2, Square, Trash2, Plus } from "lucide-react";
import {
  getTenderRequirements,
  createTenderRequirement,
  toggleTenderRequirement,
  deleteTenderRequirement,
} from "@/lib/api";

interface RequirementRecord {
  id: string;
  label: string;
  is_satisfied: boolean;
  satisfied_document_id: string | null;
}

function normalizeError(reason: unknown, fallback: string) {
  const message = reason instanceof Error ? reason.message : String(reason ?? "");
  return message || fallback;
}

/**
 * Freeform per-tender submission checklist (crm.tender_requirements). Items
 * are ticked automatically when an uploaded document's file name matches the
 * item's label (see documents.py's _auto_match_tender_requirements) -
 * anything that doesn't match gets ticked by hand here.
 */
export function TenderChecklistPanel({ tenderId }: { tenderId: string }) {
  const [items, setItems] = useState<RequirementRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getTenderRequirements(tenderId);
      if (!res.success || !Array.isArray(res.data)) throw new Error("Checklist did not load.");
      setItems(res.data);
    } catch (e) {
      setError(normalizeError(e, "Checklist did not load."));
    } finally {
      setLoading(false);
    }
  }, [tenderId]);

  useEffect(() => { void load(); }, [load]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const label = newLabel.trim();
    if (!label || adding) return;
    setAdding(true);
    setError(null);
    try {
      const res = await createTenderRequirement(tenderId, label);
      if (!res.success) throw new Error("Checklist item could not be added.");
      setNewLabel("");
      await load();
    } catch (e2) {
      setError(normalizeError(e2, "Checklist item could not be added."));
    } finally {
      setAdding(false);
    }
  };

  const handleToggle = async (item: RequirementRecord) => {
    setBusyId(item.id);
    setError(null);
    const next = !item.is_satisfied;
    setItems((current) => current.map((i) => (i.id === item.id ? { ...i, is_satisfied: next } : i)));
    try {
      const res = await toggleTenderRequirement(tenderId, item.id, next);
      if (!res.success) throw new Error("Checklist item could not be updated.");
    } catch (e) {
      setItems((current) => current.map((i) => (i.id === item.id ? { ...i, is_satisfied: item.is_satisfied } : i)));
      setError(normalizeError(e, "Checklist item could not be updated."));
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (item: RequirementRecord) => {
    setBusyId(item.id);
    setError(null);
    try {
      const res = await deleteTenderRequirement(tenderId, item.id);
      if (!res.success) throw new Error("Checklist item could not be removed.");
      setItems((current) => current.filter((i) => i.id !== item.id));
    } catch (e) {
      setError(normalizeError(e, "Checklist item could not be removed."));
    } finally {
      setBusyId(null);
    }
  };

  const satisfiedCount = items.filter((i) => i.is_satisfied).length;

  return (
    <div className="space-y-3">
      <form onSubmit={handleAdd} className="flex gap-2">
        <input
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          placeholder="e.g. Bid Bond, BOQ, Company Registration…"
          className="flex-1 border border-ink-mid bg-ink-light px-3 py-2 text-sm text-paper"
        />
        <button
          type="submit"
          disabled={adding || !newLabel.trim()}
          className="flex items-center gap-1 border border-ink-mid px-3 py-2 text-xs uppercase text-slate-light hover:text-paper disabled:opacity-40"
        >
          {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Add
        </button>
      </form>

      {error && <p className="text-xs text-red-300">{error}</p>}

      {loading ? (
        <div className="flex items-center justify-center py-6 text-slate-light">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <p className="py-4 text-center text-xs text-slate-light">No checklist items yet. Add what needs to be submitted with this tender.</p>
      ) : (
        <>
          <p className="text-[11px] text-slate-light">{satisfiedCount} of {items.length} complete</p>
          <ul className="divide-y divide-ink-mid border border-ink-mid">
            {items.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-3 p-3">
                <button
                  type="button"
                  disabled={busyId === item.id}
                  onClick={() => void handleToggle(item)}
                  className="flex min-w-0 items-center gap-2.5 text-left disabled:opacity-40"
                >
                  {item.is_satisfied ? (
                    <CheckSquare className="h-4 w-4 shrink-0 text-emerald-400" />
                  ) : (
                    <Square className="h-4 w-4 shrink-0 text-slate-light" />
                  )}
                  <span className={`truncate text-sm ${item.is_satisfied ? "text-slate-light line-through" : "text-paper"}`}>{item.label}</span>
                  {item.satisfied_document_id && (
                    <span className="shrink-0 rounded-sm border border-emerald-500/30 bg-emerald-950/20 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-emerald-400">Auto-matched</span>
                  )}
                </button>
                <button
                  type="button"
                  disabled={busyId === item.id}
                  onClick={() => void handleDelete(item)}
                  title="Remove"
                  className="shrink-0 rounded-sm p-1.5 text-slate-light hover:bg-red-950/40 hover:text-red-300 disabled:opacity-40"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
