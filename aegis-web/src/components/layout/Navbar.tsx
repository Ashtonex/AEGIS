"use client";

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Menu, X } from 'lucide-react';

export default function Navbar() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 50);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    if (typeof document !== "undefined") {
      if (mobileMenuOpen) {
        document.body.style.overflow = "hidden";
      } else {
        document.body.style.overflow = "";
      }
    }
    return () => {
      if (typeof document !== "undefined") {
        document.body.style.overflow = "";
      }
    };
  }, [mobileMenuOpen]);

  return (
    <nav className={`fixed w-full z-50 transition-all duration-300 ${isScrolled || mobileMenuOpen ? 'bg-ink/95 backdrop-blur-sm py-4 shadow-lg' : 'bg-transparent py-6'}`}>
      <div className="max-w-7xl mx-auto px-6 md:px-12 flex items-center justify-between">

        <Link href="/" className="flex flex-col" onClick={() => setMobileMenuOpen(false)}>
          <span className="text-2xl font-black tracking-tight text-white uppercase leading-none">Six Nine</span>
          <span className="text-xs font-semibold tracking-[0.2em] text-signal uppercase">Constructions</span>
        </Link>

        {/* Desktop Navigation */}
        <div className="hidden md:flex items-center space-x-8">
          <Link href="#about" className="text-sm font-medium text-white/80 hover:text-white transition-colors">About</Link>
          <Link href="#services" className="text-sm font-medium text-white/80 hover:text-white transition-colors">Services</Link>
          <Link href="#projects" className="text-sm font-medium text-white/80 hover:text-white transition-colors">Projects</Link>
          <Link href="#contact" className="text-sm font-medium text-white/80 hover:text-white transition-colors">Contact</Link>
          <Link href="/login" className="px-5 py-2.5 bg-signal hover:bg-signal-hover text-ink font-bold text-sm tracking-wide transition-all shadow-md">
            CLIENT PORTAL
          </Link>
        </div>

        {/* Mobile Hamburger Toggle */}
        <div className="md:hidden flex items-center">
          <button
            type="button"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            className="p-2 text-white/80 hover:text-white focus:outline-none"
            aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileMenuOpen}
          >
            {mobileMenuOpen ? <X className="w-6 h-6 text-signal" /> : <Menu className="w-6 h-6 text-white" />}
          </button>
        </div>
      </div>

      {/* Mobile Drawer Menu */}
      {mobileMenuOpen && (
        <div className="md:hidden bg-ink/98 border-b border-ink-mid px-6 py-6 space-y-4 shadow-2xl backdrop-blur-md animate-in fade-in slide-in-from-top-4 duration-200">
          <div className="flex flex-col space-y-3">
            <Link
              href="#about"
              onClick={() => setMobileMenuOpen(false)}
              className="text-base font-medium text-white/90 hover:text-signal py-1.5 transition-colors border-b border-ink-mid/40"
            >
              About
            </Link>
            <Link
              href="#services"
              onClick={() => setMobileMenuOpen(false)}
              className="text-base font-medium text-white/90 hover:text-signal py-1.5 transition-colors border-b border-ink-mid/40"
            >
              Services
            </Link>
            <Link
              href="#projects"
              onClick={() => setMobileMenuOpen(false)}
              className="text-base font-medium text-white/90 hover:text-signal py-1.5 transition-colors border-b border-ink-mid/40"
            >
              Projects
            </Link>
            <Link
              href="#contact"
              onClick={() => setMobileMenuOpen(false)}
              className="text-base font-medium text-white/90 hover:text-signal py-1.5 transition-colors border-b border-ink-mid/40"
            >
              Contact
            </Link>
          </div>
          <div className="pt-2">
            <Link
              href="/login"
              onClick={() => setMobileMenuOpen(false)}
              className="block w-full text-center py-3 bg-signal hover:bg-signal-hover text-ink font-bold text-sm tracking-wide transition-all shadow-md rounded-xs"
            >
              CLIENT PORTAL &amp; SECURE LOGIN
            </Link>
          </div>
        </div>
      )}
    </nav>
  );
}
