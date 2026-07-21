"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, RefreshCw, WifiOff } from "lucide-react";

const MODULE_LABELS: Record<string, string> = {
  executive: "Executive",
  messages: "Messages",
  crm: "CRM",
  projects: "Projects",
  "site-operations": "Site Operations",
  workforce: "Workforce",
  fleet: "Fleet",
  equipment: "Equipment",
  procurement: "Procurement",
  inventory: "Inventory",
  finance: "Finance",
  hr: "HR",
  compliance: "Compliance",
  "client-portal": "Client Portal",
  documents: "Documents",
  reports: "Reports",
  analytics: "Analytics",
  settings: "Settings",
  profile: "Profile",
};

export default function OfflinePage() {
  const searchParams = useSearchParams();
  const moduleKey = searchParams?.get("module")?.toLowerCase() || "dashboard";
  const moduleLabel = MODULE_LABELS[moduleKey] || moduleKey.replace(/-/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
  const fromPath = searchParams?.get("from") || "/dashboard/executive";

  return (
    <main className="min-h-screen bg-ink text-paper flex items-center justify-center px-6 py-12">
      <section className="w-full max-w-xl border border-ink-mid bg-ink-light p-8">
        <div className="mb-6 flex h-12 w-12 items-center justify-center border border-signal/30 bg-signal/10">
          <WifiOff className="h-6 w-6 text-signal" />
        </div>
        <p className="font-mono text-[10px] uppercase tracking-widest text-signal">Offline fallback</p>
        <h1 className="mt-2 text-3xl font-semibold text-paper">{moduleLabel} is unavailable offline</h1>
        <p className="mt-3 max-w-prose text-sm text-slate-light">
          The installed shell is available, but this module needs a live connection to refresh its current data and actions.
          Reconnect and the app will resume from here.
        </p>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-2 border border-signal/40 bg-signal/10 px-4 py-2 font-mono text-xs uppercase tracking-widest text-signal hover:bg-signal/15"
          >
            <RefreshCw className="h-4 w-4" />
            Retry connection
          </button>
          <Link
            href={fromPath}
            className="inline-flex items-center gap-2 border border-ink-mid px-4 py-2 font-mono text-xs uppercase tracking-widest text-slate-light hover:text-paper"
          >
            <ArrowLeft className="h-4 w-4" />
            Return to module
          </Link>
        </div>
      </section>
    </main>
  );
}
