// Best-effort auto-detection of a merchant's storefront from a single URL.
// Used by the onboarding wizard so the merchant only has to paste their
// store URL and we fill in everything else.
//
// What we extract (all best-effort, all may be null):
//   brand_name   — from <title> or og:site_name or og:title
//   logo_url     — apple-touch-icon, og:image, then favicon
//   theme_color  — from <meta name="theme-color"> if present
//   ig_handle    — extracted from any instagram.com link in the page
//   product_count    — from /products.json (Shopify public)
//   collection_count — from /collections.json (Shopify public)
//   is_shopify   — true if /products.json returned a valid Shopify response
//
// All fetches have short timeouts so the wizard stays snappy.

const FETCH_TIMEOUT_MS = 6000;

function normalize(url) {
  if (!url) return null;
  let u = url.trim();
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  return u.replace(/\/+$/, '');
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

function extractMatch(html, regex) {
  const m = html.match(regex);
  return m ? m[1] : null;
}

function extractBrandName(html) {
  return (
    extractMatch(html, /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i) ||
    extractMatch(html, /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
    extractMatch(html, /<title[^>]*>([^<]+)<\/title>/i)?.split(/\s*[—|·\-]\s*/)[0]?.trim() ||
    null
  );
}

function extractLogoUrl(html, baseUrl) {
  const candidates = [
    extractMatch(html, /<link[^>]+rel=["']apple-touch-icon[^"']*["'][^>]+href=["']([^"']+)["']/i),
    extractMatch(html, /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i),
    extractMatch(html, /<link[^>]+rel=["']icon["'][^>]+href=["']([^"']+)["']/i),
    extractMatch(html, /<link[^>]+rel=["']shortcut icon["'][^>]+href=["']([^"']+)["']/i),
  ].filter(Boolean);

  if (!candidates.length) return null;
  const raw = candidates[0];
  if (raw.startsWith('http')) return raw;
  if (raw.startsWith('//')) return 'https:' + raw;
  if (raw.startsWith('/')) return baseUrl + raw;
  return `${baseUrl}/${raw}`;
}

function extractThemeColor(html) {
  return extractMatch(html, /<meta[^>]+name=["']theme-color["'][^>]+content=["']([^"']+)["']/i);
}

function extractInstagramHandle(html) {
  // Match instagram.com/{handle} or instagram.com/{handle}/
  const m = html.match(/(?:https?:\/\/)?(?:www\.)?instagram\.com\/([a-zA-Z0-9._]+)\/?(?:[^a-zA-Z0-9._]|$)/);
  if (!m) return null;
  const handle = m[1];
  // Filter out common non-account paths
  if (['p', 'reel', 'reels', 'stories', 'explore', 'tv', 'tag', 'tags'].includes(handle)) return null;
  return handle.length > 1 && handle.length < 31 ? handle : null;
}

async function fetchProductCount(baseUrl) {
  try {
    const res = await fetchWithTimeout(`${baseUrl}/products.json?limit=1&page=1`);
    if (!res.ok) return { is_shopify: false, count: null };
    const data = await res.json();
    if (!Array.isArray(data?.products)) return { is_shopify: false, count: null };
    // Walk a few pages to estimate total
    let total = 0;
    for (let page = 1; page <= 4; page++) {
      const r = await fetchWithTimeout(`${baseUrl}/products.json?limit=250&page=${page}`, 4000);
      if (!r.ok) break;
      const d = await r.json();
      const batch = (d.products || []).length;
      total += batch;
      if (batch < 250) break;
    }
    return { is_shopify: true, count: total };
  } catch {
    return { is_shopify: false, count: null };
  }
}

async function fetchCollectionCount(baseUrl) {
  try {
    const res = await fetchWithTimeout(`${baseUrl}/collections.json?limit=250`);
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data?.collections) ? data.collections.length : null;
  } catch {
    return null;
  }
}

async function detectStore(rawUrl) {
  const url = normalize(rawUrl);
  if (!url) throw new Error('Invalid URL');

  let html = '';
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) throw new Error(`Homepage HTTP ${res.status}`);
    html = await res.text();
  } catch (err) {
    return {
      url,
      reachable: false,
      error: err.message,
    };
  }

  const [productInfo, collectionCount] = await Promise.all([
    fetchProductCount(url),
    fetchCollectionCount(url),
  ]);

  return {
    url,
    reachable: true,
    is_shopify: productInfo.is_shopify,
    brand_name: extractBrandName(html),
    logo_url: extractLogoUrl(html, url),
    theme_color: extractThemeColor(html),
    ig_handle: extractInstagramHandle(html),
    product_count: productInfo.count,
    collection_count: collectionCount,
  };
}

module.exports = { detectStore };
