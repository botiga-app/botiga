const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { widgetCors } = require('../middleware/cors');

const CONFETTI_URL = 'https://botiga-api-two.vercel.app/public/confetti.js';

async function registerScriptTag(shop, accessToken) {
  // Check if already registered
  const listRes = await fetch(`https://${shop}/admin/api/2024-01/script_tags.json`, {
    headers: { 'X-Shopify-Access-Token': accessToken }
  });
  const list = await listRes.json();
  const existing = (list.script_tags || []).find(t => t.src === CONFETTI_URL);
  if (existing) return { already_registered: true, id: existing.id };

  // Register new script tag
  const res = await fetch(`https://${shop}/admin/api/2024-01/script_tags.json`, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': accessToken,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      script_tag: { event: 'onload', src: CONFETTI_URL }
    })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return { registered: true, id: data.script_tag.id };
}

// POST /api/setup/script-tag  — registers confetti Script Tag for a merchant
router.post('/setup/script-tag', widgetCors, async (req, res) => {
  const { api_key } = req.body;
  if (!api_key) return res.status(400).json({ error: 'api_key required' });

  const { data: merchant, error } = await supabase
    .from('merchants')
    .select('shopify_domain, shopify_access_token')
    .eq('api_key', api_key)
    .single();

  if (error || !merchant) return res.status(401).json({ error: 'Invalid API key' });
  if (!merchant.shopify_domain || !merchant.shopify_access_token) {
    return res.status(400).json({ error: 'Shopify not connected for this merchant' });
  }

  try {
    const result = await registerScriptTag(merchant.shopify_domain, merchant.shopify_access_token);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/setup/script-tag — check status
router.get('/setup/script-tag', widgetCors, async (req, res) => {
  const { api_key } = req.query;
  if (!api_key) return res.status(400).json({ error: 'api_key required' });

  const { data: merchant } = await supabase
    .from('merchants')
    .select('shopify_domain, shopify_access_token')
    .eq('api_key', api_key)
    .single();

  if (!merchant?.shopify_domain) return res.status(400).json({ error: 'Shopify not connected' });

  try {
    const listRes = await fetch(`https://${merchant.shopify_domain}/admin/api/2024-01/script_tags.json`, {
      headers: { 'X-Shopify-Access-Token': merchant.shopify_access_token }
    });
    const list = await listRes.json();
    const tag = (list.script_tags || []).find(t => t.src === CONFETTI_URL);
    res.json({ registered: !!tag, tag: tag || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = { router, registerScriptTag };
