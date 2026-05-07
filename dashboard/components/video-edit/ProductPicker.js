'use client';
import { useEffect, useMemo, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL || 'https://botiga-api-two.vercel.app';

// Search + filter UI for tagging Shopify products on a video. Loads
// /merchants/:id/shopify-products and /shopify-collections (authed),
// extracts the tag union, lets the merchant filter All / Collection /
// Tag, and POSTs /videos/:id/tags on click.
//
// Wildcard search matches against title + product_type + vendor + tags
// (case-insensitive substring) so a merchant can find products by any
// metadata, not just title.
//
// Optional shopifyDomain prop adds an ↗ "Edit on Shopify" link per
// result, opening /admin/products/:id in a new tab.
export default function ProductPicker({ video, merchantId, existingTagIds, onTagAdded, shopifyDomain }) {
  const [query, setQuery] = useState('');
  const [filterMode, setFilterMode] = useState('all');
  const [filterValue, setFilterValue] = useState('');
  const [products, setProducts] = useState([]);
  const [collections, setCollections] = useState([]);
  const [allTags, setAllTags] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(null);
  const [fetchError, setFetchError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setFetchError(null);
      try {
        const [pRes, cRes] = await Promise.all([
          fetch(`${API}/api/merchants/${merchantId}/shopify-products`),
          fetch(`${API}/api/merchants/${merchantId}/shopify-collections`),
        ]);
        if (cancelled) return;
        if (pRes.ok) {
          const pData = await pRes.json();
          if (pData.error === 'no_shopify') {
            setFetchError('Connect your Shopify store first to load products.');
          } else if (pData.error === 'token_invalid') {
            setFetchError(pData.message || 'Reinstall Botiga — Shopify rejected the access token.');
          } else {
            setProducts(pData.products || []);
            const tagSet = new Set();
            (pData.products || []).forEach(p => (p.tags || []).forEach(t => tagSet.add(t)));
            setAllTags([...tagSet].sort());
          }
        } else {
          const body = await pRes.json().catch(() => ({}));
          setFetchError(body.message || body.error || `Couldn't load products (HTTP ${pRes.status})`);
        }
        if (cRes.ok) {
          const cData = await cRes.json();
          setCollections(cData.collections || []);
        }
      } catch (err) {
        if (!cancelled) setFetchError(err.message || 'Network error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [merchantId]);

  const filtered = useMemo(() => {
    let list = products;
    if (filterMode === 'collection' && filterValue) {
      list = list.filter(p => (p.collections || []).includes(filterValue));
    } else if (filterMode === 'tag' && filterValue) {
      list = list.filter(p => (p.tags || []).includes(filterValue));
    }
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(p => {
        if ((p.title || '').toLowerCase().includes(q)) return true;
        if ((p.product_type || '').toLowerCase().includes(q)) return true;
        if ((p.vendor || '').toLowerCase().includes(q)) return true;
        if ((p.tags || []).some(t => String(t).toLowerCase().includes(q))) return true;
        return false;
      });
    }
    return list.slice(0, 80);
  }, [products, filterMode, filterValue, query]);

  async function addProduct(p) {
    setAdding(p.id);
    try {
      const r = await fetch(`${API}/api/videos/${video.id}/tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchant_id: merchantId,
          shopify_product_id: String(p.id),
          shopify_variant_id: p.variant_id || null,
          product_name: p.title,
          product_handle: p.handle,
          price: p.price ? parseFloat(p.price) : null,
          compare_at_price: p.compare_at_price ? parseFloat(p.compare_at_price) : null,
          image_url: p.image || null,
        }),
      });
      if (r.ok) {
        const data = await r.json();
        onTagAdded && onTagAdded(data);
        setQuery('');
      }
    } finally { setAdding(null); }
  }

  return (
    <div className="space-y-2.5">
      <div className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search by name, type, tag, or vendor…"
          className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
        />
        <select
          value={filterMode}
          onChange={e => { setFilterMode(e.target.value); setFilterValue(''); }}
          className="border border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:border-indigo-500"
        >
          <option value="all">All ({products.length})</option>
          <option value="collection">By collection ({collections.length})</option>
          <option value="tag">By tag ({allTags.length})</option>
        </select>
      </div>

      {fetchError && (
        <div className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-md px-2.5 py-1.5">
          <strong>Couldn't load:</strong> {fetchError}
        </div>
      )}

      {filterMode === 'collection' && (
        collections.length === 0 ? (
          <div className="text-xs text-gray-500 bg-amber-50 border border-amber-100 rounded-md px-2.5 py-1.5">
            No collections defined in your Shopify store yet.
          </div>
        ) : (
          <select
            value={filterValue}
            onChange={e => setFilterValue(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
          >
            <option value="">Pick a collection… ({collections.length})</option>
            {collections.map(c => (
              <option key={c.id || c.handle} value={c.handle}>
                {c.title || c.handle}{c.products_count ? ` (${c.products_count})` : ''}
              </option>
            ))}
          </select>
        )
      )}
      {filterMode === 'tag' && (
        allTags.length === 0 ? (
          <div className="text-xs text-gray-500 bg-amber-50 border border-amber-100 rounded-md px-2.5 py-1.5">
            No product tags found.
          </div>
        ) : (
          <select
            value={filterValue}
            onChange={e => setFilterValue(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
          >
            <option value="">Pick a tag… ({allTags.length})</option>
            {allTags.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        )
      )}

      {loading ? (
        <div className="text-xs text-gray-400 py-3">Loading products…</div>
      ) : filtered.length === 0 ? (
        <div className="text-xs text-gray-400 py-3">
          {products.length === 0
            ? 'No Shopify products loaded yet. If you just installed, wait a moment and reopen.'
            : 'No matching products. Try a different filter or clear the search.'}
        </div>
      ) : (
        <div className="border border-gray-200 rounded-lg max-h-72 overflow-y-auto divide-y divide-gray-100">
          {filtered.map(p => {
            const already = existingTagIds && existingTagIds.has(String(p.id));
            const editUrl = shopifyDomain && p.id ? `https://${shopifyDomain}/admin/products/${p.id}` : null;
            return (
              <div key={p.id} className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 transition-colors">
                {p.image ? (
                  <img src={p.image} alt="" className="w-10 h-10 rounded object-cover bg-gray-100 flex-shrink-0" />
                ) : (
                  <div className="w-10 h-10 rounded bg-gray-100 flex-shrink-0 flex items-center justify-center text-base">📦</div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-gray-900 truncate">{p.title}</div>
                  <div className="text-xs text-gray-500">
                    {p.price && <span>${p.price}</span>}
                    {p.product_type && <span> · {p.product_type}</span>}
                  </div>
                </div>
                {editUrl && (
                  <a href={editUrl} target="_blank" rel="noreferrer" title="Edit on Shopify" className="text-gray-300 hover:text-indigo-600 text-[11px]">↗</a>
                )}
                <button
                  onClick={() => !already && addProduct(p)}
                  disabled={already || adding === p.id}
                  className={`text-[11px] font-semibold px-2.5 py-1 rounded-md ${already ? 'text-gray-400' : 'text-indigo-600 hover:bg-indigo-50'}`}>
                  {already ? 'Tagged' : adding === p.id ? '…' : 'Add'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
