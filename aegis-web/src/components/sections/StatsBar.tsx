"use client";

import { StatCounter } from "../ui/StatCounter";
import { RevealOnScroll } from "../ui/RevealOnScroll";
import { StaggerContainer, StaggerItem } from "../ui/StaggerContainer";

export function StatsBar() {
  return (
    <section className="relative py-20 border-y border-snc-border bg-snc-navy-mid overflow-hidden">
      <div className="absolute inset-0 z-0 opacity-10">
        <div className="absolute inset-0 bg-gradient-to-r from-snc-navy-mid via-transparent to-snc-navy-mid" />
      </div>

      <div className="container relative z-10 max-w-[1400px] mx-auto px-6 md:px-10 lg:px-16 xl:px-20">
        <StaggerContainer className="grid grid-cols-2 md:grid-cols-4 gap-8 lg:gap-12">
          <StaggerItem className="flex justify-center md:justify-start">
            <StatCounter value={15} suffix="+" label="YEARS EXCELLENCE" showDivider={true} />
          </StaggerItem>
          <StaggerItem className="flex justify-center md:justify-start">
             {/* The previous StatCounter didn't have prefix, so I'll just put it in the suffix */}
            <StatCounter value={2} suffix="B+" label="PROJECT VALUE" showDivider={true} />
          </StaggerItem>
          <StaggerItem className="flex justify-center md:justify-start">
            <StatCounter value={100} suffix="%" label="SAFETY RECORD" showDivider={true} />
          </StaggerItem>
          <StaggerItem className="flex justify-center md:justify-start">
            <StatCounter value={450} suffix="+" label="EXPERTS" showDivider={false} />
          </StaggerItem>
        </StaggerContainer>
      </div>
    </section>
  );
}
