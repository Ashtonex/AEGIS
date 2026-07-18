import { constructMetadata } from "@/lib/metadata";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { PageHero } from "@/components/ui/PageHero";
import { SectionLabel } from "@/components/ui/SectionLabel";
import { Card } from "@/components/ui/Card";
import { StaggerContainer, StaggerItem } from "@/components/ui/StaggerContainer";
import { ShieldAlert, Award, Activity, ShieldCheck } from "lucide-react";
import { loadPageCMSContent } from "@/lib/cmsHelper";

export const metadata = constructMetadata({
  title: "Health, Safety & Environment (HSE) | Six Nine Construction",
  description: "Six Nine Construction' absolute commitment to zero-harm operations, safety compliance, and environmental protection.",
});

export default async function SafetyHsePage() {
  const content = await loadPageCMSContent("about-safety", "hero", {
    title: "Zero Harm. No Compromise.",
    subtitle: "SNC operates under a strict Zero Harm framework. We prioritize the health and safety of our people and protection of the environment above all else."
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
          { label: "Safety & HSE" }
        ]}
      />

      {/* Safety Stats Section */}
      <section className="py-24 bg-snc-void border-b border-snc-border">
        <div className="container max-w-[1400px] mx-auto px-6 md:px-10 lg:px-16 xl:px-20">
          <div className="text-center mb-16">
            <SectionLabel>OUR SAFETY PERFORMANCE</SectionLabel>
            <h2 className="text-headline-lg text-white mt-2 font-display">Safety by the Numbers</h2>
            <p className="text-body text-snc-text-secondary mt-4 max-w-2xl mx-auto">
              Our safety metrics speak for themselves. We maintain rigorous standards across all heavy industrial, mining, and civil infrastructure projects.
            </p>
          </div>

          <StaggerContainer className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <StaggerItem>
              <Card padding="standard" className="text-center border-t-2 border-t-snc-gold-primary">
                <Activity className="w-10 h-10 text-snc-gold-primary mx-auto mb-4" strokeWidth={1.5} />
                <h3 className="text-4xl font-bold font-display text-white">1.2M+</h3>
                <p className="text-xs font-mono tracking-wider text-snc-text-secondary mt-2">MAN-HOURS LTI FREE</p>
              </Card>
            </StaggerItem>
            <StaggerItem>
              <Card padding="standard" className="text-center border-t-2 border-t-snc-gold-primary">
                <ShieldCheck className="w-10 h-10 text-snc-gold-primary mx-auto mb-4" strokeWidth={1.5} />
                <h3 className="text-4xl font-bold font-display text-white">0.00</h3>
                <p className="text-xs font-mono tracking-wider text-snc-text-secondary mt-2">TOTAL RECORDABLE INJURY FREQUENCY</p>
              </Card>
            </StaggerItem>
            <StaggerItem>
              <Card padding="standard" className="text-center border-t-2 border-t-snc-gold-primary">
                <Award className="w-10 h-10 text-snc-gold-primary mx-auto mb-4" strokeWidth={1.5} />
                <h3 className="text-4xl font-bold font-display text-white">100%</h3>
                <p className="text-xs font-mono tracking-wider text-snc-text-secondary mt-2">PPE COMPLIANCE AUDITED</p>
              </Card>
            </StaggerItem>
            <StaggerItem>
              <Card padding="standard" className="text-center border-t-2 border-t-snc-gold-primary">
                <ShieldAlert className="w-10 h-10 text-snc-gold-primary mx-auto mb-4" strokeWidth={1.5} />
                <h3 className="text-4xl font-bold font-display text-white">Zero</h3>
                <p className="text-xs font-mono tracking-wider text-snc-text-secondary mt-2">ENVIRONMENTAL BREACHES</p>
              </Card>
            </StaggerItem>
          </StaggerContainer>
        </div>
      </section>

      {/* HSE Policy details */}
      <section className="py-24 bg-snc-navy-dark border-b border-snc-border">
        <div className="container max-w-[1400px] mx-auto px-6 md:px-10 lg:px-16 xl:px-20">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
            <div>
              <SectionLabel>OUR CHARTER</SectionLabel>
              <h2 className="text-headline-lg text-white mt-2 font-display">The SNC Zero Harm Mandate</h2>
              <p className="text-body text-snc-text-secondary mt-6 leading-relaxed">
                At Six Nine Construction, we believe that all occupational injuries and illnesses are preventable. Our safety governance is integrated into every work package, pre-start briefing, and site deployment control gate.
              </p>
              <p className="text-body text-snc-text-secondary mt-4 leading-relaxed">
                We empower every team member, from senior site managers to apprentices, with absolute **Stop Work Authority**—the obligation to halt any operation if safety conditions are compromised.
              </p>
            </div>
            <div className="space-y-6">
              <div className="p-6 border border-snc-border bg-snc-void">
                <h4 className="text-lg font-bold text-white mb-2">1. Continuous Training & Induction</h4>
                <p className="text-sm text-snc-text-secondary">
                  Every employee and subcontractor undergoes comprehensive, site-specific safety inductions, regular toolbox talks, and heavy machinery certification checks.
                </p>
              </div>
              <div className="p-6 border border-snc-border bg-snc-void">
                <h4 className="text-lg font-bold text-white mb-2">2. Environmental Management System</h4>
                <p className="text-sm text-snc-text-secondary">
                  We implement robust waste mitigation, topsoil preservation, water conservation, and fuel leakage prevention protocols aligned with ISO 14001 guidelines.
                </p>
              </div>
              <div className="p-6 border border-snc-border bg-snc-void">
                <h4 className="text-lg font-bold text-white mb-2">3. Continuous Audits & Observations</h4>
                <p className="text-sm text-snc-text-secondary">
                  Our internal safety inspectors conduct daily audits of equipment, scaffolding structures, and rigging mechanisms to address hazards before incidents occur.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </PageWrapper>
  );
}
