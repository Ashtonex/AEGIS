import { PortalHome } from "@/components/auth/PortalHome";
import { constructMetadata } from "@/lib/metadata";

export const metadata = constructMetadata({
  title: "Site Agent Portal | Six Nine Construction",
  description: "SNC site agent weekly execution control portal.",
  noIndex: true,
});

export default function SiteAgentPortalPage() {
  return <PortalHome portal="site-agent" />;
}
