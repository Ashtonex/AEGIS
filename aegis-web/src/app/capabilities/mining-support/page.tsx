import { constructMetadata } from "@/lib/metadata";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { PageHero } from "@/components/ui/PageHero";
import { SectionLabel } from "@/components/ui/SectionLabel";
import { loadPageCMSContent } from "@/lib/cmsHelper";

export const metadata = constructMetadata({
  title: "Mining Support Capabilities | Six Nine Construction",
  description: "Six Nine Construction' mining civil works, plant infrastructure foundations, tailing dams, haul road networks, and load-out terminals.",
});

export default async function MiningSupportPage() {
  const content = await loadPageCMSContent("capabilities-mining", "hero", {
    title: "Heavy Mining Civil Support.",
    subtitle: "We deliver robust, load-bearing concrete foundations, mineral processing plant civil works, and bulk transport corridors for regional mining houses."
  });

  return (
    <PageWrapper>
      <PageHero
        variant="half"
        title={content.title}
        subtitle={content.subtitle}
        breadcrumbs={[
          { label: "Home", href: "/" },
          { label: "Capabilities", href: "/capabilities" },
          { label: "Mining Support" }
        ]}
      />

      <section className="py-24 bg-snc-void border-b border-snc-border">
        <div className="container max-w-[1400px] mx-auto px-6 md:px-10 lg:px-16 xl:px-20">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
            <div>
              <SectionLabel>MINING INFRASTRUCTURE</SectionLabel>
              <h2 className="text-headline-lg text-white mt-2 font-display">Specialized Plant & Site Civil Engineering</h2>
              <p className="text-body text-snc-text-secondary mt-6 leading-relaxed">
                Mining environments demand extreme durability and safety compliance. SNC specializes in self-performing heavy civil packages for mineral processing facilities, including concentrator foundations, crusher pockets, conveyor plinths, and tailing dam embankments.
              </p>
              <p className="text-body text-snc-text-secondary mt-4 leading-relaxed">
                We maintain active compliance clearance checklists (including NSSA health codes, first-aid, and CIFOZ certifications) enabling immediate mobilization to restricted mineral leases and platinum/gold mining projects.
              </p>
            </div>
            <div className="space-y-6">
              <div className="p-6 border border-snc-border bg-snc-navy-dark">
                <h4 className="text-lg font-bold text-white mb-2">Crusher & Concentrator Foundations</h4>
                <p className="text-sm text-snc-text-secondary">
                  Massive, vibration-absorbing concrete foundations engineered to support crushers, mills, screens, and flotation cells.
                </p>
              </div>
              <div className="p-6 border border-snc-border bg-snc-navy-dark">
                <h4 className="text-lg font-bold text-white mb-2">Tailing Storage Embankments</h4>
                <p className="text-sm text-snc-text-secondary">
                  Structural clay cores, seepage controls, tailing delivery pipelines, and penstock drainage decants.
                </p>
              </div>
              <div className="p-6 border border-snc-border bg-snc-navy-dark">
                <h4 className="text-lg font-bold text-white mb-2">Heavy Haul Road Networks</h4>
                <p className="text-sm text-snc-text-secondary">
                  Subgrade and base course designs optimized for 150-ton dump truck axle loads, including dust suppression base layers.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </PageWrapper>
  );
}
