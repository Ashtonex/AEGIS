import { Suspense } from "react";
import type { Metadata } from "next";
import { constructMetadata } from "@/lib/metadata";
import { NavigationWrapper } from "@/components/layout/NavigationWrapper";
import { PwaRegistration } from "@/components/PwaRegistration";
import { PwaRuntime } from "@/components/pwa/PwaRuntime";
import { Inter, Archivo, JetBrains_Mono } from "next/font/google";
import "@/styles/globals.css";
import { cn } from "@/lib/utils";
import { AuthProvider } from "@/lib/auth/AuthContext";
import { AppThemeProvider } from "@/components/theme/AppThemeProvider";

// Fonts are loaded through next/font instead of the eight render-blocking
// @fontsource stylesheets this file used to import. next/font self-hosts the
// files, inlines the @font-face rules and preloads them, so there is no
// blocking CSS request and no FOUT/FOIT. Each family exposes a CSS variable
// that src/styles/globals.css feeds into the existing --font-* tokens, so
// tailwind.config.ts (font-sans / font-display / font-mono) is unchanged.
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
  // Variable font: covers the 400/500/700/900 weights the old imports pinned.
  weight: "variable",
});

const archivo = Archivo({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-archivo",
  // Covers the 700/900 weights the old imports pinned.
  weight: "variable",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-jetbrains",
  // Covers the 500/600 weights the old imports pinned.
  weight: "variable",
});

export const metadata: Metadata = constructMetadata();

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={cn(
        "scroll-smooth",
        inter.variable,
        archivo.variable,
        jetbrainsMono.variable
      )}
      data-theme="ink"
      suppressHydrationWarning
    >
      <head>
        <meta name="theme-color" content="#040810" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="icon" href="/logo.png" />
        <link rel="apple-touch-icon" href="/logo.png" />
      </head>
      <body className={cn(
        "selection:bg-signal selection:text-void"
      )}>
        <AuthProvider>
          <AppThemeProvider>
            <PwaRegistration />
            <PwaRuntime />
            <NavigationWrapper>
              {/* Root-level CSR bailout boundary. With `dynamic =
                  "force-dynamic"` removed from this layout, statically
                  prerendered routes that call useSearchParams() (e.g. the PWA
                  /offline fallback) need a Suspense boundary above them or the
                  export fails. Routes that don't bail out are unaffected. */}
              <Suspense fallback={null}>
                {children}
              </Suspense>
            </NavigationWrapper>
          </AppThemeProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
