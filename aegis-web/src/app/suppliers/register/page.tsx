import { constructMetadata } from "@/lib/metadata";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { PageHero } from "@/components/ui/PageHero";
import { SupplierForm } from "@/components/forms/SupplierForm";

export const metadata = constructMetadata({
  title: "Supplier Registration | Six Nine Constructions",
  description: "Register as an approved vendor for Six Nine Constructions.",
});

export default function SupplierRegistrationPage() {
  return (
    <PageWrapper>
      <PageHero
        title="Supplier Registration"
        subtitle="Complete the multi-step process to be evaluated for our approved vendor list."
        breadcrumbs={[
          { label: "Home", href: "/" },
          { label: "Procurement", href: "/suppliers" },
          { label: "Registration" }
        ]}
      />

      <section className="py-24 bg-[var(--snc-void)]">
        <div className="container max-w-4xl">
          <div className="p-8 md:p-12 border border-[var(--snc-navy-border)] bg-[var(--snc-navy)] rounded-sm cad-line-accent relative overflow-hidden">
            <div className="absolute inset-0  opacity-10 pointer-events-none" />
            <div className="relative z-10">
              <SupplierForm />
            </div>
          </div>
        </div>
      </section>
    </PageWrapper>
  );
}
