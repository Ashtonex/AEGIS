"use client";

import { motion } from "framer-motion";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { DXL_EASE, DURATION } from "@/lib/motion";

export function PageWrapper({ children }: { children: React.ReactNode }) {
  const prefersReducedMotion = useReducedMotion();

  if (prefersReducedMotion) {
    return <main className="min-h-screen pt-[104px] flex flex-col">{children}</main>;
  }

  return (
    <motion.main
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 16 }}
      transition={{ duration: DURATION.slow, ease: DXL_EASE }}
      className="min-h-screen pt-[104px] flex flex-col"
    >
      {children}
    </motion.main>
  );
}

