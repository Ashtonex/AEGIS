import { redirect } from "next/navigation";

export default function ProcurementPricingPage() {
  redirect("/dashboard/procurement?tab=pricing");
}
