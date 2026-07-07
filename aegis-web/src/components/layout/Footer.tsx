import Link from "next/link";
import { SITE_CONFIG } from "@/lib/constants";

export function Footer() {
  return (
    <footer className="bg-[var(--snc-navy)] border-t border-[var(--snc-navy-mid)] pt-20 pb-8 text-sm">
      <div className="container">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-12 mb-16">
          
          <div className="lg:col-span-1">
            <Link href="/" className="flex flex-col mb-6">
              <span className="font-display text-[28px] text-[var(--snc-red)] leading-none tracking-wide">
                SNC
              </span>
              <span className="font-sans font-medium text-[10px] text-white tracking-widest leading-none mt-1">
                SIX NINE CONSTRUCTIONS
              </span>
            </Link>
            <p className="text-[var(--snc-mist)] mb-6 max-w-sm leading-relaxed">
              {SITE_CONFIG.tagline}
            </p>
            <div className="flex gap-4">
              <a href={SITE_CONFIG.social.linkedin} target="_blank" rel="noreferrer" className="text-[var(--snc-mist)] hover:text-white transition-colors">LI</a>
              <a href={SITE_CONFIG.social.x} target="_blank" rel="noreferrer" className="text-[var(--snc-mist)] hover:text-white transition-colors">X</a>
              <a href={SITE_CONFIG.social.youtube} target="_blank" rel="noreferrer" className="text-[var(--snc-mist)] hover:text-white transition-colors">YT</a>
            </div>
          </div>

          <div>
            <h4 className="text-white font-semibold mb-6">Company</h4>
            <ul className="space-y-4 text-[var(--snc-mist)]">
              <li><Link href="/about" className="hover:text-white transition-colors">About Us</Link></li>
              <li><Link href="/about/leadership" className="hover:text-white transition-colors">Leadership</Link></li>
              <li><Link href="/about#certifications" className="hover:text-white transition-colors">Certifications</Link></li>
              <li><Link href="/about#esg" className="hover:text-white transition-colors">ESG & Sustainability</Link></li>
              <li><Link href="/about#awards" className="hover:text-white transition-colors">Awards</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="text-white font-semibold mb-6">Work</h4>
            <ul className="space-y-4 text-[var(--snc-mist)]">
              <li><Link href="/capabilities" className="hover:text-white transition-colors">Capabilities</Link></li>
              <li><Link href="/industries/mining" className="hover:text-white transition-colors">Industries</Link></li>
              <li><Link href="/projects" className="hover:text-white transition-colors">Projects</Link></li>
              <li><Link href="/capabilities/heavy-plant" className="hover:text-white transition-colors">Plant & Equipment</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="text-white font-semibold mb-6">Connect</h4>
            <ul className="space-y-4 text-[var(--snc-mist)]">
              <li><Link href="/tenders" className="hover:text-white transition-colors">Tenders</Link></li>
              <li><Link href="/suppliers" className="hover:text-white transition-colors">Suppliers</Link></li>
              <li><Link href="/careers" className="hover:text-white transition-colors">Careers</Link></li>
              <li><Link href="/news" className="hover:text-white transition-colors">News</Link></li>
              <li><Link href="/knowledge" className="hover:text-white transition-colors">Knowledge</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="text-white font-semibold mb-6">Portals</h4>
            <ul className="space-y-4 text-[var(--snc-mist)]">
              <li><Link href="/platform" className="hover:text-[var(--snc-red)] transition-colors">Client Portal</Link></li>
              <li><Link href="/suppliers" className="hover:text-[var(--snc-red)] transition-colors">Supplier Portal</Link></li>
              <li><Link href="/platform" className="hover:text-[var(--snc-red)] transition-colors">Employee Login</Link></li>
            </ul>
          </div>

        </div>

        <div className="border-t border-[var(--snc-navy-mid)] pt-8 flex flex-col lg:flex-row justify-between items-center gap-4 text-[var(--snc-mist)] text-xs">
          <div>
            © {new Date().getFullYear()} Six Nine Constructions (Pvt) Ltd. All rights reserved.
          </div>
          <div className="flex gap-4 font-semibold tracking-wider opacity-50">
            <span>PRAZ</span>
            <span>CIFOZ</span>
            <span>ZBCA</span>
            <span>ZIDA</span>
          </div>
          <div className="flex gap-4">
            <Link href="/privacy" className="hover:text-white transition-colors">Privacy Policy</Link>
            <Link href="/terms" className="hover:text-white transition-colors">Terms</Link>
          </div>
        </div>
        
        <div className="mt-8 text-center">
          <span className="text-[10px] text-[var(--snc-slate)]/50 tracking-widest uppercase">
            Platform Architecture by <a href="#" className="hover:text-white transition-colors">Flectēre</a>
          </span>
        </div>
      </div>
    </footer>
  );
}
