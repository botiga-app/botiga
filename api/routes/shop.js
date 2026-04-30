const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { widgetCors } = require('../middleware/cors');

// Public lookup: who lives at botiga.ai/shop/<handle>?
// Returns just enough to render the shoppable feed page on the marketplace —
// merchant display name, api_key (the widget needs it to load), and counts.
router.get('/shop/:handle', widgetCors, async (req, res) => {
  const handle = (req.params.handle || '').toLowerCase().trim();
  if (!handle) return res.status(400).json({ error: 'Missing handle' });

  const { data: merchant, error } = await supabase
    .from('merchants')
    .select('id, name, api_key, shop_handle, shopify_domain, plan')
    .eq('shop_handle', handle)
    .maybeSingle();

  if (error) {
    console.error('[shop]', handle, error.message);
    return res.status(500).json({ error: 'Lookup failed', detail: error.message });
  }
  if (!merchant) {
    return res.status(404).json({ error: 'Shop not found', handle });
  }

  // Tiny stat block so the landing page can show "12 videos · 47 products"
  const [videosRes, productsRes] = await Promise.all([
    supabase.from('videos').select('id', { count: 'exact', head: true }).eq('merchant_id', merchant.id),
    supabase.from('products').select('id', { count: 'exact', head: true }).eq('merchant_id', merchant.id),
  ]);

  res.json({
    name: merchant.name || merchant.shop_handle,
    shop_handle: merchant.shop_handle,
    api_key: merchant.api_key,
    plan: merchant.plan || 'free',
    video_count: videosRes.count || 0,
    product_count: productsRes.count || 0,
  });
});

module.exports = router;
