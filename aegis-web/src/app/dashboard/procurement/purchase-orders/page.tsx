import { redirect } from "next/navigation";

export default function ProcurementPurchaseOrdersPage() {
  redirect("/dashboard/procurement?tab=orders");
}
