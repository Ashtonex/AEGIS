"use client";

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Users, Briefcase, Truck, Settings, LogOut, Activity, ClipboardCheck } from 'lucide-react';
import { useAuth } from '@/lib/auth/AuthContext';

export default function Sidebar() {
  const pathname = usePathname();
  const { signOut, user } = useAuth();

  const navItems = [
    { name: 'Command Centre', href: '/dashboard', icon: LayoutDashboard },
    { name: 'Commercial Command', href: '/dashboard/crm', icon: Activity },
    { name: 'Projects', href: '/dashboard/projects', icon: Briefcase },
    { name: 'Site Operations', href: '/dashboard/site-operations', icon: ClipboardCheck },
    { name: 'Fleet', href: '/dashboard/fleet', icon: Truck },
    { name: 'Workforce', href: '/dashboard/workforce', icon: Users },
    { name: 'System Settings', href: '/dashboard/settings', icon: Settings },
  ];

  return (
    <aside className="w-64 bg-snc-navy h-screen fixed flex flex-col border-r border-white/10 z-50">
      <div className="p-6 border-b border-white/10">
        <div className="flex flex-col">
          <span className="text-xl font-black tracking-tight text-white uppercase leading-none">AEGIS</span>
          <span className="text-[0.65rem] font-bold tracking-widest text-snc-amber uppercase">Imperium Layer</span>
        </div>
      </div>

      <div className="p-6 flex-1 overflow-y-auto">
        <div className="text-xs font-bold text-white/40 tracking-widest uppercase mb-4">Navigation</div>
        <nav className="space-y-2">
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link 
                key={item.name} 
                href={item.href}
                className={`flex items-center space-x-3 px-3 py-2 rounded-sm text-sm font-medium transition-colors ${
                  isActive ? 'bg-snc-amber/10 text-snc-amber' : 'text-white/60 hover:bg-white/5 hover:text-white'
                }`}
              >
                <item.icon className={`w-4 h-4 ${isActive ? 'text-snc-amber' : 'text-white/40'}`} />
                <span>{item.name}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="p-6 border-t border-white/10">
        <div className="mb-4">
          <div className="text-xs text-white/50">Logged in as</div>
          <div className="text-sm font-bold text-white truncate">{user?.email || 'Authenticating...'}</div>
        </div>
        <button 
          onClick={signOut}
          className="flex items-center space-x-2 text-white/60 hover:text-red-400 transition-colors text-sm font-medium w-full"
        >
          <LogOut className="w-4 h-4" />
          <span>Terminate Session</span>
        </button>
      </div>
    </aside>
  );
}
