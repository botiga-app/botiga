const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const supabase = require('../lib/supabase');

const SHOPIFY_CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const SHOPIFY_CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const APP_URL = process.env.APP_URL || 'https://hexagonally-brownish-jenny.ngrok-free.dev';
const SCOPES = 'write_price_rules,write_discounts,read_products';

// Step 1: Initiate OAuth — visit /api/shopify/install?shop=botiga-6380.myshopify.com&merchant_id=UUID
router.get('/shopify/install', (req, res) => {
  const shop = req.query.shop;
  const merchantId = req.query.merchant_id;
  if (!shop) return res.status(400).send('Missing shop parameter');

  // Encode merchant_id into state so callback can look it up directly
  const nonce = crypto.randomBytes(16).toString('hex');
  const statePayload = merchantId ? `${nonce}.${merchantId}` : nonce;
  const redirectUri = `${APP_URL}/api/shopify/callback`;
  const installUrl = `https://${shop}/admin/oauth/authorize?client_id=${SHOPIFY_CLIENT_ID}&scope=${SCOPES}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${statePayload}`;

  res.cookie('shopify_state', statePayload, { httpOnly: true, maxAge: 60000 });
  res.redirect(installUrl);
});

// Step 2: OAuth callback — Shopify redirects here with code
router.get('/shopify/callback', async (req, res) => {
  const { shop, code, state } = req.query;

  if (!shop || !code) return res.status(400).send('Missing parameters');

  // Exchange code for access token
  const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: SHOPIFY_CLIENT_ID,
      client_secret: SHOPIFY_CLIENT_SECRET,
      code
    })
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    console.error('[Shopify OAuth] Token exchange failed:', err);
    return res.status(500).send('Token exchange failed: ' + err);
  }

  const { access_token } = await tokenRes.json();
  const storeDomain = shop;

  console.log(`\n✅ Shopify access token for ${storeDomain}:\n${access_token}\n`);

  // Extract merchant_id from state payload (format: "nonce.merchant_id" or just "nonce")
  const stateParts = (state || '').split('.');
  const merchantId = stateParts.length === 2 ? stateParts[1] : null;

  let merchant = null;

  // 1. Direct match by merchant_id from state (most reliable)
  if (merchantId) {
    const { data: byId } = await supabase
      .from('merchants')
      .select('id')
      .eq('id', merchantId)
      .single();
    if (byId) merchant = byId;
  }

  // 2. Match by shopify_domain already stored
  if (!merchant) {
    const { data: byDomain } = await supabase
      .from('merchants')
      .select('id')
      .eq('shopify_domain', storeDomain)
      .single();
    if (byDomain) merchant = byDomain;
  }

  // 3. Fall back to first merchant (single-merchant setup)
  if (!merchant) {
    const { data: first } = await supabase
      .from('merchants')
      .select('id')
      .limit(1)
      .single();
    if (first) merchant = first;
  }

  if (merchant) {
    await supabase.from('merchants').update({
      shopify_access_token: access_token,
      shopify_domain: storeDomain
    }).eq('id', merchant.id);
    console.log('[Shopify OAuth] Token saved to merchant', merchant.id);
  } else {
    console.log('[Shopify OAuth] No merchant found — token logged above');
  }

  res.send(`
    <html><body style="font-family:system-ui;padding:40px;max-width:600px;margin:auto">
      <h2>✅ Shopify connected!</h2>
      <p><strong>Store:</strong> ${storeDomain}</p>
      <p><strong>Access token:</strong></p>
      <code style="background:#f4f4f4;padding:12px;display:block;border-radius:8px;word-break:break-all">${access_token}</code>
      <p style="color:#666;margin-top:20px">Copy this token and add it to your <code>api/.env</code> as:<br>
      <code>SHOPIFY_ACCESS_TOKEN=${access_token}<br>SHOPIFY_DOMAIN=${storeDomain}</code></p>
    </body></html>
  `);
});

module.exports = router;
