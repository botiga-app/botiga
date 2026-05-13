'use client';
import { useEffect, useState } from 'react';
import { createClient } from '../../../lib/supabase';

const API = process.env.NEXT_PUBLIC_API_URL || 'https://api.botiga.ai';

// Training Data dashboard — surfaces what the AI currently sees from the
// merchant's store. Mirrors Chatty (AVADA)'s "Knowledge / Data sources"
// surface: a count per source ("0 of 855 products learned"), a tab per
// source, a Refresh button to re-pull from Shopify.
//
// We don't have a separate vector store — Botiga reads catalog live every
// 10min from the merchant's Shopify. So "learned" here means "indexed and
// available to the AI right now". Refresh = bust the catalog cache.
export default function TrainingPage() {
  const [merchantId, setMerchantId] = useState(null);
  const [apiKey, setApiKey] = useState(null);
  const [merchant, setMerchant] = useState(null);
  const [catalog, setCatalog] = useState(null);
  const [instructions, setInstructions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState('products');
  const [search, setSearch] = useState('');
  const supabase = createClient();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      setMerchantId(user.id);

      const mRes = await fetch(`${API}/api/merchants/${user.id}`);
      if (!mRes.ok || cancelled) { setLoading(false); return; }
      const m = await mRes.json();
      setMerchant(m);
      setApiKey(m.api_key);
      await loadKnowledge(m.api_key, user.id, false);
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  async function loadKnowledge(key, mId, force) {
    const url = `${API}/api/widget/catalog?k=${encodeURIComponent(key)}` + (force ? '&refresh=1' : '');
    const [catRes, instRes] = await Promise.all([
      fetch(url),
      fetch(`${API}/api/merchants/${mId}/bot-instructions`),
    ]);
    if (catRes.ok) setCatalog(await catRes.json());
    if (instRes.ok) {
      const j = await instRes.json();
      setInstructions(j.instructions || j || []);
    }
  }

  async function refresh() {
    if (!apiKey || !merchantId || refreshing) return;
    setRefreshing(true);
    await loadKnowledge(apiKey, merchantId, true);
    setRefreshing(false);
  }

  if (loading) return <div className="p-8 text-gray-400 text-sm">Loading training data…</div>;

  const products = catalog?.products || [];
  const collections = catalog?.collections || [];
  const topTags = catalog?.top_tags || [];
  const totalProducts = catalog?.total_products ?? products.length;
  const inStock = catalog?.total_in_stock ?? products.filter(p => p.available).length;
  const totalCollections = catalog?.total_collections ?? collections.length;
  const brandStatements = (merchant?.merchant_settings?.[0] || merchant?.merchant_settings || {}).brand_value_statements || [];
  const filledStatements = (Array.isArray(brandStatements) ? brandStatements : []).filter(s => s && s.trim());
  const activeInstructions = instructions.filter(i => i.active);

  const sources = [
    { key: 'products', label: 'Products', icon: '🏷️', count: inStock, total: totalProducts, sub: `${inStock} of ${totalProducts} in stock` },
    { key: 'collections', label: 'Collections', icon: '📚', count: totalCollections, total: totalCollections, sub: `${totalCollections} categories indexed` },
    { key: 'tags', label: 'Tags', icon: '🔖', count: topTags.length, total: topTags.length, sub: `${topTags.length} tags discovered` },
    { key: 'instructions', label: 'Bot training', icon: '🎓', count: activeInstructions.length, total: instructions.length, sub: `${activeInstructions.length} active directives` },
    { key: 'brand', label: 'Brand voice', icon: '🪶', count: filledStatements.length, total: 5, sub: `${filledStatements.length} of 5 statements` },
  ];

  return (
    <div className="p-8 max-w-6xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Training data</h2>
          <p className="text-sm text-gray-500">What your AI concierge currently knows about your store. Refresh to re-pull live from Shopify.</p>
        </div>
        <button
          onClick={refresh}
          disabled={refreshing || !apiKey}
          className="flex-shrink-0 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2"
        >
          {refreshing ? <><Spinner /> Refreshing…</> : <>🔄 Refresh from store</>}
        </button>
      </div>

      {!apiKey && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
          No API key on file. <a href="/dashboard/install" className="underline font-semibold">Connect Shopify</a> to start training the AI.
        </div>
      )}

      {/* Source cards row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {sources.map(s => (
          <button
            key={s.key}
            onClick={() => setTab(s.key)}
            className={`text-left p-4 rounded-xl border-2 transition-all ${
              tab === s.key ? 'border-indigo-500 bg-indigo-50' : 'border-gray-100 bg-white hover:border-gray-200'
            }`}
          >
            <div className="flex items-center gap-2 text-xs font-semibold text-gray-600 uppercase tracking-wide">
              <span>{s.icon}</span> {s.label}
            </div>
            <div className="mt-2 text-2xl font-bold text-gray-900">{s.count}</div>
            <div className="text-xs text-gray-500 mt-0.5">{s.sub}</div>
          </button>
        ))}
      </div>

      {/* Tab body */}
      <div className="bg-white rounded-xl border border-gray-100 p-6">
        {tab === 'products' && (
          <ProductsList products={products} search={search} setSearch={setSearch} />
        )}
        {tab === 'collections' && (
          <CollectionsList collections={collections} />
        )}
        {tab === 'tags' && (
          <TagsList tags={topTags} />
        )}
        {tab === 'instructions' && (
          <InstructionsList instructions={instructions} />
        )}
        {tab === 'brand' && (
          <BrandList statements={filledStatements} />
        )}
      </div>

      {/* Last fetched footer */}
      {catalog?.fetched_at && (
        <div className="text-xs text-gray-400 text-right">
          Last refreshed {timeAgo(catalog.fetched_at)} from {catalog.source || 'your store'}
        </div>
      )}
    </div>
  );
}

