"use client";

import { useEffect, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";

import { getPortalAccess } from "@/lib/api";
import { useAuth } from "@/lib/auth/AuthContext";
import { supabase } from "@/lib/supabase";

type ExternalPortal = "client" | "supplier";

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
    void getPortalAccess(portal).then(() => setAdmitted(true)).catch(async () => {
      await supabase.auth.signOut();
      router.replace("/login");
    });
  }, [isLoading, portal, router, session]);

  if (!admitted) return <main className="min-h-screen bg-ink flex items-center justify-center"><Loader2 className="w-6 h-6 text-signal animate-spin" /></main>;
  const label = portal === "client" ? "Client Portal" : "Supplier Portal";
  return <main className="min-h-screen bg-ink text-paper p-6"><section className="max-w-4xl mx-auto pt-20"><div className="border border-ink-mid bg-ink-light p-8 rounded-sm"><ShieldCheck className="w-7 h-7 text-green-500 mb-5"/><p className="font-mono text-[10px] tracking-widest text-signal uppercase">Access confirmed</p><h1 className="font-display text-4xl mt-2">{label}</h1><p className="text-slate-light mt-3">Your account is restricted to records provisioned for your organisation. Portal modules will appear here as they are activated.</p></div></section></main>;
}
