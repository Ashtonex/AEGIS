"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { sequenceRevealVariants, hoverElevation, transitions } from "@/lib/motion";
import Link from "next/link";
import Image from "next/image";

interface Project {
  id: string;
  slug: string;
  title: string;
  client: string;
  sector: string;
  status: string;
  budget: string;
  duration: string;
  scope: string;
  image: string;
  grid: string;
}

const STATUS_COLORS: Record<string, string> = {
  Completed: "text-[#2ECC71] border-[#2ECC71]/40 bg-[#2ECC71]/10",
  Active: "text-signal border-signal/40 bg-signal/10",
  "In Progress": "text-[#3498DB] border-[#3498DB]/40 bg-[#3498DB]/10",
};

export default function ProjectsRegisterPage() {
  const shouldReduceMotion = useReducedMotion();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  // Live Harare Clock for the header
  const [time, setTime] = useState<string>("");
  useEffect(() => {
    const updateTime = () => {
      const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: "Africa/Harare",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      });
      setTime(formatter.format(new Date()));
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const fetchProjects = async () => {
      try {
        const res = await fetch("/api/v1/projects");
        if (res.ok) {
          const json = await res.json();
          setProjects(json.data);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchProjects();
  }, []);

  return (
    <main className="min-h-screen bg-ink pt-32">
      <div className="max-w-[1440px] mx-auto px-6 md:px-10 lg:px-16 xl:px-20 mb-16">
        {/* Header Block */}
        <motion.div
          className="flex flex-col md:flex-row items-start md:items-end justify-between border-b border-ink-mid pb-8"
          initial="hidden"
          animate="visible"
          custom={0}
          variants={sequenceRevealVariants}
        >
          <div>
            <h1 className="font-mono text-[11px] tracking-[0.12em] uppercase text-signal mb-4">
              Intelligence Register
            </h1>
            <p className="font-black text-[clamp(32px,4vw,56px)] leading-[0.95] tracking-[-0.03em] text-paper max-w-3xl">
              Scale measured in kilometres, cubic metres, and months delivered.
            </p>
          </div>
          <div className="mt-8 md:mt-0 flex flex-col items-end gap-2">
            <span className="font-mono text-[10px] tracking-[0.1em] uppercase text-slate/50">
              System Time (CAT)
            </span>
            <span className="font-mono text-[14px] tracking-[0.15em] text-paper" suppressHydrationWarning>
              {time || "00:00:00"}
            </span>
          </div>
        </motion.div>
      </div>

      {/* The Edge-to-Edge Grid (Sequence 04 Architecture) */}
      <div className="w-full bg-ink-mid">
        {loading ? (
          <div className="flex items-center justify-center h-[50vh]">
            <span className="font-mono text-[12px] tracking-[0.2em] uppercase text-signal animate-pulse">
              Loading Intelligence Matrix...
            </span>
          </div>
        ) : (
          <>
            {/* Desktop: asymmetric CSS Grid */}
            <div className="hidden lg:grid grid-cols-12 auto-rows-[320px] gap-px">
              {projects.map((project, index) => (
                <motion.div
                  key={project.id}
                  className={project.grid}
                  initial="hidden"
                  animate="visible"
                  custom={index + 1}
                  variants={sequenceRevealVariants}
                >
                  <ProjectTile project={project} shouldReduceMotion={shouldReduceMotion ?? false} />
                </motion.div>
              ))}
            </div>

            {/* Mobile: single column stack */}
            <div className="lg:hidden flex flex-col gap-px">
              {projects.map((project, index) => (
                <motion.div
                  key={project.id}
                  className="h-[300px]"
                  initial="hidden"
                  animate="visible"
                  custom={index + 1}
                  variants={sequenceRevealVariants}
                >
                  <ProjectTile project={project} shouldReduceMotion={shouldReduceMotion ?? false} />
                </motion.div>
              ))}
            </div>
          </>
        )}
      </div>
      
      {/* Footer rail */}
      <div className="max-w-[1440px] mx-auto px-6 md:px-10 lg:px-16 xl:px-20 py-16 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 border-t border-ink-mid mt-px">
        <p className="font-mono text-[11px] tracking-[0.1em] uppercase text-slate/50">
          6 major corporate programs · USD 340M+ contract value executed
        </p>
      </div>
    </main>
  );
}

// ── ProjectTile Component (Ported from Sequence 04) ─────────────────────────
function ProjectTile({ project, shouldReduceMotion }: { project: Project; shouldReduceMotion: boolean }) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <Link href={`/projects/${project.slug}`} className="block w-full h-full">
      <motion.div
        className="relative w-full h-full overflow-hidden bg-ink cursor-pointer group"
        onHoverStart={() => setIsHovered(true)}
        onHoverEnd={() => setIsHovered(false)}
        onFocus={() => setIsHovered(true)}
        onBlur={() => setIsHovered(false)}
        tabIndex={0}
        role="article"
        aria-label={`${project.title} — ${project.sector}`}
      >
        {/* Background image — slow zoom on hover */}
        <motion.div
          className="absolute inset-0"
          variants={shouldReduceMotion ? {} : {
            rest: hoverElevation.image.rest,
            hover: hoverElevation.image.hover,
          }}
          initial="rest"
          animate={isHovered && !shouldReduceMotion ? "hover" : "rest"}
        >
          <Image
            src={project.image}
            alt={project.title}
            fill
            sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
            quality={85}
            className="object-cover"
            priority={project.slug === "kariba"}
          />
        </motion.div>

        {/* Permanent gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-ink/90 via-ink/30 to-transparent z-10" />

        {/* Rest state */}
        <motion.div
          className="absolute bottom-0 left-0 right-0 z-20 p-6"
          animate={{
            opacity: isHovered ? 0 : 1,
            y: isHovered ? 8 : 0,
          }}
          transition={transitions.fast}
        >
          <span className="font-mono text-[10px] tracking-[0.15em] uppercase text-paper/50 block mb-1">
            {project.id}
          </span>
          <h3 className="font-bold text-[16px] leading-[1.2] text-paper tracking-[-0.01em]">
            {project.title}
          </h3>
          <p className="font-mono text-[11px] tracking-[0.08em] uppercase text-slate-light mt-1">
            {project.sector}
          </p>
        </motion.div>

        {/* Hover overlay */}
        <AnimatePresence>
          {isHovered && (
            <motion.div
              className="absolute inset-0 z-30 flex flex-col justify-end"
              style={{ background: "linear-gradient(to top, rgba(10,22,40,0.97) 0%, rgba(10,22,40,0.7) 60%, transparent 100%)" }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={transitions.fast}
            >
              <div className="p-6 md:p-8">
                <div className="mb-4">
                  <span className={`inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.12em] uppercase px-2 py-1 border ${STATUS_COLORS[project.status] ?? STATUS_COLORS["Completed"]}`}>
                    <span className="w-1 h-1 rounded-full bg-current" aria-hidden="true" />
                    {project.status}
                  </span>
                </div>

                <motion.h3
                  className="font-black text-[clamp(18px,2.5vw,28px)] leading-[1.1] tracking-[-0.02em] text-paper mb-2"
                  initial={{ y: 12, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ ...transitions.reveal, delay: 0.05 }}
                >
                  {project.title}
                </motion.h3>

                <motion.p
                  className="font-mono text-[11px] tracking-[0.08em] uppercase text-slate-light mb-6"
                  initial={{ y: 8, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ ...transitions.reveal, delay: 0.1 }}
                >
                  {project.client}
                </motion.p>

                <motion.div
                  className="grid grid-cols-3 gap-4 pt-4 border-t border-paper/10"
                  initial={{ y: 8, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ ...transitions.reveal, delay: 0.15 }}
                >
                  {[
                    { label: "Contract Value", value: project.budget },
                    { label: "Programme", value: project.duration },
                    { label: "Sector", value: project.sector.split(" ")[0] },
                  ].map((stat) => (
                    <div key={stat.label}>
                      <div className="font-mono text-[9px] tracking-[0.12em] uppercase text-slate/60 mb-1">{stat.label}</div>
                      <div className="font-bold text-[14px] leading-none text-signal tracking-[-0.01em]">{stat.value}</div>
                    </div>
                  ))}
                </motion.div>

                <motion.p
                  className="font-mono text-[10px] tracking-[0.08em] text-slate/50 mt-4"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ ...transitions.reveal, delay: 0.2 }}
                >
                  {project.scope}
                </motion.p>

                <motion.div
                  className="mt-5"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ ...transitions.reveal, delay: 0.22 }}
                >
                  <div
                    className="inline-flex items-center gap-2 font-mono text-[11px] tracking-[0.1em] uppercase text-paper border-b border-paper/20 pb-0.5 transition-colors duration-micro group-hover:text-signal group-hover:border-signal"
                  >
                    Project brief
                    <svg viewBox="0 0 16 8" fill="none" className="w-3 h-3" aria-hidden="true">
                      <path d="M0 4h14M11 1l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                </motion.div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </Link>
  );
}
