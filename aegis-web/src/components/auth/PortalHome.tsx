"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";

import { getPortalAccess } from "@/lib/api";
import { useAuth } from "@/lib/auth/AuthContext";
import { supabase } from "@/lib/supabase";
import { ForemanPortalHome } from "@/components/auth/ForemanPortalHome";
import { SupplierPortalHome } from "@/components/auth/SupplierPortalHome";
import { ClientPortalHome } from "@/components/auth/ClientPortalHome";

type ExternalPortal = "client" | "supplier" | "foreman";

// ClientPortalHome owns createClientPortalMessage after this admission gate
// verifies access against the server-side portal tables.

function PortalLoading() {
  return (
    <main className="min-h-screen bg-ink text-paper">
      <section className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-signal" />
      </section>
    </main>
  );
}

/**
 * Server-side portal admission gate. A session alone never selects a portal
 * - access must be confirmed against the matching *_portal_access table
 * (see routers/portals.py) before any portal-specific UI renders.
 */
export function PortalHome({ portal }: { portal: ExternalPortal }) {
  const router = useRouter();
  // sessionLoading, not isLoading: portal admission only needs to know
  // there's a session, not the resolved employee role (that's a separate
  // /auth/me round trip DashboardShell kicks off in parallel and doesn't
  // gate portal routes on). Waiting on isLoading here serialized session ->
  // role -> portal admission -> portal data into three sequential network
  // hops before any portal content could start loading.
  const { session, sessionLoading } = useAuth();
  const [admitted, setAdmitted] = useState(false);

  useEffect(() => {
    if (sessionLoading) return;
    if (!session) {
      router.replace("/login");
      return;
    }
    void getPortalAccess(portal)
      .then((access) => {
        if (access.data?.destination === "/setup-password") {
          router.replace("/setup-password");
          return;
        }
        setAdmitted(true);
      })
      .catch(async () => {
        await supabase.auth.signOut();
        router.replace("/login");
      });
  }, [sessionLoading, portal, router, session]);

  if (!admitted) return <PortalLoading />;

  if (portal === "foreman") return <ForemanPortalHome />;
  if (portal === "supplier") return <SupplierPortalHome />;
  return <ClientPortalHome />;
}
