import { redirect } from "next/navigation";

const TAB_ROUTES: Record<string, string> = {
  configuration: "/dashboard/settings?tab=configuration",
  access: "/dashboard/settings?tab=access",
  accounts: "/dashboard/settings?tab=accounts",
  website: "/dashboard/settings?tab=website",
  audit: "/dashboard/settings?tab=audit",
};

export default async function SettingsTabPage({
  params,
}: {
  params: Promise<{ tab: string }>;
}) {
  const { tab } = await params;
  redirect(TAB_ROUTES[tab] ?? "/dashboard/settings?tab=configuration");
}
