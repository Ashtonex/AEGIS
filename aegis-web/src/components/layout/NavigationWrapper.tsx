"use client";

import React from 'react';
import { usePathname } from 'next/navigation';
import { ExecutiveNav } from './ExecutiveNav';
import { Footer } from './Footer';

export const NavigationWrapper = ({ children }: { children: React.ReactNode }) => {
  const pathname = usePathname();

  const isDashboardOrLogin = pathname?.startsWith('/dashboard') || pathname === '/login';
  const shouldHideNavAndFooter = isDashboardOrLogin;

  return (
    <>
      {!shouldHideNavAndFooter && <ExecutiveNav />}
      <div className="flex-1">
        {children}
      </div>
      {!shouldHideNavAndFooter && <Footer />}
    </>
  );
};
