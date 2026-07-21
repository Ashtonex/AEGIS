import { redirect } from "next/navigation";

const TAB_ROUTES: Record<string, string> = {
  employees: "/dashboard/hr?tab=employees",
  attendance: "/dashboard/hr?tab=attendance",
  leave: "/dashboard/hr?tab=leave",
  payroll: "/dashboard/hr?tab=payroll",
};

export default async function HRTabPage({
  params,
}: {
  params: Promise<{ tab: string }>;
}) {
  const { tab } = await params;
  redirect(TAB_ROUTES[tab] ?? "/dashboard/hr?tab=employees");
}
