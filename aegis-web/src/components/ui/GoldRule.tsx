"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "@/hooks/useReducedMotion";

interface GoldRuleProps {
  className?: string;
}

export function GoldRule({ className }: GoldRuleProps) {
  const prefersReducedMotion = useReducedMotion();

  return (
    <motion.div
      className={cn("h-[2px] bg-[var(--snc-gold)]", className)}
      style={{ width: "48px", transformOrigin: "left" }}
      initial={{ scaleX: 0 }}
      whileInView={{ scaleX: 1 }}
      viewport={{ once: true, margin: "-10%" }}
      transition={{ 
        duration: prefersReducedMotion ? 0 : 0.8, 
        ease: [0.25, 0.46, 0.45, 0.94] 
      }}
    />
  );
}
