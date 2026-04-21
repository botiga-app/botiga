'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const navItems = [
  { href: '/admin/live-feed', label: 'Live Feed', icon: '📡' },
  { href: '/admin/merchants', label: 'Merchants', icon: '🏪' },
  { href: '/admin/alerts', label: 'Alerts', icon: '🔔' },
  { href: '/admin/roadmap', label: 'Roadmap', icon: '🗺️' }
];

export default function AdminLayoutClient({ children }) {
  const pathname = usePathname();
  return (
    <div className="flex h-screen bg-gray-50">
      <aside className="w-56 bg-gray-900 text-gray-100 flex flex-col">
        <div className="p-5 border-b border-gray-800">
          <h1 className="text-lg font-bold text-white">botiga admin</h1>
          <p className="text-xs text-gray-500 mt-0.5">Internal dashboard</p>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {navItems.map(item => (
            <Link key={item.href} href={item.href}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                pathname === item.href ? 'bg-gray-700 text-white font-medium' : 'text-gray-400 hover:bg-gray-800 hover:text-white'
              }`}>
              <span>{item.icon}</span>{item.label}
            </Link>
          ))}
        </nav>
        <div className="p-3 border-t border-gray-800">
          <Link href="/dashboard" className="text-xs text-gray-500 hover:text-gray-300">← Merchant dashboard</Link>
        </div>
      </aside>
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
