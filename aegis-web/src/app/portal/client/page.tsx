import { PortalHome } from "@/components/auth/PortalHome";
import { constructMetadata } from "@/lib/metadata";

export const metadata = constructMetadata({
  title: "Client Portal | Six Nine Construction",
  description: "SNC client portal sign-in.",
  noIndex: true,
});

export default function ClientPortalPage() {
  return <PortalHome portal="client" />;
}
