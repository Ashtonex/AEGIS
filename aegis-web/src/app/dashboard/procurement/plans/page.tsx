import { redirect } from "next/navigation";

export default function ProcurementPlansPage() {
  redirect("/dashboard/procurement?tab=plans");
}
