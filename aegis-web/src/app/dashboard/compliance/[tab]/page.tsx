import { redirect } from "next/navigation";

const TAB_ROUTES: Record<string, string> = {
  obligations: "/dashboard/compliance?tab=obligations",
  employees: "/dashboard/compliance?tab=employees",
  equipment: "/dashboard/compliance?tab=equipment",
  "deployment-gates": "/dashboard/compliance?tab=deployment-gates",
  "corrective-actions": "/dashboard/compliance?tab=corrective-actions",
  incidents: "/dashboard/compliance?tab=incidents",
};

export default async function ComplianceTabPage({
  params,
}: {
  params: Promise<{ tab: string }>;
}) {
  const { tab } = await params;
  redirect(TAB_ROUTES[tab] ?? "/dashboard/compliance?tab=obligations");
}
