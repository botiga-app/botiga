'use client';
import { useEffect, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL || 'https://api.botiga.ai';
const ADMIN_SECRET = process.env.NEXT_PUBLIC_ADMIN_SECRET || '';

const SEVERITY_STYLES = {
  critical: { card: 'border-red-200 bg-red-50', badge: 'bg-red-100 text-red-700', icon: '🚨' },
  warning: { card: 'border-yellow-200 bg-yellow-50', badge: 'bg-yellow-100 text-yellow-700', icon: '⚠️' },
  info: { card: 'border-blue-200 bg-blue-50', badge: 'bg-blue-100 text-blue-700', icon: 'ℹ️' }
};

const TYPE_LABELS = {
  floor_breach: 'Floor Price Breach',
  high_llm_cost: 'High LLM Cost',
  churn_risk: 'Churn Risk',
  idle: 'Idle Merchant'
};

export default function AdminAlertsPage() {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);

  async function fetchAlerts() {
    const res = await fetch(`${API}/api/admin/alerts`, {
      headers: { 'x-admin-secret': ADMIN_SECRET }
    });
    if (res.ok) setAlerts(await res.json());
    setLoading(false);
  }

  async function resolve(id) {
    await fetch(`${API}/api/admin/alerts/${id}/resolve`, {
      method: 'POST',
      headers: { 'x-admin-secret': ADMIN_SECRET }
    });
    setAlerts(a => a.filter(al => al.id !== id));
  }

  useEffect(() => { fetchAlerts(); }, []);

  const grouped = {};
  for (const a of alerts) {
    if (!grouped[a.severity]) grouped[a.severity] = [];
    grouped[a.severity].push(a);
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Alerts</h2>
          <p className="text-sm text-gray-500">{alerts.length} unresolved alerts</p>
        </div>
        <button onClick={fetchAlerts}
          className="text-sm bg-white border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50">
          Refresh
        </button>
      </div>

      {loading ? (
        <p className="text-gray-400 text-sm">Loading alerts...</p>
      ) : alerts.length === 0 ? (
        <div className="bg-green-50 border border-green-100 rounded-xl p-8 text-center">
          <p className="text-green-700 font-medium">✅ All clear — no unresolved alerts</p>
        </div>
      ) : (
        <div className="space-y-3">
          {['critical', 'warning', 'info'].map(severity => (
            (grouped[severity] || []).map(alert => {
              const style = SEVERITY_STYLES[severity] || SEVERITY_STYLES.info;
              return (
                <div key={alert.id} className={`border rounded-xl p-4 flex items-start gap-4 ${style.card}`}>
                  <span className="text-xl mt-0.5">{style.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${style.badge}`}>
                        {TYPE_LABELS[alert.type] || alert.type}
                      </span>
                      <span className="text-xs text-gray-500">
                        {alert.merchants?.name || alert.merchant_id?.slice(0, 8)}
                      </span>
                      <span className="text-xs text-gray-400">
                        {new Date(alert.created_at).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-sm text-gray-700">{alert.message}</p>
                  </div>
                  <button
                    onClick={() => resolve(alert.id)}
                    className="text-xs text-gray-500 hover:text-gray-700 border border-gray-200 bg-white px-3 py-1.5 rounded-lg hover:bg-gray-50 flex-shrink-0"
                  >
                    Resolve
                  </button>
                </div>
              );
            })
          ))}
        </div>
      )}
    </div>
  );
}
