"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft, Loader2, AlertCircle, BookOpen, Clock
} from "lucide-react";
import { getQuotations } from "@/lib/api";
import { useAuth } from "@/lib/auth/AuthContext";

export default function QuotationHistory() {
  const { session } = useAuth();
  const [quotes, setQuotes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  const loadQuotes = useCallback(async () => {
    setLoading(true);
    setErrorMsg("");
    try {
      const res = await getQuotations();
      if (res.success && Array.isArray(res.data)) {
        setQuotes(res.data);
      } else {
        setQuotes([]);
      }
    } catch (err: any) {
      setErrorMsg("Failed to load historical estimate indexes.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (session) {
      void loadQuotes();
    }
  }, [session, loadQuotes]);

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 text-paper">

      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-ink-mid pb-6">
        <div>
          <div className="flex items-center space-x-2">
            <Link
              href="/dashboard/quotations"
              className="text-xs font-mono text-slate hover:text-white flex items-center gap-1 uppercase transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Back to Dashboard
            </Link>
          </div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-white mt-2 flex items-center gap-3">
            <BookOpen className="w-6 h-6 text-signal" />
            Cost Archives &amp; Export Command
          </h1>
          <p className="text-xs text-slate mt-1">
            Audit log of every quotation revision and export.
          </p>
        </div>
      </div>

      {errorMsg && (
        <div className="p-4 border border-red-500/20 bg-red-950/20 rounded-sm flex items-center space-x-3 text-red-400 text-sm">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      <div className="bg-ink-light border border-ink-mid p-6 rounded-sm space-y-6">
        <div>
          <h2 className="font-display font-semibold text-lg text-white">Generated Proposals Index</h2>
          <p className="text-xs text-slate">Audit logs of all cost proposal runs and dynamic file caches.</p>
        </div>

        {loading ? (
          <div className="py-20 flex flex-col items-center justify-center space-y-3">
            <Loader2 className="w-8 h-8 text-signal animate-spin" />
            <span className="text-xs text-slate font-mono uppercase">Syncing file records...</span>
          </div>
        ) : quotes.length === 0 ? (
          <div className="py-20 border border-dashed border-ink-mid rounded-sm flex flex-col items-center justify-center space-y-4">
            <Clock className="w-12 h-12 text-slate/40" />
            <p className="text-sm font-semibold text-white">No historical records found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-ink-mid text-slate font-mono uppercase tracking-wider text-[10px]">
                  <th className="pb-3 font-normal">Reference</th>
                  <th className="pb-3 font-normal">Client Name</th>
                  <th className="pb-3 font-normal">Project Scope</th>
                  <th className="pb-3 font-normal text-right">Base Amount</th>
                  <th className="pb-3 font-normal text-center">Audit Hash</th>
                  <th className="pb-3 font-normal text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {quotes.map((q) => {
                  const refNum = q.metadata?.reference_number || q.id.slice(0, 8).toUpperCase();
                  const title = q.metadata?.project_title || "Untitled Cost Structure";
                  const hash = q.metadata?.audit_trail_hash || "SECURE-HASH-NONE";
                  return (
                    <tr key={q.id} className="border-b border-ink-mid/30 hover:bg-white/[0.01]">
                      <td className="py-4 font-mono text-white font-semibold">{refNum}</td>
                      <td className="py-4 text-slate-light">{q.client_name}</td>
                      <td className="py-4 text-slate">{title}</td>
                      <td className="py-4 text-right font-mono text-white">
                        ${Number(q.quote_amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-4 text-center font-mono text-slate text-[10px] max-w-[120px] truncate" title={hash}>
                        {hash}
                      </td>
                      <td className="py-4 text-right">
                        <Link
                          href={`/dashboard/quotations/builder?edit=${q.id}`}
                          className="bg-ink border border-ink-mid text-slate hover:text-white px-3 py-1.5 text-[10px] font-mono rounded-sm transition-colors"
                        >
                          Open Builder
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
}
