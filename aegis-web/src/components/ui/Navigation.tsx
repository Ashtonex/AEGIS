import Link from 'next/link';

export function Navigation() {
  return (
    <nav className="flex items-center justify-between p-6 bg-brand-navy border-b border-brand-offwhite/10 text-brand-offwhite sticky top-0 z-50 backdrop-blur-md bg-opacity-90">
      <div className="flex items-center space-x-4">
        <Link href="/" className="text-2xl font-black tracking-tighter">
          SIX NINE <span className="text-brand-gold">CONSTRUCTIONS</span>
        </Link>
      </div>
      
      <div className="hidden md:flex space-x-8 text-sm font-medium">
        <Link href="/about" className="hover:text-brand-gold transition-colors">About</Link>
        <Link href="/services" className="hover:text-brand-gold transition-colors">Services</Link>
        <Link href="/projects" className="hover:text-brand-gold transition-colors">Projects</Link>
        <Link href="/contact" className="hover:text-brand-gold transition-colors">Contact</Link>
      </div>
      
      <div className="flex space-x-4">
        <Link href="/dashboard" className="px-4 py-2 bg-brand-gold text-brand-navy font-bold rounded-sm hover:bg-yellow-500 transition-all text-sm">
          Portal Login
        </Link>
      </div>
    </nav>
  );
}
