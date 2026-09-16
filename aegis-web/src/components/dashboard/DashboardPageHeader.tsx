"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { DOMAIN_META, getDomainForPathname, getBreadcrumbsForPathname } from "@/lib/navigation";

interface DashboardPageHeaderProps {
  /** Small back-link rendered above the eyebrow/title - for sub-routes that
   * link back to their parent dashboard page (e.g. a quotations tool
   * linking back to /dashboard/quotations). Omit for top-level pages. */
  backHref?: string;
  backLabel?: string;
  /** Breadcrumb trail rendered above the eyebrow/title, e.g.
   * [{label: "Procurement", href: "/dashboard/procurement"}, {label: "Suppliers"}].
   * Omit for top-level pages (Executive, Dashboard root) that have nothing to
   * trail back to. */
  breadcrumbs?: { label: string; href?: string }[];
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
  backHref,
  backLabel = "Back to Dashboard",
  breadcrumbs,
  eyebrow,
  title,
  documentTitle,
  subtitle,
  actions,
  className,
}: DashboardPageHeaderProps) {
  const resolvedDocumentTitle = documentTitle ?? (typeof title === "string" ? title : undefined);
  const pathname = usePathname();

  useEffect(() => {
    if (!resolvedDocumentTitle) return;
    const previous = document.title;
    document.title = `${resolvedDocumentTitle} | AEGIS`;
    return () => {
      document.title = previous;
    };
  }, [resolvedDocumentTitle]);

  const EyebrowIcon = eyebrow?.icon;

  // Falls back to a path-derived trail (Domain > Group > current page) so
  // most pages get a correct breadcrumb for free; pages with a dynamic
  // title (e.g. a customer name) pass their own `breadcrumbs` instead.
  const derivedBreadcrumbs = useMemo(() => getBreadcrumbsForPathname(pathname), [pathname]);
  const resolvedBreadcrumbs = breadcrumbs ?? derivedBreadcrumbs;
  const domain = useMemo(() => getDomainForPathname(pathname), [pathname]);
  const accentClass = domain ? DOMAIN_META[domain].accentClass : "text-signal";

  return (
    <header
      className={cn(
        "mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-ink-mid pb-5",
        className
      )}
    >
      <div>
        {resolvedBreadcrumbs.length > 0 && (
          <Breadcrumb items={resolvedBreadcrumbs} className="mb-2" />
        )}
        {backHref && (
          <Link
            href={backHref}
            className="mb-2 inline-flex items-center gap-1 font-mono text-xs uppercase text-slate hover:text-paper transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> {backLabel}
          </Link>
        )}
        {eyebrow && (
          <p className={cn("mb-1 flex items-center gap-2 font-mono text-xs uppercase tracking-widest", accentClass)}>
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
