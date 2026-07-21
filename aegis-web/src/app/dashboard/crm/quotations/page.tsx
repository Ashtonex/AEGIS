import { redirect } from "next/navigation";

export default function OldQuotationsRedirect() {
  redirect("/dashboard/quotations");
}
