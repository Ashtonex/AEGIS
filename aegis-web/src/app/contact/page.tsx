import { constructMetadata } from "@/lib/metadata";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { PageHero } from "@/components/ui/PageHero";
import { EnquiryForm } from "@/components/forms/EnquiryForm";
import { SITE_CONFIG } from "@/lib/constants";
import { MapPin, Phone, Mail, Clock } from "lucide-react";

export const metadata = constructMetadata({
  title: "Contact Us | Six Nine Construction",
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

      <section className="py-24 bg-[var(--dxl-void)] min-h-[60vh]">
        <div className="container max-w-6xl">
          <div className="grid lg:grid-cols-12 gap-16">
            
            {/* Contact Details */}
            <div className="lg:col-span-4 space-y-12">
              
              <div>
                <h3 className="text-xl font-bold text-[var(--dxl-paper)] mb-6">Headquarters</h3>
                <ul className="space-y-6 text-sm text-[var(--dxl-slate-light)]">
                  <li className="flex items-start gap-4">
                    <MapPin className="w-5 h-5 text-[var(--dxl-signal)] shrink-0" />
                    <span>{SITE_CONFIG.contact.address}</span>
                  </li>
                  <li className="flex items-center gap-4">
                    <Phone className="w-5 h-5 text-[var(--dxl-signal)] shrink-0" />
                    <span>{SITE_CONFIG.contact.phone}</span>
                  </li>
                  <li className="flex items-center gap-4">
                    <Mail className="w-5 h-5 text-[var(--dxl-signal)] shrink-0" />
                    <a href={`mailto:${SITE_CONFIG.contact.email}`} className="hover:text-[var(--dxl-signal)] transition-colors">{SITE_CONFIG.contact.email}</a>
                  </li>
                  <li className="flex items-start gap-4">
                    <Clock className="w-5 h-5 text-[var(--dxl-signal)] shrink-0" />
                    <span>Mon - Fri: 08:00 - 17:00<br/>Sat - Sun: Closed</span>
                  </li>
                </ul>
              </div>

              <div>
                <h3 className="text-xl font-bold text-[var(--dxl-paper)] mb-6">Departments</h3>
                <ul className="space-y-4 text-sm text-[var(--dxl-slate-light)]">
                  <li className="flex justify-between border-b border-[var(--dxl-ink-mid)] pb-2">
                    <span className="font-semibold text-[var(--dxl-paper)]">Commercial</span>
                    <a href="mailto:commercial@sixnineconstruction.com" className="hover:text-[var(--dxl-signal)]">commercial@sixnineconstruction.com</a>
                  </li>
                  <li className="flex justify-between border-b border-[var(--dxl-ink-mid)] pb-2">
                    <span className="font-semibold text-[var(--dxl-paper)]">Procurement</span>
                    <a href="mailto:procurement@sixnineconstruction.com" className="hover:text-[var(--dxl-signal)]">procurement@sixnineconstruction.com</a>
                  </li>
                  <li className="flex justify-between border-b border-[var(--dxl-ink-mid)] pb-2">
                    <span className="font-semibold text-[var(--dxl-paper)]">Careers</span>
                    <a href="mailto:hr@sixnineconstruction.com" className="hover:text-[var(--dxl-signal)]">hr@sixnineconstruction.com</a>
                  </li>
                </ul>
              </div>

              <div className="p-6 border border-[var(--dxl-danger)]/30 bg-[var(--dxl-danger)]/5 rounded-sm">
                 <h4 className="text-sm font-bold text-[var(--dxl-danger)] uppercase tracking-wider mb-2">Site Emergencies</h4>
                 <p className="text-sm text-[var(--dxl-slate-light)] mb-2">For active site emergencies only (24/7):</p>
                 <span className="text-lg font-mono text-[var(--dxl-paper)]">{SITE_CONFIG.contact.emergency}</span>
              </div>
            </div>

            {/* Form */}
            <div className="lg:col-span-8">
              <div className="p-8 md:p-12 border border-[var(--dxl-ink-mid)] bg-[var(--dxl-ink)] rounded-sm cad-line-accent relative overflow-hidden">
                <div className="absolute inset-0  opacity-10 pointer-events-none" />
                <div className="relative z-10">
                  <h2 className="text-2xl font-bold text-[var(--dxl-paper)] mb-2">Send an Enquiry</h2>
                  <p className="text-sm text-[var(--dxl-slate-light)] mb-8">All fields marked with an asterisk (*) are required.</p>
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