function ProductsList({ products, search, setSearch }) {
  const filtered = search
    ? products.filter(p => (p.title || '').toLowerCase().includes(search.toLowerCase()))
    : products;
  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="text-sm font-semibold text-gray-900">{filtered.length} products{search ? ' matching' : ''}</div>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search products…"
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500 w-64"
        />
      </div>
      <div className="space-y-1 max-h-[480px] overflow-y-auto pr-2">
        {filtered.slice(0, 200).map(p => (
          <div key={p.id} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
            {p.image_url ? (
              <img src={p.image_url} alt="" className="w-10 h-10 rounded object-cover flex-shrink-0" />
            ) : (
              <div className="w-10 h-10 rounded bg-gray-100 flex-shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <div className="text-sm text-gray-900 truncate">{p.title}</div>
              <div className="text-xs text-gray-400 truncate">
                {p.product_type || 'Product'} {p.tags && p.tags.length ? '· ' + p.tags.slice(0, 3).join(', ') : ''}
              </div>
            </div>
            <div className="text-right text-xs flex-shrink-0">
              <div className="text-sm font-semibold text-gray-900">${Number(p.price || 0).toFixed(0)}</div>
              {p.available ? (
                <span className="text-emerald-600 font-medium">In stock</span>
              ) : (
                <span className="text-gray-400">Out</span>
              )}
            </div>
          </div>
        ))}
        {filtered.length > 200 && (
          <div className="text-xs text-gray-400 pt-3 text-center">Showing first 200 of {filtered.length}</div>
        )}
      </div>
    </div>
  );
}

function CollectionsList({ collections }) {
  return (
    <div>
      <div className="text-sm font-semibold text-gray-900 mb-3">{collections.length} collections</div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-[480px] overflow-y-auto pr-2">
        {collections.map(c => (
          <div key={c.handle} className="flex items-center gap-3 py-2 px-3 bg-gray-50 rounded-lg">
            {c.image ? <img src={c.image} alt="" className="w-10 h-10 rounded object-cover flex-shrink-0" /> : <div className="w-10 h-10 rounded bg-gray-200 flex-shrink-0" />}
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-gray-900 truncate">{c.title}</div>
              <div className="text-xs text-gray-500 truncate">/{c.handle}{c.products_count ? ' · ' + c.products_count + ' items' : ''}</div>
            </div>
            {c.score > 0 && (
              <span className="text-xs font-semibold text-indigo-600 flex-shrink-0">★ {c.score}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function TagsList({ tags }) {
  return (
    <div>
      <div className="text-sm font-semibold text-gray-900 mb-3">{tags.length} tags by product count</div>
      <div className="flex flex-wrap gap-2 max-h-[480px] overflow-y-auto">
        {tags.map(t => (
          <div key={t.tag} className="flex items-center gap-2 px-3 py-1.5 bg-indigo-50 text-indigo-700 rounded-full text-xs font-medium">
            <span>{t.tag}</span>
            <span className="text-indigo-400">{t.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function InstructionsList({ instructions }) {
  if (!instructions.length) {
    return (
      <div className="text-center py-8">
        <div className="text-gray-400 text-sm mb-3">No bot training added yet.</div>
        <a href="/dashboard/bot-training" className="inline-block px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg">
          Add training instruction →
        </a>
      </div>
    );
  }
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-semibold text-gray-900">{instructions.length} instructions</div>
        <a href="/dashboard/bot-training" className="text-xs text-indigo-600 hover:underline">Edit →</a>
      </div>
      <div className="space-y-2">
        {instructions.slice(0, 30).map(i => (
          <div key={i.id} className={`p-3 rounded-lg border ${i.active ? 'bg-emerald-50 border-emerald-100' : 'bg-gray-50 border-gray-100 opacity-60'}`}>
            <div className="text-sm text-gray-800">{i.instruction_text}</div>
            <div className="text-xs text-gray-500 mt-1">
              {i.active ? '🟢 Active' : '⚪ Paused'}
              {i.directives && i.directives.length ? ' · ' + i.directives.length + ' directive' + (i.directives.length === 1 ? '' : 's') : ''}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BrandList({ statements }) {
  if (!statements.length) {
    return (
      <div className="text-center py-8">
        <div className="text-gray-400 text-sm mb-3">No brand voice statements yet.</div>
        <a href="/dashboard/rules" className="inline-block px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg">
          Add brand statements →
        </a>
      </div>
    );
  }
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-semibold text-gray-900">{statements.length} brand voice statements</div>
        <a href="/dashboard/rules" className="text-xs text-indigo-600 hover:underline">Edit →</a>
      </div>
      <div className="space-y-2">
        {statements.map((s, i) => (
          <div key={i} className="p-3 bg-amber-50 border border-amber-100 rounded-lg text-sm text-gray-800">
            "{s}"
          </div>
        ))}
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full inline-block animate-spin" />
  );
}

function timeAgo(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return Math.round(ms / 60_000) + 'm ago';
  if (ms < 86_400_000) return Math.round(ms / 3_600_000) + 'h ago';
  return Math.round(ms / 86_400_000) + 'd ago';
}
