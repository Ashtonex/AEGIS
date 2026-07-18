"use client";

import React, { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth/AuthContext";
import { usePathname, useRouter } from "next/navigation";
import { ShieldAlert, ArrowLeft, Loader2 } from "lucide-react";

// Helper to write to local storage session logs
export function addSessionLog(
  event: string,
  user: string,
  resource: string,
  details: string,
  status: "Success" | "Blocked" | "Warning"
) {
  if (typeof window === "undefined") return;
  const stored = localStorage.getItem("snc_session_logs");
  const logs = stored ? JSON.parse(stored) : [];
  const newLog = {
    id: `LOG-${Math.random().toString(36).substring(2, 11).toUpperCase()}`,
    timestamp: new Date().toISOString(),
    event,
    user,
    resource,
    details,
    status
  };
  localStorage.setItem("snc_session_logs", JSON.stringify([newLog, ...logs].slice(0, 100)));
}

interface RBACGuardProps {
  children: React.ReactNode;
  allowedRoles: string[];
}

export function RBACGuard({ children, allowedRoles }: RBACGuardProps) {
  const { user, session, isLoading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  const [hasLoggedDenial, setHasLoggedDenial] = useState(false);

  const userEmail = session?.user?.email || user?.email || "Unknown User";
  const userRole = String(session?.user?.app_metadata?.role || user?.app_metadata?.role || "Employee");

  const isAuthorized = React.useMemo(() => {
    const normUser = userRole.toLowerCase().trim();
    
    // System-wide superadmin/admin master bypass
    if (
      normUser === "superadmin" || 
      normUser === "admin" || 
      normUser.includes("superadmin") || 
      normUser.includes("admin")
    ) {
      return true;
    }

    return allowedRoles.some((role) => {
      const normAllowed = role.toLowerCase().trim();
      return normUser === normAllowed || normUser.includes(normAllowed) || normAllowed.includes(normUser);
    });
  }, [allowedRoles, userRole]);

  // Log access denials
  useEffect(() => {
    if (!isLoading && session && !isAuthorized && !hasLoggedDenial) {
      addSessionLog(
        "Access Denied",
        userEmail,
        pathname || "Unknown Resource",
        `Attempted access with unauthorized role: ${userRole}. Required clearance: ${allowedRoles.join(" or ")}`,
        "Blocked"
      );
      setHasLoggedDenial(true);
    }
  }, [isLoading, session, isAuthorized, userRole, userEmail, pathname, allowedRoles, hasLoggedDenial]);

  // Reset denial logging flag if user details change
  useEffect(() => {
    setHasLoggedDenial(false);
  }, [userRole]);

  if (isLoading) {
    return (
      <div className="min-h-[calc(100vh-3.5rem)] flex flex-col items-center justify-center bg-ink">
        <Loader2 className="w-8 h-8 text-signal animate-spin mb-4" />
        <p className="font-mono text-data-sm text-slate-light uppercase tracking-widest animate-pulse">
          Decrypting access ledger...
        </p>
      </div>
    );
  }

  if (!isAuthorized) {
    return (
      <div className="min-h-[calc(100vh-3.5rem)] w-full flex items-center justify-center bg-ink px-4 py-12 relative overflow-hidden blueprint-grid">
        <div 
          className="absolute inset-0 pointer-events-none opacity-30"
          style={{ backgroundImage: 'radial-gradient(circle at center, rgba(200, 150, 12, 0.03) 0%, transparent 70%)' }}
        />
        
        <div className="max-w-md w-full border border-signal/20 bg-ink-light/95 p-8 rounded-none relative z-10 shadow-2xl backdrop-blur-md">
          {/* Pulsing Warning Light */}
          <div className="relative flex items-center justify-center my-6">
            <span className="absolute inline-flex h-16 w-16 rounded-full bg-signal/10 animate-ping"></span>
            <span className="absolute inline-flex h-12 w-12 rounded-full bg-signal/20 animate-pulse"></span>
            <div className="relative inline-flex rounded-full h-6 w-6 bg-signal shadow-[0_0_20px_rgba(200,150,12,0.8)] border border-paper/10 flex items-center justify-center">
              <ShieldAlert className="w-3.5 h-3.5 text-ink font-bold animate-pulse" />
            </div>
          </div>
          
          <h2 className="font-mono text-xs uppercase tracking-widest text-signal font-bold mb-1 text-center">
            ACCESS LEVEL: RESTRICTED
          </h2>
          <h1 className="font-display text-2xl text-paper text-center mb-6">
            SNC Imperium Protocol
          </h1>
          
          {/* Identity Verification Report */}
          <div className="bg-ink border border-ink-mid p-5 mb-6 rounded-none">
            <p className="font-mono text-[9px] text-slate-light uppercase tracking-widest mb-3 border-b border-ink-mid pb-1.5 font-bold">
              Identity Verification Ledger
            </p>
            <div className="space-y-2 font-mono text-xs">
              <div className="flex justify-between gap-4">
                <span className="text-slate">IDENTITY:</span>
                <span className="text-paper truncate max-w-[200px]" title={userEmail}>
                  {userEmail}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate">ASSIGNED ROLE:</span>
                <span className="text-red-400 uppercase font-bold">{userRole}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate">CLEARANCE LEVEL:</span>
                <span className="text-red-400 font-bold uppercase">UNAUTHORIZED</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate">REQUIRED CLEARANCE:</span>
                <span className="text-signal font-bold uppercase">{allowedRoles.join(" | ")}</span>
              </div>
            </div>
          </div>

          <p className="text-xs text-slate-light font-mono leading-relaxed mb-6 border-l-2 border-signal/40 pl-3">
            SECURITY STATEMENT: The resource you attempted to contact is restricted to authorized {allowedRoles.join(" and ")} roles. All unauthorized connections are logged to the security audit server.
          </p>

          <button
            onClick={() => router.push("/dashboard/executive")}
            className="w-full mt-4 bg-transparent text-slate hover:text-paper font-mono text-xs uppercase tracking-widest py-2 border border-transparent hover:border-ink-mid transition-all duration-fast flex items-center justify-center gap-2 cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Return to Command Centre
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
