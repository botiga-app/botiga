/**
 * Marketplace product indexer.
 * Crawls /products.json for each active marketplace merchant and upserts into marketplace_products.
 */

const supabase = require('../lib/supabase');

const PAGE_SIZE = 250; // Shopify's max per page

async function fetchShopifyPage(domain, page) {
  const url = `https://${domain}/products.json?limit=${PAGE_SIZE}&page=${page}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Botiga-Indexer/1.0' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${domain}`);
  const data = await res.json();
  return data.products || [];
}

function extractProducts(merchant, shopifyProducts) {
  return shopifyProducts
    .filter(p => p.variants && p.variants.length > 0)
    .map(p => {
      const firstVariant = p.variants[0];
      const price = parseFloat(firstVariant.price) || 0;
      const compareAt = parseFloat(firstVariant.compare_at_price) || null;
      const images = (p.images || []).map(img => img.src);
      const variants = (p.variants || []).map(v => ({
        id: v.id,
        title: v.title,
        price: parseFloat(v.price) || 0,
        available: v.available !== false,
        option1: v.option1,
        option2: v.option2,
        option3: v.option3,
      }));
      const description = (p.body_html || '').replace(/<[^>]+>/g, '').trim().slice(0, 800);

      return {
        merchant_id: merchant.id,
        shopify_product_id: String(p.id),
        title: p.title || '',
        description,
        price,
        compare_at_price: compareAt,
        images: JSON.stringify(images),
        tags: p.tags ? p.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
        handle: p.handle || '',
        product_type: p.product_type || null,
        vendor: p.vendor || null,
        variants: JSON.stringify(variants),
        store_domain: merchant.marketplace_store_domain || merchant.shopify_domain,
        store_name: merchant.marketplace_store_name || merchant.shop_name || merchant.id,
        max_discount_pct: merchant.marketplace_max_discount_pct || 20,
        indexed_at: new Date().toISOString(),
      };
    });
}

async function indexMerchant(merchant) {
  const domain = merchant.marketplace_store_domain || merchant.shopify_domain;
  if (!domain) return { skipped: true, reason: 'no domain' };

  let page = 1;
  let totalIndexed = 0;
  let totalProducts = [];

  while (true) {
    const products = await fetchShopifyPage(domain, page);
    if (!products.length) break;
    totalProducts = totalProducts.concat(extractProducts(merchant, products));
    if (products.length < PAGE_SIZE) break;
    page++;
  }

  if (!totalProducts.length) return { indexed: 0 };

  // Upsert in chunks of 100
  for (let i = 0; i < totalProducts.length; i += 100) {
    const chunk = totalProducts.slice(i, i + 100);
    const { error } = await supabase
      .from('marketplace_products')
      .upsert(chunk, { onConflict: 'merchant_id,shopify_product_id' });
    if (error) throw error;
    totalIndexed += chunk.length;
  }

  return { indexed: totalIndexed };
}

async function runIndexer({ merchantId } = {}) {
  let query = supabase.from('merchants').select('*').eq('marketplace_active', true);
  if (merchantId) query = query.eq('id', merchantId);

  const { data: merchants, error } = await query;
  if (error) throw error;

  const results = [];
  for (const merchant of merchants || []) {
    try {
      const result = await indexMerchant(merchant);
      results.push({ merchantId: merchant.id, ...result });
      console.log(`[Indexer] ${merchant.id}: ${result.indexed ?? 0} products indexed`);
    } catch (err) {
      results.push({ merchantId: merchant.id, error: err.message });
      console.error(`[Indexer] ${merchant.id} failed:`, err.message);
    }
  }
  return results;
}

module.exports = { runIndexer, indexMerchant };
