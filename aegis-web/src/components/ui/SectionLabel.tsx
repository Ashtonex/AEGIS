"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useInView } from "@/hooks/useInView";

interface SectionLabelProps {
  label?: string;
  className?: string;
  children?: React.ReactNode;
}

export function SectionLabel({ label, className = "", children }: SectionLabelProps) {
  const { ref, inView } = useInView();
  const prefersReducedMotion = useReducedMotion();

  return (
    <div ref={ref} className={`flex items-center gap-4 mb-4 ${className}`}>
      <motion.div
        className="h-px bg-snc-gold-primary origin-left"
        style={{ width: 48 }}
        initial={{ scaleX: 0 }}
        animate={inView || prefersReducedMotion ? { scaleX: 1 } : { scaleX: 0 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
      />
      <span className="text-label">{label || children}</span>
    </div>
  );
}
