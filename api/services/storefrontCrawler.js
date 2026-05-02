// Pulls catalog + policy + page content from a public Shopify storefront URL.
// No auth required — uses the public /products.json, /policies/*, and
// /sitemap_pages_*.xml endpoints exposed by every standard Shopify store.
//
// Used by the clone tool to populate one of our dev stores with a real-shaped
// catalog for evaluation/testing the concierge.

function normalizeBase(input) {
  let s = String(input || '').trim();
  if (!s) throw new Error('source_url required');
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  // Strip trailing slash
  return s.replace(/\/+$/, '');
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      // Some Shopify stores block default fetch UAs
      'User-Agent': 'Mozilla/5.0 (compatible; BotigaClone/1.0)',
      Accept: 'text/html,application/xhtml+xml,application/json,*/*;q=0.8',
    },
    redirect: 'follow',
  });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} for ${url}`);
    err.status = res.status;
    throw err;
  }
  return res.text();
}

async function fetchJson(url) {
  const text = await fetchText(url);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON at ${url}`);
  }
}

// ─── Catalog ────────────────────────────────────────────────────────────────
// Returns up to 250 products at a time. Empty array = end of catalog.
async function fetchProductsPage(sourceUrl, page = 1) {
  const base = normalizeBase(sourceUrl);
  const url = `${base}/products.json?limit=250&page=${page}`;
  const data = await fetchJson(url);
  return Array.isArray(data?.products) ? data.products : [];
}

// ─── Policies ───────────────────────────────────────────────────────────────
// Shopify exposes its standard policies at /policies/<slug>. The HTML wraps
// the content in a few predictable shells; we scrape what we can find.
const POLICY_SLUGS = [
  { slug: 'refund-policy',     adminKey: 'refund_policy',     title: 'Refund Policy' },
  { slug: 'shipping-policy',   adminKey: 'shipping_policy',   title: 'Shipping Policy' },
  { slug: 'privacy-policy',    adminKey: 'privacy_policy',    title: 'Privacy Policy' },
  { slug: 'terms-of-service',  adminKey: 'terms_of_service',  title: 'Terms of Service' },
];

