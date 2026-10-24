import { redirect } from "next/navigation";

export default function ProcurementPurchasesPage() {
  redirect("/dashboard/procurement?tab=purchases");
}
