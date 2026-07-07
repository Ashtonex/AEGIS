"use client";

import { motion, useScroll, useTransform } from "framer-motion";
import { useRef } from "react";
import { cn } from "@/lib/utils";

interface ScrollFadeProps {
  children: React.ReactNode;
  className?: string;
}

export const ScrollFade = ({ children, className }: ScrollFadeProps) => {
  const ref = useRef<HTMLDivElement>(null);
  
  // Track the element's position relative to the viewport
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"]
  });

  // Map progress (0 = entering bottom, 0.5 = center, 1 = leaving top)
  const opacity = useTransform(scrollYProgress, [0, 0.4, 0.6, 1], [0.1, 1, 1, 0.1]);
  const scale = useTransform(scrollYProgress, [0, 0.5, 1], [0.8, 1, 1.1]);
  const filter = useTransform(
    scrollYProgress,
    [0, 0.4, 0.6, 1],
    ["blur(10px)", "blur(0px)", "blur(0px)", "blur(10px)"]
  );

  return (
    <motion.div
      ref={ref}
      style={{ opacity, scale, filter }}
      className={cn("will-change-[opacity,transform,filter]", className)}
    >
      {children}
    </motion.div>
  );
};
