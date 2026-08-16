import { constructMetadata } from "@/lib/metadata";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { PageHero } from "@/components/ui/PageHero";
import { SectionLabel } from "@/components/ui/SectionLabel";
import { loadPageCMSContent } from "@/lib/cmsHelper";

export const metadata = constructMetadata({
  title: "Civil Infrastructure Capabilities | Six Nine Construction",
  description: "Six Nine Construction' civil engineering and bulk infrastructure capabilities, including roads, highways, earthworks, and bulk concrete structures.",
});

export default async function CivilInfrastructurePage() {
  const content = await loadPageCMSContent("capabilities-civil", "hero", {
    title: "Civil & Highways Infrastructure.",
    subtitle: "We deliver complex engineering solutions that form the backbone of transportation, logistics, and bulk municipal services across the SADC region."
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
          { label: "Civil Infrastructure" }
        ]}
      />

      {/* Core Capability details */}
      <section className="py-24 bg-void border-b border-ink-mid">
        <div className="container max-w-[1400px] mx-auto px-6 md:px-10 lg:px-16 xl:px-20">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 mb-16">
            <div>
              <SectionLabel>HEAVY CIVIL ENGINEERING</SectionLabel>
              <h2 className="text-headline-lg text-white mt-2 font-display">Precision Earthworks & Arterial Roads</h2>
              <p className="text-body text-slate-light mt-6 leading-relaxed">
                SNC has built a reputation for delivering high-specification road networks, logistics corridors, and industrial earthworks. We own and operate a large fleet of modern heavy plant (excavators, dumpers, graders, and compactors), allowing us to self-perform bulk earthmoving and structural layers with zero subcontractor delays.
              </p>
              <p className="text-body text-slate-light mt-4 leading-relaxed">
                From subgrade stabilization to final asphalt surfacing and highway road markings, we manage the entire project lifecycle with direct engineering controls and telemetry integration.
              </p>
            </div>
            <div className="space-y-6">
              <div className="p-6 border border-ink-mid bg-ink-dark">
                <h4 className="text-lg font-bold text-white mb-2">Highways & Asphalt Surfacing</h4>
                <p className="text-sm text-slate-light">
                  Arterial road upgrades, lane additions, interchange construction, and pavement rehabilitation using high-stability bituminous compounds.
                </p>
              </div>
              <div className="p-6 border border-ink-mid bg-ink-dark">
                <h4 className="text-lg font-bold text-white mb-2">Bulk Earthworks & Site Prep</h4>
                <p className="text-sm text-slate-light">
                  Mass excavation, cut and fill operations, structural filling, and terrain leveling for industrial parks and container terminal ports.
                </p>
              </div>
              <div className="p-6 border border-ink-mid bg-ink-dark">
                <h4 className="text-lg font-bold text-white mb-2">Concrete Water Retaining Structures</h4>
                <p className="text-sm text-slate-light">
                  Reinforced concrete reservoirs, bulk water supply storm drains, box culverts, and municipal retaining walls.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </PageWrapper>
  );
}
