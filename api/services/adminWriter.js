// Writes products / pages / policies to a target Shopify store via Admin API.
// Used by the clone tool — pulls from one storefront's public surface
// (storefrontCrawler.js) and writes into one of our dev stores so we can run
// concierge eval against a real-shaped catalog.
//
// Idempotency: every create checks for an existing handle first. Re-running
// the clone job picks up where it left off without duplicating anything.

const SHOPIFY_API_VERSION = '2024-01';

async function adminFetch({ shop, accessToken }, path, options = {}) {
  const url = `https://${shop}/admin/api/${SHOPIFY_API_VERSION}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken,
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch {}
  if (!res.ok) {
    const msg = body?.errors ? JSON.stringify(body.errors) : text.slice(0, 300);
    const err = new Error(`Shopify ${options.method || 'GET'} ${path} → ${res.status}: ${msg}`);
    err.status = res.status;
    throw err;
  }
  return body;
}

async function graphqlFetch({ shop, accessToken }, query, variables = {}) {
  const url = `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken,
    },
    body: JSON.stringify({ query, variables }),
  });
  const data = await res.json();
  if (data.errors) throw new Error('GraphQL: ' + JSON.stringify(data.errors));
  return data.data;
}

// ─── Products ───────────────────────────────────────────────────────────────

async function productExists(target, handle) {
  if (!handle) return false;
  const data = await adminFetch(
    target,
    `/products.json?handle=${encodeURIComponent(handle)}&fields=id,handle&limit=1`
  );
  return Array.isArray(data?.products) && data.products.length > 0;
}

function buildProductPayload(src) {
  // Source `src` is one product from the public /products.json endpoint.
  const variants = (src.variants || []).map(v => ({
    option1: v.option1 ?? null,
    option2: v.option2 ?? null,
    option3: v.option3 ?? null,
    price: v.price != null ? String(v.price) : null,
    compare_at_price: v.compare_at_price != null ? String(v.compare_at_price) : null,
    sku: v.sku || null,
    barcode: v.barcode || null,
    weight: v.weight || null,
    weight_unit: v.weight_unit || null,
    requires_shipping: v.requires_shipping !== false,
    taxable: v.taxable !== false,
    inventory_management: 'shopify',
    inventory_quantity: 100,
  }));

  const options = (src.options || []).map(o => ({
    name: o.name,
    values: Array.isArray(o.values) ? o.values : [],
  }));

  // Shopify will fetch image bytes from the src URL itself — no need to
  // download/re-upload. Source images live on cdn.shopify.com which is public.
  const images = (src.images || []).map(i => ({ src: i.src })).filter(i => i.src);

  return {
    product: {
      title: src.title,
      body_html: src.body_html || '',
      vendor: src.vendor || null,
      product_type: src.product_type || null,
      handle: src.handle,
      tags: Array.isArray(src.tags) ? src.tags.join(', ') : (src.tags || ''),
      published: src.published_at != null,
      variants,
      options,
      images,
    },
  };
}

async function createProduct(target, sourceProduct) {
  return adminFetch(target, '/products.json', {
    method: 'POST',
    body: JSON.stringify(buildProductPayload(sourceProduct)),
  });
}

// ─── Pages ──────────────────────────────────────────────────────────────────

async function pageExists(target, handle) {
  if (!handle) return false;
  const data = await adminFetch(
    target,
    `/pages.json?handle=${encodeURIComponent(handle)}&fields=id,handle&limit=1`
  );
  return Array.isArray(data?.pages) && data.pages.length > 0;
}

async function createPage(target, { handle, title, body_html }) {
  return adminFetch(target, '/pages.json', {
    method: 'POST',
    body: JSON.stringify({
      page: { handle, title, body_html, published: true },
    }),
  });
}

// ─── Policies ───────────────────────────────────────────────────────────────
// Shopify's standard policy pages have no REST write endpoint — they live
// behind a GraphQL mutation that takes a typed enum.

const POLICY_TYPE_MAP = {
  refund_policy:    'REFUND_POLICY',
  shipping_policy:  'SHIPPING_POLICY',
  privacy_policy:   'PRIVACY_POLICY',
  terms_of_service: 'TERMS_OF_SERVICE',
};

async function updatePolicy(target, adminKey, bodyHtml) {
  const type = POLICY_TYPE_MAP[adminKey];
  if (!type) throw new Error(`unknown policy adminKey: ${adminKey}`);

  const query = `
    mutation shopPolicyUpdate($shopPolicy: ShopPolicyInput!) {
      shopPolicyUpdate(shopPolicy: $shopPolicy) {
        shopPolicy { id type body }
        userErrors { field message }
      }
    }
  `;
  const data = await graphqlFetch(target, query, { shopPolicy: { type, body: bodyHtml } });
  const errs = data?.shopPolicyUpdate?.userErrors;
  if (errs && errs.length) throw new Error('shopPolicyUpdate: ' + JSON.stringify(errs));
  return data.shopPolicyUpdate.shopPolicy;
}

module.exports = {
  productExists,
  createProduct,
  pageExists,
  createPage,
  updatePolicy,
};
