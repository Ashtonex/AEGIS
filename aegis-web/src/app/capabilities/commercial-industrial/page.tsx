import { constructMetadata } from "@/lib/metadata";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { PageHero } from "@/components/ui/PageHero";
import { SectionLabel } from "@/components/ui/SectionLabel";
import { loadPageCMSContent } from "@/lib/cmsHelper";

export const metadata = constructMetadata({
  title: "Commercial & Industrial Capabilities | Six Nine Construction",
  description: "Six Nine Construction' building, warehousing, distribution center, structural steel work, and industrial engineering capabilities.",
});

export default async function CommercialIndustrialPage() {
  const content = await loadPageCMSContent("capabilities-commercial", "hero", {
    title: "Commercial & Industrial Building.",
    subtitle: "We construct large-scale warehouses, logistics depots, retail hubs, and multi-storey commercial centers utilizing advanced framing and slab engineering."
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
          { label: "Commercial & Industrial" }
        ]}
      />

      <section className="py-24 bg-snc-void border-b border-snc-border">
        <div className="container max-w-[1400px] mx-auto px-6 md:px-10 lg:px-16 xl:px-20">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
            <div>
              <SectionLabel>INDUSTRIAL BUILDING</SectionLabel>
              <h2 className="text-headline-lg text-white mt-2 font-display">Logistics Hubs & Large Scale Enclosures</h2>
              <p className="text-body text-snc-text-secondary mt-6 leading-relaxed">
                Modern commerce relies on efficient hubs and depots. SNC delivers turn-key commercial and industrial developments from early foundation piles to structural steel erection, cladding, office fit-outs, and heavy-duty loading bays.
              </p>
              <p className="text-body text-snc-text-secondary mt-4 leading-relaxed">
                We utilize high-flatness post-tensioned floor slabs and steel-fiber reinforced concrete to ensure load-bearing performance for heavy forklift racking systems.
              </p>
            </div>
            <div className="space-y-6">
              <div className="p-6 border border-snc-border bg-snc-navy-dark">
                <h4 className="text-lg font-bold text-white mb-2">High-Flatness Floor Slabs</h4>
                <p className="text-sm text-snc-text-secondary">
                  Jointless, post-tensioned concrete floor slabs designed for high-reach racking and intensive forklift wear.
                </p>
              </div>
              <div className="p-6 border border-snc-border bg-snc-navy-dark">
                <h4 className="text-lg font-bold text-white mb-2">Portal Frame Structural Steel</h4>
                <p className="text-sm text-snc-text-secondary">
                  Large-span portal frames, trusses, cladding, and insulation for distributions depots and factories.
                </p>
              </div>
              <div className="p-6 border border-snc-border bg-snc-navy-dark">
                <h4 className="text-lg font-bold text-white mb-2">Loading Docks & Yards</h4>
                <p className="text-sm text-snc-text-secondary">
                  Dock leveler pits, heavy trailer parking yards, perimeter security, and fire protection networks.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </PageWrapper>
  );
}
