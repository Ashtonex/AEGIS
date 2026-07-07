import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { SITE_CONFIG } from "@/lib/constants";
import { constructMetadata } from "@/lib/metadata";
import { NavigationWrapper } from "@/components/layout/NavigationWrapper";
import "@/styles/globals.css";
import { cn } from "@/lib/utils";
import { AuthProvider } from "@/lib/auth/AuthContext";

const inter = Inter({ 
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

const interDisplay = Inter({ 
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = constructMetadata();

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="scroll-smooth">
      <head>
        <meta name="theme-color" content="#040810" />
      </head>
      <body className={cn(
        inter.variable,
        interDisplay.variable,
        jetbrainsMono.variable,
        "selection:bg-snc-gold-primary selection:text-snc-void"
      )}>
        <AuthProvider>
          <NavigationWrapper>
            {children}
          </NavigationWrapper>
        </AuthProvider>
      </body>
    </html>
  );
}
