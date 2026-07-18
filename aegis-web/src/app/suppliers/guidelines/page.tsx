import { constructMetadata } from "@/lib/metadata";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { PageHero } from "@/components/ui/PageHero";
import { SectionLabel } from "@/components/ui/SectionLabel";
import { Button } from "@/components/ui/Button";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { loadPageCMSContent } from "@/lib/cmsHelper";

export const metadata = constructMetadata({
  title: "Supplier Onboarding Guidelines | Six Nine Construction",
  description: "Learn about SNC's procurement guidelines, compliance requirements, tax clearances, and how to successfully register as a supply partner.",
});

export default async function SupplierGuidelinesPage() {
  const content = await loadPageCMSContent("suppliers-guidelines", "hero", {
    title: "Supplier Compliance Guidelines.",
    subtitle: "Six Nine Construction operates a transparent, fair, and compliant supply chain. Read our onboarding guidelines to ensure your company meets SNC standards."
  });

  return (
    <PageWrapper>
      <PageHero
        variant="half"
        title={content.title}
        subtitle={content.subtitle}
        breadcrumbs={[
          { label: "Home", href: "/" },
          { label: "Suppliers", href: "/suppliers" },
          { label: "Onboarding Guidelines" }
        ]}
      />

      <section className="py-24 bg-snc-void border-b border-snc-border">
        <div className="container max-w-[1400px] mx-auto px-6 md:px-10 lg:px-16 xl:px-20">
          <div className="max-w-3xl">
            <SectionLabel>REGISTRATION CHECKLIST</SectionLabel>
            <h2 className="text-headline-lg text-white mt-2 font-display">Required Onboarding Credentials</h2>
            <p className="text-body text-snc-text-secondary mt-6 leading-relaxed">
              To be provisioned as an active subcontractor or materials supplier, your organization must upload valid compliance documentation during registration. Submissions missing these files will be rejected.
            </p>

            <div className="mt-12 space-y-6">
              <div className="flex gap-4 p-5 border border-snc-border bg-snc-navy-dark">
                <CheckCircle2 className="w-6 h-6 text-snc-gold-primary shrink-0" />
                <div>
                  <h4 className="text-lg font-bold text-white mb-1">1. Company Registrations</h4>
                  <p className="text-sm text-snc-text-secondary">
                    Certificate of Incorporation, CR14 (Directors List), and CR6 (Registered Office Address).
                  </p>
                </div>
              </div>
              <div className="flex gap-4 p-5 border border-snc-border bg-snc-navy-dark">
                <CheckCircle2 className="w-6 h-6 text-snc-gold-primary shrink-0" />
                <div>
                  <h4 className="text-lg font-bold text-white mb-1">2. Tax Compliance</h4>
                  <p className="text-sm text-snc-text-secondary">
                    Valid ITF263 Tax Clearance Certificate issued by ZIMRA, accompanied by VAT registration where applicable.
                  </p>
                </div>
              </div>
              <div className="flex gap-4 p-5 border border-snc-border bg-snc-navy-dark">
                <CheckCircle2 className="w-6 h-6 text-snc-gold-primary shrink-0" />
                <div>
                  <h4 className="text-lg font-bold text-white mb-1">3. Regulatory Licensing</h4>
                  <p className="text-sm text-snc-text-secondary">
                    Valid PRAZ (Procurement Regulatory Authority of Zimbabwe) certificate under relevant categories, and NSSA compliance.
                  </p>
                </div>
              </div>
              <div className="flex gap-4 p-5 border border-snc-border bg-snc-navy-dark">
                <CheckCircle2 className="w-6 h-6 text-snc-gold-primary shrink-0" />
                <div>
                  <h4 className="text-lg font-bold text-white mb-1">4. Trade References</h4>
                  <p className="text-sm text-snc-text-secondary">
                    At least three verifiable written references from main contractors for projects completed in the past 36 months.
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-12 p-8 border border-snc-gold-primary/30 bg-snc-gold-primary/5 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
              <div>
                <h4 className="text-lg font-bold text-white">Ready to register?</h4>
                <p className="text-sm text-snc-text-secondary mt-1">Ensure you have all documents scanned as PDFs before starting the form.</p>
              </div>
              <Link href="/suppliers/register">
                <Button variant="primary">Start Supplier Intake</Button>
              </Link>
            </div>
          </div>
        </div>
      </section>
    </PageWrapper>
  );
}
