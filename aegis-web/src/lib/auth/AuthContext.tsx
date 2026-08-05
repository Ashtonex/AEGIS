"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '../supabase';
import { useRouter, usePathname } from 'next/navigation';
import { getAuthMe } from '../api';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  /** The user's actual assigned role from core.user_roles, resolved via the
   * backend - not session.user.app_metadata.role, which nothing keeps in
   * sync once an admin assigns a functional role via Settings. */
  role: string | null;
  isLoading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  const resolveRole = useCallback(async (accessToken?: string) => {
    if (!accessToken) {
      setRole(null);
      return;
    }
    try {
      const response = await getAuthMe(accessToken);
      setRole(response.data?.role ?? null);
    } catch (error) {
      console.error("Error fetching resolved role:", error);
      setRole(null);
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    async function getInitialSession() {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (error) throw error;

        if (mounted) {
          setSession(session);
          setUser(session?.user ?? null);
          await resolveRole(session?.access_token);
        }
      } catch (error) {
        console.error("Error fetching session:", error);
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
        setSession(session);
        setUser(session?.user ?? null);

        // TOKEN_REFRESHED (and USER_UPDATED) fire on every silent token
        // refresh - the user's role can't have changed just because the
        // token was renewed. Re-running the loading gate + /auth/me round
        // trip for those events did nothing useful and, since every
        // dashboard data fetch independently calls getSession() and each
        // one can itself trigger a refresh, turned into a near-continuous
        // loop that blanked the whole dashboard shell (isLoading) every
        // couple of seconds. Only a real sign-in/sign-out/initial load
        // needs to re-resolve the role.
        if (event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
          return;
        }

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

  const signOut = useCallback(async () => {
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
