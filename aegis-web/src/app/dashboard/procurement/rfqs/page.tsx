import { redirect } from "next/navigation";

export default function ProcurementRfqsPage() {
  redirect("/dashboard/procurement?tab=rfqs");
}
