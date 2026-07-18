import { constructMetadata } from "@/lib/metadata";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { PageHero } from "@/components/ui/PageHero";
import { SectionLabel } from "@/components/ui/SectionLabel";
import { HelpCircle } from "lucide-react";
import { loadPageCMSContent } from "@/lib/cmsHelper";

export const metadata = constructMetadata({
  title: "Tenders FAQ & Guidelines | Six Nine Construction",
  description: "Frequently asked questions regarding SNC project tenders, bid bonds, Joint Venture options, and submission protocols.",
});

export default async function TendersFaqPage() {
  const content = await loadPageCMSContent("tenders-faq", "hero", {
    title: "Tendering & Bidding FAQs.",
    subtitle: "Review frequently asked questions regarding bid submissions, pre-qualification criteria, and Joint Venture structures."
  });

  return (
    <PageWrapper>
      <PageHero
        variant="half"
        title={content.title}
        subtitle={content.subtitle}
        breadcrumbs={[
          { label: "Home", href: "/" },
          { label: "Tenders", href: "/tenders" },
          { label: "FAQs" }
        ]}
      />

      <section className="py-24 bg-snc-void border-b border-snc-border">
        <div className="container max-w-[1400px] mx-auto px-6 md:px-10 lg:px-16 xl:px-20">
          <div className="max-w-3xl">
            <SectionLabel>TENDER COMPLIANCE FAQ</SectionLabel>
            <h2 className="text-headline-lg text-white mt-2 font-display mb-12">Bidding Guidelines</h2>

            <div className="space-y-8">
              <div>
                <h4 className="text-lg font-bold text-white flex items-center gap-2 mb-2">
                  <HelpCircle className="w-5 h-5 text-snc-gold-primary shrink-0" />
                  What is the standard bid bond requirement?
                </h4>
                <p className="text-sm text-snc-text-secondary leading-relaxed pl-7">
                  Unless specified otherwise in the specific Tender Document, all bids above USD 100,000 must be accompanied by a Bank Guarantee or Insurance Bid Bond equivalent to 2% of the total bid sum.
                </p>
              </div>
              <div>
                <h4 className="text-lg font-bold text-white flex items-center gap-2 mb-2">
                  <HelpCircle className="w-5 h-5 text-snc-gold-primary shrink-0" />
                  Are Joint Ventures (JV) permitted?
                </h4>
                <p className="text-sm text-snc-text-secondary leading-relaxed pl-7">
                  Yes, JVs are welcomed provided that a signed Joint Venture Agreement or Memorandum of Understanding (MOU) is submitted, explicitly outlining the lead partner and resource contribution ratios.
                </p>
              </div>
              <div>
                <h4 className="text-lg font-bold text-white flex items-center gap-2 mb-2">
                  <HelpCircle className="w-5 h-5 text-snc-gold-primary shrink-0" />
                  Where do we submit physical bid samples or drawings?
                </h4>
                <p className="text-sm text-snc-text-secondary leading-relaxed pl-7">
                  All digital bid documents must be submitted online through the Secure Supplier Portal. Physical material samples or heavy structural drawings should be delivered in sealed envelopes to the SNC Procurement Office in Harare or Mutare as specified in the tender instructions.
                </p>
              </div>
              <div>
                <h4 className="text-lg font-bold text-white flex items-center gap-2 mb-2">
                  <HelpCircle className="w-5 h-5 text-snc-gold-primary shrink-0" />
                  How is supplier performance scored?
                </h4>
                <p className="text-sm text-snc-text-secondary leading-relaxed pl-7">
                  SNC uses an automated Performance Index tracker assessing suppliers on: (1) On-time delivery rate, (2) Material quality compliance, (3) Safety performance on site, and (4) Responsiveness. High scores prioritize suppliers for future private invite tenders.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </PageWrapper>
  );
}
