import { constructMetadata } from "@/lib/metadata";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { PageHero } from "@/components/ui/PageHero";
import { Shield, Lock, Activity, FileCheck, CheckCircle } from "lucide-react";

export const metadata = constructMetadata({
  title: "Privacy Policy | Six Nine Construction",
  description: "Institutional protocols for data protection, security controls, and compliance audits under Project AEGIS.",
});

export default function PrivacyPolicyPage() {
  return (
    <PageWrapper>
      <PageHero
        title="Security & Data Sovereignty"
        subtitle="Institutional protocols for data protection, security controls, and telemetry auditing under Project AEGIS."
        breadcrumbs={[
          { label: "Home", href: "/" },
          { label: "Compliance", href: "/privacy" },
          { label: "Privacy Policy" }
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
                  <div className="text-[10px] font-mono text-[#D4AF37] uppercase tracking-widest mb-2">Security Architecture</div>
                  <h3 className="font-display text-lg font-bold text-white uppercase tracking-wide">Document Metadata</h3>
                  
                  <div className="mt-4 space-y-3 font-mono text-xs text-slate-light animate-pulse-signal">
                    <div className="flex justify-between">
                      <span>DOCUMENT ID:</span>
                      <span className="text-white font-semibold">SNC-POL-2026-V2</span>
                    </div>
                    <div className="flex justify-between">
                      <span>CLASSIFICATION:</span>
                      <span className="text-white font-semibold">RESTRICTED</span>
                    </div>
                    <div className="flex justify-between">
                      <span>EFFECTIVE DATE:</span>
                      <span className="text-white font-semibold tabular-nums">2026-07-13</span>
                    </div>
                    <div className="flex justify-between">
                      <span>COMPLIANCE:</span>
                      <span className="text-[#3B82F6] font-semibold">SOC 2 TYPE II</span>
                    </div>
                  </div>
                </div>

                <nav className="space-y-4">
                  <div className="text-[10px] font-mono text-slate-light uppercase tracking-widest mb-3">Policy Index</div>
                  
                  <a href="#data-security" className="group flex items-center gap-3 py-1 text-sm text-slate-light hover:text-white transition-colors">
                    <span className="font-mono text-xs text-[#D4AF37] group-hover:underline">[01]</span>
                    <span>Data Security & Isolation</span>
                  </a>
                  
                  <a href="#compliance-audits" className="group flex items-center gap-3 py-1 text-sm text-slate-light hover:text-white transition-colors">
                    <span className="font-mono text-xs text-[#D4AF37] group-hover:underline">[02]</span>
                    <span>Compliance & Security Audits</span>
                  </a>
                  
                  <a href="#platform-telemetry" className="group flex items-center gap-3 py-1 text-sm text-slate-light hover:text-white transition-colors">
                    <span className="font-mono text-xs text-[#D4AF37] group-hover:underline">[03]</span>
                    <span>Platform Telemetry & Logging</span>
                  </a>
                  
                  <a href="#user-rights" className="group flex items-center gap-3 py-1 text-sm text-slate-light hover:text-white transition-colors">
                    <span className="font-mono text-xs text-[#D4AF37] group-hover:underline">[04]</span>
                    <span>Stakeholder & User Rights</span>
                  </a>
                  
                  <a href="#regulatory" className="group flex items-center gap-3 py-1 text-sm text-slate-light hover:text-white transition-colors">
                    <span className="font-mono text-xs text-[#D4AF37] group-hover:underline">[05]</span>
                    <span>Regulatory Frameworks</span>
                  </a>
                </nav>

                <div className="mt-8 pt-6 border-t border-[#1c1c1c] text-xs text-slate-light leading-relaxed">
                  For inquiries concerning data protection, sovereign cryptography, or audit trail verification, contact our Data Security Officer at{" "}
                  <a href="mailto:dso@sixnine.co.zw" className="text-white hover:text-[#D4AF37] underline transition-colors">
                    dso@sixnine.co.zw
                  </a>.
                </div>
              </div>
            </div>

            {/* Right Main Content */}
            <div className="lg:col-span-8 space-y-16">
              
              {/* Introduction Card */}
              <div className="p-8 bg-[#0a0a0a] border border-[#1c1c1c] border-l-2 border-l-[#D4AF37] rounded-sm">
                <h2 className="text-headline-md font-display text-white uppercase tracking-wider mb-4">Institutional Trust Statement</h2>
                <p className="text-body text-slate-light leading-relaxed mb-4">
                  Six Nine Construction operates under the highest parameters of execution precision, extending not only to physical concrete and steel but to digital architectures. As operators of <strong>Project AEGIS</strong>, our proprietary infrastructure command center, we treat client, supplier, and contractor data as highly sensitive, critical industrial assets.
                </p>
                <p className="text-body text-slate-light leading-relaxed">
                  This policy outlines our programmatic and organizational commitments to data security, telemetry sovereignty, and strict compliance with national and regional data protection frameworks.
                </p>
              </div>

              {/* Section 1: Data Security */}
              <div id="data-security" className="scroll-mt-28 space-y-6">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm text-[#D4AF37] font-semibold">[01]</span>
                  <h2 className="text-headline-lg font-display uppercase tracking-wide text-white">Data Security & Cryptographic Isolation</h2>
                </div>
                
                <p className="text-body text-slate-light leading-relaxed">
                  SNC implements enterprise-grade physical and cryptographic controls to secure operational records, contractor documents, and structural telemetry from unauthorized intrusion.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
                  <div className="p-6 bg-[#0a0a0a] border border-[#1c1c1c] rounded-sm">
                    <Lock className="w-6 h-6 text-[#D4AF37] mb-4" />
                    <h3 className="text-white font-semibold mb-2">Encryption Standards</h3>
                    <p className="text-sm text-slate-light leading-relaxed">
                      All data in transit is encrypted using transport layer security (TLS 1.3). Data at rest within our servers and database clusters is encrypted using AES-256 with key rotation cycles managed via HSMs.
                    </p>
                  </div>
                  
                  <div className="p-6 bg-[#0a0a0a] border border-[#1c1c1c] rounded-sm">
                    <Shield className="w-6 h-6 text-[#D4AF37] mb-4" />
                    <h3 className="text-white font-semibold mb-2">Zero-Trust Network Architecture</h3>
                    <p className="text-sm text-slate-light leading-relaxed">
                      Project AEGIS operates on isolated VPC networks, protecting client tender databases and financial records behind adaptive multi-factor authentication (MFA) and strict role-based access control (RBAC).
                    </p>
                  </div>
                </div>
              </div>

              {/* Section 2: Compliance & Audits */}
              <div id="compliance-audits" className="scroll-mt-28 space-y-6">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm text-[#D4AF37] font-semibold">[02]</span>
                  <h2 className="text-headline-lg font-display uppercase tracking-wide text-white">Compliance & Security Audits</h2>
                </div>
                
                <p className="text-body text-slate-light leading-relaxed">
                  We validate our technical controls through routine, independent third-party audits and rigorous testing parameters. Our platforms are designed to align with international safety and security frameworks.
                </p>

                <div className="p-6 bg-[#0a0a0a] border border-[#1c1c1c] rounded-sm">
                  <h3 className="text-white font-semibold mb-4 uppercase tracking-wider text-sm border-b border-[#1c1c1c] pb-3">Audit Protocols & Verification</h3>
                  <div className="space-y-4">
                    <div className="flex items-start gap-4">
                      <div className="p-1 bg-[#111111] border border-[#1c1c1c] text-[#D4AF37] rounded-sm mt-1">
                        <CheckCircle className="w-4 h-4" />
                      </div>
                      <div>
                        <h4 className="text-white text-sm font-semibold">SOC 2 Type II Compliance</h4>
                        <p className="text-xs text-slate-light mt-1">SNC undergoes annual independent audits covering security, availability, and processing integrity of the Project AEGIS system.</p>
                      </div>
                    </div>

                    <div className="flex items-start gap-4">
                      <div className="p-1 bg-[#111111] border border-[#1c1c1c] text-[#D4AF37] rounded-sm mt-1">
                        <CheckCircle className="w-4 h-4" />
                      </div>
                      <div>
                        <h4 className="text-white text-sm font-semibold">Penetration Testing</h4>
                        <p className="text-xs text-slate-light mt-1">Semi-annual white-box and black-box penetration assessments are conducted by CREST-accredited security engineers.</p>
                      </div>
                    </div>

                    <div className="flex items-start gap-4">
                      <div className="p-1 bg-[#111111] border border-[#1c1c1c] text-[#D4AF37] rounded-sm mt-1">
                        <CheckCircle className="w-4 h-4" />
                      </div>
                      <div>
                        <h4 className="text-white text-sm font-semibold">ISO 27001 Alignment</h4>
                        <p className="text-xs text-slate-light mt-1">Our Information Security Management System (ISMS) operates in strict conformity with the ISO/IEC 27001:2022 international standard.</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Section 3: Platform Telemetry */}
              <div id="platform-telemetry" className="scroll-mt-28 space-y-6">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm text-[#D4AF37] font-semibold">[03]</span>
                  <h2 className="text-headline-lg font-display uppercase tracking-wide text-white">Platform Telemetry & Logging</h2>
                </div>
                
                <p className="text-body text-slate-light leading-relaxed">
                  Project AEGIS tracks real-time platform actions to compile permanent audit trails, ensure operational accountability, and prevent fraudulent procurement actions.
                </p>

                <div className="p-6 bg-[#0a0a0a] border border-[#1c1c1c] rounded-sm space-y-4">
                  <div className="flex items-center gap-2 text-xs font-mono text-[#3B82F6] bg-[#3B82F6]/5 border border-[#3B82F6]/20 px-3 py-1.5 rounded-sm w-fit uppercase">
                    <Activity className="w-3.5 h-3.5 animate-pulse" />
                    <span>Active Telemetry Streams</span>
                  </div>

                  <p className="text-sm text-slate-light">
                    The following log structures are generated continuously and retained for a minimum of <span className="font-mono tabular-nums text-white">7 years</span> in compliance with corporate engineering regulations:
                  </p>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left font-mono text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-[#1c1c1c] text-slate-light">
                          <th className="py-2 pr-4 font-medium">TELEMETRY TYPE</th>
                          <th className="py-2 px-4 font-medium">DATA POINT EXAMPLES</th>
                          <th className="py-2 pl-4 font-medium text-right">ENCRYPTION STATUS</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#1c1c1c] text-white">
                        <tr>
                          <td className="py-3 pr-4 text-[#D4AF37]">ACCESS LOGS</td>
                          <td className="py-3 px-4 text-slate-light">IP Address, MFA Challenge Timestamps, User Agent</td>
                          <td className="py-3 pl-4 text-right tabular-nums text-emerald-500">AES-256-ROTATED</td>
                        </tr>
                        <tr>
                          <td className="py-3 pr-4 text-[#D4AF37]">TENDER AUDITS</td>
                          <td className="py-3 px-4 text-slate-light">Bid-bond verification hashes, timestamped proposal submissions</td>
                          <td className="py-3 pl-4 text-right tabular-nums text-emerald-500">SHA-256 INTEGRITY</td>
                        </tr>
                        <tr>
                          <td className="py-3 pr-4 text-[#D4AF37]">SYSTEM TELEMETRY</td>
                          <td className="py-3 px-4 text-slate-light">API latency parameters, query payloads, database state checks</td>
                          <td className="py-3 pl-4 text-right tabular-nums text-slate-500">ANONYMIZED</td>
                        </tr>
                        <tr>
                          <td className="py-3 pr-4 text-[#D4AF37]">OPERATIONAL LOGS</td>
                          <td className="py-3 px-4 text-slate-light">Contractor check-ins, plant dispatch coordination requests</td>
                          <td className="py-3 pl-4 text-right tabular-nums text-emerald-500">AES-256</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* Section 4: User Rights */}
              <div id="user-rights" className="scroll-mt-28 space-y-6">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm text-[#D4AF37] font-semibold">[04]</span>
                  <h2 className="text-headline-lg font-display uppercase tracking-wide text-white">Stakeholder & User Rights</h2>
                </div>
                
                <p className="text-body text-slate-light leading-relaxed">
                  We guarantee transparency and control to all registered portal users, commercial partners, and contractors. You have direct control over your digital footprint on the AEGIS platform.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="p-5 bg-[#0a0a0a] border border-[#1c1c1c] rounded-sm text-center">
                    <span className="block font-mono text-2xl text-[#D4AF37] font-bold mb-2">01.</span>
                    <h4 className="text-white text-sm font-semibold mb-2">Right to Inspect</h4>
                    <p className="text-xs text-slate-light leading-relaxed">Request full structural transcripts of all corporate records and personal telemetry stored on our systems.</p>
                  </div>
                  <div className="p-5 bg-[#0a0a0a] border border-[#1c1c1c] rounded-sm text-center">
                    <span className="block font-mono text-2xl text-[#D4AF37] font-bold mb-2">02.</span>
                    <h4 className="text-white text-sm font-semibold mb-2">Right to Restrict</h4>
                    <p className="text-xs text-slate-light leading-relaxed">Disable optional system telemetry tracking and pipeline automations tied to your contractor profile.</p>
                  </div>
                  <div className="p-5 bg-[#0a0a0a] border border-[#1c1c1c] rounded-sm text-center">
                    <span className="block font-mono text-2xl text-[#D4AF37] font-bold mb-2">03.</span>
                    <h4 className="text-white text-sm font-semibold mb-2">Right to Purge</h4>
                    <p className="text-xs text-slate-light leading-relaxed">Initiate formal requests to delete profile records, subject to regulatory tax and engineering archival laws.</p>
                  </div>
                </div>
              </div>

              {/* Section 5: Regulatory Frameworks */}
              <div id="regulatory" className="scroll-mt-28 space-y-6">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm text-[#D4AF37] font-semibold">[05]</span>
                  <h2 className="text-headline-lg font-display uppercase tracking-wide text-white">Regulatory Alignments</h2>
                </div>
                
                <p className="text-body text-slate-light leading-relaxed">
                  SNC operates globally, adapting its compliance postures to satisfy regional data protection statutes:
                </p>

                <ul className="space-y-4">
                  <li className="flex gap-4 p-4 bg-[#0a0a0a] border border-[#1c1c1c] rounded-sm">
                    <FileCheck className="w-5 h-5 text-[#D4AF37] shrink-0" />
                    <div>
                      <h4 className="text-white text-sm font-semibold">Zimbabwe Cyber Security & Data Protection Act [Chapter 12:07]</h4>
                      <p className="text-xs text-slate-light mt-1">Full compliance with the statutory rules regulating data controllers, trans-border data streams, and systemic disclosure events.</p>
                    </div>
                  </li>
                  
                  <li className="flex gap-4 p-4 bg-[#0a0a0a] border border-[#1c1c1c] rounded-sm">
                    <FileCheck className="w-5 h-5 text-[#D4AF37] shrink-0" />
                    <div>
                      <h4 className="text-white text-sm font-semibold">SADC Model Law on Data Protection</h4>
                      <p className="text-xs text-slate-light mt-1">Ensuring aligned cross-border data transfer security parameters for projects spanning Zambia, Mozambique, and South Africa.</p>
                    </div>
                  </li>

                  <li className="flex gap-4 p-4 bg-[#0a0a0a] border border-[#1c1c1c] rounded-sm">
                    <FileCheck className="w-5 h-5 text-[#D4AF37] shrink-0" />
                    <div>
                      <h4 className="text-white text-sm font-semibold">EU General Data Protection Regulation (GDPR)</h4>
                      <p className="text-xs text-slate-light mt-1">Adhering to strict European security controls for international capital sponsors and joint-venture partners operating in the region.</p>
                    </div>
                  </li>
                </ul>
              </div>

            </div>

          </div>
        </div>
      </section>
    </PageWrapper>
  );
}
