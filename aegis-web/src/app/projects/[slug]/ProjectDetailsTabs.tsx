"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Image from "next/image";
import { Project, SubProject } from "@/types/website";
import { formatCurrency } from "@/lib/utils";
import { Calendar, DollarSign, ChevronLeft, ChevronRight, CheckCircle2 } from "lucide-react";

interface ProjectDetailsTabsProps {
  project: Project;
}

export default function ProjectDetailsTabs({ project }: ProjectDetailsTabsProps) {
  const tabs = [
    {
      id: "overview",
      title: "Overview",
      isSubProject: false,
      data: {
        timeline: project.timeline,
        value: project.value,
        scopeSummary: project.scopeSummary,
        challenge: project.challenge,
        approach: project.approach,
        outcomes: project.outcomes,
        gallery: project.gallery,
      },
    },
    ...(project.subProjects || []).map((sp: any) => ({
      id: sp.id.toLowerCase(),
      title: sp.title,
      isSubProject: true,
      data: {
        timeline: sp.duration,
        value: sp.value,
        scopeSummary: sp.scopeSummary,
        challenge: sp.challenge,
        approach: sp.approach,
        outcomes: sp.outcomes,
        gallery: sp.gallery,
      },
    })),
  ];

  const [activeTabId, setActiveTabId] = useState("overview");
  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];
  const activeData = activeTab.data;

  // Active gallery index state
  const [galleryIndex, setGalleryIndex] = useState(0);

  const handleNextImage = (galleryLength: number) => {
    setGalleryIndex((prev) => (prev + 1) % galleryLength);
  };

  const handlePrevImage = (galleryLength: number) => {
    setGalleryIndex((prev) => (prev - 1 + galleryLength) % galleryLength);
  };

  const hasGallery = activeData.gallery && activeData.gallery.length > 0;

  // Formatting Timeline
  const formatTimeline = (timeline: { start: string; end?: string } | string) => {
    if (typeof timeline === "string") return timeline;
    const startYear = new Date(timeline.start).getFullYear();
    const endYear = timeline.end ? new Date(timeline.end).getFullYear() : null;
    return endYear ? `${startYear} - ${endYear}` : `${startYear} - Present`;
  };

  // Custom Gold Accent Section Label to adhere strictly to the SNC guidelines
  const GoldSectionLabel = ({ children }: { children: React.ReactNode }) => (
    <div className="flex items-center gap-3 mb-6">
      <div className="h-px bg-[#D4AF37] w-12" />
      <span className="font-mono text-xs uppercase tracking-widest text-[#D4AF37]">
        {children}
      </span>
    </div>
  );

  return (
    <div className="w-full">
      {/* 1. Horizontal Tab Bar */}
      {project.subProjects && project.subProjects.length > 0 && (
        <div className="border-b border-[#1c1c1c] bg-[#050505] sticky top-[103px] z-30 mb-12">
          <div className="container max-w-5xl">
            <div className="flex items-center overflow-x-auto scrollbar-none py-4 gap-8">
              {tabs.map((tab) => {
                const isActive = tab.id === activeTabId;
                return (
                  <button
                    key={tab.id}
                    onClick={() => {
                      setActiveTabId(tab.id);
                      setGalleryIndex(0);
                    }}
                    className={`relative py-2 text-xs font-mono tracking-widest uppercase transition-colors whitespace-nowrap focus:outline-none ${
                      isActive ? "text-[#ffffff]" : "text-[#888888] hover:text-[#cccccc]"
                    }`}
                  >
                    {tab.title}
                    {isActive && (
                      <motion.div
                        layoutId="activeTabUnderline"
                        className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#D4AF37]"
                        transition={{ type: "spring", stiffness: 380, damping: 30 }}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* 2. Transitioning Contents container */}
      <div className="container max-w-5xl">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTabId}
            initial={{ opacity: 0, x: -15 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 15 }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
            className="prose prose-invert prose-lg max-w-none"
          >
            {/* Meta Information (Timeline & Value) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-6 mb-12 bg-[#0a0a0a] border border-[#1c1c1c] rounded-sm">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-[#111111] border border-[#2c2c2c] rounded-sm text-[#D4AF37]">
                  <Calendar className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-[10px] font-mono tracking-wider uppercase text-[#888888]">
                    Timeline
                  </div>
                  <div className="font-mono tabular-nums text-sm text-[#ffffff] font-semibold">
                    {formatTimeline(activeData.timeline)}
                  </div>
                </div>
              </div>

              {activeData.value !== undefined && (
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-[#111111] border border-[#2c2c2c] rounded-sm text-[#D4AF37]">
                    <DollarSign className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-[10px] font-mono tracking-wider uppercase text-[#888888]">
                      Value / Allocation
                    </div>
                    <div className="font-mono tabular-nums text-sm text-[#D4AF37] font-bold">
                      {formatCurrency(activeData.value)}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Core Details: Challenge & Approach */}
            <div className="grid md:grid-cols-2 gap-16 mb-16">
              <div>
                <GoldSectionLabel>The Challenge</GoldSectionLabel>
                <p className="text-[#cccccc] text-base leading-relaxed font-sans">
                  {activeData.challenge}
                </p>
              </div>
              <div>
                <GoldSectionLabel>Engineering Approach</GoldSectionLabel>
                <p className="text-[#cccccc] text-base leading-relaxed font-sans">
                  {activeData.approach}
                </p>
              </div>
            </div>

            {/* Scope Breakdown */}
            <div className="mb-16">
              <GoldSectionLabel>Scope Breakdown</GoldSectionLabel>
              <div className="p-8 border border-[#1c1c1c] bg-[#0a0a0a] rounded-sm relative mt-4 text-[#cccccc] text-base leading-relaxed font-sans shadow-inner">
                {/* Visual marker inside true black box */}
                <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-[#D4AF37]" />
                {activeData.scopeSummary}
              </div>
            </div>

            {/* Outcomes & Impact */}
            <div className="mb-16">
              <GoldSectionLabel>Outcomes & Impact</GoldSectionLabel>
              <ul className="mt-6 space-y-4 text-[#cccccc] text-base font-sans list-none pl-0">
                {activeData.outcomes.map((outcome: string, i: number) => (
                  <li
                    key={i}
                    className="flex items-start gap-4 p-5 bg-[#0a0a0a] border border-[#1c1c1c] rounded-sm"
                  >
                    <div className="p-1 text-[#D4AF37] shrink-0 mt-0.5">
                      <CheckCircle2 className="w-4 h-4" />
                    </div>
                    <span>{outcome}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Sub-project Image Gallery Carousel */}
            {hasGallery && (
              <div className="mb-16">
                <GoldSectionLabel>Operational Gallery</GoldSectionLabel>
                <div className="relative aspect-[16/9] w-full overflow-hidden border border-[#1c1c1c] bg-[#050505] rounded-sm mt-6 group">
                  {/* Next.js Image component with lazy loading and sizing optimization */}
                  <Image
                    src={activeData.gallery[galleryIndex]}
                    alt={`${activeTab.title} - Operational Scene ${galleryIndex + 1}`}
                    fill
                    sizes="(max-width: 768px) 100vw, (max-width: 1200px) 80vw, 1000px"
                    quality={90}
                    loading="lazy"
                    className="object-cover transition-opacity duration-300"
                  />

                  {/* Previous / Next Arrow Controls */}
                  {activeData.gallery.length > 1 && (
                    <>
                      <button
                        onClick={() => handlePrevImage(activeData.gallery.length)}
                        className="absolute left-4 top-1/2 -translate-y-1/2 p-2 bg-[#050505]/80 hover:bg-[#050505] border border-[#2c2c2c] hover:border-[#D4AF37] text-white hover:text-[#D4AF37] transition-all rounded-sm z-10"
                        aria-label="Previous Image"
                      >
                        <ChevronLeft className="w-5 h-5" />
                      </button>
                      <button
                        onClick={() => handleNextImage(activeData.gallery.length)}
                        className="absolute right-4 top-1/2 -translate-y-1/2 p-2 bg-[#050505]/80 hover:bg-[#050505] border border-[#2c2c2c] hover:border-[#D4AF37] text-white hover:text-[#D4AF37] transition-all rounded-sm z-10"
                        aria-label="Next Image"
                      >
                        <ChevronRight className="w-5 h-5" />
                      </button>
                    </>
                  )}

                  {/* Index Indicator */}
                  <div className="absolute bottom-4 right-4 bg-[#050505]/80 backdrop-blur-sm border border-[#2c2c2c] px-3 py-1 rounded-sm text-[11px] font-mono tracking-widest text-white tabular-nums">
                    {String(galleryIndex + 1).padStart(2, "0")} / {String(activeData.gallery.length).padStart(2, "0")}
                  </div>
                </div>

                {/* Thumbnail dots indicator */}
                {activeData.gallery.length > 1 && (
                  <div className="flex justify-center gap-2 mt-4">
                    {activeData.gallery.map((_: string, idx: number) => (
                      <button
                        key={idx}
                        onClick={() => setGalleryIndex(idx)}
                        className={`w-2.5 h-2.5 rounded-full transition-colors ${
                          idx === galleryIndex
                            ? "bg-[#D4AF37]"
                            : "bg-[#2c2c2c] hover:bg-[#444444]"
                        }`}
                        aria-label={`Go to slide ${idx + 1}`}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
