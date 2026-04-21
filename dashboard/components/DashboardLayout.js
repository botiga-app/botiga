'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createClient } from '../lib/supabase';

const navItems = [
  { href: '/dashboard', label: 'Overview', icon: '📊' },
  { href: '/dashboard/negotiations', label: 'Negotiations', icon: '💬' },
  { href: '/dashboard/recovery', label: 'Recovery', icon: '🔄' },
  { href: '/dashboard/rules', label: 'Product Rules', icon: '🎯' },
  { href: '/dashboard/settings', label: 'Settings', icon: '⚙️' },
  { href: '/dashboard/billing', label: 'Billing', icon: '💳' },
  { href: '/dashboard/install', label: 'Install', icon: '🔧' }
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
        <nav className="flex-1 p-3 space-y-1">
          {navItems.map(item => (
            <Link
              key={item.href}
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
          ))}
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
        {children}
      </main>
    </div>
  );
}
