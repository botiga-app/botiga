'use client';
import { useEffect, useState } from 'react';
import { createClient } from '../../lib/supabase';

const API = process.env.NEXT_PUBLIC_API_URL || 'https://api.botiga.ai';

function MetricCard({ label, value, sub }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  );
}

const STATUS_COLORS = {
  won: 'bg-green-100 text-green-700',
  lost: 'bg-red-100 text-red-700',
  active: 'bg-blue-100 text-blue-700',
  pending: 'bg-yellow-100 text-yellow-700',
  recovered: 'bg-purple-100 text-purple-700'
};

export default function DashboardPage() {
  const [metrics, setMetrics] = useState(null);
  const [negotiations, setNegotiations] = useState([]);
  const [expanded, setExpanded] = useState(null);
  const [merchantId, setMerchantId] = useState(null);
  const supabase = createClient();

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setMerchantId(user.id);

      const [metricsRes, negsRes] = await Promise.all([
        fetch(`${API}/api/merchants/${user.id}/metrics`),
        fetch(`${API}/api/merchants/${user.id}/negotiations?limit=20`)
      ]);

      if (metricsRes.ok) setMetrics(await metricsRes.json());
      if (negsRes.ok) setNegotiations(await negsRes.json());
    }
    load();
  }, []);

  const m = metrics?.this_month;
  const w = metrics?.this_week;

  return (
    <div className="p-8">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-900">Overview</h2>
        <p className="text-sm text-gray-500">Your negotiation performance</p>
      </div>

      {/* Metrics grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <MetricCard
          label="Revenue recovered (month)"
          value={m ? `$${m.revenue_recovered.toLocaleString()}` : '—'}
          sub={w ? `$${w.revenue_recovered} this week` : null}
        />
        <MetricCard
          label="Deals closed (month)"
          value={m ? m.won : '—'}
          sub={m ? `${m.win_rate}% win rate` : null}
        />
        <MetricCard
          label="Avg discount given"
          value={m ? `${m.avg_discount_pct}%` : '—'}
        />
        <MetricCard
          label="Avg deal value"
          value={m ? `$${m.avg_deal_value}` : '—'}
          sub={m ? `${m.recovered} recovered` : null}
        />
      </div>

      {/* Negotiations table */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">Recent Negotiations</h3>
        </div>
        {negotiations.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">
            No negotiations yet. <a href="/dashboard/install" className="text-indigo-600 hover:underline">Install the widget</a> to get started.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
              <tr>
                <th className="px-5 py-3 text-left">Product</th>
                <th className="px-5 py-3 text-left">List → Deal</th>
                <th className="px-5 py-3 text-left">Discount</th>
                <th className="px-5 py-3 text-left">Broker Fee</th>
                <th className="px-5 py-3 text-left">Status</th>
                <th className="px-5 py-3 text-left">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {negotiations.map(n => (
                <>
                  <tr
                    key={n.id}
                    className="hover:bg-gray-50 cursor-pointer"
                    onClick={() => setExpanded(expanded === n.id ? null : n.id)}
                  >
                    <td className="px-5 py-3 font-medium text-gray-900 max-w-xs truncate">
                      {n.product_name || 'Unknown product'}
                    </td>
                    <td className="px-5 py-3 text-gray-600">
                      ${n.list_price} → {n.deal_price ? `$${n.deal_price}` : '—'}
                    </td>
                    <td className="px-5 py-3 text-gray-600">
                      {n.deal_price ? `${((n.list_price - n.deal_price) / n.list_price * 100).toFixed(1)}%` : '—'}
                    </td>
                    <td className="px-5 py-3 text-gray-600">
                      {n.broker_fee ? `$${n.broker_fee}` : '—'}
                    </td>
                    <td className="px-5 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[n.status] || 'bg-gray-100 text-gray-600'}`}>
                        {n.status}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-gray-400 text-xs">
                      {new Date(n.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                  {expanded === n.id && (
                    <tr key={`${n.id}-exp`}>
                      <td colSpan={6} className="px-5 pb-4">
                        <div className="bg-gray-50 rounded-lg p-4">
                          <p className="text-xs font-semibold text-gray-500 mb-3 uppercase tracking-wide">Conversation Replay</p>
                          <div className="space-y-2">
                            {(n.messages || []).map((msg, i) => (
                              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                <div className={`max-w-sm px-3 py-2 rounded-xl text-sm ${msg.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-800 border border-gray-100'}`}>
                                  {msg.content}
                                </div>
                              </div>
                            ))}
                            {(n.messages || []).length === 0 && (
                              <p className="text-xs text-gray-400">No messages recorded</p>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
