import { constructMetadata } from "@/lib/metadata";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { PageHero } from "@/components/ui/PageHero";
import { VerifyCodeForm } from "./VerifyClient";

export const metadata = constructMetadata({
  title: "Verify a Document | Six Nine Construction",
  description: "Check that a purchase order or other document from Six Nine Construction is genuine and unaltered.",
});

export default function VerifyPage() {
  return (
    <PageWrapper>
      <PageHero
        title="Verify a Document"
        subtitle="Every purchase order Six Nine Construction issues through AEGIS carries a verification code and QR code."
        breadcrumbs={[{ label: "Home", href: "/" }, { label: "Verify a Document" }]}
      />
      <section className="py-20 bg-[var(--dxl-void)] min-h-[50vh]">
        <div className="container max-w-2xl">
          <p className="text-[var(--dxl-slate-light)] mb-6">
            Scan the QR code on the document, or type the code printed beside it (it starts with SNC-).
          </p>
          <VerifyCodeForm />
        </div>
      </section>
    </PageWrapper>
  );
}
