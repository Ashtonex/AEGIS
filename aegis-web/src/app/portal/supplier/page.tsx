import { PortalHome } from "@/components/auth/PortalHome";
import { constructMetadata } from "@/lib/metadata";

export const metadata = constructMetadata({
  title: "Supplier Portal | Six Nine Construction",
  description: "SNC supplier portal sign-in.",
  noIndex: true,
});

export default function SupplierPortalPage() {
  return <PortalHome portal="supplier" />;
}
