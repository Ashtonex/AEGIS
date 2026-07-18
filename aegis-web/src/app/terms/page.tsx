import { constructMetadata } from "@/lib/metadata";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { PageHero } from "@/components/ui/PageHero";
import { FileText, Gavel, Scale, AlertTriangle, ShieldCheck } from "lucide-react";

export const metadata = constructMetadata({
  title: "Terms of Service | Six Nine Construction",
  description: "Terms and conditions regulating Project AEGIS portal access, contractor registration, and bidding securities.",
});

export default function TermsOfServicePage() {
  return (
    <PageWrapper>
      <PageHero
        title="Terms of Service"
        subtitle="Operational regulations governing contractor prequalification, bidding securities, and platform liabilities."
        breadcrumbs={[
          { label: "Home", href: "/" },
          { label: "Compliance", href: "/terms" },
          { label: "Terms of Service" }
        ]}
      />

      <section className="py-24 bg-[#050505] text-white">
        <div className="container max-w-[1400px] mx-auto px-6 md:px-10 lg:px-16 xl:px-20">
          {/* Asymmetrical Editorial Grid Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
            
            {/* Left Sticky Sidebar: Navigation & Metadata */}
            <div className="lg:col-span-4 space-y-8">
              <div className="sticky top-28 p-6 bg-[#0a0a0a] border border-[#1c1c1c] rounded-sm">
                <div className="border-b border-[#1c1c1c] pb-6 mb-6">
                  <div className="text-[10px] font-mono text-[#D4AF37] uppercase tracking-widest mb-2">Legal Framework</div>
                  <h3 className="font-display text-lg font-bold text-white uppercase tracking-wide">Document Metadata</h3>
                  
                  <div className="mt-4 space-y-3 font-mono text-xs text-slate-light">
                    <div className="flex justify-between">
                      <span>DOCUMENT ID:</span>
                      <span className="text-white font-semibold">SNC-TOS-2026-V1</span>
                    </div>
                    <div className="flex justify-between">
                      <span>CLASSIFICATION:</span>
                      <span className="text-white font-semibold">PUBLIC REGULATED</span>
                    </div>
                    <div className="flex justify-between">
                      <span>EFFECTIVE DATE:</span>
                      <span className="text-white font-semibold tabular-nums">2026-07-13</span>
                    </div>
                    <div className="flex justify-between">
                      <span>JURISDICTION:</span>
                      <span className="text-[#3B82F6] font-semibold">ZIMBABWE</span>
                    </div>
                  </div>
                </div>

                <nav className="space-y-4">
                  <div className="text-[10px] font-mono text-slate-light uppercase tracking-widest mb-3">Terms Index</div>
                  
                  <a href="#contractor-registration" className="group flex items-center gap-3 py-1 text-sm text-slate-light hover:text-white transition-colors">
                    <span className="font-mono text-xs text-[#D4AF37] group-hover:underline">[01]</span>
                    <span>Contractor Registration & Prequalification</span>
                  </a>
                  
                  <a href="#bid-securities" className="group flex items-center gap-3 py-1 text-sm text-slate-light hover:text-white transition-colors">
                    <span className="font-mono text-xs text-[#D4AF37] group-hover:underline">[02]</span>
                    <span>Bid Securities & Tender Bonds</span>
                  </a>
                  
                  <a href="#platform-liabilities" className="group flex items-center gap-3 py-1 text-sm text-slate-light hover:text-white transition-colors">
                    <span className="font-mono text-xs text-[#D4AF37] group-hover:underline">[03]</span>
                    <span>Platform Use & Liabilities</span>
                  </a>
                  
                  <a href="#indemnification" className="group flex items-center gap-3 py-1 text-sm text-slate-light hover:text-white transition-colors">
                    <span className="font-mono text-xs text-[#D4AF37] group-hover:underline">[04]</span>
                    <span>Indemnification Protocols</span>
                  </a>
                  
                  <a href="#governing-law" className="group flex items-center gap-3 py-1 text-sm text-slate-light hover:text-white transition-colors">
                    <span className="font-mono text-xs text-[#D4AF37] group-hover:underline">[05]</span>
                    <span>Governing Law & Disputes</span>
                  </a>
                </nav>

                <div className="mt-8 pt-6 border-t border-[#1c1c1c] text-xs text-slate-light leading-relaxed">
                  For formal legal notifications, contractual disputes, or representation matters, contact our Corporate Legal Team at{" "}
                  <a href="mailto:legal@sixnine.co.zw" className="text-white hover:text-[#D4AF37] underline transition-colors">
                    legal@sixnine.co.zw
                  </a>.
                </div>
              </div>
            </div>

            {/* Right Main Content */}
            <div className="lg:col-span-8 space-y-16">
              
              {/* Introduction Card */}
              <div className="p-8 bg-[#0a0a0a] border border-[#1c1c1c] border-l-2 border-l-[#D4AF37] rounded-sm">
                <h2 className="text-headline-md font-display text-white uppercase tracking-wider mb-4">Standard Operational Terms</h2>
                <p className="text-body text-slate-light leading-relaxed mb-4">
                  Welcome to the Project AEGIS portal. These Terms of Service (&quot;Terms&quot;) establish a legally binding agreement between Six Nine Construction (Pvt) Ltd (&quot;SNC&quot;) and all registered contractors, bidders, suppliers, or employees (&quot;Users&quot;) accessing the portal or participating in SNC-managed tenders and projects.
                </p>
                <p className="text-body text-slate-light leading-relaxed">
                  By completing registration or submitting bids, you unconditionally accept the terms, securities guidelines, and liability limitations specified herein.
                </p>
              </div>

              {/* Section 1: Contractor Registration */}
              <div id="contractor-registration" className="scroll-mt-28 space-y-6">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm text-[#D4AF37] font-semibold">[01]</span>
                  <h2 className="text-headline-lg font-display uppercase tracking-wide text-white">Contractor Registration & Prequalification</h2>
                </div>
                
                <p className="text-body text-slate-light leading-relaxed">
                  SNC maintains strict standards for site safety, financial stability, and technical execution. Prequalification on the Project AEGIS portal is mandatory for all subcontractors and suppliers.
                </p>

                <div className="p-6 bg-[#0a0a0a] border border-[#1c1c1c] rounded-sm space-y-4">
                  <h3 className="text-white font-semibold flex items-center gap-2 text-sm uppercase tracking-wide">
                    <ShieldCheck className="w-4 h-4 text-[#D4AF37]" />
                    Registration Requirements
                  </h3>
                  <p className="text-sm text-slate-light leading-relaxed">
                    Users must provide verified credentials during registration, including but not limited to:
                  </p>
                  <ul className="list-disc pl-6 space-y-2 text-sm text-slate-light">
                    <li>Valid registration with the Procurement Regulatory Authority of Zimbabwe (PRAZ).</li>
                    <li>Accredited standing under the Construction Industry Federation of Zimbabwe (CIFOZ) or Zimbabwe Building Contractors Association (ZBCA).</li>
                    <li>Audited financial statements matching the target project category threshold.</li>
                    <li>Verified tax clearance certificates from the Zimbabwe Revenue Authority (ZIMRA).</li>
                  </ul>
                  <p className="text-xs text-slate-light italic border-t border-[#1c1c1c] pt-3 mt-2">
                    Note: SNC reserves the right to terminate prequalification status instantly if documents are determined to be fraudulent or expired.
                  </p>
                </div>
              </div>

              {/* Section 2: Bid Securities */}
              <div id="bid-securities" className="scroll-mt-28 space-y-6">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm text-[#D4AF37] font-semibold">[02]</span>
                  <h2 className="text-headline-lg font-display uppercase tracking-wide text-white">Bid Securities & Tender Bonds</h2>
                </div>
                
                <p className="text-body text-slate-light leading-relaxed">
                  To prevent frivolous submissions and guarantee execution capacity, SNC enforces strict bid security protocols across all public and private commercial tenders.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
                  <div className="p-6 bg-[#0a0a0a] border border-[#1c1c1c] rounded-sm">
                    <FileText className="w-6 h-6 text-[#D4AF37] mb-4" />
                    <h3 className="text-white font-semibold mb-2">Bid Bond Requirements</h3>
                    <p className="text-sm text-slate-light leading-relaxed">
                      Tenders exceeding target limits require a verified Bid Security Bond issued by an approved financial institution. Standard bid bonds must represent a minimum of <span className="font-mono text-white tabular-nums">2.00%</span> to <span className="font-mono text-white tabular-nums">5.00%</span> of the total estimated bid value.
                    </p>
                  </div>
                  
                  <div className="p-6 bg-[#0a0a0a] border border-[#1c1c1c] rounded-sm">
                    <AlertTriangle className="w-6 h-6 text-[#D4AF37] mb-4" />
                    <h3 className="text-white font-semibold mb-2">Security Forfeiture</h3>
                    <p className="text-sm text-slate-light leading-relaxed">
                      Bid securities shall be forfeited in full if a bidder: withdraws their bid during the validity period, fails to execute the formal contract upon award, or fails to deliver the required Performance Bond.
                    </p>
                  </div>
                </div>
              </div>

              {/* Section 3: Platform Liabilities */}
              <div id="platform-liabilities" className="scroll-mt-28 space-y-6">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm text-[#D4AF37] font-semibold">[03]</span>
                  <h2 className="text-headline-lg font-display uppercase tracking-wide text-white">Platform Use & Liabilities</h2>
                </div>
                
                <p className="text-body text-slate-light leading-relaxed">
                  The Project AEGIS digital portal and its telemetry APIs are provided as-is to facilitate project orchestration and procurement transparency.
                </p>

                <div className="p-6 bg-[#0a0a0a] border border-[#1c1c1c] rounded-sm space-y-4">
                  <h3 className="text-white font-semibold flex items-center gap-2 text-sm uppercase tracking-wide">
                    <Scale className="w-4 h-4 text-[#D4AF37]" />
                    Limitation of Liability
                  </h3>
                  <p className="text-sm text-slate-light leading-relaxed">
                    Under no circumstances shall SNC, its directors, or its development partners be liable for:
                  </p>
                  <ul className="list-disc pl-6 space-y-2 text-sm text-slate-light font-mono text-[13px]">
                    <li>Any system outages, network latency, or server downtimes causing bid submission delays.</li>
                    <li>Inaccuracies in live telemetry data streams, telemetry dashboards, or GPS trackers.</li>
                    <li>Loss of anticipated profits or business opportunities resulting from tender evaluations.</li>
                    <li>Security breaches originating from user-side credential leakage or key share failures.</li>
                  </ul>
                  <p className="text-sm text-slate-light leading-relaxed">
                    SNC&apos;s aggregate liability for all claims arising from platform use shall not exceed the equivalent of <span className="font-mono text-white">$100.00 USD</span>.
                  </p>
                </div>
              </div>

              {/* Section 4: Indemnification */}
              <div id="indemnification" className="scroll-mt-28 space-y-6">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm text-[#D4AF37] font-semibold">[04]</span>
                  <h2 className="text-headline-lg font-display uppercase tracking-wide text-white">Indemnification Protocols</h2>
                </div>
                
                <p className="text-body text-slate-light leading-relaxed">
                  Contractors and portal users agree to defend, indemnify, and hold harmless SNC, its parent companies, affiliates, and engineering agents from any claims, losses, or expenses resulting from their platform interactions.
                </p>

                <p className="text-body text-slate-light leading-relaxed">
                  This includes, without limitation, liabilities arising from: intellectual property infringements, submission of fraudulent financial guarantees, physical safety violations on construction sites, or breaches of local environmental laws.
                </p>
              </div>

              {/* Section 5: Governing Law & Disputes */}
              <div id="governing-law" className="scroll-mt-28 space-y-6">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm text-[#D4AF37] font-semibold">[05]</span>
                  <h2 className="text-headline-lg font-display uppercase tracking-wide text-white">Governing Law & Disputes</h2>
                </div>
                
                <p className="text-body text-slate-light leading-relaxed">
                  These Terms shall be interpreted, governed, and enforced in accordance with the laws of the Republic of Zimbabwe.
                </p>

                <div className="p-6 bg-[#0a0a0a] border border-[#1c1c1c] rounded-sm space-y-4">
                  <h3 className="text-white font-semibold flex items-center gap-2 text-sm uppercase tracking-wide">
                    <Gavel className="w-4 h-4 text-[#D4AF37]" />
                    Arbitration Framework
                  </h3>
                  
                  <p className="text-sm text-slate-light leading-relaxed">
                    Any dispute, controversy, or claim arising out of these terms, or their interpretation, shall be referred to arbitration in accordance with the <strong>Arbitration Act [Chapter 7:15]</strong> of Zimbabwe.
                  </p>
                  
                  <ul className="list-disc pl-6 space-y-2 text-sm text-slate-light">
                    <li>The arbitration proceedings shall be conducted in Harare, Zimbabwe.</li>
                    <li>The language of arbitration shall be English.</li>
                    <li>The decision of the appointed arbitrator shall be final, binding, and enforceable in any court of competent jurisdiction.</li>
                  </ul>
                </div>
              </div>

            </div>

          </div>
        </div>
      </section>
    </PageWrapper>
  );
}
