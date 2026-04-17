'use client';
import { useEffect, useState, useCallback } from 'react';
import { createClient } from '../../../lib/supabase';

const API = process.env.NEXT_PUBLIC_API_URL || 'https://api.botiga.ai';

export default function RulesPage() {
  const [merchantId, setMerchantId] = useState(null);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all'); // 'all' | 'enabled'
  const [saving, setSaving] = useState({}); // handle → bool
  const supabase = createClient();

  const load = useCallback(async (mid) => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/merchants/${mid}/shopify-products`);
      const data = await res.json();
      if (data.error === 'no_shopify') {
        setError('no_shopify');
      } else if (data.error) {
        setError(data.error);
      } else if (data.products) {
        setProducts(data.products);
      }
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setMerchantId(user.id);
      await load(user.id);
    }
    init();
  }, [load]);

  async function setRule(product, negotiable, maxDiscount) {
    setSaving(s => ({ ...s, [product.handle]: true }));
    const body = {
      rule_type: 'product',
      entity_id: product.handle,
      entity_name: product.title,
      negotiable,
      max_discount_pct: maxDiscount != null ? parseInt(maxDiscount) : null
    };
    const res = await fetch(`${API}/api/merchants/${merchantId}/rules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (res.ok) {
      const rule = await res.json();
      setProducts(prev => prev.map(p => p.handle === product.handle ? { ...p, rule } : p));
    }
    setSaving(s => ({ ...s, [product.handle]: false }));
  }

  async function clearRule(product) {
    if (!product.rule) return;
    setSaving(s => ({ ...s, [product.handle]: true }));
    await fetch(`${API}/api/merchants/${merchantId}/rules/${product.rule.id}`, { method: 'DELETE' });
    setProducts(prev => prev.map(p => p.handle === product.handle ? { ...p, rule: null } : p));
    setSaving(s => ({ ...s, [product.handle]: false }));
  }

  const filtered = products.filter(p => {
    if (filter === 'enabled' && (!p.rule || !p.rule.negotiable)) return false;
    if (search && !p.title.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  if (loading) return <div className="p-8 text-sm text-gray-400">Loading products…</div>;

  if (error) {
    return (
      <div className="p-8 max-w-2xl space-y-3">
        <h2 className="text-xl font-bold text-gray-900">Product Rules</h2>
        {error === 'no_shopify' ? (
          <div className="bg-yellow-50 border border-yellow-100 rounded-xl p-6 text-sm text-yellow-800">
            <strong>Shopify not connected.</strong> Connect your Shopify store to manage per-product negotiation rules.
            <br /><a href="/dashboard/install" className="underline mt-2 inline-block">Go to Install →</a>
          </div>
        ) : (
          <div className="bg-red-50 border border-red-100 rounded-xl p-6 text-sm text-red-800">
            <strong>Failed to load products:</strong> <code className="ml-1">{error}</code>
            <br /><span className="text-red-600 mt-1 block">Check that your Shopify store is connected and the access token is valid.</span>
            <a href="/dashboard/install" className="underline mt-2 inline-block">Go to Install →</a>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="p-8 max-w-4xl space-y-5">
      <div>
        <h2 className="text-xl font-bold text-gray-900">Product Rules</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Toggle negotiation per product and set custom discount limits. Global defaults apply when no rule is set.
          Cart negotiation is separate — configure it in <a href="/dashboard/settings" className="text-indigo-600 hover:underline">Settings</a>.
        </p>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="flex bg-gray-100 rounded-lg p-1 gap-1">
          {['all', 'enabled'].map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${filter === f ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              {f === 'all' ? 'All products' : 'Negotiation enabled'}
            </button>
          ))}
        </div>
        <input
          type="text"
          placeholder="Search products…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400"
        />
      </div>

      {/* Table header */}
      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        <div className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-4 px-5 py-3 bg-gray-50 border-b border-gray-100 text-xs font-medium text-gray-500 uppercase tracking-wide">
          <div className="w-10"></div>
          <div>Product</div>
          <div className="w-24 text-right">Price</div>
          <div className="w-32 text-center">Negotiable</div>
          <div className="w-32 text-center">Max discount %</div>
        </div>

        {filtered.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-gray-400">No products found</div>
        ) : (
          filtered.map(product => {
            const isEnabled = product.rule?.negotiable !== false && product.rule !== null ? product.rule?.negotiable : false;
            const hasRule = !!product.rule;
            const isSaving = saving[product.handle];

            return (
              <div key={product.handle} className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-4 items-center px-5 py-3.5 border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                {/* Image */}
                <div className="w-10 h-10 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0">
                  {product.image
                    ? <img src={product.image} alt="" className="w-full h-full object-cover" />
                    : <div className="w-full h-full flex items-center justify-center text-gray-300 text-xs">?</div>}
                </div>

                {/* Name */}
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{product.title}</p>
                  <p className="text-xs text-gray-400 font-mono truncate">{product.handle}</p>
                  {product.product_type && <p className="text-xs text-gray-400">{product.product_type}</p>}
                </div>

                {/* Price */}
                <div className="w-24 text-right text-sm text-gray-600">
                  {product.price ? `$${parseFloat(product.price).toFixed(2)}` : '—'}
                </div>

                {/* Toggle */}
                <div className="w-32 flex justify-center">
                  <button
                    disabled={isSaving}
                    onClick={() => {
                      if (!hasRule || !isEnabled) {
                        setRule(product, true, product.rule?.max_discount_pct ?? null);
                      } else {
                        // Turn off — set negotiable=false rule
                        setRule(product, false, null);
                      }
                    }}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${isEnabled ? 'bg-indigo-600' : 'bg-gray-200'} ${isSaving ? 'opacity-50' : ''}`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${isEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                  </button>
                </div>

                {/* Max discount */}
                <div className="w-32 flex justify-center">
                  {isEnabled ? (
                    <div className="flex items-center gap-1">
                      <input
                        type="number" min={1} max={100}
                        defaultValue={product.rule?.max_discount_pct || ''}
                        placeholder="Global"
                        onBlur={e => {
                          const val = e.target.value ? parseInt(e.target.value) : null;
                          if (val !== (product.rule?.max_discount_pct || null)) {
                            setRule(product, true, val);
                          }
                        }}
                        className="w-20 border border-gray-200 rounded-lg px-2 py-1 text-sm text-center focus:outline-none focus:border-indigo-400"
                      />
                      <span className="text-xs text-gray-400">%</span>
                    </div>
                  ) : (
                    <span className="text-xs text-gray-300">—</span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <p className="text-xs text-gray-400 text-center">
        Showing {filtered.length} of {products.length} products · Discount limits override the global default when set
      </p>
    </div>
  );
}
