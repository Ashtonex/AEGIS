"use client";

import { useEffect, useRef } from "react";
import { animate, useInView } from "framer-motion";

interface StatItemProps {
  endValue: number;
  label: string;
  suffix?: string;
}

const StatItem = ({ endValue, label, suffix = "" }: StatItemProps) => {
  const nodeRef = useRef<HTMLSpanElement>(null);
  const isInView = useInView(nodeRef, { once: true, margin: "-50px" });

  useEffect(() => {
    if (isInView && nodeRef.current) {
      const controls = animate(0, endValue, {
        duration: 2.5,
        ease: "easeOut",
        onUpdate: (value) => {
          if (nodeRef.current) {
            nodeRef.current.textContent = Math.round(value).toLocaleString() + suffix;
          }
        },
      });
      return controls.stop;
    }
  }, [endValue, isInView, suffix]);

  return (
    <div className="flex flex-col items-center justify-center p-8 text-center border-r border-[var(--snc-border)] last:border-r-0">
      <span
        ref={nodeRef}
        className="text-5xl md:text-6xl font-display text-[var(--snc-navy)] mb-2 tracking-tight"
      >
        0{suffix}
      </span>
      <span className="text-sm md:text-base font-semibold text-[var(--snc-slate)] uppercase tracking-wider">
        {label}
      </span>
    </div>
  );
};

export const StatsTicker = () => {
  return (
    <div className="bg-white border-y border-[var(--snc-border)] relative z-20 -mt-16 mx-4 lg:mx-auto max-w-6xl rounded-sm shadow-2xl">
      <div className="grid grid-cols-2 md:grid-cols-4 divide-y md:divide-y-0 divide-[var(--snc-border)]">
        <StatItem endValue={12500} suffix="+" label="Projects Completed" />
        <StatItem endValue={45000} suffix="+" label="Square Meters Built" />
        <StatItem endValue={18} label="Years of Excellence" />
        <StatItem endValue={500} suffix="+" label="Team Members" />
      </div>
    </div>
  );
};
