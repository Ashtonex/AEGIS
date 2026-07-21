import { redirect } from "next/navigation";

const TAB_ROUTES: Record<string, string> = {
  projects: "/dashboard/analytics?tab=projects",
  equipment: "/dashboard/analytics?tab=equipment",
  procurement: "/dashboard/analytics?tab=procurement",
  workforce: "/dashboard/analytics?tab=workforce",
};

export default async function AnalyticsTabPage({
  params,
}: {
  params: Promise<{ tab: string }>;
}) {
  const { tab } = await params;
  redirect(TAB_ROUTES[tab] ?? "/dashboard/analytics?tab=projects");
}
