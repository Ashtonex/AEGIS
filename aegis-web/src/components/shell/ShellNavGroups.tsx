"use client";

import React from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";

export type ModuleNavItem = {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  // Roles allowed to see this item, mirroring the allowedRoles already
  // passed to <RBACGuard> on the page it links to. Omit to leave the item
  // visible to everyone (matches pages with no RBACGuard today).
  allowedRoles?: string[];
  // Roles explicitly denied this item, on top of whatever allowedRoles
  // permits. For carving a narrow exception (e.g. one restricted role) out
  // of an item that's otherwise open to everyone, without having to convert
  // it into a full allow-list and enumerate every other role that currently
  // relies on the open-by-default behavior.
  restrictedRoles?: string[];
  // Permission key that also grants visibility, on top of allowedRoles -
  // backfilled from PAGE_ACCESS in imperium-api/routers/settings.py so a
  // brand-new self-service role (with no allowedRoles entry at all) still
  // gets this item once granted the matching permission. Undefined items
  // keep today's role-only gating unchanged.
  requiredPermission?: string;
};

export type ModuleGroup = {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  subItems: ModuleNavItem[];
  directLink?: boolean;
  // Roles allowed to see the whole group. Harvested from the RBACGuard on
  // the group's root page - sub-items don't carry their own RBACGuard today
  // so this is the closest real signal for "who should see this module".
  allowedRoles?: string[];
  // See ModuleNavItem.restrictedRoles.
  restrictedRoles?: string[];
  // See ModuleNavItem.requiredPermission.
  requiredPermission?: string;
};

type ShellNavGroupsProps = {
  /** Already role/permission-filtered groups (gating stays in DashboardShell). */
  groups: ModuleGroup[];
  pathname: string | null;
  openGroups: Record<string, boolean>;
  onToggleGroup: (groupName: string, nextOpen: boolean) => void;
  onPrefetch: (href: string) => void;
};

/**
 * The sidebar nav tree, lifted verbatim out of DashboardShell's inline
 * `renderNavGroups()` and wrapped in React.memo.
 *
 * DashboardShell holds a lot of unrelated state (top-bar auto-hide, user
 * menu, onboarding tour, mobile drawer). Previously each of those state
 * changes re-walked all 149 nav links twice (desktop aside + mobile drawer).
 * With memo, this only re-renders when the filtered groups, the current
 * pathname, the open/closed map, or one of the (stable) callbacks changes.
 *
 * Rendering, class names, active-route matching, prefetch behaviour and
 * collapse/expand semantics are unchanged.
 */
function ShellNavGroupsImpl({
  groups,
  pathname,
  openGroups,
  onToggleGroup,
  onPrefetch,
}: ShellNavGroupsProps) {
  return (
    <>
      {groups.map((group) => {
        const isCurrent = pathname === group.href || pathname?.startsWith(`${group.href}/`);
        const isOpen = Boolean(openGroups[group.name] ?? isCurrent);
        if (group.directLink) {
          return (
            <Link
              key={group.name}
              href={group.href}
              prefetch
              onMouseEnter={() => onPrefetch(group.href)}
              onFocus={() => onPrefetch(group.href)}
              className={`mb-1 flex min-w-0 items-center gap-3 rounded-sm px-3 py-2 text-sm font-medium transition-colors ${
                isCurrent ? "bg-signal/5 text-signal" : "text-slate-light hover:bg-ink-light hover:text-paper"
              }`}
            >
              <group.icon className={`h-4 w-4 shrink-0 ${isCurrent ? "text-signal" : "text-slate"}`} />
              <span className="truncate">{group.name}</span>
            </Link>
          );
        }

        return (
          <div key={group.name} className="mb-1">
            <button
              onClick={() => onToggleGroup(group.name, !isOpen)}
              className={`w-full flex min-w-0 items-center justify-between gap-3 px-3 py-2 rounded-sm text-sm font-medium transition-colors ${
                isCurrent ? "text-signal bg-signal/5" : "text-slate-light hover:text-paper hover:bg-ink-light"
              }`}
            >
              <div className="flex min-w-0 items-center space-x-3">
                <group.icon className={`h-4 w-4 shrink-0 ${isCurrent ? "text-signal" : "text-slate"}`} />
                <span className="truncate">{group.name}</span>
              </div>
              {isOpen ? <ChevronDown className="h-4 w-4 shrink-0 text-slate" /> : <ChevronRight className="h-4 w-4 shrink-0 text-slate" />}
            </button>

            {isOpen && (
              <div className="mt-1 flex flex-col space-y-1 relative before:absolute before:left-5 before:top-0 before:bottom-0 before:w-px before:bg-ink-mid">
                {group.subItems.map((sub) => {
                  const isSubCurrent = pathname === sub.href || pathname?.startsWith(`${sub.href}/`);
                  return (
                    <Link
                      key={sub.name}
                      href={sub.href}
                      prefetch
                      onMouseEnter={() => onPrefetch(sub.href)}
                      onFocus={() => onPrefetch(sub.href)}
                      className={`flex min-w-0 items-center space-x-3 py-1.5 pl-10 pr-3 rounded-sm text-xs transition-colors relative ${
                        isSubCurrent
                          ? "text-paper bg-ink-light before:absolute before:left-[19px] before:top-1/2 before:-translate-y-1/2 before:w-1.5 before:h-1.5 before:rounded-full before:bg-signal"
                          : "text-slate hover:text-paper hover:bg-ink-light/50"
                      }`}
                    >
                      <sub.icon className={`h-3.5 w-3.5 shrink-0 ${isSubCurrent ? "text-signal" : "text-slate-light"}`} />
                      <span className="truncate">{sub.name}</span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

export const ShellNavGroups = React.memo(ShellNavGroupsImpl);
ShellNavGroups.displayName = "ShellNavGroups";

export default ShellNavGroups;
