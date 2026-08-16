import { constructMetadata } from "@/lib/metadata";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { PageHero } from "@/components/ui/PageHero";
import { INDUSTRIES } from "@/lib/constants";
import { notFound } from "next/navigation";
import { SectionLabel } from "@/components/ui/SectionLabel";
import { Button } from "@/components/ui/Button";
import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { getIndustryContent } from "@/lib/industriesContent";

export async function generateStaticParams() {
  return INDUSTRIES.map((ind) => ({
    slug: ind.toLowerCase(),
  }));
}

export async function generateMetadata(props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  const ind = INDUSTRIES.find(i => i.toLowerCase() === params.slug);
  if (!ind) return {};
  
  return constructMetadata({
    title: `${ind} Sector | Six Nine Construction`,
    description: `SNC's infrastructure delivery expertise in the ${ind} sector.`,
  });
}

export default async function IndustryDetailPage(props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  const indName = INDUSTRIES.find(i => i.toLowerCase() === params.slug);
  
  if (!indName) {
    notFound();
  }

  const content = getIndustryContent(params.slug);

  return (
    <PageWrapper>
      <PageHero
        title={`${indName} Sector`}
        subtitle={`Precision engineering and construction execution tailored specifically for the ${indName} industry.`}
        breadcrumbs={[
          { label: "Home", href: "/" },
          { label: "Industries" },
          { label: indName }
        ]}
      />

      <section className="py-24 bg-[var(--dxl-void)]">
        <div className="container">
          <div className="grid lg:grid-cols-12 gap-16">
            
            <div className="lg:col-span-8 prose prose-invert prose-lg max-w-none">
              <h2 className="text-3xl font-display text-[var(--dxl-paper)] mb-6">Expertise in {indName}</h2>
              <p className="text-[var(--dxl-slate-light)] leading-relaxed mb-8">
                {content.expertise}
              </p>

              <h3 className="text-2xl font-bold text-[var(--dxl-paper)] mt-12 mb-6">Key Challenges We Solve</h3>
              <div className="grid sm:grid-cols-2 gap-6 mb-12">
                {content.challenges.map((item, index) => (
                  <div key={index} className="flex items-start gap-4 p-6 border border-[var(--dxl-ink-mid)] bg-[var(--dxl-ink-mid)] rounded-sm">
                    <CheckCircle2 className="w-6 h-6 text-[var(--dxl-signal)] shrink-0" />
                    <span className="text-[var(--dxl-paper)] text-base">{item}</span>
                  </div>
                ))}
              </div>

              <h3 className="text-2xl font-bold text-[var(--dxl-paper)] mt-12 mb-6">Regulatory Context</h3>
              <p className="text-[var(--dxl-slate-light)] leading-relaxed mb-8">
                {content.regulatory}
              </p>
            </div>

            <div className="lg:col-span-4 space-y-8">
              <div className="p-8 border border-[var(--dxl-ink-mid)] bg-[var(--dxl-ink-light)] rounded-sm cad-line-accent">
                <SectionLabel>Relevant Capabilities</SectionLabel>
                <ul className="space-y-4 mt-6">
                  {content.relatedCapabilities.map(cap => (
                    <li key={cap}>
                      <Link href={`/capabilities/${cap.toLowerCase().replace(/ & /g, '-').replace(/\s+/g, '-')}`} className="flex items-center justify-between text-[var(--dxl-slate-light)] hover:text-[var(--dxl-signal)] transition-colors group">
                        <span className="font-semibold">{cap}</span>
                        <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="p-8 border border-[var(--dxl-signal)]/30 bg-[var(--dxl-signal-ghost)] rounded-sm">
                <h3 className="text-xl font-bold text-[var(--dxl-paper)] mb-4">Start a Project</h3>
                <p className="text-sm text-[var(--dxl-slate-light)] mb-6">Speak to our {indName} sector specialists about your upcoming infrastructure requirements.</p>
                <Link href={`/contact?type=New Project&industry=${indName}`}>
                  <Button variant="default" className="w-full">Request Consultation</Button>
                </Link>
              </div>
            </div>

          </div>
        </div>
      </section>
    </PageWrapper>
  );
}
