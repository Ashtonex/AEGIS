"use client";

import Link from "next/link";
import { ArrowRight, LogIn } from "lucide-react";
import { useAuth } from "@/lib/auth/AuthContext";

/** Shown under a scanned form: signed-in SNC staff jump to the leaf in the
 * stationery register; everyone else gets the sign-in link. (Capturing the
 * form's details from here is the next phase.) */
export function StaffLeafActions({ token }: { token: string }) {
  const { session, sessionLoading } = useAuth();
  if (sessionLoading) return null;
  const target = `/dashboard/finance/stationery?q=${encodeURIComponent(token)}`;

  if (!session) {
    return (
      <div className="border border-[var(--dxl-ink-mid)] p-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[var(--dxl-slate-light)]">SNC staff: sign in to AEGIS, then scan again to open this form in the register.</p>
        <Link
          href="/login"
          className="inline-flex items-center gap-2 px-4 py-2 border border-[var(--dxl-signal)] text-[var(--dxl-signal)] text-sm font-bold uppercase tracking-wide"
        >
          <LogIn className="w-4 h-4" /> Staff sign-in
        </Link>
      </div>
    );
  }

  return (
    <div className="border border-[var(--dxl-signal)]/50 bg-[var(--dxl-ink)] p-5 flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-[var(--dxl-paper)]">You are signed in to AEGIS. Open this leaf in the stationery register.</p>
      <Link
        href={target}
        className="inline-flex items-center gap-2 px-4 py-2 bg-[var(--dxl-signal)] text-[var(--dxl-void)] text-sm font-bold uppercase tracking-wide"
      >
        Open in AEGIS <ArrowRight className="w-4 h-4" />
      </Link>
    </div>
  );
}
