import { PortalHome } from "@/components/auth/PortalHome";
import { constructMetadata } from "@/lib/metadata";

export const metadata = constructMetadata({
  title: "Site Engineer Portal | Six Nine Construction",
  description: "SNC site engineer technical control portal.",
  noIndex: true,
});

export default function SiteEngineerPortalPage() {
  return <PortalHome portal="site-engineer" />;
}
