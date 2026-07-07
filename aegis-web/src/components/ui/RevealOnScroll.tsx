"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useInView } from "@/hooks/useInView";

interface RevealOnScrollProps {
  children: React.ReactNode;
  delay?: number;
  direction?: "up" | "left" | "right";
  className?: string;
}

export function RevealOnScroll({ children, delay = 0, direction = "up", className = "" }: RevealOnScrollProps) {
  const { ref, inView } = useInView();
  const prefersReducedMotion = useReducedMotion();

  if (prefersReducedMotion) {
    return <div className={className}>{children}</div>;
  }

  const getInitial = () => {
    switch (direction) {
      case "up": return { opacity: 0, y: 32 };
      case "left": return { opacity: 0, x: -32 };
      case "right": return { opacity: 0, x: 32 };
      default: return { opacity: 0, y: 32 };
    }
  };

  const getAnimate = () => {
    switch (direction) {
      case "up": return { opacity: 1, y: 0 };
      case "left": return { opacity: 1, x: 0 };
      case "right": return { opacity: 1, x: 0 };
      default: return { opacity: 1, y: 0 };
    }
  };

  return (
    <motion.div
      ref={ref}
      initial={getInitial()}
      animate={inView ? getAnimate() : getInitial()}
      transition={{
        duration: 0.65,
        delay: delay,
        ease: [0.25, 0.46, 0.45, 0.94],
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
