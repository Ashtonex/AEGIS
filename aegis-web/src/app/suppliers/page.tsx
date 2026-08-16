import { constructMetadata } from "@/lib/metadata";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { PageHero } from "@/components/ui/PageHero";
import { Button } from "@/components/ui/Button";
import Link from "next/link";
import { ShieldCheck, FileText, CheckCircle2 } from "lucide-react";

export const metadata = constructMetadata({
  title: "Supplier Portal | Six Nine Construction",
  description: "Information and pre-qualification requirements for SNC suppliers.",
});

export default function SuppliersPage() {
  return (
    <PageWrapper>
      <PageHero
        title="Supplier Portal"
        subtitle="We collaborate with partners who share our commitment to quality, safety, and precision."
        breadcrumbs={[
          { label: "Home", href: "/" },
          { label: "Procurement", href: "/suppliers" }
        ]}
      />

      <section className="py-24 bg-[var(--dxl-void)]">
        <div className="container max-w-5xl">
          <div className="grid md:grid-cols-2 gap-16 mb-24">
            <div>
              <h2 className="text-2xl font-bold text-[var(--dxl-paper)] mb-6">Procurement Policy</h2>
              <p className="text-[var(--dxl-slate-light)] leading-relaxed mb-6">
                Six Nine Construction operates a transparent, competitive, and equitable procurement system. Our supply chain is a critical component of our ability to deliver institutional-grade infrastructure. We actively seek out suppliers and sub-contractors who align with our standards for Zero Harm, technical excellence, and environmental stewardship.
              </p>
              <Button variant="outline">Download Policy PDF</Button>
            </div>
            <div className="p-8 bg-[var(--dxl-ink-light)] border border-[var(--dxl-ink-mid)] rounded-sm">
              <ShieldCheck className="w-10 h-10 text-[var(--dxl-signal)] mb-6" />
              <h3 className="text-xl font-bold text-[var(--dxl-paper)] mb-4">Pre-Qualification Criteria</h3>
              <ul className="space-y-4 text-sm text-[var(--dxl-slate-light)] mb-8">
                <li className="flex items-start gap-3"><CheckCircle2 className="w-4 h-4 text-[var(--dxl-success)] mt-0.5" /> Valid Tax Clearance Certificate</li>
                <li className="flex items-start gap-3"><CheckCircle2 className="w-4 h-4 text-[var(--dxl-success)] mt-0.5" /> Certificate of Incorporation</li>
                <li className="flex items-start gap-3"><CheckCircle2 className="w-4 h-4 text-[var(--dxl-success)] mt-0.5" /> PRAZ Registration (where applicable)</li>
                <li className="flex items-start gap-3"><CheckCircle2 className="w-4 h-4 text-[var(--dxl-success)] mt-0.5" /> Proven Track Record & References</li>
                <li className="flex items-start gap-3"><CheckCircle2 className="w-4 h-4 text-[var(--dxl-success)] mt-0.5" /> HSE Policy Compliance</li>
              </ul>
            </div>
          </div>

          <div className="border-t border-[var(--dxl-ink-mid)] pt-24 text-center">
            <h2 className="text-3xl font-display text-[var(--dxl-paper)] mb-6">Ready to Partner With Us?</h2>
            <p className="text-lg text-[var(--dxl-slate-light)] mb-12 max-w-2xl mx-auto">
              Complete the digital vendor registration process to be added to the SNC approved supplier database.
            </p>
            <div className="flex flex-col sm:flex-row justify-center gap-4">
              <Link href="/suppliers/register">
                <Button variant="default" size="lg">Start Registration</Button>
              </Link>
              <Link href="/tenders">
                <Button variant="ghost" size="lg">View Open Tenders</Button>
              </Link>
            </div>
          </div>
        </div>
      </section>
    </PageWrapper>
  );
}
