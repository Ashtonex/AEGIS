import { constructMetadata } from "@/lib/metadata";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { PageHero } from "@/components/ui/PageHero";
import { SectionLabel } from "@/components/ui/SectionLabel";
import { Button } from "@/components/ui/Button";
import Link from "next/link";
import { Target, Shield, Zap } from "lucide-react";
import { getLeadership } from "@/lib/api";
import { LeadershipCard } from "@/components/sections/LeadershipCard";
import { RevealOnScroll } from "@/components/ui/RevealOnScroll";
import { StaggerContainer, StaggerItem } from "@/components/ui/StaggerContainer";
import { Card } from "@/components/ui/Card";

export const metadata = constructMetadata({
  title: "About Us | Six Nine Constructions",
  description: "Learn about SNC's mission, vision, values, and the leadership team driving our infrastructure projects.",
});

const TIMELINE_EVENTS = [
  { year: "2019", title: "Founded in Mutare", desc: "A premier construction firm born in Mutare." },
  { year: "2020", title: "First Major Contract", desc: "Container stacking pad delivered for Africa University." },
  { year: "2022", title: "Mega Market Partnership", desc: "6,400 sqm warehouse + maize milling complex delivered." },
  { year: "2024", title: "Dreamcast Launches", desc: "Sister company spun up for premix concrete & plant hire." },
  { year: "2026", title: "Regional Expansion", desc: "Operations expanding into Zambia and the wider SADC region." },
];