async function fetchPolicy(sourceUrl, slug) {
  const base = normalizeBase(sourceUrl);
  const url = `${base}/policies/${slug}`;
  let html;
  try {
    html = await fetchText(url);
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
  const body = extractPolicyBody(html);
  if (!body) return null;
  return { slug, html: body, source_url: url };
}

// Shopify policy pages render content inside `<div class="shopify-policy__body">`
// or `<div class="shopify-policy__container">`. Themes wrap this in lots of nav
// chrome, so we anchor on the policy class and walk balanced <div>/</div> pairs
// to extract just the policy body — regex alone can't handle nested divs.
function extractPolicyBody(html) {
  if (!html) return null;

  for (const className of ['shopify-policy__body', 'shopify-policy__container']) {
    const body = extractBalancedDiv(html, className);
    if (body && body.length > 80) return body;
  }

  // Last-ditch: try a generously-sized rte block (skip tiny nav-bar rtes)
  const rteMatches = [...html.matchAll(/<div[^>]*class="[^"]*\brte\b[^"]*"[^>]*>([\s\S]{200,}?)<\/div>/gi)];
  if (rteMatches.length) {
    rteMatches.sort((a, b) => b[1].length - a[1].length);
    return rteMatches[0][1].trim();
  }
  return null;
}

// Find <div class="...{className}..."> and return the inner HTML, walking
// balanced div opens/closes. Returns null if not found.
function extractBalancedDiv(html, className) {
  const openRe = new RegExp(`<div[^>]*class="[^"]*\\b${className}\\b[^"]*"[^>]*>`, 'i');
  const startMatch = openRe.exec(html);
  if (!startMatch) return null;
  const startIdx = startMatch.index + startMatch[0].length;

  // Walk forward, counting <div ...> and </div>
  const tagRe = /<\/?div\b[^>]*>/gi;
  tagRe.lastIndex = startIdx;
  let depth = 1;
  let m;
  while ((m = tagRe.exec(html)) !== null) {
    if (m[0].startsWith('</')) {
      depth--;
      if (depth === 0) return html.slice(startIdx, m.index).trim();
    } else {
      depth++;
    }
  }
  return null;
}

// ─── Pages (About, FAQ, etc.) via sitemap ───────────────────────────────────
// Shopify's sitemap.xml is a sitemap-index pointing at separate page-level
// sitemaps with required ?from=...&to=... query params. We walk the index
// and fetch each pages-sitemap, then extract /pages/* URLs.
async function fetchPageUrls(sourceUrl) {
  const base = normalizeBase(sourceUrl);
  let indexXml;
  try {
    indexXml = await fetchText(`${base}/sitemap.xml`);
  } catch (err) {
    if (err.status === 404 || err.status === 400) return [];
    throw err;
  }

  const allLocs = (xml) => {
    const out = [];
    const re = /<loc>([^<]+)<\/loc>/g;
    let m;
    while ((m = re.exec(xml)) !== null) out.push(decodeXmlEntities(m[1].trim()));
    return out;
  };

  const sitemapLocs = allLocs(indexXml).filter(u => /sitemap_pages/i.test(u));
  // No sub-sitemap — the index file may itself list page URLs (older format)
  const candidateXmls = sitemapLocs.length === 0 ? [indexXml] : [];
  for (const subUrl of sitemapLocs) {
    try {
      candidateXmls.push(await fetchText(subUrl));
    } catch (err) {
      // Skip unreachable sub-sitemap, continue with what we have
    }
  }

  const urls = [];
  for (const xml of candidateXmls) {
    for (const u of allLocs(xml)) {
      if (u.includes('/pages/')) urls.push(u);
    }
  }
  return urls;
}

function decodeXmlEntities(s) {
  return String(s)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

async function fetchPage(url) {
  let html;
  try {
    html = await fetchText(url);
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
  const cleaned = stripNoise(html);

  // Extract handle from URL: /pages/about-us → about-us
  const handleMatch = url.match(/\/pages\/([^/?#]+)/);
  const handle = handleMatch ? handleMatch[1] : null;

  // Title: <title> tag is most reliable; strip the trailing "— Store Name" suffix.
  // Themes often render an h1 from a "You also viewed" or related-products section
  // on a page, so h1 is a poor fallback.
  let title = null;
  const titleTag = html.match(/<title>([^<]+)<\/title>/i);
  if (titleTag) {
    title = decodeXmlEntities(titleTag[1])
      .replace(/&ndash;/g, '–').replace(/&mdash;/g, '—')
      .split(/\s[—–|·]\s/)[0]
      .trim();
  }
  if (!title) {
    const og = cleaned.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
    if (og) title = decodeXmlEntities(og[1]).split(/\s[—–|·]\s/)[0].trim();
  }
  if (!title && handle) title = handle.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  // Body: pages typically render content as one or more <div class="rte"> blocks
  // inside section containers. Try canonical Shopify page wrappers first; if
  // none have substance, collect every rte block on the page and concatenate
  // unique ones (themes sometimes render the same block twice for breakpoints).
  let body_html = null;
  for (const cls of ['page-content', 'page__content']) {
    const inner = extractBalancedDiv(cleaned, cls);
    if (inner && stripTags(inner).length > 200) { body_html = inner; break; }
  }
  if (!body_html) {
    const rteBlocks = extractAllBalancedDivs(cleaned, 'rte')
      .filter(b => stripTags(b).length > 50);
    const seen = new Set();
    const unique = [];
    for (const b of rteBlocks) {
      const key = stripTags(b).slice(0, 200);
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(b.trim());
    }
    if (unique.length) body_html = unique.join('\n<hr>\n');
  }
  if (!body_html || stripTags(body_html).length < 50) return null;

  return { url, handle, title, body_html };
}

// Find all <div> blocks with the given class name; returns each block's inner
// HTML. Walks balanced div opens/closes so nested divs don't trip us up.
function extractAllBalancedDivs(html, className) {
  const openRe = new RegExp(`<div[^>]*class="[^"]*\\b${className}\\b[^"]*"[^>]*>`, 'gi');
  const out = [];
  let openMatch;
  while ((openMatch = openRe.exec(html)) !== null) {
    const startIdx = openMatch.index + openMatch[0].length;
    const tagRe = /<\/?div\b[^>]*>/gi;
    tagRe.lastIndex = startIdx;
    let depth = 1;
    let m;
    while ((m = tagRe.exec(html)) !== null) {
      if (m[0].startsWith('</')) {
        depth--;
        if (depth === 0) {
          out.push(html.slice(startIdx, m.index));
          // Resume the outer search after this block's close
          openRe.lastIndex = tagRe.lastIndex;
          break;
        }
      } else {
        depth++;
      }
    }
  }
  return out;
}

// ─── HTML cleaning helpers ──────────────────────────────────────────────────
function stripNoise(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '');
}

function stripTags(s) {
  return String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');
}

module.exports = {
  normalizeBase,
  fetchProductsPage,
  fetchPolicy,
  fetchPageUrls,
  fetchPage,
  POLICY_SLUGS,
};
