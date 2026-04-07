'use client';
import { useEffect, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL || 'https://api.botiga.ai';
const ADMIN_SECRET = process.env.NEXT_PUBLIC_ADMIN_SECRET || '';

const RISK_COLORS = {
  Good: 'bg-green-100 text-green-700',
  Watch: 'bg-yellow-100 text-yellow-700',
  'Churn Risk': 'bg-red-100 text-red-700'
};

export default function AdminMerchantsPage() {
  const [merchants, setMerchants] = useState([]);
  const [expanded, setExpanded] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const res = await fetch(`${API}/api/admin/merchants`, {
        headers: { 'x-admin-secret': ADMIN_SECRET }
      });
      if (res.ok) setMerchants(await res.json());
      setLoading(false);
    }
    load();
  }, []);

  return (
    <div className="p-8">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-900">All Merchants</h2>
        <p className="text-sm text-gray-500">{merchants.length} merchants total</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-400 text-sm">Loading...</div>
        ) : (
          <div className="divide-y divide-gray-50">
            {merchants.map(m => (
              <div key={m.id}>
                <div
                  className="px-5 py-4 hover:bg-gray-50 cursor-pointer"
                  onClick={() => setExpanded(expanded === m.id ? null : m.id)}
                >
                  <div className="flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900">{m.name || m.email}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{m.email} · {m.website_url || 'No website'}</p>
                    </div>
                    <div className="text-sm text-right">
                      <p className="font-semibold">${m.revenue_month?.toLocaleString()}</p>
                      <p className="text-xs text-gray-400">this month</p>
                    </div>
                    <div className="text-sm text-center w-20">
                      <p className="font-semibold">{m.win_rate_month}%</p>
                      <p className="text-xs text-gray-400">win rate</p>
                    </div>
                    <div className="text-sm text-center w-20">
                      <p className="font-semibold">{m.negotiations_today}</p>
                      <p className="text-xs text-gray-400">today</p>
                    </div>
                    <div className="text-sm text-center w-24">
                      <p className={`text-xs ${m.llm_cost_pct > 15 ? 'text-red-600 font-semibold' : 'text-gray-500'}`}>
                        LLM: {m.llm_cost_pct}%
                      </p>
                      <p className="text-xs text-gray-400">${m.llm_cost_month?.toFixed(3)}</p>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${RISK_COLORS[m.risk_badge] || 'bg-gray-100 text-gray-600'}`}>
                      {m.risk_badge}
                    </span>
                    <span className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full capitalize">{m.plan}</span>
                  </div>
                </div>
                {expanded === m.id && (
                  <div className="px-5 pb-4">
                    <div className="bg-gray-50 rounded-xl p-4 grid grid-cols-3 gap-4 text-sm">
                      <div><p className="text-gray-400 text-xs">Signed up</p><p className="font-medium">{new Date(m.created_at).toLocaleDateString()}</p></div>
                      <div><p className="text-gray-400 text-xs">Trial ends</p><p className="font-medium">{m.trial_ends_at ? new Date(m.trial_ends_at).toLocaleDateString() : 'Paid'}</p></div>
                      <div><p className="text-gray-400 text-xs">Tone</p><p className="font-medium capitalize">{m.merchant_settings?.tone || '—'}</p></div>
                      <div><p className="text-gray-400 text-xs">Max discount</p><p className="font-medium">{m.merchant_settings?.max_discount_pct}%</p></div>
                      <div><p className="text-gray-400 text-xs">Floor price</p><p className="font-medium">{m.merchant_settings?.floor_price_fixed ? `$${m.merchant_settings.floor_price_fixed}` : `${m.merchant_settings?.floor_price_pct || 0}%`}</p></div>
                      <div><p className="text-gray-400 text-xs">Broker fee</p><p className="font-medium">{m.merchant_settings?.broker_fee_pct}%</p></div>
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
