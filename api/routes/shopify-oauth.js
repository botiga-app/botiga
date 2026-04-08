const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const supabase = require('../lib/supabase');

const SHOPIFY_CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const SHOPIFY_CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const APP_URL = process.env.APP_URL || 'https://hexagonally-brownish-jenny.ngrok-free.dev';
const SCOPES = 'write_price_rules,write_discounts,read_products';

// Step 1: Initiate OAuth — visit /api/shopify/install?shop=botiga-6380.myshopify.com
router.get('/shopify/install', (req, res) => {
  const shop = req.query.shop;
  if (!shop) return res.status(400).send('Missing shop parameter');

  const state = crypto.randomBytes(16).toString('hex');
  const redirectUri = `${APP_URL}/api/shopify/callback`;
  const installUrl = `https://${shop}/admin/oauth/authorize?client_id=${SHOPIFY_CLIENT_ID}&scope=${SCOPES}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;

  res.cookie('shopify_state', state, { httpOnly: true, maxAge: 60000 });
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

  // Try to match merchant by shopify_domain, website_url, or any partial match
  let merchant = null;

  // 1. Match by shopify_domain already stored
  const { data: byDomain } = await supabase
    .from('merchants')
    .select('id')
    .eq('shopify_domain', storeDomain)
    .single();
  if (byDomain) merchant = byDomain;

  // 2. Match by website_url containing the myshopify domain
  if (!merchant) {
    const { data: byUrl } = await supabase
      .from('merchants')
      .select('id')
      .eq('website_url', `https://${storeDomain}`)
      .single();
    if (byUrl) merchant = byUrl;
  }

  // 3. Match by website_url containing botiga-6380 (handles custom domain case)
  if (!merchant) {
    const { data: byPartial } = await supabase
      .from('merchants')
      .select('id')
      .ilike('website_url', '%botiga-6380%')
      .single();
    if (byPartial) merchant = byPartial;
  }

  // 4. Fall back to first merchant (single-merchant setup)
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
