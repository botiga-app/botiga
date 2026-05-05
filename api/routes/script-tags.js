// Auto-installs the three Botiga widget scripts on the merchant's Shopify
// theme via the Script Tags API. Idempotent — safe to call repeatedly;
// dedupes by src.
//
// Registered scripts:
//   - video.js  → vertical feed + concierge bot. Loads on EVERY page.
//                 Reads ?btgv=<id> deep-link and auto-opens the feed.
//   - n.js      → Make-an-offer negotiate widget. Loads everywhere but
//                 self-gates to /products/* and /cart pages (silent
//                 no-op elsewhere).
//   - confetti.js → fire-and-forget effects when a deal closes.
//
// Each script's src includes ?k=<api_key> so the widget knows which
// merchant it's running for.

const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { widgetCors } = require('../middleware/cors');

const API_BASE = process.env.WIDGET_API_BASE || 'https://botiga-api-two.vercel.app';

// Returns the canonical src URL for each Botiga widget. The merchant's
// api_key is baked in so the storefront-loaded widget knows which merchant
// it's attached to. Confetti has no api_key — it's pure presentation.
function widgetSources(apiKey) {
  return [
    { name: 'video', src: `${API_BASE}/video.js?k=${encodeURIComponent(apiKey)}` },
    { name: 'n',     src: `${API_BASE}/n.js?k=${encodeURIComponent(apiKey)}` },
    { name: 'confetti', src: `${API_BASE}/public/confetti.js` },
  ];
}

// Pulls the existing script tag list from Shopify so we can dedupe + know
// what's already installed.
async function listScriptTags(shop, accessToken) {
  const res = await fetch(`https://${shop}/admin/api/2024-01/script_tags.json`, {
    headers: { 'X-Shopify-Access-Token': accessToken },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Shopify list failed (${res.status}): ${body}`);
  }
  const json = await res.json();
  return json.script_tags || [];
}

async function createScriptTag(shop, accessToken, src) {
  const res = await fetch(`https://${shop}/admin/api/2024-01/script_tags.json`, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': accessToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ script_tag: { event: 'onload', src } }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Shopify create failed (${res.status}): ${JSON.stringify(data)}`);
  return data.script_tag;
}

// Idempotent — registers any missing widget scripts on the storefront.
// Returns per-script status so callers can surface what was added vs
// already-there.
async function registerAllScripts(shop, accessToken, apiKey) {
  if (!apiKey) throw new Error('apiKey required for widget registration');

  const desired = widgetSources(apiKey);
  const existing = await listScriptTags(shop, accessToken);
  const results = [];

  for (const item of desired) {
    // Match on src prefix (ignoring trailing query params besides our k=)
    // so a key rotation doesn't cause stale tags to look like fresh ones.
    const found = existing.find(t => t.src === item.src);
    if (found) {
      results.push({ name: item.name, status: 'already_registered', id: found.id, src: item.src });
      continue;
    }
    try {
      const created = await createScriptTag(shop, accessToken, item.src);
      results.push({ name: item.name, status: 'registered', id: created.id, src: item.src });
    } catch (err) {
      results.push({ name: item.name, status: 'error', error: err.message, src: item.src });
    }
  }

  return results;
}

// Backwards-compat shim: shopify-oauth.js used to call registerScriptTag().
// Now it should call registerAllScripts() with the merchant's api_key, but
// keep this exported alias so an old-deployment OAuth callback doesn't 500.
async function registerScriptTag(shop, accessToken, apiKeyOrUndefined) {
  if (apiKeyOrUndefined) {
    return registerAllScripts(shop, accessToken, apiKeyOrUndefined);
  }
  // Legacy: only register confetti when no api_key is provided. Caller
  // should be updated to pass api_key.
  const existing = await listScriptTags(shop, accessToken);
  const confettiSrc = `${API_BASE}/public/confetti.js`;
  const found = existing.find(t => t.src === confettiSrc);
  if (found) return { already_registered: true, id: found.id };
  const created = await createScriptTag(shop, accessToken, confettiSrc);
  return { registered: true, id: created.id };
}

// Wipes ALL Botiga script tags from the storefront. Used when rotating
// the api_key (so the old key isn't still embedded in the storefront).
async function unregisterBotigaScripts(shop, accessToken) {
  const existing = await listScriptTags(shop, accessToken);
  const removed = [];
  for (const t of existing) {
    if (t.src && t.src.startsWith(API_BASE)) {
      try {
        await fetch(`https://${shop}/admin/api/2024-01/script_tags/${t.id}.json`, {
          method: 'DELETE',
          headers: { 'X-Shopify-Access-Token': accessToken },
        });
        removed.push({ id: t.id, src: t.src });
      } catch (_) {}
    }
  }
  return removed;
}

// ─── POST /api/setup/script-tag ─────────────────────────────────────────────
// Triggered by the dashboard's Install page Reinstall button. Registers
// all widget scripts (or noops if all already present).
router.post('/setup/script-tag', widgetCors, async (req, res) => {
  const { api_key } = req.body;
  if (!api_key) return res.status(400).json({ error: 'api_key required' });

  const { data: merchant, error } = await supabase
    .from('merchants')
    .select('id, shopify_domain, shopify_access_token, api_key')
    .eq('api_key', api_key)
    .single();

  if (error || !merchant) return res.status(401).json({ error: 'Invalid API key' });
  if (!merchant.shopify_domain || !merchant.shopify_access_token) {
    return res.status(400).json({ error: 'Shopify not connected for this merchant' });
  }

  try {
    const results = await registerAllScripts(merchant.shopify_domain, merchant.shopify_access_token, merchant.api_key);
    res.json({ ok: true, scripts: results });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── GET /api/setup/script-tag ──────────────────────────────────────────────
// Status check — returns per-script install state.
router.get('/setup/script-tag', widgetCors, async (req, res) => {
  const { api_key } = req.query;
  if (!api_key) return res.status(400).json({ error: 'api_key required' });

  const { data: merchant } = await supabase
    .from('merchants')
    .select('shopify_domain, shopify_access_token, api_key')
    .eq('api_key', api_key)
    .single();

  if (!merchant?.shopify_domain) return res.status(400).json({ error: 'Shopify not connected' });

  try {
    const existing = await listScriptTags(merchant.shopify_domain, merchant.shopify_access_token);
    const desired = widgetSources(merchant.api_key);
    const status = desired.map(d => ({
      name: d.name,
      src: d.src,
      installed: !!existing.find(t => t.src === d.src),
    }));
    res.json({ ok: true, all_installed: status.every(s => s.installed), scripts: status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = { router, registerScriptTag, registerAllScripts, unregisterBotigaScripts };
