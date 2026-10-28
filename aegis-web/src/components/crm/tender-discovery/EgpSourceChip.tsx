"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { getTenderEgpSource } from "@/lib/api/tender-discovery";
import { fmtHarare } from "./shared";

/** Shown on a tender that came from e-GP: official link, last check and any
 * source changes waiting for review. Renders nothing for manual tenders or
 * users without discovery access. */
export function EgpSourceChip({ tenderId }: { tenderId: string }) {
  const [data, setData] = useState<{ tender: Record<string, any>; candidate: Record<string, any> | null } | null>(null);

  useEffect(() => {
    getTenderEgpSource(tenderId).then((r) => setData(r.data ?? null)).catch(() => setData(null));
  }, [tenderId]);

  if (!data?.tender?.source_notice_id) return null;
  const { tender, candidate } = data;
  const pending = Number(candidate?.pending_changes || 0);
  return (
    <div className="fixed bottom-3 left-3 z-[75] max-w-[calc(100vw-1.5rem)] rounded-sm border border-[#D4AF37]/30 bg-[#0B0904]/95 px-3 py-2 text-[11px] text-paper shadow-lg">
      <span className="font-mono uppercase tracking-widest text-[#D4AF37]">e-GP {tender.source_reference || tender.source_notice_id}</span>
      <span className="ml-2 text-slate-light">checked {fmtHarare(tender.source_last_checked_at)}</span>
      {pending > 0 && <span className="ml-2 text-sky-300">{pending} change(s) to review</span>}
      <span className="ml-2 inline-flex gap-2">
        {tender.source_url && <a href={tender.source_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-[#D4AF37] hover:underline">notice <ExternalLink className="h-3 w-3" /></a>}
        {candidate && <Link href={`/dashboard/crm/tenders/discovery?candidate=${candidate.id}`} className="text-[#D4AF37] hover:underline">evidence</Link>}
      </span>
    </div>
  );
}
