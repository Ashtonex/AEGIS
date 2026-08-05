"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { BriefcaseBusiness, Building2, ChevronDown, Search, ShieldCheck, Truck, Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { transitions } from "@/lib/motion";

// Arrival delay — nav fades in after 300ms per Volume III Sequence 01 spec
const NAV_ARRIVAL_DELAY = 0.3;

const NAV_ITEMS = [
  { label: "Operations", href: "/capabilities", contentPanel: true },
  { label: "Intelligence", href: "/projects", contentPanel: true },
  { label: "Governance", href: "/about", contentPanel: false },
];

// Destinations only otherwise reachable via the footer - included in the
// mobile drawer since a mobile visitor can't scroll-discover the footer as
// naturally as a desktop one, and previously had no way to reach these at all.
const MOBILE_ONLY_LINKS = [
  { label: "Knowledge Centre", href: "/knowledge" },
  { label: "Newsroom", href: "/news" },
  { label: "Tenders", href: "/tenders" },
  { label: "Suppliers", href: "/suppliers" },
  { label: "Careers", href: "/careers" },
  { label: "Contact", href: "/contact" },
];

export function ExecutiveNav() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activePanel, setActivePanel] = useState<string | null>(null);
  const [portalMenuOpen, setPortalMenuOpen] = useState(false);
  const [metrics, setMetrics] = useState<{ projectsDelivered: number; contractValueM: number } | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pathname = usePathname();
  const currentPathname = pathname ?? "/";

  useEffect(() => {
    // Prefetch metrics for Intelligence nav
    const fetchMetrics = async () => {
      try {
        const res = await fetch("/api/v1/metrics");
        if (res.ok) {
          const body = await res.json();
          if (body.success && body.data) {
            setMetrics({
              projectsDelivered: body.data.projects_delivered ?? 0,
              contractValueM: Math.round((body.data.contract_value_usd ?? 0) / 100_000) / 10,
            });
          }
        }
      } catch (e) {
        // Silent
      }
    };
    fetchMetrics();
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 80);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    setMobileMenuOpen(false);
    setActivePanel(null);
    setPortalMenuOpen(false);
  }, [pathname]);

  const handleMouseEnter = (label: string, hasPanel: boolean) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (!hasPanel) {
      setActivePanel(null);
      return;
    }
    timeoutRef.current = setTimeout(() => {
      setActivePanel(label);
    }, 150);
  };

  const handleMouseLeave = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setActivePanel(null);
      setPortalMenuOpen(false);
    }, 200);
  };

  const shouldReduceMotion = useReducedMotion();

  return (
    <>
      <motion.header
        className={cn(
          "fixed top-0 inset-x-0 z-50 transition-[padding,background-color,border-color] ease-dxl",
          scrolled
            ? "bg-ink/95 backdrop-blur-md border-b border-ink-mid py-4"
            : "bg-transparent border-b-0 py-6"
        )}
        // Nav arrives 300ms after page loads — Sequence 01 Arrival spec
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{
          duration: shouldReduceMotion ? 0 : 0.4,
          ease: [0.4, 0, 0.2, 1],
          delay: shouldReduceMotion ? 0 : NAV_ARRIVAL_DELAY,
        }}
        onMouseLeave={handleMouseLeave}
      >
        <div className="max-w-container mx-auto px-6 md:px-10 lg:px-16 xl:px-20 flex items-center justify-between">
          
          {/* LOGO */}
          <Link href="/" className="group flex flex-col items-center justify-center" aria-label="Six Nine Construction — home">
            <Image
              src="/logo.png"
              alt="SNC Logo"
              width={72}
              height={48}
              className="h-[48px] w-auto object-contain transition-transform duration-300 group-hover:scale-105"
            />
          </Link>

          {/* DESKTOP NAV */}
          <nav className="hidden md:flex items-center gap-12" aria-label="Primary navigation">
            {NAV_ITEMS.map((item) => {
              const isActive = currentPathname.startsWith(item.href);
              return (
                <div
                  key={item.label}
                  className="relative"
                  onMouseEnter={() => handleMouseEnter(item.label, item.contentPanel)}
                >
                  <Link
                    href={item.href}
                    className={cn(
                      "font-sans font-semibold text-[13px] tracking-[0.06em] uppercase transition-colors duration-micro ease-dxl py-4 block",
                      isActive ? "text-signal" : "text-slate-light hover:text-paper"
                    )}
                  >
                    {item.label}
                  </Link>
                  {/* Active indicator line */}
                  {isActive && (
                    <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-signal" aria-hidden="true" />
                  )}
                </div>
              );
            })}
          </nav>

          {/* ACTIONS */}
          <div className="hidden md:flex items-center gap-4">
            <button
              className="text-slate-light hover:text-paper transition-colors duration-micro p-2"
              aria-label="Search"
            >
              <Search className="w-4 h-4" />
            </button>
            <div className="relative">
              <Link
                href="/login"
                className="inline-flex items-center gap-2 bg-signal text-ink font-bold text-[12px] tracking-[0.08em] uppercase px-5 py-2.5 transition-colors duration-fast hover:bg-[#E8B422]"
                aria-label="Access secure portal"
              >
                Secure Access
              </Link>
            </div>
          </div>

          {/* MOBILE TOGGLE */}
          <button
            className="md:hidden z-50 text-paper p-1"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileMenuOpen}
          >
            <AnimatePresence mode="wait" initial={false}>
              {mobileMenuOpen ? (
                <motion.span key="close" initial={{ opacity: 0, rotate: -90 }} animate={{ opacity: 1, rotate: 0 }} exit={{ opacity: 0 }} transition={transitions.fast}>
                  <X className="w-6 h-6" />
                </motion.span>
              ) : (
                <motion.span key="open" initial={{ opacity: 0, rotate: 90 }} animate={{ opacity: 1, rotate: 0 }} exit={{ opacity: 0 }} transition={transitions.fast}>
                  <Menu className="w-6 h-6" />
                </motion.span>
              )}
            </AnimatePresence>
          </button>
        </div>

        {/* MEGA PANEL */}
        <AnimatePresence>
          {activePanel && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
              onMouseEnter={() => handleMouseEnter(activePanel, true)}
              className="absolute top-full left-0 right-0 bg-ink/98 backdrop-blur-xl border-y border-ink-mid shadow-2xl overflow-hidden"
            >
              <div className="max-w-container mx-auto px-6 md:px-10 lg:px-16 xl:px-20 py-10">
                <div className="flex items-center gap-4 mb-8">
                  <span className="dxl-eyebrow">{activePanel}</span>
                </div>
                
                {/* ── Operations Panel ── */}
                {activePanel === "Operations" && (
                  <div className="flex gap-12">
                    {[
                      { title: "Civil Engineering", href: "/capabilities", desc: "Earthworks, roads, and primary infrastructure at national scale." },
                      { title: "Structural Construction", href: "/capabilities", desc: "Commercial, industrial, and specialized architectural realization." },
                      { title: "Plant & Logistics", href: "/capabilities", desc: "Fleet deployment, earthmoving, and project support via Dreamcast." },
                      { title: "Technical Advisory", href: "/capabilities", desc: "Feasibility, risk mitigation, and cost-engineering intelligence." },
                    ].map((item) => (
                      <Link
                        key={item.title}
                        href={item.href}
                        className="group flex-1 border-t border-ink-mid pt-4 transition-colors duration-micro hover:border-signal"
                      >
                        <div className="font-semibold text-[14px] text-paper mb-2 group-hover:text-signal transition-colors duration-micro">
                          {item.title}
                        </div>
                        <div className="text-[13px] text-slate leading-relaxed">{item.desc}</div>
                      </Link>
                    ))}
                  </div>
                )}

                {/* ── Intelligence Panel ── */}
                {activePanel === "Intelligence" && (
                  <div className="grid grid-cols-12 gap-12">
                    
                    {/* Left: Project Data Metrics */}
                    <div className="col-span-5 grid grid-cols-2 gap-8 border-t border-ink-mid pt-4">
                      <div>
                        <div className="font-mono text-[9px] tracking-[0.12em] uppercase text-slate/60 mb-2">Delivery Record</div>
                        <div className="font-bold text-[32px] leading-none text-paper tracking-[-0.02em] mb-1">
                          {metrics ? metrics.projectsDelivered : '--'}
                        </div>
                        <div className="font-mono text-[10px] tracking-[0.05em] text-slate uppercase">Projects Delivered</div>
                      </div>
                      <div>
                        <div className="font-mono text-[9px] tracking-[0.12em] uppercase text-slate/60 mb-2">Capital Deployed</div>
                        <div className="font-bold text-[32px] leading-none text-signal tracking-[-0.02em] mb-1">
                          {metrics ? `$${metrics.contractValueM}M` : '--'}
                        </div>
                        <div className="font-mono text-[10px] tracking-[0.05em] text-slate uppercase">Contract Value Executed</div>
                      </div>
                      <div className="col-span-2 mt-6">
                        <Link href="/projects" className="inline-flex items-center gap-3 bg-paper text-ink font-bold text-[11px] tracking-[0.1em] uppercase px-6 py-3 transition-colors duration-fast hover:bg-signal">
                          Access Register
                        </Link>
                      </div>
                    </div>

                    {/* Right: Featured Case Study */}
                    <Link href="/projects" className="col-span-7 group border-t border-ink-mid pt-4 flex gap-6 cursor-pointer">
                      <div className="flex-1">
                        <div className="font-mono text-[9px] tracking-[0.12em] uppercase text-signal mb-2">Project Register</div>
                        <h4 className="font-semibold text-[18px] text-paper mb-2 group-hover:text-signal transition-colors duration-fast">
                          Delivery evidence across the portfolio
                        </h4>
                        <p className="text-[13px] text-slate leading-relaxed mb-4">
                          Browse civil, structural, and mining infrastructure work executed across Zimbabwe, with scope and delivery detail per project.
                        </p>
                        <span className="font-mono text-[10px] tracking-[0.1em] text-paper/50 uppercase group-hover:text-paper transition-colors duration-fast inline-flex items-center gap-2">
                          View Project 
                          <svg viewBox="0 0 16 8" fill="none" className="w-3 h-3 group-hover:translate-x-1 transition-transform duration-fast">
                            <path d="M0 4h14M11 1l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </span>
                      </div>
                      <div className="w-[280px] h-[160px] relative overflow-hidden bg-ink-mid">
                        <div 
                          className="absolute inset-0 bg-cover bg-center transition-transform duration-reveal ease-dxl group-hover:scale-105" 
                          style={{ backgroundImage: "url('/proj-highway.jpg')" }} 
                        />
                        <div className="absolute inset-0 bg-ink/20 transition-opacity duration-fast group-hover:opacity-0" />
                      </div>
                    </Link>

                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.header>

      {/* MOBILE NAV DRAWER — plain conditional render + CSS transition, not
          AnimatePresence: framer-motion's exit animation left a stale DOM
          node behind in dev mode when this same pattern was tried elsewhere
          in this app, so this sidesteps that class of bug entirely. */}
      {mobileMenuOpen && (
        <div className="md:hidden fixed inset-0 z-40 bg-ink pt-24 px-6 pb-8 overflow-y-auto">
          <nav className="flex flex-col gap-1" aria-label="Mobile navigation">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className="flex items-center justify-between border-b border-ink-mid py-4 font-sans font-semibold text-[20px] text-paper hover:text-signal transition-colors"
              >
                {item.label}
              </Link>
            ))}
            {MOBILE_ONLY_LINKS.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className="flex items-center justify-between border-b border-ink-mid py-4 font-sans text-[15px] text-slate-light hover:text-paper transition-colors"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <Link
            href="/login"
            className="mt-8 inline-flex w-full items-center justify-center gap-2 bg-signal text-ink font-bold text-[13px] tracking-[0.08em] uppercase px-5 py-3.5 transition-colors duration-fast hover:bg-[#E8B422]"
            aria-label="Access secure portal"
          >
            Secure Access
          </Link>
        </div>
      )}
    </>
  );
}
