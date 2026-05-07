// Server-side catalog assembler. The widget no longer fetches /products.json
// directly — instead it asks /api/widget/catalog, and we fetch from the
// merchant's configured source_url server-side. This means:
//   1. The catalog is always the merchant's REAL store, not whatever
//      origin the widget happens to be embedded on (clones, dev mirrors).
//   2. We can blend in collection metadata + a tag map without forcing
//      the widget to do multiple round-trips.
//   3. Server-side caching (10 min) takes the load off the merchant's
//      Shopify storefront.

const supabase = require('../lib/supabase');
const storeContext = require('./storeContext');

const FETCH_TIMEOUT_MS = 8000;
const CATALOG_CACHE_TTL = 10 * 60 * 1000;   // 10 min — fresh enough for inventory drift
const _memCache = new Map();                // merchantId → { fetchedAt, payload }

function fetchWithTimeout(url, ms = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { signal: controller.signal, redirect: 'follow' })
    .finally(() => clearTimeout(timer));
}

function resolveSourceUrl(merchant) {
  if (!merchant) return null;
  if (merchant.source_url) return String(merchant.source_url).replace(/\/+$/, '');
  if (merchant.shopify_domain) return 'https://' + merchant.shopify_domain;
  return null;
}

async function fetchProducts(sourceUrl) {
  // Walk pages until empty. /products.json caps at 250/page; we fetch up
  // to 10 pages (2500 products) to cover boutiques with longer back
  // catalogs — earlier 1000-cap was missing Baby/Littles items that lived
  // on pages 5+. Loop terminates as soon as a page returns < 250.
  const all = [];
  for (let page = 1; page <= 10; page++) {
    try {
      const res = await fetchWithTimeout(`${sourceUrl}/products.json?page=${page}&limit=250`, 10000);
      if (!res.ok) break;
      const data = await res.json();
      const batch = data.products || [];
      all.push(...batch);
      if (batch.length < 250) break;
    } catch (_) {
      break;
    }
  }
  return all;
}

