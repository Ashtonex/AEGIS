import { cn } from "@/lib/utils";
import type { ProcurementNoticeStatus } from "@/types/website";

const STATUS_CLASSES: Record<ProcurementNoticeStatus, string> = {
  open: "text-success border-success/30 bg-success/10",
  evaluating: "text-warning border-warning/30 bg-warning/10",
  awarded: "text-info border-info/30 bg-info/10",
  in_delivery: "text-info border-info/30 bg-info/10",
  fulfilled: "text-paper border-ink-mid bg-ink-light",
  dormant: "text-slate border-ink-mid bg-transparent",
  cancelled: "text-danger border-danger/30 bg-danger/10",
};

export function NoticeStatusBadge({
  status,
  label,
  className,
}: {
  status: ProcurementNoticeStatus;
  label: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-block px-2 py-1 text-[10px] font-sans font-semibold uppercase tracking-widest border rounded-sm whitespace-nowrap",
        STATUS_CLASSES[status] ?? STATUS_CLASSES.dormant,
        className,
      )}
    >
      {label}
    </span>
  );
}
