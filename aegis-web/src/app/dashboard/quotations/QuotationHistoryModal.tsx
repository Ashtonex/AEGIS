"use client";

import React, { useEffect, useState } from "react";
import { X, History, Loader2, AlertTriangle, Plus, Pencil, Trash2 } from "lucide-react";
import { getQuotationHistory } from "@/lib/api";

interface QuotationHistoryModalProps {
  quotationId: string;
  quotationLabel: string;
  onClose: () => void;
}

const FIELD_LABELS: Record<string, string> = {
  client_name: "Client",
  quote_amount: "Estimate total",
  status: "Status",
  project_id: "Linked project",
  is_deleted: "Archived state",
};

const ACTION_ICON: Record<string, React.ReactNode> = {
  INSERT: <Plus className="w-3.5 h-3.5 text-emerald-400" />,
  UPDATE: <Pencil className="w-3.5 h-3.5 text-signal" />,
  DELETE: <Trash2 className="w-3.5 h-3.5 text-rose-400" />,
};

export default function QuotationHistoryModal({ quotationId, quotationLabel, onClose }: QuotationHistoryModalProps) {
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [events, setEvents] = useState<any[]>([]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setErrorMsg("");
      try {
        const res = await getQuotationHistory(quotationId);
        if (res.success) setEvents(res.data || []);
        else setErrorMsg(res.message || "Failed to load quotation history.");
      } catch (err: any) {
        setErrorMsg(err?.message || "Failed to load quotation history.");
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [quotationId]);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-xl max-h-[85vh] overflow-y-auto bg-ink-light border border-ink-mid rounded-sm">
        <div className="flex items-center justify-between border-b border-ink-mid px-5 py-4 sticky top-0 bg-ink-light">
          <div>
            <h3 className="font-display font-semibold text-white flex items-center gap-2">
              <History className="w-4 h-4 text-signal" /> Revision History
            </h3>
            <p className="text-[11px] text-slate mt-0.5">{quotationLabel}</p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 border border-ink-mid rounded-sm text-slate hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-3">
          {errorMsg && (
            <div className="p-3 border border-red-500/20 bg-red-950/20 rounded-sm flex items-start gap-2 text-red-400 text-xs">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {loading ? (
            <div className="py-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-signal" /></div>
          ) : events.length === 0 ? (
            <p className="text-xs text-slate">No recorded changes for this quotation yet.</p>
          ) : (
            events.map((ev) => (
              <div key={ev.id} className="flex items-start gap-3 border border-ink-mid bg-ink p-3 text-xs">
                <div className="mt-0.5 shrink-0">{ACTION_ICON[ev.action] || <Pencil className="w-3.5 h-3.5 text-slate" />}</div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-white capitalize">{ev.action.toLowerCase()}</span>
                    <span className="font-mono text-[10px] text-slate">{ev.created_at ? new Date(ev.created_at).toLocaleString() : ""}</span>
                  </div>
                  <p className="text-slate mt-0.5">
                    {ev.actor_name || ev.actor_email || "Unknown user"}
                  </p>
                  {ev.changed_fields?.length > 0 && (
                    <p className="text-[10px] font-mono uppercase text-slate-light mt-1">
                      Changed: {ev.changed_fields.map((f: string) => FIELD_LABELS[f] || f).join(", ")}
                    </p>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
