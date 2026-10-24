"use client";

import React, { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import {
  Package,
  Truck,
  ShoppingCart,
  Search,
  RefreshCw,
  Loader2,
  ArrowRight,
  Layers,
  AlertTriangle,
} from "lucide-react";
import { RBACGuard } from "@/components/auth/RBACGuard";
import { DashboardPageHeader } from "@/components/dashboard/DashboardPageHeader";
import { getInternalProjects } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";
import { title, text, type Project } from "../page";

export default function PortfolioMaterialsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const res = await getInternalProjects();
      setProjects(res.data || []);
    } catch {
      setProjects([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const activeProjects = useMemo(() => {
    return projects.filter((p) =>
      ["active", "in progress", "pre_mobilisation"].includes(text(p.status, "").toLowerCase())
    );
  }, [projects]);

  const filtered = useMemo(() => {
    return projects.filter((p) => {
      const q = query.toLowerCase();
      return (
        title(p).toLowerCase().includes(q) ||
        text(p.client_name ?? p.client, "").toLowerCase().includes(q)
      );
    });
  }, [projects, query]);

  return (
    <RBACGuard>
      <div className="min-h-full bg-ink p-4 text-paper sm:p-6 space-y-6">
        <DashboardPageHeader
          eyebrow={{ label: "Supply Chain & Delivery", icon: Package }}
          title="Portfolio Materials Logistics Radar"
          subtitle="Cross-site materials flow, procurement requisitions, and site consumption across all active projects."
          actions={
            <button
              onClick={() => void load()}
              disabled={loading}
              className="inline-flex h-10 items-center gap-2 border border-ink-mid bg-ink-light px-3 font-mono text-xs uppercase tracking-wider text-slate-light hover:border-signal hover:text-paper disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              <span>Refresh Materials</span>
            </button>
          }
        />

        {/* Top KPIs */}
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="border border-ink-mid bg-ink/70 p-4">
            <span className="font-mono text-[10px] uppercase text-slate">Active Sites Demanding Materials</span>
            <p className="mt-1 font-mono text-2xl font-bold text-signal">{activeProjects.length}</p>
            <span className="text-[11px] text-slate-light">Sites with ongoing consumption</span>
          </div>

          <div className="border border-ink-mid bg-ink/70 p-4">
            <span className="font-mono text-[10px] uppercase text-slate">Key Materials Monitored</span>
            <p className="mt-1 font-mono text-2xl font-bold text-paper">Concrete, Steel, Fuel</p>
            <span className="text-[11px] text-slate-light">Critical path bulk site commodities</span>
          </div>

          <div className="border border-ink-mid bg-ink/70 p-4">
            <span className="font-mono text-[10px] uppercase text-slate">Pre-Mobilisation Demands</span>
            <p className="mt-1 font-mono text-2xl font-bold text-amber-300">
              {projects.filter((p) => text(p.status, "").toLowerCase() === "pre_mobilisation").length}
            </p>
            <span className="text-[11px] text-slate-light">Initial procurement packs required</span>
          </div>

          <div className="border border-ink-mid bg-ink/70 p-4">
            <span className="font-mono text-[10px] uppercase text-slate">Central Store Dispatch</span>
            <p className="mt-1 font-mono text-2xl font-bold text-emerald-400">Connected</p>
            <span className="text-[11px] text-slate-light">Linked to AEGIS Supply & Inventory</span>
          </div>
        </section>

        {/* Search */}
        <section className="flex items-center justify-between border-b border-ink-mid/60 pb-4">
          <label className="flex h-10 items-center gap-2 border border-ink-mid bg-ink-light px-3">
            <Search className="h-4 w-4 text-slate" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search site or project..."
              className="w-48 sm:w-64 bg-transparent text-sm outline-none placeholder:text-slate text-paper font-sans"
            />
          </label>

          <span className="font-mono text-xs text-slate-light">
            Showing {filtered.length} Projects
          </span>
        </section>

        {/* Cross-Site Material Logistics List */}
        <section className="border border-ink-mid bg-ink">
          <div className="border-b border-ink-mid p-4 flex items-center justify-between">
            <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-paper">
              Site Materials & Supply Register
            </h3>
            <span className="text-xs text-slate-light font-mono">
              Click any project to inspect its BOQ allowances and receipt batches
            </span>
          </div>

          {loading ? (
            <div className="flex h-48 items-center justify-center gap-3 text-sm text-slate-light font-mono">
              <Loader2 className="h-5 w-5 animate-spin text-signal" />
              Loading cross-site materials radar...
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-light font-mono">
              No projects found for current criteria.
            </div>
          ) : (
            <div className="divide-y divide-ink-mid/40">
              {filtered.map((p) => {
                const st = text(p.status, "planning").toLowerCase();
                const isActive = ["active", "in progress", "live"].includes(st);

                return (
                  <Link
                    key={p.id}
                    href={`/dashboard/projects/${p.id}/materials`}
                    className="block p-4 hover:bg-ink-light/30 transition-colors group"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-display font-bold text-paper text-base group-hover:text-signal transition-colors">
                            {title(p)}
                          </span>
                          <span
                            className={`font-mono text-[10px] uppercase px-2 py-0.5 border ${
                              isActive
                                ? "border-emerald-500/40 bg-emerald-950/20 text-emerald-300"
                                : "border-slate-500/40 bg-slate-950/20 text-slate-300"
                            }`}
                          >
                            {st}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-slate-light">
                          {text(p.client_name ?? p.client, "Internal Client")} {p.location ? `• ${text(p.location)}` : ""}
                        </p>
                      </div>

                      <div className="flex items-center gap-4">
                        <span className="border border-ink-mid bg-ink-light px-3 py-1 text-xs font-mono text-slate-light group-hover:text-paper group-hover:border-signal/50 transition-colors">
                          Inspect Site Supply
                        </span>
                        <ArrowRight className="h-4 w-4 text-slate group-hover:text-signal group-hover:translate-x-1 transition-transform" />
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </RBACGuard>
  );
}
