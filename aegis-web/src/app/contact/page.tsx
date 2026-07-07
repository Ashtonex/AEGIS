import { constructMetadata } from "@/lib/metadata";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { PageHero } from "@/components/ui/PageHero";
import { EnquiryForm } from "@/components/forms/EnquiryForm";
import { SITE_CONFIG } from "@/lib/constants";
import { MapPin, Phone, Mail, Clock } from "lucide-react";

export const metadata = constructMetadata({
  title: "Contact Us | Six Nine Constructions",
  description: "Get in touch with SNC for your next infrastructure project.",
});

export default async function ContactPage(props: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const searchParams = await props.searchParams;
  const defaultType = typeof searchParams.type === 'string' ? searchParams.type : "General";

  return (
    <PageWrapper>
      <PageHero
        title="Get In Touch"
        subtitle="Our commercial and engineering teams are ready to discuss your next project."
        breadcrumbs={[
          { label: "Home", href: "/" },
          { label: "Contact Us" }
        ]}
      />

      <section className="py-24 bg-[var(--snc-void)] min-h-[60vh]">
        <div className="container max-w-6xl">
          <div className="grid lg:grid-cols-12 gap-16">
            
            {/* Contact Details */}
            <div className="lg:col-span-4 space-y-12">
              
              <div>
                <h3 className="text-xl font-bold text-[var(--snc-white)] mb-6">Headquarters</h3>
                <ul className="space-y-6 text-sm text-[var(--snc-mist)]">
                  <li className="flex items-start gap-4">
                    <MapPin className="w-5 h-5 text-[var(--snc-gold)] shrink-0" />
                    <span>{SITE_CONFIG.contact.address}</span>
                  </li>
                  <li className="flex items-center gap-4">
                    <Phone className="w-5 h-5 text-[var(--snc-gold)] shrink-0" />
                    <span>{SITE_CONFIG.contact.phone}</span>
                  </li>
                  <li className="flex items-center gap-4">
                    <Mail className="w-5 h-5 text-[var(--snc-gold)] shrink-0" />
                    <a href={`mailto:${SITE_CONFIG.contact.email}`} className="hover:text-[var(--snc-gold)] transition-colors">{SITE_CONFIG.contact.email}</a>
                  </li>
                  <li className="flex items-start gap-4">
                    <Clock className="w-5 h-5 text-[var(--snc-gold)] shrink-0" />
                    <span>Mon - Fri: 08:00 - 17:00<br/>Sat - Sun: Closed</span>
                  </li>
                </ul>
              </div>

              <div>
                <h3 className="text-xl font-bold text-[var(--snc-white)] mb-6">Departments</h3>
                <ul className="space-y-4 text-sm text-[var(--snc-mist)]">
                  <li className="flex justify-between border-b border-[var(--snc-navy-border)] pb-2">
                    <span className="font-semibold text-[var(--snc-white)]">Commercial</span>
                    <a href="mailto:commercial@sixnine.co.zw" className="hover:text-[var(--snc-gold)]">commercial@sixnine.co.zw</a>
                  </li>
                  <li className="flex justify-between border-b border-[var(--snc-navy-border)] pb-2">
                    <span className="font-semibold text-[var(--snc-white)]">Procurement</span>
                    <a href="mailto:procurement@sixnine.co.zw" className="hover:text-[var(--snc-gold)]">procurement@sixnine.co.zw</a>
                  </li>
                  <li className="flex justify-between border-b border-[var(--snc-navy-border)] pb-2">
                    <span className="font-semibold text-[var(--snc-white)]">Careers</span>
                    <a href="mailto:hr@sixnine.co.zw" className="hover:text-[var(--snc-gold)]">hr@sixnine.co.zw</a>
                  </li>
                </ul>
              </div>

              <div className="p-6 border border-[var(--snc-danger)]/30 bg-[var(--snc-danger)]/5 rounded-sm">
                 <h4 className="text-sm font-bold text-[var(--snc-danger)] uppercase tracking-wider mb-2">Site Emergencies</h4>
                 <p className="text-sm text-[var(--snc-mist)] mb-2">For active site emergencies only (24/7):</p>
                 <span className="text-lg font-mono text-[var(--snc-white)]">{SITE_CONFIG.contact.emergency}</span>
              </div>
            </div>

            {/* Form */}
            <div className="lg:col-span-8">
              <div className="p-8 md:p-12 border border-[var(--snc-navy-border)] bg-[var(--snc-navy)] rounded-sm cad-line-accent relative overflow-hidden">
                <div className="absolute inset-0  opacity-10 pointer-events-none" />
                <div className="relative z-10">
                  <h2 className="text-2xl font-bold text-[var(--snc-white)] mb-2">Send an Enquiry</h2>
                  <p className="text-sm text-[var(--snc-mist)] mb-8">All fields marked with an asterisk (*) are required.</p>
                  <EnquiryForm defaultType={defaultType} />
                </div>
              </div>
            </div>

          </div>
        </div>
      </section>
    </PageWrapper>
  );
}
