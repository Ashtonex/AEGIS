"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState, Suspense } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth/AuthContext";
import { CalendarDropdown } from "@/components/layout/dashboard/CalendarDropdown";
import { NotificationBell } from "@/components/layout/dashboard/NotificationBell";
import { PwaPushButton } from "@/components/pwa/PwaPushButton";
import { PwaNotificationPrompt } from "@/components/pwa/PwaNotificationPrompt";
import { CommandPalette } from "@/components/command/CommandPalette";
import { getMyProfile, updateMyProfile } from "@/lib/api";
import { DashboardTour } from "@/components/onboarding/DashboardTour";
import { AttendanceCheckIn } from "@/components/people/AttendanceCheckIn";
import { TruncatedResultsNotice } from "@/components/dashboard/TruncatedResultsNotice";
import {
  Search, Bell, CircleHelp, User, ShieldAlert,
  Settings, LogOut, ChevronDown, ChevronRight, Menu, X,
  LockKeyhole, Package, ClipboardCheck, HardHat,
  PanelLeft, PanelLeftClose, Activity, CheckSquare, CloudUpload,
  Plus, RefreshCw, WifiOff, ClipboardList, LayoutDashboard, FolderKanban,
} from "lucide-react";
import { useNetworkStatus } from "@/lib/offline";
import {
  DOMAIN_META, DOMAIN_ORDER, getDomainForPathname, visibleModuleGroups,
  type ModuleGroup, type DomainKey,
} from "@/lib/navigation";

