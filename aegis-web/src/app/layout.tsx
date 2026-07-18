import type { Metadata } from "next";
import { constructMetadata } from "@/lib/metadata";
import { NavigationWrapper } from "@/components/layout/NavigationWrapper";
import "@/styles/globals.css";
import { cn } from "@/lib/utils";
import { AuthProvider } from "@/lib/auth/AuthContext";

export const dynamic = "force-dynamic";

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
