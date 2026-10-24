"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { LifeBuoy, ArrowRight, AlertTriangle } from "lucide-react";

export default function TicketsRedirectPage() {
  const router = useRouter();
  const [loadError] = useState<string | null>(null);

  useEffect(() => {
    // Preserve any incoming query params (e.g. ticket_id)
    if (typeof window !== "undefined") {
      const search = window.location.search;
      router.replace(`/dashboard/crm/support${search}`);
    } else {
      router.replace("/dashboard/crm/support");
    }
  }, [router]);

  return (
    <div className="min-h-screen bg-[#050505] text-paper flex flex-col items-center justify-center p-6 text-center">
      <LifeBuoy className="w-8 h-8 text-signal animate-spin mb-4" />
      <h2 className="text-base font-bold uppercase tracking-wider mb-2 font-mono">Redirecting to Unified Support Desk...</h2>
      <p className="text-xs text-slate-light max-w-sm mb-4">
        Support ticket lifecycle, SLA policies, comment threads, and file attachments have been consolidated into the unified Support Desk.
      </p>
      {loadError && (
        <div className="text-xs text-rose-400 font-mono mb-4 flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5" />
          <span>{loadError || "Support tickets could not be loaded from the CRM support service."}</span>
        </div>
      )}
      <Link
        href="/dashboard/crm/support"
        className="inline-flex items-center gap-2 px-4 py-2 bg-signal text-ink text-xs font-bold uppercase rounded-sm font-mono"
      >
        Go to Support Desk <ArrowRight className="w-3.5 h-3.5" />
      </Link>
    </div>
  );
}
