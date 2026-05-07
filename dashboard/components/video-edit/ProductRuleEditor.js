'use client';
import { useEffect, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL || 'https://botiga-api-two.vercel.app';

// Per-product negotiation rule editor — drops in below a TagRow when
// the merchant clicks "Rules" on a tagged product. Sets max_discount_pct
// override for that specific product handle.
export default function ProductRuleEditor({ merchantId, productHandle, productName }) {
  const [rule, setRule] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [maxDiscount, setMaxDiscount] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${API}/api/merchants/${merchantId}/products/${productHandle}/rule`);
        if (cancelled) return;
        if (r.ok) {
          const data = await r.json();
          setRule(data);
          setMaxDiscount(data?.max_discount_pct != null ? String(data.max_discount_pct) : '');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [merchantId, productHandle]);

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      const num = maxDiscount === '' ? null : parseFloat(maxDiscount);
      const r = await fetch(`${API}/api/merchants/${merchantId}/products/${productHandle}/rule`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ max_discount_pct: num }),
      });
      if (r.ok) {
        const data = await r.json();
        setRule(data);
        setSavedFlash(true);
        setTimeout(() => setSavedFlash(false), 1600);
      }
    } finally { setSaving(false); }
  }

  return (
    <div className="px-3 pb-3 pt-1 border-t border-gray-100 bg-gray-50/40 rounded-b-lg">
      <p className="text-[11px] text-gray-500 mb-2">
        Override the default max discount for <strong>{productName}</strong>.
        Leave blank to use store default.
      </p>
      {loading ? (
        <p className="text-xs text-gray-400">Loading…</p>
      ) : (
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-600 flex-shrink-0">Max discount</label>
          <div className="relative flex-1 max-w-[140px]">
            <input
              type="number" min="0" max="80" step="1"
              value={maxDiscount}
              onChange={e => setMaxDiscount(e.target.value)}
              placeholder="e.g. 25"
              className="w-full border border-gray-200 rounded-md pl-2 pr-6 py-1 text-xs focus:outline-none focus:border-indigo-500"
            />
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">%</span>
          </div>
          <button
            onClick={save}
            disabled={saving}
            className="text-xs font-medium px-3 py-1 rounded-md bg-gray-900 hover:bg-gray-800 text-white disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          {savedFlash && <span className="text-xs text-emerald-600 font-medium">✓</span>}
        </div>
      )}
    </div>
  );
}
