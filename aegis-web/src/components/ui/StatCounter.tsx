"use client";

import { useEffect, useState } from "react";
import { motion, animate, useReducedMotion } from "framer-motion";
import { useInView } from "@/hooks/useInView";

interface StatCounterProps {
  value: number;
  suffix?: string;
  label: string;
  duration?: number;
  showDivider?: boolean;
}

export function StatCounter({ value, suffix = "", label, duration = 2, showDivider = true }: StatCounterProps) {
  const { ref, inView } = useInView();
  const prefersReducedMotion = useReducedMotion();
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    if (prefersReducedMotion) {
      setDisplayValue(value);
      return;
    }

    if (inView) {
      const controls = animate(0, value, {
        duration,
        ease: [0.19, 1, 0.22, 1], // easeOutExpo approx
        onUpdate: (latest) => {
          setDisplayValue(Math.floor(latest));
        },
      });
      return () => controls.stop();
    }
  }, [inView, value, duration, prefersReducedMotion]);

  return (
    <div ref={ref} className="flex items-center">
      <div className="flex flex-col">
        <div className="flex items-baseline">
          <span className="text-display-lg text-snc-gold-primary">{displayValue}</span>
          {suffix && <span className="text-display-lg text-snc-gold-primary">{suffix}</span>}
        </div>
        <span className="text-label text-snc-text-tertiary mt-2 block">{label}</span>
      </div>
      
      {showDivider && (
        <div className="hidden md:block w-px h-[60px] bg-snc-gold-primary/30 mx-8 lg:mx-16" />
      )}
    </div>
  );
}
