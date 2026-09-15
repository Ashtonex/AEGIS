import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output:
    process.env.NODE_ENV === "production" && process.env.VERCEL !== "1"
      ? "standalone"
      : undefined,
  typescript: {
    ignoreBuildErrors: process.env.AEGIS_SKIP_NEXT_TYPECHECK === "1",
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
