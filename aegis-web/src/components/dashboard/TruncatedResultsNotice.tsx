"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { AlertTriangle, X } from "lucide-react";
import { RESULTS_TRUNCATED_EVENT, type ResultsTruncatedDetail } from "@/lib/api/core";

/** Shown when the API returned only the first N rows of a longer list
 * (X-Results-Truncated header), so a capped list is never mistaken for the
 * whole record set. Clears on navigation. */
export function TruncatedResultsNotice() {
  const pathname = usePathname();
  const [limit, setLimit] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setLimit(null);
    setDismissed(false);
  }, [pathname]);

  useEffect(() => {
    const onTruncated = (event: Event) => {
      const detail = (event as CustomEvent<ResultsTruncatedDetail>).detail;
      if (!detail?.limit) return;
      setLimit((current) => (current == null ? detail.limit : Math.min(current, detail.limit)));
    };
    window.addEventListener(RESULTS_TRUNCATED_EVENT, onTruncated);
    return () => window.removeEventListener(RESULTS_TRUNCATED_EVENT, onTruncated);
  }, []);

  if (limit == null || dismissed) return null;
  return (
    <div role="status" className="sticky top-0 z-30 flex items-center gap-3 border-b border-amber-500/40 bg-amber-950/80 px-4 py-2 text-sm text-amber-100 backdrop-blur">
      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-300" />
      <span className="flex-1">
        A list on this page is showing only its first <b>{limit.toLocaleString()}</b> records. Use search or filters to find records further down.
      </span>
      <button type="button" onClick={() => setDismissed(true)} className="text-amber-200 hover:text-white" aria-label="Dismiss">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
