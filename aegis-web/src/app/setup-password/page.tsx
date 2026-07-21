"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, LockKeyhole } from "lucide-react";
import { useRouter } from "next/navigation";

import { ApiError, completePasswordSetup, resolvePortalAccess } from "@/lib/api";
import { useAuth } from "@/lib/auth/AuthContext";
import { supabase } from "@/lib/supabase";

export default function SetupPasswordPage() {
  const router = useRouter();
  const { session, isLoading } = useAuth();
  const resolvingRef = useRef(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loadingGate, setLoadingGate] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isLoading) return;
    if (!session?.access_token) {
      router.replace("/login");
      return;
    }

    if (resolvingRef.current) return;
    resolvingRef.current = true;
    void resolvePortalAccess(session.access_token)
      .then((access) => {
        if (access.data?.destination !== "/setup-password") {
          router.replace(access.data?.destination || "/login");
          return;
        }
        setLoadingGate(false);
      })
      .catch(() => {
        router.replace("/login");
      })
      .finally(() => {
        resolvingRef.current = false;
      });
  }, [isLoading, router, session?.access_token]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setNotice(null);

    if (newPassword.length < 12) {
      setError("Use at least 12 characters for the new password.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("The password confirmation does not match.");
      return;
    }

    setSubmitting(true);
    try {
      const { error: passwordError } = await supabase.auth.updateUser({ password: newPassword });
      if (passwordError) {
        throw passwordError;
      }

      await completePasswordSetup();
      setNotice("Password updated. Redirecting to your portal...");
      const access = await resolvePortalAccess(session?.access_token);
      router.replace(access.data?.destination || "/login");
    } catch (cause) {
      const message = cause instanceof ApiError
        ? cause.message
        : cause instanceof Error
          ? cause.message
          : "The new password could not be saved.";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loadingGate || isLoading) {
    return (
      <main className="min-h-screen bg-ink text-paper flex items-center justify-center p-6">
        <Loader2 className="h-6 w-6 animate-spin text-signal" />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-ink text-paper flex items-center justify-center p-6">
      <section className="w-full max-w-md border border-ink-mid bg-ink-light p-8 rounded-sm">
        <div className="mb-8">
          <div className="w-11 h-11 border border-ink-mid flex items-center justify-center mb-5">
            <LockKeyhole className="w-5 h-5 text-signal" />
          </div>
          <p className="font-mono text-[10px] tracking-widest text-signal uppercase">First login required</p>
          <h1 className="font-display text-3xl mt-2">Set a new password</h1>
          <p className="text-sm text-slate-light mt-2">
            Use the temporary credential from your access card, choose a new password, and then continue into your assigned module.
          </p>
          <p className="mt-3 text-xs text-slate-light">
            Signed in as <span className="text-paper">{session?.user.email ?? "your account"}</span>
          </p>
        </div>

        {error && (
          <div className="mb-5 p-3 border border-red-500/50 bg-red-950/30 flex gap-2 text-sm text-red-300">
            <AlertCircle className="w-5 h-5 shrink-0" />
            {error}
          </div>
        )}

        {notice && (
          <div className="mb-5 p-3 border border-green-500/30 bg-green-950/20 flex gap-2 text-sm text-green-200">
            <CheckCircle2 className="w-5 h-5 shrink-0" />
            {notice}
          </div>
        )}

        <form onSubmit={submit} className="space-y-4">
          <label className="block">
            <span className="font-mono text-[10px] text-slate-light tracking-wider">NEW PASSWORD</span>
            <input
              required
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              className="mt-2 w-full bg-ink border border-ink-mid p-3 text-paper focus:outline-none focus:border-signal"
            />
          </label>
          <label className="block">
            <span className="font-mono text-[10px] text-slate-light tracking-wider">CONFIRM PASSWORD</span>
            <input
              required
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              className="mt-2 w-full bg-ink border border-ink-mid p-3 text-paper focus:outline-none focus:border-signal"
            />
          </label>
          <button
            type="submit"
            disabled={submitting}
            className="w-full mt-3 bg-signal text-ink py-3 font-mono text-xs tracking-widest uppercase disabled:opacity-50 flex justify-center"
          >
            {submitting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <LockKeyhole className="w-4 h-4 mr-2" />
                Save password
              </>
            )}
          </button>
        </form>
      </section>
    </main>
  );
}
