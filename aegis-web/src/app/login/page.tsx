"use client";

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth/AuthContext';
import { Lock, AlertCircle, Loader2 } from 'lucide-react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const router = useRouter();
  const { session, isLoading } = useAuth();

  // If already logged in, redirect
  useEffect(() => {
    if (!isLoading && session) {
      router.push('/dashboard/executive');
    }
  }, [session, isLoading, router]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsAuthenticating(true);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        throw error;
      }
      
      // AuthContext will pick up the session change and route guard will allow entry
      router.push('/dashboard/executive');
    } catch (err: any) {
      setError(err.message || 'Failed to authenticate');
    } finally {
      setIsAuthenticating(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-ink flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-signal animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-ink text-paper flex flex-col justify-center items-center relative selection:bg-signal selection:text-ink">
      {/* Texture Layer */}
      <div 
        className="fixed inset-0 pointer-events-none opacity-5 mix-blend-overlay"
        style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, rgba(255,255,255,0.15) 1px, transparent 0)', backgroundSize: '32px 32px' }}
      />

      <div className="z-10 w-full max-w-md p-8 bg-ink-light border border-ink-mid rounded-sm shadow-2xl">
        <div className="mb-8 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-ink border border-ink-mid mb-4">
            <Lock className="w-5 h-5 text-signal" />
          </div>
          <h1 className="font-display text-headline-lg tracking-tight text-paper mb-1">IMPERIUM GATEWAY</h1>
          <p className="font-mono text-data-sm text-slate-light tracking-widest uppercase">Authorized Personnel Only</p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-950/30 border border-red-500/50 flex items-start space-x-3 rounded-sm">
            <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
            <span className="font-mono text-data-label text-red-400 leading-relaxed">{error}</span>
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-5">
          <div>
            <label className="block font-mono text-data-label text-slate-light tracking-wider mb-2">EMAIL IDENTIFICATION</label>
            <input 
              type="email" 
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-ink border border-ink-mid text-paper px-4 py-3 font-mono text-body-sm focus:outline-none focus:border-signal transition-colors rounded-sm"
              placeholder="operator@sixnine.co.zw"
            />
          </div>
          <div>
            <label className="block font-mono text-data-label text-slate-light tracking-wider mb-2">ACCESS CLEARANCE</label>
            <input 
              type="password" 
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-ink border border-ink-mid text-paper px-4 py-3 font-mono text-body-sm focus:outline-none focus:border-signal transition-colors rounded-sm"
              placeholder="••••••••"
            />
          </div>

          <button 
            type="submit" 
            disabled={isAuthenticating}
            className="w-full mt-6 bg-signal text-ink hover:bg-signal-muted font-mono text-data-sm tracking-widest uppercase py-4 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex justify-center items-center rounded-sm"
          >
            {isAuthenticating ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              'INITIALIZE LINK'
            )}
          </button>
        </form>
      </div>
      
      <div className="absolute bottom-8 text-center w-full">
        <p className="font-mono text-[10px] text-slate uppercase tracking-[0.2em]">PROJECT AEGIS • SECURE PROTOCOL</p>
      </div>
    </div>
  );
}