async function fetchCollections(sourceUrl) {
  try {
    const res = await fetchWithTimeout(`${sourceUrl}/collections.json?limit=250`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.collections || [];
  } catch (_) {
    return [];
  }
}

// Build a tag map: { tag_lower: [product_id, ...] } across the catalog.
// Tags are the merchant's primary organization layer in Shopify, so the
// universal filter scores them as first-class signals.
function buildTagMap(products) {
  const map = {};
  for (const p of products) {
    let tags = [];
    if (Array.isArray(p.tags)) tags = p.tags;
    else if (typeof p.tags === 'string') tags = p.tags.split(',').map(t => t.trim()).filter(Boolean);
    for (const t of tags) {
      const key = t.toLowerCase();
      if (!map[key]) map[key] = [];
      map[key].push(String(p.id));
    }
  }
  return map;
}

// Compact product shape — drops fields the filter doesn't use to keep
// payload tight. Variants reduced to the cheapest available + price range.
function shapeProduct(p) {
  const variants = (p.variants || []).map(v => ({
    id: v.id,
    price: parseFloat(v.price),
    compare_at_price: v.compare_at_price ? parseFloat(v.compare_at_price) : null,
    available: v.available !== false,
    options: [v.option1, v.option2, v.option3].filter(Boolean),
  }));

  const inStockVariants = variants.filter(v => v.available && Number.isFinite(v.price) && v.price > 0);
  const minPrice = inStockVariants.length
    ? Math.min(...inStockVariants.map(v => v.price))
    : (variants[0]?.price ?? null);
  const compareAt = variants.find(v => Number.isFinite(v.compare_at_price) && v.compare_at_price > minPrice)?.compare_at_price ?? null;

  let tagsArr = [];
  if (Array.isArray(p.tags)) tagsArr = p.tags;
  else if (typeof p.tags === 'string') tagsArr = p.tags.split(',').map(t => t.trim()).filter(Boolean);

  return {
    id: String(p.id),
    title: p.title,
    handle: p.handle,
    vendor: p.vendor || null,
    product_type: p.product_type || null,
    tags: tagsArr,
    image_url: (p.images && p.images[0] && p.images[0].src) || null,
    price: minPrice,
    compare_at_price: compareAt,
    available: inStockVariants.length > 0,
    created_at: p.created_at || p.published_at || null,
    body_html: p.body_html ? String(p.body_html).slice(0, 500) : null,
    variants: variants.slice(0, 8),
  };
}

// Score collections same way the deal picker does — feature collections
// (new / best-seller / featured / sale / seasonal) get higher scores so
// the universal filter can boost their products by default.
const COLLECTION_RULES = [
  { score: 100, rx: /\b(new|new[\s-]*arrival|just[\s-]*in|fresh)\b/i },
  { score:  95, rx: /\b(best[\s-]*seller|bestseller|trending|popular|hot)\b/i },
  { score:  90, rx: /\b(featured|spotlight|staff[\s-]*pick|editor)\b/i },
  { score:  85, rx: /\b(sale|clearance|deal|markdown|outlet)\b/i },
  { score:  80, rx: /\b(summer|spring|fall|autumn|winter|holiday|seasonal)\b/i },
  { score:  60, rx: /\b(limited|exclusive)\b/i },
];

function scoreCollection(col) {
  const hay = ((col.handle || '') + ' ' + (col.title || '')).toLowerCase();
  for (const rule of COLLECTION_RULES) {
    if (rule.rx.test(hay)) return rule.score;
  }
  return 0;
}

// Map: collection handle → [product_id, ...]. Server-side fetch since
// /collections.json doesn't return product membership inline. We fetch
// the first 40 collections in parallel — covers the merchant's main
// categorical buckets (Tops, Bottoms, Dresses, Baby, Littles, Gifts,
// Sale, etc.) so when a customer types "tops" or "kids" we have the
// product membership on hand. Anything beyond 40 is unusual for a
// boutique and would just slow the cold-fetch.
async function fetchCollectionMembership(sourceUrl, scoredCollections) {
  const top = scoredCollections.slice(0, 40);
  const results = await Promise.all(top.map(async col => {
    try {
      const res = await fetchWithTimeout(`${sourceUrl}/collections/${col.handle}/products.json?limit=200`, 8000);
      if (!res.ok) return { handle: col.handle, ids: [] };
      const data = await res.json();
      return { handle: col.handle, ids: (data.products || []).map(p => String(p.id)) };
    } catch (_) {
      return { handle: col.handle, ids: [] };
    }
  }));
  const map = {};
  for (const r of results) map[r.handle] = r.ids;
  return map;
}

// Main entry. Returns { products, collections, tag_map, collection_map }
// where collection_map is { handle: [product_id...] } for the top
// feature collections, used by the parser to drive collection-name
// queries ("show me summer", "show me sale").
async function getCatalog(merchantId, { force = false } = {}) {
  const cached = _memCache.get(merchantId);
  if (!force && cached && (Date.now() - cached.fetchedAt) < CATALOG_CACHE_TTL) {
    return cached.payload;
  }

  const { data: merchant } = await supabase
    .from('merchants')
    .select('id, source_url, shopify_domain')
    .eq('id', merchantId)
    .maybeSingle();
  if (!merchant) throw new Error('merchant not found');

  const sourceUrl = resolveSourceUrl(merchant);
  if (!sourceUrl) {
    return { products: [], collections: [], tag_map: {}, collection_map: {}, source: null };
  }

  const [rawProducts, rawCollections] = await Promise.all([
    fetchProducts(sourceUrl),
    fetchCollections(sourceUrl),
  ]);

  const products = rawProducts.map(shapeProduct);
  const tagMap = buildTagMap(rawProducts);

  const scoredCollections = rawCollections
    .filter(c => c.handle !== 'all')
    .map(c => ({
      handle: c.handle,
      title: c.title,
      products_count: c.products_count ?? null,
      image: c.image && c.image.src ? c.image.src : null,
      score: scoreCollection(c),
    }))
    .sort((a, b) => b.score - a.score);

  const collectionMap = await fetchCollectionMembership(sourceUrl, scoredCollections);

  // Top tags by product count — useful for diagnostics so the merchant
  // can see what tags the bot's working with.
  const topTags = Object.keys(tagMap)
    .map(t => ({ tag: t, count: tagMap[t].length }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 30);

  const payload = {
    products,
    collections: scoredCollections,
    tag_map: tagMap,
    collection_map: collectionMap,
    source: sourceUrl,
    fetched_at: new Date().toISOString(),
    // Diagnostic counts so /api/widget/catalog?k= shows the catalog state
    // at a glance without scrolling through 1000 products.
    total_products: products.length,
    total_in_stock: products.filter(p => p.available).length,
    total_collections: scoredCollections.length,
    top_tags: topTags,
  };

  _memCache.set(merchantId, { fetchedAt: Date.now(), payload });
  return payload;
}

module.exports = { getCatalog, scoreCollection };
