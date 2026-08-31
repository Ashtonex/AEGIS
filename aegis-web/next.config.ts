import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: process.env.NODE_ENV === "production" ? "standalone" : undefined,
  typescript: {
    ignoreBuildErrors: process.env.AEGIS_SKIP_NEXT_TYPECHECK === "1",
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
