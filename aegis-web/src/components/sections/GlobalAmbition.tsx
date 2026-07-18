"use client";

import { SectionLabel } from "../ui/SectionLabel";
import { RevealOnScroll } from "../ui/RevealOnScroll";

export function GlobalAmbition() {
  return (
    <section className="relative py-28 md:py-44 bg-snc-void border-y border-snc-border overflow-hidden">
      {/* Abstract Map Background */}
      <div className="absolute inset-0 z-0 opacity-20">
        <div className="absolute inset-0 bg-gradient-to-r from-snc-void via-transparent to-snc-void z-10" />
        <div className="absolute inset-0 bg-gradient-to-t from-snc-void via-transparent to-snc-void z-10" />
        
        {/* CSS Dot Map Representation of Southern Africa */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-4xl h-full max-h-[600px] z-0">
          <div className="w-full h-full" style={{
            backgroundImage: "radial-gradient(circle, var(--snc-border) 1px, transparent 1px)",
            backgroundSize: "20px 20px",
            maskImage: "radial-gradient(ellipse at center, black 20%, transparent 70%)",
            WebkitMaskImage: "radial-gradient(ellipse at center, black 20%, transparent 70%)"
          }} />
          
          {/* Highlight Nodes */}
          <div className="absolute top-[40%] left-[50%] w-3 h-3 rounded-full bg-snc-gold-primary shadow-[0_0_20px_var(--snc-gold-primary)] animate-pulse" />
          <div className="absolute top-[60%] left-[45%] w-2 h-2 rounded-full bg-snc-text-tertiary/50" />
          <div className="absolute top-[30%] left-[60%] w-2 h-2 rounded-full bg-snc-text-tertiary/50" />
          <div className="absolute top-[70%] left-[55%] w-2 h-2 rounded-full bg-snc-text-tertiary/50" />
        </div>
      </div>

      <div className="container relative z-20 text-center max-w-4xl mx-auto px-6 md:px-10 lg:px-16 xl:px-20">
        <RevealOnScroll direction="up">
          <div className="flex justify-center mb-8">
            {/* Using a custom wrapper to center the SectionLabel since the rule is "Always left-aligned. Never centred", but for this specific layout if it requires centering we might need to adjust, but wait... "Always left-aligned. Never centred." Let's left align the content instead. */}
          </div>
          <div className="text-left">
            <SectionLabel label="Expansion" />
            <h2 className="text-display-xl text-snc-text-primary mt-4 mb-8">Building Across<br />Southern Africa</h2>
            <p className="text-body-xl text-snc-text-secondary leading-relaxed max-w-2xl mb-12">
              From our foundation in Zimbabwe, Six Nine Construction is executing a disciplined expansion strategy. We are deploying our engineered operational model, Project AEGIS, and our proven delivery capability to critical infrastructure projects across the SADC region.
            </p>
            
            <div className="flex flex-wrap items-center gap-4 text-[11px] font-sans font-semibold tracking-widest uppercase text-snc-text-tertiary">
              <span className="text-snc-gold-primary">Zimbabwe</span>
              <span className="opacity-50">•</span>
              <span>Zambia</span>
              <span className="opacity-50">•</span>
              <span>Botswana</span>
              <span className="opacity-50">•</span>
              <span>Mozambique</span>
            </div>
          </div>
        </RevealOnScroll>
      </div>
    </section>
  );
}
