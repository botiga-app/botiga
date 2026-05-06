// Deterministic product search over the merchant's live catalog.
//
// The widget chat lives on a single product page, so the bot is normally
// negotiating that one item. But customers often type discovery queries
// like "any yellow dresses for Mother's Day under $60". Without this
// helper, the LLM hallucinates products it has no actual visibility into,
// AND parseCustomerOffer mistakes "$60" for a counter-offer on the current
// product. Both bugs eroded merchant trust in the bot.
//
// This module:
//   1. Detects discovery intent in the customer message (rule-based).
//   2. Filters the cached /products.json catalog by price ceiling and
//      keyword overlap (title / tags / type / vendor / body_html).
//   3. Returns a compact list the LLM can mention by name.
//
// Catalog source: storeContext.getProducts(merchant) — fetched live from
// the merchant's public /products.json and cached for 1h. We do not store
// catalog rows in our own DB outside of marketplace_products (a separate
// surface unrelated to merchant storefront chats).

const storeContext = require('./storeContext');

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'for', 'to', 'of', 'in', 'on', 'at',
  'with', 'my', 'me', 'i', 'you', 'your', 'any', 'some', 'show', 'have',
  'do', 'about', 'under', 'below', 'less', 'than', 'around', 'between',
  'looking', 'find', 'want', 'need', 'is', 'are', 'be', 'this', 'that',
  'it', 'its', 'they', 'them', 'us', 'we', 'price', 'priced', 'cost',
  'costs', 'gift', 'gifts',
]);

// Words that strongly suggest the customer is browsing the store, not
// negotiating the current product. Conservative — false positives here
// silently break the negotiation flow, so we err toward being strict.
const DISCOVERY_TRIGGERS = [
  /\bshow\s+me\b/i,
  /\bdo\s+you\s+have\b/i,
  /\bdo\s+you\s+sell\b/i,
  /\blooking\s+for\b/i,
  /\bany\s+(?:other|more|cheaper|different)\b/i,
  /\bwhat\s+(?:else|other)\b/i,
  /\brecommend\b/i,
  /\bsuggest\b/i,
  /\bbrowse\b/i,
  /\bsearch\b/i,
  // "yellow dresses under $60" — a category word + price ceiling
  /\b(?:dress|dresses|shirt|shirts|shoe|shoes|bag|bags|gift|gifts|item|items|product|products)\b.{0,40}\b(?:under|below|less\s+than)\s*\$?\s*\d+/i,
  // "under $60 for X" — price ceiling + category
  /\b(?:under|below|less\s+than)\s*\$?\s*\d+\b.{0,40}\b(?:dress|dresses|shirt|shirts|shoe|shoes|bag|bags|gift|gifts|item|items|product|products)\b/i,
];

function detectDiscoveryIntent(message) {
  if (!message || typeof message !== 'string') return false;
  return DISCOVERY_TRIGGERS.some(rx => rx.test(message));
}

function parsePriceCeiling(message) {
  if (!message) return null;
  const m = message.match(/(?:under|below|less\s+than|<=?|max(?:imum)?)\s*\$?\s*(\d+(?:\.\d+)?)/i)
         || message.match(/\$\s*(\d+(?:\.\d+)?)\s*(?:max|or\s+less|or\s+under)/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function tokenize(message) {
  return (message || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(t => t.length >= 3 && !STOP_WORDS.has(t));
}

function stripHtml(s) {
  return (s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
}

function productMinPrice(p) {
  const prices = (p.variants || [])
    .map(v => parseFloat(v.price))
    .filter(n => Number.isFinite(n) && n > 0);
  return prices.length ? Math.min(...prices) : null;
}

function scoreProduct(product, tokens) {
  if (!tokens.length) return 0;
  const title = (product.title || '').toLowerCase();
  const type = (product.product_type || '').toLowerCase();
  const vendor = (product.vendor || '').toLowerCase();
  const tags = (product.tags || []).map(t => String(t).toLowerCase());
  const body = stripHtml(product.body_html || '').toLowerCase();
  let s = 0;
  for (const t of tokens) {
    if (title.includes(t)) s += 3;
    if (tags.some(tag => tag === t)) s += 3;
    if (tags.some(tag => tag.includes(t))) s += 1;
    if (type.includes(t)) s += 2;
    if (vendor.includes(t)) s += 1;
    if (body.includes(t)) s += 1;
  }
  return s;
}

// Returns the top N products matching the query, with deterministic
// scoring + price filter. Empty array if catalog is unavailable.
async function searchProducts(merchant, query, { limit = 5 } = {}) {
  const products = await storeContext.getProducts(merchant);
  if (!products || !products.length) return [];

  const ceiling = parsePriceCeiling(query);
  const tokens = tokenize(query);
  if (!tokens.length && ceiling == null) return [];

  const scored = [];
  for (const p of products) {
    const minPrice = productMinPrice(p);
    if (minPrice == null) continue;
    if (ceiling != null && minPrice > ceiling) continue;
    const s = scoreProduct(p, tokens);
    // If only a price ceiling was given (no keywords), include all in-range.
    // Otherwise require some keyword overlap.
    if (tokens.length && s === 0) continue;
    scored.push({ p, s, minPrice });
  }

  scored.sort((a, b) => b.s - a.s || a.minPrice - b.minPrice);

  return scored.slice(0, limit).map(({ p, minPrice }) => ({
    title: p.title,
    price: minPrice,
    handle: p.handle,
    vendor: p.vendor || null,
    product_type: p.product_type || null,
    tags: (p.tags || []).slice(0, 6),
  }));
}

module.exports = {
  detectDiscoveryIntent,
  parsePriceCeiling,
  searchProducts,
};
