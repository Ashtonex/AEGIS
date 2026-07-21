import { redirect } from "next/navigation";

const TAB_ROUTES: Record<string, string> = {
  stock: "/dashboard/inventory?tab=stock",
  catalogue: "/dashboard/inventory?tab=catalogue",
  stores: "/dashboard/inventory?tab=stores",
  movements: "/dashboard/inventory?tab=movements",
};

export default async function InventoryTabPage({
  params,
}: {
  params: Promise<{ tab: string }>;
}) {
  const { tab } = await params;
  redirect(TAB_ROUTES[tab] ?? "/dashboard/inventory?tab=stock");
}
