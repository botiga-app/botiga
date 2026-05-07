// Universal product query — parses natural language into a structured
// filter object, scores the catalog deterministically, returns ranked
// results.
//
// One pure function `parseProductQuery(text, catalog)` extracts what
// it can from the input. Every dimension that can't be parsed stays
// null so the UI can present it as an unset chip the customer can tap.
//
// Pricing intent like "under $50" / "less than 60" maps to price_max.
// Sort intents like "newest" / "best sellers" / "deals" map to sort.
// Color and category words check the catalog's tag_map first
// (merchant's own organization), then product_type, then a small
// canonical color list as a fallback.
//
// `runFilter(catalog, filter, opts)` applies the filter to the catalog
// and returns up to opts.limit (default 50) ranked products.

// Canonical color list — only used when no catalog tag matches.
// Merchants vary wildly on tag conventions ("yellow" vs "Yellow" vs
// "color-yellow"), so we always prefer the merchant's tags.
const CANON_COLORS = [
  'black', 'white', 'red', 'blue', 'navy', 'green', 'olive', 'yellow',
  'pink', 'purple', 'orange', 'brown', 'beige', 'cream', 'ivory',
  'grey', 'gray', 'silver', 'gold', 'tan', 'mauve', 'teal', 'mint',
  'coral', 'peach', 'lavender', 'burgundy', 'charcoal', 'rose',
];

const SIZE_VALUES = ['xxs', 'xs', 's', 'm', 'l', 'xl', 'xxl', 'xxxl'];

const STOP_WORDS = new Set([
  'the','a','an','and','or','for','to','of','in','on','at','with','my',
  'me','i','you','your','any','some','show','have','do','about','price',
  'priced','cost','costs','around','between','please','pls','can','could',
  'would','want','need','looking','find','like','it','this','that','they',
  'them','us','we','also','here','there','one','two','three','what','whats',
  'whens','wheres','how','why','give','tell','help','me','recommend',
]);

// Category matching is collection-driven primarily, with a small
// fallback for common product types ("dress", "top", "bag").
const CATEGORY_HINTS = {
  dress:    ['dress', 'dresses', 'gown', 'gowns'],
  top:      ['top', 'tops', 'blouse', 'blouses', 'shirt', 'shirts', 'tee', 'tees'],
  bottom:   ['pants', 'jeans', 'skirt', 'skirts', 'shorts'],
  outerwear:['jacket', 'jackets', 'coat', 'coats', 'cardigan', 'cardigans', 'sweater', 'sweaters', 'hoodie'],
  bag:      ['bag', 'bags', 'tote', 'totes', 'purse', 'purses', 'clutch'],
  shoes:    ['shoes', 'sneakers', 'heels', 'boots', 'sandals', 'flats'],
  jewelry:  ['jewelry', 'jewellery', 'necklace', 'necklaces', 'earring', 'earrings', 'bracelet', 'bracelets', 'ring', 'rings'],
  accessory:['hat', 'hats', 'scarf', 'scarves', 'belt', 'belts'],
  gift:     ['gift', 'gifts', 'present', 'presents'],
};

function tokenize(text) {
  return (text || '')
    .toLowerCase()
    .split(/[^a-z0-9$]+/)
    .filter(Boolean);
}

