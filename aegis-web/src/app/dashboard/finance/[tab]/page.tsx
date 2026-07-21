import { redirect } from "next/navigation";

const TAB_ROUTES: Record<string, string> = {
  "project-financials": "/dashboard/finance?tab=project-financials",
  "cost-codes": "/dashboard/finance?tab=cost-codes",
  variations: "/dashboard/finance?tab=variations",
  "progress-claims": "/dashboard/finance?tab=progress-claims",
  budgets: "/dashboard/finance?tab=budgets",
  banking: "/dashboard/finance?tab=banking",
  "cash-accounts": "/dashboard/finance?tab=cash-accounts",
  cashbook: "/dashboard/finance?tab=cashbook",
  "supplier-payments": "/dashboard/finance?tab=supplier-payments",
  payroll: "/dashboard/finance?tab=payroll",
};

export default async function FinanceTabPage({
  params,
}: {
  params: Promise<{ tab: string }>;
}) {
  const { tab } = await params;
  redirect(TAB_ROUTES[tab] ?? "/dashboard/finance?tab=project-financials");
}
