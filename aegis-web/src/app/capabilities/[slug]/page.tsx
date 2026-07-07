import { constructMetadata } from "@/lib/metadata";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { PageHero } from "@/components/ui/PageHero";
import { EnquiryForm } from "@/components/forms/EnquiryForm";
import { CAPABILITIES } from "@/lib/constants";
import { notFound } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { SectionLabel } from "@/components/ui/SectionLabel";

export async function generateStaticParams() {
  return CAPABILITIES.map((cap) => ({
    slug: cap.toLowerCase().replace(/ & /g, '-').replace(/\s+/g, '-'),
  }));
}

export async function generateMetadata(props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  const cap = CAPABILITIES.find(c => c.toLowerCase().replace(/ & /g, '-').replace(/\s+/g, '-') === params.slug);
  if (!cap) return {};
  
  return constructMetadata({
    title: `${cap} | Capabilities | Six Nine Constructions`,
    description: `SNC's expertise and methodology in ${cap}.`,
  });
}

export default async function CapabilityDetailPage(props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  const capName = CAPABILITIES.find(c => c.toLowerCase().replace(/ & /g, '-').replace(/\s+/g, '-') === params.slug);
  
  if (!capName) {
    notFound();
  }

  // Mock data for the capability
  const capabilityData = {
    statement: `Our approach to ${capName} is defined by absolute precision and rigorous risk management. We do not just execute; we engineer solutions to complex environmental and structural challenges.`,
    challenge: `The primary challenge in ${capName} within the Southern African context is managing supply chain volatility while maintaining strict quality controls and schedule adherence under challenging operational conditions.`,
    approach: `SNC leverages Project AEGIS to provide real-time visibility into material consumption, labor productivity, and schedule variance. This allows our project managers to preemptively address bottlenecks before they impact the critical path.`,
    breakdown: [
      "Comprehensive site investigation and geotechnical analysis.",
      "Integration of 3D modeling with our proprietary ERP systems.",
      "Deployment of specialized, company-owned plant and equipment.",
      "Rigorous quality assurance and materials testing protocols.",
      "Real-time progress tracking via digital site reporting."
    ]
  };

  return (
    <PageWrapper>
      <PageHero
        title={capName}
        subtitle={capabilityData.statement}
        breadcrumbs={[
          { label: "Home", href: "/" },
          { label: "Capabilities", href: "/capabilities" },
          { label: capName }
        ]}
      />

      <section className="py-24 bg-[var(--snc-void)]">
        <div className="container">
          <div className="grid lg:grid-cols-2 gap-16 mb-24">
            <div>
              <SectionLabel>The Challenge</SectionLabel>
              <p className="text-lg text-[var(--snc-mist)] leading-relaxed">
                {capabilityData.challenge}
              </p>
            </div>
            <div>
              <SectionLabel>Our Approach</SectionLabel>
              <p className="text-lg text-[var(--snc-mist)] leading-relaxed">
                {capabilityData.approach}
              </p>
            </div>
          </div>

          <div className="mb-24">
            <SectionLabel>Capability Breakdown</SectionLabel>
            <div className="grid md:grid-cols-2 gap-6 mt-8">
              {capabilityData.breakdown.map((item, index) => (
                <div key={index} className="flex items-start gap-4 p-6 border border-[var(--snc-navy-border)] bg-[var(--snc-navy-mid)] rounded-sm">
                  <CheckCircle2 className="w-6 h-6 text-[var(--snc-gold)] shrink-0" />
                  <span className="text-[var(--snc-white)]">{item}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="p-12 border border-[var(--snc-navy-border)] bg-[var(--snc-navy-raised)] rounded-sm relative overflow-hidden">
            <div className="absolute inset-0 bg-blueprint opacity-20 pointer-events-none" />
            <div className="relative z-10 max-w-3xl">
              <h2 className="text-3xl font-display text-[var(--snc-white)] mb-4">Request a Consultation</h2>
              <p className="text-[var(--snc-mist)] mb-8">Discuss your specific {capName} requirements with our commercial engineering team.</p>
              
              <EnquiryForm defaultType="New Project" />
            </div>
          </div>
        </div>
      </section>
    </PageWrapper>
  );
}
