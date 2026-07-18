"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/Button";
import Link from "next/link";
import Image from "next/image";
import { Reveal } from "@/components/ui/Reveal";

const HERO_IMAGES = [
  "/hero_cinematic.png",
  "/proj-highway.jpg",
  "/snc_civil_yard.png",
  "/snc_industrial_warehouse.png",
];

export const HeroCarousel = () => {
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % HERO_IMAGES.length);
    }, 4000);
    return () => clearInterval(timer);
  }, []);

  return (
    <section className="relative h-[100dvh] w-full overflow-hidden flex items-center bg-[var(--snc-navy)] -mt-[104px] pt-[104px]">
      {/* Background Images with Fade Transition */}
      <AnimatePresence initial={false}>
        <motion.div
          key={currentIndex}
          initial={{ opacity: 0, scale: 1.05 }}
          animate={{ opacity: 0.6, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1.2, ease: "easeInOut" }}
          className="absolute inset-0 z-0"
        >
          <Image
            src={HERO_IMAGES[currentIndex]}
            alt="Six Nine Construction Sites"
            fill
            priority
            sizes="100vw"
            className="w-full h-full object-cover"
          />
        </motion.div>
      </AnimatePresence>

      {/* Gradients to ensure text readability */}
      <div className="absolute inset-0 z-10 bg-gradient-to-t from-[var(--snc-navy)] via-[var(--snc-navy)]/60 to-transparent" />
      <div className="absolute inset-0 z-10 bg-gradient-to-r from-[var(--snc-navy)] via-transparent to-transparent opacity-80" />

      {/* Content */}
      <div className="container relative z-20 mx-auto px-6 lg:px-12">
        <div className="max-w-4xl">
          <Reveal delay={0.2}>
            <div className="inline-flex items-center gap-2 px-4 py-1.5 mb-8 rounded-full border border-[var(--snc-border)]/20 bg-white/10 backdrop-blur-md">
              <div className="w-2 h-2 rounded-full bg-[var(--snc-red)] animate-pulse" />
              <span className="text-xs font-semibold tracking-[0.2em] uppercase text-[var(--snc-white)]">
                BUILDING ZIMBABWE&apos;S FUTURE
              </span>
            </div>
          </Reveal>

          <Reveal delay={0.4}>
            <h1 className="text-6xl md:text-[80px] lg:text-[100px] font-display text-[var(--snc-white)] leading-[0.9] tracking-tight mb-8 drop-shadow-2xl">
              Envision it. <span className="text-[var(--snc-red)] drop-shadow-[0_0_20px_var(--snc-red-ghost)]">We build it.</span>
            </h1>
          </Reveal>

          <Reveal delay={0.6}>
            <p className="text-xl md:text-2xl text-[var(--snc-mist)] max-w-2xl mb-12 font-medium leading-relaxed">
              Six Nine Construction delivers high-quality, sustainable industrial, commercial and civil builds across Zimbabwe and the wider region — backed by our sister company <strong className="text-white">Dreamcast Construction</strong> for earthmoving and premix concrete.
            </p>
          </Reveal>

          <Reveal delay={0.8}>
            <div className="flex flex-wrap gap-4">
              <Link href="/projects">
                <Button 
                  className="bg-[var(--snc-red)] hover:bg-[var(--snc-red-bright)] text-white shadow-[0_0_30px_rgba(209,32,38,0.4)] border-none text-lg h-14 px-8"
                >
                  Start a Project
                </Button>
              </Link>
              <Link href="/projects">
                <Button 
                  variant="outline" 
                  className="bg-transparent border-white/30 text-white hover:bg-white/10 backdrop-blur-sm text-lg h-14 px-8"
                >
                  View Completed Work
                </Button>
              </Link>
            </div>
          </Reveal>
        </div>
      </div>

      {/* Carousel Indicators */}
      <div className="absolute bottom-12 left-1/2 -translate-x-1/2 z-20 flex gap-3">
        {HERO_IMAGES.map((_, i) => (
          <button
            key={i}
            onClick={() => setCurrentIndex(i)}
            className={`h-1.5 rounded-full transition-all duration-500 ${
              currentIndex === i ? "w-12 bg-[var(--snc-red)] shadow-[0_0_10px_var(--snc-red)]" : "w-6 bg-white/30 hover:bg-white/50"
            }`}
          />
        ))}
      </div>
    </section>
  );
};
