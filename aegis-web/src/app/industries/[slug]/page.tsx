import { constructMetadata } from "@/lib/metadata";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { PageHero } from "@/components/ui/PageHero";
import { INDUSTRIES } from "@/lib/constants";
import { notFound } from "next/navigation";
import { SectionLabel } from "@/components/ui/SectionLabel";
import { Button } from "@/components/ui/Button";
import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";

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

      <section className="py-24 bg-[var(--snc-void)]">
        <div className="container">
          <div className="grid lg:grid-cols-12 gap-16">
            
            <div className="lg:col-span-8 prose prose-invert prose-lg max-w-none">
              <h2 className="text-3xl font-display text-[var(--snc-white)] mb-6">Expertise in {indName}</h2>
              <p className="text-[var(--snc-mist)] leading-relaxed mb-8">
                The {indName} sector demands a unique intersection of heavy engineering capability, stringent safety protocols, and the ability to operate in challenging environments without disrupting ongoing operations. Six Nine Construction has developed specialized methodologies to meet these exact requirements.
              </p>

              <h3 className="text-2xl font-bold text-[var(--snc-white)] mt-12 mb-6">Key Challenges We Solve</h3>
              <div className="grid sm:grid-cols-2 gap-6 mb-12">
                {[
                  "Maintaining Zero Harm in high-risk operational environments.",
                  "Executing brownfield expansions without disrupting current yield.",
                  "Managing complex, remote supply chains via Project AEGIS.",
                  "Navigating stringent regulatory and environmental compliance."
                ].map((item, index) => (
                  <div key={index} className="flex items-start gap-4 p-6 border border-[var(--snc-navy-border)] bg-[var(--snc-navy-mid)] rounded-sm">
                    <CheckCircle2 className="w-6 h-6 text-[var(--snc-gold)] shrink-0" />
                    <span className="text-[var(--snc-white)] text-base">{item}</span>
                  </div>
                ))}
              </div>

              <h3 className="text-2xl font-bold text-[var(--snc-white)] mt-12 mb-6">Regulatory Context</h3>
              <p className="text-[var(--snc-mist)] leading-relaxed mb-8">
                Operating in Zimbabwe and the broader SADC region requires intimate knowledge of local compliance frameworks. Our internal systems are fully aligned with PRAZ, EMA, and relevant ministerial requirements specific to the {indName} sector, ensuring that every project is de-risked from an administrative standpoint from day one.
              </p>
            </div>

            <div className="lg:col-span-4 space-y-8">
              <div className="p-8 border border-[var(--snc-navy-border)] bg-[var(--snc-navy-raised)] rounded-sm cad-line-accent">
                <SectionLabel>Relevant Capabilities</SectionLabel>
                <ul className="space-y-4 mt-6">
                  {["Civil Infrastructure", "Structural Engineering", "Earthworks & Grading", "Heavy Plant Operations"].map(cap => (
                    <li key={cap}>
                      <Link href={`/capabilities/${cap.toLowerCase().replace(/ & /g, '-').replace(/\s+/g, '-')}`} className="flex items-center justify-between text-[var(--snc-mist)] hover:text-[var(--snc-gold)] transition-colors group">
                        <span className="font-semibold">{cap}</span>
                        <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="p-8 border border-[var(--snc-gold)]/30 bg-[var(--snc-gold-ghost)] rounded-sm">
                <h3 className="text-xl font-bold text-[var(--snc-white)] mb-4">Start a Project</h3>
                <p className="text-sm text-[var(--snc-mist)] mb-6">Speak to our {indName} sector specialists about your upcoming infrastructure requirements.</p>
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
