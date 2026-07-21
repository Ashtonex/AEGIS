import type { Metadata } from "next";
import { constructMetadata } from "@/lib/metadata";
import { NavigationWrapper } from "@/components/layout/NavigationWrapper";
import { PwaRegistration } from "@/components/PwaRegistration";
import { PwaRuntime } from "@/components/pwa/PwaRuntime";
import "@/styles/globals.css";
import { cn } from "@/lib/utils";
import { AuthProvider } from "@/lib/auth/AuthContext";
import { AppThemeProvider } from "@/components/theme/AppThemeProvider";

export const dynamic = "force-dynamic";

export const metadata: Metadata = constructMetadata();

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="scroll-smooth" data-theme="ink" suppressHydrationWarning>
      <head>
        <meta name="theme-color" content="#040810" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="icon" href="/logo.png" />
        <link rel="apple-touch-icon" href="/logo.png" />
      </head>
      <body className={cn(
        "selection:bg-snc-gold-primary selection:text-snc-void"
      )}>
        <AuthProvider>
          <AppThemeProvider>
            <PwaRegistration />
            <PwaRuntime />
            <NavigationWrapper>
              {children}
            </NavigationWrapper>
          </AppThemeProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
