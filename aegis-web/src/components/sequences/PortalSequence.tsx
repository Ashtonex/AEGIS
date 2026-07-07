"use client";

/**
 * PortalSequence — Sequence 06
 * ─────────────────────────────────────────────────────────────────────────────
 * Volume III Objective: The operational gateway. Not just a website, but a system.
 *
 * Emotional arc:
 *   Operations (Archival, horizontal) → PORTAL (Systemic, bento grid, real-time)
 *   The visitor has seen the history. Now they reach the front door of the actual
 *   business operations. It should feel like an operating system interface.
 *
 * Volume II Rules applied:
 *   - Layout: Bento-box CSS Grid. Strict modularity, unequal cell sizes.
 *   - Surface: Ink background, cells use Ink-Mid for subtle elevation without shadows.
 *   - Live Data: Harare local time clock, system status indicator (Green/Signal).
 *   - Typography: Monospace heavy to reinforce the "software" feeling.
 *   - Hover: Cells slightly brighten border on hover. No bouncy scale effects.
 *
 * Grid layout (Desktop 12 columns, 3 rows):
 *   - Top Bar (System Status / Clock): col-span-12
 *   - Client Portal: col-span-7, row-span-2 (Dominant)
 *   - Supply Chain/Partner Portal: col-span-5, row-span-1
 *   - Staff/Internal Portal: col-span-5, row-span-1
 *
 * Mobile: Stacked single column bento.
 */

import { useState, useEffect, useRef } from "react";
import { motion, useInView, useReducedMotion } from "framer-motion";
import Link from "next/link";
import { sequenceRevealVariants, sequenceFadeVariants, transitions } from "@/lib/motion";
import { ArrowRight, Lock, Shield, Server, Clock } from "lucide-react";

