'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Nav from '../../components/Nav';
import { getToken, setToken, getMe, apiFetch } from '../../lib/api';

export default function AccountPage() {
  const router = useRouter();
  const [customer, setCustomer] = useState(null);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getToken()) { router.push('/auth/login'); return; }
    Promise.all([
      getMe().then(d => setCustomer(d.customer)),
      apiFetch('/api/marketplace/account/orders').then(d => setOrders(d.orders || [])).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, []);

  function handleLogout() {
    setToken(null);
    router.push('/');
  }

  if (loading) return (
    <div className="min-h-screen flex flex-col">
      <Nav />
      <div className="flex-1 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-purple-300 border-t-purple-600 rounded-full animate-spin" />
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex flex-col">
      <Nav />
      <main className="max-w-2xl mx-auto px-4 py-10 w-full">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Your account</h1>
            <div className="text-sm text-gray-400">{customer?.email}</div>
          </div>
          <button onClick={handleLogout} className="text-sm text-gray-400 hover:text-red-500 transition-colors">
            Sign out
          </button>
        </div>

        {/* Profile */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 mb-6">
          <div className="font-semibold text-gray-900 mb-4">Profile</div>
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Name</span>
              <span className="text-gray-900 font-medium">{customer?.name || '—'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Email</span>
              <span className="text-gray-900 font-medium">{customer?.email}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Phone</span>
              <span className="text-gray-900 font-medium">{customer?.phone || '—'}</span>
            </div>
          </div>
        </div>

        {/* Orders / Deals */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <div className="font-semibold text-gray-900 mb-4">Your deals</div>
          {orders.length === 0 ? (
            <div className="text-center py-8 text-gray-400 text-sm">
              No deals yet. <Link href="/" className="text-purple-600 hover:underline">Start shopping →</Link>
            </div>
          ) : (
            <div className="space-y-4">
              {orders.map(order => (
                <div key={order.id} className="flex items-center gap-4 border border-gray-100 rounded-xl p-4">
                  {order.product_image && (
                    <img src={order.product_image} alt="" className="w-14 h-14 rounded-lg object-cover flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm text-gray-900 truncate">{order.product_title}</div>
                    <div className="text-xs text-gray-400">{order.store_name}</div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="font-bold text-green-600">${order.deal_price}</div>
                    <div className="text-xs text-gray-400 line-through">${order.list_price}</div>
                    {order.cart_url && (
                      <a href={order.cart_url} className="text-xs text-purple-600 hover:underline">Buy now →</a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
