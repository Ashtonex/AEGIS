"use client";

import React, { useState } from "react";
import { useParams } from "next/navigation";
import { AlertTriangle, Plus, ShieldAlert, CheckCircle2, Clock } from "lucide-react";
import { useProject } from "@/context/ProjectWorkspaceContext";
import { formatDate } from "@/lib/utils";

export default function ProjectRisksPage() {
  const params = useParams();
  const projectId = typeof params?.id === "string" ? params.id : "";
  const { detail, refetch } = useProject();

  const risks = detail?.risks || [];
  const changes = detail?.changes || [];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-xl font-bold text-paper sm:text-2xl">
          Risks, Issues & Scope Change Register
        </h2>
        <p className="mt-1 text-xs text-slate-light">
          Identified commercial, technical, and site safety risks with active mitigation treatments.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Risks */}
        <section className="border border-ink-mid bg-ink p-5">
          <div className="border-b border-ink-mid/60 pb-3 flex items-center justify-between">
            <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-paper flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              Risk Register
            </h3>
            <span className="font-mono text-xs text-slate-light">{risks.length} Risks</span>
          </div>

          {risks.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-light font-mono">
              No open project risks currently logged.
            </div>
          ) : (
            <div className="mt-3 divide-y divide-ink-mid/40">
              {risks.map((r, idx) => (
                <div key={idx} className="py-3 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-paper text-xs">
                      {String(r.title || "Identified Risk")}
                    </span>
                    <span className="border border-amber-500/30 bg-amber-950/20 px-1.5 py-0.2 font-mono text-[10px] text-amber-300 uppercase">
                      {String(r.status || "open")}
                    </span>
                  </div>
                  <p className="text-xs text-slate-light leading-relaxed">
                    {String(r.description || "Risk treatment pending review.")}
                  </p>
                  {Boolean(r.response_plan) && (
                    <p className="text-[11px] text-cyan-300 font-mono">
                      Mitigation: {String(r.response_plan)}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Change Requests */}
        <section className="border border-ink-mid bg-ink p-5">
          <div className="border-b border-ink-mid/60 pb-3 flex items-center justify-between">
            <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-paper flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-signal" />
              Change Requests
            </h3>
            <span className="font-mono text-xs text-slate-light">{changes.length} Changes</span>
          </div>

          {changes.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-light font-mono">
              No change requests on file.
            </div>
          ) : (
            <div className="mt-3 divide-y divide-ink-mid/40">
              {changes.map((c, idx) => (
                <div key={idx} className="py-3 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-paper text-xs">
                      {String(c.title || `Change #${idx + 1}`)}
                    </span>
                    <span className="border border-ink-mid bg-ink-light px-1.5 py-0.2 font-mono text-[10px] text-slate-light uppercase">
                      {String(c.status || "pending")}
                    </span>
                  </div>
                  <p className="text-xs text-slate-light">
                    {String(c.rationale || "Scope adjustment pending signoff.")}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
