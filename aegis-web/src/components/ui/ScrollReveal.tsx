"use client";

import { motion, useScroll, useTransform, useInView } from "framer-motion";
import { useRef } from "react";
import { cn } from "@/lib/utils";

interface ScrollRevealProps {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  direction?: "up" | "down" | "left" | "right" | "none";
  amount?: "some" | "all" | number;
  staggerChildren?: boolean;
}

export function ScrollReveal({ 
  children, 
  className, 
  delay = 0, 
  direction = "up",
  amount = 0.2,
  staggerChildren = false
}: ScrollRevealProps) {
  const ref = useRef(null);
  
  // Use in-view for simple entrance animations
  const isInView = useInView(ref, { once: false, amount: amount as any });

  const getVariants = () => {
    if (staggerChildren) {
      return {
        hidden: { opacity: 0 },
        visible: {
          opacity: 1,
          transition: {
            staggerChildren: 0.1,
            delayChildren: delay
          }
        }
      };
    }
    
    switch (direction) {
      case "up": return { hidden: { opacity: 0, y: 40 }, visible: { opacity: 1, y: 0 } };
      case "down": return { hidden: { opacity: 0, y: -40 }, visible: { opacity: 1, y: 0 } };
      case "left": return { hidden: { opacity: 0, x: 40 }, visible: { opacity: 1, x: 0 } };
      case "right": return { hidden: { opacity: 0, x: -40 }, visible: { opacity: 1, x: 0 } };
      case "none": return { hidden: { opacity: 0 }, visible: { opacity: 1 } };
    }
  };

  return (
    <motion.div
      ref={ref}
      variants={getVariants()}
      initial="hidden"
      animate={isInView ? "visible" : "hidden"}
      transition={{ 
        duration: 0.8, 
        ease: [0.16, 1, 0.3, 1], // Custom cubic-bezier for premium feel
        delay: staggerChildren ? 0 : delay 
      }}
      className={cn(className)}
    >
      {children}
    </motion.div>
  );
}

// Child element for staggered lists
export function RevealItem({ children, className }: { children: React.ReactNode, className?: string }) {
  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 20 },
        visible: { opacity: 1, y: 0 }
      }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
