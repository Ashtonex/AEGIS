"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Menu, X, ChevronRight, HardHat, Pickaxe, Building2 } from "lucide-react";
import { Button } from "../ui/Button";
import { SectionLabel } from "../ui/SectionLabel";
import { Card } from "../ui/Card";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { label: "Company", href: "/about" },
  { label: "Capabilities", href: "/capabilities" },
  { label: "Projects", href: "/projects" },
  { label: "Careers", href: "/careers" },
];

export function MegaNav() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activePanel, setActivePanel] = useState<string | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pathname = usePathname();
  const currentPathname = pathname ?? "/";

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 80);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false);
    setActivePanel(null);
  }, [pathname]);

  const handleMouseEnter = (label: string) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setActivePanel(label);
    }, 200);
  };

  const handleMouseLeave = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setActivePanel(null);
    }, 300);
  };

  return (
    <>
      <header
        className={cn(
          "fixed top-0 inset-x-0 z-50 transition-all duration-300",
          scrolled 
            ? "bg-[rgba(10,22,40,0.95)] backdrop-blur-[20px] border-b border-snc-border py-4" 
            : "bg-transparent border-b-0 py-6"
        )}
        onMouseLeave={handleMouseLeave}
      >
        <div className="max-w-[1400px] mx-auto px-6 md:px-10 lg:px-16 xl:px-20 flex items-center justify-between">
          
          {/* LOGO */}
          <Link href="/" className="group flex flex-col">
            <span className="font-display text-[32px] leading-none text-snc-gold-primary">SNC</span>
            <span className="font-sans font-medium text-[9px] tracking-[0.2em] text-snc-text-secondary mt-1">SIX NINE CONSTRUCTION</span>
          </Link>

          {/* DESKTOP NAV */}
          <nav className="hidden md:flex items-center gap-[40px]">
            {NAV_ITEMS.map((item) => {
              const isActive = currentPathname.startsWith(item.href);
              return (
                <div 
                  key={item.label}
                  className="relative"
                  onMouseEnter={() => handleMouseEnter(item.label)}
                >
                  <Link 
                    href={item.href}
                    className={cn(
                      "font-sans font-medium text-[13px] tracking-[0.04em] uppercase transition-colors duration-150 py-4 block relative",
                      isActive ? "text-snc-text-primary" : "text-snc-text-secondary hover:text-snc-text-primary"
                    )}
                  >
                    {item.label}
                    {isActive && (
                      <motion.div 
                        layoutId="nav-indicator"
                        className="absolute bottom-[10px] left-0 right-0 h-[2px] bg-snc-gold-primary" 
                      />
                    )}
                  </Link>
                </div>
              );
            })}
          </nav>

          {/* ACTIONS */}
          <div className="hidden md:flex items-center gap-3">
            <Link href="/tenders">
              <Button variant="ghostGold" size="sm">Tender Board</Button>
            </Link>
            <Link href="/login">
              <Button variant="primary" size="sm">Portal Login</Button>
            </Link>
          </div>

          {/* MOBILE TOGGLE */}
          <button 
            className="md:hidden z-50 text-snc-text-primary"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>

        {/* MEGA PANEL */}
        <AnimatePresence>
          {activePanel === "Capabilities" && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              onMouseEnter={() => handleMouseEnter("Capabilities")}
              className="absolute top-full left-0 right-0 bg-[rgba(10,22,40,0.98)] backdrop-blur-[40px] border-y border-snc-border"
            >
              <div className="max-w-[1400px] mx-auto px-6 md:px-10 lg:px-16 xl:px-20 py-10 flex">
                <div className="w-[40%] pr-12 border-r border-snc-border">
                  <SectionLabel label="Core Services" />
                  <div className="flex flex-col gap-1 mt-6">
                    {["Structural Construction", "Civil Engineering", "Earthmoving & Plant Hire", "Technical Advisory", "Project AEGIS™"].map(s => (
                      <Link key={s} href="/capabilities" className="group flex items-center font-sans font-medium text-[15px] text-snc-text-secondary py-2 transition-all duration-150 hover:text-snc-text-primary hover:translate-x-1 border-l-2 border-transparent hover:border-snc-gold-primary pl-4 -ml-4">
                        {s}
                      </Link>
                    ))}
                  </div>
                </div>
                <div className="w-[60%] pl-12">
                  <Card padding="standard" className="h-full flex flex-col justify-center border-snc-navy-mid">
                    <span className="text-label mb-3">Featured Infrastructure</span>
                    <h3 className="text-headline-md text-snc-text-primary mb-2">Kariba Dam Rehabilitation</h3>
                    <p className="text-body text-snc-text-secondary max-w-lg mb-6">A monumental feat of civil engineering extending the lifespan of Southern Africa&apos;s largest hydroelectric facility.</p>
                    <Link href="/projects/kariba" className="text-[13px] font-semibold text-snc-gold-primary flex items-center gap-2 uppercase tracking-widest hover:text-snc-gold-hover transition-colors">
                      View Case Study <ChevronRight className="w-4 h-4" />
                    </Link>
                  </Card>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      {/* MOBILE MENU */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-snc-void pt-28 px-6 flex flex-col"
          >
            <nav className="flex-1 flex flex-col gap-6">
              {NAV_ITEMS.map((item) => (
                <Link
                  key={item.label}
                  href={item.href}
                  className="font-display text-[40px] text-snc-text-primary hover:text-snc-gold-primary transition-colors flex items-center justify-between border-b border-snc-border pb-4"
                >
                  {item.label}
                  <ChevronRight className="w-6 h-6 text-snc-text-tertiary" />
                </Link>
              ))}
            </nav>
            <div className="pb-12 flex flex-col gap-4">
              <Link href="/tenders">
                <Button variant="ghostGold" size="full">Tender Board</Button>
              </Link>
              <Link href="/login">
                <Button variant="primary" size="full">Portal Login</Button>
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