function parsePriceMax(text) {
  const lower = (text || '').toLowerCase();
  const m = lower.match(/(?:under|below|less\s+than|<=?|max(?:imum)?|up\s+to)\s*\$?\s*(\d+(?:\.\d+)?)/)
        || lower.match(/\$\s*(\d+(?:\.\d+)?)\s*(?:max|or\s+less|or\s+under)/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parsePriceMin(text) {
  const lower = (text || '').toLowerCase();
  const m = lower.match(/(?:over|above|more\s+than|>=?|at\s+least)\s*\$?\s*(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseSort(text) {
  const lower = (text || '').toLowerCase();
  if (/\b(best\s*sellers?|bestsellers?|popular|trending|hot|top\s+selling)\b/.test(lower)) return 'best_sellers';
  if (/\b(new|new\s+arrivals?|just\s+in|fresh|latest|recent)\b/.test(lower)) return 'newest';
  if (/\b(sale|deals?|markdown|clearance|cheapest|lowest\s+price)\b/.test(lower)) return 'deals';
  if (/\b(featured|spotlight|staff\s*picks?)\b/.test(lower)) return 'featured';
  return null;
}

function parseColor(text, catalog) {
  const lower = (text || '').toLowerCase();
  const tagMap = catalog?.tag_map || {};
  // Prefer merchant tags
  for (const tag of Object.keys(tagMap)) {
    const re = new RegExp('\\b' + tag.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + '\\b', 'i');
    if (CANON_COLORS.includes(tag) && re.test(lower)) return tag;
  }
  // Fall back to canonical
  for (const c of CANON_COLORS) {
    const re = new RegExp('\\b' + c + '\\b', 'i');
    if (re.test(lower)) return c;
  }
  return null;
}

function parseSize(text) {
  const lower = (text || '').toLowerCase();
  // Multi-char sizes (xxs/xs/xl/xxl/xxxl) are unambiguous — accept anywhere.
  // Single-char (s/m/l) are too easy to false-match (e.g. "what's new"
  // catches the 's' in "what's"). Require a "size" or "in " prefix
  // before single chars, OR full words "small/medium/large".
  const multi = lower.match(/\b(xxs|xs|xl|xxl|xxxl)\b/);
  if (multi) return multi[1].toLowerCase();
  const explicit = lower.match(/\bsize\s*[:\-]?\s*(s|m|l)\b/);
  if (explicit) return explicit[1].toLowerCase();
  const inPrefix = lower.match(/\bin\s+(?:size\s+)?(s|m|l)\b/);
  if (inPrefix) return inPrefix[1].toLowerCase();
  const fullWord = lower.match(/\b(small|medium|large)\b/);
  if (fullWord) return ({ small: 's', medium: 'm', large: 'l' })[fullWord[1]];
  return null;
}

function parseCategory(text, catalog) {
  const lower = (text || '').toLowerCase();
  // First check merchant collection titles + handles — they're the
  // strongest signal of how the merchant organizes products.
  const collections = catalog?.collections || [];
  for (const col of collections) {
    const haystack = ((col.title || '') + ' ' + (col.handle || '')).toLowerCase();
    // If the customer mentioned the collection name, prefer it
    const titleWord = (col.title || '').toLowerCase().trim();
    if (titleWord && titleWord.length >= 3 && lower.includes(titleWord)) {
      return { kind: 'collection', value: col.handle };
    }
  }
  // Then check tag_map — tags are the merchant's organization
  const tagMap = catalog?.tag_map || {};
  for (const tag of Object.keys(tagMap)) {
    if (tag.length < 3) continue;
    const re = new RegExp('\\b' + tag.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + '\\b', 'i');
    if (re.test(lower)) {
      // Skip color tags — those are handled by parseColor
      if (CANON_COLORS.includes(tag)) continue;
      return { kind: 'tag', value: tag };
    }
  }
  // Then canonical category hints
  for (const [key, words] of Object.entries(CATEGORY_HINTS)) {
    for (const w of words) {
      const re = new RegExp('\\b' + w + '\\b', 'i');
      if (re.test(lower)) return { kind: 'category', value: key, words };
    }
  }
  return null;
}

function parseProductQuery(text, catalog) {
  return {
    raw: text,
    sort: parseSort(text),
    price_max: parsePriceMax(text),
    price_min: parsePriceMin(text),
    color: parseColor(text, catalog),
    size: parseSize(text),
    category: parseCategory(text, catalog),
  };
}

// ── Scoring ────────────────────────────────────────────────────────────────
// Dimensions multiply together. A failing hard filter (price_max,
// out of stock when in_stock_only) returns 0 and the product is dropped.
// Soft signals (collection score, owner instructions, dwell) just nudge
// ranking. Owner instructions can apply boosts/suppresses by collection
// or tag.
function scoreProduct(p, filter, ctx) {
  // Hard filter: in stock
  if (!p.available) return 0;

  // Hard filter: price max / min
  const price = p.price;
  if (filter.price_max != null && (price == null || price > filter.price_max)) return 0;
  if (filter.price_min != null && (price == null || price < filter.price_min)) return 0;

  let score = 1.0;

  // Color
  if (filter.color) {
    const tagsLower = (p.tags || []).map(t => String(t).toLowerCase());
    const titleLower = (p.title || '').toLowerCase();
    if (tagsLower.includes(filter.color) || titleLower.includes(filter.color)) {
      score *= 1.5;
    } else {
      // Color was specified but this product doesn't show it — drop
      return 0;
    }
  }

  // Size — check variants
  if (filter.size) {
    const has = (p.variants || []).some(v => {
      const opts = (v.options || []).map(o => String(o).toLowerCase());
      return opts.includes(filter.size);
    });
    if (!has) return 0;
  }

  // Category match
  if (filter.category) {
    const tagsLower = (p.tags || []).map(t => String(t).toLowerCase());
    const titleLower = (p.title || '').toLowerCase();
    const typeLower = (p.product_type || '').toLowerCase();

    if (filter.category.kind === 'tag') {
      if (!tagsLower.includes(filter.category.value)) return 0;
      score *= 1.4;
    } else if (filter.category.kind === 'collection') {
      const inCol = (ctx?.collection_map?.[filter.category.value] || []).includes(p.id);
      if (!inCol) return 0;
      score *= 1.4;
    } else if (filter.category.kind === 'category') {
      const words = filter.category.words || [];
      const matches = words.some(w => titleLower.includes(w) || typeLower.includes(w) || tagsLower.includes(w));
      if (!matches) return 0;
      score *= 1.3;
    }
  }

  // Sort signal — soft boost based on intent
  if (filter.sort === 'newest') {
    const created = p.created_at ? new Date(p.created_at).getTime() : 0;
    const ageDays = created ? (Date.now() - created) / 86400000 : 365;
    score *= Math.max(0.5, 1.5 - ageDays / 60);   // <60d boosted
  } else if (filter.sort === 'deals') {
    const compareAt = p.compare_at_price;
    if (compareAt && price && compareAt > price) {
      score *= 1 + Math.min(2, (compareAt - price) / Math.max(price, 1));
    } else {
      score *= 0.7;   // demote if no markdown
    }
  } else if (filter.sort === 'best_sellers' || filter.sort === 'featured') {
    // Drop to collection-score signal — feature collections (best-seller / featured)
    // are already weighted in the boost below
  }

  // Collection score — feature collections (new / best-seller / featured / sale)
  // give products in them a baseline lift, mimicking a salesperson's
  // instinct to push what the store flags as hot today.
  let bestColScore = 0;
  if (ctx?.collection_map && ctx?.collections) {
    for (const col of ctx.collections) {
      if ((col.score || 0) <= bestColScore) continue;
      const ids = ctx.collection_map[col.handle] || [];
      if (ids.includes(p.id)) bestColScore = col.score;
    }
  }
  // Normalize 0–100 → 1.0–1.5x multiplier
  score *= 1.0 + (bestColScore / 200);

  // Owner instruction directives — boost / suppress per merchant
  // {type:'boost'|'suppress', target_kind:'collection'|'tag', target_value, weight}
  if (Array.isArray(ctx?.directives)) {
    for (const d of ctx.directives) {
      if (d.type !== 'boost' && d.type !== 'suppress') continue;
      let matches = false;
      if (d.target_kind === 'collection') {
        const ids = ctx.collection_map?.[d.target_value] || [];
        matches = ids.includes(p.id);
      } else if (d.target_kind === 'tag') {
        const tagsLower = (p.tags || []).map(t => String(t).toLowerCase());
        matches = tagsLower.includes(String(d.target_value).toLowerCase());
      }
      if (!matches) continue;
      const w = Number(d.weight) || (d.type === 'boost' ? 3 : 0);
      score *= (d.type === 'boost' ? w : 0);
    }
  }

  // Dwell boost — products the customer already lingered on appear
  // more often in their next discovery results. Capped at 2.5x so it
  // can't single-handedly override owner instructions or sort axis.
  if (ctx?.dwell_map && p.handle) {
    const sec = Number(ctx.dwell_map[p.handle] || 0);
    if (sec >= 45)      score *= 2.5;
    else if (sec >= 15) score *= 2.0;
    else if (sec >= 5)  score *= 1.5;
  }

  return score;
}

function runFilter(catalog, filter, opts = {}) {
  const limit = Math.max(1, Math.min(100, opts.limit || 50));
  const ctx = {
    collection_map: catalog?.collection_map || {},
    collections: catalog?.collections || [],
    directives: opts.directives || [],
    dwell_map: opts.dwell_map || {},
  };

  const scored = [];
  for (const p of catalog?.products || []) {
    const s = scoreProduct(p, filter, ctx);
    if (s > 0) scored.push({ p, s });
  }
  scored.sort((a, b) => b.s - a.s || (b.p.created_at ? new Date(b.p.created_at) : 0) - (a.p.created_at ? new Date(a.p.created_at) : 0));
  return scored.slice(0, limit).map(x => x.p);
}

// Returns a compact summary of available filter chips drawn from the
// catalog itself, so the UI can render a card with the right options
// pre-populated regardless of what the merchant tagged in their store.
function getFilterDimensions(catalog, parsed) {
  const tagMap = catalog?.tag_map || {};
  const tags = Object.keys(tagMap)
    .filter(t => !CANON_COLORS.includes(t))   // colors handled separately
    .map(t => ({ tag: t, count: tagMap[t].length }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  const colors = CANON_COLORS.filter(c => tagMap[c] && tagMap[c].length > 0);
  const sizes = (() => {
    const seen = new Set();
    for (const p of catalog?.products || []) {
      for (const v of p.variants || []) {
        for (const o of v.options || []) {
          const lo = String(o).toLowerCase();
          if (SIZE_VALUES.includes(lo)) seen.add(lo);
        }
      }
    }
    return SIZE_VALUES.filter(s => seen.has(s));
  })();

  const collections = (catalog?.collections || []).slice(0, 12);

  return {
    sort_options: ['newest', 'best_sellers', 'deals', 'featured'],
    price_buckets: [30, 50, 100, 200],
    colors,
    sizes,
    collections,
    tags,
    parsed,
  };
}

module.exports = {
  parseProductQuery,
  runFilter,
  scoreProduct,
  getFilterDimensions,
  CANON_COLORS,
  SIZE_VALUES,
};
