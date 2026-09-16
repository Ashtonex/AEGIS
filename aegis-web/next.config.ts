import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output:
    process.env.NODE_ENV === "production" && process.env.VERCEL !== "1"
      ? "standalone"
      : undefined,
  typescript: {
    ignoreBuildErrors: process.env.AEGIS_SKIP_NEXT_TYPECHECK === "1",
  },
  // No images config existed before this - next/image was already used in
  // 12 files but every one of them happened to serve local /public assets;
  // this lets any Supabase Storage-hosted image (profile photos, article/
  // project featured images) through next/image's resizing + AVIF/WebP
  // pipeline instead of erroring or silently only working for local paths.
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
  // lucide-react and framer-motion are both barrel exports - without this,
  // importing one icon/component from either can pull the whole package
  // into a route's bundle. Cuts first-load JS on every page that imports
  // from them (nearly all of dashboard/).
  experimental: {
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
