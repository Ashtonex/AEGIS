import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { SITE_CONFIG } from "@/lib/constants";

const FOOTER_SECTIONS = [
  {
    title: "Company",
    items: [
      { label: "About Us", href: "/about" },
      { label: "Leadership", href: "/about/leadership" },
      { label: "Certifications", href: "/about#certifications" },
      { label: "ESG & Sustainability", href: "/about#esg" },
    ],
  },
  {
    title: "Work",
    items: [
      { label: "Capabilities", href: "/capabilities" },
      { label: "Industries", href: "/industries" },
      { label: "Projects", href: "/projects" },
      { label: "Knowledge", href: "/knowledge" },
    ],
  },
  {
    title: "Connect",
    items: [
      { label: "Tenders", href: "/tenders" },
      { label: "Suppliers", href: "/suppliers" },
      { label: "Careers", href: "/careers" },
      { label: "Contact", href: "/contact" },
    ],
  },
  {
    title: "Portals",
    items: [
      { label: "Client Portal", href: "/login" },
      { label: "Supplier Portal", href: "/login" },
      { label: "Employee Login", href: "/login" },
      { label: "Privacy", href: "/privacy" },
    ],
  },
] as const;

const socialLinks = [
  { label: "LinkedIn", href: SITE_CONFIG.social.linkedin, short: "LI" },
  { label: "X", href: SITE_CONFIG.social.x, short: "X" },
  { label: "YouTube", href: SITE_CONFIG.social.youtube, short: "YT" },
] as const;

export function Footer() {
  return (
    <footer className="bg-ink border-t border-ink-mid text-paper">
      <div className="max-w-[1440px] mx-auto px-6 md:px-10 lg:px-16 xl:px-20 py-16 md:py-20">
        <div className="grid gap-14 lg:grid-cols-[1.35fr_0.65fr_0.65fr_0.65fr_0.65fr]">
          <div className="max-w-md">
            <Link href="/" className="inline-flex flex-col">
              <span className="font-black text-[30px] leading-none tracking-[-0.02em] text-signal">
                SNC
              </span>
              <span className="mt-1 font-mono text-[10px] tracking-[0.18em] uppercase text-slate-light">
                Six Nine Construction
              </span>
            </Link>

            <p className="mt-6 max-w-sm text-[15px] leading-[1.7] text-slate-light">
              {SITE_CONFIG.tagline} Civil engineering, structural construction,
              and plant logistics delivered with the same operational discipline
              on every site.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/projects"
                className="inline-flex items-center gap-2 border border-paper/15 px-4 py-2 text-[11px] font-semibold tracking-[0.12em] uppercase text-paper transition-colors duration-fast hover:border-signal hover:text-signal"
              >
                View projects
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
              <Link
                href="/tenders"
                className="inline-flex items-center gap-2 bg-signal px-4 py-2 text-[11px] font-bold tracking-[0.12em] uppercase text-ink transition-colors duration-fast hover:bg-[#E8B422]"
              >
                Open tenders
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </div>

            <div className="mt-8 flex flex-wrap gap-3">
              {socialLinks.map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-10 w-10 items-center justify-center border border-paper/15 text-[10px] font-bold tracking-[0.14em] uppercase text-slate-light transition-colors duration-fast hover:border-signal hover:text-signal"
                  aria-label={link.label}
                >
                  {link.short}
                </a>
              ))}
            </div>
          </div>

          {FOOTER_SECTIONS.map((section) => (
            <div key={section.title}>
              <h4 className="dxl-eyebrow mb-5">{section.title}</h4>
              <ul className="space-y-3 text-[14px] leading-[1.6] text-slate-light">
                {section.items.map((item) => (
                  <li key={item.label}>
                    <Link
                      href={item.href}
                      className="transition-colors duration-fast hover:text-paper"
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-14 border-t border-ink-mid pt-8 flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="text-[11px] tracking-[0.12em] uppercase text-slate-light">
            © {new Date().getFullYear()} Six Nine Construction (Pvt) Ltd.
          </div>
          <div className="flex flex-wrap gap-4 text-[11px] tracking-[0.12em] uppercase text-slate-light">
            <span>PRAZ</span>
            <span>CIFOZ</span>
            <span>ZBCA</span>
            <span>ZIDA</span>
          </div>
          <div className="flex flex-wrap gap-5 text-[11px] tracking-[0.12em] uppercase text-slate-light">
            <Link href="/privacy" className="transition-colors duration-fast hover:text-paper">
              Privacy
            </Link>
            <Link href="/terms" className="transition-colors duration-fast hover:text-paper">
              Terms
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
