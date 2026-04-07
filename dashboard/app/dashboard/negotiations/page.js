'use client';
import { useEffect, useState } from 'react';
import { createClient } from '../../../lib/supabase';

const API = process.env.NEXT_PUBLIC_API_URL || 'https://api.botiga.ai';

const STATUS_COLORS = {
  won: 'bg-green-100 text-green-700',
  lost: 'bg-red-100 text-red-700',
  active: 'bg-blue-100 text-blue-700',
  pending: 'bg-yellow-100 text-yellow-700',
  recovered: 'bg-purple-100 text-purple-700'
};

export default function NegotiationsPage() {
  const [negotiations, setNegotiations] = useState([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [expanded, setExpanded] = useState(null);
  const [merchantId, setMerchantId] = useState(null);
  const supabase = createClient();

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setMerchantId(user.id);
      const qs = statusFilter !== 'all' ? `?status=${statusFilter}` : '';
      const res = await fetch(`${API}/api/merchants/${user.id}/negotiations${qs}`);
      if (res.ok) setNegotiations(await res.json());
    }
    load();
  }, [statusFilter]);

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Negotiations</h2>
          <p className="text-sm text-gray-500">Full deal history with conversation replay</p>
        </div>
        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
          {['all', 'won', 'lost', 'pending', 'active'].map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 text-sm rounded-md transition-all capitalize ${
                statusFilter === s ? 'bg-white shadow-sm font-medium text-gray-900' : 'text-gray-500 hover:text-gray-700'
              }`}>
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        {negotiations.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">No negotiations found.</div>
        ) : (
          <div className="divide-y divide-gray-50">
            {negotiations.map(n => (
              <div key={n.id}>
                <div
                  className="px-5 py-4 flex items-center gap-4 hover:bg-gray-50 cursor-pointer"
                  onClick={() => setExpanded(expanded === n.id ? null : n.id)}
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 truncate">{n.product_name || 'Unknown product'}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{new Date(n.created_at).toLocaleString()}</p>
                  </div>
                  <div className="text-sm text-gray-600 w-32 text-right">
                    ${n.list_price} {n.deal_price ? `→ $${n.deal_price}` : ''}
                  </div>
                  <div className="w-16 text-center">
                    {n.deal_price ? (
                      <span className="text-sm font-medium text-red-500">
                        −{((n.list_price - n.deal_price) / n.list_price * 100).toFixed(0)}%
                      </span>
                    ) : '—'}
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[n.status] || 'bg-gray-100 text-gray-600'}`}>
                    {n.status}
                  </span>
                  <span className="text-gray-400 text-sm">{expanded === n.id ? '▲' : '▼'}</span>
                </div>
                {expanded === n.id && (
                  <div className="px-5 pb-5">
                    <div className="bg-gray-50 rounded-xl p-4">
                      <div className="grid grid-cols-3 gap-4 mb-4 text-sm">
                        <div><span className="text-gray-400">Floor price</span><br /><strong>${n.floor_price}</strong></div>
                        <div><span className="text-gray-400">Broker fee</span><br /><strong>{n.broker_fee ? `$${n.broker_fee}` : '—'}</strong></div>
                        <div><span className="text-gray-400">Tone used</span><br /><strong className="capitalize">{n.tone_used || '—'}</strong></div>
                      </div>
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Conversation</p>
                      <div className="space-y-2 max-h-64 overflow-y-auto">
                        {(n.messages || []).map((msg, i) => (
                          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                            <div className={`max-w-sm px-3 py-2 rounded-xl text-sm ${
                              msg.role === 'user'
                                ? 'bg-indigo-600 text-white'
                                : 'bg-white text-gray-800 border border-gray-100'
                            }`}>
                              {msg.content}
                            </div>
                          </div>
                        ))}
                        {(n.messages || []).length === 0 && (
                          <p className="text-xs text-gray-400">No messages recorded</p>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
