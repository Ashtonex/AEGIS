import { constructMetadata } from "@/lib/metadata";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { PageHero } from "@/components/ui/PageHero";
import { TenderCard } from "@/components/sections/TenderCard";
import { getTenders } from "@/lib/api";
import { Search, FolderOpen } from "lucide-react";
import { FormField } from "@/components/ui/FormField";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { StaggerContainer, StaggerItem } from "@/components/ui/StaggerContainer";
import Link from "next/link";

export const metadata = constructMetadata({
  title: "Tender Board | Six Nine Constructions",
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
          
          {/* Filters */}
          <div className="flex flex-col md:flex-row gap-4 mb-8">
            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-snc-text-tertiary z-10" />
              <FormField 
                className="pl-12 w-full mb-0" 
                containerClassName="mb-0" 
                placeholder="Search tender reference or title..." 
              />
            </div>
            <FormField
              as="select"
              containerClassName="mb-0 w-full md:w-48"
              className="mb-0 text-snc-text-secondary"
              options={[
                { label: "All Categories", value: "" },
                { label: "Materials", value: "materials" },
                { label: "Plant Hire", value: "plant" },
                { label: "Sub-contracting", value: "subcontract" }
              ]}
            />
            <FormField
              as="select"
              containerClassName="mb-0 w-full md:w-48"
              className="mb-0 text-snc-text-secondary"
              options={[
                { label: "All Statuses", value: "" },
                { label: "Open", value: "Open" },
                { label: "Closing Soon", value: "Closing Soon" }
              ]}
            />
          </div>

          <div className="bg-snc-navy border border-snc-border rounded-[4px] overflow-hidden mb-16">
            <div className="hidden lg:grid grid-cols-12 gap-6 p-4 border-b border-snc-border bg-snc-navy-mid font-sans text-[11px] font-semibold tracking-widest uppercase text-snc-text-tertiary">
              <div className="col-span-2">Reference</div>
              <div className="col-span-4">Title</div>
              <div className="col-span-3">Details</div>
              <div className="col-span-3 text-right">Actions</div>
            </div>
            
            <div className="flex flex-col">
              {tenders.length > 0 ? (
                <StaggerContainer>
                  {tenders.map((tender: any) => (
                    <StaggerItem key={tender.id}>
                      <TenderCard tender={tender} variant="row" className="bg-snc-void" />
                    </StaggerItem>
                  ))}
                </StaggerContainer>
              ) : (
                <EmptyState 
                  icon={FolderOpen}
                  title="No Tenders Found"
                  description="There are currently no active tenders matching your filters."
                />
              )}
            </div>
          </div>

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
