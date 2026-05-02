// Match an extracted product (from extractFields.js / videoAnalyzer.js)
// against the merchant's PUBLIC storefront catalog.
//
// Source-of-truth principle (May 2026): we read products from
//   merchant.source_url (clone scenario) or
//   https://merchant.shopify_domain (real merchant scenario)
// using the public /products.json endpoint — NO admin auth needed and NO
// dependency on whether the catalog has been cloned into a dev store.
//
// Caching is unified through services/storeContext.getProducts() so the
// same fetch is reused across negotiations, video auto-tag runs, and any
// future feature that needs the catalog.
//
// Strategy:
//  1. Pull the merchant's public catalog (cached 1h)
//  2. Score each product by token-overlap on title + substring + color/category boosts
//  3. Return only matches above a confidence threshold
//
// Confidence thresholds (from project memory: video auto-tag policy):
//   ≥ 0.5  → caller should auto-apply
//   0.3 - 0.5 → caller should surface as a suggestion for human review
//   < 0.3  → caller should treat as no match

const storeContext = require('./storeContext');

const STOPWORDS = new Set(['a','an','the','and','or','of','for','in','with','to','on','at','by','from']);

function tokens(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w));
}

function scoreProduct(target, candidate) {
  const targetWords = tokens(target.title);
  const candTitle = (candidate.title || '').toLowerCase();
  const candWords = tokens(candidate.title);
  if (!targetWords.length || !candWords.length) return 0;

  const matched = targetWords.filter(w => candWords.includes(w));
  let score = matched.length / Math.max(targetWords.length, candWords.length);

  const targetStr = targetWords.join(' ');
  if (candTitle.includes(targetStr)) score += 0.2;

  if (target.color && candTitle.includes(target.color.toLowerCase())) score += 0.1;

  if (target.category && (candidate.product_type || '').toLowerCase().includes(target.category.toLowerCase())) {
    score += 0.1;
  }

  // Tags can carry color/season/style info — boost on tag overlap with target words
  if (Array.isArray(candidate.tags)) {
    const tagText = candidate.tags.join(' ').toLowerCase();
    const tagOverlap = targetWords.filter(w => tagText.includes(w)).length;
    if (tagOverlap > 0) score += Math.min(0.1, tagOverlap * 0.03);
  }

  // Penalty when candidate is dramatically longer (probably a different product)
  if (candWords.length > targetWords.length * 3) score -= 0.15;

  return Math.max(0, Math.min(1, score));
}

/**
 * @param target  { title, price, color, category, sizes, description }
 *                — the structured product attrs extracted from a video / message
 * @param merchant merchant row (must have id + source_url or shopify_domain)
 * @returns { score, match: { product_id, variant_id, title, price, handle, image_url } } or null
 */
async function findBestMatch(target, merchant) {
  const products = await storeContext.getProducts(merchant);
  if (!products.length) return null;

  let bestProd = null;
  let bestScore = 0;

  for (const p of products) {
    const score = scoreProduct(target, p);
    if (score > bestScore) {
      bestScore = score;
      bestProd = p;
    }
  }

  if (!bestProd) return null;

  // Pick a variant: closest to target price if we have one, else first
  let variant = bestProd.variants?.[0];
  if (target.price && bestProd.variants?.length > 1) {
    let bestDelta = Infinity;
    for (const v of bestProd.variants) {
      const delta = Math.abs(parseFloat(v.price || 0) - target.price);
      if (delta < bestDelta) { bestDelta = delta; variant = v; }
    }
  }

  return {
    score: bestScore,
    match: {
      product_id: String(bestProd.id),
      variant_id: variant ? String(variant.id) : null,
      title: bestProd.title,
      handle: bestProd.handle,
      price: variant ? parseFloat(variant.price) : null,
      image_url: bestProd.images?.[0]?.src || null,
      product_type: bestProd.product_type || null,
      tags: Array.isArray(bestProd.tags) ? bestProd.tags : (bestProd.tags || '').split(',').map(t => t.trim()).filter(Boolean),
    },
  };
}

module.exports = { findBestMatch };
