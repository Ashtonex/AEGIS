"use client";

import { useEffect, useState } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { useRouter, usePathname } from 'next/navigation';

export function useAuth(requireAuth = false) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    // 1. Fetch initial session on mount
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
      
      if (requireAuth && !session) {
        router.push('/login');
      }
    });

    // 2. Subscribe to Auth state changes (Login, Logout, Token Refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
      
      if (requireAuth && !session) {
        // Prevent redirect loops if already on login
        if (pathname !== '/login') {
            router.push('/login');
        }
      }
    });

    // 3. Cleanup subscription on unmount
    return () => {
      subscription.unsubscribe();
    };
  }, [requireAuth, router, pathname]);

  const signOut = async () => {
    await supabase.auth.signOut();
    router.push('/login');
  };

  return { user, session, loading, signOut };
}
