import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output:
    process.env.NODE_ENV === "production" && process.env.VERCEL !== "1"
      ? "standalone"
      : undefined,
  typescript: {
    ignoreBuildErrors: process.env.AEGIS_SKIP_NEXT_TYPECHECK === "1",
  },
  images: {
    // Modern formats first; Next falls back to the original encoding for
    // browsers that don't advertise support.
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      // Supabase Storage public objects (broadcast feed images, drawing
      // thumbnails, avatars) — the project ref comes from
      // NEXT_PUBLIC_SUPABASE_URL at runtime, hence the wildcard subdomain.
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
  experimental: {
    // Barrel-heavy packages: lucide-react is imported in ~147 modules and
    // framer-motion in ~28. Rewriting these to direct per-module imports
    // keeps dev compiles and client bundles from pulling whole barrels.
    optimizePackageImports: ["lucide-react", "framer-motion"],
  },
  async redirects() {
    return [
      {
        source: "/login/client",
        destination: "/login",
        permanent: true,
      },
      {
        source: "/login/employee",
        destination: "/login",
        permanent: true,
      },
      {
        source: "/login/executive",
        destination: "/login",
        permanent: true,
      },
      {
        source: "/login/supplier",
        destination: "/login",
        permanent: true,
      },
      {
        source: "/dashboard/crm/pursuit-teams",
        destination: "/dashboard/crm/teams",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
