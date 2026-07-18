import { constructMetadata } from "@/lib/metadata";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { PageHero } from "@/components/ui/PageHero";
import { TenderBoardClient } from "@/components/sections/TenderBoardClient";
import { getTenders } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import Link from "next/link";

export const metadata = constructMetadata({
  title: "Tender Board | Six Nine Construction",
  description: "Current procurement and subcontracting opportunities with SNC.",
});

export default async function TendersPage(props: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const searchParams = await props.searchParams;
  const status = typeof searchParams.status === 'string' ? searchParams.status : undefined;
  
  const tendersRes = await getTenders({ limit: 20, status }).catch(() => null);
  const tenders = tendersRes?.success ? tendersRes.data : [];

  return (
    <PageWrapper>
      <PageHero
        title="Tender Opportunities"
        subtitle="Transparent, equitable, and efficient procurement. Partner with us to deliver excellence."
        breadcrumbs={[
          { label: "Home", href: "/" },
          { label: "Tender Board" }
        ]}
      />

      <section className="py-8 bg-snc-navy border-b border-snc-border sticky top-[80px] md:top-[104px] z-30">
        <div className="container max-w-[1400px] mx-auto px-6 md:px-10 lg:px-16 xl:px-20">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="p-6 border-l-[2px] border-l-snc-gold-primary bg-snc-navy-raised">
              <div className="text-snc-text-tertiary font-sans text-[11px] font-semibold uppercase tracking-[0.08em] mb-2">Active Tenders</div>
              <div className="text-display-lg text-snc-text-primary">{tenders.length}</div>
            </div>
            <div className="p-6 border-l-[2px] border-l-snc-warning bg-snc-navy-raised">
              <div className="text-snc-text-tertiary font-sans text-[11px] font-semibold uppercase tracking-[0.08em] mb-2">Closing This Week</div>
              <div className="text-display-lg text-snc-text-primary">{tenders.filter(t => t.status === 'Closing Soon').length}</div>
            </div>
            <div className="p-6 border-l-[2px] border-l-snc-electric bg-snc-navy-raised">
              <div className="text-snc-text-tertiary font-sans text-[11px] font-semibold uppercase tracking-[0.08em] mb-2">Pre-Qualification</div>
              <div className="text-headline-sm text-snc-text-primary mt-2">Required for all bids</div>
            </div>
          </div>
        </div>
      </section>

      <section className="py-24 bg-snc-void min-h-[50vh]">
        <div className="container max-w-[1400px] mx-auto px-6 md:px-10 lg:px-16 xl:px-20">
          
          <TenderBoardClient initialTenders={tenders} />

          <div className="p-10 border border-snc-gold-primary/30 bg-snc-gold-ghost rounded-sm flex flex-col md:flex-row items-center justify-between gap-6">
            <div>
              <h3 className="text-headline-lg text-snc-text-primary mb-2">Not Registered Yet?</h3>
              <p className="text-body text-snc-text-secondary">All suppliers must complete the vendor registration process before submitting bids.</p>
            </div>
            <Link href="/suppliers/register">
              <Button variant="primary" className="whitespace-nowrap">Register as Supplier</Button>
            </Link>
          </div>

        </div>
      </section>
    </PageWrapper>
  );
}
