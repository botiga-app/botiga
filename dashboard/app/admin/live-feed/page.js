'use client';
import { useEffect, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL || 'https://api.botiga.ai';
const ADMIN_SECRET = process.env.NEXT_PUBLIC_ADMIN_SECRET || '';

const STATUS_COLORS = {
  active: 'bg-green-100 text-green-700',
  pending: 'bg-yellow-100 text-yellow-700',
  won: 'bg-blue-100 text-blue-700',
  lost: 'bg-red-100 text-red-700'
};

export default function LiveFeedPage() {
  const [negotiations, setNegotiations] = useState([]);
  const [expanded, setExpanded] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);

  async function fetchActive() {
    try {
      const res = await fetch(`${API}/api/admin/negotiations?status=active`, {
        headers: { 'x-admin-secret': ADMIN_SECRET }
      });
      if (res.ok) {
        setNegotiations(await res.json());
        setLastRefresh(new Date());
      }
    } catch {}
  }

  useEffect(() => {
    fetchActive();
    const timer = setInterval(fetchActive, 5000);
    return () => clearInterval(timer);
  }, []);

  function floorRisk(n) {
    // Estimate how close last offer might be to floor
    const lastMsg = (n.messages || []).findLast(m => m.role === 'assistant');
    return n.messages?.length >= 5;
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Live Negotiation Feed</h2>
          <p className="text-sm text-gray-400">
            {negotiations.length} active · Auto-refreshes every 5s
            {lastRefresh && ` · Last: ${lastRefresh.toLocaleTimeString()}`}
          </p>
        </div>
        <button onClick={fetchActive}
          className="text-sm bg-white border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50">
          Refresh now
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        {negotiations.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">No active negotiations right now.</div>
        ) : (
          <div className="divide-y divide-gray-50">
            {negotiations.map(n => {
              const risk = floorRisk(n);
              return (
                <div key={n.id} className={risk ? 'border-l-4 border-red-400' : ''}>
                  <div
                    className="px-5 py-4 flex items-center gap-4 hover:bg-gray-50 cursor-pointer"
                    onClick={() => setExpanded(expanded === n.id ? null : n.id)}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm text-gray-900">{n.merchants?.name || n.merchant_id.slice(0, 8)}</p>
                      <p className="text-xs text-gray-500 truncate">{n.product_name}</p>
                    </div>
                    <div className="text-sm text-gray-600 text-right">
                      <div>${n.list_price}</div>
                      <div className="text-xs text-gray-400">floor: ${n.floor_price}</div>
                    </div>
                    <div className="text-xs text-gray-500 w-16 text-center">
                      {(n.messages || []).length / 2} turns
                    </div>
                    <div className="text-xs capitalize w-20">
                      {n.tone_used || '—'}
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[n.status] || 'bg-gray-100 text-gray-600'}`}>
                      {n.status}
                    </span>
                    {risk && <span className="text-xs text-red-500 font-medium">⚠ floor risk</span>}
                  </div>
                  {expanded === n.id && (
                    <div className="px-5 pb-4">
                      <div className="bg-gray-50 rounded-xl p-4 space-y-2 max-h-64 overflow-y-auto">
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
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
