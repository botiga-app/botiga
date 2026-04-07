'use client';
import { useEffect, useState } from 'react';

const STATUS_COLORS = {
  won: 'bg-green-100 text-green-700',
  lost: 'bg-red-100 text-red-700',
  active: 'bg-blue-100 text-blue-700',
  pending: 'bg-yellow-100 text-yellow-700',
  recovered: 'bg-purple-100 text-purple-700'
};

export default function NegotiationFeed({ merchantId }) {
  const [negotiations, setNegotiations] = useState([]);
  const [expanded, setExpanded] = useState(null);
  const API = process.env.NEXT_PUBLIC_API_URL || 'https://api.botiga.ai';

  useEffect(() => {
    if (!merchantId) return;
    fetch(`${API}/api/merchants/${merchantId}/negotiations?limit=10`)
      .then(r => r.json())
      .then(setNegotiations)
      .catch(() => {});
  }, [merchantId]);

  if (!negotiations.length) return null;

  return (
    <div className="divide-y divide-gray-50">
      {negotiations.map(n => (
        <div key={n.id}>
          <div
            className="px-5 py-3 flex items-center gap-3 hover:bg-gray-50 cursor-pointer text-sm"
            onClick={() => setExpanded(expanded === n.id ? null : n.id)}
          >
            <div className="flex-1 min-w-0 truncate font-medium text-gray-800">{n.product_name || '—'}</div>
            <div className="text-gray-500 text-xs">${n.list_price} → {n.deal_price ? `$${n.deal_price}` : '—'}</div>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[n.status]}`}>{n.status}</span>
          </div>
          {expanded === n.id && (
            <div className="px-5 pb-3">
              <div className="bg-gray-50 rounded-lg p-3 space-y-1.5 max-h-48 overflow-y-auto">
                {(n.messages || []).map((m, i) => (
                  <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`text-xs max-w-xs px-2.5 py-1.5 rounded-xl ${m.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-800 border border-gray-100'}`}>
                      {m.content}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