export function PortalSequence() {
  const shouldReduceMotion = useReducedMotion();
  const sectionRef = useRef<HTMLElement>(null);
  const isInView = useInView(sectionRef, { once: true, margin: "-10% 0px" });

  // Live Harare Clock
  const [time, setTime] = useState<string>("");
  
  // Live System Status
  const [systemStatus, setSystemStatus] = useState<{ status: string; latency: number } | null>(null);

  useEffect(() => {
    // Only run on client to avoid hydration mismatch
    const updateTime = () => {
      const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: "Africa/Harare",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      });
      setTime(formatter.format(new Date()));
    };
    
    updateTime();
    const timeInterval = setInterval(updateTime, 1000);
    
    // Fetch system status
    const fetchStatus = async () => {
      try {
        const res = await fetch("/api/v1/system/status");
        if (res.ok) {
          const data = await res.json();
          setSystemStatus({
            status: data.status,
            latency: data.metrics?.latency_ms || 14,
          });
        }
      } catch (err) {
        // Silent fallback
      }
    };
    
    fetchStatus();
    const statusInterval = setInterval(fetchStatus, 10000);
    
    return () => {
      clearInterval(timeInterval);
      clearInterval(statusInterval);
    };
  }, []);

  return (
    <section
      id="portal"
      ref={sectionRef}
      aria-labelledby="portal-heading"
      className="bg-ink relative py-24 md:py-32"
    >
      <div className="max-w-[1440px] mx-auto px-6 md:px-10 lg:px-16 xl:px-20">
        
        {/* ── Section header ──────────────────────────────────────────────── */}
        <motion.div
          className="flex flex-col md:flex-row items-start md:items-end justify-between mb-12"
          initial="hidden"
          animate={isInView ? "visible" : "hidden"}
          custom={0}
          variants={sequenceRevealVariants}
        >
          <div>
            <h2
              id="portal-heading"
              className="font-mono text-[11px] tracking-[0.12em] uppercase text-signal mb-4"
            >
              06 — System Access
            </h2>
            <p className="font-black text-[clamp(32px,4vw,52px)] leading-[1.0] tracking-[-0.02em] text-paper">
              Project AEGIS DXL.
            </p>
          </div>
          <div className="mt-6 md:mt-0">
            <span className="font-mono text-[10px] tracking-[0.15em] uppercase text-slate/40 block text-right">
              06 / 07
            </span>
          </div>
        </motion.div>

        {/* ── Bento Grid ─────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 auto-rows-min">
          
          {/* Top Status Bar (col-span-12) */}
          <motion.div
            className="lg:col-span-12 flex flex-col sm:flex-row items-start sm:items-center justify-between bg-ink-mid/30 border border-ink-mid p-4 rounded-sm"
            initial="hidden"
            animate={isInView ? "visible" : "hidden"}
            custom={1}
            variants={sequenceRevealVariants}
          >
            <div className="flex items-center gap-6 mb-4 sm:mb-0">
              <div className="flex items-center gap-2">
                <div className="relative flex h-2 w-2">
                  {systemStatus?.status === "online" ? (
                    <>
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#2ECC71] opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-[#2ECC71]"></span>
                    </>
                  ) : (
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-slate"></span>
                  )}
                </div>
                <span className={`font-mono text-[10px] tracking-[0.1em] uppercase ${systemStatus?.status === 'online' ? 'text-[#2ECC71]' : 'text-slate'}`}>
                  {systemStatus ? `AEGIS Core ${systemStatus.status}` : 'Connecting...'}
                </span>
              </div>
              <div className="hidden sm:flex items-center gap-2">
                <Server className="w-3 h-3 text-slate/50" />
                <span className="font-mono text-[10px] tracking-[0.1em] uppercase text-slate/50">
                  Latency: {systemStatus ? `${systemStatus.latency}ms` : '--'}
                </span>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <Clock className="w-3 h-3 text-signal" />
              <span className="font-mono text-[11px] tracking-[0.15em] uppercase text-paper w-[72px]" suppressHydrationWarning>
                {time || "00:00:00"}
              </span>
              <span className="font-mono text-[10px] tracking-[0.1em] text-slate/50 ml-1">CAT</span>
            </div>
          </motion.div>

          {/* Client Portal (col-span-7, row-span-2) */}
          <motion.div
            className="lg:col-span-7 lg:row-span-2 group relative bg-ink-mid/20 border border-ink-mid p-8 md:p-12 rounded-sm transition-colors duration-300 hover:border-signal/50 hover:bg-ink-mid/40 flex flex-col justify-between min-h-[380px]"
            initial="hidden"
            animate={isInView ? "visible" : "hidden"}
            custom={2}
            variants={sequenceRevealVariants}
          >
            <div>
              <Shield className="w-8 h-8 text-signal mb-8 opacity-80" />
              <h3 className="font-black text-[28px] md:text-[36px] leading-[1.1] text-paper mb-4">
                Client Dashboard
              </h3>
              <p className="text-[15px] leading-[1.6] text-slate max-w-md">
                Secure access to live project telemetry. Review daily site reports, 
                financial drawdowns, drone progression scans, and health & safety metrics.
              </p>
            </div>
            
            <div className="mt-12">
              <Link 
                href="/login" 
                className="inline-flex items-center gap-3 bg-paper text-ink px-6 py-3 font-mono text-[11px] tracking-[0.1em] uppercase hover:bg-signal transition-colors duration-300"
              >
                Authenticate
                <ArrowRight className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1" />
              </Link>
            </div>
          </motion.div>

          {/* Partner & Subcontractor Portal (col-span-5, row-span-1) */}
          <motion.div
            className="lg:col-span-5 lg:row-span-1 group relative bg-ink-mid/20 border border-ink-mid p-8 rounded-sm transition-colors duration-300 hover:border-paper/30 hover:bg-ink-mid/40 flex flex-col justify-between min-h-[182px]"
            initial="hidden"
            animate={isInView ? "visible" : "hidden"}
            custom={3}
            variants={sequenceRevealVariants}
          >
             <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-[18px] text-paper">Partner Network</h3>
                <Lock className="w-4 h-4 text-slate/40" />
              </div>
              <p className="font-mono text-[11px] leading-[1.5] text-slate/70 max-w-sm uppercase tracking-[0.05em]">
                Subcontractor procurement, invoicing, and supply chain logistics.
              </p>
            </div>
            <Link 
                href="/login?type=partner" 
                className="inline-flex items-center gap-2 font-mono text-[10px] tracking-[0.1em] uppercase text-paper/60 mt-6 hover:text-paper transition-colors duration-300"
              >
                Enter Portal
                <ArrowRight className="w-3 h-3 transition-transform duration-300 group-hover:translate-x-1" />
            </Link>
          </motion.div>

          {/* Internal Systems (col-span-5, row-span-1) */}
          <motion.div
            className="lg:col-span-5 lg:row-span-1 group relative bg-ink-mid/20 border border-ink-mid p-8 rounded-sm transition-colors duration-300 hover:border-paper/30 hover:bg-ink-mid/40 flex flex-col justify-between min-h-[182px]"
            initial="hidden"
            animate={isInView ? "visible" : "hidden"}
            custom={4}
            variants={sequenceRevealVariants}
          >
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-[18px] text-paper">Staff Operations</h3>
                <Lock className="w-4 h-4 text-slate/40" />
              </div>
              <p className="font-mono text-[11px] leading-[1.5] text-slate/70 max-w-sm uppercase tracking-[0.05em]">
                AEGIS internal system access. Resource allocation, HR, and fleet management.
              </p>
            </div>
            <Link 
                href="/login?type=staff" 
                className="inline-flex items-center gap-2 font-mono text-[10px] tracking-[0.1em] uppercase text-paper/60 mt-6 hover:text-paper transition-colors duration-300"
              >
                Secured Access
                <ArrowRight className="w-3 h-3 transition-transform duration-300 group-hover:translate-x-1" />
            </Link>
          </motion.div>

        </div>
      </div>
    </section>
  );
}
