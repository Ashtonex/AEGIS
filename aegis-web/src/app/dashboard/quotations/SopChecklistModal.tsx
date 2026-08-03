"use client";

import React, { useCallback, useEffect, useState } from "react";
import { X, CheckCircle2, Circle, Loader2, ShieldCheck, AlertTriangle } from "lucide-react";
import { listSopTemplates, getQuotationSopReadiness, startSopInstance, completeSopItem } from "@/lib/api";

interface SopChecklistModalProps {
  quotationId: string;
  quotationLabel: string;
  onClose: () => void;
}

export default function SopChecklistModal({ quotationId, quotationLabel, onClose }: SopChecklistModalProps) {
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [templates, setTemplates] = useState<any[]>([]);
  const [readiness, setReadiness] = useState<{ instances: any[]; missing_required_templates: string[]; ready_to_win: boolean } | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [evidenceNotes, setEvidenceNotes] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setErrorMsg("");
    try {
      const [tmplRes, readyRes] = await Promise.all([
        listSopTemplates("quotation"),
        getQuotationSopReadiness(quotationId),
      ]);
      if (tmplRes.success) setTemplates(tmplRes.data || []);
      if (readyRes.success) setReadiness(readyRes.data ?? null);
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to load SOP checklist data.");
    } finally {
      setLoading(false);
    }
  }, [quotationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const instanceForTemplate = (templateId: string) =>
    readiness?.instances.find((inst) => inst.template_id === templateId);

  const handleStart = async (templateId: string) => {
    setBusyKey(`start:${templateId}`);
    setErrorMsg("");
    try {
      const res = await startSopInstance(templateId, "quotation", quotationId);
      if (!res.success) setErrorMsg(res.message || "Failed to start checklist.");
      await load();
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to start checklist.");
    } finally {
      setBusyKey(null);
    }
  };

  const handleToggleItem = async (instanceId: string, item: any) => {
    const nextChecked = !item.is_checked;
    const note = evidenceNotes[item.id];
    setBusyKey(`item:${item.id}`);
    setErrorMsg("");
    try {
      const res = await completeSopItem(instanceId, item.id, nextChecked, note ? { evidence_note: note } : undefined);
      if (!res.success) setErrorMsg(res.message || "Failed to update checklist item.");
      await load();
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to update checklist item.");
    } finally {
      setBusyKey(null);
    }
  };

  const requiredTemplates = templates.filter((t) => t.blocks_quotation_win);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-2xl max-h-[85vh] overflow-y-auto bg-ink-light border border-ink-mid rounded-sm">
        <div className="flex items-center justify-between border-b border-ink-mid px-5 py-4 sticky top-0 bg-ink-light">
          <div>
            <h3 className="font-display font-semibold text-white flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-signal" /> Required SOP Checklists
            </h3>
            <p className="text-[11px] text-slate mt-0.5">{quotationLabel}</p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 border border-ink-mid rounded-sm text-slate hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {errorMsg && (
            <div className="p-3 border border-red-500/20 bg-red-950/20 rounded-sm flex items-start gap-2 text-red-400 text-xs">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {loading ? (
            <div className="py-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-signal" /></div>
          ) : requiredTemplates.length === 0 ? (
            <p className="text-xs text-slate">No SOP templates are configured to block winning a quotation yet.</p>
          ) : (
            <>
              <div className={`text-xs font-mono px-3 py-2 rounded-sm border ${readiness?.ready_to_win ? "border-emerald-500/30 bg-emerald-950/20 text-emerald-400" : "border-amber-500/30 bg-amber-950/20 text-amber-400"}`}>
                {readiness?.ready_to_win
                  ? "All required SOPs complete - this quotation is clear to mark Won."
                  : `Not ready to win: ${readiness?.missing_required_templates.join(", ")}`}
              </div>

              {requiredTemplates.map((tmpl) => {
                const instance = instanceForTemplate(tmpl.id);
                return (
                  <div key={tmpl.id} className="border border-ink-mid rounded-sm p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold text-white">{tmpl.name}</p>
                        <p className="text-[11px] text-slate">{tmpl.description}</p>
                      </div>
                      {instance ? (
                        <span className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded-sm border ${instance.status === "complete" ? "border-emerald-500/30 text-emerald-400" : "border-amber-500/30 text-amber-400"}`}>
                          {instance.status}
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleStart(tmpl.id)}
                          disabled={busyKey === `start:${tmpl.id}`}
                          className="text-[10px] font-mono uppercase px-3 py-1.5 border border-signal/40 text-signal rounded-sm hover:bg-signal/10 disabled:opacity-50"
                        >
                          {busyKey === `start:${tmpl.id}` ? "Starting..." : "Start Checklist"}
                        </button>
                      )}
                    </div>

                    {instance && (
                      <div className="space-y-2 pt-2 border-t border-ink-mid/40">
                        {instance.items.map((item: any) => (
                          <div key={item.id} className="flex items-start gap-2 text-xs">
                            <button
                              type="button"
                              onClick={() => handleToggleItem(instance.id, item)}
                              disabled={busyKey === `item:${item.id}`}
                              className="mt-0.5 shrink-0 disabled:opacity-50"
                            >
                              {item.is_checked ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <Circle className="w-4 h-4 text-slate" />}
                            </button>
                            <div className="flex-1">
                              <p className={item.is_checked ? "text-slate-light line-through" : "text-paper"}>
                                {item.item_label}
                                {item.requires_independent_reviewer && (
                                  <span className="ml-1.5 text-[9px] font-mono uppercase text-amber-400">independent reviewer</span>
                                )}
                                {item.requires_evidence && (
                                  <span className="ml-1.5 text-[9px] font-mono uppercase text-slate">evidence required</span>
                                )}
                              </p>
                              {item.is_checked ? (
                                <p className="text-[10px] text-slate mt-0.5">
                                  Checked by {item.checked_by ? item.checked_by.slice(0, 8) : "?"} on {item.checked_at ? new Date(item.checked_at).toLocaleString() : ""}
                                  {item.evidence_note ? ` — "${item.evidence_note}"` : ""}
                                </p>
                              ) : (
                                (item.requires_evidence) && (
                                  <input
                                    type="text"
                                    placeholder="Evidence note (required to check this off)"
                                    value={evidenceNotes[item.id] || ""}
                                    onChange={(e) => setEvidenceNotes((prev) => ({ ...prev, [item.id]: e.target.value }))}
                                    className="mt-1 w-full bg-ink border border-ink-mid px-2 py-1 text-[11px] text-paper outline-none focus:border-signal"
                                  />
                                )
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
