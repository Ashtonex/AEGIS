"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { ChevronRight, ChevronDown } from "lucide-react";
import { SectionLabel } from "./SectionLabel";
import { Button } from "./Button";
import { StatCounter } from "./StatCounter";
import { cn } from "@/lib/utils";

interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface PageHeroProps {
  variant?: "full" | "half";
  title?: string | React.ReactNode;
  subtitle?: string;
  breadcrumbs?: BreadcrumbItem[];
  backgroundImage?: string;
  className?: string;
}

export function PageHero({ 
  variant = "half", 
  title, 
  subtitle, 
  breadcrumbs,
  backgroundImage,
  className 
}: PageHeroProps) {

  if (variant === "full") {
    return (
      <section 
        className={cn("relative min-h-[100dvh] pt-32 pb-20 bg-snc-void blueprint-grid flex flex-col justify-center overflow-hidden", className)}
        style={{ 
          backgroundImage: `linear-gradient(to bottom, rgba(11,15,20,0.8), rgba(7,10,13,1)), url('/hero_cinematic.png')`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundBlendMode: 'overlay'
        }}
      >
        
        {/* GOLD ENTRY LINE */}
        <motion.div 
          className="absolute left-0 h-px top-[35%]"
          style={{ 
            background: "linear-gradient(90deg, transparent, var(--snc-gold-primary) 20%, var(--snc-gold-primary) 80%, transparent)" 
          }}
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: "100%", opacity: 0.4 }}
          transition={{ duration: 2.5, ease: "easeOut" }}
        />

        <div className="container relative z-10">
          <div className="max-w-4xl">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
            >
              <SectionLabel label="Engineered to Perform" />
            </motion.div>

            <h1 className="mt-4 mb-8">
              <motion.span 
                className="block font-display text-[clamp(40px,8vw,120px)] leading-[0.95] text-snc-text-primary"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.3 }}
              >
                INFRASTRUCTURE
              </motion.span>
              <motion.span 
                className="block font-display text-[clamp(40px,8vw,120px)] leading-[0.95] text-snc-text-primary"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.45 }}
              >
                BUILT WITH
              </motion.span>
              <motion.span 
                className="block font-display text-[clamp(40px,8vw,120px)] leading-[0.95] text-snc-gold-primary"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.6 }}
              >
                UNYIELDING
              </motion.span>
              <motion.span 
                className="block font-display text-[clamp(40px,8vw,120px)] leading-[0.95] text-snc-text-primary"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.75 }}
              >
                PRECISION
              </motion.span>
            </h1>

            <motion.p 
              className="text-body-xl text-snc-text-secondary max-w-2xl mb-10"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 1.0 }}
            >
              Southern Africa's premier contractor for high-stakes civil engineering, commercial construction, and mining infrastructure.
            </motion.p>

            <motion.div 
              className="flex flex-col sm:flex-row gap-4 mb-16"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 1.3 }}
            >
              <Link href="/dashboard">
                <Button variant="primary" className="w-full sm:w-auto">Access Project Portal</Button>
              </Link>
              <Link href="/capabilities">
                <Button variant="outline" className="w-full sm:w-auto">View Capabilities</Button>
              </Link>
            </motion.div>

            {/* TRUST INDICATORS & STAT ROW */}
            <motion.div 
              className="flex flex-col md:flex-row md:items-center gap-10 md:gap-16 pt-8 border-t border-snc-border"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 1.6 }}
            >
              <div className="flex flex-row items-center gap-6">
                <div className="text-caption text-snc-text-tertiary">ISO 9001:2015</div>
                <div className="w-px h-6 bg-snc-border" />
                <div className="text-caption text-snc-text-tertiary">PRAZ CATEGORY A</div>
                <div className="w-px h-6 bg-snc-border" />
                <div className="text-caption text-snc-text-tertiary">CIFOZ CLASS A</div>
              </div>
              <div className="flex flex-row items-start gap-6 md:gap-16">
                <StatCounter value={15} suffix="+" label="YEARS EXCELLENCE" showDivider={true} />
                <StatCounter value={100} suffix="M+" label="PROJECT VALUE" showDivider={true} />
                <StatCounter value={0} suffix=" LTI" label="SAFETY RECORD" showDivider={false} />
              </div>
            </motion.div>
          </div>
        </div>

        {/* SCROLL INDICATOR */}
        <motion.div 
          className="absolute bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center justify-center gap-2"
          animate={{ y: [0, 8, 0] }}
          transition={{ duration: 2, ease: "easeInOut", repeat: Infinity }}
        >
          <span className="text-caption">SCROLL</span>
          <ChevronDown className="w-5 h-5 text-snc-gold-primary" />
        </motion.div>
      </section>
    );
  }

  // HALF VARIANT (INNER PAGES)
  return (
    <section 
      className={cn("relative min-h-[50vh] flex flex-col justify-end pt-32 pb-16 bg-snc-navy overflow-hidden", className)}
      style={backgroundImage ? { 
        backgroundImage: `linear-gradient(to bottom, rgba(10,22,40,0.8), rgba(4,8,16,1)), url(${backgroundImage})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center'
      } : {}}
    >
      <div className="absolute inset-0 blueprint-grid opacity-30" />
      
      <div className="container relative z-10">
        {breadcrumbs && (
          <div className="mb-8">
            <div className="flex items-center gap-2 text-caption">
              {breadcrumbs.map((crumb, index) => (
                <div key={index} className="flex items-center gap-2">
                  {index > 0 && <ChevronRight className="w-3 h-3 text-snc-gold-primary" />}
                  {crumb.href ? (
                    <Link href={crumb.href} className="text-snc-text-tertiary hover:text-snc-text-primary transition-colors">
                      {crumb.label}
                    </Link>
                  ) : (
                    <span className="text-snc-text-primary">{crumb.label}</span>
                  )}
                </div>
              ))}
            </div>
            <div className="w-12 h-px bg-snc-gold-primary mt-4" />
          </div>
        )}

        <div className="max-w-4xl">
          <h1 className="text-headline-xl text-snc-text-primary mb-6">{title}</h1>
          {subtitle && (
            <p className="text-body-xl text-snc-text-secondary max-w-2xl">{subtitle}</p>
          )}
        </div>
      </div>
    </section>
  );
}
