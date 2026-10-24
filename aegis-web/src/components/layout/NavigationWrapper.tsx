"use client";

import React from 'react';
import { usePathname } from 'next/navigation';
import { ExecutiveNav } from './ExecutiveNav';
import { Footer } from './Footer';

export const NavigationWrapper = ({ children }: { children: React.ReactNode }) => {
  const pathname = usePathname();

  const isDashboardOrLogin =
    pathname?.startsWith('/dashboard') || pathname?.startsWith('/portal') || pathname === '/login'
    // Embedded in Microsoft Teams (deploy/teams-app) - no site chrome.
    || pathname?.startsWith('/teams');
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
