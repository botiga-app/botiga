const supabase = require('./supabase');

const SHOPIFY_CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const SHOPIFY_CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;

const REFRESH_WINDOW_MS = 5 * 60 * 1000;

async function refreshAccessToken(merchant) {
  if (!merchant.shopify_refresh_token || !merchant.shopify_domain) {
    throw new Error('Cannot refresh: missing refresh_token or shopify_domain');
  }

  const res = await fetch(`https://${merchant.shopify_domain}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: SHOPIFY_CLIENT_ID,
      client_secret: SHOPIFY_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: merchant.shopify_refresh_token
    })
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Shopify refresh failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  const tokenExpiresAt = data.expires_in
    ? new Date(Date.now() + data.expires_in * 1000).toISOString()
    : null;
  const refreshExpiresAt = data.refresh_token_expires_in
    ? new Date(Date.now() + data.refresh_token_expires_in * 1000).toISOString()
    : null;

  const { error } = await supabase
    .from('merchants')
    .update({
      shopify_access_token: data.access_token,
      shopify_refresh_token: data.refresh_token || merchant.shopify_refresh_token,
      shopify_token_expires_at: tokenExpiresAt,
      shopify_refresh_token_expires_at: refreshExpiresAt
    })
    .eq('id', merchant.id);

  if (error) throw new Error(`DB update after refresh failed: ${error.message}`);

  return data.access_token;
}

async function loadMerchant(merchantId) {
  const { data, error } = await supabase
    .from('merchants')
    .select('id, shopify_domain, shopify_access_token, shopify_refresh_token, shopify_token_expires_at, shopify_refresh_token_expires_at')
    .eq('id', merchantId)
    .single();

  if (error) throw new Error(`Merchant lookup failed: ${error.message}`);
  if (!data) throw new Error(`Merchant ${merchantId} not found`);
  return data;
}

function needsRefresh(merchant) {
  if (!merchant.shopify_token_expires_at) return false;
  const expiresMs = new Date(merchant.shopify_token_expires_at).getTime();
  return expiresMs - Date.now() < REFRESH_WINDOW_MS;
}

async function getValidShopifyToken(merchantOrId) {
  const merchant = typeof merchantOrId === 'string'
    ? await loadMerchant(merchantOrId)
    : merchantOrId;

  if (!merchant.shopify_access_token) return null;

  if (needsRefresh(merchant) && merchant.shopify_refresh_token) {
    return refreshAccessToken(merchant);
  }

  return merchant.shopify_access_token;
}

async function getShopifyAuth(merchantId) {
  const merchant = await loadMerchant(merchantId);
  const token = await getValidShopifyToken(merchant);
  return { domain: merchant.shopify_domain, token };
}

module.exports = {
  getValidShopifyToken,
  getShopifyAuth,
  refreshAccessToken
};
