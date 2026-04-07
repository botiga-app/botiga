'use client';
import { useEffect, useState } from 'react';
import { createClient } from '../../../lib/supabase';

const API = process.env.NEXT_PUBLIC_API_URL || 'https://api.botiga.ai';

export default function RecoveryPage() {
  const [negotiations, setNegotiations] = useState([]);
  const supabase = createClient();

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const res = await fetch(`${API}/api/merchants/${user.id}/negotiations?status=pending&limit=50`);
      if (res.ok) setNegotiations(await res.json());
    }
    load();
  }, []);

  const total = negotiations.length;
  const withContact = negotiations.filter(n => n.customer_whatsapp || n.customer_email).length;
  const recovered = negotiations.filter(n => n.status === 'recovered').length;

  return (
    <div className="p-8">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-900">Recovery</h2>
        <p className="text-sm text-gray-500">Abandoned deal recovery analytics</p>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <p className="text-sm text-gray-500">Pending recoveries</p>
          <p className="text-2xl font-bold mt-1">{total}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <p className="text-sm text-gray-500">With contact captured</p>
          <p className="text-2xl font-bold mt-1">{withContact}</p>
          <p className="text-xs text-gray-400 mt-1">{total ? Math.round(withContact/total*100) : 0}% capture rate</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <p className="text-sm text-gray-500">Successfully recovered</p>
          <p className="text-2xl font-bold mt-1 text-green-600">{recovered}</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-50">
          <h3 className="font-semibold text-gray-900 text-sm">Pending Recovery Queue</h3>
        </div>
        {negotiations.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">No pending recoveries.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
              <tr>
                <th className="px-5 py-3 text-left">Product</th>
                <th className="px-5 py-3 text-left">Deal Price</th>
                <th className="px-5 py-3 text-left">Contact</th>
                <th className="px-5 py-3 text-left">Abandoned</th>
                <th className="px-5 py-3 text-left">Recovery sent</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {negotiations.map(n => (
                <tr key={n.id} className="hover:bg-gray-50">
                  <td className="px-5 py-3 font-medium truncate max-w-xs">{n.product_name || '—'}</td>
                  <td className="px-5 py-3 text-gray-600">{n.deal_price ? `$${n.deal_price}` : '—'}</td>
                  <td className="px-5 py-3 text-gray-600">
                    {n.customer_whatsapp ? <span className="text-green-600">📱 WhatsApp</span>
                     : n.customer_email ? <span className="text-blue-600">✉️ Email</span>
                     : <span className="text-gray-300">None captured</span>}
                  </td>
                  <td className="px-5 py-3 text-gray-400 text-xs">{new Date(n.created_at).toLocaleString()}</td>
                  <td className="px-5 py-3 text-gray-400 text-xs">
                    {n.recovery_sent_at ? new Date(n.recovery_sent_at).toLocaleString() : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
