// Reads public storefront data from merchant.source_url (clone scenario) or
// merchant.shopify_domain (real-merchant scenario) so the negotiation engine
// can reference live commercial context (collections, active promos, brand
// voice) without re-crawling on every request.
//
// All endpoints used here are public — no auth needed:
//   /collections.json
//   /          (homepage HTML for banners)
//   /pages/about-us etc.
//
// Cached in store_context_cache; on fetch failure we fall back to stale
// cache rather than throw, so a flaky source never blocks a negotiation.

const supabase = require('../lib/supabase');

const TTL = {
  collections: 60 * 60 * 1000,       // 1h
  promos: 15 * 60 * 1000,            // 15m
  about: 24 * 60 * 60 * 1000,        // 24h
  products: 60 * 60 * 1000,          // 1h
};

const FETCH_TIMEOUT_MS = 5000;

function resolveSourceUrl(merchant) {
  if (!merchant) return null;
  if (merchant.source_url) return merchant.source_url.replace(/\/+$/, '');
  if (merchant.shopify_domain) return `https://${merchant.shopify_domain}`;
  return null;
}

async function fetchWithTimeout(url, ms = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal, redirect: 'follow' });
  } finally {
    clearTimeout(timeout);
  }
}

async function readCache(merchantId, key) {
  const { data } = await supabase
    .from('store_context_cache')
    .select('payload, fetched_at')
    .eq('merchant_id', merchantId)
    .eq('cache_key', key)
    .maybeSingle();
  if (!data) return null;
  return {
    payload: data.payload,
    ageMs: Date.now() - new Date(data.fetched_at).getTime(),
  };
}

async function writeCache(merchantId, key, payload) {
  await supabase.from('store_context_cache').upsert({
    merchant_id: merchantId,
    cache_key: key,
    payload,
    fetched_at: new Date().toISOString(),
  }, { onConflict: 'merchant_id,cache_key' });
}

async function getOrFetch(merchant, key, ttlMs, fetcher) {
  const sourceUrl = resolveSourceUrl(merchant);
  if (!sourceUrl || !merchant.id) return null;

  const cached = await readCache(merchant.id, key);
  if (cached && cached.ageMs < ttlMs) return cached.payload;

  try {
    const fresh = await fetcher(sourceUrl);
    if (fresh != null) await writeCache(merchant.id, key, fresh);
    return fresh;
  } catch (err) {
    console.warn(`[storeContext] ${key} fetch failed for ${merchant.id}: ${err.message}`);
    return cached?.payload ?? null;
  }
}

// ─── HTML helpers ───────────────────────────────────────────────────────────

function stripHtml(s) {
  return (s || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Fetchers ───────────────────────────────────────────────────────────────

async function fetchCollections(sourceUrl) {
  const res = await fetchWithTimeout(`${sourceUrl}/collections.json?limit=250`);
  if (!res.ok) throw new Error(`Collections HTTP ${res.status}`);
  const data = await res.json();
  return (data.collections || []).map(c => ({
    handle: c.handle,
    title: c.title,
    description: stripHtml(c.body_html || '').slice(0, 300),
    products_count: c.products_count ?? null,
  }));
}

const BANNER_PATTERNS = [
  /<section[^>]*announcement[^>]*>([\s\S]*?)<\/section>/gi,
  /<div[^>]*announcement[^>]*>([\s\S]*?)<\/div>/gi,
  /<header[^>]*banner[^>]*>([\s\S]*?)<\/header>/gi,
  /<div[^>]*data-section-type=["']announcement-bar["'][^>]*>([\s\S]*?)<\/div>/gi,
  /<aside[^>]*promo[^>]*>([\s\S]*?)<\/aside>/gi,
];

async function fetchPromos(sourceUrl) {
  const res = await fetchWithTimeout(sourceUrl);
  if (!res.ok) throw new Error(`Homepage HTTP ${res.status}`);
  const html = await res.text();
  const promos = [];

  for (const pat of BANNER_PATTERNS) {
    pat.lastIndex = 0;
    let m;
    while ((m = pat.exec(html)) !== null && promos.length < 8) {
      const text = stripHtml(m[1]);
      if (text && text.length > 5 && text.length < 200) promos.push(text);
    }
  }

  return [...new Set(promos)].slice(0, 5);
}

async function fetchProducts(sourceUrl) {
  // Public /products.json paginates 250/page; walk until empty.
  // Returns the raw product objects so callers can score against title,
  // body_html, tags, variants, etc.
  const all = [];
  for (let page = 1; page <= 20; page++) {
    const res = await fetchWithTimeout(`${sourceUrl}/products.json?page=${page}&limit=250`, 10000);
    if (!res.ok) {
      if (page === 1) throw new Error(`Products HTTP ${res.status}`);
      break;
    }
    const data = await res.json();
    const batch = data.products || [];
    if (!batch.length) break;
    all.push(...batch);
    if (batch.length < 250) break;
  }
  return all;
}

async function fetchAbout(sourceUrl) {
  const candidates = ['/pages/about', '/pages/about-us', '/pages/our-story', '/pages/story'];
  for (const path of candidates) {
    try {
      const res = await fetchWithTimeout(sourceUrl + path);
      if (!res.ok) continue;
      const html = await res.text();
      const main = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i)
        || html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
      if (!main) continue;
      const text = stripHtml(main[1]);
      if (text.length >= 50) return { path, text: text.slice(0, 1500) };
    } catch { /* try next candidate */ }
  }
  return null;
}

// ─── Public API ─────────────────────────────────────────────────────────────

async function getCollections(merchant) {
  return (await getOrFetch(merchant, 'collections', TTL.collections, fetchCollections)) ?? [];
}

async function getActivePromos(merchant) {
  return (await getOrFetch(merchant, 'promos', TTL.promos, fetchPromos)) ?? [];
}

async function getAboutContent(merchant) {
  return await getOrFetch(merchant, 'about', TTL.about, fetchAbout);
}

async function getProducts(merchant) {
  return (await getOrFetch(merchant, 'products', TTL.products, fetchProducts)) ?? [];
}

// Convenience: assemble a compact context string for the LLM system prompt.
// Returns null if there's nothing useful to add (no source_url, all fetches empty).
async function buildLLMContext(merchant) {
  if (!resolveSourceUrl(merchant)) return null;

  const [collections, promos, about] = await Promise.all([
    getCollections(merchant),
    getActivePromos(merchant),
    getAboutContent(merchant),
  ]);

  const parts = [];

  if (collections?.length) {
    const titles = collections.slice(0, 12).map(c => c.title).filter(Boolean);
    if (titles.length) parts.push(`Store collections you can reference: ${titles.join(', ')}.`);
  }

  if (promos?.length) {
    parts.push(`Active site-wide promotions visible to shoppers right now: ${promos.slice(0, 3).join(' | ')}.`);
  }

  if (about?.text) {
    parts.push(`Brand voice / about content: ${about.text.slice(0, 400)}.`);
  }

  return parts.length ? parts.join('\n') : null;
}

module.exports = {
  getCollections,
  getActivePromos,
  getAboutContent,
  getProducts,
  buildLLMContext,
};
