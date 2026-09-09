import { redirect } from "next/navigation";

const TAB_ROUTES: Record<string, string> = {
  dashboard: "/dashboard/projects?tab=dashboard",
  overview: "/dashboard/projects?tab=overview",
  schedule: "/dashboard/projects?tab=schedule",
  financials: "/dashboard/projects?tab=financials",
  materials: "/dashboard/projects?tab=materials",
  controls: "/dashboard/projects?tab=controls",
  documents: "/dashboard/projects?tab=documents",
  assign: "/dashboard/projects?tab=assign",
};

export default async function ProjectsTabPage({
  params,
}: {
  params: Promise<{ tab: string }>;
}) {
  const { tab } = await params;
  redirect(TAB_ROUTES[tab] ?? "/dashboard/projects?tab=dashboard");
}
