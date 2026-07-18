import { constructMetadata } from "@/lib/metadata";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { PageHero } from "@/components/ui/PageHero";
import { Timeline } from "@/components/ui/Timeline";
import { SectionLabel } from "@/components/ui/SectionLabel";

export const metadata = constructMetadata({
  title: "Our Story | Six Nine Construction",
  description: "The founding and growth narrative of Six Nine Construction.",
});

export default function StoryPage() {
  const milestones = [
    {
      year: "2010",
      title: "Foundation",
      description: "Six Nine Construction was established in Harare, Zimbabwe, initially focusing on specialized civil engineering sub-contracts."
    },
    {
      year: "2014",
      title: "First Major Public Works",
      description: "Awarded our first tier-one municipal infrastructure project, delivering a critical water reticulation system ahead of schedule."
    },
    {
      year: "2016",
      title: "Mining Sector Entry",
      description: "Expanded capabilities into mining infrastructure, securing a long-term contract for surface infrastructure development at a major platinum operation."
    },
    {
      year: "2019",
      title: "CIFOZ & PRAZ Category A",
      description: "Achieved the highest level of industry accreditation in Zimbabwe, recognizing our capacity to execute unrestricted project values."
    },
    {
      year: "2022",
      title: "Project AEGIS Deployment",
      description: "Revolutionized our operational model with the in-house development and deployment of Project AEGIS, our proprietary digital command center."
    },
    {
      year: "2025",
      title: "Regional Expansion",
      description: "Initiated our Southern African expansion strategy, taking our engineered delivery model to cross-border infrastructure projects."
    }
  ];

  return (
    <PageWrapper>
      <PageHero
        title="Our Story"
        subtitle="A timeline of precision, growth, and relentless execution."
        breadcrumbs={[
          { label: "Home", href: "/" },
          { label: "Company", href: "/about" },
          { label: "Our Story" }
        ]}
      />

      <section className="py-24 bg-[var(--snc-void)]">
        <div className="container max-w-4xl">
          <div className="prose prose-invert prose-lg max-w-none mb-24">
            <p className="text-xl leading-loose text-[var(--snc-white)] font-medium mb-8">
              The infrastructure deficit in Southern Africa is not a problem of capital—it is a problem of execution. Six Nine Construction was founded to solve this exact challenge.
            </p>
            
            <p className="text-[var(--snc-mist)] leading-relaxed mb-6">
              From our inception in Zimbabwe, we observed a critical gap in the market: the divide between traditional, intuition-based construction management and the rigorous, data-driven approach required for modern, large-scale infrastructure.
            </p>

            <blockquote className="border-l-4 border-[var(--snc-gold)] pl-8 my-12 py-4 bg-[var(--snc-navy)]/50 italic text-[var(--snc-white)] text-xl">
              &quot;We don&apos;t just build structures. We engineer certainty into unpredictable environments.&quot;
            </blockquote>

            <p className="text-[var(--snc-mist)] leading-relaxed mb-6">
              Our growth trajectory has been entirely organic, fueled by a reputation for absolute reliability. When a mining house needs a processing plant foundation poured to millimeter accuracy under a constrained shutdown schedule, they call SNC.
            </p>

            <p className="text-[var(--snc-mist)] leading-relaxed">
              Today, empowered by Project AEGIS, we are not just a construction company; we are an infrastructure delivery platform. Every cubic meter of earth moved, every ton of steel erected, and every man-hour deployed is tracked, analyzed, and optimized.
            </p>
          </div>

          <div className="mt-24">
            <SectionLabel label="The Journey" />
            <h2 className="text-[var(--snc-white)] mb-12">Milestones of Growth</h2>
            <Timeline events={milestones} />
          </div>
        </div>
      </section>
    </PageWrapper>
  );
}
