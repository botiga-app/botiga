'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { createClient } from '../lib/supabase';

const API = process.env.NEXT_PUBLIC_API_URL || 'https://api.botiga.ai';

// Sidebar grouped: 3 pillar tabs (Concierge → Negotiation → Video),
// then activity (Negotiations / Comments / Recovery), then ops (Install / Billing).
// Concierge bot lives in /dashboard/settings (bot persona); Negotiation bot
// lives in /dashboard/rules (defaults + per-product rules + recovery).
const navItems = [
  { href: '/dashboard', label: 'Overview', icon: '📊' },
  { href: '/dashboard/settings', label: 'Concierge bot', icon: '💬', section: 'Setup' },
  { href: '/dashboard/rules', label: 'Negotiation bot', icon: '🤝', section: 'Setup' },
  { href: '/dashboard/videos', label: 'Video bot', icon: '🎬', section: 'Setup' },
  { href: '/dashboard/leads', label: 'Leads', icon: '🔥', section: 'Activity' },
  { href: '/dashboard/negotiations', label: 'Negotiations', icon: '📋', section: 'Activity' },
  { href: '/dashboard/comments', label: 'Comments', icon: '💭', section: 'Activity' },
  { href: '/dashboard/recovery', label: 'Recovery', icon: '🔄', section: 'Activity' },
  { href: '/dashboard/install', label: 'Install', icon: '🔧', section: 'Account' },
  { href: '/dashboard/billing', label: 'Billing', icon: '💳', section: 'Account' },
];

export default function DashboardLayout({ children, merchantId, apiKey }) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push('/login');
  }

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="w-56 bg-white border-r border-gray-100 flex flex-col">
        <div className="p-5 border-b border-gray-100">
          <h1 className="text-lg font-bold text-indigo-600">botiga.ai</h1>
          <p className="text-xs text-gray-400 mt-0.5">Merchant Dashboard</p>
        </div>
        <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
          {navItems.map((item, idx) => {
            const prev = navItems[idx - 1];
            const showSectionHeader = item.section && (!prev || prev.section !== item.section);
            return (
              <div key={item.href}>
                {showSectionHeader && (
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 px-3 pt-3 pb-1">
                    {item.section}
                  </div>
                )}
                <Link
                  href={item.href}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                    pathname === item.href
                      ? 'bg-indigo-50 text-indigo-700 font-medium'
                      : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  <span>{item.icon}</span>
                  {item.label}
                </Link>
              </div>
            );
          })}
        </nav>
        <div className="p-3 border-t border-gray-100">
          <button
            onClick={handleSignOut}
            className="w-full text-left px-3 py-2 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-50 rounded-lg"
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto">
        <OnboardingBanner />
        {children}
      </main>
    </div>
  );
}

// Soft nudge for merchants who skipped onboarding. Disappears once
// onboarding_completed_at is set.
function OnboardingBanner() {
  const [show, setShow] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 3 });
  const supabase = createClient();
  const pathname = usePathname();

  useEffect(() => {
    let cancelled = false;
    async function check() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      const r = await fetch(`${API}/api/merchants/${user.id}`);
      if (!r.ok || cancelled) return;
      const m = await r.json();
      if (m.onboarding_completed_at) return;
      const steps = [!!m.website_url, !!m.shopify_access_token, !!m.ig_handle];
      const done = steps.filter(Boolean).length;
      setProgress({ done, total: 3 });
      setShow(true);
    }
    check();
    return () => { cancelled = true; };
  }, [pathname]);

  if (!show) return null;
  const pct = Math.round((progress.done / progress.total) * 100);
  const allDone = progress.done === progress.total;

  return (
    <div className="bg-gradient-to-r from-indigo-50 to-pink-50 border-b border-indigo-100 px-6 py-3">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-xl">{allDone ? '🎉' : '✨'}</span>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-gray-900">
              {allDone ? "You're almost done — confirm to finish" : 'Finish setting up Botiga'}
            </div>
            <div className="text-xs text-gray-600 truncate">
              {allDone
                ? `All ${progress.total} steps connected · click to confirm + tag your first videos`
                : `${progress.done}/${progress.total} steps complete · ~2 min to finish`}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="hidden sm:block w-32 h-1.5 bg-white rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-indigo-500 to-pink-500 transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <Link
            href="/onboarding"
            className="px-4 py-1.5 bg-gray-900 hover:bg-gray-800 text-white text-xs font-semibold rounded-full transition-colors"
          >
            {allDone ? 'Confirm setup →' : 'Continue setup →'}
          </Link>
          <button
            onClick={() => setShow(false)}
            className="text-gray-400 hover:text-gray-600 text-lg leading-none"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      </div>
    </div>
  );
}
