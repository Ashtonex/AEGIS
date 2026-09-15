"use client";

import { useEffect } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface DashboardPageHeaderProps {
  eyebrow?: { label: string; icon?: LucideIcon };
  /** String for the common case; a node (e.g. a dynamic greeting) when the
   * title itself needs to render something other than plain text - pass
   * documentTitle explicitly in that case, since the tab title can't be
   * derived from a ReactNode. */
  title: string | React.ReactNode;
  documentTitle?: string;
  subtitle?: string;
  /** Right-aligned slot for a page's own action button(s) (Refresh, Export,
   * etc) - unchanged from what each page already rendered next to its
   * heading, just repositioned into the shared layout. */
  actions?: React.ReactNode;
  className?: string;
}

/**
 * One canonical dashboard page header, replacing the ad-hoc per-page
 * heading markup (different h1 classNames, different eyebrow treatments,
 * different wrapper elements) that made every dashboard route look
 * different from every other one. See aegis-web/src/components/dashboard/
 * for the rollout - each page's existing eyebrow/title/subtitle/action
 * content maps directly into these props.
 */
export function DashboardPageHeader({
  eyebrow,
  title,
  documentTitle,
  subtitle,
  actions,
  className,
}: DashboardPageHeaderProps) {
  const resolvedDocumentTitle = documentTitle ?? (typeof title === "string" ? title : undefined);

  useEffect(() => {
    if (!resolvedDocumentTitle) return;
    const previous = document.title;
    document.title = `${resolvedDocumentTitle} | AEGIS`;
    return () => {
      document.title = previous;
    };
  }, [resolvedDocumentTitle]);

  const EyebrowIcon = eyebrow?.icon;

  return (
    <header
      className={cn(
        "mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-ink-mid pb-5",
        className
      )}
    >
      <div>
        {eyebrow && (
          <p className="mb-1 flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-signal">
            {EyebrowIcon && <EyebrowIcon className="h-3.5 w-3.5" />}
            {eyebrow.label}
          </p>
        )}
        {typeof title === "string" ? (
          <>
            <h1 className="font-display text-3xl font-bold tracking-tight text-paper">{title}</h1>
            {subtitle && <p className="mt-1 text-sm text-slate-light">{subtitle}</p>}
          </>
        ) : (
          // A node (e.g. a dynamic greeting) is trusted to render its own
          // heading/subtitle - it isn't wrapped in another <h1> here, and
          // the subtitle prop is ignored in this branch to avoid a second,
          // redundant one.
          title
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}
