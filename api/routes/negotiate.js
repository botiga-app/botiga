const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { validateApiKey } = require('../middleware/auth');
const { negotiationLimiter, settingsLimiter } = require('../middleware/rateLimit');
const { widgetCors } = require('../middleware/cors');
const { processNegotiation } = require('../services/negotiation');

// Widget settings — called on page load
router.get('/widget/settings', widgetCors, settingsLimiter, async (req, res) => {
  const apiKey = req.query.k;
  if (!apiKey) return res.status(400).json({ error: 'Missing API key' });

  const { data: merchant, error } = await supabase
    .from('merchants')
    .select('id, plan, trial_ends_at')
    .eq('api_key', apiKey)
    .single();

  if (error || !merchant) return res.status(401).json({ error: 'Invalid API key' });

  if (merchant.plan === 'trial' && new Date(merchant.trial_ends_at) < new Date()) {
    return res.status(402).json({ error: 'Trial expired' });
  }

  const { data: settings } = await supabase
    .from('merchant_settings')
    .select('*')
    .eq('merchant_id', merchant.id)
    .single();

  // Return only fields safe for public consumption
  res.json({
    tone: settings?.tone || 'friendly',
    button_label: settings?.button_label || 'Make an offer',
    button_color: settings?.button_color || null,
    button_text_color: settings?.button_text_color || null,
    button_position: settings?.button_position || 'below-cart',
    negotiate_on_product: settings?.negotiate_on_product ?? true,
    negotiate_on_cart: settings?.negotiate_on_cart ?? true,
    recovery_enabled: settings?.recovery_enabled ?? true,
    dwell_time_seconds: settings?.dwell_time_seconds ?? 5,
    plan: merchant.plan
  });
});

// Core negotiation endpoint
router.post('/negotiate', widgetCors, negotiationLimiter, validateApiKey, async (req, res) => {
  const {
    session_id,
    negotiation_id,
    product_name,
    product_url,
    variant_id,
    list_price,
    customer_message,
  } = req.body;

  if (!session_id || !list_price || !customer_message) {
    return res.status(400).json({ error: 'Missing required fields: session_id, list_price, customer_message' });
  }

  if (typeof list_price !== 'number' || list_price <= 0) {
    return res.status(400).json({ error: 'list_price must be a positive number' });
  }

  const merchantId = req.merchant.id;

  const [{ data: settings }, { data: merchant }] = await Promise.all([
    supabase.from('merchant_settings').select('*').eq('merchant_id', merchantId).single(),
    supabase.from('merchants').select('shopify_access_token, shopify_domain').eq('id', merchantId).single()
  ]);

  // Fall back to env vars if merchant record doesn't have Shopify creds
  const shopifyDomain = merchant?.shopify_domain || process.env.SHOPIFY_DOMAIN || null;
  const shopifyAccessToken = merchant?.shopify_access_token || process.env.SHOPIFY_ACCESS_TOKEN || null;

  const merchantSettings = settings || {
    tone: 'friendly',
    max_discount_pct: 20,
    floor_price_pct: null,
    floor_price_fixed: null,
    broker_fee_pct: 25,
    recovery_enabled: true
  };

  try {
    const result = await processNegotiation({
      merchantId,
      merchantSettings,
      shopifyDomain,
      shopifyAccessToken,
      sessionId: session_id,
      negotiationId: negotiation_id || null,
      productName: product_name || 'this item',
      productUrl: product_url || null,
      variantId: variant_id || null,
      listPrice: list_price,
      customerMessage: customer_message
    });

    res.json({
      negotiation_id: result.negotiationId,
      bot_reply: result.reply,
      status: result.status,
      deal_price: result.dealPrice,
      checkout_url: result.checkoutUrl,
      broker_fee: result.brokerFee,
      expires_at: result.expiresAt
    });
  } catch (err) {
    console.error('[negotiate] Error:', err.message);
    res.status(500).json({ error: 'Negotiation service temporarily unavailable' });
  }
});

module.exports = router;
