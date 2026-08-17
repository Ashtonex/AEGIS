import { redirect } from "next/navigation";

const TAB_ROUTES: Record<string, string> = {
  "project-financials": "/dashboard/finance?tab=project-financials",
  "cost-codes": "/dashboard/finance?tab=cost-codes",
  variations: "/dashboard/finance?tab=variations",
  "progress-claims": "/dashboard/finance?tab=progress-claims",
  "earned-value": "/dashboard/finance?tab=earned-value",
  "close-out": "/dashboard/finance?tab=close-out",
  budgets: "/dashboard/finance?tab=budgets",
  banking: "/dashboard/finance?tab=banking",
  "cash-accounts": "/dashboard/finance?tab=cash-accounts",
  cashbook: "/dashboard/finance?tab=cashbook",
  "supplier-payments": "/dashboard/finance?tab=supplier-payments",
  payroll: "/dashboard/finance?tab=payroll",
  transfers: "/dashboard/finance?tab=transfers",
  "department-pnl": "/dashboard/finance?tab=department-pnl",
  statutory: "/dashboard/finance?tab=statutory",
  "vendor-payments": "/dashboard/finance?tab=vendor-payments",
  "client-payments": "/dashboard/finance?tab=client-payments",
  "historical-entry": "/dashboard/finance?tab=historical-entry",
  "financial-statements": "/dashboard/finance?tab=financial-statements",
};

export default async function FinanceTabPage({
  params,
}: {
  params: Promise<{ tab: string }>;
}) {
  const { tab } = await params;
  redirect(TAB_ROUTES[tab] ?? "/dashboard/finance?tab=project-financials");
}
