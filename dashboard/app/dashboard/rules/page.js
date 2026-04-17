'use client';
import { useEffect, useState, useCallback, useMemo } from 'react';
import { createClient } from '../../../lib/supabase';

const API = process.env.NEXT_PUBLIC_API_URL || 'https://api.botiga.ai';

export default function RulesPage() {
  const [merchantId, setMerchantId] = useState(null);
  const [products, setProducts] = useState([]);
  const [tagRules, setTagRules] = useState({});
  const [collections, setCollections] = useState([]);
  const [collectionsLoading, setCollectionsLoading] = useState(false);
  const [globalDiscount, setGlobalDiscount] = useState(20);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [viewBy, setViewBy] = useState('products'); // 'products' | 'tags' | 'collections'
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState(new Set());
  const [saving, setSaving] = useState({});
  const [bulkDiscount, setBulkDiscount] = useState('');
  const [bulkLoading, setBulkLoading] = useState(false);
  const supabase = createClient();

  // Derive unique tags from products
  const tags = useMemo(() => {
    const tagMap = {};
    for (const p of products) {
      for (const tag of (p.tags || [])) {
        if (!tagMap[tag]) tagMap[tag] = { tag, products: [] };
        tagMap[tag].products.push(p);
      }
    }
    return Object.values(tagMap).sort((a, b) => b.products.length - a.products.length);
  }, [products]);

  // Filtered products list
  const filtered = useMemo(() => {
    return products.filter(p => {
      const isEnabled = p.rule ? p.rule.negotiable : true;
      if (filter === 'enabled' && !isEnabled) return false;
      if (filter === 'disabled' && isEnabled) return false;
      if (search && !p.title.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [products, filter, search]);

  // Filtered tags list
  const filteredTags = useMemo(() => {
    if (!search) return tags;
    return tags.filter(t => t.tag.toLowerCase().includes(search.toLowerCase()));
  }, [tags, search]);

  // Filtered collections list
  const filteredCollections = useMemo(() => {
    if (!search) return collections;
    return collections.filter(c => c.title.toLowerCase().includes(search.toLowerCase()));
  }, [collections, search]);

  const load = useCallback(async (mid) => {
    setLoading(true);
    try {
      const [productsRes, merchantRes] = await Promise.all([
        fetch(`${API}/api/merchants/${mid}/shopify-products`),
        fetch(`${API}/api/merchants/${mid}`)
      ]);
      const productsData = await productsRes.json();
      const merchantData = await merchantRes.json();

      if (productsData.error === 'no_shopify') {
        setError('no_shopify');
      } else if (productsData.error) {
        setError(productsData.error);
      } else if (productsData.products) {
        setProducts(productsData.products);
        setTagRules(productsData.tag_rules || {});
      }

      const disc = merchantData?.merchant_settings?.max_discount_pct;
      if (disc) setGlobalDiscount(disc);
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }, []);

  async function loadCollections(mid) {
    setCollectionsLoading(true);
    try {
      const res = await fetch(`${API}/api/merchants/${mid}/shopify-collections`);
      const data = await res.json();
      if (data.collections) setCollections(data.collections);
    } catch (e) {}
    setCollectionsLoading(false);
  }

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setMerchantId(user.id);
      await load(user.id);
    }
    init();
  }, [load]);

  // Load collections lazily when tab is clicked
  useEffect(() => {
    if (viewBy === 'collections' && merchantId && collections.length === 0 && !collectionsLoading) {
      loadCollections(merchantId);
    }
  }, [viewBy, merchantId]);

  // ── Product rule actions ─────────────────────────────────────────────
  async function setProductRule(product, negotiable, maxDiscount) {
    setSaving(s => ({ ...s, [product.handle]: true }));
    const body = {
      rule_type: 'product',
      entity_id: product.handle,
      entity_name: product.title,
      negotiable,
      max_discount_pct: maxDiscount != null && maxDiscount !== '' ? parseInt(maxDiscount) : null
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

  async function clearProductRule(product) {
    if (!product.rule) return;
    setSaving(s => ({ ...s, [product.handle]: true }));
    await fetch(`${API}/api/merchants/${merchantId}/rules/${product.rule.id}`, { method: 'DELETE' });
    setProducts(prev => prev.map(p => p.handle === product.handle ? { ...p, rule: null } : p));
    setSaving(s => ({ ...s, [product.handle]: false }));
  }

  // ── Tag rule actions ─────────────────────────────────────────────────
  async function setTagRule(tag, negotiable, maxDiscount) {
    setSaving(s => ({ ...s, [`tag:${tag}`]: true }));
    const body = {
      rule_type: 'tag',
      entity_id: tag,
      entity_name: tag,
      negotiable,
      max_discount_pct: maxDiscount != null && maxDiscount !== '' ? parseInt(maxDiscount) : null
    };
    const res = await fetch(`${API}/api/merchants/${merchantId}/rules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (res.ok) {
      const rule = await res.json();
      setTagRules(prev => ({ ...prev, [tag]: rule }));
    }
    setSaving(s => ({ ...s, [`tag:${tag}`]: false }));
  }

  async function clearTagRule(tag) {
    const rule = tagRules[tag];
    if (!rule) return;
    setSaving(s => ({ ...s, [`tag:${tag}`]: true }));
    await fetch(`${API}/api/merchants/${merchantId}/rules/${rule.id}`, { method: 'DELETE' });
    setTagRules(prev => { const n = { ...prev }; delete n[tag]; return n; });
    setSaving(s => ({ ...s, [`tag:${tag}`]: false }));
  }

  // ── Collection rule actions ──────────────────────────────────────────
  async function setCollectionRule(col, negotiable, maxDiscount) {
    setSaving(s => ({ ...s, [`col:${col.handle}`]: true }));
    const body = {
      rule_type: 'collection',
      entity_id: col.handle,
      entity_name: col.title,
      negotiable,
      max_discount_pct: maxDiscount != null && maxDiscount !== '' ? parseInt(maxDiscount) : null
    };
    const res = await fetch(`${API}/api/merchants/${merchantId}/rules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (res.ok) {
      const rule = await res.json();
      setCollections(prev => prev.map(c => c.handle === col.handle ? { ...c, rule } : c));
    }
    setSaving(s => ({ ...s, [`col:${col.handle}`]: false }));
  }

  async function clearCollectionRule(col) {
    if (!col.rule) return;
    setSaving(s => ({ ...s, [`col:${col.handle}`]: true }));
    await fetch(`${API}/api/merchants/${merchantId}/rules/${col.rule.id}`, { method: 'DELETE' });
    setCollections(prev => prev.map(c => c.handle === col.handle ? { ...c, rule: null } : c));
    setSaving(s => ({ ...s, [`col:${col.handle}`]: false }));
  }

  // ── Bulk actions (products view) ─────────────────────────────────────
  async function bulkSetRule(negotiable, maxDiscount) {
    setBulkLoading(true);
    const targets = products.filter(p => selected.has(p.handle));
    await Promise.all(targets.map(p =>
      setProductRule(p, negotiable,
        maxDiscount !== undefined ? maxDiscount : (p.rule?.max_discount_pct ?? null)
      )
    ));
    setSelected(new Set());
    setBulkLoading(false);
  }

  async function bulkReset() {
    setBulkLoading(true);
    const targets = products.filter(p => selected.has(p.handle) && p.rule);
    await Promise.all(targets.map(p => clearProductRule(p)));
    setSelected(new Set());
    setBulkLoading(false);
  }

  function toggleSelect(handle) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(handle) ? next.delete(handle) : next.add(handle);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === filtered.length && filtered.length > 0) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map(p => p.handle)));
    }
  }

  // ── Shared toggle component ──────────────────────────────────────────
  function Toggle({ enabled, onChange, disabled }) {
    return (
      <button
        disabled={disabled}
        onClick={onChange}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${enabled ? 'bg-indigo-600' : 'bg-gray-200'} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'}`} />
      </button>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────
  if (loading) return <div className="p-8 text-sm text-gray-400">Loading…</div>;

  if (error) {
    return (
      <div className="p-8 max-w-2xl space-y-3">
        <h2 className="text-xl font-bold text-gray-900">Negotiation Rules</h2>
        {error === 'no_shopify' ? (
          <div className="bg-yellow-50 border border-yellow-100 rounded-xl p-6 text-sm text-yellow-800">
            <strong>Shopify not connected.</strong> Connect your store to manage negotiation rules.
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

  const allSelectedOnPage = filtered.length > 0 && selected.size === filtered.length;

  return (
    <div className="p-8 max-w-5xl space-y-5">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-gray-900">Negotiation Rules</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Set negotiation rules by product, tag, or collection. Product rules override tag/collection rules. Global default: <strong>{globalDiscount}% max discount</strong>. Configure in <a href="/dashboard/settings" className="text-indigo-600 hover:underline">Settings</a>.
        </p>
      </div>

      {/* View by + Search + Filter row */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* View by tabs */}
        <div className="flex bg-gray-100 rounded-lg p-1 gap-1">
          {[
            { key: 'products', label: 'Products' },
            { key: 'tags', label: 'Tags' },
            { key: 'collections', label: 'Collections' }
          ].map(v => (
            <button key={v.key} onClick={() => { setViewBy(v.key); setSearch(''); setSelected(new Set()); }}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${viewBy === v.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              {v.label}
              {v.key === 'tags' && tags.length > 0 && <span className="ml-1.5 text-xs bg-gray-200 text-gray-600 rounded-full px-1.5 py-0.5">{tags.length}</span>}
              {v.key === 'products' && <span className="ml-1.5 text-xs bg-gray-200 text-gray-600 rounded-full px-1.5 py-0.5">{products.length}</span>}
            </button>
          ))}
        </div>

        {/* Filter (products only) */}
        {viewBy === 'products' && (
          <div className="flex bg-gray-100 rounded-lg p-1 gap-1">
            {[['all', 'All'], ['enabled', 'Enabled'], ['disabled', 'Disabled']].map(([f, label]) => (
              <button key={f} onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${filter === f ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                {label}
              </button>
            ))}
          </div>
        )}

        <input
          type="text"
          placeholder={viewBy === 'products' ? 'Search products…' : viewBy === 'tags' ? 'Search tags…' : 'Search collections…'}
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 min-w-40 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400"
        />
      </div>

      {/* Bulk action bar */}
      {viewBy === 'products' && selected.size > 0 && (
        <div className="flex items-center gap-3 flex-wrap bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-3">
          <span className="text-sm font-medium text-indigo-700">{selected.size} selected</span>
          <div className="h-4 w-px bg-indigo-200" />
          <button disabled={bulkLoading} onClick={() => bulkSetRule(true)}
            className="text-sm text-indigo-700 hover:text-indigo-900 font-medium disabled:opacity-50">
            Enable all
          </button>
          <button disabled={bulkLoading} onClick={() => bulkSetRule(false)}
            className="text-sm text-red-600 hover:text-red-800 font-medium disabled:opacity-50">
            Disable all
          </button>
          <div className="flex items-center gap-1.5">
            <input
              type="number" min={1} max={100} placeholder="Discount %"
              value={bulkDiscount}
              onChange={e => setBulkDiscount(e.target.value)}
              className="w-28 border border-indigo-200 bg-white rounded-lg px-2 py-1 text-sm focus:outline-none focus:border-indigo-500"
            />
            <button disabled={bulkLoading || !bulkDiscount}
              onClick={() => { bulkSetRule(true, bulkDiscount); setBulkDiscount(''); }}
              className="text-sm bg-indigo-600 text-white px-3 py-1 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
              Set discount
            </button>
          </div>
          <div className="h-4 w-px bg-indigo-200" />
          <button disabled={bulkLoading} onClick={bulkReset}
            className="text-sm text-gray-500 hover:text-gray-700 disabled:opacity-50">
            Reset to global
          </button>
          <button onClick={() => setSelected(new Set())}
            className="ml-auto text-xs text-gray-400 hover:text-gray-600">
            ✕ Clear
          </button>
        </div>
      )}

      {/* ── PRODUCTS TABLE ── */}
      {viewBy === 'products' && (
        <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[auto_auto_1fr_auto_auto_auto_auto] gap-3 px-5 py-3 bg-gray-50 border-b border-gray-100 text-xs font-medium text-gray-500 uppercase tracking-wide items-center">
            <input
              type="checkbox"
              checked={allSelectedOnPage}
              onChange={toggleSelectAll}
              className="w-4 h-4 rounded text-indigo-600 cursor-pointer"
            />
            <div className="w-10"></div>
            <div>Product</div>
            <div className="w-20 text-right">Price</div>
            <div className="w-28 text-center">Negotiable</div>
            <div className="w-36 text-center">Max discount</div>
            <div className="w-16 text-center">Override</div>
          </div>

          {filtered.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-gray-400">No products found</div>
          ) : (
            filtered.map(product => {
              const hasRule = !!product.rule;
              const isEnabled = hasRule ? product.rule.negotiable : true; // inherit global = enabled
              const ruleDiscount = product.rule?.max_discount_pct;
              const isSaving = saving[product.handle];

              return (
                <div key={product.handle}
                  className="grid grid-cols-[auto_auto_1fr_auto_auto_auto_auto] gap-3 items-center px-5 py-3.5 border-b border-gray-50 hover:bg-gray-50/50 transition-colors">

                  {/* Checkbox */}
                  <input
                    type="checkbox"
                    checked={selected.has(product.handle)}
                    onChange={() => toggleSelect(product.handle)}
                    className="w-4 h-4 rounded text-indigo-600 cursor-pointer"
                  />

                  {/* Image */}
                  <div className="w-10 h-10 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0">
                    {product.image
                      ? <img src={product.image} alt="" className="w-full h-full object-cover" />
                      : <div className="w-full h-full flex items-center justify-center text-gray-300 text-xs">?</div>}
                  </div>

                  {/* Name + tags */}
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{product.title}</p>
                    <p className="text-xs text-gray-400 font-mono truncate">{product.handle}</p>
                    {product.tags?.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {product.tags.slice(0, 3).map(tag => (
                          <span key={tag} className="text-xs bg-gray-100 text-gray-500 rounded px-1.5 py-0.5">{tag}</span>
                        ))}
                        {product.tags.length > 3 && <span className="text-xs text-gray-400">+{product.tags.length - 3}</span>}
                      </div>
                    )}
                  </div>

                  {/* Price */}
                  <div className="w-20 text-right text-sm text-gray-600">
                    {product.price ? `$${parseFloat(product.price).toFixed(2)}` : '—'}
                  </div>

                  {/* Toggle */}
                  <div className="w-28 flex justify-center">
                    <Toggle
                      enabled={isEnabled}
                      disabled={isSaving}
                      onChange={() => {
                        if (isEnabled) {
                          setProductRule(product, false, null);
                        } else {
                          if (hasRule) {
                            setProductRule(product, true, ruleDiscount ?? null);
                          } else {
                            clearProductRule(product); // no-op since no rule, just toggle back visually
                          }
                        }
                      }}
                    />
                  </div>

                  {/* Max discount */}
                  <div className="w-36 flex justify-center">
                    {isEnabled ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="number" min={1} max={100}
                          defaultValue={ruleDiscount || ''}
                          placeholder={`${globalDiscount} (global)`}
                          onBlur={e => {
                            const val = e.target.value ? parseInt(e.target.value) : null;
                            if (val !== (ruleDiscount || null)) {
                              setProductRule(product, isEnabled, val);
                            }
                          }}
                          className="w-24 border border-gray-200 rounded-lg px-2 py-1 text-sm text-center focus:outline-none focus:border-indigo-400"
                        />
                        <span className="text-xs text-gray-400">%</span>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-300">—</span>
                    )}
                  </div>

                  {/* Override badge / reset */}
                  <div className="w-16 flex justify-center">
                    {hasRule ? (
                      <button
                        onClick={() => clearProductRule(product)}
                        disabled={isSaving}
                        title="Reset to global defaults"
                        className="text-xs text-gray-400 hover:text-red-500 border border-gray-200 hover:border-red-200 rounded px-1.5 py-0.5 transition-colors"
                      >
                        Reset
                      </button>
                    ) : (
                      <span className="text-xs text-gray-300 italic">Global</span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ── TAGS TABLE ── */}
      {viewBy === 'tags' && (
        <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
          <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-4 px-5 py-3 bg-gray-50 border-b border-gray-100 text-xs font-medium text-gray-500 uppercase tracking-wide">
            <div>Tag</div>
            <div className="w-20 text-center">Products</div>
            <div className="w-28 text-center">Negotiable</div>
            <div className="w-36 text-center">Max discount</div>
            <div className="w-16 text-center">Override</div>
          </div>

          {filteredTags.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-gray-400">
              {products.length === 0 ? 'No products loaded' : 'No tags found — add tags to your Shopify products'}
            </div>
          ) : (
            filteredTags.map(({ tag, products: tagProducts }) => {
              const rule = tagRules[tag];
              const isEnabled = rule ? rule.negotiable : true;
              const isSaving = saving[`tag:${tag}`];

              return (
                <div key={tag}
                  className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-4 items-center px-5 py-3.5 border-b border-gray-50 hover:bg-gray-50/50 transition-colors">

                  {/* Tag name */}
                  <div>
                    <p className="text-sm font-medium text-gray-900">{tag}</p>
                    <p className="text-xs text-gray-400">{tagProducts.slice(0, 2).map(p => p.title).join(', ')}{tagProducts.length > 2 ? ` +${tagProducts.length - 2} more` : ''}</p>
                  </div>

                  {/* Product count */}
                  <div className="w-20 text-center">
                    <span className="text-sm text-gray-500">{tagProducts.length}</span>
                  </div>

                  {/* Toggle */}
                  <div className="w-28 flex justify-center">
                    <Toggle
                      enabled={isEnabled}
                      disabled={isSaving}
                      onChange={() => {
                        if (isEnabled && rule) setTagRule(tag, false, null);
                        else if (!isEnabled) setTagRule(tag, true, rule?.max_discount_pct ?? null);
                        else setTagRule(tag, false, null); // no rule + currently shown as enabled → create disabled rule
                      }}
                    />
                  </div>

                  {/* Max discount */}
                  <div className="w-36 flex justify-center">
                    {isEnabled ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="number" min={1} max={100}
                          defaultValue={rule?.max_discount_pct || ''}
                          placeholder={`${globalDiscount} (global)`}
                          onBlur={e => {
                            const val = e.target.value ? parseInt(e.target.value) : null;
                            if (val !== (rule?.max_discount_pct || null)) {
                              setTagRule(tag, isEnabled, val);
                            }
                          }}
                          className="w-24 border border-gray-200 rounded-lg px-2 py-1 text-sm text-center focus:outline-none focus:border-indigo-400"
                        />
                        <span className="text-xs text-gray-400">%</span>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-300">—</span>
                    )}
                  </div>

                  {/* Reset */}
                  <div className="w-16 flex justify-center">
                    {rule ? (
                      <button onClick={() => clearTagRule(tag)} disabled={isSaving}
                        className="text-xs text-gray-400 hover:text-red-500 border border-gray-200 hover:border-red-200 rounded px-1.5 py-0.5 transition-colors">
                        Reset
                      </button>
                    ) : (
                      <span className="text-xs text-gray-300 italic">Global</span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ── COLLECTIONS TABLE ── */}
      {viewBy === 'collections' && (
        <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
          <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-4 px-5 py-3 bg-gray-50 border-b border-gray-100 text-xs font-medium text-gray-500 uppercase tracking-wide">
            <div>Collection</div>
            <div className="w-24 text-center">Products</div>
            <div className="w-28 text-center">Negotiable</div>
            <div className="w-36 text-center">Max discount</div>
            <div className="w-16 text-center">Override</div>
          </div>

          {collectionsLoading ? (
            <div className="px-5 py-10 text-center text-sm text-gray-400">Loading collections…</div>
          ) : filteredCollections.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-gray-400">No collections found</div>
          ) : (
            filteredCollections.map(col => {
              const isEnabled = col.rule ? col.rule.negotiable : true;
              const isSaving = saving[`col:${col.handle}`];

              return (
                <div key={col.handle}
                  className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-4 items-center px-5 py-3.5 border-b border-gray-50 hover:bg-gray-50/50 transition-colors">

                  <div>
                    <p className="text-sm font-medium text-gray-900">{col.title}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <p className="text-xs text-gray-400 font-mono">{col.handle}</p>
                      <span className="text-xs text-gray-300 border border-gray-200 rounded px-1">{col.type}</span>
                    </div>
                  </div>

                  <div className="w-24 text-center">
                    <span className="text-sm text-gray-500">{col.products_count || '—'}</span>
                  </div>

                  <div className="w-28 flex justify-center">
                    <Toggle
                      enabled={isEnabled}
                      disabled={isSaving}
                      onChange={() => {
                        if (isEnabled && col.rule) setCollectionRule(col, false, null);
                        else if (!isEnabled) setCollectionRule(col, true, col.rule?.max_discount_pct ?? null);
                        else setCollectionRule(col, false, null);
                      }}
                    />
                  </div>

                  <div className="w-36 flex justify-center">
                    {isEnabled ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="number" min={1} max={100}
                          defaultValue={col.rule?.max_discount_pct || ''}
                          placeholder={`${globalDiscount} (global)`}
                          onBlur={e => {
                            const val = e.target.value ? parseInt(e.target.value) : null;
                            if (val !== (col.rule?.max_discount_pct || null)) {
                              setCollectionRule(col, isEnabled, val);
                            }
                          }}
                          className="w-24 border border-gray-200 rounded-lg px-2 py-1 text-sm text-center focus:outline-none focus:border-indigo-400"
                        />
                        <span className="text-xs text-gray-400">%</span>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-300">—</span>
                    )}
                  </div>

                  <div className="w-16 flex justify-center">
                    {col.rule ? (
                      <button onClick={() => clearCollectionRule(col)} disabled={isSaving}
                        className="text-xs text-gray-400 hover:text-red-500 border border-gray-200 hover:border-red-200 rounded px-1.5 py-0.5 transition-colors">
                        Reset
                      </button>
                    ) : (
                      <span className="text-xs text-gray-300 italic">Global</span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Footer */}
      <p className="text-xs text-gray-400 text-center">
        {viewBy === 'products' && `Showing ${filtered.length} of ${products.length} products · Product rules override tag and collection rules`}
        {viewBy === 'tags' && `${tags.length} unique tags · Tag rules override collection rules but not product rules`}
        {viewBy === 'collections' && `${collections.length} collections · Collection rules apply when no product or tag rule is set`}
      </p>
    </div>
  );
}
