"use client";

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase, setCachedAccessToken } from '../supabase';
import { useRouter, usePathname } from 'next/navigation';
import { getAuthMe, resolvePortalAccess } from '../api';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  /** The user's actual assigned role from core.user_roles, resolved via the
   * backend - not session.user.app_metadata.role, which nothing keeps in
   * sync once an admin assigns a functional role via Settings. */
  role: string | null;
  isLoading: boolean;
  /** True until the initial Supabase session check resolves - does NOT wait
   * on the follow-up /auth/me role round trip the way isLoading does. Use
   * this for gates that only need to know "is there a session", so they
   * don't pay for a network hop they never needed (see PortalHome and
   * DashboardShell's portal-route branch). */
  sessionLoading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [sessionLoading, setSessionLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();
  const resolvedUserIdRef = useRef<string | null>(null);
  const lastAppliedTokenRef = useRef<string | null>(null);
  const roleResolveSeqRef = useRef(0);

  const resolveRole = useCallback(async (accessToken?: string) => {
    const sequence = roleResolveSeqRef.current + 1;
    roleResolveSeqRef.current = sequence;
    if (!accessToken) {
      if (sequence === roleResolveSeqRef.current) {
        setRole(null);
      }
      return;
    }
    try {
      const response = await getAuthMe(accessToken);
      if (sequence === roleResolveSeqRef.current && accessToken === lastAppliedTokenRef.current) {
        setRole(response.data?.role ?? null);
      }
    } catch (error) {
      console.error("Error fetching resolved role:", error);
      if (sequence === roleResolveSeqRef.current && accessToken === lastAppliedTokenRef.current) {
        setRole(null);
      }
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    async function getInitialSession() {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (error) throw error;

        if (mounted) {
          lastAppliedTokenRef.current = session?.access_token ?? null;
          setSession(session);
          setUser(session?.user ?? null);
          setCachedAccessToken(session?.access_token ?? null);
          resolvedUserIdRef.current = session?.user?.id ?? null;
          setSessionLoading(false);
          await resolveRole(session?.access_token);
        }
      } catch (error) {
        console.error("Error fetching session:", error);
        if (mounted) setSessionLoading(false);
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    getInitialSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (!mounted) return;

        // GoTrue re-announces the same session (e.g. redundant SIGNED_IN
        // events, observed repeating every ~2s on some pages) without the
        // access token changing. Skip the update entirely - including
        // setSession - when the token is unchanged, so `session` keeps a
        // stable object reference. Otherwise every page effect keyed on
        // `session` (loadData, etc.) refires on every no-op re-announcement,
        // producing endless duplicate API calls.
        const nextToken = session?.access_token ?? null;
        if (nextToken === lastAppliedTokenRef.current) {
          return;
        }
        lastAppliedTokenRef.current = nextToken;

        setSession(session);
        setUser(session?.user ?? null);
        setCachedAccessToken(nextToken);

        // TOKEN_REFRESHED (and USER_UPDATED) fire on every silent token
        // refresh - the user's role can't have changed just because the
        // token was renewed. Re-running the loading gate + /auth/me round
        // trip for those events did nothing useful.
        if (event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
          return;
        }

        // SIGNED_IN can fire redundantly for the same already-authenticated
        // user (observed repeating every ~2s on some pages, cause not fully
        // isolated - possibly the GoTrue client re-announcing under some
        // concurrent-access condition). Re-running the full loading gate for
        // a no-op re-announcement blanked the whole dashboard shell
        // (DashboardShell unmounts everything while isLoading is true)
        // repeatedly, which looked like the page reloading on its own. Only
        // treat it as a real transition - and pay the resolveRole round
        // trip - when the signed-in user actually changed.
        const nextUserId = session?.user?.id ?? null;
        if (event === "SIGNED_IN" && nextUserId && nextUserId === resolvedUserIdRef.current) {
          return;
        }
        resolvedUserIdRef.current = nextUserId;

        setIsLoading(true);
        void resolveRole(session?.access_token).finally(() => {
          if (mounted) setIsLoading(false);
        });
      }
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [resolveRole]);

  // Route guard for /dashboard and /portal. Once the initial session check
  // has resolved (isLoading is false), an absent session means redirect
  // immediately - no artificial delay during which protected chrome could
  // render. Consumers (e.g. DashboardShell) are responsible for not
  // rendering protected content while isLoading is still true.
  useEffect(() => {
    const isProtectedRoute = pathname?.startsWith('/dashboard') || pathname?.startsWith('/portal');
    if (isLoading || session || !isProtectedRoute) {
      return;
    }
    router.push('/login');
  }, [isLoading, session, pathname, router]);

  // Supabase's invite/recovery emails should redirect straight to
  // /setup-password, but its redirect_to allow-list matching has been
  // observed silently truncating any requested path down to the bare site
  // origin - the link lands wherever, with a valid session already
  // established via the URL hash, and nothing routes them onward. /login and
  // /setup-password already resolve this themselves (PortalLogin and the
  // page's own gate), so this only needs to catch every other page.
  const passwordCheckedTokenRef = useRef<string | null>(null);
  useEffect(() => {
    if (sessionLoading || !session?.access_token) return;
    if (pathname === '/login' || pathname === '/setup-password') return;
    if (passwordCheckedTokenRef.current === session.access_token) return;
    passwordCheckedTokenRef.current = session.access_token;

    resolvePortalAccess(session.access_token)
      .then((access) => {
        if (access.data?.destination === '/setup-password') {
          router.replace('/setup-password');
        }
      })
      .catch(() => {
        // Fail open - a background check shouldn't block normal navigation.
      });
  }, [sessionLoading, session, pathname, router]);

  const signOut = useCallback(async () => {
    roleResolveSeqRef.current += 1;
    lastAppliedTokenRef.current = null;
    resolvedUserIdRef.current = null;
    setCachedAccessToken(null);
    await supabase.auth.signOut();
    setRole(null);
    router.push('/login');
  }, [router]);

  return (
    <AuthContext.Provider value={{
      user,
      session,
      role,
      isLoading,
      sessionLoading,
      signOut
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
