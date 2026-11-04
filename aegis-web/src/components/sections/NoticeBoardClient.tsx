"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Calendar, FolderOpen, Search } from "lucide-react";
import type { ProcurementNotice, ProcurementNoticeStatus } from "@/types/website";
import { FormField } from "../ui/FormField";
import { EmptyState } from "../ui/EmptyState";
import { NoticeStatusBadge } from "./NoticeStatusBadge";

const STATUS_FILTERS: { label: string; value: "" | ProcurementNoticeStatus }[] = [
  { label: "All statuses", value: "" },
  { label: "Active", value: "open" },
  { label: "Under evaluation", value: "evaluating" },
  { label: "Awarded", value: "awarded" },
  { label: "In delivery", value: "in_delivery" },
  { label: "Fulfilled", value: "fulfilled" },
  { label: "Dormant", value: "dormant" },
  { label: "Cancelled", value: "cancelled" },
];

// Active notices first, then the rest newest first.
const ORDER: Record<ProcurementNoticeStatus, number> = {
  open: 0, evaluating: 1, awarded: 2, in_delivery: 2, dormant: 3, fulfilled: 4, cancelled: 5,
};

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Harare" });
}

export function NoticeBoardClient({ notices }: { notices: ProcurementNotice[] }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"" | ProcurementNoticeStatus>("");

  const shown = useMemo(() => {
    const term = search.trim().toLowerCase();
    return notices
      .filter((n) => !status || n.status === status)
      .filter(
        (n) =>
          !term ||
          [n.reference, n.title, n.project, n.description].some((v) => (v || "").toLowerCase().includes(term)),
      )
      .sort(
        (a, b) =>
          ORDER[a.status] - ORDER[b.status] ||
          new Date(b.published_at || 0).getTime() - new Date(a.published_at || 0).getTime(),
      );
  }, [notices, search, status]);

  return (
    <>
      <div className="flex flex-col md:flex-row gap-4 mb-8">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate z-10" />
          <FormField
            className="pl-12 w-full mb-0 bg-ink border-ink-mid text-paper placeholder:text-slate focus:border-signal"
            containerClassName="mb-0"
            placeholder="Search by reference, title or project..."
            aria-label="Search notices"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <FormField
          as="select"
          containerClassName="mb-0 w-full md:w-56"
          className="mb-0 text-slate-light bg-ink border-ink-mid focus:border-signal"
          aria-label="Filter by status"
          value={status}
          onChange={(e) => setStatus(e.target.value as "" | ProcurementNoticeStatus)}
          options={STATUS_FILTERS}
        />
      </div>

      <div className="bg-ink border border-ink-mid rounded-[4px] overflow-hidden mb-16">
        <div className="hidden lg:grid grid-cols-12 gap-6 p-4 border-b border-ink-mid bg-ink-mid font-sans text-[11px] font-semibold tracking-widest uppercase text-slate">
          <div className="col-span-3">Reference</div>
          <div className="col-span-5">Notice</div>
          <div className="col-span-3">Dates</div>
          <div className="col-span-1" />
        </div>
        {shown.length === 0 ? (
          <EmptyState
            icon={FolderOpen}
            title="No notices found"
            description={notices.length === 0 ? "There are no procurement notices yet." : "No notices match your search."}
          />
        ) : (
          <ul className="flex flex-col">
            {shown.map((n) => (
              <li key={n.reference}>
                <Link
                  href={`/tenders/${encodeURIComponent(n.reference)}`}
                  className="grid grid-cols-1 lg:grid-cols-12 gap-3 lg:gap-6 p-6 border-b border-ink-mid bg-void hover:bg-ink-light/50 transition-colors group"
                >
                  <div className="lg:col-span-3 flex flex-col items-start gap-2 min-w-0">
                    <span className="text-[12px] font-mono text-slate break-all">{n.reference}</span>
                    <NoticeStatusBadge status={n.status} label={n.status_label} />
                  </div>
                  <div className="lg:col-span-5 min-w-0">
                    <h3 className="font-sans font-semibold text-[15px] text-paper group-hover:text-signal transition-colors mb-1 break-words">
                      {n.title}
                    </h3>
                    <p className="text-[12px] text-slate-light">
                      {n.type}
                      {n.project ? ` · ${n.project}` : ""}
                    </p>
                  </div>
                  <div className="lg:col-span-3 flex flex-col gap-1 text-[13px] text-slate-light">
                    <span className="flex items-center gap-2">
                      <Calendar className="w-3.5 h-3.5 text-slate shrink-0" /> Issued {formatDate(n.published_at)}
                    </span>
                    {n.closing_date && (
                      <span className="flex items-center gap-2">
                        <Calendar className="w-3.5 h-3.5 text-slate shrink-0" /> Closes {formatDate(n.closing_date)}
                      </span>
                    )}
                  </div>
                  <div className="lg:col-span-1 flex lg:justify-end items-center text-slate group-hover:text-signal">
                    <span className="lg:sr-only text-[12px] mr-2">View notice</span>
                    <ArrowRight className="w-4 h-4" />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
