"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
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

export function ExecutiveNav() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activePanel, setActivePanel] = useState<string | null>(null);
  const [portalMenuOpen, setPortalMenuOpen] = useState(false);
  const [metrics, setMetrics] = useState<{ activeSites: number; contractValue: number } | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pathname = usePathname();
  const currentPathname = pathname ?? "/";

  useEffect(() => {
    // Prefetch metrics for Intelligence nav
    const fetchMetrics = async () => {
      try {
        const res = await fetch("/api/v1/metrics");
        if (res.ok) {
          const data = await res.json();
          setMetrics({
            activeSites: data.data.activeSites,
            contractValue: data.data.contractValue,
          });
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
          <Link href="/" className="group flex flex-col" aria-label="Six Nine Construction — home">
            <span className="font-black text-[28px] leading-none text-signal tracking-[-0.02em]">
              SNC
            </span>
            <span className="font-mono font-medium text-[9px] tracking-[0.2em] text-slate-light mt-0.5 uppercase">
              Six Nine Construction
            </span>
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
                        <div className="font-mono text-[9px] tracking-[0.12em] uppercase text-slate/60 mb-2">Live Status</div>
                        <div className="font-bold text-[32px] leading-none text-paper tracking-[-0.02em] mb-1">
                          {metrics ? metrics.activeSites : '--'}
                        </div>
                        <div className="font-mono text-[10px] tracking-[0.05em] text-slate uppercase">Active Sites</div>
                      </div>
                      <div>
                        <div className="font-mono text-[9px] tracking-[0.12em] uppercase text-slate/60 mb-2">Capital Deployed</div>
                        <div className="font-bold text-[32px] leading-none text-signal tracking-[-0.02em] mb-1">
                          {metrics ? `$${metrics.contractValue}M` : '--'}
                        </div>
                        <div className="font-mono text-[10px] tracking-[0.05em] text-slate uppercase">Current Fiscal</div>
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
                        <div className="font-mono text-[9px] tracking-[0.12em] uppercase text-signal mb-2">Featured Delivery</div>
                        <h4 className="font-semibold text-[18px] text-paper mb-2 group-hover:text-signal transition-colors duration-fast">
                          Harare–Beitbridge Highway
                        </h4>
                        <p className="text-[13px] text-slate leading-relaxed mb-4">
                          14.2km dual carriageway execution including primary structural drainage and asphalt overlay. Delivered 4 months ahead of schedule.
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
    </>
  );
}
