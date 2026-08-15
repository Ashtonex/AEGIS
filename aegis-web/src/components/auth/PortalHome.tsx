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
  const { session, isLoading } = useAuth();
  const [admitted, setAdmitted] = useState(false);

  useEffect(() => {
    if (isLoading) return;
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
  }, [isLoading, portal, router, session]);

  if (!admitted) return <PortalLoading />;

  if (portal === "foreman") return <ForemanPortalHome />;
  if (portal === "supplier") return <SupplierPortalHome />;
  return <ClientPortalHome />;
}
