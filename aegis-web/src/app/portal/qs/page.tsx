import { PortalHome } from "@/components/auth/PortalHome";
import { constructMetadata } from "@/lib/metadata";

export const metadata = constructMetadata({
  title: "QS Portal | Six Nine Construction",
  description: "SNC quantity surveyor commercial control portal.",
  noIndex: true,
});

export default function QsPortalPage() {
  return <PortalHome portal="qs" />;
}
