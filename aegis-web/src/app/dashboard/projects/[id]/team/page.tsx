"use client";

import React from "react";
import { useParams } from "next/navigation";
import { Users, HardHat, ShieldCheck, Mail, Phone, Calendar } from "lucide-react";
import { useProject } from "@/context/ProjectWorkspaceContext";
import { formatDate } from "@/lib/utils";

export default function ProjectTeamPage() {
  const params = useParams();
  const projectId = typeof params?.id === "string" ? params.id : "";
  const { team, loading } = useProject();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-xl font-bold text-paper sm:text-2xl">
          Project Workforce & Team Roster
        </h2>
        <p className="mt-1 text-xs text-slate-light">
          Active personnel, supervisors, artisans, and subcontractors allocated directly from HR master records.
        </p>
      </div>

      <section className="border border-ink-mid bg-ink">
        <div className="border-b border-ink-mid p-4 flex items-center justify-between">
          <span className="font-mono text-xs font-bold uppercase tracking-wider text-paper">
            Allocated Staff & Artisans
          </span>
          <span className="font-mono text-xs text-slate-light">
            {team.length} Team Members
          </span>
        </div>

        {team.length === 0 ? (
          <div className="py-12 text-center text-xs text-slate-light font-mono">
            No personnel currently allocated to this project in HR.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-ink-mid bg-ink-light/50 font-mono text-[11px] text-slate uppercase tracking-wider">
                  <th className="py-2.5 px-4">Name / ID</th>
                  <th className="py-2.5 px-4">Job Title / Role</th>
                  <th className="py-2.5 px-4">Trade / Category</th>
                  <th className="py-2.5 px-4 text-center">Allocation</th>
                  <th className="py-2.5 px-4">Starts On</th>
                  <th className="py-2.5 px-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-mid/40 font-mono">
                {team.map((m, idx) => (
                  <tr key={idx} className="hover:bg-ink-light/30 transition-colors">
                    <td className="py-3 px-4">
                      <span className="font-medium text-paper block font-sans text-xs">
                        {m.employee_name || "Artisan"}
                      </span>
                      <span className="text-[10px] text-slate-light font-mono">
                        {m.employee_number || "EMP"}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-paper">
                      {m.job_title || m.role_on_project || "Site Worker"}
                    </td>
                    <td className="py-3 px-4 text-slate-light">
                      {m.trade || m.category_name || "General"}
                    </td>
                    <td className="py-3 px-4 text-center text-signal font-bold">
                      {m.allocation_percent ? `${m.allocation_percent}%` : "100%"}
                    </td>
                    <td className="py-3 px-4 text-slate-light">
                      {formatDate(String(m.starts_on || m.created_at || ""))}
                    </td>
                    <td className="py-3 px-4">
                      <span className="border border-emerald-500/30 bg-emerald-950/20 px-2 py-0.5 text-[10px] uppercase text-emerald-400">
                        {m.status || "active"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
