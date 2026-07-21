import { redirect } from "next/navigation";

export default function ProcurementRequisitionsPage() {
  redirect("/dashboard/procurement?tab=requisitions");
}
