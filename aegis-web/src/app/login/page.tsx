import { PortalLogin } from "@/components/auth/PortalLogin";
import { constructMetadata } from "@/lib/metadata";

export const metadata = constructMetadata({
  title: "Secure Access | Six Nine Construction",
  description: "Sign in to the SNC client, supplier, or employee portal.",
  noIndex: true,
});

export default function LoginPage() {
  return <PortalLogin />;
}
