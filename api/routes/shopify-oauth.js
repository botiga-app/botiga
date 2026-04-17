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

  let saveStatus = 'No merchant found';
  if (merchant) {
    const { error: updateError } = await supabase.from('merchants').update({
      shopify_access_token: access_token,
      shopify_domain: storeDomain
    }).eq('id', merchant.id);

    if (updateError) {
      console.error('[Shopify OAuth] DB update failed:', updateError.message);
      saveStatus = `DB update failed: ${updateError.message}`;
    } else {
      saveStatus = `Saved to merchant ${merchant.id}`;
      console.log('[Shopify OAuth] Token saved to merchant', merchant.id);
      // Auto-register confetti Script Tag on install
      try {
        const { registerScriptTag } = require('./script-tags');
        const tagResult = await registerScriptTag(storeDomain, access_token);
        console.log('[Shopify OAuth] Script tag:', tagResult);
      } catch (e) {
        console.warn('[Shopify OAuth] Script tag registration failed:', e.message);
      }
    }
  }

  res.send(`
    <html><body style="font-family:system-ui;padding:40px;max-width:600px;margin:auto">
      <h2>✅ Shopify connected!</h2>
      <p><strong>Store:</strong> ${storeDomain}</p>
      <p><strong>Save status:</strong> <code>${saveStatus}</code></p>
      <p><strong>Access token:</strong></p>
      <code style="background:#f4f4f4;padding:12px;display:block;border-radius:8px;word-break:break-all">${access_token}</code>
      <hr style="margin:24px 0;border:none;border-top:1px solid #eee"/>
      <p style="color:#666"><strong>If save status shows an error</strong>, the DB columns are missing. Run this SQL in Supabase:</p>
      <code style="background:#f4f4f4;padding:12px;display:block;border-radius:8px;font-size:12px">
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS shopify_access_token TEXT;<br>
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS shopify_domain TEXT;
      </code>
      <p style="color:#666;margin-top:16px">Then set these in Vercel env vars as an immediate bridge:<br>
      <code>SHOPIFY_ACCESS_TOKEN=${access_token}<br>SHOPIFY_DOMAIN=${storeDomain}</code></p>
    </body></html>
  `);
});

// Diagnostic: GET /api/shopify/status?merchant_id=UUID
// Shows exactly what's in DB and whether the Shopify API responds
router.get('/shopify/status', async (req, res) => {
  const merchantId = req.query.merchant_id;
  if (!merchantId) return res.status(400).json({ error: 'merchant_id required' });

  const { data: merchant, error } = await supabase
    .from('merchants')
    .select('id, email, shopify_domain, shopify_access_token')
    .eq('id', merchantId)
    .single();

  if (error) return res.status(404).json({ error: 'Merchant not found', detail: error.message });

  const domain = merchant.shopify_domain || process.env.SHOPIFY_DOMAIN;
  const token = merchant.shopify_access_token || process.env.SHOPIFY_ACCESS_TOKEN;

  const status = {
    merchant_id: merchant.id,
    shopify_domain_in_db: merchant.shopify_domain,
    shopify_domain_effective: domain,
    token_in_db: merchant.shopify_access_token ? `${merchant.shopify_access_token.slice(0, 10)}...` : null,
    token_from_env: process.env.SHOPIFY_ACCESS_TOKEN ? `${process.env.SHOPIFY_ACCESS_TOKEN.slice(0, 10)}...` : null,
    token_effective: token ? `${token.slice(0, 10)}...` : null,
    ready: !!(domain && token),
    shopify_api_test: null
  };

  // Live test the Shopify API if we have credentials
  if (domain && token) {
    try {
      const testRes = await fetch(`https://${domain}/admin/api/2024-01/shop.json`, {
        headers: { 'X-Shopify-Access-Token': token }
      });
      if (testRes.ok) {
        const { shop } = await testRes.json();
        status.shopify_api_test = `OK — connected to "${shop.name}" (${shop.myshopify_domain})`;
      } else {
        status.shopify_api_test = `FAILED — ${testRes.status}: ${await testRes.text()}`;
        status.ready = false;
      }
    } catch (e) {
      status.shopify_api_test = `ERROR — ${e.message}`;
      status.ready = false;
    }

    // Also test read_products scope specifically (shop.json works with any token)
    try {
      const prodRes = await fetch(`https://${domain}/admin/api/2024-01/products.json?limit=1`, {
        headers: { 'X-Shopify-Access-Token': token }
      });
      if (prodRes.ok) {
        status.products_scope_test = 'OK — read_products scope confirmed';
      } else {
        const body = await prodRes.text();
        status.products_scope_test = `FAILED (${prodRes.status}) — token lacks read_products scope. Re-run OAuth to grant access. Detail: ${body}`;
        status.ready = false;
      }
    } catch (e) {
      status.products_scope_test = `ERROR — ${e.message}`;
    }
  }

  res.json(status);
});

module.exports = router;
