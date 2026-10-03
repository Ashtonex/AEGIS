import type { ReactNode } from "react";
import type React from "react";
import { Breadcrumb } from "./Breadcrumb";
import { StatusBadge } from "./StatusBadge";
import { cn } from "@/lib/utils";

/**
 * DashboardPageHeader — the single orientation block for every page under
 * /dashboard.
 *
 * Before this existed each dashboard route hand-rolled its own heading: some
 * used `text-2xl font-semibold font-display`, some `text-3xl font-black
 * uppercase`, some had no <h1> at all, and none had breadcrumbs — so every
 * screen looked the same and users lost track of where they were.
 *
 * The visual language here is deliberately NOT new: it is the dominant
 * existing convention in this codebase (font-display / text-2xl /
 * tracking-tight / text-paper title, text-sm text-slate-light supporting copy,
 * border-ink-mid rule underneath) promoted into one component. Breadcrumbs are
 * delegated to the existing <Breadcrumb> primitive rather than reimplemented,
 * and the optional status chip reuses <StatusBadge>.
 *
 * Server-component safe: no hooks, no "use client".
 */

export interface DashboardPageHeaderCrumb {
  label: string;
  href?: string;
}

/** Mirrors the StatusBadge status union. */
export type DashboardPageHeaderStatusTone =
  | "success"
  | "error"
  | "warning"
  | "neutral"
  | "active"
  | "data";

export interface DashboardPageHeaderStatus {
  label: string;
  /** Defaults to "neutral" so callers can pass just a label. */
  tone?: DashboardPageHeaderStatusTone;
}

export interface DashboardPageHeaderProps
  extends Omit<React.HTMLAttributes<HTMLElement>, "title" | "children"> {
  /** Rendered as the page's one and only <h1>. */
  title: string;
  /** Supporting sentence under the title. */
  description?: ReactNode;
  /** Alias for `description`, for pages that already talk in "subtitle". */
  subtitle?: ReactNode;
  /**
   * Trail from the dashboard root to this page. The last entry is the current
   * page and is rendered as plain text by <Breadcrumb>, never a link.
   */
  breadcrumbs?: DashboardPageHeaderCrumb[];
  /** Buttons / filters. Right-aligned on >=sm, wraps below the title on mobile. */
  actions?: ReactNode;
  /** Optional state chip shown inline beside the title. */
  status?: DashboardPageHeaderStatus;
  /** Small mono kicker above the title (module name, live-data note, etc.). */
  eyebrow?: ReactNode;
  /** Hide the bottom hairline rule when the page supplies its own divider. */
  divider?: boolean;
  className?: string;
  /** Extra content (tab strips, filter rows) rendered below the header row. */
  children?: ReactNode;
}

export function DashboardPageHeader({
  title,
  description,
  subtitle,
  breadcrumbs,
  actions,
  status,
  eyebrow,
  divider = true,
  className,
  children,
  ...rest
}: DashboardPageHeaderProps) {
  const supportingCopy = description ?? subtitle;

  return (
    <header
      className={cn(
        "w-full",
        divider && "border-b border-ink-mid pb-5",
        className
      )}
      {...rest}
    >
      {breadcrumbs && breadcrumbs.length > 0 && (
        <Breadcrumb
          items={breadcrumbs}
          className="mb-3 flex-wrap gap-y-1 text-slate-light"
        />
      )}

      {/* Title column and actions column. Stacked on mobile so long titles are
          never squashed by a row of buttons; side-by-side from sm up. */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          {eyebrow && (
            <p className="mb-1 font-mono text-xs uppercase tracking-widest text-signal">
              {eyebrow}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-2xl font-semibold tracking-tight text-paper">
              {title}
            </h1>
            {status && (
              <StatusBadge status={status.tone ?? "neutral"} label={status.label} />
            )}
          </div>

          {supportingCopy && (
            <p className="mt-1 max-w-reading text-sm text-slate-light">
              {supportingCopy}
            </p>
          )}
        </div>

        {actions && (
          <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end">
            {actions}
          </div>
        )}
      </div>

      {children}
    </header>
  );
}

export default DashboardPageHeader;