export default async function AboutPage() {
  const leadershipRes = await getLeadership().catch(() => null);
  const leadership = leadershipRes?.success ? leadershipRes.data.slice(0, 4) : [];

  return (
    <PageWrapper>
      <PageHero
        variant="half"
        title="Institutional Execution."
        subtitle="Since 2019, Six Nine Construction has been delivering world-class civil, commercial, and heavy industrial infrastructure."
        breadcrumbs={[
          { label: "Home", href: "/" },
          { label: "Company", href: "/about" },
          { label: "About Us" }
        ]}
      />

      {/* Mission / Vision / Values */}
      <section className="py-24 bg-snc-void border-b border-snc-border">
        <div className="container max-w-[1400px] mx-auto px-6 md:px-10 lg:px-16 xl:px-20">
          <StaggerContainer className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
            <StaggerItem>
              <Card padding="standard" className="h-full border-t-[2px] border-t-snc-gold-primary">
                <Target className="w-10 h-10 text-snc-gold-primary mb-6" strokeWidth={1.5} />
                <h3 className="text-headline-md text-snc-text-primary mb-4">Our Mission</h3>
                <p className="text-body text-snc-text-secondary">
                  To engineer and deliver critical infrastructure that accelerates economic growth across Southern Africa, maintaining the highest standards of safety, quality, and technical precision.
                </p>
              </Card>
            </StaggerItem>
            <StaggerItem>
              <Card padding="standard" className="h-full border-t-[2px] border-t-snc-electric">
                <Zap className="w-10 h-10 text-snc-electric mb-6" strokeWidth={1.5} />
                <h3 className="text-headline-md text-snc-text-primary mb-4">Our Vision</h3>
                <p className="text-body text-snc-text-secondary">
                  To be the most technologically advanced and reliable construction partner in the region, setting the benchmark for operational excellence through data-driven execution.
                </p>
              </Card>
            </StaggerItem>
            <StaggerItem>
              <Card padding="standard" className="h-full border-t-[2px] border-t-snc-success">
                <Shield className="w-10 h-10 text-snc-success mb-6" strokeWidth={1.5} />
                <h3 className="text-headline-md text-snc-text-primary mb-4">Our Values</h3>
                <ul className="space-y-3 text-body text-snc-text-secondary">
                  <li className="flex items-start gap-3">
                    <div className="w-1.5 h-1.5 rounded-full bg-snc-success mt-2.5 shrink-0 shadow-[0_0_8px_var(--snc-success)]" />
                    <span><strong className="text-snc-text-primary font-semibold">Zero Harm:</strong> Safety without compromise.</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <div className="w-1.5 h-1.5 rounded-full bg-snc-success mt-2.5 shrink-0 shadow-[0_0_8px_var(--snc-success)]" />
                    <span><strong className="text-snc-text-primary font-semibold">Precision:</strong> Engineered accuracy in all things.</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <div className="w-1.5 h-1.5 rounded-full bg-snc-success mt-2.5 shrink-0 shadow-[0_0_8px_var(--snc-success)]" />
                    <span><strong className="text-snc-text-primary font-semibold">Integrity:</strong> Institutional transparency.</span>
                  </li>
                </ul>
              </Card>
            </StaggerItem>
          </StaggerContainer>
        </div>
      </section>

      {/* Cinematic Timeline */}
      <section className="py-32 bg-snc-navy relative overflow-hidden">
        <div className="container max-w-[1400px] mx-auto px-6 md:px-10 lg:px-16 xl:px-20 relative z-10">
          <div className="text-center mb-24">
            <RevealOnScroll direction="up">
              <SectionLabel label="Our Journey" className="justify-center mb-4" />
              <h2 className="text-display-lg text-snc-text-primary">A Legacy of Delivery</h2>
            </RevealOnScroll>
          </div>

          <div className="relative max-w-4xl mx-auto">
            {/* Center Line */}
            <div className="absolute left-1/2 top-0 bottom-0 w-[1px] bg-snc-border -translate-x-1/2" />
            
            <div className="flex flex-col gap-32">
              {TIMELINE_EVENTS.map((event, i) => {
                const isEven = i % 2 === 0;
                return (
                  <RevealOnScroll key={event.year} direction={isEven ? "right" : "left"} className={`relative flex items-center justify-center ${isEven ? 'flex-row' : 'flex-row-reverse'}`}>
                    
                    {/* Year Display (Massive) */}
                    <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-0 opacity-5 pointer-events-none text-center">
                      <span className="font-display text-[120px] md:text-[200px] leading-none text-snc-text-primary select-none drop-shadow-2xl">
                        {event.year}
                      </span>
                    </div>

                    {/* Content side */}
                    <div className={`w-1/2 flex flex-col justify-center ${isEven ? 'items-end text-right pr-12 md:pr-24' : 'items-start text-left pl-12 md:pl-24'} z-10`}>
                      <h3 className="text-headline-xl text-snc-text-primary mb-4 leading-none">
                        {event.title}
                      </h3>
                      <p className="text-body-lg text-snc-text-secondary max-w-sm">
                        {event.desc}
                      </p>
                    </div>
                    
                    {/* Empty side for balance */}
                    <div className="w-1/2" />

                    {/* Center Node */}
                    <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-20 w-12 h-12 rounded-full bg-snc-navy-mid border-[2px] border-snc-gold-primary flex items-center justify-center shadow-[0_0_20px_var(--snc-gold-ghost)]">
                      <span className="text-[10px] font-sans font-bold text-snc-gold-primary">{i + 1}</span>
                    </div>
                  </RevealOnScroll>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* Leadership Preview */}
      <section className="py-24 bg-snc-void border-t border-snc-border">
        <div className="container max-w-[1400px] mx-auto px-6 md:px-10 lg:px-16 xl:px-20">
          <RevealOnScroll>
            <div className="flex flex-col md:flex-row md:items-end justify-between mb-16 gap-8">
              <div>
                <SectionLabel label="Leadership" />
                <h2 className="text-headline-xl text-snc-text-primary mt-4">Executive Team</h2>
              </div>
              <Link href="/about/leadership">
                <Button variant="ghostWhite">View Full Team</Button>
              </Link>
            </div>
          </RevealOnScroll>

          <StaggerContainer className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 md:gap-8">
            {leadership.map((profile: any) => (
              <StaggerItem key={profile.id}>
                <LeadershipCard profile={profile} />
              </StaggerItem>
            ))}
          </StaggerContainer>
        </div>
      </section>
    </PageWrapper>
  );
}
