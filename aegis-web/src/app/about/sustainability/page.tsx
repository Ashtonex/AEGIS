import { constructMetadata } from "@/lib/metadata";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { PageHero } from "@/components/ui/PageHero";
import { SectionLabel } from "@/components/ui/SectionLabel";
import { Card } from "@/components/ui/Card";
import { StaggerContainer, StaggerItem } from "@/components/ui/StaggerContainer";
import { Leaf, Users, HeartHandshake } from "lucide-react";
import { loadPageCMSContent } from "@/lib/cmsHelper";

export const metadata = constructMetadata({
  title: "Sustainability & ESG | Six Nine Construction",
  description: "Six Nine Construction' Environmental, Social, and Governance (ESG) charter, green building initiatives, and community impact programs.",
});

export default async function SustainabilityPage() {
  const content = await loadPageCMSContent("about-sustainability", "hero", {
    title: "Building for Tomorrow.",
    subtitle: "Sustainable construction is not a checkbox; it is the core of our business strategy. We deliver infrastructure that lasts, respects local ecosystems, and empowers communities."
  });

  return (
    <PageWrapper>
      <PageHero
        variant="half"
        title={content.title}
        subtitle={content.subtitle}
        breadcrumbs={[
          { label: "Home", href: "/" },
          { label: "Company", href: "/about" },
          { label: "Sustainability & ESG" }
        ]}
      />

      {/* ESG Pillars */}
      <section className="py-24 bg-snc-void border-b border-snc-border">
        <div className="container max-w-[1400px] mx-auto px-6 md:px-10 lg:px-16 xl:px-20">
          <div className="text-center mb-16">
            <SectionLabel>OUR ESG STRATEGY</SectionLabel>
            <h2 className="text-headline-lg text-white mt-2 font-display">The Three Corporate Pillars</h2>
          </div>

          <StaggerContainer className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <StaggerItem>
              <Card padding="standard" className="h-full border-t-[2px] border-t-snc-gold-primary">
                <Leaf className="w-10 h-10 text-snc-gold-primary mb-6" strokeWidth={1.5} />
                <h3 className="text-headline-md text-white mb-4">Environmental Stewardship</h3>
                <p className="text-body text-snc-text-secondary text-sm">
                  We actively manage our carbon footprint through eco-efficient fleet management, local sourcing of construction materials, green concrete formulations, and strict construction waste recycling.
                </p>
              </Card>
            </StaggerItem>
            <StaggerItem>
              <Card padding="standard" className="h-full border-t-[2px] border-t-snc-gold-primary">
                <Users className="w-10 h-10 text-snc-gold-primary mb-6" strokeWidth={1.5} />
                <h3 className="text-headline-md text-white mb-4">Social Inclusion</h3>
                <p className="text-body text-snc-text-secondary text-sm">
                  We invest heavily in local workforce development, building regional engineering capacity, providing safe working conditions, and funding community clinics and clean water supply points near our sites.
                </p>
              </Card>
            </StaggerItem>
            <Card padding="standard" className="h-full border-t-[2px] border-t-snc-gold-primary">
              <HeartHandshake className="w-10 h-10 text-snc-gold-primary mb-6" strokeWidth={1.5} />
              <h3 className="text-headline-md text-white mb-4">Ethical Governance</h3>
              <p className="text-body text-snc-text-secondary text-sm">
                We maintain zero tolerance for corruption, enforce transparent supply chain auditing, and implement strict anti-bribery covenants aligned with regional corporate compliance frameworks.
              </p>
            </Card>
          </StaggerContainer>
        </div>
      </section>

      {/* ESG Targets */}
      <section className="py-24 bg-snc-navy-dark border-b border-snc-border">
        <div className="container max-w-[1400px] mx-auto px-6 md:px-10 lg:px-16 xl:px-20">
          <div className="max-w-3xl">
            <SectionLabel>OUR TARGETS</SectionLabel>
            <h2 className="text-headline-lg text-white mt-2 font-display">2030 Sustainability Commitments</h2>
            <div className="mt-12 space-y-8">
              <div className="flex gap-4">
                <div className="w-12 h-12 border border-snc-border flex items-center justify-center shrink-0 text-snc-gold-primary font-mono text-sm">01</div>
                <div>
                  <h4 className="text-headline-sm text-white mb-1">Carbon Reduction</h4>
                  <p className="text-sm text-snc-text-secondary">
                    Reduce operational diesel consumption across our heavy plant and logistics fleet by 30% by transitioning to newer engine technology and telematics optimization.
                  </p>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="w-12 h-12 border border-snc-border flex items-center justify-center shrink-0 text-snc-gold-primary font-mono text-sm">02</div>
                <div>
                  <h4 className="text-headline-sm text-white mb-1">Local Resource Upliftment</h4>
                  <p className="text-sm text-snc-text-secondary">
                    Ensure at least 70% of project labor is recruited from host communities, accompanied by structured skills transfer and certifications via the SNC Training Academy.
                  </p>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="w-12 h-12 border border-snc-border flex items-center justify-center shrink-0 text-snc-gold-primary font-mono text-sm">03</div>
                <div>
                  <h4 className="text-headline-sm text-white mb-1">Resource Recovery</h4>
                  <p className="text-sm text-snc-text-secondary">
                    Achieve 90% diversion of non-hazardous demolition and excavation waste from local municipal landfills by using onsite recycling and crushed aggregate reclamation.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </PageWrapper>
  );
}
