import { redirect } from "next/navigation";

export default function ProcurementSuppliersPage() {
  redirect("/dashboard/procurement?tab=suppliers");
}
