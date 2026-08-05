import { PortalHome } from "@/components/auth/PortalHome";
import { constructMetadata } from "@/lib/metadata";

export const metadata = constructMetadata({
  title: "Foreman Portal | Six Nine Construction",
  description: "SNC foreman portal sign-in.",
  noIndex: true,
});

export default function ForemanPortalPage() {
  return <PortalHome portal="foreman" />;
}