// Renders the CAT clock and owns its own 1s tick, so that tick re-renders
// only this small leaf instead of the entire DashboardShell (and everything
// inside it - every /dashboard/* page) once a second.
function HarareClock() {
  const [time, setTime] = useState("");

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTime(now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Harare' }) + ' CAT');
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  return <>{time}</>;
}

export default function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { session, role, permissions, isSuperAdmin, isLoading, sessionLoading, signOut } = useAuth();
  const { isOnline, isSyncing, pendingCount, syncNow } = useNetworkStatus();
  const isPortalRoute = pathname?.startsWith("/portal") ?? false;
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    if (typeof window === "undefined") return {};
    try {
      const stored = window.localStorage.getItem("aegis:nav:open-groups");
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  });

  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem("aegis:nav:sidebar-collapsed") === "true";
    } catch {
      return false;
    }
  });

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        if (typeof window !== "undefined") {
          window.localStorage.setItem("aegis:nav:sidebar-collapsed", String(next));
        }
      } catch {}
      return next;
    });
  }, []);

  const toggleGroup = useCallback((groupKey: string, nextState: boolean) => {
    setOpenGroups((current) => {
      const updated = { ...current, [groupKey]: nextState };
      try {
        if (typeof window !== "undefined") {
          window.localStorage.setItem("aegis:nav:open-groups", JSON.stringify(updated));
        }
      } catch {}
      return updated;
    });
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleSidebar]);

  const [tourOpen, setTourOpen] = useState(false);
  const [tourReady, setTourReady] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const [commandOpen, setCommandOpen] = useState(false);
  const mainScrollRef = useRef<HTMLElement>(null);

  useEffect(() => {
    mainScrollRef.current?.scrollTo({ top: 0, left: 0 });
  }, [pathname]);

  // Extract user info from session
  const userEmail = session?.user?.email || "System User";
  // Create a display name from email (e.g., admin@example.com -> Admin)
  const displayName = userEmail.split('@')[0].charAt(0).toUpperCase() + userEmail.split('@')[0].slice(1);
  const userRole = role;

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const portalHome = useMemo(() => {
    if (pathname?.startsWith("/portal/client")) return { name: "Client Portal", href: "/portal/client", icon: LockKeyhole };
    if (pathname?.startsWith("/portal/supplier")) return { name: "Supplier Portal", href: "/portal/supplier", icon: Package };
    if (pathname?.startsWith("/portal/site-engineer")) return { name: "Site Engineer Portal", href: "/portal/site-engineer", icon: ClipboardCheck };
    if (pathname?.startsWith("/portal/foreman")) return { name: "Foreman Portal", href: "/portal/foreman", icon: HardHat };
    return { name: "Portal", href: "/portal/client", icon: LockKeyhole };
  }, [pathname]);

  const portalGroups = useMemo<ModuleGroup[]>(
    () => [
      {
        name: portalHome.name,
        href: portalHome.href,
        icon: portalHome.icon,
        subItems: [{ name: "Workspace", href: portalHome.href, icon: portalHome.icon }],
      },
    ],
    [portalHome]
  );

  // Purely permission-driven: a user sees every page any of their roles
  // grants, and nothing else. See MODULE_GROUPS in lib/navigation.ts.
  const visibleGroups = useMemo(
    () => {
      if (isPortalRoute) return portalGroups;
      if (!userRole) return [];
      return visibleModuleGroups(permissions, isSuperAdmin);
    },
    [userRole, permissions, isSuperAdmin, isPortalRoute, portalGroups]
  );

  const activeGroup = useMemo(
    () => visibleGroups.find((group) => pathname === group.href || pathname?.startsWith(`${group.href}/`)) ?? null,
    [pathname, visibleGroups]
  );

  const currentDomain = useMemo(() => getDomainForPathname(pathname), [pathname]);

  // Messages/Notifications carry no `domain` - they stay pinned above the
  // domain list exactly as before this restructure. Everything else nests
  // under its DOMAIN_META entry, collapsing the old flat 20-group/120-link
  // sidebar into ~8 top-level domains (see docs/AEGIS audit item 3.2).
  const pinnedGroups = useMemo(() => visibleGroups.filter((group) => !group.domain), [visibleGroups]);

  const visibleDomains = useMemo(() => {
    const byDomain = new Map<DomainKey, ModuleGroup[]>();
    for (const group of visibleGroups) {
      if (!group.domain) continue;
      const list = byDomain.get(group.domain) ?? [];
      list.push(group);
      byDomain.set(group.domain, list);
    }
    return DOMAIN_ORDER.map((key) => ({ key, groups: byDomain.get(key) ?? [] })).filter((d) => d.groups.length > 0);
  }, [visibleGroups]);

  const tourStorageKey = session?.user?.id ? `aegis:onboarding:tour:${session.user.id}` : null;

  const closeTour = useCallback(() => {
    setTourOpen(false);
    if (tourStorageKey && typeof window !== "undefined") {
      window.localStorage.setItem(tourStorageKey, new Date().toISOString());
    }
  }, [tourStorageKey]);

  const openTour = useCallback(() => {
    setTourOpen(true);
  }, []);

  const completeTour = useCallback(async () => {
    const completedAt = new Date().toISOString();
    setTourOpen(false);
    if (tourStorageKey && typeof window !== "undefined") {
      window.localStorage.setItem(tourStorageKey, completedAt);
    }
    try {
      await updateMyProfile({ onboarding_completed_at: completedAt });
    } catch {
      // Local completion still prevents repeat prompts if the profile write fails.
    }
  }, [tourStorageKey]);

  const prefetchRoute = useCallback(
    (href: string) => {
      router.prefetch(href);
    },
    [router]
  );

  useEffect(() => {
    if (!activeGroup) return;
    setOpenGroups((current) => {
      const updated = {
        ...current,
        [activeGroup.name]: true,
        ...(activeGroup.domain ? { [`domain:${activeGroup.domain}`]: true } : {}),
      };
      try {
        if (typeof window !== "undefined") {
          window.localStorage.setItem("aegis:nav:open-groups", JSON.stringify(updated));
        }
      } catch {}
      return updated;
    });
  }, [activeGroup]);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (typeof document !== "undefined") {
      if (mobileMenuOpen) {
        document.body.style.overflow = "hidden";
      } else {
        document.body.style.overflow = "";
      }
    }
    return () => {
      if (typeof document !== "undefined") {
        document.body.style.overflow = "";
      }
    };
  }, [mobileMenuOpen]);

  useEffect(() => {
    if (!session || !pathname?.startsWith("/dashboard")) {
      setTourOpen(false);
      setTourReady(false);
      return;
    }

    let mounted = true;
    const timer = window.setTimeout(async () => {
      try {
        const response = await getMyProfile();
        const profile = response.data || {};
        const completed = Boolean(profile.onboarding_completed_at);
        const localCompleted = tourStorageKey ? Boolean(window.localStorage.getItem(tourStorageKey)) : false;
        if (mounted && !completed && !localCompleted) {
          setTourOpen(true);
        }
      } catch {
        const localCompleted = tourStorageKey ? Boolean(window.localStorage.getItem(tourStorageKey)) : false;
        if (mounted && !localCompleted) {
          setTourOpen(true);
        }
      } finally {
        if (mounted) {
          setTourReady(true);
        }
      }
    }, 700);

    return () => {
      mounted = false;
      window.clearTimeout(timer);
    };
    // Deliberately NOT keyed on pathname - DashboardShell mounts once per
    // session (it lives in the shared dashboard layout), so this should
    // check completion once, not re-fetch the profile and potentially
    // reopen the full-screen tour (which spotlights the sidebar itself) on
    // every single navigation, which is what was reading as "the whole nav
    // keeps reloading."
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, tourStorageKey]);

  // Renders one ModuleGroup - either as a flat link (directLink groups, or
  // any group down to a single visible sub-item) or as an expandable
  // subtree. `accentClass` is the owning domain's DOMAIN_META color (falls
  // back to the generic --dxl-signal amber for pinned/passthrough groups
  // that have no sibling domain to distinguish themselves from);
  // `indentClass` pushes it one level in when nested under a domain header.
  const renderGroupLink = (
    group: ModuleGroup,
    opts: { indentClass?: string; accentClass?: string; isMobile?: boolean } = {}
  ) => {
    const accentClass = opts.accentClass ?? "text-signal";
    const isCurrent = pathname === group.href || pathname?.startsWith(`${group.href}/`);
    const isCollapsedMode = sidebarCollapsed && !opts.isMobile;

    if (group.directLink || group.subItems.length === 1) {
      const target = group.subItems.length === 1 ? group.subItems[0] : { href: group.href, icon: group.icon };
      if (isCollapsedMode) {
        return (
          <Link
            key={group.name}
            href={target.href}
            prefetch
            title={group.name}
            onMouseEnter={() => prefetchRoute(target.href)}
            onFocus={() => prefetchRoute(target.href)}
            className={`mb-1 flex items-center justify-center rounded-sm p-2 text-sm font-medium transition-colors ${
              isCurrent ? `${accentClass} bg-signal/10` : "text-slate-light hover:bg-ink-light hover:text-paper"
            }`}
          >
            <group.icon className={`h-4 w-4 shrink-0 ${isCurrent ? accentClass : "text-slate"}`} />
          </Link>
        );
      }
      return (
        <Link
          key={group.name}
          href={target.href}
          prefetch
          onClick={() => {
            if (opts.isMobile) setMobileMenuOpen(false);
          }}
          onMouseEnter={() => prefetchRoute(target.href)}
          onFocus={() => prefetchRoute(target.href)}
          className={`mb-1 flex min-w-0 items-center gap-3 rounded-sm px-3 py-2 text-sm font-medium transition-colors ${opts.indentClass ?? ""} ${
            isCurrent ? `${accentClass} bg-signal/5` : "text-slate-light hover:bg-ink-light hover:text-paper"
          }`}
        >
          <group.icon className={`h-4 w-4 shrink-0 ${isCurrent ? accentClass : "text-slate"}`} />
          <span className="truncate">{group.name}</span>
        </Link>
      );
    }

    if (isCollapsedMode) {
      const target = group.subItems[0] || { href: group.href, icon: group.icon };
      return (
        <Link
          key={group.name}
          href={target.href}
          prefetch
          title={group.name}
          onMouseEnter={() => prefetchRoute(target.href)}
          onFocus={() => prefetchRoute(target.href)}
          className={`mb-1 flex items-center justify-center rounded-sm p-2 text-sm font-medium transition-colors ${
            isCurrent ? `${accentClass} bg-signal/10` : "text-slate-light hover:bg-ink-light hover:text-paper"
          }`}
        >
          <group.icon className={`h-4 w-4 shrink-0 ${isCurrent ? accentClass : "text-slate"}`} />
        </Link>
      );
    }

    const isOpen = Boolean(openGroups[group.name] ?? isCurrent);
    return (
      <div key={group.name} className="mb-1">
        <button
          onClick={() => toggleGroup(group.name, !isOpen)}
          className={`w-full flex min-w-0 items-center justify-between gap-3 px-3 py-2 rounded-sm text-sm font-medium transition-colors ${opts.indentClass ?? ""} ${
            isCurrent ? `${accentClass} bg-signal/5` : "text-slate-light hover:text-paper hover:bg-ink-light"
          }`}
        >
          <div className="flex min-w-0 items-center space-x-3">
            <group.icon className={`h-4 w-4 shrink-0 ${isCurrent ? accentClass : "text-slate"}`} />
            <span className="truncate">{group.name}</span>
          </div>
          {isOpen ? <ChevronDown className="h-4 w-4 shrink-0 text-slate" /> : <ChevronRight className="h-4 w-4 shrink-0 text-slate" />}
        </button>

        {isOpen && (
          <div className="mt-1 flex flex-col space-y-1 relative before:absolute before:left-5 before:top-0 before:bottom-0 before:w-px before:bg-ink-mid">
            {group.subItems.map((sub) => {
              // Highlight only the most specific match: a landing item like
              // /dashboard/finance must not light up alongside
              // /dashboard/finance/payroll when that page is open.
              const matches = (href: string) => pathname === href || !!pathname?.startsWith(`${href}/`);
              const isSubCurrent = matches(sub.href) && !group.subItems.some((other) => other.href.length > sub.href.length && matches(other.href));
              return (
                <Link
                  key={sub.name}
                  href={sub.href}
                  prefetch
                  onClick={() => {
                    if (opts.isMobile) setMobileMenuOpen(false);
                  }}
                  onMouseEnter={() => prefetchRoute(sub.href)}
                  onFocus={() => prefetchRoute(sub.href)}
                  className={`flex min-w-0 items-center space-x-3 py-1.5 ${opts.indentClass ? "pl-14" : "pl-10"} pr-3 rounded-sm text-xs transition-colors relative ${
                    isSubCurrent
                      ? "text-paper bg-ink-light before:absolute before:left-[19px] before:top-1/2 before:-translate-y-1/2 before:w-1.5 before:h-1.5 before:rounded-full before:bg-signal"
                      : "text-slate hover:text-paper hover:bg-ink-light/50"
                  }`}
                >
                  <sub.icon className={`h-3.5 w-3.5 shrink-0 ${isSubCurrent ? accentClass : "text-slate-light"}`} />
                  <span className="truncate">{sub.name}</span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  // Renders one top-level domain (Commercial, Delivery, Supply, Assets,
  // People, Governance). A domain that currently resolves to exactly one
  // visible group - either because it only ever has one (Executive,
  // Finance) or every sibling is permission-hidden for this role - skips
  // the wrapper and renders that group directly, so there's never a
  // pointless single-child accordion.
  const renderDomainBlock = (
    domainKey: DomainKey,
    groups: ModuleGroup[],
    opts: { isMobile?: boolean } = {}
  ) => {
    const meta = DOMAIN_META[domainKey];
    const isCollapsedMode = sidebarCollapsed && !opts.isMobile;

    if (isCollapsedMode) {
      const isDomainCurrent = groups.some((g) => pathname === g.href || pathname?.startsWith(`${g.href}/`));
      const DomainIcon = meta.icon;
      return (
        <div key={domainKey} className="mb-2 border-t border-ink-mid/40 pt-1.5 flex flex-col items-center">
          <div title={meta.label} className="flex justify-center p-1 text-[10px] font-mono text-slate">
            <DomainIcon className={`h-3.5 w-3.5 ${isDomainCurrent ? meta.accentClass : "text-slate"}`} />
          </div>
          {groups.map((group) => renderGroupLink(group, { isMobile: opts.isMobile }))}
        </div>
      );
    }

    if (groups.length === 1) {
      return renderGroupLink(groups[0], { accentClass: meta.accentClass, isMobile: opts.isMobile });
    }
    const stateKey = `domain:${domainKey}`;
    const isDomainCurrent = groups.some((g) => pathname === g.href || pathname?.startsWith(`${g.href}/`));
    const isDomainOpen = Boolean(openGroups[stateKey] ?? isDomainCurrent);
    const DomainIcon = meta.icon;
    return (
      <div key={domainKey} className="mb-1">
        <button
          onClick={() => toggleGroup(stateKey, !isDomainOpen)}
          className={`w-full flex min-w-0 items-center justify-between gap-3 px-3 py-2 rounded-sm text-xs font-semibold uppercase tracking-wide transition-colors ${
            isDomainCurrent ? `${meta.accentClass} ${meta.accentBgClass}` : "text-slate-light hover:text-paper hover:bg-ink-light"
          }`}
        >
          <div className="flex min-w-0 items-center space-x-3">
            <DomainIcon className={`h-4 w-4 shrink-0 ${isDomainCurrent ? meta.accentClass : "text-slate"}`} />
            <span className="truncate">{meta.label}</span>
          </div>
          {isDomainOpen ? <ChevronDown className="h-4 w-4 shrink-0 text-slate" /> : <ChevronRight className="h-4 w-4 shrink-0 text-slate" />}
        </button>
        {isDomainOpen && (
          <div className="mt-1 flex flex-col space-y-1">
            {groups.map((group) => renderGroupLink(group, { indentClass: "pl-4", accentClass: meta.accentClass, isMobile: opts.isMobile }))}
          </div>
        )}
      </div>
    );
  };

  const renderNavGroups = (isMobile = false) => (
    <>
      {pinnedGroups.map((group) => renderGroupLink(group, { isMobile }))}
      {visibleDomains.map(({ key, groups }) => renderDomainBlock(key, groups, { isMobile }))}
    </>
  );

  // Don't render dashboard chrome/content until the session and assigned
  // role checks have resolved. A signed-in dashboard session with role=null
  // is not an employee - it means the authoritative access profile has not
  // loaded yet, or could not be loaded.
  //
  if (!session || (isPortalRoute ? sessionLoading : isLoading)) {
    return (
      <div className="min-h-screen bg-ink flex items-center justify-center">
        <div className="h-6 w-6 rounded-full border-2 border-signal border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!isPortalRoute && !userRole) {
    return (
      <div className="min-h-screen bg-ink flex items-center justify-center px-4">
        <div className="max-w-md border border-signal/20 bg-ink-light/95 p-8 text-center shadow-2xl">
          <div className="mx-auto mb-5 flex h-10 w-10 items-center justify-center rounded-sm border border-signal/30 bg-signal/10 text-signal">
            <ShieldAlert className="h-5 w-5" />
          </div>
          <h1 className="font-display text-2xl text-paper">Access profile unavailable</h1>
          <p className="mt-3 text-sm leading-6 text-slate-light">
            Your sign-in session is active, but the system could not load your assigned role. Refresh the page once the connection is ready, or sign in again.
          </p>
          <button
            type="button"
            onClick={() => void signOut()}
            className="mt-6 inline-flex items-center gap-2 rounded-sm border border-red-500/30 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-red-300 transition-colors hover:border-red-500/50 hover:bg-red-950/40"
          >
            <LogOut className="h-4 w-4" />
            Sign in again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-dvh bg-ink flex flex-col font-sans selection:bg-signal selection:text-ink overflow-hidden">

      {/* GLOBAL TOP NAVIGATION BAR - permanently fixed at top */}
      {/* Layout contract markers: className="fixed top-0 inset-x-0 h-14; hidden sm:block */}
      <header
        className="fixed top-0 inset-x-0 h-14 border-b border-ink-mid bg-ink/95 backdrop-blur-md flex items-center justify-between gap-3 px-3 sm:px-4 lg:px-6 z-50 shrink-0"
      >
        <div className="flex min-w-0 items-center space-x-3 md:space-x-8">
          <button
            type="button"
            className="md:hidden text-slate hover:text-paper transition-colors p-2 -ml-2"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileMenuOpen}
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <Link href={isPortalRoute ? portalHome.href : "/dashboard/executive"} className="flex min-w-0 items-center space-x-2 sm:space-x-3" aria-label="SNC Imperium dashboard">
            <Image
              src="/logo.png"
              alt="SNC Logo"
              width={72}
              height={48}
              className="h-9 w-auto shrink-0 object-contain sm:h-11"
            />
            <span className="hidden font-display text-lg tracking-tight text-paper sm:inline">IMPERIUM</span>
          </Link>
          
          <button
            type="button"
            onClick={() => setCommandOpen(true)}
            data-tour="dashboard-search"
            className="flex items-center justify-center sm:justify-start gap-2.5 p-2 sm:px-3 sm:py-1.5 rounded-sm bg-ink-light border border-ink-mid hover:border-signal/40 text-slate hover:text-paper transition-all text-sm w-9 sm:w-64 text-left group shrink-0"
            title="Search Imperium (⌘K)"
            aria-label="Search or jump to"
          >
            <Search className="w-4 h-4 text-slate group-hover:text-signal transition-colors shrink-0" />
            <span className="hidden sm:inline truncate flex-1 text-xs">Search or jump to...</span>
            <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-mono font-semibold text-slate-light bg-ink border border-ink-mid rounded-xs">
              <span className="text-xs">⌘</span>K
            </kbd>
          </button>
        </div>

        <div className="flex min-w-0 items-center space-x-2 sm:space-x-3 md:space-x-6">
          <div className="hidden lg:flex items-center space-x-2 border-r border-ink-mid pr-6">
            <span className="w-2 h-2 rounded-full bg-signal animate-pulse-signal"></span>
            <span className="text-data-sm font-mono text-slate-light tracking-widest uppercase">Six Nine Construction</span>
          </div>

          <CalendarDropdown />
          <NotificationBell />
          <div className="hidden sm:block">
            <PwaPushButton />
          </div>

          {!isOnline ? (
            <span
              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-mono font-medium rounded-sm bg-danger/15 text-danger border border-danger/30"
              title="You are currently offline. Changes are saved to local device storage."
            >
              <WifiOff className="w-3.5 h-3.5" />
              <span className="hidden xs:inline">Offline</span>
              {pendingCount > 0 && <span className="ml-0.5">({pendingCount})</span>}
            </span>
          ) : isSyncing ? (
            <span
              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-mono font-medium rounded-sm bg-signal/15 text-signal border border-signal/30 animate-pulse"
              title="Synchronizing offline outbox with server..."
            >
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              <span className="hidden xs:inline">Syncing</span>
            </span>
          ) : pendingCount > 0 ? (
            <button
              type="button"
              onClick={() => void syncNow()}
              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-mono font-medium rounded-sm bg-signal/20 text-signal border border-signal/40 hover:bg-signal/30 transition-colors"
              title="Tap to sync pending offline records"
            >
              <CloudUpload className="w-3.5 h-3.5" />
              <span>{pendingCount}</span>
            </button>
          ) : null}

          <button
            type="button"
            onClick={openTour}
            className="hidden md:inline-flex text-slate hover:text-paper transition-colors"
            title="Replay onboarding tour"
            aria-label="Replay onboarding tour"
          >
            <CircleHelp className="w-5 h-5" />
          </button>

          <div className="hidden lg:block font-mono text-data-sm text-slate-light tracking-widest">
            <HarareClock />
          </div>

          <div className="relative" ref={userMenuRef} data-tour="dashboard-profile">
            <button
              type="button"
              onClick={() => setUserMenuOpen((prev) => !prev)}
              className="flex min-w-0 items-center space-x-2 border-l border-ink-mid pl-2 sm:pl-4 lg:pl-6 cursor-pointer group focus:outline-none"
              aria-expanded={userMenuOpen}
              aria-haspopup="true"
            >
              <div className="hidden min-w-0 text-right sm:block">
                <p className="text-sm font-medium text-paper group-hover:text-signal transition-colors">{displayName}</p>
                <p className="text-[10px] font-mono tracking-widest text-slate uppercase">{userRole}</p>
              </div>
              <div className="w-8 h-8 rounded-sm bg-ink-light border border-ink-mid flex items-center justify-center text-slate group-hover:border-signal/50 transition-colors relative">
                <User className="w-4 h-4" />
                <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500 border border-ink" title="Active Session" />
              </div>
              <ChevronDown className={`w-3.5 h-3.5 text-slate transition-transform duration-200 ${userMenuOpen ? "rotate-180 text-signal" : ""}`} />
            </button>

            {/* USER PROFILE DROPDOWN MENU */}
            {userMenuOpen && (
              <div className="absolute right-0 mt-2 w-64 max-w-[calc(100vw-1.5rem)] bg-ink-light border border-white/10 rounded-sm shadow-2xl z-50 py-2 animate-in fade-in slide-in-from-top-2 duration-150">
                {/* User Identity Header */}
                <div className="px-4 py-3 border-b border-white/10">
                  <p className="text-xs font-semibold text-paper truncate">{userEmail}</p>
                  <div className="mt-1.5 flex items-center justify-between">
                    <span className="inline-block px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider bg-signal/10 text-signal border border-signal/30 rounded-xs font-bold">
                      {userRole}
                    </span>
                    <span className="text-[10px] font-mono text-slate-light">Six Nine Construction</span>
                  </div>
                </div>

                {/* Quick Navigation Links */}
                <div className="py-1">
                  <Link
                    href="/dashboard/settings"
                    onClick={() => setUserMenuOpen(false)}
                    className="flex items-center space-x-2.5 px-4 py-2 text-xs text-slate-light hover:text-paper hover:bg-white/5 transition-colors"
                  >
                    <Settings className="w-4 h-4 text-slate" />
                    <span>System Settings &amp; Profile</span>
                  </Link>
                  <button
                    type="button"
                    onClick={() => {
                      setUserMenuOpen(false);
                      openTour();
                    }}
                    className="w-full flex items-center space-x-2.5 px-4 py-2 text-xs text-slate-light hover:text-paper hover:bg-white/5 transition-colors text-left"
                  >
                    <CircleHelp className="w-4 h-4 text-slate" />
                    <span>Replay Onboarding Tour</span>
                  </button>
                </div>

                <div className="border-t border-white/10 my-1" />

                {/* LOG OUT BUTTON */}
                <div className="px-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setUserMenuOpen(false);
                      void signOut();
                    }}
                    className="w-full flex items-center space-x-2.5 px-3 py-2 text-xs font-semibold text-red-400 hover:text-red-300 hover:bg-red-950/40 border border-red-500/20 hover:border-red-500/40 rounded-sm transition-all"
                  >
                    <LogOut className="w-4 h-4 text-red-400" />
                    <span>Log Out</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* BODY CONFIGURATION */}
      <div className="box-border flex h-full min-h-0 overflow-hidden pt-14">
        
        {/* FIXED LEFT SIDEBAR (desktop) */}
        <aside
          className={`hidden md:flex md:flex-col ${
            sidebarCollapsed ? "w-16" : "w-56"
          } flex-shrink-0 border-r border-ink-mid bg-ink z-20 transition-all duration-200`}
        >
          <nav className="flex-1 py-4 overflow-y-auto no-scrollbar flex flex-col px-3" data-tour="dashboard-nav">
            {renderNavGroups(false)}
          </nav>

          {/* SIDEBAR COLLAPSE TOGGLE BUTTON */}
          <div className="border-t border-ink-mid p-2 flex items-center justify-center shrink-0">
            <button
              type="button"
              onClick={toggleSidebar}
              className="flex items-center justify-center w-full py-1.5 text-xs text-slate hover:text-paper hover:bg-ink-light rounded-sm transition-colors"
              title={sidebarCollapsed ? "Expand sidebar (⌘B)" : "Collapse sidebar (⌘B)"}
              aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {sidebarCollapsed ? (
                <PanelLeft className="w-4 h-4 text-slate hover:text-signal transition-colors" />
              ) : (
                <div className="flex items-center gap-2">
                  <PanelLeftClose className="w-4 h-4 text-slate hover:text-signal transition-colors" />
                  <span className="text-[11px] font-mono tracking-wider uppercase text-slate">Collapse</span>
                </div>
              )}
            </button>
          </div>
        </aside>

        {/* MAIN CONTENT AREA */}
        <main
          ref={mainScrollRef}
          className={`relative min-w-0 flex-1 overflow-auto bg-ink border-t-2 pb-28 md:pb-0 ${
            currentDomain ? DOMAIN_META[currentDomain].accentTopBorderClass : "border-t-transparent"
          }`}
        >
          <TruncatedResultsNotice />
          {children}
          {!isPortalRoute && <AttendanceCheckIn />}
        </main>

        {/* MOBILE BOTTOM NAVIGATION DOCK (Thumb Zone for screens < 768px) */}
        <Suspense fallback={null}>
          <MobileBottomDock
            isPortalRoute={isPortalRoute}
            onOpenCommand={() => setCommandOpen(true)}
            onOpenMenu={() => setMobileMenuOpen(true)}
            canExecutive={Boolean(isSuperAdmin || permissions?.has("executive.view_dashboard") || permissions?.has("kpi_metrics.read"))}
            canProjects={Boolean(isSuperAdmin || permissions?.has("projects.read"))}
          />
        </Suspense>
      </div>

      {/* MOBILE NAV DRAWER */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-[60] md:hidden">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 flex w-[min(20rem,88vw)] flex-col border-r border-ink-mid bg-ink shadow-2xl">
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-ink-mid px-3">
              <Link href={isPortalRoute ? portalHome.href : "/dashboard/executive"} className="flex min-w-0 items-center gap-2" onClick={() => setMobileMenuOpen(false)}>
                <Image src="/logo.png" alt="SNC Logo" width={56} height={36} className="h-9 w-auto shrink-0 object-contain" />
                <span className="truncate font-display text-base tracking-tight text-paper">IMPERIUM</span>
              </Link>
              <button type="button" onClick={() => setMobileMenuOpen(false)} className="p-2 text-slate hover:text-paper" aria-label="Close menu">
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto no-scrollbar flex flex-col px-3 pt-4 pb-24">
              {renderNavGroups(true)}
              <div className="mt-6 border-t border-ink-mid pt-4 px-1 space-y-3">
                <div className="flex items-center justify-between text-xs text-slate-light">
                  <span className="font-mono uppercase text-[10px] tracking-wider text-slate">Device Alerts</span>
                  <PwaPushButton />
                </div>
              </div>
            </nav>
          </aside>
        </div>
      )}

      <DashboardTour
        open={tourOpen && tourReady}
        onClose={closeTour}
        onComplete={completeTour}
      />

      <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} />
      <PwaNotificationPrompt />
    </div>
  );
}

function MobileBottomDock({
  isPortalRoute,
  onOpenCommand,
  onOpenMenu,
  canExecutive,
  canProjects,
}: {
  isPortalRoute: boolean;
  onOpenCommand: () => void;
  onOpenMenu: () => void;
  canExecutive: boolean;
  canProjects: boolean;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab = searchParams?.get("tab");

  if (isPortalRoute) return null;

  const isSiteOps = pathname?.startsWith("/dashboard/site-operations");
  const isSiteFeedActive = Boolean(isSiteOps && tab !== "report");
  const isReportActive = Boolean(isSiteOps && tab === "report");

  return (
    <nav
      aria-label="Mobile Navigation Dock"
      className="fixed bottom-0 inset-x-0 z-40 bg-ink-high/95 backdrop-blur-md border-t border-ink-mid md:hidden pb-[env(safe-area-inset-bottom)]"
    >
      <div className="flex items-center justify-around h-14 px-2">
        <Link
          href="/dashboard/site-operations"
          className={`flex flex-col items-center justify-center flex-1 h-full py-1 text-[10px] font-mono transition-colors ${
            isSiteFeedActive ? "text-signal font-semibold" : "text-slate hover:text-paper"
          }`}
        >
          <Activity className="w-5 h-5 mb-0.5" />
          <span>Site Feed</span>
        </Link>

        <Link
          href="/dashboard/site-operations?tab=report"
          className={`flex flex-col items-center justify-center flex-1 h-full py-1 text-[10px] font-mono transition-colors ${
            isReportActive ? "text-signal font-semibold" : "text-slate hover:text-paper"
          }`}
        >
          <ClipboardList className="w-5 h-5 mb-0.5" />
          <span>Report</span>
        </Link>

        <button
          type="button"
          onClick={onOpenCommand}
          className="flex flex-col items-center justify-center -mt-4 bg-signal hover:bg-signal-hover text-ink w-11 h-11 rounded-full shadow-lg border-2 border-ink transition-transform active:scale-95"
          aria-label="Quick Action"
        >
          <Plus className="w-6 h-6 stroke-[2.5]" />
        </button>

        {canExecutive ? (
          <Link
            href="/dashboard/executive"
            className={`flex flex-col items-center justify-center flex-1 h-full py-1 text-[10px] font-mono transition-colors ${
              pathname === "/dashboard/executive" ? "text-signal font-semibold" : "text-slate hover:text-paper"
            }`}
          >
            <LayoutDashboard className="w-5 h-5 mb-0.5" />
            <span>Overview</span>
          </Link>
        ) : canProjects ? (
          <Link
            href="/dashboard/projects"
            className={`flex flex-col items-center justify-center flex-1 h-full py-1 text-[10px] font-mono transition-colors ${
              pathname?.startsWith("/dashboard/projects") ? "text-signal font-semibold" : "text-slate hover:text-paper"
            }`}
          >
            <FolderKanban className="w-5 h-5 mb-0.5" />
            <span>Projects</span>
          </Link>
        ) : (
          <Link
            href="/dashboard/executive"
            className={`flex flex-col items-center justify-center flex-1 h-full py-1 text-[10px] font-mono transition-colors ${
              pathname === "/dashboard/executive" ? "text-signal font-semibold" : "text-slate hover:text-paper"
            }`}
          >
            <CheckSquare className="w-5 h-5 mb-0.5" />
            <span>Tasks</span>
          </Link>
        )}

        <button
          type="button"
          onClick={onOpenMenu}
          className="flex flex-col items-center justify-center flex-1 h-full py-1 text-[10px] font-mono text-slate hover:text-paper transition-colors"
          aria-label="Open full menu"
        >
          <Menu className="w-5 h-5 mb-0.5" />
          <span>Menu</span>
        </button>
      </div>
    </nav>
  );
}
