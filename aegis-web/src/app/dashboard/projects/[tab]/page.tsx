import { redirect } from "next/navigation";

const TAB_ROUTES: Record<string, string> = {
  overview: "/dashboard/projects?tab=overview",
  schedule: "/dashboard/projects?tab=schedule",
  financials: "/dashboard/projects?tab=financials",
  materials: "/dashboard/projects?tab=materials",
};

export default async function ProjectsTabPage({
  params,
}: {
  params: Promise<{ tab: string }>;
}) {
  const { tab } = await params;
  redirect(TAB_ROUTES[tab] ?? "/dashboard/projects?tab=overview");
}
