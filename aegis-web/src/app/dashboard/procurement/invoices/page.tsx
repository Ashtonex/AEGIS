import { redirect } from "next/navigation";

export default function ProcurementInvoicesPage() {
  redirect("/dashboard/procurement?tab=invoices");
}
