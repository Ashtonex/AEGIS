"use client";

import { constructMetadata } from "@/lib/metadata";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { PageHero } from "@/components/ui/PageHero";
import { ApplicationForm } from "@/components/forms/ApplicationForm";
import { getJobPositions } from "@/lib/api";
import { useApiQuery } from "@/hooks/useApiQuery";
import { SectionLabel } from "@/components/ui/SectionLabel";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { useState } from "react";
import { MapPin, Calendar, HardHat, TrendingUp, ShieldCheck, Briefcase, ArrowRight, X, Cpu } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { StaggerContainer, StaggerItem } from "@/components/ui/StaggerContainer";
import { RevealOnScroll } from "@/components/ui/RevealOnScroll";

export default function CareersPage() {
  const { data: positionsRes, isLoading } = useApiQuery(() => getJobPositions());
  const positions = (positionsRes?.success && Array.isArray(positionsRes.data)) ? positionsRes.data : [];
  
  const [selectedPosition, setSelectedPosition] = useState<{id: string, title: string} | null>(null);

  const benefits = [
    { title: "Career Growth", desc: "Clear progression paths within a rapidly expanding regional group.", icon: <TrendingUp className="w-8 h-8" strokeWidth={1.5} /> },
    { title: "Safety Culture", desc: "An uncompromising commitment to Zero Harm on every site.", icon: <ShieldCheck className="w-8 h-8" strokeWidth={1.5} /> },
    { title: "Competitive Package", desc: "Top-tier remuneration, health cover, and performance bonuses.", icon: <Briefcase className="w-8 h-8" strokeWidth={1.5} /> },
    { title: "Meaningful Work", desc: "Build infrastructure that fundamentally changes communities.", icon: <HardHat className="w-8 h-8" strokeWidth={1.5} /> },
  ];

  return (
    <PageWrapper>
      <PageHero
        title="Build Your Career"
        subtitle="Join the team engineering Southern Africa's critical infrastructure."
        breadcrumbs={[
          { label: "Home", href: "/" },
          { label: "Careers" }
        ]}
      />

      {/* Why SNC */}
      <section className="py-24 bg-snc-void border-b border-snc-border">
        <div className="container max-w-[1400px] mx-auto px-6 md:px-10 lg:px-16 xl:px-20">
          <RevealOnScroll>
            <SectionLabel label="Why SNC" className="mb-12" />
          </RevealOnScroll>
          <StaggerContainer className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 md:gap-8">
            {benefits.map((b, i) => (
              <StaggerItem key={i}>
                <Card className="h-full flex flex-col p-8 bg-snc-navy-raised border-t-[2px] border-t-snc-gold-primary hover:border-snc-gold-primary transition-colors group">
                  <div className="text-snc-text-primary group-hover:text-snc-gold-primary transition-colors mb-6">{b.icon}</div>
                  <h4 className="text-headline-sm text-snc-text-primary mb-3">{b.title}</h4>
                  <p className="text-body text-snc-text-secondary flex-1">{b.desc}</p>
                </Card>
              </StaggerItem>
            ))}
          </StaggerContainer>
        </div>
      </section>

      {/* Open Positions */}
      <section className="py-24 bg-snc-navy">
        <div className="container max-w-5xl mx-auto px-6 md:px-10">
          <RevealOnScroll>
            <div className="text-center mb-16">
              <h2 className="text-headline-xl text-snc-text-primary mb-4">Current Opportunities</h2>
              <p className="text-body-lg text-snc-text-secondary">Explore roles across our engineering, commercial, and operational divisions.</p>
            </div>
          </RevealOnScroll>

          {isLoading ? (
            <div className="space-y-4">
               {[1,2,3].map(i => (
                 <Skeleton key={i} className="h-32 w-full rounded-sm" />
               ))}
            </div>
          ) : positions.length > 0 ? (
            <StaggerContainer className="space-y-4">
              {positions.map((pos: any) => (
                <StaggerItem key={pos.id}>
                  <div className="p-8 border border-snc-border bg-snc-navy-raised rounded-[4px] hover:border-snc-gold-primary hover:bg-snc-navy-high transition-colors flex flex-col md:flex-row md:items-center justify-between gap-6 group">
                    <div>
                      <h4 className="text-headline-md text-snc-text-primary mb-3 group-hover:text-snc-gold-primary transition-colors">{pos.title}</h4>
                      <div className="flex flex-wrap items-center gap-4 text-caption mb-4 md:mb-0">
                        <span className="px-2 py-1 bg-snc-void border border-snc-border text-snc-text-secondary rounded-sm uppercase tracking-widest">{pos.department}</span>
                        <span className="px-2 py-1 bg-snc-electric/10 border border-snc-electric/30 text-snc-electric rounded-sm uppercase tracking-widest">{pos.type}</span>
                        <span className="flex items-center gap-1.5 text-snc-text-tertiary"><MapPin className="w-3.5 h-3.5" /> {pos.location}</span>
                        <span className="flex items-center gap-1.5 text-snc-text-tertiary"><Calendar className="w-3.5 h-3.5" /> Posted: {formatDate(pos.postedDate)}</span>
                      </div>
                    </div>
                    <Button 
                      variant="ghostWhite"
                      onClick={() => setSelectedPosition({ id: pos.id, title: pos.title })}
                      className="shrink-0 flex items-center gap-2"
                    >
                      Apply Now <ArrowRight className="w-4 h-4" />
                    </Button>
                  </div>
                </StaggerItem>
              ))}
            </StaggerContainer>
          ) : (
            <div className="p-16 text-center border border-snc-border bg-snc-navy-raised rounded-[4px]">
              <p className="text-body text-snc-text-secondary mb-6">There are no specific openings currently listed.</p>
              <button 
                onClick={() => setSelectedPosition({ id: "speculative", title: "Speculative Application" })}
                className="text-snc-gold-primary font-sans font-semibold text-[13px] uppercase tracking-[0.08em] hover:text-snc-gold-hover transition-colors underline underline-offset-4"
              >
                Submit a speculative application
              </button>
            </div>
          )}
        </div>
      </section>

      {/* Slide-in Application Form Panel */}
      <AnimatePresence>
        {selectedPosition && (
          <>
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }} 
              className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100]"
              onClick={() => setSelectedPosition(null)}
            />
            <motion.div 
              initial={{ x: "100%" }} 
              animate={{ x: 0 }} 
              exit={{ x: "100%" }} 
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="fixed inset-y-0 right-0 w-full max-w-2xl bg-snc-navy border-l border-snc-border shadow-2xl z-[101] overflow-y-auto flex flex-col"
            >
              <div className="sticky top-0 bg-[rgba(10,22,40,0.95)] backdrop-blur-md border-b border-snc-border p-8 flex items-center justify-between z-10">
                <div>
                  <div className="text-[11px] font-sans font-semibold uppercase tracking-widest text-snc-text-tertiary mb-2">Applying for</div>
                  <h3 className="text-headline-lg text-snc-text-primary">{selectedPosition.title}</h3>
                </div>
                <button 
                  onClick={() => setSelectedPosition(null)}
                  className="p-2 hover:bg-snc-navy-raised rounded-full transition-colors text-snc-text-secondary hover:text-snc-text-primary"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
              <div className="p-8 flex-1">
                <ApplicationForm 
                  positionId={selectedPosition.id} 
                  positionTitle={selectedPosition.title} 
                />
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </PageWrapper>
  );
}
