import { redirect } from "next/navigation";

const TAB_ROUTES: Record<string, string> = {
  employees: "/dashboard/hr?tab=employees",
  recruitment: "/dashboard/hr?tab=recruitment",
  documents: "/dashboard/hr?tab=documents",
  credentials: "/dashboard/hr?tab=credentials",
  performance: "/dashboard/hr?tab=performance",
  assets: "/dashboard/hr?tab=assets",
  training: "/dashboard/hr?tab=training",
  "org-chart": "/dashboard/hr?tab=org-chart",
  planning: "/dashboard/hr?tab=planning",
  attendance: "/dashboard/hr?tab=attendance",
  leave: "/dashboard/hr?tab=leave",
  payroll: "/dashboard/hr?tab=payroll",
  "vendor-verification": "/dashboard/hr?tab=vendor-verification",
};

export default async function HRTabPage({
  params,
}: {
  params: Promise<{ tab: string }>;
}) {
  const { tab } = await params;
  redirect(TAB_ROUTES[tab] ?? "/dashboard/hr?tab=employees");
}
