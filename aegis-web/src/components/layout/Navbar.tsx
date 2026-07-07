"use client";

import { useState, useEffect } from 'react';
import Link from 'next/link';

export default function Navbar() {
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 50);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <nav className={`fixed w-full z-50 transition-all duration-300 ${isScrolled ? 'bg-snc-navy/95 backdrop-blur-sm py-4 shadow-lg' : 'bg-transparent py-6'}`}>
      <div className="max-w-7xl mx-auto px-6 md:px-12 flex items-center justify-between">
        <Link href="/" className="flex flex-col">
          <span className="text-2xl font-black tracking-tight text-white uppercase leading-none">Six Nine</span>
          <span className="text-xs font-semibold tracking-[0.2em] text-snc-amber uppercase">Constructions</span>
        </Link>
        
        <div className="hidden md:flex items-center space-x-8">
          <Link href="#about" className="text-sm font-medium text-white/80 hover:text-white transition-colors">About</Link>
          <Link href="#services" className="text-sm font-medium text-white/80 hover:text-white transition-colors">Services</Link>
          <Link href="#projects" className="text-sm font-medium text-white/80 hover:text-white transition-colors">Projects</Link>
          <Link href="#contact" className="text-sm font-medium text-white/80 hover:text-white transition-colors">Contact</Link>
          <Link href="/login" className="px-5 py-2.5 bg-snc-amber hover:bg-yellow-600 text-snc-navy font-bold text-sm tracking-wide transition-all shadow-md">
            CLIENT PORTAL
          </Link>
        </div>
      </div>
    </nav>
  );
}
