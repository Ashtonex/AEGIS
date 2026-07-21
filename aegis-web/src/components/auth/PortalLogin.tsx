"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { AlertCircle, Loader2, LockKeyhole } from "lucide-react";
import { useRouter } from "next/navigation";

import { ApiError, resolvePortalAccess } from "@/lib/api";
import { useAuth } from "@/lib/auth/AuthContext";
import { supabase } from "@/lib/supabase";

export function PortalLogin() {
  const router = useRouter();
  const { session, isLoading } = useAuth();
  const resolvingPortalRef = useRef(false);
  const resolvedPortalRef = useRef(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const resolvePortal = async (accessToken?: string) => {
    if (resolvingPortalRef.current || resolvedPortalRef.current) {
      return;
    }

    resolvingPortalRef.current = true;
    try {
      const access = await resolvePortalAccess(accessToken);
      resolvedPortalRef.current = true;
      router.replace(access.data?.destination || "/login");
    } catch (accessError) {
      if (accessError instanceof ApiError && accessError.status === 403) {
        await supabase.auth.signOut();
        setError("This account is not provisioned for any AEGIS portal. Please contact your administrator.");
      } else if (accessError instanceof ApiError && accessError.status === 401) {
        await supabase.auth.signOut();
        setError("Your session could not be verified. Please sign in again.");
      } else if (accessError instanceof ApiError) {
        setError(accessError.message);
      } else {
        setError("Unable to verify portal access. Please try again in a moment.");
      }
    } finally {
      resolvingPortalRef.current = false;
    }
  };

  useEffect(() => {
    if (!isLoading && session?.access_token) void resolvePortal(session.access_token);
  // Admission must run when the session changes, not on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, session]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError || !data.session?.access_token) {
      setError("Unable to authenticate this account. Please verify your credentials and try again.");
      setSubmitting(false);
      return;
    }

    try {
      await resolvePortal(data.session.access_token);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-ink text-paper flex items-center justify-center p-6">
      <section className="w-full max-w-md border border-ink-mid bg-ink-light p-8 rounded-sm">
        <div className="mb-8">
          <div className="w-11 h-11 border border-ink-mid flex items-center justify-center mb-5">
            <LockKeyhole className="w-5 h-5 text-signal" />
          </div>
          <p className="font-mono text-[10px] tracking-widest text-signal uppercase">AEGIS secure access</p>
          <h1 className="font-display text-3xl mt-2">AEGIS Portal Access</h1>
          <p className="text-sm text-slate-light mt-2">
            Enter your credentials to access your provisioned workspace (Executives, Foremen, Employees, Clients, or Suppliers).
          </p>
        </div>

        {error && (
          <div className="mb-5 p-3 border border-red-500/50 bg-red-950/30 flex gap-2 text-sm text-red-300">
            <AlertCircle className="w-5 h-5 shrink-0" />
            {error}
          </div>
        )}

        <form onSubmit={submit} className="space-y-4">
          <label className="block">
            <span className="font-mono text-[10px] text-slate-light tracking-wider">EMAIL</span>
            <input
              required
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-2 w-full bg-ink border border-ink-mid p-3 text-paper focus:outline-none focus:border-signal"
            />
          </label>
          <label className="block">
            <span className="font-mono text-[10px] text-slate-light tracking-wider">PASSWORD</span>
            <input
              required
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-2 w-full bg-ink border border-ink-mid p-3 text-paper focus:outline-none focus:border-signal"
            />
          </label>
          <button
            type="submit"
            disabled={submitting || isLoading}
            className="w-full mt-3 bg-signal text-ink py-3 font-mono text-xs tracking-widest uppercase disabled:opacity-50 flex justify-center"
          >
            {submitting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <LockKeyhole className="w-4 h-4 mr-2" />
                Sign in
              </>
            )}
          </button>
        </form>
        <p className="mt-6 text-xs text-slate-light">
          Use the credentials card issued by your AEGIS administrator. Contact them if you need access provisioned.
        </p>
      </section>
    </main>
  );
}
